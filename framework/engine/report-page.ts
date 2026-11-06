// The look of the report, approved on a simulation with the data of a real run: the dark
// background and the one orange of the portfolio site, the summary first and every test open
// down to its evidence (US-05).

export const reportStyles = `
:root {
  --bg: #080b12; --panel: #0f1420; --panel-2: #141b2a; --line: #232c3f;
  --text: #e8ecf3; --muted: #8b95a8; --accent: #ED6F1C;
  --passed: #3fb27f; --failed: #e5534b; --inconclusive: #d9a440; --not_run: #7d8799;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 64px; }
h1, h2, h3 { font-family: Montserrat, Inter, system-ui, sans-serif; font-weight: 900; letter-spacing: -0.01em; margin: 0; }
.eyebrow { color: var(--accent); font-weight: 700; margin: 0 0 6px; letter-spacing: .04em; }
h1 { font-size: 34px; }
.lead { color: var(--muted); margin: 6px 0 0; font-size: 17px; }
.lead strong { color: var(--text); }
section { margin-top: 36px; }
h2 { font-size: 20px; margin-bottom: 14px; }
.context { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0; }
.context div { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.context dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.context dd { margin: 2px 0 0; font-weight: 600; }
.totals { list-style: none; padding: 0; margin: 14px 0 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.totals li { background: var(--panel); border: 1px solid var(--line); border-top: 4px solid var(--c); border-radius: 10px; padding: 14px; }
.totals .n { font-size: 30px; font-weight: 800; display: block; }
.totals .l { color: var(--muted); }
.note { color: var(--muted); margin: 12px 0 0; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.filter { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; cursor: pointer; font: inherit; }
.filter.active { border-color: var(--accent); color: var(--accent); }
.filter .count { color: var(--muted); margin-left: 4px; }
ol { list-style: none; padding: 0; margin: 0; }
.group { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 10px; }
.group > details > summary { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; flex-wrap: wrap; }
summary { list-style: none; }
summary::-webkit-details-marker { display: none; }
.cid { font-weight: 800; color: var(--accent); min-width: 56px; }
.gtitle { flex: 1 1 320px; }
.gcounts { display: flex; gap: 6px; flex-wrap: wrap; }
.mini { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--panel-2); color: var(--muted); }
.mini-failed { color: var(--failed); } .mini-inconclusive { color: var(--inconclusive); } .mini-passed { color: var(--passed); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); flex: none; }
.dot-passed { --c: var(--passed); } .dot-failed { --c: var(--failed); } .dot-inconclusive { --c: var(--inconclusive); } .dot-not_run { --c: var(--not_run); }
.tests { border-top: 1px solid var(--line); }
.test > details > summary { display: flex; align-items: center; gap: 10px; padding: 9px 16px 9px 38px; cursor: pointer; flex-wrap: wrap; border-top: 1px solid var(--line); }
.test:first-child > details > summary { border-top: 0; }
.variation { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.test-reason { color: var(--muted); font-size: 13px; flex: 1 1 260px; }
.ms { color: var(--muted); font-size: 12px; margin-left: auto; }
.chip { font-size: 12px; font-weight: 700; padding: 2px 9px; border-radius: 6px; background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); min-width: 92px; text-align: center; }
.chip-passed { --c: var(--passed); } .chip-failed { --c: var(--failed); } .chip-inconclusive { --c: var(--inconclusive); } .chip-not_run { --c: var(--not_run); }
.test-body { padding: 4px 16px 18px 38px; }
.test-name code { color: var(--muted); font-size: 12px; }
.reason { background: color-mix(in srgb, var(--failed) 12%, transparent); border-left: 3px solid var(--failed); padding: 8px 12px; border-radius: 6px; }
.reason strong { margin-right: 8px; }
.evidence-state { color: var(--muted); font-size: 13px; }
h4 { margin: 16px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
h5 { margin: 14px 0 6px; font-size: 14px; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
td.num { text-align: right; color: var(--muted); }
td.ok { color: var(--passed); font-weight: 600; } td.bad { color: var(--failed); font-weight: 600; }
.detail-row td { color: var(--failed); font-size: 12px; }
.kind { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.kind-observes { border-color: var(--accent); color: var(--accent); }
.evidence { margin-top: 16px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; }
.evidence > summary { cursor: pointer; font-weight: 700; }
.call, .reading { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin: 8px 0; background: var(--bg); }
.call-line { margin: 0 0 4px; font-size: 13px; word-break: break-all; }
.method { font-weight: 800; color: var(--accent); margin-right: 6px; } .method.db { color: #6aa9ff; }
.status { font-weight: 700; margin-left: 6px; } .status-2xx { color: var(--passed); } .status-4xx, .status-5xx { color: var(--failed); }
.call details summary { cursor: pointer; color: var(--muted); font-size: 13px; }
pre { background: #05070c; border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow-x: auto; font-size: 12px; margin: 6px 0; }
.rows td, .rows th { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: nowrap; }
.muted { color: var(--muted); }
footer { margin-top: 40px; color: var(--muted); font-size: 13px; }
footer a { color: var(--accent); }
[hidden] { display: none !important; }
@media (max-width: 720px) { .totals { grid-template-columns: repeat(2, 1fr); } .test > details > summary, .test-body { padding-left: 16px; } }
`;

// The filters by result. A group stays visible while one of its tests is.
export const reportScript = `
const buttons = document.querySelectorAll(".filter");
buttons.forEach((button) => button.addEventListener("click", () => {
  const filter = button.dataset.filter;
  buttons.forEach((each) => { each.classList.toggle("active", each === button); each.setAttribute("aria-pressed", String(each === button)); });
  document.querySelectorAll(".test").forEach((test) => { test.hidden = filter !== "all" && test.dataset.result !== filter; });
  document.querySelectorAll(".group").forEach((group) => {
    const visible = group.querySelectorAll(".test:not([hidden])").length;
    group.hidden = visible === 0;
    if (filter !== "all" && visible > 0) group.querySelector("details").open = true;
  });
}));
`;
