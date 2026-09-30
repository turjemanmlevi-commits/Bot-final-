import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHarness, simConfig, SIM_ACCOUNTS } from '../gates/harness';
import { writeFixtureVault } from '../gates/fixtures';
import type { ProviderCart, ProviderCartItem } from '../providers/types';

let dir = '';
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'to-cart-truth-'));
  await writeFixtureVault(dir);
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

async function reserved() {
  const h = await createHarness(dir);
  const rt = h.app.runtime;
  const account = rt.ctx.accounts.create(SIM_ACCOUNTS[0]!, 'test');
  const op = rt.ctx.ops.create(simConfig([account.id], h.clock.now(), { requestedQty: 2 }), 'test');
  assert.ok((await rt.ctx.ops.command(op.id, { command: 'validate' }, 'test')).ok);
  assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 'test')).ok);
  const claim = rt.ctx.claims.reserve({
    operationId: op.id, accountId: account.id, candidateId: 'candidate', offerRef: 'offer',
    sectionId: null, sectionLabel: 'Tribuna', row: '1', qty: 2, unitPrice: 5000, attempt: 1,
  });
  assert.ok(claim);
  const sent = rt.ctx.claims.markSent(claim);
  const item: ProviderCartItem = { offerRef: 'offer', sectionLabel: 'Tribuna', row: '1', seats: ['1', '2'], qty: 2, unitPrice: 5000, idempotencyKey: claim.idempotencyKey };
  const cart: ProviderCart = { cartRef: 'real-ref', items: [item], expiresAt: new Date(h.clock.now() + 600_000).toISOString(), openUrl: 'https://tickets.example.org/cart' };
  return { h, rt, account, op: rt.ctx.ops.get(op.id), claim: sent, item, cart };
}

describe('el carrito necesita evidencia del contenido solicitado', () => {
  for (const [label, patch] of [
    ['cantidad', { qty: 1 }],
    ['precio', { unitPrice: 5001 }],
    ['oferta', { offerRef: 'other-offer' }],
  ] as Array<[string, Partial<ProviderCartItem>]>) {
    it(`una clave de intento correcta no confirma ${label} incorrecta ni libera la reserva`, async () => {
      const { h, rt, op, claim, item, cart } = await reserved();
      try {
        const read = { ...cart, items: [{ ...item, ...patch }] };
        rt.ctx.registry.get('sim')!.readCart = async () => read;
        const result = await rt.ctx.claims.handleAddResult(claim, op, 'event', { ok: true, ms: 0, value: { status: 'ADDED', cart, item, duplicate: false } });
        assert.equal(result.kind, 'AMBIGUOUS');
        assert.equal(rt.store.carts.size, 0, 'sin registro que finja una reserva correcta');
        await rt.ctx.claims.reconcile(claim.id, 'event', 1);
        assert.equal(rt.store.claims.get(claim.id)?.state, 'AMBIGUOUS');
        assert.equal(rt.store.allocations.get(op.id)?.claimedQty, 2, 'la reserva sigue ocupada para no duplicar');
        assert.ok([...rt.store.humanTasks.values()].some((t) => t.kind === 'VERIFY_CART' && t.claimId === claim.id));
        assert.ok(![...rt.store.alerts.values()].some((a) => a.kind === 'CART_CONFIRMED' || a.kind === 'CART_SECURED'));
      } finally { await h.stop(); }
    });
  }

  it('confirma cuando la lectura posterior contiene oferta, cantidad y precio exactos', async () => {
    const { h, rt, op, claim, item, cart } = await reserved();
    try {
      rt.ctx.registry.get('sim')!.readCart = async () => cart;
      const result = await rt.ctx.claims.handleAddResult(claim, op, 'event', { ok: true, ms: 0, value: { status: 'ADDED', cart, item, duplicate: false } });
      assert.equal(result.kind, 'CONFIRMED');
      const saved = [...rt.store.carts.values()][0];
      assert.equal(saved?.confirmation, 'READBACK');
      assert.equal(saved?.qty, 2);
      assert.equal(saved?.openUrl, cart.openUrl);
    } finally { await h.stop(); }
  });

  it('un carrito que requiere revisión no emite la alerta de carrito confirmado', async () => {
    const { h, rt, op, account } = await reserved();
    try {
      const saved = rt.ctx.carts.add({
        operationId: op.id, accountId: account.id,
        item: { claimId: null, sectionId: null, sectionLabel: 'Tribuna', row: '1', seats: [], qty: 2, unitPrice: 14_000 },
        level: 'READBACK', providerCartRef: 'review', expiresAt: null, openUrl: null, review: 'El precio supera el máximo.',
      });
      assert.equal(saved.state, 'REVIEW_REQUIRED');
      assert.ok(![...rt.store.alerts.values()].some((a) => a.cartId === saved.id && a.kind === 'CART_CONFIRMED'));
      assert.ok([...rt.store.alerts.values()].some((a) => a.cartId === saved.id && a.kind === 'CART_REVIEW'));
    } finally { await h.stop(); }
  });

  it('un registro manual no se vuelve READBACK al añadir otras entradas verificadas', async () => {
    const { h, rt, op, account } = await reserved();
    try {
      const addition = {
        operationId: op.id, accountId: account.id,
        item: { claimId: null, sectionId: null, sectionLabel: 'Tribuna', row: null, seats: [], qty: 1, unitPrice: 5000 },
        providerCartRef: 'mixed', expiresAt: null, openUrl: null, review: null,
      };
      rt.ctx.carts.add({ ...addition, level: 'HUMAN' });
      const mixed = rt.ctx.carts.add({ ...addition, level: 'READBACK' });
      assert.equal(mixed.confirmation, 'HUMAN');
      assert.equal(mixed.qty, 2);
    } finally { await h.stop(); }
  });
});
