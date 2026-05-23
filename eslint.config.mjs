import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled JS output from `npm run pretest` (tsconfig.test.json → .tmp-tests/).
    // These are CommonJS files and will always trigger @typescript-eslint/no-require-imports.
    ".tmp-tests/**",
    // Compiled JS output and reports from one-off local scripts.
    ".tmp-scripts/**",
    ".tmp-refund-backfill/**",
  ]),
]);

export default eslintConfig;
