/** Small helpers shared by the W2-FLO route handlers. */
import { DomainError } from '@/src/db/errors';
import { isUuid } from '@/src/lib/uuidv5';

/** The `[id]` route param as a uuid; anything else is indistinguishable from "not found". */
export function idParam(params: Record<string, string | string[]>, name = 'id'): string {
  const v = params[name];
  if (typeof v !== 'string' || !isUuid(v)) {
    throw new DomainError({ code: 'NOT_FOUND', message: 'Not found' });
  }
  return v.toLowerCase();
}
