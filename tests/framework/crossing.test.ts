import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { casesFor, loadCatalog } from "../../framework/payments/catalog.ts";
import { executeCase } from "../../framework/payments/execution.ts";
import { loadIntegration } from "../../framework/payments/integrations.ts";
import type { RunSetup } from "../../framework/payments/run-setup.ts";
import { scripted, temporaryDirectory } from "./builders.ts";

// The catalog crossed with an integration made only of config (HU-03, HU-13): it builds its
// cases without touching code, and what does not apply to it is not run, with its reason.

function kiosk() {
  const directory = temporaryDirectory();
  mkdirSync(join(directory, "kiosk"));
  writeFileSync(
    join(directory, "kiosk", "integration.json"),
    JSON.stringify({
      id: "kiosk",
      name: "Kiosk",
      region: "mx",
      contract: "standard",
      notice: "together",
      inquiry: false,
      paymentMethod: { id: "kiosk", keyEnv: "MX_KIOSK_KEY" },
    }),
  );
  return loadIntegration("kiosk", pathToFileURL(`${directory}/`));
}

const endsAtTheInquiry = {
  id: "F02-09",
  title: "The inquiry of a code nobody created answers R-101",
  flow: "unknown-reference",
  code: "00000000000000",
  amount: 150.5,
  objective: { step: "inquiry", expect: "R-101" },
  tags: [],
};

describe("the catalog crossed with each integration", () => {
  it("builds the cases of an integration made only of config", () => {
    const names = casesFor(kiosk()).map((entry) => entry.name);
    expect(names).toContain("F01-01__kiosk__single-fixed");
    expect(names.length).toBe(casesFor(loadIntegration("supermarket")).length);
  });

  it("does not run a case whose step its integration does not have, and says why", () => {
    const [entry] = casesFor(kiosk(), [endsAtTheInquiry as never]);
    expect(entry?.notApplicable).toBe(
      "Kiosk does not inquire before it pays, so the case does not apply",
    );
  });

  it("runs the same case where its step exists", () => {
    const [entry] = casesFor(loadIntegration("supermarket"), [
      endsAtTheInquiry as never,
    ]);
    expect(entry?.notApplicable).toBeUndefined();
  });

  it("applies the whole real catalog to the supermarket", () => {
    expect(
      casesFor(loadIntegration("supermarket"), loadCatalog()).filter(
        (entry) => entry.notApplicable !== undefined,
      ),
    ).toEqual([]);
  });

  it("leaves the file of a case that does not apply, with its reason", async () => {
    const integration = kiosk();
    const [entry] = casesFor(integration, [endsAtTheInquiry as never]);
    const run = {
      id: "run",
      directory: temporaryDirectory(),
      startedAt: "2026-10-28T10:00:00.000-06:00",
      integration,
      environment: {
        name: "local",
        payrefUrl: "http://payref.test",
        database: {
          host: "127.0.0.1",
          port: 3307,
          user: "reader",
          password: "password",
          database: "payref_mx",
        },
        merchant: { id: "merchant-mx-1", key: "merchant-key" },
        paymentMethod: { id: "kiosk", key: "kiosk-key" },
      },
      version: "1.1",
    } satisfies RunSetup;
    const execution = executeCase({
      entry: entry as never,
      run,
      db: {} as Pool,
      transport: scripted([]),
    });
    expect(await execution.done).toMatchObject({
      result: "not_run",
      reason:
        "Kiosk does not inquire before it pays, so the case does not apply",
    });
  });
});
