/**
 * Operaciones, seguridad y API: kill switch antes de T0, avisos a las personas
 * al pausar, «entrad ya» sin repetir, alertas de carrito, cierre con carritos
 * por pagar, demo, cuentas de otra operación, datos personales, mensajes de
 * error en castellano y compresión de las respuestas.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { Alert, HumanTask, Id, OperationConfig } from '@to/shared';
import { AccountInputSchema } from '@to/shared';
import { writeFixtureVault } from '../gates/fixtures';
import { createHarness, manualConfig, type Harness } from '../gates/harness';
import { createHttpApp } from '../http/app';
import type { Notifier } from '../runtime/context';
import { DEMO_MANUAL_EVENT, seedDemo } from '../runtime/demo';
import { MemoryDriver } from '../store/drivers';
import { iso } from '../util/time';

const MIN = 60_000;
/** El «🚦 ¡Abre la venta!» de T0. */
const OPENING = /🚦 <b>¡Abre la venta!/;
const VAULT = path.resolve(fileURLToPath(new URL('../../../vault', import.meta.url)));

/** Telegram de mentira: guarda los avisos a las personas y las alertas. */
function recorder() {
  const announced: Array<{ text: string; accountIds: Id[] }> = [];
  const alerts: Alert[] = [];
  const notifier: Notifier = {
    enabled: true,
    connected: true,
    detail: '',
    notifyAlert: (a: Alert) => void alerts.push(a),
    notifyTask: (_t: HumanTask) => undefined,
    announce: (text, accountIds) => void announced.push({ text, accountIds }),
  };
  return { notifier, announced, alerts };
}

let dir = '';
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'to-ops-'));
  await writeFixtureVault(dir);
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Operación manual armada (T0 en 1 min) con `n` cuentas y la sesión lista. */
async function armedManual(h: Harness, n: number, over: Partial<OperationConfig> = {}) {
  const rt = h.app.runtime;
  const accounts = Array.from({ length: n }, (_, i) =>
    rt.ctx.accounts.create({ label: `Persona ${i + 1}`, providerId: 'manual', holderRef: `persona${i + 1}`, verification: 'VERIFIED' }, 't'),
  );
  const base = manualConfig(accounts.map((a) => a.id), h.clock.now());
  // 2 entradas por cuenta: todas trabajan a la vez.
  const op = rt.ctx.ops.create({ ...base, requestedQty: 2 * n, preferences: { ...base.preferences, maxPerAccount: 2 }, ...over }, 't');
  assert.ok((await rt.ctx.ops.command(op.id, { command: 'validate' }, 't')).ok);
  const armed = await rt.ctx.ops.command(op.id, { command: 'arm' }, 't');
  assert.ok(armed.ok, armed.message);
  await h.clock.advance(500);
  for (const t of [...rt.store.humanTasks.values()]) {
    if (t.operationId === op.id && t.kind === 'OPEN_SESSION' && t.state === 'OPEN') rt.ctx.tasks.respond(t.id, { result: 'READY' }, 't');
  }
  return { rt, op, accounts };
}

const openTasks = (h: Harness, op: Id, kind: HumanTask['kind'], accountId?: Id) =>
  [...h.app.runtime.store.humanTasks.values()].filter((t) => t.operationId === op && t.kind === kind && t.state === 'OPEN' && (!accountId || t.accountId === accountId));

describe('kill switch y pausa en asistencia manual', () => {
  it('kill switch global antes de T0: la operación queda retenida en pausa (no termina) y se reanuda al soltarlo', async () => {
    const h = await createHarness(dir);
    const tg = recorder();
    h.app.runtime.ctx.notifier = tg.notifier;
    try {
      const { rt, op } = await armedManual(h, 2);
      rt.ctx.safety.setKillSwitch('GLOBAL', null, true, 'revisar precios', 't');
      await h.clock.advance(61_000);
      const held = rt.ctx.ops.get(op.id);
      assert.equal(held.state, 'PAUSED', `en T0 no termina: ${held.state} (${held.endReason})`);
      assert.equal(held.endReason, null);
      assert.equal(held.pausedReason, 'KILL_SWITCH global');
      assert.equal(openTasks(h, op.id, 'ADD_TO_CART').length, 0, 'con el kill switch activo no se reparte nada');
      assert.ok(tg.announced.some((a) => /retenida en T0/.test(a.text) && a.accountIds.length === 2), 'se avisa a las personas de que no compren');
      assert.ok(!tg.announced.some((a) => OPENING.test(a.text)));

      assert.equal((await rt.ctx.ops.command(op.id, { command: 'resume' }, 't')).ok, false, 'no se reanuda con el kill switch activo');
      await h.clock.advance(5000);
      assert.equal(openTasks(h, op.id, 'ADD_TO_CART').length, 0);

      rt.ctx.safety.setKillSwitch('GLOBAL', null, false, null, 't');
      const resumed = await rt.ctx.ops.command(op.id, { command: 'resume' }, 't');
      assert.ok(resumed.ok, resumed.message);
      assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING');
      assert.equal(openTasks(h, op.id, 'ADD_TO_CART').length, 2, 'al reanudar llegan las tareas');
      assert.ok(tg.announced.some((a) => OPENING.test(a.text)), 'y el «¡Abre la venta!» que no salió en T0');
    } finally {
      await h.stop();
    }
  });

  it('pausar avisa a las personas; en pausa no hay tareas nuevas y al reanudar se les dice que sigan', async () => {
    const h = await createHarness(dir);
    const tg = recorder();
    h.app.runtime.ctx.notifier = tg.notifier;
    try {
      const { rt, op, accounts } = await armedManual(h, 2);
      await h.clock.advance(61_000);
      assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING');
      const acc = accounts[0]?.id ?? '';
      const first = openTasks(h, op.id, 'ADD_TO_CART', acc)[0];
      assert.ok(first);

      assert.ok((await rt.ctx.ops.command(op.id, { command: 'pause', reason: 'precio mal puesto' }, 't')).ok);
      const stop = tg.announced.find((a) => /EN PAUSA/.test(a.text));
      assert.ok(stop, 'aviso de pausa por Telegram');
      assert.match(stop.text, /precio mal puesto/);
      assert.deepEqual([...stop.accountIds].sort(), accounts.map((a) => a.id).sort());

      rt.ctx.tasks.respond(first.id, { result: 'FAILED' }, 't');
      await h.clock.advance(3000);
      assert.equal(openTasks(h, op.id, 'ADD_TO_CART', acc).length, 0, 'en pausa no se crean tareas nuevas');

      assert.ok((await rt.ctx.ops.command(op.id, { command: 'resume' }, 't')).ok);
      assert.ok(tg.announced.some((a) => /seguimos/.test(a.text)), 'al reanudar se les dice que sigan');
      assert.ok(!tg.announced.some((a) => OPENING.test(a.text) && tg.announced.indexOf(a) > tg.announced.indexOf(stop)), 'no se repite «¡Abre la venta!»');
      await h.clock.advance(500);
      assert.equal(openTasks(h, op.id, 'ADD_TO_CART', acc).length, 1, 'y vuelve a tener tarea');
    } finally {
      await h.stop();
    }
  });

  it('parar una cuenta con una tarea de compra abierta avisa a esa persona, con su nombre y no con su id', async () => {
    const h = await createHarness(dir);
    const tg = recorder();
    h.app.runtime.ctx.notifier = tg.notifier;
    try {
      const { rt, op, accounts } = await armedManual(h, 2);
      await h.clock.advance(61_000);
      const acc = accounts[1];
      assert.ok(acc && openTasks(h, op.id, 'ADD_TO_CART', acc.id).length === 1);
      rt.ctx.safety.setKillSwitch('ACCOUNT', acc.id, true, 'se ha ido', 't');
      const msg = tg.announced.find((a) => /parada/.test(a.text));
      assert.ok(msg, 'Telegram a la persona');
      assert.deepEqual(msg.accountIds, [acc.id]);
      assert.match(msg.text, /Persona 2/);
      const alert = tg.alerts.find((a) => a.kind === 'KILL_SWITCH');
      assert.equal(alert?.title, 'Kill switch de la cuenta «Persona 2» activado');
      assert.ok(!alert?.title.includes(acc.id));
      assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING', 'la operación sigue con las demás');
    } finally {
      await h.stop();
    }
  });
});

describe('avisos «entrad ya»', () => {
  const reminders = (announced: Array<{ text: string }>) => announced.filter((a) => /Entrad YA en la web oficial/.test(a.text));

  it('se desarma y se rearma con otro T0 (venta aplazada): salen los avisos de la nueva hora', async () => {
    const h = await createHarness(dir);
    const tg = recorder();
    h.app.runtime.ctx.notifier = tg.notifier;
    try {
      const rt = h.app.runtime;
      const accounts = [1, 2].map((i) => rt.ctx.accounts.create({ label: `Cuenta ${i}`, providerId: 'manual', holderRef: `p${i}`, verification: 'VERIFIED' }, 't'));
      const cfg = { ...manualConfig(accounts.map((a) => a.id), h.clock.now()), t0: iso(h.clock.now() + 40 * MIN) };
      const op = rt.ctx.ops.create(cfg, 't');
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'validate' }, 't')).ok);
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
      await h.clock.advance(11 * MIN); // T−29
      assert.equal(reminders(tg.announced).length, 1, 'aviso T−30 de la hora original');

      assert.ok((await rt.ctx.ops.command(op.id, { command: 'disarm' }, 't')).ok);
      const newT0 = h.clock.now() + 2 * 60 * MIN + 29 * MIN;
      rt.ctx.ops.updateConfig(op.id, { ...cfg, t0: iso(newT0) }, 't', 'venta aplazada');
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'validate' }, 't')).ok);
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
      await h.clock.advance(newT0 - 29 * MIN - h.clock.now()); // nuevo T−29
      assert.equal(reminders(tg.announced).length, 2, 'aviso T−30 del nuevo T0');
    } finally {
      await h.stop();
    }
  });

  it('no se repiten tras un reinicio del servidor', async () => {
    const driver = new MemoryDriver();
    const h1 = await createHarness(dir, { driver });
    const tg1 = recorder();
    h1.app.runtime.ctx.notifier = tg1.notifier;
    const rt = h1.app.runtime;
    const accounts = [1, 2, 3].map((i) => rt.ctx.accounts.create({ label: `Cuenta ${i}`, providerId: 'manual', holderRef: `p${i}`, verification: 'VERIFIED' }, 't'));
    const t0 = h1.clock.now() + 12 * MIN;
    const op = rt.ctx.ops.create({ ...manualConfig(accounts.map((a) => a.id), h1.clock.now()), t0: iso(t0) }, 't');
    assert.ok((await rt.ctx.ops.command(op.id, { command: 'validate' }, 't')).ok);
    assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
    await h1.clock.advance(1000);
    assert.equal(reminders(tg1.announced).length, 1, '«Faltan 12 min» al armar');
    await h1.stop();

    // Reinicio: mismo journal, un minuto después.
    const h2 = await createHarness(dir, { driver, start: h1.clock.now() + MIN });
    const tg2 = recorder();
    h2.app.runtime.ctx.notifier = tg2.notifier;
    try {
      assert.equal(h2.app.runtime.ctx.ops.get(op.id).state, 'ARMED');
      await h2.clock.advance(5000);
      assert.equal(reminders(tg2.announced).length, 0, 'el aviso ya enviado no se repite');
      await h2.clock.advance(t0 - 10 * MIN - h2.clock.now() + 1000);
      assert.equal(reminders(tg2.announced).length, 1, 'el de T−10 sí llega');
    } finally {
      await h2.stop();
    }
  });
});

describe('carritos', () => {
  it('la alerta «N entradas en carrito» se resuelve al pagar, liberar o caducar el carrito', async () => {
    const h = await createHarness(dir);
    try {
      const { rt, op } = await armedManual(h, 2);
      await h.clock.advance(61_000);
      const [a1, a2] = openTasks(h, op.id, 'ADD_TO_CART');
      rt.ctx.tasks.respond(a1?.id ?? '', { result: 'IN_CART', qty: 2, unitPrice: 5000 }, 't');
      rt.ctx.tasks.respond(a2?.id ?? '', { result: 'IN_CART', qty: 2, unitPrice: 5500 }, 't');
      const carts = [...rt.store.carts.values()].filter((c) => c.operationId === op.id);
      assert.equal(carts.length, 2);
      const confirmed = (cartId: Id) => [...rt.store.alerts.values()].find((a) => a.kind === 'CART_CONFIRMED' && a.cartId === cartId);
      assert.equal(confirmed(carts[0]?.id ?? '')?.state, 'OPEN');
      rt.ctx.carts.mark(carts[0]?.id ?? '', 'PAID', 't');
      assert.equal(confirmed(carts[0]?.id ?? '')?.state, 'RESOLVED', 'pagado');
      rt.ctx.carts.mark(carts[1]?.id ?? '', 'RELEASED', 't');
      assert.equal(confirmed(carts[1]?.id ?? '')?.state, 'RESOLVED', 'liberado');

      // Un carrito leído de la web (no confirmado por una persona) caduca solo.
      const expiring = rt.ctx.carts.add({
        operationId: op.id,
        accountId: carts[0]?.accountId ?? '',
        item: { claimId: null, sectionId: null, sectionLabel: 'T3', row: null, seats: [], qty: 1, unitPrice: 5000 },
        level: 'READBACK',
        providerCartRef: 'ref',
        expiresAt: iso(h.clock.now() + 2000),
        openUrl: null,
        review: null,
      });
      assert.equal(confirmed(expiring.id)?.state, 'OPEN');
      await h.clock.advance(3000);
      assert.equal(rt.store.carts.get(expiring.id)?.state, 'EXPIRED');
      assert.equal(confirmed(expiring.id)?.state, 'RESOLVED', 'caducado');
      assert.equal([...rt.store.alerts.values()].find((a) => a.kind === 'CART_EXPIRED' && a.cartId === expiring.id)?.state, 'OPEN', 'queda el aviso de que caducó');
    } finally {
      await h.stop();
    }
  });

  it('cerrar con carritos por pagar pide confirmación explícita', async () => {
    const h = await createHarness(dir);
    try {
      const { rt, op } = await armedManual(h, 2);
      await h.clock.advance(61_000);
      const [a1] = openTasks(h, op.id, 'ADD_TO_CART');
      rt.ctx.tasks.respond(a1?.id ?? '', { result: 'IN_CART', qty: 2, unitPrice: 5000 }, 't');
      assert.ok((await rt.ctx.ops.command(op.id, { command: 'stop' }, 't')).ok);
      const refused = await rt.ctx.ops.command(op.id, { command: 'close' }, 't');
      assert.equal(refused.ok, false);
      assert.equal(refused.needsConfirm, true);
      assert.match(refused.message, /1 carrito por pagar: Persona \d \(2\)/);
      assert.equal(rt.ctx.ops.get(op.id).state, 'ENDED');
      const closed = await rt.ctx.ops.command(op.id, { command: 'close', confirm: true }, 't');
      assert.ok(closed.ok, closed.message);
      assert.equal(rt.ctx.ops.get(op.id).state, 'CLOSED');
    } finally {
      await h.stop();
    }
  });
});

describe('validación', () => {
  it('una cuenta de otra operación: aviso al validar y error al armar, con el nombre de esa operación', async () => {
    const h = await createHarness(dir);
    try {
      const { rt, op, accounts } = await armedManual(h, 1, { name: 'Real Madrid - Villarreal' });
      const other = rt.ctx.ops.create({ ...manualConfig(accounts.map((a) => a.id), h.clock.now()), name: 'Otra', requestedQty: 2 }, 't');
      const v = await rt.ctx.ops.command(other.id, { command: 'validate' }, 't');
      assert.ok(v.ok, 'solo es un aviso');
      const warn = v.validation?.issues.find((i) => i.code === 'ACCOUNT_LEASED');
      assert.equal(warn?.severity, 'WARNING');
      assert.match(warn?.message ?? '', /Persona 1: la está usando otra operación \(«Real Madrid - Villarreal»\)/);
      const armed = await rt.ctx.ops.command(other.id, { command: 'arm' }, 't');
      assert.equal(armed.ok, false);
      const err = armed.validation?.issues.find((i) => i.code === 'ACCOUNT_LEASED');
      assert.equal(err?.severity, 'ERROR');
      assert.match(err?.message ?? '', /«Real Madrid - Villarreal»/);
      assert.ok(!err?.message.includes(op.id), 'sin el id de la operación');
    } finally {
      await h.stop();
    }
  });

  it('rechaza teléfonos, tarjetas y emails aunque lleven paréntesis o barras, también en el nombre visible', () => {
    const ok = { label: 'Ana · principal', providerId: 'manual', holderRef: 'ana' };
    const bad: Array<Record<string, string>> = [
      { holderRef: '(612) 345-678' },
      { holderRef: '612/345/678' },
      { holderRef: '+34 (612) 34 56 78' },
      { paymentRef: '4111/1111/1111/1111' },
      { label: 'ana.garcia@gmail.com' },
      { label: 'Ana 612345678' },
      { label: 'Ana (612) 345 678' },
    ];
    for (const b of bad) assert.equal(AccountInputSchema.safeParse({ ...ok, ...b }).success, false, JSON.stringify(b));
    for (const label of ['Ana · principal', 'Fer (manual)', 'Grupo 2026', 'Eva 3']) {
      assert.ok(AccountInputSchema.safeParse({ ...ok, label }).success, label);
    }
    assert.ok(AccountInputSchema.safeParse({ ...ok, householdRef: 'casa-2026', paymentRef: 'tarjeta-ana' }).success);
  });
});

describe('demo', () => {
  it('un escenario inexistente no crea nada; la demo no tiene aviso de presupuesto y no acumula «Demo manual»', async () => {
    const h = await createHarness(VAULT);
    h.humanSolvesChallenges();
    try {
      const rt = h.app.runtime;
      await assert.rejects(seedDemo(rt, { scenarioId: 'inexistente' }), /Escenario desconocido: «inexistente»/);
      assert.equal(rt.store.operations.size, 0, 'sin operación huérfana');
      assert.equal(rt.store.accounts.size, 0);

      for (let i = 0; i < 3; i++) {
        const demo = await seedDemo(rt, { startInSeconds: 20, scenarioId: 'tranquilo', seed: i + 1 });
        const issues = rt.ctx.ops.get(demo.operationId).validation?.issues ?? [];
        assert.deepEqual(issues.filter((x) => x.code.startsWith('BUDGET')), [], 'el presupuesto cubre las 8 entradas');
        await h.clock.runUntil(() => ['CART_SECURED', 'ENDED'].includes(rt.ctx.ops.get(demo.operationId).state), 15 * MIN);
      }
      const manual = [...rt.store.operations.values()].filter((r) => r.config.eventId === DEMO_MANUAL_EVENT);
      assert.equal(manual.length, 3);
      assert.equal(manual.filter((r) => r.state === 'VALIDATED').length, 1, 'una sola «Demo manual» pendiente');
      assert.equal(manual.filter((r) => r.state === 'CANCELLED').length, 2);
    } finally {
      await h.stop();
    }
  });
});

describe('API HTTP', () => {
  let h: Harness;
  let dist = '';
  const bigJs = `console.log(${JSON.stringify('dashboard '.repeat(5000))});\n`;
  before(async () => {
    h = await createHarness(dir);
    dist = await mkdtemp(path.join(tmpdir(), 'to-dist-'));
    await mkdir(path.join(dist, 'assets'));
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
    await writeFile(path.join(dist, 'assets', 'app.js'), bigJs);
  });
  after(async () => {
    await h.stop();
    await rm(dist, { recursive: true, force: true });
  });
  const http = () => createHttpApp(h.app, { dashboardDist: dist, operatorToken: null });
  const JSON_HEADERS = { 'content-type': 'application/json' };

  it('los errores de los formularios salen en castellano y con el nombre del campo', async () => {
    const acc = await http().request('/api/accounts', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ label: 'x'.repeat(61), providerId: 'manual', holderRef: 'ana' }) });
    assert.equal(acc.status, 400);
    assert.equal(((await acc.json()) as { error: { message: string } }).error.message, 'Nombre visible: máximo 60 caracteres');

    const cfg = manualConfig([], h.clock.now());
    const op = await http().request('/api/operations', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...cfg, name: 'n'.repeat(130), cartExpiryAlertsSeconds: [300, 240, 180, 120, 90, 60, 45, 30, 20, 10, 5] }),
    });
    assert.equal(op.status, 400);
    const message = ((await op.json()) as { error: { message: string } }).error.message;
    assert.match(message, /Nombre de la operación: máximo 120 caracteres/);
    assert.match(message, /Avisar antes de que caduque un carrito: como mucho 10 valores/);
    assert.doesNotMatch(message, /Too big|expected/);

    const task = await http().request('/api/human-tasks/x/respond', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ result: 'IN_CART', qty: 1.5 }) });
    assert.equal(((await task.json()) as { error: { message: string } }).error.message, 'Cantidad: tiene que ser un número entero');
  });

  it('comprime el dashboard y la API con gzip, pero no el stream en tiempo real', async () => {
    const js = await http().request('/assets/app.js', { headers: { 'accept-encoding': 'gzip, deflate, br' } });
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('content-encoding'), 'gzip');
    const raw = Buffer.from(await js.arrayBuffer());
    assert.ok(raw.length < bigJs.length / 10, `comprimido: ${raw.length} B`);
    assert.equal(gunzipSync(raw).toString('utf8'), bigJs);

    const state = await http().request('/api/state', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(state.headers.get('content-encoding'), 'gzip');
    assert.ok(JSON.parse(gunzipSync(Buffer.from(await state.arrayBuffer())).toString('utf8')));
    const plain = await http().request('/api/state');
    assert.equal(plain.headers.get('content-encoding'), null, 'sin Accept-Encoding, sin comprimir');

    const stream = await http().request('/api/stream', { headers: { 'accept-encoding': 'gzip' } });
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.equal(stream.headers.get('content-encoding'), null);
    const reader = stream.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /^event: hello/);
    await reader.cancel();
  });
});
