import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { callerOf, type Auth } from "./auth.ts";
import type { RegionConfig } from "./config.ts";
import { rejections } from "./errors.ts";
import {
  inquirySchema,
  paymentSchema,
  type InquiryParams,
  type PaymentBody,
} from "./schemas.ts";

type Dependencies = { db: Pool; region: RegionConfig; auth: Auth };

type Reference = {
  code: string;
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
  { db, region, auth }: Dependencies,
): void {
  // The inquiry is informative: it never registers anything. It tells the payment method
  // everything about the reference, even what it does not need to charge.
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
        message: "The reference can be paid",
        reference: reference.code,
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
      const reference = await findReference(db, code);
      if (!reference) {
        return rejections.notFound;
      }
      const { folio, authorization } = await registerPayment(db, region, {
        reference,
        paymentMethodId: callerOf(request).id,
        amount,
        sequence,
        at: new Date(),
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

async function findReference(
  db: Pool,
  code: string,
): Promise<Reference | undefined> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT code, type, amount_type, amount, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on
     FROM payment_references WHERE code = ?`,
    [code],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  return {
    code: row.code,
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
