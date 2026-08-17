/**
 * Client-side counterpart to lib/staff-auth.ts. The key is never bundled —
 * it's typed in once by whoever is operating the staff views and kept only
 * in that browser's localStorage, then attached to every request by
 * fetchJson. A public visitor's browser has no key stored, so staff-only
 * mutations 401 for them by default.
 */
const STORAGE_KEY = 'bitewise_staff_key';

export function getStaffKey(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStaffKey(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, key);
}

export function promptForStaffKey(): void {
  if (typeof window === 'undefined') return;
  const current = getStaffKey() ?? '';
  const next = window.prompt(
    'Staff key — required for approve/reject, pickup, and dispatch actions.\n' +
      '(Ask whoever set up this deployment if you don\'t have it.)',
    current
  );
  if (next != null && next.trim()) setStaffKey(next.trim());
}
