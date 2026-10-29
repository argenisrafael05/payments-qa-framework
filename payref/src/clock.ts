import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "./config.ts";

// The time of the business is the server's, like in production. Only in test mode, a request
// can fix it with X-Test-Time, so a case at a time frontier never waits for the clock. It is not
// part of the business contract, so it is not in the openapi.
const times = new WeakMap<FastifyRequest, Date>();

const withOffset =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?([+-]\d{2}:\d{2}|Z)$/;

export function registerClock(app: FastifyInstance, config: Config): void {
  app.addHook("onRequest", async (request, reply) => {
    const header = request.headers["x-test-time"];
    if (config.mode !== "test" || header === undefined) {
      return;
    }
    const time = Array.isArray(header) ? header[0] : header;
    if (
      time === undefined ||
      !withOffset.test(time) ||
      Number.isNaN(Date.parse(time))
    ) {
      return reply.code(400).send({
        message:
          "X-Test-Time must be a date and time with its offset, like 2026-11-15T23:59:59-06:00",
      });
    }
    times.set(request, new Date(time));
  });
}

export function nowOf(request: FastifyRequest): Date {
  return times.get(request) ?? new Date();
}

// The day it is in the region, which is the one the expiry counts.
export function regionDate(now: Date, utcOffset: string): string {
  const [, sign, hours, minutes] =
    /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset) ?? [];
  const offset =
    (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  return new Date(now.getTime() + offset * 60_000).toISOString().slice(0, 10);
}
