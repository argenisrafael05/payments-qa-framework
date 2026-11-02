import { describe, expect, it } from "vitest";
import { casesFor } from "../../framework/payments/catalog.ts";
import {
  creationTimeOf,
  inRegion,
} from "../../framework/payments/execution.ts";
import { loadIntegration } from "../../framework/payments/integrations.ts";

// The time each step runs at: the one of the case, except the creation of a reference that is
// already expired then, which is not created with a past date (HU-07).

const expired = {
  id: "F99-01",
  title: "An expired reference is rejected",
  flow: "payment",
  reference: { type: "single", amountType: "fixed", expiresOn: "2026-11-15" },
  amount: 150.5,
  time: "2026-11-20T12:00:00",
  objective: { step: "request", expect: "R-103" },
  tags: [],
};

function creationOf(changes: object): string | undefined {
  const [entry] = casesFor(loadIntegration("supermarket"), [
    { ...expired, ...changes } as never,
  ]);
  if (entry === undefined) {
    throw new Error("The case has no test");
  }
  return creationTimeOf(entry, "-06:00");
}

describe("the time each step runs at", () => {
  it("creates a reference already expired at the time of the case the day before it expires, at 00:00", () => {
    expect(creationOf({})).toBe("2026-11-14T00:00:00-06:00");
    expect(creationOf({ time: "2026-11-16T00:00:00" })).toBe(
      "2026-11-14T00:00:00-06:00",
    );
    // The first of a month goes back to the last day of the month before.
    expect(
      creationOf({
        reference: {
          type: "single",
          amountType: "fixed",
          expiresOn: "2026-12-01",
        },
        time: "2026-12-02T12:00:00",
      }),
    ).toBe("2026-11-30T00:00:00-06:00");
  });

  it("creates at the time of the case a reference that is still valid then", () => {
    const lastSecond = {
      time: "2026-11-15T23:59:59",
      objective: { step: "notice", expect: "OK" },
    };
    expect(creationOf(lastSecond)).toBeUndefined();
    expect(
      creationOf({
        ...lastSecond,
        reference: { type: "single", amountType: "fixed" },
      }),
    ).toBeUndefined();
  });

  it("keeps the time of the case when the creation is what it tests", () => {
    expect(
      creationOf({
        reference: {
          type: "single",
          amountType: "fixed",
          expiresOn: "2026-11-14",
        },
        time: "2026-11-15T12:00:00",
        objective: { step: "create", expect: 400 },
      }),
    ).toBeUndefined();
  });

  it("leaves the time of the server to a case that does not fix it", () => {
    expect(
      creationOf({
        reference: {
          type: "single",
          amountType: "fixed",
          expiresOn: "2099-12-31",
        },
        time: undefined,
        objective: { step: "notice", expect: "OK" },
      }),
    ).toBeUndefined();
  });

  it("writes a moment in the time of its region, to the second, as PayRef reads it", () => {
    const moment = Date.parse("2026-11-16T03:00:30.250Z");
    expect(inRegion(moment, "-03:00")).toBe("2026-11-16T00:00:30-03:00");
    expect(inRegion(moment, "-06:00")).toBe("2026-11-15T21:00:30-06:00");
  });
});
