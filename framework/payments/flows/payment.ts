import type { PaymentStep } from "../context.ts";
import type { Integration } from "../integrations.ts";
import { merchantToken, paymentMethodToken } from "../steps/access.ts";
import { inquiry, payTogether, secondPayment } from "../steps/payments.ts";
import { createReference } from "../steps/references.ts";

// The payment of a reference, written once for every integration. The config picks the
// variant: how the request and the notice arrive.
export function paymentFlow(integration: Integration): readonly PaymentStep[] {
  return flowOf("payment", integration);
}

export type FlowName = "payment" | "payment-twice" | "unknown-reference";

// The payment twice pays, and then pays the same reference again, with the same sequence or a
// new one, without an inquiry in between. The unknown reference pays a code nobody created, so
// the merchant does nothing. The inquiry goes only when the payment method inquires.
export function flowOf(
  flow: FlowName,
  integration: Integration,
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
      return [paymentMethodToken, ...asks, ...pays];
  }
}

function paymentOf(integration: Integration): readonly PaymentStep[] {
  switch (integration.notice) {
    case "together":
      return [payTogether];
  }
}
