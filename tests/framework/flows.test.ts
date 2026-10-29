import { describe, expect, it } from "vitest";
import { casesFor } from "../../framework/payments/catalog.ts";
import { planFor } from "../../framework/payments/execution.ts";
import { flowOf } from "../../framework/payments/flows/payment.ts";
import { loadIntegration } from "../../framework/payments/integrations.ts";
import {
  inquiry,
  inquiryOfUnknown,
} from "../../framework/payments/steps/payments.ts";

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

  it("takes the reference to the state a transition starts from, then fires its event", () => {
    const names = (
      from: "active" | "paid" | "cancelled" | "expired",
      event: string,
    ) =>
      flowOf("transition", supermarket, { from, event }).map(
        (step) => step.name,
      );
    expect(names("paid", "cancel")).toEqual([
      "merchant-token",
      "create-reference",
      "payment-method-token",
      "pay-first",
      "cancel",
    ]);
    expect(names("cancelled", "view")).toEqual([
      "merchant-token",
      "create-reference",
      "cancel-first",
      "view",
    ]);
    expect(names("cancelled", "request")).toEqual([
      "merchant-token",
      "create-reference",
      "cancel-first",
      "payment-method-token",
      "inquiry",
      "payment",
    ]);
    expect(names("expired", "view")).toEqual([
      "merchant-token",
      "create-reference",
      "view",
    ]);
  });

  it("pays a second time in the flow that pays twice", () => {
    expect(flowOf("payment-twice", supermarket).at(-1)?.name).toBe(
      "second-payment",
    );
  });
});

describe("the caller of the objective", () => {
  const aCase = {
    id: "F99-01",
    title: "A case",
    flow: "payment",
    reference: { type: "single", amountType: "fixed" },
    amount: 150.5,
    objective: { step: "notice", expect: "OK" },
    tags: [],
  };

  function stepsOf(changes: object) {
    const [entry] = casesFor(supermarket, [{ ...aCase, ...changes } as never]);
    if (entry === undefined) {
      throw new Error("The case has no test");
    }
    return planFor(entry, supermarket).steps;
  }

  it("gets the token of another merchant right before the event it asks for", () => {
    const steps = stepsOf({
      flow: "transition",
      from: "active",
      objective: {
        step: "cancel",
        expect: "R-101",
        caller: "another-merchant",
      },
    });
    expect(steps.map((step) => step.name)).toEqual([
      "merchant-token",
      "create-reference",
      "caller-token",
      "cancel",
    ]);
    expect(steps.slice(-2).map((step) => step.title)).toEqual([
      "another-merchant gets its token",
      "The merchant cancels the reference, as another-merchant",
    ]);
  });

  it("gets the token of the other role right before the objective", () => {
    const steps = stepsOf({
      objective: { step: "request", expect: 403, caller: "other-role" },
    });
    expect(steps.map((step) => step.name)).toEqual([
      "merchant-token",
      "create-reference",
      "payment-method-token",
      "inquiry",
      "caller-token",
      "payment",
    ]);
  });

  it("calls without a token or with a wrong key with nothing before it", () => {
    expect(
      stepsOf({
        objective: { step: "create", expect: 401, caller: "no-token" },
      }).map((step) => step.title),
    ).toEqual([
      "The merchant gets its token",
      "The merchant creates the reference, without a token",
    ]);
    expect(
      stepsOf({
        objective: { step: "token", expect: 401, caller: "wrong-key" },
      }).map((step) => step.title),
    ).toEqual(["The merchant gets its token, with a key PayRef does not know"]);
  });
});

describe("the inquiry", () => {
  it("tells a code nobody created, whatever the payment after it expects", () => {
    expect(inquiryOfUnknown.expects?.({ kind: "status", status: 401 })).toEqual(
      { kind: "code", code: "R-101" },
    );
    expect(
      flowOf("unknown-reference", supermarket).map((step) => step.name),
    ).toEqual(["payment-method-token", "inquiry", "payment"]);
  });

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
