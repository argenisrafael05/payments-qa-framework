import { need, text, type PaymentStep } from "../context.ts";

// Each role exchanges its key for a token before its first call. Who calls always comes from
// the token, so these steps are part of every flow, and a case that tests the auth itself ends
// at the first one.

export const merchantToken: PaymentStep = {
  name: "merchant-token",
  title: "The merchant gets its token",
  kind: "executes",
  covers: ["token"],
  run: (context) => context.apis.merchant.token(context.merchant.key),
  keep: (context, body) => {
    context.tokens.merchant = text(body.token, "The merchant's token");
  },
};

export const paymentMethodToken: PaymentStep = {
  name: "payment-method-token",
  title: "The payment method gets its token",
  kind: "executes",
  covers: ["token"],
  run: (context) => context.apis.paymentMethod.token(context.paymentMethod.key),
  keep: (context, body) => {
    context.tokens.paymentMethod = text(
      body.token,
      "The payment method's token",
    );
  },
};

// Who calls the objective in place of its usual role gets its token right before it: another
// merchant or the other role (8.9). The auth is the same for every caller, so it goes through
// the merchant's client whoever it is.
export function callerToken(title: string): PaymentStep {
  return {
    name: "caller-token",
    title,
    kind: "executes",
    covers: [],
    run: (context) =>
      context.apis.merchant.token(need(context.caller, "The caller").key),
    keep: (context, body) => {
      context.tokens.caller = text(body.token, "The caller's token");
    },
  };
}
