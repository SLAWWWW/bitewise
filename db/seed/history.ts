/**
 * Step 5 (architecture B): 90 days of history as a deterministic simulation in pure TS.
 *
 *   300 orders (220 DIRECT incl. 6 "today", 80 WAREHOUSE_INBOUND), codes ORD-YYMMDD-NNN
 *   in time order; 600 allocation slots (450 direct + 150 warehouse):
 *     460 RECEIVED + 40 PARTIALLY_RECEIVED (500 accepted receipts)
 *     30 declined (8 FEE_UNAFFORDABLE), 10 cancelled (donor/staff), 25 expired
 *     (no response or reservation expiry), 10 fee refused after acceptance,
 *     25 in progress (OFFER_HELD 5, ACCEPTED_RESERVED 5, LOGISTICS_PENDING 4,
 *     AWAITING_FINAL_APPROVAL 4, APPROVED 3, DISPATCHED 4) with unexpired holds.
 *
 * Every historical event satisfies the same invariants as live commands (agreement
 * valid at offer, dispatch and handover; approvals before dispatch; holds within the
 * item quantity; ledger zero-sum and non-negative). Warehouse stock is simulated
 * chronologically with FEFO (earliest usable_until, then received_at, then id).
 */
import { canonicalJson } from '@/src/lib/canonical-json';
import { sha256Hex } from '@/src/lib/hash';
import { formatQty } from '@/src/lib/qty';
import { shuffle, type Rng } from '@/src/lib/prng';
import { estimateTravel } from '@/src/adapters/routing/straight-line';
import type { CategoryCode } from '@/src/shared/enums';
import { DAY, HOUR, MIN, chance, intIn, iso, pad, weightedPick, yymmdd, type Clock, type Ids, type Streams } from './config';
import type { Dataset } from './dataset';
import type { FloInfo } from './flos';
import { agreementValidAt } from './agreements';
import { DIRECT_PRODUCTS, WAREHOUSES, type RefContext, type SourceInfo } from './reference';
import { routingFixture } from './routing-fixtures';
import { addAudit } from './audit';
import { WAREHOUSE_SIZES, Ledger, buildInbounds, drawUnits, type BatchInfo, type WarehouseOrderPlan } from './warehouse';
import type { Area } from './marginals';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
export type HistLabel =
  | 'RECEIVED'
  | 'PARTIAL'
  | 'DECLINED'
  | 'DECLINED_FEE'
  | 'CANCELLED_OTHER'
  | 'EXPIRED_NO_RESPONSE'
  | 'EXPIRED_RESERVATION'
  | 'FEE_REFUSED';
export type InProgressState = 'OFFER_HELD' | 'ACCEPTED_RESERVED' | 'LOGISTICS_PENDING' | 'AWAITING_FINAL_APPROVAL' | 'APPROVED' | 'DISPATCHED';
export type SlotLabel = HistLabel | InProgressState;

export const HIST_LABEL_COUNTS: Record<HistLabel, number> = {
  RECEIVED: 460,
  PARTIAL: 40,
  DECLINED: 22,
  DECLINED_FEE: 8,
  CANCELLED_OTHER: 10,
  EXPIRED_NO_RESPONSE: 15,
  EXPIRED_RESERVATION: 10,
  FEE_REFUSED: 10,
};

export const IN_PROGRESS: readonly { state: InProgressState; direct: number; warehouse: number; product: string; sourceKind: 'MARKET' | 'RETAILER' }[] = [
  { state: 'OFFER_HELD', direct: 4, warehouse: 1, product: 'PISANG', sourceKind: 'MARKET' },
  { state: 'ACCEPTED_RESERVED', direct: 4, warehouse: 1, product: 'BISKUIT', sourceKind: 'RETAILER' },
  { state: 'LOGISTICS_PENDING', direct: 3, warehouse: 1, product: 'SAYUR-CAMPUR', sourceKind: 'MARKET' },
  { state: 'AWAITING_FINAL_APPROVAL', direct: 3, warehouse: 1, product: 'BISKUIT', sourceKind: 'RETAILER' },
  { state: 'APPROVED', direct: 2, warehouse: 1, product: 'PISANG', sourceKind: 'MARKET' },
  { state: 'DISPATCHED', direct: 3, warehouse: 1, product: 'SAYUR-CAMPUR', sourceKind: 'MARKET' },
];

/** Hours after the previous-day 00:00 at which each in-progress group's order was created. */
const IN_PROGRESS_T0_HOUR: Record<InProgressState, number> = {
  OFFER_HELD: 18,
  ACCEPTED_RESERVED: 15,
  LOGISTICS_PENDING: 14,
  AWAITING_FINAL_APPROVAL: 13,
  APPROVED: 12,
  DISPATCHED: 11,
};
/** Pickup window relative to the clock (hours) for in-progress groups. */
const IN_PROGRESS_PICKUP: Record<InProgressState, [number, number]> = {
  OFFER_HELD: [4, 7],
  ACCEPTED_RESERVED: [3, 6],
  LOGISTICS_PENDING: [3, 6],
  AWAITING_FINAL_APPROVAL: [2, 5],
  APPROVED: [2, 5],
  DISPATCHED: [-1.5, 0.5],
};

const RESPONSE_WINDOW_MIN = 240;
const TIMELY_WITHIN_MIN = 120;

// ---------------------------------------------------------------------------
// Records handed to the reporting step
// ---------------------------------------------------------------------------
export interface ReceiptRecord {
  receiptId: string;
  receiptLineId: string;
  deliveryId: string;
  deliveryCode: string;
  flo: FloInfo;
  dispatchedAt: number;
  receivedAt: number;
  plannedDistributionAt: number;
  acceptedQty: bigint;
  unit: string;
  increment: bigint;
}

export interface DispatchRecord {
  deliveryId: string;
  deliveryCode: string;
  flo: FloInfo;
  dispatchedAt: number;
}

export interface HistoryResult {
  receipts: ReceiptRecord[];
  dispatches: DispatchRecord[];
  meta: {
    areaFallbacks: number;
    warehouseReschedules: number;
    labelCounts: Record<string, number>;
    batchCount: number;
  };
}

// ---------------------------------------------------------------------------
// Internal plans
// ---------------------------------------------------------------------------
interface Timeline {
  t0: number;
  queued: number;
  sent: number;
  expires: number;
  responded: number | null;
  pickupStart: number;
  pickupEnd: number;
  plannedReceipt: number;
  plannedDistribution: number;
  distributeBy: number;
}

interface OrderPlan {
  key: string;
  t0: number;
  route: 'DIRECT' | 'WAREHOUSE_INBOUND';
  group: 'OLD' | 'FIXTURE_RECENT_BREAD' | 'IN_PROGRESS' | 'EXPECTED' | 'INSPECTED' | 'TODAY';
  source: SourceInfo;
  products: string[];
  inProgress?: (typeof IN_PROGRESS)[number];
  today?: TodaySpec;
  warehouseCode?: string;
  expectedAt?: number;
  // assigned after sorting
  code?: string;
  id?: string;
}

interface TodaySpec {
  key: string;
  state: 'DRAFT' | 'NEEDS_INFO' | 'SAFETY_REVIEW' | 'READY';
  product: string | null;
  qty: string | null;
  unit: string | null;
  sourceCode: string;
  hour: number;
  safety: 'CLEARED' | 'REVIEW_REQUIRED' | 'PENDING';
  description: string;
  missing: string[];
  parse: Record<string, unknown> | null;
  conversion: boolean;
}

const TODAY_ORDERS: readonly TodaySpec[] = [
  { key: 'TODAY_DRAFT', state: 'DRAFT', product: 'NASI-KOTAK', qty: null, unit: null, sourceCode: 'SRC-009', hour: 6.25, safety: 'PENDING',
    description: 'Nasi kotak sisa acara (draf, jumlah belum diisi)', missing: ['quantity', 'pickup_window'], parse: null, conversion: false },
  { key: 'AC48_TRAY', state: 'NEEDS_INFO', product: 'ROTI-MANIS-6', qty: '3', unit: 'tray', sourceCode: 'SRC-002', hour: 6.5, safety: 'PENDING',
    description: 'Roti manis 3 tray', missing: ['unit_conversion'],
    parse: { raw_text: 'Ada roti manis 3 tray, bisa diambil siang ini', quantity: '3', unit: 'tray', known_units: ['pack', 'portion'], conversion_found: false },
    conversion: false },
  { key: 'TODAY_SAFETY_REVIEW', state: 'SAFETY_REVIEW', product: 'LAUK-PORSI', qty: '35', unit: 'portion', sourceCode: 'SRC-010', hour: 6.75, safety: 'REVIEW_REQUIRED',
    description: 'Lauk porsi dingin, suhu penyimpanan belum dikonfirmasi', missing: [], parse: null, conversion: false },
  { key: 'SC01_BREAD', state: 'READY', product: 'ROTI-TAWAR', qty: '120', unit: 'portion', sourceCode: 'SRC-001', hour: 7, safety: 'CLEARED',
    description: 'Roti tawar 120 porsi (SC01, toko roti Sunter)', missing: [], parse: null, conversion: false },
  { key: 'TODAY_READY_PRODUCE', state: 'READY', product: 'SAYUR-CAMPUR', qty: '25', unit: 'kg', sourceCode: 'SRC-017', hour: 7.25, safety: 'CLEARED',
    description: 'Sayur campur 25 kg (pasar, kosmetik)', missing: [], parse: null, conversion: false },
  { key: 'TODAY_READY_MEAL', state: 'READY', product: 'NASI-KOTAK', qty: '40', unit: 'box', sourceCode: 'SRC-014', hour: 7.5, safety: 'CLEARED',
    description: 'Nasi kotak 40 kotak dari hotel', missing: [], parse: null, conversion: true },
];

const DIRECT_QTY: Record<string, [number, number]> = {
  'ROTI-TAWAR': [15, 50],
  'ROTI-MANIS-6': [4, 12],
  'NASI-KOTAK': [15, 40],
  'LAUK-PORSI': [15, 40],
  'SAYUR-CAMPUR': [5, 20],
  PISANG: [5, 25],
  BISKUIT: [10, 30],
};

const EST_KG_PER_UNIT: Record<string, number> = {
  'ROTI-TAWAR': 0.1,
  'ROTI-MANIS-6': 0.4,
  'NASI-KOTAK': 0.45,
  'LAUK-PORSI': 0.2,
  'SAYUR-CAMPUR': 1,
  PISANG: 1,
  'BERAS-5KG': 5,
  'BERAS-CURAH': 1,
  BISKUIT: 0.2,
  'WAFER-KARTON': 0.15,
  'MINYAK-1L': 0.92,
  'MIE-INSTAN': 0.085,
};

const DONATION_REASON: Record<string, string> = {
  BAKERY: 'PRODUCTION_EXCESS',
  CATERER: 'SURPLUS',
  HOTEL: 'SURPLUS',
  MARKET: 'COSMETIC_PRODUCE',
  RETAILER: 'NEAR_EXPIRY',
  DISTRIBUTOR: 'OUTER_PACKAGING_DAMAGE',
};

function categoryForKind(kind: SourceInfo['kind'], rng: Rng): 'BREAD' | 'PREPARED_MEAL' | 'PRODUCE' {
  switch (kind) {
    case 'BAKERY':
      return 'BREAD';
    case 'CATERER':
    case 'HOTEL':
      return 'PREPARED_MEAL';
    case 'MARKET':
      return 'PRODUCE';
    default:
      return rng() < 0.5 ? 'BREAD' : 'PRODUCE';
  }
}

function drawQty(rng: Rng, productCode: string, minInc: bigint): bigint {
  const [lo, hi] = DIRECT_QTY[productCode];
  const steps = Number((BigInt(lo) * 1000n) / minInc);
  const stepsHi = Number((BigInt(hi) * 1000n) / minInc);
  return BigInt(intIn(rng, steps, stepsHi)) * minInc;
}

const floorInc = (q: bigint, inc: bigint) => q - (q % inc);

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------
export function buildHistory(ds: Dataset, clock: Clock, ids: Ids, streams: Streams, ref: RefContext, flos: FloInfo[]): HistoryResult {
  const T = clock.now;
  const today = clock.today;
  const yesterday = clock.addDays(today, -1);
  const tenantId = ref.tenantId;
  const users = ref.users;
  const policies = ref.policies;
  const receipts: ReceiptRecord[] = [];
  const dispatches: DispatchRecord[] = [];
  const meta = { areaFallbacks: 0, warehouseReschedules: 0, labelCounts: {} as Record<string, number>, batchCount: 0 };
  const established = flos.filter((f) => f.tenure === 'ESTABLISHED');

  const rOrders = streams.get('history.orders');
  const rItems = streams.get('history.items');
  const rFlo = streams.get('history.flo_selection');
  const rResp = streams.get('history.responses');
  const rTransport = streams.get('history.transport');
  const rQty = streams.get('history.quantities');
  const rTime = streams.get('history.times');
  const rExcl = streams.get('history.exclusions');

  const directSources = ref.sources.filter((s) => s.kind !== 'DISTRIBUTOR');
  const directHistSources = directSources;
  const warehouseSources = ref.sources.filter((s) => s.kind === 'DISTRIBUTOR' || s.kind === 'RETAILER');

  // ------------------------------------------------------------------ orders
  const orders: OrderPlan[] = [];
  const histStartDate = clock.addDays(today, -90);
  // 207 random old direct orders on days 0..89 (up to yesterday), plus the FLO-0002 fixture order.
  for (let i = 0; i < 207; i++) {
    const day = intIn(rOrders, 0, 89);
    const minute = intIn(rOrders, 0, 240);
    const source = directHistSources[intIn(rOrders, 0, directHistSources.length - 1)];
    const cat = categoryForKind(source.kind, rOrders);
    const two = chance(rOrders, 0.25);
    const choices = DIRECT_PRODUCTS[cat];
    const p1 = choices[intIn(rOrders, 0, choices.length - 1)];
    const alt = choices.filter((c) => c !== p1);
    const products = two && alt.length > 0 ? [p1, alt[intIn(rOrders, 0, alt.length - 1)]] : [p1];
    orders.push({
      key: `old-direct-${i}`, t0: clock.at(clock.addDays(histStartDate, day), 6, minute), route: 'DIRECT', group: 'OLD', source, products,
    });
  }
  // F_SC01_RECENT_BREAD: order the afternoon two days before; received at T − 2d exactly.
  orders.push({
    key: 'fixture-recent-bread', t0: clock.at(clock.addDays(today, -3), 15), route: 'DIRECT', group: 'FIXTURE_RECENT_BREAD',
    source: ref.sourceByCode['SRC-001'], products: ['ROTI-TAWAR'],
  });
  // 75 inspected warehouse orders on days 0..82.
  const whPlans: { plan: OrderPlan; productCode: string; qty: number }[] = [];
  const whProducts = Object.keys(WAREHOUSE_SIZES);
  for (let i = 0; i < 80; i++) {
    const inspected = i < 75;
    const source = warehouseSources[intIn(rOrders, 0, warehouseSources.length - 1)];
    const productCode = whProducts[intIn(rOrders, 0, whProducts.length - 1)];
    const size = WAREHOUSE_SIZES[productCode];
    const qty = drawUnits(rOrders, size.batch, size.step) * (inspected ? 1 : 1);
    const day = inspected ? intIn(rOrders, 0, 82) : 0;
    const minute = intIn(rOrders, 0, 360);
    let t0: number;
    let expectedAt: number;
    if (inspected) {
      t0 = clock.at(clock.addDays(histStartDate, day), 9, minute);
      expectedAt = t0 + intIn(rOrders, 20, 44) * HOUR;
    } else {
      // 5 EXPECTED: 2 due today, 3 later.
      const j = i - 75;
      t0 = T - (3 - Math.min(j, 2)) * DAY + j * 37 * MIN;
      expectedAt = [T + 2 * HOUR, T + 6 * HOUR, clock.at(clock.addDays(today, 1), 10), clock.at(clock.addDays(today, 2), 10), clock.at(clock.addDays(today, 3), 14)][j];
    }
    const warehouseCode = ['JAKARTA', 'TANGERANG'].includes(source.area) ? 'WH-JKU' : 'WH-BKS';
    const plan: OrderPlan = {
      key: `warehouse-${i}`, t0, route: 'WAREHOUSE_INBOUND', group: inspected ? 'INSPECTED' : 'EXPECTED', source, products: [productCode],
      warehouseCode, expectedAt,
    };
    orders.push(plan);
    whPlans.push({ plan, productCode, qty });
  }
  // 6 in-progress direct orders (yesterday), one per state.
  for (const g of IN_PROGRESS) {
    const candidates = directSources.filter((s) => s.kind === g.sourceKind);
    const source = candidates[intIn(rOrders, 0, candidates.length - 1)];
    orders.push({
      key: `inprogress-${g.state}`, t0: clock.at(yesterday, IN_PROGRESS_T0_HOUR[g.state]), route: 'DIRECT', group: 'IN_PROGRESS', source,
      products: [g.product], inProgress: g,
    });
  }
  // 6 "today" orders.
  for (const tdy of TODAY_ORDERS) {
    orders.push({
      key: tdy.key, t0: clock.at(today, 0) + Math.round(tdy.hour * 60) * MIN, route: 'DIRECT', group: 'TODAY',
      source: ref.sourceByCode[tdy.sourceCode], products: tdy.product ? [tdy.product] : [], today: tdy,
    });
  }
  if (orders.length !== 300) throw new Error(`expected 300 orders, got ${orders.length}`);
  if (orders.filter((o) => o.route === 'DIRECT').length !== 220) throw new Error('expected 220 DIRECT orders');

  // Codes ORD-YYMMDD-NNN in time order (per local day).
  orders.sort((a, b) => a.t0 - b.t0 || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const perDay = new Map<string, number>();
  for (const o of orders) {
    const d = clock.dateOf(o.t0);
    const n = (perDay.get(d) ?? 0) + 1;
    perDay.set(d, n);
    o.code = `ORD-${yymmdd(d)}-${pad(n, 3)}`;
    o.id = ids.id('order', o.code);
  }

  // ------------------------------------------------------------ helpers
  const travelMinutes = (src: SourceInfo, f: FloInfo): number => {
    const fx = routingFixture(src.code, f.code);
    if (fx) return fx.minutes;
    return estimateTravel({ lat: src.lat, lng: src.lng }, { lat: f.lat, lng: f.lng }).minutes;
  };

  const responseMinutes = (f: FloInfo, cap = 238): number => {
    switch (f.contact) {
      case 'FAST':
        return intIn(rResp, 2, 12);
      case 'ORDINARY':
        return intIn(rResp, 20, 90);
      default:
        return Math.min(cap, intIn(rResp, 120, 238));
    }
  };

  function selectFlo(opts: {
    label: SlotLabel;
    category: CategoryCode;
    areas: readonly Area[];
    sentAt: number;
    receiptBound: number;
    exclude: Set<string>;
    inProgress: boolean;
    forceCode?: string;
  }): FloInfo {
    if (opts.forceCode) {
      const f = flos.find((x) => x.code === opts.forceCode)!;
      if (!agreementValidAt(f, opts.sentAt) || !agreementValidAt(f, opts.receiptBound)) {
        throw new Error(`fixture ${f.code} has no valid agreement for its forced slot`);
      }
      return f;
    }
    const ok = (f: FloInfo, areaCheck: boolean) =>
      (!areaCheck || opts.areas.includes(f.area)) &&
      f.eligibleCategories.has(opts.category) &&
      !opts.exclude.has(f.code) &&
      !(opts.inProgress && f.fixture) &&
      !(f.fixture?.sc01 && opts.category === 'BREAD' && opts.sentAt >= T - 30 * DAY) &&
      agreementValidAt(f, opts.sentAt) &&
      agreementValidAt(f, opts.receiptBound);
    let cand = established.filter((f) => ok(f, true));
    if (cand.length === 0) {
      meta.areaFallbacks++;
      cand = established.filter((f) => ok(f, false));
    }
    if (cand.length === 0) throw new Error(`no candidate FLO for ${opts.category} at ${iso(opts.sentAt)}`);
    const w = (f: FloInfo) => {
      let x = f.historyWeight;
      if (opts.label === 'EXPIRED_NO_RESPONSE') x *= f.contact === 'SLOW' ? 4 : f.contact === 'FAST' ? 0.25 : 1;
      return x;
    };
    return weightedPick(rFlo, cand, w);
  }

  // Standard direct timeline from the order instant.
  const standardTimeline = (t0: number, rank: number): Omit<Timeline, 'responded'> => {
    const wave = Math.ceil(rank / 3);
    const queued = t0 + 35 * MIN + (wave - 1) * 30 * MIN + (rank - 1) * MIN;
    const sent = queued + MIN;
    const pickupStart = t0 + 6 * HOUR;
    const plannedReceipt = pickupStart + HOUR;
    return {
      t0, queued, sent, expires: clock.addContactMinutes(sent, RESPONSE_WINDOW_MIN), pickupStart, pickupEnd: t0 + 9 * HOUR,
      plannedReceipt, plannedDistribution: plannedReceipt + 3 * HOUR, distributeBy: t0 + 14 * HOUR,
    };
  };

  // ---------------------------------------------------------- slot emitter
  interface Slot {
    key: string;
    code: string;
    offerCode: string;
    deliveryCode: string;
    label: SlotLabel;
    flo: FloInfo;
    productCode: string;
    route: 'DIRECT' | 'WAREHOUSE';
    offered: bigint;
    rank: number;
    campaignId: string;
    itemId: string | null;
    releasePlanId: string | null;
    batch: BatchInfo | null;
    source: SourceInfo;
    tl: Timeline;
    origin: 'LOCAL' | 'IMPORT';
  }

  interface SlotOutcome {
    allocQty: bigint;
    holdReleasedAt: number | null;
    dispatchedAt: number | null;
    receivedAt: number | null;
    accepted: bigint;
    rejected: bigint;
    responseDeadline: number;
    lastAt: number;
    campaignLineId: string;
  }

  function emitSlot(s: Slot): SlotOutcome {
    const p = ref.products[s.productCode];
    const inc = p.def.minIncrement;
    const unit = p.def.baseUnit;
    const f = s.flo;
    const tl = s.tl;
    const isWh = s.route === 'WAREHOUSE';
    const allocationId = ids.id('allocation', s.key);
    const offerId = ids.id('offer', s.key);
    const lineId = ids.id('campaign_line', s.key);
    const reservationId = ids.id('reservation', s.key);
    const label = s.label;
    const responded = tl.responded;
    const wave = Math.ceil(s.rank / 3);

    // r_exclusion (historical offers only): 3% NO_DELIVERY_RECEIPT, 2% OUTAGE.
    const inProg = isInProgress(label);
    const u = rExcl();
    // FEE_UNAFFORDABLE declines are explicit, timely, eligible responses (INV07 / SC02).
    const exclusion = inProg || label === 'DECLINED_FEE' ? null : u < 0.03 ? 'NO_DELIVERY_RECEIPT' : u < 0.05 ? 'OUTAGE' : null;
    const delivered = exclusion === 'NO_DELIVERY_RECEIPT' ? null : tl.sent + MIN;

    // Partial accept (direct only, ~8% of completed deliveries).
    const partialAccept = !isWh && (label === 'RECEIVED' || label === 'PARTIAL') && rQty() < 0.08 && s.offered >= 4n * inc;
    let allocQty = s.offered;
    if (partialAccept) {
      const share = BigInt(Math.round((0.5 + 0.3 * rQty()) * 1000));
      allocQty = floorInc((s.offered * share) / 1000n, inc);
      if (allocQty < inc) allocQty = inc;
      if (allocQty >= s.offered) allocQty = s.offered - inc;
    }

    // Offer -----------------------------------------------------------------
    const acceptedLabels: SlotLabel[] = ['RECEIVED', 'PARTIAL', 'CANCELLED_OTHER', 'FEE_REFUSED', 'EXPIRED_RESERVATION',
      'ACCEPTED_RESERVED', 'LOGISTICS_PENDING', 'AWAITING_FINAL_APPROVAL', 'APPROVED', 'DISPATCHED'];
    const accepted = acceptedLabels.includes(label);
    const declined = label === 'DECLINED' || label === 'DECLINED_FEE';
    const offerState = accepted ? (partialAccept ? 'PARTIALLY_ACCEPTED' : 'ACCEPTED') : declined ? 'DECLINED'
      : label === 'EXPIRED_NO_RESPONSE' ? 'EXPIRED' : delivered === null ? 'SENT' : 'DELIVERED';
    const timelyByClock = responded !== null && contactMinutes(tl.sent, responded) <= TIMELY_WITHIN_MIN;
    const rEligible = inProg && label === 'OFFER_HELD' ? null : exclusion ? false : true;
    const rTimely = inProg && label === 'OFFER_HELD' ? null : exclusion ? null : responded !== null ? timelyByClock : false;
    const declineReason = label === 'DECLINED_FEE' ? 'FEE_UNAFFORDABLE' : declined ? pickFrom(rResp, ['TIMING', 'SUITABILITY', 'CAPACITY_FULL']) : null;
    ds.add('offers', {
      id: offerId, tenant_id: tenantId, code: s.offerCode, campaign_id: s.campaignId, campaign_line_id: lineId, campaign_revision: 1,
      allocation_id: allocationId, flo_id: f.id, contact_id: f.simContactId, quantity: formatQty(s.offered), unit, state: offerState,
      response_deadline: iso(tl.expires), expires_at: iso(tl.expires), queued_at: iso(tl.queued), sent_at: iso(tl.sent),
      delivery_receipt_at: delivered === null ? null : iso(delivered), responded_at: responded === null ? null : iso(responded),
      response_kind: accepted ? (partialAccept ? 'PARTIAL_ACCEPT' : 'ACCEPT') : declined ? 'DECLINE' : null,
      decline_reason_code: declineReason, accepted_qty: accepted ? formatQty(allocQty) : null,
      r_eligible: rEligible, r_timely: rTimely, r_exclusion: exclusion, outbox_id: null, revision: 1,
      created_at: iso(tl.queued), updated_at: iso(responded ?? (label === 'EXPIRED_NO_RESPONSE' ? tl.expires : tl.sent)),
    });

    // Campaign line --------------------------------------------------------
    ds.add('campaign_lines', {
      id: lineId, tenant_id: tenantId, campaign_id: s.campaignId, campaign_revision: 1, flo_id: f.id, wave_no: wave, rank: s.rank,
      max_qty: formatQty(s.offered), unit, receiving_start: iso(tl.pickupStart), receiving_end: iso(tl.pickupEnd + 2 * HOUR),
      distribution_deadline: iso(tl.distributeBy), planned_receipt_at: iso(tl.plannedReceipt), created_at: iso(tl.t0 + 20 * MIN),
    });

    // Transport --------------------------------------------------------------
    let transport: { method: string; quote: string; payer: string; est: number | null; conf: number | null; acceptedAt: number | null; refusedAt: number | null } | null = null;
    const tu = rTransport();
    const fee = intIn(rTransport, 10, 40) * 1000;
    const fcFee = intIn(rTransport, 25, 50) * 1000;
    if (responded !== null && accepted) {
      if (label === 'FEE_REFUSED') {
        transport = { method: 'FLO_BOOKED_COURIER', quote: 'REFUSED', payer: 'FLO', est: fee, conf: null, acceptedAt: null, refusedAt: responded + 40 * MIN };
      } else if (label === 'EXPIRED_RESERVATION' || label === 'ACCEPTED_RESERVED') {
        transport = tu < 0.5 && label === 'ACCEPTED_RESERVED'
          ? { method: 'SELF_PICKUP', quote: 'NOT_APPLICABLE', payer: 'FLO', est: null, conf: null, acceptedAt: null, refusedAt: null }
          : { method: 'FLO_BOOKED_COURIER', quote: 'AWAITING_QUOTE', payer: 'FLO', est: null, conf: null, acceptedAt: null, refusedAt: null };
      } else if (label === 'LOGISTICS_PENDING') {
        transport = { method: 'FLO_BOOKED_COURIER', quote: 'QUOTED', payer: 'FLO', est: fee, conf: null, acceptedAt: null, refusedAt: null };
      } else if (tu < 0.5) {
        transport = { method: 'SELF_PICKUP', quote: 'NOT_APPLICABLE', payer: 'FLO', est: null, conf: null, acceptedAt: null, refusedAt: null };
      } else if (tu < 0.85) {
        transport = { method: 'FLO_BOOKED_COURIER', quote: 'CONFIRMED', payer: 'FLO', est: fee, conf: fee, acceptedAt: responded + 10 * MIN, refusedAt: null };
      } else {
        transport = { method: 'FOODCYCLE_COORDINATED_COURIER', quote: 'CONFIRMED', payer: 'FOODCYCLE', est: fcFee, conf: fcFee, acceptedAt: responded + 10 * MIN, refusedAt: null };
      }
    } else if (label === 'DECLINED_FEE' && responded !== null) {
      transport = { method: 'FLO_BOOKED_COURIER', quote: 'REFUSED', payer: 'FLO', est: fee, conf: null, acceptedAt: null, refusedAt: responded };
    }
    if (transport) {
      const created = responded!;
      ds.add('transport_arrangements', {
        id: ids.id('transport', s.key), tenant_id: tenantId, allocation_id: allocationId, method: transport.method,
        arranger: transport.method === 'FOODCYCLE_COORDINATED_COURIER' ? 'FOODCYCLE' : 'FLO', payer: transport.payer,
        quote_status: transport.quote, estimated_fee_idr: transport.est, confirmed_fee_idr: transport.conf, currency: 'IDR',
        fee_accepted_at: transport.acceptedAt === null ? null : iso(transport.acceptedAt),
        fee_accepted_contact_id: transport.acceptedAt === null ? null : f.simContactId,
        fee_refused_at: transport.refusedAt === null ? null : iso(transport.refusedAt), revision: 1,
        created_at: iso(created), updated_at: iso(transport.refusedAt ?? transport.acceptedAt ?? created),
      });
    }

    // Final approval, delivery, receipt -------------------------------------
    const reachesApproval = ['RECEIVED', 'PARTIAL', 'APPROVED', 'DISPATCHED'].includes(label);
    const finalAt = reachesApproval && responded !== null ? responded + 20 * MIN : null;
    if (reachesApproval) {
      const approver = s.rank % 2 === 0 ? users.KOORD2 : users.ADMIN;
      ds.add('approvals', {
        id: ids.id('approval', `FINAL_DISPATCH:${s.key}`), tenant_id: tenantId, stage: 'FINAL_DISPATCH', subject_type: 'ALLOCATION',
        subject_id: allocationId, subject_revision: 1, input_hash: '0'.repeat(64), approver_id: approver, approved_at: iso(finalAt!),
        expires_at: iso(tl.pickupEnd), reason: 'Persetujuan akhir pengiriman (riwayat simulasi)', invalidated_at: null, invalidated_reason: null,
        created_at: iso(finalAt!), created_by: approver, updated_at: iso(finalAt!),
      });
      addAudit(ds, ids, {
        key: `final:${s.key}`, actorId: approver, action: 'DISPATCH_APPROVED', subjectType: 'ALLOCATION', subjectId: allocationId,
        subjectRevision: 1, policyVersionId: policies['ALLOC-DEMO-2.0'], at: finalAt!, payload: { allocation_code: s.code, flo_code: f.code },
      });
    }

    let dispatchedAt: number | null = null;
    let receivedAt: number | null = null;
    let acceptedQty = 0n;
    let rejectedQty = 0n;
    const travel = travelMinutes(s.source, f);
    if (label === 'RECEIVED' || label === 'PARTIAL') {
      dispatchedAt = s.key === FIXTURE_SLOT_KEY ? T - 2 * DAY - travel * MIN : tl.pickupStart + intIn(rTime, 0, 90) * MIN;
      receivedAt = dispatchedAt + travel * MIN;
      if (label === 'PARTIAL') {
        let rej = floorInc((allocQty * BigInt(100 + Math.round(rQty() * 200))) / 1000n, inc);
        if (rej < inc) rej = inc;
        if (rej >= allocQty) rej = allocQty - inc;
        if (rej <= 0n) throw new Error(`partial receipt impossible for ${s.code}`);
        rejectedQty = rej;
      }
      acceptedQty = allocQty - rejectedQty;
    } else if (label === 'DISPATCHED') {
      dispatchedAt = T - HOUR + s.rank * 5 * MIN;
    }
    const hasDelivery = ['RECEIVED', 'PARTIAL', 'APPROVED', 'DISPATCHED'].includes(label);
    if (hasDelivery) {
      const deliveryId = ids.id('delivery', s.key);
      const dlineId = ids.id('delivery_line', s.key);
      const custodian = transport?.method === 'SELF_PICKUP' ? 'FLO' : 'COURIER';
      const dState = label === 'RECEIVED' ? 'RECEIVED' : label === 'PARTIAL' ? 'PARTIALLY_RECEIVED' : label === 'DISPATCHED' ? 'IN_TRANSIT' : 'PLANNED';
      ds.add('deliveries', {
        id: deliveryId, tenant_id: tenantId, code: s.deliveryCode, route: isWh ? 'WAREHOUSE_OUTBOUND' : 'DIRECT',
        source_location_id: s.source.id, destination_flo_id: f.id, state: dState, custodian: dispatchedAt === null ? null : custodian,
        planned_pickup_at: iso(tl.pickupStart), picked_up_at: dispatchedAt === null ? null : iso(dispatchedAt),
        dispatched_at: dispatchedAt === null ? null : iso(dispatchedAt), planned_arrival_at: iso(tl.plannedReceipt),
        arrived_at: receivedAt === null ? null : iso(receivedAt), received_at: receivedAt === null ? null : iso(receivedAt), revision: 1,
        created_at: iso(finalAt!), updated_at: iso(receivedAt ?? dispatchedAt ?? finalAt!),
      });
      ds.add('delivery_lines', {
        id: dlineId, tenant_id: tenantId, delivery_id: deliveryId, allocation_id: allocationId, item_id: s.itemId,
        batch_id: s.batch?.id ?? null, product_id: p.id, category_id: p.categoryId, unit, unit_kind: p.def.unitKind,
        offered_qty: formatQty(s.offered), allocated_qty: formatQty(allocQty),
        dispatched_qty: dispatchedAt === null ? null : formatQty(allocQty), picked_qty: dispatchedAt === null ? null : formatQty(allocQty),
        created_at: iso(finalAt!), updated_at: iso(dispatchedAt ?? finalAt!),
      });
      if (dispatchedAt !== null) {
        addAudit(ds, ids, {
          key: `dispatch:${s.key}`, actorId: isWh ? users.GUDANG1 : users.KOORD1, action: 'DELIVERY_DISPATCHED', subjectType: 'DELIVERY',
          subjectId: deliveryId, subjectRevision: 1, at: dispatchedAt, payload: { delivery_code: s.deliveryCode, route: isWh ? 'WAREHOUSE_OUTBOUND' : 'DIRECT' },
        });
      }
      if (label === 'DISPATCHED') dispatches.push({ deliveryId, deliveryCode: s.deliveryCode, flo: f, dispatchedAt: dispatchedAt! });
      if (receivedAt !== null) {
        const receiptId = ids.id('receipt', s.key);
        const rlineId = ids.id('receipt_line', s.key);
        ds.add('flo_receipts', {
          id: receiptId, tenant_id: tenantId, delivery_id: deliveryId, flo_id: f.id, received_at: iso(receivedAt),
          time_source: s.origin === 'IMPORT' ? 'IMPORT' : chance(rTime, 0.7) ? 'FLO_LINK' : 'STAFF_ENTRY',
          recorded_by_actor: null, bast_media_id: null, corrects_receipt_id: null, status: 'CURRENT', origin: s.origin,
          inspection_observations: s.origin === 'IMPORT' ? null : {
            smell: 'PASS', appearance: 'PASS', texture: 'PASS', packaging: rejectedQty > 0n ? 'CONCERN' : 'PASS',
            taste: 'NOT_PERFORMED', notes: rejectedQty > 0n ? 'Kemasan bermasalah; jumlah tersebut ditolak (simulasi)' : 'Pemeriksaan penerimaan sintetis tidak menemukan masalah',
          },
          inspection_outcome: s.origin === 'IMPORT' ? null : rejectedQty > 0n ? 'PARTIAL' : 'ACCEPTED',
          created_at: iso(receivedAt), updated_at: iso(receivedAt),
        });
        ds.add('receipt_lines', {
          id: rlineId, tenant_id: tenantId, receipt_id: receiptId, delivery_line_id: dlineId, flo_id: f.id, category_id: p.categoryId,
          unit, received_at: iso(receivedAt), accepted_qty: formatQty(acceptedQty), rejected_qty: formatQty(rejectedQty),
          discrepancy_reason: rejectedQty > 0n ? pickFrom(rQty, ['Sebagian rusak saat pengiriman (simulasi)', 'Kemasan penyok (simulasi)', 'Tidak sesuai kondisi saat diterima (simulasi)']) : null,
          is_current: true, created_at: iso(receivedAt), updated_at: iso(receivedAt),
        });
        if (s.origin === 'IMPORT') {
          ds.add('external_mappings', {
            id: ids.id('external_mapping', `FOODCYCLE_SHEET:FLO_RECEIPT:${s.deliveryCode}`), tenant_id: tenantId, system: 'FOODCYCLE_SHEET',
            entity_type: 'FLO_RECEIPT', external_id: `FC-RCPT-${s.deliveryCode.slice(4)}`, internal_id: receiptId,
            created_at: iso(receivedAt), created_by: users.ADMIN,
          });
        }
        receipts.push({
          receiptId, receiptLineId: rlineId, deliveryId, deliveryCode: s.deliveryCode, flo: f, dispatchedAt: dispatchedAt!, receivedAt,
          plannedDistributionAt: receivedAt + 3 * HOUR, acceptedQty, unit, increment: inc,
        });
      }
    }

    // Reservation + allocation state ----------------------------------------
    let resKind: 'HOLD' | 'RESERVATION' = accepted ? 'RESERVATION' : 'HOLD';
    let resState: 'ACTIVE' | 'RELEASED' | 'CONSUMED' | 'EXPIRED';
    let releasedReason: string | null = null;
    let releasedAt: number | null = null;
    let resExpires: number;
    let allocState: string;
    let cancelReason: string | null = null;
    switch (label) {
      case 'RECEIVED':
      case 'PARTIAL':
        resState = 'CONSUMED';
        resExpires = tl.pickupEnd;
        allocState = label === 'RECEIVED' ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
        break;
      case 'DISPATCHED':
        resState = 'CONSUMED';
        resExpires = tl.pickupEnd;
        allocState = 'DISPATCHED';
        break;
      case 'DECLINED':
      case 'DECLINED_FEE':
        resState = 'RELEASED';
        releasedReason = 'OFFER_DECLINED';
        releasedAt = responded!;
        resExpires = tl.expires;
        allocState = 'CANCELLED';
        cancelReason = `DECLINED:${declineReason}`;
        break;
      case 'CANCELLED_OTHER': {
        resState = 'RELEASED';
        releasedAt = responded! + 45 * MIN;
        const donor = !isWh && chance(rQty, 0.6);
        releasedReason = donor ? 'DONOR_WITHDRAWN' : 'STAFF_CANCELLED';
        resExpires = tl.pickupEnd;
        allocState = 'CANCELLED';
        cancelReason = releasedReason;
        break;
      }
      case 'FEE_REFUSED':
        resState = 'RELEASED';
        releasedAt = responded! + 40 * MIN;
        releasedReason = 'FEE_REFUSED';
        resExpires = tl.pickupEnd;
        allocState = 'CANCELLED';
        cancelReason = 'LOGISTICS_FEE_REFUSED';
        break;
      case 'EXPIRED_NO_RESPONSE':
        resKind = 'HOLD';
        resState = 'EXPIRED';
        releasedAt = tl.expires;
        resExpires = tl.expires;
        allocState = 'EXPIRED';
        break;
      case 'EXPIRED_RESERVATION':
        resState = 'EXPIRED';
        resExpires = responded! + 120 * MIN;
        releasedAt = resExpires;
        allocState = 'EXPIRED';
        break;
      case 'OFFER_HELD':
        resKind = 'HOLD';
        resState = 'ACTIVE';
        resExpires = tl.expires;
        allocState = 'OFFER_HELD';
        break;
      default:
        resState = 'ACTIVE';
        resExpires = tl.pickupEnd;
        allocState = label;
    }
    if (resState === 'ACTIVE' && resExpires <= T) throw new Error(`in-progress hold already expired for ${s.code}`);
    const lastAt = Math.max(releasedAt ?? 0, receivedAt ?? 0, dispatchedAt ?? 0, finalAt ?? 0, responded ?? 0, tl.queued);
    ds.add('allocations', {
      id: allocationId, tenant_id: tenantId, code: s.code, item_id: s.itemId, release_plan_id: s.releasePlanId,
      source_type: isWh ? 'BATCH' : 'DIRECT_ITEM', flo_id: f.id, category_id: p.categoryId, quantity: formatQty(allocQty), unit,
      unit_kind: p.def.unitKind, state: allocState, cancel_reason: cancelReason, chosen_run_id: null, campaign_id: s.campaignId,
      manual_approval_id: null, planned_pickup_start: iso(tl.pickupStart), planned_pickup_end: iso(tl.pickupEnd),
      planned_receipt_at: iso(tl.plannedReceipt), planned_distribution_at: iso(tl.plannedDistribution),
      planned_service_date: clock.dateOf(tl.plannedDistribution), revision: 1, created_at: iso(tl.queued), updated_at: iso(lastAt),
    });
    ds.add('reservations', {
      id: reservationId, tenant_id: tenantId, kind: resKind, source_type: isWh ? 'BATCH' : 'DIRECT_ITEM', allocation_id: allocationId,
      offer_id: offerId, state: resState, expires_at: iso(resExpires), released_reason: resState === 'RELEASED' ? releasedReason : null,
      revision: 1, created_at: iso(tl.queued), updated_at: iso(releasedAt ?? dispatchedAt ?? responded ?? tl.queued),
    });
    ds.add('reservation_lines', {
      id: ids.id('reservation_line', s.key), tenant_id: tenantId, reservation_id: reservationId, item_id: s.itemId,
      batch_id: s.batch?.id ?? null, quantity: formatQty(allocQty), unit,
      state: resState === 'ACTIVE' ? 'ACTIVE' : resState === 'CONSUMED' ? 'CONSUMED' : 'RELEASED',
      created_at: iso(tl.queued), updated_at: iso(releasedAt ?? dispatchedAt ?? responded ?? tl.queued),
    });

    meta.labelCounts[label] = (meta.labelCounts[label] ?? 0) + 1;
    return {
      allocQty, holdReleasedAt: resState === 'RELEASED' || resState === 'EXPIRED' ? releasedAt : null, dispatchedAt, receivedAt,
      accepted: acceptedQty, rejected: rejectedQty, responseDeadline: tl.expires, lastAt, campaignLineId: lineId,
    };
  }

  function contactMinutes(a: number, b: number): number {
    // Contact minutes between two instants (08:00–20:00 local), by bisection on addContactMinutes.
    let lo = 0;
    let hi = Math.ceil((b - a) / MIN) + 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (clock.addContactMinutes(a, mid) >= b) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  function emitCampaign(c: {
    key: string;
    id: string;
    itemId: string | null;
    releasePlanId: string | null;
    t0: number;
    lastDeadline: number;
    running: boolean;
    lastAt: number;
    sourceType: 'DIRECT_ITEM' | 'BATCH';
    approver: string;
  }): void {
    const created = c.t0 + 15 * MIN;
    const approvedAt = c.t0 + 30 * MIN;
    ds.add('outreach_campaigns', {
      id: c.id, tenant_id: tenantId, item_id: c.itemId, release_plan_id: c.releasePlanId, source_type: c.sourceType, allocation_run_id: null,
      state: c.running ? 'RUNNING' : 'COMPLETED', revision: 1, plan_hash: null, response_window_min: RESPONSE_WINDOW_MIN,
      expansion_bands: [], template_version: 'OFFER-ID-1', created_at: iso(created), created_by: users.KOORD1, updated_at: iso(c.lastAt),
    });
    ds.add('approvals', {
      id: ids.id('approval', `OUTREACH:${c.key}`), tenant_id: tenantId, stage: 'OUTREACH', subject_type: 'OUTREACH_CAMPAIGN',
      subject_id: c.id, subject_revision: 1, input_hash: '0'.repeat(64), approver_id: c.approver, approved_at: iso(approvedAt),
      expires_at: iso(c.lastDeadline), reason: 'Disetujui untuk penjangkauan (riwayat simulasi)', invalidated_at: null, invalidated_reason: null,
      created_at: iso(approvedAt), created_by: c.approver, updated_at: iso(approvedAt),
    });
    addAudit(ds, ids, {
      key: `outreach:${c.key}`, actorId: c.approver, action: 'OUTREACH_APPROVED', subjectType: 'OUTREACH_CAMPAIGN', subjectId: c.id,
      subjectRevision: 1, policyVersionId: policies['OUTREACH-DEMO-1.0'], at: approvedAt,
    });
  }

  // ------------------------------------------------------------ labels
  const histLabels: HistLabel[] = [];
  for (const [k, n] of Object.entries(HIST_LABEL_COUNTS) as [HistLabel, number][]) for (let i = 0; i < n; i++) histLabels.push(k);
  // One RECEIVED label belongs to the FLO-0002 fixture slot.
  histLabels.splice(histLabels.indexOf('RECEIVED'), 1);
  const shuffledLabels = shuffle(histLabels, streams.get('history.labels'));
  const DIRECT_RANDOM = 430;
  const directLabels = shuffledLabels.slice(0, DIRECT_RANDOM);
  const warehouseLabels = shuffledLabels.slice(DIRECT_RANDOM);
  if (warehouseLabels.length !== 144) throw new Error(`expected 144 warehouse labels, got ${warehouseLabels.length}`);

  // ------------------------------------------------------------ direct items
  interface ItemPlan {
    order: OrderPlan;
    lineNo: number;
    productCode: string;
    key: string;
    id: string;
    slots: number;
  }
  const oldItems: ItemPlan[] = [];
  for (const o of orders) {
    if (o.group !== 'OLD') continue;
    o.products.forEach((pc, j) => {
      const key = `${o.code}:${j + 1}`;
      oldItems.push({ order: o, lineNo: j + 1, productCode: pc, key, id: ids.id('item', key), slots: 1 });
    });
  }
  // Largest remainder: each item ≥ 1 slot, the rest by weights, total exactly 430.
  {
    const extra = DIRECT_RANDOM - oldItems.length;
    if (extra < 0) throw new Error('more old direct items than direct slots');
    const weights = oldItems.map(() => 0.5 + 2.5 * rItems());
    const total = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map((w) => (w / total) * extra);
    const floors = raw.map((r) => Math.floor(r));
    let left = extra - floors.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
    for (const { i } of order) {
      if (left <= 0) break;
      floors[i]++;
      left--;
    }
    oldItems.forEach((it, i) => (it.slots = 1 + floors[i]));
  }

  const intakeRng = streams.get('history.intake');
  let labelCursor = 0;

  const emitDirectOrder = (o: OrderPlan, items: { key: string; id: string; lineNo: number; productCode: string; quantity: bigint; tl: Timeline }[], state: string, intake: string) => {
    const t0 = o.t0;
    const src = o.source;
    ds.add('donation_orders', {
      id: o.id, tenant_id: tenantId, code: o.code, donor_id: src.donorId, source_location_id: src.id, route: 'DIRECT',
      intake_channel: intake, donation_reason: DONATION_REASON[src.kind] ?? 'SURPLUS', pickup_start: iso(items[0].tl.pickupStart),
      pickup_end: iso(items[0].tl.pickupEnd), operational_state: state, reporting_state: null,
      external_ref: intake === 'CSV' ? `FC-IMP-${o.code!.slice(4)}` : null, revision: 1, created_at: iso(t0), created_by: users.KOORD1,
      updated_at: iso(t0 + 10 * MIN),
    });
    for (const it of items) emitItem(it, t0, 'CLEARED');
  };

  const emitItem = (
    it: { key: string; id: string; lineNo: number; productCode: string; quantity: bigint | null; tl: Pick<Timeline, 'distributeBy'> | null; unit?: string; description?: string; missing?: string[]; parse?: unknown; conversionId?: string | null },
    t0: number,
    safety: 'CLEARED' | 'REVIEW_REQUIRED' | 'PENDING',
    orderId?: string,
  ) => {
    const p = ref.products[it.productCode];
    const unit = it.unit ?? p.def.baseUnit;
    const comparable = ref.categories[p.def.category].def.comparableUnit;
    const conversionId =
      it.conversionId !== undefined ? it.conversionId : unit !== comparable ? (ref.conversions[`${it.productCode}:${unit}:${comparable}`] ?? null) : null;
    const estKg = it.quantity === null || unit !== p.def.baseUnit ? null : ((Number(it.quantity) / 1000) * EST_KG_PER_UNIT[it.productCode]).toFixed(3);
    ds.add('donation_items', {
      id: it.id, tenant_id: tenantId, order_id: orderId ?? ids.id('order', it.key.split(':')[0]), line_no: it.lineNo, product_id: p.id,
      category_id: p.categoryId, description: it.description ?? p.def.name, quantity: it.quantity === null ? null : formatQty(it.quantity),
      unit: it.quantity === null && !it.unit ? null : unit, unit_kind: p.def.unitKind, conversion_id: conversionId,
      est_weight_kg: estKg, measured_weight_kg: it.productCode === 'BERAS-5KG' && estKg ? estKg : null,
      weight_provenance: estKg ? (it.productCode === 'BERAS-5KG' ? 'MEASURED' : 'ESTIMATED') : null, condition: 'BAIK',
      storage_req: p.def.storage, prep_info: it.tl ? { ready_at: iso(t0 - HOUR) } : null, label_info: null,
      distribute_by: it.tl ? iso(it.tl.distributeBy) : null, safety_state: safety, parse: it.parse ?? null,
      missing_fields: it.missing ?? [], revision: 1, created_at: iso(t0), created_by: users.KOORD1, updated_at: iso(t0 + 10 * MIN),
    });
    if (safety !== 'PENDING') {
      const verdict = safety;
      ds.add('safety_evaluations', {
        id: ids.id('safety', it.key), tenant_id: tenantId, subject_type: 'ITEM', subject_id: it.id, policy_version_id: policies['SAFETY-DEMO-SYNTH-1.0'],
        inputs_hash: sha256Hex(canonicalJson({ item: it.key, product: it.productCode, distribute_by: it.tl ? iso(it.tl.distributeBy) : null })),
        deterministic_verdict: verdict, ai_proposed_verdict: null, verdict, reasons: verdict === 'REVIEW_REQUIRED' ? ['COLD_CHAIN_UNCONFIRMED'] : [],
        usable_until: it.tl ? iso(it.tl.distributeBy) : null, reviewer_id: null, reviewed_at: null, created_at: iso(t0 + 10 * MIN),
      });
    }
  };

  // Old direct orders + the fixture order --------------------------------
  for (const o of orders) {
    if (o.group !== 'OLD' && o.group !== 'FIXTURE_RECENT_BREAD') continue;
    const intakeU = intakeRng();
    const intake = o.group === 'FIXTURE_RECENT_BREAD' ? 'MESSAGE' : intakeU < 0.08 ? 'CSV' : intakeU < 0.3 ? 'MESSAGE' : 'MANUAL';
    const items: { key: string; id: string; lineNo: number; productCode: string; quantity: bigint; tl: Timeline }[] = [];
    const itemPlans = o.group === 'OLD'
      ? oldItems.filter((it) => it.order === o)
      : [{ order: o, lineNo: 1, productCode: 'ROTI-TAWAR', key: `${o.code}:1`, id: ids.id('item', `${o.code}:1`), slots: 1 }];
    for (const it of itemPlans) {
      const p = ref.products[it.productCode];
      const cat = p.def.category;
      const campaignKey = it.key;
      const campaignId = ids.id('campaign', campaignKey);
      const used = new Set<string>();
      let sumOffered = 0n;
      let lastDeadline = 0;
      let lastAt = 0;
      let tlFirst: Timeline | null = null;
      for (let k = 1; k <= it.slots; k++) {
        const isFixture = o.group === 'FIXTURE_RECENT_BREAD';
        const label: SlotLabel = isFixture ? 'RECEIVED' : directLabels[labelCursor++];
        let base = standardTimeline(o.t0, k);
        if (isFixture) {
          // Received exactly at T − 2d (08:00 WIB two days before the clock).
          const travel = routingFixture('SRC-001', 'FLO-0002')!.minutes;
          const dispatched = T - 2 * DAY - travel * MIN;
          base = { ...base, pickupStart: dispatched - 10 * MIN, pickupEnd: dispatched + 2 * HOUR, plannedReceipt: T - 2 * DAY,
            plannedDistribution: T - 2 * DAY + 3 * HOUR, distributeBy: T - 2 * DAY + 8 * HOUR };
        }
        const flo = selectFlo({
          label, category: cat, areas: [o.source.area], sentAt: base.sent, receiptBound: base.pickupEnd + 3 * HOUR, exclude: used,
          inProgress: false, forceCode: isFixture ? 'FLO-0002' : undefined,
        });
        used.add(flo.code);
        const respondedLabels: SlotLabel[] = ['RECEIVED', 'PARTIAL', 'DECLINED', 'DECLINED_FEE', 'CANCELLED_OTHER', 'EXPIRED_RESERVATION', 'FEE_REFUSED'];
        const rm = label === 'DECLINED_FEE' ? Math.min(responseMinutes(flo), 110) : responseMinutes(flo);
        const tl: Timeline = { ...base, responded: respondedLabels.includes(label) ? clock.addContactMinutes(base.sent, rm) : null };
        if (tl.responded !== null && tl.responded >= tl.expires) tl.responded = tl.expires - MIN;
        tlFirst ??= tl;
        const offered = drawQty(rQty, it.productCode, p.def.minIncrement);
        const suffix = `${it.key.replace('ORD-', '').replace(':', '-')}-${k}`;
        const slotKey = isFixture ? FIXTURE_SLOT_KEY : `${it.key}:${k}`;
        const out = emitSlot({
          key: slotKey, code: `ALC-${suffix}`, offerCode: `OFR-${suffix}`, deliveryCode: `DLV-${suffix}`, label, flo,
          productCode: it.productCode, route: 'DIRECT', offered, rank: k, campaignId, itemId: it.id, releasePlanId: null, batch: null,
          source: o.source, tl, origin: intake === 'CSV' ? 'IMPORT' : 'LOCAL',
        });
        sumOffered += offered;
        lastDeadline = Math.max(lastDeadline, out.responseDeadline);
        lastAt = Math.max(lastAt, out.lastAt);
      }
      const remainder = rItems() < 0.6 ? 0n : BigInt(intIn(rItems, 1, 6)) * p.def.minIncrement;
      items.push({ key: it.key, id: it.id, lineNo: it.lineNo, productCode: it.productCode, quantity: sumOffered + remainder, tl: tlFirst! });
      emitCampaign({
        key: campaignKey, id: campaignId, itemId: it.id, releasePlanId: null, t0: o.t0, lastDeadline, running: false, lastAt,
        sourceType: 'DIRECT_ITEM', approver: o.t0 % 2 === 0 ? users.KOORD1 : users.ADMIN,
      });
    }
    emitDirectOrder(o, items, 'CLOSED', intake);
  }
  if (labelCursor !== DIRECT_RANDOM) throw new Error(`direct labels consumed ${labelCursor} != ${DIRECT_RANDOM}`);

  // In-progress direct orders ------------------------------------------------
  for (const o of orders) {
    if (o.group !== 'IN_PROGRESS') continue;
    const g = o.inProgress!;
    const p = ref.products[g.product];
    const key = `${o.code}:1`;
    const itemId = ids.id('item', key);
    const campaignId = ids.id('campaign', key);
    const used = new Set<string>();
    const [ps, pe] = IN_PROGRESS_PICKUP[g.state];
    let sumOffered = 0n;
    let lastDeadline = 0;
    let lastAt = 0;
    let tlFirst: Timeline | null = null;
    for (let k = 1; k <= g.direct; k++) {
      const queued = o.t0 + 35 * MIN + (k - 1) * MIN;
      const sent = queued + MIN;
      const pickupStart = T + ps * HOUR;
      const base = {
        t0: o.t0, queued, sent, expires: clock.addContactMinutes(sent, RESPONSE_WINDOW_MIN), pickupStart, pickupEnd: T + pe * HOUR,
        plannedReceipt: pickupStart + HOUR, plannedDistribution: pickupStart + 4 * HOUR, distributeBy: T + (pe + 6) * HOUR,
      };
      const flo = selectFlo({ label: g.state, category: p.def.category, areas: [o.source.area], sentAt: sent, receiptBound: base.pickupEnd + 3 * HOUR, exclude: used, inProgress: true });
      used.add(flo.code);
      const rm = Math.min(responseMinutes(flo), 110);
      const tl: Timeline = { ...base, responded: g.state === 'OFFER_HELD' ? null : clock.addContactMinutes(sent, rm) };
      tlFirst ??= tl;
      const offered = drawQty(rQty, g.product, p.def.minIncrement);
      const suffix = `${key.replace('ORD-', '').replace(':', '-')}-${k}`;
      const out = emitSlot({
        key: `${key}:${k}`, code: `ALC-${suffix}`, offerCode: `OFR-${suffix}`, deliveryCode: `DLV-${suffix}`, label: g.state, flo,
        productCode: g.product, route: 'DIRECT', offered, rank: k, campaignId, itemId, releasePlanId: null, batch: null, source: o.source, tl,
        origin: 'LOCAL',
      });
      sumOffered += offered;
      lastDeadline = Math.max(lastDeadline, out.responseDeadline);
      lastAt = Math.max(lastAt, out.lastAt);
    }
    emitCampaign({
      key, id: campaignId, itemId, releasePlanId: null, t0: o.t0, lastDeadline, running: g.state === 'OFFER_HELD', lastAt,
      sourceType: 'DIRECT_ITEM', approver: users.KOORD1,
    });
    emitDirectOrder(o, [{ key, id: itemId, lineNo: 1, productCode: g.product, quantity: sumOffered, tl: tlFirst! }],
      g.state === 'OFFER_HELD' ? 'ALLOCATING' : 'FULLY_ALLOCATED', 'MANUAL');
  }

  // Today orders --------------------------------------------------------------
  for (const o of orders) {
    if (o.group !== 'TODAY') continue;
    const tdy = o.today!;
    const src = o.source;
    const pickupStart = tdy.state === 'DRAFT' ? null : T + 2 * HOUR;
    const pickupEnd = tdy.state === 'DRAFT' ? null : T + 5 * HOUR;
    const distributeBy = tdy.key === 'SC01_BREAD' ? T + 10 * HOUR : tdy.state === 'DRAFT' ? null : T + 9 * HOUR;
    ds.add('donation_orders', {
      id: o.id, tenant_id: tenantId, code: o.code, donor_id: src.donorId, source_location_id: src.id, route: 'DIRECT',
      intake_channel: tdy.key === 'AC48_TRAY' ? 'MESSAGE' : 'MANUAL', donation_reason: DONATION_REASON[src.kind] ?? 'SURPLUS',
      pickup_start: pickupStart === null ? null : iso(tdy.key === 'SC01_BREAD' ? T + HOUR : pickupStart),
      pickup_end: pickupEnd === null ? null : iso(tdy.key === 'SC01_BREAD' ? T + 4 * HOUR : pickupEnd),
      operational_state: tdy.state, reporting_state: null, external_ref: null, revision: 1, created_at: iso(o.t0), created_by: users.KOORD1,
      updated_at: iso(o.t0 + 5 * MIN),
    });
    const itemKey = `${o.code}:1`;
    emitItem(
      {
        key: itemKey, id: ids.id('item', itemKey), lineNo: 1, productCode: tdy.product!, quantity: tdy.qty === null ? null : BigInt(Math.round(Number(tdy.qty) * 1000)),
        tl: distributeBy === null ? null : { distributeBy }, unit: tdy.unit ?? undefined, description: tdy.description, missing: tdy.missing,
        parse: tdy.parse, conversionId: tdy.unit === 'tray' ? null : undefined,
      },
      o.t0,
      tdy.safety,
      o.id,
    );
  }

  // ------------------------------------------------------ warehouse orders
  const whOrderPlans: WarehouseOrderPlan[] = [];
  for (const w of whPlans) {
    const o = w.plan;
    const key = `${o.code}:1`;
    const itemId = ids.id('item', key);
    const p = ref.products[w.productCode];
    const inspected = o.group === 'INSPECTED';
    ds.add('donation_orders', {
      id: o.id, tenant_id: tenantId, code: o.code, donor_id: o.source.donorId, source_location_id: o.source.id, route: 'WAREHOUSE_INBOUND',
      intake_channel: chance(intakeRng, 0.5) ? 'CSV' : 'MANUAL', donation_reason: DONATION_REASON[o.source.kind] ?? 'NEAR_EXPIRY',
      pickup_start: null, pickup_end: null, operational_state: inspected ? 'CLOSED' : 'READY', reporting_state: null, external_ref: null,
      revision: 1, created_at: iso(o.t0), created_by: users.KOORD1, updated_at: iso(o.t0 + 10 * MIN),
    });
    const quantity = BigInt(w.qty) * 1000n;
    ds.add('donation_items', {
      id: itemId, tenant_id: tenantId, order_id: o.id, line_no: 1, product_id: p.id, category_id: p.categoryId, description: p.def.name,
      quantity: formatQty(quantity), unit: p.def.baseUnit, unit_kind: p.def.unitKind,
      conversion_id: ref.conversions[`${w.productCode}:${p.def.baseUnit}:${ref.categories[p.def.category].def.comparableUnit}`] ?? null,
      est_weight_kg: (w.qty * EST_KG_PER_UNIT[w.productCode]).toFixed(3), measured_weight_kg: null, weight_provenance: 'ESTIMATED',
      condition: 'BAIK', storage_req: p.def.storage, prep_info: null, label_info: { packaged: true }, distribute_by: null,
      safety_state: inspected ? 'CLEARED' : 'PENDING', parse: null, missing_fields: [], revision: 1, created_at: iso(o.t0),
      created_by: users.KOORD1, updated_at: iso(o.t0 + 10 * MIN),
    });
    whOrderPlans.push({
      orderId: o.id!, orderCode: o.code!, itemId, productCode: w.productCode, warehouseCode: o.warehouseCode!, t0: o.t0, expectedQty: w.qty,
      inspected, expectedAt: o.expectedAt!,
    });
  }
  const inbound = buildInbounds(ds, clock, ids, streams, ref, whOrderPlans);
  meta.batchCount = inbound.batches.length;

  // ------------------------------------------------- warehouse simulation
  const ledger = new Ledger(ds, ids, tenantId);
  type Ev = { at: number; seq: number; run: () => void };
  const queue: Ev[] = [];
  let seq = 0;
  const push = (at: number, run: () => void) => {
    const ev = { at, seq: seq++, run };
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const q = queue[mid];
      if (q.at < ev.at || (q.at === ev.at && q.seq < ev.seq)) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, ev);
  };
  for (const e of inbound.events) push(e.at, () => e.run(ledger));

  const rWh = streams.get('history.warehouse');
  const MIN_SHELF = 7 * DAY;
  const whCodeSeq = new Map<string, number>();
  const firstInspection = Math.min(...inbound.batches.map((b) => b.receivedAt));

  interface WhSlot {
    label: SlotLabel;
    hold: number;
    warehouseCode: string;
    inProgress: boolean;
    reschedules: number;
  }
  // Historical warehouse holds: sorted instants between first stock + 3 days and yesterday, 08:00–12:00.
  const whStartDay = Math.ceil((firstInspection - clock.dayStart(histStartDate)) / DAY) + 3;
  const whSlots: WhSlot[] = [];
  const holdTimes: number[] = [];
  for (let i = 0; i < warehouseLabels.length; i++) {
    const day = intIn(rWh, whStartDay, 89);
    holdTimes.push(clock.at(clock.addDays(histStartDate, day), 8, intIn(rWh, 0, 240)));
  }
  holdTimes.sort((a, b) => a - b);
  warehouseLabels.forEach((label, i) => {
    whSlots.push({ label, hold: holdTimes[i], warehouseCode: rWh() < 0.6 ? 'WH-JKU' : 'WH-BKS', inProgress: false, reschedules: 0 });
  });
  for (const g of IN_PROGRESS) {
    whSlots.push({
      label: g.state, hold: clock.at(yesterday, IN_PROGRESS_T0_HOUR[g.state]) + 65 * MIN, warehouseCode: 'WH-JKU', inProgress: true, reschedules: 0,
    });
  }

  const availableBatches = (warehouseCode: string, at: number): BatchInfo[] =>
    inbound.batches
      .filter(
        (b) =>
          b.warehouseCode === warehouseCode && !b.expiryDemo && b.receivedAt <= at && b.usableUntil >= at + MIN_SHELF &&
          ledger.balance(b.id, 'AVAILABLE') > 0n,
      )
      .sort((a, b) => a.usableUntil - b.usableUntil || a.receivedAt - b.receivedAt || (a.id < b.id ? -1 : 1));

  const processHold = (ws: WhSlot) => {
    let whCode = ws.warehouseCode;
    let cands = availableBatches(whCode, ws.hold);
    if (cands.length === 0) {
      whCode = whCode === 'WH-JKU' ? 'WH-BKS' : 'WH-JKU';
      cands = availableBatches(whCode, ws.hold);
    }
    if (cands.length === 0) {
      if (ws.inProgress || ws.hold + DAY > T - DAY || ws.reschedules > 20) throw new Error(`no warehouse stock for slot at ${iso(ws.hold)}`);
      ws.reschedules++;
      meta.warehouseReschedules++;
      ws.hold += DAY;
      push(ws.hold, () => processHold(ws));
      return;
    }
    const productsAvail = [...new Set(cands.map((b) => b.productCode))].sort();
    const productCode = productsAvail[intIn(rWh, 0, productsAvail.length - 1)];
    const batch = cands.find((b) => b.productCode === productCode)!;
    const size = WAREHOUSE_SIZES[productCode];
    const desired = BigInt(drawUnits(rWh, size.alloc, 1)) * 1000n;
    const avail = ledger.balance(batch.id, 'AVAILABLE');
    const qty = desired < avail ? desired : avail;
    const p = ref.products[productCode];
    const wh = ref.warehouses[whCode];
    const date = clock.dateOf(ws.hold);
    const n = (whCodeSeq.get(date) ?? 0) + 1;
    whCodeSeq.set(date, n);
    const suffix = `${yymmdd(date)}-${pad(n, 2)}`;
    const key = `W:${suffix}`;
    const t0 = ws.hold - 35 * MIN;
    let base: Omit<Timeline, 'responded'>;
    if (ws.inProgress) {
      const [ps, pe] = IN_PROGRESS_PICKUP[ws.label as InProgressState];
      const pickupStart = T + ps * HOUR;
      base = {
        t0, queued: ws.hold, sent: ws.hold + MIN, expires: clock.addContactMinutes(ws.hold + MIN, RESPONSE_WINDOW_MIN), pickupStart,
        pickupEnd: T + pe * HOUR, plannedReceipt: pickupStart + HOUR, plannedDistribution: pickupStart + 4 * HOUR, distributeBy: T + (pe + 48) * HOUR,
      };
    } else {
      base = standardTimeline(t0, 1);
      base = { ...base, distributeBy: base.t0 + 3 * DAY };
    }
    const flo = selectFlo({
      label: ws.label, category: p.def.category, areas: WAREHOUSES.find((w) => w.code === whCode)!.serves, sentAt: base.sent,
      receiptBound: base.pickupEnd + 3 * HOUR, exclude: new Set(), inProgress: ws.inProgress,
    });
    const respondedLabels: SlotLabel[] = ['RECEIVED', 'PARTIAL', 'DECLINED', 'DECLINED_FEE', 'CANCELLED_OTHER', 'EXPIRED_RESERVATION', 'FEE_REFUSED',
      'ACCEPTED_RESERVED', 'LOGISTICS_PENDING', 'AWAITING_FINAL_APPROVAL', 'APPROVED', 'DISPATCHED'];
    const rm = ws.inProgress || ws.label === 'DECLINED_FEE' ? Math.min(responseMinutes(flo), 110) : responseMinutes(flo);
    const tl: Timeline = { ...base, responded: respondedLabels.includes(ws.label) ? clock.addContactMinutes(base.sent, rm) : null };
    if (tl.responded !== null && tl.responded >= tl.expires) tl.responded = tl.expires - MIN;
    const releasePlanId = ids.id('release_plan', key);
    const campaignId = ids.id('campaign', key);
    ds.add('release_plans', {
      id: releasePlanId, tenant_id: tenantId, warehouse_id: wh.source.id, state: ws.inProgress ? 'ACTIVE' : 'COMPLETED', revision: 1,
      created_at: iso(t0), created_by: users.KOORD1, updated_at: iso(t0),
    });
    // Hold movement first (AVAILABLE → RESERVED) at queue time.
    ledger.post({
      key: `hold:${key}`, type: 'RESERVATION_TRANSFER', at: ws.hold, actorId: null, reason: 'Hold penawaran (FEFO)',
      entries: [
        { batchId: batch.id, account: 'AVAILABLE', qty: -qty },
        { batchId: batch.id, account: 'RESERVED', qty },
      ],
    });
    const out = emitSlot({
      key, code: `ALW-${suffix}`, offerCode: `OFW-${suffix}`, deliveryCode: `DLW-${suffix}`, label: ws.label, flo, productCode,
      route: 'WAREHOUSE', offered: qty, rank: 1, campaignId, itemId: null, releasePlanId, batch, source: wh.source, tl, origin: 'LOCAL',
    });
    emitCampaign({
      key, id: campaignId, itemId: null, releasePlanId, t0, lastDeadline: out.responseDeadline, running: ws.label === 'OFFER_HELD', lastAt: out.lastAt,
      sourceType: 'BATCH', approver: users.KOORD2,
    });
    if (out.holdReleasedAt !== null) {
      const at = out.holdReleasedAt;
      push(at, () =>
        ledger.post({
          key: `release:${key}`, type: 'RESERVATION_RELEASE', at, actorId: null, reason: 'Hold/reservasi dilepas',
          entries: [
            { batchId: batch.id, account: 'RESERVED', qty: -qty },
            { batchId: batch.id, account: 'AVAILABLE', qty },
          ],
        }),
      );
    }
    if (out.dispatchedAt !== null) {
      const at = out.dispatchedAt;
      push(at, () =>
        ledger.post({
          key: `dispatch:${key}`, type: 'DISPATCH_TRANSFER', at, actorId: users.GUDANG1, reason: 'Pengiriman keluar',
          entries: [
            { batchId: batch.id, account: 'RESERVED', qty: -qty },
            { batchId: batch.id, account: 'IN_TRANSIT', qty },
          ],
        }),
      );
    }
    if (out.receivedAt !== null) {
      const at = out.receivedAt;
      const acc = out.accepted;
      const rej = out.rejected;
      push(at, () =>
        ledger.post({
          key: `delivery_receipt:${key}`, type: 'DELIVERY_RECEIPT', at, actorId: null, reason: 'Diterima FLO',
          entries: [
            { batchId: batch.id, account: 'IN_TRANSIT', qty: -(acc + rej) },
            { batchId: batch.id, account: 'DELIVERED', qty: acc },
            { batchId: batch.id, account: 'EXCEPTION', qty: rej },
          ],
        }),
      );
    }
  };
  for (const ws of whSlots) push(ws.hold, () => processHold(ws));
  while (queue.length > 0) {
    const ev = queue.shift()!;
    if (ev.at > T) throw new Error(`warehouse event after the clock at ${iso(ev.at)}`);
    ev.run();
  }
  ledger.finalize(inbound.batches.map((b) => b.id), T);

  return { receipts, dispatches, meta };
}

function isInProgress(label: SlotLabel): label is InProgressState {
  return ['OFFER_HELD', 'ACCEPTED_RESERVED', 'LOGISTICS_PENDING', 'AWAITING_FINAL_APPROVAL', 'APPROVED', 'DISPATCHED'].includes(label);
}

function pickFrom<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

/** Natural key of the F_SC01_RECENT_BREAD slot (received at clock − 2 days). */
export const FIXTURE_SLOT_KEY = 'fixture:F_SC01_RECENT_BREAD';
