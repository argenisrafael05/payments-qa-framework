import { createHmac } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Recorder } from "../../framework/engine/evidence.ts";
import { Http } from "../../framework/engine/http.ts";
import { judge } from "../../framework/engine/judge.ts";
import { verdictOf } from "../../framework/engine/observation.ts";
import {
  walletBridgeApi,
  WalletBridgeApi,
} from "../../framework/integrations/wallet/WalletBridgeApi.ts";
import { casesFor } from "../../framework/payments/catalog.ts";
import { movementsOf } from "../../framework/payments/database/readings.ts";
import { flowOf } from "../../framework/payments/flows/payment.ts";
import { loadIntegration } from "../../framework/payments/integrations.ts";
import { observeWebhook } from "../../framework/payments/steps/third-party.ts";
import { answered, reply, scripted, temporaryDirectory } from "./builders.ts";

// The bridge of the wallet, read with its own template and signed as the wallet would (HU-11).

describe("the bridge of the wallet", () => {
  it("sends the webhook without a signature when it has no key to sign with", async () => {
    const recorder = new Recorder(join(temporaryDirectory(), "case.json"), {
      name: "case",
      integration: "wallet",
      variation: "base",
      case: {},
    });
    const transport = scripted([reply(401, { message: "Unsigned" })]);
    const http = new Http({
      transport,
      baseUrl: "http://payref.test",
      recorder,
    });
    recorder.plan(
      [{ name: "webhook", title: "Webhook", kind: "executes" }],
      [],
    );
    recorder.beginStep(0);
    await new WalletBridgeApi(http).webhook("", {
      resource: "wq_1",
      amount: 150.5,
      paidAt: "2026-11-15T12:00:00-06:00",
    });
    recorder.endStep();
    expect(transport.requests[0]?.headers).not.toHaveProperty(
      "x-wallet-signature",
    );
  });

  it("signs the webhook as the wallet would, over the exact bytes that travel", async () => {
    const recorder = new Recorder(join(temporaryDirectory(), "case.json"), {
      name: "case",
      integration: "wallet",
      variation: "base",
      case: {},
    });
    const transport = scripted([reply(200, { result: "accepted" })]);
    const http = new Http({
      transport,
      baseUrl: "http://payref.test",
      recorder,
    });
    recorder.plan(
      [{ name: "webhook", title: "Webhook", kind: "executes" }],
      [],
    );
    recorder.beginStep(0);
    await new WalletBridgeApi(http).webhook("wallet-key", {
      resource: "wq_1",
      amount: 150.5,
      paidAt: "2026-11-15T12:00:00-06:00",
    });
    recorder.endStep();
    const [request] = transport.requests;
    const signature = createHmac("sha256", "wallet-key")
      .update(request?.body ?? "")
      .digest("hex");
    expect(request?.headers["x-wallet-signature"]).toBe(`sha256=${signature}`);
    // With spaces, so a signature checked over the JSON PayRef read fails.
    expect(request?.body).toContain('"amount": 150.5');
  });

  it("reads the codes of the wallet as the codes of PayRef", () => {
    const answer = (body: object) =>
      answered(walletBridgeApi.webhook, 200, body);
    expect(
      judge(answer({ result: "cancelled", message: "Cancelled" }), {
        kind: "code",
        code: "R-105",
      }),
    ).toMatchObject({ result: "match", found: "R-105" });
    expect(
      judge(
        answer({
          result: "accepted",
          message: "Payment registered",
          folio: "MX-0000000001",
          authorization: "CTSEZE",
        }),
        { kind: "success" },
      ),
    ).toMatchObject({ result: "match", found: "OK" });
    expect(
      judge(answer({ result: "accepted", message: "Payment registered" }), {
        kind: "success",
      }),
    ).toMatchObject({
      result: "mismatch",
      found: "OK without folio and authorization",
    });
  });

  it("asks for the resource and sends the webhook, without a token of its own", () => {
    expect(
      flowOf("payment", loadIntegration("wallet")).map((step) => step.name),
    ).toEqual(["merchant-token", "create-reference", "resource", "webhook"]);
  });

  it("asks the simulated wallet to pay when the wallet sends its own webhook, and observes it", () => {
    const steps = flowOf("payment", loadIntegration("wallet"), {
      source: "third-party",
    });
    expect(steps.at(-1)).toMatchObject({ name: "webhook", kind: "observes" });
  });

  it("runs a case that ends at a notice with both sources, and one that ends before with none", () => {
    const names = (step: string) =>
      casesFor(loadIntegration("wallet"), [
        {
          id: "F99-11",
          title: "Wallet",
          flow: "payment",
          reference: { type: "single", amountType: "fixed" },
          objective: { step, expect: "OK" },
          tags: [],
        } as never,
      ]).map((entry) => entry.name);
    expect(names("notice")).toEqual([
      "F99-11__wallet__single-fixed-by-framework",
      "F99-11__wallet__single-fixed-by-wallet",
    ]);
    expect(names("request")).toEqual(["F99-11__wallet__single-fixed"]);
  });

  describe("the trap of the step that observes", () => {
    // A database where the webhook never shows up: PayRef never kept it.
    const nothingCame = { query: async () => [[]] } as unknown as Pool;

    it("a naive check right after the payment passes a case whose webhook never came, and ours does not", async () => {
      // The naive check: no movement right after telling the wallet the customer paid, which is
      // what a case that expects the webhook to be rejected would look for.
      const { movements } = await movementsOf(nothingCame, "12345678901234");
      expect(movements).toEqual([]);
      const observation = await observeWebhook(nothingCame, "wq_1", 0, {
        timeoutMs: 50,
        everyMs: 10,
      });
      expect(
        verdictOf(observation, { kind: "code", code: "R-105" }),
      ).toMatchObject({ result: "no_response", expected: "R-105" });
      expect(observation.waitedMs).toBeGreaterThanOrEqual(50);
    });

    it("reads the code of the webhook PayRef kept, once it shows up", async () => {
      let asked = 0;
      // The webhook shows up on the third time the framework asks.
      const showsUpLate = {
        query: async () => {
          asked++;
          return [
            asked < 3
              ? []
              : [{ id: 1, resource_id: "wq_1", result: "R-105", folio: null }],
          ];
        },
      } as unknown as Pool;
      const observation = await observeWebhook(showsUpLate, "wq_1", 0, {
        timeoutMs: 1_000,
        everyMs: 10,
      });
      expect(
        verdictOf(observation, { kind: "code", code: "R-105" }),
      ).toMatchObject({ result: "match", found: "R-105" });
      expect(asked).toBe(3);
    });
  });

  it("runs the real catalog on the wallet, but the window and what needs a token of its own", () => {
    const reasons = new Map(
      casesFor(loadIntegration("wallet"))
        .filter((entry) => entry.notApplicable !== undefined)
        .map((entry) => [entry.case.id, entry.notApplicable]),
    );
    expect([...reasons.keys()].filter((id) => !id.startsWith("F07"))).toEqual([
      "F06-04",
      "F08-04",
      "F08-05",
      "F08-06",
      "F11-04",
      "F11-06",
    ]);
    // What the wallet cannot send by itself only runs with the framework as its source.
    expect(reasons.get("F08-04")).toBe(
      "Wallet cannot send a webhook without its signature, so the case does not apply",
    );
    expect(reasons.get("F11-04")).toBe(
      "Wallet has no token of its own, it signs, so the case does not apply",
    );
    expect(reasons.get("F07-01")).toBe(
      "Wallet has no reversal window, so the case does not apply",
    );
  });

  it("pays twice with the same webhook again, or with another resource and its webhook", () => {
    const wallet = loadIntegration("wallet");
    const lastSteps = (secondSequence: "same" | "new") =>
      flowOf("payment-twice", wallet, { secondSequence })
        .map((step) => step.name)
        .slice(2);
    expect(lastSteps("same")).toEqual([
      "resource",
      "webhook",
      "second-webhook",
    ]);
    expect(lastSteps("new")).toEqual([
      "resource",
      "webhook",
      "second-resource",
      "second-webhook",
    ]);
  });

  it("asks for the resource of a code nobody created as the merchant, and pays first before a transition from paid", () => {
    const wallet = loadIntegration("wallet");
    expect(
      flowOf("unknown-reference", wallet).map((step) => step.name),
    ).toEqual(["merchant-token", "resource", "webhook"]);
    expect(
      flowOf("transition", wallet, {
        transition: { from: "paid", event: "view" },
      }).map((step) => step.name),
    ).toEqual([
      "merchant-token",
      "create-reference",
      "resource-first",
      "webhook-first",
      "view",
    ]);
  });
});
