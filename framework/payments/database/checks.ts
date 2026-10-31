import type { DatabaseCheck } from "../../engine/runner.ts";
import { need, type PaymentContext } from "../context.ts";
import { referenceOf, unavailable } from "./readings.ts";

// The extra checks a case can ask for by name, on top of the final one (3.1).
export const extraCheckNames = ["reference-state"] as const;

export type ExtraCheckName = (typeof extraCheckNames)[number];

export const extraChecks: Record<
  ExtraCheckName,
  DatabaseCheck<PaymentContext>
> = {
  // The state the reference is left in, from what the API confirmed (8.6): cancelled if the
  // merchant cancelled it, paid if it is a single one with a confirmed payment, and active if
  // not, also after a reversal (8.7).
  "reference-state": {
    name: "reference-state",
    title: "The reference is in the state its payment leaves it in",
    async run(context) {
      const code = need(context.created, "The reference").code;
      const type = need(context.reference, "The reference").type;
      const expected = context.cancelled
        ? "cancelled"
        : type === "single" &&
            context.payments.some((payment) => payment.status === "confirmed")
          ? "paid"
          : "active";
      try {
        const { reference, reading } = await referenceOf(context.db, code);
        return {
          result: reference?.status === expected ? "match" : "mismatch",
          expected,
          found: reference?.status ?? "no reference",
          readings: [reading],
        };
      } catch (error) {
        return unavailable("The reference", error);
      }
    },
  },
};
