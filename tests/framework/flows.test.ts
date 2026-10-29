import { describe, expect, it } from "vitest";
import { flowOf } from "../../framework/payments/flows/payment.ts";
import { loadIntegration } from "../../framework/payments/integrations.ts";
import { inquiry } from "../../framework/payments/steps/payments.ts";

// The flows and what each step expects, without PayRef.

const supermarket = loadIntegration("supermarket");

describe("the flows", () => {
  it("inquires before paying when the payment method inquires", () => {
    expect(flowOf("payment", supermarket).map((step) => step.name)).toEqual([
      "merchant-token",
      "create-reference",
      "payment-method-token",
      "inquiry",
      "payment",
    ]);
  });

  it("goes straight to the payment when the payment method only pays", () => {
    const onlyPays = { ...supermarket, inquiry: false };
    expect(flowOf("payment", onlyPays).map((step) => step.name)).toEqual([
      "merchant-token",
      "create-reference",
      "payment-method-token",
      "payment",
    ]);
  });

  it("pays a code nobody created without the merchant", () => {
    expect(
      flowOf("unknown-reference", supermarket).map((step) => step.name),
    ).toEqual(["payment-method-token", "inquiry", "payment"]);
  });

  it("pays a second time in the flow that pays twice", () => {
    expect(flowOf("payment-twice", supermarket).at(-1)?.name).toBe(
      "second-payment",
    );
  });
});

describe("the inquiry", () => {
  it("expects R-101 when the reference does not exist, because there is nothing to tell", () => {
    expect(inquiry.expects?.({ kind: "code", code: "R-101" })).toEqual({
      kind: "code",
      code: "R-101",
    });
  });

  it("expects OK for any other answer of the payment, because it only informs", () => {
    for (const code of ["R-102", "R-103", "R-104", "R-105", "R-106", "R-108"]) {
      expect(inquiry.expects?.({ kind: "code", code })).toEqual({
        kind: "success",
      });
    }
    expect(inquiry.expects?.({ kind: "status", status: 401 })).toEqual({
      kind: "success",
    });
    expect(inquiry.expects?.({ kind: "success" })).toEqual({ kind: "success" });
  });
});
