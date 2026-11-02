import { createHmac } from "node:crypto";
import type { Exchange, Http, OperationTemplate } from "../../engine/http.ts";
import type {
  PaymentNotice,
  ResourceRequest,
  ThirdPartyApi,
} from "../../payments/clients/ThirdPartyApi.ts";
import { businessCodes } from "../../payments/codes.ts";

// How to read the bridge of PayRef to the wallet (3.1). The merchant asks for the resource like
// any of its calls, so it reads like the core. The webhook is answered in the format of the
// wallet, with its own codes, and the dictionary translates each one to the code of PayRef.
export const walletBridgeApi = {
  paymentResource: {
    businessStatus: 200,
    codeField: "code",
    success: { code: "OK", requires: ["resource", "qr", "link"] },
    codes: Object.fromEntries(businessCodes.map((code) => [code, code])),
    repeatable: false,
  },
  webhook: {
    businessStatus: 200,
    codeField: "result",
    success: { code: "accepted", requires: ["folio", "authorization"] },
    codes: {
      accepted: "OK",
      "unknown-resource": "R-101",
      "already-paid": "R-102",
      expired: "R-103",
      "invalid-amount": "R-104",
      cancelled: "R-105",
      repeated: "R-106",
      "payment-in-progress": "R-108",
    },
    repeatable: false,
  },
} satisfies Record<string, OperationTemplate>;

// The client of the bridge of the wallet, which has a contract of its own.
export class WalletBridgeApi implements ThirdPartyApi {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  requestResource(token: string, request: ResourceRequest): Promise<Exchange> {
    return this.#http.call(walletBridgeApi.paymentResource, {
      method: "POST",
      path: "/wallet/payment-resources",
      token,
      body: request,
    });
  }

  // Signed as the wallet would: HMAC-SHA256 with its key, over the exact body that travels.
  // Without a key there is nothing to sign with, so it goes without a signature, like a webhook
  // somebody forged.
  webhook(key: string, notice: PaymentNotice): Promise<Exchange> {
    const signature = createHmac("sha256", key)
      .update(JSON.stringify(notice))
      .digest("hex");
    return this.#http.call(walletBridgeApi.webhook, {
      method: "POST",
      path: "/wallet/webhooks",
      body: notice,
      headers:
        key === "" ? {} : { "x-wallet-signature": `sha256=${signature}` },
    });
  }
}
