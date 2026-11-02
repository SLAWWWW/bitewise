/**
 * GET /api/audit — the tenant's audit timeline, newest first (capability audit.read).
 *
 *   ?subject_type=&action=&actor_id=&actor_kind=&subject_id=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   &cursor=<opaque>&limit=1..200 (default 50)
 *
 * Response: { data: { items: AuditEventItem[], next_cursor: string | null }, correlation_id }
 * Dates are local calendar days in the tenant time zone (WIB). The cursor is opaque
 * (src/http/pagination) and stable under concurrent appends.
 */
import { handler } from '@/src/http/handler';
import { auditListQuery, listAuditEvents } from '@/src/application/audit/queries';

export const GET = handler(
  { capability: 'audit.read', query: auditListQuery },
  async ({ actor, query, tx }) => {
    const { cursor, limit, ...filters } = query;
    return tx((c) => listAuditEvents(c, { ...filters, cursor, limit }, actor.tenantTimezone));
  },
);
