/**
 * «/evento» en Telegram: crear un evento con Claude desde el móvil, con botones.
 *
 *   1. ¿Dónde se vende?            → botones con las webs de venta
 *   2. Claude busca sus eventos     → botones con los próximos eventos
 *   3. Claude lee el evento         → fechas, apertura, límite, precios, recinto
 *   4. ✅ Crear (y qué venta abre)   → evento en la sala + recinto + vigilancia
 *   5. ¿Dónde queréis sentaros?     → zonas del recinto en orden → «Listo»
 *      (si la web vende zonas que el plano no tiene: «➕ Añadir al recinto»)
 *
 * Solo el chat principal puede crear eventos. Las consultas a Claude tardan
 * 1–2 minutos: se hacen en segundo plano para que el bot siga respondiendo
 * (a una tarea de compra, por ejemplo) mientras tanto.
 *
 * Los botones llevan `ev:<sesión>:<acción>[:<n>]` (Telegram admite 64 bytes).
 */

import {
  AI_STATUS_LABEL,
  MAX_PREFERENCES,
  PREFERENCE_EMOJI,
  TOP_PER_ACCOUNT,
  TOP_WATCH_DAYS,
  type AiEventDetails,
  type AiEventSummary,
  type AiEventsResult,
  type TopMatch,
} from '@to/shared';
import type { CreatedFromAi, EventAssistant } from '../ai/assistant';
import type { TopMatches } from '../ai/top';
import { log } from '../util/log';

export type FlowButton = { text: string; callback_data: string } | { text: string; url: string };

/** Lo que el flujo necesita del bot. */
export interface FlowIO {
  send(chatId: string, text: string, keyboard?: FlowButton[][]): Promise<number | null>;
  /** Imagen por enlace (Telegram la descarga); false si no ha podido. */
  photo(chatId: string, url: string, caption: string): Promise<boolean>;
  edit(chatId: string, messageId: number, text: string, keyboard?: FlowButton[][]): Promise<void>;
  answer(callbackId: string, text: string): Promise<void>;
}

interface Session {
  id: string;
  chatId: string;
  providerId: string | null;
  providerName: string;
  events: AiEventSummary[];
  page: number;
  event: AiEventSummary | null;
  details: AiEventDetails | null;
  created: CreatedFromAi | null;
  seats: string[];
  busy: boolean;
  at: number;
  /** ⭐ Grandes partidos: vigilancia de 2 semanas y 1 entrada por cuenta. */
  top: boolean;
  /** Web de venta de cada evento de la lista (en los grandes partidos cambia de uno a otro). */
  providerIds: Array<string | null>;
  /** Zonas que vende la web y que el plano del recinto aún no tiene. */
  missing: string[];
}

const PAGE = 8;
const MAX_SESSIONS = 20;
const SESSION_MS = 3 * 3_600_000;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const DAY_FMT = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const LONG_FMT = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** «2026-10-10T21:00» (hora de Madrid) → «sáb, 10 oct · 21:00». */
function fmtLocal(local: string | null, long = false, timeTBA = false): string {
  if (!local) return 'fecha sin publicar';
  const d = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return local;
  const day = (long ? LONG_FMT : DAY_FMT).format(d);
  return timeTBA ? `${day} (hora por confirmar)` : `${day} · ${local.slice(11, 16)}`;
}

function money(usd: number): string {
  return `${usd.toFixed(2).replace('.', ',')} $`;
}

export class TelegramEventFlow {
  private readonly sessions = new Map<string, Session>();
  private seq = 0;

  constructor(
    private readonly io: FlowIO,
    private readonly assistant: () => EventAssistant | null,
    private readonly topList: () => TopMatches | null = () => null,
  ) {}

  /** «/top»: los grandes partidos del año; tocar uno lo prepara (vigilancia de 2 semanas, 1 entrada por cuenta). */
  async startTop(chatId: string): Promise<void> {
    const a = this.assistant();
    const top = this.topList();
    if (!a || !top) {
      await this.io.send(chatId, 'Esta sala no tiene «Grandes partidos».');
      return;
    }
    if (!a.configured()) {
      await this.io.send(chatId, '🤖 <b>Claude no está conectado.</b>\nEn el dashboard: <b>Ajustes → Claude (IA)</b>, pega tu clave. Después vuelve a escribir /top.');
      return;
    }
    const s = this.open(chatId);
    s.top = true;
    s.providerName = '⭐ Grandes partidos';
    const state = top.state();
    if (state.refreshing) {
      await this.io.send(chatId, '🔎 Claude está buscando los grandes partidos… Te escribo al terminar (2–4 minutos).');
      this.background(s, () => top.settled(), () => this.showTop(s));
      return;
    }
    if (state.matches.length === 0) {
      await this.io.send(chatId, '⭐ <b>Grandes partidos</b>\nAún no hay lista. Claude busca los 50 partidos más importantes de los próximos 12 meses (Clásico, Champions, finales, Copa, selección…). Tarda 2–4 minutos.', [
        [{ text: '🔎 Buscar ahora con Claude', callback_data: `ev:${s.id}:t` }],
        [{ text: 'Cancelar', callback_data: `ev:${s.id}:x` }],
      ]);
      return;
    }
    await this.showTop(s);
  }

  private async showTop(s: Session): Promise<void> {
    const matches = this.topList()?.state().matches ?? [];
    const upcoming = matches.filter((m) => m.eventId === null);
    s.events = upcoming.map((m) => topToSummary(m));
    s.providerIds = upcoming.map((m) => m.providerId);
    s.page = 0;
    const prepared = matches.length - upcoming.length;
    const text = [
      `⭐ <b>Grandes partidos</b> (${upcoming.length} por preparar${prepared > 0 ? `, ${prepared} ya preparados` : ''}).`,
      `Toca uno: Claude lee sus datos y se prepara con vigilancia desde ${TOP_WATCH_DAYS / 7} semanas antes de la venta y ${TOP_PER_ACCOUNT} entrada por cuenta (todas las cuentas a la vez).`,
    ].join('\n');
    await this.io.send(s.chatId, text, this.eventsKeyboard(s));
  }

  /** «/evento»: empieza eligiendo dónde se vende. */
  async start(chatId: string): Promise<void> {
    const a = this.assistant();
    if (!a) {
      await this.io.send(chatId, 'Esta sala no tiene Claude disponible.');
      return;
    }
    if (!a.configured()) {
      await this.io.send(
        chatId,
        '🤖 <b>Claude no está conectado.</b>\nEn el dashboard: <b>Ajustes → Claude (IA)</b>, pega tu clave de la API (platform.claude.com → API keys). Después vuelve a escribir /evento.',
      );
      return;
    }
    const sellers = a.sellers();
    if (sellers.length === 0) {
      await this.io.send(chatId, 'No hay webs de venta en la sala (vault → 30 Proveedores).');
      return;
    }
    const s = this.open(chatId);
    const keyboard: FlowButton[][] = sellers.slice(0, 12).map((p, i) => [{ text: `🛒 ${cut(p.name, 40)}`, callback_data: `ev:${s.id}:s:${i}` }]);
    keyboard.push([{ text: 'Cancelar', callback_data: `ev:${s.id}:x` }]);
    await this.io.send(chatId, '🤖 <b>Nuevo evento con Claude</b>\n¿Dónde se vende? Claude mirará su web y te enseñará los próximos eventos.', keyboard);
  }

  /** Botón pulsado (`ev:…`). `main` = viene del chat principal. */
  async callback(chatId: string, messageId: number | null, callbackId: string, data: string, actor: string, main: boolean): Promise<void> {
    const [, sid = '', action = '', arg] = data.split(':');
    const s = this.sessions.get(sid);
    if (!main) return this.io.answer(callbackId, 'Solo el chat principal puede crear eventos.');
    if (!s || s.chatId !== chatId) return this.io.answer(callbackId, 'Esta búsqueda ha caducado: escribe /evento para empezar otra.');
    const a = this.assistant();
    if (!a) return this.io.answer(callbackId, 'Claude no está disponible.');
    s.at = Date.now();
    const n = arg === undefined ? null : Number(arg);
    switch (action) {
      case 'x':
        this.sessions.delete(s.id);
        await this.io.answer(callbackId, 'Cancelado');
        if (messageId !== null) await this.io.edit(chatId, messageId, '❌ Cancelado.');
        return;
      case 's': {
        const seller = n === null ? undefined : a.sellers()[n];
        if (!seller) return this.io.answer(callbackId, 'Esa web ya no está en la sala.');
        if (s.busy) return this.io.answer(callbackId, 'Claude sigue buscando…');
        s.providerId = seller.providerId;
        s.providerName = seller.name;
        await this.io.answer(callbackId, `Buscando en ${seller.name}…`);
        if (messageId !== null) {
          await this.io.edit(chatId, messageId, `🔎 Claude está mirando <b>${esc(seller.name)}</b>${seller.url ? ` (${esc(seller.url)})` : ''}… Suele tardar 1–2 minutos: te escribo al terminar.`);
        }
        this.background(s, () => a.find(seller.providerId), (r) => this.showEvents(s, r));
        return;
      }
      case 't': {
        const top = this.topList();
        if (!top) return this.io.answer(callbackId, 'No disponible.');
        if (s.busy) return this.io.answer(callbackId, 'Claude sigue buscando…');
        await this.io.answer(callbackId, 'Buscando…');
        if (messageId !== null) await this.io.edit(chatId, messageId, '🔎 Claude está buscando los grandes partidos de los próximos 12 meses… Te escribo al terminar (2–4 minutos).');
        try {
          top.refresh(actor);
        } catch (err) {
          await this.io.send(chatId, `❌ ${esc((err as Error).message)}`);
          return;
        }
        this.background(s, () => top.settled(), () => this.showTop(s));
        return;
      }
      case 'r': {
        if (s.top) {
          // En los grandes partidos, «buscar otra vez» vuelve a pedir la lista a Claude.
          return this.callback(chatId, messageId, callbackId, `ev:${s.id}:t`, actor, main);
        }
        if (!s.providerId) return this.io.answer(callbackId, 'Elige antes la web de venta.');
        if (s.busy) return this.io.answer(callbackId, 'Claude sigue buscando…');
        const providerId = s.providerId;
        await this.io.answer(callbackId, 'Buscando otra vez…');
        if (messageId !== null) await this.io.edit(chatId, messageId, `🔎 Claude vuelve a mirar <b>${esc(s.providerName)}</b>… (1–2 minutos)`);
        this.background(s, () => a.find(providerId, true), (r) => this.showEvents(s, r));
        return;
      }
      case 'p': {
        s.page = Math.max(0, n ?? 0);
        await this.io.answer(callbackId, '');
        if (messageId !== null) await this.io.edit(chatId, messageId, this.eventsText(s, null), this.eventsKeyboard(s));
        return;
      }
      case 'e': {
        const ev = n === null ? undefined : s.events[n];
        const eventProvider = (n === null ? null : (s.providerIds[n] ?? null)) ?? s.providerId;
        if (!ev || !eventProvider) return this.io.answer(callbackId, 'Ese evento ya no está en la lista.');
        if (s.busy) return this.io.answer(callbackId, 'Claude sigue buscando…');
        const providerId = eventProvider;
        s.providerId = eventProvider;
        s.event = ev;
        s.details = null;
        await this.io.answer(callbackId, 'Leyendo el evento…');
        if (messageId !== null) {
          await this.io.edit(
            chatId,
            messageId,
            `🔎 Claude está leyendo <b>${esc(ev.name)}</b>: fechas, apertura de la venta, límite de compra, precios y recinto… (1–2 minutos)`,
          );
        }
        this.background(s, () => a.details(providerId, ev), (d) => this.showDetails(s, d));
        return;
      }
      case 'c': {
        const d = s.details;
        if (!d || !s.providerId) return this.io.answer(callbackId, 'Elige antes el evento.');
        if (s.created) return this.io.answer(callbackId, 'Este evento ya está creado.');
        if (s.busy) return this.io.answer(callbackId, 'Un momento…');
        const saleName = n === null || Number.isNaN(n) ? null : (d.sales[n]?.name ?? null);
        s.busy = true;
        await this.io.answer(callbackId, 'Creando…');
        try {
          const created = await a.create(s.providerId, d, saleName, actor, s.top ? { watchDays: TOP_WATCH_DAYS, perAccountQty: TOP_PER_ACCOUNT } : {});
          s.created = created;
          if (messageId !== null) await this.io.edit(chatId, messageId, this.detailsText(s, d), []);
          await this.showCreated(s, created);
        } catch (err) {
          await this.io.send(chatId, `❌ ${esc((err as Error).message)}`);
        } finally {
          s.busy = false;
        }
        return;
      }
      case 'z': {
        const zones = s.created?.venue.zones ?? [];
        const zone = n === null ? undefined : zones[n];
        if (!zone) return this.io.answer(callbackId, 'Esa zona ya no está.');
        const i = s.seats.indexOf(zone);
        if (i < 0 && s.seats.length >= MAX_PREFERENCES) {
          return this.io.answer(callbackId, `Ya hay ${MAX_PREFERENCES}: toca una elegida para quitarla.`);
        }
        if (i >= 0) s.seats.splice(i, 1);
        else s.seats.push(zone);
        await this.io.answer(callbackId, i >= 0 ? `Quitada: ${zone}` : `${PREFERENCE_EMOJI[s.seats.length - 1] ?? ''} ${s.seats.length}ª preferencia: ${zone}`);
        if (messageId !== null) await this.io.edit(chatId, messageId, this.seatsText(s), this.seatsKeyboard(s));
        return;
      }
      case 'a': {
        const created = s.created;
        const layout = s.details?.layout ?? null;
        if (!created || !layout) return this.io.answer(callbackId, 'Crea antes el evento.');
        if (s.busy) return this.io.answer(callbackId, 'Un momento…');
        s.busy = true;
        try {
          const r = await a.addSaleZones(created.venue.id, layout, actor);
          created.venue.zones = a.zones(created.venue.id);
          s.missing = a.missingSaleZones(created.venue.id, layout);
          await this.io.answer(callbackId, r.zones > 0 ? `Añadida${r.zones === 1 ? '' : 's'} ${r.zones} zona${r.zones === 1 ? '' : 's'} ✅` : 'El recinto ya las tenía');
          if (messageId !== null) await this.io.edit(chatId, messageId, this.seatsText(s), this.seatsKeyboard(s));
        } catch (err) {
          await this.io.answer(callbackId, cut((err as Error).message, 190));
        } finally {
          s.busy = false;
        }
        return;
      }
      case 'k': {
        const created = s.created;
        if (!created) return this.io.answer(callbackId, 'Crea antes el evento.');
        try {
          await a.setSeats(created.event.id, s.seats, actor);
          await this.io.answer(callbackId, 'Guardado ✅');
          if (messageId !== null) {
            await this.io.edit(
              chatId,
              messageId,
              s.seats.length > 0
                ? `💺 <b>Dónde queréis las entradas</b> (guardado):\n${s.seats.map((z, i) => `${PREFERENCE_EMOJI[i] ?? ''} ${i + 1}ª ${esc(z)}`).join('\n')}\n\nAl abrir la venta, el bot manda a cada persona a la 1ª; si no hay, a la 2ª y después a la 3ª, al instante.`
                : '💺 Sin zonas preferidas: la operación podrá intentar cualquier zona permitida del recinto.',
              [],
            );
          }
          this.sessions.delete(s.id);
        } catch (err) {
          await this.io.answer(callbackId, cut((err as Error).message, 190));
        }
        return;
      }
      default:
        return this.io.answer(callbackId, '');
    }
  }

  // ---------------------------------------------------------------------------

  private open(chatId: string): Session {
    const now = Date.now();
    for (const [id, x] of this.sessions) if (now - x.at > SESSION_MS) this.sessions.delete(id);
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    const id = `${(++this.seq).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const s: Session = {
      id,
      chatId,
      providerId: null,
      providerName: '',
      events: [],
      page: 0,
      event: null,
      details: null,
      created: null,
      seats: [],
      busy: false,
      at: now,
      top: false,
      providerIds: [],
      missing: [],
    };
    this.sessions.set(id, s);
    return s;
  }

  /** Consulta a Claude en segundo plano: el bot sigue atendiendo lo demás. */
  private background<T>(s: Session, work: () => Promise<T>, done: (r: T) => Promise<void>): void {
    s.busy = true;
    void work()
      .then(async (r) => {
        s.busy = false;
        await done(r);
      })
      .catch(async (err: Error) => {
        s.busy = false;
        log.warn('Telegram: la consulta a Claude ha fallado', { error: err.message });
        await this.io.send(s.chatId, `❌ ${esc(err.message)}`, [[{ text: 'Volver a empezar', callback_data: `ev:${s.id}:x` }]]).catch(() => null);
      });
  }

  private async showEvents(s: Session, r: AiEventsResult): Promise<void> {
    s.events = r.events;
    s.page = 0;
    s.event = null;
    s.details = null;
    await this.io.send(s.chatId, this.eventsText(s, r), this.eventsKeyboard(s));
  }

  private eventsText(s: Session, r: AiEventsResult | null): string {
    const lines: string[] = [];
    if (s.events.length === 0) {
      lines.push(`📅 Claude no ha encontrado eventos en <b>${esc(s.providerName)}</b> para los próximos meses.`);
    } else {
      lines.push(`📅 <b>Próximos eventos en ${esc(s.providerName)}</b> (${s.events.length}). Toca uno y Claude leerá sus datos:`);
    }
    if (r?.notes) lines.push('', `ℹ️ ${esc(r.notes)}`);
    if (r) lines.push('', `<i>${r.cached ? 'Respuesta de hace un rato (gratis).' : `Consulta: ${money(r.cost.usd)} · ${r.cost.seconds} s.`}</i>`);
    return lines.join('\n');
  }

  private eventsKeyboard(s: Session): FlowButton[][] {
    const from = s.page * PAGE;
    const rows: FlowButton[][] = s.events.slice(from, from + PAGE).map((e, i) => {
      const when = e.startsAtLocal ? fmtLocal(e.startsAtLocal, false, e.timeTBA).replace(' (hora por confirmar)', '') : 'sin fecha';
      return [{ text: cut(`${when} · ${e.name}`, 60), callback_data: `ev:${s.id}:e:${from + i}` }];
    });
    const nav: FlowButton[] = [];
    if (s.page > 0) nav.push({ text: '◀ Anteriores', callback_data: `ev:${s.id}:p:${s.page - 1}` });
    if (from + PAGE < s.events.length) nav.push({ text: 'Más ▶', callback_data: `ev:${s.id}:p:${s.page + 1}` });
    if (nav.length > 0) rows.push(nav);
    rows.push([
      { text: '🔄 Buscar otra vez', callback_data: `ev:${s.id}:r` },
      { text: 'Cancelar', callback_data: `ev:${s.id}:x` },
    ]);
    return rows;
  }

  private async showDetails(s: Session, d: AiEventDetails): Promise<void> {
    s.details = d;
    const rows: FlowButton[][] = [];
    const nowLocal = this.assistant()?.nowLocal() ?? '';
    const future = d.sales.map((x, i) => ({ ...x, i })).filter((x) => x.opensAtLocal >= nowLocal);
    const choices = (future.length > 0 ? future : d.sales.map((x, i) => ({ ...x, i }))).slice(0, 4);
    if (!d.startsAtLocal) {
      rows.push([{ text: '⚠️ Sin fecha: créalo en el dashboard', callback_data: `ev:${s.id}:x` }]);
    } else if (choices.length > 0) {
      for (const x of choices) rows.push([{ text: cut(`✅ Crear · abre ${x.name} ${fmtLocal(x.opensAtLocal)}`, 60), callback_data: `ev:${s.id}:c:${x.i}` }]);
    } else {
      rows.push([{ text: '✅ Crear evento (apertura por anunciar)', callback_data: `ev:${s.id}:c:-` }]);
    }
    if (d.url) rows.push([{ text: '🌐 Página oficial', url: d.url }]);
    rows.push([{ text: 'Cancelar', callback_data: `ev:${s.id}:x` }]);
    await this.io.send(s.chatId, this.detailsText(s, d), rows);
  }

  private detailsText(s: Session, d: AiEventDetails): string {
    const lines = [`🎟 <b>${esc(d.name)}</b>`, `📅 ${fmtLocal(d.startsAtLocal, true, d.timeTBA)}`];
    const venue = d.venue ? `${esc(d.venue)}${d.city ? ` (${esc(d.city)})` : ''}` : 'recinto sin confirmar';
    lines.push(
      `🏟 ${venue}${d.vaultVenueId ? ' — ya está en la sala' : d.layout ? ` — nuevo: se crea con sus zonas (${d.layout.length})` : ' — nuevo: se crea con una estructura orientativa'}`,
    );
    if (d.planImageUrl) lines.push('🗺 Plano oficial encontrado: lo verás al elegir dónde queréis las entradas.');
    if (d.url) lines.push(`🔗 Compra oficial${d.seller ? ` (${esc(d.seller)})` : ''}: ${esc(d.url)}`);
    if (d.urlWarning) lines.push(`⚠️ ${esc(d.urlWarning)}`);
    if (d.sales.length > 0) {
      lines.push('🕐 <b>Venta</b>:');
      for (const x of d.sales) lines.push(`   • ${esc(x.name)}: ${fmtLocal(x.opensAtLocal)}${x.limit ? ` · máx. ${x.limit} por persona` : ''}`);
    } else {
      lines.push('🕐 Apertura de la venta: aún no anunciada (la vigilancia te lo recordará).');
    }
    if (d.limit.perPerson !== null) {
      lines.push(
        `🔢 Límite: <b>${d.limit.perPerson}</b> por persona${d.limit.quote ? ` — «${esc(cut(d.limit.quote, 160))}»` : ''} ${d.limit.official ? '(de la web oficial ✓)' : '(no sale de la web oficial: revísalo)'}`,
      );
    } else {
      lines.push('🔢 Límite de compra: no publicado. Míralo en la web oficial y ponlo en el dashboard.');
    }
    if (d.price && (d.price.min !== null || d.price.max !== null)) {
      lines.push(`💶 ${[d.price.min, d.price.max].filter((x) => x !== null).join(' – ')} ${esc(d.price.currency)}`);
    }
    if (d.layout && d.layout.length > 0) {
      lines.push('🏟 <b>Cómo está estructurada la venta</b>:');
      for (const z of d.layout.slice(0, 8)) {
        lines.push(
          `   • ${esc(z.zone)}${z.standing ? ' (de pie)' : ''}${z.sections.length > 0 ? `: ${esc(cut(z.sections.join(', '), 60))}` : ''}${z.price ? ` · ${esc(z.price)}` : ''}${
            z.venueZone && z.venueZone !== z.zone ? ` → ${esc(z.venueZone)}` : ''
          }`,
        );
      }
      if (d.layout.length > 8) lines.push(`   … y ${d.layout.length - 8} zonas más (en el dashboard).`);
    }
    if (d.status) lines.push(`📣 ${AI_STATUS_LABEL[d.status]}`);
    if (d.notes) lines.push(`ℹ️ ${esc(cut(d.notes, 400))}`);
    lines.push('', `<i>${d.cached ? 'Respuesta de hace un rato (gratis).' : `Consulta: ${money(d.cost.usd)} · ${d.cost.seconds} s.`}</i>`);
    if (s.created) lines.push('', '✅ <b>Creado.</b>');
    return lines.join('\n');
  }

  private async showCreated(s: Session, c: CreatedFromAi): Promise<void> {
    const e = c.event;
    const lines = [
      `✅ <b>Evento creado:</b> ${esc(e.name)}`,
      `🏟 ${esc(c.venue.name)}${c.venue.created ? ' (recinto nuevo en la sala)' : ''}`,
      e.onSaleAt
        ? `👀 Vigilancia desde ${s.top ? `${TOP_WATCH_DAYS / 7} semanas` : '2 días'} antes de la venta: te aviso aquí el día antes, 1 hora antes y al abrir.`
        : '👀 Vigilancia puesta: te aviso aquí (y pon la apertura en el dashboard cuando se anuncie).',
    ];
    if (s.top) lines.push(`🎟 ${TOP_PER_ACCOUNT} entrada por cuenta: al abrir, todas las cuentas van a la vez (cada una a por la suya).`);
    if (!c.limitsVerified) lines.push('⚠️ <b>Límite sin verificar</b>: confírmalo en el dashboard (Eventos → editar) antes de preparar la compra.');
    if (c.warnings.length > 0) lines.push(`ℹ️ ${esc(cut(c.warnings.join(' · '), 300))}`);
    await this.io.send(s.chatId, lines.join('\n'));
    // La web vende zonas que el plano del recinto no tiene: se pueden añadir con un toque.
    s.missing = c.venue.created ? [] : (this.assistant()?.missingSaleZones(c.venue.id, s.details?.layout ?? null) ?? []);
    if (c.venue.zones.length === 0 && s.missing.length === 0) return;
    if (c.planImage) await this.io.photo(s.chatId, c.planImage, `🗺 Plano oficial de ${c.venue.name} (tal cual se ve al comprar)`);
    await this.io.send(s.chatId, this.seatsText(s), this.seatsKeyboard(s));
  }

  private seatsText(s: Session): string {
    const lines = [
      '💺 <b>¿Dónde queréis las entradas?</b>',
      `Toca hasta ${MAX_PREFERENCES} zonas en orden: ${PREFERENCE_EMOJI.map((e, i) => `${e} ${i + 1}ª`).join(', ')} preferencia. Otra vez para quitarla. Después, «Listo».`,
    ];
    if (s.missing.length > 0) {
      lines.push(
        '',
        `➕ La web vende también <b>${esc(cut(s.missing.join(', '), 200))}</b>, que vuestro plano no tiene: toca «Añadir al recinto» para poder elegir${s.missing.length === 1 ? 'la' : 'las'}.`,
      );
    }
    if (s.seats.length > 0) lines.push('', ...s.seats.map((z, i) => `${PREFERENCE_EMOJI[i] ?? ''} ${i + 1}ª ${esc(z)}`));
    return lines.join('\n');
  }

  private seatsKeyboard(s: Session): FlowButton[][] {
    const zones = (s.created?.venue.zones ?? []).slice(0, 24);
    const rows: FlowButton[][] = [];
    for (let i = 0; i < zones.length; i += 2) {
      rows.push(
        zones.slice(i, i + 2).map((z, j) => {
          const rank = s.seats.indexOf(z);
          return { text: cut(`${rank >= 0 ? `${PREFERENCE_EMOJI[rank] ?? ''} ${rank + 1}ª ` : ''}${z}`, 32), callback_data: `ev:${s.id}:z:${i + j}` };
        }),
      );
    }
    if (s.missing.length > 0) {
      rows.push([{ text: cut(`➕ Añadir al recinto (${s.missing.length} zona${s.missing.length === 1 ? '' : 's'} de la web)`, 60), callback_data: `ev:${s.id}:a` }]);
    }
    rows.push([{ text: s.seats.length > 0 ? '✅ Listo' : 'Saltar (cualquier zona)', callback_data: `ev:${s.id}:k` }]);
    return rows;
  }
}

/** Un gran partido como evento de la lista (para leerlo con Claude). */
function topToSummary(m: TopMatch): AiEventSummary {
  return {
    name: m.name,
    startsAtLocal: m.startsAtLocal,
    timeTBA: m.timeTBA,
    venue: m.venue,
    city: m.city,
    url: m.ticketUrl,
    saleOpensLocal: m.saleOpensLocal,
    sourceUrl: null,
    vaultVenueId: m.vaultVenueId,
  };
}
