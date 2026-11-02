import type { CaseRecord } from "./evidence.ts";
import type { Result } from "./results.ts";

// How each of the four results reads, in the console and in the report (8.5).
export const resultLabels: Record<Result, string> = {
  passed: "Passed",
  failed: "Failed",
  inconclusive: "Inconclusive",
  not_run: "Not run",
};

export type Outcome = { result: Result; approved: boolean; note?: string };

// A case without its file never started. One whose file never finished could not be tested.
export function outcomeOf(record: CaseRecord | undefined): Outcome {
  if (record === undefined) {
    return { result: "not_run", approved: false, note: "it never started" };
  }
  if (record.status !== "finished" || record.result === undefined) {
    return {
      result: "inconclusive",
      approved: false,
      note: "the case did not finish",
    };
  }
  if (record.result === "passed" && record.approved !== true) {
    return {
      result: "passed",
      approved: false,
      note: `not approved: the evidence is incomplete (${record.evidence?.missing.join("; ")})`,
    };
  }
  return {
    result: record.result,
    approved: record.approved === true,
    note: record.reason,
  };
}
