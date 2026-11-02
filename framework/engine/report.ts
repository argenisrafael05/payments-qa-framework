import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CallRecord,
  CaseRecord,
  CheckRecord,
  ReadingRecord,
  StepRecord,
} from "./evidence.ts";
import { outcomeOf, resultLabels, type Outcome } from "./outcome.ts";
import { reportScript, reportStyles } from "./report-page.ts";
import type { Result } from "./results.ts";
import { caseFile, readJson, runFile, type RunRecord } from "./run-files.ts";

// The report of a run (HU-05): the summary first, and every test open down to its steps, its
// checks and its evidence. It only shows what the run saved, so it can be made again at any
// time, also for a run that was cut, and it never recommends nor guesses a cause.

type Test = { name: string; record?: CaseRecord; outcome: Outcome };

// The worst result goes first, the one to look at.
const byWorst: Result[] = ["failed", "inconclusive", "not_run", "passed"];

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Reads the files of the run and writes report.html next to them.
export function writeReport(directory: string): string {
  const run = readJson<RunRecord>(runFile(directory));
  if (run === undefined) {
    throw new Error(`There is no run in ${directory}`);
  }
  const records = new Map(
    run.selection.map((name) => [
      name,
      readJson<CaseRecord>(caseFile(directory, name)),
    ]),
  );
  const file = join(directory, "report.html");
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, renderReport(run, records));
  renameSync(temporary, file);
  return file;
}

export function renderReport(
  run: RunRecord,
  records: ReadonlyMap<string, CaseRecord | undefined>,
): string {
  const tests: Test[] = run.selection.map((name) => {
    const record = records.get(name);
    return { name, record, outcome: outcomeOf(record) };
  });
  const count = (result: Result) =>
    tests.filter((test) => test.outcome.result === result).length;
  const approved = tests.filter((test) => test.outcome.approved).length;
  const ran = tests.filter(
    (test) => test.record !== undefined && test.outcome.result !== "not_run",
  );
  const complete = ran.filter((test) => test.record?.evidence?.complete);
  const title = `${capitalized(run.integration)} · PayRef ${run.payrefVersion}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Execution report · ${escape(title)}</title>
<style>${reportStyles}</style>
</head>
<body>
<main>
<header>
  <p class="eyebrow">/// Execution report</p>
  <h1>${escape(title)}</h1>
  <p class="lead"><strong>${approved} of ${tests.length} tests approved.</strong> ${count("failed")} failed, ${count("inconclusive")} inconclusive and ${count("not_run")} not run, each one with its reason.${endOf(run)}</p>
</header>

<section aria-labelledby="summary-title">
  <h2 id="summary-title">Summary</h2>
  <dl class="context">
    ${contextItem("Integration", capitalized(run.integration))}
    ${contextItem("Region", run.region)}
    ${contextItem("Environment", run.environment)}
    ${contextItem("PayRef", run.payrefVersion)}
    ${contextItem("Started", dateOf(run.startedAt))}
    ${contextItem("Duration", durationOf(run))}
  </dl>
  <ul class="totals">
    ${(["passed", "failed", "inconclusive", "not_run"] as const)
      .map(
        (result) =>
          `<li style="--c: var(--${result})"><span class="n">${count(result)}</span><span class="l">${resultLabels[result]}</span></li>`,
      )
      .join("")}
  </ul>
  <p class="note">The evidence is complete in ${complete.length} of the ${ran.length} tests that ran. A passed test with incomplete evidence is not approved.</p>
  ${errorsOf(run)}
</section>

<section aria-labelledby="cases-title">
  <h2 id="cases-title">Cases</h2>
  <div class="filters" role="group" aria-label="Show the tests with this result">${filters(tests)}</div>
  <ol class="groups">${groupsOf(tests).map(group).join("")}</ol>
</section>

<footer>
  <p>Run <code>${escape(run.id)}</code>. This report shows what the run saved, test by test. The Playwright report of the same run is in <a href="playwright-report/index.html">playwright-report</a>.</p>
</footer>
</main>
<script>${reportScript}</script>
</body>
</html>
`;
}

function endOf(run: RunRecord): string {
  if (run.status === "interrupted") {
    return " The run was interrupted.";
  }
  return run.status === "running" ? " The run did not finish." : "";
}

function contextItem(label: string, value: string): string {
  return `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
}

function errorsOf(run: RunRecord): string {
  if (run.errors.length === 0) {
    return "";
  }
  return `<div class="reason"><strong>Errors of the run</strong><ul>${run.errors
    .map((error) => `<li>${escape(error)}</li>`)
    .join("")}</ul></div>`;
}

function filters(tests: readonly Test[]): string {
  const all = `<button type="button" class="filter active" data-filter="all" aria-pressed="true">All <span class="count">${tests.length}</span></button>`;
  return (
    all +
    byWorst
      .map((result) => {
        const n = tests.filter((test) => test.outcome.result === result).length;
        return `<button type="button" class="filter" data-filter="${result}" aria-pressed="false">${resultLabels[result]} <span class="count">${n}</span></button>`;
      })
      .join("")
  );
}

// The tests of each case together, in the order the run selected them.
function groupsOf(tests: readonly Test[]): Test[][] {
  const groups = new Map<string, Test[]>();
  for (const test of tests) {
    const id = test.name.split("__")[0] ?? test.name;
    groups.set(id, [...(groups.get(id) ?? []), test]);
  }
  return [...groups.values()];
}

function group(tests: Test[]): string {
  const first = tests[0];
  const id = first?.name.split("__")[0] ?? "";
  const title = tests
    .map((test) => (test.record?.case as { title?: string } | undefined)?.title)
    .find((each) => each !== undefined);
  const counted = byWorst.filter((result) =>
    tests.some((test) => test.outcome.result === result),
  );
  const worst = counted[0] ?? "passed";
  const counts = counted
    .map((result) => {
      const n = tests.filter((test) => test.outcome.result === result).length;
      return `<span class="mini mini-${result}">${n} ${resultLabels[result].toLowerCase()}</span>`;
    })
    .join(" ");
  const open = worst === "failed" || worst === "inconclusive" ? " open" : "";
  return `<li class="group"><details${open}><summary><span class="dot dot-${worst}" aria-hidden="true"></span><span class="cid">${escape(id)}</span><span class="gtitle">${escape(title ?? "")}</span><span class="gcounts">${counts}</span></summary><ol class="tests">${tests.map(test).join("")}</ol></details></li>`;
}

function test(each: Test): string {
  const { name, record, outcome } = each;
  const variation = record?.variation ?? name.split("__").slice(2).join("__");
  const note =
    outcome.note !== undefined && outcome.result !== "passed"
      ? `<span class="test-reason">${escape(outcome.note)}</span>`
      : "";
  const ms =
    record?.durationMs === undefined
      ? ""
      : `<span class="ms">${record.durationMs} ms</span>`;
  return `<li class="test" data-result="${outcome.result}"><details><summary>${chip(outcome.result)}<span class="variation">${escape(variation)}</span>${note}${ms}</summary><div class="test-body"><p class="test-name"><code>${escape(name)}</code></p>${detail(record, outcome)}</div></details></li>`;
}

function detail(record: CaseRecord | undefined, outcome: Outcome): string {
  const parts: string[] = [];
  if (outcome.note !== undefined) {
    parts.push(
      `<p class="reason"><strong>${outcome.approved || outcome.result !== "passed" ? "Reason" : "Not approved"}</strong> ${escape(outcome.note)}</p>`,
    );
  }
  if (record === undefined || outcome.result === "not_run") {
    return parts.join("");
  }
  parts.push(`<p class="evidence-state">${evidenceState(record)}</p>`);
  const checks = [
    ...record.checks,
    ...(record.finalCheck === undefined ? [] : [record.finalCheck]),
  ];
  parts.push(stepsTable(record.steps));
  if (checks.length > 0) {
    parts.push(checksTable(checks));
  }
  parts.push(evidence(record.steps, checks));
  return parts.join("");
}

function evidenceState(record: CaseRecord): string {
  const missing = record.evidence?.missing ?? [];
  return record.evidence?.complete
    ? "Evidence complete"
    : `Evidence incomplete: ${escape(missing.join("; "))}`;
}

function stepsTable(steps: readonly StepRecord[]): string {
  const rows = steps
    .map((step, index) => {
      const verdict = step.verdict;
      const cells =
        verdict === undefined
          ? `<td class="muted">${step.status === "ran" ? "no verdict" : "not run"}</td><td></td><td></td>`
          : `<td>${escape(verdict.expected)}</td><td>${escape(verdict.found)}</td><td class="${verdict.result === "match" ? "ok" : "bad"}">${verdict.result.replace("_", " ")}</td>`;
      return `<tr><td>${index + 1}</td><td>${escape(step.title)}</td><td><span class="kind kind-${step.kind}">${step.kind}</span></td>${cells}<td class="num">${step.durationMs ?? ""}</td></tr>`;
    })
    .join("");
  return `<h4>Steps</h4><div class="scroll"><table class="steps"><thead><tr><th scope="col">#</th><th scope="col">Step</th><th scope="col">Kind</th><th scope="col">Expected</th><th scope="col">Found</th><th scope="col">Verdict</th><th scope="col">ms</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function checksTable(checks: readonly CheckRecord[]): string {
  const rows = checks
    .map((check) => {
      const ok = check.result === "match" || check.result === "skipped";
      const detailRow =
        check.detail === undefined
          ? ""
          : `<tr class="detail-row"><td colspan="4">${escape(check.detail)}</td></tr>`;
      return `<tr><td>${escape(check.title)}</td><td>${escape(check.expected)}</td><td>${escape(check.found)}</td><td class="${ok ? "ok" : "bad"}">${escape(check.result ?? check.status)}</td></tr>${detailRow}`;
    })
    .join("");
  return `<h4>Database</h4><div class="scroll"><table class="checks"><thead><tr><th scope="col">Check</th><th scope="col">Expected</th><th scope="col">Found</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function evidence(
  steps: readonly StepRecord[],
  checks: readonly CheckRecord[],
): string {
  const calls = steps.reduce((sum, step) => sum + step.calls.length, 0);
  const readings =
    steps.reduce((sum, step) => sum + step.readings.length, 0) +
    checks.reduce((sum, check) => sum + check.readings.length, 0);
  const sections = [
    ...steps
      .filter((step) => step.status === "ran")
      .map((step, index) =>
        evidenceOf(`${index + 1}. ${step.title}`, step.calls, step.readings),
      ),
    ...checks.map((check) => evidenceOf(check.title, [], check.readings)),
  ].join("");
  return `<details class="evidence"><summary>Evidence · ${plural(calls, "call")}, ${plural(readings, "reading")}</summary>${sections}</details>`;
}

function evidenceOf(
  title: string,
  calls: readonly CallRecord[],
  readings: readonly ReadingRecord[],
): string {
  if (calls.length === 0 && readings.length === 0) {
    return "";
  }
  return `<section class="ev-step" aria-label="Evidence of ${escape(title)}"><h5>${escape(title)}</h5>${calls.map(call).join("")}${readings.map(reading).join("")}</section>`;
}

function call(record: CallRecord): string {
  const { request, response } = record;
  const headers = Object.entries(request.headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  const body = pretty(request.body);
  const status =
    response === undefined
      ? `<span class="status status-5xx">${escape(record.error)}</span>`
      : `<span class="status status-${Math.floor(response.status / 100)}xx">${response.status}</span>`;
  return `<div class="call"><p class="call-line"><span class="method">${escape(request.method)}</span> ${escape(request.url)} ${status} <span class="muted">attempt ${record.attempt} · ${record.durationMs} ms</span></p><details><summary>Request</summary><pre>${escape(headers)}${body === "" ? "" : `\n\n${escape(body)}`}</pre></details><details><summary>Response</summary><pre>${escape(response === undefined ? record.error : pretty(response.body))}</pre></details></div>`;
}

function reading(record: ReadingRecord): string {
  const content =
    "error" in record
      ? `<p class="bad">${escape(record.error)}</p>`
      : rowsTable(record.rows);
  return `<div class="reading"><p class="call-line"><span class="method db">DB</span> ${escape(record.name)}</p>${content}</div>`;
}

function rowsTable(rows: readonly Record<string, unknown>[]): string {
  const first = rows[0];
  if (first === undefined) {
    return `<p class="muted">No rows</p>`;
  }
  const keys = Object.keys(first);
  const head = keys
    .map((key) => `<th scope="col">${escape(key)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${keys.map((key) => `<td>${escape(row[key])}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<div class="scroll"><table class="rows"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function chip(result: Result): string {
  return `<span class="chip chip-${result}">${resultLabels[result]}</span>`;
}

// A body as it was saved, with its credentials already hidden, laid out to read.
function pretty(body: unknown): string {
  if (body === undefined || body === null || body === "") {
    return "";
  }
  if (typeof body !== "string") {
    return JSON.stringify(body, null, 2);
  }
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

// The time as the run kept it, in the zone where it ran, like 01 Nov 2026, 21:41:10.
function dateOf(timestamp: string): string {
  const [, year, month, day, time] =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/.exec(timestamp) ?? [];
  return year === undefined
    ? timestamp
    : `${day} ${months[Number(month) - 1]} ${year}, ${time}`;
}

function durationOf(run: RunRecord): string {
  if (run.finishedAt === undefined) {
    return "did not finish";
  }
  const seconds = Math.round(
    (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000,
  );
  return `${seconds} s`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

// Everything the run saved is text from outside, like a body PayRef answered, so it is escaped
// before it goes in the page.
function escape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
