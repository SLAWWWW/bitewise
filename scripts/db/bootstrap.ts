/**
 * npm run db:bootstrap
 *
 * Idempotently creates the cluster roles (db/bootstrap.sql) and the
 * application database (default `lumbung`) if it does not exist yet.
 * Uses DATABASE_ADMIN_URL (superuser, bootstrap only). Role passwords are
 * taken from DATABASE_OWNER_URL / DATABASE_URL so the URLs always work.
 */
import {
  DEFAULT_ADMIN_URL,
  DEFAULT_APP_URL,
  DEFAULT_OWNER_URL,
  bootstrapCluster,
  createDatabase,
  databaseExists,
  databaseNameOf,
  loadLocalEnv,
  passwordOf,
} from '../../src/db/migrate-lib';

async function main() {
  loadLocalEnv();
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const ownerUrl = process.env.DATABASE_OWNER_URL ?? DEFAULT_OWNER_URL;
  const appUrl = process.env.DATABASE_URL ?? DEFAULT_APP_URL;
  const dbName = databaseNameOf(ownerUrl);
  if (databaseNameOf(appUrl) !== dbName) {
    throw new Error(`DATABASE_URL and DATABASE_OWNER_URL point at different databases`);
  }
  const ownerPassword = passwordOf(ownerUrl) ?? 'lumbung_owner';
  const appPassword = passwordOf(appUrl) ?? 'lumbung_app';
  if ((process.env.APP_MODE ?? 'DEMO') === 'LIVE' && (ownerPassword === 'lumbung_owner' || appPassword === 'lumbung_app')) {
    throw new Error('APP_MODE=LIVE refuses the development role passwords; set real ones in the URLs.');
  }

  await bootstrapCluster(adminUrl, { ownerPassword, appPassword });
  process.stdout.write('roles lumbung_owner / lumbung_app: ok\n');
  if (await databaseExists(adminUrl, dbName)) {
    process.stdout.write(`database ${dbName}: already exists\n`);
  } else {
    await createDatabase(adminUrl, dbName);
    process.stdout.write(`database ${dbName}: created (owner lumbung_owner, schema lumbung)\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`db:bootstrap failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
