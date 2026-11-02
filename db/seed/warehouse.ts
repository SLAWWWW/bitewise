/**
 * Warehouse part of step 5 (architecture B): 80 expected inbounds (75 inspected,
 * 5 expected), 75 inspections → exactly 120 batches (45 split into 2 lots), quarantine
 * portions (5 released, 3 held), rejections (dispositions only), and an in-memory
 * double-entry ledger whose final balances become batch_balances.
 */
import { formatQty } from '@/src/lib/qty';
import { shuffle, type Rng } from '@/src/lib/prng';
import { DAY, HOUR, MIN, intIn, iso, type Clock, type Ids, type Streams } from './config';
import type { Dataset } from './dataset';
import type { RefContext } from './reference';
import { addAudit } from './audit';

export type Account =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'IN_TRANSIT'
  | 'QUARANTINE'
  | 'RETURN_PENDING'
  | 'DISPOSED'
  | 'EXTERNAL_RECEIPT'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'ADJUSTMENT_OFFSET';

const PHYSICAL_NON_NEGATIVE: ReadonlySet<Account> = new Set(['AVAILABLE', 'RESERVED', 'IN_TRANSIT', 'QUARANTINE', 'RETURN_PENDING', 'DISPOSED', 'DELIVERED', 'EXCEPTION']);

export interface BatchInfo {
  id: string;
  code: string;
  productCode: string;
  warehouseCode: string;
  receivedAt: number;
  usableUntil: number;
  /** Lot that never becomes allocatable (expiry demo): too little shelf life left. */
  expiryDemo: boolean;
}

export interface LedgerEntry {
  batchId: string;
  account: Account;
  qty: bigint;
}

export class Ledger {
  private balances = new Map<string, Map<Account, bigint>>();
  private entryCount = 0;
  movements = 0;

  constructor(
    private ds: Dataset,
    private ids: Ids,
    private tenantId: string,
  ) {}

  balance(batchId: string, account: Account): bigint {
    return this.balances.get(batchId)?.get(account) ?? 0n;
  }

  post(m: { key: string; type: string; at: number; actorId: string | null; reason: string | null; entries: LedgerEntry[] }): string {
    const id = this.ids.id('movement', m.key);
    const at = iso(m.at);
    // Zero-sum per batch (mirrors the deferred SQL trigger).
    const perBatch = new Map<string, bigint>();
    for (const e of m.entries) perBatch.set(e.batchId, (perBatch.get(e.batchId) ?? 0n) + e.qty);
    for (const [b, s] of perBatch) if (s !== 0n) throw new Error(`Unbalanced movement ${m.key} on batch ${b}`);
    this.ds.add('stock_movements', {
      id, tenant_id: this.tenantId, command_id: `seed:${m.key}`, type: m.type, reversal_of: null, reason: m.reason,
      actor_id: m.actorId, occurred_at: at, correlation_id: `seed:${m.key}`, created_at: at, created_by: m.actorId,
    });
    this.movements++;
    let n = 0;
    for (const e of m.entries) {
      if (e.qty === 0n) continue;
      n++;
      this.entryCount++;
      this.ds.add('movement_entries', {
        id: this.ids.id('movement_entry', `${m.key}:${n}`), tenant_id: this.tenantId, movement_id: id, batch_id: e.batchId,
        account: e.account, signed_qty: formatQty(e.qty), created_at: at, created_by: m.actorId,
      });
      let acc = this.balances.get(e.batchId);
      if (!acc) {
        acc = new Map();
        this.balances.set(e.batchId, acc);
      }
      const next = (acc.get(e.account) ?? 0n) + e.qty;
      if (PHYSICAL_NON_NEGATIVE.has(e.account) && next < 0n) {
        throw new Error(`Negative ${e.account} balance on ${e.batchId} after ${m.key}`);
      }
      acc.set(e.account, next);
    }
    return id;
  }

  /** batch_balances rows = Σ entries per (batch, account), in batch insertion order. */
  finalize(batchOrder: readonly string[], at: number): void {
    for (const b of batchOrder) {
      const acc = this.balances.get(b);
      if (!acc) continue;
      for (const [account, qty] of [...acc.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
        this.ds.add('batch_balances', { tenant_id: this.tenantId, batch_id: b, account, qty: formatQty(qty), updated_at: iso(at) });
      }
    }
  }
}

/** Base-unit batch sizes and per-allocation demand (whole units). */
export const WAREHOUSE_SIZES: Record<string, { batch: [number, number]; alloc: [number, number]; step: number }> = {
  'BERAS-5KG': { batch: [20, 60], alloc: [8, 20], step: 1 },
  'BERAS-CURAH': { batch: [50, 150], alloc: [15, 50], step: 1 },
  BISKUIT: { batch: [40, 120], alloc: [12, 40], step: 1 },
  'WAFER-KARTON': { batch: [48, 144], alloc: [12, 48], step: 24 },
  'MINYAK-1L': { batch: [24, 72], alloc: [6, 24], step: 1 },
  'MIE-INSTAN': { batch: [80, 240], alloc: [20, 80], step: 40 },
};

export function drawUnits(rng: Rng, range: [number, number], step: number): number {
  const lo = Math.ceil(range[0] / step);
  const hi = Math.floor(range[1] / step);
  return intIn(rng, lo, hi) * step;
}

export interface WarehouseOrderPlan {
  orderId: string;
  orderCode: string;
  itemId: string;
  productCode: string;
  warehouseCode: string;
  t0: number;
  expectedQty: number;
  inspected: boolean;
  expectedAt: number;
}

export interface InboundResult {
  batches: BatchInfo[];
  /** Ledger events to replay chronologically: receipt at inspection, quarantine releases. */
  events: { at: number; key: string; run: (ledger: Ledger) => void }[];
}

/**
 * Inbounds, inspections, lots and batches for the warehouse orders. The receipt
 * movements are returned as timed events so the caller can interleave them with
 * outbound holds in one chronological simulation.
 */
export function buildInbounds(
  ds: Dataset,
  clock: Clock,
  ids: Ids,
  streams: Streams,
  ref: RefContext,
  orders: readonly WarehouseOrderPlan[],
): InboundResult {
  const tenantId = ref.tenantId;
  const T = clock.now;
  const rng = streams.get('warehouse.inbound');
  const batches: BatchInfo[] = [];
  const events: InboundResult['events'] = [];

  const inspectedOrders = orders.filter((o) => o.inspected);
  if (inspectedOrders.length !== 75) throw new Error(`expected 75 inspected inbounds, got ${inspectedOrders.length}`);

  // 45 of 75 inspections split into 2 lots → 120 lots = 120 batches.
  const splitSet = new Set(shuffle(inspectedOrders.map((o) => o.orderCode), streams.get('warehouse.split')).slice(0, 45));

  interface Lot {
    order: WarehouseOrderPlan;
    lotNo: number;
    actual: number;
    inspectedAt: number;
    inspector: string;
    expiryDate: string;
    quarantine: number;
    rejected: number;
    expiryDemo: boolean;
    releaseQuarantine: boolean;
  }
  const lots: Lot[] = [];
  const shortageSet = new Set(shuffle(inspectedOrders.map((o) => o.orderCode), streams.get('warehouse.shortage')).slice(0, 5));

  for (const o of orders) {
    const inbound = ids.id('inbound', o.orderCode);
    const lineId = ids.id('inbound_line', `${o.orderCode}:1`);
    const p = ref.products[o.productCode];
    const inspectedAt = o.expectedAt + intIn(rng, 0, 120) * MIN;
    const inspector = intIn(rng, 0, 1) === 0 ? ref.users.GUDANG1 : ref.users.GUDANG2;
    const lot1Share = 0.4 + 0.2 * rng();
    const expiryDays = intIn(rng, 120, 300);
    const lot2Extra = intIn(rng, 20, 60);
    const shortage = shortageSet.has(o.orderCode) ? Math.max(1, Math.round(o.expectedQty * 0.05)) : 0;
    ds.add('expected_inbounds', {
      id: inbound, tenant_id: tenantId, order_id: o.orderId, warehouse_id: ref.warehouses[o.warehouseCode].source.id,
      expected_at: iso(o.expectedAt), state: o.inspected ? 'INSPECTED' : 'EXPECTED', revision: 1,
      created_at: iso(o.t0 + 30 * MIN), created_by: ref.users.KOORD1, updated_at: iso(o.inspected ? inspectedAt : o.t0 + 30 * MIN),
    });
    ds.add('inbound_lines', {
      id: lineId, tenant_id: tenantId, inbound_id: inbound, item_id: o.itemId, product_id: p.id, expected_qty: String(o.expectedQty),
      unit: p.def.baseUnit, created_at: iso(o.t0 + 30 * MIN), updated_at: iso(o.t0 + 30 * MIN),
    });
    if (!o.inspected) continue;
    const actual = o.expectedQty - shortage;
    const split = splitSet.has(o.orderCode);
    const step = WAREHOUSE_SIZES[o.productCode].step;
    const inspDate = clock.dateOf(inspectedAt);
    if (split) {
      const a1 = Math.max(step, Math.round((actual * lot1Share) / step) * step);
      lots.push({ order: o, lotNo: 1, actual: a1, inspectedAt, inspector, expiryDate: clock.addDays(inspDate, expiryDays), quarantine: 0, rejected: 0, expiryDemo: false, releaseQuarantine: false });
      lots.push({ order: o, lotNo: 2, actual: actual - a1, inspectedAt, inspector, expiryDate: clock.addDays(inspDate, expiryDays + lot2Extra), quarantine: 0, rejected: 0, expiryDemo: false, releaseQuarantine: false });
    } else {
      lots.push({ order: o, lotNo: 1, actual, inspectedAt, inspector, expiryDate: clock.addDays(inspDate, expiryDays), quarantine: 0, rejected: 0, expiryDemo: false, releaseQuarantine: false });
    }
  }
  if (lots.length !== 120) throw new Error(`expected 120 lots, got ${lots.length}`);

  // Special lots: 4 expiry demos (old inspections), 3 held + 5 released quarantine
  // portions, 6 rejections. Disjoint sets, chosen on their own stream.
  const pickRng = streams.get('warehouse.special_lots');
  const taken = new Set<Lot>();
  const choose = (pool: Lot[], n: number): Lot[] => {
    const out = shuffle(pool.filter((l) => !taken.has(l)), pickRng).slice(0, n);
    if (out.length !== n) throw new Error('not enough lots for the special warehouse fixtures');
    out.forEach((l) => taken.add(l));
    return out;
  };
  for (const l of choose(lots.filter((l) => l.inspectedAt <= T - 12 * DAY && l.actual >= 4), 4)) {
    l.expiryDemo = true;
    l.expiryDate = clock.addDays(clock.dateOf(l.inspectedAt), 5);
  }
  for (const l of choose(lots.filter((l) => l.inspectedAt >= T - 20 * DAY && l.actual >= 8), 3)) {
    l.quarantine = Math.max(1, Math.round(l.actual * 0.15));
  }
  for (const l of choose(lots.filter((l) => l.inspectedAt < T - 25 * DAY && l.actual >= 8), 5)) {
    l.quarantine = Math.max(1, Math.round(l.actual * 0.15));
    l.releaseQuarantine = true;
  }
  for (const l of choose(lots.filter((l) => l.actual >= 8), 6)) {
    l.rejected = Math.max(1, Math.round(l.actual * 0.06));
  }

  // Inspections (one per inspected inbound), lines (one per lot), batches.
  const byOrder = new Map<string, Lot[]>();
  for (const l of lots) {
    const arr = byOrder.get(l.order.orderCode) ?? [];
    arr.push(l);
    byOrder.set(l.order.orderCode, arr);
  }
  for (const [orderCode, orderLots] of byOrder) {
    const o = orderLots[0].order;
    const p = ref.products[o.productCode];
    const inspectionId = ids.id('inspection', orderCode);
    const at = orderLots[0].inspectedAt;
    const inspector = orderLots[0].inspector;
    ds.add('inspections', {
      id: inspectionId, tenant_id: tenantId, inbound_id: ids.id('inbound', orderCode), inspector_id: inspector, inspected_at: iso(at),
      observations: { temperature: 'ambient', packaging: 'baik', synthetic: true }, created_at: iso(at), created_by: inspector,
    });
    addAudit(ds, ids, {
      key: `inspection:${orderCode}`, actorId: inspector, action: 'INBOUND_INSPECTED', subjectType: 'EXPECTED_INBOUND',
      subjectId: ids.id('inbound', orderCode), at, payload: { order_code: orderCode, lots: orderLots.length },
    });
    for (const l of orderLots) {
      const lotCode = `LOT-${orderCode.slice(4)}-${l.lotNo}`;
      const lineId = ids.id('inspection_line', `${orderCode}:${l.lotNo}`);
      const accepted = l.actual - l.quarantine - l.rejected;
      if (accepted <= 0) throw new Error(`lot ${lotCode} has no accepted quantity`);
      const expiresAt = clock.dayStart(l.expiryDate);
      ds.add('inspection_lines', {
        id: lineId, tenant_id: tenantId, inspection_id: inspectionId, inbound_line_id: ids.id('inbound_line', `${orderCode}:1`),
        external_lot: lotCode, label_expiry: iso(expiresAt), actual_qty: String(l.actual), accepted_qty: String(accepted),
        quarantined_qty: String(l.quarantine), rejected_qty: String(l.rejected),
        condition: l.rejected > 0 ? 'SEBAGIAN_RUSAK' : l.quarantine > 0 ? 'PERLU_PEMERIKSAAN' : 'BAIK',
        storage_obs: 'Kering, suhu ruang', created_at: iso(at), created_by: inspector,
      });
      if (l.rejected > 0) {
        ds.add('dispositions', {
          id: ids.id('disposition', `${orderCode}:${l.lotNo}`), tenant_id: tenantId, source_type: 'INSPECTION_LINE', source_id: lineId,
          qty: String(l.rejected), unit: p.def.baseUnit, kind: 'REJECTED_AT_INBOUND', decided_by: inspector,
          reason: 'Kemasan rusak saat kedatangan (simulasi)', created_at: iso(at), created_by: inspector,
        });
      }
      const batchCode = `BAT-${orderCode.slice(4)}-${l.lotNo}`;
      const batchId = ids.id('batch', batchCode);
      const storageCode = p.def.storage === 'CHILLED' ? 'CHL-01' : l.lotNo === 1 ? 'AMB-01' : 'AMB-02';
      ds.add('inventory_batches', {
        id: batchId, tenant_id: tenantId, batch_code: batchCode, product_id: p.id, category_id: p.categoryId, donor_order_id: o.orderId,
        donor_line_id: o.itemId, external_lot: lotCode, base_unit: p.def.baseUnit, unit_kind: p.def.unitKind,
        storage_location_id: ref.warehouses[o.warehouseCode].storage[storageCode], received_at: iso(at), expires_at: iso(expiresAt),
        handling_deadline: null, condition: 'BAIK', inspection_id: inspectionId, restriction: 'NONE', conversion_id: null,
        created_at: iso(at), created_by: inspector, updated_at: iso(at),
      });
      const info: BatchInfo = {
        id: batchId, code: batchCode, productCode: o.productCode, warehouseCode: o.warehouseCode, receivedAt: at, usableUntil: expiresAt,
        expiryDemo: l.expiryDemo,
      };
      batches.push(info);
      const accQ = BigInt(accepted) * 1000n;
      const qQ = BigInt(l.quarantine) * 1000n;
      events.push({
        at,
        key: `receipt:${batchCode}`,
        run: (ledger) =>
          ledger.post({
            key: `receipt:${batchCode}`, type: 'RECEIPT', at, actorId: inspector, reason: 'Penerimaan inbound terinspeksi',
            entries: [
              { batchId, account: 'EXTERNAL_RECEIPT', qty: -(accQ + qQ) },
              { batchId, account: 'AVAILABLE', qty: accQ },
              { batchId, account: 'QUARANTINE', qty: qQ },
            ],
          }),
      });
      if (l.quarantine > 0) {
        if (l.releaseQuarantine) {
          const relAt = at + intIn(rng, 1, 3) * DAY + 2 * HOUR;
          const releaser = ref.users.GUDANG1;
          events.push({
            at: relAt,
            key: `qrelease:${batchCode}`,
            run: (ledger) =>
              ledger.post({
                key: `qrelease:${batchCode}`, type: 'QUARANTINE_RELEASE', at: relAt, actorId: releaser,
                reason: 'Pemeriksaan ulang: layak (simulasi)',
                entries: [
                  { batchId, account: 'QUARANTINE', qty: -qQ },
                  { batchId, account: 'AVAILABLE', qty: qQ },
                ],
              }),
          });
          ds.add('approvals', {
            id: ids.id('approval', `QUARANTINE_RELEASE:${batchCode}`), tenant_id: tenantId, stage: 'QUARANTINE_RELEASE',
            subject_type: 'BATCH', subject_id: batchId, subject_revision: 1, input_hash: '0'.repeat(64), approver_id: releaser,
            approved_at: iso(relAt), expires_at: null, reason: 'Karantina dilepas setelah pemeriksaan ulang (simulasi)',
            invalidated_at: null, invalidated_reason: null, created_at: iso(relAt), created_by: releaser, updated_at: iso(relAt),
          });
          addAudit(ds, ids, {
            key: `qrelease:${batchCode}`, actorId: releaser, action: 'QUARANTINE_RELEASED', subjectType: 'BATCH', subjectId: batchId,
            at: relAt, payload: { batch_code: batchCode, qty: String(l.quarantine), unit: p.def.baseUnit },
          });
        } else {
          ds.add('tasks', {
            id: ids.id('task', `quarantine_review:${batchCode}`), tenant_id: tenantId, kind: 'QUARANTINE_REVIEW', subject_type: 'BATCH',
            subject_id: batchId, severity: 'MEDIUM', state: 'OPEN', assignee_id: ref.users.GUDANG2, due_at: iso(at + 2 * DAY),
            dedup_key: `quarantine_review:${batchCode}`, payload: { batch_code: batchCode, qty: String(l.quarantine), unit: p.def.baseUnit },
            resolved_at: null, resolution: null, revision: 1, created_at: iso(at), updated_at: iso(at),
          });
        }
      }
      if (l.expiryDemo) {
        ds.add('tasks', {
          id: ids.id('task', `batch_expired:${batchCode}`), tenant_id: tenantId, kind: 'BATCH_EXPIRED', subject_type: 'BATCH',
          subject_id: batchId, severity: 'HIGH', state: 'OPEN', assignee_id: ref.users.GUDANG2, due_at: iso(expiresAt + DAY),
          dedup_key: `batch_expired:${batchCode}`,
          payload: { batch_code: batchCode, remaining_qty: String(accepted), unit: p.def.baseUnit, reason: 'Masa simpan habis sebelum dialokasikan' },
          resolved_at: null, resolution: null, revision: 1, created_at: iso(expiresAt), updated_at: iso(expiresAt),
        });
      }
    }
  }
  return { batches, events };
}
