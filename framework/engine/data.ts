import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Cases and configs are data, validated when they load, so a typo fails before anything runs
// and the message says which file and which field.
export function loadData<T>(file: URL, schema: z.ZodType<T>): T {
  const name = relative(root, fileURLToPath(file));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} could not be read: ${message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${name} is not valid:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
