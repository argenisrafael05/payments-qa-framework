import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { callerOf, type Auth } from "./auth.ts";
import { nowOf, regionDate } from "./clock.ts";
import type { RegionConfig } from "./config.ts";
import { rejections } from "./errors.ts";
import { checkExpiry, decimalsOf, stateOf } from "./rules.ts";
import { hasPaymentInWindow, settleWindows } from "./window.ts";
import {
  cancelReferenceSchema,
  createReferenceSchema,
  viewReferenceSchema,
  type CreateReferenceBody,
  type ReferenceParams,
} from "./schemas.ts";

type Dependencies = {
  db: Pool;
  region: RegionConfig;
  auth: Auth;
  bugs: ReadonlySet<number>;
};

type OwnReference = {
  code: string;
  status: "active" | "paid" | "cancelled";
  type: "single" | "recurring";
  amountType: "fixed" | "open";
  amount: number | null;
  expiresOn: string | null;
};

export function registerReferences(
  app: FastifyInstance,
  { db, region, auth, bugs }: Dependencies,
): void {
  app.post<{ Body: CreateReferenceBody }>(
    "/references",
    { schema: createReferenceSchema, onRequest: auth.allow("merchant") },
    async (request, reply) => {
      const { type, amountType, amount, expiresOn } = request.body;
      if (amountType === "fixed" && amount === undefined) {
        return reply
          .code(400)
          .send({ message: "amount is required for a fixed reference" });
      }
      if (amountType === "open" && amount !== undefined) {
        return reply
          .code(400)
          .send({ message: "amount is only for a fixed reference" });
      }
      if (amount !== undefined && decimalsOf(amount) > region.decimals) {
        return reply.code(400).send({
          message: `amount can have up to ${region.decimals} decimals in this region`,
        });
      }
      // Today can still be paid, so a reference that expires today is created (8.3).
      if (
        expiresOn !== undefined &&
        expiresOn < regionDate(nowOf(request), region.utcOffset)
      ) {
        return reply
          .code(400)
          .send({ message: "expiresOn is a day that already passed" });
      }

      const code = randomDigits(region.referenceLength);
      await db.query(
        `INSERT INTO payment_references (code, merchant_id, type, amount_type, amount, expires_on, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          code,
          callerOf(request).id,
          type,
          amountType,
          amount ?? null,
          expiresOn ?? null,
          nowOf(request),
        ],
      );

      return {
        code: "OK",
        message: "Reference created",
        reference: code,
        status: "active",
        type,
        amountType,
        amount,
        expiresOn,
      };
    },
  );

  // The merchant sees its reference with its state, computed for an expired one.
  app.get<{ Params: ReferenceParams }>(
    "/references/:reference",
    { schema: viewReferenceSchema, onRequest: auth.allow("merchant") },
    async (request) => {
      await settleWindows(db, region, request.params.reference, nowOf(request));
      const reference = await ownReference(
        db,
        request.params.reference,
        callerOf(request).id,
      );
      if (!reference) {
        return rejections.notFound;
      }
      return {
        code: "OK",
        message: "Reference found",
        reference: reference.code,
        status: stateOf(reference, nowOf(request), region, bugs),
        type: reference.type,
        amountType: reference.amountType,
        amount: reference.amount ?? undefined,
        expiresOn: reference.expiresOn ?? undefined,
      };
    },
  );

  // Only an active reference is cancelled. One that no longer is answers its own code, in the
  // order of 8.4: cancelled, expired, and a single that is paid (US-07). While the reversal
  // window of a payment runs, it is not cancelled either (US-10).
  app.post<{ Params: ReferenceParams }>(
    "/references/:reference/cancellation",
    { schema: cancelReferenceSchema, onRequest: auth.allow("merchant") },
    async (request) => {
      await settleWindows(db, region, request.params.reference, nowOf(request));
      const reference = await ownReference(
        db,
        request.params.reference,
        callerOf(request).id,
      );
      if (!reference) {
        return rejections.notFound;
      }
      if (reference.status === "cancelled") {
        return rejections.cancelled;
      }
      const expired = checkExpiry(
        reference.expiresOn,
        nowOf(request),
        region,
        bugs,
      );
      if (expired) {
        return expired;
      }
      if (reference.status === "paid") {
        return rejections.alreadyPaid;
      }
      if (await hasPaymentInWindow(db, region, reference.code)) {
        return rejections.paymentInProgress;
      }
      await db.query(
        "UPDATE payment_references SET status = 'cancelled' WHERE code = ?",
        [reference.code],
      );
      return {
        code: "OK",
        message: "Reference cancelled",
        reference: reference.code,
        status: "cancelled",
      };
    },
  );
}

// A reference of another merchant does not exist for this one, so its answer never reveals it.
async function ownReference(
  db: Pool,
  code: string,
  merchantId: string,
): Promise<OwnReference | undefined> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT code, status, type, amount_type, amount, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on
     FROM payment_references WHERE code = ? AND merchant_id = ?`,
    [code, merchantId],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  return {
    code: row.code,
    status: row.status,
    type: row.type,
    amountType: row.amount_type,
    amount: row.amount === null ? null : Number(row.amount),
    expiresOn: row.expires_on,
  };
}

function randomDigits(length: number): string {
  let digits = "";
  for (let i = 0; i < length; i++) {
    digits += String(randomInt(10));
  }
  return digits;
}
