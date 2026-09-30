import { z } from 'zod';
import type { BrowserSnapshot, OperationConfig, OperationState } from '@to/shared';
import type { App } from '../app';
import { normalizeInventory } from '../domain/candidates';
import { prepareSnapshot } from '../domain/decision';
import { eventUsage, groupKeyFor } from '../domain/limits';
import { validateConfig } from '../domain/validation';
import { hashOf } from '../util/hash';
import { iso } from '../util/time';
import { REAL_TEST_MAX_PRICE, REAL_TEST_PROVIDER } from './prueba';

/** This workflow has no manual/simulator fallback and never changes official limits. */
export const BrowserRealTestInputSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  accountIds: z.array(z.string().trim().min(1).max(200)).min(1).max(10)
    .refine((ids) => new Set(ids).size === ids.length, 'No repitas cuentas'),
  maxUnitPrice: z.number().int().positive().max(REAL_TEST_MAX_PRICE).default(REAL_TEST_MAX_PRICE),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/).optional(),
}).strict();
export const BrowserRealTestExecuteSchema = BrowserRealTestInputSchema.extend({
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
});
export type BrowserRealTestInput = z.input<typeof BrowserRealTestInputSchema>;
type Input = z.output<typeof BrowserRealTestInputSchema>;
type ExecuteInput = z.output<typeof BrowserRealTestExecuteSchema>;

export interface BrowserTestBlocker { code: string; message: string; accountId?: string }
export interface BrowserTestBinding {
  accountId: string; label: string; connected: boolean; supported: boolean;
  recipeId: string | null; detail: string | null;
}
export interface BrowserTestPreflight {
  ok: boolean;
  blockers: BrowserTestBlocker[];
  plannedConfig: OperationConfig | null;
  bindings: BrowserTestBinding[];
}
export interface BrowserTestResult extends BrowserTestPreflight {
  operationId?: string;
  state?: OperationState;
  message: string;
}

const BUYING = new Set<OperationState>(['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED']);
const canonical = (url: string) => { const u = new URL(url); u.hash = ''; return u.href.replace(/\/$/, ''); };
// Intentionally empty. The inspected Real Madrid seat selector is canvas based:
// neither observe-only nor the Entradas.com recipe implements it. Add an ID here
// only together with its inspected, tested selection AND cart readback integration.
const REVIEWED_REAL_MADRID_RECIPES: ReadonlySet<string> = new Set();

/** Read-only preflight, followed by the existing validated/limited operation engine. */
export class BrowserRealTestService {
  private readonly requests = new Map<string, { fingerprint: string; promise: Promise<BrowserTestResult> }>();
  private readonly reservedAccounts = new Set<string>();

  constructor(private readonly app: App, private readonly reviewedRecipes: ReadonlySet<string> = REVIEWED_REAL_MADRID_RECIPES) {}

  preflight(input: BrowserRealTestInput): BrowserTestPreflight {
    return this.check(BrowserRealTestInputSchema.parse(input));
  }

  private check(input: Input, ownOperationId?: string): BrowserTestPreflight {
    const { runtime, registry, browser } = this.app;
    const { store, ctx } = runtime;
    const blockers: BrowserTestBlocker[] = [];
    const bindings: BrowserTestBinding[] = [];
    const fail = (code: string, message: string, accountId?: string) => {
      blockers.push({ code, message, ...(accountId ? { accountId } : {}) });
    };
    if (this.reviewedRecipes.size === 0) fail('REAL_MADRID_RECIPE_UNAVAILABLE', 'El selector de asientos y la lectura del carrito del Real Madrid todavía no tienen una integración comprobada. Vincular la extensión no basta para reservar; no se iniciará una compra manual ni simulada.');
    const event = store.events.get(input.eventId);
    if (!event) {
      fail('EVENT_NOT_FOUND', 'Selecciona un evento existente del Real Madrid.');
      return { ok: false, blockers, plannedConfig: null, bindings };
    }
    if (event.providerId !== REAL_TEST_PROVIDER) fail('WRONG_PROVIDER', 'Esta prueba solo utiliza eventos y cuentas del Real Madrid.');
    if (!event.url || !this.officialUrl(event.url)) fail('REAL_URL_REQUIRED', 'El evento debe tener una URL HTTPS oficial del Real Madrid.');
    if (Date.parse(event.startsAt) <= ctx.now()) fail('EVENT_PASSED', 'Este evento ya ha comenzado; selecciona el partido que quieres probar.');
    if (event.onSaleAt && Date.parse(event.onSaleAt) > ctx.now()) fail('SALE_NOT_OPEN', 'La venta configurada para este evento todavía no está abierta.');
    if (event.currency !== 'EUR') fail('CURRENCY_UNSUPPORTED', 'Esta prueba expresa el precio máximo en euros.');
    const provider = registry.descriptor(event.providerId);
    if (provider?.mode !== 'BROWSER_SESSION' || !registry.automated(event.providerId, 'inventory.read') || !registry.automated(event.providerId, 'cart.add') || !registry.automated(event.providerId, 'cart.read')) {
      fail('AUTOMATION_UNAVAILABLE', 'No hay un navegador real compatible conectado. Esta prueba nunca cambia a asistencia manual ni a simulación.');
    }
    if (!ctx.journal.healthy) fail('JOURNAL_UNHEALTHY', 'El registro no está persistiendo; la prueba está detenida por seguridad.');
    if (ctx.safety.openCircuitsFor(event.providerId).length) fail('CIRCUIT_OPEN', 'El proveedor tiene un circuito de seguridad abierto.');
    const telegram = ctx.telegramStatus?.() ?? ctx.notifier?.status?.();
    const telegramConnected = telegram ? telegram.enabled && telegram.connected : Boolean(ctx.notifier?.enabled && ctx.notifier.connected);
    if (!telegramConnected) fail('TELEGRAM_DISCONNECTED', 'Conecta el bot de Telegram antes de iniciar esta prueba.');
    const hasDestination = telegram?.mainChatConfigured || input.accountIds.some((id) => Boolean(store.accounts.get(id)?.telegramChatId));
    if (!hasDestination) fail('TELEGRAM_DESTINATION_MISSING', 'Configura el chat de Telegram que recibirá el enlace a los carritos verificados.');

    const config: OperationConfig = {
      name: `Prueba navegador real · ${event.name}`.slice(0, 120),
      eventId: event.id, providerId: event.providerId,
      // Commands below start immediately. A future T0 prevents a scheduler race while arming.
      t0: iso(ctx.now() + 60_000), runWindowMinutes: 5, freezeLeadSeconds: 0,
      requestedQty: input.accountIds.length, currency: event.currency,
      maxUnitPrice: input.maxUnitPrice, budget: input.maxUnitPrice * input.accountIds.length,
      preferences: {
        targets: [...event.preferredTargets], excludeSections: [], requireContiguous: false,
        minGroupSize: 1, maxPerAccount: 1, allowStanding: true, allowObstructed: false,
        allowAccessible: false, maxAmbiguity: 0.3,
      },
      accountIds: [...input.accountIds], cartExpiryAlertsSeconds: [300, 60],
    };
    const operations = [...store.operations.values()].filter((op) => op.id !== ownOperationId && op.config.eventId === event.id);
    const usage = eventUsage({
      semantics: event.limits.semantics, accounts: store.accounts,
      operations: operations.map((op) => ({ id: op.id, name: op.config.name, allocation: BUYING.has(op.state) ? store.allocations.get(op.id) ?? null : null })),
      carts: store.carts.values(), claims: store.claims.values(),
    });
    const artifact = store.artifactFor(event.venueId, event.id);
    const validation = validateConfig(config, {
      now: ctx.now(), operationId: ownOperationId ?? 'browser-real-test-preflight', configVersion: 1,
      event, artifact, provider, accounts: store.accounts, scenarioIds: [], forArm: true, eventUsage: usage,
      leasedBy: (id) => {
        const lease = store.accounts.get(id)?.leasedBy;
        if (!lease || lease === ownOperationId) return null;
        const op = store.operations.get(lease);
        return { id: lease, name: op?.config.name ?? lease, state: op?.state ?? null };
      },
    });
    for (const issue of validation.issues) if (issue.severity === 'ERROR') fail(issue.code, issue.message);
    // General validation permits partial capacity. This test requires exactly one from EVERY selected account.
    const plannedGroups = new Map<string, number>();
    const statuses = browser.status();
    for (const accountId of input.accountIds) {
      const account = store.accounts.get(accountId);
      const binding = browser.getBinding(accountId);
      const summary: BrowserTestBinding = { accountId, label: account?.label ?? accountId, connected: Boolean(binding), supported: false, recipeId: binding?.recipe.id ?? null, detail: null };
      bindings.push(summary);
      if (!account) continue; // The semantic validator already explains this.
      if (account.verification !== 'VERIFIED') fail('ACCOUNT_NOT_VERIFIED', `${account.label}: la cuenta debe estar verificada.`, accountId);
      if (ctx.safety.engagedFor({ providerId: event.providerId, accountId, operationId: ownOperationId })) fail('KILL_SWITCH', `${account.label}: hay una parada de seguridad activa.`, accountId);
      const group = groupKeyFor(account, event.limits.semantics);
      if (group) {
        const inPlan = (plannedGroups.get(group) ?? 0) + 1;
        plannedGroups.set(group, inPlan);
        if ((usage.perAccount.get(accountId) ?? 0) + 1 > event.limits.perAccount || (usage.perGroup.get(group) ?? 0) + inPlan > event.limits.perGroup) {
          fail('EXACT_QUOTA_UNAVAILABLE', `${account.label}: los límites del evento no permiten una entrada para cada cuenta seleccionada.`, accountId);
        }
      }
      if (!binding) { fail('BROWSER_NOT_LINKED', `${account.label}: vincula su pestaña y sesión existentes.`, accountId); continue; }
      if (binding.eventId !== event.id || binding.eventRef !== event.providerEventRef) { fail('BINDING_EVENT_MISMATCH', `${account.label}: la pestaña está vinculada a otro evento.`, accountId); continue; }
      const realRecipe = this.reviewedRecipes.has(binding.recipe.id) && !['fixture-v1', 'observe-only-v1'].includes(binding.recipe.id) && Boolean(binding.recipe.cart);
      if (!realRecipe) fail('RECIPE_UNSUPPORTED', `${account.label}: falta una receta comprobada para seleccionar entradas y verificar el carrito real; la conexión de observación no puede reservar.`, accountId);
      if (!this.officialUrl(binding.eventUrl) || binding.recipe.allowedOrigins.some((url) => !this.officialUrl(url))) fail('REAL_URL_REQUIRED', `${account.label}: la pestaña no corresponde a la venta oficial HTTPS del Real Madrid.`, accountId);
      const status = statuses.find((s) => s.accountId === accountId);
      if (status?.uncertain || status?.pendingCommands) fail('BROWSER_RESULT_PENDING', `${account.label}: hay una orden o resultado pendiente; revisa el carrito antes de probar.`, accountId);
      let snapshot: BrowserSnapshot;
      try { snapshot = browser.snapshot(accountId, event.providerEventRef); }
      catch { fail('BROWSER_SNAPSHOT_MISSING', `${account.label}: no hay una lectura reciente de su pestaña.`, accountId); continue; }
      summary.supported = snapshot.supported && realRecipe;
      summary.detail = snapshot.detail ?? null;
      if (!snapshot.supported) fail('PAGE_UNSUPPORTED', `${account.label}: ${snapshot.detail || 'esta página no permite todavía la selección automática comprobada.'}`, accountId);
      if (canonical(snapshot.url) !== canonical(binding.eventUrl)) fail('BROWSER_WRONG_PAGE', `${account.label}: vuelve a la página exacta que se vinculó.`, accountId);
      if (snapshot.session !== 'READY' || snapshot.queue !== 'PASSED' || account.session.state !== 'READY') fail('SESSION_NOT_READY', `${account.label}: termina tú el inicio de sesión, la cola o el CAPTCHA en esa pestaña.`, accountId);
      if (!snapshot.cart || !snapshot.cart.verified || snapshot.cart.accountId !== accountId || snapshot.cart.eventRef !== event.providerEventRef) {
        fail('EMPTY_CART_UNVERIFIED', `${account.label}: no se ha podido leer y comprobar que el carrito de este evento está vacío.`, accountId);
      } else if (snapshot.cart.items.length !== 0) fail('CART_NOT_EMPTY', `${account.label}: ya hay entradas en el carrito; revísalas antes de otra prueba.`, accountId);
      if (summary.supported && artifact && validation.compiledPolicy) {
        const normalized = normalizeInventory('browser-real-test-preflight', snapshot.offers, Date.parse(snapshot.observedAt), artifact);
        const eligible = prepareSnapshot(normalized, validation.compiledPolicy, new Set(artifact.sections.filter((s) => s.closed).map((s) => s.id)), input.maxUnitPrice).eligible;
        if (!eligible.some((offer) => offer.qtyMin <= 1 && offer.qtyMax >= 1)) fail('NO_ELIGIBLE_SINGLE_TICKET', `${account.label}: no hay una entrada identificada que cumpla zona, disponibilidad y precio máximo.`, accountId);
      }
    }
    return { ok: blockers.length === 0, blockers, plannedConfig: config, bindings };
  }

  private officialUrl(value: string): boolean {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'realmadrid.com' || u.hostname.endsWith('.realmadrid.com')); }
    catch { return false; }
  }

  execute(raw: z.input<typeof BrowserRealTestExecuteSchema>, actor = 'dashboard'): Promise<BrowserTestResult> {
    const input = BrowserRealTestExecuteSchema.parse(raw);
    const fingerprint = hashOf({ eventId: input.eventId, accountIds: [...input.accountIds].sort(), maxUnitPrice: input.maxUnitPrice });
    const previous = this.requests.get(input.requestId);
    if (previous) {
      if (previous.fingerprint === fingerprint) return previous.promise;
      return Promise.resolve({ ok: false, blockers: [{ code: 'REQUEST_ID_CONFLICT', message: 'Este identificador ya se usó con otro evento, cuentas o precio.' }], plannedConfig: null, bindings: [], message: 'No se ha iniciado otra operación.' });
    }
    const checked = this.check(input);
    if (!checked.ok) return Promise.resolve({ ...checked, message: 'Prueba bloqueada: no se ha creado ni iniciado ninguna operación.' });
    if (input.accountIds.some((id) => this.reservedAccounts.has(id))) return Promise.resolve({ ...checked, ok: false, blockers: [{ code: 'TEST_IN_PROGRESS', message: 'Ya se está iniciando una prueba con estas cuentas.' }], message: 'No se ha iniciado otra operación.' });
    // Do not evict successful request IDs: a repeated HTTP request must never reserve twice.
    if (this.requests.size >= 1000) return Promise.resolve({ ...checked, ok: false, blockers: [{ code: 'REQUEST_LIMIT', message: 'Se ha alcanzado el límite de solicitudes de esta sesión del servidor.' }], message: 'No se ha iniciado otra operación.' });
    input.accountIds.forEach((id) => this.reservedAccounts.add(id));
    const promise = this.run(input, checked, actor).finally(() => input.accountIds.forEach((id) => this.reservedAccounts.delete(id)));
    this.requests.set(input.requestId, { fingerprint, promise });
    return promise;
  }

  private async run(input: ExecuteInput, initial: BrowserTestPreflight, actor: string): Promise<BrowserTestResult> {
    const { ctx, store } = this.app.runtime;
    const originalBindings = new Map(input.accountIds.map((id) => [id, this.app.browser.getBinding(id)?.connectionId]));
    const op = ctx.ops.create(initial.plannedConfig!, actor);
    ctx.journal.audit('browser.real_test.requested', { requestId: input.requestId, eventId: input.eventId, accountIds: input.accountIds, maxUnitPrice: input.maxUnitPrice }, { operationId: op.id, actor });
    const stop = async (checked: BrowserTestPreflight, message: string): Promise<BrowserTestResult> => {
      const current = store.operations.get(op.id);
      if (current && ['DRAFT', 'VALIDATED', 'ARMED', 'FROZEN'].includes(current.state)) await ctx.ops.command(op.id, { command: 'cancel', reason: message }, actor);
      return { ...checked, ok: false, operationId: op.id, state: store.operations.get(op.id)?.state, message };
    };
    const guard = () => {
      const checked = this.check(input, op.id);
      for (const id of input.accountIds) if (this.app.browser.getBinding(id)?.connectionId !== originalBindings.get(id)) {
        checked.blockers.push({ code: 'BINDING_CHANGED', message: 'La pestaña vinculada ha cambiado durante la preparación.', accountId: id });
      }
      checked.ok = checked.blockers.length === 0;
      return checked;
    };
    try {
      for (const command of ['validate', 'arm', 'start-now'] as const) {
        const checked = guard();
        if (!checked.ok) return await stop(checked, 'La preparación ha cambiado: no se ha iniciado la reserva.');
        const result = await ctx.ops.command(op.id, { command }, actor);
        if (!result.ok) {
          const blockers = result.validation?.issues.filter((i) => i.severity === 'ERROR').map((i) => ({ code: i.code, message: i.message })) ?? [];
          if (!blockers.length) blockers.push({ code: 'START_REJECTED', message: result.message });
          return await stop({ ...checked, ok: false, blockers }, result.message);
        }
      }
      return { ...initial, operationId: op.id, state: store.operations.get(op.id)?.state, message: 'Prueba real iniciada: una entrada por cuenta. Telegram avisará únicamente cuando el carrito completo esté verificado. El bot no paga.' };
    } catch (error) {
      return await stop({ ...initial, ok: false, blockers: [{ code: 'START_FAILED', message: error instanceof Error ? error.message : 'No se pudo iniciar la prueba.' }] }, 'La prueba no se ha podido iniciar de forma segura.');
    }
  }
}
