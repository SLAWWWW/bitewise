import type { AppMode } from './env';

/** Temporary documentation: both the process and tenant must be non-live.
 * The explicit switch also lets a DEMO deployment hide the guide without deleting it.
 */
export function prototypeGuideEnabled({
  appMode,
  tenantMode,
  flag,
}: {
  appMode: AppMode;
  tenantMode: AppMode;
  flag?: string;
}): boolean {
  return appMode !== 'LIVE' && tenantMode !== 'LIVE' && (flag === undefined || flag === 'true');
}
