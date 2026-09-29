/**
 * Telegram (opcional). Envía alertas importantes y tareas humanas con botones,
 * y acepta comandos básicos.
 *
 * - Se activa con el token del bot (Ajustes · Telegram en el dashboard, o
 *   TELEGRAM_BOT_TOKEN en .env). El chat principal (tú o un grupo) recibe todo y
 *   puede usar /pausa y /parar_todo.
 * - Cada cuenta puede tener su propio chat (telegramChatId): esa persona recibe
 *   sus tareas y puede responderlas, nada más.
 * - A cualquier otro chat que escriba al bot solo se le contesta con su chat ID,
 *   para que puedas configurarlo. No recibe nada ni puede mandar nada.
 * - Al conectar, el bot se configura solo: menú de comandos y descripción.
 */

import type { Account, Alert, HumanTask, TelegramChatSeen, TelegramStatus } from '@to/shared';
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
  /** Poner el menú de comandos y la descripción del bot al conectar (por defecto sí). */
  setupProfile?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON: Record<Alert['severity'], string> = { INFO: 'ℹ️', WARNING: '⚠️', CRITICAL: '🚨' };
const ALWAYS_SEND = new Set<Alert['kind']>(['CART_SECURED', 'CART_CONFIRMED']);

/** Cómo responder rápido (/ayuda, /start y bienvenida). */
export const HELP =
  '<b>Cómo ir rápido</b>\n' +
  '1. Antes de la venta llega el <b>plan</b>: hora, zonas en orden, entradas y precio máximo.\n' +
  '2. Inicia sesión en la web oficial y pulsa <b>✅ Sesión lista</b>.\n' +
  '3. A la hora exacta llega <b>¡Abre la venta!</b> y tu tarea con el botón <b>🌐 Abrir la web oficial</b>.\n' +
  '4. Con las entradas en el carrito pulsa <b>✅ N en carrito</b> y los minutos que le quedan. Si no hay por ese precio, <b>❌ No pude</b>: la siguiente zona llega al instante.\n' +
  '5. Paga en la web oficial y pulsa <b>💳 Ya lo he pagado</b>.\n\n' +
  '<b>Comandos</b>\n' +
  '/tareas — tus tareas abiertas, con botones\n' +
  '/estado — cómo va cada operación\n' +
  '/pausa — pausar lo que está en marcha (chat principal)\n' +
  '/parar_todo — parar todo al instante (chat principal)\n' +
  '/id — número de este chat';

/** Menú de comandos que se pone en el bot al conectar (setMyCommands). */
export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'tareas', description: 'Tus tareas abiertas, con botones' },
  { command: 'estado', description: 'Cómo va cada operación' },
  { command: 'ayuda', description: 'Cómo responder rápido' },
  { command: 'pausa', description: 'Pausar lo que está en marcha (chat principal)' },
  { command: 'parar_todo', description: 'Parar todo al instante (chat principal)' },
  { command: 'id', description: 'Número de este chat' },
];

/** Texto que ve quien abre el bot por primera vez («¿Qué puede hacer este bot?»). */
export const BOT_DESCRIPTION =
  'Bot privado de la sala de control para comprar entradas en la web oficial (Real Madrid, Ticketmaster, entradas.com).\n\n' +
  'Avisa en el segundo exacto en que abre la venta y dice a cada persona qué zona intentar, cuántas entradas y hasta qué precio. Se responde con un toque.\n\n' +
  'Pulsa «Iniciar»: te dirá el número de este chat para darte de alta.';

export const BOT_SHORT_DESCRIPTION = 'Avisos al segundo y tareas con botones para comprar entradas en la web oficial.';

const MAX_SEEN = 10;
const HINT_EVERY_MS = 30_000;

interface TgResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}

/** Llamada a la Bot API. El token nunca aparece en los mensajes de error. */
async function callTelegram<T>(apiBase: string, token: string, method: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const redact = (m: string) => m.split(token).join('<token>');
  let res: Response;
  try {
    res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch (err) {
    throw new Error(redact((err as Error).message));
  }
  let json: TgResponse<T>;
  try {
    json = (await res.json()) as TgResponse<T>;
  } catch {
    throw new Error(`Telegram respondió ${res.status} sin JSON`);
  }
  if (!json.ok) {
    if (json.error_code === 401 || json.error_code === 404) throw new Error('Token no válido: pega el token correcto en Ajustes · Telegram');
    throw new Error(redact(json.description ?? `Telegram ${method} falló (${res.status})`));
  }
  return json.result;
}

/** Comprueba un token con getMe antes de guardarlo. */
export async function probeTelegramToken(apiBase: string, token: string): Promise<{ ok: true; username: string } | { ok: false; message: string }> {
  try {
    const me = await callTelegram<{ username?: string; is_bot?: boolean }>(apiBase.replace(/\/+$/, ''), token, 'getMe', {}, 10_000);
    if (!me.username) return { ok: false, message: 'Telegram no ha devuelto el nombre del bot: vuelve a intentarlo.' };
    return { ok: true, username: me.username };
  } catch (err) {
    const message = (err as Error).message;
    if (/Token no válido/.test(message)) {
      return {
        ok: false,
        message: 'Telegram no reconoce ese token. Cópialo otra vez entero del mensaje de @BotFather (la línea larga debajo de «Use this token to access the HTTP API»).',
      };
    }
    return { ok: false, message: `No se pudo conectar con Telegram (${message}). Comprueba la conexión a Internet y vuelve a probar.` };
  }
}

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
  /** Mensajes con botones de cada tarea (para quitarlos en todos los chats al cerrarse). */
  private readonly taskMessages = new Map<string, Array<{ chatId: string; messageId: number }>>();
  private readonly lastHint = new Map<string, number>();
  private chatId: string | null;
  private profileDone = false;
  private webhookCleared = false;
  /** Primera comprobación del token (getMe) terminada. */
  private checked: Promise<void> = Promise.resolve();
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
    this.checked = this.check();
    void this.poll();
  }

  /** Espera a la primera comprobación del bot (como mucho `ms`). */
  async ready(ms = 5000): Promise<void> {
    await Promise.race([this.checked, new Promise((r) => setTimeout(r, ms))]);
  }

  /** Cambia el chat principal al momento (lo elige el dashboard). */
  setMainChat(chatId: string | null): void {
    this.chatId = chatId;
    this.refreshDetail();
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
      mainChatId: this.chatId,
      recentChats: [...this.seen.values()].map((c) => ({ ...c, known: known.has(c.chatId) })).sort((a, b) => b.at.localeCompare(a.at)),
      configurable: false,
    };
  }

  private refreshDetail(): void {
    if (!this.bot) return;
    this.detail = this.chatId
      ? `@${this.bot} · chat principal ${this.chatId}`
      : `@${this.bot} conectado. Falta el chat principal: abre el bot en Telegram, pulsa «Iniciar» y elígelo en Ajustes · Telegram`;
  }

  private api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000, signal?: AbortSignal): Promise<T> {
    return callTelegram<T>(this.apiBase, this.opts.token, method, body, timeoutMs, signal);
  }

  private async check(): Promise<void> {
    try {
      const me = await this.api<{ username: string }>('getMe', {});
      this.bot = me.username;
      this.connected = true;
      this.refreshDetail();
      log.info(
        this.chatId
          ? `Telegram conectado: @${me.username}`
          : `Telegram: @${me.username} conectado. Falta el chat principal: abre el bot, pulsa «Iniciar» y elígelo en Ajustes · Telegram.`,
      );
      void this.setupProfile();
    } catch (err) {
      this.connected = false;
      this.detail = `Sin conexión: ${(err as Error).message}`;
      log.warn('Telegram: no se pudo comprobar el bot', { error: (err as Error).message });
    }
  }

  /** Menú de comandos y descripción del bot, una vez por conexión. Si falla, el bot funciona igual. */
  private async setupProfile(): Promise<void> {
    if (this.profileDone || this.stopped || this.opts.setupProfile === false) return;
    this.profileDone = true;
    try {
      await this.api('setMyCommands', { commands: BOT_COMMANDS });
      await this.api('setMyDescription', { description: BOT_DESCRIPTION });
      await this.api('setMyShortDescription', { short_description: BOT_SHORT_DESCRIPTION });
    } catch (err) {
      log.warn('Telegram: no se pudo poner el menú de comandos del bot (no afecta a los avisos)', { error: (err as Error).message });
    }
  }

  private async sendNow(chatId: string, text: string, keyboard?: Button[][]): Promise<{ message_id?: number } | undefined> {
    return this.api<{ message_id?: number }>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  private send(chatId: string, text: string, keyboard?: Button[][], onSent?: (messageId: number) => void): void {
    void this.sendNow(chatId, text, keyboard).then((r) => {
      if (onSent && typeof r?.message_id === 'number') onSent(r.message_id);
    }).catch((err: Error) => {
      this.detail = `Error enviando a ${chatId}: ${err.message}`;
      log.warn('Telegram: no se pudo enviar', { chatId, error: err.message });
    });
  }

  /** Envía y espera la respuesta de Telegram, con el error explicado. */
  private async deliver(target: string, text: string): Promise<{ ok: boolean; message: string }> {
    try {
      await this.sendNow(target, text);
      this.connected = true;
      this.refreshDetail();
      return { ok: true, message: `Mensaje enviado al chat ${target}.` };
    } catch (err) {
      const message = (err as Error).message;
      return {
        ok: false,
        message: /chat not found|bot was blocked|user is deactivated/i.test(message)
          ? `Telegram no deja escribir al chat ${target}: abre el bot en Telegram, pulsa «Iniciar» (/start) y vuelve a probar.`
          : `No se pudo enviar: ${message}`,
      };
    }
  }

  async sendTest(chatId?: string | null): Promise<{ ok: boolean; message: string }> {
    const target = chatId?.trim() || this.chatId;
    if (!target) return { ok: false, message: 'No hay chat principal: abre el bot en Telegram, pulsa «Iniciar» y elige tu chat en Ajustes · Telegram.' };
    const r = await this.deliver(
      target,
      '✅ <b>Prueba de la sala de control</b>\nEste chat recibirá las alertas importantes y las tareas con botones. Escribe /ayuda para ver cómo responder rápido.',
    );
    return r.ok ? { ok: true, message: `Mensaje de prueba enviado al chat ${target}.` } : r;
  }

  /** Bienvenida al chat que se acaba de elegir como principal. */
  welcomeMain(chatId: string): Promise<{ ok: boolean; message: string }> {
    return this.deliver(
      chatId,
      '✅ <b>Este es el chat principal de la sala de control</b>\n' +
        'Aquí llega todo: el plan de cada compra, «¡Abre la venta!», las tareas de cada cuenta con botones, los avisos de carrito y «¡entradas aseguradas!».\n\n' +
        HELP,
    );
  }

  /** Una cuenta acaba de quedar vinculada a un chat: se le explica qué va a recibir. */
  accountLinked(account: Account): void {
    if (!account.telegramChatId) return;
    this.send(
      account.telegramChatId,
      `✅ <b>Este chat es el de la cuenta «${esc(account.label)}»</b>\n` +
        'Aquí te llegarán tu plan, el aviso «¡Abre la venta!» y tus tareas con botones. Ten la web oficial abierta con la sesión iniciada y responde con un toque.\n\n' +
        HELP,
    );
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
    // Carrito a punto de caducar (o tiempo agotado): se responde con un toque.
    const cart = alert.cartId ? this.runtime?.store.carts.get(alert.cartId) : undefined;
    const keyboard: Button[][] | undefined =
      alert.kind === 'CART_EXPIRING' && cart && (cart.state === 'ACTIVE' || cart.state === 'REVIEW_REQUIRED')
        ? [
            [{ text: '💳 Ya lo he pagado', callback_data: `p:${cart.id}` }],
            [5, 10, 15].map((m) => ({ text: `⏱ Quedan ${m} min`, callback_data: `x:${cart.id}:${m}` })),
          ]
        : undefined;
    for (const chat of this.chatsFor(alert.accountId)) this.send(chat, text, keyboard);
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
      lines.push('', '<i>Pulsa cuántas tienes en el carrito (se anota al precio máximo; el precio exacto se puede indicar en el dashboard).</i>');
    }
    const keyboard: Button[][] = [];
    if (task.link) keyboard.push([{ text: '🌐 Abrir la web oficial', url: task.link }]);
    if (task.kind === 'OPEN_SESSION') {
      keyboard.push([
        { text: '✅ Sesión lista', callback_data: `t:${task.id}:READY` },
        { text: '❌ No puedo', callback_data: `t:${task.id}:FAILED` },
      ]);
    } else {
      // Un botón por cantidad: si solo entran algunas, el sistema sigue buscando las que faltan.
      const max = Math.max(1, Math.min(20, task.target?.qty ?? 1));
      const counts = Array.from({ length: max }, (_, i) => max - i);
      for (let i = 0; i < counts.length; i += 5) {
        keyboard.push(counts.slice(i, i + 5).map((n) => ({ text: `✅ ${n} en carrito`, callback_data: `t:${task.id}:IN_CART:${n}` })));
      }
      keyboard.push([
        { text: '❌ No pude', callback_data: `t:${task.id}:FAILED` },
        { text: '❓ No sé', callback_data: `t:${task.id}:UNKNOWN` },
      ]);
    }
    return { text: lines.join('\n'), keyboard };
  }

  announce(text: string, accountIds: string[], link?: string | null): void {
    const chats = new Set<string>();
    if (this.chatId) chats.add(this.chatId);
    for (const id of accountIds) {
      const personal = this.runtime?.store.accounts.get(id)?.telegramChatId;
      if (personal) chats.add(personal);
    }
    const keyboard: Button[][] | undefined = link ? [[{ text: '🌐 Abrir la web oficial', url: link }]] : undefined;
    for (const chat of chats) this.send(chat, text, keyboard);
  }

  notifyTask(task: HumanTask): void {
    const { text, keyboard } = this.taskMessage(task);
    for (const chat of this.chatsFor(task.accountId)) this.send(chat, text, keyboard, (messageId) => this.trackTaskMessage(task.id, chat, messageId));
  }

  private trackTaskMessage(taskId: string, chatId: string, messageId: number): void {
    const list = this.taskMessages.get(taskId) ?? [];
    list.push({ chatId, messageId });
    this.taskMessages.set(taskId, list);
    if (this.taskMessages.size > 500) {
      const oldest = this.taskMessages.keys().next().value;
      if (oldest !== undefined) this.taskMessages.delete(oldest);
    }
  }

  /** La tarea se cerró (dashboard, Telegram o sistema): fuera los botones en todos los chats. */
  taskClosed(task: HumanTask): void {
    const list = this.taskMessages.get(task.id);
    if (!list) return;
    this.taskMessages.delete(task.id);
    for (const m of list) {
      void this.api('editMessageReplyMarkup', { chat_id: m.chatId, message_id: m.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
    }
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
        if (/webhook/i.test(message) && !this.webhookCleared) {
          // El bot tenía un webhook de otro programa: sin quitarlo no llegan los botones.
          this.webhookCleared = true;
          log.warn('Telegram: el bot tenía un webhook puesto; se quita para recibir los mensajes aquí');
          await this.api('deleteWebhook', {}).catch(() => undefined);
          continue;
        }
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
      `👋 <b>Hola, soy el bot de la sala de control.</b>\nEl número de este chat es: <code>${id}</code>\n\n` +
        '• Si gestionas la sala: en el dashboard, <b>Ajustes · Telegram</b>, pulsa «Usar como chat principal» junto a tu nombre.\n' +
        '• Si vas a comprar con una cuenta: pásale este número a quien gestiona la sala (lo pone en Ajustes · Telegram o en Cuentas → Chat de Telegram). Cuando te dé de alta te llegará un mensaje aquí.',
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
      const [kind, ref, result, extra] = (q.data ?? '').split(':');
      const actor = `telegram:${q.from.username ?? q.from.id}`;
      if (kind === 'p' && ref) {
        // «Ya lo he pagado» (en la web oficial).
        let text = 'Pagado ✅';
        try {
          const cart = rt.store.carts.get(ref);
          if (!cart) throw new Error('El carrito ya no existe');
          const account = rt.store.accounts.get(cart.accountId);
          if (chat !== this.chatId && account?.telegramChatId !== chat) throw new Error('Este carrito es de otra cuenta');
          rt.ctx.carts.mark(cart.id, 'PAID', actor, 'Pagado (confirmado por Telegram)');
          text = `Pagado ✅ (${cart.qty} entrada${cart.qty === 1 ? '' : 's'})`;
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
      if (kind === 'x' && ref && result) {
        // Minutos que le quedan al carrito (pregunta tras «en carrito»).
        let text = 'Anotado ✅';
        let keep: Button[][] = [];
        try {
          const cart = rt.store.carts.get(ref);
          if (!cart) throw new Error('El carrito ya no existe');
          const account = rt.store.accounts.get(cart.accountId);
          if (chat !== this.chatId && account?.telegramChatId !== chat) throw new Error('Este carrito es de otra cuenta');
          const minutes = Number(result);
          if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error('Minutos no válidos');
          rt.ctx.carts.setExpiry(cart.id, new Date(rt.ctx.now() + minutes * 60_000).toISOString(), actor);
          text = `Te avisaremos antes de que caduque (${minutes} min).`;
          keep = [[{ text: '💳 Ya lo he pagado', callback_data: `p:${cart.id}` }]];
        } catch (err) {
          text = (err as Error).message;
        }
        await this.api('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => undefined);
        if (q.message) {
          // Queda solo «Ya lo he pagado».
          await this.api('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: keep } }).catch(
            () => undefined,
          );
        }
        return;
      }
      const taskId = ref;
      if (kind !== 't' || !taskId || !result) return;
      const task = rt.store.humanTasks.get(taskId);
      let text = 'Hecho ✅';
      try {
        if (!task) throw new Error('La tarea ya no existe');
        // Un chat personal solo responde tareas de su propia cuenta.
        const account = rt.store.accounts.get(task.accountId);
        if (chat !== this.chatId && account?.telegramChatId !== chat) throw new Error('Esta tarea es de otra cuenta');
        if (result === 'IN_CART') {
          const wanted = task.target?.qty ?? 1;
          const n = extra === undefined ? wanted : Number(extra);
          if (!Number.isInteger(n) || n < 1 || n > wanted) throw new Error('Cantidad no válida');
          const done = rt.ctx.tasks.respond(
            taskId,
            {
              result: 'IN_CART',
              qty: n,
              unitPrice: task.target?.maxUnitPrice ?? 1,
              note: `Confirmado por Telegram: ${n} en carrito, anotadas al precio máximo`,
            },
            actor,
          );
          text = `Anotadas ${n} en carrito ✅`;
          const cartId = done.claimId ? rt.store.claims.get(done.claimId)?.cartId : null;
          if (cartId) {
            this.send(chat, '⏱ ¿Cuántos minutos le quedan al carrito en la web? Te avisaremos antes de que caduque. Cuando lo pagues, pulsa «Ya lo he pagado».', [
              [5, 8, 10, 15, 20].map((m) => ({ text: `${m} min`, callback_data: `x:${cartId}:${m}` })),
              [{ text: '💳 Ya lo he pagado', callback_data: `p:${cartId}` }],
            ]);
          }
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
