import { createHash } from 'node:crypto';

/**
 * JSON canónico: claves ordenadas, sin `undefined`. Dos objetos con el mismo
 * contenido producen exactamente la misma cadena (base de hashes y replay).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : canonicalize(v)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = canonicalize(v);
  }
  return out;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hash del contenido canónico de un valor. */
export function hashOf(value: unknown, length = 64): string {
  return sha256(canonicalJson(value)).slice(0, length);
}
