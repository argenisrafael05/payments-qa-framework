import { readdirSync } from "node:fs";
import { z } from "zod";
import { loadData } from "../engine/data.ts";
import type { Expectation } from "../engine/judge.ts";
import { businessCodes } from "./codes.ts";
import { extraCheckNames } from "./database/checks.ts";
import {
  flowOf,
  isPaymentState,
  paymentStates,
  referenceStates,
  resourceStates,
  type NoticeSource,
  type State,
} from "./flows/payment.ts";
import type { Integration } from "./integrations.ts";
import { regions } from "./regions.ts";

const baseCatalog = new URL("../cases/base/", import.meta.url);

// The amounts a case writes by what they are, so it runs in any region (HU-03): each one
// becomes the number of its integration.
export const amountNames = [
  "min",
  "max",
  "below-min",
  "above-max",
  "below-fixed",
  "above-fixed",
  "extra-decimal",
] as const;

// The lengths of a code, around the one of its region, and the one of the other region.
export const codeLengths = ["short", "exact", "long", "other-region"] as const;

// An axis of the reference takes one value, or a list that makes one test per value (HU-03).
function axis<T extends z.ZodType>(value: T) {
  return z.union([value, z.array(value).min(1)]);
}

// A case is only data: it never writes an assertion (3.1).
const caseSchema = z.strictObject({
  id: z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/),
  title: z.string().min(1),
  // The payment, the payment twice, which pays again with the same sequence or a new one, or
  // the payment of a code nobody created.
  flow: z.enum(["payment", "payment-twice", "unknown-reference", "transition"]),
  // The state a transition starts from: one of its reference (8.6), one of the payment of a bank
  // after its request (8.7), or the resource of a third party created and not paid (8.8). Its
  // objective is the event.
  from: axis(
    z.enum([...referenceStates, ...paymentStates, ...resourceStates]),
  ).optional(),
  // At which frontier of the reversal window the event arrives, for a transition from a pending
  // payment: a second before the window ends, or when it ends. The framework turns it into the
  // time of the window of each integration. Without it, the event comes right after the request.
  after: z.enum(["before-window-end", "window-end"]).optional(),
  // The codes the unknown reference tries, each one a test: digits, or a length of its region,
  // one digit short, exact or one digit long, or the length of the other region.
  code: axis(
    z.union([z.string().regex(/^[0-9]+$/), z.enum(codeLengths)]),
  ).optional(),
  secondSequence: axis(z.enum(["same", "new"])).optional(),
  // The time the case fixes, in the time of its region and without its zone, which the
  // framework adds. Only the cases at a time frontier fix it, and the rest run with the time of
  // the server. A reference that is already expired at that time is created the day before it
  // expires, at 00:00.
  time: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
      "a date and time without its zone, like 2026-11-15T23:59:59",
    )
    .refine((time) => !Number.isNaN(Date.parse(time)), "a real date and time")
    .optional(),
  // How the reference is (8.2). Without expiresOn, it never expires.
  reference: z
    .strictObject({
      type: axis(z.enum(["single", "recurring"])),
      amountType: axis(z.enum(["fixed", "open"])),
      expiresOn: axis(z.iso.date().nullable()).optional(),
      // Only when a fixed reference must be worth something else than what is paid, or null to
      // send a fixed one without its amount, a mistake of the merchant (HU-07).
      amount: z.number().nullable().optional(),
    })
    .optional(),
  // What the customer pays, or a list that makes a test of each. A number, or a name that the
  // framework turns into the number of the integration: the limits of its payment method,
  // one unit around the fixed amount, or one decimal more than its region allows. A fixed
  // reference is created with it, or with the ordinary amount when the name goes around it.
  // Without it, the case pays the ordinary amount of its region.
  amount: axis(z.union([z.number(), z.enum(amountNames)])).optional(),
  // Where the case ends and what it expects there (3.1): a business code, or the HTTP status
  // of a request that must not reach the business.
  objective: z.strictObject({
    step: z.enum([
      "inquiry",
      "request",
      "notice",
      "second-payment",
      "reversal",
      "view",
      "cancel",
      "create",
      "token",
    ]),
    expect: z.union([
      z.enum(businessCodes),
      z.number().int().min(400).max(599),
    ]),
    // Who calls the objective when it is not the usual one, as in the first column of 8.9:
    // without a token, with a made-up token, with a wrong key, with the token of the other role,
    // with a malformed request, or another merchant, by the alias its integration gives it.
    caller: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional(),
  }),
  tags: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
  checks: z.array(z.enum(extraCheckNames)).optional(),
  // A case with a rule still pending does not run, and says why (8.5).
  blocked: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export type Case = z.infer<typeof caseSchema>;

// One value per axis: the reference one test creates.
export type Reference = {
  type: "single" | "recurring";
  amountType: "fixed" | "open";
  amount?: number;
  expiresOn?: string;
};

export type CaseEntry = {
  // The title of the test in Playwright and the name of its file.
  name: string;
  // How its reference is, like single-fixed or recurring-open-2099-12-31, and its amount when
  // the case lists them.
  variation: string;
  reference?: Reference;
  // The code of the unknown reference, which nobody created.
  code?: string;
  // Why the case does not apply to this integration, when it does not (HU-03).
  notApplicable?: string;
  amount: number;
  secondSequence?: "same" | "new";
  from?: State;
  // Who sends the webhook, when its integration pays with one.
  source?: NoticeSource;
  case: Case;
};

export function loadCatalog(directory: URL = baseCatalog): Case[] {
  const cases = readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((file) => loadData(new URL(file, directory), z.array(caseSchema)));
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) {
      throw new Error(`The case ${item.id} is in the catalog twice`);
    }
    ids.add(item.id);
  }
  return cases;
}

// The tests of one integration: one per variation of each case. A case that cannot run as it
// is written fails here, before anything runs.
export function casesFor(
  integration: Integration,
  cases: Case[] = loadCatalog(),
): CaseEntry[] {
  const entries = cases.flatMap((item): CaseEntry[] => {
    const notApplicable = applies(item, integration);
    checkCaller(item, integration);
    const amounts = item.amount ?? regions[integration.region].amount;
    if (
      (item.flow === "payment-twice") !==
      (item.secondSequence !== undefined)
    ) {
      throw new Error(
        `${item.id}: secondSequence goes with the payment-twice flow, and only with it`,
      );
    }
    const unknown = item.flow === "unknown-reference";
    if (
      unknown !== (item.code !== undefined) ||
      unknown === (item.reference !== undefined)
    ) {
      throw new Error(
        `${item.id}: the unknown-reference flow takes a code and no reference, and the other flows a reference and no code`,
      );
    }
    if (unknown) {
      return list(item.code ?? []).flatMap((code) =>
        list(amounts).map((given) => {
          const listed = Array.isArray(item.amount) ? `-${given}` : "";
          const name = `${code}${listed}`;
          return {
            name: `${item.id}__${integration.id}__${name}`,
            variation: name,
            code: codeOf(code, integration),
            amount: amountOf(given, integration),
            ...(notApplicable === undefined ? {} : { notApplicable }),
            case: item,
          };
        }),
      );
    }
    checkTransition(item);
    const sources = sourcesOf(item, integration, notApplicable);
    return variationsOf(item, amounts, integration).flatMap((variation) =>
      list(item.secondSequence ?? null).flatMap((secondSequence) =>
        list(item.from ?? null).flatMap((from) =>
          sources.map((source) => {
            const cannotSend =
              source === "third-party"
                ? onlyTheFramework[item.objective.caller ?? ""]
                : undefined;
            const name = [
              variation.variation,
              secondSequence && `${secondSequence}-sequence`,
              from && `from-${from}`,
              source &&
                `by-${source === "framework" ? "framework" : integration.id}`,
            ]
              .filter(Boolean)
              .join("-");
            return {
              name: `${item.id}__${integration.id}__${name}`,
              variation: name,
              reference: variation.reference,
              amount: variation.amount,
              ...(secondSequence === null ? {} : { secondSequence }),
              ...(from === null ? {} : { from }),
              ...(source === null ? {} : { source }),
              ...(notApplicable === undefined
                ? cannotSend === undefined
                  ? {}
                  : {
                      notApplicable: `${integration.name} cannot send a webhook ${cannotSend}, so the case does not apply`,
                    }
                : { notApplicable }),
              case: item,
            };
          }),
        ),
      ),
    );
  });
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new Error(`${entry.name} comes out twice: a list repeats a value`);
    }
    names.add(entry.name);
  }
  return entries;
}

// A case that ends at a notice of a third party runs with both sources of its webhook, the
// framework and the third party itself (HU-12). One that ends before it has no webhook to send.
function sourcesOf(
  item: Case,
  integration: Integration,
  notApplicable: string | undefined,
): (NoticeSource | null)[] {
  const endsAtANotice = ["notice", "second-payment"].includes(
    item.objective.step,
  );
  return integration.notice === "webhook" &&
    endsAtANotice &&
    notApplicable === undefined
    ? ["framework", "third-party"]
    : [null];
}

// What an integration can turn on. A step that only comes with one of them makes a case not
// apply where it is off, and a step that no flow has is a mistake of the case.
const everythingOn = (integration: Integration): Integration => ({
  ...integration,
  inquiry: true,
});

const missing: Record<string, string> = {
  inquiry: "does not inquire before it pays",
};

function applies(item: Case, integration: Integration): string | undefined {
  const step = item.objective.step;
  const transition =
    item.flow === "transition"
      ? { from: "active" as const, event: step }
      : undefined;
  const has = (on: Integration) =>
    flowOf(item.flow, on, { transition }).some((each) =>
      each.covers.includes(step),
    );
  if (!has(integration)) {
    if (!has(everythingOn(integration))) {
      throw new Error(
        `${item.id}: the ${item.flow} flow of ${integration.id} has no ${step} step`,
      );
    }
    return `${integration.name} ${missing[step] ?? `has no ${step} step`}, so the case does not apply`;
  }
  // Only a third party sends a webhook: a late one, after its reference expired or was cancelled,
  // and the ways of sending it.
  const webhookOnly =
    (webhookWays as readonly (string | undefined)[]).includes(
      item.objective.caller,
    ) ||
    (item.flow === "transition" &&
      step === "notice" &&
      list(item.from ?? []).some((from) => !isPaymentState(from)));
  if (webhookOnly && integration.notice !== "webhook") {
    return `${integration.name} has no webhook, so the case does not apply`;
  }
  // Only a third party gives a payment resource (8.8), and only there the merchant asks for it,
  // so another merchant asking for the request of any other integration does not apply.
  const resourceOnly =
    list(item.from ?? []).includes("created") ||
    (step === "request" &&
      item.objective.caller !== undefined &&
      !isCallerKind(item.objective.caller));
  if (resourceOnly && integration.notice !== "webhook") {
    return `${integration.name} has no payment resource, so the case does not apply`;
  }
  // A third party has no token of its own: it signs (HU-11). A case that needs the token of its
  // payment method, the other role or the 403 of an operation it does not have, does not apply.
  const needsItsToken =
    item.objective.caller === "other-role" ||
    (item.objective.expect === 403 && item.objective.caller === undefined);
  if (integration.notice === "webhook" && needsItsToken) {
    return `${integration.name} has no token of its own, it signs, so the case does not apply`;
  }
  // The payment of a bank in its window, and its reversal, come with the window (HU-10).
  const withoutWindow =
    (step === "reversal" || list(item.from ?? []).some(isPaymentState)) &&
    integration.reversalWindow === undefined;
  // A 403 without a caller is an operation the payment method does not have (8.9), like the
  // reversal without the window. The other 403 of 8.9, the token of the other role, always says
  // who calls. It runs only where its integration lacks the operation.
  if (item.objective.expect === 403 && item.objective.caller === undefined) {
    return withoutWindow
      ? undefined
      : `${integration.name} has the ${step}, so the case does not apply`;
  }
  return withoutWindow
    ? `${integration.name} has no reversal window, so the case does not apply`
    : undefined;
}

// How a webhook can arrive besides the usual way, with another amount than its resource, without
// its signature, with a wrong one or of a resource nobody created (8.8, 8.9). Only the framework
// sends the last three: the third party itself always signs, and only pays what it made.
const webhookWays = [
  "other-amount",
  "unsigned",
  "bad-signature",
  "unknown-resource",
] as const;

const onlyTheFramework: Record<string, string> = {
  unsigned: "without its signature",
  "bad-signature": "with a wrong signature",
  "unknown-resource": "of a resource it never made",
};

// The ways a case can call its objective besides the usual one (8.9). Any other caller is
// another merchant, by the alias its integration gives it.
export const callerKinds = [
  "no-token",
  "invalid-token",
  "wrong-key",
  "other-role",
  "malformed-request",
  ...webhookWays,
] as const;

export type CallerKind = (typeof callerKinds)[number];

export function isCallerKind(caller: string): caller is CallerKind {
  return (callerKinds as readonly string[]).includes(caller);
}

// The steps that send a body, which a malformed request breaks.
const sendsBody = ["create", "request", "notice", "second-payment", "reversal"];

// The number of an amount in this integration. One unit is the smallest of its region: a cent
// in Mexico and a whole one in South America.
function amountOf(
  given: number | (typeof amountNames)[number],
  integration: Integration,
): number {
  if (typeof given === "number") {
    return given;
  }
  const region = regions[integration.region];
  const unit = 10 ** -region.decimals;
  const { min, max } = integration.amountLimits;
  const exact = (value: number, decimals: number) =>
    Number(value.toFixed(decimals));
  switch (given) {
    case "min":
      return min;
    case "max":
      return max;
    case "below-min":
      return exact(min - unit, region.decimals);
    case "above-max":
      return exact(max + unit, region.decimals);
    case "below-fixed":
      return exact(region.amount - unit, region.decimals);
    case "above-fixed":
      return exact(region.amount + unit, region.decimals);
    case "extra-decimal":
      return exact(
        region.amount + 5 * 10 ** -(region.decimals + 1),
        region.decimals + 1,
      );
  }
}

// A code nobody created, of the length the case asks for in its region. Each region keeps
// everything in its own database, so a code of the other region does not exist here either
// (HU-09). PayRef has two regions, so the other one is the one that is not its own.
function codeOf(given: string, integration: Integration): string {
  const length = regions[integration.region].referenceLength;
  switch (given) {
    case "short":
      return "0".repeat(length - 1);
    case "exact":
      return "0".repeat(length);
    case "long":
      return "0".repeat(length + 1);
    case "other-region": {
      const other = integration.region === "mx" ? "sa" : "mx";
      return "0".repeat(regions[other].referenceLength);
    }
    default:
      return given;
  }
}

// Each way of calling goes with the step it fits. Another merchant only asks for what the
// merchant does with its reference, and the config of the integration says who it is.
function checkCaller(item: Case, integration: Integration): void {
  const { step, caller } = item.objective;
  if ((step === "token") !== (caller === "wrong-key")) {
    throw new Error(
      `${item.id}: the token step goes with a wrong key, and a wrong key with the token step`,
    );
  }
  if (
    (webhookWays as readonly (string | undefined)[]).includes(caller) &&
    step !== "notice"
  ) {
    throw new Error(
      `${item.id}: a way of sending the webhook goes with the notice`,
    );
  }
  if (caller === undefined || isCallerKind(caller)) {
    if (caller === "malformed-request" && !sendsBody.includes(step)) {
      throw new Error(
        `${item.id}: a malformed request goes with a step that sends a body: ${sendsBody.join(", ")}`,
      );
    }
    return;
  }
  if (step !== "view" && step !== "cancel" && step !== "request") {
    throw new Error(
      `${item.id}: another merchant goes with what the merchant does with its reference: view, cancel or ask for the payment resource`,
    );
  }
  if (integration.otherMerchants?.[caller] === undefined) {
    throw new Error(
      `${item.id}: its caller ${caller} is not among the other merchants of ${integration.id}. Add it to framework/integrations/${integration.id}/integration.json`,
    );
  }
}

// A transition starts from a state its reference can be in: only a single one stays paid, and
// an expired one needs its date and its time, so it goes in a case of its own.
function checkTransition(item: Case): void {
  if ((item.flow === "transition") !== (item.from !== undefined)) {
    throw new Error(
      `${item.id}: from goes with the transition flow, and only with it`,
    );
  }
  const states = list(item.from ?? []);
  if (item.after !== undefined && states.some((state) => state !== "pending")) {
    throw new Error(
      `${item.id}: after counts from the request, so it goes with a transition from pending`,
    );
  }
  if (states.includes("expired")) {
    if (states.length > 1) {
      throw new Error(
        `${item.id}: an expired reference goes in a case of its own, with its date and its time`,
      );
    }
    if (item.reference?.expiresOn === undefined || item.time === undefined) {
      throw new Error(
        `${item.id}: an expired reference needs its expiresOn and the time of the case`,
      );
    }
  }
  if (
    states.includes("paid") &&
    list(item.reference?.type ?? []).includes("recurring")
  ) {
    throw new Error(
      `${item.id}: a recurring reference stays active when it is paid, so it never starts from paid`,
    );
  }
}

type Variation = { reference: Reference; amount: number; variation: string };

// Every combination of the values of its axes. A date that is not there says nothing in the
// name, so a reference that never expires is single-fixed, and the amount is in the name only
// when the case lists several.
function list<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function variationsOf(
  item: Case,
  amounts: Case["amount"] & {},
  integration: Integration,
): Variation[] {
  const variations: Variation[] = [];
  if (item.reference === undefined) {
    return variations;
  }
  for (const type of list(item.reference.type)) {
    for (const amountType of list(item.reference.amountType)) {
      for (const expiresOn of list(item.reference.expiresOn ?? null)) {
        for (const given of list(amounts)) {
          const amount = amountOf(given, integration);
          // An open reference with an amount is a mistake of the merchant: it only reaches PayRef
          // from a case that ends at the creation and expects its 400.
          const merchantMistake =
            item.objective.step === "create" && item.objective.expect === 400;
          const created = item.reference.amount;
          if (
            amountType === "open" &&
            typeof created === "number" &&
            !merchantMistake
          ) {
            throw new Error(
              `${item.id}: reference.amount is only for a fixed reference`,
            );
          }
          const reference: Reference = { type, amountType };
          if (amountType === "fixed" && created !== null) {
            reference.amount =
              created ??
              (given === "below-fixed" || given === "above-fixed"
                ? regions[integration.region].amount
                : amount);
          }
          if (amountType === "open" && typeof created === "number") {
            reference.amount = created;
          }
          if (expiresOn !== null) {
            reference.expiresOn = expiresOn;
          }
          const listed = Array.isArray(item.amount) ? String(given) : null;
          variations.push({
            reference,
            amount,
            variation: [type, amountType, expiresOn, listed]
              .filter((part) => part !== null)
              .join("-"),
          });
        }
      }
    }
  }
  return variations;
}

export function expectationOf(item: Case): Expectation {
  const expected = item.objective.expect;
  if (typeof expected === "number") {
    return { kind: "status", status: expected };
  }
  return expected === "OK"
    ? { kind: "success" }
    : { kind: "code", code: expected };
}
