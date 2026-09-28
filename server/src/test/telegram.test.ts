/**
 * Bot de Telegram contra un servidor local que imita la Bot API: detección del
 * chat ID, comandos, tareas con botones, chats no autorizados y mensaje de prueba.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createHarness, type Harness } from '../gates/harness';
import { writeFixtureVault } from '../gates/fixtures';
import { TelegramNotifier } from '../telegram/telegram';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TOKEN = '123456:TEST';

interface Sent {
  method: string;
  body: Record<string, unknown>;
}

class FakeTelegram {
  server: Server;
  sent: Sent[] = [];
  private updates: unknown[] = [];
  private nextId = 1;
  private waiting: Array<() => void> = [];

  constructor() {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
        const reply = (json: unknown) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(json));
        };
        if (!m || m[1] !== TOKEN) return reply({ ok: false, error_code: 401, description: 'Unauthorized' });
        const method = m[2] as string;
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (method === 'getMe') return reply({ ok: true, result: { id: 1, is_bot: true, username: 'orquestador_prueba_bot' } });
        if (method === 'getUpdates') {
          const offset = Number(body.offset ?? 0);
          // Como Telegram: pedir desde `offset` confirma (y borra) las anteriores.
          this.updates = (this.updates as Array<{ update_id: number }>).filter((u) => u.update_id >= offset);
          const flush = () => {
            const out = (this.updates as Array<{ update_id: number }>).filter((u) => u.update_id >= offset);
            reply({ ok: true, result: out });
          };
          if ((this.updates as Array<{ update_id: number }>).some((u) => u.update_id >= offset)) return flush();
          const t = setTimeout(flush, 150);
          this.waiting.push(() => {
            clearTimeout(t);
            flush();
          });
          return;
        }
        this.sent.push({ method, body });
        if (method === 'sendMessage' && body.chat_id === '404') return reply({ ok: false, error_code: 400, description: 'Bad Request: chat not found' });
        return reply({ ok: true, result: true });
      });
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  push(update: Record<string, unknown>): void {
    this.updates.push({ update_id: this.nextId++, ...update });
    const w = this.waiting;
    this.waiting = [];
    for (const fn of w) fn();
  }

  message(chatId: number, text: string, name = 'Persona'): void {
    this.push({ message: { message_id: this.nextId, chat: { id: chatId, type: 'private', first_name: name }, from: { id: chatId, first_name: name }, text } });
  }

  messagesTo(chatId: string): string[] {
    return this.sent.filter((s) => s.method === 'sendMessage' && s.body.chat_id === chatId).map((s) => String(s.body.text));
  }

  close(): Promise<void> {
    for (const fn of this.waiting) fn();
    return new Promise((r) => this.server.close(() => r()));
  }
}

async function until(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`Tiempo agotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

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
    assert.match(n.status().detail, /falta TELEGRAM_CHAT_ID/);
    tg.message(555, '/start', 'Levi');
    await until(() => tg.messagesTo('555').length > 0, 'respuesta a /start');
    assert.match(tg.messagesTo('555')[0] ?? '', /TELEGRAM_CHAT_ID=555/);
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
    assert.ok(tg.messagesTo('555').some((t) => /Prueba del Ticket Orchestrator/.test(t)));
    assert.equal((await n.sendTest('404')).message.includes('no encuentra el chat'), true);

    const before = tg.messagesTo('555').length;
    tg.message(555, '/estado');
    await until(() => tg.messagesTo('555').slice(before).some((t) => /No hay operaciones activas/.test(t)), 'respuesta a /estado');

    // Tarea para la cuenta de Bea, que tiene su propio chat.
    const rt = h.app.runtime;
    const bea = rt.ctx.accounts.create({ label: 'Bea', providerId: 'manual', holderRef: 'bea', verification: 'VERIFIED', telegramChatId: '777' }, 't');
    const task = rt.ctx.tasks.create({ operationId: null, accountId: bea.id, kind: 'OPEN_SESSION', title: 'Inicia sesión', instructions: 'Entra en la web oficial.', link: 'https://www.ticketmaster.es/' });
    await until(() => tg.messagesTo('777').length > 0 && tg.messagesTo('555').some((t) => t.includes('Inicia sesión')), 'tarea en ambos chats');
    const msg = tg.sent.find((s) => s.method === 'sendMessage' && s.body.chat_id === '777');
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

  it('un token incorrecto se explica en el estado', async () => {
    const n = start('555', '999:MALO');
    await until(() => /Token no válido/.test(n.status().detail), 'detalle del token');
    assert.equal(n.status().connected, false);
    n.stop();
  });
});
