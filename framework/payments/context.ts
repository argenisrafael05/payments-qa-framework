import { randomBytes } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { Http } from "../engine/http.ts";
import type { Step } from "../engine/runner.ts";
import type { Reference } from "./catalog.ts";
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
  // The reference the test asks for, and the code the merchant got for it, or the one that
  // nobody created.
  reference?: Reference;
  created?: { code: string };
  // What the customer pays, and what a second payment pays.
  amount: number;
  secondAmount: number;
  // The payment method's own number for the operation, and the one of a second payment.
  sequence: string;
  secondSequence?: string;
  tokens: { merchant?: string; paymentMethod?: string };
  // What the API confirmed. The database has to match it at the end (HU-01).
  confirmed: ConfirmedPayment[];
};

export type PaymentStep = Step<PaymentContext>;

export function createContext(options: {
  http: Http;
  db: Pool;
  environment: Environment;
  reference?: Reference;
  code?: string;
  amount: number;
  secondAmount?: number;
  secondSequence?: "same" | "new";
  integration: string;
}): PaymentContext {
  const sequence = () =>
    `${options.integration}-${randomBytes(6).toString("hex")}`;
  const first = sequence();
  return {
    apis: {
      merchant: new MerchantApi(options.http),
      paymentMethod: new StandardPaymentMethodApi(options.http),
    },
    db: options.db,
    merchant: options.environment.merchant,
    paymentMethod: options.environment.paymentMethod,
    reference: options.reference,
    created: options.code === undefined ? undefined : { code: options.code },
    amount: options.amount,
    secondAmount: options.secondAmount ?? options.amount,
    sequence: first,
    secondSequence:
      options.secondSequence === undefined
        ? undefined
        : options.secondSequence === "same"
          ? first
          : sequence(),
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
