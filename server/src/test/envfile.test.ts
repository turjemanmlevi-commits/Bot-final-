/**
 * El archivo .env tal como lo deja un usuario de Windows: guardado con BOM o
 * en UTF-16 por el Bloc de notas, con una variable de Windows del mismo
 * nombre, y con varias claves guardadas a la vez desde el dashboard.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { decodeEnvText, loadEnvInto, updateEnvFile } from '../util/envfile';

const SERVER_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPO_ROOT = path.resolve(SERVER_DIR, '..');

const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

/** env.ts de verdad, en un proceso aparte (lee el .env al importarse). Solo con las variables indicadas. */
function loadEnvModule(vars: Record<string, string>): Promise<{ anthropicKey: string | null; port: number; publicBaseUrl: string; shadowed: string[] }> {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(path.join(SERVER_DIR, 'src', 'env.ts')).href)});
console.log(JSON.stringify({ anthropicKey: m.env.anthropicKey, port: m.env.port, publicBaseUrl: m.env.publicBaseUrl, shadowed: m.ENV_LOAD.shadowed }));`;
  const base = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR'].flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])));
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: SERVER_DIR, env: { ...base, ...vars } }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${err.message}\n${stderr}`));
      resolve(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}'));
    });
  });
}

describe('.env guardado por el Bloc de notas', () => {
  it('se entiende con BOM, en UTF-16 (LE y BE) y en ANSI', () => {
    assert.equal(decodeEnvText(Buffer.from('\uFEFFANTHROPIC_API_KEY=x\r\n', 'utf8')), 'ANTHROPIC_API_KEY=x\r\n');
    assert.equal(decodeEnvText(utf16le('PORT=9000\r\n')), 'PORT=9000\r\n');
    assert.equal(decodeEnvText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('PORT=9000\n', 'utf16le').swap16()])), 'PORT=9000\n');
    assert.equal(decodeEnvText(Buffer.from('VAULT_DIR=C:\\Users\\Leviç\\vault\n', 'latin1')), 'VAULT_DIR=C:\\Users\\Leviç\\vault\n');
    assert.equal(decodeEnvText(Buffer.from('VAULT_DIR=C:\\Users\\José\\vault\n', 'utf8')), 'VAULT_DIR=C:\\Users\\José\\vault\n');
  });

  let dir = '';
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'to-envfile-'));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('una clave en la 1.ª línea de un .env con BOM se lee (no queda «\\uFEFFANTHROPIC_API_KEY»)', async () => {
    const file = path.join(dir, 'bom.env');
    await writeFile(file, '\uFEFFANTHROPIC_API_KEY=sk-ant-buena\r\nPORT=8799\r\n');
    const target: NodeJS.ProcessEnv = {};
    loadEnvInto(file, target);
    assert.equal(target.ANTHROPIC_API_KEY, 'sk-ant-buena');
    assert.equal(target.PORT, '8799');
    assert.deepEqual(Object.keys(target).sort(), ['ANTHROPIC_API_KEY', 'PORT']);
  });

  it('las claves del dashboard mandan sobre una variable de Windows con el mismo nombre; el resto, no', async () => {
    const file = path.join(dir, 'sombra.env');
    await writeFile(file, 'ANTHROPIC_API_KEY=sk-ant-buena\nTELEGRAM_BOT_TOKEN=\nTICKETMASTER_API_KEY=igual\nPORT=8787\n');
    const target: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'sk-ant-vieja-revocada', TELEGRAM_BOT_TOKEN: '1:del-sistema', TICKETMASTER_API_KEY: 'igual', PORT: '9000' };
    const shadowed = loadEnvInto(file, target);
    assert.equal(target.ANTHROPIC_API_KEY, 'sk-ant-buena');
    assert.deepEqual(shadowed, ['ANTHROPIC_API_KEY']);
    // Vacía en el .env: sigue la del sistema. PORT (y el resto de ajustes): manda el sistema, como siempre.
    assert.equal(target.TELEGRAM_BOT_TOKEN, '1:del-sistema');
    assert.equal(target.PORT, '9000');
  });

  it('env.ts: con BOM y con UTF-16 la clave guardada sigue ahí al reiniciar, y manda sobre la variable de Windows', async () => {
    const bom = path.join(dir, 'real-bom.env');
    await writeFile(bom, '\uFEFFANTHROPIC_API_KEY=sk-ant-buena\r\nPORT=8799\r\n');
    const a = await loadEnvModule({ ENV_FILE: bom });
    assert.equal(a.anthropicKey, 'sk-ant-buena');
    assert.equal(a.port, 8799);

    const u16 = path.join(dir, 'real-utf16.env');
    await writeFile(u16, utf16le('ANTHROPIC_API_KEY=sk-ant-buena\r\nPORT=8798\r\n'));
    const b = await loadEnvModule({ ENV_FILE: u16, ANTHROPIC_API_KEY: 'sk-ant-vieja-revocada' });
    assert.equal(b.anthropicKey, 'sk-ant-buena');
    assert.equal(b.port, 8798);
    assert.deepEqual(b.shadowed, ['ANTHROPIC_API_KEY']);
  });

  it('env.ts: con el .env de la plantilla y otro PORT, los carritos del simulador siguen al puerto', async () => {
    const file = path.join(dir, 'puerto.env');
    const template = await readFile(path.join(REPO_ROOT, '.env.example'), 'utf8');
    await writeFile(file, template.replace(/^PORT=.*$/m, 'PORT=8974'));
    const e = await loadEnvModule({ ENV_FILE: file });
    assert.equal(e.port, 8974);
    assert.equal(e.publicBaseUrl, 'http://localhost:8974');
  });
});

describe('guardar claves desde el dashboard', () => {
  let dir = '';
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'to-envsave-'));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('tres guardados a la vez (Telegram, Claude y Ticketmaster) no se pisan ni dejan basura', async () => {
    const file = path.join(dir, '.env');
    for (let round = 0; round < 30; round++) {
      await writeFile(file, '# .env\r\nTELEGRAM_BOT_TOKEN=\r\nANTHROPIC_API_KEY=\r\nTICKETMASTER_API_KEY=\r\nLOG_LEVEL=info\r\n');
      await Promise.all([
        updateEnvFile(file, { TELEGRAM_BOT_TOKEN: `123:tok${round}` }),
        updateEnvFile(file, { ANTHROPIC_API_KEY: `sk-ant-${round}` }),
        updateEnvFile(file, { TICKETMASTER_API_KEY: `tm${round}` }),
      ]);
      assert.equal(
        await readFile(file, 'utf8'),
        `# .env\r\nTELEGRAM_BOT_TOKEN=123:tok${round}\r\nANTHROPIC_API_KEY=sk-ant-${round}\r\nTICKETMASTER_API_KEY=tm${round}\r\nLOG_LEVEL=info\r\n`,
        `ronda ${round}`,
      );
    }
    assert.deepEqual(await readdir(dir), ['.env'], 'sin temporales sueltos');
  });

  it('un .env en UTF-16 o con BOM se reescribe en UTF-8 sin perder nada', async () => {
    const file = path.join(dir, 'u16.env');
    await writeFile(file, utf16le('# Configuración\r\nPORT=9000\r\nANTHROPIC_API_KEY=\r\n'));
    await updateEnvFile(file, { ANTHROPIC_API_KEY: 'sk-ant-nueva' });
    assert.equal(await readFile(file, 'utf8'), '# Configuración\r\nPORT=9000\r\nANTHROPIC_API_KEY=sk-ant-nueva\r\n');

    const bom = path.join(dir, 'bom.env');
    await writeFile(bom, '\uFEFFANTHROPIC_API_KEY=\r\nMANUAL_TASK_MINUTES=30\r\n');
    await updateEnvFile(bom, { ANTHROPIC_API_KEY: 'sk-ant-nueva' });
    assert.equal(await readFile(bom, 'utf8'), 'ANTHROPIC_API_KEY=sk-ant-nueva\r\nMANUAL_TASK_MINUTES=30\r\n');
  });
});
