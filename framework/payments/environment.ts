import { existsSync } from "node:fs";
import type { Integration } from "./integrations.ts";

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

// What the framework knows of each region of PayRef: where it answers, its database and the
// merchant it uses.
const regions = {
  mx: {
    portEnv: "PAYREF_MX_PORT",
    database: "payref_mx",
    merchant: { id: "merchant-mx-1", keyEnv: "MX_MERCHANT_1_KEY" },
  },
} as const;

export type Environment = {
  name: string;
  payrefUrl: string;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  // Each role with its id in PayRef, to read its database, and its key.
  merchant: { id: string; key: string };
  paymentMethod: { id: string; key: string };
};

// PayRef only runs on this machine, so the environment is always the local one. The region
// resolves the connections and the merchant, and the integration only brings its own key.
export function resolveEnvironment(
  integration: Integration,
  env: NodeJS.ProcessEnv = process.env,
): Environment {
  const region = regions[integration.region];
  return {
    name: "local",
    payrefUrl: `http://127.0.0.1:${required(env, region.portEnv)}`,
    database: {
      host: "127.0.0.1",
      port: Number(required(env, "MYSQL_PORT")),
      user: required(env, "QA_DB_USER"),
      password: required(env, "QA_DB_PASSWORD"),
      database: region.database,
    },
    merchant: {
      id: region.merchant.id,
      key: required(env, region.merchant.keyEnv),
    },
    paymentMethod: {
      id: integration.paymentMethod.id,
      key: required(env, integration.paymentMethod.keyEnv),
    },
  };
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
