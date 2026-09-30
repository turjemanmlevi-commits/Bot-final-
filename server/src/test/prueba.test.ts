/**
 * Prueba real con el Real Madrid en un clic (dashboard y /prueba en Telegram):
 * usa las cuentas del Real Madrid que ya hay, elige un partido de prueba a la venta
 * con cupo, arma la operación y el plan y las tareas llegan por Telegram.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import type { HumanTask, Id } from '@to/shared';
import { createHarness, manualConfig, type Harness } from '../gates/harness';
import { REAL_TEST_PREFIX, seedRealTest } from '../runtime/prueba';
import { TelegramNotifier } from '../telegram/telegram';
import { FakeTelegram, TOKEN, until } from './fake-telegram';

const VAULT = path.resolve(fileURLToPath(new URL('../../../vault', import.meta.url)));
/** 30-sep-2026: los partidos del femenino ya están a la venta; el baloncesto abre el 1-oct. */
const START = Date.parse('2026-09-30T13:00:00Z');
const PARIS = 'evt-real-madrid-femenino-paris-fc-women-s-champions-league-j4';
const INTER = 'evt-real-madrid-femenino-inter-women-s-champions-league-j5';
const CHAT = '6626060160';

function levi(h: Harness, telegramChatId: string | null = CHAT) {
  const rt = h.app.runtime;
  const rm = rt.ctx.accounts.create(
    { label: 'Morris Levi Turjeman', providerId: 'real-madrid', holderRef: 'Levi Turjeman', verification: 'VERIFIED', eligibility: ['*'], telegramChatId },
    't',
  );
  const tm = rt.ctx.accounts.create(
    { label: 'Morris Levi Turjeman', providerId: 'ticketmaster', holderRef: 'Levi Turjeman', verification: 'VERIFIED', eligibility: ['*'], telegramChatId },
    't',
  );
  return { rm, tm };
}

const openTasks = (h: Harness, op: Id, kind: HumanTask['kind']) =>
  [...h.app.runtime.store.humanTasks.values()].filter((t) => t.operationId === op && t.kind === kind && t.state === 'OPEN');

describe('prueba real con el Real Madrid', () => {
  it('sin cuenta del Real Madrid lo dice y no deja nada a medias', async () => {
    const h = await createHarness(VAULT, { start: START });
    try {
      await assert.rejects(seedRealTest(h.app.runtime), /No hay ninguna cuenta del Real Madrid/);
      assert.equal(h.app.runtime.store.operations.size, 0);
    } finally {
      await h.stop();
    }
  });

  it('arma con tus cuentas en un partido a la venta: plan, tarea a la hora y en carrito', async () => {
    const h = await createHarness(VAULT, { start: START });
    const rt = h.app.runtime;
    try {
      const { rm, tm } = levi(h);
      const r = await seedRealTest(rt, { startInSeconds: 120 });
      const op = rt.ctx.ops.get(r.operationId);
      assert.equal(op.state, 'ARMED');
      assert.equal(r.eventId, PARIS, 'primero un partido que ya está a la venta');
      assert.ok(op.config.name.startsWith(REAL_TEST_PREFIX));
      assert.deepEqual(op.config.accountIds, [rm.id], 'solo la cuenta del Real Madrid, no la de Ticketmaster');
      assert.equal(op.config.requestedQty, 1);
      assert.equal(r.t0, new Date(START + 120_000).toISOString());
      assert.equal(rt.store.accounts.get(tm.id)?.leasedBy, null);
      assert.match(r.message, /1 entrada/);
      assert.equal(r.telegram, false, 'sin bot conectado no promete mensajes aunque la cuenta tenga chat');
      assert.match(r.message, /Telegram no está conectado/);

      // Al armar: «Inicia sesión» con «Sesión lista». A la hora: la tarea de compra.
      const session = openTasks(h, op.id, 'OPEN_SESSION');
      assert.equal(session.length, 1);
      rt.ctx.tasks.respond(session[0]?.id ?? '', { result: 'READY' }, 't');
      await h.clock.advance(121_000);
      assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING');
      const buy = openTasks(h, op.id, 'ADD_TO_CART');
      assert.equal(buy.length, 1);
      assert.equal(buy[0]?.target?.qty, 1);
      assert.equal(buy[0]?.target?.sectionLabel, 'Tribuna', 'la 1ª preferencia del partido');
      assert.equal(buy[0]?.target?.maxUnitPrice, 6_000);

      rt.ctx.tasks.respond(buy[0]?.id ?? '', { result: 'IN_CART', qty: 1, unitPrice: 2_400 }, 't');
      await h.clock.advance(500);
      assert.equal(rt.ctx.ops.get(op.id).state, 'CART_SECURED');
    } finally {
      await h.stop();
    }
  });

  it('una prueba viva se para antes; la siguiente cierra la asegurada y va a otro partido con cupo', async () => {
    const h = await createHarness(VAULT, { start: START });
    const rt = h.app.runtime;
    try {
      const { rm } = levi(h);
      const first = await seedRealTest(rt, { startInSeconds: 60 });
      await assert.rejects(seedRealTest(rt), /Ya hay una prueba en marcha/);
      rt.ctx.tasks.respond(openTasks(h, first.operationId, 'OPEN_SESSION')[0]?.id ?? '', { result: 'READY' }, 't');
      await h.clock.advance(61_000);
      const buy = openTasks(h, first.operationId, 'ADD_TO_CART')[0];
      rt.ctx.tasks.respond(buy?.id ?? '', { result: 'IN_CART', qty: 1, unitPrice: 2_400 }, 't');
      await h.clock.advance(500);
      assert.equal(rt.ctx.ops.get(first.operationId).state, 'CART_SECURED');

      // El carrito del Paris FC ocupa el cupo (1 por persona): la nueva va al Inter.
      const second = await seedRealTest(rt);
      assert.equal(rt.ctx.ops.get(first.operationId).state, 'CLOSED', 'la asegurada se cierra sola');
      assert.equal([...rt.store.carts.values()].find((c) => c.operationId === first.operationId)?.state, 'ACTIVE', 'su carrito sigue para pagar o liberar');
      assert.equal(second.eventId, INTER);
      assert.deepEqual(rt.ctx.ops.get(second.operationId).config.accountIds, [rm.id]);

      // Parada (terminada) también se cierra sola; sin cupo en ninguno, lo dice.
      rt.ctx.tasks.respond(openTasks(h, second.operationId, 'OPEN_SESSION')[0]?.id ?? '', { result: 'READY' }, 't');
      await h.clock.advance(121_000);
      rt.ctx.tasks.respond(openTasks(h, second.operationId, 'ADD_TO_CART')[0]?.id ?? '', { result: 'IN_CART', qty: 1, unitPrice: 2_400 }, 't');
      await h.clock.advance(500);
      const third = await seedRealTest(rt);
      assert.notEqual(third.eventId, PARIS);
      assert.notEqual(third.eventId, INTER);
      assert.match(third.message, /la venta general de este partido abre el 1 de octubre/, 'avisa si aún no está a la venta');
      assert.ok((await rt.ctx.ops.command(third.operationId, { command: 'cancel' }, 't')).ok);
    } finally {
      await h.stop();
    }
  });

  it('no toca una cuenta que está en una compra de verdad', async () => {
    const h = await createHarness(VAULT, { start: START });
    const rt = h.app.runtime;
    try {
      const { rm } = levi(h);
      const base = manualConfig([rm.id], h.clock.now());
      const real = rt.ctx.ops.create(
        {
          ...base,
          name: 'Compra de verdad',
          eventId: INTER,
          providerId: 'real-madrid',
          requestedQty: 1,
          budget: 6_000,
          preferences: { ...base.preferences, targets: ['Tribuna'], requireContiguous: false, minGroupSize: 1 },
        },
        't',
      );
      const validated = await rt.ctx.ops.command(real.id, { command: 'validate' }, 't');
      assert.ok(validated.ok, validated.validation?.issues.map((i) => i.message).join(' · '));
      assert.ok((await rt.ctx.ops.command(real.id, { command: 'arm' }, 't')).ok);
      await assert.rejects(seedRealTest(rt), /están ocupadas: «Morris Levi Turjeman» está en «Compra de verdad»/);
      assert.equal(rt.ctx.ops.get(real.id).state, 'ARMED');
      assert.equal([...rt.store.operations.values()].length, 1);
    } finally {
      await h.stop();
    }
  });
});

describe('/prueba en Telegram', () => {
  let tg: FakeTelegram;
  let base = '';
  let h: Harness;
  let n: TelegramNotifier | null = null;

  before(async () => {
    tg = new FakeTelegram();
    base = await tg.listen();
    h = await createHarness(VAULT, { start: START });
  });
  after(async () => {
    n?.stop();
    await h.stop();
    await tg.close();
  });

  it('desde el chat principal arma la prueba y todo llega al chat: plan, tarea y «en carrito»', async () => {
    const rt = h.app.runtime;
    const { rm } = levi(h);
    n = new TelegramNotifier({ token: TOKEN, chatId: CHAT, apiBase: base, retryMs: 50 });
    rt.ctx.notifier = n;
    n.attach(rt);
    await until(() => n?.status().connected === true, 'conexión');

    // Otro chat no puede lanzarla.
    tg.message(777, '/prueba', 'Otro');
    const seen = tg.messagesTo(CHAT).length;
    tg.message(Number(CHAT), '/prueba', 'Levi');
    await until(() => tg.messagesTo(CHAT).slice(seen).some((t) => t.includes('🧪 Prueba armada')), 'confirmación de /prueba');
    const op = [...rt.store.operations.values()].find((o) => o.config.name.startsWith(REAL_TEST_PREFIX));
    assert.ok(op);
    assert.equal(op.state, 'ARMED');
    assert.ok(!tg.messagesTo('777').some((t) => t.includes('Prueba armada')));
    assert.ok(tg.messagesTo(CHAT).some((t) => t.includes('Te llega ahora el plan por Telegram')));
    // El plan con «✅ Sesión lista» llega al chat; se pulsa desde Telegram.
    const session = openTasks(h, op.id, 'OPEN_SESSION')[0];
    assert.ok(session);
    await until(() => tg.sent.some((s) => s.method === 'sendMessage' && JSON.stringify(s.body.reply_markup ?? '').includes(`t:${session.id}:READY`)), 'plan con Sesión lista');
    tg.push({ callback_query: { id: 'q1', data: `t:${session.id}:READY`, from: { id: Number(CHAT), username: 'levi' }, message: { chat: { id: Number(CHAT) }, message_id: 1 } } });
    await until(() => rt.store.accounts.get(rm.id)?.session.state === 'READY', 'sesión lista desde Telegram');

    // A la hora: «¡Abre la venta!» y la tarea con «✅ 1 en carrito».
    await h.clock.advance(121_000);
    const buy = openTasks(h, op.id, 'ADD_TO_CART')[0];
    assert.ok(buy);
    await until(() => tg.sent.some((s) => s.method === 'sendMessage' && JSON.stringify(s.body.reply_markup ?? '').includes(`t:${buy.id}:IN_CART:1`)), 'tarea de compra');
    assert.ok(tg.messagesTo(CHAT).some((t) => t.includes('¡Abre la venta!')));
    tg.push({ callback_query: { id: 'q2', data: `t:${buy.id}:IN_CART:1`, from: { id: Number(CHAT), username: 'levi' }, message: { chat: { id: Number(CHAT) }, message_id: 2 } } });
    await until(() => rt.store.humanTasks.get(buy.id)?.state === 'DONE', 'en carrito desde Telegram');
    await h.clock.advance(500);
    assert.equal(rt.ctx.ops.get(op.id).state, 'CART_SECURED');
    await until(() => tg.messagesTo(CHAT).some((t) => /aseguradas en carrito/.test(t)), '¡entradas aseguradas!');
  });
});
