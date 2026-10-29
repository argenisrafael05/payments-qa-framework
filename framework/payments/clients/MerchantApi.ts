import type { Exchange, Http } from "../../engine/http.ts";
import { coreApi } from "../policies/core.ts";
import { requestToken } from "./auth.ts";

export type NewReference = {
  type: "single" | "recurring";
  amountType: "fixed" | "open";
  amount?: number;
  expiresOn?: string;
};

// The merchant's side of the core contract, the same for every integration. Like a
// Page Object for an API, it only calls and returns: the state travels in the case's context.
export class MerchantApi {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  token(key: string): Promise<Exchange> {
    return requestToken(this.#http, key);
  }

  // `at` is the time it is created, when it is not the one of the case.
  createReference(
    token: string,
    reference: NewReference,
    at?: string,
  ): Promise<Exchange> {
    return this.#http.call(coreApi.createReference, {
      method: "POST",
      path: "/references",
      token,
      body: reference,
      testTime: at,
    });
  }

  view(token: string, reference: string): Promise<Exchange> {
    return this.#http.call(coreApi.viewReference, {
      method: "GET",
      path: `/references/${encodeURIComponent(reference)}`,
      token,
    });
  }

  cancel(token: string, reference: string): Promise<Exchange> {
    return this.#http.call(coreApi.cancelReference, {
      method: "POST",
      path: `/references/${encodeURIComponent(reference)}/cancellation`,
      token,
    });
  }
}
