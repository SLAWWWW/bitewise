import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { prototypeGuideEnabled } from '@/src/config/prototype-guide';
import { navForCapabilities } from '@/src/ui/nav';
import { guideMaps } from '@/components/prototype-guide/content';
import { guideMarkdown } from '@/components/prototype-guide/export';

describe('temporary prototype documentation', () => {
  it('requires both process and tenant to be non-live, even with an explicit opt-in', () => {
    for (const appMode of ['DEMO', 'TEST', 'LIVE'] as const) {
      for (const tenantMode of ['DEMO', 'TEST', 'LIVE'] as const) {
        expect(prototypeGuideEnabled({ appMode, tenantMode, flag: 'true' })).toBe(appMode !== 'LIVE' && tenantMode !== 'LIVE');
      }
    }
  });

  it('can be disabled in a demo and fails closed on unexpected flags', () => {
    expect(prototypeGuideEnabled({ appMode: 'DEMO', tenantMode: 'TEST' })).toBe(true);
    for (const flag of ['false', '0', '', 'TRUE', 'yes']) {
      expect(prototypeGuideEnabled({ appMode: 'DEMO', tenantMode: 'DEMO', flag })).toBe(false);
    }
  });

  it('keeps prototype navigation opt-in without granting other capabilities', () => {
    expect(navForCapabilities([]).some(item => item.href === '/panduan')).toBe(false);
    const enabled = navForCapabilities([], { prototypeGuide: true }).map(item => item.href);
    expect(enabled).toContain('/panduan');
    expect(enabled).not.toContain('/persetujuan');
    expect(navForCapabilities([], { prototypeGuide: true, enabledStage: 1 }).some(item => item.href === '/panduan')).toBe(false);
  });

  it('keeps translated diagrams connected and implementation references valid', () => {
    const id = guideMaps('id'), en = guideMaps('en');
    expect(id.map(map => map.id)).toEqual(en.map(map => map.id));
    for (const [i, map] of en.entries()) {
      expect(map.nodes.map(node => node.id)).toEqual(id[i].nodes.map(node => node.id));
      const ids = new Set(map.nodes.map(node => node.id));
      expect(ids.size).toBe(map.nodes.length);
      for (const edge of map.edges) {
        expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
      }
      for (const node of map.nodes) {
        expect(map.edges.some(edge => edge.from === node.id || edge.to === node.id)).toBe(true);
        for (const source of node.source) expect(existsSync(resolve(source)), source).toBe(true);
      }
    }
  });

  it('exports every diagram and explanation from the same content', () => {
    const maps = guideMaps('en');
    const markdown = guideMarkdown(maps, 'en');
    expect(markdown.match(/```mermaid/g)).toHaveLength(6);
    for (const map of maps) {
      expect(markdown).toContain(map.label);
      for (const node of map.nodes) {
        expect(markdown).toContain(node.title);
        expect(markdown).toContain(node.exception);
      }
    }
  });
});
