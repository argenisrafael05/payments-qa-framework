// The contract of the core API. Fastify validates every request with these schemas,
// and the openapi document is generated from them, so the two never drift apart.

const businessCode = { type: "string", pattern: "^(OK|R-1[0-9]{2})$" } as const;
// A code of another length simply does not exist in the region (R-101). The maximum only
// keeps giant inputs out.
const referenceCode = {
  type: "string",
  pattern: "^[0-9]+$",
  maxLength: 30,
} as const;
const amount = { type: "number", exclusiveMinimum: 0 } as const;
const referenceType = {
  type: "string",
  enum: ["single", "recurring"],
} as const;
const amountTypes = { type: "string", enum: ["fixed", "open"] } as const;
const expiresOn = { type: "string", format: "date" } as const;

const errorResponse = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
} as const;

const technicalErrorResponse = {
  type: "object",
  properties: {
    code: { type: "string", enum: ["R-199"] },
    message: { type: "string" },
  },
  required: ["code", "message"],
} as const;

function businessResponse(data: Record<string, object>) {
  return {
    type: "object",
    properties: { code: businessCode, message: { type: "string" }, ...data },
    required: ["code", "message"],
  } as const;
}

function responses(data: Record<string, object>) {
  return {
    200: businessResponse(data),
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    500: technicalErrorResponse,
  };
}

export type TokenBody = { key: string };

export const tokenSchema = {
  tags: ["auth"],
  body: {
    type: "object",
    // No format check on purpose: a wrong key of any length gets the same 401,
    // so the answer never hints at what a real key looks like.
    properties: { key: { type: "string", minLength: 1, maxLength: 128 } },
    required: ["key"],
    additionalProperties: false,
  },
  response: responses({ token: { type: "string" } }),
};

export type CreateReferenceBody = {
  type: "single" | "recurring";
  amountType: "fixed" | "open";
  amount?: number;
  expiresOn?: string;
};

export const createReferenceSchema = {
  tags: ["merchant"],
  body: {
    type: "object",
    properties: {
      type: referenceType,
      amountType: amountTypes,
      amount: {
        ...amount,
        description:
          "Required when amountType is fixed. Not allowed when it is open: it is rejected, never ignored.",
      },
      expiresOn,
    },
    required: ["type", "amountType"],
    additionalProperties: false,
  },
  response: responses({
    reference: referenceCode,
    status: {
      type: "string",
      enum: ["active", "paid", "cancelled", "expired"],
    },
    type: referenceType,
    amountType: amountTypes,
    amount,
    expiresOn,
  }),
};

export type ReferenceParams = { reference: string };

const referenceParams = {
  type: "object",
  properties: { reference: referenceCode },
  required: ["reference"],
} as const;

// The merchant sees its reference with its state. Expired is not kept: it comes from the date
// and the time of the region.
export const viewReferenceSchema = {
  tags: ["merchant"],
  params: referenceParams,
  response: responses({
    reference: referenceCode,
    status: {
      type: "string",
      enum: ["active", "paid", "cancelled", "expired"],
    },
    type: referenceType,
    amountType: amountTypes,
    amount,
    expiresOn,
  }),
};

export const cancelReferenceSchema = {
  tags: ["merchant"],
  params: referenceParams,
  response: responses({
    reference: referenceCode,
    status: { type: "string", enum: ["cancelled"] },
  }),
};

export type InquiryParams = { reference: string };

export const inquirySchema = {
  tags: ["payment method"],
  params: {
    type: "object",
    properties: { reference: referenceCode },
    required: ["reference"],
  },
  response: responses({
    reference: referenceCode,
    status: { type: "string", enum: ["active", "paid", "cancelled"] },
    type: referenceType,
    amountType: amountTypes,
    amount,
    expiresOn,
  }),
};

export type PaymentBody = {
  reference: string;
  amount: number;
  sequence: string;
};

export const paymentSchema = {
  tags: ["payment method"],
  body: {
    type: "object",
    properties: {
      reference: referenceCode,
      // Any number: the business decides, so an amount that is not valid gets R-104.
      amount: {
        type: "number",
        description:
          "Any number. An amount that is not valid for the reference gets R-104, and it is never rounded.",
      },
      sequence: { type: "string", minLength: 1, maxLength: 40 },
    },
    required: ["reference", "amount", "sequence"],
    additionalProperties: false,
  },
  response: responses({
    folio: { type: "string" },
    authorization: { type: "string" },
  }),
};
