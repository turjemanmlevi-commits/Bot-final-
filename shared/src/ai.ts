/**
 * Claude (API de Anthropic) investiga los eventos por ti: al elegir la web de
 * venta, mira qué eventos tiene; al elegir uno, reúne sus datos oficiales
 * (fecha, hora, recinto, fases de venta, límite de compra, precios y cómo es
 * el recinto) citando de dónde sale cada cosa. Solo lee información pública:
 * no entra en ninguna cuenta ni compra nada.
 */

import { z } from 'zod';
import type { LimitSemantics } from './domain';

export interface AiStatus {
  /** Hay clave puesta. */
  configured: boolean;
  /** true: la clave funciona; false: falló la última vez; null: sin probar. */
  ok: boolean | null;
  detail: string;
  /** Modelo que se usa. */
  model: string;
  /** Id del modelo que se usa (null: se elige en la primera consulta). */
  modelId: string | null;
  /** Una persona ha elegido el modelo (ANTHROPIC_MODEL); si no, el Sonnet más reciente de la cuenta. */
  modelFixed: boolean;
  /** La clave se puede poner desde el dashboard (se guarda en .env). */
  configurable: boolean;
  /** Gastado desde que arrancó la sala (dólares, aproximado). */
  spentUsd: number;
}

/** Un modelo de la cuenta que sirve para las búsquedas, con su precio orientativo. */
export interface AiModelOption {
  id: string;
  name: string;
  /** Dólares por millón de tokens leídos (entrada) y escritos (salida). */
  input: number;
  output: number;
}

export interface AiModelsResult {
  /** Modelo que se usa ahora (null: se elige en la primera consulta). */
  current: string | null;
  fixed: boolean;
  options: AiModelOption[];
}

/** Modelo para las búsquedas; null = el Sonnet más reciente de la cuenta. */
export const AiModelSchema = z.object({
  model: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/, 'Nombre de modelo no válido')
    .nullable(),
});

/** Clave de la API de Claude (sk-ant-…); null = quitarla. */
export const AiKeySchema = z.object({
  key: z
    .string()
    .trim()
    .max(300)
    .regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, 'Pega la clave completa: empieza por «sk-ant-»'),
});

export interface AiKeyResult {
  ok: boolean;
  message: string;
  status: AiStatus;
}

/** Lo que ha costado una consulta (precio de la API, en dólares). */
export interface AiCost {
  usd: number;
  searches: number;
  fetches: number;
  inputTokens: number;
  outputTokens: number;
  seconds: number;
}

export const AiEventsQuerySchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  days: z.number().int().min(1).max(365),
  /** Afinar: artista, equipo, ciudad… (opcional). */
  q: z.string().trim().max(100).optional(),
  /** Otra página de la web de venta (p. ej. la sección de entradas); por defecto, su web oficial. */
  siteUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\/\S+$/i, 'Pega el enlace completo, empezando por https://')
    .nullable()
    .optional(),
  /** true = volver a preguntar aunque haya una respuesta reciente guardada. */
  fresh: z.boolean().optional(),
});
export type AiEventsQuery = z.infer<typeof AiEventsQuerySchema>;

export interface AiEventSummary {
  name: string;
  /** «AAAA-MM-DDTHH:mm» hora de España (00:00 si la hora no está publicada). */
  startsAtLocal: string | null;
  timeTBA: boolean;
  venue: string | null;
  city: string | null;
  url: string | null;
  /** Apertura de la venta si ya se sabe, «AAAA-MM-DDTHH:mm». */
  saleOpensLocal: string | null;
  sourceUrl: string | null;
  /** Recinto de la sala que le corresponde (null: se crea al elegirlo). */
  vaultVenueId: string | null;
}

export interface AiEventsResult {
  providerId: string;
  events: AiEventSummary[];
  /** Lo que Claude quiere que sepas (p. ej. «la web no deja leer la lista; sale de su buscador»). */
  notes: string;
  cost: AiCost;
  /** Respuesta guardada de hace poco (no ha costado nada). */
  cached: boolean;
}

export const AiDetailsQuerySchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(200),
  startsAtLocal: z.string().trim().max(20).nullable().optional(),
  venue: z.string().trim().max(160).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  url: z.string().trim().max(1000).nullable().optional(),
  fresh: z.boolean().optional(),
});
export type AiDetailsQuery = z.infer<typeof AiDetailsQuerySchema>;

export type AiEventStatus = 'ON_SALE' | 'UPCOMING' | 'SOLD_OUT' | 'CANCELLED' | 'POSTPONED' | null;

export interface AiEventDetails {
  name: string;
  startsAtLocal: string | null;
  timeTBA: boolean;
  venue: string | null;
  city: string | null;
  /** Enlace directo a la página de COMPRA del evento en la web oficial (nunca una reventa). */
  url: string | null;
  /** Quién vende oficialmente (el club, la ticketera, la UEFA…). */
  seller: string | null;
  /** Aviso si Claude encontró un enlace que no vale (p. ej. una web de reventa). */
  urlWarning: string | null;
  /** Fases de venta (socios, preventa, general…) con su apertura y, si lo dicen, su límite por persona. */
  sales: Array<{ name: string; opensAtLocal: string; limit: number | null }>;
  limit: {
    perPerson: number | null;
    semantics: LimitSemantics | null;
    /** Frase literal de las condiciones. */
    quote: string | null;
    sourceUrl: string | null;
    /** La frase sale de la web de venta oficial (no de una noticia). */
    official: boolean;
  };
  price: { min: number | null; max: number | null; currency: string } | null;
  /**
   * Cómo está estructurada la venta de ESTE evento: zonas y secciones con los
   * nombres de la web de venta, su precio si se ve y, si el recinto ya está en
   * la sala, a qué zona de nuestro plano corresponde cada una.
   */
  layout: AiSaleZone[] | null;
  /** Imagen del plano oficial (tal cual se ve al comprar), si Claude la ha encontrado. */
  planImageUrl: string | null;
  status: AiEventStatus;
  notes: string;
  sources: string[];
  vaultVenueId: string | null;
  cost: AiCost;
  cached: boolean;
}

export interface AiSaleZone {
  zone: string;
  sections: string[];
  standing: boolean;
  /** Precio de la zona tal y como lo enseña la web («60–150 €»), o null. */
  price: string | null;
  /** Zona de nuestro plano a la que corresponde (recinto ya en la sala), o null si no está. */
  venueZone: string | null;
}

export const AI_STATUS_LABEL: Record<Exclude<AiEventStatus, null>, string> = {
  ON_SALE: 'A la venta',
  UPCOMING: 'Venta próximamente',
  SOLD_OUT: 'Agotado',
  CANCELLED: 'Cancelado',
  POSTPONED: 'Aplazado',
};

// ---------------------------------------------------------------------------
// Plano oficial: dónde está cada zona en la imagen (para tocarla)
// ---------------------------------------------------------------------------

export const AiSeatMapQuerySchema = z.object({
  imageUrl: z.string().trim().max(1000).regex(/^https:\/\/\S+$/i, 'La imagen del plano tiene que ser un enlace https://'),
  /** Zonas del recinto de la sala (los nombres que se van a elegir). */
  zones: z.array(z.string().trim().min(1).max(120)).min(1).max(80),
  venue: z.string().trim().max(160).optional(),
  fresh: z.boolean().optional(),
});
export type AiSeatMapQuery = z.infer<typeof AiSeatMapQuerySchema>;

/** Punto de una zona sobre la imagen del plano: x e y en % (0,0 = arriba a la izquierda). */
export interface PlanPoint {
  zone: string;
  x: number;
  y: number;
}

export interface AiSeatMap {
  imageUrl: string;
  points: PlanPoint[];
  /** Por qué faltan zonas o no se ha podido leer la imagen (vacío si todo bien). */
  notes: string;
  cost: AiCost;
  cached: boolean;
}

/** Hasta 3 sitios preferidos, cada uno con su color (el mismo en el dashboard y en Telegram). */
export const MAX_PREFERENCES = 3;
export const PREFERENCE_COLORS = ['#16a34a', '#f97316', '#2563eb'] as const;
export const PREFERENCE_EMOJI = ['🟢', '🟠', '🔵'] as const;
export const PREFERENCE_NAME = ['verde', 'naranja', 'azul'] as const;

// ---------------------------------------------------------------------------
// De lo que devuelve Claude a un evento de la sala (lo usan el dashboard y el bot)
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Nombre limpio para el «recinto rápido» (sin los separadores «:», «,», «;» ni la marca de pie). */
function layoutName(s: string): string {
  return s
    .replace(/[:,;#\r\n]+/g, ' ')
    .replace(/\((?:de pie|pie|standing|general)\)/gi, ' ')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Las zonas que ha leído Claude en el formato del «recinto rápido»
 * («Zona (de pie): sección, sección»), sin repetidos y dentro de los topes
 * (60 zonas, 400 secciones). Cadena vacía si no hay nada aprovechable.
 */
export function aiLayoutText(layout: AiEventDetails['layout']): string {
  if (!layout) return '';
  const zones = new Set<string>();
  const lines: string[] = [];
  let sections = 0;
  for (const z of layout) {
    const zone = layoutName(z.zone);
    const zk = norm(zone);
    if (zk === '' || zones.has(zk) || zones.size >= 60) continue;
    zones.add(zk);
    const seen = new Set<string>();
    const secs: string[] = [];
    for (const raw of z.sections) {
      const s = layoutName(raw);
      const sk = norm(s);
      if (sk === '' || seen.has(sk) || sections + secs.length >= 400) continue;
      seen.add(sk);
      secs.push(s);
    }
    sections += Math.max(1, secs.length);
    lines.push(`${zone}${z.standing ? ' (de pie)' : ''}${secs.length > 0 ? `: ${secs.join(', ')}` : ''}`);
  }
  return lines.join('\n');
}

/** Fase de venta por defecto: la venta general que aún no ha abierto; si no, la próxima; si no, la última. */
export function aiDefaultSale(sales: AiEventDetails['sales'], nowLocal: string): AiEventDetails['sales'][number] | null {
  const future = sales.filter((s) => s.opensAtLocal >= nowLocal);
  return future.find((s) => /general/i.test(s.name)) ?? future[0] ?? sales.at(-1) ?? null;
}

/**
 * ¿Deja el límite puesto comprar más que el de la fase de venta («máx. 1 por
 * persona» en la de socios)? Mira «Por cuenta» y, si el límite se cuenta por
 * titular, hogar o tarjeta, también «Por grupo» (es lo que puede comprar una
 * persona sumando sus cuentas). null si cabe.
 */
export function limitAbovePhase(
  limits: { perAccount: number; perGroup: number; semantics: LimitSemantics },
  phaseLimit: number | null,
): { field: 'perAccount' | 'perGroup'; value: number } | null {
  if (phaseLimit === null) return null;
  if (limits.perAccount > phaseLimit) return { field: 'perAccount', value: limits.perAccount };
  if (limits.semantics !== 'PER_ACCOUNT' && limits.perGroup > phaseLimit) return { field: 'perGroup', value: limits.perGroup };
  return null;
}

/** Datos del evento listos para el formulario o para crearlo desde Telegram. */
export interface AiEventDraft {
  name: string;
  url: string | null;
  startsAt: string | null;
  onSaleAt: string | null;
  currency: string;
  /** null: la página no publica el límite (se queda lo que hubiera). */
  limit: {
    perAccount: number;
    semantics: LimitSemantics;
    verified: boolean;
    source: string;
    notes: string;
  } | null;
  /** Si no hay límite: de dónde mirarlo. */
  limitsSource: string;
  notes: string;
  /** Estructura de la venta (líneas para la nota del evento). */
  saleZones: string[];
}

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Traduce los datos de Claude a un evento de la sala. El límite queda
 * «verificado» solo si Claude cita la frase de la web de venta oficial (y la
 * fase elegida no da más que esa frase); si no, se rellena pero hay que confirmarlo.
 */
export function aiEventDraft(d: AiEventDetails, opts: { saleName?: string | null; saleIndex?: number | null; today: string; nowLocal: string }): AiEventDraft {
  // Por posición manda sobre el nombre: dos fases pueden llamarse igual («Venta socios» del 1 y del 2).
  const sale =
    opts.saleIndex !== undefined
      ? opts.saleIndex === null
        ? null
        : (d.sales[opts.saleIndex] ?? null)
      : opts.saleName === undefined
        ? aiDefaultSale(d.sales, opts.nowLocal)
        : (d.sales.find((s) => s.name === opts.saleName) ?? null);
  // El límite de la fase elegida (socios, general…) manda sobre el general.
  const n = sale?.limit ?? d.limit.perPerson;
  const quote = sale?.limit && sale.limit !== d.limit.perPerson ? `${sale.limit} por persona en «${sale.name}»` : d.limit.quote ? `«${d.limit.quote}»` : `${n} por persona`;
  const from = host(d.limit.sourceUrl) ?? 'la web';
  // La fase no trae su propia fuente: solo queda verificada si no supera la frase oficial citada.
  const verified = d.limit.official && n !== null && d.limit.perPerson !== null && n <= d.limit.perPerson;
  const limit =
    n !== null
      ? {
          perAccount: n,
          semantics: d.limit.semantics ?? 'PER_HOLDER',
          verified,
          source: `${verified ? 'Condiciones oficiales' : 'Según'} ${from} (leído por Claude el ${opts.today}): ${quote}${d.limit.sourceUrl ? ` · ${d.limit.sourceUrl}` : ''}`.slice(0, 500),
          notes: verified
            ? ''
            : d.limit.official && d.limit.perPerson !== null
              ? `La fase «${sale?.name ?? ''}» da ${n} por persona y la frase oficial dice ${d.limit.perPerson}: compruébalo en la web de venta antes de marcarlo como verificado.`.slice(0, 500)
              : 'No sale de la web de venta oficial: compruébalo allí antes de marcarlo como verificado.',
        }
      : null;
  const notes: string[] = [`Datos reunidos por Claude el ${opts.today} (revísalos en la web oficial).`];
  if (d.timeTBA) notes.push('Hora del evento: por confirmar.');
  if (d.seller) notes.push(`Venta oficial: ${d.seller}${d.url ? ` — ${d.url}` : ''}.`);
  if (d.sales.length > 0) {
    notes.push(`Fases de venta: ${d.sales.map((s) => `${s.name} (${s.opensAtLocal.replace('T', ' ')}${s.limit ? `, máx. ${s.limit} por persona` : ''})`).join('; ')}.`);
  }
  if (sale) notes.push(`Apertura elegida: ${sale.name}.`);
  if (d.price && (d.price.min !== null || d.price.max !== null)) {
    notes.push(`Precios: ${[d.price.min, d.price.max].filter((x) => x !== null).join('–')} ${d.price.currency}.`);
  }
  if (d.layout && d.layout.length > 0) notes.push(`Estructura de la venta: ${aiSaleZonesText(d.layout).join(' | ')}.`);
  if (d.status) notes.push(`Estado: ${AI_STATUS_LABEL[d.status]}.`);
  if (d.notes) notes.push(d.notes);
  if (d.sources.length > 0) notes.push(`Fuentes: ${d.sources.join(' · ')}`);
  return {
    name: d.name.slice(0, 120),
    url: d.url,
    startsAt: d.startsAtLocal,
    onSaleAt: sale?.opensAtLocal ?? null,
    currency: d.price?.currency && /^[A-Z]{3}$/.test(d.price.currency) ? d.price.currency : 'EUR',
    limit,
    limitsSource: d.url ? `Página oficial: ${d.url}`.slice(0, 500) : '',
    notes: notes.join('\n').slice(0, 5000),
    saleZones: aiSaleZonesText(d.layout),
  };
}

/**
 * La estructura de la venta en líneas para la nota del evento (se leen y se
 * editan en Obsidian): «Lateral Este: Grada baja, Grada alta · 60–150 € → Lateral Este».
 */
export function aiSaleZonesText(layout: AiEventDetails['layout']): string[] {
  if (!layout) return [];
  // « · » separa el precio y «→» nuestra zona: dentro de un nombre se cambian por « - » (al buscar alias es lo mismo).
  const clean = (s: string) => layoutName(s).replace(/\s*[·→]\s*/g, ' - ').trim();
  return layout.slice(0, 60).map((z) => {
    const name = clean(z.zone) + (z.standing ? ' (de pie)' : '');
    const secs = z.sections.map(clean).filter(Boolean);
    const price = z.price ? ` · ${z.price.replace(/[·→]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)}` : '';
    const ours = z.venueZone ? ` → ${z.venueZone}` : '';
    return `${name}${secs.length > 0 ? `: ${secs.join(', ')}` : ''}${price}${ours}`.slice(0, 400);
  });
}

/** Una línea de la estructura de la venta (lo contrario de aiSaleZonesText). */
export function parseSaleZone(line: string): { zone: string; sections: string[]; standing: boolean; price: string | null; venueZone: string | null } | null {
  let rest = line.trim();
  if (!rest) return null;
  let venueZone: string | null = null;
  const arrow = rest.lastIndexOf('→');
  if (arrow >= 0) {
    venueZone = rest.slice(arrow + 1).trim() || null;
    rest = rest.slice(0, arrow).trim();
  }
  let price: string | null = null;
  const dot = rest.indexOf(' · ');
  if (dot >= 0) {
    price = rest.slice(dot + 3).trim() || null;
    rest = rest.slice(0, dot).trim();
  }
  const colon = rest.indexOf(':');
  let zone = colon >= 0 ? rest.slice(0, colon).trim() : rest;
  const sections = colon >= 0 ? rest.slice(colon + 1).split(',').map((x) => x.trim()).filter(Boolean) : [];
  const standing = /\((?:de pie|pie|standing|general)\)\s*$/i.test(zone);
  zone = zone.replace(/\s*\((?:de pie|pie|standing|general)\)\s*$/i, '').trim();
  return zone ? { zone, sections, standing, price, venueZone } : null;
}
