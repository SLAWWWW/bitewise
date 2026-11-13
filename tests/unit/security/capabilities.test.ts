import { describe, it, expect } from 'vitest';
import { DomainError } from '@/src/db/errors';
import { hasAnyCap, hasCap, requireActor, requireCap } from '@/src/security/capabilities';
import {
  CAPABILITIES,
  HUMAN_ONLY_CAPABILITIES,
  ROLE_CAPABILITIES,
  capabilitiesForRoles,
  isCapability,
} from '@/src/shared/capabilities';
import { navForCapabilities, NAV_ITEMS, isActive } from '@/src/ui/nav';

describe('capability vocabulary (G.3)', () => {
  it('has exactly the 45 contract capabilities, unique', () => {
    expect(CAPABILITIES).toHaveLength(45);
    expect(new Set(CAPABILITIES).size).toBe(45);
  });

  it('role bundles only use known capabilities', () => {
    for (const caps of Object.values(ROLE_CAPABILITIES)) for (const c of caps) expect(isCapability(c)).toBe(true);
  });

  it('WAREHOUSE_SUPERVISOR extends WAREHOUSE', () => {
    for (const c of ROLE_CAPABILITIES.WAREHOUSE) expect(ROLE_CAPABILITIES.WAREHOUSE_SUPERVISOR).toContain(c);
    expect(ROLE_CAPABILITIES.WAREHOUSE).not.toContain('inventory.adjust.approve');
    expect(ROLE_CAPABILITIES.WAREHOUSE_SUPERVISOR).toContain('inventory.adjust.approve');
  });

  it('the demo admin (ADMIN+COORDINATOR) gets the union, deduplicated', () => {
    const caps = capabilitiesForRoles(['ADMIN', 'COORDINATOR']);
    expect(new Set(caps).size).toBe(caps.length);
    expect(caps).toContain('demo.reset');
    expect(caps).toContain('dispatch.approve');
  });

  it('auditors cannot approve anything', () => {
    expect(ROLE_CAPABILITIES.AUDITOR).toEqual(['flo.read', 'audit.read']);
    for (const c of HUMAN_ONLY_CAPABILITIES) expect(ROLE_CAPABILITIES.AUDITOR).not.toContain(c);
  });

  it('volunteers can claim and progress routes without staff powers', () => {
    expect(ROLE_CAPABILITIES.VOLUNTEER).toEqual(['route.read', 'route.claim', 'route.progress']);
    expect(ROLE_CAPABILITIES.VOLUNTEER).not.toContain('dispatch.approve');
    expect(ROLE_CAPABILITIES.VOLUNTEER).not.toContain('delivery.receive');
  });
});

describe('hasCap / requireCap', () => {
  const coordinator = { capabilities: [...ROLE_CAPABILITIES.COORDINATOR] };

  it('checks membership capabilities', () => {
    expect(hasCap(coordinator, 'dispatch.approve')).toBe(true);
    expect(hasCap(coordinator, 'agreement.review')).toBe(false);
    expect(hasCap(null, 'flo.read')).toBe(false);
    expect(hasAnyCap(coordinator, ['agreement.review', 'flo.read'])).toBe(true);
  });

  it('throws 403 CAPABILITY_REQUIRED and 401 UNAUTHENTICATED', () => {
    expect(() => requireCap(coordinator, 'agreement.review')).toThrow(DomainError);
    try {
      requireCap(coordinator, 'agreement.review');
    } catch (e) {
      expect((e as DomainError).code).toBe('CAPABILITY_REQUIRED');
      expect((e as DomainError).http).toBe(403);
    }
    try {
      requireActor(null);
    } catch (e) {
      expect((e as DomainError).http).toBe(401);
    }
    expect(requireCap(coordinator, 'flo.read')).toBe(coordinator);
  });
});

describe('navigation config', () => {
  it('filters by capability and enabled stage', () => {
    const auditor = navForCapabilities(ROLE_CAPABILITIES.AUDITOR);
    expect(auditor.map((i) => i.href)).toEqual(['/ringkasan', '/donasi', '/flo', '/persediaan', '/pengiriman', '/pengaturan', '/audit']);
    expect(navForCapabilities(ROLE_CAPABILITIES.AUDITOR,{enabledStage:1}).map(i=>i.href)).toEqual(['/ringkasan','/flo','/pengaturan','/audit']);
    const all = navForCapabilities(CAPABILITIES, { enabledStage: 5, prototypeGuide: true });
    expect(all).toHaveLength(NAV_ITEMS.length);
  });

  it('keeps PRD §16 navigation order', () => {
    expect(NAV_ITEMS.filter(i => !i.prototypeOnly).map((i) => i.labelKey)).toEqual([
      'nav.ringkasan',
      'nav.donasi',
      'nav.rekomendasi',
      'nav.persetujuan',
      'nav.flo',
      'nav.persediaan',
      'nav.pengiriman',
      'nav.rute',
      'nav.relawan',
      'nav.pesan',
      'nav.pelaporan',
      'nav.pengaturan',
      'nav.audit',
    ]);
  });

  it('matches active sections by path prefix', () => {
    expect(isActive({ href: '/flo' }, '/flo/abc/perjanjian')).toBe(true);
    expect(isActive({ href: '/flo' }, '/flowers')).toBe(false);
  });
});
