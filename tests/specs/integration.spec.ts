import { casesFor } from "../../framework/payments/catalog.ts";
import { currentRun } from "../../framework/payments/run-setup.ts";
import { approve, test } from "../fixtures/fixtures.ts";

const { integration } = currentRun();

// One generic spec for every integration: each case of the catalog becomes a test. The
// test only runs its case. The judge and the checks decide, and approve() tells Playwright.
for (const entry of casesFor(integration)) {
  test(
    entry.name,
    { tag: entry.case.tags.map((tag) => `@${tag}`) },
    async ({ cases }) => {
      approve(await cases.run(entry));
    },
  );
}
