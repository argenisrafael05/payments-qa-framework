import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { writeReport } from "../framework/engine/report.ts";
import { runsDirectory } from "../framework/engine/run-files.ts";

// npm run report [-- <run folder>]: writes the report of a run again, from what it saved
// (HU-05). Without a folder, it takes the last run.
const given = process.argv[2];
const runs = readdirSync(runsDirectory).sort();
const last = runs.at(-1);
if (given === undefined && last === undefined) {
  console.error("There are no runs yet. Run npm test first");
  process.exit(1);
}
const directory =
  given === undefined ? join(runsDirectory, last ?? "") : resolve(given);
try {
  const file = writeReport(directory);
  console.log(`  Report: ${relative(process.cwd(), file)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
