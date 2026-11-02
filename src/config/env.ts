/**
 * Server configuration (architecture G.1). Validated once with zod and cached.
 *
 * Mode rules:
 *  - DEMO / TEST may fall back to dev-default secrets (with a startup warning).
 *  - LIVE refuses dev-default secrets, refuses DATABASE_OWNER_URL / DATABASE_ADMIN_URL
 *    in the web process, and refuses mock/fake adapters being silently forced.
 *
 * The UI mode label is not the security control — `assertModeAtStartup()` runs from
 * `instrumentation.ts` and side-effect boundaries call `getEnv()` themselves.
 */
import { z } from 'zod';

export const APP_MODES = ['DEMO', 'TEST', 'LIVE'] as const;
export type AppMode = (typeof APP_MODES)[number];

/** Dev-only defaults. Never valid in LIVE. */
export const DEV_SESSION_SECRET = 'lumbung-dev-session-secret-do-not-use-in-live-000';
/** 32 zero-ish bytes, base64. Never valid in LIVE. */
export const DEV_CONTACT_ENC_KEY = Buffer.from('lumbung-dev-contact-key-32-bytes').toString('base64');

export const DEFAULT_DATABASE_URL = 'postgres://lumbung_app:lumbung_app@localhost:54329/lumbung';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));

const rawSchema = z.object({
  APP_MODE: z.enum(APP_MODES).default('DEMO'),
  DATABASE_URL: z.string().min(1).default(DEFAULT_DATABASE_URL),
  DATABASE_OWNER_URL: optionalString,
  DATABASE_ADMIN_URL: optionalString,
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  APP_TIMEZONE: z.string().min(1).default('Asia/Jakarta'),
  SESSION_SECRET: optionalString,
  CONTACT_ENC_KEY: optionalString,
  MEDIA_DIR: z.string().min(1).default('.data/media'),
  MESSAGING_ADAPTER: z.enum(['mock', 'fonnte']).default('mock'),
  FONNTE_TOKEN: optionalString,
  ROUTING_ADAPTER: z.enum(['fixture', 'straight_line']).default('fixture'),
  LLM_ADAPTER: z.enum(['fake', 'gemini']).default('fake'),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  WORKER_ID: optionalString,
  LEASE_SECONDS: z.coerce.number().int().positive().default(30),
});

export interface Env {
  APP_MODE: AppMode;
  DATABASE_URL: string;
  DATABASE_OWNER_URL?: string;
  DATABASE_ADMIN_URL?: string;
  APP_BASE_URL: string;
  APP_TIMEZONE: string;
  SESSION_SECRET: string;
  CONTACT_ENC_KEY: string;
  MEDIA_DIR: string;
  /** Effective adapter: DEMO/TEST always 'mock' regardless of the configured value. */
  MESSAGING_ADAPTER: 'mock' | 'fonnte';
  /** What the operator configured, before mode forcing (for diagnostics only). */
  MESSAGING_ADAPTER_CONFIGURED: 'mock' | 'fonnte';
  FONNTE_TOKEN?: string;
  ROUTING_ADAPTER: 'fixture' | 'straight_line';
  LLM_ADAPTER: 'fake' | 'gemini';
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  WORKER_ID?: string;
  LEASE_SECONDS: number;
  /** Warnings produced while resolving defaults (printed at startup). */
  warnings: string[];
}

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'EnvError';
  }
}

export type ProcessKind = 'web' | 'worker' | 'script';

function decodedKeyLength(b64: string): number {
  try {
    return Buffer.from(b64, 'base64').length;
  } catch {
    return -1;
  }
}

function urlUser(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).username) || null;
  } catch {
    return null;
  }
}

/**
 * Pure parser — exported for tests. Does not read or cache `process.env`.
 */
export function parseEnv(
  source: Record<string, string | undefined>,
  opts: { process?: ProcessKind } = {},
): Env {
  const proc = opts.process ?? 'web';
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    const problems = Object.entries(flat.fieldErrors).map(
      ([k, msgs]) => `${k}: ${(msgs as string[] | undefined)?.join(', ') ?? 'invalid'}`,
    );
    throw new EnvError(problems.length ? problems : flat.formErrors);
  }
  const raw = parsed.data;
  const problems: string[] = [];
  const warnings: string[] = [];
  const live = raw.APP_MODE === 'LIVE';

  let sessionSecret = raw.SESSION_SECRET;
  if (!sessionSecret) {
    if (live) problems.push('SESSION_SECRET is required in LIVE');
    else warnings.push('SESSION_SECRET not set: using the insecure dev default (DEMO/TEST only)');
    sessionSecret = DEV_SESSION_SECRET;
  }
  if (sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  if (live && sessionSecret === DEV_SESSION_SECRET) problems.push('SESSION_SECRET must not be the dev default in LIVE');

  let contactKey = raw.CONTACT_ENC_KEY;
  if (!contactKey) {
    if (live) problems.push('CONTACT_ENC_KEY is required in LIVE');
    else warnings.push('CONTACT_ENC_KEY not set: using the insecure dev default (DEMO/TEST only)');
    contactKey = DEV_CONTACT_ENC_KEY;
  }
  if (decodedKeyLength(contactKey) !== 32) problems.push('CONTACT_ENC_KEY must be 32 bytes, base64-encoded');
  if (live && contactKey === DEV_CONTACT_ENC_KEY) problems.push('CONTACT_ENC_KEY must not be the dev default in LIVE');

  if (live && proc === 'web') {
    if (raw.DATABASE_OWNER_URL) problems.push('DATABASE_OWNER_URL must not be set for the LIVE web process');
    if (raw.DATABASE_ADMIN_URL) problems.push('DATABASE_ADMIN_URL must not be set for the LIVE web process');
  }
  if (live) {
    const user = urlUser(raw.DATABASE_URL);
    if (user === 'postgres' || user === 'lumbung_owner') {
      problems.push('DATABASE_URL must use the least-privileged app role in LIVE (not owner/superuser)');
    }
  }

  // INV10: DEMO/TEST can never send for real, whatever is configured.
  const messaging = live ? raw.MESSAGING_ADAPTER : 'mock';
  if (!live && raw.MESSAGING_ADAPTER !== 'mock') {
    warnings.push(`MESSAGING_ADAPTER=${raw.MESSAGING_ADAPTER} ignored in ${raw.APP_MODE}: mock adapter forced`);
  }
  if (live && raw.MESSAGING_ADAPTER === 'fonnte' && !raw.FONNTE_TOKEN) {
    problems.push('FONNTE_TOKEN is required when MESSAGING_ADAPTER=fonnte in LIVE');
  }
  if (raw.LLM_ADAPTER === 'gemini' && !raw.GEMINI_API_KEY) {
    if (live) problems.push('GEMINI_API_KEY is required when LLM_ADAPTER=gemini');
    else warnings.push('LLM_ADAPTER=gemini without GEMINI_API_KEY: agents will fall back to deterministic mode');
  }

  if (problems.length) throw new EnvError(problems);

  return {
    APP_MODE: raw.APP_MODE,
    DATABASE_URL: raw.DATABASE_URL,
    DATABASE_OWNER_URL: raw.DATABASE_OWNER_URL,
    DATABASE_ADMIN_URL: raw.DATABASE_ADMIN_URL,
    APP_BASE_URL: raw.APP_BASE_URL,
    APP_TIMEZONE: raw.APP_TIMEZONE,
    SESSION_SECRET: sessionSecret,
    CONTACT_ENC_KEY: contactKey,
    MEDIA_DIR: raw.MEDIA_DIR,
    MESSAGING_ADAPTER: messaging,
    MESSAGING_ADAPTER_CONFIGURED: raw.MESSAGING_ADAPTER,
    FONNTE_TOKEN: raw.FONNTE_TOKEN,
    ROUTING_ADAPTER: raw.ROUTING_ADAPTER,
    LLM_ADAPTER: raw.LLM_ADAPTER,
    GEMINI_API_KEY: raw.GEMINI_API_KEY,
    GEMINI_MODEL: raw.GEMINI_MODEL,
    WORKER_ID: raw.WORKER_ID,
    LEASE_SECONDS: raw.LEASE_SECONDS,
    warnings,
  };
}

let cached: Env | undefined;

/** Validated, cached process configuration. Throws EnvError on invalid config. */
export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env, { process: currentProcessKind() });
  return cached;
}

/** Test hook: forget the cached env so the next getEnv() re-reads process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

function currentProcessKind(): ProcessKind {
  const k = process.env.LUMBUNG_PROCESS;
  return k === 'worker' || k === 'script' ? k : 'web';
}

/** DEMO or TEST: simulated clock, mock adapters, demo controls allowed. */
export function isDemoLike(env: Pick<Env, 'APP_MODE'> = getEnv()): boolean {
  return env.APP_MODE === 'DEMO' || env.APP_MODE === 'TEST';
}

/**
 * Startup gate (instrumentation.ts → register()). Throws in LIVE misconfiguration,
 * prints warnings otherwise.
 */
export function assertModeAtStartup(): Env {
  const env = getEnv();
  for (const w of env.warnings) console.warn(`[lumbung:${env.APP_MODE}] ${w}`);
  console.info(`[lumbung] APP_MODE=${env.APP_MODE}`);
  return env;
}
