/**
 * Receta de la web de entradas del Real Madrid (plataforma Onebox, «channels-client»).
 *
 * Los selectores salen del código real del front de Onebox (client-dists.oneboxtds.com,
 * v0.2467): componentes `ob-*`, atributos `data-testid` y el visor SVG del recinto, cuyos
 * asientos son `circle.interactive.seat.available` con `aria-label` («Fila X Asiento Y»).
 *
 * Reglas: nunca se pulsa «Pagar» ni el botón de checkout; CAPTCHA (Turnstile), cola
 * (Queue-it) y login se esperan a que los resuelva una persona.
 */
import type { Locator, Page } from 'playwright';
import type { Minor } from '@to/shared';

// ---------------------------------------------------------------------------
// Selectores (front de Onebox)
// ---------------------------------------------------------------------------

export const OB = {
  /** Página de selección de localidades: /<canal>/select/<sesión> */
  pageSelect: 'ob-page-select-locations',
  graphic: 'ob-graphic-selection',
  notGraphic: 'ob-not-graphic-selection',
  spinner: '.ob-viewport-spinner, .ob-spinner-container',
  /** Lista lateral de zonas/sectores del visor gráfico. */
  viewItem: 'ob-view-list .view-item, .view-list .view-item',
  viewItemTitle: '.view-main-info-texts-title, .ob-item-name-container',
  viewer: '#ob-channels-venue-viewer, ob-venue-viewer',
  svgContainer: '.ob-svg-container',
  seatAvailable: 'circle.interactive.seat.available:not(.sold-out):not(.selected):not(.pending), .interactive.seat.available:not(.sold-out):not(.selected):not(.pending)',
  seatAny: '.interactive.seat',
  /** Zonas sin plano (lista de zonas de precio con contador). */
  priceZones: '[data-testid="ob-price-zones-selection"], ob-price-zones-selection',
  priceZoneCard: '.ob-selection-card',
  /** Zona no numerada dentro del visor gráfico. */
  nnz: 'ob-not-numbered-zone-selection',
  counterAdd: '[data-testid="counter-add"]',
  counterRemove: '[data-testid="counter-remove"]',
  counterQty: '[data-testid="counter-quantity"]',
  dialog: 'mat-dialog-container, .cdk-dialog-container',
  seatDialogConfirm: '[data-testid="select-rate-dialog-confirm"]',
  seatDialogClose: '[data-testid="select-rate-dialog-close"]',
  rateSelect: 'mat-select.ob-select-rate, .ob-select-rate mat-select, mat-select',
  rateOption: '.ob-select-rate-options mat-option, mat-option',
  autoDialog: 'ob-select-automatic-seat-dialog',
  autoActions: '.automatic-seat-actions',
  autoGlobalButton: 'ob-graphic-selection .ob-automatic-selection-btn, ob-graphic-selection [aria-label*="Buscar asientos" i]',
  priceZoneBox: '[data-testid="ob-price-zone-box"], ob-pricezone-box',
  /** Resumen del carrito en la propia página de selección. */
  cartSummary: 'ob-select-graphic-cart-summary, ob-select-cart-summary, ob-select-expandable-summary, ob-cart-summary, ob-sidebar-cart, ob-overlay-cart, ob-checkout-summary',
  cartTotal: '[data-testid="cart-summary-total"], [data-testid="cart-total"]',
  cartItem: 'ob-cart-summary-card-item, .ob-location-card',
  cartItemDelete: '[data-testid="cart-summary-delete"]',
  cartCountdown: '.ob-flat-countdown, ob-order-countdown, .ob-countdown-value',
  cartButton: '[data-testid="cart-button"]',
  cartCounter: '[data-testid="shopping-cart-counter"]',
  summaryTab: 'ob-graphic-selection-tabs [value="summary"], .tabs-group [value="summary"]',
  /** Botones que llevan al pago: los gestores genéricos NUNCA los pulsan. */
  paymentButtons: '[data-testid="cart-summary-payment-btn"], [data-testid="sidebar-pzs-selection-payment-btn"], [data-testid="checkout-payment-button"], [data-testid="cart-payment-button"], [data-testid="cart-continue-button"]',
  /** «Comprar entradas» en la selección: lleva a la pantalla de checkout (datos y pago). Solo lo pulsa `clickGoToCheckout`. */
  goToCheckoutButtons: '[data-testid="cart-summary-payment-btn"], [data-testid="sidebar-pzs-selection-payment-btn"], [data-testid="cart-continue-button"], [data-testid="cart-payment-button"]',
  /** Botón de pago de la pantalla de checkout: NUNCA se pulsa. */
  checkoutPayButton: '[data-testid="checkout-payment-button"]',
  /** Vaciar el carrito entero (cabecera del resumen en el checkout o en el carrito lateral). */
  cartClearButtons: 'ob-checkout-summary ob-button[prefixIcon="delete"], ob-sidebar-cart ob-button[prefixIcon="delete"], ob-overlay-cart ob-button[prefixIcon="delete"], ob-cart-summary ob-button[prefixIcon="delete"], [data-testid="cart-summary-delete-session-btn"], ob-button[aria-label*="vaciar" i], ob-button[arialabel*="vaciar" i]',
  /** Catálogo y ficha de evento. */
  catalogCard: '.ob-catalog-card, [data-testid="catalog-item-card"]',
  catalogCardTitle: '[data-testid="catalog-card-title"], .title',
  sessionCard: '[data-testid="ob-sessions-list"] [data-testid="catalog-item-card"], [data-testid="ob-sessions-hours-list"] [data-testid="catalog-item-card"], ob-sessions-list [data-testid="catalog-item-card"], [data-testid="catalog-item-card"]',
  sessionCta: '[data-testid="catalog-item-card-action-button"], [data-testid="sessions-cta-button"], [data-testid="one-step-action-button"]',
  unavailableTag: '.ob-unavailable-tag, .ob-coming-soon-tag, .available_soon, .ob-sold-out, .session-sold-out, .session-not-on-sale',
  /** Login y retos. */
  loginForm: '[data-testid="ob-login-form"], ob-login-form, ob-onebox-login-dialog, ob-vendor-login-dialog, ob-collective-login-dialog',
  turnstile: 'ob-turnstile-challenge, iframe[src*="challenges.cloudflare.com"], .cf-turnstile',
} as const;

export const REAL_MADRID_CHANNEL_HOME = 'https://tickets.realmadrid.com/realmadrid_femenino/?hl=es-ES';

export type ObPageKind = 'challenge' | 'blocked' | 'queue' | 'login' | 'catalog' | 'event' | 'select' | 'checkout' | 'other';

export interface ObClassification {
  kind: ObPageKind;
  detail: string;
}

export interface ViewItem {
  index: number;
  id: string;
  name: string;
  price: Minor | null;
  soldOut: boolean;
  disabled: boolean;
  /** Botón «Buscar asientos» (selección automática de Onebox). */
  hasAutomatic: boolean;
  /** Zona no numerada: contador inline en vez de plano. */
  isNnz: boolean;
}

export interface SeatInfo {
  id: string;
  x: number;
  y: number;
  r: number;
  label: string;
  row: string | null;
  seat: number | null;
}

export interface CartReadback {
  quantity: number;
  total: Minor | null;
  items: Array<{ name: string; location: string; unitPrice: Minor | null; seats: string[]; row: string | null; qty: number }>;
  expiresAt: string | null;
  source: string;
}

export interface Prefs {
  quantity: number;
  zones: string[];
  maxUnitPrice: Minor | null;
  contiguous: boolean;
}

export interface Hooks {
  log(level: 'info' | 'ok' | 'warn' | 'error' | 'human', message: string): void;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function parseEuros(text: string): Minor | null {
  const m = /(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?\s?€|€\s?(\d+)(?:[.,](\d{1,2}))?/.exec(text);
  if (!m) return null;
  const int = (m[1] ?? m[3] ?? '0').replace(/\./g, '');
  const dec = (m[2] ?? m[4] ?? '00').padEnd(2, '0');
  return Number(int) * 100 + Number(dec);
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Palabras que no distinguen una zona de otra. */
const GENERIC_WORDS = new Set(['grada', 'zona', 'sector', 'graderio', 'stand', 'area', 'bloque', 'block', 'tier', 'nivel', 'planta', 'entrada', 'entradas']);

/** Posición de una zona en la lista de preferencias (Infinity = no coincide). */
export function zoneRank(name: string, zones: string[]): number {
  if (zones.length === 0) return 0;
  const n = normalize(name);
  const i = zones.findIndex((z) => {
    const q = normalize(z);
    if (!q) return false;
    if (n.includes(q)) return true;
    // Todas las palabras significativas de la preferencia aparecen («grada oeste» ~ «lateral oeste»).
    const words = q.split(' ').filter((w) => w.length > 2 && !GENERIC_WORDS.has(w));
    return words.length > 0 && words.every((w) => n.includes(w));
  });
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function visible(loc: Locator, timeout = 400): Promise<boolean> {
  try {
    return await loc.isVisible({ timeout });
  } catch {
    return false;
  }
}

async function text(loc: Locator, timeout = 800): Promise<string> {
  try {
    return ((await loc.innerText({ timeout })) ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

async function bodyText(page: Page, limit = 4000): Promise<string> {
  return (await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')).slice(0, limit);
}

/** Clic en un `ob-button` (o cualquier contenedor): pulsa el <button> interior si existe. */
export async function clickButton(loc: Locator, timeout = 5000): Promise<void> {
  const inner = loc.locator('button, a[href]').first();
  if ((await inner.count()) > 0) {
    await inner.click({ timeout });
    return;
  }
  await loc.click({ timeout });
}

/** Es un botón que llevaría al pago o al checkout: prohibido. */
export async function isPaymentButton(loc: Locator): Promise<boolean> {
  const testid = (await loc.getAttribute('data-testid', { timeout: 600 }).catch(() => null)) ?? '';
  if (/payment|checkout|continue|booking|^pay/.test(testid)) return true;
  const t = normalize(await text(loc));
  // «Comprar entradas» en el catálogo solo lleva a la selección; el botón de pago de la selección se reconoce por su data-testid.
  return /\b(pagar|pay now|checkout|finalizar (la )?compra|tramitar|ir a pagar|go to checkout|reservar|book tickets|guardar reserva)\b/.test(t);
}

// ---------------------------------------------------------------------------
// Clasificación de la página
// ---------------------------------------------------------------------------

const RX = {
  challengeUrl: /challenges\.cloudflare\.com|\/cdn-cgi\/challenge/i,
  challengeTitle: /just a moment|un momento|attention required|verif(y|ica)/i,
  challengeText: /verify you are human|verifica que eres (un )?humano|comprobando (tu|el) navegador|checking your browser|verificaci[oó]n de seguridad/i,
  blockedText: /sorry, you have been blocked|has sido bloqueado|access denied|acceso denegado/i,
  queueUrl: /queue-it\.net|\/cola(\?|\/|$)|waitingroom|waiting-room|sala-de-espera/i,
  queueText: /cola virtual|est[áa]s en la cola|sala de espera|waiting room|you are now in line|tu turno/i,
  loginUrl: /\/login|\/signin|\/sign-in|\/acceso|\/oauth|\/authorize|you\.realmadrid|account\.oneboxtds|auth\./i,
  checkoutUrl: /\/checkout(\/|\?|$)/i,
  selectUrl: /\/select\/\d+/i,
  eventUrl: /\/events\/[^/]+(\?|$)/i,
  catalogUrl: /\/(events|billboard)\/?(\?|$)|\/[a-z0-9_-]+\/?(\?hl=[^&]+)?$/i,
};

async function visibleChallengeFrame(page: Page): Promise<boolean> {
  for (const f of page.frames()) {
    if (!/challenges\.cloudflare\.com|recaptcha\/api2\/(anchor|bframe)|hcaptcha\.com/i.test(f.url())) continue;
    const el = await f.frameElement().catch(() => null);
    const box = el ? await el.boundingBox().catch(() => null) : null;
    if (box && box.width > 40 && box.height > 40) return true;
  }
  return false;
}

export async function classifyOnebox(page: Page): Promise<ObClassification> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const body = await bodyText(page);
  if (RX.blockedText.test(body) && body.length < 2500) return { kind: 'blocked', detail: 'La web ha bloqueado el acceso (Cloudflare).' };
  if (RX.challengeUrl.test(url) || (RX.challengeTitle.test(title) && body.length < 1500) || RX.challengeText.test(body) || (await visibleChallengeFrame(page))) {
    return { kind: 'challenge', detail: 'Verificación (CAPTCHA/Cloudflare)' };
  }
  const turnstile = page.locator(OB.turnstile).first();
  if (await visible(turnstile)) {
    const box = await turnstile.boundingBox().catch(() => null);
    if (box && box.width > 40 && box.height > 40) return { kind: 'challenge', detail: 'Verificación Turnstile' };
  }
  if (RX.queueUrl.test(url) || RX.queueText.test(body)) return { kind: 'queue', detail: 'Cola virtual' };
  if (RX.checkoutUrl.test(url) || (await visible(page.locator('ob-page-pre-checkout, ob-page-full-checkout, ob-page-booking-checkout').first()))) {
    return { kind: 'checkout', detail: 'Página de checkout' };
  }
  const passwordVisible = await visible(page.locator('input[type="password"]').first());
  const loginDialog = await visible(page.locator(OB.loginForm).first());
  if (passwordVisible || loginDialog) return { kind: 'login', detail: 'Inicio de sesión' };
  if (await visible(page.locator(OB.pageSelect).first())) return { kind: 'select', detail: 'Selección de localidades' };
  if (await visible(page.locator(OB.priceZones).first())) return { kind: 'select', detail: 'Selección de entradas (lista en la ficha)' };
  if (RX.selectUrl.test(url)) {
    // La página de selección aún carga (o pide login por redirección).
    if (RX.loginUrl.test(url)) return { kind: 'login', detail: 'Inicio de sesión' };
    return { kind: 'select', detail: 'Selección (cargando)' };
  }
  if (await visible(page.locator('ob-page-event').first())) return { kind: 'event', detail: 'Ficha del evento' };
  if (await visible(page.locator('ob-page-events, ob-page-billboard, ob-catalog-list').first())) return { kind: 'catalog', detail: 'Catálogo' };
  if (RX.loginUrl.test(url)) return { kind: 'login', detail: 'Inicio de sesión' };
  if (RX.eventUrl.test(url)) return { kind: 'event', detail: 'Ficha del evento (cargando)' };
  return { kind: 'other', detail: title || url };
}

/** Espera a que la página de selección tenga contenido (plano o lista de zonas). */
export async function waitForSelectContent(page: Page, timeoutMs: number): Promise<'graphic' | 'list' | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await visible(page.locator(OB.priceZones).first())) return 'list';
    if (await visible(page.locator(OB.viewItem).first())) return 'graphic';
    if ((await visible(page.locator(OB.graphic).first())) && (await page.locator(OB.seatAny).count()) > 0) return 'graphic';
    await sleep(500);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Catálogo: del canal al partido
// ---------------------------------------------------------------------------

/**
 * Desde el catálogo o la ficha del evento, entra en la primera sesión a la venta.
 * Devuelve true si ha navegado (hay que volver a clasificar la página).
 */
export async function goToFirstSession(page: Page, kind: 'catalog' | 'event', hooks: Hooks): Promise<boolean> {
  const cards = page.locator(kind === 'event' ? OB.sessionCard : OB.catalogCard);
  const n = await cards.count();
  if (n === 0) {
    // Ficha de un solo paso: botón directo.
    const cta = page.locator(OB.sessionCta).first();
    if ((await visible(cta)) && !(await isPaymentButton(cta))) {
      hooks.log('info', `Entrando: «${await text(cta)}».`);
      await clickButton(cta);
      return true;
    }
    return false;
  }
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    if (!(await visible(card))) continue;
    const label = (await text(card.locator(OB.catalogCardTitle).first())) || (await text(card)).slice(0, 80);
    const blocked = (await card.locator(OB.unavailableTag).count()) > 0 || /agotad|sold out|pr[oó]ximamente|coming soon|no disponible/i.test(await text(card));
    if (blocked) {
      hooks.log('info', `  · ${label}: agotado o todavía no a la venta; sigo.`);
      continue;
    }
    hooks.log('ok', `Partido elegido: ${label}.`);
    const cta = card.locator(OB.sessionCta).first();
    if ((await cta.count()) > 0 && !(await isPaymentButton(cta))) await clickButton(cta);
    else await card.click({ timeout: 5000 });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lista de zonas del visor gráfico
// ---------------------------------------------------------------------------

const READ_VIEW_ITEMS_JS = `(() => {
  const items = Array.from(document.querySelectorAll('ob-view-list .view-item, .view-list .view-item'));
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  return items.map((el, index) => {
    const titleEl = el.querySelector('.view-main-info-texts-title') || el.querySelector('.ob-item-name-container') || el.querySelector('.view-main-info-texts');
    const btns = Array.from(el.querySelectorAll('ob-button, button'));
    const aria = btns.map((b) => norm((b.getAttribute('aria-label', { timeout: 600 }) || '') + ' ' + (b.textContent || ''))).join(' | ').toLowerCase();
    const cls = el.className || '';
    return {
      index,
      id: (el.id || '').replace(/^view-item-/, ''),
      name: norm(titleEl ? titleEl.textContent : (el.textContent || '').split('\\n')[0]).slice(0, 120),
      text: norm(el.textContent).slice(0, 400),
      soldOut: /ob-sold-out/.test(cls) || !!el.querySelector('.ob-sold-out-text, .ob-unavailable-tag'),
      disabled: /\\bdisabled\\b/.test(cls) || el.getAttribute('aria-disabled', { timeout: 600 }) === 'true',
      hasAutomatic: /buscar|search|autom[aá]tic|mejores asientos|best seats|ob-automatic-selection-btn/.test(aria + ' ' + Array.from(el.querySelectorAll('ob-button')).map((b) => b.className).join(' ')),
      isNnz: !!el.querySelector('ob-not-numbered-zone-selection, [data-testid="counter-add"]') || /ob-view-list-intermediate-nnz/.test(cls),
    };
  });
})()`;

export async function readViewItems(page: Page): Promise<ViewItem[]> {
  const raw = (await page.evaluate(READ_VIEW_ITEMS_JS)) as Array<Omit<ViewItem, 'price'> & { text: string }>;
  return raw.map((r) => ({ ...r, price: parseEuros(r.text), soldOut: r.soldOut || /agotad|sold out/i.test(r.text) }));
}

export function rankViewItems(items: ViewItem[], prefs: Prefs): ViewItem[] {
  return items
    .filter((i) => !i.soldOut && !i.disabled && i.name)
    .filter((i) => prefs.maxUnitPrice === null || i.price === null || i.price <= prefs.maxUnitPrice)
    .map((i) => ({ i, rank: zoneRank(i.name, prefs.zones) }))
    .filter((x) => Number.isFinite(x.rank))
    .sort((a, b) => a.rank - b.rank || (a.i.price ?? Number.POSITIVE_INFINITY) - (b.i.price ?? Number.POSITIVE_INFINITY) || a.i.index - b.i.index)
    .map((x) => x.i);
}

export function viewItemLocator(page: Page, item: ViewItem): Locator {
  if (item.id) return page.locator(`[id="view-item-${item.id}"]`).first();
  return page.locator(OB.viewItem).nth(item.index);
}

// ---------------------------------------------------------------------------
// Diálogos (tarifa, avisos)
// ---------------------------------------------------------------------------

async function pickRate(dialog: Locator, hooks: Hooks): Promise<void> {
  const selects = dialog.locator(OB.rateSelect);
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const sel = selects.nth(i);
    if (!(await visible(sel))) continue;
    const current = await text(sel);
    const empty = !current || /selecciona|select|elige|choose|tarifa|rate/i.test(current) && !/€/.test(current);
    if (!empty) continue;
    await sel.click({ timeout: 3000 }).catch(() => undefined);
    await sleep(250);
    const options = dialog.page().locator(OB.rateOption);
    const total = await options.count();
    let chosen: Locator | null = null;
    let fallback: Locator | null = null;
    for (let j = 0; j < total; j++) {
      const opt = options.nth(j);
      if (!(await visible(opt))) continue;
      const disabled = (await opt.getAttribute('aria-disabled', { timeout: 600 })) === 'true';
      if (disabled) continue;
      const t = normalize(await text(opt));
      fallback ??= opt;
      if (/general|adult|publico|público|normal|estandar|standard/.test(t)) {
        chosen = opt;
        break;
      }
    }
    const pick = chosen ?? fallback;
    if (pick) {
      hooks.log('info', `Tarifa: «${await text(pick)}».`);
      await pick.click({ timeout: 3000 });
      await sleep(200);
    } else {
      await dialog.page().keyboard.press('Escape').catch(() => undefined);
    }
  }
}

export type DialogOutcome = 'none' | 'seat-confirmed' | 'alert-continued' | 'alert-cancelled' | 'alert-limit' | 'closed';

/**
 * Atiende el diálogo abierto (si lo hay): tarifa de un asiento, aviso de asientos
 * no consecutivos / sueltos, límite… Nunca pulsa pagar.
 */
export async function handleDialog(page: Page, hooks: Hooks, opts: { contiguous: boolean }): Promise<DialogOutcome> {
  const dialog = page.locator(OB.dialog).last();
  if (!(await visible(dialog))) return 'none';
  const confirm = dialog.locator(OB.seatDialogConfirm).first();
  if (await visible(confirm)) {
    await pickRate(dialog, hooks);
    const inner = confirm.locator('button').first();
    const enabledNow = async (): Promise<boolean> => ((await inner.count()) > 0 ? inner.isEnabled({ timeout: 800 }).catch(() => false) : confirm.isEnabled({ timeout: 800 }).catch(() => false));
    const end = Date.now() + 4000;
    while (!(await enabledNow()) && Date.now() < end) {
      await pickRate(dialog, hooks);
      await sleep(300);
    }
    if (!(await enabledNow())) {
      hooks.log('warn', 'El botón de confirmar el asiento sigue desactivado (¿falta elegir tarifa?): cierro el diálogo.');
      const close = dialog.locator(OB.seatDialogClose).first();
      if (await visible(close)) await clickButton(close, 2000).catch(() => undefined);
      else await dialog.page().keyboard.press('Escape').catch(() => undefined);
      await sleep(300);
      return 'closed';
    }
    await clickButton(confirm);
    await sleep(300);
    return 'seat-confirmed';
  }
  if (await visible(dialog.locator(OB.autoDialog).first())) return 'none';
  const t = normalize(await text(dialog));
  const nonConsecutive = /consecutiv|no est[aá]n juntos|no quedan juntos|separad/.test(t);
  const orphan = /hu[eé]rfan|orphan|suelto|aislad|un asiento libre|single seat/.test(t);
  const limit = /l[ií]mite|limit|m[aá]ximo|maximum/.test(t) && !nonConsecutive;
  const buttons = dialog.locator('[mat-dialog-actions] ob-button, mat-dialog-actions ob-button, [mat-dialog-actions] button, mat-dialog-actions button, .mat-mdc-dialog-actions button, ob-button, button');
  const n = await buttons.count();
  const visibleButtons: Locator[] = [];
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if ((await visible(b)) && !(await isPaymentButton(b))) visibleButtons.push(b);
  }
  if (visibleButtons.length === 0) {
    await page.keyboard.press('Escape').catch(() => undefined);
    return 'closed';
  }
  const labelled = await Promise.all(visibleButtons.map(async (b) => ({ b, t: normalize(await text(b)), primary: await isPrimary(b) })));
  const cancel = labelled.find((x) => /volver|atr[aá]s|cancel|cerrar|close|back|no\b/.test(x.t)) ?? labelled[0]!;
  const action = labelled.find((x) => x.primary && x !== cancel) ?? labelled.find((x) => /continuar|confirmar|aceptar|entendido|ok|s[ií]\b|continue|confirm|accept|understood/.test(x.t)) ?? labelled[labelled.length - 1]!;
  if (nonConsecutive && opts.contiguous) {
    hooks.log('warn', `La web avisa de asientos no consecutivos: vuelvo atrás («${cancel.t}»).`);
    await clickButton(cancel.b);
    await sleep(300);
    return 'alert-cancelled';
  }
  if (limit && !orphan) {
    hooks.log('warn', `Aviso de la web (límite): ${t.slice(0, 160)}`);
    await clickButton(cancel.b);
    await sleep(300);
    return 'alert-limit';
  }
  hooks.log('info', `Aviso de la web: «${t.slice(0, 120)}» → «${action.t}».`);
  await clickButton(action.b);
  await sleep(300);
  return 'alert-continued';
}

async function isPrimary(b: Locator): Promise<boolean> {
  const color = (await b.getAttribute('color', { timeout: 600 }).catch(() => null)) ?? '';
  const cls = (await b.getAttribute('class', { timeout: 600 }).catch(() => null)) ?? '';
  const inner = b.locator('button').first();
  const innerCls = (await inner.count()) > 0 ? ((await inner.getAttribute('class', { timeout: 600 }).catch(() => null)) ?? '') : '';
  // Un <button> dentro de un <ob-button color="primary"> también es principal.
  const hostColor = (await b.locator('xpath=ancestor::ob-button[1]').first().getAttribute('color', { timeout: 600 }).catch(() => null)) ?? '';
  return color === 'primary' || hostColor === 'primary' || /mat-primary|mdc-button--unelevated|mat-mdc-unelevated-button|primary/.test(cls + ' ' + innerCls);
}

// ---------------------------------------------------------------------------
// Asientos en el plano
// ---------------------------------------------------------------------------

const READ_SEATS_JS = `(() => {
  const sel = 'circle.interactive.seat.available, .interactive.seat.available';
  const els = Array.from(document.querySelectorAll(sel)).filter((el) => {
    const c = el.classList;
    return !c.contains('sold-out') && !c.contains('selected') && !c.contains('pending') && !c.contains('filtered');
  });
  const rowRx = /(?:fila|row|reihe|rang)\\s*[:#]?\\s*([A-Za-z0-9]+)/i;
  const seatRx = /(?:asiento|butaca|seat|si[eè]ge|platz|localidad)\\s*[:#]?\\s*([A-Za-z0-9]+)/i;
  return els.map((el) => {
    const b = el.getBoundingClientRect();
    const label = el.getAttribute('aria-label', { timeout: 600 }) || el.getAttribute('aria-description', { timeout: 600 }) || '';
    const rm = rowRx.exec(label); const sm = seatRx.exec(label);
    return {
      id: el.getAttribute('id', { timeout: 600 }) || '',
      x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(b.width, b.height) / 2,
      label,
      row: rm ? rm[1] : null,
      seat: sm && /^\\d+$/.test(sm[1]) ? Number(sm[1]) : null,
    };
  }).filter((s) => s.id && s.r > 0);
})()`;

export async function readSeats(page: Page): Promise<SeatInfo[]> {
  return (await page.evaluate(READ_SEATS_JS)) as SeatInfo[];
}

/** Agrupa los asientos disponibles en tramos contiguos (misma fila, numeración o geometría seguida). */
export function contiguousGroups(seats: SeatInfo[]): SeatInfo[][] {
  const groups: SeatInfo[][] = [];
  const byRow = new Map<string, SeatInfo[]>();
  const labelled = seats.filter((s) => s.row !== null && s.seat !== null);
  if (labelled.length >= seats.length * 0.8) {
    for (const s of labelled) {
      const key = s.row!;
      byRow.set(key, [...(byRow.get(key) ?? []), s]);
    }
    for (const row of byRow.values()) {
      row.sort((a, b) => a.seat! - b.seat!);
      let run: SeatInfo[] = [];
      for (const s of row) {
        const prev = run[run.length - 1];
        if (prev && s.seat! === prev.seat! + 1) run.push(s);
        else {
          if (run.length) groups.push(run);
          run = [s];
        }
      }
      if (run.length) groups.push(run);
    }
    return groups;
  }
  // Geometría: misma altura (±60 % del radio) y separación horizontal ≤ 2,6 radios.
  const sorted = [...seats].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: SeatInfo[][] = [];
  for (const s of sorted) {
    const row = rows.find((r) => Math.abs(r[0]!.y - s.y) <= Math.max(2, r[0]!.r * 0.6));
    if (row) row.push(s);
    else rows.push([s]);
  }
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let run: SeatInfo[] = [];
    for (const s of row) {
      const prev = run[run.length - 1];
      if (prev && s.x - prev.x <= Math.max(prev.r, s.r) * 2.6) run.push(s);
      else {
        if (run.length) groups.push(run);
        run = [s];
      }
    }
    if (run.length) groups.push(run);
  }
  return groups;
}

/**
 * Elige `qty` asientos seguidos. Evita dejar un asiento suelto a un lado del bloque
 * (la web avisa de «asientos huérfanos»). Devuelve null si no hay bloque suficiente.
 */
export function chooseSeatBlock(seats: SeatInfo[], qty: number, contiguous: boolean): SeatInfo[] | null {
  if (qty <= 0) return [];
  const groups = contiguousGroups(seats);
  const candidates: Array<{ block: SeatInfo[]; score: number }> = [];
  for (const g of groups) {
    if (g.length < qty) continue;
    for (let start = 0; start + qty <= g.length; start++) {
      const left = start;
      const right = g.length - (start + qty);
      const orphan = left === 1 || right === 1;
      const leftover = left + right;
      // Mejor: sin huérfanos, dejando el menor resto posible (bloques ajustados), y al principio del tramo.
      candidates.push({ block: g.slice(start, start + qty), score: (orphan ? 1000 : 0) + leftover * 10 + start });
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]!.block;
  }
  if (contiguous) return null;
  // Sueltos: los que estén, primero los tramos más largos.
  const flat = groups.sort((a, b) => b.length - a.length).flat();
  return flat.length >= qty ? flat.slice(0, qty) : null;
}

export function seatLocator(page: Page, seat: SeatInfo): Locator {
  return page.locator(`[id="${seat.id.replace(/"/g, '\\"')}"]`).first();
}

// ---------------------------------------------------------------------------
// Contadores (zonas sin plano, zonas no numeradas, diálogo automático)
// ---------------------------------------------------------------------------

export async function readCounter(scope: Locator): Promise<number | null> {
  const q = scope.locator(OB.counterQty).first();
  if (await visible(q)) {
    const t = await text(q);
    const m = /\d+/.exec(t);
    if (m) return Number(m[0]);
    const v = await q.locator('input').first().inputValue({ timeout: 600 }).catch(() => '');
    if (/^\d+$/.test(v)) return Number(v);
  }
  const input = scope.locator('input[formcontrolname="quantity"], input[type="number"]').first();
  if (await visible(input)) {
    const v = await input.inputValue({ timeout: 600 }).catch(() => '');
    if (/^\d+$/.test(v)) return Number(v);
  }
  return null;
}

/** Ajusta un contador `ob-counter-input` hasta `target` pulsando +/-. */
export async function setCounter(scope: Locator, target: number, hooks: Hooks): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    const current = await readCounter(scope);
    if (current === null) return false;
    if (current === target) return true;
    const btn = scope.locator(current < target ? OB.counterAdd : OB.counterRemove).first();
    if (!(await visible(btn))) return false;
    const inner = btn.locator('button').first();
    const enabled = (await inner.count()) > 0 ? await inner.isEnabled({ timeout: 800 }).catch(() => false) : await btn.isEnabled({ timeout: 800 }).catch(() => false);
    if (!enabled) {
      hooks.log('warn', `El contador no deja pasar de ${current} (límite de la web).`);
      return false;
    }
    await clickButton(btn, 3000);
    await sleep(350);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lectura del carrito
// ---------------------------------------------------------------------------

const READ_CART_JS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const roots = Array.from(document.querySelectorAll('ob-select-graphic-cart-summary, ob-select-cart-summary, ob-select-expandable-summary, ob-cart-summary, ob-sidebar-cart, ob-overlay-cart, ob-checkout-summary'));
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const root = roots.find(vis) || roots[0] || null;
  if (!root) return null;
  const all = Array.from(root.querySelectorAll('ob-cart-summary-card-item, .ob-location-card'));
  // Un elemento y su tarjeta interior cuentan una sola vez.
  const nodes = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  const items = nodes.map((it) => {
    const name = norm((it.querySelector('.ob-item-card-name, .ob-title, .ob-item-card-title') || {}).textContent);
    const location = norm((it.querySelector('.ob-location') || {}).textContent);
    const keys = Array.from(it.querySelectorAll('.ob-location-key')).map((k) => norm(k.textContent));
    const priceEl = it.querySelector('[data-testid="ob-summary-item-price"], [data-testid="ob-summary-item-promoted-price"], .ob-price');
    const counter = it.querySelector('[data-testid="counter-quantity"]');
    const counterInput = it.querySelector('input[formcontrolname="quantity"]');
    const txt = norm(it.textContent).slice(0, 300);
    const qtyM = /(\\d+)\\s*(?:x|×|entradas?|tickets?)\\b/i.exec(txt);
    const qty = counter && /\\d+/.test(counter.textContent || '') ? Number(/\\d+/.exec(counter.textContent)[0])
      : counterInput && /^\\d+$/.test(counterInput.value) ? Number(counterInput.value)
      : qtyM ? Number(qtyM[1]) : 1;
    return { name, location, keys, qty: qty > 0 ? qty : 1, priceText: norm(priceEl ? priceEl.textContent : ''), text: txt };
  });
  const totalEl = root.querySelector('[data-testid="cart-summary-total"], [data-testid="cart-total"], .ob-cart-summary-total, .total-price, .total');
  const qtyEl = root.querySelector('.quantity, .total-items, .items-tag');
  const cd = root.querySelector('.ob-flat-countdown, ob-order-countdown, .ob-countdown-value') || document.querySelector('.ob-flat-countdown, ob-order-countdown, .ob-countdown-value');
  const counter = document.querySelector('[data-testid="shopping-cart-counter"]');
  return {
    source: root.tagName.toLowerCase(),
    totalText: norm(totalEl ? totalEl.textContent : ''),
    qtyText: norm(qtyEl ? qtyEl.textContent : ''),
    counterText: norm(counter ? counter.textContent : ''),
    countdownText: norm(cd ? cd.textContent : ''),
    items,
    text: norm(root.textContent).slice(0, 600),
  };
})()`;

interface RawCart {
  source: string;
  totalText: string;
  qtyText: string;
  counterText: string;
  countdownText: string;
  items: Array<{ name: string; location: string; keys: string[]; qty: number; priceText: string; text: string }>;
  text: string;
}

function countdownToIso(t: string): string | null {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
  if (!m) return null;
  const secs = m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
  if (secs <= 0) return null;
  return new Date(Date.now() + secs * 1000).toISOString();
}

export async function readCartSummary(page: Page): Promise<CartReadback | null> {
  let raw = (await page.evaluate(READ_CART_JS).catch(() => null)) as RawCart | null;
  if (!raw || (raw.items.length === 0 && !raw.totalText)) {
    // Pestaña «Resumen» (móvil) o carrito superior.
    const tab = page.locator(OB.summaryTab).first();
    if (await visible(tab)) {
      await tab.click({ timeout: 2000 }).catch(() => undefined);
      await sleep(400);
      raw = (await page.evaluate(READ_CART_JS).catch(() => null)) as RawCart | null;
    }
  }
  if (!raw) return null;
  const items = raw.items.map((it) => {
    const rowM = /(?:fila|row)\s*[:#]?\s*([A-Za-z0-9]+)/i.exec(it.location + ' ' + it.keys.join(' ') + ' ' + it.text);
    const seatsM = [...new Set([...(it.location + ' ' + it.keys.join(' ')).matchAll(/(?:asiento|butaca|seat)s?\s*[:#]?\s*([A-Za-z0-9]+(?:\s*[,y-]\s*[A-Za-z0-9]+)*)/gi)].map((m) => m[1]!))];
    return {
      name: it.name || it.text.slice(0, 60),
      location: it.location || it.keys.join(' · '),
      unitPrice: parseEuros(it.priceText) ?? parseEuros(it.text),
      seats: seatsM,
      row: rowM ? rowM[1]! : null,
      qty: it.qty,
    };
  });
  const qtyFromText = /(\d+)/.exec(raw.qtyText)?.[1] ?? /(\d+)/.exec(raw.counterText)?.[1];
  const quantity = items.length > 0 ? items.reduce((s, i) => s + i.qty, 0) : qtyFromText ? Number(qtyFromText) : 0;
  return {
    quantity,
    total: parseEuros(raw.totalText),
    items,
    expiresAt: countdownToIso(raw.countdownText),
    source: raw.source,
  };
}

/** Confirmación «¿Eliminar?»: pulsa la acción de eliminar/confirmar, nunca pagar. */
async function confirmDeleteDialog(page: Page): Promise<void> {
  const dialog = page.locator(OB.dialog).last();
  if (!(await visible(dialog))) return;
  const btns = dialog.locator('ob-button, button');
  const n = await btns.count();
  let clicked = false;
  for (let j = n - 1; j >= 0; j--) {
    const b = btns.nth(j);
    const t = normalize(await text(b));
    if ((await visible(b)) && !(await isPaymentButton(b)) && /eliminar|borrar|quitar|vaciar|delete|remove|s[ií]\b|confirmar|aceptar|ok/.test(t)) {
      await clickButton(b, 3000).catch(() => undefined);
      clicked = true;
      break;
    }
  }
  if (!clicked) await page.keyboard.press('Escape').catch(() => undefined);
  await sleep(400);
}

/** Quita todas las entradas del carrito (para liberarlas o para empezar limpio). Funciona en la selección y en el checkout. */
export async function releaseCart(page: Page, hooks: Hooks): Promise<number> {
  let removed = 0;
  for (let i = 0; i < 20; i++) {
    const del = page.locator(OB.cartItemDelete).first();
    if (!(await visible(del))) break;
    await clickButton(del, 3000).catch(() => undefined);
    await sleep(400);
    await confirmDeleteDialog(page);
    removed++;
  }
  // Sin borrado por línea (checkout): botón de vaciar el carrito entero.
  if (removed === 0) {
    const clear = page.locator(OB.cartClearButtons).first();
    if (await visible(clear)) {
      await clickButton(clear, 3000).catch(() => undefined);
      await sleep(400);
      await confirmDeleteDialog(page);
      await sleep(800);
      const after = await readCartSummary(page).catch(() => null);
      if (!after || after.quantity === 0) removed = 1;
    }
  }
  // Último recurso desde el checkout: volver a la selección y borrar allí.
  if (removed === 0 && /\/checkout/i.test(page.url())) {
    await page.goBack({ timeout: 10_000 }).catch(() => undefined);
    await sleep(1500);
    for (let i = 0; i < 20; i++) {
      const del = page.locator(OB.cartItemDelete).first();
      if (!(await visible(del))) break;
      await clickButton(del, 3000).catch(() => undefined);
      await sleep(400);
      await confirmDeleteDialog(page);
      removed++;
    }
  }
  if (removed) hooks.log('info', `Carrito vaciado (${removed} línea(s)).`);
  return removed;
}

/**
 * Pulsa «Comprar entradas» (va a la pantalla de checkout: datos del comprador y pago).
 * NO es pagar: el botón de pago del checkout está prohibido. Devuelve true si lo pulsó.
 */
export async function clickGoToCheckout(page: Page, hooks: Hooks): Promise<boolean> {
  const btns = page.locator(OB.goToCheckoutButtons);
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    if (!(await visible(b))) continue;
    const inner = b.locator('button').first();
    const enabled = (await inner.count()) > 0 ? await inner.isEnabled({ timeout: 800 }).catch(() => false) : await b.isEnabled({ timeout: 800 }).catch(() => false);
    if (!enabled) continue;
    hooks.log('info', `Pulso «${(await text(b)) || 'Comprar entradas'}» para abrir la pantalla de pago (sin pagar).`);
    await clickButton(b);
    return true;
  }
  return false;
}

/**
 * Diálogos que pueden salir al ir al checkout (venta cruzada «¿quieres añadir más?», asientos
 * sueltos…): sigue hacia el checkout. Nunca «reservar», «comprar más» ni pagar.
 */
export async function handleGoToCheckoutDialog(page: Page, hooks: Hooks): Promise<'none' | 'continued' | 'cancelled'> {
  const dialog = page.locator(OB.dialog).last();
  if (!(await visible(dialog))) return 'none';
  const btns = dialog.locator('ob-button, button');
  const n = await btns.count();
  const options: Array<{ b: Locator; t: string; primary: boolean }> = [];
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    if (!(await visible(b))) continue;
    options.push({ b, t: normalize(await text(b)), primary: await isPrimary(b) });
  }
  const forbidden = /reservar|book|comprar m[aá]s|buy more|seguir comprando|a[ñn]adir m[aá]s|pagar\b|pay\b/;
  const go = options.find((o) => /checkout|tramitar|finalizar|ir a pagar|continuar|continue|confirmar|confirm|aceptar|accept|entendido|ok\b/.test(o.t) && !forbidden.test(o.t))
    ?? options.find((o) => o.primary && !forbidden.test(o.t));
  if (!go) {
    hooks.log('warn', `Diálogo desconocido al ir al checkout: «${(await text(dialog)).slice(0, 120)}». Lo cierro.`);
    await page.keyboard.press('Escape').catch(() => undefined);
    return 'cancelled';
  }
  hooks.log('info', `Diálogo al ir al checkout: pulso «${go.t}».`);
  await clickButton(go.b);
  await sleep(500);
  return 'continued';
}

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

export async function dumpDiagnostics(page: Page, dir: string, tag: string, hooks: Hooks): Promise<string | null> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(dir, `${stamp}-${tag}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => undefined);
    const html = await page.content().catch(() => '');
    await fs.writeFile(`${base}.html`, html);
    const info = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      classification: await classifyOnebox(page).catch(() => null),
      viewItems: await readViewItems(page).catch(() => []),
      seats: (await readSeats(page).catch(() => [])).length,
      cart: await readCartSummary(page).catch(() => null),
    };
    await fs.writeFile(`${base}.json`, JSON.stringify(info, null, 2));
    hooks.log('info', `Diagnóstico guardado: ${base}.png / .html / .json`);
    return base;
  } catch (err) {
    hooks.log('warn', `No se pudo guardar el diagnóstico: ${(err as Error).message}`);
    return null;
  }
}
