import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "./results.ts";

// Every run keeps its own folder, and nothing is ever deleted on its own (RNF-10).
export const runsDirectory = fileURLToPath(
  new URL("../../artifacts/runs/", import.meta.url),
);

export type RunRecord = {
  id: string;
  integration: string;
  region: string;
  environment: string;
  payrefVersion: string;
  status: "running" | "finished" | "interrupted";
  startedAt: string;
  finishedAt?: string;
  // Written before the first case: a case without its file never started.
  selection: string[];
  totals?: Record<Result, number> & { approved: number };
  errors: string[];
};

export function runFile(directory: string): string {
  return join(directory, "run.json");
}

// A test repeated by the run keeps each repetition apart, so a later one never hides a failure.
export function caseName(title: string, repeat: number): string {
  return repeat === 0 ? title : `${title}__repeat-${repeat + 1}`;
}

export function caseFile(directory: string, name: string): string {
  return join(directory, "cases", `${name}.json`);
}

// A file is written whole and then put in place, so a cut never leaves half a file.
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
}

export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}
