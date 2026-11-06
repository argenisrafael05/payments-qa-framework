import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { callerOf, type Auth } from "./auth.ts";
import type { PaymentMethodConfig, RegionConfig } from "./config.ts";
import { rejections } from "./errors.ts";
import { nowOf } from "./clock.ts";
import { checkAmount, checkExpiry, stateOf } from "./rules.ts";
import {
  inquirySchema,
  paymentNoticeSchema,
  paymentSchema,
  reversalSchema,
  type InquiryParams,
  type PaymentBody,
  type PaymentNoticeBody,
} from "./schemas.ts";
import {
  confirmPayment,
  hasPaymentInWindow,
  hasWindow,
  settleWindows,
  windowEnd,
} from "./window.ts";

type Dependencies = {
  db: Pool;
  region: RegionConfig;
  auth: Auth;
  bugs: ReadonlySet<number>;
};

export type Reference = {
  code: string;
  merchantId: string;
  status: "active" | "paid" | "cancelled";
  type: "single" | "recurring";
  amountType: "fixed" | "open";
  amount: number | null;
  expiresOn: string | null;
};

export type Rejection = (typeof rejections)[keyof typeof rejections];

type NewPayment = {
  reference: Reference;
  paymentMethodId: string;
  amount: number;
  sequence: string;
  at: Date;
  // Confirmed in one call, or pending until the notice of its request.
  status: "confirmed" | "pending";
};

type Movement = {
  id: number;
  folio: string;
  authorization: string;
  referenceCode: string;
  referenceType: "single" | "recurring";
  status: "pending" | "confirmed" | "reversed";
  requestedAt: Date;
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
      onRequest: auth.allow("paymentMethod", "inquiry"),
    },
    async (request) => {
      const now = nowOf(request);
      await settleWindows(db, region, request.params.reference, now);
      const reference = await findReference(db, request.params.reference);
      if (!reference) {
        return rejections.notFound;
      }
      return {
        code: "OK",
        message: "The reference was found",
        reference: reference.code,
        status: stateOf(reference, now, region, bugs),
        type: reference.type,
        amountType: reference.amountType,
        amount: reference.amount ?? undefined,
        expiresOn: reference.expiresOn ?? undefined,
      };
    },
  );

  const { validate } = paymentRules({ db, region, bugs });

  // The payment request and the payment notice in one call, like a supermarket that only
  // calls once the customer has paid.
  app.post<{ Body: PaymentBody }>(
    "/payments",
    {
      schema: paymentSchema,
      onRequest: auth.allow("paymentMethod", "payment"),
    },
    async (request) => {
      const caller = callerOf(request);
      const now = nowOf(request);
      const validated = await validate(request.body, caller.id, now);
      if ("rejection" in validated) {
        return validated.rejection;
      }
      const { folio, authorization } = await registerPayment(db, region, {
        reference: validated.reference,
        paymentMethodId: caller.id,
        amount: validated.amount,
        sequence: request.body.sequence,
        at: now,
        status: "confirmed",
      });
      return {
        code: "OK",
        message: "Payment registered",
        folio,
        authorization,
      };
    },
  );

  // The request alone, for a payment method that validates before it charges. It validates like
  // the payment in one call, and the payment stays pending until its notice: the reversal window
  // opens here, when its payment method has one (HU-10).
  app.post<{ Body: PaymentBody }>(
    "/payment-requests",
    {
      schema: paymentSchema,
      onRequest: auth.allow("paymentMethod", "request"),
    },
    async (request) => {
      const caller = callerOf(request);
      const now = nowOf(request);
      const validated = await validate(request.body, caller.id, now);
      if ("rejection" in validated) {
        return validated.rejection;
      }
      const { folio, authorization } = await registerPayment(db, region, {
        reference: validated.reference,
        paymentMethodId: caller.id,
        amount: validated.amount,
        sequence: request.body.sequence,
        at: now,
        status: "pending",
      });
      return {
        code: "OK",
        message: "Payment requested",
        folio,
        authorization,
      };
    },
  );

  // The notice confirms the pending payment of its request. It does not validate again: the
  // customer paid while the reference applied (HU-10). A second notice of a confirmed payment,
  // also one its window already confirmed, is a repeated notice, or R-102 on a single
  // reference, and the notice of a reversed one comes after its window closed (8.7).
  app.post<{ Body: PaymentNoticeBody }>(
    "/payment-notices",
    {
      schema: paymentNoticeSchema,
      onRequest: auth.allow("paymentMethod", "notice"),
    },
    async (request) => {
      const caller = callerOf(request);
      const now = nowOf(request);
      const movement = await settledMovement(
        request.body.folio,
        caller.id,
        now,
      );
      // A folio this payment method never got is a payment that does not exist for it.
      if (!movement) {
        return rejections.notFound;
      }
      if (movement.status === "confirmed") {
        return movement.referenceType === "single"
          ? rejections.alreadyPaid
          : rejections.repeatedNotice;
      }
      if (movement.status === "reversed") {
        return rejections.windowClosed;
      }
      // Without the window, the notice validates again, because in between the reference could
      // be cancelled, expire or get paid (HU-08). With it, the payment is protected (HU-10).
      if (!hasWindow(region, caller.id)) {
        const rejection = await validateAgain(movement.referenceCode, now);
        if (rejection) {
          return rejection;
        }
      }
      await confirmPayment(db, movement, now);
      return {
        code: "OK",
        message: "Payment confirmed",
        folio: movement.folio,
        authorization: movement.authorization,
      };
    },
  );

  // The reversal undoes the pending payment while its window runs, and the reference can be paid
  // again: it never got paid. At the end of the window exactly, the window is already closed,
  // and so it is after a notice or another reversal (8.7).
  app.post<{ Body: PaymentNoticeBody }>(
    "/reversals",
    {
      schema: reversalSchema,
      onRequest: auth.allow("paymentMethod", "reversal"),
    },
    async (request) => {
      const caller = callerOf(request);
      const now = nowOf(request);
      const movement = await movementOf(db, request.body.folio, caller.id);
      if (!movement) {
        return rejections.notFound;
      }
      const end = windowEnd(region, caller.id, movement.requestedAt);
      // Bug 8: the reversal is still taken at the end of the window exactly.
      const open = end !== undefined && (bugs.has(8) ? now <= end : now < end);
      if (movement.status !== "pending" || !open) {
        await settleWindows(db, region, movement.referenceCode, now);
        return rejections.windowClosed;
      }
      await db.query(
        "UPDATE movements SET status = 'reversed', reversed_at = ? WHERE id = ?",
        [now, movement.id],
      );
      return {
        code: "OK",
        message: "Payment reversed",
        folio: movement.folio,
      };
    },
  );

  // What can change between the request and the notice, in the order of 8.4.
  async function validateAgain(
    code: string,
    now: Date,
  ): Promise<Rejection | undefined> {
    const reference = await findReference(db, code);
    if (!reference) {
      return rejections.notFound;
    }
    if (reference.status === "cancelled") {
      return rejections.cancelled;
    }
    const expired = checkExpiry(reference.expiresOn, now, region, bugs);
    if (expired) {
      return expired;
    }
    if (
      reference.type === "single" &&
      (await hasConfirmedPayment(db, reference.code))
    ) {
      return rejections.alreadyPaid;
    }
    return undefined;
  }

  // The movement of a folio, after the window of its reference had its chance to end.
  async function settledMovement(
    folio: string,
    paymentMethodId: string,
    now: Date,
  ): Promise<Movement | undefined> {
    const movement = await movementOf(db, folio, paymentMethodId);
    if (!movement) {
      return undefined;
    }
    await settleWindows(db, region, movement.referenceCode, now);
    return movementOf(db, folio, paymentMethodId);
  }
}

// The rules every payment goes through, shared by the routes of the payment methods and by the
// bridge of the wallet, which reuses the standard request and notice (HU-11).
export function paymentRules({ db, region, bugs }: Omit<Dependencies, "auth">) {
  // What every payment goes through, in the order of 8.4: in one call, in its request, or in what
  // the bridge of the wallet asks for. A request for a payment resource brings no sequence yet.
  async function validate(
    body: { reference: string; amount: number; sequence?: string },
    paymentMethodId: string,
    now: Date,
    checks: { expiry: boolean } = { expiry: true },
  ): Promise<
    { reference: Reference; amount: number } | { rejection: Rejection }
  > {
    await settleWindows(db, region, body.reference, now);
    const reference = await findReference(db, body.reference);
    if (!reference) {
      return { rejection: rejections.notFound };
    }
    // A cancelled reference is never paid, and this goes before its expiry (8.4).
    if (reference.status === "cancelled") {
      return { rejection: rejections.cancelled };
    }
    const expired = checks.expiry
      ? checkExpiry(reference.expiresOn, now, region, bugs)
      : undefined;
    if (expired) {
      return { rejection: expired };
    }
    const checked = checkAmount(
      body.amount,
      reference,
      paymentMethodOf(region, paymentMethodId),
      region,
      bugs,
    );
    if ("rejection" in checked) {
      return checked;
    }
    // A single reference takes one payment, whatever sequence comes, and this goes before the
    // sequence: that is why a repeated notice on a paid single gets R-102 (8.4).
    if (
      reference.type === "single" &&
      (await hasConfirmedPayment(db, reference.code))
    ) {
      return { rejection: rejections.alreadyPaid };
    }
    // While the window of another payment runs, the reference takes no other request, single or
    // recurring (HU-10).
    if (await hasPaymentInWindow(db, region, reference.code)) {
      return { rejection: rejections.paymentInProgress };
    }
    // The sequence belongs to the payment method: one it already used is a repeated notice.
    // Bug 1: the repeated notice registers another payment.
    if (
      body.sequence !== undefined &&
      !bugs.has(1) &&
      (await sequenceUsed(db, paymentMethodId, body.sequence))
    ) {
      return { rejection: rejections.repeatedNotice };
    }
    return { reference, amount: checked.amount };
  }

  return { validate };
}

async function movementOf(
  db: Pool,
  folio: string,
  paymentMethodId: string,
): Promise<Movement | undefined> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.folio, m.authorization_code, m.reference_code, m.status, m.requested_at, r.type
     FROM movements m JOIN payment_references r ON r.code = m.reference_code
     WHERE m.folio = ? AND m.payment_method_id = ?`,
    [folio, paymentMethodId],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    folio: row.folio,
    authorization: row.authorization_code,
    referenceCode: row.reference_code,
    referenceType: row.type,
    status: row.status,
    requestedAt: row.requested_at,
  };
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

export async function findReference(
  db: Pool,
  code: string,
): Promise<Reference | undefined> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT code, merchant_id, status, type, amount_type, amount, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on
     FROM payment_references WHERE code = ?`,
    [code],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  return {
    code: row.code,
    merchantId: row.merchant_id,
    status: row.status,
    type: row.type,
    amountType: row.amount_type,
    amount: row.amount === null ? null : Number(row.amount),
    expiresOn: row.expires_on,
  };
}

export async function registerPayment(
  db: Pool,
  region: RegionConfig,
  payment: NewPayment,
): Promise<{ folio: string; authorization: string }> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO movements (reference_code, payment_method_id, sequence, amount, status, requested_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payment.reference.code,
        payment.paymentMethodId,
        payment.sequence,
        payment.amount,
        payment.status,
        payment.at,
        payment.status === "confirmed" ? payment.at : null,
      ],
    );
    const folio = `${region.region.toUpperCase()}-${String(result.insertId).padStart(10, "0")}`;
    const authorization = authorizationCode();
    await connection.query(
      "UPDATE movements SET folio = ?, authorization_code = ? WHERE id = ?",
      [folio, authorization, result.insertId],
    );
    if (payment.status === "confirmed" && payment.reference.type === "single") {
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
