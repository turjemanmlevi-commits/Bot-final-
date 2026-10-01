/**
 * Prueba de humo end-to-end en modo SIMULADO, sin red:
 *   bot (Chromium oculto) → réplica de la web de Onebox (catálogo, cola, login, plano de
 *   asientos / selección automática / lista de zonas) → carrito → aviso a un Telegram FALSO
 *   local → pulsación de botón → decisión aplicada. Comprueba que NUNCA se pulsa pagar.
 *
 *   npm run prueba:smoke
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

// --- Telegram falso -------------------------------------------------------
interface Sent {
  method: string;
  text: string;
  keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
}
const sent: Sent[] = [];
const pendingPresses: string[] = [];
let updateId = 100;

const fakeTelegram: Server = createServer((req, res) => {
  void (async () => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    const method = (req.url ?? '').split('/').pop() ?? '';
    let fields: Record<string, string> = {};
    if ((req.headers['content-type'] ?? '').startsWith('multipart/form-data')) {
      const form = await new Response(buf, { headers: { 'content-type': req.headers['content-type']! } }).formData();
      for (const [k, v] of form) if (typeof v === 'string') fields[k] = v;
    } else if (buf.length) {
      fields = Object.fromEntries(Object.entries(JSON.parse(buf.toString())).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    }
    const ok = (result: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    };
    if (method === 'getMe') return ok({ username: 'bot_de_prueba' });
    if (method === 'sendMessage' || method === 'sendPhoto') {
      const markup = fields['reply_markup'] ? (JSON.parse(fields['reply_markup']) as { inline_keyboard: Sent['keyboard'] }) : { inline_keyboard: [] };
      sent.push({ method, text: fields['text'] ?? fields['caption'] ?? '', keyboard: markup.inline_keyboard });
      return ok({ message_id: sent.length });
    }
    if (method === 'getUpdates' && buf.length === 0) {
      // detectChatId: el usuario ha escrito «hola» al bot.
      return ok([{ update_id: 1, message: { chat: { id: 42, type: 'private' } } }]);
    }
    if (method === 'getUpdates') {
      const offset = Number(JSON.parse(buf.toString() || '{}').offset ?? 0);
      if (offset === -1) return ok([]);
      const data = pendingPresses.shift();
      if (!data) {
        await new Promise((r) => setTimeout(r, 200));
        return ok([]);
      }
      updateId++;
      return ok([{ update_id: updateId, callback_query: { id: `cq${updateId}`, data, from: { username: 'yo' }, message: { message_id: 1, chat: { id: 42 } } } }]);
    }
    return ok(true);
  })();
});
await new Promise<void>((r) => fakeTelegram.listen(0, '127.0.0.1', r));
const tgPort = (fakeTelegram.address() as { port: number }).port;

process.env['TELEGRAM_BOT_TOKEN'] = 'TEST';
process.env['TELEGRAM_CHAT_ID'] = '42';
process.env['TELEGRAM_API_BASE'] = `http://127.0.0.1:${tgPort}`;
process.env['PRUEBA_ENV_FILE'] = path.join(mkdtempSync(path.join(tmpdir(), 'prueba-env-')), '.env');
// Login con credenciales (en modo oculto no hay nadie que lo haga a mano).
process.env['RM_EMAIL'] = 'prueba@ejemplo.com';
process.env['RM_PASSWORD'] = 'simulado';

// --- App bajo prueba ------------------------------------------------------
const { loadConfig } = await import('../src/config.js');
const { Runner } = await import('../src/runner.js');
const { createAppServer, parseRunOptions } = await import('../src/server.js');
const { chooseSeatBlock, zoneRank } = await import('../src/onebox.js');
type RunStatus = import('../src/runner.js').RunStatus;

const cfg = loadConfig();
cfg.profileDir = mkdtempSync(path.join(tmpdir(), 'prueba-perfil-'));
cfg.capturesDir = mkdtempSync(path.join(tmpdir(), 'prueba-capturas-'));
cfg.humanWaitMs = 40_000;
const runner = new Runner(cfg);
const app = createAppServer(cfg, runner);
await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;

async function api(p: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

interface MockState {
  carts: Array<{ sid: string; items: Array<{ zoneName: string; row: number | null; seat: number | null; qty: number; priceCents: number }> }>;
  paid: boolean;
  checkoutVisited: boolean;
}
const mockState = async (): Promise<MockState> => (await api('/mock/api/state')).json as unknown as MockState;
const resetMock = async (): Promise<void> => void (await api('/mock/api/reset', {}));

async function waitFor(statuses: RunStatus[], timeoutMs = 90_000): Promise<RunStatus> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (statuses.includes(runner.state.status)) return runner.state.status;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout esperando ${statuses.join('/')} (estado: ${runner.state.status})\n${runner.state.log.map((l) => l.message).join('\n')}`);
}

let failed = false;
/** Cada paso empieza con el runner parado, aunque el anterior haya fallado a medias. */
async function ensureIdle(): Promise<void> {
  if (!runner.busy) return;
  runner.stop();
  await runner.closeSession();
  const end = Date.now() + 15_000;
  while (runner.busy && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
}
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await ensureIdle();
    await fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failed = true;
    console.error(`✘ ${name}\n  ${(err as Error).stack ?? err}\n  --- log ---\n  ${runner.state.log.map((l) => `[${l.level}] ${l.message}`).join('\n  ')}`);
  }
}

const logText = (): string => runner.state.log.map((l) => l.message).join('\n');

await step('unidad: zonas y bloques de asientos seguidos', async () => {
  assert.equal(zoneRank('Lateral Oeste · Grada baja', ['Grada Oeste', 'Tribuna']), 0);
  assert.equal(zoneRank('Tribuna Central', ['Grada Oeste', 'Tribuna']), 1);
  assert.equal(zoneRank('Fondo Sur', ['Grada Oeste', 'Tribuna']), Number.POSITIVE_INFINITY);
  assert.equal(zoneRank('Cualquiera', []), 0);
  const seat = (row: string, n: number, x = n * 20): { id: string; x: number; y: number; r: number; label: string; row: string; seat: number } => ({ id: `s-${row}-${n}`, x, y: Number(row) * 30, r: 8, label: `Fila ${row} Asiento ${n}`, row, seat: n });
  // Fila 2: 5-9 libres; fila 3: 1-4 libres. Con 3 seguidas: evita dejar uno suelto (5-7 deja 8-9).
  const seats = [seat('2', 5), seat('2', 6), seat('2', 7), seat('2', 8), seat('2', 9), seat('3', 1), seat('3', 2), seat('3', 3), seat('3', 4)];
  assert.deepEqual(chooseSeatBlock(seats, 3, true)!.map((s) => `${s.row}-${s.seat}`), ['2-5', '2-6', '2-7']);
  // Con 4 seguidas: la fila 3 completa (no deja resto) gana a 5-8 (deja 9 suelto).
  assert.deepEqual(chooseSeatBlock(seats, 4, true)!.map((s) => `${s.row}-${s.seat}`), ['3-1', '3-2', '3-3', '3-4']);
  assert.equal(chooseSeatBlock(seats, 6, true), null);
  assert.equal(chooseSeatBlock(seats, 6, false)!.length, 6);
  // Sin etiquetas de fila: geometría.
  const geo = [1, 2, 3, 5, 6].map((n) => ({ id: `g${n}`, x: n * 20, y: 100, r: 8, label: '', row: null, seat: null }));
  assert.deepEqual(chooseSeatBlock(geo, 3, true)!.map((s) => s.id), ['g1', 'g2', 'g3']);
  assert.equal(chooseSeatBlock(geo, 3, true)!.length, 3);
  assert.equal(chooseSeatBlock([geo[3]!, geo[4]!], 3, true), null);
});

await step('catálogo → partido → cola → login → 3 asientos seguidos en «Grada Oeste» → Telegram «Sí»', async () => {
  await resetMock();
  const { status } = await api('/api/prueba', {
    mode: 'simulado',
    entry: 'canal',
    quantity: 3,
    zones: 'Grada Oeste, Tribuna',
    maxUnitPrice: '30',
    contiguous: true,
    queue: true,
    headless: true,
  });
  assert.equal(status, 202);
  await waitFor(['CART_SECURED', 'FAILED']);
  assert.equal(runner.state.status, 'CART_SECURED', runner.state.error ?? logText());
  const cart = runner.state.cart!;
  assert.equal(cart.qty, 3);
  assert.equal(cart.total, 7500);
  assert.match(cart.strategy, /^plano:Lateral Oeste/);
  assert.ok(cart.items.every((i) => /Lateral Oeste/.test(i.sectionLabel)), JSON.stringify(cart.items));
  assert.ok(cart.expiresAt, 'debe leer la cuenta atrás del carrito');
  assert.equal(cart.eventTitle, 'Real Madrid Femenino - FC Barcelona');
  // En la web: 3 asientos seguidos de la misma fila (fila 2: 5, 6, 7) y nada pagado.
  const st = await mockState();
  assert.equal(st.carts.length, 1);
  const seats = st.carts[0]!.items.map((i) => [i.zoneName, i.row, i.seat]);
  assert.deepEqual(seats, [['Lateral Oeste', 2, 5], ['Lateral Oeste', 2, 6], ['Lateral Oeste', 2, 7]]);
  assert.equal(st.paid, false);
  assert.equal(st.checkoutVisited, false);
  assert.match(logText(), /En cola virtual/);
  assert.match(logText(), /Iniciando sesión con prueba@ejemplo\.com/);
  assert.match(logText(), /Partido elegido: Real Madrid Femenino - FC Barcelona/);

  const msg = sent.find((s) => /Quieres comprar las entradas/.test(s.text));
  assert.ok(msg, 'debe enviar el aviso del carrito a Telegram');
  assert.equal(msg.method, 'sendPhoto');
  assert.match(msg.text, /1 × Lateral Oeste · Fila 2 Asiento 5 — 25,00 €/);
  assert.match(msg.text, /Total:<\/b> 75,00 €/);
  assert.match(msg.text, /asientos elegidos en el plano/);
  assert.ok(msg.keyboard.flat().every((b) => !b.url), 'URL local: no va en botón');
  const yes = msg.keyboard.flat().find((b) => b.callback_data?.startsWith('comprar:'));
  assert.ok(yes);
  pendingPresses.push(yes.callback_data!);
  await waitFor(['OPENED']);
  assert.ok(sent.some((s) => /Completa|Carrito listo/.test(s.text)));
  // El carrito sigue vivo (ni pagado ni liberado).
  assert.equal((await mockState()).carts[0]!.items.length, 3);
  await runner.closeSession();
});

await step('zona con «Buscar asientos»: selección automática de la web (2 seguidas en Tribuna Central)', async () => {
  await resetMock();
  sent.length = 0;
  await api('/api/prueba', { mode: 'simulado', quantity: 2, zones: 'Tribuna Central', auto: true, headless: true, login: false });
  await waitFor(['CART_SECURED', 'FAILED']);
  assert.equal(runner.state.status, 'CART_SECURED', runner.state.error ?? logText());
  const cart = runner.state.cart!;
  assert.match(cart.strategy, /^automatica:Tribuna Central/);
  assert.equal(cart.qty, 2);
  assert.equal(cart.total, 8000);
  const items = (await mockState()).carts[0]!.items;
  assert.equal(items.length, 2);
  assert.equal(items[0]!.row, items[1]!.row);
  assert.equal(Math.abs(items[0]!.seat! - items[1]!.seat!), 1);
  assert.match(logText(), /Diálogo: pulso «Siguiente»/);
  assert.match(logText(), /Diálogo: pulso «Añadir al carrito»/);
  await runner.closeSession();
});

await step('zona sin numerar (contador + «Añadir al carrito»)', async () => {
  await resetMock();
  await api('/api/prueba', { mode: 'simulado', quantity: 2, zones: 'de pie', headless: true, login: false });
  await waitFor(['CART_SECURED', 'FAILED']);
  assert.equal(runner.state.status, 'CART_SECURED', runner.state.error ?? logText());
  assert.match(runner.state.cart!.strategy, /^zona:Grada de pie/);
  assert.equal(runner.state.cart!.qty, 2);
  assert.equal(runner.state.cart!.total, 2000);
  await runner.closeSession();
});

await step('lista de zonas sin plano: la preferida agotada → siguiente; «No, liberar» vacía el carrito', async () => {
  await resetMock();
  sent.length = 0;
  await api('/api/prueba', { mode: 'simulado', quantity: 2, zones: 'Fondo Norte, Fondo Sur', maxUnitPrice: '20', list: true, headless: true, login: false });
  await waitFor(['CART_SECURED', 'FAILED']);
  assert.equal(runner.state.status, 'CART_SECURED', runner.state.error ?? logText());
  assert.match(runner.state.cart!.strategy, /^lista:Fondo Sur/);
  assert.equal(runner.state.cart!.qty, 2);
  assert.equal(runner.state.cart!.total, 3000);
  const r = await api('/api/decision', { decision: 'cancelar' });
  assert.equal(r.status, 200);
  await waitFor(['CANCELLED']);
  assert.equal((await mockState()).carts.length, 0, 'el carrito debe quedar vacío');
  assert.ok(sent.some((s) => /no se compran/.test(s.text)));
});

await step('sin zona que cumpla el precio → pide ayuda humana; oculto → falla con mensaje claro', async () => {
  await resetMock();
  sent.length = 0;
  await api('/api/prueba', { mode: 'simulado', quantity: 2, maxUnitPrice: '5', headless: true, login: false });
  await waitFor(['FAILED']);
  assert.match(runner.state.error ?? '', /modo oculto/);
  assert.ok(sent.some((s) => /La prueba ha fallado/.test(s.text)));
  assert.equal((await mockState()).paid, false);
});

await step('validación: modo real acepta URL vacía (elige el partido) y rechaza dominios ajenos', async () => {
  const r = await api('/api/prueba', { mode: 'real', eventUrl: 'https://example.com/x' });
  assert.equal(r.status, 400);
  assert.match(String(r.json['error']), /tickets\.realmadrid\.com/);
  const opts = parseRunOptions({ mode: 'real', eventUrl: '', quantity: 3, zones: 'Grada Oeste', contiguous: true }, cfg, 3000);
  assert.equal(opts.eventUrl, '');
  assert.equal(opts.headless, false);
  assert.deepEqual(opts.zones, ['Grada Oeste']);
  assert.equal(opts.contiguous, true);
  const real = parseRunOptions({ mode: 'real', eventUrl: 'https://tickets.realmadrid.com/realmadrid_femenino/select/3007478?hl=es-ES' }, cfg, 3000);
  assert.match(real.eventUrl, /^https:\/\/tickets\.realmadrid\.com/);
});

await step('conectar Telegram desde el panel: detecta el chat, avisa y guarda en .env', async () => {
  sent.length = 0;
  const bad = await api('/api/telegram', { token: 'no-es-un-token' });
  assert.equal(bad.status, 400);
  const r = await api('/api/telegram', { token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', chatId: '' });
  assert.equal(r.status, 200, String(r.json['error']));
  assert.equal(r.json['username'], 'bot_de_prueba');
  assert.ok(sent.some((s) => /Conectado con la prueba local/.test(s.text)));
  assert.equal(runner.state.telegram.detail, 'Conectado como @bot_de_prueba');
  const saved = readFileSync(process.env['PRUEBA_ENV_FILE']!, 'utf8');
  assert.match(saved, /^TELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ$/m);
  assert.match(saved, /^TELEGRAM_CHAT_ID=42$/m);
});

await runner.closeSession();
app.close();
fakeTelegram.close();
console.log(failed ? '\nFALLOS en la prueba de humo.' : '\nPrueba de humo OK.');
process.exit(failed ? 1 : 0);
