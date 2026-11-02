/**
 * Test data factories (skeleton). Tenancy comes from db-helpers.makeTenant; domain
 * owners add their own factories here or next to their tests (e.g. FLOs, agreements)
 * using `withOwner` and uuidv5 ids under `tenant.ns`.
 */
export { makeTenant, ctxFor, withOwner, withAppTx, ownerPool, SEED_INSTANT } from './db-helpers';
export type { TestTenant, TestUser, MakeTenantOptions } from './db-helpers';

import { entityId } from '@/src/lib/uuidv5';
import type { TestTenant } from './db-helpers';

/** Deterministic id for an entity inside a test tenant: idFor(t, 'flo', 'FLO-0001'). */
export function idFor(t: Pick<TestTenant, 'ns'>, entity: string, naturalKey: string): string {
  return entityId(t.ns, entity, naturalKey);
}
