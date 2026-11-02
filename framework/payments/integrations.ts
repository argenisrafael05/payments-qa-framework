import { readdirSync } from "node:fs";
import { z } from "zod";
import { loadData } from "../engine/data.ts";

const directory = new URL("../integrations/", import.meta.url);

// Each one that takes part, as PayRef knows it, and the variable that holds its key.
const role = z.strictObject({
  id: z.string().min(1),
  keyEnv: z.string().min(1),
});

// An integration is pure config: it picks pieces that already exist.
const integrationSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  region: z.enum(["mx", "sa"]),
  // The contract its payment method speaks: the standard one, or the bridge of PayRef to a
  // third party like the wallet, which has its own client in its folder.
  contract: z.enum(["standard", "wallet-bridge"]),
  // How the request and the notice arrive: together in one call, the request first and its
  // notice after it, like a bank, or a payment resource and then a webhook, like a wallet.
  notice: z.enum(["together", "separate", "webhook"]),
  // Whether its payment method inquires before it pays. The inquiry is optional, and some
  // only pay.
  inquiry: z.boolean(),
  paymentMethod: role,
  // The limits of its payment method for an open amount, the same as in PayRef.
  amountLimits: z.strictObject({ min: z.number(), max: z.number() }),
  // The reversal window of its payment method, the same as in PayRef, when it turns it on: the
  // framework needs it to know what the database must have when the window ends (HU-10).
  reversalWindow: z
    .strictObject({ minutes: z.number().int().positive() })
    .optional(),
  // The merchant that creates its references, and the others some cases ask for, each by an
  // alias that says what it is for. A case names the alias, never the id.
  merchant: role,
  otherMerchants: z
    .record(z.string().regex(/^[a-z][a-z0-9-]*$/), role)
    .optional(),
});

export type Integration = z.infer<typeof integrationSchema>;

export function listIntegrations(from: URL = directory): string[] {
  return readdirSync(from, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadIntegration(
  id: string,
  from: URL = directory,
): Integration {
  const available = listIntegrations(from);
  if (!available.includes(id)) {
    throw new Error(
      `There is no integration "${id}". The ones there are: ${available.join(", ")}`,
    );
  }
  const integration = loadData(
    new URL(`${id}/integration.json`, from),
    integrationSchema,
  );
  if (integration.id !== id) {
    throw new Error(
      `framework/integrations/${id}/integration.json: its id must be "${id}", like its folder`,
    );
  }
  // The window opens with the request, so it needs a request that comes before its notice.
  if (
    integration.reversalWindow !== undefined &&
    integration.notice !== "separate"
  ) {
    throw new Error(
      `framework/integrations/${id}/integration.json: the reversal window opens with the request, so it goes with "notice": "separate"`,
    );
  }
  return integration;
}
