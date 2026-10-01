/**
 * Fuentes oficiales de eventos desde el dashboard: claves (se guardan en .env,
 * sin reiniciar), próximos eventos de un recinto y consulta de un evento.
 *
 * - Ticketmaster: próximos eventos del recinto (o por nombre), con apertura de
 *   la venta, preventas y límite de compra oficiales.
 * - Partidos: próximos partidos de LaLiga y Champions del club del estadio.
 *
 * Las claves solo viven en este ordenador (.env) y nunca salen por la API.
 */

import { bestVenueMatch, FEED_LABEL, type FeedEvent, type FeedEventsResult, type FeedId, type FeedKeyResult, type FeedSearchBy, type FeedsStatus, type FeedStatus } from '@to/shared';
import type { Runtime } from '../runtime/runtime';
import { updateEnvFile } from '../util/envfile';
import { log } from '../util/log';
import { iso } from '../util/time';
import { clubMatches, FeedError, localDateTime, TtlCache } from './common';
import { COMPETITIONS, FootballClient, playedAt, type FootballMatch } from './football';
import { matchTmVenues, TicketmasterClient, type TmVenue } from './ticketmaster';

const DAY = 86_400_000;

export const FEED_ENV: Record<FeedId, string> = { ticketmaster: 'TICKETMASTER_API_KEY', football: 'FOOTBALL_DATA_TOKEN' };

export interface FeedControlOptions {
  runtime: Runtime;
  timeZone: string;
  /** Archivo .env donde se guardan las claves; null = solo en memoria. */
  envFile: string | null;
  envTemplate?: string | null;
  ticketmasterBase?: string;
  footballBase?: string;
  /** Pruebas: sin esperas entre consultas. */
  fast?: boolean;
}

export interface UpcomingQuery {
  feed: FeedId;
  /** Recinto del vault (opcional): sin él, eventos de toda España. */
  venueId: string | null;
  days: number;
  by: FeedSearchBy;
  q: string | null;
  /** Partidos: solo los de este club en casa (p. ej. «Real Madrid»). */
  club?: string | null;
}

/** Como mucho se traen 5 páginas de 200 (la API no da más de 1.000 resultados por búsqueda). */
const MAX_PAGES = 5;

interface VenueInfo {
  venueId: string;
  name: string;
  city: string | null;
  aliases: string[];
  clubs: string[];
}

/** Error de uso (falta la clave, el recinto…): el mensaje se enseña tal cual. */
export class FeedUsageError extends Error {
  constructor(
    readonly code: 'NOT_CONFIGURED' | 'BAD_REQUEST' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

export class FeedControl {
  private tm: TicketmasterClient | null = null;
  private fd: FootballClient | null = null;
  private readonly health: Record<FeedId, { ok: boolean | null; detail: string }> = {
    ticketmaster: { ok: null, detail: '' },
    football: { ok: null, detail: '' },
  };
  private readonly venueCache = new TtlCache<TmVenue[]>(12 * 3_600_000);
  private readonly listCache = new TtlCache<FeedEventsResult>(5 * 60_000);
  private readonly matchCache = new TtlCache<FootballMatch[]>(10 * 60_000);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly opts: FeedControlOptions,
    initial: { ticketmasterKey?: string | null; footballToken?: string | null } = {},
  ) {
    if (initial.ticketmasterKey) this.tm = this.makeTm(initial.ticketmasterKey);
    if (initial.footballToken) this.fd = this.makeFd(initial.footballToken);
    opts.runtime.ctx.feedsStatus = () => this.status();
  }

  // ---------------------------------------------------------------------------
  // Estado y claves
  // ---------------------------------------------------------------------------

  configured(feed: FeedId): boolean {
    return feed === 'ticketmaster' ? this.tm !== null : this.fd !== null;
  }

  status(): FeedsStatus {
    const one = (feed: FeedId): FeedStatus => {
      const h = this.health[feed];
      const configured = this.configured(feed);
      const detail = !configured
        ? feed === 'ticketmaster'
          ? 'Sin clave: pega tu «Consumer Key» gratuita de developer.ticketmaster.com.'
          : 'Sin token: pega el token gratuito de football-data.org.'
        : h.detail || 'Clave puesta (se comprueba en la primera consulta).';
      return { feed, configured, ok: configured ? h.ok : null, detail };
    };
    return { ticketmaster: one('ticketmaster'), football: one('football'), configurable: this.opts.envFile !== null };
  }

  /** Comprueba la clave con la fuente, la guarda en .env y la usa al momento. null = quitarla. */
  setKey(feed: FeedId, key: string | null, actor: string): Promise<FeedKeyResult> {
    return this.serial(async () => {
      const label = FEED_LABEL[feed];
      if (key === null) {
        const warning = await this.persist({ [FEED_ENV[feed]]: null });
        if (feed === 'ticketmaster') this.tm = null;
        else this.fd = null;
        this.health[feed] = { ok: null, detail: '' };
        this.clearCaches();
        this.opts.runtime.ctx.journal.audit('feeds.key_removed', { feed }, { actor });
        this.publish();
        return this.result(true, `Clave de ${label} quitada.${warning ? ` ${warning}` : ''}`);
      }
      const client = feed === 'ticketmaster' ? this.makeTm(key) : this.makeFd(key);
      try {
        await client.probe();
      } catch (err) {
        return this.result(false, err instanceof FeedError ? err.message : `No se pudo comprobar la clave: ${(err as Error).message}`);
      }
      const warning = await this.persist({ [FEED_ENV[feed]]: key });
      if (client instanceof TicketmasterClient) this.tm = client;
      else this.fd = client;
      this.clearCaches();
      this.health[feed] = { ok: true, detail: `Conectado (comprobado a las ${this.clock()}).` };
      this.opts.runtime.ctx.journal.audit('feeds.configured', { feed }, { actor });
      log.info(`Fuente de eventos configurada desde el dashboard: ${label}`);
      this.publish();
      const text =
        feed === 'ticketmaster'
          ? 'Listo: Ticketmaster conectado. En Eventos → Nuevo evento, elige «Ticketmaster» en «Dónde se vende»: sale la lista de sus próximos eventos en toda España.'
          : 'Listo: partidos conectados. En Eventos → Nuevo evento, elige «Real Madrid» (u «Otra web oficial» para los demás clubes) en «Dónde se vende»: salen los próximos partidos.';
      return this.result(true, warning ? `${text} ${warning}` : text);
    });
  }

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------

  /** Próximos eventos en la fuente elegida: de un recinto, por nombre o de toda España. */
  upcoming(q: UpcomingQuery): Promise<FeedEventsResult> {
    const days = Math.min(400, Math.max(1, Math.round(q.days)));
    const query: UpcomingQuery = { ...q, days, q: q.q?.trim() || null, club: q.club?.trim() || null };
    // El recinto de cada evento depende del vault: si cambia el vault, la caché ya no vale.
    const key = JSON.stringify([query, this.opts.runtime.store.vaultReport?.at ?? '']);
    return this.listCache.get(key, () => (query.feed === 'ticketmaster' ? this.tmUpcoming(query) : this.fdUpcoming(query)));
  }

  /** Un evento concreto, tal y como está ahora en la fuente (null si ya no está). */
  async lookup(feed: FeedId, id: string): Promise<FeedEvent | null> {
    if (feed === 'ticketmaster') {
      const tm = this.need(this.tm, feed);
      return this.track(feed, () => tm.event(id));
    }
    const fd = this.need(this.fd, feed);
    return this.track(feed, async () => (await fd.match(id))?.event ?? null);
  }

  /**
   * Ticketmaster: los eventos de un recinto o, sin recinto, los de toda España
   * (por fecha del evento o por hora de apertura de la venta). Cada evento
   * lleva el recinto del vault que le corresponde (si está).
   */
  private async tmUpcoming(q: UpcomingQuery): Promise<FeedEventsResult> {
    const tm = this.need(this.tm, 'ticketmaster');
    const now = this.opts.runtime.ctx.now();
    const to = now + q.days * DAY;
    const venue = q.venueId ? this.venue(q.venueId) : null;
    const base = { feed: 'ticketmaster' as const, from: iso(now), to: iso(to), by: q.by };
    const matched = venue ? await this.track('ticketmaster', () => this.venueCache.get(venue.venueId, () => matchTmVenues(tm, venue))) : [];
    const matchedOut = matched.map((v) => ({ id: v.id, name: v.name, city: v.city }));

    type Params = Omit<Parameters<TicketmasterClient['events']>[0], 'page' | 'size'>;
    // Por apertura de la venta, la API los da ordenados por esa hora: se para al pasar la ventana.
    const saleAfterWindow = (page: FeedEvent[]) => {
      const start = page.at(-1)?.sales.find((s) => s.kind === 'PUBLIC')?.startsAt;
      return start ? Date.parse(start) > to : false;
    };
    const collect = async (params: Params): Promise<{ events: FeedEvent[]; truncated: boolean }> => {
      const out: FeedEvent[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await this.track('ticketmaster', () => tm.events({ ...params, size: 200, page }));
        out.push(...r.events);
        if (page + 1 >= r.totalPages || (params.onsaleFrom !== undefined && saleAfterWindow(r.events))) return { events: out, truncated: false };
      }
      return { events: out, truncated: true };
    };
    const window = (extra: Params): Params => (q.by === 'sale' ? { ...extra, onsaleFrom: now } : { ...extra, from: now, to });

    if (venue && !q.q && matched.length === 0) {
      return {
        ...base,
        matched: [],
        events: [],
        message: `No encuentro «${venue.name}» en Ticketmaster. Escribe el artista o el nombre del evento en el buscador.`,
        truncated: false,
      };
    }
    const all = new Map<string, FeedEvent>();
    let truncated = false;
    const sources: Params[] = venue && !q.q ? matched.slice(0, 4).map((v) => window({ venueId: v.id })) : [window(q.q ? { keyword: q.q } : {})];
    for (const params of sources) {
      const r = await collect(params);
      for (const e of r.events) all.set(e.id, e);
      truncated ||= r.truncated;
    }
    const ids = new Set(matched.map((v) => v.id));
    const listed = (q.by === 'sale' ? bySale([...all.values()], now, to) : [...all.values()].filter((e) => inWindow(e, now, to)).sort(byStart)).map((e) => ({
      ...e,
      vaultVenueId: venue && e.venue?.id && ids.has(e.venue.id) ? venue.venueId : this.vaultVenueForTm(e),
      ...(venue && q.q ? { atVenue: e.venue?.id ? ids.has(e.venue.id) : false } : {}),
    }));
    const when = q.by === 'sale' ? `con venta que abra en los próximos ${q.days} días` : `en los próximos ${q.days} días`;
    const empty = q.q
      ? `Ticketmaster no tiene eventos de «${q.q}» en España ${when}.`
      : venue
        ? q.by === 'sale'
          ? `Ninguna venta de Ticketmaster abre en ${venue.name} en los próximos ${q.days} días.`
          : `Ticketmaster no tiene eventos en ${venue.name} en los próximos ${q.days} días.`
        : `Ticketmaster no tiene eventos en España ${when}.`;
    return {
      ...base,
      matched: matchedOut,
      events: listed,
      message: listed.length === 0 ? empty : truncated ? 'Hay más eventos de los que caben en una lista: escribe el artista, el evento o la ciudad para afinar.' : null,
      truncated,
    };
  }

  /**
   * Partidos: los de un estadio o, sin estadio, todos los partidos en casa de
   * los clubes de LaLiga (Champions incluida), con su estadio del vault.
   * Con `club`, solo los de ese club (p. ej. «Real Madrid»).
   */
  private async fdUpcoming(q: UpcomingQuery): Promise<FeedEventsResult> {
    const fd = this.need(this.fd, 'football');
    const venue = q.venueId ? this.venue(q.venueId) : null;
    const now = this.opts.runtime.ctx.now();
    const to = now + q.days * DAY;
    // La API cuenta los días en UTC: se pide uno de margen por cada lado y luego se filtra por hora.
    const dateFrom = localDateTime(now - DAY, 'UTC').slice(0, 10);
    const dateTo = localDateTime(to + DAY, 'UTC').slice(0, 10);
    const matches: FootballMatch[] = [];
    const notes: string[] = [];
    for (const c of COMPETITIONS) {
      try {
        matches.push(...(await this.track('football', () => this.matchCache.get(`${c.code}|${dateFrom}|${dateTo}`, () => fd.matches(c.code, dateFrom, dateTo)))));
      } catch (err) {
        if (err instanceof FeedError && err.kind === 'PLAN') notes.push(`${c.label}: no está en tu cuenta de football-data.org.`);
        else throw err;
      }
    }
    const venues = this.vaultVenues();
    const events = matches
      .map((m) => ({ m, venueId: venue ? (playedAt(m, venue) ? venue.venueId : null) : this.vaultVenueForMatch(m, venues) }))
      // Sin estadio: LaLiga entera (se juega en España) y, de la Champions, los partidos en casa de clubes españoles.
      .filter((x) => (venue ? x.venueId !== null : x.m.competition === 'PD' || x.venueId !== null))
      .filter((x) => !q.club || clubMatches([q.club], x.m.homeNames))
      .map((x) => ({ ...x.m.event, vaultVenueId: x.venueId }))
      .filter((e) => e.startsAt !== null && Date.parse(e.startsAt) >= now - 3 * 3_600_000 && Date.parse(e.startsAt) <= to)
      .sort(byStart);
    let empty: string;
    let matched: FeedEventsResult['matched'] = [];
    if (venue) {
      const who = venue.clubs.length > 0 ? venue.clubs.join(' / ') : venue.name;
      matched = [{ id: venue.venueId, name: who, city: venue.city }];
      empty =
        venue.clubs.length === 0
          ? `${venue.name} no tiene club de fútbol en el vault (propiedad «club» de la nota del recinto), así que no puedo saber qué partidos se juegan allí.`
          : `No hay partidos de ${who} en casa (LaLiga o Champions) en los próximos ${q.days} días.`;
    } else {
      if (q.club) matched = [{ id: 'club', name: q.club, city: null }];
      empty = q.club ? `No hay partidos de ${q.club} en casa (LaLiga o Champions) en los próximos ${q.days} días.` : `No hay partidos en España en los próximos ${q.days} días.`;
    }
    return {
      feed: 'football',
      matched,
      from: iso(now),
      to: iso(to),
      by: 'event',
      events,
      message: events.length === 0 ? [empty, ...notes].join(' ') : notes.length > 0 ? notes.join(' ') : null,
      truncated: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Recinto del vault de cada evento
  // ---------------------------------------------------------------------------

  private readonly tmVenueMemo = new Map<string, string | null>();

  private vaultVenues(): VenueInfo[] {
    return (this.opts.runtime.store.vaultReport?.venues ?? []).map((v) => ({
      venueId: v.venueId,
      name: v.name,
      city: v.city ?? null,
      aliases: v.aliases ?? [],
      clubs: v.clubs ?? [],
    }));
  }

  /** ¿Qué recinto del vault es el de este evento de Ticketmaster? (por nombre y ciudad) */
  private vaultVenueForTm(e: FeedEvent): string | null {
    const v = e.venue;
    const report = this.opts.runtime.store.vaultReport;
    if (!v || !report) return null;
    const key = `${report.at}|${v.id ?? ''}|${v.name}|${v.city ?? ''}`;
    const memo = this.tmVenueMemo.get(key);
    if (memo !== undefined) return memo;
    const found = bestVaultVenue(this.vaultVenues(), v.name, v.city);
    if (this.tmVenueMemo.size > 3000) this.tmVenueMemo.clear();
    this.tmVenueMemo.set(key, found);
    return found;
  }

  /** Estadio del vault de un partido: el del club local o, si no, por el nombre del estadio. */
  private vaultVenueForMatch(m: FootballMatch, venues: VenueInfo[]): string | null {
    const byClub = venues.find((v) => v.clubs.length > 0 && clubMatches(v.clubs, m.homeNames));
    if (byClub) return byClub.venueId;
    return m.venueName ? bestVaultVenue(venues, m.venueName, null) : null;
  }

  // ---------------------------------------------------------------------------

  private venue(venueId: string): VenueInfo {
    const v = this.opts.runtime.store.vaultReport?.venues.find((x) => x.venueId === venueId);
    if (!v) throw new FeedUsageError('NOT_FOUND', `El recinto ${venueId} no está en el vault.`);
    return { venueId: v.venueId, name: v.name, city: v.city ?? null, aliases: v.aliases ?? [], clubs: v.clubs ?? [] };
  }

  private need<T>(client: T | null, feed: FeedId): T {
    if (!client) {
      throw new FeedUsageError(
        'NOT_CONFIGURED',
        feed === 'ticketmaster'
          ? 'Falta la clave de Ticketmaster: ponla en Ajustes · Fuentes de eventos (es gratis y tarda 5 minutos).'
          : 'Falta el token de football-data.org: ponlo en Ajustes · Fuentes de eventos (es gratis).',
      );
    }
    return client;
  }

  /** Anota si la fuente responde (para el estado de Ajustes). */
  private async track<T>(feed: FeedId, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      const before = this.health[feed].ok;
      this.health[feed] = { ok: true, detail: `Funciona (última consulta a las ${this.clock()}).` };
      if (before !== true) this.publish();
      return out;
    } catch (err) {
      if (err instanceof FeedError && (err.kind === 'AUTH' || err.kind === 'NETWORK')) {
        const changed = this.health[feed].detail !== err.message;
        this.health[feed] = { ok: false, detail: err.message };
        if (changed) this.publish();
      }
      throw err;
    }
  }

  private clock(): string {
    return new Intl.DateTimeFormat('es-ES', { timeZone: this.opts.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(this.opts.runtime.ctx.now()));
  }

  private makeTm(key: string): TicketmasterClient {
    return new TicketmasterClient({ apiKey: key, apiBase: this.opts.ticketmasterBase, timeZone: this.opts.timeZone, gapMs: this.opts.fast ? 0 : 250 });
  }

  private makeFd(token: string): FootballClient {
    return new FootballClient({ token, apiBase: this.opts.footballBase, timeZone: this.opts.timeZone, perMinute: this.opts.fast ? 1000 : 9 });
  }

  private clearCaches(): void {
    this.venueCache.clear();
    this.listCache.clear();
    this.matchCache.clear();
  }

  private publish(): void {
    const { ctx } = this.opts.runtime;
    ctx.hub.publish({ type: 'system', data: ctx.ops.systemStatus() });
  }

  private result(ok: boolean, message: string): FeedKeyResult {
    return { ok, message, status: this.status() };
  }

  private async persist(changes: Record<string, string | null>): Promise<string | null> {
    if (!this.opts.envFile) return null;
    try {
      await updateEnvFile(this.opts.envFile, changes, this.opts.envTemplate ?? null);
      return null;
    } catch (err) {
      const message = (err as Error).message;
      log.warn('No se pudo guardar la clave de la fuente de eventos en .env', { error: message });
      return `Aviso: no se pudo guardar en el archivo .env (${message}); funciona ahora, pero al reiniciar habrá que ponerla otra vez.`;
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

const byStart = (a: FeedEvent, b: FeedEvent) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9') || a.name.localeCompare(b.name);

/** ¿Empieza el evento dentro de la ventana? (los que no tienen fecha, no) */
const inWindow = (e: FeedEvent, from: number, to: number) => e.startsAt !== null && Date.parse(e.startsAt) >= from - 3 * 3_600_000 && Date.parse(e.startsAt) <= to;

/** El recinto del vault que mejor encaja con un nombre (y ciudad) de fuera, o null. */
export const bestVaultVenue = bestVenueMatch;

/** Próxima fase de venta que abre entre `from` y `to` (o null). */
export function nextSaleIn(e: FeedEvent, from: number, to: number): number | null {
  let best: number | null = null;
  for (const s of e.sales) {
    if (!s.startsAt) continue;
    const t = Date.parse(s.startsAt);
    if (t >= from && t <= to && (best === null || t < best)) best = t;
  }
  return best;
}

/** Eventos con alguna venta (general o preventa) que abre en la ventana, por hora de apertura. */
function bySale(events: FeedEvent[], from: number, to: number): FeedEvent[] {
  return events
    .map((e) => ({ e, t: nextSaleIn(e, from, to) }))
    .filter((x): x is { e: FeedEvent; t: number } => x.t !== null)
    .sort((a, b) => a.t - b.t || byStart(a.e, b.e))
    .map((x) => x.e);
}
