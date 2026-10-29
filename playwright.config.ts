import { defineConfig } from "@playwright/test";
import { loadEnvFiles } from "./framework/payments/environment.ts";
import { currentRun } from "./framework/payments/run-setup.ts";

loadEnvFiles();
const run = currentRun();

// One integration per run, with one worker, and Playwright never retries a case (HU-01, 3.1).
export default defineConfig({
  testDir: "tests/specs",
  fullyParallel: false,
  // The closing runs go with CI=1, so a forgotten test.only never passes (4.1).
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  // The last line of the quick check, once PayRef is up (RE-17).
  globalSetup: "./tests/global-setup.ts",
  outputDir: `${run.directory}/playwright-output`,
  reporter: [
    ["./tests/reporters/console.ts"],
    [
      "html",
      { outputFolder: `${run.directory}/playwright-report`, open: "never" },
    ],
  ],
  // PayRef starts in test mode, with an empty database, and stops when the run ends.
  webServer: {
    command: "npm run start --workspace payref",
    port: Number(new URL(run.environment.payrefUrl).port),
    env: {
      REGION: run.integration.region,
      PAYREF_MODE: "test",
      PAYREF_VERSION: run.version,
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
