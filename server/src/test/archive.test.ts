import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Account, Cart, Claim } from '@to/shared';
import { writeFixtureVault } from '../gates/fixtures';
import { createHarness, simConfig } from '../gates/harness';
import { createHttpApp } from '../http/app';

let vault: string;
before(async () => { vault = await mkdtemp(path.join(tmpdir(), 'to-archive-test-')); await writeFixtureVault(vault); });
after(async () => { await rm(vault, { recursive: true, force: true }); });

describe('eliminación recuperable', () => {
  it('conserva identidad e historial; restaurar no activa la cuenta', async () => {
    const h = await createHarness(vault);
    try {
      const { ctx, store } = h.app.runtime;
      const a = ctx.accounts.create({ label: 'Prueba', providerId: 'sim', holderRef: 'titular', verification: 'VERIFIED' }, 'test');
      const archived = ctx.accounts.archive(a.id, true, 'test');
      assert.equal(archived.archived, true);
      assert.equal(archived.enabled, false);
      assert.equal(archived.holderRef, a.holderRef);
      assert.throws(() => ctx.accounts.update(a.id, { enabled: true }, 'test'), /Restaura/);
      await assert.rejects(ctx.accounts.openSession(a.id, 'test'), /Restaura/);
      assert.throws(() => ctx.accounts.humanReady(a.id, 'test'), /Restaura/);
      await ctx.journal.flush();
      assert.equal(store.accounts.get(a.id)?.archived, true);
      const persisted = (await h.driver.loadEntities()).find((row) => row.kind === 'account' && row.id === a.id)?.data as Account;
      assert.equal(persisted.archived, true);
      assert.equal(persisted.holderRef, a.holderRef);
      const restored = ctx.accounts.archive(a.id, false, 'test');
      assert.equal(restored.archived, false);
      assert.equal(restored.enabled, false);
    } finally { await h.stop(); }
  });

  it('elimina un borrador sin arrancarlo y conserva sus datos al restaurar', async () => {
    const h = await createHarness(vault);
    try {
      const { ctx, store } = h.app.runtime;
      const a = ctx.accounts.create({ label: 'Prueba', providerId: 'sim', holderRef: 'titular' }, 'test');
      const op = ctx.ops.create(simConfig([a.id], h.clock.now()), 'test');
      const archived = ctx.ops.archive(op.id, true, 'test');
      assert.equal(archived.state, 'CANCELLED');
      assert.equal(archived.archived, true);
      assert.deepEqual(store.operations.get(op.id)?.config, op.config);
      assert.equal((await ctx.ops.command(op.id, { command: 'validate' }, 'test')).ok, false);
      assert.equal(ctx.ops.archive(op.id, false, 'test').state, 'CANCELLED');
      assert.equal(store.carts.size, 0);
    } finally { await h.stop(); }
  });

  it('rechaza operaciones activas, carritos abiertos e intentos ambiguos', async () => {
    const h = await createHarness(vault);
    try {
      const { ctx, store } = h.app.runtime;
      const a = ctx.accounts.create({ label: 'Prueba', providerId: 'sim', holderRef: 'titular' }, 'test');
      const op = ctx.ops.create(simConfig([a.id], h.clock.now()), 'test');
      store.operations.set(op.id, { ...op, state: 'RUNNING' });
      assert.throws(() => ctx.ops.archive(op.id, true, 'test'), /Detén/);
      assert.throws(() => ctx.accounts.archive(a.id, true, 'test'), /operación/);
      store.operations.set(op.id, { ...op, state: 'CLOSED' });
      store.carts.set('test-cart', { id: 'test-cart', operationId: op.id, accountId: a.id, state: 'ACTIVE' } as Cart);
      assert.throws(() => ctx.ops.archive(op.id, true, 'test'), /carritos/);
      assert.throws(() => ctx.accounts.archive(a.id, true, 'test'), /carrito/);
      store.carts.delete('test-cart');
      store.claims.set('test-claim', { id: 'test-claim', operationId: op.id, accountId: a.id, state: 'AMBIGUOUS' } as Claim);
      assert.throws(() => ctx.ops.archive(op.id, true, 'test'), /intentos/);
      assert.throws(() => ctx.accounts.archive(a.id, true, 'test'), /intento/);
    } finally { await h.stop(); }
  });

  it('API exige autenticación, mismo origen y un booleano explícito', async () => {
    const h = await createHarness(vault);
    try {
      const a = h.app.runtime.ctx.accounts.create({ label: 'Prueba', providerId: 'sim', holderRef: 'titular' }, 'test');
      const http = createHttpApp(h.app, { operatorToken: 'test-only', dashboardDist: null });
      const url = `http://localhost/api/accounts/${a.id}/archive`;
      const send = (headers: Record<string, string>, archived: unknown) => http.request(url, { method: 'POST', headers, body: JSON.stringify({ archived }) });
      assert.equal((await send({ 'content-type': 'application/json' }, true)).status, 401);
      const headers = { 'content-type': 'application/json', authorization: 'Bearer test-only', host: 'localhost' };
      assert.equal((await send({ ...headers, origin: 'https://evil.example' }, true)).status, 403);
      assert.equal((await send(headers, 'true')).status, 400);
      assert.equal((await send(headers, true)).status, 200);
      assert.equal(h.app.runtime.store.accounts.get(a.id)?.archived, true);
    } finally { await h.stop(); }
  });

  it('cerrar al eliminar libera las cuentas sin eliminar carritos pagados ni sus límites', async () => {
    const h = await createHarness(vault);
    try {
      const { ctx, store } = h.app.runtime;
      const a = ctx.accounts.create({ label: 'Prueba', providerId: 'sim', holderRef: 'titular' }, 'test');
      const op = ctx.ops.create(simConfig([a.id], h.clock.now()), 'test');
      store.putOperationRecord({ ...op, state: 'ENDED' });
      store.putAccount({ ...a, leasedBy: op.id });
      const paid = { id: 'paid', operationId: op.id, accountId: a.id, state: 'PAID', qty: 1 } as Cart;
      store.putCart(paid);
      assert.equal(ctx.ops.archive(op.id, true, 'test').state, 'CLOSED');
      assert.equal(store.accounts.get(a.id)?.leasedBy, null);
      assert.deepEqual(store.carts.get('paid'), paid);
      ctx.accounts.archive(a.id, true, 'test');
      assert.equal(store.accounts.get(a.id)?.holderRef, 'titular');
      await ctx.journal.flush();
      assert.equal((await h.driver.loadEntities()).some((row) => row.kind === 'cart' && row.id === 'paid'), true);
    } finally { await h.stop(); }
  });
});
