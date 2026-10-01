/**
 * Partidos de LaLiga y Champions League (football-data.org, gratis con registro):
 * https://docs.football-data.org/general/v4/
 *
 * Da la fecha y la hora oficiales de cada partido y si la hora ya está fijada.
 * No da la apertura de la venta ni los límites de compra: esos los publica cada
 * club en su web (se ponen a mano en el evento).
 */

import type { FeedEvent, FeedEventStatus } from '@to/shared';
import { iso } from '../util/time';
import { cleanText, clubMatches, FeedError, localDateTime, networkError, RateWindow, validMs, venueNameScore } from './common';

export const COMPETITIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'PD', label: 'LaLiga' },
  { code: 'CL', label: 'Champions League' },
];

interface FdTeam {
  id?: number;
  name?: string | null;
  shortName?: string | null;
  tla?: string | null;
}

interface FdMatch {
  id?: number;
  utcDate?: string;
  status?: string;
  matchday?: number | null;
  stage?: string | null;
  venue?: string | null;
  homeTeam?: FdTeam;
  awayTeam?: FdTeam;
  competition?: { code?: string; name?: string };
}

export interface FootballMatch {
  event: FeedEvent;
  /** Competición (PD = LaLiga, CL = Champions). */
  competition: string;
  /** Nombres del equipo local (para saber en qué estadio se juega). */
  homeNames: string[];
  venueName: string | null;
}

function fdStatus(s: string | undefined): FeedEventStatus {
  switch (s) {
    case 'SCHEDULED':
    case 'TIMED':
      return 'SCHEDULED';
    case 'POSTPONED':
    case 'SUSPENDED':
      return 'POSTPONED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'FINISHED':
    case 'AWARDED':
    case 'IN_PLAY':
    case 'PAUSED':
      return 'FINISHED';
    default:
      return 'UNKNOWN';
  }
}

const teamName = (t: FdTeam | undefined) => cleanText(t?.shortName, 60) ?? cleanText(t?.name, 80) ?? 'Por decidir';

/** Partido → formato común. En «SCHEDULED» solo está el día: la hora aún no está fijada. */
export function normalizeMatch(m: FdMatch, timeZone: string): FootballMatch | null {
  if (typeof m.id !== 'number') return null;
  const ms = validMs(m.utcDate);
  const code = m.competition?.code ?? '';
  const label = COMPETITIONS.find((c) => c.code === code)?.label ?? cleanText(m.competition?.name, 60) ?? 'Fútbol';
  const timeTBA = m.status === 'SCHEDULED';
  const round = code === 'PD' && m.matchday ? ` (jornada ${m.matchday})` : '';
  const venueName = cleanText(m.venue, 120);
  const event: FeedEvent = {
    feed: 'football',
    id: String(m.id),
    name: `${teamName(m.homeTeam)} – ${teamName(m.awayTeam)} · ${label}${round}`,
    url: null,
    startsAt: ms === null ? null : iso(ms),
    startsAtLocal: ms === null ? null : localDateTime(ms, timeZone),
    timeTBA,
    venueLocalTime: null,
    status: fdStatus(m.status),
    sales: [],
    saleTBD: true,
    limit: { text: null, perCustomer: null, semantics: null },
    price: null,
    venue: venueName ? { id: null, name: venueName, city: null } : null,
    category: label,
    seatmapUrl: null,
    info: timeTBA ? 'La hora todavía no está fijada (LaLiga suele confirmarla unas dos semanas antes): si vigilas el evento, te aviso cuando salga.' : null,
    vaultVenueId: null,
    home: cleanText(m.homeTeam?.shortName, 60) ?? cleanText(m.homeTeam?.name, 80),
  };
  const homeNames = [m.homeTeam?.name, m.homeTeam?.shortName].filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return { event, competition: code, homeNames, venueName };
}

/** ¿Se juega este partido en nuestro estadio? (por el club local o por el nombre del estadio) */
export function playedAt(match: FootballMatch, venue: { name: string; aliases: string[]; clubs: string[] }): boolean {
  if (venue.clubs.length > 0 && clubMatches(venue.clubs, match.homeNames)) return true;
  return match.venueName !== null && venueNameScore([venue.name, ...venue.aliases], [match.venueName]) >= 0.8;
}

export interface FootballOptions {
  token: string;
  apiBase?: string;
  timeZone: string;
  /** Consultas por minuto (la cuenta gratuita admite 10). */
  perMinute?: number;
  timeoutMs?: number;
}

export class FootballClient {
  private readonly base: string;
  private readonly limiter: RateWindow;

  constructor(private readonly opts: FootballOptions) {
    this.base = (opts.apiBase ?? 'https://api.football-data.org').replace(/\/+$/, '');
    this.limiter = new RateWindow(opts.perMinute ?? 9, 60_000);
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    const url = new URL(`${this.base}/v4/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    await this.limiter.wait();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-Auth-Token': this.opts.token, accept: 'application/json' },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      throw new FeedError(
        'NETWORK',
        `No se pudo conectar con football-data.org (${networkError(err)}). Comprueba la conexión a internet o si un antivirus o cortafuegos bloquea api.football-data.org.`,
      );
    }
    const text = await res.text().catch(() => '');
    let message = '';
    try {
      message = String((JSON.parse(text) as { message?: string }).message ?? '');
    } catch {
      message = '';
    }
    if (res.status === 404) return null;
    if (res.status === 429) {
      const secs = /(\d+)\s*sec/i.exec(message)?.[1];
      throw new FeedError('RATE', `football-data.org: demasiadas consultas (la cuenta gratuita admite 10 por minuto).${secs ? ` Espera ${secs} segundos.` : ' Espera un minuto.'}`);
    }
    if (/token/i.test(message) || res.status === 401) {
      throw new FeedError('AUTH', 'football-data.org no acepta el token: copia otra vez el «API Token» del email de registro (o de tu cuenta en football-data.org).');
    }
    if (res.status === 403) throw new FeedError('PLAN', 'Tu cuenta de football-data.org no incluye esta competición (la gratuita sí trae LaLiga y la Champions).');
    if (!res.ok) throw new FeedError('BAD', `football-data.org respondió ${res.status}${message ? `: ${message.slice(0, 200)}` : ''}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new FeedError('BAD', 'football-data.org ha respondido algo que no se entiende (no es JSON).');
    }
  }

  async probe(): Promise<void> {
    await this.get('competitions/PD');
  }

  /** Partidos de una competición entre dos días («AAAA-MM-DD», ambos incluidos). */
  async matches(code: string, dateFrom: string, dateTo: string): Promise<FootballMatch[]> {
    const json = await this.get<{ matches?: FdMatch[] }>(`competitions/${encodeURIComponent(code)}/matches`, { dateFrom, dateTo });
    return (json?.matches ?? [])
      .map((m) => normalizeMatch({ ...m, competition: m.competition ?? { code } }, this.opts.timeZone))
      .filter((m): m is FootballMatch => m !== null);
  }

  async match(id: string): Promise<FootballMatch | null> {
    const json = await this.get<FdMatch>(`matches/${encodeURIComponent(id)}`);
    return json ? normalizeMatch(json, this.opts.timeZone) : null;
  }
}
