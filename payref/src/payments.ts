import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { callerOf, type Auth } from "./auth.ts";
import type { PaymentMethodConfig, RegionConfig } from "./config.ts";
import { rejections } from "./errors.ts";
import { nowOf } from "./clock.ts";
import { checkAmount, checkExpiry } from "./rules.ts";
import {
  inquirySchema,
  paymentSchema,
  type InquiryParams,
  type PaymentBody,
} from "./schemas.ts";

type Dependencies = {
  db: Pool;
  region: RegionConfig;
  auth: Auth;
  bugs: ReadonlySet<number>;
};

type Reference = {
  code: string;
  status: "active" | "paid" | "cancelled";
  type: "single" | "recurring";
  amountType: "fixed" | "open";
  amount: number | null;
  expiresOn: string | null;
};

type NewPayment = {
  reference: Reference;
  paymentMethodId: string;
  amount: number;
  sequence: string;
  at: Date;
};

export function registerPayments(
  app: FastifyInstance,
  { db, region, auth, bugs }: Dependencies,
): void {
  // The inquiry only informs, and it never registers anything (HU-08). It tells the payment
  // method everything about the reference, its state too, but it validates nothing: the payment
  // always does, whether there was an inquiry or not. Only a reference that does not exist has
  // nothing to tell.
  app.get<{ Params: InquiryParams }>(
    "/inquiries/:reference",
    {
      schema: inquirySchema,
      preHandler: auth.allow("paymentMethod", "inquiry"),
    },
    async (request) => {
      const reference = await findReference(db, request.params.reference);
      if (!reference) {
        return rejections.notFound;
      }
      return {
        code: "OK",
        message: "The reference was found",
        reference: reference.code,
        status: reference.status,
        type: reference.type,
        amountType: reference.amountType,
        amount: reference.amount ?? undefined,
        expiresOn: reference.expiresOn ?? undefined,
      };
    },
  );

  // The payment request and the payment notice in one call, like a supermarket that only
  // calls once the customer has paid.
  app.post<{ Body: PaymentBody }>(
    "/payments",
    {
      schema: paymentSchema,
      preHandler: auth.allow("paymentMethod", "payment"),
    },
    async (request) => {
      const { reference: code, amount, sequence } = request.body;
      const caller = callerOf(request);
      const reference = await findReference(db, code);
      if (!reference) {
        return rejections.notFound;
      }
      const now = nowOf(request);
      const expired = checkExpiry(reference.expiresOn, now, region, bugs);
      if (expired) {
        return expired;
      }
      const checked = checkAmount(
        amount,
        reference,
        paymentMethodOf(region, caller.id),
        region,
        bugs,
      );
      if ("rejection" in checked) {
        return checked.rejection;
      }
      // A single reference takes one payment, whatever sequence comes, and this goes before the
      // sequence: that is why a repeated notice on a paid single gets R-102 (8.4).
      if (
        reference.type === "single" &&
        (await hasConfirmedPayment(db, reference.code))
      ) {
        return rejections.alreadyPaid;
      }
      // The sequence belongs to the payment method: one it already used is a repeated notice.
      // Bug 1: the repeated notice registers another payment.
      if (!bugs.has(1) && (await sequenceUsed(db, caller.id, sequence))) {
        return rejections.repeatedNotice;
      }
      const { folio, authorization } = await registerPayment(db, region, {
        reference,
        paymentMethodId: caller.id,
        amount: checked.amount,
        sequence,
        at: now,
      });
      return {
        code: "OK",
        message: "Payment registered",
        folio,
        authorization,
      };
    },
  );
}

async function hasConfirmedPayment(db: Pool, code: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM movements WHERE reference_code = ? AND status = 'confirmed' LIMIT 1",
    [code],
  );
  return rows.length > 0;
}

async function sequenceUsed(
  db: Pool,
  paymentMethodId: string,
  sequence: string,
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM movements WHERE payment_method_id = ? AND sequence = ? LIMIT 1",
    [paymentMethodId, sequence],
  );
  return rows.length > 0;
}

function paymentMethodOf(
  region: RegionConfig,
  id: string,
): PaymentMethodConfig {
  const method = region.paymentMethods.find((item) => item.id === id);
  if (!method) {
    throw new Error(`The payment method ${id} is not in the region`);
  }
  return method;
}

async function findReference(
  db: Pool,
  code: string,
): Promise<Reference | undefined> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT code, status, type, amount_type, amount, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on
     FROM payment_references WHERE code = ?`,
    [code],
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

async function registerPayment(
  db: Pool,
  region: RegionConfig,
  payment: NewPayment,
): Promise<{ folio: string; authorization: string }> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO movements (reference_code, payment_method_id, sequence, amount, status, requested_at, confirmed_at)
       VALUES (?, ?, ?, ?, 'confirmed', ?, ?)`,
      [
        payment.reference.code,
        payment.paymentMethodId,
        payment.sequence,
        payment.amount,
        payment.at,
        payment.at,
      ],
    );
    const folio = `${region.region.toUpperCase()}-${String(result.insertId).padStart(10, "0")}`;
    const authorization = authorizationCode();
    await connection.query(
      "UPDATE movements SET folio = ?, authorization_code = ? WHERE id = ?",
      [folio, authorization, result.insertId],
    );
    if (payment.reference.type === "single") {
      await connection.query(
        "UPDATE payment_references SET status = 'paid' WHERE code = ?",
        [payment.reference.code],
      );
    }
    await connection.commit();
    return { folio, authorization };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const authorizationCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Random, so it never depends on the reference or on the time.
function authorizationCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += authorizationCharacters.charAt(
      randomInt(authorizationCharacters.length),
    );
  }
  return code;
}
