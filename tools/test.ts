import { spawnSync } from "node:child_process";
import { loadEnvFiles } from "../framework/payments/environment.ts";
import { listIntegrations } from "../framework/payments/integrations.ts";
import {
  checkConfig,
  checkDatabase,
  checkPortFree,
  checkReadOnly,
  checkVariables,
} from "../framework/payments/preflight.ts";
import type { RunSetup } from "../framework/payments/run-setup.ts";

// npm test [-- <integration>... <Playwright options>]: one run per integration, one after the
// other. The names come first, and from the first option on, everything goes to
// Playwright as it is, like --grep @smoke. Each run starts with the quick check.
loadEnvFiles();
const integrations = listIntegrations();
const selected: string[] = [];
const playwrightArgs: string[] = [];
let version = "1.1";

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? "";
  if (arg === "--payref") {
    version = args[++i] ?? version;
  } else if (playwrightArgs.length > 0 || arg.startsWith("-")) {
    playwrightArgs.push(arg);
  } else if (integrations.includes(arg)) {
    selected.push(arg);
  } else {
    console.error(
      `There is no integration "${arg}". The ones there are: ${integrations.join(", ")}`,
    );
    process.exit(1);
  }
}

let databaseStarted = false;

// Docker and the database go up if they are not, and they stay up for the next run.
function startDatabase(): void {
  if (databaseStarted) {
    return;
  }
  const result = spawnSync("docker", ["compose", "up", "--wait"], {
    encoding: "utf8",
  });
  if (result.error !== undefined || result.status !== 0) {
    const detail = result.stderr?.trim();
    throw new Error(
      `Docker is not running, or the database did not start. Open Docker Desktop and run npm test again${detail ? `\n${detail}` : ""}`,
    );
  }
  databaseStarted = true;
}

// What failed in one integration, like its config, its key or its port, only stops its run.
// What failed in Docker or the database stops them all.
async function preflight(id: string): Promise<"ready" | "skip" | "stop"> {
  console.log(`\nPreflight · ${id}`);
  let run: RunSetup | undefined;
  const environment = () => {
    if (run === undefined) {
      throw new Error("The variables of the run were not checked");
    }
    return run.environment;
  };
  const checks: [string, "run" | "all", () => unknown][] = [
    ["Docker is running and the database is up", "all", startDatabase],
    ["The catalog and the config are valid", "run", () => checkConfig(id)],
    [
      "The variables of the run are set",
      "run",
      () => {
        run = checkVariables(id, { ...process.env, PAYREF_VERSION: version });
      },
    ],
    [
      "The database answers with the framework's user",
      "all",
      () => checkDatabase(environment().database),
    ],
    [
      "The framework's database user can only read",
      "all",
      () => checkReadOnly(environment().database),
    ],
    [
      "The port of PayRef is free",
      "run",
      () => checkPortFree(Number(new URL(environment().payrefUrl).port)),
    ],
  ];
  for (const [text, stops, check] of checks) {
    try {
      await check();
      console.log(`  ✓ ${text}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const indented = message.replaceAll("\n", "\n    ");
      console.log(`  ✗ ${indented}\n\n  The run did not start.`);
      return stops === "all" ? "stop" : "skip";
    }
  }
  return "ready";
}

let failed = false;
for (const integration of selected.length > 0 ? selected : integrations) {
  const state = await preflight(integration);
  if (state === "stop") {
    process.exit(1);
  }
  if (state === "skip") {
    failed = true;
    continue;
  }
  const run = spawnSync("npx", ["playwright", "test", ...playwrightArgs], {
    stdio: "inherit",
    env: {
      ...process.env,
      QA_INTEGRATION: integration,
      PAYREF_VERSION: version,
    },
  });
  failed ||= run.status !== 0;
}
process.exit(failed ? 1 : 0);
