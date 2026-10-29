import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ReadingRecord } from "../../engine/evidence.ts";
import type { CheckOutcome } from "../../engine/runner.ts";

// The readings have business names, and the SQL lives only here, never in a case. The same
// reading serves the evidence and the check (3.1).

export type Movement = {
  folio: string | null;
  authorization: string | null;
  paymentMethodId: string;
  sequence: string;
  // As the database keeps it, with its two decimals.
  amount: string;
  status: string;
  requestedAt: string | null;
  confirmedAt: string | null;
  reversedAt: string | null;
};

export async function movementsOf(
  db: Pool,
  reference: string,
): Promise<{ movements: Movement[]; reading: ReadingRecord }> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT folio, authorization_code, payment_method_id, sequence, amount, status, requested_at, confirmed_at, reversed_at
     FROM movements WHERE reference_code = ? ORDER BY id`,
    [reference],
  );
  const movements: Movement[] = rows.map((row) => ({
    folio: row.folio,
    authorization: row.authorization_code,
    paymentMethodId: row.payment_method_id,
    sequence: row.sequence,
    amount: row.amount,
    status: row.status,
    requestedAt: instant(row.requested_at),
    confirmedAt: instant(row.confirmed_at),
    reversedAt: instant(row.reversed_at),
  }));
  return {
    movements,
    reading: { name: "The movements of the reference", rows: movements },
  };
}

export type StoredReference = {
  code: string;
  merchantId: string;
  type: string;
  amountType: string;
  amount: string | null;
  status: string;
};

export async function referenceOf(
  db: Pool,
  code: string,
): Promise<{ reference?: StoredReference; reading: ReadingRecord }> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT code, merchant_id, type, amount_type, amount, status
     FROM payment_references WHERE code = ?`,
    [code],
  );
  const references: StoredReference[] = rows.map((row) => ({
    code: row.code,
    merchantId: row.merchant_id,
    type: row.type,
    amountType: row.amount_type,
    amount: row.amount,
    status: row.status,
  }));
  return {
    reference: references[0],
    reading: { name: "The reference", rows: references },
  };
}

// A database that does not answer never looks like a mismatch: the case could not be tested.
export function unavailable(reading: string, error: unknown): CheckOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return {
    result: "unavailable",
    detail: message,
    readings: [{ name: reading, error: message }],
  };
}

function instant(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}
