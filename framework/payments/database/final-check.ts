import type { CheckOutcome, DatabaseCheck } from "../../engine/runner.ts";
import type { ConfirmedPayment, PaymentContext } from "../context.ts";
import { movementsOf, unavailable, type Movement } from "./readings.ts";

// The database has the last word (HU-01): the movements of the reference must match what the
// API confirmed, no more and no less. It runs once at the end of every case, also after a
// failure, because the most expensive bug is an error that still left the payment.
export const finalCheck: DatabaseCheck<PaymentContext> = {
  name: "final-check",
  title: "The movements match what the API confirmed",
  async run(context) {
    const reference = context.created?.code;
    if (reference === undefined) {
      return {
        result: "skipped",
        detail: "The case never created a reference",
        readings: [],
      };
    }

    let read;
    try {
      read = await movementsOf(context.db, reference);
    } catch (error) {
      return unavailable("The movements of the reference", error);
    }
    return {
      ...compareMovements(context.confirmed, read.movements),
      readings: [read.reading],
    };
  },
};

// No more and no less: every payment the API confirmed is there, as it confirmed it, and no
// movement is there that the API never confirmed.
export function compareMovements(
  confirmed: readonly ConfirmedPayment[],
  movements: readonly Movement[],
): Omit<CheckOutcome, "readings"> {
  const differences: string[] = [];
  for (const payment of confirmed) {
    const movement = movements.find((row) => row.folio === payment.folio);
    if (movement === undefined) {
      differences.push(`${payment.folio} is not in the database`);
      continue;
    }
    if (movement.status !== "confirmed") {
      differences.push(`${payment.folio} is ${movement.status}, not confirmed`);
    }
    // The exact amount: comparing with two decimals would hide an amount the database rounded.
    if (Number(movement.amount) !== payment.amount) {
      differences.push(
        `${payment.folio} has amount ${movement.amount}, and the API confirmed ${payment.amount}`,
      );
    }
    const expected = {
      paymentMethodId: payment.paymentMethodId,
      authorization: payment.authorization,
      sequence: payment.sequence,
    };
    for (const [field, value] of Object.entries(expected)) {
      const stored = movement[field as keyof Movement];
      if (stored !== value) {
        differences.push(
          `${payment.folio} has ${field} ${String(stored)}, and the API confirmed ${value}`,
        );
      }
    }
  }
  for (const movement of movements) {
    if (!confirmed.some((payment) => payment.folio === movement.folio)) {
      differences.push(
        `${movement.folio ?? "a movement without a folio"} is ${movement.status}, and the API never confirmed it`,
      );
    }
  }

  return {
    result: differences.length === 0 ? "match" : "mismatch",
    expected: count(confirmed.map((payment) => `${payment.folio} confirmed`)),
    found: count(
      movements.map(
        (movement) => `${movement.folio ?? "no folio"} ${movement.status}`,
      ),
    ),
    detail: differences.length === 0 ? undefined : differences.join("; "),
  };
}

function count(movements: string[]): string {
  if (movements.length === 0) {
    return "no movements";
  }
  const noun = movements.length === 1 ? "movement" : "movements";
  return `${movements.length} ${noun}: ${movements.join(", ")}`;
}
