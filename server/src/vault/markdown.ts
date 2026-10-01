import { parse as parseYaml } from 'yaml';

/** Separa el frontmatter YAML del cuerpo de una nota de Obsidian. */
export function splitFrontmatter(text: string): { yaml: string | null; body: string } {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = src.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return { yaml: null, body: src };
  for (let i = 1; i < lines.length; i++) {
    // El cierre va al principio de la línea: un «---» sangrado es texto de un valor de varias líneas.
    const line = (lines[i] ?? '').trimEnd();
    if (line === '---' || line === '...') {
      return { yaml: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') };
    }
  }
  return { yaml: null, body: src };
}

export function parseFrontmatter(yaml: string): Record<string, unknown> {
  const data: unknown = parseYaml(yaml, { schema: 'core', prettyErrors: true });
  if (data === null || data === undefined) return {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('El frontmatter no es un objeto clave: valor');
  }
  return data as Record<string, unknown>;
}

export interface WikiLink {
  /** Destino tal y como está escrito (puede incluir carpeta). */
  target: string;
  /** Nombre de la nota: último segmento, sin extensión ni encabezado. */
  name: string;
}

const WIKILINK_RE = /^\s*!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/;

/**
 * Interpreta un valor de propiedad como enlace. Acepta `[[Nota]]`,
 * `[[carpeta/Nota|alias]]`, `[[Nota#Encabezado]]` y texto plano.
 */
export function parseLink(value: unknown): WikiLink | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (raw === '' || raw === '[[]]') return null;
  const m = WIKILINK_RE.exec(raw);
  const target = (m ? (m[1] ?? '') : raw).trim().replace(/\\/g, '/');
  if (target === '') return null;
  const last = target.split('/').pop() ?? target;
  return { target, name: last.replace(/\.md$/i, '') };
}

/** Lista de valores de una propiedad (acepta escalar o lista). */
export function asList(value: unknown): unknown[] {
  if (value === null || value === undefined || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

export function asStringList(value: unknown): string[] {
  return asList(value)
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .map((v) => String(v).trim())
    .filter((v) => v !== '');
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const s = value.trim();
    return s === '' ? null : s;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (['true', 'sí', 'si', 'yes', '1'].includes(s)) return true;
    if (['false', 'no', '0'].includes(s)) return false;
  }
  return null;
}
