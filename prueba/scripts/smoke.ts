/**
 * Prueba de humo end-to-end en modo SIMULADO, sin red:
 *   bot (Chromium oculto) → web simulada (cola + login + zonas) → carrito
 *   → aviso a un Telegram FALSO local → pulsación de botón → decisión aplicada.
 *
 *   npm run prueba:smoke
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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

// --- App bajo prueba ------------------------------------------------------
const { loadConfig } = await import('../src/config.js');
const { Runner } = await import('../src/runner.js');
const { createAppServer } = await import('../src/server.js');
type RunStatus = import('../src/runner.js').RunStatus;

const cfg = loadConfig();
cfg.profileDir = mkdtempSync(path.join(tmpdir(), 'prueba-perfil-'));
cfg.humanWaitMs = 20_000;
const runner = new Runner(cfg);
const app = createAppServer(cfg, runner);
await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;

async function api(p: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

async function waitFor(statuses: RunStatus[], timeoutMs = 60_000): Promise<RunStatus> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (statuses.includes(runner.state.status)) return runner.state.status;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout esperando ${statuses.join('/')} (estado: ${runner.state.status})\n${runner.state.log.map((l) => l.message).join('\n')}`);
}

let failed = false;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failed = true;
    console.error(`✘ ${name}\n  ${(err as Error).stack ?? err}`);
  }
}

await step('cola + login + selección por preferencia → carrito → Telegram «Sí» abre el carrito', async () => {
  const { status, json } = await api('/api/prueba', {
    mode: 'simulado',
    quantity: 2,
    zones: 'Fondo Norte, Lateral Este',
    maxUnitPrice: '30',
    queue: true,
    headless: true,
  });
  assert.equal(status, 202);
  await waitFor(['CART_SECURED', 'FAILED']);
  assert.equal(runner.state.status, 'CART_SECURED', runner.state.error ?? '');
  const cart = runner.state.cart!;
  // Fondo Norte está agotado → pasa a Lateral Este (25 €).
  assert.deepEqual(cart.items.map((i) => [i.sectionLabel, i.qty, i.unitPrice]), [['Lateral Este', 2, 2500]]);
  assert.equal(cart.total, 5000);
  assert.ok(cart.expiresAt, 'debe leer la caducidad del carrito');
  assert.match(cart.url, /\/mock\/realmadrid_femenino\/checkout\/[a-f0-9]+$/);

  const msg = sent.find((s) => /Quieres comprar las entradas/.test(s.text));
  assert.ok(msg, 'debe enviar el aviso del carrito a Telegram');
  assert.equal(msg.method, 'sendPhoto');
  assert.match(msg.text, /2 × Lateral Este/);
  assert.match(msg.text, /Total:<\/b> 50,00 €/);
  assert.match(msg.text, /prueba@ejemplo\.com/);
  // URL local: Telegram no la acepta en un botón, va en el texto.
  assert.ok(msg.keyboard.flat().every((b) => !b.url));
  assert.match(msg.text, /checkout/);
  const yes = msg.keyboard.flat().find((b) => b.callback_data?.startsWith('comprar:'));
  assert.ok(yes);

  pendingPresses.push(yes.callback_data!);
  await waitFor(['OPENED']);
  assert.ok(sent.some((s) => /Completa|Carrito listo/.test(s.text)));
  // El carrito sigue vivo (no se ha pagado ni liberado).
  assert.equal((await fetch(cart.url)).status, 200);
  await runner.closeSession();
});

await step('«No, liberar» desde el panel libera el carrito', async () => {
  sent.length = 0;
  await api('/api/prueba', { mode: 'simulado', quantity: 1, zones: '', headless: true });
  await waitFor(['CART_SECURED', 'FAILED']);
  assert.equal(runner.state.status, 'CART_SECURED', runner.state.error ?? '');
  // Sin zonas: la más barata disponible (Fondo Sur, 15 €).
  assert.equal(runner.state.cart!.items[0]!.sectionLabel, 'Fondo Sur');
  const url = runner.state.cart!.url;
  const r = await api('/api/decision', { decision: 'cancelar' });
  assert.equal(r.status, 200);
  await waitFor(['CANCELLED']);
  assert.equal((await fetch(url)).status, 404);
  assert.ok(sent.some((s) => /no se compran/.test(s.text)));
});

await step('sin zona que cumpla el precio → pide ayuda humana; oculto → falla con mensaje claro', async () => {
  sent.length = 0;
  await api('/api/prueba', { mode: 'simulado', quantity: 2, maxUnitPrice: '10', headless: true });
  await waitFor(['FAILED']);
  assert.match(runner.state.error ?? '', /modo oculto/);
  assert.ok(sent.some((s) => /La prueba ha fallado/.test(s.text)));
});

await step('validación: modo real exige URL de tickets.realmadrid.com', async () => {
  const r = await api('/api/prueba', { mode: 'real', eventUrl: 'https://example.com/x' });
  assert.equal(r.status, 400);
  assert.match(String(r.json['error']), /tickets\.realmadrid\.com/);
});

await runner.closeSession();
app.close();
fakeTelegram.close();
console.log(failed ? '\nFALLOS en la prueba de humo.' : '\nPrueba de humo OK.');
process.exit(failed ? 1 : 0);
