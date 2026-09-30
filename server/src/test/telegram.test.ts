/**
 * Bot de Telegram contra un servidor local que imita la Bot API: detección del
 * chat ID, comandos, tareas con botones, chats no autorizados y mensaje de prueba.
 * Además: envíos que no se pierden (429, 5xx, cuelgues), orden por chat, ritmo,
 * conexiones abiertas antes de T0 y un solo mensaje por persona en la apertura.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { EventAssistant } from '../ai/assistant';
import { createHarness, manualConfig, type Harness } from '../gates/harness';
import { writeFixtureVault } from '../gates/fixtures';
import { TelegramEventFlow, type FlowButton } from '../telegram/event-flow';
import { TelegramNotifier, type TelegramOptions } from '../telegram/telegram';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FakeTelegram, TOKEN, until, type Sent } from './fake-telegram';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe('Telegram: envíos que no se pierden y T0', () => {
  let tg: FakeTelegram;
  let base = '';
  let dir = '';
  let h: Harness;
  const notifiers: TelegramNotifier[] = [];
  let seq = 0;

  before(async () => {
    tg = new FakeTelegram();
    base = await tg.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-tg-envios-'));
    await writeFixtureVault(dir);
    h = await createHarness(dir);
  });

  after(async () => {
    for (const n of notifiers) n.stop();
    await h.stop();
    await tg.close();
    await rm(dir, { recursive: true, force: true });
  });

  const start = (opts: Partial<TelegramOptions> = {}) => {
    for (const old of notifiers) old.stop(); // aunque una prueba anterior haya fallado a medias
    const n = new TelegramNotifier({ token: TOKEN, chatId: '555', apiBase: base, retryMs: 50, setupProfile: false, ...opts });
    notifiers.push(n);
    h.app.runtime.ctx.notifier = n;
    n.attach(h.app.runtime);
    return n;
  };
  const account = (label: string, chat: string) =>
    h.app.runtime.ctx.accounts.create({ label, providerId: 'manual', holderRef: `${label.toLowerCase()}-${++seq}`, verification: 'VERIFIED', telegramChatId: chat }, 't');
  const sessionTask = (accountId: string, title = 'Inicia sesión') =>
    h.app.runtime.ctx.tasks.create({ operationId: null, accountId, kind: 'OPEN_SESSION', title, instructions: 'Entra en la web oficial.', link: 'https://www.ticketmaster.es/' });

  it('un 429, un 500, una página 502 o un cuelgue de Telegram no pierden el mensaje, y los de un chat llegan en orden', async () => {
    const n = start({ sendTimeoutMs: 300 });
    await until(() => n.status().connected, 'conexión');
    tg.fail('sendMessage', { status: 429, retryAfter: 1 });
    n.announce('uno', []);
    n.announce('dos', []);
    await until(() => tg.messagesTo('555').includes('dos'), 'reenvío tras retry_after', 5000);
    // «dos» espera a que salga «uno»: nada se pierde ni se adelanta.
    assert.deepEqual(tg.messagesTo('555').filter((t) => t === 'uno' || t === 'dos'), ['uno', 'dos']);
    const limited = tg.refused.find((r) => r.body.text === 'uno');
    const delivered = tg.sent.find((r) => r.body.text === 'uno');
    assert.ok((delivered?.at ?? 0) - (limited?.at ?? 0) >= 950, 'espera lo que pide retry_after');

    tg.fail('sendMessage', { status: 500 }, { status: 502, html: true }, { hang: true });
    n.announce('tres', []);
    await until(() => tg.messagesTo('555').includes('tres'), 'reintentos tras 500, 502 y cuelgue', 8000);
    assert.equal(tg.refused.filter((r) => r.body.text === 'tres').length, 3);
    assert.equal(tg.messagesTo('555').filter((t) => t === 'tres').length, 1);
    n.stop();
  });

  it('las conexiones se reutilizan y se abren antes de T0: la apertura no espera a ningún handshake', async () => {
    // Como api.telegram.org: getUpdates espera hasta 25 s (ocupa su conexión) y sin «Keep-Alive: timeout=»
    // el cliente decide cuánto mantiene abiertas las demás.
    tg.server.keepAliveTimeout = 0;
    tg.pollHoldMs = 30_000;
    const n = start();
    await until(() => n.status().connected, 'conexión');
    n.announce('antes', []);
    await until(() => tg.messagesTo('555').includes('antes'), 'primer envío');
    await sleep(4500); // con fetch, una conexión ociosa se cerraba a los 4 s
    const idle = tg.connections;
    n.announce('después', []);
    await until(() => tg.messagesTo('555').includes('después'), 'envío tras la pausa');
    assert.equal(tg.connections, idle, 'reutiliza la conexión que ya estaba abierta');

    // Telegram ha cerrado las conexiones ociosas: sin precalentar, la apertura abriría una por chat.
    const accs = ['901', '902', '903', '904', '905'].map((c) => account(`P${c}`, c));
    await until(() => accs.every((a) => tg.messagesTo(a.telegramChatId ?? '').length === 1), 'bienvenidas');
    await sleep(100);
    tg.server.closeIdleConnections();
    await sleep(100);
    n.prewarm(accs.map((a) => a.id));
    await sleep(300);
    const warm = tg.connections;
    assert.ok(warm >= idle + 6, 'una conexión por chat de la apertura');
    n.announce('🚦 ¡Abre la venta!', accs.map((a) => a.id));
    await until(() => ['555', ...accs.map((a) => a.telegramChatId ?? '')].every((c) => tg.messagesTo(c).includes('🚦 ¡Abre la venta!')), 'aviso en los 6 chats');
    assert.equal(tg.connections, warm, 'ninguna conexión nueva en la apertura');
    n.stop();
    tg.server.keepAliveTimeout = 5000;
    tg.pollHoldMs = 150;
  });

  it('en T0 cada persona con tarea recibe UN mensaje (¡Abre la venta! + tarea); el principal, primero el aviso', async () => {
    const n = start();
    await until(() => n.status().connected, 'conexión');
    const rt = h.app.runtime;
    const prewarmed: string[][] = [];
    const prewarm = n.prewarm?.bind(n);
    n.prewarm = (ids: string[]) => {
      prewarmed.push(ids);
      prewarm?.(ids);
    };
    const dani = account('Dani', '779');
    const eva = account('Eva', '780');
    const op = rt.ctx.ops.create(manualConfig([dani.id, eva.id], h.clock.now()), 't');
    await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
    assert.ok((await rt.ctx.ops.command(op.id, { command: 'arm' }, 't')).ok);
    await h.clock.advance(500);
    const session = [...rt.store.humanTasks.values()].find((t) => t.accountId === dani.id && t.kind === 'OPEN_SESSION' && t.state === 'OPEN');
    rt.ctx.tasks.respond(session?.id ?? '', { result: 'READY' }, 't');
    await sleep(300); // bienvenida, plan y «entrad ya»
    const opening = (chat: string, from: number) => tg.messagesTo(chat).slice(from).filter((t) => /¡Abre la venta!|Añade/.test(t));
    const b779 = tg.messagesTo('779').length;
    const b780 = tg.messagesTo('780').length;
    const b555 = tg.messagesTo('555').length;
    await h.clock.advance(Date.parse(op.config.t0) - h.clock.now() - 3500);
    const at35 = prewarmed.length;
    await h.clock.advance(1000);
    const at25 = [...prewarmed];
    await h.clock.advance(2600);
    assert.equal(rt.ctx.ops.get(op.id).state, 'RUNNING');
    await until(() => opening('779', b779).length > 0 && opening('780', b780).length > 0 && opening('555', b555).length >= 2, 'mensajes de T0');
    await sleep(200); // que no llegue nada más
    const toDani = opening('779', b779);
    assert.equal(toDani.length, 1, 'un único mensaje para quien tiene tarea');
    assert.match(toDani[0] ?? '', /^🚦 <b>¡Abre la venta! Gate manual<\/b>/);
    assert.match(toDani[0] ?? '', /Añade 4 entradas/);
    const toEva = opening('780', b780);
    assert.equal(toEva.length, 1, 'quien no tiene tarea recibe el aviso');
    assert.match(toEva[0] ?? '', /1 cuenta sin «Sesión lista»/);
    const toMain = opening('555', b555);
    assert.equal(toMain.length, 2, 'el aviso y la copia de la tarea');
    assert.match(toMain[0] ?? '', /^🚦 <b>¡Abre la venta! Gate manual<\/b>/, 'primero el aviso');
    assert.match(toMain[1] ?? '', /^🧑 <b>Añade 4 entradas/, 'después la tarea, sin repetir el aviso');
    assert.equal(at35, 0, 'a T−3,5 s todavía no se abren las conexiones');
    assert.deepEqual(at25, [[dani.id, eva.id]], 'a T−3 s se abren las conexiones de la apertura');
    await rt.ctx.ops.command(op.id, { command: 'cancel' }, 't');
    n.stop();
  });

  it('una respuesta colgada de Telegram a un botón no retrasa los botones de los demás', async () => {
    const n = start();
    await until(() => n.status().connected, 'conexión');
    const rt = h.app.runtime;
    const ta = sessionTask(account('Ana', '811').id);
    const tb = sessionTask(account('Beto', '812').id);
    tg.fail('answerCallbackQuery', { hang: true });
    tg.push({ callback_query: { id: 'cuelga', data: `t:${ta.id}:READY`, from: { id: 811 }, message: { chat: { id: 811 }, message_id: 1 } } });
    await until(() => tg.refused.some((r) => r.body.callback_query_id === 'cuelga'), 'respuesta colgada');
    assert.equal(rt.store.humanTasks.get(ta.id)?.state, 'DONE', 'la tarea se responde sin esperar a Telegram');
    tg.push({ callback_query: { id: 'rapido', data: `t:${tb.id}:READY`, from: { id: 812 }, message: { chat: { id: 812 }, message_id: 1 } } });
    await until(() => rt.store.humanTasks.get(tb.id)?.state === 'DONE' && tg.sent.some((s) => s.body.callback_query_id === 'rapido'), 'botón de Beto atendido', 2000);
    n.stop();
  });

  it('con muchos mensajes a la vez respeta el ritmo, y las tareas de cada persona salen antes que las copias', async () => {
    const n = start({ sendsPerSecond: 2 });
    await until(() => n.status().connected, 'conexión');
    const accs = [
      ['Uxue', '831'],
      ['Vera', '832'],
      ['Wally', '833'],
    ].map(([label, chat]) => account(label ?? '', chat ?? ''));
    await until(() => accs.every((a) => tg.messagesTo(a.telegramChatId ?? '').length === 1), 'bienvenidas', 4000);
    await sleep(1100); // se recupera el cupo
    const from = tg.sent.length;
    for (const a of accs) sessionTask(a.id, `Sesión de ${a.label}`);
    await until(() => tg.sent.slice(from).filter((s) => s.method === 'sendMessage').length === 6, 'tareas y copias', 6000);
    const out = tg.sent.slice(from).filter((s) => s.method === 'sendMessage');
    assert.ok((out[5]?.at ?? 0) - (out[0]?.at ?? 0) >= 1400, `al ritmo pedido (${(out[5]?.at ?? 0) - (out[0]?.at ?? 0)} ms)`);
    const order = out.map((s) => String(s.body.chat_id));
    assert.equal(order[0], '831', 'la tarea de la persona sale antes que su copia en el chat principal');
    // Las dos primeras salen al momento; después, las tareas de Vera y Wally antes que las copias del chat principal.
    assert.deepEqual([...order.slice(2, 4)].sort(), ['832', '833']);
    assert.deepEqual(order.slice(4), ['555', '555']);
    n.stop();
  });

  it('/estado con muchas operaciones se parte en varios mensajes y no cuenta las finalizadas', async () => {
    const n = start();
    await until(() => n.status().connected, 'conexión');
    const rt = h.app.runtime;
    const acc = account('Fin', '820');
    const ended = rt.ctx.ops.create({ ...manualConfig([acc.id], h.clock.now()), name: 'Operación ya terminada' }, 't');
    await rt.ctx.ops.command(ended.id, { command: 'validate' }, 't');
    await rt.ctx.ops.command(ended.id, { command: 'arm' }, 't');
    await rt.ctx.ops.command(ended.id, { command: 'start-now' }, 't');
    await rt.ctx.ops.command(ended.id, { command: 'stop' }, 't');
    assert.equal(rt.ctx.ops.get(ended.id).state, 'ENDED');
    const names = Array.from({ length: 40 }, (_, i) => `Operación ${String(i).padStart(2, '0')} ${'x'.repeat(100)}`);
    for (const name of names) rt.ctx.ops.create({ ...manualConfig([acc.id], h.clock.now()), name }, 't');
    const before = tg.messagesTo('555').length;
    tg.message(555, '/estado');
    const parts = () => tg.messagesTo('555').slice(before).filter((t) => t.startsWith('• <b>'));
    await until(() => names.every((name) => parts().some((t) => t.includes(name))), 'estado completo');
    assert.ok(parts().length >= 2, 'en varios mensajes');
    for (const p of parts()) assert.ok(p.length <= 4096, `mensaje de ${p.length} caracteres`);
    assert.ok(!parts().some((t) => t.includes('Operación ya terminada')), 'sin las finalizadas');
    n.stop();
  });

  it('si getMe falla al arrancar y Telegram vuelve, el bot se comprueba otra vez y pone su menú', async () => {
    tg.fail('getMe', { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    const n = start({ setupProfile: true });
    try {
      await until(() => n.status().bot === 'orquestador_prueba_bot' && n.status().connected, 'bot comprobado otra vez', 6000);
      await until(() => tg.sent.some((s) => s.method === 'setMyCommands'), 'menú de comandos');
    } finally {
      tg.clearFaults();
      n.stop();
    }
  });

  it('el «Error enviando…» del estado se quita cuando los envíos vuelven a llegar', async () => {
    const n = start();
    await until(() => n.status().connected, 'conexión');
    account('Nadie', '404'); // Telegram no deja escribir a este chat: falla la bienvenida
    await until(() => /Error enviando a 404/.test(n.status().detail), 'error en el estado');
    n.announce('vuelve a ir', []);
    await until(() => tg.messagesTo('555').includes('vuelve a ir'), 'envío correcto');
    await until(() => n.status().detail === '@orquestador_prueba_bot · chat principal 555', 'estado limpio', 2000);
    n.stop();
  });

  it('un botón desconocido o de una versión anterior se contesta igual (no se queda cargando)', async () => {
    const n = start();
    await until(() => n.status().connected, 'conexión');
    const datas = ['zzz', 't:', 't:nada', 'p:', 'x:cart_x', ''];
    datas.forEach((data, i) => tg.push({ callback_query: { id: `viejo${i}`, data, from: { id: 555 }, message: { chat: { id: 555 }, message_id: 1 } } }));
    await until(() => datas.every((_, i) => tg.sent.some((s) => s.method === 'answerCallbackQuery' && s.body.callback_query_id === `viejo${i}`)), 'respuestas');
    n.stop();
  });

  it('los botones de la copia que manda /tareas también se quitan al cerrarse la tarea', async () => {
    const n = start();
    await until(() => n.status().connected, 'conexión');
    const lola = account('Lola', '712');
    const task = sessionTask(lola.id, 'Sesión de Lola');
    // El doble de Telegram numera cada mensaje por su posición en `sent`.
    const copies = () =>
      tg.sent.flatMap((s, i) => (s.method === 'sendMessage' && s.body.chat_id === '712' && String(s.body.text).includes('Sesión de Lola') ? [i + 1] : []));
    await until(() => copies().length === 1, 'tarea');
    tg.message(712, '/tareas', 'Lola');
    await until(() => copies().length === 2, 'copia de /tareas');
    h.app.runtime.ctx.tasks.respond(task.id, { result: 'READY' }, 'dashboard');
    const cleared = (id: number) => tg.sent.some((s: Sent) => s.method === 'editMessageReplyMarkup' && s.body.chat_id === '712' && s.body.message_id === id);
    await until(() => copies().every(cleared), 'botones quitados en los dos mensajes');
    n.stop();
  });
});

describe('/evento: botones', () => {
  it('recortar un nombre largo no parte un emoji (Telegram rechazaría el mensaje entero)', async () => {
    const sent: Array<{ text: string; keyboard?: FlowButton[][] }> = [];
    const io = {
      send: async (_chat: string, text: string, keyboard?: FlowButton[][]) => {
        sent.push({ text, keyboard });
        return 1;
      },
      photo: async () => true,
      edit: async () => undefined,
      answer: async () => undefined,
    };
    const assistant = { configured: () => true, sellers: () => [{ providerId: 'taquilla', name: `${'A'.repeat(38)}🔥 Taquilla oficial`, url: null }] };
    const flow = new TelegramEventFlow(io, () => assistant as unknown as EventAssistant);
    await flow.start('555');
    const button = sent[0]?.keyboard?.[0]?.[0]?.text ?? '';
    assert.match(button, /A…$/);
    assert.equal(Buffer.from(button, 'utf8').toString('utf8'), button, 'UTF-16 válido: sin medio emoji');
  });
});
