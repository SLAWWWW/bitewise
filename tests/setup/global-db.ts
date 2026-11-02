/**
 * Vitest globalSetup for the `db` project (architecture G.1).
 *
 * 1. Reuse the server answering on TEST_DATABASE_ADMIN_URL (default DATABASE_ADMIN_URL,
 *    then the dev default on :54329); otherwise start a non-persistent embedded
 *    PostgreSQL 17 in .data/pg-test-<pid> on a free port.
 * 2. Bootstrap roles, create a uniquely named database lumbung_test_<pid>_<rand>,
 *    run all migrations as lumbung_owner (src/db/migrate-lib.ts, owned by W1-DB).
 * 3. provide() TEST_DATABASE_URL (lumbung_app) / TEST_DATABASE_OWNER_URL /
 *    TEST_DATABASE_ADMIN_URL / TEST_DATABASE_NAME to the test files.
 * 4. Teardown drops the database and stops the embedded server if we started it.
 *
 * Concurrent runs (several agents) are safe: each run gets its own database.
 */
import { randomBytes } from 'node:crypto';
import type { TestProject } from 'vitest/node';
import {
  canConnect,
  createMigratedDatabase,
  DEFAULT_ADMIN_URL,
  loadLocalEnv,
  rolePasswordsFromEnv,
} from '../../src/db/migrate-lib';

declare module 'vitest' {
  export interface ProvidedContext {
    TEST_DATABASE_URL: string;
    TEST_DATABASE_OWNER_URL: string;
    TEST_DATABASE_ADMIN_URL: string;
    TEST_DATABASE_NAME: string;
  }
}

export default async function setup(project: TestProject) {
  loadLocalEnv();
  process.env.TZ = 'UTC';

  let adminUrl =
    process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  let stopEmbedded: (() => Promise<void>) | null = null;

  if (!(await canConnect(adminUrl))) {
    const { startEmbedded, freePort } = await import('../../scripts/db/start');
    const port = await freePort();
    const handle = await startEmbedded({ dir: `.data/pg-test-${process.pid}`, port, persistent: false });
    adminUrl = handle.adminUrl;
    stopEmbedded = handle.stop;
    console.info(`[global-db] started embedded PostgreSQL on :${port}`);
  } else {
    console.info(`[global-db] reusing PostgreSQL at ${new URL(adminUrl).host}`);
  }

  const dbName = `lumbung_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  let db: Awaited<ReturnType<typeof createMigratedDatabase>>;
  try {
    // Roles are cluster-wide: keep the passwords configured in .env.local (DATABASE_URL /
    // DATABASE_OWNER_URL) so reusing the dev server never resets the dev credentials.
    db = await createMigratedDatabase(adminUrl, dbName, rolePasswordsFromEnv());
  } catch (err) {
    if (stopEmbedded) await stopEmbedded();
    throw err;
  }
  console.info(`[global-db] ${dbName}: applied ${db.applied.length} migration(s)`);

  project.provide('TEST_DATABASE_URL', db.appUrl);
  project.provide('TEST_DATABASE_OWNER_URL', db.ownerUrl);
  project.provide('TEST_DATABASE_ADMIN_URL', adminUrl);
  project.provide('TEST_DATABASE_NAME', dbName);

  return async () => {
    try {
      await db.drop();
    } finally {
      if (stopEmbedded) await stopEmbedded();
    }
  };
}
