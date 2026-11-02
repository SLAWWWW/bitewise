/**
 * Capability checks on an already-loaded actor. Capabilities come from the DB
 * membership (never the cookie). SQL `require_cap` re-checks inside commands.
 */
import { DomainError } from '@/src/db/errors';
import type { Capability } from '@/src/shared/capabilities';

export interface CapabilityHolder {
  capabilities: readonly string[];
}

export function hasCap(actor: CapabilityHolder | null | undefined, cap: Capability): boolean {
  return !!actor && actor.capabilities.includes(cap);
}

export function hasAnyCap(actor: CapabilityHolder | null | undefined, caps: readonly Capability[]): boolean {
  return caps.length === 0 || caps.some((c) => hasCap(actor, c));
}

export function requireActor<A>(actor: A | null | undefined): A {
  if (!actor) throw new DomainError({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
  return actor;
}

export function requireCap<A extends CapabilityHolder>(actor: A | null | undefined, cap: Capability): A {
  const a = requireActor(actor);
  if (!hasCap(a, cap)) {
    throw new DomainError({ code: 'CAPABILITY_REQUIRED', message: `Missing capability ${cap}`, detail: { capability: cap } });
  }
  return a;
}
