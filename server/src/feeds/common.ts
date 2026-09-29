/**
 * Piezas comunes de las fuentes oficiales de eventos (Ticketmaster, partidos):
 * errores con mensaje en español, fechas, espera entre consultas, caché y
 * comparación de nombres de recintos y clubes.
 */

import { normalizeLabel } from '../util/normalize';
import { timeZoneOffsetMs } from '../util/time';

export type FeedErrorKind = 'AUTH' | 'RATE' | 'NETWORK' | 'BAD' | 'PLAN';

/** Fallo de una fuente, con un mensaje que se puede enseñar tal cual (nunca lleva la clave). */
export class FeedError extends Error {
  constructor(
    readonly kind: FeedErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** Descripción corta de un fallo de red («fetch failed (ECONNRESET)»). */
export function networkError(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'no contesta';
  const cause = e.cause?.code ?? e.cause?.message;
  return cause ? `${e.message} (${cause})` : e.message;
}

/** Instante → «AAAA-MM-DDTHH:mm» en la zona dada (lo que guarda el vault). */
export function localDateTime(ms: number, timeZone: string): string {
  return new Date(ms + timeZoneOffsetMs(ms, timeZone)).toISOString().slice(0, 16);
}

/** Fecha para las APIs: ISO sin milisegundos (Ticketmaster no los acepta). */
export function apiDateTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Fecha ISO válida y creíble (Ticketmaster pone 1900-01-01 cuando no hay fecha). */
export function validMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const year = new Date(ms).getUTCFullYear();
  return year < 2000 || year > 2100 ? null : ms;
}

/** Solo enlaces http(s) completos. */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Texto limpio: sin HTML, espacios repetidos ni saltos. */
export function cleanText(value: unknown, max = 600): string | null {
  if (typeof value !== 'string') return null;
  const t = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t === '') return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Espera mínima entre consultas seguidas (Ticketmaster: 5 por segundo). */
export class Throttle {
  private last = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly gapMs: number) {}

  wait(): Promise<void> {
    const run = this.chain.then(async () => {
      const wait = this.last + this.gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

/** Como mucho `max` consultas por ventana (football-data.org gratis: 10 por minuto). */
export class RateWindow {
  private readonly calls: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  wait(): Promise<void> {
    const run = this.chain.then(async () => {
      for (;;) {
        const now = Date.now();
        while (this.calls.length > 0 && now - (this.calls[0] as number) >= this.windowMs) this.calls.shift();
        if (this.calls.length < this.max) break;
        await new Promise((r) => setTimeout(r, (this.calls[0] as number) + this.windowMs - now + 5));
      }
      this.calls.push(Date.now());
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

/** Caché con caducidad. Si se pide lo mismo dos veces a la vez, se hace una sola consulta. */
export class TtlCache<T> {
  private readonly map = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 200,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.map.set(key, { at: now, value });
    // Un fallo no se guarda: la siguiente vez se vuelve a preguntar.
    value.catch(() => {
      if (this.map.get(key)?.value === value) this.map.delete(key);
    });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    return value;
  }

  clear(): void {
    this.map.clear();
  }
}

// ---------------------------------------------------------------------------
// Nombres de recintos
// ---------------------------------------------------------------------------

const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'l', 'd', 'y', 'i', 'a', 'da', 'do', 'dos', 'das', 'the', 'and', 'of', 'en']);
/** Palabras que no distinguen un recinto de otro. */
const GENERIC = new Set([
  'estadio',
  'estadi',
  'stadium',
  'arena',
  'palacio',
  'palau',
  'pabellon',
  'recinto',
  'ferial',
  'feria',
  'plaza',
  'toros',
  'auditorio',
  'centro',
  'espacio',
  'sala',
  'campo',
  'futbol',
  'municipal',
  'deportes',
  'multiusos',
  'pista',
  'parque',
  'parc',
  'festival',
  'nuevo',
  'nou',
]);

export function nameTokens(s: string): string[] {
  return normalizeLabel(s)
    .split(' ')
    .filter((t) => t !== '' && !STOP.has(t));
}

/**
 * ¿Se refieren al mismo recinto? 1 = mismo nombre; 0,85 = todas las palabras
 * propias del nuestro están en el suyo; 0,8 = al revés; 0 = no. Las palabras
 * genéricas («estadio», «arena»…) y la ciudad no bastan para parecerse.
 */
export function venueNameScore(ours: string[], theirs: string[], cityTokens: string[] = []): number {
  const city = new Set(cityTokens);
  const distinctive = (tokens: string[]) => tokens.filter((t) => !GENERIC.has(t) && !city.has(t));
  let best = 0;
  for (const a of ours) {
    const ta = nameTokens(a);
    if (ta.length === 0) continue;
    for (const b of theirs) {
      const tb = nameTokens(b);
      if (tb.length === 0) continue;
      if ([...ta].sort().join(' ') === [...tb].sort().join(' ')) return 1;
      const setA = new Set(ta);
      const setB = new Set(tb);
      const da = distinctive(ta);
      const db = distinctive(tb);
      if (da.length > 0 && da.every((t) => setB.has(t))) best = Math.max(best, 0.85);
      else if (db.length > 0 && db.every((t) => setA.has(t))) best = Math.max(best, 0.8);
    }
  }
  return best;
}

/** ¿Es la misma ciudad? null si falta alguna. */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a || !b) return null;
  const x = normalizeLabel(a);
  const y = normalizeLabel(b);
  if (x === '' || y === '') return null;
  return x === y || x.includes(y) || y.includes(x);
}

// ---------------------------------------------------------------------------
// Nombres de clubes
// ---------------------------------------------------------------------------

const CLUB_STOP = new Set([...STOP, 'cf', 'fc', 'cd', 'ud', 'sd', 'sad', 'rc', 'rcd', 'ca', 'club', 'futbol', 'balompie', 'football']);

function clubTokens(s: string): string[] {
  return normalizeLabel(s)
    .split(' ')
    .filter((t) => t !== '' && !CLUB_STOP.has(t))
    .sort();
}

/**
 * ¿Es este equipo el club del estadio? Igual nombre (sin «CF», «Club»…) o, si
 * el del estadio tiene dos palabras o más, todas están en el del equipo
 * («Rayo Vallecano» ⊂ «Rayo Vallecano de Madrid»). Una sola palabra común no
 * basta: «Deportivo» no es «Deportivo Alavés».
 */
export function clubMatches(clubs: string[], teamNames: Array<string | null | undefined>): boolean {
  for (const club of clubs) {
    const c = clubTokens(club);
    if (c.length === 0) continue;
    for (const name of teamNames) {
      if (!name) continue;
      const t = clubTokens(name);
      if (t.length === 0) continue;
      if (t.join(' ') === c.join(' ')) return true;
      const set = new Set(t);
      if (c.length >= 2 && c.every((x) => set.has(x))) return true;
    }
  }
  return false;
}
