/**
 * Cambia variables de un archivo .env desde el propio servidor (el dashboard
 * configura Telegram sin que haya que abrir el Bloc de notas).
 *
 * Conserva todo lo demás: comentarios, orden, BOM y saltos de línea (CRLF en
 * Windows). Si el archivo no existe se parte de la plantilla (.env.example).
 */

import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';

const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

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

/** Guarda los cambios en el archivo (escritura atómica cuando se puede). */
export async function updateEnvFile(file: string, changes: Record<string, string | null>, template?: string | null): Promise<void> {
  let text = '';
  if (existsSync(file)) text = await readFile(file, 'utf8');
  else if (template && existsSync(template)) text = await readFile(template, 'utf8');
  const out = applyEnvChanges(text, changes);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, out, 'utf8');
    await rename(tmp, file);
  } catch {
    // OneDrive o un antivirus pueden bloquear el renombrado un instante: se escribe directamente.
    await rm(tmp, { force: true }).catch(() => undefined);
    await writeFile(file, out, 'utf8');
  }
}
