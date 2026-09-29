/**
 * Antes de arrancar: ¿se puede abrir la base de datos (PGlite)?
 *
 * Se prueba en un proceso aparte: si falla, ese proceso termina y no deja
 * archivos abiertos, así que la carpeta se puede apartar (renombrar, nunca
 * borrar) y empezar con una base de datos nueva en vez de no arrancar.
 */

import { execFile } from 'node:child_process';
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
