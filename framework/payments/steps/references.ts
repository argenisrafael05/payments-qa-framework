import { need, text, type PaymentStep } from "../context.ts";

export const createReference: PaymentStep = {
  name: "create-reference",
  title: "The merchant creates the reference",
  kind: "executes",
  covers: [],
  run: (context) =>
    context.apis.merchant.createReference(
      need(context.tokens.merchant, "The merchant's token"),
      context.reference,
    ),
  keep: (context, body) => {
    context.created = {
      code: text(body.reference, "The reference"),
      amount: context.reference.amount,
    };
  },
};
