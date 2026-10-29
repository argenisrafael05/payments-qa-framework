import { randomBytes } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { Http } from "../engine/http.ts";
import type { Step } from "../engine/runner.ts";
import type { Case } from "./catalog.ts";
import { MerchantApi } from "./clients/MerchantApi.ts";
import { StandardPaymentMethodApi } from "./clients/StandardPaymentMethodApi.ts";
import type { Environment } from "./environment.ts";

export type ConfirmedPayment = {
  folio: string;
  authorization: string;
  amount: number;
  sequence: string;
  paymentMethodId: string;
};

// Everything a case carries from one step to the next. Each case has its own, so the
// clients are reused without sharing anything between cases.
export type PaymentContext = {
  apis: { merchant: MerchantApi; paymentMethod: StandardPaymentMethodApi };
  db: Pool;
  merchant: Environment["merchant"];
  paymentMethod: Environment["paymentMethod"];
  // The reference the case asks for, and the one the merchant got.
  reference: Case["reference"];
  created?: { code: string; amount: number };
  // The payment method's own number for the operation.
  sequence: string;
  tokens: { merchant?: string; paymentMethod?: string };
  // What the API confirmed. The database has to match it at the end (HU-01).
  confirmed: ConfirmedPayment[];
};

export type PaymentStep = Step<PaymentContext>;

export function createContext(options: {
  http: Http;
  db: Pool;
  environment: Environment;
  reference: Case["reference"];
  integration: string;
}): PaymentContext {
  return {
    apis: {
      merchant: new MerchantApi(options.http),
      paymentMethod: new StandardPaymentMethodApi(options.http),
    },
    db: options.db,
    merchant: options.environment.merchant,
    paymentMethod: options.environment.paymentMethod,
    reference: options.reference,
    sequence: `${options.integration}-${randomBytes(6).toString("hex")}`,
    tokens: {},
    confirmed: [],
  };
}

// What an earlier step had to leave. If it is not there, the bug is in the framework.
export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`${what} is missing`);
  }
  return value;
}

export function text(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new Error(`${what} is not text`);
  }
  return value;
}
