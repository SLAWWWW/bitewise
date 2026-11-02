import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Seed and domain logic must be deterministic: time comes from the tenant clock or an
// injected `now`, randomness from src/lib/prng (architecture B, CLAUDE rules).
const determinismRules = {
  "no-restricted-properties": [
    "error",
    { object: "Math", property: "random", message: "Use streamFor()/mulberry32 from src/lib/prng." },
    { object: "Date", property: "now", message: "Use the tenant clock or an injected `now`." },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: "Argument-less new Date() reads the wall clock; pass an explicit instant.",
    },
    {
      selector: "CallExpression[callee.property.name='randomUUID']",
      message: "Use uuidv5 (src/lib/uuidv5) for deterministic ids.",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["db/seed/**/*.ts", "src/domain/**/*.ts"],
    rules: determinismRules,
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    ".data/**",
  ]),
]);

export default eslintConfig;
