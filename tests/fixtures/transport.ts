import type { APIRequestContext } from "@playwright/test";
import type { Transport } from "../../framework/engine/http.ts";

// The adapter: Playwright's request behind the framework's own transport. A status
// never throws here: every response goes back to the judge.
export function playwrightTransport(
  request: APIRequestContext,
  timeout = 10_000,
): Transport {
  return {
    async send({ method, url, headers, body }) {
      try {
        const response = await request.fetch(url, {
          method,
          headers,
          // The bytes as the framework built them. A text that is not valid JSON would be
          // encoded again, and the evidence would not show what traveled.
          data: body === undefined ? undefined : Buffer.from(body),
          timeout,
          failOnStatusCode: false,
          maxRedirects: 0,
        });
        return {
          response: {
            status: response.status(),
            headers: response.headers(),
            body: await response.text(),
          },
        };
      } catch (error) {
        return { error: firstLine(error) };
      }
    },
  };
}

// Playwright adds its call log after the first line, and the name of the call before it.
function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? message).replace(/^[\w.]+: /, "");
}
