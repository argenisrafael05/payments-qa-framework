import { apisOf, need, type PaymentStep } from "../context.ts";
import {
  paymentNotice,
  paymentRequest,
  payTogether,
  reversal,
} from "./payments.ts";
import { frameworkWebhook, resourceRequest } from "./third-party.ts";

// What the merchant does with its reference after creating it (HU-07).

export const viewReference: PaymentStep = {
  name: "view",
  title: "The merchant sees the reference",
  kind: "executes",
  covers: ["view"],
  run: (context) =>
    context.apis.merchant.view(
      need(context.tokens.merchant, "The merchant's token"),
      need(context.created, "The reference").code,
    ),
};

export const cancelReference: PaymentStep = {
  name: "cancel",
  title: "The merchant cancels the reference",
  kind: "executes",
  covers: ["cancel"],
  run: (context) =>
    context.apis.merchant.cancel(
      need(context.tokens.merchant, "The merchant's token"),
      need(context.created, "The reference").code,
    ),
  keep: (context) => {
    context.cancelled = true;
  },
};

// The steps that take a reference to the state a transition starts from. They carry out no
// step of the objective, so the event after them is always the one the case expects.

export const cancelFirst: PaymentStep = {
  ...cancelReference,
  name: "cancel-first",
  title: "The merchant cancels the reference first",
  covers: [],
};

export const payFirst: PaymentStep = {
  ...payTogether,
  name: "pay-first",
  title: "The payment method pays the reference first",
  covers: [],
};

export const requestFirst: PaymentStep = {
  ...paymentRequest,
  name: "request-first",
  title: "The payment method sends the request first",
  covers: [],
};

export const noticeFirst: PaymentStep = {
  ...paymentNotice,
  name: "notice-first",
  title: "The payment method sends the notice first",
  covers: [],
};

export const reversalFirst: PaymentStep = {
  ...reversal,
  name: "reversal-first",
  title: "The payment method reverses the payment first",
  covers: [],
};

export const resourceFirst: PaymentStep = {
  ...resourceRequest,
  name: "resource-first",
  title: "The merchant asks for the payment resource first",
  covers: [],
};

export const webhookFirst: PaymentStep = {
  ...frameworkWebhook,
  name: "webhook-first",
  title: "The framework sends the webhook first",
  covers: [],
};

// A reference that is already expired at the time of the case asks for its resource at the time
// it was created, the day before it expires, while it still applied (8.8).
export const resourceWhileValid: PaymentStep = {
  ...resourceFirst,
  title:
    "The merchant asks for the payment resource first, while the reference still applied",
  run: (context) =>
    resourceFirst.run({
      ...context,
      apis: apisOf(context.http.with({ testTime: context.creationTime })),
    }),
};
