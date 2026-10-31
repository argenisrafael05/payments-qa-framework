import { createServer, type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { loadIntegration } from "../../framework/payments/integrations.ts";
import {
  checkConfig,
  checkPortFree,
  checkVariables,
  healthProblem,
} from "../../framework/payments/preflight.ts";

// The parts of the quick check that need no database. The read-only user is checked against
// the real one in every run, because these tests run without Docker (RE-42).

const run = {
  integration: loadIntegration("supermarket"),
  version: "1.1" as const,
};

describe("the quick check", () => {
  it("knows when the port of PayRef is taken", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    await expect(checkPortFree(port)).rejects.toThrow(
      `The port ${port} is already in use`,
    );
    await new Promise((resolve) => server.close(resolve));
    await expect(checkPortFree(port)).resolves.toBeUndefined();
  });

  it("accepts a PayRef that answers with its database, its region and its version", () => {
    expect(
      healthProblem(200, { status: "ok", region: "mx", version: "1.1" }, run),
    ).toBeUndefined();
  });

  it("stops when the database of PayRef does not answer", () => {
    expect(
      healthProblem(
        503,
        { status: "unavailable", region: "mx", version: "1.1" },
        run,
      ),
    ).toMatch(/^PayRef answers, but its database does not/);
  });

  it("stops when PayRef is another region or another version", () => {
    expect(
      healthProblem(200, { status: "ok", region: "mx", version: "1.0" }, run),
    ).toBe("PayRef answers as mx 1.0, and the run asked for mx 1.1");
  });

  it("names the variable that is missing", () => {
    expect(() =>
      checkVariables("supermarket", { PAYREF_MX_PORT: "4101" }),
    ).toThrow(/^Missing environment variable MYSQL_PORT/);
  });

  it("checks the catalog and the config of the integration", () => {
    expect(() => checkConfig("supermarket")).not.toThrow();
    expect(() => checkConfig("atm")).toThrow('There is no integration "atm"');
  });
});
