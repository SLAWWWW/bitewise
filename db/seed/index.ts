/**
 * Deterministic demo seed (architecture B). Usable from scripts and tests:
 *
 *   await seedTenant(ownerPoolOrUrl, { slug: 'foodcycle-demo', name: 'FoodCycle Demo',
 *     mode: 'DEMO', seed: 20261026, clock: '2026-10-26T01:00:00Z' });
 *
 * One owner transaction: (optional protected reset via demo_reset_begin) → bulk insert →
 * approval hashes in SQL → manifest → verify_tenant_invariants() must return 0 rows →
 * compare with db/seed/expected-manifest.json (canonical seed + clock only) → COMMIT.
 * Any failure rolls the whole tenant back. IDs are uuidv5 under the tenant slug's
 * namespace, so a reset reconstructs exactly the same identities.
 */
import pg from 'pg';
import { createOwnerPool } from '@/src/db/owner';
import { generateSeed, type GeneratedSeed } from './generate';
import { insertDataset } from './insert';
import { recomputeApprovalHashes, type HashReport } from './hashes';
import {
  computeCounts,
  defaultExpectedPath,
  diffCounts,
  readExpected,
  schemaVersion,
  writeExpected,
  type SeedManifest,
} from './manifest';
import { DEFAULT_SEED_CONFIG, Ids, isCanonicalRun, msOf, type SeedConfig } from './config';

export { generateSeed } from './generate';
export { DEFAULT_SEED_CONFIG } from './config';
export type { SeedConfig } from './config';
export type { SeedManifest } from './manifest';

export interface SeedTenantOptions extends Partial<SeedConfig> {
  /** Delete the existing DEMO/TEST tenant with this slug first (lumbung.demo_reset_begin). */
  reset?: boolean;
  /**
   * Expected-manifest handling for canonical runs (seed 20261026 + default clock):
   *  'compare' (default): compare; write the file if it does not exist yet;
   *  'write': overwrite the file with this run's manifest (--write-expected);
   *  'skip': neither.
   */
  expected?: 'compare' | 'write' | 'skip';
  expectedPath?: string;
  /** Explicit 32-byte contact key (defaults to CONTACT_ENC_KEY / the DEMO dev key). */
  contactKey?: Buffer;
  log?: (msg: string) => void;
}

export interface SeedResult {
  tenantId: string;
  slug: string;
  resetTenantId: string | null;
  manifest: SeedManifest;
  hashes: HashReport;
  expected: 'MATCHED' | 'WRITTEN' | 'SKIPPED';
  warnings: string[];
  generated: Pick<GeneratedSeed, 'flos' | 'meta'>;
}

export class SeedError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SeedError';
  }
}

export async function seedTenant(target: pg.Pool | string, opts: SeedTenantOptions = {}): Promise<SeedResult> {
  if (process.env.APP_MODE === 'LIVE') throw new SeedError('Refusing to seed: APP_MODE=LIVE');
  const { reset = false, expected = 'compare', expectedPath = defaultExpectedPath(), contactKey, log = () => undefined, ...cfgPart } = opts;
  const gen = generateSeed({ ...DEFAULT_SEED_CONFIG, ...cfgPart });
  const cfg = gen.cfg;
  const ownPool = typeof target === 'string';
  const pool = typeof target === 'string' ? createOwnerPool(target, 2) : target;
  const warnings: string[] = [];
  const clockIso = new Date(msOf(cfg.clock)).toISOString();
  let result: SeedResult | undefined;
  let writeAfterCommit: SeedManifest | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('lumbung:seed:' || $1))`, [cfg.slug]);

    // Existing tenant: reset only through the protected function (DEMO/TEST + is_demo).
    const existing = await client.query<{ id: string; mode: string; is_demo: boolean }>(
      `SELECT id, mode, is_demo FROM lumbung.tenants WHERE slug = $1`,
      [cfg.slug],
    );
    let resetTenantId: string | null = null;
    if (existing.rows.length > 0) {
      const t = existing.rows[0];
      if (!reset) throw new SeedError(`Tenant "${cfg.slug}" already exists; use the reset command (npm run db:reset)`);
      if (!['DEMO', 'TEST'].includes(t.mode) || !t.is_demo) {
        throw new SeedError(`Refusing to reset tenant "${cfg.slug}": mode=${t.mode}, is_demo=${t.is_demo}`);
      }
      const r = await client.query<{ id: string | null }>(`SELECT lumbung.demo_reset_begin($1) AS id`, [cfg.slug]);
      resetTenantId = r.rows[0].id;
      log(`reset: deleted tenant ${resetTenantId}`);
    }

    // Some later-stage SQL helpers read the context GUCs; give the seed a SYSTEM context.
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_kind', 'SYSTEM', true),
              set_config('app.correlation_id', $2, true)`,
      [gen.tenantId, `seed:${cfg.slug}:${cfg.seed}`],
    );

    const stats = await insertDataset(client, gen.ds, { contactKey });
    log(`inserted ${Object.values(stats.rows).reduce((a, b) => a + b, 0)} rows in ${stats.statements} statements`);

    // Bulk loading a second tenant can leave the planner estimating one row for
    // a previously unseen tenant. Refresh statistics before cross-ledger joins.
    await client.query('ANALYZE lumbung.flos, lumbung.agreements, lumbung.donation_orders, lumbung.donation_items, lumbung.allocations, lumbung.offers, lumbung.deliveries, lumbung.delivery_lines, lumbung.flo_receipts, lumbung.receipt_lines, lumbung.inventory_batches, lumbung.batch_balances, lumbung.movement_entries, lumbung.evidence_obligations, lumbung.service_schedules, lumbung.category_demands, lumbung.flo_category_capacities');

    const hashes = await recomputeApprovalHashes(client, gen.tenantId);
    if (hashes.allocationInputHash === 'FALLBACK_SQL' || hashes.campaignPlanHash === 'FALLBACK_SQL') {
      warnings.push(
        'approval hashes computed with the inline SQL fallback (lumbung.allocation_input_hash / campaign_plan_hash not defined yet); re-seed after Stage 2 migrations',
      );
    }

    const manifest: SeedManifest = {
      seed: cfg.seed,
      clock: clockIso,
      schema_version: await schemaVersion(client),
      counts: await computeCounts(client, gen.tenantId, clockIso),
    };
    await client.query(
      `INSERT INTO lumbung.seed_manifests (id, tenant_id, seed, clock, schema_version, counts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $4)`,
      [new Ids(cfg.slug).id('seed_manifest', `${cfg.seed}:${clockIso}`), gen.tenantId, cfg.seed, clockIso, manifest.schema_version, JSON.stringify(manifest.counts)],
    );

    const violations = await client.query(`SELECT code, subject_type, subject_id, detail FROM lumbung.verify_tenant_invariants($1)`, [gen.tenantId]);
    if (violations.rows.length > 0) {
      throw new SeedError(`verify_tenant_invariants returned ${violations.rows.length} violation(s)`, violations.rows.slice(0, 20));
    }

    let expectedState: SeedResult['expected'] = 'SKIPPED';
    if (expected !== 'skip' && isCanonicalRun(cfg)) {
      const file = readExpected(expectedPath);
      if (expected === 'write' || !file) {
        writeAfterCommit = manifest;
        expectedState = 'WRITTEN';
      } else {
        const problems: string[] = [];
        if (file.seed !== manifest.seed) problems.push(`seed: expected ${file.seed}, got ${manifest.seed}`);
        if (file.clock !== manifest.clock) problems.push(`clock: expected ${file.clock}, got ${manifest.clock}`);
        problems.push(...diffCounts(file.counts, manifest.counts, 'counts.'));
        if (problems.length > 0) {
          throw new SeedError(`Seed manifest differs from ${expectedPath} (regenerate deliberately with --write-expected)`, problems);
        }
        if (file.schema_version !== manifest.schema_version) {
          warnings.push(
            `schema_version differs from the expected manifest (${file.schema_version} → ${manifest.schema_version}); counts match. Regenerate with --write-expected to record it.`,
          );
        }
        expectedState = 'MATCHED';
      }
    }

    await client.query('COMMIT');
    result = {
      tenantId: gen.tenantId, slug: cfg.slug, resetTenantId, manifest, hashes, expected: expectedState, warnings,
      generated: { flos: gen.flos, meta: gen.meta },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    if (ownPool) await pool.end();
  }
  if (writeAfterCommit) writeExpected(writeAfterCommit, expectedPath);
  return result!;
}
