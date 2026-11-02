/**
 * AC01 (pure part): the generator is deterministic — two runs are deep-equal, ids are
 * uuidv5 per tenant slug, counts do not depend on the slug, and the seed code never
 * touches Math.random / Date.now / argument-less new Date() / random UUIDs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSeed } from '@/db/seed/generate';
import { TABLE_ORDER } from '@/db/seed/dataset';
import { entityId, tenantNamespace } from '@/src/lib/uuidv5';

const root = path.resolve(__dirname, '../../..');

function snapshot(slug?: string) {
  const g = generateSeed(slug ? { slug } : {});
  return { tables: Object.fromEntries(TABLE_ORDER.map((t) => [t, g.ds.rows(t)])), deferred: g.ds.deferred, flos: g.flos, meta: g.meta };
}

afterEach(() => vi.restoreAllMocks());

describe('seed determinism', () => {
  it('two runs with the same config are deep-equal', () => {
    const a = snapshot();
    const b = snapshot();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('runs without Math.random or Date.now (spies throw)', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now used');
    });
    expect(() => generateSeed()).not.toThrow();
  });

  it('ids are uuidv5 under the tenant slug namespace; another slug gives other ids but the same volumes', () => {
    const a = generateSeed();
    const b = generateSeed({ slug: 'seed-other-slug' });
    const ns = tenantNamespace('foodcycle-demo');
    expect(a.tenantId).toBe(entityId(ns, 'tenant', 'foodcycle-demo'));
    expect(a.flos[0].id).toBe(entityId(ns, 'flo', 'FLO-0001'));
    expect(b.flos[0].id).not.toBe(a.flos[0].id);
    for (const t of TABLE_ORDER) expect(b.ds.count(t), t).toBe(a.ds.count(t));
    const withoutId = (fs: typeof a.flos) => fs.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'id')));
    expect(withoutId(b.flos)).toEqual(withoutId(a.flos));
  });

  it('a different seed changes the shuffles but keeps exact marginals', () => {
    const a = generateSeed();
    const c = generateSeed({ seed: 7 });
    expect(c.flos.map((f) => f.area)).not.toEqual(a.flos.map((f) => f.area));
    const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
    expect(count(c.flos.map((f) => f.area))).toEqual(count(a.flos.map((f) => f.area)));
    expect(count(c.flos.map((f) => f.agreementClass))).toEqual(count(a.flos.map((f) => f.agreementClass)));
  });

  it('every row id is unique per table', () => {
    const g = generateSeed();
    for (const t of TABLE_ORDER) {
      const ids = g.ds.rows(t).map((r) => r.id).filter((x) => x !== undefined);
      expect(new Set(ids).size, t).toBe(ids.length);
    }
  });

  it('seed sources never use Math.random, Date.now, new Date() without arguments or random UUIDs', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|mts|js)$/.test(name)) files.push(p);
      }
    };
    walk(path.join(root, 'db', 'seed'));
    files.push(path.join(root, 'scripts', 'db', 'seed.ts'), path.join(root, 'scripts', 'db', 'reset.ts'));
    expect(files.length).toBeGreaterThan(10);
    const banned = [/Math\.random\s*\(/, /Date\.now\s*\(/, /new Date\(\s*\)/, /gen_random_uuid/, /randomUUID/, /randomBytes/];
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const re of banned) expect(re.test(src), `${path.relative(root, f)} matches ${re}`).toBe(false);
    }
  });
});
