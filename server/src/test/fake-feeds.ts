/**
 * Servidores locales que imitan la Discovery API de Ticketmaster y la API de
 * football-data.org (para las pruebas: nunca se usa una clave real).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const TM_KEY = 'TESTkey0123456789abcdefABCDEF0123';
export const FD_TOKEN = 'abcdef0123456789abcdef0123456789';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Evento crudo de la Discovery API (forma real, con lo que usa el sistema). */
export interface RawTmEvent {
  id: string;
  name: string;
  url?: string;
  dates: { start: { localDate?: string; localTime?: string; dateTime?: string; timeTBA?: boolean }; timezone?: string; status?: { code: string } };
  sales?: { public?: { startDateTime?: string; endDateTime?: string; startTBD?: boolean }; presales?: Array<{ name: string; startDateTime?: string; endDateTime?: string }> };
  ticketLimit?: { info?: string };
  priceRanges?: Array<{ type: string; currency: string; min: number; max: number }>;
  pleaseNote?: string;
  classifications?: Array<{ primary: boolean; segment: { name: string }; genre: { name: string } }>;
  _embedded?: { venues: Array<{ id: string; name: string; city: { name: string }; timezone?: string }> };
}

export class FakeTicketmaster {
  server: Server;
  venues: Array<{ id: string; name: string; city: { name: string }; aliases?: string[] }> = [];
  events: RawTmEvent[] = [];
  calls: Array<{ path: string; params: Record<string, string> }> = [];

  constructor(readonly key = TM_KEY) {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  listen(): Promise<string> {
    return listen(this.server);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x');
    const params = Object.fromEntries(url.searchParams.entries());
    this.calls.push({ path: url.pathname, params });
    if (params.apikey !== this.key) {
      return json(res, 401, { fault: { faultstring: 'Invalid ApiKey', detail: { errorcode: 'oauth.v2.InvalidApiKey' } } });
    }
    for (const k of ['startDateTime', 'endDateTime']) {
      if (params[k] !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(params[k] as string)) {
        return json(res, 400, { errors: [{ code: 'DIS1015', detail: `Query param with date must be of valid format YYYY-MM-DDTHH:mm:ssZ {example: 2020-08-01T14:00:00Z }`, status: '400' }] });
      }
    }
    // Sin locale=* la API real solo devuelve eventos en inglés de EE. UU.: aquí, nada.
    const localeOk = params.locale === '*';
    if (url.pathname === '/discovery/v2/venues.json') {
      const words = norm(params.keyword ?? '').split(' ').filter(Boolean);
      const found = this.venues.filter((v) => {
        const text = norm([v.name, ...(v.aliases ?? [])].join(' '));
        return words.every((w) => text.includes(w));
      });
      return json(res, 200, found.length > 0 && localeOk ? { _embedded: { venues: found }, page: { totalPages: 1 } } : { page: { totalElements: 0, totalPages: 0 } });
    }
    if (url.pathname === '/discovery/v2/events.json') {
      const from = params.startDateTime ? Date.parse(params.startDateTime) : -Infinity;
      const to = params.endDateTime ? Date.parse(params.endDateTime) : Infinity;
      const list = this.events
        .filter((e) => localeOk)
        .filter((e) => !params.venueId || e._embedded?.venues.some((v) => v.id === params.venueId))
        .filter((e) => !params.keyword || norm(e.name).includes(norm(params.keyword as string)))
        .filter((e) => {
          const t = e.dates.start.dateTime ? Date.parse(e.dates.start.dateTime) : NaN;
          return Number.isNaN(t) ? false : t >= from && t <= to;
        })
        .sort((a, b) => (a.dates.start.dateTime ?? '').localeCompare(b.dates.start.dateTime ?? ''));
      const size = Number(params.size ?? 20);
      const page = Number(params.page ?? 0);
      const slice = list.slice(page * size, page * size + size);
      const totalPages = Math.ceil(list.length / size);
      return json(res, 200, slice.length > 0 ? { _embedded: { events: slice }, page: { size, totalElements: list.length, totalPages, number: page } } : { page: { size, totalElements: 0, totalPages: 0, number: page } });
    }
    const m = /^\/discovery\/v2\/events\/([^/]+)\.json$/.exec(url.pathname);
    if (m) {
      const e = localeOk ? this.events.find((x) => x.id === decodeURIComponent(m[1] as string)) : undefined;
      return e ? json(res, 200, e) : json(res, 404, { errors: [{ code: 'DIS1004', detail: 'Resource not found with provided criteria', status: '404' }] });
    }
    json(res, 404, { errors: [{ code: 'DIS1001', detail: 'Not found' }] });
  }
}

export interface RawMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number;
  venue?: string | null;
  competition: { code: string; name: string };
  homeTeam: { id: number; name: string; shortName: string; tla: string };
  awayTeam: { id: number; name: string; shortName: string; tla: string };
}

export class FakeFootballData {
  server: Server;
  matches: RawMatch[] = [];
  /** Competiciones que la cuenta «no tiene» (403). */
  restricted = new Set<string>();
  calls: string[] = [];

  constructor(readonly token = FD_TOKEN) {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  listen(): Promise<string> {
    return listen(this.server);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x');
    this.calls.push(url.pathname + url.search);
    if (req.headers['x-auth-token'] !== this.token) return json(res, 400, { message: 'Your API token is invalid.', errorCode: 400 });
    let m = /^\/v4\/competitions\/(\w+)$/.exec(url.pathname);
    if (m) return json(res, 200, { id: 2014, code: m[1], name: 'Primera Division' });
    m = /^\/v4\/competitions\/(\w+)\/matches$/.exec(url.pathname);
    if (m) {
      const code = m[1] as string;
      if (this.restricted.has(code)) {
        return json(res, 403, { message: 'The resource you are looking for is restricted and apparently not within your permissions. Please check your subscription.', errorCode: 403 });
      }
      const from = url.searchParams.get('dateFrom') ?? '0000';
      const to = url.searchParams.get('dateTo') ?? '9999';
      const matches = this.matches.filter((x) => x.competition.code === code && x.utcDate.slice(0, 10) >= from && x.utcDate.slice(0, 10) <= to);
      return json(res, 200, { filters: { dateFrom: from, dateTo: to }, resultSet: { count: matches.length }, matches });
    }
    m = /^\/v4\/matches\/(\d+)$/.exec(url.pathname);
    if (m) {
      const x = this.matches.find((y) => y.id === Number(m?.[1]));
      return x ? json(res, 200, x) : json(res, 404, { message: 'The resource you are looking for does not exist.', errorCode: 404 });
    }
    json(res, 404, { message: 'Not found' });
  }
}
