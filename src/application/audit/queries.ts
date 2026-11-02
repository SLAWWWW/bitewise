/**
 * Audit timeline read model (PRD §16 "audit timeline", §22). Shared by
 * `GET /api/audit` and the `/audit` page.
 *
 * Order: newest first, `(occurred_at DESC, seq DESC)` — a total order, so keyset
 * pagination is stable (no skipped or repeated rows when new events are appended
 * while paging). `seq` (identity, migration 0015) is the insertion order: under the
 * FROZEN demo clock every command stamps the same tenant_now(), so ties must follow the
 * order in which things happened, never random UUIDs. The cursor's sort key is the exact
 * microsecond instant rendered by Postgres (a JS Date would truncate to milliseconds and
 * break ties) plus the seq as a decimal string (bigint).
 *
 * Date filters are local calendar dates in the tenant time zone (WIB by default):
 * `from` = start of that local day (inclusive), `to` = end of that local day
 * (exclusive start of the next day), converted by SQL `AT TIME ZONE`.
 *
 * Call inside `withTx(actorCtx(actor), ...)`; RLS restricts rows to the tenant.
 */
import { z } from 'zod';
import { DomainError } from '@/src/db/errors';
import type { Queryable } from '@/src/db/types';
import { ACTOR_KINDS, type ActorKind } from '@/src/db/types';
import { decodeCursor, paginationQuery, toPage, type Page } from '@/src/http/pagination';

/** Empty query-string values ("?action=") mean "no filter". */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(blankToUndefined, s.optional());

/** Identifiers stored in audit_events (action / subject_type), e.g. 'agreement.approve', 'AGREEMENT'. */
const identifier = z.string().max(100).regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid identifier');

const filterShape = {
  subject_type: opt(identifier),
  action: opt(identifier),
  actor_id: opt(z.uuid()),
  actor_kind: opt(z.enum(ACTOR_KINDS)),
  subject_id: opt(z.uuid()),
  from: opt(z.iso.date()),
  to: opt(z.iso.date()),
};

const dateOrder = {
  check: (f: { from?: string; to?: string }) => !f.from || !f.to || f.from <= f.to,
  params: { message: '"from" must be on or before "to"', path: ['to'] },
};

export const auditFilterSchema = z.object(filterShape).refine(dateOrder.check, dateOrder.params);

export type AuditFilters = z.infer<typeof auditFilterSchema>;

/** Query schema for GET /api/audit: filters + `cursor` + `limit`. */
export const auditListQuery = z
  .object({
    ...filterShape,
    cursor: opt(paginationQuery.shape.cursor.unwrap()),
    limit: z.preprocess(blankToUndefined, paginationQuery.shape.limit),
  })
  .refine(dateOrder.check, dateOrder.params);

export type AuditListQuery = z.infer<typeof auditListQuery>;

export interface AuditEventItem {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_kind: ActorKind;
  actor_name: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  subject_revision: number | null;
  reason: string | null;
  policy_code: string | null;
  correlation_id: string | null;
  payload: unknown;
}

const SORT_KEY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const SEQ_RE = /^[1-9]\d{0,18}$/;

function badCursor(): DomainError {
  return new DomainError({ code: 'BAD_REQUEST', message: 'Invalid cursor', field_errors: { cursor: ['Invalid cursor'] } });
}

/** Decode and validate an audit cursor → [occurred_at µs ISO, seq]. */
export function decodeAuditCursor(cursor: string): [string, string] {
  const [k, seq] = decodeCursor(cursor);
  if (typeof k !== 'string' || !SORT_KEY_RE.test(k) || !SEQ_RE.test(seq)) throw badCursor();
  return [k, seq];
}

export async function listAuditEvents(
  c: Queryable,
  q: AuditFilters & { cursor?: string; limit: number },
  tz: string,
): Promise<Page<AuditEventItem>> {
  const after = q.cursor ? decodeAuditCursor(q.cursor) : null;
  const r = await c.query<AuditEventItem & { sort_key: string; seq: string; occurred_at: Date }>(
    `SELECT e.id, e.seq, e.occurred_at,
            to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_key,
            e.actor_id, e.actor_kind, u.display_name AS actor_name, e.action, e.subject_type,
            e.subject_id, e.subject_revision, e.reason, p.code AS policy_code, e.correlation_id, e.payload
       FROM lumbung.audit_events e
       LEFT JOIN lumbung.users u ON u.id = e.actor_id
       LEFT JOIN lumbung.policy_versions p ON p.id = e.policy_version_id
      WHERE ($1::text IS NULL OR e.subject_type = $1)
        AND ($2::text IS NULL OR e.action = $2)
        AND ($3::uuid IS NULL OR e.actor_id = $3)
        AND ($4::text IS NULL OR e.actor_kind = $4)
        AND ($5::uuid IS NULL OR e.subject_id = $5)
        AND ($6::date IS NULL OR e.occurred_at >= ($6::date)::timestamp AT TIME ZONE $8::text)
        AND ($7::date IS NULL OR e.occurred_at < ($7::date + 1)::timestamp AT TIME ZONE $8::text)
        AND ($9::timestamptz IS NULL OR (e.occurred_at, e.seq) < ($9::timestamptz, $10::bigint))
      ORDER BY e.occurred_at DESC, e.seq DESC
      LIMIT $11`,
    [
      q.subject_type ?? null,
      q.action ?? null,
      q.actor_id ?? null,
      q.actor_kind ?? null,
      q.subject_id ?? null,
      q.from ?? null,
      q.to ?? null,
      tz,
      after?.[0] ?? null,
      after?.[1] ?? null,
      q.limit + 1,
    ],
  );
  const page = toPage(r.rows, q.limit, (row) => [row.sort_key, row.seq]);
  return {
    next_cursor: page.next_cursor,
    items: page.items.map((row) => {
      const item: AuditEventItem & { sort_key?: string; seq?: string } = { ...row, occurred_at: row.occurred_at.toISOString() };
      delete item.sort_key; // internal keyset key, not part of the API
      delete item.seq;
      return item;
    }),
  };
}

export interface AuditFilterOptions {
  subjectTypes: string[];
  actions: string[];
  actors: { id: string; name: string | null }[];
  actorKinds: ActorKind[];
}

/** Distinct values present in this tenant's audit trail, for the filter controls. */
export async function auditFilterOptions(c: Queryable, max = 200): Promise<AuditFilterOptions> {
  // Sequential on purpose: one pg client cannot run queries concurrently.
  const types = await c.query<{ v: string }>(
    `SELECT DISTINCT subject_type COLLATE "C" AS v FROM lumbung.audit_events ORDER BY v LIMIT $1`,
    [max],
  );
  const actions = await c.query<{ v: string }>(
    `SELECT DISTINCT action COLLATE "C" AS v FROM lumbung.audit_events ORDER BY v LIMIT $1`,
    [max],
  );
  const actors = await c.query<{ id: string; name: string | null }>(
    `SELECT a.id, u.display_name AS name
       FROM (SELECT DISTINCT actor_id AS id FROM lumbung.audit_events WHERE actor_id IS NOT NULL) a
       LEFT JOIN lumbung.users u ON u.id = a.id
      ORDER BY u.display_name COLLATE "C" NULLS LAST, a.id
      LIMIT $1`,
    [max],
  );
  const kinds = await c.query<{ v: ActorKind }>(`SELECT DISTINCT actor_kind AS v FROM lumbung.audit_events ORDER BY v`);
  return {
    subjectTypes: types.rows.map((r) => r.v),
    actions: actions.rows.map((r) => r.v),
    actors: actors.rows,
    actorKinds: kinds.rows.map((r) => r.v),
  };
}
