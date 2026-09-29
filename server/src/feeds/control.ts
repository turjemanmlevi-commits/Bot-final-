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

import { FEED_LABEL, type FeedEvent, type FeedEventsResult, type FeedId, type FeedKeyResult, type FeedSearchBy, type FeedsStatus, type FeedStatus } from '@to/shared';
import type { Runtime } from '../runtime/runtime';
import { updateEnvFile } from '../util/envfile';
import { log } from '../util/log';
import { iso } from '../util/time';
import { FeedError, localDateTime, TtlCache } from './common';
import { COMPETITIONS, FootballClient, playedAt, type FootballMatch } from './football';
import { matchTmVenues, TicketmasterClient, type TmVenue } from './ticketmaster';

const DAY = 86_400_000;
/** Para «ventas que abren pronto» se miran los eventos del próximo año y pico. */
const SALE_HORIZON = 400 * DAY;

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
  venueId: string | null;
  days: number;
  by: FeedSearchBy;
  q: string | null;
}

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
          ? 'Listo: Ticketmaster conectado. En Eventos → Nuevo evento, elige un recinto y «Ticketmaster»: salen sus próximos eventos.'
          : 'Listo: partidos conectados. En Eventos → Nuevo evento, elige un estadio de LaLiga: salen sus próximos partidos.';
      return this.result(true, warning ? `${text} ${warning}` : text);
    });
  }

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------

  /** Próximos eventos de un recinto (o por nombre) en la fuente elegida. */
  upcoming(q: UpcomingQuery): Promise<FeedEventsResult> {
    const days = Math.min(400, Math.max(1, Math.round(q.days)));
    const query = { ...q, days, q: q.q?.trim() || null };
    const key = JSON.stringify(query);
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

  private async tmUpcoming(q: UpcomingQuery): Promise<FeedEventsResult> {
    const tm = this.need(this.tm, 'ticketmaster');
    const now = this.opts.runtime.ctx.now();
    const to = now + q.days * DAY;
    const venue = q.venueId ? this.venue(q.venueId) : null;
    const base = { feed: 'ticketmaster' as const, from: iso(now), to: iso(to), by: q.by };
    const matched = venue ? await this.track('ticketmaster', () => this.venueCache.get(venue.venueId, () => matchTmVenues(tm, venue))) : [];
    const matchedOut = matched.map((v) => ({ id: v.id, name: v.name, city: v.city }));
    const until = q.by === 'sale' ? now + SALE_HORIZON : to;

    if (q.q) {
      const { events } = await this.track('ticketmaster', () => tm.events({ keyword: q.q ?? '', from: now, to: until, size: 100 }));
      const ids = new Set(matched.map((v) => v.id));
      const list = (q.by === 'sale' ? bySale(events, now, to) : events).map((e) => ({ ...e, atVenue: e.venue?.id ? ids.has(e.venue.id) : false }));
      const where = q.by === 'sale' ? `con venta que abra en los próximos ${q.days} días` : `en los próximos ${q.days} días`;
      return {
        ...base,
        matched: matchedOut,
        events: list,
        message: list.length === 0 ? `Ticketmaster no tiene eventos de «${q.q}» en España ${where}.` : null,
      };
    }
    if (!venue) throw new FeedUsageError('BAD_REQUEST', 'Elige primero el recinto (o escribe el artista o el nombre del evento).');
    if (matched.length === 0) {
      return {
        ...base,
        matched: [],
        events: [],
        message: `No encuentro «${venue.name}» en Ticketmaster. Escribe el artista o el nombre del evento en el buscador.`,
      };
    }
    const all = new Map<string, FeedEvent>();
    for (const v of matched.slice(0, 4)) {
      for (let page = 0; page < (q.by === 'sale' ? 3 : 1); page++) {
        const r = await this.track('ticketmaster', () => tm.events({ venueId: v.id, from: now, to: until, size: q.by === 'sale' ? 200 : 100, page }));
        for (const e of r.events) all.set(e.id, e);
        if (page + 1 >= r.totalPages) break;
      }
    }
    const events = q.by === 'sale' ? bySale([...all.values()], now, to) : [...all.values()].sort(byStart);
    const empty =
      q.by === 'sale'
        ? `Ninguna venta de Ticketmaster abre en ${venue.name} en los próximos ${q.days} días.`
        : `Ticketmaster no tiene eventos en ${venue.name} en los próximos ${q.days} días.`;
    return { ...base, matched: matchedOut, events, message: events.length === 0 ? empty : null };
  }

  private async fdUpcoming(q: UpcomingQuery): Promise<FeedEventsResult> {
    const fd = this.need(this.fd, 'football');
    if (!q.venueId) throw new FeedUsageError('BAD_REQUEST', 'Elige primero el estadio.');
    const venue = this.venue(q.venueId);
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
    const events = matches
      .filter((m) => playedAt(m, venue))
      .map((m) => m.event)
      .filter((e) => e.startsAt !== null && Date.parse(e.startsAt) >= now - 3 * 3_600_000 && Date.parse(e.startsAt) <= to)
      .sort(byStart);
    const who = venue.clubs.length > 0 ? venue.clubs.join(' / ') : venue.name;
    const empty =
      venue.clubs.length === 0
        ? `${venue.name} no tiene club de fútbol en el vault (propiedad «club» de la nota del recinto), así que no puedo saber qué partidos se juegan allí.`
        : `No hay partidos de ${who} en casa (LaLiga o Champions) en los próximos ${q.days} días.`;
    return {
      feed: 'football',
      matched: [{ id: venue.venueId, name: who, city: venue.city }],
      from: iso(now),
      to: iso(to),
      by: 'event',
      events,
      message: events.length === 0 ? [empty, ...notes].join(' ') : notes.length > 0 ? notes.join(' ') : null,
    };
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
