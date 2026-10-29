import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Exchange,
  HttpOutcome,
  HttpRequest,
  OperationTemplate,
  Transport,
} from "../../framework/engine/http.ts";

// Controlled inputs: each test builds exactly the response, the rows or the error it needs.

export function reply(status: number, body: unknown): HttpOutcome {
  return {
    response: {
      status,
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  };
}

export function answered(
  template: OperationTemplate,
  status: number,
  body: unknown,
): Exchange {
  return { template, outcome: reply(status, body) };
}

export function unanswered(
  template: OperationTemplate,
  error: string,
): Exchange {
  return { template, outcome: { error } };
}

// A transport that answers in order, and keeps every request it got.
export function scripted(
  outcomes: HttpOutcome[],
): Transport & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async send(request) {
      requests.push(request);
      const outcome = outcomes.shift();
      if (outcome === undefined) {
        throw new Error(`No answer left for ${request.method} ${request.url}`);
      }
      return outcome;
    },
  };
}

export function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "payments-qa-framework-"));
}
