import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaseRecord } from "../../framework/engine/evidence.ts";
import { renderReport, writeReport } from "../../framework/engine/report.ts";
import {
  caseFile,
  runFile,
  writeJson,
  type RunRecord,
} from "../../framework/engine/run-files.ts";
import { temporaryDirectory } from "./builders.ts";

// The report of a run, from controlled files (HU-05): it shows what the run saved, nothing more.

const run: RunRecord = {
  id: "2026-11-01_21-41-10_wallet_mx_local_1.0",
  integration: "wallet",
  region: "mx",
  environment: "local",
  payrefVersion: "1.0",
  status: "finished",
  startedAt: "2026-11-01T21:41:10.882-06:00",
  finishedAt: "2026-11-01T21:41:33.168-06:00",
  selection: [
    "F01-01__wallet__single-fixed-by-framework",
    "F08-02__wallet__single-fixed-from-cancelled-by-framework",
    "F07-01__wallet__single-fixed-from-pending",
    "F08-04__wallet__single-fixed-by-framework",
  ],
  errors: [],
};

function caseRecord(name: string, changes: Partial<CaseRecord>): CaseRecord {
  return {
    name,
    integration: "wallet",
    variation: name.split("__")[2] ?? "",
    case: { title: `The title of ${name.split("__")[0]}` },
    status: "finished",
    startedAt: "2026-11-01T21:41:11.000-06:00",
    steps: [],
    checks: [],
    problems: [],
    result: "passed",
    approved: true,
    evidence: { complete: true, missing: [] },
    durationMs: 30,
    ...changes,
  };
}

const passed = caseRecord(run.selection[0] ?? "", {});
const failed = caseRecord(run.selection[1] ?? "", {
  result: "failed",
  approved: false,
  reason: "webhook: expected R-105, got OK without folio and authorization",
  steps: [
    {
      name: "webhook",
      title: "The framework sends the webhook",
      kind: "executes",
      status: "ran",
      durationMs: 4,
      readings: [],
      calls: [
        {
          attempt: 1,
          at: "2026-11-01T21:41:12.000-06:00",
          durationMs: 4,
          request: {
            method: "POST",
            url: "http://127.0.0.1:4101/wallet/webhooks",
            headers: { "content-type": "application/json" },
            body: { resource: "wq_1" },
          },
          response: {
            status: 200,
            headers: {},
            body: { result: "accepted", message: "<script>alert(1)</script>" },
          },
        },
      ],
      verdict: {
        result: "mismatch",
        check: "success",
        expected: "R-105",
        found: "OK without folio and authorization",
      },
    },
  ],
});
const notRun = caseRecord(run.selection[2] ?? "", {
  result: "not_run",
  approved: false,
  reason: "Wallet has no reversal window, so the case does not apply",
});

function records(...saved: CaseRecord[]): Map<string, CaseRecord | undefined> {
  return new Map(
    run.selection.map((name) => [
      name,
      saved.find((record) => record.name === name),
    ]),
  );
}

describe("the report of a run", () => {
  it("shows the summary first, with the totals of the files of the run", () => {
    const page = renderReport(run, records(passed, failed, notRun));
    expect(page).toContain("<strong>1 of 4 tests approved.</strong>");
    expect(page).toContain(
      "1 failed, 0 inconclusive and 2 not run, each one with its reason.",
    );
    expect(page.indexOf("Summary")).toBeLessThan(page.indexOf("Cases"));
    expect(page).toContain("<dt>PayRef</dt><dd>1.0</dd>");
    expect(page).toContain("<dt>Duration</dt><dd>22 s</dd>");
  });

  it("shows every test of the selection with its result and its reason", () => {
    const page = renderReport(run, records(passed, failed, notRun));
    for (const name of run.selection) {
      expect(page).toContain(name);
    }
    expect(page).toContain(
      "webhook: expected R-105, got OK without folio and authorization",
    );
    expect(page).toContain(
      "Wallet has no reversal window, so the case does not apply",
    );
    // A test without its file never started.
    expect(page).toContain("it never started");
  });

  it("takes a case whose file never finished as inconclusive", () => {
    const cut = caseRecord(run.selection[0] ?? "", {
      status: "running",
      result: undefined,
    });
    const page = renderReport(run, records(cut, failed, notRun));
    expect(page).toContain("the case did not finish");
    expect(page).toContain(
      "<strong>0 of 4 tests approved.</strong> 1 failed, 1 inconclusive",
    );
  });

  it("does not approve a passed test whose evidence is incomplete", () => {
    const incomplete = caseRecord(run.selection[0] ?? "", {
      approved: false,
      evidence: { complete: false, missing: ["webhook: nothing was captured"] },
    });
    const page = renderReport(run, records(incomplete, failed, notRun));
    expect(page).toContain("<strong>0 of 4 tests approved.</strong>");
    expect(page).toContain(
      "not approved: the evidence is incomplete (webhook: nothing was captured)",
    );
  });

  it("escapes what PayRef answered, so a body never runs in the page", () => {
    const page = renderReport(run, records(passed, failed, notRun));
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("writes report.html next to the files of the run, and writes it again", () => {
    const directory = temporaryDirectory();
    writeJson(runFile(directory), run);
    for (const record of [passed, failed, notRun]) {
      writeJson(caseFile(directory, record.name), record);
    }
    const file = writeReport(directory);
    expect(file).toBe(join(directory, "report.html"));
    expect(readFileSync(file, "utf8")).toContain("1 of 4 tests approved");
    expect(writeReport(directory)).toBe(file);
    expect(existsSync(file)).toBe(true);
  });

  it("says so when the folder has no run", () => {
    expect(() => writeReport(temporaryDirectory())).toThrow(
      "There is no run in",
    );
  });
});
