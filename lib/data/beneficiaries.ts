/**
 * Willing Hearts' partner beneficiary network — the organisations that receive
 * food directly when it's too close to spoiling to keep waiting on a public
 * claim (see ESCALATION_THRESHOLD_HOURS).
 *
 * These are the real-world end of the supply chain: a public listing that
 * nobody claims doesn't become waste, it becomes a scheduled drop to a partner
 * that can absorb it immediately. Each branch has its own nearby partners, so
 * the contingency leg is short even when the clock is nearly out.
 *
 * Demo data for a fictional charity — plausible Singapore organisation types
 * and locations, not real registered entities.
 */

export type BeneficiaryType =
  | 'family_service_centre'
  | 'senior_care'
  | 'children_home'
  | 'shelter'
  | 'soup_kitchen'
  | 'migrant_worker_dorm';

export interface PartnerBeneficiary {
  /** Stable slug, independent of the display name — the join key for
   *  `beneficiary_allocations`, so renaming a partner never orphans its
   *  fulfilment history the way matching on `name` would. */
  key: string;
  name: string;
  type: BeneficiaryType;
  /** Real coordinates, so multi-stop delivery routes are computed with the same
   *  Haversine maths used everywhere else rather than from guessed durations. */
  lat: number;
  lng: number;
  /** Rough travel time from the branch, in minutes — the contingency leg. */
  minutes_from_branch: number;
  /** Roughly how many people a single drop can serve. */
  serves: number;
  /** Registered daily demand, in kg — what this partner actually asked for.
   *  This is what turns dispatch from "nearest partner that'll take it" into
   *  real demand-quota allocation: a partner already at quota today shouldn't
   *  keep absorbing donations just because it's closest. */
  daily_quota_kg: number;
  /** What this partner can actually take — drives which one the planner picks. */
  accepts: {
    cooked: boolean;
    needs_cold_chain: boolean;
    bulk_dry_goods: boolean;
  };
  note: string;
}

/** Keyed by the branch's area label, matching `branches.area` in the database. */
export const PARTNER_BENEFICIARIES: Record<string, PartnerBeneficiary[]> = {
  North: [
    {
      key: 'marsiling-fsc',
      name: 'Marsiling Family Service Centre',
      type: 'family_service_centre',
      lat: 1.4326,
      lng: 103.774,
      minutes_from_branch: 8,
      serves: 120,
      daily_quota_kg: 45,
      accepts: { cooked: true, needs_cold_chain: true, bulk_dry_goods: true },
      note: 'Runs a daily 6pm family meal service; can plate cooked food on arrival.',
    },
    {
      key: 'woodlands-sac',
      name: 'Woodlands Senior Activity Centre',
      type: 'senior_care',
      lat: 1.4382,
      lng: 103.801,
      minutes_from_branch: 12,
      serves: 65,
      daily_quota_kg: 25,
      accepts: { cooked: true, needs_cold_chain: false, bulk_dry_goods: true },
      note: 'Prefers soft, low-sodium cooked items; no cold storage on site.',
    },
    {
      key: 'kranji-dorm',
      name: 'Kranji Migrant Worker Dormitory Kitchen',
      type: 'migrant_worker_dorm',
      lat: 1.4251,
      lng: 103.762,
      minutes_from_branch: 15,
      serves: 400,
      daily_quota_kg: 90,
      accepts: { cooked: true, needs_cold_chain: true, bulk_dry_goods: true },
      note: 'Largest absorber in the north — commercial kitchen, walk-in chiller.',
    },
  ],
  Central: [
    {
      key: 'toa-payoh-fsc',
      name: 'Toa Payoh Family Service Centre',
      type: 'family_service_centre',
      lat: 1.3352,
      lng: 103.8496,
      minutes_from_branch: 6,
      serves: 90,
      daily_quota_kg: 35,
      accepts: { cooked: true, needs_cold_chain: true, bulk_dry_goods: true },
      note: 'Collects on request; two vans available until 8pm.',
    },
    {
      key: 'st-andrews-childrens-home',
      name: "St. Andrew's Children's Home",
      type: 'children_home',
      lat: 1.3418,
      lng: 103.8862,
      minutes_from_branch: 14,
      serves: 55,
      daily_quota_kg: 20,
      accepts: { cooked: true, needs_cold_chain: true, bulk_dry_goods: true },
      note: 'Cold storage on site; avoids high-sugar beverage donations.',
    },
    {
      key: 'jalan-kukoh-soup-kitchen',
      name: 'Jalan Kukoh Soup Kitchen',
      type: 'soup_kitchen',
      lat: 1.2879,
      lng: 103.8408,
      minutes_from_branch: 18,
      serves: 200,
      daily_quota_kg: 60,
      accepts: { cooked: true, needs_cold_chain: false, bulk_dry_goods: true },
      note: 'Serves rental-block residents nightly; takes cooked food immediately.',
    },
  ],
  South: [
    {
      key: 'bukit-merah-fsc',
      name: 'Bukit Merah Family Service Centre',
      type: 'family_service_centre',
      lat: 1.2843,
      lng: 103.8189,
      minutes_from_branch: 5,
      serves: 110,
      daily_quota_kg: 40,
      accepts: { cooked: true, needs_cold_chain: true, bulk_dry_goods: true },
      note: 'Closest partner in the network — 5 minutes door to door.',
    },
    {
      key: 'henderson-shelter',
      name: 'Henderson Transitional Shelter',
      type: 'shelter',
      lat: 1.2871,
      lng: 103.8175,
      minutes_from_branch: 11,
      serves: 75,
      daily_quota_kg: 28,
      accepts: { cooked: true, needs_cold_chain: false, bulk_dry_goods: true },
      note: 'Residents eat on site; limited chiller space, prefers same-day cooked.',
    },
    {
      key: 'telok-blangah-senior-care',
      name: 'Telok Blangah Senior Care Hub',
      type: 'senior_care',
      lat: 1.2765,
      lng: 103.8092,
      minutes_from_branch: 16,
      serves: 60,
      daily_quota_kg: 22,
      accepts: { cooked: true, needs_cold_chain: true, bulk_dry_goods: true },
      note: 'Takes dairy and produce readily; cooked food must arrive above 60°C or chilled.',
    },
  ],
  East: [
    {
      key: 'tampines-fsc',
      name: 'Tampines Family Service Centre',
      type: 'family_service_centre',
      lat: 1.3521,
      lng: 103.9445,
      minutes_from_branch: 7,
      serves: 95,
      daily_quota_kg: 38,
      accepts: { cooked: true, needs_cold_chain: true, bulk_dry_goods: true },
      note: 'Distributes to 300+ registered households weekly.',
    },
    {
      key: 'bedok-soup-kitchen',
      name: 'Bedok Community Soup Kitchen',
      type: 'soup_kitchen',
      lat: 1.3236,
      lng: 103.9273,
      minutes_from_branch: 13,
      serves: 180,
      daily_quota_kg: 55,
      accepts: { cooked: true, needs_cold_chain: false, bulk_dry_goods: true },
      note: 'Fastest turnaround for cooked food — serves within the hour.',
    },
    {
      key: 'simei-youth-home',
      name: 'Simei Children & Youth Home',
      type: 'children_home',
      lat: 1.3435,
      lng: 103.9531,
      minutes_from_branch: 17,
      serves: 48,
      daily_quota_kg: 18,
      accepts: { cooked: true, needs_cold_chain: true, bulk_dry_goods: true },
      note: 'Good destination for bread, dairy and snack items.',
    },
  ],
};

/** Partners near a branch, nearest first. Falls back to Central if a branch has
 *  no area recorded, so the contingency leg always has somewhere to go. */
export function beneficiariesForArea(area: string | null): PartnerBeneficiary[] {
  const list = (area && PARTNER_BENEFICIARIES[area]) || PARTNER_BENEFICIARIES.Central;
  return [...list].sort((a, b) => a.minutes_from_branch - b.minutes_from_branch);
}

/** Every beneficiary across every area, flattened — for the quota dashboard,
 *  which shows the whole network rather than one branch's neighbourhood. */
export function allBeneficiaries(): PartnerBeneficiary[] {
  return Object.values(PARTNER_BENEFICIARIES).flat();
}

export function findBeneficiaryByKey(key: string): PartnerBeneficiary | undefined {
  return allBeneficiaries().find((b) => b.key === key);
}
