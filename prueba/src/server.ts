/**
 * Servidor local: panel de la prueba (/), API (/api/*) y la réplica simulada (/mock/*).
 * Escucha solo en 127.0.0.1 por defecto.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import type { PruebaConfig } from './config.js';
import type { RunOptions } from './bot.js';
import { handleMock, MOCK_CHANNEL_PATH, MOCK_EVENT_PATH } from './mock-site.js';
import { panelHtml } from './panel.js';
import type { Runner } from './runner.js';

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export interface MockFlags {
  /** Entrar por el canal (catálogo → partido → sesión) en vez de por la URL del partido. */
  entry: 'canal' | 'partido';
  queue: boolean;
  challenge: boolean;
  login: boolean;
  /** Zonas con botón «Buscar asientos» (selección automática). */
  auto: boolean;
  /** Lista de zonas sin plano. */
  list: boolean;
}

export function mockEventUrl(cfg: PruebaConfig, port: number, flags: Partial<MockFlags> = {}): string {
  const base = `http://${cfg.host}:${port}${flags.entry === 'canal' ? MOCK_CHANNEL_PATH : MOCK_EVENT_PATH}`;
  const q = new URLSearchParams();
  if (flags.queue) q.set('cola', '1');
  if (flags.challenge) q.set('reto', '1');
  if (flags.login === false) q.set('login', '0');
  if (flags.auto) q.set('auto', '1');
  if (flags.list) q.set('lista', '1');
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** Valida lo que llega del panel y lo convierte en opciones de ejecución. */
export function parseRunOptions(body: Record<string, unknown>, cfg: PruebaConfig, port: number): RunOptions {
  const mode = body['mode'] === 'real' ? 'real' : 'simulado';
  const quantity = Number(body['quantity'] ?? cfg.defaults.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error('La cantidad debe estar entre 1 y 10.');
  const zones = String(body['zones'] ?? '')
    .split(',')
    .map((z) => z.trim())
    .filter(Boolean);
  const rawMax = String(body['maxUnitPrice'] ?? '').trim().replace(',', '.');
  const maxEur = rawMax === '' ? null : Number(rawMax);
  if (maxEur !== null && (!Number.isFinite(maxEur) || maxEur <= 0)) throw new Error('El precio máximo no es válido.');
  const contiguous = body['contiguous'] === undefined ? cfg.defaults.contiguous : body['contiguous'] === true || body['contiguous'] === 'true' || body['contiguous'] === 1;

  let eventUrl: string;
  if (mode === 'simulado') {
    eventUrl = mockEventUrl(cfg, port, {
      entry: body['entry'] === 'canal' ? 'canal' : 'partido',
      queue: body['queue'] === true,
      challenge: body['challenge'] === true,
      login: body['login'] !== false,
      auto: body['auto'] === true,
      list: body['list'] === true,
    });
  } else {
    eventUrl = String(body['eventUrl'] ?? '').trim();
    if (eventUrl) {
      let u: URL;
      try {
        u = new URL(eventUrl);
      } catch {
        throw new Error('La URL del partido no es válida. Déjala vacía para que el bot elija el próximo partido del femenino.');
      }
      if (u.protocol !== 'https:' || !/(^|\.)(realmadrid\.com|oneboxtds\.com)$/.test(u.hostname)) {
        throw new Error('En modo real la URL debe ser de tickets.realmadrid.com (o vacía: el bot elige el próximo partido del femenino).');
      }
    }
  }
  return {
    mode,
    eventUrl,
    quantity,
    zones,
    maxUnitPrice: maxEur === null ? null : Math.round(maxEur * 100),
    contiguous,
    // En modo real la ventana siempre es visible: puede hacer falta que intervengas.
    headless: mode === 'simulado' && body['headless'] === true,
  };
}

export function createAppServer(cfg: PruebaConfig, runner: Runner): Server {
  let port = cfg.port;
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      try {
        if (await handleMock(req, res, url)) return;

        if (url.pathname === '/' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            panelHtml({
              realEventUrl: cfg.defaults.realEventUrl,
              quantity: cfg.defaults.quantity,
              zones: cfg.defaults.zones.join(', '),
              maxUnitPriceEur: cfg.defaults.maxUnitPriceEur,
              contiguous: cfg.defaults.contiguous,
            }),
          );
          return;
        }
        if (url.pathname === '/api/estado' && req.method === 'GET') return json(res, 200, runner.state);
        if (url.pathname === '/api/eventos' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          const push = (s: unknown): void => void res.write(`data: ${JSON.stringify(s)}\n\n`);
          push(runner.state);
          runner.on('state', push);
          const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
          req.on('close', () => {
            clearInterval(ping);
            runner.off('state', push);
          });
          return;
        }
        if (url.pathname === '/api/prueba' && req.method === 'POST') {
          const opts = parseRunOptions(await readJson(req), cfg, port);
          return json(res, 202, { id: runner.start(opts) });
        }
        if (url.pathname === '/api/telegram' && req.method === 'POST') {
          const body = await readJson(req);
          const username = await runner.configureTelegram(String(body['token'] ?? ''), String(body['chatId'] ?? ''));
          return json(res, 200, { ok: true, username });
        }
        if (url.pathname === '/api/decision' && req.method === 'POST') {
          const body = await readJson(req);
          const d = body['decision'];
          if (d !== 'comprar' && d !== 'cancelar') return json(res, 400, { error: 'decision debe ser comprar o cancelar' });
          return runner.decide(d, 'panel') ? json(res, 200, { ok: true }) : json(res, 409, { error: 'No hay ningún carrito pendiente de decisión.' });
        }
        if (url.pathname === '/api/parar' && req.method === 'POST') {
          runner.stop();
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/captura' && req.method === 'GET') {
          const file = runner.state.cart?.screenshot;
          if (!file) return json(res, 404, { error: 'Sin captura' });
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
          createReadStream(file).on('error', () => res.end()).pipe(res);
          return;
        }
        json(res, 404, { error: 'No encontrado' });
      } catch (err) {
        if (!res.headersSent) json(res, 400, { error: (err as Error).message });
        else res.end();
      }
    })();
  });
  server.on('listening', () => {
    const addr = server.address();
    if (addr && typeof addr === 'object') port = addr.port;
  });
  return server;
}
