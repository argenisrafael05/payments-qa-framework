import type { ReadingRecord } from "./evidence.ts";
import type { JsonObject } from "./http.ts";
import { describe, type Expectation, type Verdict } from "./judge.ts";

// What a step that observes saw in the database: the code that someone else's action left there,
// read once it showed up, or nothing when it never did in time (HU-12).
export type Observation = {
  kind: "observation";
  readings: ReadingRecord[];
  waitedMs: number;
  // The code the system kept for the action, and the row it kept it in.
  seen?: { code: string; row: JsonObject };
};

export function isObservation(value: object): value is Observation {
  return "kind" in value && value.kind === "observation";
}

// The code it saw decides, like the code of a response. Nothing in time is no verdict on the
// system: it did not answer, so the case could not be tested (8.5).
export function verdictOf(
  observation: Observation,
  expectation: Expectation,
): Verdict {
  const expected = describe(expectation);
  const { seen } = observation;
  if (seen === undefined) {
    return {
      result: "no_response",
      expected,
      found: `nothing in the database after ${observation.waitedMs} ms`,
      succeeded: false,
    };
  }
  const reading = { succeeded: seen.code === "OK", body: seen.row };
  const matches =
    expectation.kind === "success"
      ? seen.code === "OK"
      : expectation.kind === "code" && seen.code === expectation.code;
  return matches
    ? { result: "match", expected, found: seen.code, ...reading }
    : {
        result: "mismatch",
        check: "code",
        expected,
        found: seen.code,
        ...reading,
      };
}
