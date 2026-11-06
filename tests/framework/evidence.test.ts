import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import {
  evidenceGaps,
  Recorder,
  type CaseRecord,
} from "../../framework/engine/evidence.ts";
import { Http, type Transport } from "../../framework/engine/http.ts";
import { maskHeaders } from "../../framework/engine/masking.ts";
import { runCase, type Step } from "../../framework/engine/runner.ts";
import { coreApi } from "../../framework/payments/policies/core.ts";
import { currentRun } from "../../framework/payments/run-setup.ts";
import { playwrightTransport } from "../fixtures/transport.ts";
import { reply, scripted, temporaryDirectory } from "./builders.ts";

// The evidence is compared against what really happened (3.2).

function recorderIn(directory: string): Recorder {
  return new Recorder(join(directory, "case.json"), {
    name: "case",
    integration: "test",
    variation: "base",
    case: {},
  });
}

function httpFor(transport: Transport, recorder: Recorder): Http {
  return new Http({
    transport,
    baseUrl: "http://payref.test",
    recorder,
    retryDelayMs: 0,
  });
}

const saved = (directory: string): CaseRecord =>
  JSON.parse(readFileSync(join(directory, "case.json"), "utf8"));

describe("the evidence", () => {
  it("keeps what happened, with the credentials hidden and the business identifiers visible", async () => {
    const directory = temporaryDirectory();
    const recorder = recorderIn(directory);
    const http = httpFor(
      scripted([
        reply(200, { code: "OK", token: "secret-token" }),
        reply(200, {
          code: "OK",
          folio: "MX-0000000001",
          authorization: "CTSEZE",
        }),
      ]),
      recorder,
    );
    recorder.plan(
      [
        { name: "token", title: "Token", kind: "executes" },
        { name: "payment", title: "Payment", kind: "executes" },
      ],
      [],
    );

    recorder.beginStep(0);
    await http.call(coreApi.token, {
      method: "POST",
      path: "/auth/token",
      body: { key: "secret-key" },
    });
    recorder.endStep();
    recorder.beginStep(1);
    await http.call(coreApi.payment, {
      method: "POST",
      path: "/payments",
      token: "secret-token",
      body: { reference: "12345678901234", amount: 150.5, sequence: "s-1" },
    });
    recorder.endStep();

    const file = readFileSync(join(directory, "case.json"), "utf8");
    expect(file).not.toContain("secret-key");
    expect(file).not.toContain("secret-token");
    const [token, payment] = saved(directory).steps;
    expect(token?.calls[0]?.request.body).toEqual({ key: "[hidden]" });
    expect(token?.calls[0]?.response?.body).toEqual({
      code: "OK",
      token: "[hidden]",
    });
    expect(payment?.calls[0]?.request.headers.authorization).toBe(
      "Bearer [hidden]",
    );
    expect(payment?.calls[0]?.request.body).toEqual({
      reference: "12345678901234",
      amount: 150.5,
      sequence: "s-1",
    });
    expect(payment?.calls[0]?.response?.body).toMatchObject({
      folio: "MX-0000000001",
      authorization: "CTSEZE",
    });
  });

  it("sends the time the case fixes with every call, and keeps it visible", async () => {
    const directory = temporaryDirectory();
    const recorder = recorderIn(directory);
    const transport = scripted([reply(200, { code: "OK" })]);
    const http = new Http({
      transport,
      baseUrl: "http://payref.test",
      recorder,
      testTime: "2026-11-15T23:59:59-06:00",
    });
    recorder.plan(
      [{ name: "inquiry", title: "Inquiry", kind: "executes" }],
      [],
    );
    recorder.beginStep(0);
    await http.call(coreApi.inquiry, { method: "GET", path: "/inquiries/1" });
    recorder.endStep();
    expect(transport.requests[0]?.headers["x-test-time"]).toBe(
      "2026-11-15T23:59:59-06:00",
    );
    expect(saved(directory).steps[0]?.calls[0]?.request.headers).toMatchObject({
      "x-test-time": "2026-11-15T23:59:59-06:00",
    });
  });

  it("sends the time of a call that brings its own, not the one of the case", async () => {
    const directory = temporaryDirectory();
    const recorder = recorderIn(directory);
    const transport = scripted([
      reply(200, { code: "OK" }),
      reply(200, { code: "OK" }),
    ]);
    const http = new Http({
      transport,
      baseUrl: "http://payref.test",
      recorder,
      testTime: "2026-11-20T12:00:00-06:00",
    });
    recorder.plan(
      [{ name: "inquiry", title: "Inquiry", kind: "executes" }],
      [],
    );
    recorder.beginStep(0);
    await http.call(coreApi.inquiry, {
      method: "GET",
      path: "/inquiries/1",
      testTime: "2026-11-15T00:00:00-06:00",
    });
    await http.call(coreApi.inquiry, { method: "GET", path: "/inquiries/1" });
    recorder.endStep();
    expect(
      transport.requests.map((request) => request.headers["x-test-time"]),
    ).toEqual(["2026-11-15T00:00:00-06:00", "2026-11-20T12:00:00-06:00"]);
  });

  it("calls an objective the way the case says: without a token, with another, or with its body cut", async () => {
    const recorder = recorderIn(temporaryDirectory());
    const transport = scripted([
      reply(401, { message: "Missing or invalid token" }),
      reply(403, { message: "This caller cannot use this operation" }),
      reply(400, { message: "Body is not valid JSON" }),
    ]);
    const http = httpFor(transport, recorder);
    recorder.plan(
      [{ name: "payment", title: "Payment", kind: "executes" }],
      [],
    );
    recorder.beginStep(0);
    const call = {
      method: "POST",
      path: "/payments",
      token: "its-own-token",
      body: { reference: "1" },
    } as const;
    await http.with({ token: null }).call(coreApi.payment, call);
    await http.with({ token: "another-token" }).call(coreApi.payment, call);
    await http.with({ breakBody: true }).call(coreApi.payment, call);
    recorder.endStep();
    const [none, another, broken] = transport.requests;
    expect(none?.headers.authorization).toBeUndefined();
    expect(another?.headers.authorization).toBe("Bearer another-token");
    expect(broken?.headers.authorization).toBe("Bearer its-own-token");
    expect(broken?.body).toBe('{"reference":"1"');
  });

  it("sends the bytes the framework built, so the evidence is what traveled", async () => {
    const sent: unknown[] = [];
    const request = {
      fetch: async (_url: string, options: { data?: unknown }) => {
        sent.push(options.data);
        return {
          status: () => 400,
          headers: () => ({}),
          text: async () => "{}",
        };
      },
    } as unknown as APIRequestContext;
    await playwrightTransport(request).send({
      method: "POST",
      url: "http://payref.test/payments",
      headers: { "content-type": "application/json" },
      body: '{"reference":"1"',
    });
    expect(sent[0]).toEqual(Buffer.from('{"reference":"1"'));
  });

  it("hides the Authorization header whatever its case", () => {
    expect(
      maskHeaders({ Authorization: "Bearer abc", "X-Other": "visible" }),
    ).toEqual({ Authorization: "Bearer [hidden]", "X-Other": "visible" });
    expect(maskHeaders({ AUTHORIZATION: "abc" })).toEqual({
      AUTHORIZATION: "[hidden]",
    });
  });

  it("keeps the failure of a step", async () => {
    const directory = temporaryDirectory();
    const recorder = recorderIn(directory);
    const http = httpFor(
      scripted([reply(200, { code: "R-103", message: "expired" })]),
      recorder,
    );
    const payment: Step<object> = {
      name: "payment",
      title: "Payment",
      kind: "executes",
      covers: ["notice"],
      run: () =>
        http.call(coreApi.payment, { method: "POST", path: "/payments" }),
    };
    await runCase(
      {
        steps: [payment],
        objective: { kind: "success" },
        checks: [],
        finalCheck: {
          name: "final",
          title: "Final",
          run: async () => ({ result: "match", readings: [] }),
        },
      },
      {},
      recorder,
    );
    const record = saved(directory);
    expect(record.result).toBe("failed");
    expect(record.steps[0]?.verdict).toEqual({
      result: "mismatch",
      check: "code",
      expected: "OK",
      found: "R-103",
    });
    expect(record.steps[0]?.calls[0]?.response?.status).toBe(200);
  });

  it("keeps every attempt of a retry, and never retries what is not safe to repeat", async () => {
    const directory = temporaryDirectory();
    const recorder = recorderIn(directory);
    recorder.plan(
      [
        { name: "inquiry", title: "Inquiry", kind: "executes" },
        { name: "payment", title: "Payment", kind: "executes" },
      ],
      [],
    );
    const transport = scripted([
      reply(503, "unavailable"),
      reply(200, { code: "OK", reference: "12345678901234" }),
      reply(503, "unavailable"),
    ]);
    const http = httpFor(transport, recorder);

    recorder.beginStep(0);
    await http.call(coreApi.inquiry, { method: "GET", path: "/inquiries/1" });
    recorder.endStep();
    recorder.beginStep(1);
    await http.call(coreApi.payment, { method: "POST", path: "/payments" });
    recorder.endStep();

    const [inquiry, payment] = saved(directory).steps;
    expect(
      inquiry?.calls.map((call) => [call.attempt, call.response?.status]),
    ).toEqual([
      [1, 503],
      [2, 200],
    ]);
    expect(payment?.calls).toHaveLength(1);
    expect(transport.requests).toHaveLength(3);
  });

  it("saves the case after every step, before the next one starts", async () => {
    const directory = temporaryDirectory();
    const recorder = recorderIn(directory);
    let seenBeforeSecondCall: CaseRecord | undefined;
    const answers = [reply(200, { code: "OK" }), reply(200, { code: "R-103" })];
    const transport: Transport = {
      async send() {
        if (answers.length === 1) {
          seenBeforeSecondCall = saved(directory);
        }
        return answers.shift() ?? reply(500, "no answer");
      },
    };
    const http = httpFor(transport, recorder);
    const call = (name: string): Step<object> => ({
      name,
      title: name,
      kind: "executes",
      covers: [name],
      run: () =>
        http.call(
          { ...coreApi.payment, success: { code: "OK", requires: [] } },
          { method: "POST", path: `/${name}` },
        ),
    });
    await runCase(
      {
        steps: [call("first"), call("second")],
        objective: { kind: "code", code: "R-103" },
        checks: [],
        finalCheck: {
          name: "final",
          title: "Final",
          run: async () => ({ result: "match", readings: [] }),
        },
      },
      {},
      recorder,
    );
    expect(seenBeforeSecondCall?.steps[0]?.verdict?.result).toBe("match");
    // The step in progress is saved when it ends.
    expect(seenBeforeSecondCall?.steps[1]?.status).toBe("not_run");
    expect(saved(directory).result).toBe("passed");
  });

  it("marks incomplete a step that is missing its minimum", () => {
    const record = recorderIn(temporaryDirectory()).record;
    record.steps = [
      {
        name: "payment",
        title: "Payment",
        kind: "executes",
        status: "ran",
        calls: [],
        readings: [],
      },
    ];
    expect(evidenceGaps(record)).toEqual([
      "payment: nothing was captured",
      "payment: no verdict",
      "the final database check did not run",
    ]);
  });

  it("takes a captured error and zero rows as evidence too", () => {
    const record = recorderIn(temporaryDirectory()).record;
    const verdict = {
      result: "no_response" as const,
      expected: "OK",
      found: "no response: Timeout 10000ms exceeded.",
    };
    record.steps = [
      {
        name: "inquiry",
        title: "Inquiry",
        kind: "executes",
        status: "ran",
        calls: [
          {
            attempt: 1,
            at: "2026-10-27T10:00:00.000-06:00",
            durationMs: 10_000,
            request: { method: "GET", url: "http://payref.test", headers: {} },
            error: "Timeout 10000ms exceeded.",
          },
        ],
        readings: [],
        verdict,
      },
      {
        name: "notice",
        title: "Notice",
        kind: "observes",
        status: "ran",
        calls: [],
        readings: [{ name: "The movements of the reference", rows: [] }],
        verdict,
      },
      {
        name: "webhook",
        title: "Webhook",
        kind: "observes",
        status: "ran",
        calls: [],
        readings: [],
        verdict,
      },
    ];
    record.finalCheck = {
      name: "final",
      title: "Final",
      status: "ran",
      result: "match",
      readings: [],
    };
    expect(evidenceGaps(record)).toEqual(["webhook: nothing was captured"]);
  });

  it("marks a check without its result and a final check that did not finish", () => {
    const record = recorderIn(temporaryDirectory()).record;
    record.checks = [
      { name: "reference-paid", title: "Paid", status: "ran", readings: [] },
    ];
    record.finalCheck = {
      name: "final",
      title: "Final",
      status: "ran",
      readings: [],
    };
    expect(evidenceGaps(record)).toEqual([
      "reference-paid: no result",
      "the final database check did not finish",
    ]);
  });

  it("says so when the case file could not be saved, and does not approve it", () => {
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});
    const notADirectory = join(temporaryDirectory(), "a-file");
    writeFileSync(notADirectory, "");
    const recorder = new Recorder(join(notADirectory, "case.json"), {
      name: "case",
      integration: "test",
      variation: "base",
      case: {},
    });
    const record = recorder.finish();
    silenced.mockRestore();
    expect(record.approved).toBe(false);
    expect(record.evidence?.missing).toContainEqual(
      expect.stringMatching(/^the case file could not be saved: /),
    );
  });

  it("changes nothing once the case is finished", () => {
    const recorder = recorderIn(temporaryDirectory());
    recorder.plan(
      [{ name: "payment", title: "Payment", kind: "executes" }],
      [{ name: "reference-paid", title: "Paid" }],
    );
    const finished = structuredClone(recorder.finish());
    recorder.beginStep(0);
    recorder.recordCall({
      attempt: 1,
      at: "2026-10-27T10:00:00.000-06:00",
      durationMs: 1,
      request: { method: "POST", url: "http://payref.test", headers: {} },
    });
    recorder.endStep();
    recorder.beginCheck(0);
    recorder.endCheck(0, { result: "mismatch", readings: [] }, 1);
    recorder.beginFinalCheck({ name: "final", title: "Final" });
    recorder.problem({ result: "failed", reason: "too late" });
    expect(recorder.record).toEqual(finished);
  });

  it("does not approve a passed case with incomplete evidence", () => {
    const recorder = recorderIn(temporaryDirectory());
    recorder.plan(
      [{ name: "payment", title: "Payment", kind: "executes" }],
      [],
    );
    recorder.beginStep(0);
    recorder.endStep();
    const record = recorder.finish();
    expect(record).toMatchObject({ result: "passed", approved: false });
    expect(record.evidence?.complete).toBe(false);
  });

  it("keeps the reason of a case that never started", () => {
    const directory = temporaryDirectory();
    recorderIn(directory).notRun("the case does not apply");
    expect(saved(directory)).toMatchObject({
      status: "finished",
      result: "not_run",
      reason: "the case does not apply",
      approved: false,
    });
  });

  it("writes each file whole, without leaving a temporary one", () => {
    const directory = temporaryDirectory();
    const recorder = recorderIn(directory);
    recorder.plan(
      [{ name: "payment", title: "Payment", kind: "executes" }],
      [],
    );
    recorder.finish();
    expect(readdirSync(directory)).toEqual(["case.json"]);
  });

  it("gives every run its own folder, also a run of one case", () => {
    const env = {
      QA_INTEGRATION: "supermarket",
      PAYREF_MX_PORT: "4101",
      MYSQL_PORT: "3307",
      QA_DB_USER: "reader",
      QA_DB_PASSWORD: "password",
      MX_MERCHANT_1_KEY: "merchant-key",
      MX_MERCHANT_2_KEY: "another-merchant-key",
      MX_SUPERMARKET_KEY: "supermarket-key",
    };
    const first = currentRun({
      ...env,
      QA_RUN_STARTED: "2026-10-27T10:00:00.000-06:00",
    });
    const second = currentRun({
      ...env,
      QA_RUN_STARTED: "2026-10-27T10:00:01.000-06:00",
    });
    expect(first.id).toBe("2026-10-27_10-00-00_supermarket_mx_local_1.1");
    expect(second.directory).not.toBe(first.directory);
  });
});
