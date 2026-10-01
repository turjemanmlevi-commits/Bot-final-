/**
 * Telegram configurado desde el dashboard: el token se comprueba, se guarda en
 * .env (sin tocar el resto) y el bot se conecta sin reiniciar; el chat principal
 * se elige entre los que han escrito al bot. El token nunca sale por la API.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Hono } from 'hono';
import type { TelegramConfigResult } from '@to/shared';
import { createHarness, type Harness } from '../gates/harness';
import { writeFixtureVault } from '../gates/fixtures';
import { createHttpApp } from '../http/app';
import { TelegramControl } from '../telegram/control';
import { BOT_COMMANDS } from '../telegram/telegram';
import { applyEnvChanges, updateEnvFile } from '../util/envfile';
import { FakeTelegram, until } from './fake-telegram';

/** Token con la forma real de @BotFather (lo acepta el servidor de pruebas). */
const REAL_FORMAT = '1234567890:AAEtestTESTtest_test-TESTtestTEST123';

describe('archivo .env', () => {
  it('cambia solo las variables indicadas y conserva comentarios, orden y CRLF', () => {
    const before = '# Telegram\r\nPORT=8787\r\nTELEGRAM_BOT_TOKEN=\r\n# comentario\r\nTELEGRAM_CHAT_ID=1\r\nTELEGRAM_CHAT_ID=2\r\n';
    const out = applyEnvChanges(before, { TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_CHAT_ID: '555', NUEVA: 'x' });
    assert.equal(out, '# Telegram\r\nPORT=8787\r\nTELEGRAM_BOT_TOKEN=123:ABC\r\n# comentario\r\nTELEGRAM_CHAT_ID=555\r\nNUEVA=x\r\n');
  });

  it('no toca líneas comentadas, vacía con null y respeta el BOM', () => {
    const out = applyEnvChanges('﻿# TELEGRAM_CHAT_ID=9\nA=1', { TELEGRAM_CHAT_ID: null }, 'linux');
    assert.equal(out, '﻿# TELEGRAM_CHAT_ID=9\nA=1\nTELEGRAM_CHAT_ID=\n');
    assert.equal(applyEnvChanges('', { A: '1' }, 'win32'), 'A=1\r\n');
  });

  it('rechaza valores que romperían el archivo', () => {
    assert.throws(() => applyEnvChanges('', { A: 'x\nB=2' }));
    assert.throws(() => applyEnvChanges('', { A: 'con espacio' }));
    assert.throws(() => applyEnvChanges('', { 'mal-nombre': '1' }));
  });

  it('crea el .env desde la plantilla si todavía no existe', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'to-env-'));
    try {
      await writeFile(path.join(dir, '.env.example'), '# plantilla\nTELEGRAM_BOT_TOKEN=\nMANUAL_TASK_MINUTES=30\n');
      const file = path.join(dir, '.env');
      await updateEnvFile(file, { TELEGRAM_BOT_TOKEN: '1:X' }, path.join(dir, '.env.example'));
      assert.equal(await readFile(file, 'utf8'), '# plantilla\nTELEGRAM_BOT_TOKEN=1:X\nMANUAL_TASK_MINUTES=30\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Telegram desde el dashboard', () => {
  let tg: FakeTelegram;
  let base = '';
  let dir = '';
  let envFile = '';
  let h: Harness;
  let control: TelegramControl;
  let http: Hono;

  before(async () => {
    tg = new FakeTelegram(REAL_FORMAT, 'Amirentradas_prueba_bot');
    base = await tg.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-tgsetup-'));
    await writeFixtureVault(dir);
    envFile = path.join(dir, '.env');
    await writeFile(envFile, '# Mi configuración\nPORT=8787\nTELEGRAM_BOT_TOKEN=\nTELEGRAM_CHAT_ID=\nMANUAL_TASK_MINUTES=30\n');
    h = await createHarness(dir);
    control = new TelegramControl({ runtime: h.app.runtime, apiBase: base, envFile, retryMs: 50 });
    http = createHttpApp(h.app, { dashboardDist: null, operatorToken: null, telegram: control });
  });

  after(async () => {
    control.stop();
    await h.stop();
    await tg.close();
    await rm(dir, { recursive: true, force: true });
  });

  const put = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    http.request(url, { method: 'PUT', headers: { 'content-type': 'application/json', host: 'localhost:8787', ...headers }, body: JSON.stringify(body) });

  it('sin token: se puede configurar desde el dashboard', () => {
    const st = h.app.runtime.ctx.ops.systemStatus().telegram;
    assert.equal(st.enabled, false);
    assert.equal(st.configurable, true);
    assert.match(st.detail, /Ajustes · Telegram/);
  });

  it('un token que Telegram no reconoce no se guarda', async () => {
    const r = await control.setToken('1234567890:AAEotroOTROotro_otro-OTROotroOTRO999', 'Levi');
    assert.equal(r.ok, false);
    assert.match(r.message, /@BotFather/);
    assert.match(await readFile(envFile, 'utf8'), /^TELEGRAM_BOT_TOKEN=$/m);
    assert.equal(h.app.runtime.ctx.notifier, null);
  });

  it('solo desde el propio dashboard: JSON y mismo origen', async () => {
    const plain = await http.request('/api/telegram/token', {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', host: 'localhost:8787' },
      body: JSON.stringify({ token: REAL_FORMAT }),
    });
    assert.equal(plain.status, 400);
    const evil = await put('/api/telegram/token', { token: REAL_FORMAT }, { origin: 'https://otra-web.example' });
    assert.equal(evil.status, 403);
    const bad = await put('/api/telegram/token', { token: 'hola' });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: { message: string } }).error.message, /Token del bot/);
    assert.match(await readFile(envFile, 'utf8'), /^TELEGRAM_BOT_TOKEN=$/m, 'nada de eso toca el .env');
  });

  it('con el token bueno: se guarda, conecta sin reiniciar y el bot se configura solo', async () => {
    const res = await put('/api/telegram/token', { token: `  ${REAL_FORMAT}  ` }, { origin: 'http://localhost:8787' });
    assert.equal(res.status, 200);
    const r = (await res.json()) as TelegramConfigResult;
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /@Amirentradas_prueba_bot conectado/);
    assert.equal(r.status.connected, true);
    assert.equal(r.status.bot, 'Amirentradas_prueba_bot');
    assert.ok(!JSON.stringify(r).includes(REAL_FORMAT), 'el token nunca vuelve por la API');
    const env = await readFile(envFile, 'utf8');
    assert.equal(env, `# Mi configuración\nPORT=8787\nTELEGRAM_BOT_TOKEN=${REAL_FORMAT}\nTELEGRAM_CHAT_ID=\nMANUAL_TASK_MINUTES=30\n`);
    assert.ok(h.app.runtime.ctx.notifier, 'el runtime ya avisa por Telegram');
    await until(() => tg.sent.some((s) => s.method === 'setMyShortDescription'), 'perfil del bot');
    const commands = tg.sent.find((s) => s.method === 'setMyCommands')?.body.commands as Array<{ command: string }>;
    assert.deepEqual(
      commands.map((c) => c.command),
      BOT_COMMANDS.map((c) => c.command),
    );
    assert.match(String(tg.sent.find((s) => s.method === 'setMyDescription')?.body.description), /Iniciar/);
    const system = await (await http.request('/api/system')).text();
    assert.ok(!system.includes(REAL_FORMAT), 'ni en el estado del sistema');
  });

  it('el mismo token otra vez no reinicia el bot', async () => {
    const n = h.app.runtime.ctx.notifier;
    const r = await control.setToken(REAL_FORMAT, 'Levi');
    assert.equal(r.ok, true);
    assert.equal(h.app.runtime.ctx.notifier, n);
  });

  it('/start aparece en el dashboard y se elige como chat principal', async () => {
    tg.message(555, '/start', 'Levi');
    await until(() => control.status().recentChats.some((c) => c.chatId === '555'), 'chat visto');
    await until(() => tg.messagesTo('555').length > 0, 'respuesta con el número');
    assert.match(tg.messagesTo('555')[0] ?? '', /Usar como chat principal/);

    const res = await put('/api/telegram/main-chat', { chatId: '555' });
    const r = (await res.json()) as TelegramConfigResult;
    assert.equal(r.ok, true, r.message);
    assert.equal(r.status.mainChatConfigured, true);
    assert.equal(r.status.mainChatId, '555');
    assert.match(await readFile(envFile, 'utf8'), /^TELEGRAM_CHAT_ID=555$/m);
    assert.ok(tg.messagesTo('555').some((t) => t.includes('chat principal de la sala de control') && t.includes('Cómo ir rápido')));

    // Ya es el chat principal: los comandos funcionan sin reiniciar.
    const before = tg.messagesTo('555').length;
    tg.message(555, '/estado', 'Levi');
    await until(() => tg.messagesTo('555').slice(before).some((t) => /No hay operaciones activas/.test(t)), '/estado');
  });

  it('un chat al que Telegram no deja escribir se explica', async () => {
    const r = await control.setMainChat('404', 'Levi');
    assert.equal(r.ok, false);
    assert.match(r.message, /pulsa «Iniciar»/);
    const back = await control.setMainChat('555', 'Levi');
    assert.equal(back.ok, true, back.message);
  });

  it('asignar un chat a una cuenta le da la bienvenida a esa persona', async () => {
    const rt = h.app.runtime;
    const acc = rt.ctx.accounts.create({ label: 'Ana (socia)', providerId: 'manual', holderRef: 'ana', verification: 'VERIFIED' }, 'Levi');
    assert.equal(tg.messagesTo('602').length, 0);
    rt.ctx.accounts.update(acc.id, { telegramChatId: '602' }, 'Levi');
    await until(() => tg.messagesTo('602').some((t) => t.includes('«Ana (socia)»')), 'bienvenida de Ana');
    // Cambiar otra cosa de la cuenta no repite la bienvenida.
    rt.ctx.accounts.update(acc.id, { label: 'Ana' }, 'Levi');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(tg.messagesTo('602').length, 1);
  });

  it('sin archivo .env no se puede configurar desde el dashboard', async () => {
    const other = await createHarness(dir);
    try {
      const c = new TelegramControl({ runtime: other.app.runtime, apiBase: base, envFile: null });
      assert.equal(other.app.runtime.ctx.ops.systemStatus().telegram.configurable, false);
      c.stop();
    } finally {
      await other.stop();
    }
  });
});

describe('chat principal: el número del bot no vale', () => {
  it('se rechaza al elegirlo y se ignora si estaba guardado', async () => {
    const { isBotId } = await import('../telegram/control');
    assert.equal(isBotId('1234567890', REAL_FORMAT), true);
    assert.equal(isBotId('6626060160', REAL_FORMAT), false);
    const tg = new FakeTelegram(REAL_FORMAT, 'bot_prueba_bot');
    const base = await tg.listen();
    const dir = await mkdtemp(path.join(tmpdir(), 'to-tgbot-'));
    await writeFixtureVault(dir);
    const h = await createHarness(dir);
    try {
      // Guardado por error en .env: al arrancar no cuenta como chat principal.
      const c = new TelegramControl({ runtime: h.app.runtime, apiBase: base, envFile: null, retryMs: 50 }, { token: REAL_FORMAT, chatId: '1234567890' });
      assert.equal(c.status().mainChatConfigured, false);
      const r = await c.setMainChat('1234567890', 'Levi');
      assert.equal(r.ok, false);
      assert.match(r.message, /número del propio bot/);
      assert.equal(c.status().mainChatId, null);
      c.stop();
    } finally {
      await h.stop();
      await tg.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('el número del bot guardado al arrancar', () => {
  it('no queda como chat principal aunque el bot se creara antes con él, y no se acepta en una cuenta', async () => {
    const { TelegramNotifier } = await import('../telegram/telegram');
    const tg = new FakeTelegram(REAL_FORMAT, 'bot_prueba_bot');
    const base = await tg.listen();
    const dir = await mkdtemp(path.join(tmpdir(), 'to-tgbot2-'));
    await writeFixtureVault(dir);
    const h = await createHarness(dir);
    try {
      // Como en main.ts: el bot se crea con lo que dice .env y después se le pasa al control.
      const early = new TelegramNotifier({ token: REAL_FORMAT, chatId: '1234567890', apiBase: base, retryMs: 50 });
      const c = new TelegramControl({ runtime: h.app.runtime, apiBase: base, envFile: null, retryMs: 50 }, { token: REAL_FORMAT, chatId: '1234567890', notifier: early });
      assert.equal(c.status().mainChatId, null);
      assert.equal(c.status().mainChatConfigured, false);
      const http = createHttpApp(h.app, { dashboardDist: null, operatorToken: null, telegram: c });
      const res = await http.request('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Levi', providerId: 'manual', holderRef: 'levi', verification: 'VERIFIED', telegramChatId: '1234567890' }),
      });
      assert.equal(res.status, 400);
      assert.match(((await res.json()) as { error: { message: string } }).error.message, /número del propio bot/);
      c.stop();
    } finally {
      await h.stop();
      await tg.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('cortes de red con Telegram', () => {
  it('un envío que falla por la conexión se reintenta solo', async () => {
    const { createServer } = await import('node:http');
    const { TelegramNotifier } = await import('../telegram/telegram');
    let sends = 0;
    const server = createServer((req, res) => {
      if (req.url?.endsWith('/sendMessage') && sends++ === 0) {
        req.socket.destroy(); // como una conexión que el servidor ya había cerrado
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: req.url?.endsWith('/getMe') ? { username: 'x_bot' } : { message_id: 1 } }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const n = new TelegramNotifier({ token: REAL_FORMAT, chatId: '6626060160', apiBase: `http://127.0.0.1:${port}`, setupProfile: false });
      const r = await n.sendTest();
      assert.equal(r.ok, true, r.message);
      assert.equal(sends, 2, 'el primer intento se cortó y el segundo llegó');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
