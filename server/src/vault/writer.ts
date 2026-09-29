/**
 * Escribe notas de Obsidian desde el dashboard (eventos y recintos rápidos).
 *
 * El vault sigue siendo la fuente de verdad: lo que se crea aquí son notas
 * normales que puedes abrir y retocar en Obsidian. Al editar un evento se
 * conserva todo lo que no gestiona el formulario (cuerpo, comentarios, otras
 * propiedades).
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatPlanPoint, type EventNoteInput, type FeedId, type LayoutZone, type VenueQuickInput } from '@to/shared';
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
    officialFeed: input.officialFeed ?? null,
    officialId: input.officialFeed ? (input.officialId ?? null) : null,
    officialSale: input.officialFeed ? (input.officialSale ?? null) : null,
    watchDaysBefore: input.watchDaysBefore ?? null,
    // Sin el campo (p. ej. al editar desde otra pantalla) se conservan los que hubiera.
    ...(input.preferredTargets !== undefined ? { preferredTargets: input.preferredTargets } : {}),
    ...(input.perAccountQty !== undefined ? { perAccountQty: input.perAccountQty } : {}),
    ...(input.saleZones !== undefined ? { saleZones: input.saleZones } : {}),
    ...(input.planImage !== undefined ? { planImage: input.planImage } : {}),
    ...(input.planPoints !== undefined ? { planPoints: input.planPoints.map(formatPlanPoint) } : {}),
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
  if (input.officialFeed && input.officialId) lines.push(`- Elegido de la fuente oficial (${OFFICIAL_LABEL[input.officialFeed]}): \`${input.officialId}\``);
  if (input.preferredTargets && input.preferredTargets.length > 0) lines.push(`- Dónde queremos sentarnos (en orden): ${input.preferredTargets.join(' → ')}`);
  if (input.perAccountQty) lines.push(`- Entradas por cuenta: ${input.perAccountQty} (todas las cuentas a la vez)`);
  if (input.saleZones && input.saleZones.length > 0) {
    lines.push('- Cómo está estructurada la venta (zona: secciones · precio → zona de nuestro plano):');
    for (const z of input.saleZones) lines.push(`  - ${z}`);
  }
  if (input.planImage) lines.push(`- Plano oficial: ${input.planImage}`);
  if (input.limitsSource) lines.push(`- Condiciones / límites: ${input.limitsSource}`);
  if (input.watchDaysBefore) {
    lines.push(
      `- Vigilancia: desde ${input.watchDaysBefore} ${input.watchDaysBefore === 1 ? 'día' : 'días'} antes de la venta${input.officialFeed ? ' (si cambia algo oficial, aviso por Telegram y se actualiza aquí)' : ' (recordatorios por Telegram)'}.`,
    );
  }
  lines.push('', '## Notas', '', input.notes?.trim() || '_Apunta aquí lo que conviene saber para la compra (fases de venta, requisitos, precios)._', '');
  return lines.join('\n');
}

const OFFICIAL_LABEL: Record<FeedId, string> = { ticketmaster: 'Ticketmaster', football: 'partidos de football-data.org' };

/**
 * Cambia solo algunas propiedades de una nota de evento (lo que actualiza la
 * vigilancia cuando la fuente oficial cambia una fecha). El resto no se toca.
 */
export async function patchEventNote(vaultDir: string, sourceFile: string, patch: Record<string, unknown>): Promise<void> {
  const abs = path.resolve(vaultDir, sourceFile);
  const root = path.resolve(vaultDir);
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
  if (doc.errors.length > 0 || !isMap(doc.contents)) throw new VaultWriteError(`Las propiedades de ${sourceFile} tienen errores`, 'BAD_REQUEST');
  for (const [key, value] of Object.entries(patch)) doc.set(key, value);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const front = `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n`;
  await writeFile(abs, (front + body).replace(/\r?\n/g, eol), 'utf8');
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
    preferredTargets: input.preferredTargets ?? [],
    perAccountQty: input.perAccountQty ?? null,
    saleZones: input.saleZones ?? [],
    planImage: input.planImage ?? null,
    planPoints: (input.planPoints ?? []).map(formatPlanPoint),
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

// ---------------------------------------------------------------------------
// Recinto: zonas de la venta que no estaban y nombres de la web como alias
// ---------------------------------------------------------------------------

/** Nota de zona de un recinto (dentro de su carpeta «Zonas») cuyo nombre es `zone`, o null. */
async function findZoneNote(folderAbs: string, zone: string): Promise<string | null> {
  const dir = path.join(folderAbs, 'Zonas');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const key = zone.trim().toLowerCase();
  for (const n of names) {
    if (!n.endsWith('.md')) continue;
    const abs = path.join(dir, n);
    if (path.basename(n, '.md').toLowerCase() === key) return abs;
    try {
      const { yaml } = splitFrontmatter(await readFile(abs, 'utf8'));
      const doc = yaml ? parseDocument(yaml, { schema: 'core' }) : null;
      const name = doc && isMap(doc.contents) ? doc.get('name') : null;
      if (typeof name === 'string' && name.trim().toLowerCase() === key) return abs;
    } catch {
      // nota ilegible: se ignora
    }
  }
  return null;
}

/**
 * Añade a un recinto existente las zonas de la venta que no tenía (con sus
 * secciones) y, a las que ya tenía, el nombre que usa la web como alias. No
 * toca nada más de las notas. Devuelve cuántas zonas y alias se han añadido.
 */
export async function addVenueSaleZones(
  vaultDir: string,
  venueFile: string,
  input: { zones: LayoutZone[]; aliases: Array<{ zone: string; alias: string }>; existingSections: string[] },
  ctx: VenueWriteContext,
): Promise<{ zones: number; aliases: number }> {
  const venueAbs = path.resolve(vaultDir, venueFile);
  const root = path.resolve(vaultDir);
  if (!venueAbs.startsWith(root + path.sep)) throw new VaultWriteError('Ruta de recinto no válida', 'BAD_REQUEST');
  const folderAbs = path.dirname(venueAbs);
  const venueBase = path.basename(venueFile, '.md');
  const today = todayIn(ctx.timeZone, ctx.now);
  const takenSections = new Set(input.existingSections.map((x) => safeFileName(x).toLowerCase()));
  let zones = 0;
  for (const z of input.zones) {
    if (await findZoneNote(folderAbs, z.name)) continue;
    const zBase = safeFileName(z.name);
    const zAbs = path.join(folderAbs, 'Zonas', `${zBase}.md`);
    if (await exists(zAbs)) continue;
    await mkdir(path.dirname(zAbs), { recursive: true });
    await writeFile(
      zAbs,
      frontmatterText({ type: 'zone', venue: link(venueBase), name: z.name, aliases: [], source: 'Web de venta (leído por Claude)', verifiedAt: today, verifiedBy: ctx.actor, tags: ['zona'] }) +
        `\n# ${z.name}\n\nZona añadida desde la estructura de la venta de un evento. Revísala con el plano oficial.\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    for (const s of z.sections) {
      // Una sección con el mismo nombre que otra del recinto lleva delante su zona.
      let name = s.name;
      if (takenSections.has(safeFileName(name).toLowerCase())) name = `${z.name} · ${s.name}`;
      const sBase = safeFileName(name);
      if (takenSections.has(sBase.toLowerCase())) continue;
      takenSections.add(sBase.toLowerCase());
      const sAbs = path.join(folderAbs, 'Secciones', `${sBase}.md`);
      if (await exists(sAbs)) continue;
      await mkdir(path.dirname(sAbs), { recursive: true });
      await writeFile(
        sAbs,
        frontmatterText({ type: 'section', venue: link(venueBase), zone: link(zBase), name, kind: s.standing ? 'STANDING' : 'SEATED', aliases: [], tags: ['seccion'] }) +
          `\n# ${name}\n\nZona [[${zBase}]] de [[${venueBase}]]. Añadida desde la estructura de la venta.\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
    }
    zones++;
  }
  let aliases = 0;
  for (const a of input.aliases) {
    const zAbs = await findZoneNote(folderAbs, a.zone);
    if (!zAbs) continue;
    const text = await readFile(zAbs, 'utf8');
    const { yaml, body } = splitFrontmatter(text);
    if (yaml === null) continue;
    const doc = parseDocument(yaml, { schema: 'core' });
    if (doc.errors.length > 0 || !isMap(doc.contents)) continue;
    const current = doc.get('aliases');
    const list: string[] = Array.isArray(current) ? current.map(String) : current && typeof current === 'object' && 'toJSON' in current ? ((current as { toJSON(): unknown }).toJSON() as unknown[]).map(String) : [];
    if ([a.zone, ...list].some((x) => x.trim().toLowerCase() === a.alias.trim().toLowerCase())) continue;
    doc.set('aliases', [...list, a.alias]);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    await writeFile(zAbs, (`---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n` + body).replace(/\r?\n/g, eol), 'utf8');
    aliases++;
  }
  return { zones, aliases };
}
