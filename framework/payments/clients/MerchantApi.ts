import type { Exchange, Http } from "../../engine/http.ts";
import { coreApi } from "../policies/core.ts";
import { requestToken } from "./auth.ts";

export type NewReference = {
  type: "single" | "recurring";
  amountType: "fixed" | "open";
  amount?: number;
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

  createReference(token: string, reference: NewReference): Promise<Exchange> {
    return this.#http.call(coreApi.createReference, {
      method: "POST",
      path: "/references",
      token,
      body: reference,
    });
  }
}
