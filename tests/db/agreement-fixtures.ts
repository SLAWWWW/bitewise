/**
 * W2-FLO test fixture: a small, fully deterministic FLO directory inside a fresh test
 * tenant (owner SQL, uuidv5 ids). Used by tests/db/agreement-commands.test.ts and
 * tests/api/flos.test.ts.
 *
 * TODO(W2-SEED): once db/seed/index.ts exports seedTenant, add a smoke test that runs
 * listFlos/getFlo over the full seed (AC01 classifier parity) in addition to this
 * hand-built fixture, which pins exact R/E/history numbers.
 *
 * Clock T = 2026-10-26T01:00:00Z (08:00 WIB, Monday), FROZEN.
 *
 *  FLO-0001  PANTI     JAKARTA/Sunter  ACTIVE (2026-01-01..2027-06-30)  need 90 fresh  R 6 eligible/5 timely/1 excluded
 *            receipts: BREAD 40 portion (T−2d), BREAD 30 portion (T−10d), SNACK 12 pack (T−3d), STAPLE 5 kg (T−40d),
 *            superseded BREAD 999 portion (T−1d, not current)
 *            obligations: BAST 3 on-time + 1 late; RECEIPT_PHOTO 2 on-time, 1 final-rejected, 1 open past due,
 *            1 open not due, 1 excused, 1 under review
 *            contact sim:flo:0001 (encrypted, AAD = tenant id)
 *  FLO-0002  NON_PANTI JAKARTA/Sunter  EXPIRING_SOON (2025-11-01..2026-10-31, AC03)  need stale
 *  FLO-0003  PANTI     BEKASI          EXPIRING_SOON (2025-11-01..2026-10-31) + PENDING renewal (2026-11-01..2027-10-31, AC04)
 *                                      open renewal task (7 d) on the old version
 *  FLO-0004  NON_PANTI BEKASI          PENDING only
 *  FLO-0005  NON_PANTI JAKARTA         NEW, no agreement, no history
 *  FLO-0006  PANTI     JAKARTA         EXPIRED (2025-01-01..2026-09-30)
 *  FLO-0007  NON_PANTI BEKASI          REVOKED (2026-01-01..2027-01-31, revoked T−1d)
 */
import type pg from 'pg';
import { sealContact } from '@/src/application/flo/contacts';
import { entityId } from '@/src/lib/uuidv5';
import type { TestTenant } from '../setup/db-helpers';

export const T_ISO = '2026-10-26T01:00:00.000Z';
const T_MS = Date.parse(T_ISO);
export const at = (days: number, hours = 0): string => new Date(T_MS + days * 86_400_000 + hours * 3_600_000).toISOString();

export interface FloFixture {
  tenant: TestTenant;
  flo: Record<'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7', string>;
  agreement: {
    F1: string;
    F2: string;
    F3_OLD: string;
    F3_RENEWAL: string;
    F4_PENDING: string;
    F6: string;
    F7: string;
  };
  category: Record<'BREAD' | 'SNACK' | 'STAPLE', string>;
  cluster: Record<'SUNTER' | 'BEKASI', string>;
  renewalTaskF3: string;
}

type Row = Record<string, unknown>;

async function ins(c: pg.PoolClient, table: string, row: Row): Promise<void> {
  const cols = Object.keys(row);
  const vals = cols.map((k) => {
    const v = row[k];
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Buffer) && !(v instanceof Date)
      ? JSON.stringify(v)
      : v;
  });
  await c.query(
    `INSERT INTO lumbung.${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    vals,
  );
}

export async function buildFloFixture(owner: pg.Pool, t: TestTenant): Promise<FloFixture> {
  const id = (entity: string, key: string) => entityId(t.ns, entity, key);
  const tid = t.id;
  const reviewer = t.users.AGREEMENT_REVIEWER.id;
  const coord = t.users.COORDINATOR.id;

  const flo = {
    F1: id('flo', 'FLO-0001'),
    F2: id('flo', 'FLO-0002'),
    F3: id('flo', 'FLO-0003'),
    F4: id('flo', 'FLO-0004'),
    F5: id('flo', 'FLO-0005'),
    F6: id('flo', 'FLO-0006'),
    F7: id('flo', 'FLO-0007'),
  };
  const category = { BREAD: id('category', 'BREAD'), SNACK: id('category', 'SNACK'), STAPLE: id('category', 'STAPLE') };
  const cluster = { SUNTER: id('cluster', 'JKT-SUNTER'), BEKASI: id('cluster', 'BKS-1') };
  const agreement = {
    F1: id('agreement', 'FLO-0001:1'),
    F2: id('agreement', 'FLO-0002:1'),
    F3_OLD: id('agreement', 'FLO-0003:1'),
    F3_RENEWAL: id('agreement', 'FLO-0003:2'),
    F4_PENDING: id('agreement', 'FLO-0004:1'),
    F6: id('agreement', 'FLO-0006:1'),
    F7: id('agreement', 'FLO-0007:1'),
  };
  const renewalTaskF3 = id('renewal', 'FLO-0003:1:7');

  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    // Reference data
    await ins(c, 'categories', { id: category.BREAD, tenant_id: tid, code: 'BREAD', name_id: 'Roti', name_en: 'Bread', comparable_unit: 'portion', perishability: 'HIGH' });
    await ins(c, 'categories', { id: category.SNACK, tenant_id: tid, code: 'SNACK', name_id: 'Kudapan', name_en: 'Snack', comparable_unit: 'pack', perishability: 'LOW' });
    await ins(c, 'categories', { id: category.STAPLE, tenant_id: tid, code: 'STAPLE', name_id: 'Bahan pokok', name_en: 'Staple', comparable_unit: 'kg', perishability: 'LOW' });
    await ins(c, 'clusters', { id: cluster.SUNTER, tenant_id: tid, code: 'JKT-SUNTER', name: 'Sunter (Demo)', area: 'JAKARTA', lat: -6.14, lng: 106.87, radius_km: 3 });
    await ins(c, 'clusters', { id: cluster.BEKASI, tenant_id: tid, code: 'BKS-1', name: 'Bekasi Barat (Demo)', area: 'BEKASI', lat: -6.24, lng: 106.99, radius_km: 4 });

    // FLOs
    const flos: [keyof typeof flo, string, string, 'PANTI' | 'NON_PANTI', string, 'NEW' | 'ESTABLISHED', string | null][] = [
      ['F1', 'FLO-0001', 'Panti Asuhan Uji Mawar 001', 'PANTI', 'JAKARTA', 'ESTABLISHED', cluster.SUNTER],
      ['F2', 'FLO-0002', 'Komunitas Dapur Uji 002', 'NON_PANTI', 'JAKARTA', 'ESTABLISHED', cluster.SUNTER],
      ['F3', 'FLO-0003', 'Panti Asuhan Uji Melati 003', 'PANTI', 'BEKASI', 'ESTABLISHED', cluster.BEKASI],
      ['F4', 'FLO-0004', 'Komunitas Dapur Uji 004', 'NON_PANTI', 'BEKASI', 'ESTABLISHED', cluster.BEKASI],
      ['F5', 'FLO-0005', 'Komunitas Baru Uji 005', 'NON_PANTI', 'JAKARTA', 'NEW', null],
      ['F6', 'FLO-0006', 'Panti Asuhan Uji Kenanga 006', 'PANTI', 'JAKARTA', 'ESTABLISHED', cluster.SUNTER],
      ['F7', 'FLO-0007', 'Komunitas Dapur Uji 007', 'NON_PANTI', 'BEKASI', 'ESTABLISHED', cluster.BEKASI],
    ];
    for (const [k, code, name, type, area, tenure, cl] of flos) {
      await ins(c, 'flos', {
        id: flo[k], tenant_id: tid, code, name, flo_type: type, service_model: type === 'PANTI' ? 'RESIDENTIAL' : 'COMMUNITY_KITCHEN',
        status: 'ACTIVE', address: `Jl. Uji No. ${code.slice(-1)}`, area, lat: -6.15, lng: 106.85, location_confidence: 'HIGH', tenure,
      });
      if (cl) await ins(c, 'flo_clusters', { tenant_id: tid, flo_id: flo[k], cluster_id: cl, is_primary: true });
    }
    const sealed = sealContact('sim:flo:0001', tid);
    await ins(c, 'flo_contacts', {
      tenant_id: tid, flo_id: flo.F1, channel: 'SIM', address_ciphertext: sealed.ciphertext, address_hint: sealed.hint,
      role: 'Pengurus', verification_state: 'VERIFIED', consent_state: 'GRANTED', contact_hours: { from: '08:00', to: '20:00' },
    });
    await ins(c, 'flo_category_prefs', { tenant_id: tid, flo_id: flo.F1, category_id: category.BREAD, preference: 'PREFER' });
    await ins(c, 'flo_category_prefs', { tenant_id: tid, flo_id: flo.F1, category_id: category.STAPLE, preference: 'ACCEPT' });
    await ins(c, 'service_schedules', {
      tenant_id: tid, flo_id: flo.F1, effective_from: '2026-01-01', service_dows: [1, 3, 5], people_per_event: 60,
      count_basis: 'DAILY_RESIDENTS', declared_count: 62, verified_count: 60, verified_by: coord, verified_at: at(-60),
    });
    await ins(c, 'category_demands', {
      tenant_id: tid, flo_id: flo.F1, category_id: category.BREAD, unit: 'portion', basis: 'PER_PERSON_QTY', quantity: '1',
      valid_from: '2026-01-01', confidence: 'HIGH', assessor_id: coord, confirmed_by: coord, status: 'CONFIRMED',
    });
    await ins(c, 'flo_category_capacities', {
      tenant_id: tid, flo_id: flo.F1, category_id: category.BREAD, unit: 'portion', per_event_capacity: '60', distribution_capacity: '80',
      confirmed_at: at(-30), confirmed_by: coord,
    });
    await ins(c, 'availability_windows', { tenant_id: tid, flo_id: flo.F1, kind: 'RECEIVING', dow: 1, start_local: '09:00', end_local: '17:00' });
    await ins(c, 'availability_windows', { tenant_id: tid, flo_id: flo.F1, kind: 'CLOSURE', starts_at: at(10), ends_at: at(12) });

    // Needs
    await ins(c, 'need_assessments', {
      tenant_id: tid, flo_id: flo.F1, category_id: category.BREAD, score: '90', basis: 'Kunjungan', assessor_id: coord,
      assessed_at: at(-2), expires_at: at(28), status: 'CONFIRMED', confirmed_by: coord,
    });
    await ins(c, 'need_assessments', {
      tenant_id: tid, flo_id: flo.F2, category_id: category.BREAD, score: '95', assessor_id: coord,
      assessed_at: at(-40), expires_at: at(-10), status: 'CONFIRMED', confirmed_by: coord,
    });

    // Agreements (instants = legal dates in Asia/Jakarta)
    const agr = async (
      aid: string, floId: string, version: number, from: string, through: string, state: string,
      extra: Row = {},
    ) => {
      await c.query(
        `INSERT INTO lumbung.agreements (id, tenant_id, flo_id, version, signed_date, valid_from_date, valid_through_date,
            valid_from, valid_until_exclusive, review_state, uploaded_by, reviewer_id, reviewed_at, revoked_at, revoke_reason)
         VALUES ($1, $2, $3, $4, $5::date - 10, $5::date, $6::date,
                 $5::date::timestamp AT TIME ZONE 'Asia/Jakarta', ($6::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta',
                 $7, $8, $9, $10, $11, $12)`,
        [
          aid, tid, floId, version, from, through, state, reviewer,
          state === 'PENDING_VERIFICATION' ? null : reviewer,
          state === 'PENDING_VERIFICATION' ? null : at(-300),
          (extra.revoked_at as string) ?? null,
          (extra.revoke_reason as string) ?? null,
        ],
      );
    };
    await agr(agreement.F1, flo.F1, 1, '2026-01-01', '2027-06-30', 'APPROVED');
    await agr(agreement.F2, flo.F2, 1, '2025-11-01', '2026-10-31', 'APPROVED');
    await agr(agreement.F3_OLD, flo.F3, 1, '2025-11-01', '2026-10-31', 'APPROVED');
    await agr(agreement.F3_RENEWAL, flo.F3, 2, '2026-11-01', '2027-10-31', 'PENDING_VERIFICATION');
    await agr(agreement.F4_PENDING, flo.F4, 1, '2026-10-01', '2027-09-30', 'PENDING_VERIFICATION');
    await agr(agreement.F6, flo.F6, 1, '2025-01-01', '2026-09-30', 'APPROVED');
    await agr(agreement.F7, flo.F7, 1, '2026-01-01', '2027-01-31', 'REVOKED', { revoked_at: at(-1), revoke_reason: 'Uji pencabutan' });
    await ins(c, 'renewal_tasks', {
      id: renewalTaskF3, tenant_id: tid, agreement_id: agreement.F3_OLD, offset_days: 7, due_at: '2026-10-24T17:00:00Z', status: 'OPEN',
    });

    // History scaffolding for FLO-0001
    const donor = id('donor', 'D-1');
    const src = id('source', 'SRC-1');
    const order = id('order', 'ORD-1');
    const item = id('item', 'ORD-1:1');
    const campaign = id('campaign', 'CMP-1');
    const line = id('campaign_line', 'CMP-1:F1');
    await ins(c, 'donors', { id: donor, tenant_id: tid, code: 'D-1', name: 'Toko Roti Simulasi Uji', kind: 'BAKERY' });
    await ins(c, 'source_locations', { id: src, tenant_id: tid, code: 'SRC-1', donor_id: donor, kind: 'DONOR_SITE', cluster_id: cluster.SUNTER });
    await ins(c, 'donation_orders', { id: order, tenant_id: tid, code: 'ORD-1', donor_id: donor, source_location_id: src, route: 'DIRECT', intake_channel: 'MANUAL', operational_state: 'CLOSED' });
    await ins(c, 'donation_items', { id: item, tenant_id: tid, order_id: order, line_no: 1, category_id: category.BREAD, description: 'Roti', quantity: '1000', unit: 'portion', unit_kind: 'COUNT', safety_state: 'CLEARED' });
    await ins(c, 'outreach_campaigns', { id: campaign, tenant_id: tid, item_id: item, source_type: 'DIRECT_ITEM', state: 'COMPLETED', response_window_min: 60, template_version: 'v1' });
    await ins(c, 'campaign_lines', {
      id: line, tenant_id: tid, campaign_id: campaign, campaign_revision: 1, flo_id: flo.F1, wave_no: 1, rank: 1, max_qty: '100',
      unit: 'portion', receiving_start: at(-60), receiving_end: at(-59), distribution_deadline: at(-58), planned_receipt_at: at(-60),
    });

    let seq = 0;
    /** allocation + delivery (+ optional receipt) for FLO-0001; returns the delivery id. */
    const delivery = async (
      catKey: keyof typeof category, unit: string, unitKind: string, qty: string, dispatchedAt: string,
      receipt?: { receivedAt: string; accepted: string; rejected?: string; current?: boolean; reason?: string },
    ): Promise<string> => {
      seq += 1;
      const n = String(seq).padStart(3, '0');
      const alloc = id('alloc', `A-${n}`);
      const dlv = id('delivery', `DLV-${n}`);
      const dl = id('delivery_line', `DLV-${n}:1`);
      await ins(c, 'allocations', {
        id: alloc, tenant_id: tid, code: `ALC-${n}`, item_id: item, source_type: 'DIRECT_ITEM', flo_id: flo.F1, category_id: category[catKey],
        quantity: qty, unit, unit_kind: unitKind, state: receipt ? 'RECEIVED' : 'DISPATCHED', campaign_id: campaign,
      });
      await ins(c, 'deliveries', {
        id: dlv, tenant_id: tid, code: `DLV-${n}`, route: 'DIRECT', source_location_id: src, destination_flo_id: flo.F1,
        state: receipt ? 'RECEIVED' : 'IN_TRANSIT', dispatched_at: dispatchedAt, received_at: receipt?.receivedAt ?? null,
      });
      await ins(c, 'delivery_lines', {
        id: dl, tenant_id: tid, delivery_id: dlv, allocation_id: alloc, item_id: item, category_id: category[catKey], unit, unit_kind: unitKind,
        allocated_qty: qty, dispatched_qty: qty,
      });
      if (receipt) {
        const rc = id('receipt', `DLV-${n}`);
        await ins(c, 'flo_receipts', { id: rc, tenant_id: tid, delivery_id: dlv, flo_id: flo.F1, received_at: receipt.receivedAt, time_source: 'STAFF', status: receipt.current === false ? 'SUPERSEDED' : 'CURRENT' });
        await ins(c, 'receipt_lines', {
          tenant_id: tid, receipt_id: rc, delivery_line_id: dl, flo_id: flo.F1, category_id: category[catKey], unit, received_at: receipt.receivedAt,
          accepted_qty: receipt.accepted, rejected_qty: receipt.rejected ?? '0', discrepancy_reason: receipt.reason ?? null,
          is_current: receipt.current ?? true,
        });
      }
      return dlv;
    };

    const d1 = await delivery('BREAD', 'portion', 'COUNT', '40', at(-2, -2), { receivedAt: at(-2), accepted: '40' });
    const d2 = await delivery('BREAD', 'portion', 'COUNT', '35', at(-10, -2), { receivedAt: at(-10), accepted: '30', rejected: '5', reason: 'Kemasan rusak' });
    const d3 = await delivery('SNACK', 'pack', 'COUNT', '12', at(-3, -2), { receivedAt: at(-3), accepted: '12' });
    const d4 = await delivery('STAPLE', 'kg', 'MASS', '5', at(-40, -2), { receivedAt: at(-40), accepted: '5' });
    await delivery('BREAD', 'portion', 'COUNT', '999', at(-1, -2), { receivedAt: at(-1), accepted: '999', current: false });
    const d6 = await delivery('BREAD', 'portion', 'COUNT', '10', at(-5));
    const d7 = await delivery('BREAD', 'portion', 'COUNT', '10', at(-6));
    const d8 = await delivery('BREAD', 'portion', 'COUNT', '10', at(-7));

    // Obligations (subject = delivery of FLO-0001)
    const obl = async (type: string, subject: string, state: string, dueAt: string, timeliness: string | null, extra: Row = {}) => {
      await ins(c, 'evidence_obligations', {
        tenant_id: tid, type, subject_type: 'DELIVERY', subject_id: subject, anchor_kind: 'DISPATCH', anchor_at: at(-60),
        due_at: dueAt, due_rule: 'CALENDAR_NEXT_DAY_EOD', state, resolved_timeliness: timeliness, ...extra,
      });
    };
    await obl('BAST', d1, 'ACCEPTED', at(-2), 'ON_TIME');
    await obl('BAST', d2, 'ACCEPTED', at(-10), 'ON_TIME');
    await obl('BAST', d3, 'ACCEPTED', at(-3), 'ON_TIME');
    await obl('BAST', d4, 'ACCEPTED', at(-40), 'LATE');
    await obl('RECEIPT_PHOTO', d1, 'ACCEPTED', at(-1), 'ON_TIME');
    await obl('RECEIPT_PHOTO', d2, 'ACCEPTED', at(-9), 'ON_TIME');
    await obl('RECEIPT_PHOTO', d3, 'REJECTED_FINAL', at(-2), null);
    await obl('RECEIPT_PHOTO', d4, 'OPEN', at(-39), null); // due, nothing submitted → missing (0)
    await obl('RECEIPT_PHOTO', d6, 'OPEN', at(1), null); // not due → excluded
    await obl('RECEIPT_PHOTO', d7, 'EXCUSED', at(-5), null, { excuse_category: 'TECHNICAL', excused_by: coord, excused_at: at(-4) });
    await obl('RECEIPT_PHOTO', d8, 'UNDER_REVIEW', at(-6), null); // pending review → excluded

    // Offers: 6 eligible (5 timely), 1 excluded (OUTAGE), 1 undetermined
    for (let i = 1; i <= 8; i++) {
      const alloc = id('alloc', `OFFER-ALLOC-${i}`);
      await ins(c, 'allocations', {
        id: alloc, tenant_id: tid, code: `ALC-O${i}`, item_id: item, source_type: 'DIRECT_ITEM', flo_id: flo.F1, category_id: category.BREAD,
        quantity: '10', unit: 'portion', unit_kind: 'COUNT', state: 'CANCELLED', cancel_reason: 'TEST', campaign_id: campaign,
      });
      const eligible = i <= 6 ? true : i === 7 ? false : null;
      await ins(c, 'offers', {
        tenant_id: tid, code: `OFR-${i}`, campaign_id: campaign, campaign_line_id: line, campaign_revision: 1, allocation_id: alloc,
        flo_id: flo.F1, quantity: '10', unit: 'portion', state: 'DECLINED', sent_at: at(-20 + i), responded_at: at(-20 + i, 1),
        response_kind: 'DECLINE', decline_reason_code: 'TIMING', r_eligible: eligible, r_timely: i <= 5 ? true : i === 6 ? false : null,
        r_exclusion: i === 7 ? 'OUTAGE' : null,
      });
    }

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
  return { tenant: t, flo, agreement, category, cluster, renewalTaskF3 };
}

/** Owner-side clock move for a test tenant (FROZEN at `iso`). */
export async function setClock(owner: pg.Pool, tenantId: string, iso: string): Promise<void> {
  await owner.query(`UPDATE lumbung.tenant_clocks SET mode = 'FROZEN', sim_anchor = $2 WHERE tenant_id = $1`, [tenantId, iso]);
}
