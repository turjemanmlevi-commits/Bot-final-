/**
 * Antes de arrancar: ¿se puede abrir la base de datos (PGlite)?
 *
 * Se prueba en un proceso aparte: si falla, ese proceso termina y no deja
 * archivos abiertos, así que la carpeta se puede apartar (renombrar, nunca
 * borrar) y empezar con una base de datos nueva en vez de no arrancar.
 *
 * Además: una sola sala de control por carpeta de datos (bloqueo con su pid y
 * su puerto) y, al actualizar, los datos de la carpeta de antes se copian.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile, cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Carpeta del paquete del servidor (desde aquí se resuelve @electric-sql/pglite). */
const SERVER_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const PROBE = `
import { PGlite } from '@electric-sql/pglite';
const db = await PGlite.create(process.argv[1]);
await db.query('select 1');
await db.close();
`;

export function probePglite(dir: string, timeoutMs = 90_000): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', PROBE, dir],
      { cwd: SERVER_DIR, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (!err) return resolve({ ok: true });
        const lines = `${stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const reason = lines.find((l) => /FATAL|PANIC|Error:/.test(l)) ?? lines.at(-1) ?? err.message;
        resolve({ ok: false, error: reason.slice(0, 300) });
      },
    );
  });
}

/** Nombre de la carpeta apartada: pglite-no-se-pudo-abrir-2026-09-29_14-43-47 */
export function asideName(dir: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  return `${dir}-no-se-pudo-abrir-${stamp}`;
}

// ---------------------------------------------------------------------------
// Una sala por carpeta de datos: dos a la vez (aunque sea en puertos
// distintos) se pisan la base de datos y al cerrar se pierde lo de una.
// ---------------------------------------------------------------------------

/** Bloqueo en la carpeta de datos: qué sala la usa (pid y puerto). */
export const LOCK_FILE = 'sala-abierta.json';

interface RoomLock {
  pid: number;
  port: number;
  startedAt: number;
}

export interface ClaimOptions {
  /** ¿Contesta en ese puerto una sala de control? */
  isRoom: (port: number) => Promise<boolean>;
  /** Un bloqueo más reciente que esto puede ser de una sala que se está abriendo: se la espera. */
  startingMs?: number;
  pollMs?: number;
  /** Se llama una vez si hay que esperar a la otra sala. */
  onWait?: (port: number) => void;
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function parseLock(text: string | null): RoomLock | null {
  try {
    const v = JSON.parse(text ?? '') as { pid?: unknown; port?: unknown; startedAt?: unknown };
    if (!Number.isInteger(v.pid) || !Number.isInteger(v.port)) return null;
    return { pid: v.pid as number, port: v.port as number, startedAt: Date.parse(String(v.startedAt)) };
  } catch {
    return null;
  }
}

/** ¿Sigue vivo ese proceso? (tras un cierre forzado o un apagón, no) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reserva la carpeta de datos para esta sala (archivo sala-abierta.json con su
 * pid y su puerto). Devuelve el puerto de la otra sala abierta con estos mismos
 * datos, o null si queda reservada. Un bloqueo abandonado (cierre forzado,
 * apagón) no impide arrancar: su proceso ya no existe o no contesta como sala.
 * Si no se puede escribir el bloqueo, se sigue sin él (como antes).
 */
export async function claimDataDir(dir: string, port: number, opts: ClaimOptions): Promise<number | null> {
  const file = path.join(dir, LOCK_FILE);
  const startingMs = opts.startingMs ?? 120_000;
  const pollMs = opts.pollMs ?? 1000;
  const until = Date.now() + startingMs;
  let waiting = false;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  for (let tries = 0; tries < 30; tries++) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }), { flag: 'wx' });
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return null;
    }
    const text = readText(file);
    const other = parseLock(text);
    if (other && other.pid !== process.pid && alive(other.pid)) {
      if (await opts.isRoom(other.port)) return other.port;
      // Vivo pero sin contestar: se está abriendo (doble clic) o ese número de proceso ya es de otro programa.
      if (Date.now() - other.startedAt < startingMs && Date.now() < until) {
        if (!waiting) opts.onWait?.(other.port);
        waiting = true;
        tries = 0;
        await sleep(pollMs);
        continue;
      }
    } else if (text !== null && text.trim() === '' && tries < 10) {
      // Otra sala lo está escribiendo en este mismo instante.
      await sleep(100);
      continue;
    }
    // Abandonado: se quita (si nadie lo ha cambiado mientras tanto) y se vuelve a intentar.
    try {
      if (text === null || readText(file) === text) rmSync(file, { force: true });
    } catch {
      return null;
    }
  }
  return null;
}

/** Quita el bloqueo al cerrar (solo si es de esta sala). */
export function releaseDataDir(dir: string): void {
  const file = path.join(dir, LOCK_FILE);
  try {
    if (parseLock(readText(file))?.pid === process.pid) rmSync(file, { force: true });
  } catch {
    // nada: el siguiente arranque verá que este proceso ya no existe
  }
}

// ---------------------------------------------------------------------------
// Datos de la versión anterior (proyecto en OneDrive: antes en «bot final\data»)
// ---------------------------------------------------------------------------

/** En la carpeta nueva: de dónde se trajeron los datos (así no se vuelve a avisar de la de antes). */
export const COPIED_FROM_FILE = 'copiado-de-la-version-anterior.json';

export interface LegacyData {
  /** copied: traídos · unreadable: la de antes no se abre (se empieza de cero) · unused: aquí ya había otra base y la de antes sigue sin usar */
  state: 'copied' | 'unreadable' | 'unused';
  notice: string;
}

/**
 * Si en `to` no hay base de datos y en `from` sí, la COPIA (la original no se
 * toca ni se abre) y comprueba que la copia se abre. Si en `to` ya había otra
 * (se abrió una versión que no la copiaba), avisa de que la de antes sigue sin
 * usar. Devuelve el aviso para la consola y el dashboard, o null. Si la copia
 * falla, lanza el error (no se crea una base vacía: se reintenta al volver a abrir).
 */
export async function copyLegacyData(from: string, to: string): Promise<LegacyData | null> {
  const src = path.join(from, 'pglite');
  const dest = path.join(to, 'pglite');
  if (path.resolve(src) === path.resolve(dest) || !existsSync(src)) return null;
  const mark = () => writeFile(path.join(to, COPIED_FROM_FILE), JSON.stringify({ from, at: new Date().toISOString() })).catch(() => undefined);
  if (existsSync(dest)) {
    if (existsSync(path.join(to, COPIED_FROM_FILE))) return null;
    return {
      state: 'unused',
      notice: `Hay datos de una versión anterior en ${from} que no se están usando: la sala usa ${to}, fuera de OneDrive. Si te faltan cuentas u operaciones de antes, cierra la ventana negra, cambia el nombre de la carpeta ${dest} (por ejemplo, a «pglite-nueva») y vuelve a abrir «Sala de control»: se copiarán las de antes (lo creado desde entonces queda en la carpeta renombrada). Si no te falta nada, borra la carpeta de antes o cámbiale el nombre, y este aviso no volverá a salir.`,
    };
  }
  const tmp = `${dest}-copiando`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  try {
    await cp(src, tmp, { recursive: true });
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  const probe = await probePglite(tmp);
  if (!probe.ok) {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    await mark();
    return {
      state: 'unreadable',
      notice: `La base de datos de la versión anterior (${src}) no se puede abrir (${probe.error}): se deja ahí, sin tocar, y se empieza con una nueva en ${dest}.`,
    };
  }
  // En Windows, el antivirus puede tener abiertos un instante los archivos recién copiados.
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, dest);
      break;
    } catch (err) {
      if (i >= 5) throw err;
      await sleep(500);
    }
  }
  await mark();
  // La lista de ⭐ Grandes partidos también (así no se vuelve a pagar).
  const top = 'top-partidos.json';
  if (existsSync(path.join(from, top)) && !existsSync(path.join(to, top))) await copyFile(path.join(from, top), path.join(to, top)).catch(() => undefined);
  return {
    state: 'copied',
    notice: `Tus datos de la versión anterior (cuentas, operaciones…) se han copiado de ${from} a ${to}, fuera de OneDrive, que bloqueaba la base de datos. La carpeta de antes sigue ahí, sin tocar, pero ya no se usa: cuando compruebes que está todo, puedes borrarla.`,
  };
}
