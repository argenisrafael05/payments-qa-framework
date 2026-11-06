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
import { outcomeOf, resultLabels } from "../../framework/engine/outcome.ts";
import { writeReport } from "../../framework/engine/report.ts";
import { results } from "../../framework/engine/results.ts";
import {
  caseFile,
  caseName,
  readJson,
  runFile,
  writeJson,
  type RunRecord,
} from "../../framework/engine/run-files.ts";
import { localTimestamp } from "../../framework/engine/time.ts";
import { currentRun } from "../../framework/payments/run-setup.ts";

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
      selection: suite
        .allTests()
        .map((test) => caseName(test.title, test.repeatEachIndex)),
      errors: [],
    };
    writeJson(runFile(this.#run.directory), this.#record);
    console.log(
      `\n${integration.id} · ${integration.region} · ${environment.name} · PayRef ${version}\n`,
    );
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const name = caseName(test.title, test.repeatEachIndex);
    const file = caseFile(this.#run.directory, name);
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
      `  ${resultLabels[outcome.result].padEnd(13)} ${name}  ${seconds}${
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
        `  ${resultLabels[name].padEnd(13)} ${String(totals[name]).padStart(3)}${extra}`,
      );
    }
    if (record.status === "interrupted") {
      console.log("\n  The run was interrupted.");
    }
    // The report is made from the files the run just saved (US-05).
    const report = writeReport(this.#run.directory);
    console.log(`\n  Report: ${relative(process.cwd(), report)}`);
    console.log(`  Files:  ${relative(process.cwd(), this.#run.directory)}\n`);
  }
}
