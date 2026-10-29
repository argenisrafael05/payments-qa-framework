import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "mysql2/promise";
import { callerOf, type Auth } from "./auth.ts";
import type { RegionConfig } from "./config.ts";
import { createReferenceSchema, type CreateReferenceBody } from "./schemas.ts";

type Dependencies = { db: Pool; region: RegionConfig; auth: Auth };

export function registerReferences(
  app: FastifyInstance,
  { db, region, auth }: Dependencies,
): void {
  app.post<{ Body: CreateReferenceBody }>(
    "/references",
    { schema: createReferenceSchema, preHandler: auth.allow("merchant") },
    async (request, reply) => {
      const { type, amountType, amount, expiresOn } = request.body;
      if (amountType === "fixed" && amount === undefined) {
        return reply
          .code(400)
          .send({ message: "amount is required for a fixed reference" });
      }
      if (amountType === "open" && amount !== undefined) {
        return reply
          .code(400)
          .send({ message: "amount is only for a fixed reference" });
      }

      const code = randomDigits(region.referenceLength);
      await db.query(
        `INSERT INTO payment_references (code, merchant_id, type, amount_type, amount, expires_on, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          code,
          callerOf(request).id,
          type,
          amountType,
          amount ?? null,
          expiresOn ?? null,
          new Date(),
        ],
      );

      return {
        code: "OK",
        message: "Reference created",
        reference: code,
        status: "active",
        type,
        amountType,
        amount,
        expiresOn,
      };
    },
  );
}

function randomDigits(length: number): string {
  let digits = "";
  for (let i = 0; i < length; i++) {
    digits += String(randomInt(10));
  }
  return digits;
}
