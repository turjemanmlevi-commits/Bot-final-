/**
 * Asistencia manual: comportamientos que importan en una compra real
 * (carritos confirmados por personas, reparto en paralelo, siguiente zona,
 * «Sesión lista» por compra, cuentas paradas, respuestas duplicadas).
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { HumanTask, Id, OperationConfig } from '@to/shared';
import { writeFixtureVault } from '../gates/fixtures';
import { createHarness, type Harness } from '../gates/harness';
import { iso } from '../util/time';

const EVENT = 'evt-test-limite-3';

async function vaultWithLimit3(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'to-manual-'));
  await writeFixtureVault(dir);
  await writeFile(
    path.join(dir, '20 Eventos', 'Evento Limite 3.md'),
    `---
type: event
id: ${EVENT}
name: Evento Limite 3
venue: "[[Recinto Test]]"
provider: "[[Manual]]"
providerEventRef: TEST-L3
startsAt: 2027-01-01T21:00:00Z
currency: EUR
limitPerAccount: 3
limitPerGroup: 3
limitPerOperation: 12
limitSemantics: PER_HOLDER
limitsVerified: true
limitsSource: "fixture"
---
`,
    'utf8',
  );
  return dir;
}

function config(accountIds: Id[], now: number, over: Partial<OperationConfig> = {}): OperationConfig {
  return {
    name: 'Compra manual',
    eventId: EVENT,
    providerId: 'manual',
    t0: iso(now + 60_000),
    runWindowMinutes: 60,
    freezeLeadSeconds: 30,
    requestedQty: 4,
    currency: 'EUR',
    maxUnitPrice: 10_000,
    budget: 40_000,
    preferences: {
      targets: ['T3', 'T4', 'Tribuna'],
      excludeSections: [],
      requireContiguous: true,
      minGroupSize: 2,
      allowStanding: false,
      allowObstructed: false,
      allowAccessible: false,
      maxAmbiguity: 0.2,
    },
    accountIds,
    cartExpiryAlertsSeconds: [120, 60],
    ...over,
  };
}

describe('asistencia manual en una compra real', () => {
  let dir = '';
  let h: Harness;
  before(async () => {
    dir = await vaultWithLimit3();
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const tasksOf = (op: Id, kind: HumanTask['kind'], accountId?: Id) =>
    [...h.app.runtime.store.humanTasks.values()].filter((t) => t.operationId === op && t.kind === kind && t.state === 'OPEN' && (!accountId || t.accountId === accountId));

  async function armed(n: number, over: Partial<OperationConfig> = {}) {
    h = await createHarness(dir);
    const rt = h.app.runtime;
    const accounts = Array.from({ length: n }, (_, i) =>
      rt.ctx.accounts.create({ label: `P${i + 1}`, providerId: 'manual', holderRef: `persona${i + 1}`, verification: 'VERIFIED' }, 't'),
    );
    const op = rt.ctx.ops.create(config(accounts.map((a) => a.id), h.clock.now(), over), 't');
    assert.ok((await rt.ctx.ops.command(op.id, { command: 'validate' }, 't')).ok);
    const arm = await rt.ctx.ops.command(op.id, { command: 'arm' }, 't');
    assert.ok(arm.ok, arm.message);
    await h.clock.advance(500);
    return { rt, op, accounts };
  }

  it('reparte en paralelo respetando el grupo mínimo (4 = 2 + 2, no 3 + 1)', async () => {
    const { rt, op, accounts } = await armed(2);
    try {
      for (const t of tasksOf(op.id, 'OPEN_SESSION')) rt.ctx.tasks.respond(t.id, { result: 'READY' }, 't');
      await h.clock.advance(61_000);
      assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING');
      const adds = tasksOf(op.id, 'ADD_TO_CART');
      assert.equal(adds.length, 2, 'las dos personas trabajan a la vez');
      assert.deepEqual(adds.map((t) => t.target?.qty).sort(), [2, 2]);
      assert.ok(accounts.every((a) => adds.some((t) => t.accountId === a.id)));
    } finally {
      await h.stop();
    }
  });

  it('«No pude» pasa a la siguiente zona al instante; la verificación fallida también', async () => {
    const { rt, op, accounts } = await armed(1, { requestedQty: 2 });
    try {
      const acc = accounts[0]?.id ?? '';
      rt.ctx.tasks.respond(tasksOf(op.id, 'OPEN_SESSION')[0]?.id ?? '', { result: 'READY' }, 't');
      await h.clock.advance(61_000);
      const first = tasksOf(op.id, 'ADD_TO_CART', acc)[0];
      assert.equal(first?.target?.sectionLabel, 'T3');
      rt.ctx.tasks.respond(first?.id ?? '', { result: 'FAILED' }, 't');
      // Sin avanzar el reloj: la siguiente llega en la misma respuesta.
      const second = tasksOf(op.id, 'ADD_TO_CART', acc)[0];
      assert.equal(second?.target?.sectionLabel, 'T4');
      // Nadie responde: la tarea caduca, se pide verificar y la verificación dice que no.
      await h.clock.advance(h.app.runtime.ctx.cfg.humanTaskDeadlineMs + 1000);
      const verify = tasksOf(op.id, 'VERIFY_CART', acc)[0];
      assert.ok(verify, 'se pide verificar');
      rt.ctx.tasks.respond(verify?.id ?? '', { result: 'FAILED' }, 't');
      const third = tasksOf(op.id, 'ADD_TO_CART', acc)[0];
      assert.equal(third?.target?.sectionLabel, 'Tribuna', 'tras «no está» también se pasa a la siguiente zona');
    } finally {
      await h.stop();
    }
  });

  it('un carrito confirmado por una persona no se da por perdido solo; «Liberar» reabre la operación', async () => {
    const { rt, op, accounts } = await armed(2);
    try {
      for (const t of tasksOf(op.id, 'OPEN_SESSION')) rt.ctx.tasks.respond(t.id, { result: 'READY' }, 't');
      await h.clock.advance(61_000);
      const [a1, a2] = tasksOf(op.id, 'ADD_TO_CART');
      rt.ctx.tasks.respond(a1?.id ?? '', { result: 'IN_CART', qty: 2, unitPrice: 9000, expiresAt: iso(h.clock.now() + 60_000) }, 't');
      rt.ctx.tasks.respond(a2?.id ?? '', { result: 'IN_CART', qty: 2, unitPrice: 9500, expiresAt: iso(h.clock.now() + 600_000) }, 't');
      await h.clock.advance(500);
      assert.equal(rt.ctx.ops.get(op.id).state, 'CART_SECURED');
      // Pasa la hora estimada del primer carrito.
      await h.clock.advance(90_000);
      const cart1 = [...rt.store.carts.values()].find((c) => c.accountId === a1?.accountId);
      assert.equal(cart1?.state, 'ACTIVE', 'no caduca solo: lo decide una persona');
      assert.ok([...rt.store.alerts.values()].some((al) => al.cartId === cart1?.id && al.state !== 'RESOLVED' && al.title.includes('¿lo has pagado?')));
      assert.equal(rt.store.allocations.get(op.id)?.cartedQty, 4, 'sigue contando');
      // Se perdió: «Liberar» → vuelve a EN MARCHA y la misma cuenta recibe tarea.
      rt.ctx.carts.mark(cart1?.id ?? '', 'RELEASED', 't');
      await h.clock.advance(500);
      assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING');
      assert.equal(rt.store.allocations.get(op.id)?.cartedQty, 2);
      const again = tasksOf(op.id, 'ADD_TO_CART', a1?.accountId);
      assert.equal(again.length, 1);
      assert.equal(again[0]?.target?.qty, 2);
      // El otro carrito se paga normalmente.
      const cart2 = [...rt.store.carts.values()].find((c) => c.accountId === a2?.accountId);
      assert.equal(rt.ctx.carts.mark(cart2?.id ?? '', 'PAID', 't').state, 'PAID');
    } finally {
      await h.stop();
    }
  });

  it('cada compra exige «Sesión lista» de nuevo y manda el plan', async () => {
    h = await createHarness(dir);
    const rt = h.app.runtime;
    try {
      const acc = rt.ctx.accounts.create({ label: 'Ana', providerId: 'manual', holderRef: 'ana', verification: 'VERIFIED' }, 't');
      rt.ctx.accounts.humanReady(acc.id, 'ensayo de ayer');
      assert.equal(rt.store.accounts.get(acc.id)?.session.state, 'READY');
      const op = rt.ctx.ops.create(config([acc.id], h.clock.now()), 't');
      await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
      await h.clock.advance(500);
      assert.equal(rt.store.accounts.get(acc.id)?.session.state, 'LOGGED_OUT');
      const task = tasksOf(op.id, 'OPEN_SESSION', acc.id)[0];
      assert.match(task?.instructions ?? '', /Plan: la venta abre a las/);
      // Desarmar cancela esa tarea (su plan ya no vale).
      await rt.ctx.ops.command(op.id, { command: 'disarm' }, 't');
      assert.equal(rt.store.humanTasks.get(task?.id ?? '')?.state, 'CANCELLED');
    } finally {
      await h.stop();
    }
  });

  it('parar UNA cuenta antes de T0 no cancela la operación del resto', async () => {
    const { rt, op, accounts } = await armed(2);
    try {
      for (const t of tasksOf(op.id, 'OPEN_SESSION')) rt.ctx.tasks.respond(t.id, { result: 'READY' }, 't');
      rt.ctx.safety.setKillSwitch('ACCOUNT', accounts[0]?.id ?? '', true, 'no viene', 't');
      await h.clock.advance(61_000);
      assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING');
      const adds = tasksOf(op.id, 'ADD_TO_CART');
      assert.ok(adds.length >= 1);
      assert.ok(adds.every((t) => t.accountId === accounts[1]?.id), 'solo trabaja la cuenta no parada');
    } finally {
      await h.stop();
    }
  });

  it('si alguien dijo «no sé» y otro responde «en carrito», vale para la verificación', async () => {
    const { rt, op } = await armed(1, { requestedQty: 2 });
    try {
      rt.ctx.tasks.respond(tasksOf(op.id, 'OPEN_SESSION')[0]?.id ?? '', { result: 'READY' }, 't');
      await h.clock.advance(61_000);
      const add = tasksOf(op.id, 'ADD_TO_CART')[0];
      rt.ctx.tasks.respond(add?.id ?? '', { result: 'UNKNOWN' }, 'chat-principal');
      assert.equal(tasksOf(op.id, 'VERIFY_CART').length, 1);
      const r = rt.ctx.tasks.respond(add?.id ?? '', { result: 'IN_CART', qty: 2, unitPrice: 9000 }, 'chat-personal');
      assert.equal(r.kind, 'VERIFY_CART', 'la respuesta se aplicó a la verificación');
      await h.clock.advance(300);
      assert.equal(rt.store.allocations.get(op.id)?.cartedQty, 2);
      assert.equal(rt.ctx.ops.get(op.id).state, 'CART_SECURED');
    } finally {
      await h.stop();
    }
  });
});
