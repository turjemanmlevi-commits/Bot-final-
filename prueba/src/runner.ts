/**
 * Orquesta una prueba: lanza el bot, avisa por Telegram y espera tu decisión
 * ("Sí, comprar" → te abre el carrito para que pagues tú; "No" → libera).
 */
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { saveEnvValues, type PruebaConfig } from './config.js';
import { runBot, type BotSession, type HumanReason, type LogLevel, type RunOptions, type SecuredCart } from './bot.js';
import { detectChatId, escapeHtml, isTelegramButtonUrl, TelegramClient, TelegramError, type Keyboard } from './telegram.js';

export type RunStatus = 'IDLE' | 'RUNNING' | 'WAITING_HUMAN' | 'CART_SECURED' | 'OPENED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
export type Decision = 'comprar' | 'cancelar';

export interface LogEntry {
  at: string;
  level: LogLevel;
  message: string;
}

export interface RunState {
  id: string | null;
  status: RunStatus;
  options: RunOptions | null;
  account: string | null;
  log: LogEntry[];
  cart: SecuredCart | null;
  error: string | null;
  telegram: { configured: boolean; detail: string };
}

const HUMAN_TITLES: Record<HumanReason, string> = {
  login: '🔐 Inicio de sesión necesario',
  challenge: '🧩 Verificación en la web',
  queue: '⏳ En cola virtual',
  selection: '🖐️ Selección manual necesaria',
  blocked: '⛔ Acceso bloqueado',
};

const STRATEGY_LABEL: Record<string, string> = {
  plano: 'asientos elegidos en el plano',
  automatica: 'selección automática de la web',
  zona: 'zona sin numerar',
  lista: 'lista de zonas',
  manual: 'selección hecha a mano',
};

function eur(cents: number | null): string {
  return cents === null ? '—' : (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

export class Runner extends EventEmitter {
  readonly state: RunState;
  private telegram: TelegramClient | null;
  private abort: AbortController | null = null;
  private poll: AbortController | null = null;
  private session: BotSession | null = null;
  private resolveDecision: ((d: Decision) => void) | null = null;
  private cartMessageId: number | null = null;

  constructor(private readonly cfg: PruebaConfig) {
    super();
    const { token, chatId, apiBase } = cfg.telegram;
    this.telegram = token && chatId ? new TelegramClient(token, chatId, apiBase) : null;
    this.state = {
      id: null,
      status: 'IDLE',
      options: null,
      account: null,
      log: [],
      cart: null,
      error: null,
      telegram: {
        configured: this.telegram !== null,
        detail: this.telegram
          ? 'Configurado'
          : token
            ? 'Falta TELEGRAM_CHAT_ID (ejecuta npm run prueba:chat-id)'
            : 'Sin configurar: el aviso se muestra solo en este panel',
      },
    };
  }

  async checkTelegram(): Promise<void> {
    if (!this.telegram) return;
    try {
      const user = await this.telegram.whoAmI();
      this.state.telegram.detail = `Conectado como @${user}`;
    } catch (err) {
      this.state.telegram.detail = `Error: ${(err as Error).message}`;
    }
    this.changed();
  }

  /** Configura Telegram desde el panel: valida el token, detecta el chat, manda un mensaje de prueba y lo guarda. */
  async configureTelegram(rawToken: string, rawChatId: string): Promise<string> {
    if (this.busy) throw new Error('Espera a que termine la prueba en marcha.');
    const token = rawToken.trim();
    if (!/^\d+:[\w-]{20,}$/.test(token)) throw new Error('Ese token no parece válido. Cópialo entero de @BotFather (tiene la forma 123456:ABC…).');
    const apiBase = this.cfg.telegram.apiBase;
    try {
      const chatId = rawChatId.trim() || (await detectChatId(token, apiBase));
      if (!chatId) throw new Error('Abre tu bot en Telegram, escríbele «hola» y vuelve a pulsar «Guardar y probar».');
      const client = new TelegramClient(token, chatId, apiBase);
      const username = await client.whoAmI();
      await client.sendMessage('✅ <b>Conectado con la prueba local.</b>\nAquí te avisaré cuando haya entradas en el carrito.');
      saveEnvValues({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId });
      this.telegram = client;
      this.state.telegram = { configured: true, detail: `Conectado como @${username}` };
      this.changed();
      return username;
    } catch (err) {
      if (err instanceof TelegramError && /conflict|webhook/i.test(err.description)) {
        throw new Error('Tu bot está conectado a otro programa (webhook u otro bot en marcha, p. ej. la sala de control). Para el otro programa o escribe tu chat ID a mano.');
      }
      if (err instanceof TelegramError && /unauthorized|not found/i.test(err.description)) {
        throw new Error('Telegram no reconoce ese token. Cópialo otra vez de @BotFather.');
      }
      if (err instanceof TelegramError && /chat not found/i.test(err.description)) {
        throw new Error('No encuentro ese chat. Escribe «hola» a tu bot y deja el chat ID vacío.');
      }
      throw err;
    }
  }

  get busy(): boolean {
    return this.state.status === 'RUNNING' || this.state.status === 'WAITING_HUMAN' || this.state.status === 'CART_SECURED';
  }

  private changed(): void {
    this.emit('state', this.state);
  }

  private log(level: LogLevel, message: string): void {
    this.state.log.push({ at: new Date().toISOString(), level, message });
    if (this.state.log.length > 400) this.state.log.splice(0, this.state.log.length - 400);
    if (this.state.status === 'WAITING_HUMAN' && level === 'ok') this.state.status = 'RUNNING';
    console.log(`[${level.toUpperCase().padEnd(5)}] ${message}`);
    this.changed();
  }

  private async notify(html: string, keyboard?: Keyboard, photo?: string | null): Promise<number | null> {
    if (!this.telegram) return null;
    try {
      return photo ? await this.telegram.sendPhoto(photo, html, keyboard) : await this.telegram.sendMessage(html, keyboard);
    } catch (err) {
      this.log('warn', `No se pudo enviar el mensaje de Telegram: ${(err as Error).message}`);
      return null;
    }
  }

  start(options: RunOptions): string {
    if (this.busy) throw new Error('Ya hay una prueba en marcha.');
    void this.closeSession();
    const id = randomBytes(4).toString('hex');
    const simulated = options.mode === 'simulado';
    const account = simulated
      ? { email: this.cfg.account.email ?? 'prueba@ejemplo.com', password: this.cfg.account.password ?? 'simulado' }
      : { email: this.cfg.account.email, password: this.cfg.account.password };
    Object.assign(this.state, {
      id,
      status: 'RUNNING',
      options,
      account: account.email ?? 'sesión guardada en el perfil del bot',
      log: [],
      cart: null,
      error: null,
    } satisfies Partial<RunState>);
    this.cartMessageId = null;
    this.changed();

    this.abort = new AbortController();
    void this.run(id, options, account, this.abort.signal);
    return id;
  }

  private async run(id: string, options: RunOptions, account: { email: string | null; password: string | null }, signal: AbortSignal): Promise<void> {
    const reqs = [
      `${options.quantity} entrada(s)`,
      options.contiguous && options.quantity > 1 ? 'seguidas' : null,
      options.zones.length ? `zonas: ${options.zones.join(' > ')}` : 'zona: la más barata',
      options.maxUnitPrice !== null ? `máx. ${eur(options.maxUnitPrice)}/entrada` : 'sin tope de precio',
      options.fallbackFewer && options.quantity > 1 ? 'si no hay tantas, menos' : null,
      options.eventUrl ? null : 'partido: el próximo a la venta',
    ].filter(Boolean);
    this.log('info', `Prueba ${id} en modo ${options.mode.toUpperCase()} — ${reqs.join(', ')}.`);
    await this.startPolling(id);
    try {
      const session = await runBot(options, {
        profileDir: this.cfg.profileDir,
        capturesDir: this.cfg.capturesDir,
        account,
        humanWaitMs: this.cfg.humanWaitMs,
        signal,
        hooks: {
          log: (level, message) => this.log(level, message),
          needHuman: async (reason, message) => {
            if (reason !== 'queue') this.state.status = 'WAITING_HUMAN';
            this.changed();
            await this.notify(`<b>${HUMAN_TITLES[reason]}</b>\n${escapeHtml(message)}`);
          },
        },
      });
      if (signal.aborted) return;
      this.session = session;
      session.context.on('close', () => {
        if (this.session === session) this.session = null;
        if (this.state.id === id && this.state.status === 'CART_SECURED') this.finish('CANCELLED', 'Has cerrado la ventana del bot: el carrito caducará solo.');
      });
      this.state.cart = session.cart;
      this.state.status = 'CART_SECURED';
      this.changed();
      await this.sendCartMessage(id, session.cart);
      await this.awaitDecision(session);
    } catch (err) {
      if (signal.aborted) {
        this.finish('CANCELLED', 'Prueba detenida.');
      } else {
        const msg = (err as Error).message.split('\n')[0] ?? String(err);
        this.state.error = msg;
        this.log('error', msg);
        this.finish('FAILED');
        await this.notify(`❌ <b>La prueba ha fallado</b>\n${escapeHtml(msg)}`);
      }
    } finally {
      this.poll?.abort();
      this.poll = null;
    }
  }

  private async sendCartMessage(id: string, cart: SecuredCart): Promise<void> {
    const strategyKey = cart.strategy.split(':')[0] ?? '';
    const strategyZone = cart.strategy.split(':').slice(1).join(':');
    const lines = [
      '🎟️ <b>¡Entradas en el carrito!</b>',
      '',
      `<b>Partido:</b> ${escapeHtml(cart.eventTitle)}`,
      `<b>Cuenta:</b> ${escapeHtml(this.state.account ?? '—')}`,
      ...cart.items.map((i) => `• ${i.qty} × ${escapeHtml(i.sectionLabel)} — ${eur(i.unitPrice)}`),
      `<b>Total:</b> ${eur(cart.total)}`,
      cart.expiresAt ? `⏳ El carrito caduca sobre las <b>${clock(cart.expiresAt)}</b>` : '⏳ Caducidad desconocida: no tardes',
      STRATEGY_LABEL[strategyKey] ? `<i>(${STRATEGY_LABEL[strategyKey]}${strategyZone ? ` · ${escapeHtml(strategyZone)}` : ''})</i>` : '',
      '',
      '<b>¿Quieres comprar las entradas?</b>',
      '<i>El pago lo haces tú: el bot nunca paga.</i>',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
    const keyboard: Keyboard = [];
    if (isTelegramButtonUrl(cart.url)) {
      lines.push('', `🔗 Enlace: ${escapeHtml(cart.url)}`, '<i>(el carrito está en la ventana del bot de tu PC; en el móvil verás la web del partido)</i>');
      keyboard.push([{ text: '🔗 Abrir el enlace del partido', url: cart.url }]);
    } else {
      lines.push('', `Enlace al carrito (en tu PC): <code>${escapeHtml(cart.url)}</code>`);
    }
    keyboard.push([
      { text: '✅ Sí, ábreme el carrito', callback_data: `comprar:${id}` },
      { text: '❌ No, liberar', callback_data: `cancelar:${id}` },
    ]);
    this.log('ok', this.telegram ? 'Enviando aviso a Telegram: «¿Quieres comprar las entradas?»' : 'Telegram sin configurar: responde desde este panel.');
    this.cartMessageId = await this.notify(lines.join('\n'), keyboard, cart.screenshot);
  }

  private awaitDecision(session: BotSession): Promise<void> {
    const expires = session.cart.expiresAt ? Date.parse(session.cart.expiresAt) - Date.now() : this.cfg.cartHoldMs;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveDecision = null;
        this.finish('EXPIRED', 'El carrito ha caducado sin respuesta.');
        void this.notify('⌛ El carrito ha caducado sin respuesta. Las entradas se liberan.');
        void this.closeSession();
        resolve();
      }, Math.max(expires, 5_000));
      this.resolveDecision = (decision) => {
        clearTimeout(timer);
        this.resolveDecision = null;
        void this.applyDecision(session, decision).finally(resolve);
      };
    });
  }

  /** Decisión desde Telegram o desde el panel. */
  decide(decision: Decision, source: 'telegram' | 'panel'): boolean {
    if (this.state.status !== 'CART_SECURED' || !this.resolveDecision) return false;
    this.log('info', `Respuesta recibida desde ${source}: ${decision === 'comprar' ? 'SÍ, comprar' : 'NO, liberar'}.`);
    this.resolveDecision(decision);
    return true;
  }

  private async applyDecision(session: BotSession, decision: Decision): Promise<void> {
    if (this.cartMessageId !== null) await this.telegram?.clearButtons(this.cartMessageId);
    if (decision === 'comprar') {
      await session.page.bringToFront().catch(() => undefined);
      const visible = !this.state.options?.headless;
      this.finish(
        'OPENED',
        visible
          ? 'Carrito abierto en la ventana del bot. Completa tú el pago allí (el bot no toca nada más).'
          : `Carrito listo en ${session.cart.url} (navegador oculto: ábrelo tú).`,
      );
      await this.notify(
        visible
          ? '✅ Te he dejado el carrito abierto en la ventana del bot en tu ordenador. <b>Completa tú el pago allí.</b>'
          : `✅ Carrito listo. Ábrelo aquí: <code>${escapeHtml(session.cart.url)}</code>`,
      );
      return;
    }
    await session.release();
    this.finish('CANCELLED', 'Entradas liberadas: he quitado las entradas del carrito y cerrado el navegador del bot.');
    await this.notify('❌ Vale, no se compran. He quitado las entradas del carrito y cerrado el navegador del bot.');
    await this.closeSession();
  }

  private finish(status: RunStatus, message?: string): void {
    this.state.status = status;
    if (message) this.log(status === 'FAILED' || status === 'EXPIRED' ? 'warn' : 'ok', message);
    this.changed();
  }

  private async startPolling(id: string): Promise<void> {
    if (!this.telegram) return;
    this.poll?.abort();
    const poll = new AbortController();
    this.poll = poll;
    await this.telegram.skipPendingUpdates().catch(() => undefined);
    const telegram = this.telegram;
    void telegram
      .pollCallbacks(async (press) => {
        const [decision, runId] = press.data.split(':');
        if (runId !== id || (decision !== 'comprar' && decision !== 'cancelar')) {
          await telegram.answerCallback(press.id, 'Ese botón es de una prueba anterior.');
          return;
        }
        const ok = this.decide(decision, 'telegram');
        await telegram.answerCallback(press.id, ok ? (decision === 'comprar' ? 'Abriendo carrito…' : 'Liberando…') : 'Ya no está pendiente.');
      }, poll.signal)
      .catch(() => undefined);
  }

  stop(): void {
    this.abort?.abort();
    this.resolveDecision?.('cancelar');
  }

  async closeSession(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.context.close().catch(() => undefined);
  }
}
