import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The machine runs at +08 (not Jakarta). Force UTC everywhere so implicit
// local-time bugs surface; workers inherit this from the main process.
process.env.TZ = 'UTC';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig `@/*` → `./*` (new code imports '@/src/...').
      '@': root,
      // `server-only` throws outside the react-server condition; DB/security modules are
      // exercised directly from tests, so stub it.
      'server-only': fileURLToPath(new URL('./tests/setup/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    env: { TZ: 'UTC' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: [
            'tests/db/**/*.test.ts',
            'tests/api/**/*.test.ts',
            'tests/scenarios/**/*.test.ts',
            'tests/process/**/*.test.ts',
          ],
          // Creates a uniquely named, migrated database per run (G.1) and provides its URLs.
          globalSetup: ['tests/setup/global-db.ts'],
          // Points src/db/pool at the provided test database before each file.
          setupFiles: ['tests/setup/db-env.ts'],
          maxWorkers: 4,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
