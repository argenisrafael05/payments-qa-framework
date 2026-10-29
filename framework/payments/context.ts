import { randomBytes } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { Http } from "../engine/http.ts";
import type { Step } from "../engine/runner.ts";
import type { Reference } from "./catalog.ts";
import { MerchantApi } from "./clients/MerchantApi.ts";
import { StandardPaymentMethodApi } from "./clients/StandardPaymentMethodApi.ts";
import type { Environment, Role } from "./environment.ts";

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
  // The wrapper of the case, to call its objective the way the case says (8.9).
  http: Http;
  apis: Apis;
  db: Pool;
  merchant: Environment["merchant"];
  paymentMethod: Environment["paymentMethod"];
  // The reference the test asks for, and the code the merchant got for it, or the one that
  // nobody created.
  reference?: Reference;
  created?: { code: string };
  // The time the merchant creates it, when it is not the one of the case.
  creationTime?: string;
  // What the customer pays.
  amount: number;
  // The payment method's own number for the operation, and the one of a second payment.
  sequence: string;
  secondSequence?: string;
  // Who calls the objective in place of its usual role, when it gets a token of its own:
  // another merchant or the other role (8.9).
  caller?: Role;
  tokens: { merchant?: string; paymentMethod?: string; caller?: string };
  // What the API confirmed. The database has to match it at the end (HU-01).
  confirmed: ConfirmedPayment[];
  // The merchant cancelled the reference, and the API confirmed it.
  cancelled?: boolean;
};

export type PaymentStep = Step<PaymentContext>;

export type Apis = {
  merchant: MerchantApi;
  paymentMethod: StandardPaymentMethodApi;
};

export function apisOf(http: Http): Apis {
  return {
    merchant: new MerchantApi(http),
    paymentMethod: new StandardPaymentMethodApi(http),
  };
}

export function createContext(options: {
  http: Http;
  db: Pool;
  environment: Environment;
  reference?: Reference;
  creationTime?: string;
  caller?: Role;
  code?: string;
  amount: number;
  secondSequence?: "same" | "new";
  integration: string;
}): PaymentContext {
  const sequence = () =>
    `${options.integration}-${randomBytes(6).toString("hex")}`;
  const first = sequence();
  return {
    http: options.http,
    apis: apisOf(options.http),
    db: options.db,
    merchant: options.environment.merchant,
    paymentMethod: options.environment.paymentMethod,
    reference: options.reference,
    creationTime: options.creationTime,
    caller: options.caller,
    created: options.code === undefined ? undefined : { code: options.code },
    amount: options.amount,
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
