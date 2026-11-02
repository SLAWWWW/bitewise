/**
 * Step 2 + 4 (architecture B): 200 FLOs with exact marginals and named fixtures, and
 * their operational data (contacts, preferences, schedules, demand, capacities,
 * needs, availability windows).
 */
import { shuffle } from '@/src/lib/prng';
import { maskAddress } from '@/src/security/crypto';
import type { CategoryCode } from '@/src/shared/enums';
import { CATEGORY_CODES } from '@/src/shared/enums';
import {
  AGREEMENT_COUNTS,
  AREA_COUNTS,
  enforceBySwap,
  FLO_COUNT,
  PEOPLE_BAND_COUNTS,
  PEOPLE_BANDS,
  shuffledMarginal,
  tenureTuples,
  TYPE_COUNTS,
  type AgreementClass,
  type Area,
  type ContactProfile,
  type FloTypeLabel,
  type PeopleBand,
  type ReportingProfile,
  type TenureTuple,
} from './marginals';
import { FIXTURE_INDEXES, FLO_FIXTURES, type FloFixture } from './fixtures';
import { FIXTURE_PLACEMENTS, SC01_EXCLUSION_RADIUS_KM, SC01_SOURCE_CODE } from './routing-fixtures';
import { AREA_BBOX, CLUSTERS, type ClusterDef, type RefContext } from './reference';
import { DAY, chance, intIn, iso, pad, type Clock, type Ids, type Streams } from './config';
import type { Dataset } from './dataset';
import { haversine } from '@/src/lib/geo';

export type Pref = 'PREFER' | 'ACCEPT' | 'EXCLUDE';

export interface ApprovedInterval {
  id: string;
  from: number;
  /** Effective end: the legal exclusive end, or the start of an approved successor that capped it (0015). */
  until: number;
}

export interface FloInfo {
  idx: number;
  code: string;
  id: string;
  name: string;
  area: Area;
  type: FloTypeLabel;
  band: PeopleBand;
  people: number;
  agreementClass: AgreementClass;
  tenure: TenureTuple['tenure'];
  contact: ContactProfile;
  reporting: ReportingProfile;
  cluster: ClusterDef;
  lat: number;
  lng: number;
  locationConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED';
  prefs: Map<CategoryCode, Pref>;
  eligibleCategories: Set<CategoryCode>;
  fixture?: FloFixture;
  simContactId: string;
  emailContactId: string;
  /** APPROVED agreement intervals (filled by agreements.ts). */
  approved: ApprovedInterval[];
  historyWeight: number;
}

/** The latent attribute arrays after shuffles + fixture swaps (exposed for unit tests). */
export interface FloAttributes {
  area: Area[];
  type: FloTypeLabel[];
  band: PeopleBand[];
  agreement: AgreementClass[];
  tuple: TenureTuple[];
}

export function floCode(i: number): string {
  return `FLO-${pad(i + 1, 4)}`;
}

const NAME_WORDS = [
  'Mawar', 'Melati', 'Anggrek', 'Kenanga', 'Cempaka', 'Dahlia', 'Teratai', 'Kamboja', 'Flamboyan', 'Bougenvil',
  'Seroja', 'Tulip', 'Lili', 'Aster', 'Sakura', 'Asoka', 'Kemuning', 'Soka', 'Matahari', 'Cendana',
  'Akasia', 'Beringin', 'Cemara', 'Meranti', 'Jati', 'Mahoni', 'Palem', 'Pinus', 'Rasamala', 'Waru',
];
const NON_PANTI_KINDS = [
  { prefix: 'Komunitas Dapur Demo', model: 'COMMUNITY_KITCHEN' },
  { prefix: 'Rumah Singgah Demo', model: 'SHELTER' },
  { prefix: 'Majelis Taklim Simulasi', model: 'COMMUNITY_EVENT' },
  { prefix: 'Posko Pangan Demo', model: 'DISTRIBUTION_POINT' },
];

/** Marginal arrays with fixture enforcement (pure; used by tests). */
export function floAttributes(streams: Streams): FloAttributes {
  const area = shuffledMarginal(streams.get('flo.area'), AREA_COUNTS);
  const type = shuffledMarginal(streams.get('flo.type'), TYPE_COUNTS);
  const band = shuffledMarginal(streams.get('flo.people_band'), PEOPLE_BAND_COUNTS);
  const agreement = shuffledMarginal(streams.get('flo.agreement'), AGREEMENT_COUNTS);
  const tuple = tenureTuples(streams.get('flo.contact'), streams.get('flo.reporting'), streams.get('flo.tenure'));
  if (tuple.length !== FLO_COUNT) throw new Error('tenure tuples must be 200');

  const fx = FLO_FIXTURES;
  enforceBySwap(area, fx.filter((f) => f.area).map((f) => ({ index: f.index, label: `${f.code}.area`, matches: (v: Area) => v === f.area })), FIXTURE_INDEXES);
  enforceBySwap(
    agreement,
    fx.filter((f) => f.agreement).map((f) => ({ index: f.index, label: `${f.code}.agreement`, matches: (v: AgreementClass) => v === f.agreement })),
    FIXTURE_INDEXES,
  );
  enforceBySwap(
    tuple,
    fx
      .filter((f) => f.tenure || f.contact || f.reporting)
      .map((f) => ({
        index: f.index,
        label: `${f.code}.tenure`,
        matches: (v: TenureTuple) =>
          (!f.tenure || v.tenure === f.tenure) && (!f.contact || v.contact === f.contact) && (!f.reporting || v.reporting === f.reporting),
      })),
    FIXTURE_INDEXES,
  );
  return { area, type, band, agreement, tuple };
}

function offsetKm(lat: number, lng: number, km: number, bearingDeg: number): { lat: number; lng: number } {
  const b = (bearingDeg * Math.PI) / 180;
  return {
    lat: lat + (km / 111.32) * Math.cos(b),
    lng: lng + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(b),
  };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function buildFlos(ds: Dataset, clock: Clock, ids: Ids, streams: Streams, ref: RefContext): FloInfo[] {
  const attrs = floAttributes(streams);
  const tenantId = ref.tenantId;
  const setupMs = ref.setupMs;
  const fixtureByIdx = new Map(FLO_FIXTURES.map((f) => [f.index, f]));
  const placementByCode = new Map(FIXTURE_PLACEMENTS.map((p) => [p.floCode, p]));
  const sc01Source = ref.sourceByCode[SC01_SOURCE_CODE];

  const peopleRng = streams.get('flo.people_value');
  const geoRng = streams.get('flo.geo');
  const profileRng = streams.get('flo.profile');
  const prefRng = streams.get('flo.prefs');

  // Cluster placement: pinned fixtures; placed fixtures use the nearest cluster in their
  // area; everyone else round-robins over the area's clusters in index order.
  const clusterOf = new Array<ClusterDef>(FLO_COUNT);
  const coords = new Array<{ lat: number; lng: number }>(FLO_COUNT);
  for (let i = 0; i < FLO_COUNT; i++) {
    const f = fixtureByIdx.get(i);
    const placement = placementByCode.get(floCode(i));
    if (placement) {
      const src = ref.sourceByCode[placement.sourceCode];
      const p = offsetKm(src.lat, src.lng, placement.distanceKm, placement.bearingDeg);
      coords[i] = { lat: round6(p.lat), lng: round6(p.lng) };
      if (f?.clusterCode) clusterOf[i] = CLUSTERS.find((c) => c.code === f.clusterCode)!;
      else {
        const inArea = CLUSTERS.filter((c) => c.area === attrs.area[i]);
        clusterOf[i] = inArea.reduce((best, c) =>
          haversine(c.lat, c.lng, p.lat, p.lng) < haversine(best.lat, best.lng, p.lat, p.lng) ? c : best,
        );
      }
    } else if (f?.clusterCode) {
      clusterOf[i] = CLUSTERS.find((c) => c.code === f.clusterCode)!;
    }
  }
  for (const area of Object.keys(AREA_COUNTS) as Area[]) {
    const areaClusters = CLUSTERS.filter((c) => c.area === area);
    let k = 0;
    for (let i = 0; i < FLO_COUNT; i++) {
      if (attrs.area[i] !== area || clusterOf[i]) continue;
      clusterOf[i] = areaClusters[k % areaClusters.length];
      k++;
    }
  }
  for (let i = 0; i < FLO_COUNT; i++) {
    const u = geoRng();
    const v = geoRng();
    const w = geoRng();
    if (coords[i]) continue;
    const c = clusterOf[i];
    const bbox = AREA_BBOX[attrs.area[i]];
    let p = offsetKm(c.lat, c.lng, c.radiusKm * Math.sqrt(u), v * 360);
    p = { lat: clip(p.lat, bbox.minLat, bbox.maxLat), lng: clip(p.lng, bbox.minLng, bbox.maxLng) };
    const d = haversine(sc01Source.lat, sc01Source.lng, p.lat, p.lng);
    if (d < SC01_EXCLUSION_RADIUS_KM) {
      // Keep the SC01 fixture FLO-0001 the closest one: push outward from the source.
      const bearing = (Math.atan2(
        (p.lng - sc01Source.lng) * Math.cos((sc01Source.lat * Math.PI) / 180),
        p.lat - sc01Source.lat,
      ) * 180) / Math.PI;
      p = offsetKm(sc01Source.lat, sc01Source.lng, SC01_EXCLUSION_RADIUS_KM + 0.2 + 0.8 * w, bearing);
    }
    coords[i] = { lat: round6(p.lat), lng: round6(p.lng) };
  }

  // Location confidence: 6 fixed non-fixture FLOs UNVERIFIED, 20 MEDIUM, rest HIGH.
  const nonFixture = shuffle(
    Array.from({ length: FLO_COUNT }, (_, i) => i).filter((i) => !FIXTURE_INDEXES.has(i)),
    streams.get('flo.location_confidence'),
  );
  const confidence = new Array<FloInfo['locationConfidence']>(FLO_COUNT).fill('HIGH');
  nonFixture.slice(0, 6).forEach((i) => (confidence[i] = 'UNVERIFIED'));
  nonFixture.slice(6, 26).forEach((i) => (confidence[i] = 'MEDIUM'));

  const flos: FloInfo[] = [];
  for (let i = 0; i < FLO_COUNT; i++) {
    const code = floCode(i);
    const id = ids.id('flo', code);
    const fixture = fixtureByIdx.get(i);
    const type = attrs.type[i];
    const band = attrs.band[i];
    const [lo, hi] = PEOPLE_BANDS[band];
    const people = lo + Math.floor(peopleRng() * (hi - lo + 1));
    const word = NAME_WORDS[(i * 7) % NAME_WORDS.length];
    const num = pad(i + 1, 3);
    const npk = NON_PANTI_KINDS[i % NON_PANTI_KINDS.length];
    const name = type === 'PANTI' ? `Panti Asuhan Simulasi ${word} ${num}` : `${npk.prefix} ${word} ${num}`;
    const serviceModel = type === 'PANTI' ? 'RESIDENTIAL' : npk.model;
    const tuple = attrs.tuple[i];
    const cooking = chance(profileRng, type === 'PANTI' ? 0.8 : 0.4);
    const chilled = chance(profileRng, 0.4);
    const halal = chance(profileRng, 0.6);
    const peanut = chance(profileRng, 0.1);
    const createdMs =
      tuple.tenure === 'NEW' ? clock.at(clock.addDays(clock.today, -intIn(profileRng, 2, 20)), 10) : setupMs + intIn(profileRng, 0, 60) * DAY;

    // Category preferences: 2–4 PREFER, 1–2 ACCEPT, sometimes one EXCLUDE.
    const order = shuffle(CATEGORY_CODES, prefRng);
    const nPrefer = intIn(prefRng, 2, 4);
    const nAccept = intIn(prefRng, 1, 2);
    const exclude = chance(prefRng, 0.15);
    const prefs = new Map<CategoryCode, Pref>();
    order.slice(0, nPrefer).forEach((c) => prefs.set(c, 'PREFER'));
    order.slice(nPrefer, nPrefer + nAccept).forEach((c) => prefs.set(c, 'ACCEPT'));
    if (exclude && nPrefer + nAccept < order.length) prefs.set(order[order.length - 1], 'EXCLUDE');
    if (fixture?.sc01 && prefs.get('BREAD') !== 'PREFER') {
      // SC01 set must prefer BREAD; demote one PREFER to ACCEPT to keep the 2–4 shape.
      const demote = order.slice(0, nPrefer).find((c) => c !== 'BREAD');
      if (demote && nPrefer >= 4) prefs.set(demote, 'ACCEPT');
      prefs.set('BREAD', 'PREFER');
    }
    const eligibleCategories = new Set<CategoryCode>([...prefs].filter(([, p]) => p !== 'EXCLUDE').map(([c]) => c));

    const info: FloInfo = {
      idx: i, code, id, name, area: attrs.area[i], type, band, people, agreementClass: attrs.agreement[i],
      tenure: tuple.tenure, contact: tuple.contact, reporting: tuple.reporting, cluster: clusterOf[i],
      lat: coords[i].lat, lng: coords[i].lng, locationConfidence: confidence[i], prefs, eligibleCategories, fixture,
      simContactId: ids.id('flo_contact', `${code}:SIM`), emailContactId: ids.id('flo_contact', `${code}:EMAIL`),
      approved: [], historyWeight: fixture?.historyWeight ?? 1,
    };
    flos.push(info);

    const created = iso(createdMs);
    ds.add('flos', {
      id, tenant_id: tenantId, code, name, flo_type: type, service_model: serviceModel, status: 'ACTIVE',
      address: `Jl. Simulasi ${word} No. ${i + 1}, ${clusterOf[i].name}`, area: info.area,
      lat: info.lat.toFixed(6), lng: info.lng.toFixed(6), location_confidence: info.locationConfidence,
      cooking_capable: cooking, storage_capabilities: chilled ? ['AMBIENT', 'CHILLED'] : ['AMBIENT'],
      halal_required: halal, allergen_exclusions: peanut ? ['peanut'] : [], tenure: info.tenure, revision: 1,
      created_at: created, created_by: ref.users.KOORD1, updated_at: created,
    });
    ds.add('flo_clusters', {
      id: ids.id('flo_cluster', `${code}:${clusterOf[i].code}`), tenant_id: tenantId, flo_id: id,
      cluster_id: ref.clusters[clusterOf[i].code].id, is_primary: true, created_at: created, updated_at: created,
    });

    const contactHours = { timezone: 'Asia/Jakarta', windows: [{ dows: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '20:00' }] };
    const sim = `sim:flo:${pad(i + 1, 4)}`;
    const email = `flo${pad(i + 1, 4)}@example.invalid`;
    ds.add('flo_contacts', {
      id: info.simContactId, tenant_id: tenantId, flo_id: id, channel: 'SIM', address_ciphertext: null, address_hint: maskAddress(sim),
      role: 'PIC', verification_state: info.tenure === 'NEW' ? 'UNVERIFIED' : 'VERIFIED', consent_state: 'GRANTED', opted_out_at: null,
      contact_hours: contactHours, created_at: created, updated_at: created, __plain: sim,
    });
    ds.add('flo_contacts', {
      id: info.emailContactId, tenant_id: tenantId, flo_id: id, channel: 'EMAIL', address_ciphertext: null, address_hint: maskAddress(email),
      role: 'ADMIN', verification_state: 'VERIFIED', consent_state: 'GRANTED', opted_out_at: null,
      contact_hours: contactHours, created_at: created, updated_at: created, __plain: email,
    });
    for (const c of CATEGORY_CODES) {
      const p = prefs.get(c);
      if (!p) continue;
      ds.add('flo_category_prefs', {
        id: ids.id('flo_pref', `${code}:${c}`), tenant_id: tenantId, flo_id: id, category_id: ref.categories[c].id, preference: p,
        created_at: created, updated_at: created,
      });
    }
  }

  buildOperational(ds, clock, ids, streams, ref, flos);
  return flos;
}

function demandFor(c: CategoryCode, people: number): { basis: 'PER_EVENT_QTY' | 'PER_PERSON_QTY'; qty: number } {
  switch (c) {
    case 'BREAD':
    case 'PREPARED_MEAL':
    case 'SNACK':
      return { basis: 'PER_PERSON_QTY', qty: 1 };
    case 'PRODUCE':
      return { basis: 'PER_EVENT_QTY', qty: Math.max(2, Math.ceil(people * 0.15)) };
    case 'RICE':
      return { basis: 'PER_EVENT_QTY', qty: Math.max(2, Math.ceil(people * 0.2)) };
    case 'STAPLE':
      return { basis: 'PER_EVENT_QTY', qty: Math.max(2, Math.ceil(people * 0.3)) };
  }
}

function capacityFor(c: CategoryCode, people: number, u: number): number {
  switch (c) {
    case 'BREAD':
    case 'PREPARED_MEAL':
      return Math.max(10, Math.round(people * (0.8 + 0.7 * u)));
    case 'PRODUCE':
      return Math.max(5, Math.ceil(people * 0.3));
    case 'RICE':
      return Math.max(10, Math.ceil(people * 0.5));
    case 'SNACK':
      return Math.max(10, people);
    case 'STAPLE':
      return Math.max(10, Math.ceil(people * 0.5));
  }
}

function buildOperational(ds: Dataset, clock: Clock, ids: Ids, streams: Streams, ref: RefContext, flos: FloInfo[]): void {
  const tenantId = ref.tenantId;
  const T = clock.now;
  const setupDate = clock.dateOf(ref.setupMs);
  const scheduleFrom = clock.addDays(setupDate, 4);
  const demandFrom = clock.addDays(setupDate, 1);
  const rng = streams.get('flo.operational');
  const needRng = streams.get('flo.needs');
  const k1 = ref.users.KOORD1;

  for (const f of flos) {
    const isNew = f.tenure === 'NEW';
    const created = iso(isNew ? clock.at(clock.addDays(clock.today, -2), 10) : ref.setupMs + 3 * DAY);

    // Schedule (each row stands alone; never mix count bases).
    const dows = f.type === 'PANTI' ? [1, 2, 3, 4, 5, 6, 7] : pickDows(rng);
    const verifiedAt = ref.setupMs + intIn(rng, 20, 150) * DAY;
    ds.add('service_schedules', {
      id: ids.id('schedule', `${f.code}:1`), tenant_id: tenantId, flo_id: f.id, effective_from: scheduleFrom, effective_to_excl: null,
      service_dows: dows, people_per_event: f.people, count_basis: f.type === 'PANTI' ? 'DAILY_RESIDENTS' : 'PER_EVENT',
      declared_count: f.people, verified_count: isNew ? null : f.people, verified_by: isNew ? null : k1,
      verified_at: isNew ? null : iso(verifiedAt), evidence_media_id: null, created_at: created, updated_at: created,
    });

    // Availability: contact 08–20 daily; receiving by service model.
    for (let d = 1; d <= 7; d++) {
      ds.add('availability_windows', {
        id: ids.id('window', `${f.code}:CONTACT:${d}`), tenant_id: tenantId, flo_id: f.id, kind: 'CONTACT', dow: d,
        start_local: '08:00', end_local: '20:00', starts_at: null, ends_at: null, created_at: created, updated_at: created,
      });
    }
    const recvDays = f.type === 'PANTI' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6];
    for (const d of recvDays) {
      ds.add('availability_windows', {
        id: ids.id('window', `${f.code}:RECEIVING:${d}`), tenant_id: tenantId, flo_id: f.id, kind: 'RECEIVING', dow: d,
        start_local: f.type === 'PANTI' ? '07:00' : '09:00', end_local: f.type === 'PANTI' ? '19:00' : '17:00',
        starts_at: null, ends_at: null, created_at: created, updated_at: created,
      });
    }

    for (const [c, pref] of f.prefs) {
      if (pref === 'EXCLUDE') continue;
      const cat = ref.categories[c];
      const unit = cat.def.comparableUnit;
      const isSc01Bread = !!f.fixture?.sc01 && c === 'BREAD';

      // Demand for PREFER categories, ~8% of pairs missing (AC09).
      const missDemand = chance(rng, 0.08);
      if (pref === 'PREFER' && (isSc01Bread || !missDemand)) {
        const dm = demandFor(c, f.people);
        ds.add('category_demands', {
          id: ids.id('demand', `${f.code}:${c}:1`), tenant_id: tenantId, flo_id: f.id, category_id: cat.id, unit, basis: dm.basis,
          quantity: String(dm.qty), valid_from: demandFrom, valid_to_excl: null, confidence: isNew ? 'LOW' : 'MEDIUM',
          assessor_id: k1, confirmed_by: isNew ? null : k1, status: isNew ? 'PROPOSED' : 'CONFIRMED', created_at: created, updated_at: created,
        });
      }

      // Capacity (≈5% unknown → NULL).
      const unknownCap = chance(rng, 0.05);
      const capU = rng();
      let cap: number | null = unknownCap ? null : capacityFor(c, f.people, capU);
      let dist: number | null = cap === null ? null : cap * 2;
      if (isSc01Bread && f.fixture?.breadCapacity) {
        cap = f.fixture.breadCapacity;
        dist = f.fixture.breadCapacity;
      }
      ds.add('flo_category_capacities', {
        id: ids.id('capacity', `${f.code}:${c}`), tenant_id: tenantId, flo_id: f.id, category_id: cat.id, unit,
        per_event_capacity: cap === null ? null : String(cap), distribution_capacity: dist === null ? null : String(dist),
        confirmed_at: cap === null ? null : created, confirmed_by: cap === null ? null : k1, created_at: created, updated_at: created,
      });

      // Needs: 70% fresh confirmed, 15% stale, 15% missing; NEW FLOs have none.
      if (pref !== 'PREFER' || isNew) continue;
      const u = needRng();
      const score = intIn(needRng, 20, 80);
      const daysAgoFresh = intIn(needRng, 1, 20);
      const daysAgoStale = intIn(needRng, 35, 60);
      const fixtureNeed = isSc01Bread ? f.fixture?.breadNeed : undefined;
      let assessed: number;
      let expires: number;
      let s: number;
      if (fixtureNeed !== undefined) {
        assessed = clock.at(clock.addDays(clock.today, -3), 10);
        expires = assessed + 60 * DAY;
        s = fixtureNeed;
      } else if (u < 0.7) {
        assessed = clock.at(clock.addDays(clock.today, -daysAgoFresh), 10);
        expires = assessed + 60 * DAY;
        s = score;
      } else if (u < 0.85) {
        assessed = clock.at(clock.addDays(clock.today, -daysAgoStale), 10);
        expires = assessed + 90 * DAY;
        s = score;
      } else continue;
      const dm = demandFor(c, f.people);
      const requested = dm.basis === 'PER_PERSON_QTY' ? f.people : dm.qty;
      ds.add('need_assessments', {
        id: ids.id('need', `${f.code}:${c}:1`), tenant_id: tenantId, flo_id: f.id, category_id: cat.id, score: s.toFixed(2),
        basis: 'Kunjungan lapangan (simulasi)', requested_qty: String(requested), unit,
        intended_distribution_date: clock.addDays(clock.today, 2), available_stock_qty: null, expected_deliveries_qty: null,
        existing_support: null, assessor_id: k1, assessed_at: iso(assessed), expires_at: iso(expires), status: 'CONFIRMED',
        confirmed_by: k1, created_at: iso(assessed), updated_at: iso(assessed),
      });
    }
  }

  // A few dated closures in the near future (non-fixture, established).
  const closureFlos = flos.filter((f) => !f.fixture && f.tenure === 'ESTABLISHED').slice(0, 200);
  const picks = shuffle(closureFlos, streams.get('flo.closures')).slice(0, 4);
  for (const f of picks.sort((a, b) => a.idx - b.idx)) {
    const startDate = clock.addDays(clock.today, 3);
    ds.add('availability_windows', {
      id: ids.id('window', `${f.code}:CLOSURE:1`), tenant_id: tenantId, flo_id: f.id, kind: 'CLOSURE', dow: null,
      start_local: null, end_local: null, starts_at: iso(clock.dayStart(startDate)), ends_at: iso(clock.dayStart(clock.addDays(startDate, 2))),
      created_at: iso(T - 2 * DAY), updated_at: iso(T - 2 * DAY),
    });
  }
}

function pickDows(rng: () => number): number[] {
  const n = intIn(rng, 1, 3);
  const days = shuffle([1, 2, 3, 4, 5, 6], rng).slice(0, n);
  return days.sort((a, b) => a - b);
}
