/**
 * Arranque de la sala de control (lo que pasa al hacer doble clic en «Sala de
 * control»): una sola sala por carpeta de datos, un bloqueo abandonado no
 * impide arrancar, el puerto ocupado por la propia sala no es un error y, al
 * actualizar, los datos de la carpeta de antes se copian sin tocar la original.
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { writeFixtureVault } from '../gates/fixtures';
import { claimDataDir, copyLegacyData, LOCK_FILE, releaseDataDir } from '../store/dbcheck';

const SERVER_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Un proceso que ya ha terminado (como tras un cierre forzado): su pid ya no existe. */
async function deadPid(): Promise<number> {
  const p = spawn(process.execPath, ['-e', '']);
  await new Promise((r) => p.once('exit', r));
  return p.pid as number;
}

/** Un proceso vivo que no es una sala (como un pid reutilizado por otro programa). */
function otherProgram(): ChildProcess {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
}

async function freePort(): Promise<number> {
  const srv = createTcpServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

const readLock = async (dir: string) => JSON.parse(await readFile(path.join(dir, LOCK_FILE), 'utf8')) as { pid: number; port: number };

describe('una sala por carpeta de datos (bloqueo)', () => {
  let root = '';
  const children: ChildProcess[] = [];
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'to-lock-'));
  });
  after(async () => {
    for (const c of children) c.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  });
  const lockIn = async (name: string, lock: object) => {
    const dir = path.join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, LOCK_FILE), JSON.stringify(lock));
    return dir;
  };

  it('la primera sala reserva la carpeta con su pid y su puerto, y la libera al cerrar', async () => {
    const dir = path.join(root, 'libre');
    assert.equal(await claimDataDir(dir, 8787, { isRoom: async () => false }), null);
    assert.deepEqual(await readLock(dir).then((l) => [l.pid, l.port]), [process.pid, 8787]);
    releaseDataDir(dir);
    assert.equal(existsSync(path.join(dir, LOCK_FILE)), false);
  });

  it('si otra sala abierta usa esos datos (aunque en otro puerto), devuelve su puerto y no toca su bloqueo', async () => {
    const other = otherProgram();
    children.push(other);
    const dir = await lockIn('ocupada', { pid: other.pid, port: 8970, startedAt: new Date().toISOString() });
    assert.equal(await claimDataDir(dir, 8971, { isRoom: async (p) => p === 8970 }), 8970);
    assert.equal((await readLock(dir)).pid, other.pid);
    releaseDataDir(dir); // no es suyo: no lo quita
    assert.equal((await readLock(dir)).pid, other.pid);
  });

  it('un bloqueo abandonado tras un cierre forzado (kill -9) no impide arrancar', async () => {
    const dir = await lockIn('abandonada', { pid: await deadPid(), port: 8970, startedAt: new Date().toISOString() });
    assert.equal(await claimDataDir(dir, 8971, { isRoom: async () => true }), null);
    assert.equal((await readLock(dir)).pid, process.pid);
  });

  it('tampoco si ese pid ya es de otro programa (reinicio) o el archivo está roto', async () => {
    const other = otherProgram();
    children.push(other);
    const old = new Date(Date.now() - 3_600_000).toISOString();
    const reused = await lockIn('reutilizado', { pid: other.pid, port: 8970, startedAt: old });
    assert.equal(await claimDataDir(reused, 8971, { isRoom: async () => false }), null);
    assert.equal((await readLock(reused)).pid, process.pid);

    const broken = path.join(root, 'roto');
    await mkdir(broken);
    await writeFile(path.join(broken, LOCK_FILE), '{"pid": 12');
    assert.equal(await claimDataDir(broken, 8971, { isRoom: async () => true }), null);
    assert.equal((await readLock(broken)).pid, process.pid);
  });

  it('doble clic: si la otra sala aún se está abriendo, la espera y luego dice que ya está abierta', async () => {
    const other = otherProgram();
    children.push(other);
    const dir = await lockIn('abriendose', { pid: other.pid, port: 8787, startedAt: new Date().toISOString() });
    const openedAt = Date.now() + 300;
    let waits = 0;
    const port = await claimDataDir(dir, 8787, { isRoom: async () => Date.now() >= openedAt, pollMs: 50, startingMs: 5000, onWait: () => waits++ });
    assert.equal(port, 8787);
    assert.equal(waits, 1);
    // Si nunca llega a contestar, al acabar la espera se queda con la carpeta.
    const hung = await lockIn('colgada', { pid: other.pid, port: 8787, startedAt: new Date().toISOString() });
    assert.equal(await claimDataDir(hung, 8787, { isRoom: async () => false, pollMs: 50, startingMs: 300 }), null);
    assert.equal((await readLock(hung)).pid, process.pid);
  });
});

/** Árbol de archivos con tamaño y fecha: para comprobar que la original no se toca. */
async function snapshot(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(dir, { recursive: true })).sort()) {
    const s = await stat(path.join(dir, name));
    out.push(`${name} ${s.size} ${s.mtimeMs}`);
  }
  return out;
}

describe('datos de la versión anterior (proyecto en OneDrive)', { concurrency: true }, () => {
  let root = '';
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'to-legacy-'));
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('se copian a la carpeta nueva sin tocar la original, y solo la primera vez', async () => {
    const legacy = path.join(root, 'bot final', 'data');
    await mkdir(legacy, { recursive: true });
    const db = await PGlite.create(path.join(legacy, 'pglite'));
    await db.exec(`create table cuentas (alias text); insert into cuentas values ('Cuenta guardada antes de actualizar');`);
    await db.close();
    await writeFile(path.join(legacy, 'top-partidos.json'), '{"partidos":[]}');
    const before = await snapshot(legacy);

    const to = path.join(root, 'AppData', 'Local', 'TicketOrchestrator', 'data');
    const r = await copyLegacyData(legacy, to);
    assert.equal(r?.state, 'copied');
    assert.match(r?.notice ?? '', /sin tocar/);
    assert.deepEqual(await snapshot(legacy), before, 'la original sigue igual');
    assert.equal(await readFile(path.join(to, 'top-partidos.json'), 'utf8'), '{"partidos":[]}');
    assert.equal(existsSync(path.join(to, 'pglite-copiando')), false);
    const copy = await PGlite.create(path.join(to, 'pglite'));
    assert.deepEqual((await copy.query<{ alias: string }>('select alias from cuentas')).rows, [{ alias: 'Cuenta guardada antes de actualizar' }]);
    await copy.close();

    // Ya hay base de datos en la carpeta nueva (la traída): no se vuelve a copiar encima ni se avisa más.
    assert.equal(await copyLegacyData(legacy, to), null);

    // En un PC que ya abrió una versión que no la copiaba (base nueva vacía), se avisa de que la de antes sigue sin usar.
    const other = path.join(root, 'ya-actualizado');
    await mkdir(other, { recursive: true });
    await (await PGlite.create(path.join(other, 'pglite'))).close();
    const unused = await copyLegacyData(legacy, other);
    assert.equal(unused?.state, 'unused');
    assert.match(unused?.notice ?? '', /no se están usando/);
    assert.deepEqual(await snapshot(legacy), before);
  });

  it('si la de antes no se puede abrir, no se copia y se deja donde está', async () => {
    const legacy = path.join(root, 'rota', 'data');
    await mkdir(legacy, { recursive: true });
    const db = await PGlite.create(path.join(legacy, 'pglite'));
    await db.close();
    await writeFile(path.join(legacy, 'pglite', 'global', 'pg_control'), Buffer.alloc(8192));
    const before = await snapshot(legacy);

    const to = path.join(root, 'rota-nueva');
    const r = await copyLegacyData(legacy, to);
    assert.equal(r?.state, 'unreadable');
    assert.match(r?.notice ?? '', /no se puede abrir/);
    assert.equal(existsSync(path.join(to, 'pglite')), false);
    assert.equal(existsSync(path.join(to, 'pglite-copiando')), false);
    assert.deepEqual(await snapshot(legacy), before);
  });
});

// ---------------------------------------------------------------------------
// El servidor de verdad (src/main.ts), como lo arranca INICIAR.bat
// ---------------------------------------------------------------------------

interface Room {
  proc: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

function startRoom(vars: Record<string, string>): Room {
  // Solo estas variables: nada de claves ni servicios reales.
  const env = {
    ...Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR'].flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : []))),
    TELEGRAM_API_BASE: 'http://127.0.0.1:9',
    ANTHROPIC_API_BASE: 'http://127.0.0.1:9',
    TICKETMASTER_API_BASE: 'http://127.0.0.1:9',
    FOOTBALL_DATA_API_BASE: 'http://127.0.0.1:9',
    HOST: '127.0.0.1',
    ...vars,
  };
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: SERVER_DIR, env });
  let out = '';
  proc.stdout?.on('data', (d) => (out += d));
  proc.stderr?.on('data', (d) => (out += d));
  const exit = new Promise<number | null>((r) => proc.once('exit', (code) => r(code)));
  return { proc, output: () => out, exit };
}

async function waitHealth(room: Room, port: number, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {
      // aún no escucha
    }
    if (room.proc.exitCode !== null) break;
    await sleep(200);
  }
  throw new Error(`La sala no contesta en ${port}:\n${room.output()}`);
}

async function exitWithin(room: Room, ms = 60_000): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), ms)));
  const r = await Promise.race([room.exit, timeout]);
  clearTimeout(timer);
  if (r === 'timeout') {
    room.proc.kill('SIGKILL');
    throw new Error(`La sala no se ha cerrado sola:\n${room.output()}`);
  }
  return r;
}

describe('arrancar la sala de control', { concurrency: true }, () => {
  let root = '';
  let vault = '';
  const rooms: Room[] = [];
  const servers: Server[] = [];
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'to-arranque-'));
    vault = path.join(root, 'vault');
    await writeFixtureVault(vault);
  });
  after(async () => {
    for (const r of rooms) r.proc.kill('SIGKILL');
    for (const s of servers) s.close();
    await rm(root, { recursive: true, force: true });
  });
  const room = (vars: Record<string, string>) => {
    const r = startRoom({ ENV_FILE: path.join(root, 'no-hay.env'), VAULT_DIR: vault, ...vars });
    rooms.push(r);
    return r;
  };

  it('con un bloqueo abandonado arranca; una 2.ª sala con los mismos datos en otro puerto no arranca', { timeout: 120_000 }, async () => {
    const data = path.join(root, 'datos');
    await mkdir(data, { recursive: true });
    await writeFile(path.join(data, LOCK_FILE), JSON.stringify({ pid: await deadPid(), port: 8787, startedAt: new Date().toISOString() }));
    const p1 = await freePort();
    let p2 = await freePort();
    while (p2 === p1) p2 = await freePort();

    const first = room({ PORT: String(p1), DATA_DIR: data, JOURNAL_DRIVER: 'pglite' });
    await waitHealth(first, p1);
    assert.deepEqual(await readLock(data).then((l) => [l.pid, l.port]), [first.proc.pid, p1]);

    const second = room({ PORT: String(p2), DATA_DIR: data, JOURNAL_DRIVER: 'pglite' });
    assert.equal(await exitWithin(second), 1);
    assert.match(second.output(), new RegExp(`abierta con estos mismos datos en http://localhost:${p1}`));
    await assert.rejects(fetch(`http://127.0.0.1:${p2}/api/health`));

    first.proc.kill('SIGTERM');
    assert.equal(await exitWithin(first), 0);
    assert.equal(existsSync(path.join(data, LOCK_FILE)), false, 'al cerrar se quita el bloqueo');
  });

  /** Ocupa el puerto con algo que tarda en contestar la 1.ª vez (como una sala que aún arranca). */
  async function occupy(answer: (res: import('node:http').ServerResponse) => void): Promise<number> {
    let first = true;
    const srv = createHttpServer((_req, res) => {
      if (first) {
        first = false;
        setTimeout(() => answer(res), 2500);
      } else answer(res);
    });
    servers.push(srv);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    return (srv.address() as AddressInfo).port;
  }

  it('si pierde el puerto frente a la propia sala (doble clic), dice que ya está abierta y sale bien', { timeout: 60_000 }, async () => {
    const port = await occupy((res) => res.end(JSON.stringify({ ok: true, version: '0.4.0', journal: { driver: 'memory' } })));
    const r = room({ PORT: String(port), DATA_DIR: path.join(root, 'datos-dc'), JOURNAL_DRIVER: 'memory' });
    assert.equal(await exitWithin(r), 0);
    assert.match(r.output(), /YA está abierta/);
  });

  it('si el puerto es de otro programa, remite al .env (PORT y PUBLIC_BASE_URL)', { timeout: 60_000 }, async () => {
    const port = await occupy((res) => {
      res.statusCode = 404;
      res.end('Not found');
    });
    const r = room({ PORT: String(port), DATA_DIR: path.join(root, 'datos-otro'), JOURNAL_DRIVER: 'memory' });
    assert.equal(await exitWithin(r), 1);
    assert.match(r.output(), new RegExp(`El puerto ${port} lo está usando otro programa.*PORT=${port + 1}.*PUBLIC_BASE_URL`));
  });
});
