import type { CheckOutcome, DatabaseCheck } from "../../engine/runner.ts";
import { need, type PaymentContext } from "../context.ts";
import { referenceOf, resourcesOf, unavailable } from "./readings.ts";

// The extra checks a case can ask for by name, on top of the final one (3.1).
export const extraCheckNames = [
  "reference-state",
  "same-resource",
  "another-resource",
] as const;

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
  // The payment resource of a third party is the same while the reference is not paid (8.8):
  // however many times the merchant asks for one amount, the log of the bridge has one resource.
  "same-resource": {
    name: "same-resource",
    title: "The reference keeps one payment resource while it is not paid",
    run: (context) => countResources(context, 1),
  },
  // Another amount is another payment, so it gets a resource of its own (8.8).
  "another-resource": {
    name: "another-resource",
    title: "Another amount gets a payment resource of its own",
    run: (context) => countResources(context, 2),
  },
};

// How many resources the log of the bridge has for the reference, the last one being the one the
// merchant just got.
async function countResources(
  context: PaymentContext,
  count: number,
): Promise<CheckOutcome> {
  const code = need(context.created, "The reference").code;
  const expected = need(context.resource, "The resource").id;
  const shown = (n: number) => `${n} ${n === 1 ? "resource" : "resources"}`;
  try {
    const { resources, reading } = await resourcesOf(context.db, code);
    const ids = [...new Set(resources.map((row) => String(row.resourceId)))];
    return {
      result:
        ids.length === count && ids.at(-1) === expected ? "match" : "mismatch",
      expected: `${shown(count)}, the last one ${expected}`,
      found: `${shown(ids.length)}: ${ids.join(", ")}`,
      readings: [reading],
    };
  } catch (error) {
    return unavailable("The payment resources of the reference", error);
  }
}
