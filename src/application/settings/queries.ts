/**
 * Pengaturan read model (PRD §16, §17 runtime modes, §27 production activation).
 *
 *  - policy versions (code, version, status APPROVED_DEMO vs APPROVED_LIVE, body summary)
 *  - the production readiness checklist = activation_decisions, completed to all 10 PRD
 *    §27 keys so a missing row is shown as "not recorded" rather than silently dropped
 *  - the tenant clock
 *
 * Call inside `withTx(actorCtx(actor), ...)` (RLS-scoped reads only).
 */
import type { Queryable } from '@/src/db/types';
import {
  ACTIVATION_DECISION_KEYS,
  POLICY_KINDS,
  type ActivationDecisionKey,
  type ClockMode,
  type PolicyKind,
  type PolicyStatus,
  type TenantMode,
} from '@/src/shared/enums';

export interface PolicyVersionRow {
  id: string;
  kind: PolicyKind;
  code: string;
  version: string;
  status: PolicyStatus;
  body: unknown;
  approved_at: string | null;
  approved_by_name: string | null;
  /** Selected in tenant_active_policies for its kind. */
  is_active: boolean;
  /** Only APPROVED_LIVE versions may drive live commands (PRD §27, architecture F.14). */
  live_allowed: boolean;
}

export type DecisionStatus = 'NOT_DECIDED' | 'APPROVED' | 'MISSING';

export interface ActivationDecisionRow {
  key: ActivationDecisionKey;
  status: DecisionStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  notes: string | null;
  /** Whether the affected live capability may be enabled right now. */
  live_enabled: boolean;
  /** Why it is disabled (null when enabled). */
  disabled_reason: 'NOT_DECIDED' | 'MISSING' | 'TENANT_NOT_LIVE' | null;
}

export interface SettingsSnapshot {
  now: string | null;
  clockMode: ClockMode | null;
  policies: PolicyVersionRow[];
  decisions: ActivationDecisionRow[];
  approvedDecisionCount: number;
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : (v instanceof Date ? v : new Date(v)).toISOString();

/**
 * Live capability gate for one decision. Pure, so the same rule can be reused by
 * command guards later: approved AND the tenant is LIVE.
 */
export function decisionGate(
  status: DecisionStatus,
  tenantMode: TenantMode,
): Pick<ActivationDecisionRow, 'live_enabled' | 'disabled_reason'> {
  if (status === 'MISSING') return { live_enabled: false, disabled_reason: 'MISSING' };
  if (status !== 'APPROVED') return { live_enabled: false, disabled_reason: 'NOT_DECIDED' };
  if (tenantMode !== 'LIVE') return { live_enabled: false, disabled_reason: 'TENANT_NOT_LIVE' };
  return { live_enabled: true, disabled_reason: null };
}

export async function loadSettings(c: Queryable, tenantMode: TenantMode): Promise<SettingsSnapshot> {
  const clock = await c.query<{ now: Date; mode: ClockMode | null }>(
    `SELECT lumbung.tenant_now() AS now,
            (SELECT k.mode FROM lumbung.tenant_clocks k WHERE k.tenant_id = lumbung.current_tenant()) AS mode`,
  );

  const policies = await c.query<{
    id: string;
    kind: PolicyKind;
    code: string;
    version: string;
    status: PolicyStatus;
    body: unknown;
    approved_at: Date | null;
    approved_by_name: string | null;
    is_active: boolean;
  }>(
    `SELECT p.id, p.kind, p.code, p.version, p.status, p.body, p.approved_at,
            u.display_name AS approved_by_name,
            EXISTS (SELECT 1 FROM lumbung.tenant_active_policies tap
                     WHERE tap.kind = p.kind AND tap.policy_version_id = p.id) AS is_active
       FROM lumbung.policy_versions p
       LEFT JOIN lumbung.users u ON u.id = p.approved_by
      ORDER BY array_position($1::text[], p.kind), p.code COLLATE "C", p.id`,
    [POLICY_KINDS as readonly string[]],
  );

  const decisions = await c.query<{
    key: ActivationDecisionKey;
    status: 'NOT_DECIDED' | 'APPROVED';
    approved_at: Date | null;
    approved_by_name: string | null;
    notes: string | null;
  }>(
    `SELECT d.key, d.status, d.approved_at, u.display_name AS approved_by_name, d.notes
       FROM lumbung.activation_decisions d
       LEFT JOIN lumbung.users u ON u.id = d.approved_by`,
  );
  const byKey = new Map(decisions.rows.map((r) => [r.key, r]));
  const decisionRows: ActivationDecisionRow[] = ACTIVATION_DECISION_KEYS.map((key) => {
    const r = byKey.get(key);
    const status: DecisionStatus = r ? r.status : 'MISSING';
    return {
      key,
      status,
      approved_at: iso(r?.approved_at ?? null),
      approved_by_name: r?.approved_by_name ?? null,
      notes: r?.notes ?? null,
      ...decisionGate(status, tenantMode),
    };
  });

  return {
    now: iso(clock.rows[0]?.now ?? null),
    clockMode: clock.rows[0]?.mode ?? null,
    policies: policies.rows.map((p) => ({
      ...p,
      approved_at: iso(p.approved_at),
      live_allowed: p.status === 'APPROVED_LIVE',
    })),
    decisions: decisionRows,
    approvedDecisionCount: decisionRows.filter((d) => d.status === 'APPROVED').length,
  };
}

/* ------------------------------------------------------------------------------------
 * Policy body summary (pure). Bodies are seed/policy-owner defined JSON; we never assume
 * a schema beyond "weights is an object of numbers" (ALLOC-DEMO-2.0, architecture C).
 * ---------------------------------------------------------------------------------- */

export interface PolicySummaryPart {
  /** Field name as stored in the body (shown verbatim, monospace). */
  key: string;
  /** Display text for the value. */
  value: string;
}

export interface PolicySummary {
  weights: PolicySummaryPart[];
  fields: PolicySummaryPart[];
  /** Fields not shown because of the limit. */
  hidden: number;
  empty: boolean;
}

function scalarText(v: unknown): string | null {
  if (v === null) return 'null';
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 39)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number') && v.length <= 6) {
    return v.join(', ');
  }
  return null;
}

/** Summarise a policy body: `weights` first, then scalar top-level fields (sorted). */
export function summarizePolicyBody(body: unknown, maxFields = 6): PolicySummary {
  if (body === null || body === undefined) return { weights: [], fields: [], hidden: 0, empty: true };
  if (typeof body !== 'object' || Array.isArray(body)) {
    const s = scalarText(body);
    return { weights: [], fields: s ? [{ key: 'value', value: s }] : [], hidden: 0, empty: !s };
  }
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return { weights: [], fields: [], hidden: 0, empty: true };

  const weights: PolicySummaryPart[] = [];
  const w = obj.weights;
  if (w && typeof w === 'object' && !Array.isArray(w)) {
    for (const k of Object.keys(w).sort()) {
      const v = (w as Record<string, unknown>)[k];
      if (typeof v === 'number' || typeof v === 'string') weights.push({ key: k, value: String(v) });
    }
  }

  const fields: PolicySummaryPart[] = [];
  let hidden = 0;
  for (const k of keys) {
    if (k === 'weights' && weights.length) continue;
    const s = scalarText(obj[k]);
    if (s === null) {
      hidden++;
      continue;
    }
    if (fields.length < maxFields) fields.push({ key: k, value: s });
    else hidden++;
  }
  return { weights, fields, hidden, empty: false };
}
