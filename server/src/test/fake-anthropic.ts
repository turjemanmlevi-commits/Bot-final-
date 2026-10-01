/**
 * Servidor local que imita la API de Claude (para las pruebas): lista de
 * modelos y /v1/messages en streaming (SSE), con respuestas guionizadas.
 * Nunca sale a internet ni usa una clave real.
 */

import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const AI_KEY = 'sk-ant-api03-prueba-local-0123456789abcdef';

export interface FakeBlock {
  type: string;
  [k: string]: unknown;
}

export interface FakeReply {
  content: FakeBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'pause_turn' | 'refusal' | 'max_tokens';
  /** Tarda en contestar (para comprobar que el bot no se queda esperando). */
  delayMs?: number;
  /** Empieza a contestar y se queda callada (la conexión sigue abierta): para el tope de tiempo. */
  stall?: boolean;
  /** Empieza a contestar y corta la conexión a mitad. */
  cut?: boolean;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    /** Lo leído de la caché y lo guardado en ella (la API los cuenta aparte de input_tokens). */
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number };
  };
}

export interface FakeError {
  status: number;
  type: string;
  message: string;
}

export interface SeenRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/** Modelos de la cuenta de prueba (nombres inventados). */
export const FAKE_MODELS = [
  { id: 'claude-sonnet-prueba', display_name: 'Sonnet de prueba', created_at: '2026-09-01T00:00:00Z', type: 'model' },
  { id: 'claude-opus-prueba-nuevo', display_name: 'Opus de prueba (nuevo)', created_at: '2026-08-01T00:00:00Z', type: 'model' },
  { id: 'claude-opus-prueba-viejo', display_name: 'Opus de prueba (viejo)', created_at: '2026-01-01T00:00:00Z', type: 'model' },
  // Sin la búsqueda web que se usa: no se ofrecen para elegir.
  { id: 'claude-opus-4-5-20251101', display_name: 'Claude Opus 4.5', created_at: '2025-11-01T00:00:00Z', type: 'model' },
  { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z', type: 'model' },
];

export class FakeAnthropic {
  server: Server;
  requests: SeenRequest[] = [];
  /** Respuestas de /v1/messages, en orden (una función puede mirar la petición). */
  script: Array<FakeReply | FakeError | ((body: Record<string, unknown>) => FakeReply | FakeError)> = [];

  constructor(readonly key = AI_KEY) {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const json = (status: number, payload: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_prueba' });
          res.end(JSON.stringify(payload));
        };
        const error = (status: number, type: string, message: string) => json(status, { type: 'error', error: { type, message } });
        if (req.headers['x-api-key'] !== this.key) return error(401, 'authentication_error', 'invalid x-api-key');
        this.requests.push({ path: url.pathname, headers: req.headers, body });
        if (req.method === 'GET' && url.pathname === '/v1/models') {
          return json(200, { data: FAKE_MODELS, has_more: false, first_id: FAKE_MODELS[0]?.id, last_id: FAKE_MODELS.at(-1)?.id });
        }
        if (req.method === 'POST' && url.pathname === '/v1/messages') {
          const next = this.script.shift();
          if (!next) return error(500, 'api_error', 'La prueba no tiene más respuestas guionizadas');
          const reply = typeof next === 'function' ? next(body) : next;
          if ('status' in reply) return error(reply.status, reply.type, reply.message);
          if (body.stream !== true) return error(400, 'invalid_request_error', 'La prueba espera streaming');
          if (reply.delayMs) {
            setTimeout(() => this.stream(res, String(body.model), reply), reply.delayMs);
            return;
          }
          return this.stream(res, String(body.model), reply);
        }
        return error(404, 'not_found_error', `No existe ${url.pathname}`);
      });
    });
  }

  /** Emite la respuesta como lo hace la API: eventos SSE bloque a bloque. */
  private stream(res: import('node:http').ServerResponse, model: string, reply: FakeReply): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': 'req_prueba' });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const usage = { input_tokens: reply.usage?.input_tokens ?? 1000, output_tokens: reply.usage?.output_tokens ?? 200 };
    send('message_start', {
      type: 'message_start',
      message: { id: `msg_${this.requests.length}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 1 } },
    });
    if (reply.stall) return;
    if (reply.cut) {
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Buscando…' } });
      setTimeout(() => res.socket?.destroy(), 50);
      return;
    }
    reply.content.forEach((block, index) => {
      if (block.type === 'text') {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: String(block.text ?? '') } });
      } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        send('content_block_start', { type: 'content_block_start', index, content_block: { ...block, input: {} } });
        send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) } });
      } else {
        send('content_block_start', { type: 'content_block_start', index, content_block: block });
      }
      send('content_block_stop', { type: 'content_block_stop', index });
    });
    send('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: reply.stop_reason, stop_sequence: null },
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        ...(reply.usage?.cache_read_input_tokens !== undefined ? { cache_read_input_tokens: reply.usage.cache_read_input_tokens } : {}),
        ...(reply.usage?.cache_creation_input_tokens !== undefined ? { cache_creation_input_tokens: reply.usage.cache_creation_input_tokens } : {}),
        ...(reply.usage?.server_tool_use ? { server_tool_use: reply.usage.server_tool_use } : {}),
      },
    });
    send('message_stop', { type: 'message_stop' });
    res.end();
  }

  messageRequests(): SeenRequest[] {
    return this.requests.filter((r) => r.path === '/v1/messages');
  }

  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  close(): Promise<void> {
    return new Promise((r) => {
      this.server.close(() => r());
      // Las respuestas que se han quedado calladas (stall) también se cierran.
      this.server.closeAllConnections();
    });
  }
}

/** Claude ha buscado en la web y la vuelta se ha pausado (hay que reanudarla). */
export function pausedSearch(query: string): FakeReply {
  return {
    content: [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: [{ type: 'web_search_result', url: 'https://www.realmadrid.com/es-ES/entradas', title: 'Entradas', encrypted_content: 'x', page_age: null }],
      },
    ],
    stop_reason: 'pause_turn',
    usage: { input_tokens: 3000, output_tokens: 300, server_tool_use: { web_search_requests: 1 } },
  };
}

/** Claude entrega el resultado llamando a la herramienta. */
export function deliver(name: string, input: Record<string, unknown>, searches = 2, fetches = 1): FakeReply {
  return {
    content: [
      { type: 'text', text: 'Hecho.' },
      { type: 'tool_use', id: 'toolu_1', name, input },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 20_000, output_tokens: 1500, server_tool_use: { web_search_requests: searches, web_fetch_requests: fetches } },
  };
}
