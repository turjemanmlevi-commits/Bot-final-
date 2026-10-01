/**
 * Ticketmaster Discovery API (oficial, gratuita, solo lectura):
 * https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *
 * Lista los próximos eventos de un recinto con su fecha y hora, la apertura de
 * la venta general y de las preventas, y el límite de compra que publica
 * Ticketmaster. No entra en ticketmaster.es ni compra nada.
 *
 * La API pide la clave en la dirección de la consulta: por eso nunca se
 * escriben direcciones en los logs y los errores se redactan sin ella.
 */

import { parseTicketLimit, type FeedEvent, type FeedEventStatus, type FeedSale } from '@to/shared';
import { iso, parseVaultDate } from '../util/time';
import { apiDateTime, cleanText, FeedError, httpUrl, localDateTime, nameTokens, networkError, sameCity, Throttle, validMs, venueNameScore } from './common';

// ---------------------------------------------------------------------------
// Forma de las respuestas (solo lo que se usa)
// ---------------------------------------------------------------------------

interface TmRawVenue {
  id?: string;
  name?: string;
  aliases?: string[];
  city?: { name?: string };
  timezone?: string;
}

interface TmRawEvent {
  id?: string;
  name?: string;
  url?: string;
  info?: string;
  pleaseNote?: string;
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
      dateTBD?: boolean;
      dateTBA?: boolean;
      timeTBA?: boolean;
      noSpecificTime?: boolean;
    };
    timezone?: string;
    status?: { code?: string };
  };
  sales?: {
    public?: { startDateTime?: string; endDateTime?: string; startTBD?: boolean; startTBA?: boolean };
    presales?: Array<{ name?: string; startDateTime?: string; endDateTime?: string }>;
  };
  ticketLimit?: { info?: string; infos?: Record<string, string> };
  priceRanges?: Array<{ type?: string; currency?: string; min?: number; max?: number }>;
  seatmap?: { staticUrl?: string };
  classifications?: Array<{ primary?: boolean; segment?: { name?: string }; genre?: { name?: string }; type?: { name?: string }; subType?: { name?: string } }>;
  _embedded?: { venues?: TmRawVenue[] };
}

interface TmPage<K extends string, T> {
  _embedded?: Record<K, T[]>;
  page?: { totalPages?: number; totalElements?: number; number?: number };
}

export interface TmVenue {
  id: string;
  name: string;
  city: string | null;
  aliases: string[];
}

// ---------------------------------------------------------------------------
// Límite de compra
// ---------------------------------------------------------------------------

/** El límite de compra se lee igual en el servidor y en el dashboard. */
export { parseTicketLimit, type ParsedLimit } from '@to/shared';

function limitText(raw: TmRawEvent['ticketLimit']): string | null {
  if (!raw) return null;
  const infos = raw.infos ?? {};
  const pick = infos['es-es'] ?? infos.es ?? Object.entries(infos).find(([k]) => k.startsWith('es'))?.[1] ?? raw.info ?? Object.values(infos)[0];
  return cleanText(pick, 400);
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

function tmStatus(code: string | undefined): FeedEventStatus {
  switch ((code ?? '').toLowerCase()) {
    case 'onsale':
      return 'ONSALE';
    case 'offsale':
      return 'OFFSALE';
    case 'canceled':
    case 'cancelled':
      return 'CANCELLED';
    case 'postponed':
      return 'POSTPONED';
    case 'rescheduled':
      return 'RESCHEDULED';
    default:
      return 'UNKNOWN';
  }
}

const SEGMENT: Record<string, string> = {
  music: 'Música',
  sports: 'Deportes',
  'arts & theatre': 'Teatro y espectáculos',
  film: 'Cine',
  miscellaneous: 'Otros',
};

function category(raw: TmRawEvent): string | null {
  const c = raw.classifications?.find((x) => x.primary) ?? raw.classifications?.[0];
  if (!c) return null;
  const seg = c.segment?.name ? (SEGMENT[c.segment.name.toLowerCase()] ?? c.segment.name) : null;
  const genre = c.genre?.name && !/^(undefined|other)$/i.test(c.genre.name) ? c.genre.name : null;
  const out = [seg, genre].filter((x) => x && !/^undefined$/i.test(x));
  return out.length > 0 ? out.join(' · ') : null;
}

function sale(kind: FeedSale['kind'], name: string, start: string | undefined, end: string | undefined, timeZone: string): FeedSale {
  const s = validMs(start);
  const e = validMs(end);
  return { kind, name, startsAt: s === null ? null : iso(s), startsAtLocal: s === null ? null : localDateTime(s, timeZone), endsAt: e === null ? null : iso(e) };
}

/** Aparcamientos y extras que Ticketmaster publica como «eventos» aparte: no son entradas. */
export function isUpsell(raw: TmRawEvent): boolean {
  if (/\b(parking|aparcamiento|estacionamiento)\b/i.test(raw.name ?? '')) return true;
  return (raw.classifications ?? []).some((c) => /^(upsell|parking)$/i.test(c.type?.name ?? '') || /^(upsell|parking)$/i.test(c.subType?.name ?? ''));
}

/** Evento de la Discovery API → formato común (fechas en la zona del vault). */
export function normalizeTmEvent(raw: TmRawEvent, timeZone: string): FeedEvent | null {
  if (!raw.id || !raw.name) return null;
  const start = raw.dates?.start ?? {};
  const eventTz = raw.dates?.timezone ?? raw._embedded?.venues?.[0]?.timezone ?? timeZone;
  let startMs = validMs(start.dateTime);
  if (startMs === null && start.localDate && /^\d{4}-\d{2}-\d{2}$/.test(start.localDate)) {
    const hhmm = start.localTime && /^\d{2}:\d{2}/.test(start.localTime) ? start.localTime.slice(0, 5) : '00:00';
    startMs = parseVaultDate(`${start.localDate}T${hhmm}`, eventTz);
  }
  const timeTBA = Boolean(start.timeTBA || start.noSpecificTime || start.dateTBA || start.dateTBD || (!start.dateTime && !start.localTime));
  const venueLocalTime = startMs !== null && eventTz !== timeZone ? localDateTime(startMs, eventTz).slice(11) : null;

  const pub = raw.sales?.public;
  const sales: FeedSale[] = [];
  if (pub && (validMs(pub.startDateTime) !== null || validMs(pub.endDateTime) !== null)) {
    sales.push(sale('PUBLIC', 'Venta general', pub.startDateTime, pub.endDateTime, timeZone));
  }
  const presales = (raw.sales?.presales ?? [])
    .map((p) => sale('PRESALE', cleanText(p.name, 120) ?? 'Preventa', p.startDateTime, p.endDateTime, timeZone))
    .sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9'));
  sales.push(...presales);
  const saleTBD = Boolean(pub?.startTBD || pub?.startTBA) || validMs(pub?.startDateTime) === null;

  const official = limitText(raw.ticketLimit);
  const notes = [cleanText(raw.pleaseNote, 800), cleanText(raw.info, 800)].filter((x): x is string => x !== null).join(' ');
  let limit: FeedEvent['limit'] = { text: official, perCustomer: null, semantics: null };
  const fromOfficial = parseTicketLimit(official);
  if (fromOfficial.perCustomer !== null) {
    limit = { text: official, perCustomer: fromOfficial.perCustomer, semantics: fromOfficial.semantics };
  } else if (!official) {
    const fromNotes = parseTicketLimit(notes, { strict: true });
    if (fromNotes.perCustomer !== null) limit = { text: fromNotes.excerpt, perCustomer: fromNotes.perCustomer, semantics: fromNotes.semantics };
  }

  const pr = raw.priceRanges?.find((p) => p.type === 'standard') ?? raw.priceRanges?.[0];
  const venue = raw._embedded?.venues?.[0];
  return {
    feed: 'ticketmaster',
    id: raw.id,
    name: cleanText(raw.name, 200) ?? raw.id,
    url: httpUrl(raw.url),
    startsAt: startMs === null ? null : iso(startMs),
    startsAtLocal: startMs === null ? null : localDateTime(startMs, timeZone),
    timeTBA,
    venueLocalTime,
    status: tmStatus(raw.dates?.status?.code),
    sales,
    saleTBD,
    limit,
    price:
      pr && (typeof pr.min === 'number' || typeof pr.max === 'number')
        ? { min: typeof pr.min === 'number' ? pr.min : null, max: typeof pr.max === 'number' ? pr.max : null, currency: (pr.currency ?? 'EUR').toUpperCase() }
        : null,
    venue: venue?.name ? { id: venue.id ?? null, name: venue.name, city: venue.city?.name ?? null } : null,
    category: category(raw),
    seatmapUrl: httpUrl(raw.seatmap?.staticUrl),
    info: notes === '' ? null : cleanText(notes, 600),
    vaultVenueId: null,
    home: null,
  };
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

export interface TicketmasterOptions {
  apiKey: string;
  /** Solo para pruebas: servidor que imita la API. */
  apiBase?: string;
  timeZone: string;
  /** Espera mínima entre consultas (la API admite 5 por segundo). */
  gapMs?: number;
  timeoutMs?: number;
}

function errorDetail(text: string): string {
  try {
    const j = JSON.parse(text) as { fault?: { faultstring?: string }; errors?: Array<{ detail?: string }> };
    const d = j.fault?.faultstring ?? j.errors?.[0]?.detail;
    return d ? `: ${d.slice(0, 200)}` : '';
  } catch {
    return '';
  }
}

export class TicketmasterClient {
  private readonly base: string;
  private readonly throttle: Throttle;

  constructor(private readonly opts: TicketmasterOptions) {
    this.base = (opts.apiBase ?? 'https://app.ticketmaster.com').replace(/\/+$/, '');
    this.throttle = new Throttle(opts.gapMs ?? 250);
  }

  private redact(message: string): string {
    return message.split(this.opts.apiKey).join('<clave>');
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(`${this.base}/discovery/v2/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // Sin «locale=*» la API solo devuelve los eventos en inglés de EE. UU.
    url.searchParams.set('locale', '*');
    url.searchParams.set('apikey', this.opts.apiKey);
    await this.throttle.wait();
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000) });
    } catch (err) {
      throw new FeedError(
        'NETWORK',
        this.redact(`No se pudo conectar con Ticketmaster (${networkError(err)}). Comprueba la conexión a internet o si un antivirus o cortafuegos bloquea app.ticketmaster.com.`),
      );
    }
    const text = await res.text().catch(() => '');
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw new FeedError('AUTH', 'Ticketmaster no acepta la clave: copia otra vez la «Consumer Key» de tu app en developer.ticketmaster.com (My Apps).');
    }
    if (res.status === 429) {
      throw new FeedError('RATE', 'Ticketmaster: demasiadas consultas seguidas (la clave gratuita admite 5 por segundo y 5.000 al día). Espera un momento y vuelve a intentarlo.');
    }
    if (!res.ok) throw new FeedError('BAD', this.redact(`Ticketmaster respondió ${res.status}${errorDetail(text)}`));
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new FeedError('BAD', 'Ticketmaster ha respondido algo que no se entiende (no es JSON).');
    }
  }

  /** Comprueba la clave con una consulta mínima. */
  async probe(): Promise<void> {
    await this.get('events.json', { countryCode: 'ES', size: '1' });
  }

  async venues(keyword: string): Promise<TmVenue[]> {
    const json = await this.get<TmPage<'venues', TmRawVenue>>('venues.json', { keyword, countryCode: 'ES', size: '20' });
    return (json?._embedded?.venues ?? [])
      .filter((v): v is TmRawVenue & { id: string; name: string } => Boolean(v.id && v.name))
      .map((v) => ({ id: v.id, name: v.name, city: v.city?.name ?? null, aliases: (v.aliases ?? []).filter((a) => typeof a === 'string') }));
  }

  /**
   * Eventos en España: los que empiezan entre `from` y `to` (por fecha) o, con
   * `onsaleFrom`, los que abren la venta general desde ese momento (por hora de apertura).
   */
  async events(q: {
    venueId?: string;
    keyword?: string;
    from?: number;
    to?: number;
    onsaleFrom?: number;
    size?: number;
    page?: number;
  }): Promise<{ events: FeedEvent[]; totalPages: number }> {
    const params: Record<string, string> = {
      countryCode: 'ES',
      sort: q.onsaleFrom !== undefined ? 'onSaleStartDate,asc' : 'date,asc',
      size: String(q.size ?? 100),
      page: String(q.page ?? 0),
    };
    if (q.from !== undefined) params.startDateTime = apiDateTime(q.from);
    if (q.to !== undefined) params.endDateTime = apiDateTime(q.to);
    if (q.onsaleFrom !== undefined) params.onsaleStartDateTime = apiDateTime(q.onsaleFrom);
    if (q.venueId) params.venueId = q.venueId;
    if (q.keyword) params.keyword = q.keyword;
    const json = await this.get<TmPage<'events', TmRawEvent>>('events.json', params);
    const events = (json?._embedded?.events ?? [])
      .filter((e) => !isUpsell(e))
      .map((e) => normalizeTmEvent(e, this.opts.timeZone))
      .filter((e): e is FeedEvent => e !== null);
    return { events, totalPages: json?.page?.totalPages ?? 1 };
  }

  /** Un evento por su identificador (null si Ticketmaster ya no lo tiene). */
  async event(id: string): Promise<FeedEvent | null> {
    const json = await this.get<TmRawEvent>(`events/${encodeURIComponent(id)}.json`, {});
    return json ? normalizeTmEvent(json, this.opts.timeZone) : null;
  }
}

// ---------------------------------------------------------------------------
// Recinto del vault → recintos de Ticketmaster
// ---------------------------------------------------------------------------

export interface VaultVenueRef {
  name: string;
  city: string | null;
  aliases: string[];
}

/**
 * Busca en Ticketmaster los recintos que son el nuestro (por nombre y alias, en
 * la misma ciudad). Un mismo recinto puede estar varias veces (nombres antiguos,
 * pista y grada…): se devuelven todos los que encajan, el mejor primero.
 */
export async function matchTmVenues(client: TicketmasterClient, venue: VaultVenueRef): Promise<TmVenue[]> {
  const ours = [...new Set([venue.name, ...venue.aliases].map((s) => s.trim()).filter(Boolean))];
  const terms = ours.slice(0, 4);
  const found = new Map<string, TmVenue>();
  for (const term of terms) for (const v of await client.venues(term)) found.set(v.id, v);
  const cityTokens = venue.city ? nameTokens(venue.city) : [];
  const scored = [...found.values()]
    .map((v) => {
      let score = venueNameScore(ours, [v.name, ...v.aliases], cityTokens);
      const city = sameCity(venue.city, v.city);
      if (city === false) score -= 0.3;
      if (city === true) score += 0.05;
      return { v, score };
    })
    .filter((x) => x.score >= 0.75)
    .sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name));
  return scored.slice(0, 6).map((x) => x.v);
}
