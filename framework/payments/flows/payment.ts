import type { PaymentStep } from "../context.ts";
import type { Integration } from "../integrations.ts";
import { merchantToken, paymentMethodToken } from "../steps/access.ts";
import {
  cancelFirst,
  cancelReference,
  noticeFirst,
  payFirst,
  requestFirst,
  resourceFirst,
  resourceWhileValid,
  reversalFirst,
  viewReference,
  webhookFirst,
} from "../steps/merchant.ts";
import {
  anotherRequest,
  inquiry,
  inquiryOfUnknown,
  paymentNotice,
  paymentRequest,
  payTogether,
  reversal,
  secondNotice,
  secondPayment,
  secondRequest,
} from "../steps/payments.ts";
import { createReference } from "../steps/references.ts";
import {
  frameworkWebhook,
  observedWebhook,
  repeatedFrameworkWebhook,
  repeatedObservedWebhook,
  resourceRequest,
  secondFrameworkWebhook,
  secondObservedWebhook,
  secondResourceRequest,
} from "../steps/third-party.ts";

// The payment of a reference, written once for every integration. The config picks the
// variant: how the request and the notice arrive.
export function paymentFlow(integration: Integration): readonly PaymentStep[] {
  return flowOf("payment", integration);
}

// Who sends the webhook of a third party: the framework, signed as the third party would, or the
// third party itself (HU-12).
export type NoticeSource = "framework" | "third-party";

export type FlowName =
  "payment" | "payment-twice" | "unknown-reference" | "transition";

// The states of the reference (8.6), the ones of the payment of a bank, after its request (8.7),
// and the one of the payment resource of a third party in between, created and not paid (8.8).
export const referenceStates = [
  "active",
  "paid",
  "cancelled",
  "expired",
] as const;
export const paymentStates = ["pending", "confirmed", "reversed"] as const;
export const resourceStates = ["created"] as const;

export type State =
  | (typeof referenceStates)[number]
  | (typeof paymentStates)[number]
  | (typeof resourceStates)[number];

export function isPaymentState(
  state: State,
): state is (typeof paymentStates)[number] {
  return (paymentStates as readonly string[]).includes(state);
}

// A transition of 8.6 or 8.7: the state it starts from, and the event it gets.
export type Transition = { from: State; event: string };

// What else a case says about its flow: the transition it tests, who sends the webhook of a third
// party, and whether a second payment brings the same sequence or a new one.
export type FlowOptions = {
  transition?: Transition;
  source?: NoticeSource;
  secondSequence?: "same" | "new";
};

// What takes a reference to each state. An expired one only needs its date and its time, and a
// paid one goes through the payment of its integration first, sent by the framework. The
// payment of a bank starts with its request, and then its notice or its reversal. With a third
// party, an expired or a cancelled reference got its resource while it still applied, so its
// webhook can come late (8.8).
function toState(
  state: State,
  integration: Integration,
): readonly PaymentStep[] {
  switch (state) {
    case "active":
      return [];
    case "expired":
      return integration.notice === "webhook" ? [resourceWhileValid] : [];
    case "paid":
      return payingFirst(integration);
    case "cancelled":
      return integration.notice === "webhook"
        ? [resourceFirst, cancelFirst]
        : [cancelFirst];
    case "created":
      return [resourceFirst];
    case "pending":
      return [paymentMethodToken, requestFirst];
    case "confirmed":
      return [paymentMethodToken, requestFirst, noticeFirst];
    case "reversed":
      return [paymentMethodToken, requestFirst, reversalFirst];
  }
}

function payingFirst(integration: Integration): readonly PaymentStep[] {
  switch (integration.notice) {
    case "together":
      return [paymentMethodToken, payFirst];
    case "separate":
      return [paymentMethodToken, requestFirst, noticeFirst];
    case "webhook":
      return [resourceFirst, webhookFirst];
  }
}

const events: Record<string, readonly PaymentStep[]> = {
  view: [viewReference],
  cancel: [cancelReference],
  reversal: [reversal],
};

// The notice of each integration, as an event: the one of a bank, or the webhook of a third
// party, sent by the framework or by the third party itself.
function noticeOf(
  integration: Integration,
  source: NoticeSource,
): readonly PaymentStep[] {
  if (integration.notice !== "webhook") {
    return [paymentNotice];
  }
  return [source === "framework" ? frameworkWebhook : observedWebhook];
}

// The payment twice pays, and then pays the same reference again, with the same sequence or a
// new one, without an inquiry in between. The unknown reference pays a code nobody created, so
// the merchant does nothing, but ask a third party for its resource. The inquiry goes only when
// the payment method inquires.
export function flowOf(
  flow: FlowName,
  integration: Integration,
  { transition, source = "framework", secondSequence }: FlowOptions = {},
): readonly PaymentStep[] {
  const asks = integration.inquiry ? [inquiry] : [];
  const pays = paymentOf(integration, source);
  // A third party never gets a token: the merchant asks it for the resource, and it signs its
  // webhook.
  const token = integration.notice === "webhook" ? [] : [paymentMethodToken];
  switch (flow) {
    case "payment":
      return [merchantToken, createReference, ...token, ...asks, ...pays];
    case "payment-twice":
      return [
        merchantToken,
        createReference,
        ...token,
        ...asks,
        ...pays,
        ...secondPaymentOf(integration, source, secondSequence),
      ];
    case "unknown-reference":
      return [
        ...(integration.notice === "webhook" ? [merchantToken] : []),
        ...token,
        ...(integration.inquiry ? [inquiryOfUnknown] : []),
        ...pays,
      ];
    case "transition": {
      const from = transition?.from ?? "active";
      // Paying is the payment of every integration, with its inquiry when it inquires. A
      // payment already requested gets another request, from another customer.
      const paying = isPaymentState(from)
        ? [anotherRequest]
        : [...token, ...asks, ...pays];
      const event =
        transition?.event === "request"
          ? paying
          : transition?.event === "notice"
            ? noticeOf(integration, source)
            : (events[transition?.event ?? ""] ?? []);
      return [
        merchantToken,
        createReference,
        ...toState(from, integration),
        ...event,
      ];
    }
  }
}

// The second payment of the same reference. For a third party the sequence is the id of the
// resource: the same one is the same webhook again, and a new one is another resource.
function secondPaymentOf(
  integration: Integration,
  source: NoticeSource,
  secondSequence: FlowOptions["secondSequence"],
): readonly PaymentStep[] {
  switch (integration.notice) {
    case "together":
      return [secondPayment];
    case "separate":
      return [secondRequest, secondNotice];
    case "webhook":
      if (secondSequence === "same") {
        return [
          source === "framework"
            ? repeatedFrameworkWebhook
            : repeatedObservedWebhook,
        ];
      }
      return [
        secondResourceRequest,
        source === "framework" ? secondFrameworkWebhook : secondObservedWebhook,
      ];
  }
}

function paymentOf(
  integration: Integration,
  source: NoticeSource,
): readonly PaymentStep[] {
  switch (integration.notice) {
    case "together":
      return [payTogether];
    case "separate":
      return [paymentRequest, paymentNotice];
    case "webhook":
      return [
        resourceRequest,
        source === "framework" ? frameworkWebhook : observedWebhook,
      ];
  }
}
