import { describe, expect, it } from "vitest";
import type { JudgeCheck, Verdict } from "../../framework/engine/judge.ts";
import {
  checkProblem,
  decide,
  frameworkProblem,
  stepProblem,
  type Problem,
} from "../../framework/engine/results.ts";

// The decision table of the case result (8.5), row by row.

const mismatch = (found: string, check: JudgeCheck = "code"): Verdict => ({
  result: "mismatch",
  check,
  expected: "R-103",
  found,
  succeeded: false,
});

const resultOf = (...problems: (Problem | undefined)[]) =>
  decide(
    problems.filter((problem) => problem !== undefined),
    [],
  );

describe("the result of a case", () => {
  it("passes when every check passed, also an expected rejection", () => {
    const expectedRejection: Verdict = {
      result: "match",
      expected: "R-103",
      found: "R-103",
      succeeded: false,
    };
    expect(stepProblem("payment", expectedRejection)).toBeUndefined();
    expect(resultOf()).toEqual({
      result: "passed",
      reason: undefined,
      approved: true,
      evidence: { complete: true, missing: [] },
    });
  });

  it("fails another code, another status, an unclassified response or a leak", () => {
    expect(resultOf(stepProblem("payment", mismatch("OK")))).toMatchObject({
      result: "failed",
      reason: "payment: expected R-103, got OK",
    });
    expect(
      resultOf(stepProblem("payment", mismatch("500", "transport"))),
    ).toMatchObject({
      result: "failed",
      reason: "payment: expected R-103, got 500",
    });
    expect(
      resultOf(
        stepProblem(
          "payment",
          mismatch("a stack trace in the response", "leak"),
        ),
      ),
    ).toMatchObject({
      result: "failed",
      reason: "payment: a stack trace in the response",
    });
  });

  it("fails when the database does not match what the API confirmed", () => {
    const problem = checkProblem("final-check", {
      result: "mismatch",
      detail: "MX-0000000001 is confirmed, and the API never confirmed it",
      readings: [],
    });
    expect(resultOf(problem)).toMatchObject({
      result: "failed",
      reason:
        "final-check: MX-0000000001 is confirmed, and the API never confirmed it",
    });
  });

  it("cannot test without a response", () => {
    const noResponse: Verdict = {
      result: "no_response",
      expected: "OK",
      found: "no response: connect ECONNREFUSED 127.0.0.1:4101",
      succeeded: false,
    };
    expect(resultOf(stepProblem("inquiry", noResponse))).toMatchObject({
      result: "inconclusive",
      reason: "inquiry: no response: connect ECONNREFUSED 127.0.0.1:4101",
    });
  });

  it("cannot test when the database does not answer or the run is interrupted", () => {
    const unavailable = checkProblem("final-check", {
      result: "unavailable",
      detail: "connect ECONNREFUSED 127.0.0.1:3307",
      readings: [],
    });
    expect(resultOf(unavailable)).toMatchObject({
      result: "inconclusive",
      reason:
        "final-check: could not read the database (connect ECONNREFUSED 127.0.0.1:3307)",
    });
    expect(
      resultOf({ result: "inconclusive", reason: "the run was interrupted" }),
    ).toMatchObject({ result: "inconclusive" });
  });

  it("cannot test when the framework itself breaks, and never calls it a bug", () => {
    expect(resultOf(frameworkProblem(new TypeError("x is undefined")))).toEqual(
      expect.objectContaining({
        result: "inconclusive",
        reason: "framework error: x is undefined",
      }),
    );
  });

  it("stays failed when the run is interrupted after a failure", () => {
    expect(
      resultOf(stepProblem("payment", mismatch("OK")), {
        result: "inconclusive",
        reason: "the run was interrupted",
      }),
    ).toMatchObject({
      result: "failed",
      reason: "payment: expected R-103, got OK",
    });
  });

  it("does not approve a passed case whose evidence is incomplete", () => {
    expect(decide([], ["payment: no verdict"])).toEqual({
      result: "passed",
      reason: undefined,
      approved: false,
      evidence: { complete: false, missing: ["payment: no verdict"] },
    });
  });

  it("a check that was skipped is not a problem", () => {
    expect(
      checkProblem("final-check", { result: "skipped", readings: [] }),
    ).toBeUndefined();
  });
});
