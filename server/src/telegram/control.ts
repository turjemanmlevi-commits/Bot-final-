/**
 * Telegram configurado desde el dashboard, sin tocar archivos ni reiniciar:
 *
 * - setToken: comprueba el token con Telegram, lo guarda en .env y conecta el
 *   bot al momento (que se configura solo: comandos y descripción).
 * - setMainChat: elige el chat principal entre los que han escrito al bot (o
 *   cualquier chat ID), lo guarda en .env y le manda la bienvenida.
 *
 * El token solo vive en este ordenador (.env, que no se sube a GitHub) y nunca
 * se devuelve por la API ni aparece en los logs.
 */

import type { TelegramConfigResult, TelegramStatus } from '@to/shared';
import type { Runtime } from '../runtime/runtime';
import { updateEnvFile } from '../util/envfile';
import { log } from '../util/log';
import { probeTelegramToken, TelegramNotifier } from './telegram';

export interface TelegramControlOptions {
  cartOnly?: boolean;
  runtime: Runtime;
  apiBase?: string;
  timeZone?: string;
  /** Archivo .env donde se guardan el token y el chat principal; null = solo en memoria. */
  envFile: string | null;
  /** Plantilla si el .env todavía no existe (.env.example). */
  envTemplate?: string | null;
  retryMs?: number;
}

export interface TelegramInitial {
  token?: string | null;
  chatId?: string | null;
  /** Bot ya creado al arrancar (para que los avisos del arranque también lleguen). */
  notifier?: TelegramNotifier | null;
}

/** ¿Es el número del propio bot? (el token empieza por él: 123456789:AA…) */
export function isBotId(chatId: string, token: string): boolean {
  return chatId.trim() === token.split(':')[0];
}

export class TelegramControl {
  private notifier: TelegramNotifier | null = null;
  private token: string | null = null;
  private chatId: string | null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly apiBase: string;
  private readonly timeZone: string;

  constructor(
    private readonly opts: TelegramControlOptions,
    initial: TelegramInitial = {},
  ) {
    this.apiBase = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.timeZone = opts.timeZone ?? 'Europe/Madrid';
    this.chatId = initial.chatId ?? null;
    if (this.chatId && initial.token && isBotId(this.chatId, initial.token)) {
      // El número del propio bot (el principio del token) no es un chat: un bot no puede escribirse a sí mismo.
      log.warn(`TELEGRAM_CHAT_ID=${this.chatId} es el número del propio bot, no un chat: elige tu chat en Ajustes · Telegram.`);
      this.chatId = null;
    }
    opts.runtime.ctx.telegramStatus = () => this.status();
    if (initial.token) {
      this.token = initial.token;
      const n = initial.notifier ?? this.create(initial.token);
      // El bot creado al arrancar pudo leer el número del propio bot como chat principal.
      n.setMainChat(this.chatId);
      this.install(n);
    }
  }

  /** ¿Es el número del propio bot? (no vale como chat de nadie) */
  isBotChat(chatId: string | null | undefined): boolean {
    return Boolean(chatId && this.token && isBotId(chatId, this.token));
  }

  status(): TelegramStatus {
    const configurable = this.opts.envFile !== null;
    if (this.notifier) return { ...this.notifier.status(), configurable };
    return {
      enabled: false,
      connected: false,
      detail: 'Sin configurar: pega el token de tu bot en Ajustes · Telegram.',
      bot: null,
      mainChatConfigured: this.chatId !== null,
      mainChatId: this.chatId,
      recentChats: [],
      configurable,
    };
  }

  /** Comprueba el token, lo guarda y conecta el bot sin reiniciar. */
  setToken(token: string, actor: string): Promise<TelegramConfigResult> {
    return this.serial(async () => {
      const probe = await probeTelegramToken(this.apiBase, token);
      if (!probe.ok) return this.result(false, probe.message);
      const warning = await this.persist({ TELEGRAM_BOT_TOKEN: token });
      if (token !== this.token || !this.notifier) {
        this.notifier?.stop();
        this.token = token;
        const n = this.create(token);
        this.install(n);
        await n.ready();
      }
      this.opts.runtime.ctx.journal.audit('telegram.configured', { bot: probe.username }, { actor });
      log.info(`Telegram configurado desde el dashboard: @${probe.username}`);
      this.publish();
      const text = this.chatId
        ? `Listo: @${probe.username} conectado. ${this.opts.cartOnly ? 'Solo se avisa cuando el pedido completo queda verificado en carrito' : 'Los avisos van al chat principal'} (${this.chatId}).`
        : `Listo: @${probe.username} conectado. Ahora abre el bot en Telegram y pulsa «Iniciar».`;
      return this.result(true, warning ? `${text} ${warning}` : text);
    });
  }

  /** Elige (o quita, con null) el chat principal, lo guarda y le da la bienvenida. */
  setMainChat(chatId: string | null, actor: string): Promise<TelegramConfigResult> {
    return this.serial(async () => {
      if (chatId && this.token && isBotId(chatId, this.token)) {
        return this.result(
          false,
          `${chatId} es el número del propio bot (sale al principio del token), no tu chat. Abre el bot en Telegram, pulsa «Iniciar» y elige tu nombre en la lista (o escribe el número que te contesta el bot).`,
        );
      }
      const warning = await this.persist({ TELEGRAM_CHAT_ID: chatId });
      this.chatId = chatId;
      this.notifier?.setMainChat(chatId);
      this.opts.runtime.ctx.journal.audit('telegram.main_chat', { chatId }, { actor });
      this.publish();
      const tail = warning ? ` ${warning}` : '';
      if (chatId === null) return this.result(true, `Chat principal quitado.${tail}`);
      if (!this.notifier) return this.result(true, `Chat principal guardado (${chatId}). Falta conectar el bot con su token.${tail}`);
      const sent = await this.notifier.welcomeMain(chatId);
      this.publish();
      return sent.ok
        ? this.result(true, `Listo: el chat ${chatId} es el principal y le ha llegado un mensaje de bienvenida.${tail}`)
        : this.result(false, `Guardado como chat principal, pero ${sent.message.charAt(0).toLowerCase()}${sent.message.slice(1)}${tail}`);
    });
  }

  stop(): void {
    this.notifier?.stop();
  }

  private create(token: string): TelegramNotifier {
    return new TelegramNotifier({ token, chatId: this.chatId, apiBase: this.apiBase, timeZone: this.timeZone, retryMs: this.opts.retryMs, cartOnly: this.opts.cartOnly });
  }

  private install(n: TelegramNotifier): void {
    const { runtime } = this.opts;
    this.notifier = n;
    runtime.ctx.notifier = n;
    n.attach(runtime);
    this.publish();
  }

  private publish(): void {
    const { ctx } = this.opts.runtime;
    ctx.hub.publish({ type: 'system', data: ctx.ops.systemStatus() });
  }

  private result(ok: boolean, message: string): TelegramConfigResult {
    return { ok, message, status: this.status() };
  }

  /** Guarda en .env; si no se puede, sigue funcionando hasta que se cierre el servidor. */
  private async persist(changes: Record<string, string | null>): Promise<string | null> {
    if (!this.opts.envFile) return null;
    try {
      await updateEnvFile(this.opts.envFile, changes, this.opts.envTemplate ?? null);
      return null;
    } catch (err) {
      const message = (err as Error).message;
      log.warn('No se pudo guardar la configuración de Telegram en .env', { error: message });
      return `Aviso: no se pudo guardar en el archivo .env (${message}); funciona ahora, pero al reiniciar habrá que ponerlo otra vez.`;
    }
  }

  /** Un cambio de configuración cada vez (dos clics seguidos no se pisan). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
