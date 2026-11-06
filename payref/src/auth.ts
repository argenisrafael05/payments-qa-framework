import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { required, type Operation, type RegionConfig } from "./config.ts";
import { tokenSchema, type TokenBody } from "./schemas.ts";

export type Caller =
  | { role: "merchant"; id: string }
  | { role: "paymentMethod"; id: string; operations: Operation[] };

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller | null;
  }
}

export type Auth = ReturnType<typeof createAuth>;

// One key per merchant and one per payment method, exchanged for a token.
// Who is calling always comes from the token, never from the body.
export function createAuth(
  region: RegionConfig,
  env: NodeJS.ProcessEnv = process.env,
) {
  const keys = new Map<string, Caller>();
  for (const merchant of region.merchants) {
    keys.set(required(env, merchant.keyEnv), {
      role: "merchant",
      id: merchant.id,
    });
  }
  // A third party never gets a token: it signs what it sends (HU-11).
  for (const method of region.paymentMethods.filter(
    (each) => each.kind === "standard",
  )) {
    keys.set(required(env, method.keyEnv), {
      role: "paymentMethod",
      id: method.id,
      operations: method.operations,
    });
  }
  const tokens = new Map<string, Caller>();

  function register(app: FastifyInstance): void {
    app.decorateRequest("caller", null);

    app.post<{ Body: TokenBody }>(
      "/auth/token",
      { schema: tokenSchema },
      async (request, reply) => {
        const caller = keys.get(request.body.key);
        if (!caller) {
          return reply.code(401).send({ message: "Invalid key" });
        }
        const token = randomBytes(24).toString("hex");
        tokens.set(token, caller);
        return { code: "OK", message: "Token issued", token };
      },
    );
  }

  // It goes on onRequest, before the body is read: the credential is the first rule (8.4), so
  // nobody without one ever learns how a request has to be written.
  function allow(role: Caller["role"], operation?: Operation) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      const caller = token ? tokens.get(token) : undefined;
      if (!caller) {
        return reply.code(401).send({ message: "Missing or invalid token" });
      }
      const allowed =
        caller.role === role &&
        (operation === undefined ||
          (caller.role === "paymentMethod" &&
            caller.operations.includes(operation)));
      if (!allowed) {
        return reply
          .code(403)
          .send({ message: "This caller cannot use this operation" });
      }
      request.caller = caller;
    };
  }

  return { register, allow };
}

export function callerOf(request: FastifyRequest): Caller {
  if (!request.caller) {
    throw new Error("This route has no authentication");
  }
  return request.caller;
}
