/**
 * Bot de Telegram contra un servidor local que imita la Bot API: detección del
 * chat ID, comandos, tareas con botones, chats no autorizados y mensaje de prueba.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createHarness, manualConfig, type Harness } from '../gates/harness';
import { writeFixtureVault } from '../gates/fixtures';
import { TelegramNotifier } from '../telegram/telegram';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FakeTelegram, TOKEN, until } from './fake-telegram';

describe('Telegram', () => {
  let tg: FakeTelegram;
  let base = '';
  let dir = '';
  let h: Harness;
  const notifiers: TelegramNotifier[] = [];

  before(async () => {
    tg = new FakeTelegram();
    base = await tg.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-tg-'));
    await writeFixtureVault(dir);
    h = await createHarness(dir);
  });

  after(async () => {
    for (const n of notifiers) n.stop();
    await h.stop();
    await tg.close();
    await rm(dir, { recursive: true, force: true });
  });

  const start = (chatId: string | null, token = TOKEN) => {
    const n = new TelegramNotifier({ token, chatId, apiBase: base, retryMs: 50 });
    notifiers.push(n);
    h.app.runtime.ctx.notifier = n;
    n.attach(h.app.runtime);
    return n;
  };

  it('sin chat configurado, responde a /start con el chat ID y lo muestra en el estado', async () => {
    const n = start(null);
    await until(() => n.status().bot === 'orquestador_prueba_bot', 'getMe');
    assert.equal(n.status().mainChatConfigured, false);
    assert.match(n.status().detail, /Falta el chat principal/);
    tg.message(555, '/start', 'Levi');
    await until(() => tg.messagesTo('555').length > 0, 'respuesta a /start');
    assert.match(tg.messagesTo('555')[0] ?? '', /<code>555<\/code>/);
    assert.match(tg.messagesTo('555')[0] ?? '', /Ajustes · Telegram/);
    const seen = n.status().recentChats.find((c) => c.chatId === '555');
    assert.equal(seen?.name, 'Levi');
    assert.equal(seen?.known, false);
    const test = await n.sendTest();
    assert.equal(test.ok, false, 'sin chat principal no hay a quién enviar la prueba');
    n.stop();
  });

  it('con chat principal: comandos, tareas con botones y chats no autorizados', async () => {
    const n = start('555');
    await until(() => n.status().connected, 'conexión');
    assert.equal(n.status().mainChatConfigured, true);
    const test = await n.sendTest();
    assert.equal(test.ok, true, test.message);
    assert.ok(tg.messagesTo('555').some((t) => /Prueba de la sala de control/.test(t)));
    assert.equal((await n.sendTest('404')).message.includes('no deja escribir al chat 404'), true);

    const before = tg.messagesTo('555').length;
    tg.message(555, '/estado');
    await until(() => tg.messagesTo('555').slice(before).some((t) => /No hay operaciones activas/.test(t)), 'respuesta a /estado');

    // Tarea para la cuenta de Bea, que tiene su propio chat.
    const rt = h.app.runtime;
    const bea = rt.ctx.accounts.create({ label: 'Bea', providerId: 'manual', holderRef: 'bea', verification: 'VERIFIED', telegramChatId: '777' }, 't');
    const task = rt.ctx.tasks.create({ operationId: null, accountId: bea.id, kind: 'OPEN_SESSION', title: 'Inicia sesión', instructions: 'Entra en la web oficial.', link: 'https://www.ticketmaster.es/' });
    const isTask = (t: string) => t.includes('<b>Inicia sesión</b>');
    await until(() => tg.messagesTo('777').some(isTask) && tg.messagesTo('555').some(isTask), 'tarea en ambos chats');
    // Al vincular la cuenta, Bea recibió la bienvenida con cómo responder rápido.
    assert.ok(tg.messagesTo('777').some((t) => t.includes('Este chat es el de la cuenta «Bea»') && t.includes('Cómo ir rápido')));
    const msg = tg.sent.find((s) => s.method === 'sendMessage' && s.body.chat_id === '777' && isTask(String(s.body.text)));
    const keyboard = (msg?.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> }).inline_keyboard;
    assert.equal(keyboard[0]?.[0]?.url, 'https://www.ticketmaster.es/', 'botón a la web oficial');
    assert.equal(keyboard[1]?.[0]?.callback_data, `t:${task.id}:READY`);

    // Un chat desconocido no puede responder tareas.
    tg.push({ callback_query: { id: 'q1', data: `t:${task.id}:READY`, from: { id: 888 }, message: { chat: { id: 888 }, message_id: 1 } } });
    await until(() => tg.sent.some((s) => s.method === 'answerCallbackQuery' && s.body.callback_query_id === 'q1'), 'rechazo');
    assert.equal(rt.store.humanTasks.get(task.id)?.state, 'OPEN');

    // Bea responde desde su chat.
    tg.push({ callback_query: { id: 'q2', data: `t:${task.id}:READY`, from: { id: 777, username: 'bea' }, message: { chat: { id: 777 }, message_id: 2 } } });
    await until(() => rt.store.humanTasks.get(task.id)?.state === 'DONE', 'tarea respondida');
    assert.equal(rt.store.accounts.get(bea.id)?.session.state, 'READY');
    assert.equal(rt.store.humanTasks.get(task.id)?.response?.actor, 'telegram:bea');

    // Solo el chat principal puede parar todo.
    const beforeBea = tg.messagesTo('777').length;
    tg.message(777, '/parar_todo', 'Bea');
    await until(() => tg.messagesTo('777').slice(beforeBea).some((t) => /Solo el chat principal/.test(t)), 'respuesta a Bea');
    assert.equal(rt.ctx.safety.engagedFor({}), null);
    tg.message(555, '/parar_todo');
    await until(() => rt.ctx.safety.engagedFor({}) !== null, 'kill switch global');
    rt.ctx.safety.setKillSwitch('GLOBAL', null, false, null, 't');
    n.stop();
  });

  it('«en carrito» por cantidad desde Telegram y minutos que le quedan al carrito', async () => {
    const n = start('555');
    await until(() => n.status().connected, 'conexión');
    const rt = h.app.runtime;
    const acc = rt.ctx.accounts.create({ label: 'Carla', providerId: 'manual', holderRef: 'carla', verification: 'VERIFIED', telegramChatId: '778' }, 't');
    const op = rt.ctx.ops.create(manualConfig([acc.id], h.clock.now()), 't');
    await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
    assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
    await h.clock.advance(500);
    const session = [...rt.store.humanTasks.values()].find((t) => t.accountId === acc.id && t.kind === 'OPEN_SESSION' && t.state === 'OPEN');
    rt.ctx.tasks.respond(session?.id ?? '', { result: 'READY' }, 't');
    assert.ok((await rt.ctx.ops.command(op.id, { command: 'start-now' }, 't')).ok);
    await h.clock.advance(1000);
    const add = [...rt.store.humanTasks.values()].find((t) => t.accountId === acc.id && t.kind === 'ADD_TO_CART' && t.state === 'OPEN');
    assert.equal(add?.target?.qty, 4);
    await until(() => tg.sent.some((x) => x.method === 'sendMessage' && x.body.chat_id === '778' && String(x.body.text).includes('Añade')), 'tarea de compra');
    const msg = tg.sent.find((x) => x.method === 'sendMessage' && x.body.chat_id === '778' && String(x.body.text).includes('Añade'));
    const rows = (msg?.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }).inline_keyboard;
    assert.deepEqual(
      rows.flat().filter((b) => b.callback_data?.includes('IN_CART')).map((b) => b.text),
      ['✅ 4 en carrito', '✅ 3 en carrito', '✅ 2 en carrito', '✅ 1 en carrito'],
    );
    // Solo consigue 2 de 4: el sistema debe saberlo para seguir buscando las otras 2.
    tg.push({ callback_query: { id: 'q-cart', data: `t:${add?.id}:IN_CART:2`, from: { id: 778, username: 'carla' }, message: { chat: { id: 778 }, message_id: 9 } } });
    await until(() => rt.store.humanTasks.get(add?.id ?? '')?.state === 'DONE', 'tarea respondida');
    const alloc = rt.store.allocations.get(op.id);
    assert.equal(alloc?.cartedQty, 2, 'cuenta 2, no 4');
    const cart = [...rt.store.carts.values()].find((c) => c.operationId === op.id);
    assert.equal(cart?.qty, 2);
    assert.equal(cart?.expiresAt, null);
    await until(() => tg.sent.some((x) => x.method === 'sendMessage' && x.body.chat_id === '778' && String(x.body.text).startsWith('⏱ ¿Cuántos minutos')), 'pregunta de minutos');
    const ask = tg.sent.find((x) => x.method === 'sendMessage' && x.body.chat_id === '778' && String(x.body.text).startsWith('⏱ ¿Cuántos minutos'));
    const mins = (ask?.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard[0] ?? [];
    assert.equal(mins.find((b) => b.callback_data.endsWith(':10'))?.callback_data, `x:${cart?.id}:10`);
    // Otro chat no puede tocar este carrito.
    tg.push({ callback_query: { id: 'q-min-bad', data: `x:${cart?.id}:5`, from: { id: 999 }, message: { chat: { id: 999 }, message_id: 10 } } });
    tg.push({ callback_query: { id: 'q-min', data: `x:${cart?.id}:10`, from: { id: 778, username: 'carla' }, message: { chat: { id: 778 }, message_id: 11 } } });
    await until(() => rt.store.carts.get(cart?.id ?? '')?.expiresAt !== null, 'caducidad anotada');
    assert.equal(Date.parse(rt.store.carts.get(cart?.id ?? '')?.expiresAt ?? ''), h.clock.now() + 10 * 60_000);
    n.stop();
  });

  it('un token incorrecto se explica en el estado', async () => {
    const n = start('555', '999:MALO');
    await until(() => /Token no válido/.test(n.status().detail), 'detalle del token');
    assert.equal(n.status().connected, false);
    n.stop();
  });
});
