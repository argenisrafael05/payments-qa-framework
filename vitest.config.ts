import { defineConfig } from "vitest/config";

// The framework's own tests, at component level: no PayRef and no Docker (RNF-02).
export default defineConfig({
  test: {
    include: ["tests/framework/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["framework/**/*.ts"],
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage",
      // The judge and the evidence reach 80 % of their lines and branches (RNF-03).
      thresholds: {
        "framework/engine/judge.ts": { lines: 80, branches: 80 },
        "framework/engine/evidence.ts": { lines: 80, branches: 80 },
      },
    },
  },
});
