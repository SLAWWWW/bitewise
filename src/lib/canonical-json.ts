/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit order (recursively),
 * arrays keep their order, `undefined` object members are dropped, no whitespace.
 * Used for request_hash and facts_hash. Throws on values JSON cannot represent
 * deterministically (NaN/Infinity, functions, symbols, cycles).
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalJson(value: unknown): string {
  return serialise(value, new Set());
}

function serialise(v: unknown, seen: Set<object>): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(Object.is(v, -0) ? 0 : v);
    case 'string':
      return JSON.stringify(v);
    case 'bigint':
      return JSON.stringify(v.toString());
    case 'undefined':
    case 'function':
    case 'symbol':
      throw new TypeError(`canonicalJson: cannot serialise ${typeof v}`);
  }
  const obj = v as object;
  if (obj instanceof Date) {
    if (Number.isNaN(obj.getTime())) throw new TypeError('canonicalJson: invalid Date');
    return JSON.stringify(obj.toISOString());
  }
  if (seen.has(obj)) throw new TypeError('canonicalJson: cycle');
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return '[' + obj.map((x) => (x === undefined ? 'null' : serialise(x, seen))).join(',') + ']';
    }
    const rec = obj as Record<string, unknown>;
    const keys = Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialise(rec[k], seen)).join(',') + '}';
  } finally {
    seen.delete(obj);
  }
}
