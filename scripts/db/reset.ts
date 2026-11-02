/**
 * npm run db:reset [-- --slug foodcycle-demo]
 *
 * Protected demo reset: refuses APP_MODE=LIVE and any tenant that is not DEMO/TEST
 * with is_demo; deletes the tenant through lumbung.demo_reset_begin (cascade, inside
 * one owner transaction) and re-seeds the same deterministic data and identities.
 * Other tenants are untouched.
 */
import pg from 'pg';
import { DEFAULT_OWNER_URL, loadLocalEnv } from '../../src/db/migrate-lib';
import { seedTenant } from '../../db/seed';
import { assertNotLive, parseSeedArgs } from './seed';

async function main() {
  loadLocalEnv();
  assertNotLive();
  const args = parseSeedArgs(process.argv.slice(2));
  const slug = args.slug ?? 'foodcycle-demo';
  const ownerUrl = process.env.DATABASE_OWNER_URL ?? DEFAULT_OWNER_URL;

  // Fail early with a clear message for LIVE / non-demo tenants (the SQL function
  // also refuses with LB:RESET_FORBIDDEN).
  const probe = new pg.Client({ connectionString: ownerUrl, application_name: 'lumbung-reset' });
  await probe.connect();
  try {
    const { rows } = await probe.query<{ mode: string; is_demo: boolean }>(
      `SELECT mode, is_demo FROM lumbung.tenants WHERE slug = $1`,
      [slug],
    );
    if (rows.length > 0 && (!['DEMO', 'TEST'].includes(rows[0].mode) || !rows[0].is_demo)) {
      throw new Error(`Refusing to reset tenant "${slug}": mode=${rows[0].mode}, is_demo=${rows[0].is_demo}`);
    }
  } finally {
    await probe.end();
  }

  const started = performance.now();
  const res = await seedTenant(ownerUrl, { ...args, slug, reset: true, log: (m) => process.stdout.write(`  ${m}\n`) });
  process.stdout.write(
    `reset tenant ${res.slug}: ${res.resetTenantId ? 'deleted and re-seeded' : 'was absent, seeded'} (${res.tenantId}) in ` +
      `${Math.round(performance.now() - started)} ms; expected-manifest=${res.expected}\n`,
  );
  for (const w of res.warnings) process.stderr.write(`warning: ${w}\n`);
}

main().catch((err) => {
  process.stderr.write(`db:reset failed: ${err instanceof Error ? err.message : String(err)}\n`);
  const details = (err as { details?: unknown }).details;
  if (details) process.stderr.write(`${JSON.stringify(details, null, 2)}\n`);
  process.exit(1);
});
