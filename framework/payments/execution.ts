import type { Pool } from "mysql2/promise";
import { Recorder, type CaseRecord } from "../engine/evidence.ts";
import { Http, type Transport } from "../engine/http.ts";
import { caseFile } from "../engine/run-files.ts";
import { closeCase, runCase, type CasePlan } from "../engine/runner.ts";
import { expectationOf, type CaseEntry } from "./catalog.ts";
import { createContext, type PaymentContext } from "./context.ts";
import { extraChecks } from "./database/checks.ts";
import { finalCheck } from "./database/final-check.ts";
import { paymentFlow } from "./flows/payment.ts";
import type { RunSetup } from "./run-setup.ts";

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

  if (entry.case.blocked !== undefined) {
    const record = recorder.notRun(`blocked: ${entry.case.blocked}`);
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
    }),
    db: options.db,
    environment: run.environment,
    reference: entry.case.reference,
    integration: run.integration.id,
  });
  const plan = planFor(entry, run);
  return {
    done: runCase(plan, context, recorder),
    get finished() {
      return recorder.finished;
    },
    close: (reason) => closeCase(plan, context, recorder, reason),
  };
}

// The flow up to the step where the case ends, and the checks it asks for.
function planFor(entry: CaseEntry, run: RunSetup): CasePlan<PaymentContext> {
  const flow = paymentFlow(run.integration);
  const objective = flow.findIndex((step) =>
    step.covers.includes(entry.case.objective.step),
  );
  if (objective === -1) {
    throw new Error(`${entry.name}: its flow has no step for its objective`);
  }
  return {
    steps: flow.slice(0, objective + 1),
    objective: expectationOf(entry.case),
    checks: (entry.case.checks ?? []).map((name) => extraChecks[name]),
    finalCheck,
  };
}
