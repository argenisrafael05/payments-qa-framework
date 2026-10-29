import type { DatabaseCheck } from "../../engine/runner.ts";
import { need, type PaymentContext } from "../context.ts";
import { referenceOf, unavailable } from "./readings.ts";

// The extra checks a case can ask for by name, on top of the final one (3.1).
export const extraCheckNames = ["reference-paid"] as const;

export type ExtraCheckName = (typeof extraCheckNames)[number];

export const extraChecks: Record<
  ExtraCheckName,
  DatabaseCheck<PaymentContext>
> = {
  "reference-paid": {
    name: "reference-paid",
    title: "The reference is paid",
    async run(context) {
      const code = need(context.created, "The reference").code;
      try {
        const { reference, reading } = await referenceOf(context.db, code);
        return {
          result: reference?.status === "paid" ? "match" : "mismatch",
          expected: "paid",
          found: reference?.status ?? "no reference",
          readings: [reading],
        };
      } catch (error) {
        return unavailable("The reference", error);
      }
    },
  },
};
