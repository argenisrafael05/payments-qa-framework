import type { PaymentStep } from "../context.ts";
import type { Integration } from "../integrations.ts";
import { merchantToken, paymentMethodToken } from "../steps/access.ts";
import { inquiry, payTogether } from "../steps/payments.ts";
import { createReference } from "../steps/references.ts";

// The payment of a reference, written once for every integration. The config picks the
// variant: how the request and the notice arrive.
export function paymentFlow(integration: Integration): readonly PaymentStep[] {
  switch (integration.notice) {
    case "together":
      return [
        merchantToken,
        createReference,
        paymentMethodToken,
        inquiry,
        payTogether,
      ];
  }
}
