import { loadConfig } from './config.js';
import { Runner } from './runner.js';
import { createAppServer } from './server.js';

const cfg = loadConfig();
const runner = new Runner(cfg);
const server = createAppServer(cfg, runner);

server.listen(cfg.port, cfg.host, () => {
  console.log('');
  console.log(`  Panel de la prueba:  http://${cfg.host}:${cfg.port}`);
  console.log(`  Web simulada:        http://${cfg.host}:${cfg.port}/mock/realmadrid_femenino/select/9000001`);
  console.log(`  Telegram:            ${runner.state.telegram.detail}`);
  console.log('');
  void runner.checkTelegram().then(() => console.log(`  Telegram:            ${runner.state.telegram.detail}`));
});

const shutdown = (): void => {
  runner.stop();
  void runner.closeSession().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
