/**
 * Vigilancia de un evento antes de la venta («vigilar desde 2 días antes»).
 *
 * Desde N días antes de la apertura de la venta (o del evento, si no tiene
 * apertura) hasta que abre:
 * - consulta el evento en su fuente oficial cada 10 minutos (cada 2 en las 3
 *   horas finales): si cambia la fecha, la apertura, las preventas, el límite o
 *   el estado (cancelado, aplazado), avisa en el dashboard y por Telegram y, si
 *   la fecha la elegiste de la fuente, la actualiza en la nota del vault;
 * - manda recordatorios al chat principal: al empezar, el día antes y una hora
 *   antes (y al abrir, si no hay ninguna operación armada).
 *
 * Solo lee datos públicos de la fuente: nunca entra en la web de venta.
 */

import { FEED_EVENT_STATUS_LABEL, FEED_LABEL, watchStartMs, type CatalogEvent, type EventWatch, type FeedEvent, type FeedSnapshot } from '@to/shared';
import type { App } from '../app';
import type { AlertSeverity } from '@to/shared';
import type { TimerHandle } from '../util/clock';
import { log } from '../util/log';
import { iso } from '../util/time';
import { patchEventNote } from '../vault/writer';
import { FeedError, localDateTime } from './common';
import type { FeedControl } from './control';
import { parseTicketLimit } from './ticketmaster';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LIVE_STATES = new Set(['ARMED', 'FROZEN', 'RUNNING']);

export interface WatcherOptions {
  app: App;
  feeds: FeedControl;
  timeZone: string;
  /** Cada cuánto se revisa la lista de eventos vigilados. */
  tickMs?: number;
}

interface Change {
  text: string;
  severity: AlertSeverity;
  /** Propiedades de la nota que se actualizan con el dato oficial nuevo. */
  patch?: Record<string, unknown>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function snapshotOf(e: FeedEvent): FeedSnapshot {
  return {
    name: e.name,
    startsAt: e.startsAt,
    timeTBA: e.timeTBA,
    status: e.status,
    sales: e.sales.map((s) => ({ name: s.name, startsAt: s.startsAt })),
    saleTBD: e.saleTBD,
    limitText: e.limit.text,
  };
}

const sameMinute = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Math.abs(Date.parse(a) - Date.parse(b)) < MIN);

export class EventWatcher {
  private timer: TimerHandle | null = null;
  private soonTimer: TimerHandle | null = null;
  private unsubscribe: (() => void) | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private readonly opts: WatcherOptions) {}

  start(): void {
    if (this.timer !== null) return;
    const { clock } = this.opts.app.runtime.ctx;
    this.timer = clock.setInterval(() => void this.tick(), this.opts.tickMs ?? MIN);
    // Un evento nuevo o cambiado en el vault se mira al momento, sin esperar al minuto.
    this.unsubscribe = this.opts.app.runtime.hub.subscribe((m) => {
      if (m.type !== 'vault' || this.soonTimer !== null) return;
      this.soonTimer = clock.setTimeout(() => {
        this.soonTimer = null;
        void this.tick();
      }, 300);
    });
    void this.tick();
  }

  stop(): void {
    const { clock } = this.opts.app.runtime.ctx;
    if (this.timer !== null) clock.clearInterval(this.timer);
    if (this.soonTimer !== null) clock.clearTimeout(this.soonTimer);
    this.unsubscribe?.();
    this.timer = null;
    this.soonTimer = null;
    this.unsubscribe = null;
  }

  /** Una pasada por todos los eventos (el temporizador la lanza cada minuto). */
  tick(): Promise<void> {
    if (this.running) {
      // Algo ha cambiado mientras se revisaba: otra pasada al terminar.
      this.again = true;
      return this.running;
    }
    this.running = this.pass()
      .catch((err: Error) => log.warn('Error en la vigilancia de eventos', { error: err.message }))
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          void this.tick();
        }
      });
    return this.running;
  }

  private async pass(): Promise<void> {
    const { store } = this.opts.app.runtime;
    for (const event of [...store.events.values()]) await this.check(event);
    // Eventos que ya no están en el vault: fuera su vigilancia.
    for (const id of [...store.watches.keys()]) if (!store.events.has(id)) store.removeWatch(id);
  }

  private async check(event: CatalogEvent): Promise<void> {
    const { ctx, store } = this.opts.app.runtime;
    const days = event.watchDaysBefore ?? 0;
    const prev = store.watches.get(event.id) ?? null;
    if (days <= 0) {
      if (prev) store.removeWatch(event.id);
      return;
    }
    const now = ctx.now();
    const anchorKind: EventWatch['anchorKind'] = event.onSaleAt ? 'SALE' : 'EVENT';
    const anchorMs = Date.parse(event.onSaleAt ?? event.startsAt);
    // A la misma hora de reloj aunque entre medias cambie la hora.
    const fromMs = watchStartMs(anchorMs, days, this.opts.timeZone);
    const w: EventWatch = {
      eventId: event.id,
      eventName: event.name,
      feed: event.officialFeed,
      feedEventId: event.officialId,
      daysBefore: days,
      anchor: iso(anchorMs),
      anchorKind,
      from: iso(fromMs),
      state: now < fromMs ? 'WAITING' : now > anchorMs + HOUR ? 'DONE' : 'WATCHING',
      lastCheckAt: prev?.lastCheckAt ?? null,
      lastError: prev?.lastError ?? null,
      // Si se cambia el evento oficial vinculado, se empieza de cero.
      snapshot: prev && prev.feed === event.officialFeed && prev.feedEventId === event.officialId ? prev.snapshot : null,
      changes: prev?.changes ?? [],
      sent: prev?.sent ?? [],
      updatedAt: prev?.updatedAt ?? iso(now),
    };
    // Si la apertura se mueve, los recordatorios se vuelven a mandar para la hora nueva.
    if (prev && prev.anchor !== w.anchor) w.sent = w.sent.filter((k) => k === 'start');

    if (w.state === 'WATCHING') {
      if (!w.sent.includes('start')) {
        this.announce(event, this.startText(event, w, now), []);
        // El aviso de inicio ya dice cuándo es: el de «mañana» sobraría si llega a la vez.
        w.sent = [...w.sent, 'start', ...(anchorMs - now <= DAY ? ['day'] : [])];
      }
      if (w.feed && w.feedEventId && this.opts.feeds.configured(w.feed) && this.due(w, now, anchorMs)) await this.poll(event, w, now);
      this.reminders(event, w, now, anchorMs);
    }
    this.save(prev, w, now);
  }

  /** Cada 10 minutos; cada 2 en las 3 horas antes de la apertura. */
  private due(w: EventWatch, now: number, anchorMs: number): boolean {
    if (!w.lastCheckAt) return true;
    const every = anchorMs - now <= 3 * HOUR ? 2 * MIN : 10 * MIN;
    return now - Date.parse(w.lastCheckAt) >= every - 1000;
  }

  private async poll(event: CatalogEvent, w: EventWatch, now: number): Promise<void> {
    if (!w.feed || !w.feedEventId) return;
    const label = FEED_LABEL[w.feed];
    w.lastCheckAt = iso(now);
    let fresh: FeedEvent | null;
    try {
      fresh = await this.opts.feeds.lookup(w.feed, w.feedEventId);
    } catch (err) {
      w.lastError = err instanceof FeedError || err instanceof Error ? err.message : String(err);
      if (err instanceof FeedError && err.kind === 'AUTH' && !w.sent.includes('auth')) {
        w.sent = [...w.sent, 'auth'];
        this.alert(event, 'WARNING', `No puedo vigilar «${event.name}»`, `${w.lastError} Mientras tanto solo habrá recordatorios.`, 'auth');
      }
      return;
    }
    w.lastError = null;
    if (!fresh) {
      if (!w.sent.includes('gone')) {
        w.sent = [...w.sent, 'gone'];
        this.record(event, w, now, {
          text: `${label} ya no tiene este evento (¿retirado o cancelado?). Compruébalo en la web oficial.`,
          severity: 'CRITICAL',
        });
      }
      return;
    }
    const next = snapshotOf(fresh);
    if (w.snapshot) {
      const changes = this.diff(event, w.snapshot, next, fresh);
      const patch: Record<string, unknown> = {};
      for (const c of changes) Object.assign(patch, c.patch ?? {});
      const outcome = Object.keys(patch).length > 0 ? await this.applyPatch(event, patch) : null;
      const suffix =
        outcome === 'APPLIED'
          ? ' Ya está actualizado en el evento.'
          : outcome === 'WRITTEN'
            ? ' Ya está cambiado en la nota del evento, pero el vault tiene errores en otras notas y no se ha recargado: revisa «Recintos · vault».'
            : ' Actualízalo en el evento (no se pudo cambiar solo).';
      for (const c of changes) this.record(event, w, now, { ...c, text: c.patch ? c.text + suffix : c.text });
    }
    w.snapshot = next;
  }

  /** Qué ha cambiado entre dos consultas, en español y con la actualización de la nota si toca. */
  private diff(event: CatalogEvent, a: FeedSnapshot, b: FeedSnapshot, fresh: FeedEvent): Change[] {
    const out: Change[] = [];
    const when = (isoStr: string | null) => (isoStr ? this.fmt(isoStr) : 'sin fecha');
    const localOf = (isoStr: string) => localDateTime(Date.parse(isoStr), this.opts.timeZone);

    if (b.status !== a.status) {
      const bad = b.status === 'CANCELLED' || b.status === 'POSTPONED';
      out.push({
        text: `Estado oficial: ${FEED_EVENT_STATUS_LABEL[b.status]} (antes: ${FEED_EVENT_STATUS_LABEL[a.status]}).`,
        severity: bad ? 'CRITICAL' : b.status === 'RESCHEDULED' ? 'WARNING' : 'INFO',
      });
    }
    if (!sameMinute(a.startsAt, b.startsAt) || (a.timeTBA && !b.timeTBA)) {
      const confirmed = a.timeTBA && !b.timeTBA && b.startsAt;
      out.push({
        text: confirmed ? `Ya hay hora oficial: ${when(b.startsAt)}.` : `Nueva fecha del evento: ${when(b.startsAt)} (antes: ${when(a.startsAt)}).`,
        severity: 'WARNING',
        patch: b.startsAt && !b.timeTBA ? { startsAt: localOf(b.startsAt) } : undefined,
      });
    }
    const chosen = event.officialSale;
    const oldSales = new Map(a.sales.map((s) => [s.name, s.startsAt]));
    for (const s of b.sales) {
      const before = oldSales.get(s.name);
      const isChosen = chosen !== null && s.name === chosen;
      const patch = isChosen && s.startsAt ? { onSaleAt: localOf(s.startsAt) } : undefined;
      if (before === undefined) {
        out.push({ text: `Nueva fase de venta: ${s.name}, desde ${when(s.startsAt)}.`, severity: 'WARNING', patch });
      } else if (!sameMinute(before, s.startsAt)) {
        out.push({ text: `${s.name}: ahora abre ${when(s.startsAt)} (antes: ${when(before)}).`, severity: 'WARNING', patch });
      }
    }
    for (const s of a.sales) {
      if (!b.sales.some((x) => x.name === s.name)) out.push({ text: `Ya no aparece la fase de venta «${s.name}».`, severity: 'WARNING' });
    }
    if ((a.limitText ?? '') !== (b.limitText ?? '')) {
      const n0 = parseTicketLimit(a.limitText).perCustomer;
      const n1 = parseTicketLimit(b.limitText).perCustomer;
      const lower = n1 !== null && (n0 === null || n1 < n0) && n1 < event.limits.perAccount;
      out.push({
        text: `Límite de compra oficial: «${b.limitText ?? 'sin publicar'}» (antes: «${a.limitText ?? 'sin publicar'}»). El evento dice ${event.limits.perAccount} por cuenta: revísalo en Eventos.`,
        severity: lower ? 'CRITICAL' : 'WARNING',
      });
    }
    if (a.name !== b.name && out.length === 0) out.push({ text: `Nuevo nombre oficial: «${fresh.name}».`, severity: 'INFO' });
    return out;
  }

  /** Escribe el dato oficial nuevo en la nota y recarga el vault. */
  private async applyPatch(event: CatalogEvent, patch: Record<string, unknown>): Promise<'APPLIED' | 'WRITTEN' | 'FAILED'> {
    const { app } = this.opts;
    if (!app.vaultDir) return 'FAILED';
    try {
      await patchEventNote(app.vaultDir, event.sourceFile, patch);
    } catch (err) {
      log.warn('La vigilancia no pudo actualizar la nota del evento', { file: event.sourceFile, error: (err as Error).message });
      return 'FAILED';
    }
    app.runtime.ctx.journal.audit('vault.event_auto_updated', { eventId: event.id, file: event.sourceFile, patch }, { actor: 'vigilancia' });
    try {
      return (await app.compileAndApply()).applied ? 'APPLIED' : 'WRITTEN';
    } catch {
      return 'WRITTEN';
    }
  }

  private reminders(event: CatalogEvent, w: EventWatch, now: number, anchorMs: number): void {
    const left = anchorMs - now;
    const what = w.anchorKind === 'SALE' ? 'la venta' : 'el evento';
    const ops = this.operations(event);
    const armed = ops.some((o) => LIVE_STATES.has(o.state));
    const accountIds = [...new Set(ops.flatMap((o) => o.accountIds))];
    if (left <= DAY && left > 2 * HOUR && Date.parse(w.from) <= anchorMs - DAY && !w.sent.includes('day')) {
      w.sent = [...w.sent, 'day'];
      this.announce(event, `⏰ <b>Mañana: ${esc(event.name)}</b>\n${what === 'la venta' ? 'Abre la venta' : 'Es el evento'} el ${esc(this.fmt(iso(anchorMs)))}.`, accountIds);
    }
    if (left <= HOUR && left > 0 && !w.sent.includes('hour')) {
      w.sent = [...w.sent, 'hour'];
      const tail =
        w.anchorKind !== 'SALE'
          ? ''
          : armed
            ? '\nLa operación está armada: iniciad sesión en la web oficial y pulsad «✅ Sesión lista».'
            : '\n⚠️ Todavía no hay ninguna operación armada para este evento: créala y ármala en Operaciones.';
      this.announce(event, `⏰ <b>En 1 hora: ${esc(event.name)}</b>\n${what === 'la venta' ? 'Abre la venta' : 'Empieza'} a las ${esc(this.clock(iso(anchorMs)))}.${tail}`, accountIds);
    }
    if (w.anchorKind === 'SALE' && left <= 0 && !w.sent.includes('open')) {
      w.sent = [...w.sent, 'open'];
      // Con una operación armada, el aviso de apertura lo manda la propia operación.
      if (!armed) this.announce(event, `🔔 <b>Abre la venta: ${esc(event.name)}</b>\nNo hay operación armada: si vais a comprar, entrad ya en la web oficial.`, []);
    }
  }

  private operations(event: CatalogEvent): Array<{ state: string; accountIds: string[] }> {
    const out: Array<{ state: string; accountIds: string[] }> = [];
    for (const r of this.opts.app.runtime.store.operations.values()) {
      if (r.config.eventId === event.id) out.push({ state: r.state, accountIds: r.config.accountIds });
    }
    return out;
  }

  private startText(event: CatalogEvent, w: EventWatch, now: number): string {
    const what = w.anchorKind === 'SALE' ? 'La venta abre' : 'El evento es';
    const source = w.feed ? `Consulto ${FEED_LABEL[w.feed]} cada 10 minutos: si cambia la hora, las preventas, el límite o se cancela, te aviso aquí.` : 'Te recordaré la hora el día antes y una hora antes.';
    const noSale =
      w.anchorKind === 'EVENT'
        ? '\nTodavía no tiene hora de apertura de la venta: cuando se anuncie, ponla en Eventos → Editar (o vuelve a pulsar «📥 Enviar a la sala» en la página del evento).'
        : '';
    return `👀 <b>Vigilando: ${esc(event.name)}</b>\n${what} el ${esc(this.fmt(w.anchor))} (${esc(this.rel(Date.parse(w.anchor) - now))}).\n${esc(source)}${esc(noSale)}`;
  }

  /** Cambio detectado: queda en la vigilancia, como alerta en el dashboard y (si importa) en Telegram. */
  private record(event: CatalogEvent, w: EventWatch, now: number, c: Change): void {
    w.changes = [{ at: iso(now), text: c.text }, ...w.changes].slice(0, 20);
    w.updatedAt = iso(now);
    this.alert(event, c.severity, `${event.name}: cambio oficial`, c.text, `${now}:${w.changes.length}`);
    // Las alertas INFO no llegan a Telegram: este aviso sí debe llegar.
    if (c.severity === 'INFO') this.announce(event, `🔔 <b>${esc(event.name)}</b>\n${esc(c.text)}`, []);
  }

  private alert(event: CatalogEvent, severity: AlertSeverity, title: string, message: string, key: string): void {
    this.opts.app.runtime.ctx.alerts.raise({ kind: 'EVENT_WATCH', severity, title, message, dedupeKey: `watch:${event.id}:${key}` });
  }

  private announce(event: CatalogEvent, html: string, accountIds: string[]): void {
    this.opts.app.runtime.ctx.notifier?.announce?.(html, accountIds, event.url);
  }

  private save(prev: EventWatch | null, w: EventWatch, now: number): void {
    const { store } = this.opts.app.runtime;
    const strip = (x: EventWatch) => JSON.stringify({ ...x, updatedAt: '' });
    if (prev && strip(prev) === strip(w)) return;
    store.putWatch({ ...w, updatedAt: iso(now) });
  }

  private fmt(isoStr: string): string {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: this.opts.timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(isoStr));
  }

  private clock(isoStr: string): string {
    return new Intl.DateTimeFormat('es-ES', { timeZone: this.opts.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(isoStr));
  }

  private rel(ms: number): string {
    if (ms <= 0) return 'ya';
    const h = Math.round(ms / HOUR);
    if (h < 1) return `en ${Math.max(1, Math.round(ms / MIN))} min`;
    if (h < 48) return `en ${h} h`;
    return `en ${Math.round(ms / DAY)} días`;
  }
}
