import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Recorder } from "../../framework/engine/evidence.ts";
import {
  Http,
  type HttpOutcome,
  type OperationTemplate,
  type Transport,
} from "../../framework/engine/http.ts";
import {
  closeCase,
  runCase,
  type CasePlan,
  type CheckOutcome,
  type DatabaseCheck,
  type Step,
} from "../../framework/engine/runner.ts";
import { UnexpectedResponse } from "../../framework/engine/results.ts";
import { reply, scripted, temporaryDirectory } from "./builders.ts";

// The runner with steps and checks of its own: no PayRef and no database.

const template: OperationTemplate = {
  businessStatus: 200,
  codeField: "code",
  success: { code: "OK", requires: [] },
  codes: { OK: "OK", "R-101": "R-101", "R-103": "R-103" },
  repeatable: false,
};

type Context = { http: Http; ran: string[] };

function step(name: string): Step<Context> {
  return {
    name,
    title: `Step ${name}`,
    kind: "executes",
    covers: [name],
    run: (context) => {
      context.ran.push(name);
      return context.http.call(template, { method: "POST", path: `/${name}` });
    },
  };
}

type Counted = DatabaseCheck<Context> & { runs: number };

function check(name: string, outcome: Omit<CheckOutcome, "readings">): Counted {
  const counted: Counted = {
    name,
    title: `Check ${name}`,
    runs: 0,
    async run() {
      counted.runs += 1;
      return { ...outcome, readings: [{ name: "rows", rows: [] }] };
    },
  };
  return counted;
}

function setup(transport: Transport) {
  const recorder = new Recorder(join(temporaryDirectory(), "case.json"), {
    name: "case",
    integration: "test",
    variation: "base",
    case: {},
  });
  const http = new Http({
    transport,
    baseUrl: "http://payref.test",
    recorder,
    retryDelayMs: 0,
  });
  return { recorder, context: { http, ran: [] } as Context };
}

function plan(
  steps: string[],
  options: { extra?: Counted; final?: Counted } = {},
): CasePlan<Context> {
  return {
    steps: steps.map(step),
    objective: { kind: "code", code: "R-103" },
    checks: options.extra ? [options.extra] : [],
    finalCheck: options.final ?? check("final", { result: "match" }),
  };
}

const ok = reply(200, { code: "OK" });

describe("the runner", () => {
  it("runs the steps to the objective, and only the objective expects its code", async () => {
    const { recorder, context } = setup(
      scripted([ok, ok, reply(200, { code: "R-103" })]),
    );
    const record = await runCase(plan(["a", "b", "c"]), context, recorder);
    expect(context.ran).toEqual(["a", "b", "c"]);
    expect(record).toMatchObject({ result: "passed", approved: true });
  });

  it("lets a step expect what the next one does, and goes on when it comes", async () => {
    const sharing: Step<Context> = {
      ...step("a"),
      expects: (next) => next,
    };
    const casePlan = { ...plan(["a", "b"]), steps: [sharing, step("b")] };
    const rejected = reply(200, { code: "R-103" });

    const both = setup(scripted([rejected, rejected]));
    expect(await runCase(casePlan, both.context, both.recorder)).toMatchObject({
      result: "passed",
    });
    expect(both.context.ran).toEqual(["a", "b"]);

    const first = setup(scripted([ok]));
    expect(
      await runCase(casePlan, first.context, first.recorder),
    ).toMatchObject({ result: "failed", reason: "a: expected R-103, got OK" });
  });

  it("stops at the first problem and marks the steps that never ran", async () => {
    const { recorder, context } = setup(
      scripted([ok, reply(200, { code: "R-101" })]),
    );
    const record = await runCase(plan(["a", "b", "c"]), context, recorder);
    expect(context.ran).toEqual(["a", "b"]);
    expect(record.result).toBe("failed");
    expect(record.reason).toBe("b: expected OK, got R-101");
    expect(record.steps.map((item) => item.status)).toEqual([
      "ran",
      "ran",
      "not_run",
    ]);
  });

  it("after a failure skips the extra checks and still runs the final one, once", async () => {
    const extra = check("extra", { result: "match" });
    const final = check("final", { result: "match" });
    const { recorder, context } = setup(
      scripted([reply(200, { code: "R-101" })]),
    );
    const record = await runCase(
      plan(["a", "b"], { extra, final }),
      context,
      recorder,
    );
    expect(extra.runs).toBe(0);
    expect(final.runs).toBe(1);
    expect(record.checks[0]?.status).toBe("not_run");
    expect(record.finalCheck?.result).toBe("match");
  });

  it("only adds the line of the final check after a failure", async () => {
    const final = check("final", {
      result: "mismatch",
      detail: "MX-0000000001 is confirmed, and the case did not expect it",
    });
    const { recorder, context } = setup(scripted([reply(200, { code: "OK" })]));
    const record = await runCase(plan(["a"], { final }), context, recorder);
    expect(record.reason).toBe("a: expected R-103, got OK");
    expect(record.problems[1]?.reason).toBe(
      "final: MX-0000000001 is confirmed, and the case did not expect it",
    );
  });

  it("runs the extra checks when nothing failed", async () => {
    const extra = check("extra", {
      result: "mismatch",
      expected: "paid",
      found: "active",
    });
    const { recorder, context } = setup(
      scripted([reply(200, { code: "R-103" })]),
    );
    const record = await runCase(plan(["a"], { extra }), context, recorder);
    expect(extra.runs).toBe(1);
    expect(record.reason).toBe("extra: expected paid, got active");
  });

  it("keeps only what the case expected, so a wrong OK does not count for the database", async () => {
    const kept: string[] = [];
    const paying: Step<Context> = {
      ...step("a"),
      keep: () => {
        kept.push("a");
      },
    };
    const runWith = (objective: CasePlan<Context>["objective"]) => {
      const { recorder, context } = setup(
        scripted([reply(200, { code: "OK" })]),
      );
      return runCase(
        {
          steps: [paying],
          objective,
          checks: [],
          finalCheck: check("final", { result: "match" }),
        },
        context,
        recorder,
      );
    };
    const expectedARejection = await runWith({ kind: "code", code: "R-101" });
    expect(expectedARejection.result).toBe("failed");
    expect(kept).toEqual([]);
    await runWith({ kind: "success" });
    expect(kept).toEqual(["a"]);
  });

  it("takes a step that throws as a framework error, and still runs the final check", async () => {
    const final = check("final", { result: "match" });
    const { recorder, context } = setup(scripted([]));
    const record = await runCase(plan(["a"], { final }), context, recorder);
    expect(record.result).toBe("inconclusive");
    expect(record.reason).toBe(
      "framework error: No answer left for POST http://payref.test/a",
    );
    expect(final.runs).toBe(1);
  });

  it("takes a response that does not fit the case as failed, not as an error of the framework", async () => {
    const final = check("final", { result: "match" });
    const { recorder, context } = setup(scripted([reply(200, { code: "OK" })]));
    const withOtherFolio: Step<Context> = {
      ...step("a"),
      keep: () => {
        throw new UnexpectedResponse("answered MX-2, a folio nobody asked for");
      },
    };
    const record = await runCase(
      {
        steps: [withOtherFolio],
        objective: { kind: "success" },
        checks: [],
        finalCheck: final,
      },
      context,
      recorder,
    );
    expect(record.result).toBe("failed");
    expect(record.reason).toBe("a: answered MX-2, a folio nobody asked for");
    expect(final.runs).toBe(1);
  });

  it("closes a case that ran out of time without running the final check twice", async () => {
    let answer: (outcome: HttpOutcome) => void = () => {};
    const waiting: Transport = {
      send: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    };
    const final = check("final", { result: "match" });
    const { recorder, context } = setup(waiting);
    const casePlan = plan(["a", "b"], { final });

    const running = runCase(casePlan, context, recorder);
    const closed = await closeCase(
      casePlan,
      context,
      recorder,
      "the case ran out of time",
    );
    expect(closed).toMatchObject({
      result: "inconclusive",
      reason: "the case ran out of time",
    });

    answer(ok);
    await running;
    expect(final.runs).toBe(1);
    expect(context.ran).toEqual(["a"]);
    expect(recorder.record.result).toBe("inconclusive");
  });
});
