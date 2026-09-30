import type { Hono, Context } from 'hono';
import { z } from 'zod';
import type { App } from '../app';
import { BrowserSessionProvider } from '../providers/browser';
import { BrowserBridgeError } from './bridge';
import type { BrowserAuth, BrowserConnectInput, BrowserReportInput } from '@to/shared';
import { BrowserRealTestService, BrowserRealTestInputSchema, BrowserRealTestExecuteSchema } from '../runtime/browser-test';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const busyStates = new Set(['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED']);
const selector = z.string().trim().min(1).max(300);
const recipeSchema = z.object({
  id: z.enum(['observe-only-v1', 'fixture-v1', 'entradas-fastbooking-v1']),
  allowedOrigins: z.array(z.string().url()).min(1).max(5),
  cart: z.object({ rootSelector: selector, itemSelector: selector, eventRefAttribute: selector,
    offerRefAttribute: selector, qtyAttribute: selector, unitPriceAttribute: selector,
    sectionAttribute: selector, cartRefAttribute: selector, expiresAtAttribute: selector.optional(),
  }).optional(),
});
const pairSchema = z.object({ accountId: z.string().min(1), eventId: z.string().min(1), eventUrl: z.string().url().optional(), recipe: recipeSchema });

function dashboardOnly(c: Context): void {
  const target = new URL(c.req.url);
  if (!localHosts.has(target.hostname)) throw new BrowserBridgeError('La vinculación se hace desde este PC', 'FORBIDDEN');
  const origin = c.req.header('origin');
  if (origin && origin !== target.origin) throw new BrowserBridgeError('Vincula desde la sala de control, no desde otra web', 'FORBIDDEN');
  if (!c.req.header('content-type')?.startsWith('application/json')) throw new BrowserBridgeError('Se esperaba JSON', 'INVALID_REQUEST');
}

function officialHost(url: string, reference: string): boolean {
  const a = new URL(url), b = new URL(reference);
  if (a.username || a.password || a.protocol !== b.protocol) return false;
  const base = b.hostname.replace(/^www\./, '');
  return a.hostname === base || a.hostname.endsWith(`.${base}`) || a.hostname === b.hostname;
}

/** Pairing and account commands remain behind operator auth; the extension uses its own narrow token. */
export function browserExtensionRoutes(http: Hono, app: App): void {
  const { browser } = app;
  http.use('/api/browser/bridge/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return c.json({ error: { code: 'FORBIDDEN', message: 'Origen de extensión no válido' } }, 403);
    if (origin) { c.header('Access-Control-Allow-Origin', origin); c.header('Vary', 'Origin'); }
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'content-type');
      return c.body(null, 204);
    }
    if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: { code: 'INVALID_REQUEST', message: 'Se esperaba JSON' } }, 400);
    const length = Number(c.req.header('content-length') ?? '0');
    if (length > 1_000_000) return c.json({ error: { code: 'INVALID_REQUEST', message: 'Lectura demasiado grande' } }, 413);
    await next();
  });
  http.post('/api/browser/bridge/connect', async (c) => c.json(browser.connect(await c.req.json<BrowserConnectInput>())));
  http.post('/api/browser/bridge/poll', async (c) => c.json(browser.poll(await c.req.json<BrowserAuth>())));
  http.post('/api/browser/bridge/report', async (c) => c.json(browser.report(await c.req.json<BrowserReportInput>())));
}

export function browserDashboardRoutes(http: Hono, app: App): void {
  const { browser, runtime, registry } = app;
  const realTest = new BrowserRealTestService(app);
  http.get('/api/browser/status', (c) => c.json(browser.status()));
  http.post('/api/browser/real-test/preflight', async (c) => {
    dashboardOnly(c);
    const parsed = BrowserRealTestInputSchema.safeParse(await c.req.json());
    if (!parsed.success) throw new BrowserBridgeError('Selecciona un evento, cuentas distintas y un precio máximo válido en céntimos', 'INVALID_REQUEST');
    return c.json(realTest.preflight(parsed.data));
  });
  http.post('/api/browser/real-test/execute', async (c) => {
    dashboardOnly(c);
    const parsed = BrowserRealTestExecuteSchema.safeParse(await c.req.json());
    if (!parsed.success) throw new BrowserBridgeError('Evento, cuentas, precio o identificador de solicitud inválidos', 'INVALID_REQUEST');
    const result = await realTest.execute(parsed.data);
    return c.json(result, result.ok ? 200 : 409);
  });
  http.post('/api/browser/pair', async (c) => {
    dashboardOnly(c);
    const parsed = pairSchema.safeParse(await c.req.json());
    if (!parsed.success) throw new BrowserBridgeError('Cuenta, evento o receta inválidos', 'INVALID_REQUEST');
    const input = parsed.data;
    const account = runtime.store.accounts.get(input.accountId);
    const event = runtime.store.events.get(input.eventId);
    if (!account || !event || account.providerId !== event.providerId || !account.enabled) throw new BrowserBridgeError('La cuenta no corresponde al proveedor del evento', 'INVALID_REQUEST');
    if ([...runtime.store.operations.values()].some((op) => op.config.providerId === event.providerId && busyStates.has(op.state))) throw new BrowserBridgeError('Para o cierra las operaciones de este proveedor antes de cambiar su conexión', 'BUSY');
    const eventUrl = input.eventUrl ?? event.url;
    if (!eventUrl || !event.url || !officialHost(eventUrl, event.url)) throw new BrowserBridgeError('La pestaña debe ser del dominio oficial del evento', 'WRONG_PAGE');
    if (input.recipe.allowedOrigins.some((o) => !officialHost(o, event.url!))) throw new BrowserBridgeError('La receta contiene un dominio ajeno al evento', 'WRONG_PAGE');
    if (input.recipe.id === 'fixture-v1' && !localHosts.has(new URL(eventUrl).hostname)) throw new BrowserBridgeError('La receta de pruebas solo funciona en localhost', 'INVALID_REQUEST');
    const result = browser.pair({ accountId: account.id, eventId: event.id, eventRef: event.providerEventRef, eventUrl, recipe: input.recipe });
    registry.enableBrowser(new BrowserSessionProvider(account.providerId, registry.get(account.providerId)?.name ?? account.providerId, browser));
    // A manual 'ready' flag is not evidence of a connected browser session.
    for (const a of runtime.store.accounts.values()) if (a.providerId === account.providerId && !browser.getBinding(a.id)) runtime.ctx.accounts.setSession(a.id, { state: 'LOGGED_OUT', challenge: null, detail: 'Pendiente de vincular la pestaña real de esta cuenta' });
    runtime.ctx.journal.audit('browser.pair_requested', { accountId: account.id, eventId: event.id, recipe: input.recipe.id });
    return c.json(result);
  });
  http.post('/api/browser/accounts/:id/disconnect', async (c) => {
    dashboardOnly(c);
    const id = c.req.param('id');
    const a = runtime.store.accounts.get(id);
    if (a?.leasedBy) runtime.ctx.ops.pauseFor(a.leasedBy, 'Se desconectó la pestaña de esta cuenta');
    browser.revoke(id);
    if (a) runtime.ctx.accounts.setSession(id, { state: 'LOGGED_OUT', detail: 'Pestaña desconectada', challenge: null });
    return c.json({ ok: true });
  });
  http.post('/api/browser/carts/:id/focus', async (c) => {
    dashboardOnly(c);
    const cart = runtime.store.carts.get(c.req.param('id'));
    if (!cart || !['ACTIVE', 'REVIEW_REQUIRED'].includes(cart.state) || cart.confirmation !== 'READBACK') throw new BrowserBridgeError('No hay un carrito verificado que se pueda abrir', 'CART_UNVERIFIED');
    const op = runtime.store.operations.get(cart.operationId);
    if (!op?.providerEventRef) throw new BrowserBridgeError('No se encuentra el evento del carrito', 'CART_UNVERIFIED');
    const snapshot = browser.snapshot(cart.accountId, op.providerEventRef);
    const current = snapshot.cart;
    if (!current || current.cartRef !== cart.providerCartRef || current.openUrl !== cart.openUrl || current.items.reduce((n, i) => n + i.qty, 0) !== cart.qty || current.items.reduce((n, i) => n + i.qty * i.unitPrice, 0) !== cart.total) throw new BrowserBridgeError('El carrito de esa pestaña ya no coincide con el reservado; revísalo en el navegador', 'CART_UNVERIFIED');
    if (!browser.focus(cart.accountId, op.providerEventRef)) throw new BrowserBridgeError('La pestaña no está disponible o ya se está abriendo', 'BROWSER_UNAVAILABLE');
    return c.json({ ok: true });
  });
}
