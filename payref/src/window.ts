import type { Pool, RowDataPacket } from "mysql2/promise";
import type { RegionConfig } from "./config.ts";

// The reversal window of a payment method (US-10). Its request leaves the payment pending, and
// the window closes with whatever comes first: the notice, the reversal or its end.

export type PendingPayment = {
  id: number;
  referenceCode: string;
  referenceType: "single" | "recurring";
};

// The window is a rule of the config of a payment method: without it, the payment method is a
// standard one (US-10).
export function hasWindow(
  region: RegionConfig,
  paymentMethodId: string,
): boolean {
  return windowOf(region, paymentMethodId) !== undefined;
}

// When the window of a payment closes, if its payment method has one.
export function windowEnd(
  region: RegionConfig,
  paymentMethodId: string,
  requestedAt: Date,
): Date | undefined {
  const window = windowOf(region, paymentMethodId);
  return window === undefined
    ? undefined
    : new Date(requestedAt.getTime() + window.minutes * 60_000);
}

function windowOf(region: RegionConfig, paymentMethodId: string) {
  return region.paymentMethods.find((method) => method.id === paymentMethodId)
    ?.reversalWindow;
}

// Without a notice or a reversal, the payment is confirmed on its own when its window ends. It
// is seen at the next request that touches the reference, and the movement keeps the time the
// window ended. At the end exactly, the window is already closed.
export async function settleWindows(
  db: Pool,
  region: RegionConfig,
  referenceCode: string,
  now: Date,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.payment_method_id, m.requested_at, r.type
     FROM movements m JOIN payment_references r ON r.code = m.reference_code
     WHERE m.reference_code = ? AND m.status = 'pending'`,
    [referenceCode],
  );
  for (const row of rows) {
    const end = windowEnd(region, row.payment_method_id, row.requested_at);
    if (end !== undefined && now >= end) {
      await confirmPayment(
        db,
        { id: row.id, referenceCode, referenceType: row.type },
        end,
      );
    }
  }
}

// The pending payment is confirmed, and a single reference is paid. Each step keeps its own
// date, so the request keeps the one it had.
export async function confirmPayment(
  db: Pool,
  payment: PendingPayment,
  at: Date,
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE movements SET status = 'confirmed', confirmed_at = ? WHERE id = ?",
      [at, payment.id],
    );
    if (payment.referenceType === "single") {
      await connection.query(
        "UPDATE payment_references SET status = 'paid' WHERE code = ?",
        [payment.referenceCode],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// A payment in progress is a pending one whose window still runs. The pending payment of a
// payment method without a window blocks nothing: its notice validates again (US-08).
export async function hasPaymentInWindow(
  db: Pool,
  region: RegionConfig,
  referenceCode: string,
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT payment_method_id FROM movements WHERE reference_code = ? AND status = 'pending'",
    [referenceCode],
  );
  return rows.some((row) => hasWindow(region, row.payment_method_id));
}
