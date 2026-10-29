import { need, type PaymentStep } from "../context.ts";
import { payTogether } from "./payments.ts";

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
