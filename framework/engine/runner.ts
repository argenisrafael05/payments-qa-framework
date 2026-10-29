import type { CaseRecord, ReadingRecord, Recorder } from "./evidence.ts";
import type { Exchange, JsonObject } from "./http.ts";
import { judge, type Expectation } from "./judge.ts";
import {
  checkProblem,
  frameworkProblem,
  stepProblem,
  type Problem,
} from "./results.ts";

export type Step<C> = {
  name: string;
  title: string;
  // It executes a call, or it observes in the database what someone else did (HU-01).
  kind: "executes" | "observes";
  // The business steps it carries out, as a case names them in its objective.
  covers: readonly string[];
  run(context: C): Promise<Exchange>;
  // What it expects, from what the next step expects. Without it, it only has to succeed.
  expects?(next: Expectation): Expectation;
  // Keeps what the next steps need, from a response that succeeded.
  keep?(context: C, body: JsonObject): void;
};

export type CheckOutcome = {
  result: "match" | "mismatch" | "unavailable" | "skipped";
  expected?: string;
  found?: string;
  detail?: string;
  readings: ReadingRecord[];
};

// A check reads the database. It never reads a response: that is the judge's job (3.1).
export type DatabaseCheck<C> = {
  name: string;
  title: string;
  run(context: C): Promise<CheckOutcome>;
};

export type CasePlan<C> = {
  // Up to the objective, which is the last one.
  steps: readonly Step<C>[];
  objective: Expectation;
  // The extra checks the case asks for by name (3.1).
  checks: readonly DatabaseCheck<C>[];
  finalCheck: DatabaseCheck<C>;
};

const success: Expectation = { kind: "success" };

// Runs a case to its objective (3.1). The steps before it only have to succeed, and the case
// stops at the first problem. The extra checks come after, and the final check of the
// database always runs, once (HU-01).
export async function runCase<C>(
  plan: CasePlan<C>,
  context: C,
  recorder: Recorder,
): Promise<CaseRecord> {
  recorder.plan(plan.steps, plan.checks);
  const expectations = expectationsOf(plan);
  let stopped = false;

  for (const [index, step] of plan.steps.entries()) {
    // A case closed from outside, like one that ran out of time, stops here.
    if (recorder.finished) {
      break;
    }
    recorder.beginStep(index);
    try {
      const verdict = judge(
        await step.run(context),
        expectations[index] ?? success,
      );
      recorder.endStep(verdict);
      if (verdict.succeeded && verdict.body !== undefined) {
        step.keep?.(context, verdict.body);
      }
      stopped = report(recorder, stepProblem(step.name, verdict));
    } catch (error) {
      recorder.endStep();
      stopped = report(recorder, frameworkProblem(error));
    }
    if (stopped) {
      break;
    }
  }

  // After a problem the extra checks do not run: they are not a diagnosis (HU-01).
  for (const [index, check] of plan.checks.entries()) {
    if (stopped || recorder.finished) {
      break;
    }
    recorder.beginCheck(index);
    stopped = report(recorder, await runCheck(check, context, recorder, index));
  }

  await finalCheck(plan, context, recorder);
  return recorder.finish();
}

// The objective is what the last step expects. The steps before it only have to succeed,
// unless they say they expect what the next one does.
function expectationsOf<C>(plan: CasePlan<C>): Expectation[] {
  const expectations: Expectation[] = [];
  let next = plan.objective;
  for (let index = plan.steps.length - 1; index >= 0; index--) {
    const step = plan.steps[index];
    const expectation =
      index === plan.steps.length - 1
        ? plan.objective
        : (step?.expects?.(next) ?? success);
    expectations[index] = expectation;
    next = expectation;
  }
  return expectations;
}

// Closes a case that could not finish on its own, like one that ran out of time or a run that
// was interrupted. The final check still runs, unless it had already started.
export async function closeCase<C>(
  plan: CasePlan<C>,
  context: C,
  recorder: Recorder,
  reason: string,
): Promise<CaseRecord> {
  recorder.problem({ result: "inconclusive", reason });
  await finalCheck(plan, context, recorder);
  return recorder.finish();
}

// Once per case, whoever gets here first: the case itself or the one that closes it.
async function finalCheck<C>(
  plan: CasePlan<C>,
  context: C,
  recorder: Recorder,
): Promise<void> {
  if (recorder.finished || recorder.finalCheckStarted) {
    return;
  }
  recorder.beginFinalCheck(plan.finalCheck);
  report(recorder, await runCheck(plan.finalCheck, context, recorder, "final"));
}

async function runCheck<C>(
  check: DatabaseCheck<C>,
  context: C,
  recorder: Recorder,
  target: number | "final",
): Promise<Problem | undefined> {
  const startedAt = Date.now();
  try {
    const outcome = await check.run(context);
    recorder.endCheck(target, outcome, Date.now() - startedAt);
    return checkProblem(check.name, outcome);
  } catch (error) {
    return frameworkProblem(error);
  }
}

function report(recorder: Recorder, problem: Problem | undefined): boolean {
  if (problem === undefined) {
    return false;
  }
  recorder.problem(problem);
  return true;
}
