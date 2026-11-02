import { describe, it, expect } from 'vitest';
import { DICTIONARIES, NAMESPACES, interpolate, roleLabel, t } from '@/src/i18n';

describe('i18n', () => {
  it('defaults to Bahasa Indonesia and supports English', () => {
    expect(t('common', 'nav.ringkasan')).toBe('Ringkasan');
    expect(t('common', 'nav.ringkasan', undefined, 'en')).toBe('Overview');
  });

  it('interpolates variables', () => {
    expect(t('common', 'masuk.choose', { name: 'Koordinator Demo 1' })).toBe('Masuk sebagai Koordinator Demo 1');
    expect(interpolate('{a} dan {b}', { a: 1 })).toBe('1 dan {b}');
  });

  it('falls back to id, then to the key', () => {
    expect(t('common', 'no.such.key', undefined, 'en')).toBe('no.such.key');
  });

  it('registers all implemented namespaces', () => {
    expect([...NAMESPACES]).toEqual(['common', 'flo', 'settings', 'dashboard', 'audit', 'direct', 'ops']);
    for (const ns of NAMESPACES) {
      expect(DICTIONARIES.id[ns]).toBeTypeOf('object');
      expect(DICTIONARIES.en[ns]).toBeTypeOf('object');
    }
  });

  it('id and en common dictionaries have identical keys', () => {
    expect(Object.keys(DICTIONARIES.en.common).sort()).toEqual(Object.keys(DICTIONARIES.id.common).sort());
  });

  it('has every nav label from PRD §16', () => {
    for (const k of ['Ringkasan', 'Donasi', 'Rekomendasi', 'Persetujuan', 'FLO', 'Persediaan', 'Pengiriman', 'Pesan', 'Pelaporan', 'Pengaturan', 'Audit']) {
      expect(Object.values(DICTIONARIES.id.common)).toContain(k);
    }
  });

  it('translates composite role labels and passes unknown ones through', () => {
    expect(roleLabel('ADMIN+COORDINATOR')).toBe('Administrator tenant + Koordinator operasi');
    expect(roleLabel('Relawan khusus')).toBe('Relawan khusus');
  });
});
