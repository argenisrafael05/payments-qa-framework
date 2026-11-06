import { join } from "node:path";
import { runsDirectory } from "../engine/run-files.ts";
import { localTimestamp } from "../engine/time.ts";
import { resolveEnvironment, type Environment } from "./environment.ts";
import { loadIntegration, type Integration } from "./integrations.ts";

export type RunSetup = {
  id: string;
  directory: string;
  startedAt: string;
  integration: Integration;
  environment: Environment;
  version: "1.0" | "1.1";
};

// One run is one integration (US-01). Its identity is fixed once, in the main process, and it
// reaches the workers through the environment, so every piece writes in the same folder.
export function currentRun(env: NodeJS.ProcessEnv = process.env): RunSetup {
  const id = env.QA_INTEGRATION;
  if (!id) {
    throw new Error("QA_INTEGRATION is missing: run the cases with npm test");
  }
  const version = env.PAYREF_VERSION ?? "1.1";
  if (version !== "1.0" && version !== "1.1") {
    throw new Error(`PAYREF_VERSION must be 1.0 or 1.1, got "${version}"`);
  }
  const integration = loadIntegration(id);
  const environment = resolveEnvironment(integration, env);

  env.QA_RUN_STARTED ??= localTimestamp();
  const startedAt = env.QA_RUN_STARTED;
  const time = startedAt.slice(0, 19).replace("T", "_").replaceAll(":", "-");
  const runId = `${time}_${integration.id}_${integration.region}_${environment.name}_${version}`;
  return {
    id: runId,
    directory: join(runsDirectory, runId),
    startedAt,
    integration,
    environment,
    version,
  };
}
