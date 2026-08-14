import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias from tsconfig.json so tests import the same
    // way application code does.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Submitting or approving a listing can now invoke two real AI calls in
    // sequence — the food-safety check (§7.7) and the branch-matching
    // pipeline — where it used to be just one. The default 5s was already
    // too short for a single cold call; 40s gives two real sequential calls
    // room to breathe without slowing down the plain unit-test files, which
    // never come close to this ceiling.
    testTimeout: 40000,
  },
});
