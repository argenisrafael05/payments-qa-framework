import { randomBytes } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { Recorder, type CaseRecord } from "../engine/evidence.ts";
import { Http, type Transport } from "../engine/http.ts";
import { caseFile } from "../engine/run-files.ts";
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
import { flowOf } from "./flows/payment.ts";
import type { Role } from "./environment.ts";
import type { Integration } from "./integrations.ts";
import type { RunSetup } from "./run-setup.ts";
import { callerToken } from "./steps/access.ts";

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
}): Execution {
  const { entry, run } = options;
  const recorder = new Recorder(caseFile(run.directory, entry.name), {
    name: entry.name,
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

  const context = createContext({
    http: new Http({
      transport: options.transport,
      baseUrl: run.environment.payrefUrl,
      recorder,
      testTime: entry.case.time,
    }),
    db: options.db,
    environment: run.environment,
    reference: entry.reference,
    creationTime: creationTimeOf(entry),
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

// Seeing the reference reports the state the transition started from (8.6).
function objectiveOf(entry: CaseEntry): Expectation {
  const objective = expectationOf(entry.case);
  return entry.from !== undefined &&
    entry.case.objective.step === "view" &&
    objective.kind === "success"
    ? { kind: "success", state: entry.from }
    : objective;
}

// Every step runs at the time of the case, but a reference that is already expired then was
// created on its day, at 00:00, while it was still valid, because a past date is not created
// (HU-07). The day of the case is the one written in its time, which is the time of its region.
// A case that tests the creation itself keeps its time.
export function creationTimeOf(entry: CaseEntry): string | undefined {
  const time = entry.case.time;
  const expiresOn = entry.reference?.expiresOn;
  if (
    time === undefined ||
    expiresOn === undefined ||
    entry.case.objective.step === "create"
  ) {
    return undefined;
  }
  const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(time)?.[1];
  return offset !== undefined && time.slice(0, 10) > expiresOn
    ? `${expiresOn}T00:00:00${offset}`
    : undefined;
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
    how: "without a token",
    change: (context) => ({
      ...context,
      apis: apisOf(context.http.with({ token: null })),
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
  const flow = flowOf(
    entry.case.flow,
    integration,
    entry.from === undefined
      ? undefined
      : { from: entry.from, event: entry.case.objective.step },
  );
  const objective = flow.findIndex((step) =>
    step.covers.includes(entry.case.objective.step),
  );
  const step = flow[objective];
  if (step === undefined) {
    throw new Error(`${entry.name}: its flow has no step for its objective`);
  }
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
