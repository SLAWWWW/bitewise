/**
 * Human labels for stable domain codes (food categories, FLO service models).
 * Codes stay the storage/API contract; the UI shows these labels. Unknown codes
 * fall back to the raw code so nothing is silently hidden.
 */
import type { Locale } from './types';

const CATEGORY: Record<string, { id: string; en: string }> = {
  BREAD: { id: 'Roti', en: 'Bread' },
  PREPARED_MEAL: { id: 'Makanan siap saji', en: 'Prepared meal' },
  PRODUCE: { id: 'Sayur & buah', en: 'Fresh produce' },
  RICE: { id: 'Beras', en: 'Rice' },
  SNACK: { id: 'Camilan', en: 'Snacks' },
  STAPLE: { id: 'Bahan pokok', en: 'Packaged staple' },
};

const SERVICE_MODEL: Record<string, { id: string; en: string }> = {
  RESIDENTIAL: { id: 'Hunian (penghuni harian)', en: 'Residential (daily residents)' },
  COMMUNITY_KITCHEN: { id: 'Dapur komunitas', en: 'Community kitchen' },
  SHELTER: { id: 'Rumah singgah', en: 'Shelter' },
  COMMUNITY_EVENT: { id: 'Kegiatan komunitas', en: 'Community event' },
  DISTRIBUTION_POINT: { id: 'Posko distribusi', en: 'Distribution point' },
};

export function categoryLabel(code: string | null | undefined, locale: Locale): string {
  if (!code) return '—';
  return CATEGORY[code]?.[locale] ?? code;
}

export function serviceModelLabel(code: string | null | undefined, locale: Locale): string {
  if (!code) return '—';
  return SERVICE_MODEL[code]?.[locale] ?? code;
}
