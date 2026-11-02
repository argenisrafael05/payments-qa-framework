import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { callerOf, type Auth } from "./auth.ts";
import { nowOf } from "./clock.ts";
import { required, type RegionConfig } from "./config.ts";
import { rejections } from "./errors.ts";
import {
  findReference,
  paymentRules,
  registerPayment,
  type Rejection,
} from "./payments.ts";
import {
  paymentResourceSchema,
  walletWebhookSchema,
  type PaymentResourceBody,
  type WalletWebhookBody,
} from "./schemas.ts";

declare module "fastify" {
  interface FastifyRequest {
    rawBody: string;
  }
}

type Dependencies = {
  db: Pool;
  region: RegionConfig;
  auth: Auth;
  bugs: ReadonlySet<number>;
};

type Resource = { referenceCode: string; amount: number };

type Operation = {
  operation: "resource" | "webhook";
  referenceCode: string | null;
  resourceId?: string;
  amount: number;
  qr?: string;
  link?: string;
  result: string;
  folio?: string;
  at: Date;
};

// What the bridge answers the wallet, in its own words, for each code of PayRef.
const walletResults: Record<"OK" | Rejection["code"], string> = {
  OK: "accepted",
  "R-101": "unknown-resource",
  "R-102": "already-paid",
  "R-103": "expired",
  "R-104": "invalid-amount",
  "R-105": "cancelled",
  "R-106": "repeated",
  "R-107": "window-closed",
  "R-108": "payment-in-progress",
};

// The bridge to a third party that makes a QR or a link and tells the payment with a webhook
// (HU-11). It has no rules of its own: it reuses the standard request and notice of the core.
export function registerWalletBridge(
  app: FastifyInstance,
  { db, region, auth, bugs }: Dependencies,
): void {
  const wallet = region.paymentMethods.find(
    (method) => method.kind === "third-party",
  );
  if (wallet === undefined) {
    return;
  }
  const walletId = wallet.id;
  const key = required(process.env, wallet.keyEnv);
  const walletUrl = `http://127.0.0.1:${required(process.env, wallet.portEnv ?? "")}`;
  const { validate } = paymentRules({ db, region, bugs });

  // The merchant asks for the resource of its own reference. It is the request: PayRef
  // validates it like a standard one, and only then asks the wallet for a QR or a link. The
  // resource is for one payment: while it is not paid, asking again gives the same one (8.8).
  app.post<{ Body: PaymentResourceBody }>(
    "/wallet/payment-resources",
    { schema: paymentResourceSchema, preHandler: auth.allow("merchant") },
    async (request) => {
      const now = nowOf(request);
      const { reference: code, amount } = request.body;
      const reference = await findReference(db, code);
      // A reference of another merchant does not exist for this one (HU-07).
      const validated =
        reference?.merchantId === callerOf(request).id
          ? await validate({ reference: code, amount }, walletId, now)
          : { rejection: rejections.notFound };
      if ("rejection" in validated) {
        await logOperation(db, {
          operation: "resource",
          referenceCode: code,
          amount,
          result: validated.rejection.code,
          at: now,
        });
        return validated.rejection;
      }
      const created =
        (await unpaidResourceOf(db, code)) ??
        (await createResource(walletUrl, key, {
          reference: code,
          amount: validated.amount,
        }));
      await logOperation(db, {
        operation: "resource",
        referenceCode: code,
        resourceId: created.id,
        amount: validated.amount,
        qr: created.qr,
        link: created.link,
        result: "OK",
        at: now,
      });
      return {
        code: "OK",
        message: "Payment resource created",
        resource: created.id,
        qr: created.qr,
        link: created.link,
      };
    },
  );

  // The webhook is the notice. It comes signed with the key of the wallet over the exact bytes it
  // sends, so its body is kept as it arrived to check the signature.
  app.register(async (webhooks) => {
    webhooks.decorateRequest("rawBody", "");
    webhooks.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (request, body, done) => {
        request.rawBody = String(body);
        try {
          done(null, JSON.parse(String(body)));
        } catch (error) {
          done(Object.assign(error as Error, { statusCode: 400 }), undefined);
        }
      },
    );

    webhooks.post<{ Body: WalletWebhookBody }>(
      "/wallet/webhooks",
      { schema: walletWebhookSchema },
      async (request, reply) => {
        if (!signedBy(key, request, bugs)) {
          return reply
            .code(401)
            .send({ message: "The signature is missing or does not match" });
        }
        const now = nowOf(request);
        const notice = request.body;
        const resource = await resourceOf(db, notice.resource);
        const outcome =
          resource === undefined
            ? { rejection: rejections.notFound }
            : await pay(resource, notice, now);
        await logOperation(db, {
          operation: "webhook",
          referenceCode: resource?.referenceCode ?? null,
          resourceId: notice.resource,
          amount: notice.amount,
          result: "rejection" in outcome ? outcome.rejection.code : "OK",
          folio: "rejection" in outcome ? undefined : outcome.folio,
          at: now,
        });
        if ("rejection" in outcome) {
          return {
            result: walletResultOf(outcome.rejection.code, bugs),
            message: outcome.rejection.message,
          };
        }
        return {
          result: walletResults.OK,
          message: "Payment registered",
          folio: outcome.folio,
          authorization: outcome.authorization,
        };
      },
    );
  });

  // The webhook validates everything again, in case something changed since the resource: its
  // sequence is the id of the resource, so a repeated one is a repeated notice (HU-11).
  async function pay(
    resource: Resource,
    notice: WalletWebhookBody,
    now: Date,
  ): Promise<
    { folio: string; authorization: string } | { rejection: Rejection }
  > {
    // Bug 6: the webhook does not check the expiry again.
    const validated = await validate(
      {
        reference: resource.referenceCode,
        amount: notice.amount,
        sequence: notice.resource,
      },
      walletId,
      now,
      { expiry: !bugs.has(6) },
    );
    if ("rejection" in validated) {
      return validated;
    }
    // A webhook with another amount than its resource is not the payment it asked for.
    if (notice.amount !== resource.amount) {
      return { rejection: rejections.invalidAmount };
    }
    return registerPayment(db, region, {
      reference: validated.reference,
      paymentMethodId: walletId,
      amount: validated.amount,
      sequence: notice.resource,
      at: now,
      status: "confirmed",
    });
  }
}

// Bug 7: the bridge translates a cancelled reference as accepted, after the core rejected it.
function walletResultOf(
  code: Rejection["code"],
  bugs: ReadonlySet<number>,
): string {
  return bugs.has(7) && code === "R-105" ? "accepted" : walletResults[code];
}

// The wallet answers in its own format, like a real third party. PayRef asks it with a
// signature, the same way the wallet signs its webhooks.
async function createResource(
  walletUrl: string,
  key: string,
  order: { reference: string; amount: number },
): Promise<{ id: string; qr: string; link: string }> {
  const body = JSON.stringify({
    merchantReference: order.reference,
    amount: order.amount,
  });
  const response = await fetch(`${walletUrl}/qr-codes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-payref-signature": signatureOf(key, body),
    },
    body,
  });
  const answer = (await response.json()) as {
    state?: string;
    id?: string;
    qr?: string;
    link?: string;
  };
  if (
    answer.state !== "CREATED" ||
    answer.id === undefined ||
    answer.qr === undefined ||
    answer.link === undefined
  ) {
    throw new Error(
      `The wallet did not create the resource (${response.status})`,
    );
  }
  return { id: answer.id, qr: answer.qr, link: answer.link };
}

export function signatureOf(key: string, body: string): string {
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}

// Bug 5: any signature passes, as long as there is one.
function signedBy(
  key: string,
  request: FastifyRequest,
  bugs: ReadonlySet<number>,
): boolean {
  const signature = request.headers["x-wallet-signature"];
  if (typeof signature !== "string") {
    return false;
  }
  if (bugs.has(5)) {
    return true;
  }
  const expected = Buffer.from(signatureOf(key, request.rawBody));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The last resource of the reference that no webhook paid yet.
async function unpaidResourceOf(
  db: Pool,
  referenceCode: string,
): Promise<{ id: string; qr: string; link: string } | undefined> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.resource_id, r.qr, r.link FROM bridge_operations r
     WHERE r.operation = 'resource' AND r.result = 'OK' AND r.reference_code = ?
       AND NOT EXISTS (
         SELECT 1 FROM bridge_operations w
         WHERE w.operation = 'webhook' AND w.result = 'OK' AND w.resource_id = r.resource_id
       )
     ORDER BY r.id DESC LIMIT 1`,
    [referenceCode],
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : { id: row.resource_id, qr: row.qr, link: row.link };
}

// The resource is found by the id the wallet gave it, never by the reference.
async function resourceOf(
  db: Pool,
  resourceId: string,
): Promise<Resource | undefined> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT reference_code, amount FROM bridge_operations
     WHERE operation = 'resource' AND result = 'OK' AND resource_id = ? LIMIT 1`,
    [resourceId],
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : { referenceCode: row.reference_code, amount: Number(row.amount) };
}

async function logOperation(db: Pool, entry: Operation): Promise<void> {
  await db.query(
    `INSERT INTO bridge_operations (operation, reference_code, resource_id, amount, qr, link, result, folio, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.operation,
      entry.referenceCode,
      entry.resourceId ?? null,
      entry.amount,
      entry.qr ?? null,
      entry.link ?? null,
      entry.result,
      entry.folio ?? null,
      entry.at,
    ],
  );
}
