/**
 * Step 1 (architecture B): tenant, staff users, clock, policies, activation decisions,
 * clusters, categories, products and conversions, donors, source locations,
 * warehouses and storage locations.
 */
import { capabilitiesForRoles, type Role } from '@/src/shared/capabilities';
import { ACTIVATION_DECISION_KEYS, type CategoryCode } from '@/src/shared/enums';
import type { Area } from './marginals';
import { DAY, iso, pad, type Clock, type Ids, type SeedConfig } from './config';
import type { Dataset } from './dataset';
import { maskAddress } from '@/src/security/crypto';

// ---------------------------------------------------------------------------
// Staff users (G.3)
// ---------------------------------------------------------------------------
export type UserKey = 'ADMIN' | 'KOORD1' | 'KOORD2' | 'GUDANG1' | 'GUDANG2' | 'REVIEW_AGR' | 'REVIEW_EVD' | 'AUDITOR';

export const STAFF: readonly { key: UserKey; name: string; local: string; roles: Role[] }[] = [
  { key: 'ADMIN', name: 'Admin Demo', local: 'admin', roles: ['ADMIN', 'COORDINATOR'] },
  { key: 'KOORD1', name: 'Koordinator Demo 1', local: 'koordinator1', roles: ['COORDINATOR'] },
  { key: 'KOORD2', name: 'Koordinator Demo 2', local: 'koordinator2', roles: ['COORDINATOR'] },
  { key: 'GUDANG1', name: 'Gudang Demo 1', local: 'gudang1', roles: ['WAREHOUSE'] },
  { key: 'GUDANG2', name: 'Gudang Demo 2', local: 'gudang2', roles: ['WAREHOUSE_SUPERVISOR'] },
  { key: 'REVIEW_AGR', name: 'Peninjau Perjanjian Demo', local: 'peninjau.perjanjian', roles: ['AGREEMENT_REVIEWER'] },
  { key: 'REVIEW_EVD', name: 'Peninjau Bukti Demo', local: 'peninjau.bukti', roles: ['EVIDENCE_REVIEWER'] },
  { key: 'AUDITOR', name: 'Auditor Demo', local: 'auditor', roles: ['AUDITOR'] },
];

// ---------------------------------------------------------------------------
// Geography: 20 clusters with fixed centroids inside fixed area envelopes
// ---------------------------------------------------------------------------
export const AREA_BBOX: Record<Area, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  JAKARTA: { minLat: -6.37, maxLat: -6.08, minLng: 106.68, maxLng: 106.98 },
  BOGOR: { minLat: -6.7, maxLat: -6.47, minLng: 106.7, maxLng: 106.9 },
  DEPOK: { minLat: -6.46, maxLat: -6.35, minLng: 106.72, maxLng: 106.88 },
  TANGERANG: { minLat: -6.32, maxLat: -6.1, minLng: 106.48, maxLng: 106.7 },
  BEKASI: { minLat: -6.36, maxLat: -6.15, minLng: 106.95, maxLng: 107.1 },
};

export interface ClusterDef {
  code: string;
  name: string;
  area: Area;
  lat: number;
  lng: number;
  radiusKm: number;
}

export const CLUSTERS: readonly ClusterDef[] = [
  { code: 'CL-JKT-01', name: 'Sunter (Demo)', area: 'JAKARTA', lat: -6.138, lng: 106.865, radiusKm: 2.5 },
  { code: 'CL-JKT-02', name: 'Kemayoran (Demo)', area: 'JAKARTA', lat: -6.162, lng: 106.846, radiusKm: 2.5 },
  { code: 'CL-JKT-03', name: 'Cengkareng (Demo)', area: 'JAKARTA', lat: -6.148, lng: 106.735, radiusKm: 3 },
  { code: 'CL-JKT-04', name: 'Tebet (Demo)', area: 'JAKARTA', lat: -6.23, lng: 106.853, radiusKm: 2.5 },
  { code: 'CL-JKT-05', name: 'Pasar Minggu (Demo)', area: 'JAKARTA', lat: -6.285, lng: 106.843, radiusKm: 3 },
  { code: 'CL-JKT-06', name: 'Cakung (Demo)', area: 'JAKARTA', lat: -6.185, lng: 106.94, radiusKm: 3 },
  { code: 'CL-BGR-01', name: 'Bogor Tengah (Demo)', area: 'BOGOR', lat: -6.595, lng: 106.797, radiusKm: 3 },
  { code: 'CL-BGR-02', name: 'Cibinong (Demo)', area: 'BOGOR', lat: -6.485, lng: 106.842, radiusKm: 3 },
  { code: 'CL-BGR-03', name: 'Bogor Barat (Demo)', area: 'BOGOR', lat: -6.565, lng: 106.75, radiusKm: 3 },
  { code: 'CL-DPK-01', name: 'Margonda (Demo)', area: 'DEPOK', lat: -6.385, lng: 106.83, radiusKm: 2.5 },
  { code: 'CL-DPK-02', name: 'Sawangan (Demo)', area: 'DEPOK', lat: -6.41, lng: 106.76, radiusKm: 2.5 },
  { code: 'CL-DPK-03', name: 'Cimanggis (Demo)', area: 'DEPOK', lat: -6.37, lng: 106.86, radiusKm: 2 },
  { code: 'CL-TNG-01', name: 'Tangerang Kota (Demo)', area: 'TANGERANG', lat: -6.178, lng: 106.63, radiusKm: 3 },
  { code: 'CL-TNG-02', name: 'Ciledug (Demo)', area: 'TANGERANG', lat: -6.23, lng: 106.68, radiusKm: 2.5 },
  { code: 'CL-TNG-03', name: 'BSD (Demo)', area: 'TANGERANG', lat: -6.295, lng: 106.655, radiusKm: 3 },
  { code: 'CL-TNG-04', name: 'Cikupa (Demo)', area: 'TANGERANG', lat: -6.23, lng: 106.51, radiusKm: 3 },
  { code: 'CL-BKS-01', name: 'Bekasi Barat (Demo)', area: 'BEKASI', lat: -6.235, lng: 106.99, radiusKm: 2.5 },
  { code: 'CL-BKS-02', name: 'Bekasi Timur (Demo)', area: 'BEKASI', lat: -6.25, lng: 107.03, radiusKm: 2.5 },
  { code: 'CL-BKS-03', name: 'Tambun (Demo)', area: 'BEKASI', lat: -6.26, lng: 107.065, radiusKm: 2.5 },
  { code: 'CL-BKS-04', name: 'Bantar Gebang (Demo)', area: 'BEKASI', lat: -6.32, lng: 106.99, radiusKm: 2.5 },
];

// ---------------------------------------------------------------------------
// Categories, products, conversions (PRD §24 product fixtures)
// ---------------------------------------------------------------------------
export interface CategoryDef {
  code: CategoryCode;
  nameId: string;
  nameEn: string;
  comparableUnit: string;
  perishability: string;
}

export const CATEGORIES: readonly CategoryDef[] = [
  { code: 'BREAD', nameId: 'Roti', nameEn: 'Bread', comparableUnit: 'portion', perishability: 'HIGH' },
  { code: 'PREPARED_MEAL', nameId: 'Makanan siap saji', nameEn: 'Prepared meal', comparableUnit: 'portion', perishability: 'HIGH' },
  { code: 'PRODUCE', nameId: 'Sayur dan buah', nameEn: 'Fresh produce', comparableUnit: 'kg', perishability: 'MEDIUM' },
  { code: 'RICE', nameId: 'Beras', nameEn: 'Rice', comparableUnit: 'kg', perishability: 'LOW' },
  { code: 'SNACK', nameId: 'Makanan ringan', nameEn: 'Sealed snacks', comparableUnit: 'pack', perishability: 'LOW' },
  { code: 'STAPLE', nameId: 'Bahan pokok kemasan', nameEn: 'Packaged staples', comparableUnit: 'pcs', perishability: 'LOW' },
];

export interface ProductDef {
  code: string;
  name: string;
  category: CategoryCode;
  baseUnit: string;
  unitKind: 'COUNT' | 'MASS' | 'VOLUME';
  /** milli-units */
  minIncrement: bigint;
  allergens: string[];
  storage: 'AMBIENT' | 'CHILLED' | 'FROZEN';
  conversions: { from: string; to: string; factor: string; provenance: 'MEASURED' | 'ESTIMATED' | 'APPROVED_ESTIMATE'; source: string }[];
}

export const PRODUCTS: readonly ProductDef[] = [
  { code: 'ROTI-TAWAR', name: 'Roti Tawar (Simulasi)', category: 'BREAD', baseUnit: 'portion', unitKind: 'COUNT', minIncrement: 1000n, allergens: ['gluten'], storage: 'AMBIENT', conversions: [] },
  { code: 'ROTI-MANIS-6', name: 'Roti Manis isi 6 (Simulasi)', category: 'BREAD', baseUnit: 'pack', unitKind: 'COUNT', minIncrement: 1000n, allergens: ['gluten', 'milk', 'egg'], storage: 'AMBIENT',
    conversions: [{ from: 'pack', to: 'portion', factor: '6', provenance: 'APPROVED_ESTIMATE', source: 'Label kemasan isi 6 (estimasi demo disetujui)' }] },
  { code: 'NASI-KOTAK', name: 'Nasi Kotak (Simulasi)', category: 'PREPARED_MEAL', baseUnit: 'box', unitKind: 'COUNT', minIncrement: 1000n, allergens: [], storage: 'AMBIENT',
    conversions: [{ from: 'box', to: 'portion', factor: '1', provenance: 'APPROVED_ESTIMATE', source: '1 kotak = 1 porsi (estimasi demo disetujui)' }] },
  { code: 'LAUK-PORSI', name: 'Lauk Porsi (Simulasi)', category: 'PREPARED_MEAL', baseUnit: 'portion', unitKind: 'COUNT', minIncrement: 1000n, allergens: ['egg'], storage: 'CHILLED', conversions: [] },
  { code: 'SAYUR-CAMPUR', name: 'Sayur Campur (Simulasi)', category: 'PRODUCE', baseUnit: 'kg', unitKind: 'MASS', minIncrement: 500n, allergens: [], storage: 'CHILLED', conversions: [] },
  { code: 'PISANG', name: 'Pisang (Simulasi)', category: 'PRODUCE', baseUnit: 'kg', unitKind: 'MASS', minIncrement: 500n, allergens: [], storage: 'AMBIENT', conversions: [] },
  { code: 'BERAS-5KG', name: 'Beras 5 kg (Simulasi)', category: 'RICE', baseUnit: 'pack', unitKind: 'COUNT', minIncrement: 1000n, allergens: [], storage: 'AMBIENT',
    conversions: [{ from: 'pack', to: 'kg', factor: '5', provenance: 'MEASURED', source: 'Berat bersih pada kemasan' }] },
  { code: 'BERAS-CURAH', name: 'Beras Curah (Simulasi)', category: 'RICE', baseUnit: 'kg', unitKind: 'MASS', minIncrement: 1000n, allergens: [], storage: 'AMBIENT', conversions: [] },
  { code: 'BISKUIT', name: 'Biskuit (Simulasi)', category: 'SNACK', baseUnit: 'pack', unitKind: 'COUNT', minIncrement: 1000n, allergens: ['gluten', 'milk'], storage: 'AMBIENT', conversions: [] },
  { code: 'WAFER-KARTON', name: 'Wafer (Simulasi)', category: 'SNACK', baseUnit: 'pack', unitKind: 'COUNT', minIncrement: 1000n, allergens: ['gluten', 'milk', 'soy'], storage: 'AMBIENT',
    conversions: [{ from: 'carton', to: 'pack', factor: '24', provenance: 'MEASURED', source: 'Isi karton 24 pak' }] },
  { code: 'MINYAK-1L', name: 'Minyak Goreng 1 L (Simulasi)', category: 'STAPLE', baseUnit: 'bottle', unitKind: 'COUNT', minIncrement: 1000n, allergens: [], storage: 'AMBIENT',
    conversions: [
      { from: 'bottle', to: 'L', factor: '1', provenance: 'MEASURED', source: 'Volume bersih 1 L per botol' },
      { from: 'bottle', to: 'pcs', factor: '1', provenance: 'APPROVED_ESTIMATE', source: '1 botol dihitung 1 item bahan pokok (estimasi demo)' },
    ] },
  { code: 'MIE-INSTAN', name: 'Mie Instan (Simulasi)', category: 'STAPLE', baseUnit: 'pcs', unitKind: 'COUNT', minIncrement: 1000n, allergens: ['gluten'], storage: 'AMBIENT',
    conversions: [{ from: 'carton', to: 'pcs', factor: '40', provenance: 'MEASURED', source: 'Isi karton 40 bungkus' }] },
];

export const DIRECT_PRODUCTS: Record<'BREAD' | 'PREPARED_MEAL' | 'PRODUCE' | 'SNACK', readonly string[]> = {
  BREAD: ['ROTI-TAWAR', 'ROTI-TAWAR', 'ROTI-MANIS-6'],
  PREPARED_MEAL: ['NASI-KOTAK', 'LAUK-PORSI'],
  PRODUCE: ['SAYUR-CAMPUR', 'PISANG'],
  SNACK: ['BISKUIT'],
};
export const WAREHOUSE_PRODUCTS: readonly string[] = ['BERAS-5KG', 'BERAS-CURAH', 'BISKUIT', 'WAFER-KARTON', 'MINYAK-1L', 'MIE-INSTAN'];

// ---------------------------------------------------------------------------
// Donors and sources
// ---------------------------------------------------------------------------
export type DonorKind = 'BAKERY' | 'CATERER' | 'HOTEL' | 'MARKET' | 'RETAILER' | 'DISTRIBUTOR';

export const DONORS: readonly { name: string; kind: DonorKind; cluster: string }[] = [
  { name: 'Toko Roti Simulasi Sunter', kind: 'BAKERY', cluster: 'CL-JKT-01' },
  { name: 'Toko Roti Simulasi Tebet', kind: 'BAKERY', cluster: 'CL-JKT-04' },
  { name: 'Toko Roti Simulasi Bogor', kind: 'BAKERY', cluster: 'CL-BGR-01' },
  { name: 'Toko Roti Simulasi Margonda', kind: 'BAKERY', cluster: 'CL-DPK-01' },
  { name: 'Toko Roti Simulasi Tangerang', kind: 'BAKERY', cluster: 'CL-TNG-01' },
  { name: 'Toko Roti Simulasi Bekasi', kind: 'BAKERY', cluster: 'CL-BKS-01' },
  { name: 'Toko Roti Simulasi Cengkareng', kind: 'BAKERY', cluster: 'CL-JKT-03' },
  { name: 'Toko Roti Simulasi BSD', kind: 'BAKERY', cluster: 'CL-TNG-03' },
  { name: 'Katering Demo Kemayoran', kind: 'CATERER', cluster: 'CL-JKT-02' },
  { name: 'Katering Demo Pasar Minggu', kind: 'CATERER', cluster: 'CL-JKT-05' },
  { name: 'Katering Demo Cibinong', kind: 'CATERER', cluster: 'CL-BGR-02' },
  { name: 'Katering Demo Ciledug', kind: 'CATERER', cluster: 'CL-TNG-02' },
  { name: 'Katering Demo Tambun', kind: 'CATERER', cluster: 'CL-BKS-03' },
  { name: 'Hotel Simulasi Cakung', kind: 'HOTEL', cluster: 'CL-JKT-06' },
  { name: 'Hotel Simulasi Sawangan', kind: 'HOTEL', cluster: 'CL-DPK-02' },
  { name: 'Hotel Simulasi Bekasi Timur', kind: 'HOTEL', cluster: 'CL-BKS-02' },
  { name: 'Pasar Simulasi Tebet', kind: 'MARKET', cluster: 'CL-JKT-04' },
  { name: 'Pasar Simulasi Bogor Barat', kind: 'MARKET', cluster: 'CL-BGR-03' },
  { name: 'Pasar Simulasi Cimanggis', kind: 'MARKET', cluster: 'CL-DPK-03' },
  { name: 'Pasar Simulasi Cikupa', kind: 'MARKET', cluster: 'CL-TNG-04' },
  { name: 'Pasar Simulasi Bantar Gebang', kind: 'MARKET', cluster: 'CL-BKS-04' },
  { name: 'Supermarket Demo Sunter', kind: 'RETAILER', cluster: 'CL-JKT-01' },
  { name: 'Supermarket Demo Margonda', kind: 'RETAILER', cluster: 'CL-DPK-01' },
  { name: 'Supermarket Demo Tangerang', kind: 'RETAILER', cluster: 'CL-TNG-01' },
  { name: 'Supermarket Demo Bekasi', kind: 'RETAILER', cluster: 'CL-BKS-01' },
  { name: 'Distributor Demo Cakung', kind: 'DISTRIBUTOR', cluster: 'CL-JKT-06' },
  { name: 'Distributor Demo Kemayoran', kind: 'DISTRIBUTOR', cluster: 'CL-JKT-02' },
  { name: 'Distributor Demo Cikupa', kind: 'DISTRIBUTOR', cluster: 'CL-TNG-04' },
  { name: 'Distributor Demo Bekasi', kind: 'DISTRIBUTOR', cluster: 'CL-BKS-02' },
  { name: 'Distributor Demo Bogor', kind: 'DISTRIBUTOR', cluster: 'CL-BGR-02' },
];

/** Second sites (SRC-031..SRC-040) for donors 2..11 (donor 1 stays single-site for SC01). */
export const SECOND_SITES: readonly { donor: number; cluster: string }[] = [
  { donor: 2, cluster: 'CL-JKT-05' },
  { donor: 3, cluster: 'CL-BGR-03' },
  { donor: 4, cluster: 'CL-DPK-02' },
  { donor: 5, cluster: 'CL-TNG-02' },
  { donor: 6, cluster: 'CL-BKS-03' },
  { donor: 7, cluster: 'CL-TNG-01' },
  { donor: 8, cluster: 'CL-TNG-04' },
  { donor: 9, cluster: 'CL-JKT-04' },
  { donor: 10, cluster: 'CL-JKT-06' },
  { donor: 11, cluster: 'CL-BGR-01' },
];

export const WAREHOUSES: readonly { code: string; name: string; cluster: string; lat: number; lng: number; serves: Area[] }[] = [
  { code: 'WH-JKU', name: 'Gudang Demo Jakarta Utara', cluster: 'CL-JKT-02', lat: -6.162, lng: 106.846, serves: ['JAKARTA', 'TANGERANG', 'DEPOK'] },
  { code: 'WH-BKS', name: 'Gudang Demo Bekasi', cluster: 'CL-BKS-01', lat: -6.235, lng: 106.99, serves: ['BEKASI', 'BOGOR', 'DEPOK'] },
];

// ---------------------------------------------------------------------------
// Reference context consumed by later steps
// ---------------------------------------------------------------------------
export interface SourceInfo {
  code: string;
  id: string;
  donorIdx: number | null; // 1-based donor number, null for warehouses
  donorId: string | null;
  kind: DonorKind | 'WAREHOUSE';
  cluster: ClusterDef;
  area: Area;
  lat: number;
  lng: number;
  name: string;
}

export interface RefContext {
  tenantId: string;
  users: Record<UserKey, string>;
  categories: Record<CategoryCode, { id: string; def: CategoryDef }>;
  products: Record<string, { id: string; def: ProductDef; categoryId: string }>;
  /** conversion id by `${product}:${from}:${to}` */
  conversions: Record<string, string>;
  clusters: Record<string, { id: string; def: ClusterDef }>;
  sources: SourceInfo[];
  sourceByCode: Record<string, SourceInfo>;
  warehouses: Record<string, { source: SourceInfo; storage: Record<string, string> }>;
  policies: Record<string, string>;
  setupMs: number;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function buildReference(ds: Dataset, cfg: SeedConfig, clock: Clock, ids: Ids): RefContext {
  const tenantId = ids.tenantId;
  // Configuration happened well before the history window (deterministic, clock-relative).
  const setupMs = clock.at(clock.addDays(clock.today, -300), 9);
  const setup = iso(setupMs);
  const T = clock.now;

  ds.add('tenants', {
    id: tenantId, slug: cfg.slug, name: cfg.name, timezone: cfg.timezone, mode: cfg.mode, is_demo: true,
    created_at: setup, updated_at: setup,
  });

  const users = {} as Record<UserKey, string>;
  for (const s of STAFF) {
    const id = ids.id('user', s.key);
    users[s.key] = id;
    ds.add('users', {
      id, display_name: s.name, email: `${s.local}@${cfg.slug}.example.invalid`, kind: 'HUMAN', created_at: setup, updated_at: setup,
    });
    ds.add('memberships', {
      id: ids.id('membership', s.key), tenant_id: tenantId, user_id: id, role_label: s.roles.join('+'),
      capabilities: capabilitiesForRoles(s.roles), status: 'ACTIVE', created_at: setup, updated_at: setup,
    });
  }

  ds.add('tenant_clocks', { tenant_id: tenantId, mode: 'FROZEN', sim_anchor: iso(T), real_anchor: null, created_at: setup, updated_at: setup });

  // Policies ---------------------------------------------------------------
  const approvedAt = iso(setupMs + DAY);
  const policies: Record<string, string> = {};
  const policyDefs: { kind: string; code: string; version: string; body: unknown; active: boolean }[] = [
    {
      kind: 'ALLOCATION', code: 'ALLOC-DEMO-2.0', version: '2.0', active: true,
      body: {
        synthetic: true,
        weights: { N: 0.35, F: 0.25, L: 0.2, R: 0.1, E: 0.1 },
        fairness_mix: { deficit: 0.7, recency: 0.3 },
        logistics_mix: { travel: 0.7, cost_fit: 0.3 },
        reporting_mix: { BAST: 0.4, RECEIPT_PHOTO: 0.3, DISTRIBUTION: 0.3 },
        smoothing: { prior_successes: 2, prior_trials: 4 },
        horizon_days: 30,
        recency_days: 30,
        need_stale_days: 30,
        max_travel_minutes: { BREAD: 60, PREPARED_MEAL: 45, PRODUCE: 90, RICE: 120, SNACK: 120, STAPLE: 120 },
        hard_max_travel_minutes: { BREAD: 90, PREPARED_MEAL: 60, PRODUCE: 120, RICE: 180, SNACK: 180, STAPLE: 180 },
        min_useful_qty: {
          BREAD: { qty: '10', unit: 'portion' },
          PREPARED_MEAL: { qty: '10', unit: 'portion' },
          PRODUCE: { qty: '5', unit: 'kg' },
          RICE: { qty: '10', unit: 'kg' },
          SNACK: { qty: '10', unit: 'pack' },
          STAPLE: { qty: '10', unit: 'pcs' },
        },
        wave_size: 3,
        reason_thresholds: { HIGH_NEED: 0.8, LOW_CATEGORY_COVERAGE: 0.6 },
      },
    },
    {
      kind: 'SAFETY', code: 'SAFETY-DEMO-SYNTH-1.0', version: '1.0', active: true,
      body: {
        synthetic: true,
        live_blocked_reason: 'Profil keamanan pangan sintetis; butuh persetujuan FoodCycle food safety lead (PRD §27)',
        min_handling_hours: 2,
        profiles: {
          BREAD: { max_hours_from_ready: 14, storage: 'AMBIENT', risk: 'MEDIUM' },
          PREPARED_MEAL: { max_hours_from_ready: 4, storage: 'CHILLED_OR_HOT', risk: 'HIGH' },
          PRODUCE: { max_hours_from_ready: 36, storage: 'AMBIENT_OR_CHILLED', risk: 'MEDIUM' },
          RICE: { requires_label_expiry: true, storage: 'AMBIENT', risk: 'LOW' },
          SNACK: { requires_label_expiry: true, storage: 'AMBIENT', risk: 'LOW' },
          STAPLE: { requires_label_expiry: true, storage: 'AMBIENT', risk: 'LOW' },
        },
        warehouse_min_remaining_shelf_days: 7,
      },
    },
    {
      kind: 'REPORTING', code: 'REPORTING-DEMO-1.0', version: '1.0', active: true,
      body: {
        due_rules: { BAST: 'AT_RECEIPT', RECEIPT_PHOTO: 'CALENDAR_NEXT_DAY_EOD', DISTRIBUTION: 'CALENDAR_NEXT_DAY_EOD' },
        bast_reminder_minutes: 30,
        distribution_followup_escalate_hours: 24,
        timezone: 'Asia/Jakarta',
      },
    },
    {
      kind: 'REPORTING', code: 'REPORTING-DEMO-24H', version: '1.0-24h', active: false,
      body: {
        alternative_of: 'REPORTING-DEMO-1.0',
        due_rules: { BAST: 'AT_RECEIPT', RECEIPT_PHOTO: 'ROLLING_24H', DISTRIBUTION: 'ROLLING_24H' },
        bast_reminder_minutes: 30,
        distribution_followup_escalate_hours: 24,
        timezone: 'Asia/Jakarta',
      },
    },
    {
      kind: 'LOGISTICS', code: 'LOGISTICS-DEMO-1.0', version: '1.0', active: true,
      body: {
        routing: 'FIXTURE_THEN_STRAIGHT_LINE', straight_line_speed_kmh: 25, payer_default: 'FLO', currency: 'IDR',
        reservation_ttl_minutes: { urgent: 15, scheduled: 120 },
      },
    },
    {
      kind: 'OUTREACH', code: 'OUTREACH-DEMO-1.0', version: '1.0', active: true,
      body: {
        response_window_contact_minutes: 240, timely_within_contact_minutes: 120,
        contact_hours: { start: '08:00', end: '20:00', timezone: 'Asia/Jakarta' }, wave_size: 3, template_version: 'OFFER-ID-1',
      },
    },
    {
      kind: 'RETENTION', code: 'RETENTION-90D', version: '1.0', active: true,
      body: { media_retention_days: 90, evidence_retention_days: 90, synthetic_only: true },
    },
  ];
  for (const p of policyDefs) {
    const id = ids.id('policy', p.code);
    policies[p.code] = id;
    ds.add('policy_versions', {
      id, tenant_id: tenantId, kind: p.kind, code: p.code, version: p.version, body: p.body, status: 'APPROVED_DEMO',
      approved_by: users.ADMIN, approved_at: approvedAt, supersedes_id: null, created_at: setup, created_by: users.ADMIN, updated_at: approvedAt,
    });
    if (p.active) {
      ds.add('tenant_active_policies', {
        tenant_id: tenantId, kind: p.kind, policy_version_id: id, created_at: approvedAt, created_by: users.ADMIN, updated_at: approvedAt,
      });
    }
  }

  const ACTIVATION_NOTES: Record<string, string> = {
    REGISTRY_SOURCE_OF_TRUTH: 'Pemilik: FoodCycle operations & system owner. Memblokir sinkronisasi data induk dan kelayakan perjanjian LIVE.',
    WAREHOUSE_STOCK_CONTRACT: 'Pemilik: FoodCycle warehouse & system owner. Memblokir penulisan inbound/outbound LIVE.',
    EVIDENCE_DEADLINE_POLICY: 'Pemilik: FoodCycle operations. Memblokir tenggat bukti dan skor kinerja LIVE.',
    SAFETY_PROFILES: 'Pemilik: FoodCycle food safety lead. Memblokir alokasi dan pengiriman LIVE.',
    NEED_SCORING: 'Pemilik: FoodCycle programme team. Memblokir bobot alokasi operasional.',
    COURIER_FEE_PROCESS: 'Pemilik: FoodCycle operations & kontak FLO. Memblokir konfirmasi transport akhir.',
    CONTACT_PERMISSIONS: 'Pemilik: FoodCycle account owner. Memblokir pesan keluar LIVE.',
    MEDIA_POLICY: 'Pemilik: FoodCycle privacy / authorised lead. Memblokir pengumpulan bukti beridentitas.',
    APPROVAL_ROLES: 'Pemilik: FoodCycle operations owner. Memblokir persetujuan kampanye dan pengiriman LIVE.',
    HOSTING_OPERATIONS: 'Pemilik: Lumbung technical owner. Memblokir deployment produksi.',
  };
  for (const key of ACTIVATION_DECISION_KEYS) {
    ds.add('activation_decisions', {
      id: ids.id('activation', key), tenant_id: tenantId, key, status: 'NOT_DECIDED', approved_by: null, approved_at: null,
      notes: ACTIVATION_NOTES[key], created_at: setup, updated_at: setup,
    });
  }

  ds.add('simulation_settings', {
    tenant_id: tenantId, llm_fault: null, send_fault: null, behaviour: { synthetic: true, seed: cfg.seed }, created_at: setup, updated_at: setup,
  });

  // Categories / products / conversions -------------------------------------
  const categories = {} as RefContext['categories'];
  for (const c of CATEGORIES) {
    const id = ids.id('category', c.code);
    categories[c.code] = { id, def: c };
    ds.add('categories', {
      id, tenant_id: tenantId, code: c.code, name_id: c.nameId, name_en: c.nameEn, comparable_unit: c.comparableUnit,
      perishability: c.perishability, created_at: setup, updated_at: setup,
    });
  }
  const products: RefContext['products'] = {};
  const conversions: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const id = ids.id('product', p.code);
    products[p.code] = { id, def: p, categoryId: categories[p.category].id };
    ds.add('products', {
      id, tenant_id: tenantId, code: p.code, name: p.name, category_id: categories[p.category].id, base_unit: p.baseUnit,
      unit_kind: p.unitKind, min_increment: (Number(p.minIncrement) / 1000).toString(), allergens: p.allergens,
      storage_profile: p.storage, halal_status: 'HALAL', created_at: setup, updated_at: setup,
    });
    for (const cv of p.conversions) {
      const key = `${p.code}:${cv.from}:${cv.to}`;
      const cid = ids.id('conversion', `${key}:1`);
      conversions[key] = cid;
      ds.add('unit_conversions', {
        id: cid, tenant_id: tenantId, product_id: id, from_unit: cv.from, to_unit: cv.to, factor: cv.factor, provenance: cv.provenance,
        version: 1, source: cv.source, valid_from: setup, valid_to: null, created_at: setup, updated_at: setup,
      });
    }
  }

  // Clusters ------------------------------------------------------------------
  const clusters: RefContext['clusters'] = {};
  for (const c of CLUSTERS) {
    const id = ids.id('cluster', c.code);
    clusters[c.code] = { id, def: c };
    ds.add('clusters', {
      id, tenant_id: tenantId, code: c.code, name: c.name, area: c.area, lat: c.lat.toFixed(6), lng: c.lng.toFixed(6),
      radius_km: c.radiusKm.toFixed(2), created_at: setup, updated_at: setup,
    });
  }

  // Donors / sources / warehouses --------------------------------------------
  const sources: SourceInfo[] = [];
  const DONOR_HOURS = { timezone: 'Asia/Jakarta', windows: [{ dows: [1, 2, 3, 4, 5, 6, 7], start: '06:00', end: '20:00' }] };
  DONORS.forEach((d, i) => {
    const n = i + 1;
    const code = `DON-${pad(n, 3)}`;
    const id = ids.id('donor', code);
    ds.add('donors', { id, tenant_id: tenantId, code, name: d.name, kind: d.kind, created_at: setup, updated_at: setup });
    const contactId = ids.id('donor_contact', `${code}:SIM`);
    const addr = `sim:donor:${pad(n, 3)}`;
    ds.add('donor_contacts', {
      id: contactId, tenant_id: tenantId, donor_id: id, channel: 'SIM', address_ciphertext: null, address_hint: maskAddress(addr),
      role: 'PIC', verification_state: 'VERIFIED', consent_state: 'GRANTED', opted_out_at: null, contact_hours: DONOR_HOURS,
      created_at: setup, updated_at: setup,
      __plain: addr,
    });
    const cl = clusters[d.cluster].def;
    sources.push({
      code: `SRC-${pad(n, 3)}`, id: ids.id('source', `SRC-${pad(n, 3)}`), donorIdx: n, donorId: id, kind: d.kind, cluster: cl, area: cl.area,
      lat: 0, lng: 0, name: d.name,
    });
  });
  SECOND_SITES.forEach((s, j) => {
    const n = 31 + j;
    const donor = DONORS[s.donor - 1];
    const cl = clusters[s.cluster].def;
    sources.push({
      code: `SRC-${pad(n, 3)}`, id: ids.id('source', `SRC-${pad(n, 3)}`), donorIdx: s.donor, donorId: ids.id('donor', `DON-${pad(s.donor, 3)}`),
      kind: donor.kind, cluster: cl, area: cl.area, lat: 0, lng: 0, name: `${donor.name} (cabang ${cl.name.replace(' (Demo)', '')})`,
    });
  });
  // Deterministic placement of donor sites: SRC-001 exactly on the Sunter centroid;
  // others on a small fixed offset ring so sites in one cluster do not coincide.
  sources.forEach((s, i) => {
    if (s.code === 'SRC-001') {
      s.lat = s.cluster.lat;
      s.lng = s.cluster.lng;
      return;
    }
    const angle = ((i * 137) % 360) * (Math.PI / 180);
    const km = 0.6 + (i % 4) * 0.35;
    s.lat = round6(s.cluster.lat + (km / 111.32) * Math.cos(angle));
    s.lng = round6(s.cluster.lng + (km / (111.32 * Math.cos((s.cluster.lat * Math.PI) / 180))) * Math.sin(angle));
  });
  for (const s of sources) {
    ds.add('source_locations', {
      id: s.id, tenant_id: tenantId, code: s.code, name: s.name, donor_id: s.donorId, kind: 'DONOR_SITE',
      address: `Jl. Simulasi ${s.cluster.name.replace(' (Demo)', '')} No. ${Number(s.code.slice(4))}`, cluster_id: clusters[s.cluster.code].id,
      lat: s.lat.toFixed(6), lng: s.lng.toFixed(6), location_confidence: 'HIGH', hours: DONOR_HOURS, created_at: setup, updated_at: setup,
    });
  }
  const warehouses: RefContext['warehouses'] = {};
  for (const w of WAREHOUSES) {
    const cl = clusters[w.cluster].def;
    const src: SourceInfo = {
      code: w.code, id: ids.id('source', w.code), donorIdx: null, donorId: null, kind: 'WAREHOUSE', cluster: cl, area: cl.area,
      lat: w.lat, lng: w.lng, name: w.name,
    };
    ds.add('source_locations', {
      id: src.id, tenant_id: tenantId, code: w.code, name: w.name, donor_id: null, kind: 'WAREHOUSE',
      address: `Kawasan Gudang Simulasi, ${cl.name}`, cluster_id: clusters[w.cluster].id, lat: w.lat.toFixed(6), lng: w.lng.toFixed(6),
      location_confidence: 'HIGH', hours: { timezone: 'Asia/Jakarta', windows: [{ dows: [1, 2, 3, 4, 5, 6], start: '07:00', end: '18:00' }] },
      created_at: setup, updated_at: setup,
    });
    const storage: Record<string, string> = {};
    for (const [code, profile] of [['AMB-01', 'AMBIENT'], ['AMB-02', 'AMBIENT'], ['CHL-01', 'CHILLED']] as const) {
      const sid = ids.id('storage', `${w.code}:${code}`);
      storage[code] = sid;
      ds.add('storage_locations', {
        id: sid, tenant_id: tenantId, warehouse_id: src.id, code, storage_profile: profile, created_at: setup, updated_at: setup,
      });
    }
    warehouses[w.code] = { source: src, storage };
  }

  const sourceByCode: Record<string, SourceInfo> = {};
  for (const s of sources) sourceByCode[s.code] = s;
  for (const w of Object.values(warehouses)) sourceByCode[w.source.code] = w.source;

  return { tenantId, users, categories, products, conversions, clusters, sources, sourceByCode, warehouses, policies, setupMs };
}
