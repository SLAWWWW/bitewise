/**
 * Foreground embedded PostgreSQL 17 for local development (docs/architecture.md G.1, F.1).
 *
 *   npm run db:start            # .data/pg on port 54329, persistent
 *   tsx scripts/db/start.ts --dir .data/pg-scratch --port 54400 [--ephemeral] [--verbose]
 *
 * initdb runs only when <dir>/PG_VERSION is absent. Stops cleanly on SIGINT/SIGTERM.
 * Also importable: `startEmbedded({ dir, port, persistent })` and `ensureCluster()` for test setup.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export interface StartEmbeddedOptions {
  /** Data directory (absolute or relative to cwd). Default `.data/pg`. */
  dir?: string;
  /** TCP port. Default 54329. */
  port?: number;
  /**
   * Keep the data directory after stop(). Default true. When false the
   * directory is deleted by stop() (embedded-postgres semantics).
   */
  persistent?: boolean;
  /**
   * Forward every server log line. Default: only WARNING/FATAL/PANIC (per-statement
   * ERRORs belong to the client that caused them, e.g. tests).
   */
  verbose?: boolean;
  log?: (line: string) => void;
}

export interface EmbeddedHandle {
  dir: string;
  port: number;
  adminUrl: string;
  /** True when this call ran initdb. */
  initialised: boolean;
  stop: () => Promise<void>;
}

const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'postgres';

/** Ask the OS for a free TCP port on localhost. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Remove a postmaster.pid left behind by a crashed server; refuse if live. */
function clearStalePid(dir: string): void {
  const pidFile = path.join(dir, 'postmaster.pid');
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8').split('\n')[0]);
  if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
    throw new Error(
      `A PostgreSQL server (pid ${pid}) is already running on ${dir}. Stop it first or use it directly.`,
    );
  }
  rmSync(pidFile, { force: true });
}

export async function startEmbedded(opts: StartEmbeddedOptions = {}): Promise<EmbeddedHandle> {
  const dir = path.resolve(process.cwd(), opts.dir ?? '.data/pg');
  const port = opts.port ?? 54329;
  const persistent = opts.persistent ?? true;
  const log = opts.log ?? ((line: string) => process.stderr.write(`[pg] ${line}\n`));
  const important = /\b(WARNING|FATAL|PANIC)\b/;
  const onLog = (msg: unknown) => {
    const text = String(msg instanceof Error ? msg.message : msg);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      if (opts.verbose || important.test(line)) log(line.trimEnd());
    }
  };

  // Dynamic import: embedded-postgres is ESM-only and registers exit hooks on load.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  mkdirSync(path.dirname(dir), { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: SUPERUSER,
    password: SUPERUSER_PASSWORD,
    authMethod: 'scram-sha-256',
    persistent,
    initdbFlags: ['--locale=C', '--encoding=UTF8'],
    postgresFlags: ['-c', 'listen_addresses=localhost'],
    onLog,
    onError: onLog,
  });

  let initialised = false;
  if (!existsSync(path.join(dir, 'PG_VERSION'))) {
    await pg.initialise();
    initialised = true;
  } else {
    clearStalePid(dir);
  }
  try {
    await pg.start();
  } catch (err) {
    throw new Error(
      `embedded-postgres failed to start on port ${port} (data dir ${dir}). Is the port in use?` +
        (err instanceof Error ? ` ${err.message}` : ''),
    );
  }

  let stopped = false;
  return {
    dir,
    port,
    adminUrl: `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${port}/postgres`,
    initialised,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await pg.stop();
    },
  };
}

export interface ClusterHandle {
  adminUrl: string;
  /** Set when this call had to start a private embedded instance. */
  embedded: EmbeddedHandle | null;
  stop: () => Promise<void>;
}

/**
 * Reuse the first reachable admin URL among `candidates`; otherwise start a
 * private, non-persistent embedded instance in `.data/<dirPrefix>-<pid>-<rand>`
 * on a free port (deleted again by stop()). For DB tests.
 */
export async function ensureCluster(
  candidates: Array<string | undefined>,
  opts: { dirPrefix?: string } = {},
): Promise<ClusterHandle> {
  const { canConnect } = await import('../../src/db/migrate-lib');
  for (const url of candidates) {
    if (url && (await canConnect(url))) {
      return { adminUrl: url, embedded: null, stop: async () => undefined };
    }
  }
  const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const embedded = await startEmbedded({
    dir: `.data/${opts.dirPrefix ?? 'pg-dbtest'}-${suffix}`,
    port: await freePort(),
    persistent: false,
  });
  return { adminUrl: embedded.adminUrl, embedded, stop: embedded.stop };
}

function parseArgs(argv: string[]) {
  const out: { dir?: string; port?: number; persistent: boolean; verbose: boolean } = {
    persistent: true,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--ephemeral') out.persistent = false;
    else if (a === '--verbose') out.verbose = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (out.port !== undefined && !(Number.isInteger(out.port) && out.port > 0 && out.port < 65536)) {
    throw new Error('--port must be an integer 1..65535');
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const handle = await startEmbedded(args);
  const host = `localhost:${handle.port}`;
  const dbName = 'lumbung';
  process.stdout.write(
    [
      `embedded PostgreSQL 17 ready (${handle.initialised ? 'initialised new cluster' : 'existing cluster'})`,
      `  data dir:            ${handle.dir}`,
      `  DATABASE_ADMIN_URL=${handle.adminUrl}`,
      `  DATABASE_OWNER_URL=postgres://lumbung_owner:lumbung_owner@${host}/${dbName}`,
      `  DATABASE_URL=postgres://lumbung_app:lumbung_app@${host}/${dbName}`,
      `Next: npm run db:bootstrap && npm run db:migrate. Ctrl-C to stop.`,
      '',
    ].join('\n'),
  );

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`\n${signal} received, stopping PostgreSQL...\n`);
    handle
      .stop()
      .then(() => {
        process.stdout.write('PostgreSQL stopped.\n');
        process.exit(0);
      })
      .catch((err) => {
        process.stderr.write(`Failed to stop cleanly: ${String(err)}\n`);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Keep the event loop alive in the foreground.
  setInterval(() => undefined, 1 << 30);
}

const invokedDirectly = /scripts[\\/]db[\\/]start\.ts$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
