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
 * - Los mensajes de cada chat salen en orden, por conexiones ya abiertas y
 *   reintentando si Telegram falla o pide esperar: una tarea no se pierde.
 */

import http from 'node:http';
import https from 'node:https';
import type { Account, AiStatus, Alert, Cart, HumanTask, TelegramChatSeen, TelegramStatus } from '@to/shared';
import { formatMoney, OPERATION_STATE_LABEL } from '@to/shared';
import type { Notifier } from '../runtime/context';
import { seedRealTest } from '../runtime/prueba';
import type { Runtime } from '../runtime/runtime';
import { log } from '../util/log';
import { TelegramEventFlow } from './event-flow';

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
  /** Plazo de cada intento de envío de un mensaje (por defecto 5 s; después se reintenta). */
  sendTimeoutMs?: number;
  /** Mensajes por segundo como mucho, sumando todos los chats (por defecto 25; Telegram admite ~30). */
  sendsPerSecond?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON: Record<Alert['severity'], string> = { INFO: 'ℹ️', WARNING: '⚠️', CRITICAL: '🚨' };
const ALWAYS_SEND = new Set<Alert['kind']>(['CART_SECURED', 'CART_CONFIRMED']);

/**
 * Enlace que se puede poner en un botón: http(s) y un servidor público. Telegram
 * rechaza el mensaje entero si un botón apunta a localhost, a una IP o a un nombre
 * sin punto (el carrito del simulador en el PC): esos van como texto.
 */
export function buttonUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const isPublic = host.includes('.') && !/(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(host) && !/^[\d.]+$/.test(host) && !host.includes(':');
    return (u.protocol === 'https:' || u.protocol === 'http:') && isPublic ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Cómo responder rápido (/ayuda, /start y bienvenida). */
export const HELP =
  '<b>Cómo ir rápido</b>\n' +
  '1. Antes de la venta llega el <b>plan</b>: hora, zonas en orden, entradas y precio máximo.\n' +
  '2. Inicia sesión en la web oficial y pulsa <b>✅ Sesión lista</b>.\n' +
  '3. A la hora exacta llega <b>¡Abre la venta!</b> y tu tarea con el botón <b>🌐 Abrir la web oficial</b>.\n' +
  '4. Con las entradas en el carrito pulsa <b>✅ N en carrito</b> y los minutos que le quedan. Si no hay por ese precio, <b>❌ No pude</b>: la siguiente zona llega al instante.\n' +
  '5. Paga en la web oficial y pulsa <b>💳 Ya lo he pagado</b>.\n\n' +
  '<b>Comandos</b>\n' +
  '/evento — crear un evento con Claude: web de venta → evento → dónde sentaros (chat principal)\n' +
  '/top — los grandes partidos del año (Clásico, Champions, finales…), listos para preparar (chat principal)\n' +
  '/prueba — prueba real con el navegador del bot: entra en la web del Real Madrid con tu cuenta, mete 3 entradas seguidas en el carrito y te manda la captura (chat principal)\n' +
  '/tareas — tus tareas abiertas, con botones\n' +
  '/estado — cómo va cada operación y si Claude está conectado\n' +
  '/pausa — pausar lo que está en marcha (chat principal)\n' +
  '/parar_todo — parar todo al instante (chat principal)\n' +
  '/id — número de este chat';

/** Menú de comandos que se pone en el bot al conectar (setMyCommands). */
export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'evento', description: 'Crear un evento con Claude (chat principal)' },
  { command: 'top', description: 'Grandes partidos del año (chat principal)' },
  { command: 'prueba', description: 'Prueba real: el bot mete 3 entradas en el carrito (chat principal)' },
  { command: 'tareas', description: 'Tus tareas abiertas, con botones' },
  { command: 'estado', description: 'Cómo va cada operación y si Claude está conectado' },
  { command: 'ayuda', description: 'Cómo responder rápido' },
  { command: 'pausa', description: 'Pausar lo que está en marcha (chat principal)' },
  { command: 'parar_todo', description: 'Parar todo al instante (chat principal)' },
  { command: 'id', description: 'Número de este chat' },
];

/** Texto que ve quien abre el bot por primera vez («¿Qué puede hacer este bot?»). */
export const BOT_DESCRIPTION =
  'Bot privado de la sala de control para comprar entradas en la web oficial (Real Madrid, Ticketmaster, entradas.com).\n\n' +
  'Avisa en el segundo exacto en que abre la venta y dice a cada persona qué zona intentar, cuántas entradas y hasta qué precio. Se responde con un toque.\n\n' +
  'Con /evento, Claude busca los eventos de la web de venta y los prepara con sus fechas, la apertura, el límite de compra y el recinto.\n\n' +
  'Pulsa «Iniciar»: te dirá el número de este chat para darte de alta.';

export const BOT_SHORT_DESCRIPTION = 'Avisos al segundo y tareas con botones para comprar entradas en la web oficial.';

const MAX_SEEN = 10;
const HINT_EVERY_MS = 30_000;
/** Una tarea de compra creada hasta 10 s después de arrancar la operación es «de la apertura». */
const OPENING_WINDOW_MS = 10_000;
/** Plazo de cada intento de envío: una tarea colgada se reintenta pronto en vez de esperar 15 s. */
const SEND_TIMEOUT_MS = 5000;
/** Ritmo máximo de mensajes, sumando todos los chats (Telegram admite ~30/s). */
const SENDS_PER_SECOND = 25;
/** Telegram admite 4096 caracteres por mensaje: /estado se parte en trozos de como mucho esto. */
const MAX_CHUNK = 3500;

interface TgResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/** Descripción corta de un fallo de red («socket hang up (ECONNRESET)»). */
function networkError(err: unknown): string {
  const e = err as Error & { code?: string; cause?: { code?: string; message?: string } };
  const cause = e.cause?.code ?? e.cause?.message ?? (e.code && !e.message.includes(e.code) ? e.code : undefined);
  return cause ? `${e.message} (${cause})` : e.message;
}

/**
 * Conexiones persistentes con la Bot API. Con fetch, una conexión ociosa se
 * cerraba a los ~4 s y en T0 cada mensaje abría la suya (TCP + TLS, todos a la
 * vez). Aquí se reutilizan (la más reciente primero) y se cierran tras 50 s ociosas.
 */
const MAX_SOCKETS = 32;
const AGENT_OPTS = { keepAlive: true, keepAliveMsecs: 10_000, maxSockets: MAX_SOCKETS, maxFreeSockets: MAX_SOCKETS, scheduling: 'lifo' as const, timeout: 50_000 };
const httpsAgent = new https.Agent({ ...AGENT_OPTS, maxCachedSessions: 64 });
// Solo para las pruebas (TELEGRAM_API_BASE con http://).
const httpAgent = new http.Agent(AGENT_OPTS);

class TelegramTimeout extends Error {
  override readonly name = 'TimeoutError';
}

/** Un POST a la Bot API por una conexión persistente. */
function post(url: URL, payload: string, timeoutMs: number, signal?: AbortSignal): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (err: Error) => {
      clearTimeout(timer);
      reject(err);
    };
    const secure = url.protocol === 'https:';
    const req = (secure ? https : http).request(
      url,
      { method: 'POST', agent: secure ? httpsAgent : httpAgent, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, signal },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', fail);
        res.on('close', () => {
          if (!res.complete) fail(new Error('Telegram cortó la respuesta'));
        });
      },
    );
    timer = setTimeout(() => req.destroy(new TelegramTimeout(`Telegram no ha contestado en ${Math.round(timeoutMs / 100) / 10} s`)), timeoutMs);
    req.on('error', fail);
    req.end(payload);
  });
}

/** Espera `ms`, o menos si se para el bot. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Bot de Telegram parado'));
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('Bot de Telegram parado'));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Intentos ante un corte de red, un 5xx o una página de error; un 429 no gasta intento. */
const ATTEMPTS = 4;
/** Esperas de un 429 que se aceptan seguidas, y la espera más larga (s). */
const MAX_RATE_LIMITED = 5;
const MAX_RETRY_AFTER_S = 60;
const backoffMs = (failures: number) => Math.min(2000, 200 * 2 ** (failures - 1));

interface CallOpts {
  timeoutMs: number;
  /** Corta la llamada y sus esperas (al parar el bot). */
  signal?: AbortSignal;
  /** 1 = sin reintentos (getUpdates: lo reintenta su bucle). */
  attempts?: number;
  /** Reintentar también si Telegram no contesta a tiempo (un envío: mejor un duplicado que una tarea perdida). */
  retryTimeout?: boolean;
}

/**
 * Llamada a la Bot API. El token nunca aparece en los mensajes de error.
 * Un aviso de apertura o una tarea no se puede perder: se reintenta con espera
 * creciente ante un corte de red, un 5xx o una página HTML de error, y ante un
 * 429 se espera lo que pide Telegram (retry_after) y se reenvía.
 */
async function callTelegram<T>(apiBase: string, token: string, method: string, body: Record<string, unknown>, opts: CallOpts): Promise<T> {
  const redact = (m: string) => m.split(token).join('<token>');
  const url = new URL(`${apiBase}/bot${token}/${method}`);
  const payload = JSON.stringify(body);
  const attempts = opts.attempts ?? ATTEMPTS;
  let failures = 0;
  let limited = 0;
  for (;;) {
    let res: { status: number; text: string };
    try {
      res = await post(url, payload, opts.timeoutMs, opts.signal);
    } catch (err) {
      const error = new Error(redact(networkError(err)));
      const timedOut = (err as Error).name === 'TimeoutError';
      if (opts.signal?.aborted || (timedOut && !opts.retryTimeout) || ++failures >= attempts) throw error;
      await pause(backoffMs(failures), opts.signal);
      continue;
    }
    let json: TgResponse<T>;
    try {
      json = JSON.parse(res.text) as TgResponse<T>;
      if (typeof json !== 'object' || json === null) throw new Error('sin JSON');
    } catch {
      // Una página de error del balanceador (502/504 en HTML) se reintenta como cualquier 5xx.
      const error = new Error(`Telegram respondió ${res.status} sin JSON`);
      if (res.status < 500 || ++failures >= attempts) throw error;
      await pause(backoffMs(failures), opts.signal);
      continue;
    }
    if (json.ok) return json.result;
    if (json.error_code === 401 || json.error_code === 404) throw new Error('Token no válido: pega el token correcto en Ajustes · Telegram');
    const error = new Error(redact(json.description ?? `Telegram ${method} falló (${res.status})`));
    const code = json.error_code ?? res.status;
    if (code === 429) {
      // Límite de Telegram (~1 mensaje/s por chat, ~30/s en total): se espera lo que pide y se reenvía.
      const wait = Math.max(1, Number(json.parameters?.retry_after) || 1);
      if (attempts === 1 || ++limited > MAX_RATE_LIMITED || wait > MAX_RETRY_AFTER_S) throw error;
      log.warn(`Telegram limita los envíos (${method}): se reintenta en ${wait} s`);
      await pause(wait * 1000, opts.signal);
      continue;
    }
    if (code < 500 || ++failures >= attempts) throw error;
    await pause(backoffMs(failures), opts.signal);
  }
}

/** Junta líneas en mensajes de como mucho `max` caracteres. */
function chunkLines(lines: string[], max = MAX_CHUNK): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + 1 + line.length > max) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

/** Comprueba un token con getMe antes de guardarlo. */
export async function probeTelegramToken(apiBase: string, token: string): Promise<{ ok: true; username: string } | { ok: false; message: string }> {
  try {
    const me = await callTelegram<{ username?: string; is_bot?: boolean }>(apiBase.replace(/\/+$/, ''), token, 'getMe', {}, { timeoutMs: 10_000, attempts: 3 });
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

/** Línea de /estado: si el bot tiene Claude conectado (la misma clave que el dashboard). */
export function claudeLine(ai: AiStatus | null): string {
  if (!ai?.configured) return '🤖 <b>Claude: sin conectar.</b> /evento y /top no funcionan hasta que pongas la clave en el dashboard: <b>Ajustes → Claude (IA)</b>.';
  if (ai.ok === false) return `🤖 <b>Claude: la clave no funciona.</b> ${esc(ai.detail)}`;
  const spent = ai.spentUsd > 0 ? ` · gastado ${ai.spentUsd.toFixed(2).replace('.', ',')} $ desde que se abrió la sala` : '';
  return `🤖 <b>Claude: conectado</b>${ai.ok === null ? ' (aún sin usar)' : ''} · ${esc(ai.model || 'modelo por defecto')}${spent}. Lo usan /evento y /top.`;
}

/** «/estado ahora» → «/estado» (sin el @nombre_del_bot de los grupos). */
function commandOf(text: string | undefined): string {
  return (text ?? '').trim().split(/\s+/)[0]?.toLowerCase().replace(/@.*$/, '') ?? '';
}

/** Comandos que esperan a Claude o a Telegram (crear eventos). */
const FLOW_COMMANDS = new Set(['/evento', '/nuevo', '/top']);

/** Un mensaje en la cola de un chat. */
interface Outgoing {
  text: string;
  keyboard?: Button[][];
  /** Copia informativa (la tarea de otra persona en el chat principal): sale después de lo urgente. */
  low: boolean;
  done: (r: { message_id?: number } | undefined) => void;
  fail: (err: Error) => void;
}

export class TelegramNotifier implements Notifier {
  readonly enabled = true;
  connected = false;
  detail = 'Conectando con Telegram…';
  private bot: string | null = null;
  private runtime: Runtime | null = null;
  private offset = 0;
  private stopped = false;
  /** Se aborta al parar: corta la escucha, los envíos y sus esperas. */
  private readonly life = new AbortController();
  /** Mensajes pendientes de cada chat: salen en orden y de uno en uno (un 429 retiene solo a ese chat). */
  private readonly outbox = new Map<string, Outgoing[]>();
  private readonly sending = new Set<string>();
  /** Cupo de envíos (fichas que se recargan a `sendsPerSecond`). */
  private tokens: number;
  private tokensAt = Date.now();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  /** Actualizaciones en curso por carril: las de un chat van en orden y las de chats distintos, a la vez. */
  private readonly inbox = new Map<string, Promise<void>>();
  /** Último «Error enviando a…» mostrado (se quita en cuanto un envío sale bien). */
  private sendError: string | null = null;
  /** Cuentas que ya recibieron su tarea de la apertura con «¡Abre la venta!» («operación:cuenta»). */
  private readonly openingSent = new Set<string>();
  private checking = false;
  private lastCheckAt = 0;
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
  private readonly sendTimeoutMs: number;
  private readonly sendsPerSecond: number;
  /** «10:00» en la zona de la sala (crear el formato cuesta ~0,1 ms: se hace una vez). */
  private readonly clockFmt: Intl.DateTimeFormat;
  /** Número del propio bot (principio del token): nunca es el chat de nadie. */
  private readonly botId: string;
  /** «/evento»: crear eventos con Claude desde Telegram. */
  private readonly flow: TelegramEventFlow;

  constructor(private readonly opts: TelegramOptions) {
    this.botId = opts.token.split(':')[0] ?? '';
    this.chatId = opts.chatId === this.botId ? null : opts.chatId;
    this.apiBase = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.timeZone = opts.timeZone ?? 'Europe/Madrid';
    this.retryMs = opts.retryMs ?? 5000;
    this.sendTimeoutMs = opts.sendTimeoutMs ?? SEND_TIMEOUT_MS;
    this.sendsPerSecond = Math.max(1, opts.sendsPerSecond ?? SENDS_PER_SECOND);
    this.tokens = this.sendsPerSecond;
    this.clockFmt = new Intl.DateTimeFormat('es-ES', { timeZone: this.timeZone, hour: '2-digit', minute: '2-digit' });
    this.flow = new TelegramEventFlow(
      {
        send: async (chatId, text, keyboard) => {
          try {
            const r = await this.enqueue(chatId, text, keyboard);
            return typeof r?.message_id === 'number' ? r.message_id : null;
          } catch (err) {
            log.warn('Telegram: no se pudo enviar', { chatId, error: (err as Error).message });
            return null;
          }
        },
        photo: async (chatId, url, caption) => {
          try {
            await this.api('sendPhoto', { chat_id: chatId, photo: url, caption, parse_mode: 'HTML' });
            return true;
          } catch (err) {
            // Telegram no ha podido descargar la imagen: se manda el enlace.
            log.warn('Telegram: no se pudo enviar la imagen del plano', { error: (err as Error).message });
            await this.enqueue(chatId, `${caption}: ${url}`).catch(() => undefined);
            return false;
          }
        },
        edit: async (chatId, messageId, text, keyboard) => {
          await this.api('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
          }).catch(() => undefined);
        },
        answer: async (callbackId, text) => {
          await this.api('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) }).catch(() => undefined);
        },
      },
      () => this.runtime?.ctx.eventAssistant ?? null,
      () => this.runtime?.ctx.topMatches ?? null,
    );
  }

  attach(runtime: Runtime): void {
    this.runtime = runtime;
    this.checked = this.check();
    void this.poll();
  }

  /** Mensaje a un chat concreto (prueba con el navegador): se resuelve cuando Telegram lo acepta. */
  async sendTo(chatId: string, text: string, keyboard?: Button[][]): Promise<number | null> {
    const r = await this.enqueue(chatId, text, keyboard);
    return typeof r?.message_id === 'number' ? r.message_id : null;
  }

  /** Foto desde un archivo local (captura de la pantalla de pago) con pie y botones. Si falla, va el texto. */
  async sendPhotoTo(chatId: string, file: string, caption: string, keyboard?: Button[][]): Promise<number | null> {
    try {
      const { readFile } = await import('node:fs/promises');
      const data = await readFile(file);
      const form = new FormData();
      form.set('chat_id', chatId);
      form.set('caption', caption.slice(0, 1024));
      form.set('parse_mode', 'HTML');
      if (keyboard) form.set('reply_markup', JSON.stringify({ inline_keyboard: keyboard }));
      form.set('photo', new Blob([data], { type: 'image/png' }), 'captura.png');
      const res = await fetch(`${this.apiBase}/bot${this.opts.token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
      const json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id?: number } };
      if (!json.ok) throw new Error(json.description ?? `HTTP ${res.status}`);
      // El pie de una foto tiene 1024 caracteres: si el texto es más largo, va aparte.
      if (caption.length > 1024) await this.enqueue(chatId, caption).catch(() => undefined);
      return typeof json.result?.message_id === 'number' ? json.result.message_id : null;
    } catch (err) {
      log.warn('Telegram: no se pudo enviar la captura; va el texto', { error: (err as Error).message });
      return this.sendTo(chatId, caption, keyboard);
    }
  }

  clearButtons(chatId: string, messageId: number): void {
    this.setKeyboard(chatId, messageId);
  }

  /** Espera a la primera comprobación del bot (como mucho `ms`). */
  async ready(ms = 5000): Promise<void> {
    await Promise.race([this.checked, new Promise((r) => setTimeout(r, ms))]);
  }

  /** Cambia el chat principal al momento (lo elige el dashboard). */
  setMainChat(chatId: string | null): void {
    this.chatId = chatId === this.botId ? null : chatId;
    this.refreshDetail();
  }

  stop(): void {
    this.stopped = true;
    this.life.abort();
    if (this.drainTimer !== null) clearTimeout(this.drainTimer);
    this.drainTimer = null;
    for (const queue of this.outbox.values()) for (const m of queue) m.fail(new Error('Bot de Telegram parado'));
    this.outbox.clear();
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

  private api<T>(method: string, body: Record<string, unknown>, opts: Partial<CallOpts> = {}): Promise<T> {
    return callTelegram<T>(this.apiBase, this.opts.token, method, body, { timeoutMs: 15_000, signal: this.life.signal, ...opts });
  }

  private async check(): Promise<void> {
    this.checking = true;
    this.lastCheckAt = Date.now();
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
      if (this.stopped) return;
      this.connected = false;
      this.detail = `Sin conexión: ${(err as Error).message}`;
      log.warn('Telegram: no se pudo comprobar el bot', { error: (err as Error).message });
    } finally {
      this.checking = false;
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

  private sendNow(chatId: string, text: string, keyboard?: Button[][]): Promise<{ message_id?: number } | undefined> {
    return this.api<{ message_id?: number }>(
      'sendMessage',
      {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      },
      { timeoutMs: this.sendTimeoutMs, retryTimeout: true },
    );
  }

  /** Pone un mensaje en la cola de su chat; se resuelve cuando Telegram lo ha aceptado. */
  private enqueue(chatId: string, text: string, keyboard?: Button[][], low = false): Promise<{ message_id?: number } | undefined> {
    return new Promise((done, fail) => {
      if (this.stopped) return fail(new Error('Bot de Telegram parado'));
      const queue = this.outbox.get(chatId) ?? [];
      queue.push({ text, keyboard, low, done, fail });
      this.outbox.set(chatId, queue);
      this.drain();
    });
  }

  /** Envía lo que se pueda ya: un mensaje por chat a la vez y, sumando todos, al ritmo permitido. */
  private drain(): void {
    if (this.stopped) return;
    const now = Date.now();
    this.tokens = Math.min(this.sendsPerSecond, this.tokens + ((now - this.tokensAt) * this.sendsPerSecond) / 1000);
    this.tokensAt = now;
    for (;;) {
      // El siguiente chat libre; primero los que no tienen en cabeza una copia informativa.
      let next: string | null = null;
      for (const [chat, queue] of this.outbox) {
        if (this.sending.has(chat)) continue;
        if (!queue[0]?.low) {
          next = chat;
          break;
        }
        next ??= chat;
      }
      if (next === null) return;
      if (this.tokens < 1) {
        // Sin cupo: se vuelve a mirar en cuanto lo haya.
        this.drainTimer ??= setTimeout(
          () => {
            this.drainTimer = null;
            this.drain();
          },
          Math.ceil(((1 - this.tokens) * 1000) / this.sendsPerSecond),
        );
        return;
      }
      const chat = next;
      const queue = this.outbox.get(chat) ?? [];
      const m = queue.shift();
      if (queue.length === 0) this.outbox.delete(chat);
      if (!m) continue;
      this.tokens -= 1;
      this.sending.add(chat);
      void this.sendNow(chat, m.text, m.keyboard)
        .then(m.done, m.fail)
        .finally(() => {
          this.sending.delete(chat);
          this.drain();
        });
    }
  }

  private send(chatId: string, text: string, keyboard?: Button[][], opts: { onSent?: (messageId: number) => void; low?: boolean } = {}): void {
    void this.enqueue(chatId, text, keyboard, opts.low).then(
      (r) => {
        // Ya se puede enviar: fuera el «Error enviando a…» de un fallo anterior.
        if (this.sendError !== null && this.detail === this.sendError) this.refreshDetail();
        this.sendError = null;
        if (opts.onSent && typeof r?.message_id === 'number') opts.onSent(r.message_id);
      },
      (err: Error) => {
        if (this.stopped) return;
        this.detail = this.sendError = `Error enviando a ${chatId}: ${err.message}`;
        log.warn('Telegram: no se pudo enviar', { chatId, error: err.message });
      },
    );
  }

  /** Envía y espera la respuesta de Telegram, con el error explicado. */
  private async deliver(target: string, text: string): Promise<{ ok: boolean; message: string }> {
    try {
      await this.enqueue(target, text);
      this.connected = true;
      this.refreshDetail();
      return { ok: true, message: `Mensaje enviado al chat ${target}.` };
    } catch (err) {
      const message = (err as Error).message;
      return {
        ok: false,
        message: /bots? can't send messages to (the )?bots?/i.test(message)
          ? `${target} es el número de un bot, no el de una persona: elige tu chat en Ajustes · Telegram (el de quien pulsó «Iniciar»).`
          : /chat not found|bot was blocked|user is deactivated/i.test(message)
            ? `Telegram no deja escribir al chat ${target}: abre el bot en Telegram, pulsa «Iniciar» (/start) y vuelve a probar.`
            : /fetch failed|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|no ha contestado|cortó la respuesta/i.test(message)
              ? `No se pudo conectar con Telegram (${message}). Comprueba la conexión a Internet y vuelve a pulsar «Enviar mensaje de prueba»; si se repite, un antivirus o cortafuegos puede estar bloqueando a Node.js.`
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
    if (!account.telegramChatId || account.telegramChatId === this.botId) return;
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
    if (personal && personal !== this.botId) chats.add(personal);
    return [...chats];
  }

  /** Chat propio de la cuenta, si tiene uno distinto del principal. */
  private personalChat(accountId: string): string | null {
    const personal = this.runtime?.store.accounts.get(accountId)?.telegramChatId;
    return personal && personal !== this.botId && personal !== this.chatId ? personal : null;
  }

  notifyAlert(alert: Alert): void {
    if (alert.severity === 'INFO' && !ALWAYS_SEND.has(alert.kind)) return;
    if (alert.kind === 'HUMAN_TASK') return; // la tarea llega con sus propios botones
    let text = `${ICON[alert.severity]} <b>${esc(alert.title)}</b>\n${esc(alert.message)}`;
    // Carrito a punto de caducar (o tiempo agotado): se responde con un toque.
    const cart = alert.cartId ? this.runtime?.store.carts.get(alert.cartId) : undefined;
    let keyboard: Button[][] | undefined =
      alert.kind === 'CART_EXPIRING' && cart && (cart.state === 'ACTIVE' || cart.state === 'REVIEW_REQUIRED')
        ? [
            [{ text: '💳 Ya lo he pagado', callback_data: `p:${cart.id}` }],
            [5, 10, 15].map((m) => ({ text: `⏱ Quedan ${m} min`, callback_data: `x:${cart.id}:${m}` })),
          ]
        : undefined;
    // Entradas en el carrito: el enlace para verlas y pagarlas.
    if (alert.kind === 'CART_CONFIRMED' || alert.kind === 'CART_SECURED') {
      const links = this.cartLinks(alert);
      text += links.text;
      if (links.keyboard.length > 0) keyboard = links.keyboard;
    }
    for (const chat of this.chatsFor(alert.accountId)) this.send(chat, text, keyboard);
  }

  /**
   * Enlaces de los carritos de un aviso: el del carrito («N entradas en carrito») o los
   * de todos los carritos vivos de la operación («¡entradas aseguradas!»). En la web
   * oficial es la página de compra del evento; en el simulador, su carrito.
   */
  private cartLinks(alert: Alert): { text: string; keyboard: Button[][] } {
    const store = this.runtime?.store;
    if (!store) return { text: '', keyboard: [] };
    const alive = (c: Cart) => c.state === 'ACTIVE' || c.state === 'REVIEW_REQUIRED';
    const carts = alert.cartId
      ? [store.carts.get(alert.cartId)].filter((c): c is Cart => c !== undefined && alive(c))
      : [...store.carts.values()].filter((c) => c.operationId === alert.operationId && alive(c));
    const withUrl = carts.filter((c) => c.openUrl);
    if (withUrl.length === 0) return { text: '', keyboard: [] };
    const official = withUrl.every((c) => c.confirmation === 'HUMAN');
    const label = (c: Cart) => store.accounts.get(c.accountId)?.label ?? c.accountId;
    const urls = [...new Set(withUrl.map((c) => c.openUrl as string))];
    // Una sola dirección (la página oficial del evento, igual para todas las cuentas): un botón.
    const entries =
      urls.length === 1 ? [{ name: null as string | null, url: urls[0] as string }] : withUrl.slice(0, 10).map((c) => ({ name: label(c), url: c.openUrl as string }));
    const keyboard: Button[][] = [];
    const plain: string[] = [];
    for (const e of entries) {
      const url = buttonUrl(e.url);
      const title = official ? `🛒 Ir al carrito en la web oficial${e.name ? ` · ${e.name}` : ''}` : `🛒 Abrir el carrito${e.name ? ` · ${e.name}` : ''}`;
      if (url) keyboard.push([{ text: title, url }]);
      else plain.push(`🛒 ${e.name ? `${esc(e.name)}: ` : 'Carrito: '}${esc(e.url)}`);
    }
    return { text: plain.length > 0 ? `\n\n${plain.join('\n')}` : '', keyboard };
  }

  private clock(iso: string): string {
    return this.clockFmt.format(new Date(iso));
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

  announce(text: string, accountIds: string[], link?: string | null, opts: { mainChat?: boolean } = {}): void {
    const chats = new Set<string>();
    if (this.chatId) chats.add(this.chatId);
    for (const id of accountIds) {
      const personal = this.runtime?.store.accounts.get(id)?.telegramChatId;
      if (personal && personal !== this.botId) chats.add(personal);
    }
    if (opts.mainChat === false && this.chatId) chats.delete(this.chatId);
    const keyboard: Button[][] | undefined = link ? [[{ text: '🌐 Abrir la web oficial', url: link }]] : undefined;
    for (const chat of chats) this.send(chat, text, keyboard);
  }

  /**
   * Unos segundos antes de T0: abre (o refresca) una conexión por cada chat que
   * recibirá mensajes en la apertura, para que en T0 no haya ningún handshake.
   */
  prewarm(accountIds: string[]): void {
    if (this.stopped) return;
    const chats = new Set(accountIds.flatMap((id) => this.chatsFor(id)));
    const n = Math.min(Math.max(1, chats.size), MAX_SOCKETS - 2);
    for (let i = 0; i < n; i++) void this.api('getMe', {}, { timeoutMs: 5000 }).catch(() => undefined);
  }

  /**
   * «¡Abre la venta!» para la primera tarea de compra de una cuenta que nace con la
   * apertura: va en el mismo mensaje que la tarea (un solo mensaje por persona en T0).
   */
  private openingLine(task: HumanTask): string | null {
    const op = task.operationId ? this.runtime?.store.operations.get(task.operationId) : undefined;
    if (task.kind !== 'ADD_TO_CART' || !op?.startedAt || Date.parse(task.createdAt) - Date.parse(op.startedAt) > OPENING_WINDOW_MS) return null;
    const key = `${op.id}:${task.accountId}`;
    if (this.openingSent.has(key)) return null;
    this.openingSent.add(key);
    return `🚦 <b>¡Abre la venta! ${esc(op.config.name)}</b>\nEntra ya en la web oficial (cola incluida).`;
  }

  notifyTask(task: HumanTask): void {
    const { text, keyboard } = this.taskMessage(task);
    const personal = this.personalChat(task.accountId);
    // El chat principal ya recibió el aviso de apertura justo antes que las copias de las tareas.
    const opening = personal ? this.openingLine(task) : null;
    // Primero el chat de la persona: con poco cupo, su tarea sale antes que la copia informativa.
    const chats = this.chatsFor(task.accountId).sort((a, b) => Number(b === personal) - Number(a === personal));
    for (const chat of chats) {
      const own = chat === personal;
      this.send(chat, own && opening ? `${opening}\n\n${text}` : text, keyboard, {
        onSent: (messageId) => this.trackTaskMessage(task.id, chat, messageId),
        // La copia en el chat principal de una tarea que ya llega a su persona es informativa.
        low: personal !== null && !own,
      });
    }
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
    for (const m of list) this.setKeyboard(m.chatId, m.messageId);
  }

  /** Cambia (o quita) los botones de un mensaje sin esperar a Telegram. */
  private setKeyboard(chatId: string | number, messageId: number, keyboard: Button[][] = []): void {
    void this.api('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } }).catch(() => undefined);
  }

  /** Responde a un botón sin esperar a Telegram: una respuesta lenta no retrasa a nadie. */
  private answer(callbackId: string, text: string): void {
    void this.api('answerCallbackQuery', { callback_query_id: callbackId, text }).catch(() => undefined);
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
      try {
        const updates = await this.api<TgUpdate[]>(
          'getUpdates',
          { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
          { timeoutMs: 35_000, attempts: 1 },
        );
        if (!this.bot) {
          // getMe falló al arrancar pero Telegram ya contesta: se comprueba otra vez (nombre y menú de comandos).
          if (!this.checking && Date.now() - this.lastCheckAt >= this.retryMs) void this.check();
        } else if (!this.connected) {
          this.connected = true;
          this.refreshDetail();
        }
        for (const u of updates) {
          if (this.stopped) break;
          this.offset = Math.max(this.offset, u.update_id + 1);
          this.dispatch(u);
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
        await pause(this.retryMs, this.life.signal).catch(() => undefined);
        if (!this.bot && !this.stopped && !this.checking) await this.check();
      }
    }
  }

  /**
   * Atiende una actualización sin esperar a las demás: lo que cambia el estado (responder
   * una tarea, marcar un carrito) se hace al momento y en orden dentro de cada chat, y una
   * respuesta lenta de Telegram a una persona no retrasa a las demás.
   */
  private dispatch(u: TgUpdate): void {
    const chat = String(u.callback_query?.message?.chat.id ?? u.message?.chat.id ?? '');
    // «/evento» espera a Claude y a Telegram: va por su propio carril para no retrasar los botones de las tareas.
    const flow = u.callback_query ? (u.callback_query.data ?? '').startsWith('ev:') : FLOW_COMMANDS.has(commandOf(u.message?.text));
    const lane = flow ? `ev:${chat}` : chat;
    const next = (this.inbox.get(lane) ?? Promise.resolve())
      .then(() => this.handle(u))
      .catch((err: Error) => log.warn('Telegram: error procesando un mensaje', { error: err.message }));
    this.inbox.set(lane, next);
    void next.then(() => {
      if (this.inbox.get(lane) === next) this.inbox.delete(lane);
    });
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
        this.answer(q.id, 'Este chat no está autorizado.');
        return;
      }
      const [kind, ref, result, extra] = (q.data ?? '').split(':');
      const actor = `telegram:${q.from.username ?? q.from.id}`;
      if (kind === 'ev') {
        // Crear un evento con Claude (/evento).
        await this.flow.callback(chat, q.message?.message_id ?? null, q.id, q.data ?? '', actor, chat === this.chatId);
        return;
      }
      if (kind === 'pb' && ref && result) {
        // Prueba con el navegador: «Sí, voy a pagar» / «No, liberar».
        const service = rt.ctx.browserTest;
        const ok = service && (result === 'comprar' || result === 'cancelar') ? service.decide(ref, result, `telegram:${q.from.username ?? q.from.id}`) : false;
        this.answer(q.id, ok ? (result === 'comprar' ? 'Abriendo la ventana del bot…' : 'Liberando…') : 'Esa prueba ya no está pendiente.');
        if (q.message) this.setKeyboard(q.message.chat.id, q.message.message_id);
        return;
      }
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
        this.answer(q.id, text);
        if (q.message) this.setKeyboard(q.message.chat.id, q.message.message_id);
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
        this.answer(q.id, text);
        // Queda solo «Ya lo he pagado».
        if (q.message) this.setKeyboard(q.message.chat.id, q.message.message_id, keep);
        return;
      }
      const taskId = ref;
      if (kind !== 't' || !taskId || !result) {
        // Botón de una versión anterior del bot (o mal formado): se contesta igual, para que no se quede cargando.
        this.answer(q.id, 'Botón antiguo: escribe /tareas para ver tus tareas.');
        return;
      }
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
      this.answer(q.id, text);
      if (q.message) this.setKeyboard(q.message.chat.id, q.message.message_id);
      return;
    }
    const m = u.message;
    if (!m) return;
    this.remember(m.chat);
    const chat = String(m.chat.id);
    const cmd = commandOf(m.text);
    if (cmd === '/id') {
      this.send(chat, `El chat ID de este chat es: <code>${chat}</code>`);
      return;
    }
    if (!allowed.has(chat)) {
      this.hint(m.chat);
      return;
    }
    const main = chat === this.chatId;
    if (FLOW_COMMANDS.has(cmd)) {
      if (!main) {
        this.send(chat, 'Solo el chat principal puede crear eventos.');
        return;
      }
      if (cmd === '/top') await this.flow.startTop(chat);
      else await this.flow.start(chat);
    } else if (cmd === '/estado') {
      // En el chat principal, primero si este bot tiene Claude (lo usan /evento y /top).
      if (main) this.send(chat, claudeLine(rt.ctx.aiStatus?.() ?? null));
      const ops = rt.ctx.ops.summaries().filter((o) => !['CLOSED', 'CANCELLED', 'ENDED'].includes(o.state));
      const lines = ops.map((o) => `• <b>${esc(o.name)}</b>: ${OPERATION_STATE_LABEL[o.state]} · ${o.cartedQty}/${o.requestedQty} en carrito`);
      if (lines.length === 0) this.send(chat, 'No hay operaciones activas.');
      // Con muchas operaciones no cabe en un mensaje (4096 caracteres): se manda en varios.
      for (const part of chunkLines(lines)) this.send(chat, part);
    } else if (cmd === '/tareas') {
      const mine = (t: HumanTask) => main || rt.store.accounts.get(t.accountId)?.telegramChatId === chat;
      const tasks = [...rt.store.humanTasks.values()].filter((t) => t.state === 'OPEN' && mine(t));
      if (tasks.length === 0) {
        this.send(chat, 'No hay tareas abiertas.');
        return;
      }
      for (const t of tasks) {
        const { text, keyboard } = this.taskMessage(t);
        // Esta copia también pierde los botones cuando se cierre la tarea.
        this.send(chat, text, keyboard, { onSent: (messageId) => this.trackTaskMessage(t.id, chat, messageId) });
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
    } else if (cmd === '/prueba') {
      if (!main) {
        this.send(chat, 'Solo el chat principal puede lanzar la prueba.');
        return;
      }
      try {
        const service = rt.ctx.browserTest;
        if (service) {
          const st = service.start({}, 'telegram');
          this.send(chat, `🧪 Prueba en marcha con la cuenta «${esc(st.accountLabel ?? '')}»: 3 entradas seguidas del próximo partido del femenino. Te aviso aquí con la captura cuando estén en el carrito.`);
        } else {
          const r = await seedRealTest(rt, { actor: 'telegram' });
          this.send(chat, `🧪 ${esc(r.message)}`);
        }
      } catch (err) {
        this.send(chat, `❌ ${esc((err as Error).message)}`);
      }
    } else if (cmd === '/ayuda' || cmd === '/start' || cmd === '/help') {
      this.send(chat, HELP);
    }
  }
}
