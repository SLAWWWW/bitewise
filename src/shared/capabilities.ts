/**
 * Capability strings (architecture G.3) — the single source. Seed memberships use
 * exactly these strings and `lumbung.require_cap(text)` checks them in SQL.
 */

export const CAPABILITIES = [
  'flo.read',
  'flo.edit',
  'need.propose',
  'need.confirm',
  'agreement.upload',
  'agreement.review',
  'donation.create',
  'donation.validate',
  'allocation.run',
  'outreach.approve',
  'campaign.start',
  'offer.respond',
  'transport.edit',
  'dispatch.approve',
  'delivery.dispatch',
  'delivery.receive',
  'volunteer.read',
  'volunteer.manage',
  'route.read',
  'route.manage',
  'route.claim',
  'route.progress',
  'reservation.release',
  'receipt.correct',
  'receipt.correct.approve',
  'inventory.receive',
  'inventory.inspect',
  'inventory.quarantine_release',
  'inventory.pick',
  'inventory.adjust.request',
  'inventory.adjust.approve',
  'inventory.recall',
  'evidence.submit',
  'evidence.review',
  'evidence.excuse',
  'conversation.takeover',
  'message.send',
  'import.preview',
  'import.commit',
  'policy.manage',
  'users.manage',
  'audit.read',
  'media.sensitive.read',
  'demo.clock',
  'demo.reset',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(s: string): s is Capability {
  return (CAPABILITIES as readonly string[]).includes(s);
}

export const ROLES = [
  'ADMIN',
  'COORDINATOR',
  'WAREHOUSE',
  'WAREHOUSE_SUPERVISOR',
  'AGREEMENT_REVIEWER',
  'EVIDENCE_REVIEWER',
  'AUDITOR',
  'VOLUNTEER',
] as const;
export type Role = (typeof ROLES)[number];

const WAREHOUSE: readonly Capability[] = [
  'flo.read',
  'inventory.receive',
  'inventory.inspect',
  'inventory.quarantine_release',
  'inventory.pick',
  'inventory.adjust.request',
  'delivery.dispatch',
  'audit.read',
];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  ADMIN: [
    'users.manage',
    'policy.manage',
    'audit.read',
    'flo.read',
    'media.sensitive.read',
    'demo.clock',
    'demo.reset',
    'import.preview',
    'import.commit',
    'volunteer.read',
    'volunteer.manage',
    'route.read',
    'route.manage',
  ],
  COORDINATOR: [
    'flo.read',
    'flo.edit',
    'need.propose',
    'need.confirm',
    'donation.create',
    'donation.validate',
    'allocation.run',
    'outreach.approve',
    'campaign.start',
    'offer.respond',
    'transport.edit',
    'dispatch.approve',
    'delivery.dispatch',
    'delivery.receive',
    'volunteer.read',
    'volunteer.manage',
    'route.read',
    'route.manage',
    'reservation.release',
    'receipt.correct',
    'evidence.submit',
    'conversation.takeover',
    'message.send',
    'audit.read',
    'demo.clock',
  ],
  WAREHOUSE,
  WAREHOUSE_SUPERVISOR: [...WAREHOUSE, 'inventory.adjust.approve', 'inventory.recall', 'receipt.correct.approve'],
  AGREEMENT_REVIEWER: ['flo.read', 'agreement.upload', 'agreement.review', 'audit.read'],
  EVIDENCE_REVIEWER: ['flo.read', 'evidence.review', 'evidence.excuse', 'media.sensitive.read', 'audit.read'],
  AUDITOR: ['flo.read', 'audit.read'],
  VOLUNTEER: ['route.read', 'route.claim', 'route.progress'],
};

/** Union of the capabilities of several roles, deduplicated, in CAPABILITIES order. */
export function capabilitiesForRoles(roles: readonly Role[]): Capability[] {
  const set = new Set<Capability>();
  for (const r of roles) for (const c of ROLE_CAPABILITIES[r]) set.add(c);
  return CAPABILITIES.filter((c) => set.has(c));
}

/**
 * Never granted to WORKER/AGENT actor kinds (mirrors the SQL allowlist in require_cap).
 */
export const HUMAN_ONLY_CAPABILITIES: readonly Capability[] = [
  'agreement.review',
  'outreach.approve',
  'dispatch.approve',
  'inventory.quarantine_release',
  'need.confirm',
  'policy.manage',
  'evidence.excuse',
];
