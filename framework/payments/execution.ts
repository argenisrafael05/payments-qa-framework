import { randomBytes } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { Recorder, type CaseRecord } from "../engine/evidence.ts";
import { Http, type Transport } from "../engine/http.ts";
import { caseFile, caseName } from "../engine/run-files.ts";
import type { Expectation } from "../engine/judge.ts";
import { closeCase, runCase, type CasePlan } from "../engine/runner.ts";
import {
  expectationOf,
  isCallerKind,
  type CallerKind,
  type CaseEntry,
} from "./catalog.ts";
import {
  apisOf,
  createContext,
  need,
  type PaymentContext,
  type PaymentStep,
} from "./context.ts";
import { extraChecks } from "./database/checks.ts";
import { finalCheck } from "./database/final-check.ts";
import { WalletSimulatorApi } from "../integrations/wallet/WalletSimulatorApi.ts";
import { flowOf, isPaymentState } from "./flows/payment.ts";
import type { Role } from "./environment.ts";
import type { Integration } from "./integrations.ts";
import { regions } from "./regions.ts";
import type { RunSetup } from "./run-setup.ts";
import { callerToken } from "./steps/access.ts";
import { paymentOf } from "./steps/payments.ts";

export type Execution = {
  done: Promise<CaseRecord>;
  readonly finished: boolean;
  // For a case that cannot finish on its own, like one that ran out of time.
  close(reason: string): Promise<CaseRecord>;
};

// Starts one case of the run, with its own evidence, context and plan.
export function executeCase(options: {
  entry: CaseEntry;
  run: RunSetup;
  db: Pool;
  transport: Transport;
  // Which repetition of the test this is, when the run repeats it.
  repeat?: number;
}): Execution {
  const { entry, run } = options;
  const name = caseName(entry.name, options.repeat ?? 0);
  const recorder = new Recorder(caseFile(run.directory, name), {
    name,
    integration: run.integration.id,
    variation: entry.variation,
    case: entry.case,
  });

  const notRun =
    entry.notApplicable ??
    (entry.case.blocked === undefined
      ? undefined
      : `blocked: ${entry.case.blocked}`);
  if (notRun !== undefined) {
    const record = recorder.notRun(notRun);
    return {
      done: Promise.resolve(record),
      finished: true,
      close: () => Promise.resolve(record),
    };
  }

  const utcOffset = regions[run.integration.region].utcOffset;
  const time = timeOf(entry, run.integration);
  const context = createContext({
    http: new Http({
      transport: options.transport,
      baseUrl: run.environment.payrefUrl,
      recorder,
      testTime: time,
    }),
    db: options.db,
    environment: run.environment,
    reference: entry.reference,
    creationTime: creationTimeOf(entry, utcOffset),
    time,
    simulator:
      run.environment.walletUrl === undefined
        ? undefined
        : new WalletSimulatorApi(
            new Http({
              transport: options.transport,
              baseUrl: run.environment.walletUrl,
              recorder,
            }),
          ),
    eventTime:
      time === undefined || entry.case.after === undefined
        ? undefined
        : inRegion(
            Date.parse(time) + afterOf(entry.case.after, run.integration),
            utcOffset,
          ),
    caller: callerOf(entry, run),
    code: entry.code,
    amount: entry.amount,
    secondSequence: entry.secondSequence,
    integration: run.integration.id,
  });
  const plan = planFor(entry, run.integration);
  return {
    done: runCase(plan, context, recorder),
    get finished() {
      return recorder.finished;
    },
    close: (reason) => closeCase(plan, context, recorder, reason),
  };
}

// Seeing or inquiring the reference reports the state the transition left it in (8.6). The payment of a bank
// leaves a single reference paid once it is confirmed, by its notice or by the end of its window,
// and any other one active (8.7).
function objectiveOf(entry: CaseEntry): Expectation {
  const objective = expectationOf(entry.case);
  if (
    entry.from === undefined ||
    !["view", "inquiry"].includes(entry.case.objective.step) ||
    objective.kind !== "success"
  ) {
    return objective;
  }
  if (!isPaymentState(entry.from)) {
    return { kind: "success", state: entry.from };
  }
  const confirmed =
    entry.from === "confirmed" ||
    (entry.from === "pending" && entry.case.after === "window-end");
  return {
    kind: "success",
    state: confirmed && entry.reference?.type === "single" ? "paid" : "active",
  };
}

// The case writes its time in the time of its region, and PayRef gets it with its zone. A case
// whose event arrives after its request fixes the time it starts, so both times are exact.
function timeOf(
  entry: CaseEntry,
  integration: Integration,
): string | undefined {
  const time = entry.case.time;
  const { utcOffset } = regions[integration.region];
  if (time !== undefined) {
    return `${time}${utcOffset}`;
  }
  return entry.case.after === undefined
    ? undefined
    : inRegion(Date.now(), utcOffset);
}

// How long after the request the event arrives, in milliseconds, from the window of the
// integration: a second before it ends, or when it ends.
export function afterOf(
  after: "before-window-end" | "window-end",
  integration: Integration,
): number {
  const window = need(integration.reversalWindow, "The reversal window");
  const end = window.minutes * 60_000;
  return after === "window-end" ? end : end - 1000;
}

// A duration as a person reads it, like 1:59.
function clockOf(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// A moment, written in the time of its region and with its zone, to the second.
export function inRegion(ms: number, utcOffset: string): string {
  const [, sign, hours, minutes] =
    /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset) ?? [];
  const offset =
    (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  const local = new Date(Math.floor(ms / 1000) * 1000 + offset * 60_000);
  return `${local.toISOString().slice(0, 19)}${utcOffset}`;
}

// The event arrives where the case says in the window, after the request. If by then the window
// ended, the payment was already confirmed on its own, at the end of the window, whatever the
// event does.
function arrivingAfter(
  step: PaymentStep,
  after: "before-window-end" | "window-end",
  integration: Integration,
): PaymentStep {
  return {
    ...step,
    title: `${step.title}, ${clockOf(afterOf(after, integration))} after the request`,
    run: (context) => {
      const eventTime = need(context.eventTime, "The time of the event");
      const window = integration.reversalWindow;
      const folio = context.requested?.folio;
      if (window !== undefined && folio !== undefined) {
        const requestedAt = Date.parse(
          need(context.time, "The time of the case"),
        );
        const windowEnd = requestedAt + window.minutes * 60_000;
        const payment = paymentOf(context, folio);
        if (
          payment.status === "pending" &&
          Date.parse(eventTime) >= windowEnd
        ) {
          payment.status = "confirmed";
          payment.confirmedAt = new Date(windowEnd).toISOString();
        }
      }
      return step.run({
        ...context,
        apis: apisOf(context.http.with({ testTime: eventTime })),
      });
    },
  };
}

// Every step runs at the time of the case, but a reference that is already expired then was
// created the day before it expires, at 00:00, while it was still valid, because a past date is
// not created (US-07). The day before, so a bug that expires it a day early never hides another
// one. The day of the case is the one written in its time, which is the time of its region. A
// case that tests the creation itself keeps its time.
export function creationTimeOf(
  entry: CaseEntry,
  utcOffset: string,
): string | undefined {
  const time = entry.case.time;
  const expiresOn = entry.reference?.expiresOn;
  if (
    time === undefined ||
    expiresOn === undefined ||
    entry.case.objective.step === "create"
  ) {
    return undefined;
  }
  if (time.slice(0, 10) <= expiresOn) {
    return undefined;
  }
  const dayBefore = new Date(Date.parse(`${expiresOn}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `${dayBefore}T00:00:00${utcOffset}`;
}

// The objectives the merchant calls. Any other one is the payment method's.
const merchantObjectives = ["create", "view", "cancel"];

// Who calls the objective in place of its usual role, when it gets a token of its own: another
// merchant, as its integration knows it, or the other role (8.9).
function callerOf(entry: CaseEntry, run: RunSetup): Role | undefined {
  const { step, caller } = entry.case.objective;
  if (caller === "other-role") {
    return merchantObjectives.includes(step)
      ? run.environment.paymentMethod
      : run.environment.merchant;
  }
  return caller === undefined || isCallerKind(caller)
    ? undefined
    : need(run.environment.otherMerchants[caller], `The merchant ${caller}`);
}

type WayOfCalling = {
  // How the step of the objective reads in the evidence.
  how: string;
  // The title of the step that gets the caller its token, when it has one of its own.
  token?: string;
  change(context: PaymentContext): PaymentContext;
};

// The call goes with the token the caller just got, instead of the one of its usual role.
function withCallerToken(context: PaymentContext): PaymentContext {
  const token = need(context.tokens.caller, "The caller's token");
  return { ...context, apis: apisOf(context.http.with({ token })) };
}

const unknownKey = "a-key-payref-never-gave";

const waysOfCalling: Record<CallerKind, WayOfCalling> = {
  "no-token": {
    // With its body cut too: the credential goes first (8.4), so the body never gets a say.
    how: "without a token, and with its body cut",
    change: (context) => ({
      ...context,
      apis: apisOf(context.http.with({ token: null, breakBody: true })),
    }),
  },
  "invalid-token": {
    how: "with a token PayRef never gave",
    change: (context) => ({
      ...context,
      apis: apisOf(
        context.http.with({ token: randomBytes(24).toString("hex") }),
      ),
    }),
  },
  "wrong-key": {
    how: "with a key PayRef does not know",
    change: (context) => ({
      ...context,
      merchant: { ...context.merchant, key: unknownKey },
      paymentMethod: { ...context.paymentMethod, key: unknownKey },
    }),
  },
  "other-role": {
    how: "with the token of the other role",
    token: "The other role gets its token",
    change: withCallerToken,
  },
  "malformed-request": {
    how: "with its body cut before its end",
    change: (context) => ({
      ...context,
      apis: apisOf(context.http.with({ breakBody: true })),
    }),
  },
  // One whole unit more than its resource, a valid amount in any region.
  "other-amount": {
    how: "with another amount than its resource",
    change: (context) => ({ ...context, amount: context.amount + 1 }),
  },
  unsigned: {
    how: "without its signature, and with its body cut",
    change: (context) => ({
      ...context,
      apis: apisOf(context.http.with({ breakBody: true })),
      paymentMethod: { ...context.paymentMethod, key: "" },
    }),
  },
  "bad-signature": {
    how: "signed with a key PayRef does not know",
    change: (context) => ({
      ...context,
      paymentMethod: { ...context.paymentMethod, key: unknownKey },
    }),
  },
  "unknown-resource": {
    how: "of a resource nobody created",
    change: (context) => ({
      ...context,
      resource: { id: `wq_${randomBytes(8).toString("hex")}` },
    }),
  },
};

// The objective, called the way the case says instead of the usual one (8.9).
function calledBy(
  step: PaymentStep,
  caller: string | undefined,
): PaymentStep[] {
  if (caller === undefined) {
    return [step];
  }
  const way: WayOfCalling = isCallerKind(caller)
    ? waysOfCalling[caller]
    : {
        how: `as ${caller}`,
        token: `${caller} gets its token`,
        change: withCallerToken,
      };
  const called: PaymentStep = {
    ...step,
    title: `${step.title}, ${way.how}`,
    run: (context) => step.run(way.change(context)),
  };
  return way.token === undefined ? [called] : [callerToken(way.token), called];
}

// The flow up to the step where the case ends, called the way the case says, and the checks it
// asks for.
export function planFor(
  entry: CaseEntry,
  integration: Integration,
): CasePlan<PaymentContext> {
  const flow = flowOf(entry.case.flow, integration, {
    transition:
      entry.from === undefined
        ? undefined
        : { from: entry.from, event: entry.case.objective.step },
    source: entry.source,
    secondSequence: entry.secondSequence,
  });
  // A payment in two calls is complete at its notice: an objective that expects OK ends at the
  // last step that covers it, and a rejection comes at the first one.
  const covering = flow.flatMap((step, index) =>
    step.covers.includes(entry.case.objective.step) ? [index] : [],
  );
  const objective =
    (expectationOf(entry.case).kind === "success"
      ? covering.at(-1)
      : covering[0]) ?? -1;
  const found = flow[objective];
  if (found === undefined) {
    throw new Error(`${entry.name}: its flow has no step for its objective`);
  }
  const { after } = entry.case;
  const step =
    after === undefined ? found : arrivingAfter(found, after, integration);
  return {
    steps: [
      ...flow.slice(0, objective),
      ...calledBy(step, entry.case.objective.caller),
    ],
    objective: objectiveOf(entry),
    checks: (entry.case.checks ?? []).map((name) => extraChecks[name]),
    finalCheck,
  };
}
