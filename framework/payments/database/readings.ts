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

// The payment resources the bridge gave for a reference, one row each time the merchant asked.
export async function resourcesOf(
  db: Pool,
  reference: string,
): Promise<{ resources: Record<string, unknown>[]; reading: ReadingRecord }> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, resource_id, amount, qr, link, created_at
     FROM bridge_operations WHERE operation = 'resource' AND result = 'OK' AND reference_code = ? ORDER BY id`,
    [reference],
  );
  const resources = rows.map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    amount: row.amount,
    qr: row.qr,
    link: row.link,
    createdAt: instant(row.created_at),
  }));
  return {
    resources,
    reading: {
      name: "The payment resources of the reference in the log of the bridge",
      rows: resources,
    },
  };
}

// The webhooks of a payment resource that PayRef kept in the log of the bridge, in order.
export async function webhooksOf(
  db: Pool,
  resourceId: string,
): Promise<{ webhooks: Record<string, unknown>[]; reading: ReadingRecord }> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, resource_id, amount, result, folio, created_at
     FROM bridge_operations WHERE operation = 'webhook' AND resource_id = ? ORDER BY id`,
    [resourceId],
  );
  const webhooks = rows.map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    amount: row.amount,
    result: row.result,
    folio: row.folio,
    createdAt: instant(row.created_at),
  }));
  return {
    webhooks,
    reading: {
      name: "The webhooks of the resource in the log of the bridge",
      rows: webhooks,
    },
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
