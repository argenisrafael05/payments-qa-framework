import { isGatewayStatus, type Exchange, type JsonObject } from "./http.ts";
import { findLeak } from "./leaks.ts";

// What a step expects: a success, an exact business code or an exact HTTP status. The steps
// before the objective only expect a success (3.1).
export type Expectation =
  | { kind: "success"; state?: string }
  | { kind: "code"; code: string }
  | { kind: "status"; status: number };

// The piece that decided, in the order the judge reads a response.
export type JudgeCheck =
  | "leak"
  | "transport"
  | "format"
  | "success"
  | "state"
  | "code"
  | "unclassified";

// What the response says, apart from the verdict: whether it is a success, and its body.
type Reading = { succeeded: boolean; body?: JsonObject };

export type Verdict =
  | ({ result: "match"; expected: string; found: string } & Reading)
  | ({
      result: "mismatch";
      check: JudgeCheck;
      expected: string;
      found: string;
    } & Reading)
  | {
      result: "no_response";
      expected: string;
      found: string;
      succeeded: false;
    };

// The judge only reads responses (3.1). It never reads the database, never decides what is
// tested and never compares a message: the code decides and the message stays as evidence.
export function judge(exchange: Exchange, expectation: Expectation): Verdict {
  const { outcome, template } = exchange;
  const expected = describe(expectation);

  const response = outcome.response;
  if (response === undefined) {
    return noResponse(expected, `no response: ${outcome.error}`);
  }
  if (isGatewayStatus(response.status)) {
    return noResponse(expected, `${response.status} from the gateway`);
  }

  const body = decode(response.body);
  const code = body?.[template.codeField];
  const missing = template.success.requires.filter(
    (field) => !present(body?.[field]),
  );
  const isSuccessCode =
    response.status === template.businessStatus &&
    code === template.success.code;
  const reading: Reading = {
    succeeded: isSuccessCode && missing.length === 0,
    body,
  };
  const mismatch = (check: JudgeCheck, found: string): Verdict => ({
    result: "mismatch",
    check,
    expected,
    found,
    ...reading,
  });
  const match = (found: string): Verdict => ({
    result: "match",
    expected,
    found,
    ...reading,
  });

  // 1. The leak, always and on the raw body.
  const leak = findLeak(response.body);
  if (leak !== undefined) {
    return mismatch("leak", `${leak} in the response`);
  }

  // 2. The transport: the status says whether the request reached the business.
  if (expectation.kind === "status") {
    const found = String(response.status);
    return response.status === expectation.status
      ? match(found)
      : mismatch("transport", found);
  }
  if (response.status !== template.businessStatus) {
    return mismatch("transport", String(response.status));
  }

  // 3. The format: what is not JSON is a technical error, never a rejection.
  if (body === undefined) {
    return mismatch("format", "a response that is not JSON");
  }

  // 4. The success, with all its conditions.
  if (isSuccessCode) {
    const success = template.codes[template.success.code] ?? "OK";
    if (missing.length > 0) {
      return mismatch("success", `${success} without ${missing.join(" and ")}`);
    }
    if (expectation.kind !== "success") {
      return mismatch("code", success);
    }
    // The state it reports, read from the field its template says, when the case expects one.
    if (expectation.state !== undefined) {
      const state = body[template.stateField ?? "status"];
      const found = `${success} (${String(state)})`;
      return state === expectation.state
        ? match(found)
        : mismatch("state", found);
    }
    return match(success);
  }

  // 5. The code, translated with the dictionary of its API.
  const translated =
    typeof code === "string" ? template.codes[code] : undefined;

  // 6. A code that is not in the dictionary is an unclassified response (8.5).
  if (translated === undefined) {
    const shown = typeof code === "string" ? code : "no code";
    return mismatch("unclassified", `an unclassified response (${shown})`);
  }
  return expectation.kind === "code" && translated === expectation.code
    ? match(translated)
    : mismatch("code", translated);
}

export function describe(expectation: Expectation): string {
  switch (expectation.kind) {
    case "success":
      return expectation.state === undefined
        ? "OK"
        : `OK (${expectation.state})`;
    case "code":
      return expectation.code;
    case "status":
      return String(expectation.status);
  }
}

function noResponse(expected: string, found: string): Verdict {
  return { result: "no_response", expected, found, succeeded: false };
}

function decode(body: string): JsonObject | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : undefined;
  } catch {
    return undefined;
  }
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}
