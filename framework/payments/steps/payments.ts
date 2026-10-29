import { need, text, type PaymentStep } from "../context.ts";

export const inquiry: PaymentStep = {
  name: "inquiry",
  title: "The payment method inquires the reference",
  kind: "executes",
  covers: ["inquiry"],
  run: (context) =>
    context.apis.paymentMethod.inquiry(
      need(context.tokens.paymentMethod, "The payment method's token"),
      need(context.created, "The reference").code,
    ),
};

// The request and the notice in one call, like a supermarket that only calls once the
// customer has paid. A case that ends at either of them ends here.
export const payTogether: PaymentStep = {
  name: "payment",
  title: "The payment method sends the request and the notice together",
  kind: "executes",
  covers: ["request", "notice"],
  run: (context) => {
    const reference = need(context.created, "The reference");
    return context.apis.paymentMethod.pay(
      need(context.tokens.paymentMethod, "The payment method's token"),
      {
        reference: reference.code,
        amount: reference.amount,
        sequence: context.sequence,
      },
    );
  },
  keep: (context, body) => {
    context.confirmed.push({
      folio: text(body.folio, "The folio"),
      authorization: text(body.authorization, "The authorization"),
      amount: need(context.created, "The reference").amount,
      sequence: context.sequence,
      paymentMethodId: context.paymentMethod.id,
    });
  },
};
