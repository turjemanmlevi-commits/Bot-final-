/**
 * Piezas comunes de las fuentes oficiales de eventos (Ticketmaster, partidos):
 * errores con mensaje en español, fechas, espera entre consultas, caché y
 * comparación de nombres de recintos y clubes.
 */

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
  /** `done`: la respuesta ya ha llegado (para guardarla en disco). */
  private readonly map = new Map<string, { at: number; value: Promise<T>; done?: { v: T } }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 200,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const value = load();
    const entry: { at: number; value: Promise<T>; done?: { v: T } } = { at: now, value };
    this.map.set(key, entry);
    // Un fallo no se guarda: la siguiente vez se vuelve a preguntar.
    value.then(
      (v) => {
        entry.done = { v };
      },
      () => {
        if (this.map.get(key)?.value === value) this.map.delete(key);
      },
    );
    this.trim();
    return value;
  }

  /** Mete una respuesta ya conocida (p. ej. leída de disco) con la hora a la que se obtuvo. */
  set(key: string, value: T, at: number): void {
    if (Date.now() - at >= this.ttlMs) return;
    this.map.set(key, { at, value: Promise.resolve(value), done: { v: value } });
    this.trim();
  }

  /** Respuestas vigentes que ya han llegado (las que siguen en curso o han fallado no). */
  entries(): Array<[string, number, T]> {
    const now = Date.now();
    return [...this.map.entries()].filter(([, e]) => e.done && now - e.at < this.ttlMs).map(([key, e]) => [key, e.at, (e.done as { v: T }).v]);
  }

  /** Olvida una respuesta guardada (p. ej. al pedir una nueva con «Buscar otra vez»). */
  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private trim(): void {
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

// ---------------------------------------------------------------------------
// Nombres de recintos y clubes: los mismos criterios que el dashboard (shared)
// ---------------------------------------------------------------------------

export { clubMatches, nameTokens, sameCity, venueNameScore } from '@to/shared';
