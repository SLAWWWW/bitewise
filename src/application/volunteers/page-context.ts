import 'server-only';
import { redirect } from 'next/navigation';
import { DomainError } from '@/src/db/errors';
import { withTx } from '@/src/db/tx';
import type { TxClient } from '@/src/db/types';
import { getLocale } from '@/src/i18n/server';
import { actorCtx, getServerActor } from '@/src/security/actor';

const PAGE_CAPS = {
  routes: ['route.read', 'route.manage', 'route.claim', 'route.progress'],
  volunteers: ['volunteer.read', 'volunteer.manage'],
} as const;

export async function volunteerPage(page: keyof typeof PAGE_CAPS) {
  const actor = await getServerActor();
  if (!actor) redirect('/masuk');
  if (!PAGE_CAPS[page].some((cap) => actor.capabilities.includes(cap))) {
    throw new DomainError({ code: 'CAPABILITY_REQUIRED', message: 'Volunteer route access is required' });
  }
  const locale = await getLocale();
  return {
    actor,
    locale,
    can: (cap: string) => actor.capabilities.some((value) => value === cap),
    tx: <T>(fn: (c: TxClient) => Promise<T>) => withTx(actorCtx(actor), fn),
  };
}
