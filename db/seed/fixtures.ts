/**
 * Named FLO fixtures (architecture B.2 table). Each pins specific attribute values;
 * marginals are kept exact by swapping (marginals.enforceBySwap). Fixture indices
 * are 0..10, so fixtures take the low codes FLO-0001..FLO-0011.
 */
import type { AgreementClass, Area, ContactProfile, ReportingProfile, Tenure } from './marginals';

export interface FloFixture {
  key: string;
  index: number;
  code: string;
  area?: Area;
  /** Pin to a cluster (otherwise round-robin; placed fixtures use the nearest cluster). */
  clusterCode?: string;
  agreement?: AgreementClass;
  tenure?: Tenure;
  contact?: ContactProfile;
  reporting?: ReportingProfile;
  /** Confirmed fresh BREAD need score. */
  breadNeed?: number;
  /** Confirmed BREAD per-event capacity (portion). */
  breadCapacity?: number;
  /** Fixed agreement through date (local legal date). */
  agreementThrough?: string;
  /** EXPIRED agreement plus a PENDING_VERIFICATION renewal (AC04). */
  pendingRenewal?: boolean;
  /** SC01 set: BREAD preferred, no random BREAD history within 30 days of the clock. */
  sc01?: boolean;
  /** Extra weight in historical candidate selection (more evidence history). */
  historyWeight?: number;
  description: string;
}

export const SUNTER_CLUSTER_CODE = 'CL-JKT-01';

export const FLO_FIXTURES: readonly FloFixture[] = [
  {
    key: 'F_SC01_EXPIRED_CLOSEST', index: 0, code: 'FLO-0001', area: 'JAKARTA', clusterCode: SUNTER_CLUSTER_CODE,
    agreement: 'EXPIRED', tenure: 'ESTABLISHED', contact: 'FAST', reporting: 'GOOD', breadNeed: 95, breadCapacity: 80,
    agreementThrough: '2026-10-20', sc01: true,
    description: 'SC01: closest FLO to the bakery, agreement expired (excluded before ranking, AC02)',
  },
  {
    key: 'F_SC01_RECENT_BREAD', index: 1, code: 'FLO-0002', area: 'JAKARTA', clusterCode: SUNTER_CLUSTER_CODE,
    agreement: 'ACTIVE_GT30', tenure: 'ESTABLISHED', breadNeed: 88, breadCapacity: 50, sc01: true,
    description: 'SC01: received a BREAD delivery at clock − 2 days',
  },
  {
    key: 'F_SC01_HIGH_NEED', index: 2, code: 'FLO-0003', area: 'JAKARTA', clusterCode: SUNTER_CLUSTER_CODE,
    agreement: 'ACTIVE_GT30', tenure: 'ESTABLISHED', contact: 'FAST', reporting: 'GOOD', breadNeed: 90, breadCapacity: 60,
    sc01: true,
    description: 'SC01: high-need eligible FLO, BREAD capacity 60',
  },
  {
    key: 'F_SC01_SECOND', index: 3, code: 'FLO-0004', area: 'JAKARTA', clusterCode: SUNTER_CLUSTER_CODE,
    agreement: 'ACTIVE_GT30', tenure: 'ESTABLISHED', contact: 'ORDINARY', breadNeed: 85, breadCapacity: 40, sc01: true,
    description: 'SC01: second FLO, BREAD capacity 40',
  },
  {
    key: 'F_SC02_FEE', index: 4, code: 'FLO-0005', area: 'JAKARTA', clusterCode: SUNTER_CLUSTER_CODE,
    agreement: 'ACTIVE_GT30', tenure: 'ESTABLISHED', breadNeed: 80, breadCapacity: 50, sc01: true,
    description: 'SC02: fee refusal candidate in Sunter',
  },
  {
    key: 'F_SC06_REVOKE', index: 5, code: 'FLO-0006', area: 'JAKARTA', agreement: 'ACTIVE_GT30', tenure: 'ESTABLISHED',
    description: 'SC06: agreement revoked before dispatch',
  },
  {
    key: 'F_AC03_MONTHEND', index: 6, code: 'FLO-0007', agreement: 'EXPIRING', tenure: 'ESTABLISHED',
    agreementThrough: '2026-10-31',
    description: 'AC03: agreement valid through 2026-10-31 (exclusive end 2026-10-31T17:00Z)',
  },
  {
    key: 'F_AC04_RENEWAL', index: 7, code: 'FLO-0008', agreement: 'EXPIRED', tenure: 'ESTABLISHED',
    agreementThrough: '2026-10-15', pendingRenewal: true,
    description: 'AC04: expired agreement plus a PENDING_VERIFICATION renewal',
  },
  {
    key: 'F_SC07_REPORT', index: 8, code: 'FLO-0009', area: 'JAKARTA', agreement: 'ACTIVE_GT30', tenure: 'ESTABLISHED',
    reporting: 'GOOD', historyWeight: 3,
    description: 'SC07: good reporter (evidence deadlines)',
  },
  {
    key: 'F_SC10_REPORT', index: 9, code: 'FLO-0010', area: 'JAKARTA', agreement: 'ACTIVE_GT30', tenure: 'ESTABLISHED',
    reporting: 'GOOD', historyWeight: 3,
    description: 'SC10: good reporter (unknown distribution)',
  },
  {
    key: 'F_NEW', index: 10, code: 'FLO-0011', agreement: 'ACTIVE_GT30', tenure: 'NEW',
    description: 'AC46: NEW FLO, no history (neutral smoothed scores)',
  },
];

export const FIXTURE_INDEXES: ReadonlySet<number> = new Set(FLO_FIXTURES.map((f) => f.index));

export function fixtureByCode(code: string): FloFixture | undefined {
  return FLO_FIXTURES.find((f) => f.code === code);
}
