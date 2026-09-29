/**
 * ⭐ Grandes partidos: Claude busca, en paralelo por tipo, los partidos más
 * importantes de los próximos 12 meses; aquí se juntan (sin repetidos), se
 * quedan los 50 más importantes y se guardan en disco (data/top-partidos.json)
 * para no volver a pagar la búsqueda hasta que se pida otra vez.
 *
 * Cada partido se enlaza con su estadio de la sala, con la web de venta con la
 * que se prepara y, si ya se ha preparado, con su evento.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bestVenueMatch, nameTokens, TOP_MAX, venueMentioned, type AiCost, type AiTopMatch, type TopMatch, type TopMatchesState } from '@to/shared';
import type { App } from '../app';
import { localDateTime } from '../feeds/common';
import { log } from '../util/log';
import { AiError, type ClaudeControl } from './claude';

/** Tipos de partido que se buscan (uno por consulta, en paralelo). */
export const TOP_SEARCHES: Array<{ key: string; focus: string; max: number }> = [
  {
    key: 'liga',
    focus:
      'LaLiga: el Clásico (Real Madrid - FC Barcelona y FC Barcelona - Real Madrid), los derbis (Real Madrid - Atlético y a la inversa, Sevilla - Betis, Athletic - Real Sociedad, Barcelona - Espanyol, Valencia - Villarreal) y los partidos entre los grandes que pueden decidir la liga.',
    max: 14,
  },
  {
    key: 'champions',
    focus:
      'UEFA Champions League: los partidos de los equipos españoles (fase liga y eliminatorias, en casa y fuera) y los grandes cruces europeos; incluye la final (fecha y estadio).',
    max: 15,
  },
  {
    key: 'copa',
    focus: 'Copa del Rey y Supercopa de España: las rondas de los grandes y las finales (fecha y sede).',
    max: 10,
  },
  {
    key: 'selecciones',
    focus:
      'Selecciones: partidos de la selección española (Nations League, clasificación, amistosos en España), Mundial o Eurocopa si los hay en estas fechas, y otras grandes finales (Mundial de Clubes, Supercopa de Europa, finales de Europa League y Conference League).',
    max: 12,
  },
];

const EMPTY_COST: AiCost = { usd: 0, searches: 0, fetches: 0, inputTokens: 0, outputTokens: 0, seconds: 0 };

interface Saved {
  at: string;
  matches: AiTopMatch[];
  notes: string[];
  cost: AiCost;
}

/** Misma fecha y mismos equipos (o misma competición si aún no hay equipos): es el mismo partido. */
function matchKey(m: AiTopMatch): string {
  const day = m.startsAtLocal?.slice(0, 10) ?? 'sin-fecha';
  const teams = [m.home, m.away]
    .filter((x): x is string => Boolean(x))
    .map((t) => nameTokens(t).sort().join('-'))
    .sort();
  return `${day}|${teams.length === 2 ? teams.join('|') : nameTokens(m.competition).sort().join('-')}`;
}

export class TopMatches {
  private saved: Saved | null = null;
  private running: { startedAt: string; promise: Promise<void> } | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly opts: {
      app: App;
      ai: ClaudeControl;
      /** Archivo donde se guarda la lista (null: solo en memoria). */
      file: string | null;
      timeZone: string;
    },
  ) {}

  /** Lee la lista guardada (al arrancar). */
  async load(): Promise<void> {
    if (!this.opts.file) return;
    try {
      const data = JSON.parse(await readFile(this.opts.file, 'utf8')) as Saved;
      if (Array.isArray(data.matches)) this.saved = data;
    } catch {
      // sin lista guardada todavía
    }
  }

  state(): TopMatchesState {
    return {
      at: this.saved?.at ?? null,
      matches: (this.saved?.matches ?? []).map((m) => this.enrich(m)),
      notes: this.saved?.notes ?? [],
      cost: this.saved?.cost ?? null,
      refreshing: this.running !== null,
      startedAt: this.running?.startedAt ?? null,
      error: this.lastError,
    };
  }

  find(id: string): TopMatch | null {
    return this.state().matches.find((m) => m.id === id) ?? null;
  }

  /** Busca la lista otra vez con Claude (en segundo plano). Si ya está buscando, no empieza otra. */
  refresh(actor: string): TopMatchesState {
    if (!this.opts.ai.configured()) throw new AiError('NOT_CONFIGURED', 'Falta la clave de Claude: ponla en Ajustes · Claude (IA).');
    if (!this.running) {
      const startedAt = new Date(this.opts.app.runtime.ctx.now()).toISOString();
      const promise = this.search(actor)
        .catch((err: Error) => {
          this.lastError = err.message;
          log.warn('Grandes partidos: la búsqueda ha fallado', { error: err.message });
        })
        .finally(() => {
          this.running = null;
        });
      this.running = { startedAt, promise };
    }
    return this.state();
  }

  /** Espera a que termine la búsqueda en curso (pruebas y Telegram). */
  async settled(): Promise<void> {
    await this.running?.promise;
  }

  private async search(actor: string): Promise<void> {
    this.lastError = null;
    const now = this.opts.app.runtime.ctx.now();
    const from = localDateTime(now, this.opts.timeZone).slice(0, 10);
    const to = localDateTime(now + 365 * 86_400_000, this.opts.timeZone).slice(0, 10);
    const results = await Promise.allSettled(TOP_SEARCHES.map((t) => this.opts.ai.topMatches({ focus: t.focus, from, to, max: t.max })));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<ClaudeControl['topMatches']>>> => r.status === 'fulfilled').map((r) => r.value);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (ok.length === 0) throw failed[0]?.reason instanceof Error ? failed[0].reason : new Error('Claude no ha devuelto ningún partido');
    // Juntar sin repetidos (el mismo partido puede salir en dos búsquedas): se queda el dato más completo.
    const list: AiTopMatch[] = [];
    const index = new Map<string, number>();
    const keysOf = (m: AiTopMatch) => {
      const keys = [matchKey(m)];
      // Mismo día y mismo estadio: el mismo partido aunque los equipos se escriban distinto («Barça» / «FC Barcelona»).
      if (m.startsAtLocal && m.venue) keys.push(`${m.startsAtLocal.slice(0, 10)}@${nameTokens(m.venue).sort().join('-')}`);
      return keys;
    };
    for (const r of ok) {
      for (const m of r.matches) {
        const keys = keysOf(m);
        const at = keys.map((k) => index.get(k)).find((i) => i !== undefined);
        const prev = at === undefined ? undefined : list[at];
        if (at === undefined || !prev) {
          list.push(m);
          for (const k of keys) index.set(k, list.length - 1);
          continue;
        }
        for (const k of keys) index.set(k, at);
        list[at] = {
          ...prev,
          importance: Math.max(prev.importance, m.importance),
          startsAtLocal: prev.timeTBA && !m.timeTBA ? m.startsAtLocal : prev.startsAtLocal,
          timeTBA: prev.timeTBA && m.timeTBA,
          venue: prev.venue ?? m.venue,
          city: prev.city ?? m.city,
          country: prev.country ?? m.country,
          ticketUrl: prev.ticketUrl ?? m.ticketUrl,
          saleOpensLocal: prev.saleOpensLocal ?? m.saleOpensLocal,
          why: prev.why || m.why,
        };
      }
    }
    const matches = [...list]
      .sort((a, b) => b.importance - a.importance || (a.startsAtLocal ?? '9').localeCompare(b.startsAtLocal ?? '9'))
      .slice(0, TOP_MAX)
      .sort((a, b) => (a.startsAtLocal ?? '9').localeCompare(b.startsAtLocal ?? '9'));
    const cost = ok.reduce<AiCost>(
      (acc, r) => ({
        usd: Math.round((acc.usd + r.cost.usd) * 10_000) / 10_000,
        searches: acc.searches + r.cost.searches,
        fetches: acc.fetches + r.cost.fetches,
        inputTokens: acc.inputTokens + r.cost.inputTokens,
        outputTokens: acc.outputTokens + r.cost.outputTokens,
        seconds: Math.max(acc.seconds, r.cost.seconds),
      }),
      EMPTY_COST,
    );
    const notes = ok.map((r) => r.notes).filter(Boolean);
    if (failed.length > 0) notes.push(`${failed.length} de ${TOP_SEARCHES.length} búsquedas no han terminado (${(failed[0]?.reason as Error)?.message ?? 'error'}): pulsa «Actualizar» más tarde para completarla.`);
    this.saved = { at: new Date(now).toISOString(), matches, notes, cost };
    await this.persist();
    this.opts.app.runtime.ctx.journal.audit('top.refreshed', { matches: matches.length, usd: cost.usd }, { actor });
  }

  private async persist(): Promise<void> {
    if (!this.opts.file || !this.saved) return;
    try {
      await mkdir(path.dirname(this.opts.file), { recursive: true });
      const tmp = `${this.opts.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.saved, null, 2), 'utf8');
      await rename(tmp, this.opts.file);
    } catch (err) {
      log.warn('Grandes partidos: no se pudo guardar la lista (funciona igual hasta cerrar)', { error: (err as Error).message });
    }
  }

  /** Estadio de la sala, web de venta con la que se prepara y evento ya preparado. */
  private enrich(m: AiTopMatch): TopMatch {
    const store = this.opts.app.runtime.store;
    const venues = (store.vaultReport?.venues ?? []).map((v) => ({ venueId: v.venueId, name: v.name, city: v.city ?? null, aliases: v.aliases ?? [] }));
    const vaultVenueId = (m.venue ? bestVenueMatch(venues, m.venue, m.city) : null) ?? venueMentioned(venues, `${m.venue ?? ''}`);
    const providers = store.providerAuthorizations.filter((p) => p.mode !== 'SIMULATED');
    const isRM = /real madrid/i.test(m.home ?? '') && (vaultVenueId === null || /bernab/i.test(m.venue ?? '') || /bernab/i.test(vaultVenueId));
    const providerId = (isRM ? providers.find((p) => p.providerId === 'real-madrid') : undefined)?.providerId ?? providers.find((p) => p.providerId === 'manual')?.providerId ?? providers[0]?.providerId ?? null;
    const day = m.startsAtLocal?.slice(0, 10) ?? null;
    const teams = new Set([...nameTokens(m.home ?? ''), ...nameTokens(m.away ?? '')]);
    const event =
      day && teams.size > 0
        ? [...store.events.values()].find((e) => {
            if (localDateTime(Date.parse(e.startsAt), this.opts.timeZone).slice(0, 10) !== day) return false;
            const hits = nameTokens(e.name).filter((t) => teams.has(t)).length;
            return hits >= Math.min(2, teams.size);
          })
        : undefined;
    return {
      ...m,
      id: createHash('sha1').update(matchKey(m)).digest('hex').slice(0, 12),
      vaultVenueId,
      providerId,
      eventId: event?.id ?? null,
    };
  }
}
