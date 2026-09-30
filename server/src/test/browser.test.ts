import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BrowserCartEvidence, BrowserSnapshot } from '../../../shared/src/browser';
import { BrowserBridge } from '../browser/bridge';
import { BrowserSessionProvider } from '../providers/browser';
import type { AddToCartRequest } from '../providers/types';

const EVENT_URL = 'http://127.0.0.1:8787/browser-fixture/event';
const request: AddToCartRequest = { accountId: 'acc-a', eventRef: 'evt-fixture', offerRef: 'offer-pista', qty: 2, unitPrice: 2500, idempotencyKey: 'request-1' };

function fixture(options: ConstructorParameters<typeof BrowserBridge>[0] = {}) {
  const bridge = new BrowserBridge(options);
  const paired = bridge.pair({ accountId: request.accountId, eventId: 'event-id', eventRef: request.eventRef, eventUrl: EVENT_URL, recipe: { id: 'fixture-v1', allowedOrigins: ['http://127.0.0.1:8787'] } });
  const connection = bridge.connect({ pairingCode: paired.pairingCode, sessionId: 'browser-session-a', tabId: 7, url: EVENT_URL });
  const empty: BrowserCartEvidence = { verified: true, accountId: request.accountId, eventRef: request.eventRef, cartRef: 'cart-a', items: [], openUrl: EVENT_URL, expiresAt: null };
  const snapshot: BrowserSnapshot = { observedAt: new Date().toISOString(), url: EVENT_URL, supported: true, session: 'READY', queue: 'PASSED', offers: [{ offerRef: request.offerRef, sectionLabel: 'Pista', row: null, seats: [], qtyMin: 1, qtyMax: 4, unitPrice: request.unitPrice, currency: 'EUR', standing: true }], cart: structuredClone(empty) };
  bridge.report({ ...connection, snapshot });
  const provider = new BrowserSessionProvider('fixture-browser', 'Browser fixture', bridge);
  const filled = (qty = request.qty): BrowserSnapshot => ({ ...snapshot, observedAt: new Date().toISOString(), cart: { ...empty, items: [{ offerRef: request.offerRef, sectionLabel: 'Pista', row: null, seats: [], qty, unitPrice: request.unitPrice, idempotencyKey: null }] } });
  return { bridge, connection, provider, snapshot, empty, filled };
}

describe('browser bridge and provider', () => {
  it('pairs one exact tab, keeps tokens out of status, and rejects replayed pairing codes', () => {
    const bridge = new BrowserBridge();
    const pair = bridge.pair({ accountId: 'a', eventId: 'e', eventRef: 'r', eventUrl: EVENT_URL, recipe: { id: 'fixture-v1', allowedOrigins: ['http://127.0.0.1:8787'] } });
    assert.throws(() => bridge.connect({ pairingCode: pair.pairingCode, sessionId: 's', tabId: 1, url: `${EVENT_URL}/other` }), /exactamente/);
    const connection = bridge.connect({ pairingCode: pair.pairingCode, sessionId: 's', tabId: 1, url: EVENT_URL });
    assert.throws(() => bridge.connect({ pairingCode: pair.pairingCode, sessionId: 's', tabId: 1, url: EVENT_URL }), /inválido/);
    for (const change of [{ tabId: 2 }, { token: 'wrong' }, { sessionId: 'other' }]) assert.throws(() => bridge.poll({ ...connection, ...change }), /autorizado/);
    assert.ok(!JSON.stringify(bridge.status()).includes(connection.token));
    assert.ok(!JSON.stringify(bridge.getBinding('a')).includes(connection.token));
    bridge.close();
  });

  it('only confirms exact observed cart rows and readback URL after an empty baseline', async () => {
    const f = fixture();
    const pending = f.provider.addToCart(request);
    const commands = f.bridge.poll(f.connection).commands;
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.type, 'ADD_TO_CART');
    assert.equal(f.bridge.poll(f.connection).commands.length, 0, 'one delivery, no second click');
    const result = f.bridge.report({ ...f.connection, snapshot: f.filled(), commandId: commands[0]?.id, outcome: { status: 'ADDED', beforeCart: f.empty } });
    assert.equal(result.commandAccepted, true);
    assert.equal(f.bridge.report({ ...f.connection, snapshot: f.filled(), commandId: commands[0]?.id, outcome: { status: 'ADDED', beforeCart: f.empty } }).commandAccepted, true, 'lost HTTP responses may be acknowledged again without another add');
    const added = await pending;
    assert.equal(added.status, 'ADDED');
    const cart = await f.provider.readCart(request.accountId, request.eventRef);
    assert.equal(cart.items[0]?.qty, 2);
    assert.equal(cart.items[0]?.idempotencyKey, request.idempotencyKey);
    assert.equal(cart.openUrl, EVENT_URL);
    assert.equal((await f.provider.addToCart(request)).status, 'ADDED');
    assert.equal(f.bridge.poll(f.connection).commands.length, 0, 'same request cannot issue another add');
    f.bridge.close();
  });

  it('navigation or a wrong quantity is ambiguous and cannot cause another automatic add', async () => {
    const f = fixture();
    const pending = f.provider.addToCart(request);
    const command = f.bridge.poll(f.connection).commands[0];
    f.bridge.report({ ...f.connection, snapshot: f.filled(1), commandId: command?.id, outcome: { status: 'ADDED', beforeCart: f.empty } });
    assert.equal((await pending).status, 'AMBIGUOUS');
    await assert.rejects(f.provider.readCart(request.accountId, request.eventRef), /evidencia completa/);
    const second = await f.provider.addToCart({ ...request, idempotencyKey: 'request-2' });
    assert.equal(second.status, 'AMBIGUOUS');
    assert.equal(f.bridge.poll(f.connection).commands.length, 0);
    f.bridge.close();
  });

  it('a previous nonempty cart is never claimed as a fresh add', async () => {
    const f = fixture();
    const pending = f.provider.addToCart(request);
    const command = f.bridge.poll(f.connection).commands[0];
    const existing = f.filled().cart as BrowserCartEvidence;
    f.bridge.report({ ...f.connection, snapshot: f.filled(), commandId: command?.id, outcome: { status: 'ADDED', beforeCart: existing } });
    assert.equal((await pending).status, 'AMBIGUOUS');
    await assert.rejects(f.provider.readCart(request.accountId, request.eventRef), /evidencia completa/);
    f.bridge.close();
  });

  it('uses the bound account and event and rejects injected foreign cart evidence', async () => {
    const f = fixture();
    await assert.rejects(f.provider.readInventory('other-account', request.eventRef), /Vincula/);
    await assert.rejects(f.provider.readCart(request.accountId, 'other-event'), /Vincula/);
    const bad = f.filled();
    if (bad.cart) bad.cart.accountId = 'other-account';
    assert.throws(() => f.bridge.report({ ...f.connection, snapshot: bad }), /cuenta\/evento/);
    assert.throws(() => f.bridge.report({ ...f.connection, snapshot: { ...f.snapshot, url: 'https://attacker.example/' } }), /orígenes/);
    f.bridge.close();
  });

  it('revalidates offer price and quantity in this account before sending any command', async () => {
    const f = fixture();
    assert.equal((await f.provider.addToCart({ ...request, unitPrice: 100 })).status, 'REJECTED');
    assert.equal((await f.provider.addToCart({ ...request, qty: 8 })).status, 'REJECTED');
    assert.equal(f.bridge.poll(f.connection).commands.length, 0);
    f.bridge.close();
  });

  it('stops at a manual challenge, observes completion, and never calls a solver', async () => {
    const f = fixture();
    f.bridge.report({ ...f.connection, snapshot: { ...f.snapshot, session: 'CHALLENGE_REQUIRED', challenge: 'CAPTCHA' } });
    assert.equal((await f.provider.sessionStatus(request.accountId)).state, 'CHALLENGE_REQUIRED');
    assert.equal((await f.provider.addToCart(request)).status, 'REJECTED');
    assert.deepEqual(f.bridge.poll(f.connection).commands.map((c) => c.type), ['FOCUS']);
    f.bridge.report({ ...f.connection, snapshot: f.snapshot });
    assert.equal((await f.provider.sessionStatus(request.accountId)).state, 'READY');
    assert.ok(!('solveCaptcha' in f.provider));
    assert.ok(!('pay' in f.provider));
    f.bridge.close();
  });

  it('times out as ambiguous and retains that result for the idempotency key', async () => {
    const f = fixture({ commandTimeoutMs: 10 });
    const result = f.provider.addToCart(request);
    f.bridge.poll(f.connection);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal((await result).status, 'AMBIGUOUS');
    assert.equal((await f.provider.addToCart(request)).status, 'AMBIGUOUS');
    assert.equal(f.bridge.status()[0]?.uncertain, true);
    assert.equal(f.bridge.poll(f.connection).commands.length, 0);
    f.bridge.close();
  });

  it('requires an explicit verified cart recipe for a real page', async () => {
    const bridge = new BrowserBridge();
    const eventUrl = 'https://www.entradas.com/event/example-1/';
    const pair = bridge.pair({ accountId: request.accountId, eventId: 'e', eventRef: request.eventRef, eventUrl, recipe: { id: 'entradas-fastbooking-v1', allowedOrigins: ['https://www.entradas.com'] } });
    const connection = bridge.connect({ pairingCode: pair.pairingCode, sessionId: 's', tabId: 1, url: eventUrl });
    const f = fixture();
    bridge.report({ ...connection, snapshot: { ...f.snapshot, url: eventUrl, cart: null } });
    const provider = new BrowserSessionProvider('entradas-com', 'Entradas', bridge);
    assert.equal((await provider.addToCart(request)).status, 'REJECTED');
    assert.equal(bridge.poll(connection).commands.length, 0);
    bridge.close(); f.bridge.close();
  });

  it('observe-only cannot execute even if a page falsely advertises supported inventory', async () => {
    const bridge = new BrowserBridge();
    const pair = bridge.pair({ accountId: request.accountId, eventId: 'e', eventRef: request.eventRef, eventUrl: EVENT_URL, recipe: { id: 'observe-only-v1', allowedOrigins: ['http://127.0.0.1:8787'] } });
    const connection = bridge.connect({ pairingCode: pair.pairingCode, sessionId: 's', tabId: 2, url: EVENT_URL });
    const f = fixture();
    bridge.report({ ...connection, snapshot: f.snapshot });
    const provider = new BrowserSessionProvider('observed', 'Observation only', bridge);
    const session = await provider.sessionStatus(request.accountId);
    assert.equal(session.state, 'UNKNOWN');
    assert.match(session.detail ?? '', /no compatible/);
    assert.equal((await provider.queueStatus(request.accountId, request.eventRef)).state, 'UNKNOWN');
    await assert.rejects(provider.readInventory(request.accountId, request.eventRef), /no soportada/);
    assert.equal((await provider.addToCart(request)).status, 'REJECTED');
    assert.equal(bridge.poll(connection).commands.length, 0);
    bridge.close(); f.bridge.close();
  });

  it('an unsupported snapshot does not advertise an operational READY session', async () => {
    const f = fixture();
    f.bridge.report({ ...f.connection, snapshot: { ...f.snapshot, supported: false } });
    const session = await f.provider.sessionStatus(request.accountId);
    assert.equal(session.state, 'UNKNOWN');
    assert.match(session.detail ?? '', /no compatible/);
    assert.equal(session.queue.state, 'UNKNOWN');
    f.bridge.close();
  });

  it('FOCUS finishes at delivery without an extension outcome or a pending cart attempt', async () => {
    const f = fixture({ commandTimeoutMs: 10 });
    assert.equal(f.bridge.focus(request.accountId, 'other-event'), false);
    assert.equal(f.bridge.focus(request.accountId, request.eventRef), true);
    assert.equal(f.bridge.status()[0]?.pendingCommands, 1);
    assert.deepEqual(f.bridge.poll(f.connection).commands.map((c) => c.type), ['FOCUS']);
    assert.equal(f.bridge.status()[0]?.pendingCommands, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(f.bridge.status()[0]?.uncertain, false);
    const pending = f.provider.addToCart(request);
    const command = f.bridge.poll(f.connection).commands[0];
    assert.equal(command?.type, 'ADD_TO_CART');
    f.bridge.report({ ...f.connection, snapshot: f.filled(), commandId: command?.id, outcome: { status: 'ADDED', beforeCart: f.empty } });
    assert.equal((await pending).status, 'ADDED');
    f.bridge.close();
  });

  it('rejects stale snapshots and uses a short-lived pairing code', () => {
    let now = Date.now();
    const bridge = new BrowserBridge({ now: () => now, pairTtlMs: 100 });
    const pair = bridge.pair({ accountId: request.accountId, eventId: 'e', eventRef: request.eventRef, eventUrl: EVENT_URL, recipe: { id: 'fixture-v1', allowedOrigins: ['http://127.0.0.1:8787'] } });
    now += 101;
    assert.throws(() => bridge.connect({ pairingCode: pair.pairingCode, sessionId: 's', tabId: 2, url: EVENT_URL }), /caducado/);
    const f = fixture();
    assert.throws(() => f.bridge.report({ ...f.connection, snapshot: { ...f.snapshot, observedAt: new Date(Date.now() - 60_000).toISOString() } }), /caducada/);
    bridge.close(); f.bridge.close();
  });
});
