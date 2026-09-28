/**
 * Escribe notas de Obsidian desde el dashboard (eventos y recintos rápidos).
 *
 * El vault sigue siendo la fuente de verdad: lo que se crea aquí son notas
 * normales que puedes abrir y retocar en Obsidian. Al editar un evento se
 * conserva todo lo que no gestiona el formulario (cuerpo, comentarios, otras
 * propiedades).
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EventNoteInput, LayoutZone, VenueQuickInput } from '@to/shared';
import { isMap, parseDocument, stringify } from 'yaml';
import { slugify } from '../util/normalize';
import { splitFrontmatter } from './markdown';

export class VaultWriteError extends Error {
  constructor(
    message: string,
    readonly code: 'CONFLICT' | 'NOT_FOUND' | 'BAD_REQUEST',
  ) {
    super(message);
  }
}

export const EVENTS_DIR = '20 Eventos';
export const VENUES_DIR = '10 Recintos';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Nombre de archivo válido en Windows, OneDrive y Obsidian (sin \ / : * ? " < > | # ^ [ ]). */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 110)
    .trim();
  if (cleaned === '') throw new VaultWriteError('El nombre no sirve como nombre de archivo', 'BAD_REQUEST');
  return WINDOWS_RESERVED.test(cleaned) ? `${cleaned}_` : cleaned;
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

/** Fecha de hoy (AAAA-MM-DD) en la zona del vault. */
export function todayIn(timeZone: string, now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

const link = (basename: string) => `[[${basename}]]`;

function frontmatterText(data: Record<string, unknown>): string {
  return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n`;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export interface EventWriteContext {
  vaultDir: string;
  timeZone: string;
  actor: string;
  /** Nota (basename) del recinto y del proveedor, ya comprobados contra el catálogo. */
  venueNote: string;
  providerNote: string;
  now?: number;
}

/** Propiedades del evento que gestiona el formulario (el resto de la nota no se toca). */
function eventProps(input: EventNoteInput, ctx: EventWriteContext): Record<string, unknown> {
  const today = todayIn(ctx.timeZone, ctx.now);
  return {
    name: input.name,
    venue: link(ctx.venueNote),
    provider: link(ctx.providerNote),
    providerEventRef: input.providerEventRef?.trim() || slugify(input.name),
    url: input.url ?? null,
    startsAt: input.startsAt,
    onSaleAt: input.onSaleAt ?? null,
    currency: input.currency,
    limitPerAccount: input.limitPerAccount,
    limitPerGroup: input.limitPerGroup,
    limitPerOperation: input.limitPerOperation,
    limitSemantics: input.limitSemantics,
    limitsVerified: input.limitsVerified,
    limitsSource: input.limitsSource,
    limitsVerifiedAt: input.limitsVerified ? today : null,
    limitsVerifiedBy: input.limitsVerified ? ctx.actor : null,
    limitsNotes: input.limitsNotes ?? '',
  };
}

function eventBody(input: EventNoteInput, providerNote: string): string {
  const lines = [
    `# ${input.name}`,
    '',
    `Evento creado desde el dashboard. Se vende en [[${providerNote}]]: el sistema **no entra en esa web**; cada persona compra desde su cuenta y el sistema coordina (ver [[Uso legítimo y guardarraíles]]).`,
    '',
  ];
  if (input.url) lines.push(`- Página oficial: ${input.url}`);
  if (input.limitsSource) lines.push(`- Condiciones / límites: ${input.limitsSource}`);
  lines.push('', '## Notas', '', input.notes?.trim() || '_Apunta aquí lo que conviene saber para la compra (fases de venta, requisitos, precios)._', '');
  return lines.join('\n');
}

export async function createEventNote(input: EventNoteInput, eventId: string, ctx: EventWriteContext): Promise<string> {
  const base = safeFileName(input.name);
  const rel = `${EVENTS_DIR}/${base}.md`;
  const abs = path.join(ctx.vaultDir, EVENTS_DIR, `${base}.md`);
  if (await exists(abs)) throw new VaultWriteError(`Ya existe la nota ${rel}: cambia el nombre o edita ese evento`, 'CONFLICT');
  const data: Record<string, unknown> = {
    type: 'event',
    id: eventId,
    ...eventProps(input, ctx),
    closedSections: [],
    overrideNotes: [],
    tags: ['evento', 'real'],
  };
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${frontmatterText(data)}\n${eventBody(input, ctx.providerNote)}`, { encoding: 'utf8', flag: 'wx' });
  return rel;
}

/**
 * Actualiza las propiedades de un evento existente conservando el resto de la
 * nota. Fija `id` si la nota no lo tenía, para que cambiar el nombre no cambie
 * el id (las operaciones lo referencian).
 */
export async function updateEventNote(sourceFile: string, eventId: string, input: EventNoteInput, ctx: EventWriteContext): Promise<string> {
  const abs = path.resolve(ctx.vaultDir, sourceFile);
  const root = path.resolve(ctx.vaultDir);
  if (!abs.startsWith(root + path.sep)) throw new VaultWriteError('Ruta de nota no válida', 'BAD_REQUEST');
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch {
    throw new VaultWriteError(`No se encuentra la nota ${sourceFile}`, 'NOT_FOUND');
  }
  const { yaml, body } = splitFrontmatter(text);
  if (yaml === null) throw new VaultWriteError(`La nota ${sourceFile} no tiene propiedades (frontmatter)`, 'BAD_REQUEST');
  const doc = parseDocument(yaml, { schema: 'core' });
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    throw new VaultWriteError(`Las propiedades de ${sourceFile} tienen errores: arréglalas en Obsidian`, 'BAD_REQUEST');
  }
  const currentId = doc.get('id');
  if (currentId === undefined || currentId === null || String(currentId).trim() === '') doc.set('id', eventId);
  for (const [key, value] of Object.entries(eventProps(input, ctx))) doc.set(key, value);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const front = `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n`;
  await writeFile(abs, (front + body).replace(/\r?\n/g, eol), 'utf8');
  return sourceFile;
}

// ---------------------------------------------------------------------------
// Recinto rápido
// ---------------------------------------------------------------------------

export interface VenueWriteContext {
  vaultDir: string;
  timeZone: string;
  actor: string;
  now?: number;
}

/**
 * Crea la carpeta del recinto con su nota, una nota por zona y una por sección.
 * Devuelve la carpeta (relativa al vault) y el número de archivos creados.
 */
export async function createVenueNotes(input: VenueQuickInput, zones: LayoutZone[], venueId: string, ctx: VenueWriteContext): Promise<{ folder: string; files: number }> {
  const venueBase = safeFileName(input.name);
  const folderRel = `${VENUES_DIR}/${venueBase}`;
  const folder = path.join(ctx.vaultDir, VENUES_DIR, venueBase);
  if (await exists(folder)) throw new VaultWriteError(`Ya existe la carpeta ${folderRel}`, 'CONFLICT');
  const today = todayIn(ctx.timeZone, ctx.now);

  const files: Array<{ rel: string; text: string }> = [];
  const zoneBases = new Set<string>();
  const sectionBases = new Set<string>();
  files.push({
    rel: `${venueBase}.md`,
    text:
      frontmatterText({
        type: 'venue',
        id: venueId,
        name: input.name,
        city: input.city?.trim() || null,
        aliases: [],
        source: input.source,
        verifiedAt: today,
        verifiedBy: ctx.actor,
        confidence: 0.8,
        tags: ['recinto'],
      }) +
      `\n# ${input.name}\n\nRecinto creado desde el dashboard a partir de: ${input.source}\n\n` +
      'Revisa zonas y secciones contra el plano oficial. Puedes añadir alias (cómo lo escribe la web), aforo y visión en cada nota de sección.\n',
  });
  for (const z of zones) {
    const zBase = safeFileName(z.name);
    if (zoneBases.has(zBase.toLowerCase())) throw new VaultWriteError(`Dos zonas acaban con el mismo nombre de archivo: ${zBase}`, 'BAD_REQUEST');
    zoneBases.add(zBase.toLowerCase());
    files.push({
      rel: `Zonas/${zBase}.md`,
      text: frontmatterText({ type: 'zone', venue: link(venueBase), name: z.name, aliases: [], tags: ['zona'] }) + `\n# ${z.name}\n`,
    });
    for (const s of z.sections) {
      const sBase = safeFileName(s.name);
      if (sectionBases.has(sBase.toLowerCase())) throw new VaultWriteError(`Dos secciones acaban con el mismo nombre de archivo: ${sBase}`, 'BAD_REQUEST');
      sectionBases.add(sBase.toLowerCase());
      files.push({
        rel: `Secciones/${sBase}.md`,
        text:
          frontmatterText({
            type: 'section',
            venue: link(venueBase),
            zone: link(zBase),
            name: s.name,
            kind: s.standing ? 'STANDING' : 'SEATED',
            aliases: [],
            tags: ['seccion'],
          }) + `\n# ${s.name}\n\nZona [[${zBase}]] de [[${venueBase}]].\n`,
      });
    }
  }
  for (const f of files) {
    const abs = path.join(folder, f.rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, f.text, { encoding: 'utf8', flag: 'wx' });
  }
  return { folder: folderRel, files: files.length };
}
