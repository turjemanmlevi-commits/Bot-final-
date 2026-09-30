// Inspection only: copied data, no Telegram, no API keys, no external watchers.
import path from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../server/src/app';
import { createHttpApp } from '../server/src/http/app';
import { PgliteDriver } from '../server/src/store/drivers';

const app = await createApp({
  driver: new PgliteDriver(path.resolve('../inspection-data/pglite')),
  vaultDir: path.resolve('vault'), timeZone: 'Europe/Madrid',
  publicBaseUrl: 'http://localhost:8789', watchVault: false, notifier: null,
});
const http = createHttpApp(app, { dashboardDist: path.resolve('dashboard/dist'), operatorToken: null });
const server = serve({ fetch: http.fetch, hostname: '127.0.0.1', port: 8789 }, () => console.log('Preview copied data: http://localhost:8789'));
async function stop() { server.close(); await app.stop(); process.exit(0); }
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
