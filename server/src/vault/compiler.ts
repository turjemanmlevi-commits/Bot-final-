/**
 * Compilador del vault de Obsidian → Venue Intelligence (spec §9, §10).
 *
 * Lee las notas con `type: venue | zone | section | event | provider` y produce:
 *  - un VenueArtifact base por recinto (hash de contenido, estable entre compilaciones),
 *  - un VenueArtifact por evento cuando el evento tiene overrides (secciones cerradas),
 *  - el catálogo de eventos con sus límites,
 *  - la autorización humana de capabilities por proveedor.
 *
 * Nunca lanza por una nota mal escrita: la registra como error y sigue.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CAPABILITIES,
  LIMIT_SEMANTICS,
  PROHIBITED_CAPABILITIES,
  type CapabilityName,
  type CatalogEvent,
  type EventLimits,
  type LimitSemantics,
  type ProviderAuthorization,
  type ProviderMode,
  type Provenance,
  type SectionKind,
  type VaultCompileReport,
  type VaultIssue,
  type VenueArtifact,
  type VenueSection,
  type VenueZone,
} from '@to/shared';
import { hashOf, sha256 } from '../util/hash';
import { compactLabel, normalizeLabel, slugify } from '../util/normalize';
import { iso, parseVaultDate } from '../util/time';
import {
  asBoolean,
  asNumber,
  asString,
  asStringList,
  parseFrontmatter,
  parseLink,
  splitFrontmatter,
} from './markdown';

export const COMPILER_VERSION = 'vault-compiler-1.0.0';

/** Carpetas del vault que no contienen datos (plantillas, adjuntos). */
const IGNORED_DIRS = new Set(['_plantillas', '_templates', '_adjuntos', 'node_modules']);

export interface VaultNote {
  file: string;
  basename: string;
  dir: string;
  data: Record<string, unknown>;
  mtimeMs: number;
  birthtimeMs: number;
  contentHash: string;
}

export interface CompiledVault {
  report: VaultCompileReport;
  /** Artefactos base (eventId null) y por evento, en orden estable. */
  artifacts: VenueArtifact[];
  events: CatalogEvent[];
  providers: ProviderAuthorization[];
}

export interface CompileOptions {
  vaultDir: string;
  /** Zona horaria para fechas sin zona escritas desde Obsidian. */
  timeZone: string;
  now?: () => number;
}

interface VenueDraft {
  id: string;
  name: string;
  city: string | null;
  note: VaultNote;
  aliases: string[];
  provenance: Provenance;
  zones: Array<VenueZone & { note: VaultNote }>;
  sections: Array<VenueSection & { note: VaultNote }>;
  warnings: string[];
  sectionAliasIndex: Record<string, string>;
  zoneAliasIndex: Record<string, string>;
  /** Secciones sin aforo: se avisa una vez por recinto (el aforo solo lo usa el simulador). */
  missingCapacity: number;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

async function walk(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch (err) {
    // Carpeta borrada o renombrada mientras se recorría (Obsidian, OneDrive): se ignora.
    if (rel !== '' && ['ENOENT', 'ENOTDIR', 'EPERM', 'EACCES', 'EBUSY'].includes((err as NodeJS.ErrnoException).code ?? '')) return out;
    throw err;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      out.push(...(await walk(root, childRel)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(childRel);
    }
  }
  return out;
}

export async function readVaultNotes(vaultDir: string, issues: VaultIssue[]): Promise<VaultNote[]> {
  const files = await walk(vaultDir);
  const notes: VaultNote[] = [];
  for (const file of files) {
    const abs = path.join(vaultDir, file);
    let text: string;
    let st;
    try {
      [text, st] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
    } catch (err) {
      issues.push({ file, severity: 'ERROR', message: `No se pudo leer: ${(err as Error).message}` });
      continue;
    }
    const { yaml } = splitFrontmatter(text);
    let data: Record<string, unknown> = {};
    if (yaml !== null) {
      try {
        data = parseFrontmatter(yaml);
      } catch (err) {
        issues.push({ file, severity: 'ERROR', message: `Frontmatter YAML inválido: ${(err as Error).message.split('\n')[0]}` });
        continue;
      }
    }
    const posix = toPosix(file);
    const dir = posix.includes('/') ? posix.slice(0, posix.lastIndexOf('/')) : '';
    notes.push({
      file: posix,
      basename: path.basename(posix, '.md'),
      dir,
      data,
      mtimeMs: st.mtimeMs,
      birthtimeMs: st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs,
      contentHash: sha256(text).slice(0, 16),
    });
  }
  return notes;
}

function noteType(note: VaultNote): string | null {
  const t = asString(note.data.type);
  return t ? t.toLowerCase() : null;
}

/** Solo enlaces http(s) completos: se muestran como enlace y nunca se visitan desde el servidor. */
export function parseOfficialUrl(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function parseKind(value: unknown): SectionKind | null {
  const s = asString(value);
  if (!s) return 'SEATED';
  const n = normalizeLabel(s);
  if (['seated', 'sentado', 'sentada', 'asiento', 'asientos', 'butaca'].includes(n)) return 'SEATED';
  if (['standing', 'de pie', 'pie', 'general', 'ga'].includes(n)) return 'STANDING';
  return null;
}

class Compiler {
  readonly errors: VaultIssue[] = [];
  readonly warnings: VaultIssue[] = [];
  private readonly venues = new Map<string, VenueDraft>();
  private readonly venueLookup = new Map<string, string>();
  private readonly providerLookup = new Map<string, string>();

  constructor(private readonly opts: CompileOptions) {}

  error(file: string, message: string): void {
    this.errors.push({ file, severity: 'ERROR', message });
  }

  warn(file: string, message: string): void {
    this.warnings.push({ file, severity: 'WARNING', message });
  }

  private date(note: VaultNote, key: string): string | null {
    const raw = note.data[key];
    if (raw === null || raw === undefined || raw === '') return null;
    const ms = parseVaultDate(raw, this.opts.timeZone);
    if (ms === null) {
      this.warn(note.file, `\`${key}\` no es una fecha válida: ${String(raw)}`);
      return null;
    }
    return iso(ms);
  }

  private provenance(note: VaultNote, fallback: Provenance | null): Provenance {
    const confidenceRaw = asNumber(note.data.confidence);
    if (confidenceRaw !== null && (confidenceRaw < 0 || confidenceRaw > 1)) {
      this.warn(note.file, '`confidence` debe estar entre 0 y 1; se ajusta al rango');
    }
    const verifiedAt = this.date(note, 'verifiedAt') ?? fallback?.verifiedAt ?? iso(note.mtimeMs);
    return {
      source: asString(note.data.source) ?? fallback?.source ?? 'sin fuente',
      verifiedAt,
      confidence: clamp01(confidenceRaw ?? fallback?.confidence ?? 0.5),
      verifiedBy: asString(note.data.verifiedBy) ?? fallback?.verifiedBy,
    };
  }

  // -------------------------------------------------------------------------
  // Recintos, zonas y secciones
  // -------------------------------------------------------------------------

  addVenues(notes: VaultNote[]): void {
    for (const note of notes) {
      const name = asString(note.data.name) ?? note.basename;
      const id = asString(note.data.id) ?? slugify(name);
      if (!id) {
        this.error(note.file, 'Recinto sin `id` ni nombre utilizable');
        continue;
      }
      if (this.venues.has(id)) {
        this.error(note.file, `Recinto duplicado: el id "${id}" ya existe en ${this.venues.get(id)?.note.file}`);
        continue;
      }
      const provenance = this.provenance(note, null);
      if (!asString(note.data.source)) this.warn(note.file, 'Recinto sin `source`: indica de qué plano salen los datos');
      const aliases = asStringList(note.data.aliases);
      this.venues.set(id, {
        id,
        name,
        city: asString(note.data.city),
        note,
        aliases,
        provenance,
        zones: [],
        sections: [],
        warnings: [],
        sectionAliasIndex: {},
        zoneAliasIndex: {},
        missingCapacity: 0,
      });
      for (const key of [id, name, note.basename, ...aliases]) this.venueLookup.set(normalizeLabel(key), id);
    }
  }

  /** Recinto de una nota: por la propiedad `venue` o por la carpeta en la que está. */
  private venueFor(note: VaultNote): VenueDraft | null {
    const link = parseLink(note.data.venue);
    if (link) {
      const id = this.venueLookup.get(normalizeLabel(link.name)) ?? this.venueLookup.get(normalizeLabel(link.target));
      if (id) return this.venues.get(id) ?? null;
      this.error(note.file, `El recinto "${link.name}" no existe en el vault`);
      return null;
    }
    let best: VenueDraft | null = null;
    for (const v of this.venues.values()) {
      const dir = v.note.dir;
      if (dir === '') continue;
      if ((note.dir === dir || note.dir.startsWith(`${dir}/`)) && (!best || dir.length > best.note.dir.length)) best = v;
    }
    if (!best) this.error(note.file, 'No se sabe a qué recinto pertenece: añade `venue: "[[Recinto]]"`');
    return best;
  }

  addZones(notes: VaultNote[]): void {
    for (const note of notes) {
      const venue = this.venueFor(note);
      if (!venue) continue;
      const name = asString(note.data.name) ?? note.basename;
      const id = asString(note.data.id) ?? `${venue.id}.zona-${slugify(name)}`;
      if (venue.zones.some((z) => z.id === id)) {
        this.error(note.file, `Zona duplicada en ${venue.name}: ${id}`);
        continue;
      }
      venue.zones.push({ id, name, aliases: asStringList(note.data.aliases), note });
    }
  }

  private zoneFor(venue: VenueDraft, note: VaultNote): (VenueZone & { note: VaultNote }) | null {
    const link = parseLink(note.data.zone);
    if (!link) {
      this.error(note.file, 'Sección sin `zone`: añade `zone: "[[Zona]]"`');
      return null;
    }
    const wanted = normalizeLabel(link.name);
    const zone = venue.zones.find(
      (z) =>
        normalizeLabel(z.name) === wanted ||
        normalizeLabel(z.note.basename) === wanted ||
        normalizeLabel(z.id) === wanted ||
        z.aliases.some((a) => normalizeLabel(a) === wanted),
    );
    if (!zone) this.error(note.file, `La zona "${link.name}" no existe en ${venue.name}`);
    return zone ?? null;
  }

  addSections(notes: VaultNote[]): void {
    for (const note of notes) {
      const venue = this.venueFor(note);
      if (!venue) continue;
      const zone = this.zoneFor(venue, note);
      if (!zone) continue;
      const name = asString(note.data.name) ?? note.basename;
      const id = asString(note.data.id) ?? `${venue.id}.${slugify(name)}`;
      if (venue.sections.some((s) => s.id === id)) {
        this.error(note.file, `Sección duplicada en ${venue.name}: ${id}`);
        continue;
      }
      const kind = parseKind(note.data.kind);
      if (!kind) {
        this.error(note.file, '`kind` debe ser SEATED (sentado) o STANDING (de pie)');
        continue;
      }
      const rows = asNumber(note.data.rows);
      const seatsPerRow = asNumber(note.data.seatsPerRow);
      let capacity = asNumber(note.data.capacity);
      if (capacity === null && rows !== null && seatsPerRow !== null) capacity = rows * seatsPerRow;
      if (capacity === null) venue.missingCapacity += 1;
      let view = asNumber(note.data.view);
      if (view !== null && (view < 0 || view > 5)) {
        this.warn(note.file, '`view` va de 0 a 5; se ajusta al rango');
        view = Math.min(5, Math.max(0, view));
      }
      const provenance = this.provenance(note, venue.provenance);
      if (provenance.confidence < 0.7) {
        venue.warnings.push(`Sección ${name}: confianza baja (${provenance.confidence})`);
      }
      venue.sections.push({
        id,
        name,
        zoneId: zone.id,
        level: asString(note.data.level),
        kind,
        aliases: asStringList(note.data.aliases),
        rows: rows === null ? null : Math.trunc(rows),
        seatsPerRow: seatsPerRow === null ? null : Math.trunc(seatsPerRow),
        capacity: capacity === null ? null : Math.trunc(capacity),
        attributes: {
          view: view ?? undefined,
          obstructed: asBoolean(note.data.obstructed) ?? undefined,
          accessible: asBoolean(note.data.accessible) ?? undefined,
          covered: asBoolean(note.data.covered) ?? undefined,
          distance: asNumber(note.data.distance) ?? undefined,
        },
        provenance,
        closed: false,
        note,
      });
    }
  }

  buildIndexes(): void {
    for (const venue of this.venues.values()) {
      if (venue.sections.length === 0) {
        this.warn(venue.note.file, `El recinto ${venue.name} no tiene secciones`);
      }
      venue.zones.sort((a, b) => a.id.localeCompare(b.id));
      venue.sections.sort((a, b) => a.id.localeCompare(b.id));

      const zoneKeys = new Map<string, Set<string>>();
      for (const z of venue.zones) {
        for (const key of [z.name, z.id, z.note.basename, ...z.aliases]) {
          for (const k of [normalizeLabel(key), compactLabel(key)]) {
            if (!k) continue;
            const set = zoneKeys.get(k) ?? new Set<string>();
            set.add(z.id);
            zoneKeys.set(k, set);
          }
        }
      }
      venue.zoneAliasIndex = this.finalizeIndex(venue, zoneKeys, 'zona');

      const zoneName = new Map(venue.zones.map((z) => [z.id, z.name] as const));
      const sectionKeys = new Map<string, Set<string>>();
      for (const s of venue.sections) {
        const zn = zoneName.get(s.zoneId) ?? '';
        for (const key of [s.name, s.id, s.note.basename, `${zn} ${s.name}`, ...s.aliases]) {
          for (const k of [normalizeLabel(key), compactLabel(key)]) {
            if (!k) continue;
            const set = sectionKeys.get(k) ?? new Set<string>();
            set.add(s.id);
            sectionKeys.set(k, set);
          }
        }
      }
      venue.sectionAliasIndex = this.finalizeIndex(venue, sectionKeys, 'sección');
    }
  }

  private finalizeIndex(venue: VenueDraft, keys: Map<string, Set<string>>, what: string): Record<string, string> {
    const index: Record<string, string> = {};
    for (const k of [...keys.keys()].sort()) {
      const ids = keys.get(k) as Set<string>;
      if (ids.size === 1) {
        index[k] = [...ids][0] as string;
      } else {
        const msg = `Alias ambiguo "${k}" apunta a varias ${what === 'zona' ? 'zonas' : 'secciones'} (${[...ids].join(', ')}); se ignora`;
        venue.warnings.push(msg);
        this.warn(venue.note.file, msg);
      }
    }
    return index;
  }

  buildArtifact(venue: VenueDraft, eventId: string | null, closed: Set<string>, overrideNotes: string[], extraFiles: string[]): VenueArtifact {
    const zones: VenueZone[] = venue.zones.map((z) => ({ id: z.id, name: z.name, aliases: z.aliases }));
    const sections: VenueSection[] = venue.sections.map(({ note: _note, ...s }) => ({ ...s, closed: closed.has(s.id) }));
    const allProv = [venue.provenance, ...venue.sections.map((s) => s.provenance)];
    const oldest = allProv.map((p) => p.verifiedAt).sort()[0] ?? venue.provenance.verifiedAt;
    const meanConfidence =
      venue.sections.length === 0
        ? venue.provenance.confidence
        : venue.sections.reduce((acc, s) => acc + s.provenance.confidence, 0) / venue.sections.length;
    const provenance: Provenance = {
      source: venue.provenance.source,
      verifiedAt: oldest,
      confidence: Math.round(Math.min(venue.provenance.confidence, meanConfidence) * 1000) / 1000,
      verifiedBy: venue.provenance.verifiedBy,
    };
    const sourceFiles = [
      venue.note.file,
      ...venue.zones.map((z) => z.note.file),
      ...venue.sections.map((s) => s.note.file),
      ...extraFiles,
    ].sort();
    const content = {
      venueId: venue.id,
      eventId,
      name: venue.name,
      city: venue.city,
      compilerVersion: COMPILER_VERSION,
      sourceFiles,
      provenance,
      zones,
      sections,
      sectionAliasIndex: venue.sectionAliasIndex,
      zoneAliasIndex: venue.zoneAliasIndex,
      overrideNotes,
      warnings: [...venue.warnings],
    };
    return { hash: hashOf(content), compiledAt: iso(this.opts.now?.() ?? Date.now()), ...content };
  }

  // -------------------------------------------------------------------------
  // Proveedores
  // -------------------------------------------------------------------------

  compileProviders(notes: VaultNote[]): ProviderAuthorization[] {
    const out: ProviderAuthorization[] = [];
    const seen = new Set<string>();
    for (const note of notes) {
      const name = asString(note.data.name) ?? note.basename;
      const providerId = asString(note.data.id) ?? slugify(name);
      if (seen.has(providerId)) {
        this.error(note.file, `Proveedor duplicado: ${providerId}`);
        continue;
      }
      const modeRaw = (asString(note.data.mode) ?? 'MANUAL_ASSIST').toUpperCase();
      if (!['SIMULATED', 'MANUAL_ASSIST', 'AUTHORIZED_API'].includes(modeRaw)) {
        this.error(note.file, '`mode` debe ser SIMULATED, MANUAL_ASSIST o AUTHORIZED_API');
        continue;
      }
      const authorized: CapabilityName[] = [];
      let prohibited = false;
      for (const cap of asStringList(note.data.authorizedCapabilities)) {
        if ((PROHIBITED_CAPABILITIES as readonly string[]).includes(cap)) {
          this.error(note.file, `Capability prohibida por diseño: ${cap}. El sistema nunca paga, resuelve retos, salta colas, sobrepasa límites ni suplanta identidades.`);
          prohibited = true;
        } else if ((CAPABILITIES as readonly string[]).includes(cap)) {
          authorized.push(cap as CapabilityName);
        } else {
          this.warn(note.file, `Capability desconocida: ${cap}`);
        }
      }
      if (prohibited) continue;
      const rawUrl = note.data.url;
      const url = parseOfficialUrl(rawUrl);
      if (asString(rawUrl) && !url) this.warn(note.file, '`url` debe ser un enlace completo que empiece por https://');
      if (modeRaw === 'SIMULATED' && providerId !== 'sim') {
        this.warn(note.file, 'Solo existe un proveedor simulado (id `sim`): este proveedor no tendrá adapter');
      }
      if (modeRaw === 'AUTHORIZED_API') {
        this.warn(
          note.file,
          'AUTHORIZED_API necesita un adapter programado y un acuerdo por escrito con el proveedor; este proyecto no incluye ninguno, así que funcionará como asistencia manual',
        );
      }
      seen.add(providerId);
      for (const key of [providerId, name, note.basename]) this.providerLookup.set(normalizeLabel(key), providerId);
      out.push({
        providerId,
        name,
        mode: modeRaw as ProviderMode,
        authorized: [...new Set(authorized)].sort(),
        source: asString(note.data.source) ?? '',
        verifiedAt: this.date(note, 'verifiedAt'),
        notes: asString(note.data.notes) ?? '',
        sourceFile: note.file,
        url,
      });
    }
    return out.sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------

  compileEvents(notes: VaultNote[], artifacts: VenueArtifact[]): CatalogEvent[] {
    const events: CatalogEvent[] = [];
    const seen = new Set<string>();
    for (const note of notes) {
      const name = asString(note.data.name) ?? note.basename;
      const id = asString(note.data.id) ?? slugify(name);
      if (seen.has(id)) {
        this.error(note.file, `Evento duplicado: ${id}`);
        continue;
      }
      const venueLink = parseLink(note.data.venue);
      const venueId = venueLink ? this.venueLookup.get(normalizeLabel(venueLink.name)) : undefined;
      const venue = venueId ? this.venues.get(venueId) : undefined;
      if (!venue) {
        this.error(note.file, venueLink ? `El recinto "${venueLink.name}" no existe` : 'Evento sin `venue`');
        continue;
      }
      const providerLink = parseLink(note.data.provider);
      const providerId = providerLink
        ? (this.providerLookup.get(normalizeLabel(providerLink.name)) ?? null)
        : null;
      if (!providerId) {
        this.error(note.file, providerLink ? `El proveedor "${providerLink.name}" no existe en 30 Proveedores` : 'Evento sin `provider`');
        continue;
      }
      const startsAt = this.date(note, 'startsAt');
      if (!startsAt) {
        this.error(note.file, 'Evento sin `startsAt` válido');
        continue;
      }
      const providerEventRef = asString(note.data.providerEventRef);
      if (!providerEventRef) {
        this.error(note.file, 'Evento sin `providerEventRef` (referencia del evento en el proveedor)');
        continue;
      }
      const rawUrl = note.data.url;
      const url = parseOfficialUrl(rawUrl);
      if (asString(rawUrl) && !url) this.warn(note.file, '`url` debe ser un enlace completo que empiece por https://');
      const limits = this.limits(note);
      const closed = new Set<string>();
      for (const raw of note.data.closedSections === undefined ? [] : [note.data.closedSections].flat()) {
        const link = parseLink(raw);
        if (!link) continue;
        const key = normalizeLabel(link.name);
        const sectionId = venue.sectionAliasIndex[key] ?? venue.sectionAliasIndex[compactLabel(link.name)];
        if (sectionId) closed.add(sectionId);
        else this.warn(note.file, `closedSections: "${link.name}" no es una sección de ${venue.name}`);
      }
      const overrideNotes = asStringList(note.data.overrideNotes);
      if (closed.size > 0 || overrideNotes.length > 0) {
        artifacts.push(this.buildArtifact(venue, id, closed, overrideNotes, [note.file]));
      }
      seen.add(id);
      events.push({
        id,
        name,
        venueId: venue.id,
        providerId,
        providerEventRef,
        startsAt,
        currency: (asString(note.data.currency) ?? 'EUR').toUpperCase(),
        limits,
        createdAt: iso(note.birthtimeMs),
        updatedAt: iso(note.mtimeMs),
        onSaleAt: this.date(note, 'onSaleAt'),
        closedSectionIds: [...closed].sort(),
        sourceFile: note.file,
        tags: asStringList(note.data.tags),
        url,
      });
    }
    return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  }

  private limits(note: VaultNote): EventLimits {
    const intOr = (key: string, fallback: number): number => {
      const n = asNumber(note.data[key]);
      if (n === null) return fallback;
      if (!Number.isInteger(n) || n < 0) {
        this.warn(note.file, `\`${key}\` debe ser un entero ≥ 0`);
        return Math.max(0, Math.trunc(n));
      }
      return n;
    };
    const perAccount = intOr('limitPerAccount', 0);
    const perGroup = intOr('limitPerGroup', perAccount);
    const perOperation = intOr('limitPerOperation', perAccount);
    const semanticsRaw = (asString(note.data.limitSemantics) ?? 'UNKNOWN').toUpperCase();
    let semantics: LimitSemantics = 'UNKNOWN';
    if ((LIMIT_SEMANTICS as readonly string[]).includes(semanticsRaw)) semantics = semanticsRaw as LimitSemantics;
    else this.warn(note.file, `limitSemantics desconocida: ${semanticsRaw}; se trata como UNKNOWN`);
    const verified = asBoolean(note.data.limitsVerified) ?? false;
    const source = asString(note.data.limitsSource) ?? '';
    if (perAccount === 0) this.warn(note.file, 'Sin `limitPerAccount`: no se podrá armar ninguna operación');
    if (verified && semantics === 'UNKNOWN') this.warn(note.file, 'Límites marcados como verificados pero con semántica UNKNOWN: no se podrá armar');
    if (verified && source === '') this.warn(note.file, 'Límites verificados sin `limitsSource`: anota de dónde salen');
    if (perGroup > 0 && perAccount > 0 && semantics === 'PER_ACCOUNT' && perGroup !== perAccount) {
      this.warn(note.file, 'Con semántica PER_ACCOUNT el grupo es la cuenta: limitPerGroup debería ser igual a limitPerAccount');
    }
    return {
      perAccount,
      perGroup,
      perOperation,
      semantics,
      verified,
      source,
      verifiedAt: this.date(note, 'limitsVerifiedAt'),
      verifiedBy: asString(note.data.limitsVerifiedBy),
      notes: asString(note.data.limitsNotes) ?? '',
    };
  }

  venueDrafts(): VenueDraft[] {
    return [...this.venues.values()];
  }

  /**
   * Secciones sin aforo: el aforo solo lo necesita el simulador, así que solo se
   * avisa en los recintos que usa algún evento simulado (en asistencia manual no hace falta).
   */
  warnMissingCapacity(events: Array<{ venueId: string; providerId: string }>, providers: Array<{ providerId: string; mode: string }>): void {
    const simulated = new Set(providers.filter((p) => p.mode === 'SIMULATED').map((p) => p.providerId));
    const simVenues = new Set(events.filter((e) => simulated.has(e.providerId)).map((e) => e.venueId));
    for (const venue of this.venues.values()) {
      if (venue.missingCapacity === 0 || !simVenues.has(venue.id)) continue;
      const n = venue.missingCapacity;
      this.warn(
        venue.note.file,
        `${n} ${n === 1 ? 'sección' : 'secciones'} de ${venue.name} sin aforo (\`capacity\`): el simulador lo necesita para ensayar en este recinto`,
      );
    }
  }
}

export async function compileVault(opts: CompileOptions): Promise<CompiledVault> {
  const started = performance.now();
  const readIssues: VaultIssue[] = [];
  const notes = await readVaultNotes(opts.vaultDir, readIssues);
  const c = new Compiler(opts);
  for (const i of readIssues) (i.severity === 'ERROR' ? c.errors : c.warnings).push(i);

  const byType = (t: string) => notes.filter((n) => noteType(n) === t);
  c.addVenues(byType('venue'));
  c.addZones(byType('zone'));
  c.addSections(byType('section'));
  c.buildIndexes();

  const artifacts: VenueArtifact[] = c
    .venueDrafts()
    .map((v) => c.buildArtifact(v, null, new Set(), [], []));
  const providers = c.compileProviders(byType('provider'));
  const events = c.compileEvents(byType('event'), artifacts);
  c.warnMissingCapacity(events, providers);

  artifacts.sort((a, b) => a.venueId.localeCompare(b.venueId) || (a.eventId ?? '').localeCompare(b.eventId ?? ''));
  const report: VaultCompileReport = {
    at: iso(opts.now?.() ?? Date.now()),
    ok: c.errors.length === 0,
    vaultDir: opts.vaultDir,
    compilerVersion: COMPILER_VERSION,
    durationMs: Math.round((performance.now() - started) * 10) / 10,
    notes: notes.length,
    venues: artifacts
      .filter((a) => a.eventId === null)
      .map((a) => ({
        venueId: a.venueId,
        name: a.name,
        hash: a.hash,
        zones: a.zones.length,
        sections: a.sections.length,
        sourceFile: c.venueDrafts().find((v) => v.id === a.venueId)?.note.file ?? '',
      })),
    events: events.length,
    providers: providers.length,
    errors: c.errors,
    warnings: c.warnings,
  };
  return { report, artifacts, events, providers };
}

/** Artefacto que corresponde a un evento: el específico si tiene overrides, si no el base del recinto. */
export function artifactForEvent(artifacts: VenueArtifact[], event: { id: string; venueId: string }): VenueArtifact | null {
  return (
    artifacts.find((a) => a.venueId === event.venueId && a.eventId === event.id) ??
    artifacts.find((a) => a.venueId === event.venueId && a.eventId === null) ??
    null
  );
}
