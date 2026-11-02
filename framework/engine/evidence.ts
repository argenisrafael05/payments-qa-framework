import type { Verdict } from "./judge.ts";
import { decide, type Decision, type Problem } from "./results.ts";
import { writeJson } from "./run-files.ts";
import type { CheckOutcome } from "./runner.ts";
import { localTimestamp } from "./time.ts";

export type CallRecord = {
  attempt: number;
  at: string;
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response?: { status: number; headers: Record<string, string>; body: unknown };
  error?: string;
};

export type ReadingRecord =
  | { name: string; rows: Record<string, unknown>[] }
  | { name: string; error: string };

export type StepRecord = {
  name: string;
  title: string;
  kind: "executes" | "observes";
  status: "ran" | "not_run";
  startedAt?: string;
  durationMs?: number;
  calls: CallRecord[];
  readings: ReadingRecord[];
  // Without the body: the judge read the original, and the evidence keeps the masked copy.
  verdict?: {
    result: Verdict["result"];
    check?: string;
    expected: string;
    found: string;
  };
};

export type CheckRecord = {
  name: string;
  title: string;
  status: "ran" | "not_run";
  durationMs?: number;
  result?: CheckOutcome["result"];
  expected?: string;
  found?: string;
  detail?: string;
  readings: ReadingRecord[];
};

export type CaseHeader = {
  name: string;
  integration: string;
  variation: string;
  case: unknown;
};

export type CaseRecord = CaseHeader &
  Partial<Decision> & {
    status: "running" | "finished";
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    steps: StepRecord[];
    checks: CheckRecord[];
    finalCheck?: CheckRecord;
    // In the order they happened. The first one decides the result (8.5).
    problems: Problem[];
    // Added at the end, as the tool reported it.
    playwright?: { status: string; durationMs: number };
  };

type Named = { name: string; title: string };

// Collects the evidence of one case and saves it after every step (HU-01). The file
// exists from the moment the case starts, and nothing changes it once the case is finished.
export class Recorder {
  readonly record: CaseRecord;
  readonly #file: string;
  readonly #startedAt = Date.now();
  #current: { step: StepRecord; startedAt: number } | undefined;
  #saveError: string | undefined;

  constructor(file: string, header: CaseHeader) {
    this.#file = file;
    this.record = {
      ...header,
      status: "running",
      startedAt: localTimestamp(),
      steps: [],
      checks: [],
      problems: [],
    };
    this.#save();
  }

  get finished(): boolean {
    return this.record.status === "finished";
  }

  get finalCheckStarted(): boolean {
    return this.record.finalCheck !== undefined;
  }

  // Every step and check of the case is listed from the start, so the ones that never ran
  // stay marked.
  plan(
    steps: readonly (Named & { kind: StepRecord["kind"] })[],
    checks: readonly Named[],
  ): void {
    this.record.steps = steps.map((step) => ({
      name: step.name,
      title: step.title,
      kind: step.kind,
      status: "not_run",
      calls: [],
      readings: [],
    }));
    this.record.checks = checks.map((check) => ({
      name: check.name,
      title: check.title,
      status: "not_run",
      readings: [],
    }));
    this.#save();
  }

  beginStep(index: number): void {
    const step = this.record.steps[index];
    if (this.finished || step === undefined) {
      return;
    }
    step.status = "ran";
    step.startedAt = localTimestamp();
    this.#current = { step, startedAt: Date.now() };
  }

  recordCall(call: CallRecord): void {
    if (!this.finished) {
      this.#current?.step.calls.push(call);
    }
  }

  recordReadings(readings: readonly ReadingRecord[]): void {
    if (!this.finished) {
      this.#current?.step.readings.push(...readings);
    }
  }

  endStep(verdict?: Verdict): void {
    const current = this.#current;
    if (this.finished || current === undefined) {
      return;
    }
    current.step.durationMs = Date.now() - current.startedAt;
    if (verdict !== undefined) {
      current.step.verdict = {
        result: verdict.result,
        check: verdict.result === "mismatch" ? verdict.check : undefined,
        expected: verdict.expected,
        found: verdict.found,
      };
    }
    this.#current = undefined;
    this.#save();
  }

  beginCheck(index: number): void {
    const check = this.record.checks[index];
    if (!this.finished && check !== undefined) {
      check.status = "ran";
    }
  }

  beginFinalCheck(check: Named): void {
    if (!this.finished) {
      this.record.finalCheck = { ...check, status: "ran", readings: [] };
    }
  }

  endCheck(
    target: number | "final",
    outcome: CheckOutcome,
    durationMs: number,
  ): void {
    const check =
      target === "final" ? this.record.finalCheck : this.record.checks[target];
    if (this.finished || check === undefined) {
      return;
    }
    Object.assign(check, { status: "ran", durationMs, ...outcome });
    this.#save();
  }

  problem(problem: Problem): void {
    if (!this.finished) {
      this.record.problems.push(problem);
    }
  }

  finish(): CaseRecord {
    if (this.finished) {
      return this.record;
    }
    const gaps = evidenceGaps(this.record);
    if (this.#saveError !== undefined) {
      gaps.push(`the case file could not be saved: ${this.#saveError}`);
    }
    Object.assign(this.record, decide(this.record.problems, gaps), {
      status: "finished",
      finishedAt: localTimestamp(),
      durationMs: Date.now() - this.#startedAt,
    });
    this.#save();
    return this.record;
  }

  // A case that never started keeps its reason (8.5), and its file says so.
  notRun(reason: string): CaseRecord {
    Object.assign(this.record, {
      status: "finished",
      result: "not_run",
      reason,
      approved: false,
      evidence: { complete: true, missing: [] },
      finishedAt: localTimestamp(),
      durationMs: 0,
    });
    this.#save();
    return this.record;
  }

  #save(): void {
    try {
      writeJson(this.#file, this.record);
    } catch (error) {
      this.#saveError = error instanceof Error ? error.message : String(error);
      console.error(`Could not save ${this.#file}: ${this.#saveError}`);
    }
  }
}

// The minimum evidence (8.5, HU-01): every step that ran left its call or its readings and its
// verdict, every check that ran left its result, and the final check is there. Zero rows and a
// captured error are evidence too.
export function evidenceGaps(record: CaseRecord): string[] {
  const gaps: string[] = [];
  for (const step of record.steps) {
    if (step.status !== "ran") {
      continue;
    }
    const captured =
      step.kind === "executes"
        ? step.calls.some(
            (call) => call.response !== undefined || call.error !== undefined,
          )
        : step.readings.length > 0;
    if (!captured) {
      gaps.push(`${step.name}: nothing was captured`);
    }
    if (step.verdict === undefined) {
      gaps.push(`${step.name}: no verdict`);
    }
  }
  for (const check of record.checks) {
    if (check.status === "ran" && check.result === undefined) {
      gaps.push(`${check.name}: no result`);
    }
  }
  if (record.finalCheck === undefined) {
    gaps.push("the final database check did not run");
  } else if (record.finalCheck.result === undefined) {
    gaps.push("the final database check did not finish");
  }
  return gaps;
}
