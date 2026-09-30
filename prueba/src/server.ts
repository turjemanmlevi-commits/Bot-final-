/**
 * Servidor local: panel de la prueba (/), API (/api/*) y la réplica simulada (/mock/*).
 * Escucha solo en 127.0.0.1 por defecto.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import type { PruebaConfig } from './config.js';
import type { RunOptions } from './bot.js';
import { handleMock, MOCK_EVENT_PATH } from './mock-site.js';
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

export function mockEventUrl(cfg: PruebaConfig, port: number): string {
  return `http://${cfg.host}:${port}${MOCK_EVENT_PATH}`;
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

  let eventUrl: string;
  if (mode === 'simulado') {
    eventUrl = mockEventUrl(cfg, port) + (body['queue'] === true ? '?cola=1' : '');
  } else {
    eventUrl = String(body['eventUrl'] ?? '').trim();
    let u: URL;
    try {
      u = new URL(eventUrl);
    } catch {
      throw new Error('Pon la URL del partido (la de «Comprar entradas» en realmadrid.com).');
    }
    if (u.protocol !== 'https:' || !/(^|\.)(realmadrid\.com|oneboxtds\.com)$/.test(u.hostname)) {
      throw new Error('En modo real la URL debe ser de tickets.realmadrid.com (o oneboxtds.com).');
    }
  }
  return {
    mode,
    eventUrl,
    quantity,
    zones,
    maxUnitPrice: maxEur === null ? null : Math.round(maxEur * 100),
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
          res.end(panelHtml({ realEventUrl: cfg.defaults.realEventUrl, quantity: cfg.defaults.quantity, zones: cfg.defaults.zones.join(', '), maxUnitPriceEur: cfg.defaults.maxUnitPriceEur }));
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
