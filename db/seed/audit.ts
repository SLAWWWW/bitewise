/**
 * Audit trail rows for seeded historical actions (append-only table; created_at is the
 * simulated occurrence time, never the wall clock).
 */
import { iso, type Ids } from './config';
import type { Dataset } from './dataset';

export interface AuditInput {
  key: string;
  actorId: string | null;
  actorKind?: 'USER' | 'WORKER' | 'AGENT' | 'FLO_LINK' | 'SYSTEM';
  action: string;
  subjectType: string;
  subjectId: string | null;
  subjectRevision?: number | null;
  policyVersionId?: string | null;
  reason?: string | null;
  at: number;
  payload?: Record<string, unknown>;
}

export function addAudit(ds: Dataset, ids: Ids, a: AuditInput): void {
  const at = iso(a.at);
  ds.add('audit_events', {
    id: ids.id('audit', a.key),
    tenant_id: ids.tenantId,
    actor_id: a.actorId,
    actor_kind: a.actorKind ?? 'USER',
    action: a.action,
    subject_type: a.subjectType,
    subject_id: a.subjectId,
    subject_revision: a.subjectRevision ?? null,
    policy_version_id: a.policyVersionId ?? null,
    reason: a.reason ?? null,
    before_hash: null,
    after_hash: null,
    correlation_id: `seed:${a.key}`,
    occurred_at: at,
    payload: { seeded: true, ...(a.payload ?? {}) },
    created_at: at,
    created_by: a.actorId,
  });
}
