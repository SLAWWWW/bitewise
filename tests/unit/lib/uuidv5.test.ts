import { describe, it, expect } from 'vitest';
import { entityId, isUuid, LUMBUNG_ROOT_NS, NS_DNS, NS_URL, tenantNamespace, uuidv5 } from '@/src/lib/uuidv5';

describe('uuidv5', () => {
  it('matches the RFC 4122 / Python uuid5 test vector', () => {
    // uuid.uuid5(uuid.NAMESPACE_DNS, 'www.example.com')
    expect(uuidv5('www.example.com', NS_DNS)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('derives the fixed Lumbung root namespace', () => {
    expect(uuidv5('https://lumbung.example.invalid/', NS_URL)).toBe(LUMBUNG_ROOT_NS);
  });

  it('sets version 5 and the RFC variant', () => {
    const id = uuidv5('flo:FLO-0042', tenantNamespace('foodcycle-demo'));
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is deterministic and namespace-sensitive', () => {
    const a = tenantNamespace('foodcycle-demo');
    const b = tenantNamespace('isolation-test');
    expect(entityId(a, 'flo', 'FLO-0001')).toBe(entityId(a, 'flo', 'FLO-0001'));
    expect(entityId(a, 'flo', 'FLO-0001')).not.toBe(entityId(b, 'flo', 'FLO-0001'));
    expect(entityId(a, 'flo', 'FLO-0001')).not.toBe(entityId(a, 'flo', 'FLO-0002'));
  });

  it('rejects an invalid namespace', () => {
    expect(() => uuidv5('x', 'not-a-uuid')).toThrow(TypeError);
  });
});
