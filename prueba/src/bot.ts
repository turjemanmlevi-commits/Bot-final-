/**
 * Flujo del bot en el navegador: abrir el canal del femenino → elegir partido → sesión →
 * seleccionar asientos → carrito. Pensado para tickets.realmadrid.com (Onebox) y para la
 * réplica local (`/mock/...`), que usa el mismo DOM.
 *
 * Reglas (spec §26): CAPTCHA, colas y límites se respetan. Si aparece uno, el bot avisa y
 * espera a que lo resuelvas tú en su ventana. El bot se detiene en el carrito: nunca pulsa
 * «Pagar» ni «Comprar entradas» (checkout).
 */
import path from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import type { CartItem, Minor } from '@to/shared';
import {
  OB,
  REAL_MADRID_CHANNEL_HOME,
  chooseSeatBlock,
  classifyOnebox,
  clickButton,
  dumpDiagnostics,
  goToFirstSession,
  handleDialog,
  isPaymentButton,
  normalize,
  parseEuros,
  rankViewItems,
  readCartSummary,
  readSeats,
  readViewItems,
  releaseCart,
  seatLocator,
  setCounter,
  viewItemLocator,
  waitForSelectContent,
  zoneRank,
  type CartReadback,
  type Hooks,
  type ObPageKind,
  type Prefs,
  type SeatInfo,
  type ViewItem,
} from './onebox.js';

export type RunMode = 'simulado' | 'real';

export interface RunOptions {
  mode: RunMode;
  /** URL del partido; vacía = entrar en el canal del femenino y elegir el primer partido a la venta. */
  eventUrl: string;
  quantity: number;
  /** Zonas por orden de preferencia (texto que aparece en la web). Vacío = la más barata disponible. */
  zones: string[];
  maxUnitPrice: Minor | null;
  /** Exigir asientos seguidos en la misma fila. */
  contiguous: boolean;
  /** Si no hay `quantity` entradas que cumplan, aceptar menos (hasta 1). */
  fallbackFewer: boolean;
  headless: boolean;
}

export type LogLevel = 'info' | 'ok' | 'warn' | 'error' | 'human';
export type HumanReason = 'login' | 'challenge' | 'queue' | 'selection' | 'blocked';

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
  /** Cómo se seleccionó: plano, automático, lista… */
  strategy: string;
}

export interface BotSession {
  context: BrowserContext;
  page: Page;
  cart: SecuredCart;
  /** Quita las entradas del carrito (las libera) sin cerrar el navegador. */
  release(): Promise<void>;
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

export { parseEuros };

function eur(cents: Minor | null): string {
  return cents === null ? '¿precio?' : (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €';
}

async function isVisible(loc: Locator, timeout = 400): Promise<boolean> {
  try {
    return await loc.isVisible({ timeout });
  } catch {
    return false;
  }
}

async function innerText(loc: Locator, timeout = 800): Promise<string> {
  try {
    return ((await loc.innerText({ timeout })) ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

async function acceptCookies(page: Page): Promise<void> {
  const byId = page.locator('#onetrust-accept-btn-handler');
  if (await isVisible(byId)) {
    await byId.click().catch(() => undefined);
    return;
  }
  const onebox = page.locator('ob-cookies-notification, ob-cookies-dialog-info').first();
  if (await isVisible(onebox)) {
    const btns = onebox.locator('ob-button, button');
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      if (/aceptar|accept|permitir|allow|entendido/i.test(await innerText(b))) {
        await clickButton(b, 3000).catch(() => undefined);
        return;
      }
    }
  }
  const btn = page.getByRole('button', { name: /^(aceptar( todas)?( las cookies)?|accept all( cookies)?|permitir todas|aceptar y cerrar)$/i }).first();
  if (await isVisible(btn)) await btn.click().catch(() => undefined);
}

/** URL de la web real con idioma español (los `aria-label` de los asientos salen en español). */
export function normalizeEventUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (/realmadrid\.com$|oneboxtds\.com$/.test(u.hostname) && !u.searchParams.has('hl')) u.searchParams.set('hl', 'es-ES');
    return u.href;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Contexto del flujo
// ---------------------------------------------------------------------------

interface FlowCtx {
  page: Page;
  opts: RunOptions;
  deps: BotDeps;
  prefs: Prefs;
  hooks: Hooks;
  notified: Set<HumanReason>;
  loginAttempted: boolean;
  /** La web ha avisado de un límite de entradas: no insistir con la misma cantidad. */
  limitHit: boolean;
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
    .locator('input[type="email"], input[autocomplete="username"], input[name*="email" i], input[name*="user" i], input[id*="email" i], input[formcontrolname*="email" i]')
    .first();
  if (!(await isVisible(emailInput))) return false;
  ctx.hooks.log('info', `Iniciando sesión con ${email}…`);
  await emailInput.fill(email);
  const pass = page.locator('input[type="password"]').first();
  if (!(await isVisible(pass))) {
    await emailInput.press('Enter');
    await pass.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  }
  if (!(await isVisible(pass))) return false;
  await pass.fill(password);
  await pass.press('Enter');
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
  return true;
}

/**
 * Espera hasta que la página no esté bloqueada por login, CAPTCHA, cola o bloqueo.
 * Devuelve la clasificación final (nunca challenge/queue/login).
 */
async function passGates(ctx: FlowCtx, deadline: number): Promise<ObPageKind> {
  const { page, deps } = ctx;
  let lastQueueLog = 0;
  let loginSince: number | null = null;
  for (;;) {
    const { kind, detail } = await classifyOnebox(page);
    if (kind !== 'challenge' && kind !== 'queue' && kind !== 'login' && kind !== 'blocked') return kind;
    if (Date.now() > deadline) throw new Error(`Tiempo agotado esperando a que se resuelva: ${detail}`);
    if (kind === 'blocked') {
      throw new Error('La web ha bloqueado esta conexión (Cloudflare: «Sorry, you have been blocked»). Suele pasar con VPN o redes de empresa: prueba desde tu conexión normal y vuelve a pulsar.');
    }
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

/** Del punto de entrada (canal, catálogo, ficha o URL del partido) hasta la página de selección. */
async function navigateToSelect(ctx: FlowCtx, deadline: number): Promise<void> {
  const { page, hooks } = ctx;
  let hops = 0;
  let idleSince: number | null = null;
  for (;;) {
    const kind = await passGates(ctx, deadline);
    if (kind === 'select') return;
    if (Date.now() > deadline) throw new Error('No se ha llegado a la página de selección de entradas.');
    if (kind === 'catalog' || kind === 'event') {
      await acceptCookies(page);
      if (hops++ > 6) throw new Error('Doy vueltas por el catálogo sin llegar a un partido a la venta.');
      hooks.log('info', kind === 'catalog' ? 'Catálogo del canal: busco el primer partido a la venta…' : 'Ficha del partido: busco la sesión a la venta…');
      const moved = await goToFirstSession(page, kind, hooks);
      if (!moved) {
        await sleep(1500, ctx.deps.signal);
        const again = await goToFirstSession(page, kind, hooks);
        if (!again) throw new Error('No hay ningún partido del femenino a la venta ahora mismo en el catálogo.');
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
      await sleep(1500, ctx.deps.signal);
      continue;
    }
    if (kind === 'checkout') {
      hooks.log('warn', 'La web ha abierto el checkout (quizá ya había entradas en el carrito). Vuelvo a la selección.');
      await page.goBack({ timeout: 10_000 }).catch(() => undefined);
      await sleep(1500, ctx.deps.signal);
      if ((await classifyOnebox(page)).kind === 'checkout') await page.goto(ctx.opts.eventUrl || REAL_MADRID_CHANNEL_HOME, { waitUntil: 'domcontentloaded' });
      continue;
    }
    // 'other': la SPA aún carga o es una página desconocida.
    idleSince ??= Date.now();
    if (Date.now() - idleSince > 25_000) {
      await dumpDiagnostics(page, ctx.deps.capturesDir, 'pagina-desconocida', hooks);
      await humanOnce(ctx, 'selection', `No reconozco esta página (${page.url()}). Si hace falta, navega tú hasta el plano de asientos del partido en la ventana del bot; yo sigo desde ahí.`);
      idleSince = Date.now();
    }
    await sleep(1000, ctx.deps.signal);
  }
}

// ---------------------------------------------------------------------------
// Selección
// ---------------------------------------------------------------------------

async function cartQuantity(page: Page): Promise<number> {
  const cart = await readCartSummary(page);
  return cart?.quantity ?? 0;
}

/** Espera a que el carrito tenga exactamente `target` entradas (o más). */
async function waitForCartQty(ctx: FlowCtx, target: number, timeoutMs: number): Promise<CartReadback | null> {
  const end = Date.now() + timeoutMs;
  let last: CartReadback | null = null;
  while (Date.now() < end) {
    await handleDialog(ctx.page, ctx.hooks, { contiguous: ctx.prefs.contiguous });
    last = await readCartSummary(ctx.page);
    if (last && last.quantity >= target) return last;
    await sleep(500, ctx.deps.signal);
  }
  return last;
}

/** Atiende diálogos hasta que no quede ninguno (máximo 6). Devuelve false si la web rechazó algo. */
async function settleDialogs(ctx: FlowCtx): Promise<boolean> {
  let cancelled = false;
  for (let i = 0; i < 6; i++) {
    const outcome = await handleDialog(ctx.page, ctx.hooks, { contiguous: ctx.prefs.contiguous });
    if (outcome === 'none') break;
    if (outcome === 'alert-cancelled') cancelled = true;
    if (outcome === 'alert-limit') {
      cancelled = true;
      ctx.limitHit = true;
    }
    await sleep(400, ctx.deps.signal);
  }
  return !cancelled;
}

/** Zonas sin plano: lista de zonas de precio con contador. */
async function selectInList(ctx: FlowCtx): Promise<string | null> {
  const { page, prefs, hooks } = ctx;
  const root = page.locator(OB.priceZones).first();
  const cards = root.locator(`${OB.priceZoneCard}, .ob-selection-item`);
  const n = await cards.count();
  const found: Array<{ i: number; name: string; price: Minor | null; soldOut: boolean }> = [];
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    if (!(await isVisible(card))) continue;
    const name = (await innerText(card.locator('[data-testid="single-rate-title"], .ob-zone-label, .ob-selection-title, .ob-rate-title').first())) || (await innerText(card)).slice(0, 60);
    const priceText = (await innerText(card.locator('[data-testid="ob-pzs-rate-final-price"], [data-testid="rate-final-price"], .ob-rate-final-price, .ob-rate-price').first())) || (await innerText(card));
    const soldOut = (await card.locator('.ob-unavailable-tag, .ob-sold-out-text').count()) > 0 || /agotad|sold out/i.test(await innerText(card));
    found.push({ i, name, price: parseEuros(priceText), soldOut });
  }
  hooks.log('info', `He encontrado ${found.length} zona(s) con precio en la lista.`);
  for (const f of found.slice(0, 12)) hooks.log('info', `  · ${f.name} — ${eur(f.price)}${f.soldOut ? ' (agotado)' : ''}`);
  const ranked = found
    .filter((f) => !f.soldOut)
    .filter((f) => prefs.maxUnitPrice === null || f.price === null || f.price <= prefs.maxUnitPrice)
    .map((f) => ({ f, rank: zoneRank(f.name, prefs.zones) }))
    .filter((x) => Number.isFinite(x.rank))
    .sort((a, b) => a.rank - b.rank || (a.f.price ?? Infinity) - (b.f.price ?? Infinity) || a.f.i - b.f.i);
  for (const { f } of ranked) {
    const card = cards.nth(f.i);
    hooks.log('info', `Probando «${f.name}» (${eur(f.price)})…`);
    if (!(await setCounter(card, prefs.quantity, hooks))) {
      await setCounter(card, 0, hooks).catch(() => undefined);
      continue;
    }
    await settleDialogs(ctx);
    const cart = await waitForCartQty(ctx, prefs.quantity, 10_000);
    if (cart && cart.quantity >= prefs.quantity) {
      hooks.log('ok', `Seleccionadas ${prefs.quantity} × «${f.name}».`);
      return `lista:${f.name}`;
    }
    hooks.log('warn', `La web no ha añadido ${prefs.quantity} entradas de «${f.name}»; pruebo la siguiente.`);
    await setCounter(card, 0, hooks).catch(() => undefined);
    await releaseCart(page, hooks);
  }
  return null;
}

/** Diálogo «Buscar asientos» (selección automática de Onebox): cantidad → zona de precio → tarifa → añadir. */
async function selectAutomatic(ctx: FlowCtx, item: ViewItem): Promise<string | null> {
  const { page, prefs, hooks } = ctx;
  const itemLoc = viewItemLocator(page, item);
  const inItem = itemLoc.locator('.ob-automatic-selection-btn, [aria-label*="Buscar" i], [aria-label*="Search" i], [aria-label*="autom" i], ob-button:has-text("Buscar"), button:has-text("Buscar")').first();
  const target = (await isVisible(inItem)) ? inItem : page.locator(OB.autoGlobalButton).first();
  if (!(await isVisible(target))) return null;
  hooks.log('info', `«${item.name}»: pido a la web ${prefs.quantity} asientos seguidos (selección automática).`);
  await clickButton(target);
  await sleep(800, ctx.deps.signal);
  const dialog = page.locator(OB.dialog).last();
  for (let step = 0; step < 8; step++) {
    if (!(await isVisible(dialog))) break;
    if ((await dialog.locator(OB.autoDialog).count()) === 0 && (await dialog.locator(OB.counterAdd).count()) === 0 && (await dialog.locator(OB.priceZoneBox).count()) === 0) {
      // Otro diálogo (aviso/tarifa): lo atiende el gestor general.
      await settleDialogs(ctx);
      continue;
    }
    // 1) cantidad
    if ((await dialog.locator(OB.counterAdd).count()) > 0) {
      const ok = await setCounter(dialog, prefs.quantity, hooks);
      if (!ok) {
        hooks.log('warn', 'La web no permite esa cantidad en la selección automática.');
        await page.keyboard.press('Escape').catch(() => undefined);
        return null;
      }
    }
    // 2) zona de precio (si la pide)
    const boxes = dialog.locator(OB.priceZoneBox);
    const nb = await boxes.count();
    if (nb > 0) {
      const zones: Array<{ i: number; name: string; price: Minor | null; selected: boolean }> = [];
      for (let i = 0; i < nb; i++) {
        const b = boxes.nth(i);
        if (!(await isVisible(b))) continue;
        const t = await innerText(b);
        const cls = ((await b.getAttribute('class')) ?? '') + ' ' + ((await b.locator('.ob-pz-box').first().getAttribute('class').catch(() => null)) ?? '');
        zones.push({ i, name: (await innerText(b.locator('.ob-pz-name').first())) || t.slice(0, 60), price: parseEuros(t), selected: /selected|active/.test(cls) || (await b.getAttribute('aria-selected')) === 'true' });
      }
      const ranked = zones
        .filter((z) => prefs.maxUnitPrice === null || z.price === null || z.price <= prefs.maxUnitPrice)
        .map((z) => ({ z, rank: zoneRank(z.name, prefs.zones) }))
        .filter((x) => Number.isFinite(x.rank))
        .sort((a, b) => a.rank - b.rank || (a.z.price ?? Infinity) - (b.z.price ?? Infinity));
      const pick = ranked[0]?.z ?? (zones.find((z) => z.selected) ?? null);
      if (!pick) {
        hooks.log('warn', 'Ninguna zona de precio del diálogo cumple el precio máximo.');
        await page.keyboard.press('Escape').catch(() => undefined);
        return null;
      }
      if (!pick.selected) {
        await boxes.nth(pick.i).click({ timeout: 3000 }).catch(() => undefined);
        await sleep(300, ctx.deps.signal);
      }
    }
    // 3) tarifas (si las pide): cada mat-select vacío
    const selects = dialog.locator('mat-select');
    const ns = await selects.count();
    for (let i = 0; i < ns; i++) {
      const sel = selects.nth(i);
      const cur = await innerText(sel);
      if (cur && /€|general|adult/i.test(cur)) continue;
      await sel.click({ timeout: 3000 }).catch(() => undefined);
      await sleep(250, ctx.deps.signal);
      const opts = page.locator(OB.rateOption);
      const no = await opts.count();
      let clicked = false;
      for (let j = 0; j < no && !clicked; j++) {
        const o = opts.nth(j);
        if ((await isVisible(o)) && (await o.getAttribute('aria-disabled')) !== 'true') {
          await o.click({ timeout: 3000 }).catch(() => undefined);
          clicked = true;
        }
      }
      if (!clicked) await page.keyboard.press('Escape').catch(() => undefined);
      await sleep(200, ctx.deps.signal);
    }
    // 4) botón principal del paso (Siguiente / Buscar / Añadir al carrito). Nunca pagar.
    const actions = dialog.locator(`${OB.autoActions} ob-button, ${OB.autoActions} button, [mat-dialog-actions] ob-button, mat-dialog-actions ob-button`);
    const na = await actions.count();
    let primary: Locator | null = null;
    for (let i = na - 1; i >= 0; i--) {
      const a = actions.nth(i);
      if (!(await isVisible(a)) || (await isPaymentButton(a))) continue;
      const color = (await a.getAttribute('color')) ?? '';
      const t = normalize(await innerText(a));
      if (color === 'primary' || /siguiente|next|buscar|search|a[ñn]adir|add|confirmar|confirm|continuar|continue/.test(t)) {
        primary = a;
        break;
      }
    }
    if (!primary) {
      hooks.log('warn', 'No encuentro el botón para continuar en el diálogo de selección automática.');
      await dumpDiagnostics(page, ctx.deps.capturesDir, 'dialogo-automatico', hooks);
      await page.keyboard.press('Escape').catch(() => undefined);
      return null;
    }
    const inner = primary.locator('button').first();
    const enabled = (await inner.count()) > 0 ? await inner.isEnabled().catch(() => false) : await primary.isEnabled().catch(() => false);
    if (!enabled) {
      await sleep(800, ctx.deps.signal);
      continue;
    }
    hooks.log('info', `Diálogo: pulso «${await innerText(primary)}».`);
    await clickButton(primary);
    await sleep(1200, ctx.deps.signal);
    const err = dialog.locator('.ob-message-box.error, [role="alert"]').first();
    if (await isVisible(err)) hooks.log('warn', `La web dice: ${(await innerText(err)).slice(0, 200)}`);
  }
  await settleDialogs(ctx);
  const cart = await waitForCartQty(ctx, prefs.quantity, 12_000);
  if (cart && cart.quantity >= prefs.quantity) {
    hooks.log('ok', `La web ha añadido ${cart.quantity} entradas en «${item.name}».`);
    return `automatica:${item.name}`;
  }
  hooks.log('warn', `La selección automática en «${item.name}» no ha dejado ${prefs.quantity} entradas en el carrito.`);
  await releaseCart(page, hooks);
  return null;
}

/** Pulsa `qty` asientos seguidos del plano que está a la vista. */
async function selectSeatsOnMap(ctx: FlowCtx, zoneName: string): Promise<boolean> {
  const { page, prefs, hooks } = ctx;
  for (let attempt = 0; attempt < 3; attempt++) {
    const seats = await readSeats(page);
    if (seats.length === 0) return false;
    const block = chooseSeatBlock(seats, prefs.quantity, prefs.contiguous);
    if (!block) {
      hooks.log('warn', `En «${zoneName}» hay ${seats.length} asientos libres pero ningún bloque de ${prefs.quantity} seguidos.`);
      return false;
    }
    const desc = block.map((s) => (s.row !== null && s.seat !== null ? `fila ${s.row} asiento ${s.seat}` : s.label || s.id)).join(', ');
    hooks.log('info', `Bloque elegido en «${zoneName}»: ${desc}.`);
    let added = 0;
    let failed = false;
    for (const seat of block) {
      const before = await cartQuantity(page);
      const loc = seatLocator(page, seat);
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
        await loc.click({ timeout: 5000, force: true });
      } catch (err) {
        hooks.log('warn', `No he podido pulsar el asiento ${seat.label || seat.id}: ${(err as Error).message.split('\n')[0]}`);
        failed = true;
        break;
      }
      await sleep(400, ctx.deps.signal);
      const ok = await settleDialogs(ctx);
      if (!ok) {
        failed = true;
        break;
      }
      // Confirmación: clase `selected` en el asiento o una entrada más en el carrito.
      const end = Date.now() + 8000;
      let confirmed = false;
      while (Date.now() < end) {
        await settleDialogs(ctx);
        const cls = (await loc.getAttribute('class').catch(() => null)) ?? '';
        const qty = await cartQuantity(page);
        if (/\bselected\b/.test(cls) || qty > before) {
          confirmed = true;
          break;
        }
        await sleep(300, ctx.deps.signal);
      }
      if (!confirmed) {
        hooks.log('warn', `El asiento ${seat.label || seat.id} no se ha confirmado en el carrito.`);
        failed = true;
        break;
      }
      added++;
      hooks.log('ok', `Asiento añadido (${added}/${prefs.quantity}): ${seat.label || seat.id}.`);
    }
    if (!failed) {
      const cart = await waitForCartQty(ctx, prefs.quantity, 8000);
      if (cart && cart.quantity >= prefs.quantity) return true;
    }
    hooks.log('warn', 'Bloque incompleto: libero lo añadido' + (ctx.limitHit ? '.' : ' y pruebo con otro bloque.'));
    await releaseCart(page, hooks);
    await sleep(800, ctx.deps.signal);
    if (ctx.limitHit) return false;
  }
  return false;
}

/** Entra en una zona del visor gráfico (sector, subsector o zona no numerada) y selecciona. */
async function selectInView(ctx: FlowCtx, item: ViewItem, depth = 0): Promise<string | null> {
  const { page, prefs, hooks } = ctx;
  const loc = viewItemLocator(page, item);
  if (!(await isVisible(loc))) return null;
  // Zona no numerada con contador inline.
  if (item.isNnz || (await loc.locator(OB.counterAdd).count()) > 0) {
    hooks.log('info', `«${item.name}» es una zona sin numerar: pongo ${prefs.quantity} entradas.`);
    if (await setCounter(loc, prefs.quantity, hooks)) {
      const confirm = loc.locator('ob-confirm-button, ob-button, button').filter({ hasText: /a[ñn]adir|add|confirmar|confirm/i }).first();
      if ((await isVisible(confirm)) && !(await isPaymentButton(confirm))) await clickButton(confirm);
      await settleDialogs(ctx);
      const cart = await waitForCartQty(ctx, prefs.quantity, 10_000);
      if (cart && cart.quantity >= prefs.quantity) return `zona:${item.name}`;
      await setCounter(loc, 0, hooks).catch(() => undefined);
      await releaseCart(page, hooks);
    }
    return null;
  }
  const beforeIds = new Set((await readViewItems(page)).map((i) => i.id || String(i.index)));
  hooks.log('info', `Abro «${item.name}»${item.price !== null ? ` (${eur(item.price)})` : ''}…`);
  const clickable = loc.locator(OB.viewItemTitle).first();
  if (await isVisible(clickable)) await clickable.click({ timeout: 5000 }).catch(() => loc.click({ timeout: 5000 }));
  else await loc.click({ timeout: 5000 });
  await sleep(1200, ctx.deps.signal);
  await settleDialogs(ctx);
  // ¿Han aparecido asientos?
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if ((await page.locator(OB.seatAny).count()) > 0) break;
    if ((await loc.locator(OB.counterAdd).count()) > 0 || (await page.locator(OB.nnz).count()) > 0) break;
    await sleep(400, ctx.deps.signal);
  }
  if ((await page.locator(OB.seatAny).count()) > 0) {
    const ok = await selectSeatsOnMap(ctx, item.name);
    return ok ? `plano:${item.name}` : null;
  }
  // Zona no numerada que se ha desplegado.
  const nnz = page.locator(OB.nnz).first();
  if (await isVisible(nnz)) {
    hooks.log('info', `«${item.name}» es una zona sin numerar: pongo ${prefs.quantity} entradas.`);
    if (await setCounter(nnz, prefs.quantity, hooks)) {
      const confirm = page.locator('ob-confirm-button, ob-nnz-dialog ob-button, .ob-nnz-dialog-button').first();
      if ((await isVisible(confirm)) && !(await isPaymentButton(confirm))) await clickButton(confirm);
      await settleDialogs(ctx);
      const cart = await waitForCartQty(ctx, prefs.quantity, 10_000);
      if (cart && cart.quantity >= prefs.quantity) return `zona:${item.name}`;
      await releaseCart(page, hooks);
    }
    return null;
  }
  // Subzonas: la lista ha cambiado.
  const after = await readViewItems(page);
  const changed = after.some((i) => !beforeIds.has(i.id || String(i.index)));
  if (changed && depth < 2) {
    const ranked = rankViewItems(after, prefs);
    hooks.log('info', `«${item.name}» tiene ${after.length} subzona(s); pruebo las que cumplen tus preferencias.`);
    for (const sub of ranked.slice(0, 6)) {
      const r = await selectInView(ctx, sub, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** Intenta con la cantidad pedida y, si se permite, con menos (hasta 1). */
async function selectTickets(ctx: FlowCtx): Promise<string | null> {
  const wanted = ctx.opts.quantity;
  const quantities = ctx.opts.fallbackFewer ? Array.from({ length: wanted }, (_, i) => wanted - i) : [wanted];
  for (const qty of quantities) {
    ctx.prefs.quantity = qty;
    ctx.limitHit = false;
    if (qty !== wanted) ctx.hooks.log('warn', `No hay ${qty + 1} entradas que cumplan: pruebo con ${qty}.`);
    const r = await selectTicketsFor(ctx);
    if (r) return r;
    if (ctx.deps.signal.aborted) break;
  }
  ctx.prefs.quantity = wanted;
  return null;
}

async function selectTicketsFor(ctx: FlowCtx): Promise<string | null> {
  const { page, prefs, hooks } = ctx;
  const mode = await waitForSelectContent(page, 30_000);
  if (!mode) {
    await dumpDiagnostics(page, ctx.deps.capturesDir, 'sin-plano', hooks);
    return null;
  }
  if (mode === 'list') {
    hooks.log('info', 'La web muestra la lista de zonas (sin plano).');
    return selectInList(ctx);
  }
  const items = await readViewItems(page);
  hooks.log('info', `He encontrado ${items.length} zona(s) en el plano.`);
  for (const i of items.slice(0, 14)) hooks.log('info', `  · ${i.name} — ${eur(i.price)}${i.soldOut ? ' (agotado)' : ''}${i.hasAutomatic ? ' · automática' : ''}`);
  const ranked = rankViewItems(items, prefs);
  if (ranked.length === 0) {
    hooks.log('warn', 'Ninguna zona cumple tus preferencias (zona, precio máximo o disponibilidad).');
    return null;
  }
  const globalAuto = !ranked.some((i) => i.hasAutomatic) && (await isVisible(page.locator(OB.autoGlobalButton).first()));
  if (globalAuto && prefs.contiguous) {
    hooks.log('info', 'La web ofrece «Buscar asientos» para todo el recinto: lo pruebo con tus preferencias.');
    const r = await selectAutomatic(ctx, ranked[0]!);
    if (r) return r;
  }
  for (const item of ranked.slice(0, 6)) {
    if (item.hasAutomatic) {
      const r = await selectAutomatic(ctx, item);
      if (r) return r;
    }
    const r = await selectInView(ctx, item);
    if (r) return r;
    if (prefs.contiguous && !item.hasAutomatic) hooks.log('info', `Sin ${prefs.quantity} asientos seguidos en «${item.name}»; siguiente zona.`);
    // Volver a la vista general para la siguiente zona.
    await page.locator(OB.viewItem).first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lectura final del carrito
// ---------------------------------------------------------------------------

async function eventTitle(page: Page): Promise<string> {
  for (const sel of ['ob-page-header-item .title', 'ob-page-header-item h1', 'ob-session-header .title', 'ob-session-header', 'ob-default-session-header', 'h1', 'ob-page-header-item']) {
    const t = await innerText(page.locator(sel).first(), 1500);
    if (t) return t.split(' · ')[0]!.slice(0, 120);
  }
  return (await page.title().catch(() => '')) || 'Partido';
}

function toSecuredCart(page: Page, cart: CartReadback, title: string, strategy: string, assisted: boolean): Omit<SecuredCart, 'screenshot'> {
  const items: CartItem[] = cart.items.map((i) => ({
    claimId: null,
    sectionId: null,
    sectionLabel: i.location ? `${i.name} · ${i.location}` : i.name,
    row: i.row,
    seats: i.seats,
    qty: i.qty,
    unitPrice: i.unitPrice ?? 0,
  }));
  const known = items.filter((i) => i.unitPrice > 0);
  const total = cart.total ?? (known.length === items.length && items.length > 0 ? items.reduce((s, i) => s + i.qty * i.unitPrice, 0) : null);
  return { url: page.url(), eventTitle: title, items, qty: cart.quantity, total, currency: 'EUR', expiresAt: cart.expiresAt, assisted, strategy };
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
    viewport: { width: 1366, height: 900 },
  });
  const onAbort = (): void => void context.close().catch(() => undefined);
  deps.signal.addEventListener('abort', onAbort, { once: true });
  const prefs: Prefs = { quantity: opts.quantity, zones: opts.zones, maxUnitPrice: opts.maxUnitPrice, contiguous: opts.contiguous };

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const ctx: FlowCtx = { page, opts, deps, prefs, hooks: { log: (l, m) => hooks.log(l, m) }, notified: new Set(), loginAttempted: false, limitHit: false };
    const start = opts.eventUrl ? normalizeEventUrl(opts.eventUrl) : REAL_MADRID_CHANNEL_HOME;
    hooks.log('info', opts.eventUrl ? `Entrando en ${start}` : `Entrando en el canal del Real Madrid Femenino: ${start}`);
    await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await acceptCookies(page);

    await navigateToSelect(ctx, Date.now() + deps.humanWaitMs);
    hooks.log('ok', 'Página de selección cargada y sesión lista.');
    const title = await eventTitle(page);
    hooks.log('info', `Partido: ${title}`);

    // Carrito previo (de una prueba anterior): se vacía para empezar limpio.
    const previous = await readCartSummary(page);
    if (previous && previous.quantity > 0) {
      hooks.log('warn', `Ya había ${previous.quantity} entrada(s) en el carrito de una prueba anterior: las libero antes de empezar.`);
      await releaseCart(page, hooks);
    }

    let strategy = await selectTickets(ctx);
    let assisted = false;
    if (!strategy) {
      await dumpDiagnostics(page, deps.capturesDir, 'sin-seleccion', hooks);
      assisted = true;
      await humanOnce(
        ctx,
        'selection',
        `No he podido seleccionar ${opts.fallbackFewer ? 'ninguna entrada' : `${opts.quantity} entrada(s)`} que cumpla tus preferencias. Elige tú los asientos en la ventana del bot: yo detecto el carrito y te aviso.`,
      );
      const cart = await waitForCartQty(ctx, 1, deps.humanWaitMs);
      if (!cart || cart.quantity === 0) throw new Error('No se ha llegado al carrito dentro del tiempo de espera.');
      strategy = 'manual';
    }

    const cart = (await waitForCartQty(ctx, 1, 5000)) ?? (await readCartSummary(page));
    if (!cart || cart.quantity === 0) throw new Error('No encuentro entradas en el carrito después de seleccionar.');
    if (prefs.maxUnitPrice !== null) {
      const expensive = cart.items.filter((i) => i.unitPrice !== null && i.unitPrice > prefs.maxUnitPrice!);
      if (expensive.length) hooks.log('warn', `Ojo: ${expensive.length} línea(s) del carrito superan el precio máximo (${eur(prefs.maxUnitPrice)}).`);
    }
    if (cart.quantity < opts.quantity) hooks.log('warn', `Pedías ${opts.quantity} y hay ${cart.quantity} en el carrito (no había más que cumplieran).`);
    hooks.log('ok', `¡${cart.quantity} entrada(s) en el carrito! Total ${eur(cart.total)}${cart.expiresAt ? `, caduca a las ${new Date(cart.expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}` : ''}.`);
    const screenshot = path.join(deps.capturesDir, `carrito-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    const shotOk = await page.screenshot({ path: screenshot }).then(() => true).catch(() => false);
    deps.signal.removeEventListener('abort', onAbort);
    const secured: SecuredCart = { ...toSecuredCart(page, cart, title, strategy, assisted), screenshot: shotOk ? screenshot : null };
    return {
      context,
      page,
      cart: secured,
      release: async () => {
        try {
          await releaseCart(page, hooks);
        } catch {
          // El navegador puede estar ya cerrado.
        }
      },
    };
  } catch (err) {
    deps.signal.removeEventListener('abort', onAbort);
    const page = context.pages()[0];
    if (page && !deps.signal.aborted) {
      const file = path.join(deps.capturesDir, `fallo-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      if (await page.screenshot({ path: file }).then(() => true).catch(() => false)) hooks.log('info', `Captura del fallo: ${file}`);
      await dumpDiagnostics(page, deps.capturesDir, 'fallo', hooks).catch(() => undefined);
    }
    await context.close().catch(() => undefined);
    throw err instanceof Aborted || deps.signal.aborted ? new Aborted() : err;
  }
}
