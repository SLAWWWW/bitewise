/**
 * npm run db:seed [-- --slug foodcycle-demo --write-expected --skip-expected]
 *
 * Seeds the deterministic demo tenant (architecture B) as lumbung_owner
 * (DATABASE_OWNER_URL). Refuses APP_MODE=LIVE. Fails when the tenant already exists
 * (use npm run db:reset). Writes db/seed/expected-manifest.json on the first canonical
 * run and compares with it afterwards; --write-expected regenerates it deliberately.
 */
import { DEFAULT_OWNER_URL, loadLocalEnv } from '../../src/db/migrate-lib';
import { seedTenant, type SeedTenantOptions } from '../../db/seed';

export function parseSeedArgs(argv: string[]): Pick<SeedTenantOptions, 'slug' | 'name' | 'expected'> {
  const out: Pick<SeedTenantOptions, 'slug' | 'name' | 'expected'> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug') out.slug = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--write-expected') out.expected = 'write';
    else if (a === '--skip-expected') out.expected = 'skip';
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

export function assertNotLive(): void {
  if ((process.env.APP_MODE ?? 'DEMO') === 'LIVE') {
    throw new Error('Refusing to run: APP_MODE=LIVE (seed and reset are demo-only)');
  }
}

async function main() {
  loadLocalEnv();
  assertNotLive();
  const args = parseSeedArgs(process.argv.slice(2));
  const ownerUrl = process.env.DATABASE_OWNER_URL ?? DEFAULT_OWNER_URL;
  const started = performance.now();
  const res = await seedTenant(ownerUrl, { ...args, log: (m) => process.stdout.write(`  ${m}\n`) });
  const c = res.manifest.counts as Record<string, unknown>;
  process.stdout.write(
    `seeded tenant ${res.slug} (${res.tenantId}) in ${Math.round(performance.now() - started)} ms\n` +
      `  flos=${c.flos} orders=${c.donation_orders} allocations=${c.allocations} receipts=${c.flo_receipts} batches=${c.inventory_batches}\n` +
      `  schema_version=${res.manifest.schema_version} expected-manifest=${res.expected}\n`,
  );
  for (const w of res.warnings) process.stderr.write(`warning: ${w}\n`);
}

if (process.argv[1] && /scripts[\\/]db[\\/]seed\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`db:seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
    const details = (err as { details?: unknown }).details;
    if (details) process.stderr.write(`${JSON.stringify(details, null, 2)}\n`);
    process.exit(1);
  });
}
