/**
 * Prueba real con el navegador, desde la sala de control.
 *
 * El bot abre su propio Chrome con el perfil de una cuenta de «Cuentas» (la sesión de la web
 * queda guardada ahí: con Google, Apple o email, la inicia la persona una sola vez), entra en
 * tickets.realmadrid.com, mete las entradas en el carrito, pulsa «Comprar entradas» para abrir
 * la pantalla de pago y avisa por Telegram (chat principal y chat de la cuenta) con la captura
 * y los botones «Sí, voy a pagar» / «No, liberar». Nunca paga.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  browserAvailable,
  findSystemBrowser,
  launchOptionsFor,
  LoginHandoff,
  openLoginBrowser,
  runBot as defaultRunBot,
  REAL_MADRID_CHANNEL_HOME,
  type BotSession,
  type HumanReason,
  type LoginBrowser,
  type LogLevel,
  type RunOptions,
  type SecuredCart,
} from '@to/prueba';
import type { Account, BrowserTestCartView, BrowserTestLogEntry, BrowserTestStartInput, BrowserTestState, BrowserTestStatus, Id } from '@to/shared';
import { BROWSER_TEST_QUICK } from '@to/shared';
import type { App } from '../app';
import { log } from '../util/log';
import type { CredentialStore } from './credenciales';

export type Decision = 'comprar' | 'cancelar';

export interface BrowserTestDeps {
  app: App;
  /** Carpeta de datos: los perfiles van en data/navegador/<cuenta>. */
  dataDir: string;
  credentials: CredentialStore;
  runBot?: typeof defaultRunBot;
  /** Cuánto se espera a que una persona haga login, pase la cola o resuelva una verificación. */
  humanWaitMs?: number;
  /** Cuánto se mantiene la decisión abierta si la web no informa de caducidad. */
  cartHoldMs?: number;
  /** Comprueba que el navegador del bot está instalado (por defecto, el Chromium de Playwright). */
  available?: () => boolean;
}

type Button = { text: string; callback_data: string } | { text: string; url: string };

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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eur = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');

export class BrowserTestError extends Error {
  constructor(
    message: string,
    readonly code = 'BROWSER_TEST',
  ) {
    super(message);
  }
}

export class BrowserTestService {
  private status: BrowserTestStatus = 'IDLE';
  private id: string | null = null;
  private startedAt: string | null = null;
  private options: RunOptions | null = null;
  private account: Account | null = null;
  private logEntries: BrowserTestLogEntry[] = [];
  private cart: SecuredCart | null = null;
  private error: string | null = null;
  private telegram = { sent: false, detail: 'Todavía no se ha enviado nada.' };
  private session: BotSession | null = null;
  private abort: AbortController | null = null;
  private resolveDecision: ((d: Decision) => void) | null = null;
  private messages: Array<{ chatId: string; messageId: number }> = [];
  /** Navegadores abiertos para iniciar sesión (uno por cuenta). */
  private readonly loginBrowsers = new Map<Id, LoginBrowser>();
  private readonly runBot: typeof defaultRunBot;
  private readonly timeZone: string;

  constructor(private readonly deps: BrowserTestDeps) {
    this.runBot = deps.runBot ?? defaultRunBot;
    this.timeZone = deps.app.timeZone;
    deps.app.runtime.ctx.browserTest = this;
  }

  // ---------------------------------------------------------------------------
  // Perfiles por cuenta
  // ---------------------------------------------------------------------------

  profileDir(accountId: Id): string {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(accountId)) throw new BrowserTestError('Cuenta no válida', 'BAD_ACCOUNT');
    return path.join(this.deps.dataDir, 'navegador', accountId);
  }

  private capturesDir(): string {
    const dir = path.join(this.deps.dataDir, 'navegador', 'capturas');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** ¿Se ha abierto alguna vez el navegador de esta cuenta? (su sesión queda en ese perfil). */
  profileExists(accountId: Id): boolean {
    try {
      return existsSync(path.join(this.profileDir(accountId), 'Default'));
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    if (this.deps.available) return this.deps.available();
    return browserAvailable();
  }

  /** Chrome o Edge del PC (preferido) o null para usar el Chromium de Playwright. */
  private systemBrowser() {
    return findSystemBrowser();
  }

  private unavailableMessage(): string {
    return 'No hay navegador para el bot: instala Google Chrome (lo mejor, para poder entrar con Google) o ejecuta «npx playwright install chromium» en la carpeta del proyecto.';
  }

  private requireAccount(accountId: Id | undefined): Account {
    const { store } = this.deps.app.runtime;
    if (accountId) {
      const a = store.accounts.get(accountId);
      if (!a) throw new BrowserTestError('Esa cuenta no existe en «Cuentas».', 'ACCOUNT_NOT_FOUND');
      return a;
    }
    const all = [...store.accounts.values()].filter((a) => a.enabled);
    const rm = all.find((a) => a.providerId === 'real-madrid') ?? all[0];
    if (!rm) throw new BrowserTestError('No hay ninguna cuenta en «Cuentas». Crea la tuya (proveedor Real Madrid) y vuelve a pulsar.', 'NO_ACCOUNT');
    return rm;
  }

  /**
   * Abre el Chrome del bot con el perfil de la cuenta para que la persona inicie sesión
   * (con Google, Apple o email) una sola vez. Se queda abierto hasta que lo cierre o empiece una prueba.
   */
  async openAccountBrowser(accountId: Id): Promise<{ ok: boolean; message: string }> {
    const account = this.requireAccount(accountId);
    if (!this.isAvailable()) throw new BrowserTestError(this.unavailableMessage(), 'UNAVAILABLE');
    if (this.busy && this.account?.id === account.id) throw new BrowserTestError('Esa cuenta está en una prueba ahora mismo.', 'BUSY');
    const existing = this.loginBrowsers.get(account.id);
    if (existing?.running()) return { ok: true, message: `El navegador de «${account.label}» ya estaba abierto: inicia sesión ahí y cierra la ventana.` };
    this.loginBrowsers.delete(account.id);
    const dir = this.profileDir(account.id);
    mkdirSync(dir, { recursive: true });
    const browser = this.systemBrowser();
    if (browser) {
      // Chrome normal, sin automatización: Google acepta el inicio de sesión y la sesión queda en el perfil.
      this.loginBrowsers.set(account.id, openLoginBrowser(browser, dir, REAL_MADRID_CHANNEL_HOME));
      this.deps.app.runtime.ctx.journal.audit('browser_test.account_browser_opened', { accountId: account.id, browser: browser.name }, { actor: 'dashboard' });
      return {
        ok: true,
        message: `Se ha abierto ${browser.name} con el perfil del bot para «${account.label}». Inicia sesión ahí (Google, Apple o email) y cierra la ventana: queda guardado para las pruebas.`,
      };
    }
    // Sin Chrome ni Edge: Chromium de Playwright (Google puede rechazar el inicio de sesión; email funciona).
    const context = await chromium.launchPersistentContext(dir, { ...launchOptionsFor(null), headless: false, locale: 'es-ES', timezoneId: this.timeZone, viewport: { width: 1366, height: 900 } });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(REAL_MADRID_CHANNEL_HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
    await page.bringToFront().catch(() => undefined);
    let open = true;
    context.on('close', () => {
      open = false;
    });
    this.loginBrowsers.set(account.id, {
      pid: null,
      running: () => open,
      waitClosed: (timeoutMs) => new Promise<boolean>((resolve) => {
        const t = setInterval(() => {
          if (!open) {
            clearInterval(t);
            resolve(true);
          }
        }, 500);
        setTimeout(() => {
          clearInterval(t);
          resolve(!open);
        }, timeoutMs).unref?.();
      }),
      close: () => context.close().catch(() => undefined),
    });
    this.deps.app.runtime.ctx.journal.audit('browser_test.account_browser_opened', { accountId: account.id, browser: 'chromium' }, { actor: 'dashboard' });
    return {
      ok: true,
      message: `Se ha abierto el navegador del bot para «${account.label}». Inicia sesión ahí con email o Apple (Google no suele dejar en este navegador: instala Google Chrome para eso) y cierra la ventana.`,
    };
  }

  async closeAccountBrowser(accountId: Id): Promise<void> {
    const b = this.loginBrowsers.get(accountId);
    this.loginBrowsers.delete(accountId);
    await b?.close().catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------

  get busy(): boolean {
    return this.status === 'RUNNING' || this.status === 'WAITING_HUMAN' || this.status === 'CART_SECURED';
  }

  state(): BrowserTestState {
    const cart = this.cart;
    const view: BrowserTestCartView | null = cart
      ? {
          eventTitle: cart.eventTitle,
          items: cart.items.map((i) => ({ label: i.sectionLabel, qty: i.qty, unitPrice: i.unitPrice, row: i.row, seats: i.seats })),
          qty: cart.qty ?? cart.items.reduce((n, i) => n + i.qty, 0),
          total: cart.total,
          expiresAt: cart.expiresAt,
          url: cart.url,
          stage: cart.stage,
          strategy: cart.strategy,
          hasScreenshot: Boolean(cart.screenshot),
        }
      : null;
    const available = this.isAvailable();
    return {
      available,
      detail: available ? `Navegador: ${this.systemBrowser()?.name ?? 'Chromium de Playwright'}.` : this.unavailableMessage(),
      id: this.id,
      status: this.status,
      startedAt: this.startedAt,
      options: this.options
        ? { quantity: this.options.quantity, zones: this.options.zones, maxUnitPrice: this.options.maxUnitPrice, contiguous: this.options.contiguous, fallbackFewer: this.options.fallbackFewer, eventUrl: this.options.eventUrl }
        : null,
      accountId: this.account?.id ?? null,
      accountLabel: this.account?.label ?? null,
      accountHasCredentials: this.account ? this.deps.credentials.has(this.account.id) : false,
      log: this.logEntries,
      cart: view,
      error: this.error,
      telegram: this.telegram,
    };
  }

  screenshotPath(): string | null {
    return this.cart?.screenshot ?? null;
  }

  private publish(): void {
    this.deps.app.runtime.hub.publish({ type: 'browser-test', state: this.state() } as never);
  }

  private log(level: LogLevel, message: string): void {
    this.logEntries.push({ at: new Date().toISOString(), level, message });
    if (this.logEntries.length > 400) this.logEntries.splice(0, this.logEntries.length - 400);
    if (this.status === 'WAITING_HUMAN' && level === 'ok') this.status = 'RUNNING';
    log.info(`Prueba navegador: ${message}`);
    this.publish();
  }

  // ---------------------------------------------------------------------------
  // Telegram
  // ---------------------------------------------------------------------------

  private chats(): string[] {
    const n = this.deps.app.runtime.ctx.notifier;
    const main = n?.status?.()?.mainChatId ?? null;
    const out = new Set<string>();
    if (main) out.add(main);
    if (this.account?.telegramChatId) out.add(this.account.telegramChatId);
    return [...out];
  }

  private async notify(text: string, keyboard?: Button[][], photo?: string | null, track = false): Promise<void> {
    const n = this.deps.app.runtime.ctx.notifier;
    const chats = this.chats();
    if (!n || !n.connected || chats.length === 0 || !n.sendTo) {
      this.telegram = { sent: false, detail: !n ? 'Telegram sin configurar (Ajustes · Telegram).' : chats.length === 0 ? 'Sin chat principal en Ajustes · Telegram.' : 'El bot de Telegram no está conectado.' };
      this.publish();
      return;
    }
    for (const chat of chats) {
      try {
        const id = photo && n.sendPhotoTo ? await n.sendPhotoTo(chat, photo, text, keyboard) : await n.sendTo(chat, text, keyboard);
        if (track && id !== null) this.messages.push({ chatId: chat, messageId: id });
        this.telegram = { sent: true, detail: `Enviado al chat ${chat}.` };
      } catch (err) {
        this.telegram = { sent: false, detail: `No se pudo enviar a ${chat}: ${(err as Error).message}` };
        this.log('warn', `No se pudo enviar el Telegram a ${chat}: ${(err as Error).message}`);
      }
    }
    this.publish();
  }

  // ---------------------------------------------------------------------------
  // Prueba
  // ---------------------------------------------------------------------------

  start(input: BrowserTestStartInput, actor: string): BrowserTestState {
    if (this.busy) throw new BrowserTestError('Ya hay una prueba en marcha. Pulsa «Parar» o responde a la que está abierta.', 'BUSY');
    if (!this.isAvailable()) throw new BrowserTestError(this.unavailableMessage(), 'UNAVAILABLE');
    const account = this.requireAccount(input.accountId);
    const quick = BROWSER_TEST_QUICK;
    const options: RunOptions = {
      mode: 'real',
      eventUrl: input.eventUrl ?? quick.eventUrl,
      quantity: input.quantity ?? quick.quantity,
      zones: (input.zones ?? quick.zones).map((z) => z.trim()).filter(Boolean),
      maxUnitPrice: input.maxUnitPriceEur === undefined || input.maxUnitPriceEur === null ? null : Math.round(input.maxUnitPriceEur * 100),
      contiguous: input.contiguous ?? quick.contiguous,
      fallbackFewer: input.fallbackFewer ?? quick.fallbackFewer,
      headless: false,
    };
    this.id = this.deps.app.runtime.ctx.ids.next('pn');
    this.status = 'RUNNING';
    this.startedAt = new Date().toISOString();
    this.options = options;
    this.account = account;
    this.logEntries = [];
    this.cart = null;
    this.error = null;
    this.messages = [];
    this.telegram = { sent: false, detail: 'Todavía no se ha enviado nada.' };
    this.deps.app.runtime.ctx.journal.audit('browser_test.started', { id: this.id, accountId: account.id, options }, { actor });
    this.abort = new AbortController();
    void this.run(this.id, options, account, this.abort.signal);
    this.publish();
    return this.state();
  }

  private async run(id: string, options: RunOptions, account: Account, signal: AbortSignal, handoffs = 0): Promise<void> {
    if (handoffs > 0) return this.runOnce(id, options, account, signal, handoffs);
    const reqs = [
      `${options.quantity} entrada(s)`,
      options.contiguous && options.quantity > 1 ? 'seguidas' : null,
      options.zones.length ? `zonas: ${options.zones.join(' > ')}` : 'zona: la más barata con sitio',
      options.maxUnitPrice !== null ? `máx. ${eur(options.maxUnitPrice)}/entrada` : 'sin tope de precio',
      options.fallbackFewer && options.quantity > 1 ? 'si no hay tantas, menos' : null,
      options.eventUrl ? null : 'partido: el próximo del femenino a la venta',
    ].filter(Boolean);
    this.log('info', `Prueba con la cuenta «${account.label}» — ${reqs.join(', ')}.`);
    const creds = this.deps.credentials.get(account.id);
    const browser = this.systemBrowser();
    if (browser) this.log('info', `Navegador: ${browser.name} con el perfil del bot de esta cuenta.`);
    else this.log('warn', 'No hay Google Chrome en este PC: se usa el Chromium de Playwright (para entrar con Google hace falta Chrome).');
    if (!this.profileExists(account.id) && !creds) {
      this.log(
        'warn',
        browser
          ? 'Esta cuenta no ha iniciado sesión nunca: cuando la web lo pida, abriré tu Chrome normal para que entres (queda guardado).'
          : 'Esta cuenta no ha iniciado sesión nunca: cuando la web lo pida, inicia sesión tú en la ventana del bot (queda guardado).',
      );
    }
    return this.runOnce(id, options, account, signal, 0);
  }

  private async runOnce(id: string, options: RunOptions, account: Account, signal: AbortSignal, handoffs: number): Promise<void> {
    const creds = this.deps.credentials.get(account.id);
    const browser = this.systemBrowser();
    await this.closeSession();
    if (this.loginBrowsers.get(account.id)?.running()) this.log('info', 'Cierro la ventana de inicio de sesión de esta cuenta para que el perfil quede libre…');
    await this.closeAccountBrowser(account.id);
    try {
      const session = await this.runBot(options, {
        profileDir: this.profileDir(account.id),
        browser,
        capturesDir: this.capturesDir(),
        account: { email: creds?.email ?? null, password: creds?.password ?? null },
        humanWaitMs: this.deps.humanWaitMs ?? 10 * 60_000,
        signal,
        hooks: {
          log: (level, message) => this.log(level, message),
          needHuman: async (reason, message, url) => {
            if (reason === 'login' && browser && handoffs < 2) throw new LoginHandoff(url);
            if (reason !== 'queue') this.status = 'WAITING_HUMAN';
            this.publish();
            await this.notify(`<b>${HUMAN_TITLES[reason]}</b> (cuenta «${esc(account.label)}»)\n${esc(message)}`);
          },
        },
      });
      if (signal.aborted) return;
      this.session = session;
      session.context.on('close', () => {
        if (this.session === session) this.session = null;
        if (this.id === id && this.status === 'CART_SECURED') this.finish('CANCELLED', 'Se ha cerrado la ventana del bot: el carrito caducará solo.');
      });
      this.cart = session.cart;
      this.status = 'CART_SECURED';
      this.publish();
      await this.sendCartMessage(id, session.cart, account);
      await this.awaitDecision(session);
    } catch (err) {
      if (!signal.aborted && err instanceof LoginHandoff && browser) {
        await this.loginHandoff(id, options, account, signal, handoffs, browser, err.url);
        return;
      }
      if (signal.aborted) {
        this.finish('CANCELLED', 'Prueba detenida.');
      } else {
        const msg = (err as Error).message.split('\n')[0] ?? String(err);
        this.error = msg;
        this.log('error', msg);
        this.finish('FAILED');
        await this.notify(`❌ <b>La prueba ha fallado</b> (cuenta «${esc(account.label)}»)\n${esc(msg)}`);
      }
    }
  }

  /**
   * Google rechaza iniciar sesión en un navegador automatizado («este navegador puede no ser seguro»):
   * se cierra la ventana del bot, se abre el Chrome normal con el mismo perfil para que la persona
   * entre, y al cerrarla se reanuda la prueba con la sesión ya guardada.
   */
  private async loginHandoff(id: string, options: RunOptions, account: Account, signal: AbortSignal, handoffs: number, browser: NonNullable<ReturnType<BrowserTestService['systemBrowser']>>, url: string): Promise<void> {
    await this.closeSession();
    this.status = 'WAITING_HUMAN';
    const waitMs = this.deps.humanWaitMs ?? 10 * 60_000;
    const minutes = Math.round(waitMs / 60_000);
    this.log(
      'human',
      `He cerrado mi ventana y he abierto ${browser.name} normal (sin automatización) con el perfil de «${account.label}». Inicia sesión ahí (Google, Apple o email) y CIERRA esa ventana: la prueba continúa sola. Tienes ${minutes} min.`,
    );
    await this.notify(
      `<b>${HUMAN_TITLES.login}</b> (cuenta «${esc(account.label)}»)\nEn tu PC se ha abierto ${esc(browser.name)} con el perfil de esta cuenta. Inicia sesión ahí (Google, Apple o email) y <b>cierra esa ventana</b>: la prueba continúa sola.`,
    );
    const safeUrl = /^https:\/\/[^/]*(realmadrid\.com|oneboxtds\.com)/i.test(url) ? url : REAL_MADRID_CHANNEL_HOME;
    const login = openLoginBrowser(browser, this.profileDir(account.id), safeUrl);
    this.loginBrowsers.set(account.id, login);
    const closed = await login.waitClosed(waitMs, signal);
    if (signal.aborted) {
      await this.closeAccountBrowser(account.id);
      this.finish('CANCELLED', 'Prueba detenida.');
      return;
    }
    if (!closed) {
      await this.closeAccountBrowser(account.id);
      this.error = 'Se agotó el tiempo para iniciar sesión.';
      this.log('error', `${this.error} Inicia sesión desde Cuentas → «Abrir navegador» y vuelve a lanzar la prueba.`);
      this.finish('FAILED');
      await this.notify(`❌ <b>La prueba ha fallado</b> (cuenta «${esc(account.label)}»)\nSe agotó el tiempo para iniciar sesión.`);
      return;
    }
    this.loginBrowsers.delete(account.id);
    this.status = 'RUNNING';
    this.log('ok', 'Ventana cerrada: reanudo la prueba con la sesión guardada.');
    await this.run(id, options, account, signal, handoffs + 1);
  }

  private async sendCartMessage(id: string, cart: SecuredCart, account: Account): Promise<void> {
    const inCheckout = cart.stage === 'checkout';
    const strategyKey = cart.strategy.split(':')[0] ?? '';
    const strategyZone = cart.strategy.split(':').slice(1).join(':');
    const clock = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: this.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    const lines = [
      inCheckout ? '🎟️ <b>¡Entradas en el carrito y pantalla de pago abierta en tu PC!</b>' : '🎟️ <b>¡Entradas en el carrito!</b>',
      '',
      `<b>Partido:</b> ${esc(cart.eventTitle)}`,
      `<b>Cuenta:</b> ${esc(account.label)}`,
      ...cart.items.map((i) => `• ${i.qty} × ${esc(i.sectionLabel)} — ${eur(i.unitPrice)}`),
      `<b>Total:</b> ${eur(cart.total)}`,
      cart.expiresAt ? `⏳ El carrito caduca sobre las <b>${clock(cart.expiresAt)}</b>` : '⏳ Caducidad desconocida: no tardes',
      STRATEGY_LABEL[strategyKey] ? `<i>(${STRATEGY_LABEL[strategyKey]}${strategyZone ? ` · ${esc(strategyZone)}` : ''})</i>` : '',
      '',
      `🔗 Enlace: ${esc(cart.url)}`,
      '<i>(el carrito está en la ventana del bot de tu PC; en el móvil verás la web del partido)</i>',
      '',
      '<b>¿Quieres comprar las entradas?</b>',
      inCheckout ? '<i>En la ventana del bot de tu PC solo queda rellenar los datos y pagar. El bot nunca paga.</i>' : '<i>El pago lo haces tú: el bot nunca paga.</i>',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
    const keyboard: Button[][] = [];
    try {
      const u = new URL(cart.url);
      if (u.protocol === 'https:' && u.hostname.includes('.')) keyboard.push([{ text: '🔗 Abrir el enlace del partido', url: cart.url }]);
    } catch {
      // sin botón de enlace
    }
    keyboard.push([
      { text: inCheckout ? '✅ Sí, voy a pagar' : '✅ Sí, ábreme el carrito', callback_data: `pb:${id}:comprar` },
      { text: '❌ No, liberar', callback_data: `pb:${id}:cancelar` },
    ]);
    this.log('ok', 'Enviando aviso a Telegram: «¿Quieres comprar las entradas?»');
    await this.notify(lines.join('\n'), keyboard, cart.screenshot, true);
  }

  private awaitDecision(session: BotSession): Promise<void> {
    const expires = session.cart.expiresAt ? Date.parse(session.cart.expiresAt) - Date.now() : (this.deps.cartHoldMs ?? 10 * 60_000);
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

  /** Decisión desde Telegram o desde el dashboard. */
  decide(runId: string | null, decision: Decision, source: string): boolean {
    if (runId && runId !== this.id) return false;
    if (this.status !== 'CART_SECURED' || !this.resolveDecision) return false;
    this.log('info', `Respuesta recibida desde ${source}: ${decision === 'comprar' ? 'SÍ, comprar' : 'NO, liberar'}.`);
    this.resolveDecision(decision);
    return true;
  }

  private async applyDecision(session: BotSession, decision: Decision): Promise<void> {
    const n = this.deps.app.runtime.ctx.notifier;
    for (const m of this.messages) n?.clearButtons?.(m.chatId, m.messageId);
    this.messages = [];
    if (decision === 'comprar') {
      await session.page.bringToFront().catch(() => undefined);
      const inCheckout = session.cart.stage === 'checkout';
      this.finish('OPENED', inCheckout ? 'Pantalla de pago abierta en la ventana del bot. Completa tú el pago allí (el bot no toca nada más).' : 'Carrito abierto en la ventana del bot. Completa tú el pago allí.');
      await this.notify(inCheckout ? '✅ La pantalla de pago está abierta en la ventana del bot de tu ordenador. <b>Rellena los datos y paga tú allí.</b>' : '✅ Te he dejado el carrito abierto en la ventana del bot. <b>Completa tú el pago allí.</b>');
      return;
    }
    await session.release();
    this.finish('CANCELLED', 'Entradas liberadas: he quitado las entradas del carrito y cerrado el navegador del bot.');
    await this.notify('❌ Vale, no se compran. He quitado las entradas del carrito y cerrado el navegador del bot.');
    await this.closeSession();
  }

  private finish(status: BrowserTestStatus, message?: string): void {
    this.status = status;
    if (message) this.log(status === 'FAILED' || status === 'EXPIRED' ? 'warn' : 'ok', message);
    this.deps.app.runtime.ctx.journal.audit('browser_test.finished', { id: this.id, status, error: this.error }, { actor: 'sistema' });
    this.publish();
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

  async close(): Promise<void> {
    this.stop();
    await this.closeSession();
    await Promise.allSettled([...this.loginBrowsers.values()].map((c) => c.close()));
    this.loginBrowsers.clear();
  }
}
