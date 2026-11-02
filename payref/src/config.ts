import { readFileSync } from "node:fs";

export type Region = "mx" | "sa";
export type Version = "1.0" | "1.1";
export type Mode = "normal" | "test";
export type Operation =
  "inquiry" | "payment" | "request" | "notice" | "reversal";

export type Config = {
  region: Region;
  version: Version;
  mode: Mode;
  // The bugs that are on: all of them in the 1.0, none in the 1.1.
  bugs: ReadonlySet<number>;
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

// A standard payment method exchanges its key for a token. A third party, like the wallet,
// signs with its key instead, and PayRef calls its API, which runs on this machine (HU-11).
export type PaymentMethodConfig = {
  id: string;
  name: string;
  kind: "standard" | "third-party";
  keyEnv: string;
  portEnv?: string;
  operations: Operation[];
  amountLimits: { min: number; max: number };
  // The reversal window of a bank: its request leaves the payment pending, and the notice
  // confirms it, or the reversal undoes it, until the window ends (HU-10).
  reversalWindow?: { minutes: number };
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
    bugs: bugsOf(env.PAYREF_BUGS, version),
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

// The 1.0 comes with its bugs, like a release. PAYREF_BUGS turns on only the ones it lists,
// like PAYREF_BUGS=2, to look at one bug at a time.
function bugsOf(
  value: string | undefined,
  version: Version,
): ReadonlySet<number> {
  if (!value) {
    return new Set(version === "1.0" ? [1, 2, 3, 4, 5, 6, 7, 8] : []);
  }
  const bugs = value.split(",").map((item) => Number(item.trim()));
  if (bugs.some((bug) => !Number.isInteger(bug) || bug < 1 || bug > 8)) {
    throw new Error(
      `PAYREF_BUGS must list bugs from 1 to 8, like 2,3, got "${value}"`,
    );
  }
  return new Set(bugs);
}

export function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}
