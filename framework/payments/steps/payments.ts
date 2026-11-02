import type { JsonObject } from "../../engine/http.ts";
import {
  need,
  text,
  type ExpectedPayment,
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

// A code nobody created: the inquiry tells it with R-101, whatever the payment after it
// expects, like a 401 for a token PayRef never gave.
export const inquiryOfUnknown: PaymentStep = {
  ...inquiry,
  expects: () => ({ kind: "code", code: "R-101" }),
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
    keepPayment(context, body, context.sequence, "confirmed"),
};

// The request alone, like a bank that validates before it charges. The payment stays pending
// until its notice.
export const paymentRequest: PaymentStep = {
  name: "request",
  title: "The payment method sends the request",
  kind: "executes",
  covers: ["request"],
  run: (context) =>
    context.apis.paymentMethod.request(
      need(context.tokens.paymentMethod, "The payment method's token"),
      {
        reference: need(context.created, "The reference").code,
        amount: context.amount,
        sequence: context.sequence,
      },
    ),
  keep: (context, body) => {
    context.requested = { folio: text(body.folio, "The folio") };
    keepPayment(context, body, context.sequence, "pending");
  },
};

// The notice of that request, by its folio. It confirms the payment.
export const paymentNotice: PaymentStep = {
  name: "notice",
  title: "The payment method sends the notice",
  kind: "executes",
  covers: ["notice"],
  run: (context) =>
    context.apis.paymentMethod.notice(
      need(context.tokens.paymentMethod, "The payment method's token"),
      need(context.requested, "The request").folio,
    ),
  keep: (context, body) => {
    paymentOf(context, text(body.folio, "The folio")).status = "confirmed";
  },
};

// Another request of the same reference while the window of the first one runs, like a second
// customer: it brings a sequence of its own.
export const anotherRequest: PaymentStep = {
  name: "another-request",
  title: "The payment method sends another request of the same reference",
  kind: "executes",
  covers: ["request"],
  run: (context) =>
    context.apis.paymentMethod.request(
      need(context.tokens.paymentMethod, "The payment method's token"),
      {
        reference: need(context.created, "The reference").code,
        amount: context.amount,
        sequence: `${context.sequence}-2`,
      },
    ),
  keep: (context, body) =>
    keepPayment(context, body, `${context.sequence}-2`, "pending"),
};

// The reversal of the payment, by its folio. A payment the window already confirmed stays
// confirmed, whatever the API answers.
export const reversal: PaymentStep = {
  name: "reversal",
  title: "The payment method reverses the payment",
  kind: "executes",
  covers: ["reversal"],
  run: (context) =>
    context.apis.paymentMethod.reversal(
      need(context.tokens.paymentMethod, "The payment method's token"),
      need(context.payments.at(-1), "The payment").folio,
    ),
  keep: (context, body) => {
    const payment = paymentOf(context, text(body.folio, "The folio"));
    if (payment.status === "pending") {
      payment.status = "reversed";
    }
  },
};

// The same reference again in two calls, like the bank: its request, and then its notice.
export const secondRequest: PaymentStep = {
  name: "second-request",
  title: "The payment method sends the request of the same reference again",
  kind: "executes",
  covers: ["second-payment"],
  run: (context) =>
    context.apis.paymentMethod.request(
      need(context.tokens.paymentMethod, "The payment method's token"),
      {
        reference: need(context.created, "The reference").code,
        amount: context.amount,
        sequence: need(context.secondSequence, "The second sequence"),
      },
    ),
  keep: (context, body) => {
    context.secondRequested = { folio: text(body.folio, "The folio") };
    keepPayment(
      context,
      body,
      need(context.secondSequence, "The second sequence"),
      "pending",
    );
  },
};

export const secondNotice: PaymentStep = {
  name: "second-notice",
  title: "The payment method sends the notice of the second request",
  kind: "executes",
  covers: ["second-payment"],
  run: (context) =>
    context.apis.paymentMethod.notice(
      need(context.tokens.paymentMethod, "The payment method's token"),
      need(context.secondRequested, "The second request").folio,
    ),
  keep: (context, body) => {
    paymentOf(context, text(body.folio, "The folio")).status = "confirmed";
  },
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
        amount: context.amount,
        sequence: need(context.secondSequence, "The second sequence"),
      },
    ),
  keep: (context, body) =>
    keepPayment(
      context,
      body,
      need(context.secondSequence, "The second sequence"),
      "confirmed",
    ),
};

// A payment the API answered OK, which the database has to have at the end.
export function keepPayment(
  context: PaymentContext,
  body: JsonObject,
  sequence: string,
  status: ExpectedPayment["status"],
): void {
  context.payments.push({
    folio: text(body.folio, "The folio"),
    authorization: text(body.authorization, "The authorization"),
    amount: context.amount,
    sequence,
    paymentMethodId: context.paymentMethod.id,
    status,
  });
}

// The payment of a folio its request already kept.
export function paymentOf(
  context: PaymentContext,
  folio: string,
): ExpectedPayment {
  return need(
    context.payments.find((payment) => payment.folio === folio),
    `The payment ${folio}`,
  );
}
