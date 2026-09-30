/**
 * Flujo del bot en el navegador: abrir evento → sesión → seleccionar → carrito.
 *
 * Reglas (spec §26): CAPTCHA, colas y límites son estados que se respetan, no controles
 * que se evaden. Si aparece uno, el bot avisa y espera a que lo resuelvas tú en su ventana.
 * El bot se detiene en el carrito: nunca pulsa "Pagar".
 */
import path from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import type { CartItem, Minor } from '@to/shared';

export type RunMode = 'simulado' | 'real';

export interface RunOptions {
  mode: RunMode;
  eventUrl: string;
  quantity: number;
  /** Zonas por orden de preferencia (texto que aparece en la web). Vacío = la más barata disponible. */
  zones: string[];
  maxUnitPrice: Minor | null;
  headless: boolean;
}

export type LogLevel = 'info' | 'ok' | 'warn' | 'error' | 'human';
export type HumanReason = 'login' | 'challenge' | 'queue' | 'selection';

export interface BotHooks {
  log(level: LogLevel, message: string): void;
  /** Se llama una vez por cada bloqueo que requiere a una persona delante de la ventana. */
  needHuman(reason: HumanReason, message: string): Promise<void>;
}

export interface BotDeps {
  profileDir: string;
  capturesDir: string;
  account: { email: string | null; password: string | null };
  humanWaitMs: number;
  signal: AbortSignal;
  hooks: BotHooks;
}

export interface SecuredCart {
  url: string;
  eventTitle: string;
  items: CartItem[];
  qty: number | null;
  total: Minor | null;
  currency: string;
  expiresAt: string | null;
  screenshot: string | null;
  /** true si la selección la hiciste tú (el bot solo detectó el carrito). */
  assisted: boolean;
}

export interface BotSession {
  context: BrowserContext;
  page: Page;
  cart: SecuredCart;
}

// ---------------------------------------------------------------------------
// Detección de estado de la página
// ---------------------------------------------------------------------------

type PageKind = 'challenge' | 'queue' | 'login' | 'cart' | 'other';

const PATTERNS = {
  challengeUrl: [/challenges\.cloudflare\.com/i, /\/cdn-cgi\/challenge/i],
  challengeTitle: /just a moment|un momento|attention required|verif(y|ica)/i,
  challengeFrame: /challenges\.cloudflare\.com|recaptcha\/api2\/(anchor|bframe)|hcaptcha\.com/i,
  challengeText: /verify you are human|verifica que eres (un )?humano|comprobando (tu|el) navegador|checking your browser/i,
  queueUrl: [/queue-it\.net/i, /\/cola(\?|\/|$)/i, /waitingroom|waiting-room|sala-de-espera/i],
  queueText: /cola virtual|est[áa]s en la cola|sala de espera|waiting room|you are now in line/i,
  loginUrl: [/\/login/i, /\/signin/i, /\/sign-in/i, /\/acceso/i, /you\.realmadrid\.com/i, /\/oauth/i, /\/authorize/i],
  cartUrl: [/checkout/i, /\/cart(\/|\?|$)/i, /carrito/i, /basket/i, /\/summary/i, /resumen/i, /\/purchase/i],
  cartText: /resumen de (tu |la )?compra|tiempo restante|finalizar (la )?compra|completar (la )?compra/i,
  soldOut: /agotad|sold ?out|no disponible|completo|sin disponibilidad/i,
  cookieAccept: /^(aceptar( todas)?( las cookies)?|accept all( cookies)?|permitir todas|aceptar y cerrar)$/i,
  addToCart: [/añadir al carrito|add to cart|a[ñn]adir a la cesta/i, /^(comprar|continuar|siguiente|reservar)\b/i],
};

async function visibleChallengeFrame(page: Page): Promise<boolean> {
  for (const f of page.frames()) {
    if (!PATTERNS.challengeFrame.test(f.url())) continue;
    const el = await f.frameElement().catch(() => null);
    const box = el ? await el.boundingBox().catch(() => null) : null;
    // Los reCAPTCHA invisibles (v3) miden 0×0: no son un bloqueo.
    if (box && box.width > 40 && box.height > 40) return true;
  }
  return false;
}

async function bodyText(page: Page, limit = 4000): Promise<string> {
  return (await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')).slice(0, limit);
}

async function classify(page: Page): Promise<PageKind> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const text = await bodyText(page);
  if (
    PATTERNS.challengeUrl.some((r) => r.test(url)) ||
    (PATTERNS.challengeTitle.test(title) && text.length < 1500) ||
    PATTERNS.challengeText.test(text) ||
    (await visibleChallengeFrame(page))
  ) {
    return 'challenge';
  }
  if (PATTERNS.queueUrl.some((r) => r.test(url)) || PATTERNS.queueText.test(text)) return 'queue';
  if (PATTERNS.cartUrl.some((r) => r.test(url)) || (PATTERNS.cartText.test(text) && !/\/select\//i.test(url))) return 'cart';
  const passwordVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  if (passwordVisible || PATTERNS.loginUrl.some((r) => r.test(url))) return 'login';
  return 'other';
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

class Aborted extends Error {
  constructor() {
    super('Prueba cancelada');
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new Aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function parseEuros(text: string): Minor | null {
  const m = /(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?\s?€|€\s?(\d+)(?:[.,](\d{2}))?/.exec(text);
  if (!m) return null;
  const int = (m[1] ?? m[3] ?? '0').replace(/\./g, '');
  const dec = m[2] ?? m[4] ?? '00';
  return Number(int) * 100 + Number(dec);
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function acceptCookies(page: Page): Promise<void> {
  const byId = page.locator('#onetrust-accept-btn-handler');
  if (await byId.isVisible().catch(() => false)) {
    await byId.click().catch(() => undefined);
    return;
  }
  const btn = page.getByRole('button', { name: PATTERNS.cookieAccept }).first();
  if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

interface FlowCtx {
  page: Page;
  opts: RunOptions;
  deps: BotDeps;
  notified: Set<HumanReason>;
  loginAttempted: boolean;
}

async function humanOnce(ctx: FlowCtx, reason: HumanReason, message: string): Promise<void> {
  if (ctx.notified.has(reason)) return;
  ctx.notified.add(reason);
  if (ctx.opts.headless) {
    throw new Error(`${message} — pero el navegador está en modo oculto (headless). Repite la prueba con la ventana visible.`);
  }
  ctx.deps.hooks.log('human', message);
  await ctx.deps.hooks.needHuman(reason, message);
}

/** Intenta el login con credenciales del .env. Devuelve true si lo ha enviado. */
async function tryCredentialLogin(ctx: FlowCtx): Promise<boolean> {
  const { email, password } = ctx.deps.account;
  if (!email || !password || ctx.loginAttempted) return false;
  ctx.loginAttempted = true;
  const { page } = ctx;
  const emailInput = page
    .locator('input[type="email"], input[autocomplete="username"], input[name*="email" i], input[name*="user" i], input[id*="email" i]')
    .first();
  if (!(await emailInput.isVisible().catch(() => false))) return false;
  ctx.deps.hooks.log('info', `Iniciando sesión con ${email}…`);
  await emailInput.fill(email);
  const pass = page.locator('input[type="password"]').first();
  if (!(await pass.isVisible().catch(() => false))) {
    // Login en dos pasos (email → contraseña).
    await emailInput.press('Enter');
    await pass.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  }
  if (!(await pass.isVisible().catch(() => false))) return false;
  await pass.fill(password);
  await pass.press('Enter');
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
  return true;
}

/**
 * Espera hasta que la página no esté bloqueada por login, CAPTCHA o cola.
 * Devuelve el tipo de página final ('other' o 'cart').
 */
async function passGates(ctx: FlowCtx, deadline: number): Promise<'other' | 'cart'> {
  const { page, deps } = ctx;
  let lastQueueLog = 0;
  let loginSince: number | null = null;
  for (;;) {
    const kind = await classify(page);
    if (kind === 'other' || kind === 'cart') return kind;
    if (Date.now() > deadline) throw new Error(`Tiempo agotado esperando a que se resuelva: ${kind}`);

    if (kind === 'challenge') {
      await humanOnce(ctx, 'challenge', 'La web muestra una verificación (CAPTCHA/Cloudflare). Resuélvela tú en la ventana del bot; yo sigo en cuanto desaparezca.');
    } else if (kind === 'queue') {
      if (Date.now() - lastQueueLog > 15_000) {
        lastQueueLog = Date.now();
        deps.hooks.log('info', 'En cola virtual: esperando mi turno (no se salta la cola).');
      }
      if (!ctx.notified.has('queue') && ctx.opts.mode === 'real') {
        ctx.notified.add('queue');
        await deps.hooks.needHuman('queue', 'Estoy en la cola virtual del Real Madrid. Espero turno; no hace falta que hagas nada.');
      }
    } else if (kind === 'login') {
      loginSince ??= Date.now();
      await acceptCookies(page);
      const sent = await tryCredentialLogin(ctx);
      if (!sent && Date.now() - loginSince > 3000) {
        await humanOnce(ctx, 'login', 'Necesito que inicies sesión con tu cuenta del Real Madrid en la ventana del bot (se queda guardada para la próxima).');
      }
    }
    await sleep(1000, deps.signal);
  }
}

interface Candidate {
  idx: number;
  text: string;
  label: string;
  price: Minor | null;
  soldOut: boolean;
  control: 'select' | 'number' | 'plus' | 'none';
}

/** Marca en la página los bloques "zona/tarifa" que tienen precio y un control de cantidad. */
/**
 * Script que corre dentro de la página. Va como texto (no como función) porque tsx/esbuild
 * inyecta helpers (`__name`) que no existen en el navegador.
 */
const FIND_CANDIDATES_JS = `(() => {
  const priceRe = /\\d\\s?€|€\\s?\\d/;
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  document.querySelectorAll('[data-bot-candidate]').forEach((el) => el.removeAttribute('data-bot-candidate'));
  const all = Array.from(document.querySelectorAll('li, tr, article, section, div, [role="row"], [role="listitem"]'));
  const cands = all.filter((el) => {
    const t = el.innerText || '';
    return t.length > 0 && t.length < 400 && priceRe.test(t) && isVisible(el);
  });
  // Quedarse con los bloques mínimos (que no contienen otro candidato).
  const minimal = cands.filter((c) => !cands.some((o) => o !== c && c.contains(o)));
  return minimal.map((el, idx) => {
    el.setAttribute('data-bot-candidate', String(idx));
    const sel = el.querySelector('select:not([disabled])');
    const numInput = el.querySelector('input[type="number"]:not([disabled])');
    const plus = Array.from(el.querySelectorAll('button:not([disabled]), [role="button"]')).find((b) =>
      /^\\+$/.test((b.textContent || '').trim()) || /añadir|aumentar|increase|plus|sumar|más/i.test(b.getAttribute('aria-label') || ''));
    const nameEl = el.querySelector('[class*="name" i], [class*="zone" i], [class*="title" i], th, td, h3, h4, strong');
    return {
      idx,
      text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
      label: ((nameEl && nameEl.textContent) || el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      control: sel ? 'select' : numInput ? 'number' : plus ? 'plus' : 'none',
    };
  });
})()`;

/** Marca en la página los bloques "zona/tarifa" que tienen precio y un control de cantidad. */
async function findCandidates(page: Page): Promise<Candidate[]> {
  const raw = (await page.evaluate(FIND_CANDIDATES_JS)) as Array<Omit<Candidate, 'price' | 'soldOut'>>;
  return raw.map((c) => ({ ...c, price: parseEuros(c.text), soldOut: PATTERNS.soldOut.test(c.text) }));
}

function rankCandidates(cands: Candidate[], opts: RunOptions): Candidate[] {
  const prefs = opts.zones.map(normalize);
  const rank = (c: Candidate): number => {
    if (prefs.length === 0) return 0;
    const t = normalize(c.text);
    const i = prefs.findIndex((p) => t.includes(p));
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  return cands
    .filter((c) => !c.soldOut && c.control !== 'none')
    .filter((c) => opts.maxUnitPrice === null || (c.price !== null && c.price <= opts.maxUnitPrice))
    .filter((c) => Number.isFinite(rank(c)))
    .sort((a, b) => rank(a) - rank(b) || (a.price ?? Infinity) - (b.price ?? Infinity) || a.idx - b.idx);
}

async function setQuantity(block: Locator, c: Candidate, qty: number): Promise<boolean> {
  if (c.control === 'select') {
    const sel = block.locator('select:not([disabled])').first();
    const values = await sel.locator('option').evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent?.trim() ?? '' })));
    const opt = values.find((o) => o.v === String(qty) || o.t === String(qty));
    if (!opt) return false;
    await sel.selectOption(opt.v);
    return true;
  }
  if (c.control === 'number') {
    await block.locator('input[type="number"]').first().fill(String(qty));
    return true;
  }
  if (c.control === 'plus') {
    const plus = block
      .locator('button:not([disabled]), [role="button"]')
      .filter({ hasText: /^\s*\+\s*$/ })
      .or(block.locator('button[aria-label*="añadir" i], button[aria-label*="aumentar" i], button[aria-label*="increase" i], button[aria-label*="más" i]'))
      .first();
    for (let i = 0; i < qty; i++) {
      await plus.click();
      await block.page().waitForTimeout(250);
    }
    return true;
  }
  return false;
}

async function clickAddToCart(page: Page): Promise<string | null> {
  for (const re of PATTERNS.addToCart) {
    const btn = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).first();
    if ((await btn.isVisible().catch(() => false)) && (await btn.isEnabled().catch(() => false))) {
      const name = ((await btn.textContent()) ?? '').trim();
      await btn.click();
      return name || re.source;
    }
  }
  return null;
}

/** Selección automática. Devuelve lo elegido o null si no ha sabido hacerlo (→ modo asistido). */
async function autoSelect(ctx: FlowCtx): Promise<{ label: string; qty: number; unitPrice: Minor | null } | null> {
  const { page, opts, deps } = ctx;
  await acceptCookies(page);
  const cands = await findCandidates(page);
  deps.hooks.log('info', `He encontrado ${cands.length} zona(s)/tarifa(s) con precio en la página.`);
  for (const c of cands.slice(0, 12)) {
    deps.hooks.log('info', `  · ${c.label} — ${c.price === null ? '¿precio?' : (c.price / 100).toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €'}${c.soldOut ? ' (agotado)' : ''}`);
  }
  const ranked = rankCandidates(cands, opts);
  if (ranked.length === 0) {
    deps.hooks.log('warn', 'Ninguna zona cumple tus preferencias (zona, precio máximo o disponibilidad).');
    return null;
  }
  for (const c of ranked) {
    const block = page.locator(`[data-bot-candidate="${c.idx}"]`);
    try {
      if (!(await setQuantity(block, c, opts.quantity))) {
        deps.hooks.log('warn', `No puedo poner ${opts.quantity} entradas en «${c.label}»; pruebo la siguiente.`);
        continue;
      }
      deps.hooks.log('ok', `Seleccionadas ${opts.quantity} × «${c.label}».`);
      const clicked = await clickAddToCart(page);
      if (!clicked) {
        deps.hooks.log('warn', 'No encuentro el botón de añadir al carrito.');
        return null;
      }
      deps.hooks.log('info', `Pulsado «${clicked}».`);
      return { label: c.label, qty: opts.quantity, unitPrice: c.price };
    } catch (err) {
      deps.hooks.log('warn', `Fallo al seleccionar «${c.label}»: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  return null;
}

async function readCart(page: Page, picked: { label: string; qty: number; unitPrice: Minor | null } | null): Promise<Omit<SecuredCart, 'screenshot' | 'assisted' | 'eventTitle'>> {
  const text = await bodyText(page, 8000);
  const rows = await page
    .locator('tbody tr')
    .evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '')))
    .catch(() => [] as string[][]);
  const items: CartItem[] = [];
  for (const cells of rows) {
    const qtyCell = cells.find((c) => /^\d{1,2}$/.test(c));
    const priceCell = cells.find((c) => /€/.test(c));
    if (!cells[0] || !qtyCell || !priceCell) continue;
    items.push({ claimId: null, sectionId: null, sectionLabel: cells[0], row: null, seats: [], qty: Number(qtyCell), unitPrice: parseEuros(priceCell) ?? 0 });
  }
  if (items.length === 0 && picked) {
    items.push({ claimId: null, sectionId: null, sectionLabel: picked.label, row: null, seats: [], qty: picked.qty, unitPrice: picked.unitPrice ?? 0 });
  }
  const totalMatch = /total[^\d€]{0,40}((?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{2})?\s?€)/i.exec(text);
  const total = totalMatch ? parseEuros(totalMatch[1]!) : items.length ? items.reduce((s, i) => s + i.qty * i.unitPrice, 0) : null;

  let expiresAt: string | null = await page
    .locator('[data-expires-at]')
    .first()
    .getAttribute('data-expires-at', { timeout: 500 })
    .catch(() => null);
  if (!expiresAt) {
    const t = /(tiempo restante|caduca|expira|reserva)[^\d]{0,60}(\d{1,2}):(\d{2})/i.exec(text);
    if (t) expiresAt = new Date(Date.now() + (Number(t[2]) * 60 + Number(t[3])) * 1000).toISOString();
  }
  return {
    url: page.url(),
    items,
    qty: items.length ? items.reduce((s, i) => s + i.qty, 0) : null,
    total,
    currency: 'EUR',
    expiresAt,
  };
}

/** Espera a que la página llegue al carrito, atendiendo login/CAPTCHA/cola por el camino. */
async function waitForCart(ctx: FlowCtx, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if ((await passGates(ctx, deadline)) === 'cart') return true;
    const err = await ctx.page.locator('.error, [role="alert"]').first().textContent({ timeout: 300 }).catch(() => null);
    if (err?.trim()) ctx.deps.hooks.log('warn', `La web dice: ${err.trim().slice(0, 200)}`);
    await sleep(700, ctx.deps.signal);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export async function runBot(opts: RunOptions, deps: BotDeps): Promise<BotSession> {
  const { hooks } = deps;
  hooks.log('info', `Abriendo navegador (${opts.headless ? 'oculto' : 'visible'}) con el perfil guardado…`);
  const context = await chromium.launchPersistentContext(deps.profileDir, {
    headless: opts.headless,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1280, height: 900 },
  });
  const onAbort = (): void => void context.close().catch(() => undefined);
  deps.signal.addEventListener('abort', onAbort, { once: true });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const ctx: FlowCtx = { page, opts, deps, notified: new Set(), loginAttempted: false };

    hooks.log('info', `Entrando en ${opts.eventUrl}`);
    await page.goto(opts.eventUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await acceptCookies(page);

    let kind = await passGates(ctx, Date.now() + deps.humanWaitMs);
    hooks.log('ok', 'Página del evento cargada y sesión lista.');
    const eventTitle = (await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => null))?.trim() || (await page.title());

    let picked: Awaited<ReturnType<typeof autoSelect>> = null;
    let assisted = false;
    if (kind !== 'cart') {
      picked = await autoSelect(ctx);
      const ok = picked ? await waitForCart(ctx, Date.now() + 30_000) : false;
      if (!ok) {
        assisted = true;
        await humanOnce(
          ctx,
          'selection',
          'No he podido completar la selección automáticamente. Elige tú las entradas en la ventana del bot y pulsa añadir al carrito: yo detecto el carrito y te aviso.',
        );
        if (!(await waitForCart(ctx, Date.now() + deps.humanWaitMs))) {
          throw new Error('No se ha llegado al carrito dentro del tiempo de espera.');
        }
      }
      kind = 'cart';
    }

    hooks.log('ok', `¡Entradas en el carrito! (${page.url()})`);
    const cart = await readCart(page, picked);
    const screenshot = path.join(deps.capturesDir, `carrito-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    const shotOk = await page.screenshot({ path: screenshot }).then(() => true).catch(() => false);
    deps.signal.removeEventListener('abort', onAbort);
    return { context, page, cart: { ...cart, eventTitle, screenshot: shotOk ? screenshot : null, assisted } };
  } catch (err) {
    deps.signal.removeEventListener('abort', onAbort);
    // Deja una captura del punto donde se quedó para poder ajustar los selectores.
    const page = context.pages()[0];
    if (page && !deps.signal.aborted) {
      const file = path.join(deps.capturesDir, `fallo-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      if (await page.screenshot({ path: file }).then(() => true).catch(() => false)) hooks.log('info', `Captura del fallo: ${file}`);
    }
    await context.close().catch(() => undefined);
    throw err instanceof Aborted || deps.signal.aborted ? new Aborted() : err;
  }
}
