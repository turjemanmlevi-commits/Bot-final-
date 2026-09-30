/**
 * Lee y cambia el archivo .env desde el propio servidor (el dashboard
 * configura Telegram sin que haya que abrir el Bloc de notas).
 *
 * Lo entiende lo guarde como lo guarde el Bloc de notas (UTF-8 con o sin BOM,
 * UTF-16 o ANSI) y, al cambiarlo, conserva todo lo demás: comentarios, orden y
 * saltos de línea (CRLF en Windows); lo escribe en UTF-8 sin BOM. Si el
 * archivo no existe se parte de la plantilla (.env.example).
 */

import { isUtf8 } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Claves que se guardan desde el dashboard: si el .env tiene valor, manda sobre una variable de entorno con el mismo nombre. */
export const DASHBOARD_KEYS: readonly string[] = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ANTHROPIC_API_KEY', 'TICKETMASTER_API_KEY', 'FOOTBALL_DATA_TOKEN'];

/** Texto del .env sea cual sea la codificación: UTF-16 (LE o BE), UTF-8 (sin el BOM) o ANSI. */
export function decodeEnvText(raw: Buffer): string {
  if (raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString('utf16le');
  if (raw[0] === 0xfe && raw[1] === 0xff) return Buffer.from(raw.subarray(2, raw.length - (raw.length % 2))).swap16().toString('utf16le');
  // «ANSI» del Bloc de notas (Windows-1252) no es UTF-8 válido: las letras con acento coinciden con latin1.
  const text = isUtf8(raw) ? raw.toString('utf8') : raw.toString('latin1');
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/**
 * Carga el .env en `target` (process.env). Como process.loadEnvFile, no pisa
 * las variables que ya existen, salvo las del dashboard (DASHBOARD_KEYS): ahí
 * manda el .env si tiene valor, o la clave guardada en Ajustes se perdería en
 * cada reinicio. Devuelve las variables del sistema que el .env ha tapado.
 */
export function loadEnvInto(file: string, target: NodeJS.ProcessEnv = process.env): string[] {
  const shadowed: string[] = [];
  for (const [key, value = ''] of Object.entries(parseEnv(decodeEnvText(readFileSync(file))))) {
    const current = target[key];
    if (current === undefined) target[key] = value;
    else if (DASHBOARD_KEYS.includes(key) && value.trim() !== '' && current.trim() !== value.trim()) {
      if (current.trim() !== '') shadowed.push(key);
      target[key] = value;
    }
  }
  return shadowed;
}

/**
 * Aplica `changes` al texto de un .env: sustituye la primera línea de cada
 * variable (y quita sus repeticiones) o la añade al final. null = vacía.
 */
export function applyEnvChanges(text: string, changes: Record<string, string | null>, platform: NodeJS.Platform = process.platform): string {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : body.includes('\n') ? '\n' : platform === 'win32' ? '\r\n' : '\n';
  const lines = body === '' ? [] : body.split(/\r?\n/);
  // Un salto de línea final deja un '' al final: las líneas nuevas van antes.
  const trailing = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailing) lines.pop();
  for (const [key, raw] of Object.entries(changes)) {
    if (!KEY_RE.test(key)) throw new Error(`Nombre de variable no válido: ${key}`);
    const value = raw ?? '';
    if (/[\r\n#"'`\s]/.test(value)) throw new Error(`Valor no válido para ${key}`);
    const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const found: number[] = [];
    lines.forEach((l, i) => {
      if (re.test(l)) found.push(i);
    });
    if (found.length === 0) {
      lines.push(`${key}=${value}`);
      continue;
    }
    lines[found[0] as number] = `${key}=${value}`;
    for (const i of found.slice(1).reverse()) lines.splice(i, 1);
  }
  return bom + lines.join(eol) + eol;
}

/** Un guardado cada vez por archivo, aunque Telegram, Claude y las fuentes guarden a la vez. */
const queues = new Map<string, Promise<void>>();
let tmpSeq = 0;

/** Guarda los cambios en el archivo (escritura atómica cuando se puede). */
export function updateEnvFile(file: string, changes: Record<string, string | null>, template?: string | null): Promise<void> {
  const key = path.resolve(file);
  const run = (queues.get(key) ?? Promise.resolve()).then(() => writeEnvChanges(file, changes, template));
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

async function writeEnvChanges(file: string, changes: Record<string, string | null>, template?: string | null): Promise<void> {
  let text = '';
  if (existsSync(file)) text = decodeEnvText(await readFile(file));
  else if (template && existsSync(template)) text = decodeEnvText(await readFile(template));
  const out = applyEnvChanges(text, changes);
  // Nombre único: dos guardados no comparten el temporal.
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
  try {
    await writeFile(tmp, out, 'utf8');
    await rename(tmp, file);
  } catch {
    // OneDrive o un antivirus pueden bloquear el renombrado un instante: se escribe directamente.
    await rm(tmp, { force: true }).catch(() => undefined);
    await writeFile(file, out, 'utf8');
  }
}
