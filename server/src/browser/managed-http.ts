import type { Hono } from 'hono';
import { z } from 'zod';
import { BrowserBridgeError } from './bridge';
import type { ManagedBrowserService } from './managed';

export function managedBrowserRoutes(http: Hono, service: ManagedBrowserService): void {
  http.use('/api/managed/*', async (c, next) => {
    const target = new URL(c.req.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new BrowserBridgeError('Usa la sala de control en este PC', 'FORBIDDEN');
    const origin = c.req.header('origin');
    if (origin && origin !== target.origin) throw new BrowserBridgeError('Petición desde otra web rechazada', 'FORBIDDEN');
    if (c.req.header('sec-fetch-site') === 'cross-site') throw new BrowserBridgeError('Petición desde otra web rechazada', 'FORBIDDEN');
    if (c.req.method !== 'GET' && !c.req.header('content-type')?.startsWith('application/json')) throw new BrowserBridgeError('Se esperaba JSON', 'INVALID_REQUEST');
    await next();
  });
  http.get('/api/managed/status', (c) => c.json(service.status()));
  http.get('/api/managed/tests', (c) => c.json(service.plans()));
  http.post('/api/managed/accounts/:id/open', async (c) => c.json(await service.open(c.req.param('id'))));
  http.post('/api/managed/tests', async (c) => {
    const input = z.object({ accountId: z.string().min(1), eventId: z.string().min(1) }).strict().safeParse(await c.req.json());
    if (!input.success) throw new BrowserBridgeError('Selecciona cuenta y evento', 'INVALID_REQUEST');
    return c.json(service.prepare(input.data.eventId, input.data.accountId));
  });
  http.post('/api/managed/tests/:id/approve', (c) => c.json(service.approveConnected(c.req.param('id'))));
  http.post('/api/managed/tests/:id/stop', (c) => c.json(service.stopTest(c.req.param('id'))));
}
