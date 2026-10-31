import type { PaymentStep } from "../context.ts";
import type { Integration } from "../integrations.ts";
import { merchantToken, paymentMethodToken } from "../steps/access.ts";
import {
  cancelFirst,
  cancelReference,
  noticeFirst,
  payFirst,
  requestFirst,
  reversalFirst,
  viewReference,
} from "../steps/merchant.ts";
import {
  anotherRequest,
  inquiry,
  inquiryOfUnknown,
  paymentNotice,
  paymentRequest,
  payTogether,
  reversal,
  secondNotice,
  secondPayment,
  secondRequest,
} from "../steps/payments.ts";
import { createReference } from "../steps/references.ts";

// The payment of a reference, written once for every integration. The config picks the
// variant: how the request and the notice arrive.
export function paymentFlow(integration: Integration): readonly PaymentStep[] {
  return flowOf("payment", integration);
}

export type FlowName =
  "payment" | "payment-twice" | "unknown-reference" | "transition";

// The states of the reference (8.6), and the ones of the payment of a bank, after its request
// (8.7).
export const referenceStates = [
  "active",
  "paid",
  "cancelled",
  "expired",
] as const;
export const paymentStates = ["pending", "confirmed", "reversed"] as const;

export type State =
  (typeof referenceStates)[number] | (typeof paymentStates)[number];

export function isPaymentState(
  state: State,
): state is (typeof paymentStates)[number] {
  return (paymentStates as readonly string[]).includes(state);
}

// A transition of 8.6 or 8.7: the state it starts from, and the event it gets.
export type Transition = { from: State; event: string };

// What takes a reference to each state. An expired one only needs its date and its time, and a
// paid one goes through the payment of its integration first. The payment of a bank starts
// with its request, and then its notice or its reversal.
function toState(
  state: State,
  integration: Integration,
): readonly PaymentStep[] {
  switch (state) {
    case "active":
    case "expired":
      return [];
    case "paid":
      return integration.notice === "together"
        ? [paymentMethodToken, payFirst]
        : [paymentMethodToken, requestFirst, noticeFirst];
    case "cancelled":
      return [cancelFirst];
    case "pending":
      return [paymentMethodToken, requestFirst];
    case "confirmed":
      return [paymentMethodToken, requestFirst, noticeFirst];
    case "reversed":
      return [paymentMethodToken, requestFirst, reversalFirst];
  }
}

const events: Record<string, readonly PaymentStep[]> = {
  view: [viewReference],
  cancel: [cancelReference],
  notice: [paymentNotice],
  reversal: [reversal],
};

// The payment twice pays, and then pays the same reference again, with the same sequence or a
// new one, without an inquiry in between. The unknown reference pays a code nobody created, so
// the merchant does nothing. The inquiry goes only when the payment method inquires.
export function flowOf(
  flow: FlowName,
  integration: Integration,
  transition?: Transition,
): readonly PaymentStep[] {
  const asks = integration.inquiry ? [inquiry] : [];
  const pays = paymentOf(integration);
  switch (flow) {
    case "payment":
      return [
        merchantToken,
        createReference,
        paymentMethodToken,
        ...asks,
        ...pays,
      ];
    case "payment-twice":
      return [
        merchantToken,
        createReference,
        paymentMethodToken,
        ...asks,
        ...pays,
        ...(integration.notice === "together"
          ? [secondPayment]
          : [secondRequest, secondNotice]),
      ];
    case "unknown-reference":
      return [
        paymentMethodToken,
        ...(integration.inquiry ? [inquiryOfUnknown] : []),
        ...pays,
      ];
    case "transition": {
      const from = transition?.from ?? "active";
      // Paying is the payment of every integration, with its inquiry when it inquires. A
      // payment already requested gets another request, from another customer.
      const paying = isPaymentState(from)
        ? [anotherRequest]
        : [paymentMethodToken, ...asks, ...pays];
      const event =
        transition?.event === "request"
          ? paying
          : (events[transition?.event ?? ""] ?? []);
      return [
        merchantToken,
        createReference,
        ...toState(from, integration),
        ...event,
      ];
    }
  }
}

function paymentOf(integration: Integration): readonly PaymentStep[] {
  switch (integration.notice) {
    case "together":
      return [payTogether];
    case "separate":
      return [paymentRequest, paymentNotice];
  }
}
