/**
 * Servidor local que imita la Bot API de Telegram (para las pruebas).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const TOKEN = '123456:TEST';

export interface Sent {
  method: string;
  body: Record<string, unknown>;
  /** Hora de llegada (Date.now()). */
  at?: number;
}

/** Fallo programado: 429 con retry_after, 500, página 502 en HTML o sin respuesta. */
export type Fault = { status: 429; retryAfter: number } | { status: 500 } | { status: 502; html: true } | { hang: true };

export class FakeTelegram {
  server: Server;
  sent: Sent[] = [];
  /** Peticiones contestadas con un fallo programado. */
  refused: Sent[] = [];
  /** Conexiones TCP abiertas por el bot. */
  connections = 0;
  /** Cuánto espera getUpdates sin novedades (Telegram real: hasta 25 s). */
  pollHoldMs = 150;
  private faults = new Map<string, Fault[]>();
  private hung: Array<() => void> = [];
  private updates: unknown[] = [];
  private nextId = 1;
  private waiting: Array<() => void> = [];

  constructor(
    readonly token = TOKEN,
    readonly username = 'orquestador_prueba_bot',
  ) {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
        let replied = false;
        const reply = (json: unknown, status = 200) => {
          if (replied) return;
          replied = true;
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(json));
        };
        if (!m || m[1] !== this.token) return reply({ ok: false, error_code: 401, description: 'Unauthorized' });
        const method = m[2] as string;
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const fault = this.faults.get(method)?.shift();
        if (fault) {
          // Como Telegram cuando se cae, pide esperar o no contesta.
          this.refused.push({ method, body, at: Date.now() });
          if ('hang' in fault) return void this.hung.push(() => res.destroy());
          if (fault.status === 502) {
            res.writeHead(502, { 'content-type': 'text/html' });
            return void res.end('<html><body><h1>502 Bad Gateway</h1></body></html>');
          }
          if (fault.status === 429) {
            return reply({ ok: false, error_code: 429, description: `Too Many Requests: retry after ${fault.retryAfter}`, parameters: { retry_after: fault.retryAfter } }, 429);
          }
          return reply({ ok: false, error_code: 500, description: 'Internal Server Error' }, 500);
        }
        if (method === 'getMe') return reply({ ok: true, result: { id: 1, is_bot: true, username: this.username } });
        if (method === 'getUpdates') {
          const offset = Number(body.offset ?? 0);
          // Como Telegram: pedir desde `offset` confirma (y borra) las anteriores.
          this.updates = (this.updates as Array<{ update_id: number }>).filter((u) => u.update_id >= offset);
          const flush = () => {
            const out = (this.updates as Array<{ update_id: number }>).filter((u) => u.update_id >= offset);
            reply({ ok: true, result: out });
          };
          if ((this.updates as Array<{ update_id: number }>).some((u) => u.update_id >= offset)) return flush();
          const t = setTimeout(flush, this.pollHoldMs);
          this.waiting.push(() => {
            clearTimeout(t);
            flush();
          });
          return;
        }
        this.sent.push({ method, body, at: Date.now() });
        if (method === 'sendMessage' && body.chat_id === '404') return reply({ ok: false, error_code: 400, description: 'Bad Request: chat not found' });
        if (method === 'sendMessage') return reply({ ok: true, result: { message_id: this.sent.length } });
        return reply({ ok: true, result: true });
      });
    });
  }

  /** Las próximas llamadas a `method` fallan así, una por fallo. */
  fail(method: string, ...faults: Fault[]): void {
    this.faults.set(method, [...(this.faults.get(method) ?? []), ...faults]);
  }

  /** Olvida los fallos programados que no se hayan usado. */
  clearFaults(): void {
    this.faults.clear();
  }

  async listen(): Promise<string> {
    this.server.on('connection', () => this.connections++);
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
    for (const fn of this.hung) fn();
    return new Promise((r) => this.server.close(() => r()));
  }
}

export async function until(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`Tiempo agotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
