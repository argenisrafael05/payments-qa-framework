import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import type {
  ExpectedPayment,
  PaymentContext,
} from "../../framework/payments/context.ts";
import {
  compareMovements,
  finalCheck,
} from "../../framework/payments/database/final-check.ts";
import type { Movement } from "../../framework/payments/database/readings.ts";

// The final check of the database, with controlled rows (US-01).

const confirmed: ExpectedPayment = {
  folio: "MX-0000000001",
  authorization: "CTSEZE",
  amount: 150.5,
  sequence: "supermarket-1",
  paymentMethodId: "supermarket",
  status: "confirmed",
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

  it("finds a payment the case did not expect, the most expensive bug", () => {
    expect(compareMovements([], [stored])).toMatchObject({
      result: "mismatch",
      expected: "no movements",
      found: "1 movement: MX-0000000001 confirmed",
      detail: "MX-0000000001 is confirmed, and the case did not expect it",
    });
  });

  it("finds a movement that is not as the API confirmed it", () => {
    const different = { ...stored, amount: "100.00", status: "reversed" };
    expect(compareMovements([confirmed], [different])).toMatchObject({
      result: "mismatch",
      detail:
        "MX-0000000001 is reversed, not confirmed; MX-0000000001 has amount 100.00, and the API confirmed 150.5",
    });
  });

  it("finds a payment its window confirmed at another time than the end of the window", () => {
    const byTheWindow = {
      ...confirmed,
      confirmedAt: "2026-10-27T06:26:59.000Z",
    };
    expect(compareMovements([byTheWindow], [stored])).toMatchObject({
      result: "mismatch",
      detail:
        "MX-0000000001 was confirmed at 2026-10-27T06:24:59.402Z, and its window ended at 2026-10-27T06:26:59.000Z",
    });
  });

  it("expects a payment in the state the API left it, pending or reversed", () => {
    const pending = { ...stored, status: "pending", confirmedAt: null };
    expect(
      compareMovements([{ ...confirmed, status: "pending" }], [pending]),
    ).toMatchObject({
      result: "match",
      expected: "1 movement: MX-0000000001 pending",
    });
    expect(
      compareMovements([{ ...confirmed, status: "reversed" }], [pending]),
    ).toMatchObject({
      result: "mismatch",
      detail: "MX-0000000001 is pending, not reversed",
    });
  });

  it("does not compare the authorization it never saw, when the wallet sent its own webhook", () => {
    const { authorization, ...observed } = confirmed;
    expect(authorization).toBe("CTSEZE");
    expect(
      compareMovements([observed], [{ ...stored, authorization: "OTHER1" }]),
    ).toMatchObject({ result: "match" });
  });

  it("finds a request whose date was rewritten when its payment was confirmed", () => {
    const requested = {
      ...confirmed,
      requestedAt: "2026-10-27T06:20:00.000Z",
    };
    expect(compareMovements([requested], [stored])).toMatchObject({
      result: "mismatch",
      detail:
        "MX-0000000001 keeps its request at 2026-10-27T06:24:59.402Z, and it came at 2026-10-27T06:20:00.000Z",
    });
    expect(
      compareMovements(
        [{ ...confirmed, requestedAt: stored.requestedAt ?? "" }],
        [stored],
      ),
    ).toMatchObject({ result: "match" });
  });

  it("finds an amount the database rounded, which two decimals would hide", () => {
    // 150.504 shown with two decimals is 150.50, the same as what the database kept.
    const rounded = { ...stored, amount: "150.50" };
    expect(
      compareMovements([{ ...confirmed, amount: 150.504 }], [rounded]),
    ).toMatchObject({
      result: "mismatch",
      detail: "MX-0000000001 has amount 150.50, and the API confirmed 150.504",
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
      payments: [],
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

  it("leaves the log of the bridge as a photo for a third party, and it decides nothing", async () => {
    const row = {
      id: 7,
      operation: "webhook",
      resource_id: "wq_1",
      amount: "150.50",
      result: "R-105",
      folio: null,
      created_at: new Date("2026-11-15T18:00:00.000Z"),
    };
    const db = {
      query: async (sql: string) =>
        sql.includes("bridge_operations") ? [[row]] : [[]],
    } as unknown as Pool;
    const context = {
      db,
      created: { code: "12345678901234" },
      payments: [],
    } as unknown as PaymentContext;

    const withoutThirdParty = await finalCheck.run(context);
    expect(withoutThirdParty.readings.map((each) => each.name)).toEqual([
      "The movements of the reference",
    ]);

    const outcome = await finalCheck.run({
      ...context,
      simulator: {},
    } as unknown as PaymentContext);
    expect(outcome.result).toBe("match");
    expect(outcome.readings[1]).toEqual({
      name: "The log of the bridge",
      rows: [
        {
          id: 7,
          operation: "webhook",
          resourceId: "wq_1",
          amount: "150.50",
          result: "R-105",
          folio: null,
          createdAt: "2026-11-15T18:00:00.000Z",
        },
      ],
    });
  });

  it("does not let a log it cannot read decide the case", async () => {
    const db = {
      query: async (sql: string) => {
        if (sql.includes("bridge_operations")) {
          throw new Error("the log is down");
        }
        return [[]];
      },
    } as unknown as Pool;
    const outcome = await finalCheck.run({
      db,
      created: { code: "12345678901234" },
      payments: [],
      simulator: {},
    } as unknown as PaymentContext);
    expect(outcome.result).toBe("match");
    expect(outcome.readings[1]).toEqual({
      name: "The log of the bridge",
      error: "the log is down",
    });
  });

  it("has nothing to read when the case never created a reference", async () => {
    const context = { payments: [] } as unknown as PaymentContext;
    expect(await finalCheck.run(context)).toMatchObject({ result: "skipped" });
  });
});
