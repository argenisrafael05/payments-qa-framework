import type { JsonObject } from "../../engine/http.ts";
import {
  need,
  text,
  type PaymentContext,
  type PaymentStep,
} from "../context.ts";

export const inquiry: PaymentStep = {
  name: "inquiry",
  title: "The payment method inquires the reference",
  kind: "executes",
  covers: ["inquiry"],
  // The inquiry only informs and never cuts the flow (HU-08): it answers OK with the data of
  // the reference, whatever its state, and only one that does not exist gets R-101. The payment
  // after it always validates on its own.
  expects: (next) =>
    next.kind === "code" && next.code === "R-101" ? next : { kind: "success" },
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
        amount: context.amount,
        sequence: context.sequence,
      },
    );
  },
  keep: (context, body) =>
    confirm(context, body, context.sequence, context.amount),
};

// The same reference, paid again: with the sequence of the first payment, like a repeated
// notice, or with a new one, like another payment.
export const secondPayment: PaymentStep = {
  name: "second-payment",
  title: "The payment method pays the same reference again",
  kind: "executes",
  covers: ["second-payment"],
  run: (context) =>
    context.apis.paymentMethod.pay(
      need(context.tokens.paymentMethod, "The payment method's token"),
      {
        reference: need(context.created, "The reference").code,
        amount: context.secondAmount,
        sequence: need(context.secondSequence, "The second sequence"),
      },
    ),
  keep: (context, body) =>
    confirm(
      context,
      body,
      need(context.secondSequence, "The second sequence"),
      context.secondAmount,
    ),
};

// A payment the API confirmed, which the database has to have at the end.
function confirm(
  context: PaymentContext,
  body: JsonObject,
  sequence: string,
  amount: number,
): void {
  context.confirmed.push({
    folio: text(body.folio, "The folio"),
    authorization: text(body.authorization, "The authorization"),
    amount,
    sequence,
    paymentMethodId: context.paymentMethod.id,
  });
}
