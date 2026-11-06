import { createServer } from "node:net";
import mysql from "mysql2/promise";
import { casesFor } from "./catalog.ts";
import type { Environment } from "./environment.ts";
import { loadIntegration } from "./integrations.ts";
import { currentRun, type RunSetup } from "./run-setup.ts";

// The quick check before each run (US-06, NFR-11). Each check passes quietly, or throws
// saying what is missing and what to do, so a run never starts half ready.

export function checkConfig(id: string): void {
  casesFor(loadIntegration(id));
}

// On a copy of the variables: the identity of the run is fixed later, by Playwright.
export function checkVariables(id: string, env: NodeJS.ProcessEnv): RunSetup {
  return currentRun({ ...env, QA_INTEGRATION: id });
}

export async function checkDatabase(
  database: Environment["database"],
): Promise<void> {
  const connection = await connectTo(database);
  await connection.end();
}

// The framework only reads (NFR-11). It tries three writes that touch no rows, so nothing
// changes even if the user could write, and each one has to be denied.
const harmlessWrites = [
  "UPDATE movements SET status = status WHERE 1 = 0",
  "INSERT INTO movements SELECT * FROM movements WHERE 1 = 0",
  "DELETE FROM movements WHERE 1 = 0",
];

export async function checkReadOnly(
  database: Environment["database"],
): Promise<void> {
  const connection = await connectTo(database);
  try {
    for (const sql of harmlessWrites) {
      try {
        await connection.query(sql);
      } catch (error) {
        if (
          (error as { code?: string }).code === "ER_TABLEACCESS_DENIED_ERROR"
        ) {
          continue;
        }
        throw new Error(
          `Could not check that the user ${database.user} only reads: ${messageOf(error)}`,
        );
      }
      throw new Error(
        `The user ${database.user} can write in ${database.database}, and the framework must only read. Check its grants in docker/mysql/01-databases-and-users.sh`,
      );
    }
  } finally {
    await connection.end();
  }
}

export function checkPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `The port ${port} is already in use. Is PayRef or the simulated wallet running already? Stop it and run npm test again`,
            )
          : error,
      );
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve());
    });
  });
}

// The last check, once Playwright has started PayRef: it answers, its database too, and it is
// the region and the version the run asked for.
export async function checkPayRef(run: RunSetup): Promise<string> {
  const url = `${run.environment.payrefUrl}/health`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(`PayRef does not answer on ${url}: ${messageOf(error)}`);
  }
  const health: unknown = await response.json().catch(() => undefined);
  const problem = healthProblem(response.status, health, run);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  return `PayRef answers in ${run.integration.region} with version ${run.version}, and so does its database`;
}

// The simulated wallet answers, for an integration that goes through its bridge.
export async function checkWallet(url: string): Promise<string> {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      return "The simulated wallet answers";
    }
    throw new Error(`it answered ${response.status}`);
  } catch (error) {
    throw new Error(
      `The simulated wallet does not answer on ${url}: ${messageOf(error)}`,
    );
  }
}

export function healthProblem(
  status: number,
  health: unknown,
  run: Pick<RunSetup, "integration" | "version">,
): string | undefined {
  const body = health as
    { status?: unknown; region?: unknown; version?: unknown } | undefined;
  if (status !== 200 || body?.status !== "ok") {
    return `PayRef answers, but its database does not (${status} ${JSON.stringify(health)})`;
  }
  if (body.region !== run.integration.region || body.version !== run.version) {
    return `PayRef answers as ${String(body.region)} ${String(body.version)}, and the run asked for ${run.integration.region} ${run.version}`;
  }
  return undefined;
}

async function connectTo(database: Environment["database"]) {
  try {
    return await mysql.createConnection({
      ...database,
      connectTimeout: 5_000,
    });
  } catch (error) {
    throw new Error(
      `The database does not answer on ${database.host}:${database.port} with the user ${database.user}: ${messageOf(error)}`,
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
