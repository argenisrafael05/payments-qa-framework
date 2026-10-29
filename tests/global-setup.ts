import { checkPayRef } from "../framework/payments/preflight.ts";
import { currentRun } from "../framework/payments/run-setup.ts";

// The last line of the quick check. Playwright starts PayRef before this runs, so the checks
// that need it to be off, like its port, already ran in npm test (RE-17).
export default async function globalSetup(): Promise<void> {
  try {
    console.log(`  ✓ ${await checkPayRef(currentRun())}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`✗ ${message}\n\n  The run did not start.`);
  }
}
