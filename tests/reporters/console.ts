import { relative } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter";
import type { CaseRecord } from "../../framework/engine/evidence.ts";
import { results, type Result } from "../../framework/engine/results.ts";
import {
  caseFile,
  readJson,
  runFile,
  writeJson,
  type RunRecord,
} from "../../framework/engine/run-files.ts";
import { localTimestamp } from "../../framework/engine/time.ts";
import { currentRun } from "../../framework/payments/run-setup.ts";

const labels: Record<Result, string> = {
  passed: "Passed",
  failed: "Failed",
  inconclusive: "Inconclusive",
  not_run: "Not run",
};

type Outcome = { result: Result; approved: boolean; note?: string };

// The console speaks only the framework's language: each case with its result when it
// ends, and the four results at the end. They come from the run's files, never from the
// statuses of Playwright, which are only kept in each case's file.
export default class ConsoleReporter implements Reporter {
  readonly #run = currentRun();
  #record: RunRecord | undefined;

  printsToStdio(): boolean {
    return true;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    const { id, integration, environment, version, startedAt } = this.#run;
    // The selection goes in before the first case: a case without its file never started.
    this.#record = {
      id,
      integration: integration.id,
      region: integration.region,
      environment: environment.name,
      payrefVersion: version,
      status: "running",
      startedAt,
      selection: suite.allTests().map((test) => test.title),
      errors: [],
    };
    writeJson(runFile(this.#run.directory), this.#record);
    console.log(
      `\n${integration.id} · ${integration.region} · ${environment.name} · PayRef ${version}\n`,
    );
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const file = caseFile(this.#run.directory, test.title);
    const record = readJson<CaseRecord>(file);
    if (record !== undefined) {
      record.playwright = {
        status: result.status,
        durationMs: result.duration,
      };
      writeJson(file, record);
    }
    const outcome = outcomeOf(record);
    const seconds = `${(result.duration / 1000).toFixed(1)}s`;
    console.log(
      `  ${labels[outcome.result].padEnd(13)} ${test.title}  ${seconds}${
        outcome.note === undefined ? "" : `\n  ${"".padEnd(13)} ${outcome.note}`
      }`,
    );
  }

  onError(error: TestError): void {
    const message = error.message ?? String(error.value);
    this.#record?.errors.push(message);
    console.error(`  ${message}`);
  }

  onEnd(result: FullResult): void {
    const record = this.#record;
    if (record === undefined) {
      return;
    }
    const totals = {
      passed: 0,
      failed: 0,
      inconclusive: 0,
      not_run: 0,
      approved: 0,
    };
    for (const name of record.selection) {
      const outcome = outcomeOf(
        readJson<CaseRecord>(caseFile(this.#run.directory, name)),
      );
      totals[outcome.result] += 1;
      totals.approved += outcome.approved ? 1 : 0;
    }
    Object.assign(record, {
      status: result.status === "interrupted" ? "interrupted" : "finished",
      finishedAt: localTimestamp(),
      totals,
    });
    writeJson(runFile(this.#run.directory), record);

    console.log("");
    for (const name of results) {
      const extra =
        name === "passed" && totals.passed > 0
          ? `   (${totals.approved} approved)`
          : "";
      console.log(
        `  ${labels[name].padEnd(13)} ${String(totals[name]).padStart(3)}${extra}`,
      );
    }
    if (record.status === "interrupted") {
      console.log("\n  The run was interrupted.");
    }
    console.log(`\n  Files: ${relative(process.cwd(), this.#run.directory)}\n`);
  }
}

// A case without its file never started. One whose file never finished could not be tested.
function outcomeOf(record: CaseRecord | undefined): Outcome {
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
