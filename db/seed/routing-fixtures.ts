/**
 * Explicit routing fixtures for the named scenarios (PRD §24: "explicit routing
 * fixtures for named scenarios. Do not claim precise real route times").
 *
 * Travel minutes are fixed, synthetic demo values (source FIXTURE). Pairs not listed
 * fall back to the straight-line adapter (src/adapters/routing/straight-line.ts).
 * The fixture FLO coordinates are placed relative to their source with the offsets
 * below, so distance_km is consistent with the stored coordinates.
 */

export interface RoutingFixture {
  /** source_locations.code */
  from: string;
  /** flos.code */
  to: string;
  minutes: number;
  distance_km: number;
  scenario: string;
  note: string;
}

/** Placement of scenario FLOs relative to the scenario source: distance (km) and bearing (deg). */
export interface FixturePlacement {
  floCode: string;
  sourceCode: string;
  distanceKm: number;
  bearingDeg: number;
}

/** SC01/SC02 source: Toko Roti Simulasi Sunter (SRC-001), at the Sunter (Demo) centroid. */
export const SC01_SOURCE_CODE = 'SRC-001';
export const WAREHOUSE_JKU_CODE = 'WH-JKU';
export const WAREHOUSE_BKS_CODE = 'WH-BKS';

export const FIXTURE_PLACEMENTS: readonly FixturePlacement[] = [
  // FLO-0001 is the geographically closest FLO to the SC01 source (expired agreement).
  { floCode: 'FLO-0001', sourceCode: SC01_SOURCE_CODE, distanceKm: 0.45, bearingDeg: 40 },
  { floCode: 'FLO-0002', sourceCode: SC01_SOURCE_CODE, distanceKm: 1.1, bearingDeg: 200 },
  { floCode: 'FLO-0003', sourceCode: SC01_SOURCE_CODE, distanceKm: 1.6, bearingDeg: 110 },
  { floCode: 'FLO-0004', sourceCode: SC01_SOURCE_CODE, distanceKm: 2.3, bearingDeg: 300 },
  { floCode: 'FLO-0005', sourceCode: SC01_SOURCE_CODE, distanceKm: 1.9, bearingDeg: 160 },
  { floCode: 'FLO-0006', sourceCode: WAREHOUSE_JKU_CODE, distanceKm: 6.5, bearingDeg: 150 },
  { floCode: 'FLO-0009', sourceCode: WAREHOUSE_JKU_CODE, distanceKm: 5.8, bearingDeg: 60 },
  { floCode: 'FLO-0010', sourceCode: WAREHOUSE_JKU_CODE, distanceKm: 7.9, bearingDeg: 250 },
];

/** No non-fixture FLO is placed closer than this to the SC01 source. */
export const SC01_EXCLUSION_RADIUS_KM = 1.0;

export const ROUTING_FIXTURES: readonly RoutingFixture[] = [
  { from: SC01_SOURCE_CODE, to: 'FLO-0001', minutes: 5, distance_km: 0.45, scenario: 'SC01', note: 'Closest FLO; agreement expired (excluded before ranking)' },
  { from: SC01_SOURCE_CODE, to: 'FLO-0002', minutes: 8, distance_km: 1.1, scenario: 'SC01', note: 'Received bakery food at clock − 2 days' },
  { from: SC01_SOURCE_CODE, to: 'FLO-0003', minutes: 12, distance_km: 1.6, scenario: 'SC01', note: 'High need; BREAD capacity 60' },
  { from: SC01_SOURCE_CODE, to: 'FLO-0004', minutes: 15, distance_km: 2.3, scenario: 'SC01', note: 'Second FLO; BREAD capacity 40' },
  { from: SC01_SOURCE_CODE, to: 'FLO-0005', minutes: 11, distance_km: 1.9, scenario: 'SC02', note: 'Fee refusal candidate' },
  { from: WAREHOUSE_JKU_CODE, to: 'FLO-0006', minutes: 24, distance_km: 6.5, scenario: 'SC06', note: 'Agreement revoked before dispatch' },
  { from: WAREHOUSE_JKU_CODE, to: 'FLO-0009', minutes: 22, distance_km: 5.8, scenario: 'SC07', note: 'Evidence deadlines' },
  { from: WAREHOUSE_JKU_CODE, to: 'FLO-0010', minutes: 28, distance_km: 7.9, scenario: 'SC10', note: 'Unknown distribution' },
];

const byPair = new Map(ROUTING_FIXTURES.map((f) => [`${f.from}→${f.to}`, f]));

/** Fixture travel for a (source code, FLO code) pair, or undefined. */
export function routingFixture(fromCode: string, toCode: string): RoutingFixture | undefined {
  return byPair.get(`${fromCode}→${toCode}`);
}
