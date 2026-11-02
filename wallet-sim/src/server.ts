import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";

// A wallet that makes a QR or a link for a payment, like a real third party: its own API, its own
// format and its own codes. PayRef asks it for a resource with a signature made with the key
// they share, the same key the wallet signs its webhooks with.

declare module "fastify" {
  interface FastifyRequest {
    rawBody: string;
  }
}

type QrCode = { id: string; merchantReference: string; amount: number };

const port = Number(required("WALLET_PORT"));
const key = required("MX_WALLET_SECRET");
const payrefUrl = `http://127.0.0.1:${required("PAYREF_MX_PORT")}`;
const qrCodes = new Map<string, QrCode>();

const app = Fastify({ logger: true });

// The signature goes over the exact bytes that traveled, so the body is kept as it arrived.
app.decorateRequest("rawBody", "");
app.addContentTypeParser(
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

app.post<{ Body: { merchantReference: string; amount: number } }>(
  "/qr-codes",
  {
    schema: {
      body: {
        type: "object",
        properties: {
          merchantReference: { type: "string", minLength: 1 },
          amount: { type: "number" },
        },
        required: ["merchantReference", "amount"],
        additionalProperties: false,
      },
    },
  },
  async (request, reply) => {
    if (!signed(request.headers["x-payref-signature"], request.rawBody)) {
      return reply.code(401).send({ state: "DENIED" });
    }
    const id = `wq_${randomBytes(8).toString("hex")}`;
    qrCodes.set(id, { id, ...request.body });
    return {
      state: "CREATED",
      id,
      qr: `walletpay://qr/${id}`,
      link: `http://127.0.0.1:${port}/pay/${id}`,
    };
  },
);

// Only for the tests: the customer pays a QR code, and the wallet answers right away. Its webhook
// goes to PayRef a moment later, on its own, like a real wallet, so whoever waits for it has to
// ask PayRef and not the wallet. It brings what the customer paid, which can be another amount
// than the one of the QR code, and the time of the case.
app.post<{ Body: { qrCode: string; amount?: number; testTime?: string } }>(
  "/simulations/payments",
  {
    schema: {
      body: {
        type: "object",
        properties: {
          qrCode: { type: "string", minLength: 1 },
          amount: { type: "number" },
          testTime: { type: "string" },
        },
        required: ["qrCode"],
        additionalProperties: false,
      },
    },
  },
  async (request, reply) => {
    const qrCode = qrCodes.get(request.body.qrCode);
    if (qrCode === undefined) {
      return reply.code(404).send({ state: "NOT_FOUND" });
    }
    const { amount = qrCode.amount, testTime } = request.body;
    setTimeout(() => {
      sendWebhook(qrCode, amount, testTime).catch((error: unknown) =>
        app.log.error(error),
      );
    }, 200);
    return { state: "PAID", qrCode: qrCode.id };
  },
);

app.get("/health", async () => ({ status: "ok" }));

await app.listen({ host: "127.0.0.1", port });

async function sendWebhook(
  qrCode: QrCode,
  amount: number,
  testTime?: string,
): Promise<void> {
  const body = JSON.stringify({
    resource: qrCode.id,
    amount,
    paidAt: testTime ?? new Date().toISOString(),
  });
  const response = await fetch(`${payrefUrl}/wallet/webhooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wallet-signature": signatureOf(body),
      ...(testTime === undefined ? {} : { "x-test-time": testTime }),
    },
    body,
  });
  app.log.info({ status: response.status, answer: await response.text() });
}

function signatureOf(body: string): string {
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}

function signed(signature: unknown, body: string): boolean {
  if (typeof signature !== "string") {
    return false;
  }
  const expected = Buffer.from(signatureOf(body));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}
