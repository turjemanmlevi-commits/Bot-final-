/**
 * Servidor del Ticket Orchestrator: API + stream + dashboard compilado.
 *   npm start           → producción local (sirve dashboard/dist)
 *   npm run dev         → recarga al cambiar el código del servidor
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { env } from './env';
import { APP_VERSION, createApp } from './app';
import { createHttpApp } from './http/app';
import { MemoryDriver, PgliteDriver, PostgresDriver, type JournalDriver } from './store/drivers';
import { TelegramNotifier } from './telegram/telegram';
import { log } from './util/log';

function makeDriver(): JournalDriver {
  switch (env.journalDriver) {
    case 'memory':
      return new MemoryDriver();
    case 'postgres':
      if (!env.databaseUrl) throw new Error('JOURNAL_DRIVER=postgres necesita DATABASE_URL');
      return new PostgresDriver(env.databaseUrl);
    default:
      return new PgliteDriver(path.join(env.dataDir, 'pglite'));
  }
}

// Un error inesperado se registra, pero no apaga el servidor en mitad de una compra.
process.on('unhandledRejection', (reason) => {
  log.error('Error no controlado (el servidor sigue en marcha)', { error: reason instanceof Error ? reason.message : String(reason) });
});

async function main(): Promise<void> {
  const notifier = env.telegramToken
    ? new TelegramNotifier({ token: env.telegramToken, chatId: env.telegramChatId, apiBase: env.telegramApiBase, timeZone: env.timeZone })
    : null;
  let app;
  try {
    app = await createApp({
      driver: makeDriver(),
      vaultDir: existsSync(env.vaultDir) ? env.vaultDir : null,
      timeZone: env.timeZone,
      publicBaseUrl: env.publicBaseUrl,
      simSeed: env.simSeed,
      notifier,
      watchVault: true,
      cfg: { humanTaskDeadlineMs: env.manualTaskMinutes * 60_000 },
    });
  } catch (err) {
    log.error('No se pudo arrancar', { error: (err as Error).message });
    if (env.journalDriver === 'pglite') {
      log.error(`¿Hay otro servidor usando ${path.join(env.dataDir, 'pglite')}? Ciérralo o usa JOURNAL_DRIVER=memory.`);
    }
    process.exit(1);
  }
  notifier?.attach(app.runtime);

  const dist = existsSync(path.join(env.dashboardDist, 'index.html')) ? env.dashboardDist : null;
  const http = createHttpApp(app, { dashboardDist: dist ?? env.dashboardDist, operatorToken: env.operatorToken });
  const server = serve({ fetch: http.fetch, port: env.port, hostname: env.host }, (info) => {
    const url = `http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${info.port}`;
    console.log('');
    console.log(`  Ticket Orchestrator v${APP_VERSION}`);
    console.log(`  ─────────────────────────────────────────────`);
    console.log(`  Dashboard   ${dist ? url : `${url}  (sin compilar: npm run build, o npm run dev:dashboard → http://localhost:5173)`}`);
    console.log(`  API         ${url}/api/state`);
    console.log(`  Vault       ${env.vaultDir}${existsSync(env.vaultDir) ? '' : '  (NO EXISTE)'}`);
    console.log(`  Journal     ${env.journalDriver}${env.journalDriver === 'pglite' ? ` → ${path.join(env.dataDir, 'pglite')}` : ''}`);
    console.log(
      `  Telegram    ${notifier ? (env.telegramChatId ? `activado (chat ${env.telegramChatId})` : 'token puesto, falta TELEGRAM_CHAT_ID: escribe /start al bot') : 'desactivado (ver «Configurar Telegram» en la guía)'}`,
    );
    console.log('');
    console.log('  Demo: botón "Nueva demo" en el dashboard, o  npm run seed:demo');
    console.log('');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`El puerto ${env.port} ya está en uso: ¿hay otro servidor abierto? Ciérralo (Ctrl+C en su terminal) o arranca con PORT=${env.port + 1}.`);
    } else {
      log.error('Error del servidor HTTP', { error: err.message });
    }
    void app.stop().finally(() => process.exit(1));
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info(`Cerrando (${signal})…`);
    notifier?.stop();
    server.close();
    await app.stop().catch((err: Error) => log.error('Error al cerrar', { error: err.message }));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
