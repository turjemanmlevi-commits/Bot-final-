import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFixtureVault, FIXTURE_UNVERIFIED_EVENT } from '../gates/fixtures';
import { createHarness, manualConfig, simConfig, simulateOperation, SIM_ACCOUNTS } from '../gates/harness';
import { replayOperation } from '../runtime/replay';
import { iso } from '../util/time';

let dir = '';
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'to-rt-'));
  await writeFixtureVault(dir);
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runtime', () => {
  it('una operación simulada llega a CART_SECURED sin sobreasignar y se reproduce igual', async () => {
    const r = await simulateOperation(dir, { scenarioId: 'tranquilo', seed: 4 });
    assert.equal(r.finalState, 'CART_SECURED');
    assert.equal(r.carted, r.requested);
    assert.deepEqual(r.violations, []);
    const rep = await replayOperation({ query: (q) => r.harness.driver.queryAudit(q) }, r.operationId, 0);
    assert.ok(rep.ok, JSON.stringify(rep.mismatches[0]));
    assert.ok(rep.decisionsChecked > 0);
    const carts = [...r.harness.app.runtime.store.carts.values()];
    assert.ok(carts.every((c) => c.state === 'ACTIVE' && c.confirmation === 'READBACK'), 'el sistema nunca paga');
  });

  it('no deja armar con límites sin verificar (fail-closed)', async () => {
    const h = await createHarness(dir);
    try {
      const rt = h.app.runtime;
      const accounts = SIM_ACCOUNTS.map((a) => rt.ctx.accounts.create(a, 't'));
      const op = rt.ctx.ops.create({ ...simConfig(accounts.map((a) => a.id), h.clock.now()), eventId: FIXTURE_UNVERIFIED_EVENT }, 't');
      const v = await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
      assert.equal(v.ok, false);
      assert.ok(v.validation?.issues.some((i) => i.code === 'LIMITS_UNVERIFIED'));
      const armed = await rt.ctx.ops.command(op.id, { command: 'arm' }, 't');
      assert.equal(armed.ok, false);
      assert.equal(rt.ctx.ops.get(op.id).state, 'DRAFT');
    } finally {
      await h.stop();
    }
  });

  it('el kill switch global pausa y corta las llamadas al proveedor', async () => {
    const h = await createHarness(dir, { seed: 21 });
    try {
      const rt = h.app.runtime;
      const accounts = SIM_ACCOUNTS.map((a) => rt.ctx.accounts.create(a, 't'));
      const op = rt.ctx.ops.create(simConfig(accounts.map((a) => a.id), h.clock.now(), { requestedQty: 12, simulation: { scenarioId: 'alta-demanda', seed: 21 } }), 't');
      await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
      await rt.ctx.ops.command(op.id, { command: 'arm' }, 't');
      h.humanSolvesChallenges();
      await h.clock.runUntil(() => rt.ctx.ops.get(op.id).state === 'RUNNING', 120_000);
      rt.ctx.safety.setKillSwitch('GLOBAL', null, true, 'test', 't');
      await h.clock.advance(100);
      const calls = rt.ctx.gateway.totalCalls();
      await h.clock.advance(5000);
      assert.equal(rt.ctx.gateway.totalCalls(), calls);
      assert.ok(['PAUSED', 'CART_SECURED'].includes(rt.ctx.ops.get(op.id).state));
      const resume = await rt.ctx.ops.command(op.id, { command: 'resume' }, 't');
      if (rt.ctx.ops.get(op.id).state === 'PAUSED') assert.equal(resume.ok, false, 'no se reanuda con el kill switch activo');
    } finally {
      await h.stop();
    }
  });

  it('SIMULATED: el desfase del reloj del proveedor se mide sin sesgo (T0 no se adelanta)', async () => {
    const h = await createHarness(dir);
    try {
      const rt = h.app.runtime;
      // El simulador va 140 ms adelantado (escenario por defecto) y tarda 10 ms en contestar la hora.
      const sync = rt.ctx.ops.syncClock('sim');
      await h.clock.advance(50);
      await sync;
      assert.equal(rt.store.clockSkew.get('sim'), 140);
    } finally {
      await h.stop();
    }
  });

  it('SIMULATED: si la cola aún no abre y faltan pocos ms, se vuelve a mirar justo entonces', async () => {
    const h = await createHarness(dir, { seed: 5 });
    try {
      const rt = h.app.runtime;
      const accounts = SIM_ACCOUNTS.slice(0, 2).map((a) => rt.ctx.accounts.create(a, 't'));
      const op = rt.ctx.ops.create(simConfig(accounts.map((a) => a.id), h.clock.now(), { requestedQty: 2, simulation: { scenarioId: 'sin-cola', seed: 5 } }), 't');
      await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
      // «Aún no abre: faltan 3 ms» en la primera consulta de cada cuenta.
      const polls = new Map<string, number[]>();
      const pollQueue = rt.ctx.accounts.pollQueue.bind(rt.ctx.accounts);
      rt.ctx.accounts.pollQueue = async (accountId, operationId, eventRef) => {
        const at = polls.get(accountId) ?? [];
        at.push(h.clock.now());
        polls.set(accountId, at);
        if (at.length === 1) return { state: 'NOT_OPEN', position: null, etaMs: 3, updatedAt: iso(h.clock.now()) };
        return pollQueue(accountId, operationId, eventRef);
      };
      await h.clock.runUntil(() => [...polls.values()].some((p) => p.length >= 2), 120_000, 1);
      const first = [...polls.values()].find((p) => p.length >= 2) ?? [];
      assert.ok((first[1] ?? 0) - (first[0] ?? 0) <= 5, `segunda consulta a los ${(first[1] ?? 0) - (first[0] ?? 0)} ms`);
    } finally {
      await h.stop();
    }
  });

  it('manual-assist: tareas humanas, carrito HUMAN y pago solo por una persona', async () => {
    const h = await createHarness(dir, { seed: 3 });
    try {
      const rt = h.app.runtime;
      const acc = rt.ctx.accounts.create({ label: 'M', providerId: 'manual', holderRef: 'm', verification: 'VERIFIED' }, 't');
      const op = rt.ctx.ops.create(manualConfig([acc.id], h.clock.now()), 't');
      await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
      await h.clock.advance(500);
      const session = [...rt.store.humanTasks.values()].find((t) => t.kind === 'OPEN_SESSION' && t.state === 'OPEN');
      assert.ok(session, 'se pide a una persona que inicie sesión');
      rt.ctx.tasks.respond(session?.id ?? '', { result: 'READY' }, 'persona');
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'start-now' }, 't')).ok);
      await h.clock.advance(1500);
      const add = [...rt.store.humanTasks.values()].find((t) => t.kind === 'ADD_TO_CART' && t.state === 'OPEN');
      assert.ok(add);
      assert.equal(add?.target?.qty, 4);
      rt.ctx.tasks.respond(add?.id ?? '', { result: 'IN_CART', qty: 4, unitPrice: 5000 }, 'persona');
      await h.clock.advance(1500);
      assert.equal(rt.ctx.ops.get(op.id).state, 'CART_SECURED');
      const cart = [...rt.store.carts.values()][0];
      assert.equal(cart?.confirmation, 'HUMAN');
      assert.equal(cart?.state, 'ACTIVE');
      rt.ctx.carts.mark(cart?.id ?? '', 'PAID', 'persona');
      assert.equal(rt.store.carts.get(cart?.id ?? '')?.state, 'PAID');
    } finally {
      await h.stop();
    }
  });
});
