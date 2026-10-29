import type { Verdict } from "./judge.ts";
import type { CheckOutcome } from "./runner.ts";

// The four results. In the code, the files and the console they are in English, like
// the report.
export const results = ["passed", "failed", "inconclusive", "not_run"] as const;
export type Result = (typeof results)[number];

// Something that kept the case from passing. "failed" says the system did something else,
// and "inconclusive" says it could not be tested.
export type Problem = { result: "failed" | "inconclusive"; reason: string };

// The decision table of the case result lives in these functions and in decide().

export function stepProblem(
  step: string,
  verdict: Verdict,
): Problem | undefined {
  switch (verdict.result) {
    case "match":
      return undefined;
    case "no_response":
      return { result: "inconclusive", reason: `${step}: ${verdict.found}` };
    case "mismatch":
      return {
        result: "failed",
        reason:
          verdict.check === "leak"
            ? `${step}: ${verdict.found}`
            : `${step}: expected ${verdict.expected}, got ${verdict.found}`,
      };
  }
}

export function checkProblem(
  check: string,
  outcome: CheckOutcome,
): Problem | undefined {
  switch (outcome.result) {
    case "match":
    case "skipped":
      return undefined;
    case "mismatch":
      return {
        result: "failed",
        reason: `${check}: ${outcome.detail ?? `expected ${outcome.expected}, got ${outcome.found}`}`,
      };
    case "unavailable":
      return {
        result: "inconclusive",
        reason: `${check}: could not read the database (${outcome.detail})`,
      };
  }
}

// An error of the framework itself never counts as a bug of PayRef.
export function frameworkProblem(error: unknown): Problem {
  const message = error instanceof Error ? error.message : String(error);
  return { result: "inconclusive", reason: `framework error: ${message}` };
}

export type Decision = {
  result: Result;
  reason?: string;
  approved: boolean;
  evidence: { complete: boolean; missing: string[] };
};

// The first problem decides, and what came after it is kept apart, without hiding it.
// A passed case is approved only with its evidence complete.
export function decide(
  problems: readonly Problem[],
  gaps: readonly string[],
): Decision {
  const main = problems[0];
  const result = main?.result ?? "passed";
  return {
    result,
    reason: main?.reason,
    approved: result === "passed" && gaps.length === 0,
    evidence: { complete: gaps.length === 0, missing: [...gaps] },
  };
}
