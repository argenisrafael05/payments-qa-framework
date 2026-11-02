import type { Pool } from "mysql2/promise";
import type { Observation } from "../../engine/observation.ts";
import {
  need,
  text,
  type PaymentContext,
  type PaymentStep,
} from "../context.ts";
import { webhooksOf } from "../database/readings.ts";
import { keepPayment } from "./payments.ts";

// What a third party does in a payment, like the wallet (HU-11): the merchant asks it for a
// payment resource, a QR or a link, and the third party tells the payment with a webhook. The
// sequence of the payment in PayRef is the id of its resource.

type Which = "resource" | "secondResource";

type Described = {
  name: string;
  title: string;
  covers: readonly string[];
};

function resourceStep(step: Described & { keepAs: Which }): PaymentStep {
  return {
    name: step.name,
    title: step.title,
    kind: "executes",
    covers: step.covers,
    run: (context) =>
      context.apis.thirdParty.requestResource(
        need(context.tokens.merchant, "The merchant's token"),
        {
          reference: need(context.created, "The reference").code,
          amount: context.amount,
        },
      ),
    keep: (context, body) => {
      context[step.keepAs] = { id: text(body.resource, "The resource") };
    },
  };
}

// The framework sends the webhook itself, signed as the payment method would, so it sees what
// the bridge answers (HU-12).
function frameworkWebhookStep(step: Described & { of: Which }): PaymentStep {
  return {
    name: step.name,
    title: step.title,
    kind: "executes",
    covers: step.covers,
    run: (context) =>
      context.apis.thirdParty.webhook(context.paymentMethod.key, {
        resource: resourceOf(context, step.of),
        amount: context.amount,
        paidAt: context.time ?? new Date().toISOString(),
      }),
    keep: (context, body) =>
      keepPayment(context, body, resourceOf(context, step.of), "confirmed"),
  };
}

// The third party sends the webhook itself once the framework tells its simulator the customer
// paid, so the framework never sees what the bridge answered (HU-12). The step observes: it waits
// until PayRef keeps a new webhook of the resource in the log of the bridge, and reads its code.
function observedWebhookStep(step: Described & { of: Which }): PaymentStep {
  return {
    name: step.name,
    title: step.title,
    kind: "observes",
    covers: step.covers,
    run: async (context) => {
      const resource = resourceOf(context, step.of);
      const before = await webhooksOf(context.db, resource);
      const paid = await need(
        context.simulator,
        "The simulator of the payment method",
      ).pay(resource, {
        amount: context.amount,
        ...(context.time === undefined ? {} : { testTime: context.time }),
      });
      if (paid.outcome.response?.status !== 200) {
        throw new Error(
          `The simulator did not take the payment: ${paid.outcome.error ?? paid.outcome.response?.status}`,
        );
      }
      return observeWebhook(
        context.db,
        resource,
        before.webhooks.length,
        webhookWait,
      );
    },
    // The framework never saw the answer of the bridge, so it only knows the folio PayRef kept.
    keep: (context, body) => {
      context.payments.push({
        folio: text(body.folio, "The folio"),
        amount: context.amount,
        sequence: resourceOf(context, step.of),
        paymentMethodId: context.paymentMethod.id,
        status: "confirmed",
      });
    },
  };
}

export const resourceRequest = resourceStep({
  name: "resource",
  title: "The merchant asks for the payment resource",
  covers: ["request"],
  keepAs: "resource",
});

export const frameworkWebhook = frameworkWebhookStep({
  name: "webhook",
  title: "The framework sends the webhook, signed as the payment method would",
  covers: ["notice"],
  of: "resource",
});

export const observedWebhook = observedWebhookStep({
  name: "webhook",
  title:
    "The payment method sends its webhook, and the framework sees it in the log of the bridge",
  covers: ["notice"],
  of: "resource",
});

// A second payment with the same sequence is the same webhook again, for the same resource.
export const repeatedFrameworkWebhook = frameworkWebhookStep({
  name: "second-webhook",
  title: "The framework sends the same webhook again",
  covers: ["second-payment"],
  of: "resource",
});

export const repeatedObservedWebhook = observedWebhookStep({
  name: "second-webhook",
  title:
    "The payment method sends the same webhook again, and the framework sees it in the log of the bridge",
  covers: ["second-payment"],
  of: "resource",
});

// A second payment with a new sequence is another resource of the same reference, and its webhook.
export const secondResourceRequest = resourceStep({
  name: "second-resource",
  title: "The merchant asks for another payment resource of the same reference",
  covers: ["second-payment"],
  keepAs: "secondResource",
});

export const secondFrameworkWebhook = frameworkWebhookStep({
  name: "second-webhook",
  title: "The framework sends the webhook of the second resource",
  covers: ["second-payment"],
  of: "secondResource",
});

export const secondObservedWebhook = observedWebhookStep({
  name: "second-webhook",
  title:
    "The payment method sends the webhook of the second resource, and the framework sees it in the log of the bridge",
  covers: ["second-payment"],
  of: "secondResource",
});

function resourceOf(context: PaymentContext, which: Which): string {
  return need(context[which], "The resource").id;
}

// How long the framework waits for the webhook of the third party, asking the database every so
// often instead of sleeping (3.1).
const webhookWait = { timeoutMs: 5_000, everyMs: 100 };

// Asks the log of the bridge until a webhook shows up after the ones that were already there, or
// until the time runs out. A check right after the payment would see nothing yet, and a case
// that expects no payment would pass even if the webhook never came.
export async function observeWebhook(
  db: Pool,
  resource: string,
  before: number,
  wait: { timeoutMs: number; everyMs: number },
): Promise<Observation> {
  const startedAt = Date.now();
  for (;;) {
    const { webhooks, reading } = await webhooksOf(db, resource);
    const webhook = webhooks[before];
    const waitedMs = Date.now() - startedAt;
    if (webhook !== undefined) {
      return {
        kind: "observation",
        readings: [reading],
        waitedMs,
        seen: { code: String(webhook.result), row: webhook },
      };
    }
    if (waitedMs >= wait.timeoutMs) {
      return { kind: "observation", readings: [reading], waitedMs };
    }
    await new Promise((resolve) => setTimeout(resolve, wait.everyMs));
  }
}
