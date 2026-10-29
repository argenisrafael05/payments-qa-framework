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
  // After a payment, a single reference is paid and a recurring one stays active (8.6). The
  // state it expects comes from the type the case asked for, never from the response.
  "reference-state": {
    name: "reference-state",
    title: "The reference is in the state its payment leaves it in",
    async run(context) {
      const code = need(context.created, "The reference").code;
      const type = need(context.reference, "The reference").type;
      const expected = type === "single" ? "paid" : "active";
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
