/**
 * «📥 Enviar a la sala» — crear un evento desde la página oficial, sin API ni claves.
 *
 * La persona abre el evento en la web oficial (Ticketmaster, entradas.com,
 * realmadrid.com…) en SU navegador y pulsa el marcador «Enviar a la sala». El
 * marcador recoge lo que esa página ya enseña (los datos del evento que la
 * web publica para los buscadores —schema.org—, el título, las fechas y las
 * líneas que hablan de la venta o del límite) y abre la sala con el formulario
 * relleno. Nada se lee sin que la persona lo pida y la sala nunca visita esas
 * webs por su cuenta.
 */

import type { LimitSemantics } from './domain';
import { bestVenueMatch, parseTicketLimit, venueMentioned, type VenueRef } from './matching';

/** Lo que envía el marcador (versión 1). */
export interface PageCapture {
  v: 1;
  url: string;
  canonical: string | null;
  title: string;
  h1: string | null;
  /** og:title, og:url, description… */
  meta: Record<string, string>;
  /** Contenido de cada <script type="application/ld+json">. */
  ld: string[];
  /** Elementos <time datetime>: [datetime, texto]. */
  times: Array<[string, string]>;
  /** Líneas visibles con fechas, horas, venta, límites o recintos. */
  lines: string[];
  /** Texto que la persona tenía seleccionado (p. ej. la tarjeta de un partido). */
  selection: string | null;
  at: string;
}

export interface ImportedSale {
  name: string;
  /** «AAAA-MM-DDTHH:mm» en la zona del vault. */
  startsAtLocal: string;
}

export interface ImportedEvent {
  name: string | null;
  url: string | null;
  startsAtLocal: string | null;
  /** Solo se sabe el día. */
  timeTBA: boolean;
  venueName: string | null;
  city: string | null;
  /** Recinto del vault reconocido; null = no está (se puede crear con venueName). */
  venueId: string | null;
  sales: ImportedSale[];
  limit: { perCustomer: number | null; semantics: LimitSemantics | null; text: string | null };
  price: { min: number | null; max: number | null; currency: string } | null;
  status: 'CANCELLED' | 'POSTPONED' | 'RESCHEDULED' | 'SOLD_OUT' | null;
  /** De dónde salen los datos: los del evento que publica la web, o leídos del texto. */
  from: 'structured' | 'text';
}

export interface PageImport {
  /** Web de venta según el dominio (null = otra web oficial). */
  providerId: string | null;
  host: string;
  pageUrl: string;
  /** Casi siempre uno; varios si la página tiene varias fechas (gira, abono…). */
  events: ImportedEvent[];
}

export interface ImportContext {
  timeZone: string;
  venues: Array<VenueRef & { clubs?: string[] }>;
  providers: Array<{ providerId: string; url: string | null }>;
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

const offsetFmt = new Map<string, Intl.DateTimeFormat>();

/** Instante → «AAAA-MM-DDTHH:mm» en la zona dada. */
export function localIn(ms: number, timeZone: string): string {
  let f = offsetFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    offsetFmt.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Fecha de schema.org → hora local del vault. «2026-10-27T21:00:00+01:00» se
 * convierte; sin zona («2026-10-27T21:00:00») es la hora del recinto (España);
 * solo día → a las 00:00 con la hora pendiente.
 */
export function isoToLocal(value: unknown, timeZone: string): { local: string; timeTBA: boolean } | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (!m) return null;
  const [, date, hh, mm, zone] = m;
  if (hh === undefined) return { local: `${date}T00:00`, timeTBA: true };
  if (!zone) return { local: `${date}T${hh}:${mm}`, timeTBA: false };
  const ms = Date.parse(zone === 'Z' ? s : s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(ms) ? null : { local: localIn(ms, timeZone), timeTBA: false };
}

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};
// «mar» es martes y marzo: solo cuenta como mes detrás del día («6 mar»).
const MONTH_RE = Object.keys(MONTHS)
  .concat('mar')
  .sort((a, b) => b.length - a.length)
  .join('|');
const MONTH_FIRST_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
MONTHS.mar = 3;

export interface TextDate {
  index: number;
  end: number;
  /** «AAAA-MM-DD» */
  date: string;
  /** «HH:mm» o null */
  time: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function plainKeepLength(s: string): string {
  // Sin tildes y en minúsculas, con la misma longitud (para poder volver al texto original).
  return s.normalize('NFC').replace(/[À-ɏ]/g, (ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '')).toLowerCase();
}

function timeNear(text: string, from: number): string | null {
  const after = text.slice(from, from + 40);
  const m =
    /^[^\d]{0,14}?(?:a las |a la |desde las |,|·|-|–|\||\s)\s*(\d{1,2})[:.h](\d{2})(?!\d)\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(after) ??
    /^[^\d]{0,14}?\b(\d{1,2})\s*(?:h|hrs|horas)\b()()/i.exec(after) ??
    /^[^\d]{0,14}?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(after);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = (m[3] ?? '').toLowerCase().replace(/\./g, '');
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * Fechas escritas en un texto («sábado 4 de octubre a las 21:00», «04/10/2026
 * 21:00», «4 oct 2026 · 21:00», «Oct 4, 2026 9:00 PM»). Sin año, el más
 * cercano a `refMs` (hacia delante).
 */
export function findDates(raw: string, refMs: number, timeZone: string): TextDate[] {
  const text = plainKeepLength(raw);
  const ref = localIn(refMs, timeZone);
  const refYear = Number(ref.slice(0, 4));
  const out: TextDate[] = [];
  const push = (index: number, end: number, d: number, mo: number, y: number | null) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
    let year = y ?? refYear;
    if (year < 100) year += 2000;
    if (y === null) {
      // Sin año: si ya ha pasado hace más de mes y medio, es el año que viene.
      const candidate = Date.UTC(year, mo - 1, d);
      const refDay = Date.UTC(refYear, Number(ref.slice(5, 7)) - 1, Number(ref.slice(8, 10)));
      if (candidate < refDay - 45 * 86_400_000) year += 1;
    }
    const probe = new Date(Date.UTC(year, mo - 1, d));
    if (probe.getUTCMonth() !== mo - 1) return;
    if (out.some((o) => index < o.end && end > o.index)) return;
    out.push({ index, end, date: `${year}-${pad(mo)}-${pad(d)}`, time: timeNear(text, end) });
  };
  let m: RegExpExecArray | null;
  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2}))?/g;
  while ((m = isoRe.exec(text))) {
    const before = out.length;
    push(m.index, m.index + m[0].length, Number(m[3]), Number(m[2]), Number(m[1]));
    if (out.length > before && m[4] !== undefined) (out[out.length - 1] as TextDate).time = `${m[4]}:${m[5]}`;
  }
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:º|\\.)?\\s*(?:de\\s+)?(${MONTH_RE})\\b\\.?(?:,?\\s*(?:de\\s+|del\\s+)?(\\d{4}))?`, 'g');
  while ((m = dayMonth.exec(text))) push(m.index, m.index + m[0].length, Number(m[1]), MONTHS[m[2] as string] ?? 0, m[3] ? Number(m[3]) : null);
  const monthDay = new RegExp(`\\b(${MONTH_FIRST_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'g');
  while ((m = monthDay.exec(text))) push(m.index, m.index + m[0].length, Number(m[2]), MONTHS[m[1] as string] ?? 0, m[3] ? Number(m[3]) : null);
  const numeric = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g;
  while ((m = numeric.exec(text))) {
    // «10.00» o «21.30» son horas, no fechas.
    if (!m[3] && m[0].includes('.')) continue;
    push(m.index, m.index + m[0].length, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Datos del evento que publica la web (schema.org)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.replace(/\s+/g, ' ').trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

function types(o: Obj): string[] {
  return list(o['@type']).filter((t): t is string => typeof t === 'string');
}

/** Todos los objetos de los bloques JSON-LD (también dentro de @graph, subEvent…). */
export function jsonLdObjects(blocks: string[]): Obj[] {
  const out: Obj[] = [];
  const seen = new Set<unknown>();
  const visit = (x: unknown, depth: number) => {
    if (depth > 6 || x === null || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      for (const y of x) visit(y, depth + 1);
      return;
    }
    const o = x as Obj;
    out.push(o);
    for (const k of ['@graph', 'subEvent', 'subEvents', 'event', 'events', 'itemListElement', 'item', 'mainEntity']) if (k in o) visit(o[k], depth + 1);
  };
  for (const b of blocks) {
    for (const candidate of [b, b.replace(/[\u0000-\u001f]+/g, ' ')]) {
      try {
        visit(JSON.parse(candidate.trim()), 0);
        break;
      } catch {
        // JSON-LD roto: se prueba sin caracteres de control y, si no, se ignora.
      }
    }
  }
  return out;
}

const isEvent = (o: Obj) => types(o).some((t) => /(Event|Festival)$/i.test(t)) && (o.startDate !== undefined || o.name !== undefined);

function statusOf(o: Obj, offers: Obj[]): ImportedEvent['status'] {
  const s = String(o.eventStatus ?? '');
  if (/cancel/i.test(s)) return 'CANCELLED';
  if (/postpon/i.test(s)) return 'POSTPONED';
  if (/reschedul/i.test(s)) return 'RESCHEDULED';
  if (offers.length > 0 && offers.every((x) => /soldout/i.test(String(x.availability ?? '')))) return 'SOLD_OUT';
  return null;
}

function fromStructured(o: Obj, ctx: ImportContext, pageUrl: string): ImportedEvent {
  const start = isoToLocal(o.startDate, ctx.timeZone);
  const loc = list(o.location).find((x): x is Obj => typeof x === 'object' && x !== null) ?? null;
  const address = loc ? (list(loc.address).find((x): x is Obj => typeof x === 'object' && x !== null) ?? null) : null;
  const venueName = loc ? str(loc.name) : str(o.location);
  const city = address ? str(address.addressLocality) : null;
  const offers = list(o.offers).filter((x): x is Obj => typeof x === 'object' && x !== null);
  const prices = offers.flatMap((x) => [num(x.price), num(x.lowPrice), num(x.highPrice)]).filter((n): n is number => n !== null && n > 0);
  const currency = offers.map((x) => str(x.priceCurrency)).find((c) => c !== null) ?? 'EUR';
  const saleStarts = offers
    .map((x) => isoToLocal(x.validFrom, ctx.timeZone))
    .filter((x): x is { local: string; timeTBA: boolean } => x !== null && !x.timeTBA)
    .map((x) => x.local)
    .sort();
  const url = str(o.url) ?? offers.map((x) => str(x.url)).find((u) => u !== null) ?? pageUrl;
  return {
    name: str(o.name),
    url: httpOnly(url) ?? httpOnly(pageUrl),
    startsAtLocal: start?.local ?? null,
    timeTBA: start?.timeTBA ?? true,
    venueName,
    city,
    venueId: null,
    sales: saleStarts.length > 0 ? [{ name: 'Venta general', startsAtLocal: saleStarts[0] as string }] : [],
    limit: { perCustomer: null, semantics: null, text: null },
    price: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices), currency: currency.toUpperCase() } : null,
    status: statusOf(o, offers),
    from: 'structured',
  };
}

function httpOnly(u: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Texto de la página
// ---------------------------------------------------------------------------

const SALE_RE = /\b(pre ?venta|venta|a la venta|on ?sale|presale|apertura de (?:la )?venta|salen a la venta|disponibles? a partir)\b/;

/** ¿Habla esta línea del límite de compra? («2 entradas por 60 €» no.) */
function isLimitLine(plain: string): boolean {
  if (/(limite|limit|maximo|max\.)/.test(plain)) return true;
  return /hasta/.test(plain) && /(por|per) (persona|cliente|usuario|compra|pedido|socio|cuenta|customer|person|order)/.test(plain);
}

/** Nombre del evento a partir del título de la página («Entradas Morat | Ticketmaster» → «Morat»). */
export function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, ' ').trim();
  // « | Ticketmaster España», « · entradas.com»… (el guion no: va dentro de los nombres, «Real Madrid - Atlético»).
  t = t.split(/\s[|·—]\s/)[0] ?? t;
  t = t.replace(/\s[-–]\s(?:ticketmaster(?:\.es)?(?:\s+espa[ñn]a)?|entradas\.com|eventim(?:\.es)?|web oficial.*|real madrid c\.?\s?f\.?)$/i, '');
  t = t.replace(/^(?:comprar\s+)?entradas?\s+(?:para|de|del)?\s*/i, '').replace(/\s+entradas?$/i, '').replace(/\s*[-–|:]\s*$/, '').trim();
  if (/^(entradas?|tickets?|comprar|inicio|home)$/i.test(t)) return null;
  return t.length >= 3 ? t.slice(0, 120) : null;
}

function saleName(line: string, dateIndex: number): string {
  const head = line.slice(0, dateIndex);
  const colon = head.lastIndexOf(':');
  if (colon > 0) {
    const label = head.slice(0, colon).replace(/\s+/g, ' ').trim();
    if (label.length >= 3 && label.length <= 60) return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const p = plainKeepLength(line);
  if (/pre ?venta|presale/.test(p)) return 'Preventa';
  if (/general|publico/.test(p)) return 'Venta general';
  return 'Venta';
}

function fromText(c: PageCapture, ctx: ImportContext, refMs: number): ImportedEvent {
  const lines = [...(c.selection ? c.selection.split(/\n+|\s{3,}/) : []), ...c.lines].map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Fecha del evento: <time datetime> primero; si no, la primera fecha (con hora, mejor) que no es de la venta.
  let start: { local: string; timeTBA: boolean } | null = null;
  for (const [dt] of c.times) {
    const x = isoToLocal(dt, ctx.timeZone);
    if (x && Date.parse(`${x.local}:00Z`) >= refMs - 12 * 3_600_000) {
      start = x;
      break;
    }
  }
  const sales: ImportedSale[] = [];
  const eventCandidates: TextDate[] = [];
  for (const line of lines) {
    const dates = findDates(line, refMs, ctx.timeZone);
    if (dates.length === 0) continue;
    if (SALE_RE.test(plainKeepLength(line))) {
      const d = dates[0] as TextDate;
      // «Venta hasta el 4 de octubre» es el cierre, no la apertura.
      const before = plainKeepLength(line.slice(0, d.index));
      const closing = /\b(hasta|fin de (la )?venta|finaliza|termina|cierra|cierre|until|ends?)\b/.test(before) && !/\b(desde|a partir|abre|comienza|empieza|from)\b/.test(before);
      if (d.time && !closing) {
        const name = saleName(line, d.index);
        if (!sales.some((s) => s.name === name)) sales.push({ name, startsAtLocal: `${d.date}T${d.time}` });
      }
    } else {
      eventCandidates.push(...dates);
    }
  }
  if (!start) {
    const withTime = eventCandidates.find((d) => d.time !== null);
    const d = withTime ?? eventCandidates[0];
    if (d) start = { local: `${d.date}T${d.time ?? '00:00'}`, timeTBA: d.time === null };
  }
  // Una «venta» después del evento no es la apertura (p. ej. «venta hasta el día del partido»).
  const validSales = start ? sales.filter((s) => s.startsAtLocal < (start as { local: string }).local) : sales;
  return {
    name: cleanTitle(c.meta['og:title'] ?? null) ?? cleanTitle(c.h1) ?? cleanTitle(c.title),
    url: httpOnly(c.meta['og:url'] ?? null) ?? httpOnly(c.canonical) ?? httpOnly(c.url),
    startsAtLocal: start?.local ?? null,
    timeTBA: start?.timeTBA ?? true,
    venueName: null,
    city: null,
    venueId: null,
    sales: validSales,
    limit: { perCustomer: null, semantics: null, text: null },
    price: null,
    status: null,
    from: 'text',
  };
}

// ---------------------------------------------------------------------------

/** Web de venta por el dominio de la página. */
export function providerForHost(host: string, providers: ImportContext['providers']): string | null {
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const p of providers) {
    if (!p.url) continue;
    try {
      const ph = new URL(p.url).hostname.toLowerCase().replace(/^www\./, '');
      if (h === ph || h.endsWith(`.${ph}`)) return p.providerId;
    } catch {
      // URL de proveedor mal escrita en el vault: se ignora
    }
  }
  if (/(^|\.)ticketmaster\./.test(h) && providers.some((p) => p.providerId === 'ticketmaster')) return 'ticketmaster';
  if (/(^|\.)(entradas\.com|eventim\.)/.test(h) && providers.some((p) => p.providerId === 'entradas-com')) return 'entradas-com';
  if (/(^|\.)realmadrid\.com$/.test(h) && providers.some((p) => p.providerId === 'real-madrid')) return 'real-madrid';
  return null;
}

/** Convierte lo que envía el marcador en uno o varios eventos listos para el formulario. */
export function parsePageCapture(c: PageCapture, ctx: ImportContext): PageImport {
  let host = '';
  try {
    host = new URL(c.url).hostname;
  } catch {
    host = '';
  }
  const refMs = Number.isNaN(Date.parse(c.at)) ? Date.now() : Date.parse(c.at);
  const pageUrl = httpOnly(c.canonical) ?? httpOnly(c.url) ?? c.url;
  const structured = jsonLdObjects(c.ld).filter(isEvent).map((o) => fromStructured(o, ctx, pageUrl));
  // Sin fecha ni nombre no sirve; fechas repetidas (mismo evento en varios bloques), una vez.
  const seen = new Set<string>();
  let events = structured.filter((e) => {
    if (!e.name && !e.startsAtLocal) return false;
    const key = `${e.name ?? ''}|${e.startsAtLocal ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const text = fromText(c, ctx, refMs);
  if (events.length === 0) events = [text];
  else {
    // Lo del texto completa lo que no trae la web (fases de venta, hora de apertura…).
    events = events.map((e) => ({
      ...e,
      sales: e.sales.length > 0 ? mergeSales(e.sales, text.sales) : text.sales.filter((s) => !e.startsAtLocal || s.startsAtLocal < e.startsAtLocal),
    }));
    // La que es de esta página, primero; el resto por fecha.
    events.sort((a, b) => Number(b.url === pageUrl) - Number(a.url === pageUrl) || (a.startsAtLocal ?? '9').localeCompare(b.startsAtLocal ?? '9'));
  }

  // Límite de compra: la primera línea que lo diga.
  let limit: ImportedEvent['limit'] = { perCustomer: null, semantics: null, text: null };
  for (const line of [...(c.selection ? [c.selection] : []), ...c.lines, c.meta.description ?? '']) {
    if (!isLimitLine(plainKeepLength(line))) continue;
    const p = parseTicketLimit(line);
    if (p.perCustomer !== null) {
      limit = { perCustomer: p.perCustomer, semantics: p.semantics, text: p.excerpt };
      break;
    }
  }

  // Recinto: el que dice la web, reconocido en el vault; si no, el que se nombra en la página.
  const everything = [c.selection ?? '', c.h1 ?? '', c.title, ...c.lines].join('\n');
  const mentioned = venueMentioned(ctx.venues, everything);
  events = events.map((e) => {
    let venueId = e.venueName ? bestVenueMatch(ctx.venues, e.venueName, e.city) : null;
    if (!venueId && !e.venueName) venueId = mentioned;
    return { ...e, venueId, limit: e.limit.perCustomer !== null ? e.limit : limit };
  });

  return { providerId: providerForHost(host, ctx.providers), host, pageUrl, events: events.slice(0, 30) };
}

function mergeSales(a: ImportedSale[], b: ImportedSale[]): ImportedSale[] {
  const out = [...a];
  for (const s of b) if (!out.some((x) => x.startsAtLocal === s.startsAtLocal || x.name === s.name)) out.push(s);
  return out.sort((x, y) => x.startsAtLocal.localeCompare(y.startsAtLocal));
}

/** Lo que va detrás de «#importar=» en la dirección de la sala. */
export function decodeCapture(fragment: string): PageCapture | null {
  try {
    const raw = fragment.replace(/^#?importar=/, '');
    const c = JSON.parse(decodeURIComponent(raw)) as Partial<PageCapture>;
    if (c.v !== 1 || typeof c.url !== 'string') return null;
    const texts = (v: unknown, max: number) => list(v).filter((x): x is string => typeof x === 'string').slice(0, max);
    return {
      v: 1,
      url: c.url.slice(0, 2000),
      canonical: typeof c.canonical === 'string' ? c.canonical.slice(0, 2000) : null,
      title: typeof c.title === 'string' ? c.title.slice(0, 400) : '',
      h1: typeof c.h1 === 'string' ? c.h1.slice(0, 400) : null,
      meta: Object.fromEntries(
        Object.entries(typeof c.meta === 'object' && c.meta !== null ? c.meta : {})
          .filter(([, v]) => typeof v === 'string')
          .slice(0, 40)
          .map(([k, v]) => [k, (v as string).slice(0, 400)]),
      ),
      ld: texts(c.ld, 12).map((x) => x.slice(0, 60_000)),
      times: list(c.times)
        .filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string')
        .slice(0, 40)
        .map((x) => [x[0].slice(0, 60), String(x[1] ?? '').slice(0, 120)]),
      lines: texts(c.lines, 200).map((x) => x.slice(0, 400)),
      selection: typeof c.selection === 'string' ? c.selection.slice(0, 4000) : null,
      at: typeof c.at === 'string' ? c.at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
