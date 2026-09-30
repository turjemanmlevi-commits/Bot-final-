/**
 * Reconocer recintos, clubes y límites de compra en textos de fuera (fuentes
 * oficiales y páginas que la persona envía a la sala). Lo usan el servidor y
 * el dashboard, así que es el mismo criterio en los dos lados.
 */

import type { LimitSemantics } from './domain';

/** Minúsculas, sin tildes y sin signos: «Bernabéu» → «bernabeu». */
export function plainText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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
  return plainText(s)
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
  const x = plainText(a);
  const y = plainText(b);
  if (x === '' || y === '') return null;
  return x === y || x.includes(y) || y.includes(x);
}

export interface VenueRef {
  venueId: string;
  name: string;
  city: string | null;
  aliases: string[];
}

/** El recinto (de una lista) que mejor encaja con un nombre y una ciudad de fuera, o null. */
export function bestVenueMatch(venues: VenueRef[], name: string, city: string | null): string | null {
  let best: { id: string; score: number } | null = null;
  for (const v of venues) {
    let score = venueNameScore([v.name, ...v.aliases], [name], v.city ? nameTokens(v.city) : []);
    if (score === 0) continue;
    const same = sameCity(v.city, city);
    if (same === false) score -= 0.3;
    if (same === true) score += 0.05;
    if (score >= 0.8 && (!best || score > best.score)) best = { id: v.venueId, score };
  }
  return best?.id ?? null;
}

/**
 * Recinto que se nombra en un texto (la página del evento): el nombre o un
 * alias con alguna palabra propia, entero. Gana el nombre más largo.
 */
export function venueMentioned(venues: VenueRef[], text: string): string | null {
  const hay = ` ${plainText(text)} `;
  let best: { id: string; len: number } | null = null;
  for (const v of venues) {
    const cityTokens = new Set(v.city ? nameTokens(v.city) : []);
    for (const n of [v.name, ...v.aliases]) {
      const tokens = nameTokens(n);
      if (!tokens.some((t) => !GENERIC.has(t) && !cityTokens.has(t))) continue;
      const needle = plainText(n);
      if (needle.length >= 5 && hay.includes(` ${needle} `) && (!best || needle.length > best.len)) best = { id: v.venueId, len: needle.length };
    }
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// Clubes
// ---------------------------------------------------------------------------

const CLUB_STOP = new Set([...STOP, 'cf', 'fc', 'cd', 'ud', 'sd', 'sad', 'rc', 'rcd', 'ca', 'club', 'futbol', 'balompie', 'football']);

function clubTokens(s: string): string[] {
  return plainText(s)
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

// ---------------------------------------------------------------------------
// Límite de compra
// ---------------------------------------------------------------------------

export interface ParsedLimit {
  perCustomer: number | null;
  semantics: LimitSemantics | null;
  /** Frase donde lo dice (para enseñarla tal cual). */
  excerpt: string | null;
}

const LIMIT_PATTERNS: RegExp[] = [
  // «Hay un límite de 6 entradas por cliente», «Máximo 4 entradas», «hasta 2 tickets»
  /(?:limite|limit|maximo|max\.?|hasta un maximo de|hasta|a maximum of|up to)\D{0,30}?\b(\d{1,2})\s*(?:entradas?|tickets?|localidades|boletos|abonos)\b/,
  // «6 ticket limit», «4 entradas por persona», «4 tickets per customer»
  /\b(\d{1,2})\s*(?:entradas?|tickets?|localidades|boletos)\s*(?:limit|como maximo|maximo|max|por|per)\b/,
  // «Ticket limit: 8 per customer», «Límite: 4 por persona»
  /(?:limite|limit)\D{0,30}?\b(\d{1,2})\s*(?:por|per)\b/,
];

function squash(value: string, max: number): string {
  const t = value.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Lee el límite de compra de un texto oficial («There is an overall 6 ticket
 * limit», «Hay un límite de 4 entradas por cliente»…). Las ticketeras cuentan
 * el límite por cliente (nombre, cuenta y tarjeta): por defecto, por titular.
 * `strict`: en textos que no son el límite oficial («2 entradas por 60 €»)
 * solo cuentan las frases con «límite», «máximo»…
 */
export function parseTicketLimit(raw: string | null | undefined, opts: { strict?: boolean } = {}): ParsedLimit {
  const none: ParsedLimit = { perCustomer: null, semantics: null, excerpt: null };
  if (!raw) return none;
  const text = raw.normalize('NFC');
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const patterns = opts.strict ? [LIMIT_PATTERNS[0], LIMIT_PATTERNS[2]] : LIMIT_PATTERNS;
  for (const re of patterns) {
    if (!re) continue;
    const m = re.exec(plain);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > 50) continue;
    let semantics: LimitSemantics = 'PER_HOLDER';
    if (/por (?:tarjeta|medio de pago)|per (?:credit )?card|per payment/.test(plain)) semantics = 'PER_PAYMENT_METHOD';
    else if (/por (?:hogar|domicilio|direccion)|per (?:household|address)/.test(plain)) semantics = 'PER_HOUSEHOLD';
    // La frase donde está (el texto normalizado tiene la misma longitud que el original).
    const start = Math.max(plain.lastIndexOf('.', m.index) + 1, 0);
    const endDot = plain.indexOf('.', m.index + m[0].length);
    const end = endDot < 0 ? text.length : endDot + 1;
    return { perCustomer: n, semantics, excerpt: squash(text.slice(start, end), 240) };
  }
  return none;
}
