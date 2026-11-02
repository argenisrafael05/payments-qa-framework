import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import type { PaymentContext } from "../../framework/payments/context.ts";
import { extraChecks } from "../../framework/payments/database/checks.ts";

// The extra checks, with a database that answers controlled rows.

function contextWith(
  type: "single" | "recurring",
  status: string,
): PaymentContext {
  const db = {
    query: async () => [
      [
        {
          code: "12345678901234",
          merchant_id: "merchant-mx-1",
          type,
          amount_type: "fixed",
          amount: "150.50",
          status,
        },
      ],
    ],
  } as unknown as Pool;
  // A payment the API confirmed, as after the flow of the payment.
  const confirmed = [
    {
      folio: "MX-0000000001",
      authorization: "CTSEZE",
      amount: 150.5,
      sequence: "supermarket-1",
      paymentMethodId: "supermarket",
      status: "confirmed",
    },
  ];
  return {
    db,
    reference: { type, amountType: "fixed", amount: 150.5 },
    created: { code: "12345678901234" },
    payments: confirmed,
  } as unknown as PaymentContext;
}

const state = extraChecks["reference-state"];

describe("the state of the reference", () => {
  it("expects a single reference to be paid after its payment", async () => {
    expect(await state.run(contextWith("single", "paid"))).toMatchObject({
      result: "match",
      expected: "paid",
    });
  });

  it("expects a recurring reference to stay active after its payment", async () => {
    expect(await state.run(contextWith("recurring", "active"))).toMatchObject({
      result: "match",
      expected: "active",
    });
  });

  it("expects a cancelled reference after the merchant cancelled it", async () => {
    const context = {
      ...contextWith("single", "cancelled"),
      cancelled: true,
    } as PaymentContext;
    expect(await state.run(context)).toMatchObject({
      result: "match",
      expected: "cancelled",
    });
  });

  it("finds a recurring reference that its first payment closed", async () => {
    expect(await state.run(contextWith("recurring", "paid"))).toMatchObject({
      result: "mismatch",
      expected: "active",
      found: "paid",
    });
  });
});

describe("the payment resource of a reference", () => {
  const sameResource = extraChecks["same-resource"];
  // The log of the bridge with one row each time the merchant asked for the resource.
  const askedFor = (...resources: string[]) =>
    ({
      db: {
        query: async () => [
          resources.map((id, index) => ({ id: index + 1, resource_id: id })),
        ],
      } as unknown as Pool,
      created: { code: "12345678901234" },
      resource: { id: resources.at(-1) },
    }) as unknown as PaymentContext;

  it("finds one resource when the merchant asked twice for an unpaid reference", async () => {
    expect(await sameResource.run(askedFor("wq_1", "wq_1"))).toMatchObject({
      result: "match",
      expected: "1 resource: wq_1",
      found: "1 resource: wq_1",
    });
  });

  it("finds a second resource the bridge should not have made", async () => {
    expect(await sameResource.run(askedFor("wq_1", "wq_2"))).toMatchObject({
      result: "mismatch",
      expected: "1 resource: wq_2",
      found: "2 resources: wq_1, wq_2",
    });
  });
});
