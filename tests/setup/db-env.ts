/**
 * Per-file setup for the `db` project: expose the provided test DB to code under test.
 * src/db/pool.ts (app role) is pointed at TEST_DATABASE_URL; APP_MODE is TEST.
 */
import { afterAll, inject } from 'vitest';
import { configureDb, closePool } from '@/src/db/pool';
import { resetEnvCache } from '@/src/config/env';

process.env.TZ = 'UTC';
process.env.APP_MODE = 'TEST';
process.env.DATABASE_URL = inject('TEST_DATABASE_URL');
process.env.DATABASE_OWNER_URL = inject('TEST_DATABASE_OWNER_URL');
process.env.TEST_DATABASE_URL = inject('TEST_DATABASE_URL');
process.env.TEST_DATABASE_OWNER_URL = inject('TEST_DATABASE_OWNER_URL');
resetEnvCache();

await configureDb({ connectionString: inject('TEST_DATABASE_URL'), max: 5 });

afterAll(async () => {
  await closePool();
  const { closeOwnerPool } = await import('./db-helpers');
  await closeOwnerPool();
});
