/**
 * Pure, deterministic dataset generator: same config → deep-equal output. No I/O,
 * no wall clock, no Math.random. Contact addresses stay in plaintext (`__plain`) here;
 * encryption happens at insert time (db/seed/insert.ts).
 */
import { Clock, Ids, Streams, resolveConfig, type SeedConfig } from './config';
import { Dataset } from './dataset';
import { buildReference } from './reference';
import { buildFlos, type FloInfo } from './flos';
import { buildAgreements } from './agreements';
import { buildHistory, type HistoryResult } from './history';
import { buildReporting, type ReportingMeta } from './reporting';
import { addAudit } from './audit';

export interface FloSummary {
  code: string;
  id: string;
  name: string;
  area: string;
  type: string;
  band: string;
  people: number;
  agreementClass: string;
  tenure: string;
  contact: string;
  reporting: string;
  cluster: string;
  lat: number;
  lng: number;
}

export interface GeneratedSeed {
  cfg: SeedConfig;
  tenantId: string;
  ds: Dataset;
  flos: FloSummary[];
  meta: { history: HistoryResult['meta']; reporting: ReportingMeta };
}

export function summarizeFlo(f: FloInfo): FloSummary {
  return {
    code: f.code, id: f.id, name: f.name, area: f.area, type: f.type, band: f.band, people: f.people, agreementClass: f.agreementClass,
    tenure: f.tenure, contact: f.contact, reporting: f.reporting, cluster: f.cluster.code, lat: f.lat, lng: f.lng,
  };
}

export function generateSeed(partial: Partial<SeedConfig> = {}): GeneratedSeed {
  const cfg = resolveConfig(partial);
  const clock = new Clock(cfg);
  const ids = new Ids(cfg.slug);
  const streams = new Streams(cfg.seed);
  const ds = new Dataset();

  const ref = buildReference(ds, cfg, clock, ids);
  const flos = buildFlos(ds, clock, ids, streams, ref);
  buildAgreements(ds, clock, ids, streams, ref, flos);
  const history = buildHistory(ds, clock, ids, streams, ref, flos);
  const reporting = buildReporting(ds, clock, ids, streams, ref, history);

  addAudit(ds, ids, {
    key: `seed:${cfg.seed}`, actorId: null, actorKind: 'SYSTEM', action: 'SEED_APPLIED', subjectType: 'TENANT', subjectId: ids.tenantId,
    at: clock.now, payload: { seed: cfg.seed, clock: new Date(clock.now).toISOString(), synthetic: true },
  });

  return { cfg, tenantId: ids.tenantId, ds, flos: flos.map(summarizeFlo), meta: { history: history.meta, reporting } };
}
