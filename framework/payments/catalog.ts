import { readdirSync } from "node:fs";
import { z } from "zod";
import { loadData } from "../engine/data.ts";
import type { Expectation } from "../engine/judge.ts";
import { businessCodes } from "./codes.ts";
import { extraCheckNames } from "./database/checks.ts";
import { paymentFlow } from "./flows/payment.ts";
import type { Integration } from "./integrations.ts";

const baseCatalog = new URL("../cases/base/", import.meta.url);

// A case is only data: it never writes an assertion (3.1).
const caseSchema = z.strictObject({
  id: z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/),
  title: z.string().min(1),
  flow: z.enum(["payment"]),
  reference: z.strictObject({
    type: z.enum(["single", "recurring"]),
    amountType: z.enum(["fixed"]),
    amount: z.number().positive(),
  }),
  // Where the case ends and what it expects there (3.1): a business code, or the HTTP status
  // of a request that must not reach the business.
  objective: z.strictObject({
    step: z.enum(["inquiry", "request", "notice"]),
    expect: z.union([
      z.enum(businessCodes),
      z.number().int().min(400).max(599),
    ]),
  }),
  tags: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
  checks: z.array(z.enum(extraCheckNames)).optional(),
  // A case with a rule still pending does not run, and says why (8.5).
  blocked: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export type Case = z.infer<typeof caseSchema>;

export type CaseEntry = {
  // The title of the test in Playwright and the name of its file.
  name: string;
  variation: string;
  case: Case;
};

export function loadCatalog(directory: URL = baseCatalog): Case[] {
  const cases = readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((file) => loadData(new URL(file, directory), z.array(caseSchema)));
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) {
      throw new Error(`The case ${item.id} is in the catalog twice`);
    }
    ids.add(item.id);
  }
  return cases;
}

// The cases of one integration. A case whose objective is not a step of its flow fails here,
// before anything runs.
export function casesFor(
  integration: Integration,
  cases: Case[] = loadCatalog(),
): CaseEntry[] {
  const flow = paymentFlow(integration);
  return cases.map((item) => {
    if (!flow.some((step) => step.covers.includes(item.objective.step))) {
      throw new Error(
        `${item.id}: the ${item.flow} flow of ${integration.id} has no ${item.objective.step} step`,
      );
    }
    const variation = `${item.reference.type}-${item.reference.amountType}`;
    return {
      name: `${item.id}__${integration.id}__${variation}`,
      variation,
      case: item,
    };
  });
}

export function expectationOf(item: Case): Expectation {
  const expected = item.objective.expect;
  if (typeof expected === "number") {
    return { kind: "status", status: expected };
  }
  return expected === "OK"
    ? { kind: "success" }
    : { kind: "code", code: expected };
}
