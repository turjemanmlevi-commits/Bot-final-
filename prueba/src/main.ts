import { spawn } from 'node:child_process';
import { loadConfig } from './config.js';
import { Runner } from './runner.js';
import { createAppServer } from './server.js';

const cfg = loadConfig();
const runner = new Runner(cfg);
const server = createAppServer(cfg, runner);

/** Abre el panel en el navegador por defecto (desactivable con PRUEBA_ABRIR=0). */
function openBrowser(url: string): void {
  if (process.env['PRUEBA_ABRIR'] === '0') return;
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    // Sin navegador disponible: la URL ya está impresa en consola.
  }
}

server.once('listening', () => {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : cfg.port;
  const url = `http://127.0.0.1:${port}`;
  console.log('');
  console.log('  ================================================');
  console.log(`   PANEL DE LA PRUEBA:  ${url}`);
  console.log('  ================================================');
  console.log(`  Web simulada:  ${url}/mock/realmadrid_femenino/select/9000001`);
  console.log('  Deja esta ventana abierta mientras uses el panel (Ctrl+C para cerrar).');
  console.log('');
  void runner.checkTelegram().then(() => console.log(`  Telegram: ${runner.state.telegram.detail}\n`));
  openBrowser(url);
});

/** Si el puerto está ocupado (p. ej. por otro dashboard), prueba los siguientes. */
function listen(port: number, attemptsLeft: number): void {
  const onError = (err: NodeJS.ErrnoException): void => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  El puerto ${port} está ocupado, pruebo el ${port + 1}…`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(`\n  No se ha podido arrancar el servidor: ${err.message}\n`);
      process.exit(1);
    }
  };
  server.once('error', onError);
  server.once('listening', () => server.off('error', onError));
  server.listen(port, cfg.host);
}

listen(cfg.port, 10);

const shutdown = (): void => {
  runner.stop();
  void runner.closeSession().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
