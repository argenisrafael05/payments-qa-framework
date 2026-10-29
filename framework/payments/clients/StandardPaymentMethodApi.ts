import type { Exchange, Http } from "../../engine/http.ts";
import { coreApi } from "../policies/core.ts";
import { requestToken } from "./auth.ts";

export type Payment = { reference: string; amount: number; sequence: string };

// The standard contract of a payment method, shared by the supermarket and the bank.
export class StandardPaymentMethodApi {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  token(key: string): Promise<Exchange> {
    return requestToken(this.#http, key);
  }

  inquiry(token: string, reference: string): Promise<Exchange> {
    return this.#http.call(coreApi.inquiry, {
      method: "GET",
      path: `/inquiries/${encodeURIComponent(reference)}`,
      token,
    });
  }

  // The request and the notice in one call.
  pay(token: string, payment: Payment): Promise<Exchange> {
    return this.#http.call(coreApi.payment, {
      method: "POST",
      path: "/payments",
      token,
      body: payment,
    });
  }
}
