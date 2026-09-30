import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BrowserConnection, BrowserRecipe, BrowserSnapshot } from '@to/shared';
import { FIXTURE_MANUAL_EVENT, withFixtureVault } from '../gates/fixtures';
import { createHarness, type Harness } from '../gates/harness';
import { createHttpApp } from '../http/app';
import { BrowserSessionProvider } from '../providers/browser';
import { ManualAssistProvider } from '../providers/manual';
import { BrowserRealTestInputSchema, BrowserRealTestService } from '../runtime/browser-test';

// These are technical doubles only. No real page/network is opened and this
// fake policy is NEVER injected into the production HTTP endpoints.
const TEST_REVIEWED_RECIPES = new Set(['entradas-fastbooking-v1']);
const SALE = 'https://tickets.realmadrid.com/select/test-double';
const RECIPE: BrowserRecipe = {
  id: 'entradas-fastbooking-v1', allowedOrigins: [new URL(SALE).origin],
  cart: { rootSelector: '[data-test-cart]', itemSelector: '[data-test-item]', eventRefAttribute: 'data-event', offerRefAttribute: 'data-offer', qtyAttribute: 'data-qty', unitPriceAttribute: 'data-price', sectionAttribute: 'data-section', cartRefAttribute: 'data-cart' },
};
interface Setup {
  h: Harness;
  service: BrowserRealTestService;
  accountIds: string[];
  connections: BrowserConnection[];
  snapshots: BrowserSnapshot[];
  input: { eventId: string; accountIds: string[] };
  report(index: number, patch: Partial<BrowserSnapshot>): void;
}

async function withSetup(run: (setup: Setup) => Promise<void>, opts: { connect?: boolean; recipe?: BrowserRecipe } = {}) {
  return withFixtureVault(async (dir) => {
    const h = await createHarness(dir);
    const { app } = h;
    const { store, ctx } = app.runtime;
    try {
      app.registry.register(new ManualAssistProvider('real-madrid', 'Real Madrid'));
      const original = store.events.get(FIXTURE_MANUAL_EVENT)!;
      store.events.set(original.id, { ...original, name: 'Technical double (not a live reservation)', providerId: 'real-madrid', url: 'https://www.realmadrid.com/entradas/test-double', onSaleAt: null });
      const accountIds = ['Technical A', 'Technical B'].map((label, n) => ctx.accounts.create({ label, providerId: 'real-madrid', holderRef: `holder-${n}`, verification: 'VERIFIED' }, 'test').id);
      const telegram = ctx.ops.systemStatus().telegram;
      ctx.telegramStatus = () => ({ ...telegram, enabled: true, connected: true, mainChatConfigured: true, mainChatId: '123' });
      const connections: BrowserConnection[] = [];
      const snapshots: BrowserSnapshot[] = [];
      const report = (index: number, patch: Partial<BrowserSnapshot>) => {
        snapshots[index] = { ...snapshots[index]!, ...patch };
        app.browser.report({ ...connections[index]!, snapshot: snapshots[index]! });
      };
      if (opts.connect !== false) {
        app.registry.enableBrowser(new BrowserSessionProvider('real-madrid', 'Real Madrid', app.browser));
        for (const [index, accountId] of accountIds.entries()) {
          const { pairingCode } = app.browser.pair({ accountId, eventId: original.id, eventRef: original.providerEventRef, eventUrl: SALE, recipe: opts.recipe ?? RECIPE });
          connections.push(app.browser.connect({ pairingCode, sessionId: `technical-session-${index}`, tabId: index + 1, url: SALE }));
          snapshots.push({
            observedAt: new Date(h.clock.now()).toISOString(), url: SALE, supported: true, session: 'READY', queue: 'PASSED',
            offers: [{ offerRef: `technical-offer-${index}`, sectionLabel: 'Pista Frontal', row: null, seats: [], qtyMin: 1, qtyMax: 4, unitPrice: 2500, currency: 'EUR', standing: true }],
            cart: { verified: true, cartRef: `technical-cart-${index}`, eventRef: original.providerEventRef, accountId, items: [], openUrl: SALE, expiresAt: null },
          });
          report(index, {});
        }
      }
      const service = new BrowserRealTestService(app, TEST_REVIEWED_RECIPES);
      await run({ h, service, accountIds, connections, snapshots, input: { eventId: original.id, accountIds }, report });
    } finally { await h.stop(); }
  });
}

const codes = (result: { blockers: { code: string }[] }) => result.blockers.map((b) => b.code);

describe('real browser test preflight and execution', () => {
  it('production permanently blocks the unimplemented Real Madrid integration even if a snapshot claims support', async () => withSetup(async ({ h, input }) => {
    const production = new BrowserRealTestService(h.app);
    const before = h.app.runtime.store.operations.size;
    const preflight = production.preflight(input);
    assert.equal(preflight.ok, false);
    assert.ok(codes(preflight).includes('REAL_MADRID_RECIPE_UNAVAILABLE'));
    assert.ok(codes(preflight).includes('RECIPE_UNSUPPORTED'), 'Entradas.com is not a Real Madrid integration');
    assert.match(preflight.blockers[0]!.message, /Vincular la extensión no basta/);
    const result = await production.execute({ ...input, requestId: 'production-blocked-0001' });
    assert.equal(result.ok, false);
    assert.equal(result.operationId, undefined);
    assert.equal(h.app.runtime.store.operations.size, before);
    assert.equal(h.app.runtime.store.humanTasks.size, 0);
  }));

  it('never falls back to manual or creates another account/event when no browser is linked', async () => withSetup(async ({ h, service, input }) => {
    const accounts = h.app.runtime.store.accounts.size;
    const result = await service.execute({ ...input, requestId: 'missing-browser-00001' });
    assert.ok(codes(result).includes('AUTOMATION_UNAVAILABLE'));
    assert.ok(codes(result).includes('BROWSER_NOT_LINKED'));
    assert.equal(h.app.registry.get('real-madrid')?.mode, 'MANUAL_ASSIST');
    assert.equal(h.app.runtime.store.operations.size, 0);
    assert.equal(h.app.runtime.store.accounts.size, accounts);
    assert.equal(h.app.runtime.store.humanTasks.size, 0);
  }, { connect: false }));

  it('technical reviewed-policy double: preflight is read-only and preserves one ticket per selected account and official limits', async () => withSetup(async ({ h, service, input }) => {
    const limits = structuredClone(h.app.runtime.store.events.get(input.eventId)!.limits);
    const beforeAccounts = JSON.stringify([...h.app.runtime.store.accounts.values()]);
    const preflight = service.preflight(input);
    assert.deepEqual(preflight.blockers, []);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.plannedConfig?.requestedQty, 2);
    assert.equal(preflight.plannedConfig?.preferences.maxPerAccount, 1);
    assert.equal(preflight.plannedConfig?.maxUnitPrice, 6000);
    assert.equal(preflight.plannedConfig?.budget, 12000);
    assert.equal(preflight.plannedConfig?.simulation, undefined);
    assert.deepEqual(preflight.plannedConfig?.accountIds, input.accountIds);
    assert.equal(service.preflight({ ...input, maxUnitPrice: 5500 }).plannedConfig?.budget, 11000, 'the price can be lowered without changing the official limits');
    assert.equal(h.app.runtime.store.operations.size, 0);
    assert.equal(h.app.runtime.store.humanTasks.size, 0);
    assert.equal(JSON.stringify([...h.app.runtime.store.accounts.values()]), beforeAccounts);
    assert.deepEqual(h.app.runtime.store.events.get(input.eventId)!.limits, limits);
  }));

  it('rejects observe-only and fixture recipes even with an injected review policy', async () => {
    for (const id of ['observe-only-v1', 'fixture-v1'] as const) await withSetup(async ({ h, input }) => {
      const service = new BrowserRealTestService(h.app, new Set([id]));
      assert.ok(codes(service.preflight(input)).includes('RECIPE_UNSUPPORTED'));
      assert.equal(h.app.runtime.store.operations.size, 0);
    }, { recipe: { ...RECIPE, id } });
  });

  it('requires supported, current, challenge-free snapshots, exact page and verified empty carts', async () => withSetup(async ({ h, service, input, snapshots, report }) => {
    const base = structuredClone(snapshots[0]!);
    report(0, { supported: false });
    assert.ok(codes(service.preflight(input)).includes('PAGE_UNSUPPORTED'));
    report(0, { ...base, session: 'CHALLENGE_REQUIRED', challenge: 'CAPTCHA' });
    assert.ok(codes(service.preflight(input)).includes('SESSION_NOT_READY'));
    report(0, { ...base, url: `${SALE}?different-event=1` });
    assert.ok(codes(service.preflight(input)).includes('BROWSER_WRONG_PAGE'));
    report(0, { ...base, cart: null });
    assert.ok(codes(service.preflight(input)).includes('EMPTY_CART_UNVERIFIED'));
    report(0, { ...base, cart: { ...base.cart!, items: [{ offerRef: 'existing', sectionLabel: 'Pista Frontal', row: null, seats: [], qty: 1, unitPrice: 2500, idempotencyKey: null }] } });
    assert.ok(codes(service.preflight(input)).includes('CART_NOT_EMPTY'));
    report(0, base);
    await h.clock.advance(10_001);
    assert.ok(codes(service.preflight(input)).includes('BROWSER_SNAPSHOT_MISSING'));
    assert.equal(h.app.runtime.store.operations.size, 0);
  }));

  it('checks binding event identity, registered account eligibility and complete legal capacity', async () => withSetup(async ({ h, service, input, accountIds }) => {
    const { store, ctx } = h.app.runtime;
    ctx.accounts.update(accountIds[0]!, { verification: 'NEEDS_ATTENTION', enabled: false }, 'test');
    let result = service.preflight(input);
    assert.ok(codes(result).includes('ACCOUNT_NOT_VERIFIED'));
    assert.ok(codes(result).includes('ACCOUNT_DISABLED'));
    ctx.accounts.update(accountIds[0]!, { verification: 'VERIFIED', enabled: true, eligibility: ['different-event'] }, 'test');
    assert.ok(codes(service.preflight(input)).includes('ACCOUNT_NOT_ELIGIBLE'));
    ctx.accounts.update(accountIds[0]!, { eligibility: ['*'], holderRef: 'shared-person' }, 'test');
    ctx.accounts.update(accountIds[1]!, { holderRef: 'shared-person' }, 'test');
    const event = store.events.get(input.eventId)!;
    store.events.set(event.id, { ...event, limits: { ...event.limits, semantics: 'PER_HOLDER', perGroup: 1 } });
    assert.ok(codes(service.preflight(input)).includes('EXACT_QUOTA_UNAVAILABLE'));
    h.app.browser.revoke(accountIds[0]!);
    const { pairingCode } = h.app.browser.pair({ accountId: accountIds[0]!, eventId: 'another-event', eventRef: 'another-ref', eventUrl: SALE, recipe: RECIPE });
    h.app.browser.connect({ pairingCode, sessionId: 'different-binding', tabId: 4, url: SALE });
    result = service.preflight(input);
    assert.ok(codes(result).includes('BINDING_EVENT_MISMATCH'));
    assert.equal(store.operations.size, 0);
  }));

  it('requires Telegram delivery, usable inventory and unchanged safety controls', async () => withSetup(async ({ h, service, input, snapshots, report, accountIds }) => {
    const ctx = h.app.runtime.ctx;
    const configured = ctx.telegramStatus!();
    ctx.telegramStatus = () => ({ ...configured, connected: false, mainChatConfigured: false });
    let result = service.preflight(input);
    assert.ok(codes(result).includes('TELEGRAM_DISCONNECTED'));
    assert.ok(codes(result).includes('TELEGRAM_DESTINATION_MISSING'));
    ctx.telegramStatus = () => configured;
    report(0, { offers: snapshots[0]!.offers.map((offer) => ({ ...offer, unitPrice: 6100 })) });
    assert.ok(codes(service.preflight(input)).includes('NO_ELIGIBLE_SINGLE_TICKET'));
    report(0, { offers: snapshots[0]!.offers.map((offer) => ({ ...offer, unitPrice: 2500, sectionLabel: 'Unknown section' })) });
    assert.ok(codes(service.preflight(input)).includes('NO_ELIGIBLE_SINGLE_TICKET'));
    ctx.safety.setKillSwitch('ACCOUNT', accountIds[0]!, true, 'test', 'test');
    result = service.preflight(input);
    assert.ok(codes(result).includes('KILL_SWITCH'));
    assert.equal(ctx.safety.engagedFor({ accountId: accountIds[0]! })?.engaged, true);
    assert.equal(h.app.runtime.store.operations.size, 0);
  }));

  it('technical reviewed-policy double: concurrent double-click starts only one existing-engine operation', async () => withSetup(async ({ h, service, input, accountIds }) => {
    const request = { ...input, requestId: 'double-click-test-0001' };
    const [first, second, competing] = await Promise.all([
      service.execute(request), service.execute(request), service.execute({ ...request, requestId: 'other-click-test-0001' }),
    ]);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.operationId, second.operationId);
    assert.equal(competing.ok, false);
    assert.ok(codes(competing).includes('TEST_IN_PROGRESS'));
    assert.equal(h.app.runtime.store.operations.size, 1);
    const op = h.app.runtime.ctx.ops.get(first.operationId!);
    assert.equal(op.state, 'RUNNING');
    assert.equal(h.app.runtime.ctx.runners.kind(op.id), 'AUTOMATED');
    assert.equal(op.config.requestedQty, 2);
    assert.equal(op.config.preferences.maxPerAccount, 1);
    assert.equal(h.app.runtime.store.humanTasks.size, 0);
    assert.equal(h.app.runtime.store.carts.size, 0, 'start success is not a reservation confirmation');
    assert.ok(accountIds.every((id) => h.app.runtime.store.accounts.get(id)?.leasedBy === op.id));
    const replay = await service.execute(request);
    assert.equal(replay.operationId, op.id);
    assert.equal(h.app.runtime.store.operations.size, 1);
    const changed = await service.execute({ ...request, maxUnitPrice: 5500 });
    assert.ok(codes(changed).includes('REQUEST_ID_CONFLICT'));
  }));

  it('rechecks after arming and cancels without a runner when a binding disappears', async () => withSetup(async ({ h, service, input, accountIds }) => {
    const { ctx, store } = h.app.runtime;
    const command = ctx.ops.command.bind(ctx.ops);
    ctx.ops.command = async (id, request, actor) => {
      const result = await command(id, request, actor);
      if (request.command === 'arm') h.app.browser.revoke(accountIds[0]!);
      return result;
    };
    const result = await service.execute({ ...input, requestId: 'changed-binding-00001' });
    assert.equal(result.ok, false);
    assert.ok(codes(result).includes('BINDING_CHANGED'));
    assert.equal(result.state, 'CANCELLED');
    assert.ok([...store.accounts.values()].every((account) => account.leasedBy === null));
    assert.equal(store.claims.size, 0);
    assert.equal(store.carts.size, 0);
    assert.equal(store.humanTasks.size, 0);
    assert.equal(h.app.browser.status().every((status) => status.pendingCommands === 0), true);
  }));

  it('HTTP endpoints require operator, loopback, same-origin, JSON and an explicit unique-account plan; default production cannot execute', async () => withSetup(async ({ h, input }) => {
    const http = createHttpApp(h.app, { dashboardDist: null, operatorToken: 'operator-test' });
    const call = (route: string, body: unknown = input, options: { auth?: boolean; origin?: string; base?: string; type?: string } = {}) => {
      const base = options.base ?? 'http://127.0.0.1:8787';
      const headers: Record<string, string> = { 'content-type': options.type ?? 'application/json', origin: options.origin ?? base };
      if (options.auth !== false) headers.authorization = 'Bearer operator-test';
      return http.request(new Request(`${base}/api/browser/real-test/${route}`, { method: 'POST', headers, body: JSON.stringify(body) }));
    };
    for (const route of ['preflight', 'execute']) {
      assert.equal((await call(route, input, { auth: false })).status, 401);
      assert.equal((await call(route, input, { origin: 'https://attacker.example' })).status, 403);
      assert.equal((await call(route, input, { base: 'https://control.example' })).status, 403);
      assert.equal((await call(route, input, { type: 'text/plain' })).status, 400);
    }
    assert.equal((await call('preflight', { ...input, accountIds: [input.accountIds[0], input.accountIds[0]] })).status, 400);
    assert.equal((await call('preflight', { ...input, qty: 9 })).status, 400, 'quantity is derived, never overridden');
    assert.equal((await call('preflight', { ...input, maxUnitPrice: 6001 })).status, 400, 'the real test cannot exceed its 60 EUR cap');
    assert.equal((await call('execute', { ...input, maxUnitPrice: 6001, requestId: 'over-price-test-00001' })).status, 400);
    assert.equal((await call('execute')).status, 400, 'a request ID is mandatory for mutation');
    const preflight = await call('preflight');
    assert.equal(preflight.status, 200);
    const preflightBody = await preflight.json() as { ok: boolean; blockers: { code: string }[] };
    assert.equal(preflightBody.ok, false);
    assert.ok(codes(preflightBody).includes('REAL_MADRID_RECIPE_UNAVAILABLE'));
    const execute = await call('execute', { ...input, requestId: 'http-real-test-000001' });
    assert.equal(execute.status, 409);
    assert.ok(codes(await execute.json() as { blockers: { code: string }[] }).includes('REAL_MADRID_RECIPE_UNAVAILABLE'));
    assert.equal(h.app.runtime.store.operations.size, 0);
    assert.equal(h.app.runtime.store.humanTasks.size, 0);
  }));

  it('rejects invalid prices, duplicate accounts and simulator-only event inputs', async () => withSetup(async ({ h, service, input }) => {
    assert.equal(BrowserRealTestInputSchema.safeParse({ ...input, maxUnitPrice: 60.1 }).success, false);
    assert.equal(BrowserRealTestInputSchema.safeParse({ ...input, maxUnitPrice: 0 }).success, false);
    assert.equal(BrowserRealTestInputSchema.safeParse({ ...input, maxUnitPrice: 6001 }).success, false);
    assert.equal(BrowserRealTestInputSchema.safeParse({ ...input, accountIds: [input.accountIds[0], input.accountIds[0]] }).success, false);
    const event = h.app.runtime.store.events.get(input.eventId)!;
    h.app.runtime.store.events.set(event.id, { ...event, providerId: 'sim' });
    assert.ok(codes(service.preflight(input)).includes('WRONG_PROVIDER'));
    assert.equal(h.app.runtime.store.operations.size, 0);
  }));
});
