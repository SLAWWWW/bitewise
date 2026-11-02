/**
 * Bulk insert of a generated dataset as the owner role:
 *   INSERT INTO lumbung.<t> (cols) SELECT cols FROM jsonb_to_recordset($1::jsonb) AS x(col type, ...)
 * in chunks of 1000 rows, in TABLE_ORDER (FK-safe), followed by deferred updates for
 * circular references. Contact addresses (`__plain`) are encrypted here with
 * AES-256-GCM (src/security/crypto.ts, CONTACT_ENC_KEY) and never stored in clear.
 */
import type pg from 'pg';
import { encryptContact } from '@/src/security/crypto';
import { TABLE_ORDER, type Dataset, type Row, type TableName } from './dataset';

const CHUNK = 1000;

type Queryable = Pick<pg.PoolClient, 'query'>;

async function columnTypes(c: Queryable, table: string): Promise<Map<string, string>> {
  const { rows } = await c.query<{ attname: string; type: string }>(
    `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = ('lumbung.' || quote_ident($1))::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    [table],
  );
  return new Map(rows.map((r) => [r.attname, r.type]));
}

const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;

function prepareRow(table: TableName, row: Row, key?: Buffer): Row {
  if (!('__plain' in row)) return row;
  const { __plain, ...rest } = row;
  if (table !== 'flo_contacts' && table !== 'donor_contacts') throw new Error(`__plain on unexpected table ${table}`);
  const blob = encryptContact(String(__plain), key ? { key } : {});
  return { ...rest, address_ciphertext: `\\x${blob.toString('hex')}` };
}

export interface InsertStats {
  rows: Record<string, number>;
  statements: number;
}

export async function insertDataset(c: Queryable, ds: Dataset, opts: { contactKey?: Buffer } = {}): Promise<InsertStats> {
  const stats: InsertStats = { rows: {}, statements: 0 };
  const deferredCols = new Map<string, Set<string>>();
  for (const d of ds.deferred) {
    const set = deferredCols.get(d.table) ?? new Set();
    set.add(d.column);
    deferredCols.set(d.table, set);
  }
  for (const table of TABLE_ORDER) {
    const rows = ds.rows(table);
    if (rows.length === 0) continue;
    const types = await columnTypes(c, table);
    const colSet = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) if (k !== '__plain') colSet.add(k);
    if (rows.some((r) => '__plain' in r)) colSet.add('address_ciphertext');
    const cols = [...colSet].sort();
    for (const col of cols) {
      if (!types.has(col)) throw new Error(`seed: unknown column ${table}.${col}`);
    }
    const deferred = deferredCols.get(table);
    if (deferred) for (const col of deferred) if (rows.some((r) => r[col] !== null && r[col] !== undefined)) {
      throw new Error(`seed: deferred column ${table}.${col} must be null at insert`);
    }
    const colList = cols.map(qi).join(', ');
    const recordDef = cols.map((col) => `${qi(col)} ${types.get(col)}`).join(', ');
    const conflict =
      table === 'users'
        ? ' ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, kind = EXCLUDED.kind, updated_at = EXCLUDED.updated_at'
        : '';
    const sql = `INSERT INTO lumbung.${qi(table)} (${colList}) SELECT ${colList} FROM jsonb_to_recordset($1::jsonb) AS x(${recordDef})${conflict}`;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => prepareRow(table, r, opts.contactKey));
      await c.query(sql, [JSON.stringify(chunk)]);
      stats.statements++;
    }
    stats.rows[table] = rows.length;
  }
  for (const d of ds.deferred) {
    const types = await columnTypes(c, d.table);
    const type = types.get(d.column);
    if (!type) throw new Error(`seed: unknown deferred column ${d.table}.${d.column}`);
    for (let i = 0; i < d.rows.length; i += CHUNK) {
      const chunk = d.rows.slice(i, i + CHUNK);
      await c.query(
        `UPDATE lumbung.${qi(d.table)} AS t SET ${qi(d.column)} = x.value
           FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, value ${type})
          WHERE t.id = x.id`,
        [JSON.stringify(chunk)],
      );
      stats.statements++;
    }
  }
  return stats;
}
