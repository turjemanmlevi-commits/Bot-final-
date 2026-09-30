/**
 * Límites entre operaciones y zonas del runner manual: el cupo por cuenta y por
 * titular es del evento (se reparte entre sus operaciones), cada persona sigue
 * por su zona aunque la operación se pause, se reanude o el servidor se reinicie,
 * una operación asegurada que lo pierde todo con la ventana cerrada queda
 * finalizada y bajar el precio o la cantidad se avisa a las personas.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { HumanTask, Id, OperationConfig } from '@to/shared';
import { formatMoney } from '@to/shared';
import { writeFixtureVault } from '../gates/fixtures';
import { createHarness, type Harness } from '../gates/harness';
import { MemoryDriver } from '../store/drivers';
import { iso } from '../util/time';

const EVENT_A = 'evt-cupo-a';
const EVENT_B = 'evt-cupo-b';

/** Dos eventos del mismo proveedor manual con 2 entradas por cuenta y por titular. */
async function vaultWithTwoEvents(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'to-cupo-'));
  await writeFixtureVault(dir);
  for (const [id, name] of [
    [EVENT_A, 'Evento Cupo A'],
    [EVENT_B, 'Evento Cupo B'],
  ] as const) {
    await writeFile(
      path.join(dir, '20 Eventos', `${name}.md`),
      `---
type: event
id: ${id}
name: ${name}
venue: "[[Recinto Test]]"
provider: "[[Manual]]"
providerEventRef: ${id.toUpperCase()}
startsAt: 2027-01-01T21:00:00Z
currency: EUR
limitPerAccount: 2
limitPerGroup: 2
limitPerOperation: 12
limitSemantics: PER_HOLDER
limitsVerified: true
limitsSource: "fixture"
---
`,
      'utf8',
    );
  }
  return dir;
}

function config(name: string, eventId: Id, accountIds: Id[], t0: number, over: Partial<OperationConfig> = {}): OperationConfig {
  return {
    name,
    eventId,
    providerId: 'manual',
    t0: iso(t0),
    runWindowMinutes: 60,
    freezeLeadSeconds: 30,
    requestedQty: 2 * accountIds.length,
    currency: 'EUR',
    maxUnitPrice: 10_000,
    budget: 100_000,
    preferences: {
      targets: ['T3', 'T4', 'Tribuna'],
      excludeSections: [],
      requireContiguous: false,
      minGroupSize: 1,
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

let dir = '';
before(async () => {
  dir = await vaultWithTwoEvents();
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const person = (h: Harness, label: string, holderRef: string) =>
  h.app.runtime.ctx.accounts.create({ label, providerId: 'manual', holderRef, verification: 'VERIFIED' }, 't');

const openTasks = (h: Harness, kind: HumanTask['kind'], accountId?: Id) =>
  [...h.app.runtime.store.humanTasks.values()].filter((t) => t.kind === kind && t.state === 'OPEN' && (!accountId || t.accountId === accountId));

async function validate(h: Harness, cfg: OperationConfig) {
  const op = h.app.runtime.ctx.ops.create(cfg, 't');
  const v = await h.app.runtime.ctx.ops.command(op.id, { command: 'validate' }, 't');
  assert.ok(v.ok, v.validation?.issues.map((i) => i.message).join(' · '));
  return { op, issues: v.validation?.issues ?? [] };
}

async function armed(h: Harness, cfg: OperationConfig) {
  const { op } = await validate(h, cfg);
  const arm = await h.app.runtime.ctx.ops.command(op.id, { command: 'arm' }, 't');
  assert.ok(arm.ok, arm.validation?.issues.map((i) => i.message).join(' · ') ?? arm.message);
  return op;
}

/** Todas dicen «Sesión lista» y se llega a T0. */
async function toT0(h: Harness) {
  await h.clock.advance(500);
  for (const t of openTasks(h, 'OPEN_SESSION')) h.app.runtime.ctx.tasks.respond(t.id, { result: 'READY' }, 't');
  await h.clock.advance(61_000);
}

describe('el cupo por cuenta y por titular es del evento', () => {
  it('dos operaciones del mismo evento nunca dan a un titular más que su límite, ni armadas a la vez', async () => {
    const h = await createHarness(dir);
    const rt = h.app.runtime;
    try {
      const [ana1, ana2, ana3, bea] = [person(h, 'Ana socia', 'ana'), person(h, 'Ana madridista', 'ana'), person(h, 'Ana tercera', 'ana'), person(h, 'Bea', 'bea')];
      const t0 = h.clock.now() + 60_000;
      // La 1.ª, con 1 entrada por cuenta, retiene 1 de las 2 de Ana.
      const base = config('Grupo 1', EVENT_A, [ana1.id], t0);
      await armed(h, { ...base, preferences: { ...base.preferences, maxPerAccount: 1 } });

      // La 2.ª avisa al validar y arma con lo que le queda a Ana.
      const { op: op2, issues } = await validate(h, config('Grupo 2', EVENT_A, [ana2.id, bea.id], t0, { requestedQty: 3 }));
      const warn = issues.find((i) => i.code === 'EVENT_QUOTA_USED');
      assert.equal(warn?.severity, 'WARNING');
      assert.equal(warn?.message, 'Ana madridista: su titular ya tiene 1 de 2 entradas de este evento, compradas o reservadas en «Grupo 1»: aquí solo podrá comprar 1.');
      assert.ok((await rt.ctx.ops.command(op2.id, { command: 'arm' }, 't')).ok);
      assert.equal(rt.store.allocations.get(op2.id)?.perGroup['titular:ana']?.cap, 1, 'la asignación arranca con lo que queda');

      // Una 3.ª con otra cuenta de Ana ya no arma: error claro, con los nombres y sin ids.
      const { op: op3 } = await validate(h, config('Grupo 3', EVENT_A, [ana3.id], t0));
      const refused = await rt.ctx.ops.command(op3.id, { command: 'arm' }, 't');
      assert.equal(refused.ok, false);
      const err = refused.validation?.issues.find((i) => i.code === 'EVENT_QUOTA_USED');
      assert.equal(err?.severity, 'ERROR');
      assert.equal(
        err?.message,
        'Ana tercera: su titular ya tiene 2 de 2 entradas de este evento, compradas o reservadas en «Grupo 1», «Grupo 2»: no le queda cupo. Quítala de esta operación.',
      );

      // En T0 cada persona pone en el carrito lo que le toca: Ana suma 2 entre las dos operaciones.
      await toT0(h);
      const adds = openTasks(h, 'ADD_TO_CART');
      assert.equal(adds.length, 3);
      for (const t of adds) rt.ctx.tasks.respond(t.id, { result: 'IN_CART', qty: t.target?.qty ?? 0, unitPrice: 5_000 }, 't');
      const inCart = (ids: Id[]) => [...rt.store.carts.values()].filter((c) => ids.includes(c.accountId)).reduce((n, c) => n + c.qty, 0);
      assert.equal(inCart([ana1.id, ana2.id, ana3.id]), 2);
      assert.equal(inCart([bea.id]), 2);
      assert.deepEqual(h.violations, []);
    } finally {
      await h.stop();
    }
  });

  it('lo pagado en una operación ya cerrada cuenta para la siguiente; lo liberado o caducado no', async () => {
    const h = await createHarness(dir);
    const rt = h.app.runtime;
    try {
      const [bea, carla, dani] = [person(h, 'Bea', 'bea'), person(h, 'Carla', 'carla'), person(h, 'Dani', 'dani')];
      const op1 = await armed(h, config('Compra 1', EVENT_A, [bea.id, carla.id], h.clock.now() + 60_000));
      await toT0(h);
      const [t1, t2] = [openTasks(h, 'ADD_TO_CART', bea.id)[0], openTasks(h, 'ADD_TO_CART', carla.id)[0]];
      rt.ctx.tasks.respond(t1?.id ?? '', { result: 'IN_CART', qty: 1, unitPrice: 5_000 }, 't');
      rt.ctx.tasks.respond(t2?.id ?? '', { result: 'IN_CART', qty: 2, unitPrice: 5_000 }, 't');
      assert.ok((await rt.ctx.ops.command(op1.id, { command: 'stop' }, 't')).ok);
      assert.ok((await rt.ctx.ops.command(op1.id, { command: 'close', confirm: true }, 't')).ok);
      const cartOf = (accountId: Id) => [...rt.store.carts.values()].find((c) => c.accountId === accountId);
      rt.ctx.carts.mark(cartOf(bea.id)?.id ?? '', 'PAID', 't');
      rt.ctx.carts.mark(cartOf(carla.id)?.id ?? '', 'RELEASED', 't');
      // Un carrito leído de la web que caducó sin pagar.
      rt.ctx.carts.add({
        operationId: op1.id,
        accountId: dani.id,
        item: { claimId: null, sectionId: null, sectionLabel: 'T3', row: null, seats: [], qty: 2, unitPrice: 5_000 },
        level: 'READBACK',
        providerCartRef: 'ref',
        expiresAt: iso(h.clock.now() + 1000),
        openUrl: null,
        review: null,
      });
      await h.clock.advance(2000);
      assert.equal(cartOf(dani.id)?.state, 'EXPIRED');

      const { op: op2, issues } = await validate(h, config('Compra 2', EVENT_A, [bea.id, carla.id, dani.id], h.clock.now() + 60_000));
      assert.deepEqual(
        issues.filter((i) => i.code === 'EVENT_QUOTA_USED').map((i) => i.message),
        ['Bea: ya tiene 1 de 2 entradas de este evento, compradas o reservadas en «Compra 1»: aquí solo podrá comprar 1.'],
      );
      assert.ok((await rt.ctx.ops.command(op2.id, { command: 'arm' }, 't')).ok);
      const caps = rt.store.allocations.get(op2.id)?.perAccount;
      assert.deepEqual([caps?.[bea.id]?.cap, caps?.[carla.id]?.cap, caps?.[dani.id]?.cap], [1, 2, 2]);
    } finally {
      await h.stop();
    }
  });

  it('un «no sé» de otra operación ocupa el cupo hasta que se comprueba', async () => {
    const h = await createHarness(dir);
    const rt = h.app.runtime;
    try {
      const eva = person(h, 'Eva', 'eva');
      const op1 = await armed(h, config('Compra 1', EVENT_A, [eva.id], h.clock.now() + 60_000));
      await toT0(h);
      rt.ctx.tasks.respond(openTasks(h, 'ADD_TO_CART', eva.id)[0]?.id ?? '', { result: 'UNKNOWN' }, 't');
      assert.ok((await rt.ctx.ops.command(op1.id, { command: 'stop' }, 't')).ok);
      assert.ok((await rt.ctx.ops.command(op1.id, { command: 'close' }, 't')).ok);

      const { op: op2 } = await validate(h, config('Compra 2', EVENT_A, [eva.id], h.clock.now() + 60_000));
      const refused = await rt.ctx.ops.command(op2.id, { command: 'arm' }, 't');
      assert.equal(refused.ok, false);
      assert.equal(
        refused.validation?.issues.find((i) => i.code === 'EVENT_QUOTA_USED')?.message,
        'Eva: ya tiene 2 de 2 entradas de este evento, compradas o reservadas en «Compra 1»: no le queda cupo. Quítala de esta operación.',
      );
      // Se comprueba que no entraron: el cupo vuelve.
      rt.ctx.tasks.respond(openTasks(h, 'VERIFY_CART', eva.id)[0]?.id ?? '', { result: 'FAILED' }, 't');
      const arm = await rt.ctx.ops.command(op2.id, { command: 'arm' }, 't');
      assert.ok(arm.ok, arm.message);
      assert.equal(rt.store.allocations.get(op2.id)?.perAccount[eva.id]?.cap, 2);
    } finally {
      await h.stop();
    }
  });

  it('las operaciones de eventos distintos no se afectan', async () => {
    const h = await createHarness(dir);
    const rt = h.app.runtime;
    try {
      const [ana1, ana2] = [person(h, 'Ana socia', 'ana'), person(h, 'Ana madridista', 'ana')];
      await armed(h, config('Evento A', EVENT_A, [ana1.id], h.clock.now() + 60_000));
      await toT0(h);
      const t = openTasks(h, 'ADD_TO_CART', ana1.id)[0];
      rt.ctx.tasks.respond(t?.id ?? '', { result: 'IN_CART', qty: 2, unitPrice: 5_000 }, 't');

      const { op, issues } = await validate(h, config('Evento B', EVENT_B, [ana2.id], h.clock.now() + 60_000));
      assert.deepEqual(issues.filter((i) => i.code === 'EVENT_QUOTA_USED' || i.code === 'CAPACITY_SHORTFALL'), []);
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
      assert.equal(rt.store.allocations.get(op.id)?.perGroup['titular:ana']?.cap, 2);
    } finally {
      await h.stop();
    }
  });
});

describe('zona de cada persona en asistencia manual', () => {
  const zone = (h: Harness, accountId: Id) => openTasks(h, 'ADD_TO_CART', accountId)[0];

  it('pausar y reanudar no devuelve a nadie a una zona donde ya dijo «No pude»', async () => {
    const h = await createHarness(dir);
    const rt = h.app.runtime;
    try {
      const eva = person(h, 'Eva', 'eva');
      const op = await armed(h, config('Zonas', EVENT_A, [eva.id], h.clock.now() + 60_000));
      await toT0(h);
      assert.equal(zone(h, eva.id)?.target?.sectionLabel, 'T3');
      rt.ctx.tasks.respond(zone(h, eva.id)?.id ?? '', { result: 'FAILED' }, 't');
      assert.equal(zone(h, eva.id)?.target?.sectionLabel, 'T4');
      // Con la operación en pausa dice que en T4 tampoco hay: al reanudar le toca Tribuna.
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'pause' }, 't')).ok);
      rt.ctx.tasks.respond(zone(h, eva.id)?.id ?? '', { result: 'FAILED' }, 't');
      assert.equal(zone(h, eva.id), undefined, 'en pausa no hay tareas nuevas');
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'resume' }, 't')).ok);
      await h.clock.advance(300);
      assert.equal(zone(h, eva.id)?.target?.sectionLabel, 'Tribuna');
    } finally {
      await h.stop();
    }
  });

  it('tras un reinicio del servidor cada persona sigue por su zona', async () => {
    const driver = new MemoryDriver();
    const h1 = await createHarness(dir, { driver });
    const eva = person(h1, 'Eva', 'eva');
    const op = await armed(h1, config('Zonas', EVENT_A, [eva.id], h1.clock.now() + 60_000));
    await toT0(h1);
    h1.app.runtime.ctx.tasks.respond(zone(h1, eva.id)?.id ?? '', { result: 'FAILED' }, 't');
    assert.equal(zone(h1, eva.id)?.target?.sectionLabel, 'T4');
    await h1.stop();

    const h2 = await createHarness(dir, { driver, start: h1.clock.now() + 1000 });
    try {
      const rt = h2.app.runtime;
      rt.ctx.tasks.respond(zone(h2, eva.id)?.id ?? '', { result: 'FAILED' }, 't');
      await h2.clock.advance(1000);
      assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING');
      assert.equal(zone(h2, eva.id)?.target?.sectionLabel, 'Tribuna');
    } finally {
      await h2.stop();
    }
  });
});

describe('fin de la ventana', () => {
  it('si se pierden todos los carritos con la ventana ya cerrada, queda finalizada y no «asegurada» con 0', async () => {
    const h = await createHarness(dir);
    const rt = h.app.runtime;
    try {
      const [bea, carla] = [person(h, 'Bea', 'bea'), person(h, 'Carla', 'carla')];
      const op = await armed(h, config('Ventana corta', EVENT_A, [bea.id, carla.id], h.clock.now() + 60_000, { runWindowMinutes: 1 }));
      await toT0(h);
      for (const t of openTasks(h, 'ADD_TO_CART')) rt.ctx.tasks.respond(t.id, { result: 'IN_CART', qty: t.target?.qty ?? 0, unitPrice: 5_000 }, 't');
      assert.equal(rt.ctx.ops.get(op.id).state, 'CART_SECURED');
      await h.clock.advance(60_000);
      const [c1, c2] = [...rt.store.carts.values()].filter((c) => c.operationId === op.id);
      rt.ctx.carts.mark(c1?.id ?? '', 'RELEASED', 't');
      assert.equal(rt.ctx.ops.get(op.id).state, 'CART_SECURED', 'aún quedan entradas en carrito');
      assert.equal(rt.store.allocations.get(op.id)?.cartedQty, 2);
      rt.ctx.carts.mark(c2?.id ?? '', 'RELEASED', 't');
      const r = rt.ctx.ops.get(op.id);
      assert.equal(r.state, 'ENDED');
      assert.equal(r.endReason, 'RUN_WINDOW_ELAPSED');
      assert.ok([...rt.store.alerts.values()].some((a) => a.kind === 'OPERATION_ENDED' && a.operationId === op.id && a.title === 'Ventana corta: finalizada (0/4)'));
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'close' }, 't')).ok);
    } finally {
      await h.stop();
    }
  });
});

describe('enmiendas', () => {
  it('bajar el precio máximo o la cantidad antes de T0 avisa a las personas con el plan nuevo', async () => {
    const h = await createHarness(dir);
    const rt = h.app.runtime;
    const told: Array<{ text: string; accountIds: Id[] }> = [];
    rt.ctx.notifier = {
      enabled: true,
      connected: true,
      detail: '',
      notifyAlert: () => undefined,
      notifyTask: () => undefined,
      announce: (text, accountIds) => void told.push({ text, accountIds }),
    };
    try {
      const [bea, carla] = [person(h, 'Bea', 'bea'), person(h, 'Carla', 'carla')];
      const op = await armed(h, config('Plan', EVENT_A, [bea.id, carla.id], h.clock.now() + 60_000, { maxUnitPrice: 8_000 }));
      await h.clock.advance(500);
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'lower-max-price', value: 6_000 }, 't')).ok);
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'reduce-qty', value: 2 }, 't')).ok);
      const changed = told.filter((x) => x.text.includes('Plan: plan cambiado'));
      assert.deepEqual(
        changed.map((x) => x.text.split('\n')[1]),
        [
          `Precio máximo: ${formatMoney(6_000, 'EUR')} por entrada con gastos (antes ${formatMoney(8_000, 'EUR')}). No pongáis en el carrito nada más caro.`,
          'Ahora se compran 2 entradas en total (antes 4).',
        ],
      );
      assert.ok(changed.every((x) => [...x.accountIds].sort().join() === [bea.id, carla.id].sort().join()), 'a todas las personas de la operación');
      // En T0 las tareas llegan con el plan nuevo.
      await toT0(h);
      const adds = openTasks(h, 'ADD_TO_CART');
      assert.deepEqual(adds.map((t) => t.target?.maxUnitPrice), [6_000]);
      assert.equal(adds.reduce((n, t) => n + (t.target?.qty ?? 0), 0), 2);
    } finally {
      await h.stop();
    }
  });
});
