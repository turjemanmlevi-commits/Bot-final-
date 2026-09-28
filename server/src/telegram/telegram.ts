/**
 * Telegram (opcional). Envía alertas importantes y tareas humanas con botones,
 * y acepta comandos básicos.
 *
 * - Se activa con TELEGRAM_BOT_TOKEN. Con TELEGRAM_CHAT_ID además hay un chat
 *   principal (tú o un grupo) que recibe todo y puede usar /pausa y /parar_todo.
 * - Cada cuenta puede tener su propio chat (telegramChatId): esa persona recibe
 *   sus tareas y puede responderlas, nada más.
 * - A cualquier otro chat que escriba al bot solo se le contesta con su chat ID,
 *   para que puedas configurarlo. No recibe nada ni puede mandar nada.
 */

import type { Alert, HumanTask, TelegramChatSeen, TelegramStatus } from '@to/shared';
import { formatMoney, OPERATION_STATE_LABEL } from '@to/shared';
import type { Notifier } from '../runtime/context';
import type { Runtime } from '../runtime/runtime';
import { log } from '../util/log';

interface TgChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TgUpdate {
  update_id: number;
  message?: { chat: TgChat; text?: string; from?: { username?: string; id: number; first_name?: string } };
  callback_query?: { id: string; data?: string; from: { username?: string; id: number }; message?: { chat: TgChat; message_id: number } };
}

type Button = { text: string; callback_data: string } | { text: string; url: string };

export interface TelegramOptions {
  token: string;
  /** Chat principal (TELEGRAM_CHAT_ID) o null si aún no se ha configurado. */
  chatId: string | null;
  /** Solo para pruebas: servidor que imita la Bot API. */
  apiBase?: string;
  timeZone?: string;
  /** Espera entre reintentos cuando Telegram no responde. */
  retryMs?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON: Record<Alert['severity'], string> = { INFO: 'ℹ️', WARNING: '⚠️', CRITICAL: '🚨' };
const ALWAYS_SEND = new Set<Alert['kind']>(['CART_SECURED', 'CART_CONFIRMED']);
const HELP =
  '<b>Ticket Orchestrator</b>\n' +
  '/estado — operaciones activas\n' +
  '/tareas — tareas humanas abiertas (con botones)\n' +
  '/pausa — pausa todo lo que está en marcha (solo chat principal)\n' +
  '/parar_todo — kill switch global (solo chat principal)\n' +
  '/id — muestra el chat ID de este chat';
const MAX_SEEN = 10;
const HINT_EVERY_MS = 30_000;

function chatName(chat: TgChat): string {
  if (chat.title) return chat.title;
  const full = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  if (full && chat.username) return `${full} (@${chat.username})`;
  return full || (chat.username ? `@${chat.username}` : `chat ${chat.id}`);
}

export class TelegramNotifier implements Notifier {
  readonly enabled = true;
  connected = false;
  detail = 'Conectando con Telegram…';
  private bot: string | null = null;
  private runtime: Runtime | null = null;
  private offset = 0;
  private stopped = false;
  private poller: AbortController | null = null;
  private readonly seen = new Map<string, TelegramChatSeen>();
  private readonly lastHint = new Map<string, number>();
  private readonly chatId: string | null;
  private readonly apiBase: string;
  private readonly timeZone: string;
  private readonly retryMs: number;

  constructor(private readonly opts: TelegramOptions) {
    this.chatId = opts.chatId;
    this.apiBase = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.timeZone = opts.timeZone ?? 'Europe/Madrid';
    this.retryMs = opts.retryMs ?? 5000;
  }

  attach(runtime: Runtime): void {
    this.runtime = runtime;
    void this.check();
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    this.poller?.abort();
  }

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------

  status(): TelegramStatus {
    const known = this.allowedChats();
    return {
      enabled: true,
      connected: this.connected,
      detail: this.detail,
      bot: this.bot,
      mainChatConfigured: this.chatId !== null,
      recentChats: [...this.seen.values()].map((c) => ({ ...c, known: known.has(c.chatId) })).sort((a, b) => b.at.localeCompare(a.at)),
    };
  }

  private refreshDetail(): void {
    if (!this.bot) return;
    this.detail = this.chatId
      ? `@${this.bot} · chat principal ${this.chatId}`
      : `@${this.bot} conectado, pero falta TELEGRAM_CHAT_ID: escribe /start al bot para ver tu chat ID`;
  }

  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(`${this.apiBase}/bot${this.opts.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    let json: { ok: boolean; result: T; description?: string; error_code?: number };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      throw new Error(`Telegram respondió ${res.status} sin JSON`);
    }
    if (!json.ok) {
      if (json.error_code === 401) throw new Error('Token no válido: revisa TELEGRAM_BOT_TOKEN en .env');
      throw new Error(json.description ?? `Telegram ${method} falló (${res.status})`);
    }
    return json.result;
  }

  private async check(): Promise<void> {
    try {
      const me = await this.api<{ username: string }>('getMe', {});
      this.bot = me.username;
      this.connected = true;
      this.refreshDetail();
      log.info(this.chatId ? `Telegram conectado: @${me.username}` : `Telegram: @${me.username} conectado. Falta TELEGRAM_CHAT_ID: escribe /start al bot y te dirá tu chat ID.`);
    } catch (err) {
      this.connected = false;
      this.detail = `Sin conexión: ${(err as Error).message}`;
      log.warn('Telegram: no se pudo comprobar el bot', { error: (err as Error).message });
    }
  }

  private async sendNow(chatId: string, text: string, keyboard?: Button[][]): Promise<void> {
    await this.api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  private send(chatId: string, text: string, keyboard?: Button[][]): void {
    void this.sendNow(chatId, text, keyboard).catch((err: Error) => {
      this.detail = `Error enviando a ${chatId}: ${err.message}`;
      log.warn('Telegram: no se pudo enviar', { chatId, error: err.message });
    });
  }

  async sendTest(chatId?: string | null): Promise<{ ok: boolean; message: string }> {
    const target = chatId?.trim() || this.chatId;
    if (!target) return { ok: false, message: 'No hay chat principal: añade TELEGRAM_CHAT_ID al archivo .env (escribe /start al bot para verlo) y reinicia.' };
    try {
      await this.sendNow(
        target,
        '✅ <b>Prueba del Ticket Orchestrator</b>\nEste chat recibirá las alertas importantes y las tareas con botones. Escribe /ayuda para ver los comandos.',
      );
      this.connected = true;
      this.refreshDetail();
      return { ok: true, message: `Mensaje de prueba enviado al chat ${target}.` };
    } catch (err) {
      const message = (err as Error).message;
      return {
        ok: false,
        message: /chat not found/i.test(message)
          ? `Telegram no encuentra el chat ${target}: abre el bot en Telegram, pulsa Iniciar (/start) y vuelve a probar.`
          : `No se pudo enviar: ${message}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Notificaciones
  // ---------------------------------------------------------------------------

  private chatsFor(accountId: string | null): string[] {
    const chats = new Set<string>();
    if (this.chatId) chats.add(this.chatId);
    const personal = accountId ? this.runtime?.store.accounts.get(accountId)?.telegramChatId : null;
    if (personal) chats.add(personal);
    return [...chats];
  }

  notifyAlert(alert: Alert): void {
    if (alert.severity === 'INFO' && !ALWAYS_SEND.has(alert.kind)) return;
    if (alert.kind === 'HUMAN_TASK') return; // la tarea llega con sus propios botones
    const text = `${ICON[alert.severity]} <b>${esc(alert.title)}</b>\n${esc(alert.message)}`;
    for (const chat of this.chatsFor(alert.accountId)) this.send(chat, text);
  }

  private clock(iso: string): string {
    return new Intl.DateTimeFormat('es-ES', { timeZone: this.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  taskMessage(task: HumanTask): { text: string; keyboard: Button[][] } {
    const account = this.runtime?.store.accounts.get(task.accountId);
    const lines = [`🧑 <b>${esc(task.title)}</b>`, `Cuenta: ${esc(account?.label ?? task.accountId)}`];
    if (task.target) {
      lines.push(`🎯 ${task.target.qty} × ${esc(task.target.sectionLabel)} · máx. ${formatMoney(task.target.maxUnitPrice, task.target.currency)} por entrada`);
    }
    if (task.deadlineAt) lines.push(`⏱ Responde antes de las ${this.clock(task.deadlineAt)}`);
    lines.push('', esc(task.instructions));
    if (task.kind !== 'OPEN_SESSION') {
      lines.push('', '<i>«En carrito» desde aquí asume la cantidad pedida al precio máximo; para indicar lo real, responde en el dashboard.</i>');
    }
    const keyboard: Button[][] = [];
    if (task.link) keyboard.push([{ text: '🌐 Abrir la web oficial', url: task.link }]);
    if (task.kind === 'OPEN_SESSION') {
      keyboard.push([
        { text: '✅ Sesión lista', callback_data: `t:${task.id}:READY` },
        { text: '❌ No puedo', callback_data: `t:${task.id}:FAILED` },
      ]);
    } else {
      keyboard.push([{ text: '✅ En carrito', callback_data: `t:${task.id}:IN_CART` }]);
      keyboard.push([
        { text: '❌ No pude', callback_data: `t:${task.id}:FAILED` },
        { text: '❓ No sé', callback_data: `t:${task.id}:UNKNOWN` },
      ]);
    }
    return { text: lines.join('\n'), keyboard };
  }

  notifyTask(task: HumanTask): void {
    const { text, keyboard } = this.taskMessage(task);
    for (const chat of this.chatsFor(task.accountId)) this.send(chat, text, keyboard);
  }

  // ---------------------------------------------------------------------------
  // Mensajes entrantes
  // ---------------------------------------------------------------------------

  private allowedChats(): Set<string> {
    const s = new Set<string>();
    if (this.chatId) s.add(this.chatId);
    for (const a of this.runtime?.store.accounts.values() ?? []) if (a.telegramChatId) s.add(a.telegramChatId);
    return s;
  }

  private remember(chat: TgChat): void {
    const id = String(chat.id);
    this.seen.delete(id);
    this.seen.set(id, { chatId: id, name: chatName(chat), at: new Date().toISOString(), known: false });
    while (this.seen.size > MAX_SEEN) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      this.poller = new AbortController();
      try {
        const updates = await this.api<TgUpdate[]>(
          'getUpdates',
          { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
          35_000,
          this.poller.signal,
        );
        if (!this.connected && this.bot) {
          this.connected = true;
          this.refreshDetail();
        }
        for (const u of updates) {
          if (this.stopped) break;
          this.offset = Math.max(this.offset, u.update_id + 1);
          await this.handle(u).catch((err: Error) => log.warn('Telegram: error procesando un mensaje', { error: err.message }));
        }
      } catch (err) {
        if (this.stopped) break;
        const message = (err as Error).message;
        this.connected = false;
        this.detail = /Conflict/i.test(message)
          ? 'Otro programa está leyendo este bot (¿hay dos servidores abiertos?). Cierra el otro.'
          : `Sin conexión: ${message}`;
        await new Promise((r) => setTimeout(r, this.retryMs));
        if (!this.bot && !this.stopped) await this.check();
      }
    }
  }

  private hint(chat: TgChat): void {
    const id = String(chat.id);
    const now = Date.now();
    if (now - (this.lastHint.get(id) ?? 0) < HINT_EVERY_MS) return;
    this.lastHint.set(id, now);
    log.info(`Telegram: el chat ${id} (${chatName(chat)}) ha escrito al bot`);
    this.send(
      id,
      `👋 Este bot es privado de un Ticket Orchestrator.\n\nEl chat ID de este chat es: <code>${id}</code>\n\n` +
        '• Si gestionas el sistema: pon <code>TELEGRAM_CHAT_ID=' +
        id +
        '</code> en el archivo .env y reinicia.\n' +
        '• Si tienes una cuenta en el grupo: pásale este número a quien lo gestiona para que lo ponga en tu cuenta (Cuentas → editar → Chat de Telegram).',
    );
  }

  async handle(u: TgUpdate): Promise<void> {
    const rt = this.runtime;
    if (!rt || this.stopped) return;
    const allowed = this.allowedChats();
    if (u.callback_query) {
      const q = u.callback_query;
      const chat = q.message ? String(q.message.chat.id) : '';
      if (!allowed.has(chat)) {
        await this.api('answerCallbackQuery', { callback_query_id: q.id, text: 'Este chat no está autorizado.' }).catch(() => undefined);
        return;
      }
      const [kind, taskId, result] = (q.data ?? '').split(':');
      if (kind !== 't' || !taskId || !result) return;
      const task = rt.store.humanTasks.get(taskId);
      const actor = `telegram:${q.from.username ?? q.from.id}`;
      let text = 'Hecho ✅';
      try {
        if (!task) throw new Error('La tarea ya no existe');
        // Un chat personal solo responde tareas de su propia cuenta.
        const account = rt.store.accounts.get(task.accountId);
        if (chat !== this.chatId && account?.telegramChatId !== chat) throw new Error('Esta tarea es de otra cuenta');
        if (result === 'IN_CART') {
          rt.ctx.tasks.respond(
            taskId,
            {
              result: 'IN_CART',
              qty: task.target?.qty ?? 1,
              unitPrice: task.target?.maxUnitPrice ?? 1,
              note: 'Confirmado por Telegram: cantidad pedida al precio máximo (corrígelo en el dashboard si fue distinto)',
            },
            actor,
          );
        } else if (result === 'READY' || result === 'FAILED' || result === 'UNKNOWN') {
          rt.ctx.tasks.respond(taskId, { result }, actor);
        } else {
          throw new Error('Respuesta desconocida');
        }
      } catch (err) {
        text = (err as Error).message;
      }
      await this.api('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => undefined);
      if (q.message) {
        await this.api('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(
          () => undefined,
        );
      }
      return;
    }
    const m = u.message;
    if (!m) return;
    this.remember(m.chat);
    const chat = String(m.chat.id);
    const cmd = (m.text ?? '').trim().split(/\s+/)[0]?.toLowerCase().replace(/@.*$/, '') ?? '';
    if (cmd === '/id') {
      this.send(chat, `El chat ID de este chat es: <code>${chat}</code>`);
      return;
    }
    if (!allowed.has(chat)) {
      this.hint(m.chat);
      return;
    }
    const main = chat === this.chatId;
    if (cmd === '/estado') {
      const ops = rt.ctx.ops.summaries().filter((o) => !['CLOSED', 'CANCELLED'].includes(o.state));
      const lines = ops.map((o) => `• <b>${esc(o.name)}</b>: ${OPERATION_STATE_LABEL[o.state]} · ${o.cartedQty}/${o.requestedQty} en carrito`);
      this.send(chat, lines.length ? lines.join('\n') : 'No hay operaciones activas.');
    } else if (cmd === '/tareas') {
      const mine = (t: HumanTask) => main || rt.store.accounts.get(t.accountId)?.telegramChatId === chat;
      const tasks = [...rt.store.humanTasks.values()].filter((t) => t.state === 'OPEN' && mine(t));
      if (tasks.length === 0) {
        this.send(chat, 'No hay tareas abiertas.');
        return;
      }
      for (const t of tasks) {
        const { text, keyboard } = this.taskMessage(t);
        this.send(chat, text, keyboard);
      }
    } else if (cmd === '/pausa' || cmd === '/parar_todo') {
      if (!main) {
        this.send(chat, 'Solo el chat principal puede pausar o parar operaciones.');
        return;
      }
      if (cmd === '/pausa') {
        let n = 0;
        for (const o of rt.ctx.ops.summaries()) {
          if (o.state !== 'RUNNING') continue;
          const r = await rt.ctx.ops.command(o.id, { command: 'pause', reason: 'Telegram /pausa' }, 'telegram');
          if (r.ok) n++;
        }
        this.send(chat, n > 0 ? `⏸ ${n} operación${n === 1 ? '' : 'es'} pausada${n === 1 ? '' : 's'}.` : 'No había operaciones en marcha.');
      } else {
        rt.ctx.safety.setKillSwitch('GLOBAL', null, true, 'Telegram /parar_todo', 'telegram');
        this.send(chat, '🛑 Kill switch GLOBAL activado: no se envía ninguna acción automática. Suéltalo desde el dashboard (Seguridad).');
      }
    } else if (cmd === '/ayuda' || cmd === '/start' || cmd === '/help') {
      this.send(chat, HELP);
    }
  }
}
