import type { CheckOutcome, DatabaseCheck } from "../../engine/runner.ts";
import type { ExpectedPayment, PaymentContext } from "../context.ts";
import {
  bridgeLogOf,
  movementsOf,
  unavailable,
  type Movement,
} from "./readings.ts";

// The database has the last word (US-01): the movements of the reference must match what the
// case expected and the API confirmed, no more and no less. It runs once at the end of every
// case, also after a failure, because the most expensive bug is an error that still left the
// payment.
export const finalCheck: DatabaseCheck<PaymentContext> = {
  name: "final-check",
  title: "The movements match what the case expected and the API confirmed",
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
    // A third party also leaves the log of its bridge, as a photo in the evidence (3.1).
    const log =
      context.simulator === undefined
        ? []
        : [await bridgeLogOf(context.db, reference)];
    return {
      ...compareMovements(context.payments, read.movements),
      readings: [read.reading, ...log],
    };
  },
};

// No more and no less: every payment that counts is there, in the state the API left it, and no
// movement is there that the case did not expect. A payment its window confirmed keeps the time
// the window ended.
export function compareMovements(
  payments: readonly ExpectedPayment[],
  movements: readonly Movement[],
): Omit<CheckOutcome, "readings"> {
  const differences: string[] = [];
  for (const payment of payments) {
    const movement = movements.find((row) => row.folio === payment.folio);
    if (movement === undefined) {
      differences.push(`${payment.folio} is not in the database`);
      continue;
    }
    if (movement.status !== payment.status) {
      differences.push(
        `${payment.folio} is ${movement.status}, not ${payment.status}`,
      );
    }
    if (
      payment.confirmedAt !== undefined &&
      movement.confirmedAt !== payment.confirmedAt
    ) {
      differences.push(
        `${payment.folio} was confirmed at ${movement.confirmedAt ?? "no time"}, and its window ended at ${payment.confirmedAt}`,
      );
    }
    if (
      payment.requestedAt !== undefined &&
      movement.requestedAt !== payment.requestedAt
    ) {
      differences.push(
        `${payment.folio} keeps its request at ${movement.requestedAt ?? "no time"}, and it came at ${payment.requestedAt}`,
      );
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
      if (value === undefined) {
        continue;
      }
      const stored = movement[field as keyof Movement];
      if (stored !== value) {
        differences.push(
          `${payment.folio} has ${field} ${String(stored)}, and the API confirmed ${value}`,
        );
      }
    }
  }
  for (const movement of movements) {
    if (!payments.some((payment) => payment.folio === movement.folio)) {
      differences.push(
        `${movement.folio ?? "a movement without a folio"} is ${movement.status}, and the case did not expect it`,
      );
    }
  }

  return {
    result: differences.length === 0 ? "match" : "mismatch",
    expected: count(
      payments.map((payment) => `${payment.folio} ${payment.status}`),
    ),
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
