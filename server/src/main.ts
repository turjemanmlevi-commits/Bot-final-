/**
 * Servidor del Ticket Orchestrator: API + stream + dashboard compilado.
 *   npm start           → producción local (sirve dashboard/dist)
 *   npm run dev         → recarga al cambiar el código del servidor
 */

import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { ENV_FILE, ENV_TEMPLATE, env } from './env';
import { APP_VERSION, createApp } from './app';
import { createHttpApp } from './http/app';
import { FeedControl } from './feeds/control';
import { EventWatcher } from './feeds/watcher';
import { asideName, probePglite } from './store/dbcheck';
import { MemoryDriver, PgliteDriver, PostgresDriver, type JournalDriver } from './store/drivers';
import { TelegramControl } from './telegram/control';
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

/** ¿Ya hay algo escuchando en nuestro puerto? (otra ventana con la sala de control abierta) */
async function portOwner(): Promise<'ours' | 'other' | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${env.port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const text = await res.text();
    return text.includes('"journal"') || text.includes('UNAUTHORIZED') ? 'ours' : 'other';
  } catch {
    return null;
  }
}

/**
 * La base de datos se prueba antes de abrirla. Si no se puede abrir, se aparta
 * (se renombra, no se borra) y se crea una nueva. Devuelve el aviso, si lo hay.
 */
async function checkDatabase(): Promise<string | null> {
  if (env.journalDriver !== 'pglite') return null;
  const dir = path.join(env.dataDir, 'pglite');
  if (!existsSync(dir)) return null;
  const probe = await probePglite(dir);
  if (probe.ok) return null;
  log.error('La base de datos no se puede abrir', { carpeta: dir, error: probe.error });
  const aside = asideName(dir);
  try {
    await rename(dir, aside);
  } catch (err) {
    log.error(
      `La carpeta de la base de datos está bloqueada por otro programa (${(err as Error).message}). Cierra las demás ventanas negras de la sala de control (o reinicia el ordenador) y vuelve a abrir «Sala de control».`,
    );
    process.exit(1);
  }
  const notice = `La base de datos anterior no se podía abrir: se ha guardado aparte en ${aside} y se ha creado una nueva. Las cuentas y operaciones de antes no están: vuelve a crearlas.`;
  log.warn(notice);
  return notice;
}

async function main(): Promise<void> {
  const owner = await portOwner();
  if (owner === 'ours') {
    console.log('');
    console.log(`  La sala de control YA está abierta en http://localhost:${env.port} (en otra ventana).`);
    console.log('  Usa esa: no hace falta abrirla dos veces. Para reiniciarla, cierra su ventana negra y vuelve a abrir «Sala de control».');
    console.log('');
    process.exit(0);
  }
  if (owner === 'other') {
    log.error(`El puerto ${env.port} lo está usando otro programa. Ciérralo o pon otro puerto en el archivo .env (PORT=${env.port + 1}).`);
    process.exit(1);
  }

  const dbNotice = await checkDatabase();
  const notifier = env.telegramToken
    ? new TelegramNotifier({ token: env.telegramToken, chatId: env.telegramChatId, apiBase: env.telegramApiBase, timeZone: env.timeZone })
    : null;
  const appOptions = {
    vaultDir: existsSync(env.vaultDir) ? env.vaultDir : null,
    timeZone: env.timeZone,
    publicBaseUrl: env.publicBaseUrl,
    simSeed: env.simSeed,
    notifier,
    watchVault: true,
    cfg: { humanTaskDeadlineMs: env.manualTaskMinutes * 60_000 },
  };
  let app;
  let inMemory = false;
  try {
    app = await createApp({ ...appOptions, driver: makeDriver() });
  } catch (err) {
    log.error('No se pudo abrir la base de datos', { error: (err as Error).message });
    if (env.journalDriver !== 'pglite') process.exit(1);
    // Mejor funcionar hoy sin guardar que no arrancar: queda avisado en el dashboard.
    log.warn('Se arranca SIN guardar (solo en memoria): funciona, pero al cerrar esta ventana se pierden cuentas y operaciones.');
    app = await createApp({ ...appOptions, driver: new MemoryDriver() });
    inMemory = true;
  }
  if (dbNotice) {
    app.runtime.ctx.alerts.raise({ kind: 'RECOVERY_REQUIRED', severity: 'WARNING', title: 'Base de datos nueva', message: dbNotice, dedupeKey: 'db:aside' });
  }
  if (inMemory) {
    app.runtime.ctx.alerts.raise({
      kind: 'JOURNAL_DEGRADED',
      severity: 'CRITICAL',
      title: 'Los datos no se están guardando',
      message: `No se pudo abrir la base de datos en ${path.join(env.dataDir, 'pglite')}: todo funciona, pero al cerrar la ventana negra se pierden cuentas y operaciones. Cierra la ventana y vuelve a abrir «Sala de control» cuando puedas.`,
      dedupeKey: 'db:memory',
    });
  }
  // Telegram se puede configurar (o cambiar) desde el dashboard sin reiniciar.
  const telegram = new TelegramControl(
    { runtime: app.runtime, apiBase: env.telegramApiBase, timeZone: env.timeZone, envFile: ENV_FILE, envTemplate: ENV_TEMPLATE },
    { token: env.telegramToken, chatId: env.telegramChatId, notifier },
  );

  // Fuentes oficiales de eventos (Ticketmaster, partidos) y vigilancia antes de la venta.
  const feeds = new FeedControl(
    {
      runtime: app.runtime,
      timeZone: env.timeZone,
      envFile: ENV_FILE,
      envTemplate: ENV_TEMPLATE,
      ticketmasterBase: env.ticketmasterApiBase,
      footballBase: env.footballApiBase,
    },
    { ticketmasterKey: env.ticketmasterKey, footballToken: env.footballDataToken },
  );
  const watcher = new EventWatcher({ app, feeds, timeZone: env.timeZone });
  watcher.start();

  const dist = existsSync(path.join(env.dashboardDist, 'index.html')) ? env.dashboardDist : null;
  const http = createHttpApp(app, { dashboardDist: dist ?? env.dashboardDist, operatorToken: env.operatorToken, telegram, feeds });
  const server = serve({ fetch: http.fetch, port: env.port, hostname: env.host }, (info) => {
    const url = `http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${info.port}`;
    console.log('');
    console.log(`  Ticket Orchestrator v${APP_VERSION}`);
    console.log(`  ─────────────────────────────────────────────`);
    console.log(`  Dashboard   ${dist ? url : `${url}  (sin compilar: npm run build, o npm run dev:dashboard → http://localhost:5173)`}`);
    console.log(`  API         ${url}/api/state`);
    console.log(`  Vault       ${env.vaultDir}${existsSync(env.vaultDir) ? '' : '  (NO EXISTE)'}`);
    console.log(
      `  Journal     ${inMemory ? 'SOLO EN MEMORIA (no se guarda: lee el aviso de arriba)' : `${env.journalDriver}${env.journalDriver === 'pglite' ? ` → ${path.join(env.dataDir, 'pglite')}` : ''}`}`,
    );
    console.log(
      `  Telegram    ${notifier ? (env.telegramChatId ? `activado (chat ${env.telegramChatId})` : 'bot conectado; falta el chat principal: ábrelo en Telegram, pulsa «Iniciar» y elígelo en Ajustes · Telegram') : 'sin configurar: pega el token de tu bot en el dashboard → Ajustes · Telegram'}`,
    );
    const sources = [env.ticketmasterKey ? 'Ticketmaster' : null, env.footballDataToken ? 'partidos' : null].filter(Boolean);
    console.log(`  Eventos     ${sources.length > 0 ? `fuentes oficiales: ${sources.join(' y ')}` : 'sin fuentes oficiales: pon la clave gratuita en Ajustes · Fuentes de eventos'}`);
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
    telegram.stop();
    watcher.stop();
    server.close();
    await app.stop().catch((err: Error) => log.error('Error al cerrar', { error: err.message }));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // Windows: cerrar la ventana negra (SIGHUP) o Ctrl+Pausa (SIGBREAK) también cierran bien la base de datos.
  process.on('SIGHUP', () => void shutdown('SIGHUP'));
  if (process.platform === 'win32') process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
}

void main();
