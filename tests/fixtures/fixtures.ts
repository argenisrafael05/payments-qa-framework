import { test as base } from "@playwright/test";
import type { Pool } from "mysql2/promise";
import type { CaseRecord } from "../../framework/engine/evidence.ts";
import type { CaseEntry } from "../../framework/payments/catalog.ts";
import { connect } from "../../framework/payments/database/connection.ts";
import {
  executeCase,
  type Execution,
} from "../../framework/payments/execution.ts";
import {
  currentRun,
  type RunSetup,
} from "../../framework/payments/run-setup.ts";
import { playwrightTransport } from "./transport.ts";

type Cases = { run(entry: CaseEntry): Promise<CaseRecord> };

export const test = base.extend<{ cases: Cases }, { run: RunSetup; db: Pool }>({
  run: [
    async ({}, use) => {
      await use(currentRun());
    },
    { scope: "worker" },
  ],
  db: [
    async ({ run }, use) => {
      const db = connect(run.environment.database);
      await use(db);
      await db.end();
    },
    { scope: "worker" },
  ],
  cases: async ({ request, run, db }, use, testInfo) => {
    let execution: Execution | undefined;
    await use({
      run(entry) {
        execution = executeCase({
          entry,
          run,
          db,
          transport: playwrightTransport(request),
        });
        return execution.done;
      },
    });
    // A case that ran out of time, or whose run was interrupted, is closed here, with its
    // last check of the database.
    if (execution !== undefined && !execution.finished) {
      await execution.close(
        testInfo.status === "timedOut"
          ? "the case ran out of time"
          : "the run was interrupted",
      );
    }
  },
});

// What Playwright shows: green only for an approved case, skipped for one that never
// started, and failed for the rest, with our result and its reason. The result itself lives in
// the case's file, and that one is the truth.
export function approve(record: CaseRecord): void {
  const result = record.result ?? "inconclusive";
  const reason =
    record.reason ??
    (record.status === "running" ? "the case did not finish" : undefined);
  const summary = reason === undefined ? result : `${result}: ${reason}`;
  test.info().annotations.push({ type: "result", description: summary });

  if (result === "not_run") {
    test.skip(true, reason);
    return;
  }
  if (record.approved === true) {
    return;
  }
  throw new Error(
    result === "passed"
      ? `passed, but not approved: the evidence is incomplete (${record.evidence?.missing.join("; ")})`
      : summary,
  );
}
