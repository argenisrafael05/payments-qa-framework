import type { Recorder } from "./evidence.ts";
import { maskBody, maskHeaders } from "./masking.ts";
import { localTimestamp } from "./time.ts";

export type JsonObject = { [key: string]: unknown };

export type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

// What came back: a response, whatever its status, or no response at all.
export type HttpOutcome =
  | { response: HttpResponse; error?: undefined }
  | { response?: undefined; error: string };

// The only thing the framework needs from an HTTP client. The adapter lives with the
// fixtures, so this package never depends on Playwright.
export type Transport = {
  send(request: HttpRequest): Promise<HttpOutcome>;
};

// How to read the responses of one operation. Every difference between APIs lives here, as
// data, so the judge never needs an if per API (3.1).
export type OperationTemplate = {
  // The status that means the request reached the business.
  businessStatus: number;
  codeField: string;
  // A success needs its code and every one of these fields.
  success: { code: string; requires: readonly string[] };
  // The API's codes, translated to PayRef's.
  codes: Readonly<Record<string, string>>;
  // The field with the state of what the response describes, when it has one.
  stateField?: string;
  // Hidden in the evidence copy (RNF-05).
  secrets?: { request?: readonly string[]; response?: readonly string[] };
  // Only an operation that can be repeated without risk is retried (3.1).
  repeatable: boolean;
};

export type Exchange = {
  template: OperationTemplate;
  outcome: HttpOutcome;
};

export type Call = {
  method: "GET" | "POST";
  path: string;
  token?: string;
  body?: JsonObject;
  // The time of this call, when it is not the one of the case.
  testTime?: string;
};

// What a case can change in the call of its objective (8.9): another token or none at all, or
// the body cut before its end, like a request that broke on the way.
export type CallChange = {
  token?: string | null;
  breakBody?: boolean;
};

// The gateway sends these when the system did not answer (8.5).
const gatewayStatuses = [408, 502, 503, 504];

// The wrapper of every call (HU-01): it sends through the transport, retries only what failed
// on the way, and leaves each attempt in the evidence.
export class Http {
  readonly #transport: Transport;
  readonly #baseUrl: string;
  readonly #recorder: Recorder;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;
  readonly #testTime: string | undefined;
  #change: CallChange = {};

  constructor(options: {
    transport: Transport;
    baseUrl: string;
    recorder: Recorder;
    maxAttempts?: number;
    retryDelayMs?: number;
    // The time the case fixes, sent with every call that does not bring its own. It stays
    // visible in the evidence.
    testTime?: string;
  }) {
    this.#transport = options.transport;
    this.#baseUrl = options.baseUrl;
    this.#recorder = options.recorder;
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#retryDelayMs = options.retryDelayMs ?? 250;
    this.#testTime = options.testTime;
  }

  // The same wrapper, with what the case changes in the call of its objective.
  with(change: CallChange): Http {
    const http = new Http({
      transport: this.#transport,
      baseUrl: this.#baseUrl,
      recorder: this.#recorder,
      maxAttempts: this.#maxAttempts,
      retryDelayMs: this.#retryDelayMs,
      testTime: this.#testTime,
    });
    http.#change = change;
    return http;
  }

  async call(template: OperationTemplate, call: Call): Promise<Exchange> {
    const request: HttpRequest = {
      method: call.method,
      url: `${this.#baseUrl}${call.path}`,
      headers: {},
    };
    const token =
      this.#change.token === undefined ? call.token : this.#change.token;
    if (typeof token === "string") {
      request.headers.authorization = `Bearer ${token}`;
    }
    const testTime = call.testTime ?? this.#testTime;
    if (testTime !== undefined) {
      request.headers["x-test-time"] = testTime;
    }
    if (call.body !== undefined) {
      request.headers["content-type"] = "application/json";
      const body = JSON.stringify(call.body);
      request.body = this.#change.breakBody === true ? body.slice(0, -1) : body;
    }

    const attempts = template.repeatable ? this.#maxAttempts : 1;
    for (let attempt = 1; ; attempt++) {
      const startedAt = new Date();
      const outcome = await this.#transport.send(request);
      this.#recorder.recordCall({
        attempt,
        at: localTimestamp(startedAt),
        durationMs: Date.now() - startedAt.getTime(),
        request: {
          method: request.method,
          url: request.url,
          headers: maskHeaders(request.headers),
          body: maskBody(request.body, template.secrets?.request),
        },
        response: outcome.response && {
          status: outcome.response.status,
          headers: outcome.response.headers,
          body: maskBody(outcome.response.body, template.secrets?.response),
        },
        error: outcome.error,
      });
      if (attempt >= attempts || !failedOnTheWay(outcome)) {
        return { template, outcome };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.#retryDelayMs * attempt),
      );
    }
  }
}

export function isGatewayStatus(status: number): boolean {
  return gatewayStatuses.includes(status);
}

function failedOnTheWay(outcome: HttpOutcome): boolean {
  return (
    outcome.response === undefined || isGatewayStatus(outcome.response.status)
  );
}
