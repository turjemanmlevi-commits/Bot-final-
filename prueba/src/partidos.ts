/**
 * Partidos del Real Madrid Femenino con entradas a la venta, leídos de la web oficial
 * (realmadrid.com). Cada partido trae su enlace directo de compra en tickets.realmadrid.com, y
 * cada competición se vende en un canal distinto (Liga F: realmadrid_femenino; Champions:
 * realmadridfemenino_champions…), así que no basta con mirar un único catálogo.
 */

export const WOMEN_TEAM_PAGE = 'https://www.realmadrid.com/es-ES/futbol/primer-equipo-femenino/inicio';

/** Catálogos del femenino en la web de entradas, por si realmadrid.com no responde. */
export const REAL_MADRID_WOMEN_CHANNELS = [
  'https://tickets.realmadrid.com/realmadridfemenino_champions/?hl=es-ES',
  'https://tickets.realmadrid.com/realmadrid_femenino/?hl=es-ES',
];

export interface OfficialMatch {
  id: string;
  /** «Real Madrid vs Paris FC». */
  title: string;
  competition: string | null;
  /** ISO, UTC. */
  dateTime: string;
  venue: string | null;
  /** Enlace oficial de compra (tickets.realmadrid.com/<canal>/select/<sesión>). */
  ticketsUrl: string;
  soldOut: boolean;
  /** Precio «desde», en céntimos, si la web lo publica. */
  fromPrice: number | null;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const str = (v: Json | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: Json | undefined): { [k: string]: Json } | null => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function priceCents(v: Json | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
  const s = str(v);
  if (!s) return null;
  const m = /(\d+(?:[.,]\d{1,2})?)/.exec(s);
  return m ? Math.round(Number(m[1]!.replace(',', '.')) * 100) : null;
}

function toMatch(o: { [k: string]: Json }): OfficialMatch | null {
  const url = str(o['ticketsLink']);
  const dateTime = str(o['dateTime']);
  if (!dateTime) return null;
  const home = str(obj(o['homeTeam'])?.['name']) ?? str(o['homeTeamName']);
  const away = str(obj(o['awayTeam'])?.['name']) ?? str(o['awayTeamName']);
  const title = str(obj(o['description'])?.['plaintext']) ?? (home && away ? `${home} vs ${away}` : null);
  if (!title) return null;
  return {
    id: str(o['id']) ?? str(o['slug']) ?? `${title}-${dateTime}`,
    title,
    competition: str(obj(o['competition'])?.['name']),
    dateTime,
    venue: str(obj(o['venue'])?.['name']),
    ticketsUrl: url ?? '',
    soldOut: o['soldOut'] === true,
    fromPrice: priceCents(o['fromPrice']),
  };
}

/** Todos los partidos (con o sin entradas) que aparecen en una página de realmadrid.com. */
export function parseOfficialMatches(html: string): OfficialMatch[] {
  const out: OfficialMatch[] = [];
  const scripts = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
  const walk = (v: Json, depth: number): void => {
    if (depth > 60 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if ('ticketsLink' in v && 'dateTime' in v) {
      const m = toMatch(v);
      if (m) out.push(m);
    }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  for (const raw of scripts) {
    try {
      walk(JSON.parse(raw) as Json, 0);
    } catch {
      // otro bloque JSON: se ignora
    }
  }
  // Sin un mismo partido repetido (la página lo incluye en varios bloques).
  const seen = new Set<string>();
  return out.filter((m) => {
    const key = `${m.id}|${m.ticketsUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Partidos con entradas a la venta ahora: enlace de tickets.realmadrid.com, no agotados y por jugar; el más próximo primero. */
export function matchesOnSale(all: OfficialMatch[], now = Date.now()): OfficialMatch[] {
  const seen = new Set<string>();
  return all
    .filter((m) => /^https:\/\/tickets\.realmadrid\.com\/[^/]+\/(select|events)\//i.test(m.ticketsUrl))
    .filter((m) => !m.soldOut && Date.parse(m.dateTime) > now)
    .filter((m) => (seen.has(m.ticketsUrl) ? false : (seen.add(m.ticketsUrl), true)))
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

/** Lee realmadrid.com y devuelve los partidos del femenino con entradas a la venta. Lanza un error si la web no responde. */
export async function fetchWomenMatchesOnSale(opts: { fetchImpl?: typeof fetch; now?: number; timeoutMs?: number; url?: string } = {}): Promise<OfficialMatch[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.url ?? WOMEN_TEAM_PAGE, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'accept-language': 'es-ES,es;q=0.9',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw new Error(`realmadrid.com respondió ${res.status}`);
  const all = parseOfficialMatches(await res.text());
  if (all.length === 0) throw new Error('No encuentro la lista de partidos en realmadrid.com (la página ha cambiado).');
  return matchesOnSale(all, opts.now);
}
