import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import type {
  ConfirmedPayment,
  PaymentContext,
} from "../../framework/payments/context.ts";
import {
  compareMovements,
  finalCheck,
} from "../../framework/payments/database/final-check.ts";
import type { Movement } from "../../framework/payments/database/readings.ts";

// The final check of the database, with controlled rows (HU-01).

const confirmed: ConfirmedPayment = {
  folio: "MX-0000000001",
  authorization: "CTSEZE",
  amount: 150.5,
  sequence: "supermarket-1",
  paymentMethodId: "supermarket",
};

const stored: Movement = {
  folio: "MX-0000000001",
  authorization: "CTSEZE",
  paymentMethodId: "supermarket",
  sequence: "supermarket-1",
  amount: "150.50",
  status: "confirmed",
  requestedAt: "2026-10-27T06:24:59.402Z",
  confirmedAt: "2026-10-27T06:24:59.402Z",
  reversedAt: null,
};

describe("the final check of the database", () => {
  it("matches when the movements are exactly what the API confirmed", () => {
    expect(compareMovements([confirmed], [stored])).toEqual({
      result: "match",
      expected: "1 movement: MX-0000000001 confirmed",
      found: "1 movement: MX-0000000001 confirmed",
      detail: undefined,
    });
    expect(compareMovements([], [])).toMatchObject({
      result: "match",
      expected: "no movements",
      found: "no movements",
    });
  });

  it("finds a payment the API confirmed that is not in the database", () => {
    expect(compareMovements([confirmed], [])).toMatchObject({
      result: "mismatch",
      detail: "MX-0000000001 is not in the database",
    });
  });

  it("finds a payment the API never confirmed, the most expensive bug", () => {
    expect(compareMovements([], [stored])).toMatchObject({
      result: "mismatch",
      expected: "no movements",
      found: "1 movement: MX-0000000001 confirmed",
      detail: "MX-0000000001 is confirmed, and the API never confirmed it",
    });
  });

  it("finds a movement that is not as the API confirmed it", () => {
    const different = { ...stored, amount: "100.00", status: "reversed" };
    expect(compareMovements([confirmed], [different])).toMatchObject({
      result: "mismatch",
      detail:
        "MX-0000000001 has status reversed, and the API confirmed confirmed; MX-0000000001 has amount 100.00, and the API confirmed 150.50",
    });
  });

  it("cannot test when the database does not answer", async () => {
    const down = {
      query: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:3307");
      },
    } as unknown as Pool;
    const context = {
      db: down,
      created: { code: "12345678901234", amount: 150.5 },
      confirmed: [],
    } as unknown as PaymentContext;
    expect(await finalCheck.run(context)).toEqual({
      result: "unavailable",
      detail: "connect ECONNREFUSED 127.0.0.1:3307",
      readings: [
        {
          name: "The movements of the reference",
          error: "connect ECONNREFUSED 127.0.0.1:3307",
        },
      ],
    });
  });

  it("has nothing to read when the case never created a reference", async () => {
    const context = { confirmed: [] } as unknown as PaymentContext;
    expect(await finalCheck.run(context)).toMatchObject({ result: "skipped" });
  });
});
