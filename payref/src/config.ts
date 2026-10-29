import { readFileSync } from "node:fs";

export type Region = "mx" | "sa";
export type Version = "1.0" | "1.1";
export type Mode = "normal" | "test";
export type Operation = "inquiry" | "payment";

export type Config = {
  region: Region;
  version: Version;
  mode: Mode;
  port: number;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
};

export type MerchantConfig = {
  id: string;
  name: string;
  keyEnv: string;
};

export type PaymentMethodConfig = {
  id: string;
  name: string;
  kind: "standard";
  keyEnv: string;
  operations: Operation[];
  amountLimits: { min: number; max: number };
};

export type RegionConfig = {
  region: Region;
  referenceLength: number;
  utcOffset: string;
  decimals: number;
  merchants: MerchantConfig[];
  paymentMethods: PaymentMethodConfig[];
};

// The same code runs once per region: the region picks the port, the database and the rules.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const region = env.REGION;
  if (region !== "mx" && region !== "sa") {
    throw new Error(`REGION must be mx or sa, got "${region ?? ""}"`);
  }

  const version = env.PAYREF_VERSION ?? "1.1";
  if (version !== "1.0" && version !== "1.1") {
    throw new Error(`PAYREF_VERSION must be 1.0 or 1.1, got "${version}"`);
  }

  const mode = env.PAYREF_MODE ?? "normal";
  if (mode !== "normal" && mode !== "test") {
    throw new Error(`PAYREF_MODE must be normal or test, got "${mode}"`);
  }

  return {
    region,
    version,
    mode,
    port: Number(required(env, `PAYREF_${region.toUpperCase()}_PORT`)),
    db: {
      host: "127.0.0.1",
      port: Number(required(env, "MYSQL_PORT")),
      user: required(env, "PAYREF_DB_USER"),
      password: required(env, "PAYREF_DB_PASSWORD"),
      database: `payref_${region}`,
    },
  };
}

export function loadRegion(region: Region): RegionConfig {
  const file = new URL(`../config/${region}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as RegionConfig;
}

export function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}
