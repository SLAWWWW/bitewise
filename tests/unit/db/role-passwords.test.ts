import { describe, expect, it } from 'vitest';
import { rolePasswordsFromEnv } from '@/src/db/migrate-lib';

describe('rolePasswordsFromEnv (cluster-wide role passwords must follow the configured URLs)', () => {
  it('takes passwords from DATABASE_OWNER_URL / DATABASE_URL', () => {
    expect(
      rolePasswordsFromEnv({
        DATABASE_OWNER_URL: 'postgres://lumbung_owner:own%40er-pw@localhost:54329/lumbung',
        DATABASE_URL: 'postgres://lumbung_app:app-pw@localhost:54329/lumbung',
      }),
    ).toEqual({ ownerPassword: 'own@er-pw', appPassword: 'app-pw' });
  });

  it('falls back to the G.1 development defaults', () => {
    expect(rolePasswordsFromEnv({})).toEqual({ ownerPassword: 'lumbung_owner', appPassword: 'lumbung_app' });
  });
});
