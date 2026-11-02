/**
 * Opaque keyset cursors: base64url(JSON [sortKey, id]). Stable sort = (sortKey, id).
 */
import { z } from 'zod';
import { DomainError } from '@/src/db/errors';

export type SortKey = string | number | null;
export type Cursor = [SortKey, string];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function encodeCursor(sortKey: SortKey | Date, id: string): string {
  const k = sortKey instanceof Date ? sortKey.toISOString() : sortKey;
  return Buffer.from(JSON.stringify([k, id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Cursor {
  const bad = () =>
    new DomainError({ code: 'BAD_REQUEST', message: 'Invalid cursor', field_errors: { cursor: ['Invalid cursor'] } });
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw bad();
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (
    !Array.isArray(v) ||
    v.length !== 2 ||
    typeof v[1] !== 'string' ||
    !(v[0] === null || typeof v[0] === 'string' || (typeof v[0] === 'number' && Number.isFinite(v[0])))
  ) {
    throw bad();
  }
  return [v[0] as SortKey, v[1]];
}

/** zod schema for `?cursor=&limit=` query params. */
export const paginationQuery = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * Given rows fetched with `LIMIT limit + 1`, trim and compute the next cursor.
 */
export function toPage<T>(rows: T[], limit: number, keyOf: (row: T) => [SortKey | Date, string]): Page<T> {
  if (rows.length <= limit) return { items: rows, next_cursor: null };
  const items = rows.slice(0, limit);
  const [k, id] = keyOf(items[items.length - 1]);
  return { items, next_cursor: encodeCursor(k, id) };
}
