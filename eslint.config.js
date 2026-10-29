import { defineConfig } from "eslint/config";
import playwright from "eslint-plugin-playwright";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["artifacts/", "coverage/", "playwright-report/", "test-results/"],
  },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  {
    // PayRef is a black box: the framework talks to it over HTTP and reads its database.
    files: ["framework/**/*.ts", "tests/**/*.ts", "tools/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "payref",
                "payref/*",
                "**/payref/**",
                "wallet-sim",
                "wallet-sim/*",
                "**/wallet-sim/**",
              ],
              message: "Talk to PayRef over HTTP, never import its code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/specs/**/*.ts"],
    extends: [playwright.configs["flat/recommended"]],
  },
]);
