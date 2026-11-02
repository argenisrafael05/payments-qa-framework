import type { Exchange, Http, OperationTemplate } from "../../engine/http.ts";
import type { ThirdPartySimulator } from "../../payments/clients/ThirdPartyApi.ts";

// How to read the simulated wallet. It answers that the customer paid, and it sends its webhook
// to PayRef after that, on its own, like a real wallet.
const walletSimulatorApi = {
  payment: {
    businessStatus: 200,
    codeField: "state",
    success: { code: "PAID", requires: [] },
    codes: { PAID: "OK" },
    repeatable: false,
  },
} satisfies Record<string, OperationTemplate>;

export class WalletSimulatorApi implements ThirdPartySimulator {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  // The time of the case goes to the wallet, so its webhook reaches PayRef at that time. The
  // amount is what the customer paid, which is not always the one of its QR code.
  pay(
    resource: string,
    payment: { amount: number; testTime?: string },
  ): Promise<Exchange> {
    return this.#http.call(walletSimulatorApi.payment, {
      method: "POST",
      path: "/simulations/payments",
      body: { qrCode: resource, ...payment },
    });
  }
}
