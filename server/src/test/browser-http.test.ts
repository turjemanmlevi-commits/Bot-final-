import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BrowserCartEvidence, BrowserCommand, BrowserConnection, BrowserPairInput, BrowserSnapshot } from '@to/shared';
import { FIXTURE_MANUAL_EVENT, withFixtureVault } from '../gates/fixtures';
import { createHarness, manualConfig, type Harness } from '../gates/harness';
import { createHttpApp } from '../http/app';

const BASE = 'http://127.0.0.1:8787';
const OPERATOR = 'browser-test-operator-secret';
const EXTENSION = `chrome-extension://${'a'.repeat(32)}`;
const REAL_EVENT = 'https://www.realmadrid.com/es-ES/entradas/fixture-event';
const FIXTURE_URL = 'http://127.0.0.1:8879/fixture?eventRef=TEST-MANUAL';

interface RequestOptions { operator?: boolean; origin?: string; base?: string; contentType?: string }
type Call = (method: string, route: string, value?: unknown, options?: RequestOptions) => Promise<Response>;

async function withHttp(run: (h: Harness, call: Call, accountId: string, pair: BrowserPairInput) => Promise<void>, eventUrl = REAL_EVENT) {
  return withFixtureVault(async (dir) => {
    const h = await createHarness(dir);
    try {
      const http = createHttpApp(h.app, { dashboardDist: null, operatorToken: OPERATOR });
      const event = h.app.runtime.store.events.get(FIXTURE_MANUAL_EVENT);
      assert.ok(event);
      h.app.runtime.store.events.set(event.id, { ...event, url: eventUrl });
      const account = h.app.runtime.ctx.accounts.create({ label: 'Browser A', providerId: 'manual', holderRef: 'browser-a', verification: 'VERIFIED' }, 'test');
      const call: Call = async (method, route, value, options = {}) => {
        const headers: Record<string, string> = { 'content-type': options.contentType ?? 'application/json', origin: options.origin ?? BASE };
        if (options.operator !== false) headers.authorization = `Bearer ${OPERATOR}`;
        return http.request(new Request(`${options.base ?? BASE}${route}`, { method, headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }));
      };
      const pair: BrowserPairInput = {
        accountId: account.id, eventId: event.id, eventRef: event.providerEventRef, eventUrl,
        recipe: { id: eventUrl === FIXTURE_URL ? 'fixture-v1' : 'observe-only-v1', allowedOrigins: [new URL(eventUrl).origin] },
      };
      await run(h, call, account.id, pair);
    } finally { await h.stop(); }
  });
}

async function connect(call: Call, pair: BrowserPairInput): Promise<BrowserConnection> {
  const paired = await call('POST', '/api/browser/pair', pair);
  assert.equal(paired.status, 200, await paired.clone().text());
  const { pairingCode } = await paired.json() as { pairingCode: string };
  const response = await call('POST', '/api/browser/bridge/connect', { pairingCode, sessionId: 'http-browser-session', tabId: 23, url: pair.eventUrl }, { operator: false, origin: EXTENSION });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<BrowserConnection>;
}

const ext = { operator: false, origin: EXTENSION };
function snapshot(h: Harness, pair: BrowserPairInput, supported = false): BrowserSnapshot {
  return {
    observedAt: new Date(h.clock.now()).toISOString(), url: pair.eventUrl, supported, session: 'READY', queue: 'PASSED',
    offers: supported ? [{ offerRef: 'pista', sectionLabel: 'Pista Frontal', row: null, seats: [], qtyMin: 1, qtyMax: 4, unitPrice: 2500, currency: 'EUR', standing: true }] : [],
    cart: null,
  };
}

describe('browser HTTP integration', () => {
  it('pairing requires operator auth, local host, same origin and JSON', async () => withHttp(async (_h, call, _accountId, pair) => {
    assert.equal((await call('POST', '/api/browser/pair', pair, { operator: false })).status, 401);
    assert.equal((await call('POST', '/api/browser/pair', pair, { origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call('POST', '/api/browser/pair', pair, { base: 'https://control.example', origin: 'https://control.example' })).status, 403);
    assert.equal((await call('POST', '/api/browser/pair', pair, { contentType: 'text/plain' })).status, 400);
    assert.equal((await call('GET', '/api/browser/status', undefined, { operator: false })).status, 401);
    assert.equal((await call('POST', '/api/browser/pair', pair)).status, 200);
  }));

  it('pairing validates the account, event, provider and official URL; fixtures stay local', async () => withHttp(async (h, call, accountId, pair) => {
    assert.equal((await call('POST', '/api/browser/pair', { ...pair, accountId: 'absent' })).status, 400);
    assert.equal((await call('POST', '/api/browser/pair', { ...pair, eventId: 'absent' })).status, 400);
    const other = h.app.runtime.ctx.accounts.create({ label: 'Other', providerId: 'sim', holderRef: 'other' }, 'test');
    assert.equal((await call('POST', '/api/browser/pair', { ...pair, accountId: other.id })).status, 400);
    assert.equal((await call('POST', '/api/browser/pair', { ...pair, eventUrl: 'https://attacker.example/event' })).status, 409);
    assert.equal((await call('POST', '/api/browser/pair', { ...pair, recipe: { ...pair.recipe, allowedOrigins: ['https://attacker.example'] } })).status, 409);
    assert.equal((await call('POST', '/api/browser/pair', { ...pair, recipe: { ...pair.recipe, id: 'fixture-v1' } })).status, 400);
    h.app.runtime.ctx.accounts.update(accountId, { enabled: false }, 'test');
    assert.equal((await call('POST', '/api/browser/pair', pair)).status, 400);
    h.app.runtime.ctx.accounts.update(accountId, { enabled: true }, 'test');
    const actualSale = { ...pair, eventUrl: 'https://tickets.realmadrid.com/select/fixture-event', recipe: { ...pair.recipe, allowedOrigins: ['https://tickets.realmadrid.com'] } };
    assert.equal((await call('POST', '/api/browser/pair', actualSale)).status, 200, 'official sale subdomain is allowed explicitly');
  }));

  it('extension routes use their scoped token without the operator token and do not promote observe-only READY', async () => withHttp(async (h, call, accountId, pair) => {
    const connection = await connect(call, pair);
    assert.equal((await call('POST', '/api/browser/bridge/poll', connection, ext)).status, 200);
    for (const bad of [{ token: 'wrong' }, { tabId: 24 }, { sessionId: 'different-profile' }]) {
      assert.equal((await call('POST', '/api/browser/bridge/poll', { ...connection, ...bad }, ext)).status, 401);
    }
    assert.equal((await call('POST', '/api/browser/bridge/poll', connection, { operator: false, origin: 'https://attacker.example' })).status, 403);
    const state = snapshot(h, pair);
    const report = await call('POST', '/api/browser/bridge/report', { ...connection, snapshot: state }, ext);
    assert.equal(report.status, 200, await report.clone().text());
    assert.equal(h.app.runtime.store.accounts.get(accountId)?.session.state, 'UNKNOWN');
    assert.match(h.app.runtime.store.accounts.get(accountId)?.session.detail ?? '', /compatible/);
    const provider = h.app.registry.get('manual');
    assert.equal((await provider?.sessionStatus?.(accountId))?.state, 'UNKNOWN');
    const status = await call('GET', '/api/browser/status');
    assert.equal(status.status, 200);
    assert.ok(!(await status.text()).includes(connection.token));
    const preflight = await call('OPTIONS', '/api/browser/bridge/poll', undefined, ext);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), EXTENSION);
    assert.equal((await call('POST', '/api/browser/pair', pair, ext)).status, 401, 'extension token cannot replace operator authorization');
  }));

  it('rejects pairing a different page and rejects cart evidence from another account/event', async () => withHttp(async (h, call, _accountId, pair) => {
    const response = await call('POST', '/api/browser/pair', pair);
    const { pairingCode } = await response.json() as { pairingCode: string };
    const attempt = { pairingCode, sessionId: 's', tabId: 2, url: `${pair.eventUrl}/different` };
    assert.equal((await call('POST', '/api/browser/bridge/connect', attempt, ext)).status, 409);
    const ok = await call('POST', '/api/browser/bridge/connect', { ...attempt, url: pair.eventUrl }, ext);
    assert.equal(ok.status, 200);
    const connection = await ok.json() as BrowserConnection;
    const state = snapshot(h, pair);
    for (const mismatch of [{ accountId: 'other' }, { eventRef: 'other' }]) {
      const cart: BrowserCartEvidence = { verified: true, accountId: pair.accountId, eventRef: pair.eventRef, cartRef: 'c', items: [], openUrl: pair.eventUrl, expiresAt: null, ...mismatch };
      assert.equal((await call('POST', '/api/browser/bridge/report', { ...connection, snapshot: { ...state, cart } }, ext)).status, 400);
    }
  }));

  it('never focuses a HUMAN cart as though it had browser readback evidence', async () => withHttp(async (h, call, accountId) => {
    const op = h.app.runtime.ctx.ops.create(manualConfig([accountId], h.clock.now()), 'test');
    const cart = h.app.runtime.ctx.carts.add({ operationId: op.id, accountId, item: { claimId: null, sectionId: null, sectionLabel: 'T3', row: null, seats: [], qty: 1, unitPrice: 2500 }, level: 'HUMAN', providerCartRef: 'human-cart', expiresAt: null, openUrl: REAL_EVENT, review: null });
    assert.equal((await call('POST', `/api/browser/carts/${cart.id}/focus`, {})).status, 409);
    assert.equal(h.app.browser.status().length, 0);
  }));

  it('round-trips an exact fixture add/readback and focuses only the matching verified cart', async () => withHttp(async (h, call, accountId, pair) => {
    const connection = await connect(call, pair);
    const empty: BrowserCartEvidence = { verified: true, accountId, eventRef: pair.eventRef, cartRef: 'http-cart', items: [], openUrl: pair.eventUrl, expiresAt: null };
    const state = { ...snapshot(h, pair, true), cart: empty };
    assert.equal((await call('POST', '/api/browser/bridge/report', { ...connection, snapshot: state }, ext)).status, 200);
    assert.equal(h.app.runtime.store.accounts.get(accountId)?.session.state, 'READY');
    const provider = h.app.registry.get('manual');
    assert.ok(provider?.addToCart && provider.readCart);
    const adding = provider.addToCart({ accountId, eventRef: pair.eventRef, offerRef: 'pista', qty: 2, unitPrice: 2500, idempotencyKey: 'http-request' });
    const polled = await call('POST', '/api/browser/bridge/poll', connection, ext);
    const { commands } = await polled.json() as { commands: BrowserCommand[] };
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.type, 'ADD_TO_CART');
    const full: BrowserCartEvidence = { ...empty, items: [{ offerRef: 'pista', sectionLabel: 'Pista Frontal', row: null, seats: [], qty: 2, unitPrice: 2500, idempotencyKey: null }] };
    const reported = await call('POST', '/api/browser/bridge/report', { ...connection, snapshot: { ...state, cart: full }, commandId: commands[0]?.id, outcome: { status: 'ADDED', beforeCart: empty } }, ext);
    assert.equal(reported.status, 200, await reported.clone().text());
    assert.equal((await adding).status, 'ADDED');
    const readback = await provider.readCart(accountId, pair.eventRef);
    assert.equal(readback.items[0]?.qty, 2);
    assert.equal(readback.openUrl, pair.eventUrl);
    const op = h.app.runtime.ctx.ops.create(manualConfig([accountId], h.clock.now()), 'test');
    h.app.runtime.store.putOperationRecord({ ...op, providerEventRef: pair.eventRef });
    const cart = h.app.runtime.ctx.carts.add({ operationId: op.id, accountId, item: { claimId: null, sectionId: null, sectionLabel: 'Pista Frontal', row: null, seats: [], qty: 2, unitPrice: 2500 }, level: 'READBACK', providerCartRef: readback.cartRef, expiresAt: null, openUrl: readback.openUrl, review: null });
    assert.equal((await call('POST', `/api/browser/carts/${cart.id}/focus`, {})).status, 200);
    const focus = await call('POST', '/api/browser/bridge/poll', connection, ext);
    assert.deepEqual(((await focus.json()) as { commands: BrowserCommand[] }).commands.map((c) => c.type), ['FOCUS']);
    assert.equal(h.app.browser.status()[0]?.pendingCommands, 0);
    const changed = { ...full, items: full.items.map((item) => ({ ...item, qty: 1 })) };
    assert.equal((await call('POST', '/api/browser/bridge/report', { ...connection, snapshot: { ...state, cart: changed } }, ext)).status, 200);
    assert.equal((await call('POST', `/api/browser/carts/${cart.id}/focus`, {})).status, 409, 'a changed cart cannot be opened as the confirmed reservation');
  }, FIXTURE_URL));
});
