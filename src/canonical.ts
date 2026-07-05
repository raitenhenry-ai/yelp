/**
 * Deterministic JSON serialization (JCS-style): object keys sorted
 * lexicographically at every depth, no insignificant whitespace.
 * Signatures are computed over this form so any two parties serialize an
 * outcome identically.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('canonicalJson: non-finite number');
  }
  return value;
}
