import assert from 'node:assert/strict';
import test from 'node:test';
import type { OperationConfig, SessionInfo } from '@to/shared';
import type { RawOffer } from '../domain/candidates';
import { withFixtureVault } from '../gates/fixtures';
import { createHarness, manualConfig, type Harness } from '../gates/harness';
import type { AddToCartRequest, AddToCartResult, InventoryRead, ProviderAdapter, ProviderCart } from '../providers/types';
import { iso } from '../util/time';

class AccountBrowser implements ProviderAdapter {
  readonly id = 'manual';
  readonly name = 'Browser account isolation fixture';
  readonly mode = 'BROWSER_SESSION' as const;
  readonly adapterVersion = 'fixture-1';
  readonly confirmationPolicy = 'READBACK' as const;
  readonly declared = ['session.open', 'session.status', 'queue.status', 'inventory.read', 'cart.add', 'cart.read'] as const;
  readonly reads: string[] = [];
  readonly adds: AddToCartRequest[] = [];
  readonly offers = new Map<string, RawOffer[]>();
  readonly carts = new Map<string, ProviderCart>();
  beforeRead: ((id: string) => Promise<void>) | null = null;
  reject: ((request: AddToCartRequest) => AddToCartResult | null) | null = null;

  constructor(private readonly harness: Harness) {}
  async sessionStatus(): Promise<SessionInfo> {
    return { state: 'READY', challenge: null, queue: { state: 'PASSED', position: null, etaMs: null, updatedAt: iso(this.harness.clock.now()) }, lastCheckedAt: iso(this.harness.clock.now()), detail: 'Fixture tab ready' };
  }
  async openSession() { return this.sessionStatus(); }
  async queueStatus() { return (await this.sessionStatus()).queue; }
  async readInventory(accountId: string): Promise<InventoryRead> {
    this.reads.push(accountId);
    if (this.beforeRead) await this.beforeRead(accountId);
    return { offers: this.offers.get(accountId) ?? [], observedAtMs: this.harness.clock.now(), schemaVersion: 'fixture:1' };
  }
  async addToCart(request: AddToCartRequest): Promise<AddToCartResult> {
    this.adds.push(request);
    const rejection = this.reject?.(request);
    if (rejection) return rejection;
    const offer = this.offers.get(request.accountId)?.find((item) => item.offerRef === request.offerRef);
    assert.ok(offer, `account ${request.accountId} was sent another tab's offer ${request.offerRef}`);
    assert.equal(request.unitPrice, offer.unitPrice);
    const item = { offerRef: offer.offerRef, sectionLabel: offer.sectionLabel, row: offer.row, seats: offer.seats, qty: request.qty, unitPrice: request.unitPrice, idempotencyKey: request.idempotencyKey };
    const cart = { cartRef: 'cart-' + request.accountId, items: [item], expiresAt: iso(this.harness.clock.now() + 600_000), openUrl: 'https://tickets.example.test/cart/' + request.accountId };
    this.carts.set(request.accountId, cart);
    return { status: 'ADDED', cart, item, duplicate: false };
  }
  async readCart(accountId: string): Promise<ProviderCart> {
    const cart = this.carts.get(accountId);
    if (!cart) throw new Error('No verified cart exists in this account tab');
    return cart;
  }
}

const offer = (ref: string, price = 5000): RawOffer => ({ offerRef: ref, sectionLabel: 'T3', row: null, seats: [], qtyMin: 1, qtyMax: 1, unitPrice: price, currency: 'EUR' });

async function setup(dir: string, people: number, requested = people) {
  const h = await createHarness(dir);
  const rt = h.app.runtime;
  const provider = new AccountBrowser(h);
  rt.ctx.registry.enableBrowser(provider);
  const accounts = Array.from({ length: people }, (_, i) => rt.ctx.accounts.create({ label: `Account ${i + 1}`, providerId: 'manual', holderRef: `holder-${i}`, verification: 'VERIFIED' }, 'test'));
  for (const account of accounts) {
    rt.ctx.accounts.setSession(account.id, await provider.sessionStatus());
    provider.offers.set(account.id, [offer('offer-' + account.id)]);
  }
  const base = manualConfig(accounts.map((account) => account.id), h.clock.now());
  const config: OperationConfig = { ...base, requestedQty: requested, maxUnitPrice: 6000, budget: requested * 6000,
    preferences: { ...base.preferences, targets: ['T3'], requireContiguous: false, minGroupSize: 1, maxPerAccount: Math.max(1, requested / people) } };
  const op = rt.ctx.ops.create(config, 'test');
  assert.equal((await rt.ctx.ops.command(op.id, { command: 'validate' }, 'test')).ok, true);
  const armed = await rt.ctx.ops.command(op.id, { command: 'arm' }, 'test');
  assert.equal(armed.ok, true, armed.message);
  return { h, rt, provider, accounts, op };
}

test('browser runner reads each account and never reuses the first tab inventory for another', async () => withFixtureVault(async (dir) => {
  const { h, rt, provider, accounts, op } = await setup(dir, 2);
  try {
    provider.offers.set(accounts[1]!.id, [offer('second-tab-only', 5500)]);
    await h.clock.advance(61_000);
    assert.equal(rt.store.operations.get(op.id)?.state, 'CART_SECURED');
    assert.equal(provider.adds.length, 2);
    assert.ok(provider.reads.includes(accounts[0]!.id));
    assert.ok(provider.reads.includes(accounts[1]!.id));
    for (const request of provider.adds) assert.ok(provider.offers.get(request.accountId)?.some((item) => item.offerRef === request.offerRef && item.unitPrice === request.unitPrice));
    assert.deepEqual(h.violations, []);
  } finally { await h.stop(); }
}));

test('a sold-out offer in one browser account does not suppress another account with the same local offer id', async () => withFixtureVault(async (dir) => {
  const { h, provider, accounts } = await setup(dir, 2);
  try {
    const first = accounts[0]!.id, second = accounts[1]!.id;
    provider.offers.set(first, [offer('same-local-id')]);
    provider.offers.set(second, [offer('same-local-id')]);
    provider.beforeRead = async (id) => { if (id === second) await h.clock.sleep(300); };
    provider.reject = (request) => request.accountId === first ? { status: 'REJECTED', reason: 'SOLD_OUT', detail: 'Only this tab lost its offer' } : null;
    await h.clock.advance(61_000);
    assert.ok(provider.carts.has(second), 'second account retains its independently observed offer');
    assert.equal(provider.adds.filter((request) => request.accountId === second).length, 1);
  } finally { await h.stop(); }
}));

test('INVALID_REQUEST waits for changed account inventory and stops after one bounded retry', async () => withFixtureVault(async (dir) => {
  const { h, rt, provider, accounts, op } = await setup(dir, 1);
  try {
    const accountId = accounts[0]!.id;
    provider.reject = () => ({ status: 'REJECTED', reason: 'INVALID_REQUEST', detail: 'Tab rejected selection' });
    await h.clock.advance(63_000);
    assert.equal(provider.adds.length, 1, 'same evidence must not generate repeated claims');
    provider.offers.set(accountId, [offer('changed-tab-offer', 5100)]);
    await h.clock.advance(2000);
    assert.equal(provider.adds.length, 2, 'changed evidence permits one bounded retry');
    provider.offers.set(accountId, [offer('third-offer', 5200)]);
    await h.clock.advance(5000);
    assert.equal(provider.adds.length, 2, 'the account remains stopped after its second invalid request');
    assert.ok([...rt.store.alerts.values()].some((alert) => alert.operationId === op.id && alert.accountId === accountId && alert.dedupeKey.startsWith('browser-rejected:')));
    assert.deepEqual(h.violations, []);
  } finally { await h.stop(); }
}));

test('browser inventory failures back off instead of polling on every runner tick', async () => withFixtureVault(async (dir) => {
  const { h, provider } = await setup(dir, 1);
  try {
    provider.beforeRead = async () => { throw Object.assign(new Error('Tab disconnected'), { code: 'SESSION_INVALID' }); };
    await h.clock.advance(63_000);
    assert.equal(provider.adds.length, 0);
    assert.ok(provider.reads.length <= 4, `bounded inventory calls: ${provider.reads.length}`);
  } finally { await h.stop(); }
}));

test('an ambiguous browser result stops further selections even when the account still has capacity', async () => withFixtureVault(async (dir) => {
  const { h, provider, accounts } = await setup(dir, 1, 2);
  try {
    provider.reject = () => ({ status: 'AMBIGUOUS', detail: 'A click occurred but the tab lost its cart view' });
    await h.clock.advance(61_000);
    assert.equal(provider.adds.length, 1);
    provider.offers.set(accounts[0]!.id, [offer('another-visible-offer')]);
    await h.clock.advance(3000);
    assert.equal(provider.adds.length, 1, 'uncertainty must be reviewed before any further account selection');
  } finally { await h.stop(); }
}));
