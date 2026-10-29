import type { FastifyError, FastifyInstance } from "fastify";

// The business result travels with a 200. Its code says what the business decided.
export const rejections = {
  notFound: { code: "R-101", message: "The reference does not exist" },
  alreadyPaid: { code: "R-102", message: "The reference is already paid" },
  expired: { code: "R-103", message: "The reference is expired" },
  invalidAmount: {
    code: "R-104",
    message: "The amount is not valid for this reference",
  },
  cancelled: { code: "R-105", message: "The reference is cancelled" },
  repeatedNotice: { code: "R-106", message: "The payment notice is repeated" },
  windowClosed: { code: "R-107", message: "The reversal window is closed" },
  paymentInProgress: {
    code: "R-108",
    message: "The reference has a payment in progress",
  },
} as const;

// Errors that never reach the business. None of them shows internal details.
export function registerErrorHandling(
  app: FastifyInstance,
  bugs: ReadonlySet<number>,
): void {
  // Bug 4: each error goes out with its stack trace as the message.
  const shown = (error: Error, message: string) =>
    bugs.has(4) ? (error.stack ?? message) : message;

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ message: shown(error, error.message) });
    }
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send({ message: shown(error, error.message) });
    }
    request.log.error(error);
    return reply
      .code(500)
      .send({ code: "R-199", message: shown(error, "Technical error") });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ message: "Route not found" }),
  );
}
