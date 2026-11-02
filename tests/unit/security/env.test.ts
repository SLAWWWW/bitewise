import { describe, it, expect } from 'vitest';
import { DEV_CONTACT_ENC_KEY, DEV_SESSION_SECRET, EnvError, isDemoLike, parseEnv } from '@/src/config/env';

const strongSecret = 's'.repeat(48);
const strongKey = Buffer.alloc(32, 7).toString('base64');
const appUrl = 'postgres://lumbung_app:pw@db.example:5432/lumbung';

describe('parseEnv', () => {
  it('defaults to DEMO with dev secrets and warnings', () => {
    const env = parseEnv({});
    expect(env.APP_MODE).toBe('DEMO');
    expect(env.SESSION_SECRET).toBe(DEV_SESSION_SECRET);
    expect(env.CONTACT_ENC_KEY).toBe(DEV_CONTACT_ENC_KEY);
    expect(env.APP_TIMEZONE).toBe('Asia/Jakarta');
    expect(env.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(env.LEASE_SECONDS).toBe(30);
    expect(env.warnings.length).toBeGreaterThan(0);
    expect(isDemoLike(env)).toBe(true);
  });

  it('forces the mock messaging adapter outside LIVE even with a real token (INV10/AC50)', () => {
    const env = parseEnv({ APP_MODE: 'DEMO', MESSAGING_ADAPTER: 'fonnte', FONNTE_TOKEN: 'real-looking-token' });
    expect(env.MESSAGING_ADAPTER).toBe('mock');
    expect(env.MESSAGING_ADAPTER_CONFIGURED).toBe('fonnte');
  });

  it('LIVE refuses dev-default or missing secrets', () => {
    expect(() => parseEnv({ APP_MODE: 'LIVE', DATABASE_URL: appUrl })).toThrow(EnvError);
    expect(() =>
      parseEnv({ APP_MODE: 'LIVE', DATABASE_URL: appUrl, SESSION_SECRET: DEV_SESSION_SECRET, CONTACT_ENC_KEY: strongKey }),
    ).toThrow(/dev default/);
  });

  it('LIVE web process refuses owner/admin URLs and an owner/superuser DATABASE_URL', () => {
    const base = { APP_MODE: 'LIVE', SESSION_SECRET: strongSecret, CONTACT_ENC_KEY: strongKey };
    expect(() => parseEnv({ ...base, DATABASE_URL: appUrl, DATABASE_OWNER_URL: 'postgres://o@x/db' })).toThrow(
      /DATABASE_OWNER_URL/,
    );
    expect(() => parseEnv({ ...base, DATABASE_URL: appUrl, DATABASE_ADMIN_URL: 'postgres://p@x/db' })).toThrow(
      /DATABASE_ADMIN_URL/,
    );
    expect(() => parseEnv({ ...base, DATABASE_URL: 'postgres://lumbung_owner:x@h/db' })).toThrow(/least-privileged/);
    // scripts may hold the owner URL
    expect(parseEnv({ ...base, DATABASE_URL: appUrl, DATABASE_OWNER_URL: 'postgres://o@x/db' }, { process: 'script' }).APP_MODE).toBe('LIVE');
  });

  it('accepts a valid LIVE configuration', () => {
    const env = parseEnv({ APP_MODE: 'LIVE', DATABASE_URL: appUrl, SESSION_SECRET: strongSecret, CONTACT_ENC_KEY: strongKey });
    expect(env.APP_MODE).toBe('LIVE');
    expect(env.warnings).toEqual([]);
    expect(isDemoLike(env)).toBe(false);
  });

  it('validates shapes', () => {
    expect(() => parseEnv({ APP_MODE: 'PROD' })).toThrow(EnvError);
    expect(() => parseEnv({ SESSION_SECRET: 'short' })).toThrow(/32 characters/);
    expect(() => parseEnv({ CONTACT_ENC_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
  });
});
