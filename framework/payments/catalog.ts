import { readdirSync } from "node:fs";
import { z } from "zod";
import { loadData } from "../engine/data.ts";
import type { Expectation } from "../engine/judge.ts";
import { businessCodes } from "./codes.ts";
import { extraCheckNames } from "./database/checks.ts";
import { flowOf, type State } from "./flows/payment.ts";
import type { Integration } from "./integrations.ts";

const baseCatalog = new URL("../cases/base/", import.meta.url);

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
  // The state a transition starts from (8.6). Its objective is the event.
  from: axis(z.enum(["active", "paid", "cancelled", "expired"])).optional(),
  // The codes the unknown reference tries, each one a test.
  code: axis(z.string().regex(/^[0-9]+$/)).optional(),
  secondSequence: axis(z.enum(["same", "new"])).optional(),
  // The time the case fixes, with its offset. Only the cases at a time frontier fix it, and
  // the rest run with the time of the server. A reference that is already expired at that time
  // is created on its day, at 00:00.
  time: z.iso.datetime({ offset: true }).optional(),
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
  // What the customer pays, or a list of amounts that each make a test. A fixed reference is
  // created with it.
  amount: axis(z.number()),
  // Where the case ends and what it expects there (3.1): a business code, or the HTTP status
  // of a request that must not reach the business.
  objective: z.strictObject({
    step: z.enum([
      "inquiry",
      "request",
      "notice",
      "second-payment",
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
        list(item.amount).map((amount) => {
          const listed = Array.isArray(item.amount) ? `-${amount}` : "";
          const name = `${code}${listed}`;
          return {
            name: `${item.id}__${integration.id}__${name}`,
            variation: name,
            code,
            amount,
            ...(notApplicable === undefined ? {} : { notApplicable }),
            case: item,
          };
        }),
      );
    }
    checkTransition(item);
    return variationsOf(item).flatMap((variation) =>
      list(item.secondSequence ?? null).flatMap((secondSequence) =>
        list(item.from ?? null).map((from) => {
          const name = [
            variation.variation,
            secondSequence && `${secondSequence}-sequence`,
            from && `from-${from}`,
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
            ...(notApplicable === undefined ? {} : { notApplicable }),
            case: item,
          };
        }),
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
    flowOf(item.flow, on, transition).some((each) =>
      each.covers.includes(step),
    );
  if (has(integration)) {
    return undefined;
  }
  if (!has(everythingOn(integration))) {
    throw new Error(
      `${item.id}: the ${item.flow} flow of ${integration.id} has no ${step} step`,
    );
  }
  return `${integration.name} ${missing[step] ?? `has no ${step} step`}, so the case does not apply`;
}

// The ways a case can call its objective besides the usual one (8.9). Any other caller is
// another merchant, by the alias its integration gives it.
export const callerKinds = [
  "no-token",
  "invalid-token",
  "wrong-key",
  "other-role",
  "malformed-request",
] as const;

export type CallerKind = (typeof callerKinds)[number];

export function isCallerKind(caller: string): caller is CallerKind {
  return (callerKinds as readonly string[]).includes(caller);
}

// The steps that send a body, which a malformed request breaks.
const sendsBody = ["create", "request", "notice", "second-payment"];

// Each way of calling goes with the step it fits. Another merchant only asks for what the
// merchant does with its reference, and the config of the integration says who it is.
function checkCaller(item: Case, integration: Integration): void {
  const { step, caller } = item.objective;
  if ((step === "token") !== (caller === "wrong-key")) {
    throw new Error(
      `${item.id}: the token step goes with a wrong key, and a wrong key with the token step`,
    );
  }
  if (caller === undefined || isCallerKind(caller)) {
    if (caller === "malformed-request" && !sendsBody.includes(step)) {
      throw new Error(
        `${item.id}: a malformed request goes with a step that sends a body: create, request, notice or second-payment`,
      );
    }
    return;
  }
  if (step !== "view" && step !== "cancel") {
    throw new Error(
      `${item.id}: another merchant goes with an event of the merchant, view or cancel`,
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

function variationsOf(item: Case): Variation[] {
  const variations: Variation[] = [];
  if (item.reference === undefined) {
    return variations;
  }
  for (const type of list(item.reference.type)) {
    for (const amountType of list(item.reference.amountType)) {
      for (const expiresOn of list(item.reference.expiresOn ?? null)) {
        for (const amount of list(item.amount)) {
          // An open reference with an amount is a mistake of the merchant: it only reaches PayRef
          // from a case that ends at the creation and expects its 400.
          const merchantMistake =
            item.objective.step === "create" && item.objective.expect === 400;
          const given = item.reference.amount;
          if (
            amountType === "open" &&
            typeof given === "number" &&
            !merchantMistake
          ) {
            throw new Error(
              `${item.id}: reference.amount is only for a fixed reference`,
            );
          }
          const reference: Reference = { type, amountType };
          if (amountType === "fixed" && given !== null) {
            reference.amount = given ?? amount;
          }
          if (amountType === "open" && typeof given === "number") {
            reference.amount = given;
          }
          if (expiresOn !== null) {
            reference.expiresOn = expiresOn;
          }
          const listed = Array.isArray(item.amount) ? String(amount) : null;
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
