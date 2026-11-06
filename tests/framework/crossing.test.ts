import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { casesFor, loadCatalog } from "../../framework/payments/catalog.ts";
import {
  afterOf,
  executeCase,
  planFor,
} from "../../framework/payments/execution.ts";
import { loadIntegration } from "../../framework/payments/integrations.ts";
import type { RunSetup } from "../../framework/payments/run-setup.ts";
import { scripted, temporaryDirectory } from "./builders.ts";

// The catalog crossed with an integration made only of config (US-03, US-13): it builds its
// cases without touching code, and what does not apply to it is not run, with its reason.

// An integration made only of config, in a folder of its own.
function configOnly(config: { id: string } & Record<string, unknown>) {
  const directory = temporaryDirectory();
  mkdirSync(join(directory, config.id));
  writeFileSync(
    join(directory, config.id, "integration.json"),
    JSON.stringify(config),
  );
  return loadIntegration(config.id, pathToFileURL(`${directory}/`));
}

const kioskConfig = {
  id: "kiosk",
  name: "Kiosk",
  region: "mx",
  contract: "standard",
  notice: "together",
  inquiry: false,
  paymentMethod: { id: "kiosk", keyEnv: "MX_KIOSK_KEY" },
  amountLimits: { min: 1, max: 10000 },
  merchant: { id: "merchant-mx-1", keyEnv: "MX_MERCHANT_1_KEY" },
  otherMerchants: {
    "another-merchant": {
      id: "merchant-mx-2",
      keyEnv: "MX_MERCHANT_2_KEY",
    },
  },
};

const kiosk = () => configOnly(kioskConfig);

// Another bank, with a window of its own: 5 minutes instead of 2.
const creditUnion = () =>
  configOnly({
    id: "credit-union",
    name: "Credit union",
    region: "sa",
    contract: "standard",
    notice: "separate",
    inquiry: false,
    paymentMethod: { id: "credit-union", keyEnv: "SA_CREDIT_UNION_KEY" },
    amountLimits: { min: 10, max: 50000 },
    reversalWindow: { minutes: 5 },
    merchant: { id: "merchant-sa-1", keyEnv: "SA_MERCHANT_1_KEY" },
    otherMerchants: {
      "another-merchant": {
        id: "merchant-sa-2",
        keyEnv: "SA_MERCHANT_2_KEY",
      },
    },
  });

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

  it("gives the cases of the window to an integration that turns it on, at the time of its own window", () => {
    const integration = creditUnion();
    const entries = casesFor(integration);
    const window = entries.filter((entry) => entry.case.id.startsWith("F07"));
    expect(window).toHaveLength(24);
    expect(window.every((entry) => entry.notApplicable === undefined)).toBe(
      true,
    );
    const lastTitle = (name: string) => {
      const entry = entries.find((each) => each.name === name);
      if (entry === undefined) {
        throw new Error(`There is no ${name}`);
      }
      return planFor(entry, integration).steps.at(-1)?.title;
    };
    expect(lastTitle("F07-01__credit-union__single-fixed-from-pending")).toBe(
      "The payment method sends the notice, 4:59 after the request",
    );
    expect(lastTitle("F07-03__credit-union__single-fixed-from-pending")).toBe(
      "The payment method reverses the payment, 5:00 after the request",
    );
    expect(afterOf("window-end", integration)).toBe(300_000);
    expect(afterOf("before-window-end", integration)).toBe(299_000);
  });

  it("leaves the window out of an integration without it, and runs its 403 there", () => {
    const entries = casesFor(kiosk());
    const window = entries.filter((entry) => entry.case.id.startsWith("F07"));
    expect(window).toHaveLength(24);
    expect(new Set(window.map((entry) => entry.notApplicable))).toEqual(
      new Set(["Kiosk has no reversal window, so the case does not apply"]),
    );
    const reversal = entries.find((entry) => entry.case.id === "F11-06");
    expect(reversal?.notApplicable).toBeUndefined();
  });

  it("fails a window on an integration that sends its request and its notice together", () => {
    expect(() =>
      configOnly({ ...kioskConfig, reversalWindow: { minutes: 2 } }),
    ).toThrow(
      'the reversal window opens with the request, so it goes with "notice": "separate"',
    );
  });

  it("runs the same case where its step exists", () => {
    const [entry] = casesFor(loadIntegration("supermarket"), [
      endsAtTheInquiry as never,
    ]);
    expect(entry?.notApplicable).toBeUndefined();
  });

  it("applies the whole real catalog, but the window where there is none, the resource where there is none and the 403 where there is", () => {
    const notApplicable = (id: string) =>
      new Map(
        casesFor(loadIntegration(id), loadCatalog())
          .filter((entry) => entry.notApplicable !== undefined)
          .map((entry) => [entry.case.id, entry.notApplicable]),
      );
    const noWebhook = "Bank has no webhook, so the case does not apply";
    expect(notApplicable("bank")).toEqual(
      new Map([
        [
          "F06-04",
          "Bank does not inquire before it pays, so the case does not apply",
        ],
        ["F08-01", noWebhook],
        ["F08-02", noWebhook],
        ["F08-03", noWebhook],
        ["F08-04", noWebhook],
        ["F08-05", noWebhook],
        ["F08-06", noWebhook],
        ["F09-01", "Bank has no payment resource, so the case does not apply"],
        ["F09-02", "Bank has no payment resource, so the case does not apply"],
        ["F10-14", "Bank has no payment resource, so the case does not apply"],
        ["F11-06", "Bank has the reversal, so the case does not apply"],
      ]),
    );
    const supermarket = notApplicable("supermarket");
    expect(
      [...supermarket.keys()].filter((id) => !id.startsWith("F07")),
    ).toEqual([
      "F08-01",
      "F08-02",
      "F08-03",
      "F08-04",
      "F08-05",
      "F08-06",
      "F09-01",
      "F09-02",
      "F10-14",
    ]);
    expect(supermarket.get("F07-01")).toBe(
      "Supermarket has no reversal window, so the case does not apply",
    );
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
        otherMerchants: {},
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
