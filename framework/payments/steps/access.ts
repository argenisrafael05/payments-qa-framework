import { text, type PaymentStep } from "../context.ts";

// Each role exchanges its key for a token before its first call. Who calls always comes from
// the token, so these steps are part of every flow.

export const merchantToken: PaymentStep = {
  name: "merchant-token",
  title: "The merchant gets its token",
  kind: "executes",
  covers: [],
  run: (context) => context.apis.merchant.token(context.merchant.key),
  keep: (context, body) => {
    context.tokens.merchant = text(body.token, "The merchant's token");
  },
};

export const paymentMethodToken: PaymentStep = {
  name: "payment-method-token",
  title: "The payment method gets its token",
  kind: "executes",
  covers: [],
  run: (context) => context.apis.paymentMethod.token(context.paymentMethod.key),
  keep: (context, body) => {
    context.tokens.paymentMethod = text(
      body.token,
      "The payment method's token",
    );
  },
};
