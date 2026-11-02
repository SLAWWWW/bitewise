/**
 * npm run db:migrate
 *
 * Applies pending db/migrations/NNNN_*.sql as lumbung_owner
 * (DATABASE_OWNER_URL), one transaction per file, tracked in
 * lumbung.schema_migrations. Refuses edited (checksum) or missing files.
 */
import { DEFAULT_OWNER_URL, databaseNameOf, loadLocalEnv, runMigrations } from '../../src/db/migrate-lib';

async function main() {
  loadLocalEnv();
  const ownerUrl = process.env.DATABASE_OWNER_URL ?? DEFAULT_OWNER_URL;
  const applied = await runMigrations(ownerUrl, {
    onApplied: (name) => process.stdout.write(`applied ${name}\n`),
    onWarning: (msg) => process.stderr.write(`warning: ${msg}\n`),
  });
  process.stdout.write(
    applied.length === 0
      ? `database ${databaseNameOf(ownerUrl)}: up to date\n`
      : `database ${databaseNameOf(ownerUrl)}: applied ${applied.length} migration(s)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`db:migrate failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
