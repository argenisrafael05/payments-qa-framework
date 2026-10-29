import { readdirSync } from "node:fs";
import { z } from "zod";
import { loadData } from "../engine/data.ts";

const directory = new URL("../integrations/", import.meta.url);

// An integration is pure config: it picks pieces that already exist.
const integrationSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  region: z.enum(["mx"]),
  // The contract its payment method speaks.
  contract: z.enum(["standard"]),
  // How the request and the notice arrive.
  notice: z.enum(["together"]),
  // As PayRef knows it, and the variable that holds its key.
  paymentMethod: z.strictObject({
    id: z.string().min(1),
    keyEnv: z.string().min(1),
  }),
});

export type Integration = z.infer<typeof integrationSchema>;

export function listIntegrations(): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadIntegration(id: string): Integration {
  const available = listIntegrations();
  if (!available.includes(id)) {
    throw new Error(
      `There is no integration "${id}". The ones there are: ${available.join(", ")}`,
    );
  }
  const integration = loadData(
    new URL(`${id}/integration.json`, directory),
    integrationSchema,
  );
  if (integration.id !== id) {
    throw new Error(
      `framework/integrations/${id}/integration.json: its id must be "${id}", like its folder`,
    );
  }
  return integration;
}
