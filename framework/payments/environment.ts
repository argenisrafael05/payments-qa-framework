import { existsSync } from "node:fs";
import type { Integration } from "./integrations.ts";
import { regions } from "./regions.ts";

const root = new URL("../../", import.meta.url);

// The values of .env win, and .env.example fills in the rest, the same as PayRef (RE-16). A
// variable that already comes from the shell wins over both.
export function loadEnvFiles(): void {
  for (const name of [".env", ".env.example"]) {
    const file = new URL(name, root);
    if (existsSync(file)) {
      process.loadEnvFile(file);
    }
  }
}

export type Environment = {
  name: string;
  payrefUrl: string;
  // The simulated wallet, for an integration that goes through its bridge.
  walletUrl?: string;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  // Each role with its id in PayRef, to read its database, and its key. The other merchants go
  // by the alias the cases call them.
  merchant: Role;
  otherMerchants: Record<string, Role>;
  paymentMethod: Role;
};

export type Role = { id: string; key: string };

// PayRef only runs on this machine, so the environment is always the local one. The region
// resolves the connections, and the integration brings who takes part, each with its key.
export function resolveEnvironment(
  integration: Integration,
  env: NodeJS.ProcessEnv = process.env,
): Environment {
  const region = regions[integration.region];
  return {
    name: "local",
    payrefUrl: `http://127.0.0.1:${required(env, region.portEnv)}`,
    ...(integration.contract === "wallet-bridge"
      ? { walletUrl: `http://127.0.0.1:${required(env, "WALLET_PORT")}` }
      : {}),
    database: {
      host: "127.0.0.1",
      port: Number(required(env, "MYSQL_PORT")),
      user: required(env, "QA_DB_USER"),
      password: required(env, "QA_DB_PASSWORD"),
      database: region.database,
    },
    merchant: roleOf(integration.merchant, env),
    otherMerchants: Object.fromEntries(
      Object.entries(integration.otherMerchants ?? {}).map(
        ([alias, merchant]) => [alias, roleOf(merchant, env)],
      ),
    ),
    paymentMethod: roleOf(integration.paymentMethod, env),
  };
}

function roleOf(
  role: { id: string; keyEnv: string },
  env: NodeJS.ProcessEnv,
): Role {
  return { id: role.id, key: required(env, role.keyEnv) };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Set it in .env, as .env.example shows`,
    );
  }
  return value;
}
