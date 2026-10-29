import { describe, expect, it } from "vitest";
import type {
  Exchange,
  OperationTemplate,
} from "../../framework/engine/http.ts";
import { judge, type Expectation } from "../../framework/engine/judge.ts";
import { findLeak } from "../../framework/engine/leaks.ts";
import { coreApi } from "../../framework/payments/policies/core.ts";
import { answered, unanswered } from "./builders.ts";

// The judge alone, without HTTP: a response, its template and what the step expects (3.2).

const success: Expectation = { kind: "success" };
const code = (value: string): Expectation => ({ kind: "code", code: value });
const status = (value: number): Expectation => ({
  kind: "status",
  status: value,
});

const payment = (httpStatus: number, body: unknown): Exchange =>
  answered(coreApi.payment, httpStatus, body);

const paid = {
  code: "OK",
  message: "Payment registered",
  folio: "MX-0000000001",
  authorization: "CTSEZE",
};
const expired = { code: "R-103", message: "The reference is expired" };
const stackTrace = JSON.stringify({
  message:
    "Error: boom\n    at registerPayment (/srv/payref/src/payments.ts:42:11)",
});

describe("the judge", () => {
  it("passes the exact result", () => {
    expect(judge(payment(200, paid), success)).toMatchObject({
      result: "match",
      expected: "OK",
      found: "OK",
      succeeded: true,
    });
  });

  it("passes the rejection the case expected", () => {
    expect(judge(payment(200, expired), code("R-103"))).toMatchObject({
      result: "match",
      found: "R-103",
    });
  });

  it("fails another rejection", () => {
    const cancelled = { code: "R-105", message: "The reference is cancelled" };
    expect(judge(payment(200, cancelled), code("R-103"))).toMatchObject({
      result: "mismatch",
      check: "code",
      expected: "R-103",
      found: "R-105",
    });
  });

  it("fails a code that is not in the dictionary as an unclassified response", () => {
    expect(judge(payment(200, { code: "X-77" }), code("R-103"))).toMatchObject({
      result: "mismatch",
      check: "unclassified",
      found: "an unclassified response (X-77)",
    });
    expect(judge(payment(200, { message: "done" }), success)).toMatchObject({
      check: "unclassified",
      found: "an unclassified response (no code)",
    });
  });

  it("takes what is not JSON as a technical error, never as a rejection", () => {
    expect(
      judge(payment(200, "<html>Bad gateway</html>"), code("R-103")),
    ).toMatchObject({
      result: "mismatch",
      check: "format",
      found: "a response that is not JSON",
    });
  });

  it("fails a leak even when the expected code came", () => {
    expect(judge(payment(400, stackTrace), status(400))).toMatchObject({
      result: "mismatch",
      check: "leak",
      found: "a stack trace in the response",
    });
    const withSql = {
      ...expired,
      detail: "Unknown column 'expires_at' in 'where clause'",
    };
    expect(judge(payment(200, withSql), code("R-103"))).toMatchObject({
      check: "leak",
      found: "SQL in the response",
    });
  });

  it("fails a 500 the system answered, and cannot test a timeout or a 503", () => {
    const technical = { code: "R-199", message: "Technical error" };
    expect(judge(payment(500, technical), code("R-103"))).toMatchObject({
      result: "mismatch",
      check: "transport",
      expected: "R-103",
      found: "500",
    });
    expect(
      judge(
        unanswered(coreApi.payment, "Timeout 10000ms exceeded."),
        code("R-103"),
      ),
    ).toMatchObject({
      result: "no_response",
      found: "no response: Timeout 10000ms exceeded.",
    });
    expect(judge(payment(503, "unavailable"), code("R-103"))).toMatchObject({
      result: "no_response",
      found: "503 from the gateway",
    });
  });

  it("needs every condition of a success", () => {
    const withoutAuthorization = { code: "OK", folio: "MX-0000000001" };
    expect(judge(payment(200, withoutAuthorization), success)).toMatchObject({
      result: "mismatch",
      check: "success",
      found: "OK without authorization",
      succeeded: false,
    });
  });

  it("compares an expected status exactly", () => {
    const invalidToken = { message: "Missing or invalid token" };
    expect(judge(payment(401, invalidToken), status(401))).toMatchObject({
      result: "match",
      found: "401",
    });
    expect(judge(payment(200, paid), status(401))).toMatchObject({
      result: "mismatch",
      check: "transport",
      expected: "401",
      found: "200",
    });
  });

  it("compares the state the response reports when the step expects one", () => {
    const view = (status: string) =>
      answered(coreApi.viewReference, 200, {
        code: "OK",
        reference: "12345678901234",
        status,
      });
    expect(
      judge(view("expired"), { kind: "success", state: "expired" }),
    ).toMatchObject({ result: "match", found: "OK (expired)" });
    expect(
      judge(view("paid"), { kind: "success", state: "active" }),
    ).toMatchObject({
      result: "mismatch",
      check: "state",
      expected: "OK (active)",
      found: "OK (paid)",
    });
  });

  it("never compares the message", () => {
    const verdictFor = (message: string) => {
      const { result, expected, found } = judge(
        payment(200, { code: "R-103", message }),
        code("R-103"),
      );
      return { result, expected, found };
    };
    expect(verdictFor("Something else entirely")).toEqual(
      verdictFor("The reference is expired"),
    );
    expect(verdictFor("Something else entirely").result).toBe("match");
  });

  it("reads another API with its own template, without an if per API", () => {
    const otherApi: OperationTemplate = {
      businessStatus: 200,
      codeField: "result",
      success: { code: "00", requires: ["id"] },
      codes: { "00": "OK", EXP: "R-103" },
      repeatable: false,
    };
    expect(
      judge(answered(otherApi, 200, { result: "EXP" }), code("R-103")),
    ).toMatchObject({ result: "match", found: "R-103" });
    expect(
      judge(answered(otherApi, 200, { result: "00", id: "7" }), success),
    ).toMatchObject({ result: "match", found: "OK" });
  });

  describe("the trap of the 200", () => {
    // A naive judge, like the ones that only look at the status.
    const naive = (exchange: Exchange) =>
      exchange.outcome.response?.status === 200;

    it("a naive judge passes a rejection that came with a 200, and ours does not", () => {
      const rejected = payment(200, expired);
      expect(naive(rejected)).toBe(true);
      expect(judge(rejected, success)).toMatchObject({
        result: "mismatch",
        check: "code",
        expected: "OK",
        found: "R-103",
      });
    });
  });
});

describe("the leaks", () => {
  it("finds what a response must never show", () => {
    expect(findLeak(stackTrace)).toBe("a stack trace");
    expect(findLeak("ER_DUP_ENTRY: Duplicate entry 'MX-1'")).toBe("SQL");
    expect(findLeak("SELECT code FROM payment_references WHERE code = ?")).toBe(
      "SQL",
    );
    expect(findLeak("cannot read /home/payref/config/mx.json")).toBe(
      "an internal path",
    );
    expect(findLeak('{"code":"FST_ERR_VALIDATION"}')).toBe(
      "an internal error code",
    );
  });

  it("does not take a normal message for a leak", () => {
    for (const message of [
      "body must have required property 'amount'",
      "The reversal window closed at 10:30:00",
      "Please select a payment method from the list",
      "The reference is expired",
    ]) {
      expect(findLeak(JSON.stringify({ message }))).toBeUndefined();
    }
  });
});
