/**
 * tsx scripts/db/create-test-db.ts [db_name] [--keep-existing]
 *
 * Creates a fresh, migrated database for tests (default `lumbung_test`):
 * bootstrap roles, DROP DATABASE IF EXISTS ... WITH (FORCE) (unless
 * --keep-existing), CREATE, migrate. Admin connection from
 * TEST_DATABASE_ADMIN_URL, else DATABASE_ADMIN_URL, else the G.1 default.
 * Prints TEST_DATABASE_URL / TEST_DATABASE_OWNER_URL.
 */
import {
  DEFAULT_ADMIN_URL,
  assertDbName,
  createMigratedDatabase,
  databaseExists,
  dropDatabase,
  loadLocalEnv,
} from '../../src/db/migrate-lib';

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const keep = args.includes('--keep-existing');
  const dbName = args.find((a) => !a.startsWith('--')) ?? 'lumbung_test';
  assertDbName(dbName);
  if (dbName === 'lumbung') throw new Error('Refusing to recreate the development database "lumbung".');
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL;

  if (await databaseExists(adminUrl, dbName)) {
    if (keep) throw new Error(`database ${dbName} already exists (--keep-existing)`);
    await dropDatabase(adminUrl, dbName);
  }
  const db = await createMigratedDatabase(adminUrl, dbName);
  process.stdout.write(
    [
      `database ${dbName}: created and migrated (${db.applied.length} migrations)`,
      `TEST_DATABASE_URL=${db.appUrl}`,
      `TEST_DATABASE_OWNER_URL=${db.ownerUrl}`,
      '',
    ].join('\n'),
  );
}

main().catch((err) => {
  process.stderr.write(`create-test-db failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
