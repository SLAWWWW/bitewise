/**
 * Shared DB types + pg type-parser installation (architecture A.3).
 *
 * This file deliberately has no `server-only` import so that CLI scripts (seed,
 * reset, migrate) and tests can reuse the parsers via `src/db/owner.ts`.
 */
import pg from 'pg';

export const ACTOR_KINDS = ['USER', 'WORKER', 'AGENT', 'FLO_LINK', 'SYSTEM'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Per-transaction context, written into the five `app.*` GUCs by `withTx`. */
export interface DbCtx {
  /** null only for the few context-free lookups (e.g. demo login directory). */
  tenantId: string | null;
  userId?: string | null;
  actorKind: ActorKind;
  /** FLO access link id when actorKind = FLO_LINK. */
  linkId?: string | null;
  correlationId: string;
}

/** A client inside an open transaction (what `withTx` hands to its callback). */
export type TxClient = pg.PoolClient;

export type Queryable = Pick<pg.PoolClient, 'query'>;

let installed = false;

/**
 * Install the type parsers once per process:
 *  - 1082 date        → 'YYYY-MM-DD' string (the default local-midnight Date is a bug)
 *  - 1700 numeric     → string (bigint milli-units are computed in TS via src/lib/qty)
 *  - 20   int8        → string (SQL counts should use ::int)
 *  - 1182 date[], 1231 numeric[], 1016 int8[] → string[]
 *  - 1114 / 1184 timestamps stay as Date.
 */
export function installTypeParsers(): void {
  if (installed) return;
  installed = true;
  const identity = (v: string) => v;
  const stringArray = pg.types.getTypeParser(1009 as never) as (v: string) => string[];
  pg.types.setTypeParser(1082, identity);
  pg.types.setTypeParser(1700, identity);
  pg.types.setTypeParser(20, identity);
  pg.types.setTypeParser(1182 as never, stringArray);
  pg.types.setTypeParser(1231 as never, stringArray);
  pg.types.setTypeParser(1016 as never, stringArray);
}

installTypeParsers();
