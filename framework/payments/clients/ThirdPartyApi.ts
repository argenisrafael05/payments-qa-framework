import type { Exchange } from "../../engine/http.ts";

export type ResourceRequest = { reference: string; amount: number };

export type PaymentNotice = {
  resource: string;
  amount: number;
  paidAt: string;
};

// What the steps of a third party need from its client: ask for a payment resource, and send its
// webhook as the third party would. Each third party brings its own client and reuses the steps.
export type ThirdPartyApi = {
  requestResource(token: string, request: ResourceRequest): Promise<Exchange>;
  webhook(key: string, notice: PaymentNotice): Promise<Exchange>;
};

// The simulator of a third party, for the tests where it sends its own webhook: the framework
// only tells it that the customer paid, and how much (HU-12).
export type ThirdPartySimulator = {
  pay(
    resource: string,
    payment: { amount: number; testTime?: string },
  ): Promise<Exchange>;
};
