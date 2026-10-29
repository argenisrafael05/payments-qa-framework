import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { createAuth } from "./auth.ts";
import { registerClock } from "./clock.ts";
import { loadConfig, loadRegion } from "./config.ts";
import { createPool, prepareDatabase } from "./db.ts";
import { registerErrorHandling } from "./errors.ts";
import { registerPayments } from "./payments.ts";
import { registerReferences } from "./references.ts";

const config = loadConfig();
const region = loadRegion(config.region);
await prepareDatabase(config, region);
const db = createPool(config);

// Strict types: a payments API must not turn "150.50" into 150.5 or drop unknown fields.
const app = Fastify({
  logger: true,
  ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
});

await app.register(swagger, {
  openapi: { info: { title: "PayRef", version: config.version } },
});
registerErrorHandling(app, config.bugs);
registerClock(app, config);

const auth = createAuth(region);
auth.register(app);
registerReferences(app, { db, region, auth, bugs: config.bugs });
registerPayments(app, { db, region, auth, bugs: config.bugs });

app.get("/health", { schema: { hide: true } }, async (_request, reply) => {
  const instance = { region: config.region, version: config.version };
  try {
    await db.query("SELECT 1");
    return { status: "ok", ...instance };
  } catch (error) {
    app.log.error(error);
    return reply.code(503).send({ status: "unavailable", ...instance });
  }
});

app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

await app.listen({ host: "127.0.0.1", port: config.port });
