/**
 * Alta de eventos y recintos desde el dashboard. El servidor los escribe como
 * notas de Obsidian en el vault (la fuente de verdad sigue siendo el vault) y
 * recompila. Aquí están los esquemas de entrada y el parser del "recinto rápido",
 * compartidos para que el dashboard enseñe exactamente lo que se va a crear.
 */

import { z } from 'zod';
import type { CatalogEvent, VaultCompileReport, VaultIssue } from './api';
import { LIMIT_SEMANTICS, type TelegramStatus } from './domain';
import { FEEDS } from './feeds';

/** Fecha y hora local sin zona, como la escribe Obsidian: 2026-09-29T10:00 (se interpreta en VAULT_TZ). */
export const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const localDateTime = z.string().trim().regex(LOCAL_DATETIME_RE, 'Usa el formato AAAA-MM-DDTHH:MM (hora de Madrid)');

/** Enlace oficial: http(s) completo. Solo se enseña como enlace, el servidor nunca lo visita. */
export const officialUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Pega el enlace completo, empezando por https://');

export const EventNoteInputSchema = z
  .object({
    name: z.string().trim().min(3, 'El nombre es demasiado corto').max(120),
    venueId: z.string().trim().min(1, 'Elige el recinto'),
    providerId: z.string().trim().min(1, 'Elige dónde se vende'),
    url: officialUrl.nullable().optional(),
    providerEventRef: z.string().trim().max(160).optional(),
    startsAt: localDateTime,
    onSaleAt: localDateTime.nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase(),
    limitPerAccount: z.number().int().min(1).max(100),
    limitPerGroup: z.number().int().min(1).max(100),
    limitPerOperation: z.number().int().min(1).max(1000),
    limitSemantics: z.enum(LIMIT_SEMANTICS),
    limitsVerified: z.boolean(),
    limitsSource: z.string().trim().max(500),
    limitsNotes: z.string().trim().max(500).optional(),
    notes: z.string().max(5000).optional(),
    /** Evento elegido de una fuente oficial: de dónde sale y su identificador allí. */
    officialFeed: z.enum(FEEDS).nullable().optional(),
    officialId: z
      .string()
      .trim()
      .max(80)
      .regex(/^[A-Za-z0-9_.:-]+$/, 'Identificador oficial no válido')
      .nullable()
      .optional(),
    /** Fase de venta elegida de la fuente («Venta general» o la preventa): su hora es la apertura. */
    officialSale: z.string().trim().max(120).nullable().optional(),
    /** Vigilar el evento desde N días antes de la venta (0 o null = no vigilar). */
    watchDaysBefore: z.number().int().min(0).max(60).nullable().optional(),
    /** Dónde queréis sentaros (zonas o secciones del recinto, en orden de preferencia). */
    preferredTargets: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    /** Imagen del plano oficial (tal cual se ve al comprar) y dónde está cada zona en ella. */
    planImage: z.string().trim().max(1000).regex(/^https:\/\/\S+$/i, 'La imagen del plano tiene que ser un enlace https://').nullable().optional(),
    planPoints: z
      .array(z.object({ zone: z.string().trim().min(1).max(120), x: z.number().min(0).max(100), y: z.number().min(0).max(100) }))
      .max(80)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.officialFeed) !== Boolean(v.officialId)) {
      ctx.addIssue({ code: 'custom', path: ['officialId'], message: 'Falta la fuente o el identificador del evento oficial' });
    }
    if (v.limitsVerified && v.limitSemantics === 'UNKNOWN') {
      ctx.addIssue({ code: 'custom', path: ['limitSemantics'], message: 'Si los límites están verificados, di cómo se cuentan (por cuenta, titular, hogar o tarjeta)' });
    }
    if (v.limitsVerified && v.limitsSource === '') {
      ctx.addIssue({ code: 'custom', path: ['limitsSource'], message: 'Indica de dónde sacas los límites (enlace o texto de las condiciones oficiales)' });
    }
    if (v.limitPerOperation < v.limitPerAccount && v.limitSemantics === 'PER_ACCOUNT') {
      ctx.addIssue({ code: 'custom', path: ['limitPerOperation'], message: 'El tope de la operación no puede ser menor que el de una cuenta' });
    }
  });
export type EventNoteInput = z.infer<typeof EventNoteInputSchema>;

export const VenueQuickInputSchema = z.object({
  name: z.string().trim().min(3, 'El nombre es demasiado corto').max(100),
  city: z.string().trim().max(80).optional(),
  source: z.string().trim().min(3, 'Indica de dónde sale el plano (p. ej. el enlace del plano oficial)').max(300),
  layout: z.string().max(20_000),
});
export type VenueQuickInput = z.infer<typeof VenueQuickInputSchema>;

export interface EventNoteResult {
  /** Ruta de la nota dentro del vault. */
  file: string;
  created: boolean;
  event: CatalogEvent | null;
  /** Errores y avisos del compilador que afectan a esta nota. */
  issues: VaultIssue[];
  report: VaultCompileReport;
}

export interface VenueQuickResult {
  folder: string;
  files: number;
  venueId: string | null;
  issues: VaultIssue[];
  report: VaultCompileReport;
}

export interface TelegramTestResult {
  ok: boolean;
  message: string;
}

/** Resultado de configurar Telegram desde el dashboard (token o chat principal). */
export interface TelegramConfigResult {
  ok: boolean;
  message: string;
  status: TelegramStatus;
}

// ---------------------------------------------------------------------------
// Recinto rápido
// ---------------------------------------------------------------------------

export interface LayoutSection {
  /** Nombre final (único en el recinto). */
  name: string;
  standing: boolean;
}

export interface LayoutZone {
  name: string;
  standing: boolean;
  sections: LayoutSection[];
}

export interface ParsedLayout {
  zones: LayoutZone[];
  errors: string[];
}

const STANDING_RE = /\s*\((?:de pie|pie|standing|general)\)\s*$/i;

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Una zona por línea, con sus secciones tras «:» separadas por comas.
 *
 *     Lateral Este: Grada baja, Primer anfiteatro, Segundo anfiteatro
 *     Pista (de pie)
 *     Grada Alta: 201, 202, 203
 *
 * «(de pie)» marca la zona entera como de pie. Una zona sin secciones tiene una
 * única sección con su mismo nombre. Si un nombre de sección se repite en varias
 * zonas, se le antepone la zona («Lateral Este · Grada baja»).
 */
export function parseVenueLayout(text: string): ParsedLayout {
  const errors: string[] = [];
  const zones: Array<{ name: string; standing: boolean; raw: string[] }> = [];
  const zoneKeys = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    const clean = line.replace(/^\s*[-*•]\s*/, '').trim();
    if (clean === '' || clean.startsWith('#')) return;
    const colon = clean.indexOf(':');
    let zonePart = colon >= 0 ? clean.slice(0, colon) : clean;
    const secPart = colon >= 0 ? clean.slice(colon + 1) : '';
    const standing = STANDING_RE.test(zonePart);
    zonePart = zonePart.replace(STANDING_RE, '').trim();
    if (zonePart === '') {
      errors.push(`Línea ${i + 1}: falta el nombre de la zona`);
      return;
    }
    const key = norm(zonePart);
    if (key === '') {
      errors.push(`Línea ${i + 1}: "${zonePart}" no es un nombre válido`);
      return;
    }
    if (zoneKeys.has(key)) {
      errors.push(`Línea ${i + 1}: la zona "${zonePart}" está repetida`);
      return;
    }
    zoneKeys.add(key);
    const raw = secPart
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
    zones.push({ name: zonePart, standing, raw: raw.length > 0 ? raw : [zonePart] });
  });

  // Secciones repetidas en varias zonas → se antepone la zona.
  const count = new Map<string, number>();
  for (const z of zones) for (const k of new Set(z.raw.map(norm))) count.set(k, (count.get(k) ?? 0) + 1);
  const used = new Set<string>();
  const out: LayoutZone[] = zones.map((z) => {
    const sections: LayoutSection[] = [];
    for (const r of z.raw) {
      const name = (count.get(norm(r)) ?? 0) > 1 ? `${z.name} · ${r}` : r;
      const key = norm(name);
      if (key === '') {
        errors.push(`Zona ${z.name}: "${r}" no es un nombre de sección válido`);
        continue;
      }
      if (used.has(key)) {
        errors.push(`Zona ${z.name}: la sección "${r}" está repetida`);
        continue;
      }
      used.add(key);
      sections.push({ name, standing: z.standing });
    }
    return { name: z.name, standing: z.standing, sections };
  });
  if (out.length === 0) errors.push('Escribe al menos una zona (una por línea)');
  if (out.length > 60) errors.push('Como máximo 60 zonas');
  if (used.size > 400) errors.push('Como máximo 400 secciones');
  return { zones: out, errors };
}

/** Dónde queréis sentaros: zonas o secciones del recinto, en orden de preferencia. */
export const PreferredTargetsSchema = z.object({
  targets: z.array(z.string().trim().min(1).max(120)).max(30),
});

/**
 * Estructura orientativa de un recinto nuevo según su nombre, cuando no hay
 * plano (se revisa después con el plano oficial en Recintos).
 */
export function guessVenueLayout(name: string): string {
  const n = norm(name);
  if (/estadi|stadium|camp nou|campo de futbol|coliseum/.test(n)) return 'Tribuna\nPreferencia\nFondo Norte\nFondo Sur';
  if (/teatro|teatre|auditori|opera|gran casino|sala /.test(`${n} `)) return 'Patio de butacas\nAnfiteatro';
  if (/arena|palacio|pabellon|palau|center|centre|multiusos|coliseo|toros|velodromo|wizink/.test(n)) return 'Pista (de pie)\nGrada baja\nGrada alta';
  if (/festival|recinto|parque|parc|ferial|playa|explanada|ifema|fira/.test(n)) return 'General (de pie)';
  return 'General';
}

/** Punto del plano en la nota de Obsidian: «Fondo Sur @ 50,92» (zona @ x,y en %). */
export function formatPlanPoint(p: { zone: string; x: number; y: number }): string {
  const n = (v: number) => String(Math.round(v * 10) / 10);
  return `${p.zone} @ ${n(p.x)},${n(p.y)}`;
}

export function parsePlanPoint(raw: string): { zone: string; x: number; y: number } | null {
  const m = /^(.+?)\s*@\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/.exec(raw.trim());
  if (!m) return null;
  const x = Number(m[2]);
  const y = Number(m[3]);
  if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) return null;
  return { zone: (m[1] ?? '').trim(), x, y };
}
