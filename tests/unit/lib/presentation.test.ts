import { describe, expect, it } from 'vitest';
import { codeLabel, quantityLabel, stockStatus } from '@/src/ui/presentation';

describe('operator quantity and status presentation', () => {
  it('distinguishes decimal scale from thousands in Indonesian', () => {
    expect(quantityLabel('12.000', 'kg', 'id')).toBe('12 kg');
    expect(quantityLabel('5.500', 'kg', 'id')).toBe('5,5 kg');
    expect(quantityLabel('12000.125', 'pack', 'id')).toBe('12.000,125 pak');
  });
  it('shows incomplete intake as unknown, never as zero', () => {
    expect(quantityLabel(null, null, 'id')).toBe('Jumlah belum diketahui');
    expect(quantityLabel('0.000', 'kg', 'en')).toBe('0 kg');
    expect(quantityLabel('12', null, 'en')).toBe('12 (unit unknown)');
  });
  it('preserves exact large and signed ledger quantities', () => {
    expect(quantityLabel('99999999999.999', 'kg', 'en')).toBe('99,999,999,999.999 kg');
    expect(quantityLabel('-1000.001', 'kg', 'id')).toBe('-1.000,001 kg');
  });
  it('renders known workflow codes without leaking translation keys', () => {
    expect(codeLabel('PLANNED', 'id')).toBe('Direncanakan');
    expect(codeLabel('WAREHOUSE_OUTBOUND', 'en')).toBe('From warehouse');
    expect(codeLabel('DISTRIBUTION', 'id')).toBe('Bukti pembagian');
  });
});


describe('stock warnings use the operational clock', () => {
  const now = '2026-10-26T01:00:00Z';
  const batch = { restriction: 'NONE', expires_at: null, handling_deadline: null };
  it('marks a reached handling deadline even when label expiry is unknown', () => {
    expect(stockStatus({ ...batch, handling_deadline: now }, now)).toBe('SAFETY_DEADLINE_PASSED');
    expect(stockStatus({ ...batch, expires_at: '2026-10-25T00:00:00Z' }, now)).toBe('SAFETY_DEADLINE_PASSED');
  });
  it('preserves explicit restrictions and does not invent expiry for unknown dates', () => {
    expect(stockStatus({ ...batch, restriction: 'RECALLED', expires_at: now }, now)).toBe('RECALLED');
    expect(stockStatus(batch, now)).toBe('NONE');
    expect(stockStatus({ ...batch, expires_at: '2026-10-27T00:00:00Z' }, now)).toBe('NONE');
  });
});
