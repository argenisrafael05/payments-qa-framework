import type { PaymentStep } from "../context.ts";
import type { Integration } from "../integrations.ts";
import { merchantToken, paymentMethodToken } from "../steps/access.ts";
import {
  cancelFirst,
  cancelReference,
  payFirst,
  viewReference,
} from "../steps/merchant.ts";
import {
  inquiry,
  inquiryOfUnknown,
  payTogether,
  secondPayment,
} from "../steps/payments.ts";
import { createReference } from "../steps/references.ts";

// The payment of a reference, written once for every integration. The config picks the
// variant: how the request and the notice arrive.
export function paymentFlow(integration: Integration): readonly PaymentStep[] {
  return flowOf("payment", integration);
}

export type FlowName =
  "payment" | "payment-twice" | "unknown-reference" | "transition";

export type State = "active" | "paid" | "cancelled" | "expired";

// A transition of 8.6: the state the reference starts from, and the event it gets.
export type Transition = { from: State; event: string };

// What takes a reference to each state. An expired one only needs its date and its time.
const toState: Record<State, readonly PaymentStep[]> = {
  active: [],
  expired: [],
  paid: [paymentMethodToken, payFirst],
  cancelled: [cancelFirst],
};

const events: Record<string, readonly PaymentStep[]> = {
  view: [viewReference],
  cancel: [cancelReference],
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
        secondPayment,
      ];
    case "unknown-reference":
      return [
        paymentMethodToken,
        ...(integration.inquiry ? [inquiryOfUnknown] : []),
        ...pays,
      ];
    case "transition": {
      // Paying is the payment of every integration, with its inquiry when it inquires.
      const event =
        transition?.event === "request"
          ? [paymentMethodToken, ...asks, ...pays]
          : (events[transition?.event ?? ""] ?? []);
      return [
        merchantToken,
        createReference,
        ...toState[transition?.from ?? "active"],
        ...event,
      ];
    }
  }
}

function paymentOf(integration: Integration): readonly PaymentStep[] {
  switch (integration.notice) {
    case "together":
      return [payTogether];
  }
}
