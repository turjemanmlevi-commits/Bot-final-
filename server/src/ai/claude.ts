/**
 * Claude investiga los eventos (API de Anthropic, SDK oficial).
 *
 * - Al elegir la web de venta: qué eventos tiene en los próximos días.
 * - Al elegir un evento: fecha y hora, recinto, fases de venta, límite de compra
 *   (con la frase literal y su enlace), precios y cómo es el recinto por dentro.
 *
 * Claude busca y lee páginas públicas con sus herramientas de búsqueda y lectura
 * web, que funcionan en los servidores de Anthropic (no desde este ordenador).
 * Solo lee: no inicia sesión, no compra y no toca ninguna cuenta. Lo que devuelve
 * rellena el formulario para que una persona lo revise; nada se guarda solo.
 *
 * La clave (ANTHROPIC_API_KEY) vive solo en .env y nunca sale por la API.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  bestVenueMatch,
  isRealLocalDateTime,
  venueMentioned,
  type AiCost,
  type AiDetailsQuery,
  type AiEventDetails,
  type AiEventsQuery,
  type AiEventsResult,
  type AiEventStatus,
  type AiEventSummary,
  type AiKeyResult,
  type AiSeatMap,
  type AiSeatMapQuery,
  type AiStatus,
  type AiTopMatch,
  type LimitSemantics,
  type PlanPoint,
  type TopCategory,
  TOP_CATEGORIES,
} from '@to/shared';
import type { Runtime } from '../runtime/runtime';
import { updateEnvFile } from '../util/envfile';
import { log } from '../util/log';
import { localDateTime, TtlCache } from '../feeds/common';

/**
 * Precios orientativos de la API (dólares): por millón de tokens y por búsqueda
 * web, los de la gama Opus actual. El gasto real está en platform.claude.com.
 */
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, perSearch: 0.01 };
/** Familia de modelos que se usa si no se elige otro (ANTHROPIC_MODEL): el más reciente de la cuenta. */
const PREFERRED_FAMILY = /^claude-opus-/;
const DAY = 86_400_000;

export class AiError extends Error {
  constructor(
    readonly code: 'NOT_CONFIGURED' | 'AUTH' | 'RATE' | 'NETWORK' | 'REFUSED' | 'INCOMPLETE' | 'BAD_REQUEST',
    message: string,
  ) {
    super(message);
  }
}

export interface ClaudeControlOptions {
  runtime: Runtime;
  timeZone: string;
  envFile: string | null;
  envTemplate?: string | null;
  /** Modelo fijo (ANTHROPIC_MODEL); sin él, el Opus más reciente que tenga la cuenta. */
  model?: string | null;
  /** Solo para pruebas: servidor que imita la API. */
  baseURL?: string;
}

// ---------------------------------------------------------------------------
// Lo que Claude entrega (herramientas estrictas: la respuesta cumple el esquema)
// ---------------------------------------------------------------------------

const nullable = (description: string) => ({ anyOf: [{ type: 'string' }, { type: 'null' }], description });

const EVENTS_TOOL: Anthropic.Beta.BetaTool = {
  name: 'entregar_eventos',
  description: 'Entrega la lista final de eventos encontrados en la web de venta. Llámala una sola vez, al terminar.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['events', 'notes'],
    properties: {
      events: {
        type: 'array',
        description: 'Eventos encontrados, por fecha (como mucho 40)',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'date', 'time', 'venue', 'city', 'url', 'saleOpens', 'sourceUrl'],
          properties: {
            name: { type: 'string', description: 'Nombre tal y como lo publica la web de venta' },
            date: nullable('Fecha del evento: AAAA-MM-DD'),
            time: nullable('Hora del evento en España: HH:MM (null si no está publicada)'),
            venue: nullable('Recinto (estadio, pabellón, sala…)'),
            city: nullable('Ciudad'),
            url: nullable('Página oficial de venta del evento'),
            saleOpens: nullable('Apertura de la venta en España: AAAA-MM-DDTHH:MM (null si no se sabe)'),
            sourceUrl: nullable('Página de donde sale el dato'),
          },
        },
      },
      notes: { type: 'string', description: 'Avisos breves en español para quien organiza la compra (o cadena vacía)' },
    },
  },
};

const DETAILS_TOOL_NAME = 'entregar_evento';

/**
 * Herramienta de los datos del evento. `zones`: las zonas de nuestro plano del
 * recinto (si ya está en la sala), para que Claude diga a cuál corresponde cada
 * zona de la venta.
 */
function detailsTool(zones: string[]): Anthropic.Beta.BetaTool {
  return {
    name: DETAILS_TOOL_NAME,
    description: 'Entrega los datos del evento para preparar la compra. Llámala una sola vez, al terminar.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'date', 'time', 'venue', 'city', 'url', 'seller', 'sales', 'limit', 'price', 'layout', 'planImage', 'status', 'notes', 'sources'],
      properties: {
        name: { type: 'string', description: 'Nombre exacto del evento en la web de venta' },
        date: nullable('AAAA-MM-DD'),
        time: nullable('HH:MM hora de España (null si no está publicada)'),
        venue: nullable('Recinto'),
        city: nullable('Ciudad'),
        url: nullable('Enlace DIRECTO a la página de COMPRA de entradas de ESTE evento en la web de venta oficial (no una noticia, no una reventa)'),
        seller: nullable('Quién vende oficialmente las entradas (club, ticketera, UEFA…)'),
        sales: {
          type: 'array',
          description: 'Fases de venta (socios, preventa, venta general…) con su apertura y su límite por persona si lo dicen',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'opensAt', 'limit'],
            properties: {
              name: { type: 'string', description: 'Nombre de la fase tal y como la llama la web' },
              opensAt: { type: 'string', description: 'Apertura: AAAA-MM-DDTHH:MM hora de España' },
              limit: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Máximo de entradas por persona en ESTA fase (null si no lo dicen)' },
            },
          },
        },
        limit: {
          type: 'object',
          additionalProperties: false,
          required: ['perPerson', 'scope', 'quote', 'sourceUrl'],
          properties: {
            perPerson: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Máximo de entradas por persona/cuenta/pedido' },
            scope: {
              anyOf: [{ type: 'string', enum: ['CUENTA', 'PERSONA', 'PEDIDO', 'TARJETA', 'HOGAR', 'SOCIO'] }, { type: 'null' }],
              description: 'Cómo cuenta el límite según las condiciones',
            },
            quote: nullable('Frase literal de las condiciones donde lo dice'),
            sourceUrl: nullable('Enlace de esa frase'),
          },
        },
        price: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['min', 'max', 'currency'],
              properties: {
                min: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                max: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                currency: { type: 'string' },
              },
            },
            { type: 'null' },
          ],
        },
        layout: {
          anyOf: [
            {
              type: 'array',
              description: 'Cómo está estructurada la venta de este evento: zonas (gradas, sectores, pista) con sus secciones o niveles y su precio, con los nombres de la web de venta',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['zone', 'sections', 'standing', 'price', 'venueZone'],
                properties: {
                  zone: { type: 'string' },
                  sections: { type: 'array', items: { type: 'string' } },
                  standing: { type: 'boolean', description: 'true si es de pie (pista, general)' },
                  price: nullable('Precio de la zona tal y como lo enseña la web, p. ej. «60–150 €» (null si no se ve)'),
                  venueZone:
                    zones.length > 0
                      ? { anyOf: [{ type: 'string', enum: zones }, { type: 'null' }], description: 'Zona de nuestro plano a la que corresponde (null si no está)' }
                      : { type: 'null', description: 'Siempre null (el recinto no está en la sala)' },
                },
              },
            },
            { type: 'null' },
          ],
        },
        planImage: nullable(
          'Enlace DIRECTO (https) a la imagen del plano oficial de asientos tal cual se ve al comprar (png, jpg o webp; si no hay, svg), de la web de venta o del recinto. Null si no la encuentras.',
        ),
        status: {
          anyOf: [{ type: 'string', enum: ['ON_SALE', 'UPCOMING', 'SOLD_OUT', 'CANCELLED', 'POSTPONED'] }, { type: 'null' }],
        },
        notes: { type: 'string', description: 'Avisos breves en español (o cadena vacía)' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Enlaces consultados que respaldan los datos' },
      },
    },
  };
}

/** Webs de reventa: nunca valen como enlace oficial ni como fuente del límite. */
const RESALE = /(^|\.)(viagogo|stubhub|ticketswap|seatpick|livefootballtickets|footballticketnet|ticombo|tixel|gigsberg|ticketbis|seatgeek|vividseats|tickpick|fanpass|sportsevents365|p1travel|stubhubinternational)\./i;

const TOP_TOOL: Anthropic.Beta.BetaTool = {
  name: 'entregar_partidos',
  description: 'Entrega la lista final de grandes partidos. Llámala una sola vez, al terminar.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['matches', 'notes'],
    properties: {
      matches: {
        type: 'array',
        description: 'Partidos encontrados (como mucho 15)',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['home', 'away', 'competition', 'category', 'importance', 'why', 'date', 'time', 'venue', 'city', 'country', 'ticketUrl', 'saleOpens'],
          properties: {
            home: nullable('Equipo local (null si aún no se sabe, p. ej. una final)'),
            away: nullable('Equipo visitante (null si aún no se sabe)'),
            competition: { type: 'string', description: 'Competición y ronda: «LaLiga · Jornada 10», «Champions League · Final»' },
            category: { type: 'string', enum: ['CLASICO', 'CHAMPIONS', 'FINAL', 'COPA', 'SUPERCOPA', 'SELECCION', 'LALIGA', 'OTRO'] },
            importance: { type: 'integer', description: 'De 1 a 100: lo importante y lo difícil que es conseguir entrada (Clásico o final: 90-100)' },
            why: { type: 'string', description: 'Por qué es de los grandes, en una frase corta' },
            date: nullable('Fecha AAAA-MM-DD (null si aún no hay fecha)'),
            time: nullable('Hora de España HH:MM (null si no está fijada)'),
            venue: nullable('Estadio'),
            city: nullable('Ciudad'),
            country: nullable('País'),
            ticketUrl: nullable('Página oficial de venta de entradas (club local, UEFA, RFEF…)'),
            saleOpens: nullable('Apertura de la venta en España: AAAA-MM-DDTHH:MM (null si no se sabe)'),
          },
        },
      },
      notes: { type: 'string', description: 'Avisos breves en español (o cadena vacía)' },
    },
  },
};

/** Herramienta del plano: dónde está cada zona en la imagen (las zonas se limitan a las de la sala). */
function planTool(zones: string[]): Anthropic.Beta.BetaTool {
  return {
    name: 'entregar_plano',
    description: 'Entrega dónde está cada zona en la imagen del plano. Llámala una sola vez, al terminar.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['points', 'notes'],
      properties: {
        points: {
          type: 'array',
          description: 'Una entrada por cada zona que se ve en la imagen',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['zone', 'x', 'y'],
            properties: {
              zone: { type: 'string', enum: zones, description: 'Zona (exactamente uno de los nombres dados)' },
              x: { type: 'number', description: 'Centro de la zona: % del ancho de la imagen (0 = borde izquierdo, 100 = derecho)' },
              y: { type: 'number', description: 'Centro de la zona: % del alto de la imagen (0 = borde de arriba, 100 = de abajo)' },
            },
          },
        },
        notes: { type: 'string', description: 'Qué zonas no se ven en la imagen o qué no está claro (o cadena vacía)' },
      },
    },
  };
}

const SYSTEM = [
  'Eres el investigador de eventos de una sala de control que coordina la compra LEGÍTIMA de entradas: cada persona compra en la web oficial con su propia cuenta y paga ella; tú solo buscas y lees información pública.',
  'Nunca inicias sesión, no añades nada al carrito y no intentas saltarte colas, límites ni verificaciones.',
  'Reglas: usa fuentes oficiales primero (la web de venta, la del club, la del recinto o la del promotor); después, prensa fiable. No inventes nada: si un dato no aparece, pon null. Las fechas y horas, siempre en hora de España (Europe/Madrid). Responde en español.',
  'Cuando termines, entrega el resultado llamando a la herramienta indicada una sola vez.',
].join('\n');

// Validación de lo que llega (defensa extra aunque el esquema sea estricto).
function str(v: unknown, max = 300): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null;
}

function httpUrl(v: unknown): string | null {
  const s = str(v, 1000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Imagen para enseñar en el dashboard y en Telegram: solo https y nunca una dirección local. */
function imageUrl(v: unknown): string | null {
  const s = httpUrl(v);
  if (!s) return null;
  const u = new URL(s);
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || host === 'localhost' || host.endsWith('.local') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
  return u.toString();
}

/** Formatos de imagen que Claude puede mirar (el svg se enseña, pero no se analiza). */
const VISION_RE = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i;

function localFrom(date: unknown, time: unknown): { local: string | null; timeTBA: boolean } {
  const d = str(date, 10);
  // Solo fechas y horas que existen (el 30 de febrero o las 25:00 no).
  if (!d || !isRealLocalDateTime(`${d}T00:00`)) return { local: null, timeTBA: true };
  const t = str(time, 5);
  if (t && isRealLocalDateTime(`${d}T${t}`)) return { local: `${d}T${t}`, timeTBA: false };
  return { local: `${d}T00:00`, timeTBA: true };
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

const SCOPE: Record<string, LimitSemantics> = {
  CUENTA: 'PER_HOLDER',
  PERSONA: 'PER_HOLDER',
  PEDIDO: 'PER_HOLDER',
  SOCIO: 'PER_HOLDER',
  TARJETA: 'PER_PAYMENT_METHOD',
  HOGAR: 'PER_HOUSEHOLD',
};

// ---------------------------------------------------------------------------

export class ClaudeControl {
  private client: Anthropic | null = null;
  private health: { ok: boolean | null; detail: string } = { ok: null, detail: '' };
  private spentUsd = 0;
  /** Modelo elegido para esta clave (id y nombre visible). */
  private model: { id: string; name: string } | null = null;
  /** El respaldo del servidor no está disponible para este modelo: se pide sin él. */
  private noFallback = false;
  private readonly eventsCache = new TtlCache<AiEventsResult>(30 * 60_000, 50);
  private readonly detailsCache = new TtlCache<AiEventDetails>(30 * 60_000, 100);
  private readonly planCache = new TtlCache<AiSeatMap>(6 * 3_600_000, 100);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly opts: ClaudeControlOptions,
    initial: { apiKey?: string | null } = {},
  ) {
    if (initial.apiKey) this.client = this.makeClient(initial.apiKey);
    opts.runtime.ctx.aiStatus = () => this.status();
  }

  configured(): boolean {
    return this.client !== null;
  }

  status(): AiStatus {
    const configured = this.client !== null;
    return {
      configured,
      ok: configured ? this.health.ok : null,
      detail: configured
        ? this.health.detail || 'Clave puesta (se comprueba en la primera búsqueda).'
        : 'Sin clave: crea una en platform.claude.com (API keys) y pégala aquí.',
      model: this.model?.name ?? this.opts.model ?? 'el más reciente de tu cuenta (se elige al conectar)',
      configurable: this.opts.envFile !== null,
      spentUsd: Math.round(this.spentUsd * 100) / 100,
    };
  }

  /** Comprueba la clave con la API, la guarda en .env y la usa al momento. null = quitarla. */
  setKey(key: string | null, actor: string): Promise<AiKeyResult> {
    return this.serial(async () => {
      if (key === null) {
        const warning = await this.persist({ ANTHROPIC_API_KEY: null });
        this.client = null;
        this.model = null;
        this.health = { ok: null, detail: '' };
        this.clearCaches();
        this.opts.runtime.ctx.journal.audit('ai.key_removed', {}, { actor });
        this.publish();
        return this.result(true, `Clave de Claude quitada.${warning ? ` ${warning}` : ''}`);
      }
      const client = this.makeClient(key);
      let model: { id: string; name: string };
      try {
        // Consulta gratuita: la lista de modelos de la cuenta (comprueba la clave y elige el modelo).
        // Con tiempo corto: la respuesta llega siempre en segundos, con el motivo si falla.
        model = await this.pickModel(client.withOptions({ timeout: 20_000, maxRetries: 1 }));
      } catch (err) {
        const e = err instanceof AiError ? err : this.explain(err);
        log.warn('Claude: la clave no se ha podido comprobar', { motivo: e.message, detalle: errorDetail(err) });
        return this.result(false, e.message);
      }
      const warning = await this.persist({ ANTHROPIC_API_KEY: key });
      this.client = client;
      this.model = model;
      this.noFallback = false;
      this.clearCaches();
      this.health = { ok: true, detail: `Conectado (comprobado a las ${this.clock()}).` };
      this.opts.runtime.ctx.journal.audit('ai.configured', { model: model.id }, { actor });
      log.info('Claude configurado desde el dashboard');
      this.publish();
      const text = 'Listo: Claude conectado. En Eventos → Nuevo evento, elige la web de venta y Claude buscará sus próximos eventos.';
      return this.result(true, warning ? `${text} ${warning}` : text);
    });
  }

  // ---------------------------------------------------------------------------
  // Búsquedas
  // ---------------------------------------------------------------------------

  /** Próximos eventos de una web de venta. */
  findEvents(q: AiEventsQuery & { siteUrl?: string | null }): Promise<AiEventsResult> {
    const provider = this.provider(q.providerId);
    const site = httpUrl(q.siteUrl) ?? provider.url;
    if (!site) throw new AiError('BAD_REQUEST', `Falta la web de «${provider.name}»: pega su enlace oficial.`);
    const key = JSON.stringify([q.providerId, site, q.days, q.q ?? '', this.today()]);
    const load = async (): Promise<AiEventsResult> => {
      const now = this.opts.runtime.ctx.now();
      const from = localDateTime(now, this.opts.timeZone).slice(0, 10);
      const to = localDateTime(now + q.days * DAY, this.opts.timeZone).slice(0, 10);
      const domain = hostOf(site) ?? site;
      const prompt = [
        `Web de venta: ${provider.name} — ${site}`,
        `Hoy es ${from} (hora de Madrid). Busca los eventos que vende esta web en España entre ${from} y ${to}${q.q ? `, relacionados con «${q.q}»` : ''}.`,
        `Empieza leyendo ${site} con web_fetch. Si no se puede leer o sale vacía, busca con web_search (por ejemplo «site:${domain} entradas») y en las webs oficiales de los clubes, recintos o promotores.`,
        'Para cada evento: nombre tal y como lo publica la web, fecha, hora, recinto, ciudad, enlace a su página de venta (mejor en el dominio de la web de venta) y, si ya está anunciada, la apertura de la venta.',
        'Solo eventos reales que vende esta web. Ordénalos por fecha. Si la lista es muy larga, prioriza los grandes (estadios, pabellones, festivales).',
        `Recintos que ya tenemos (prioriza sus eventos): ${this.vaultVenues()
          .map((v) => v.name)
          .slice(0, 120)
          .join(', ')}.`,
        `Cuando acabes, llama a ${EVENTS_TOOL.name}.`,
      ].join('\n');
      const { input, cost } = await this.research(prompt, EVENTS_TOOL, { effort: 'medium', searches: 8, fetches: 6 });
      const raw = input as { events?: unknown[]; notes?: unknown };
      const venues = this.vaultVenues();
      const events: AiEventSummary[] = [];
      for (const item of Array.isArray(raw.events) ? raw.events : []) {
        const e = item as Record<string, unknown>;
        const name = str(e.name, 200);
        if (!name) continue;
        const when = localFrom(e.date, e.time);
        if (when.local && (when.local.slice(0, 10) < from || when.local.slice(0, 10) > to)) continue;
        const venue = str(e.venue, 160);
        const city = str(e.city, 80);
        const sale = str(e.saleOpens, 20);
        events.push({
          name,
          startsAtLocal: when.local,
          timeTBA: when.timeTBA,
          venue,
          city,
          url: httpUrl(e.url),
          saleOpensLocal: sale && isRealLocalDateTime(sale) ? sale : null,
          sourceUrl: httpUrl(e.sourceUrl),
          vaultVenueId: (venue ? bestVenueMatch(venues, venue, city) : null) ?? venueMentioned(venues, `${venue ?? ''} ${name}`),
        });
      }
      events.sort((a, b) => (a.startsAtLocal ?? '9').localeCompare(b.startsAtLocal ?? '9'));
      return { providerId: q.providerId, events: events.slice(0, 40), notes: str(raw.notes, 600) ?? '', cost, cached: false };
    };
    // «Buscar otra vez»: la respuesta nueva sustituye a la guardada (también la ven Telegram y las demás pantallas).
    if (q.fresh) this.eventsCache.delete(key);
    return this.cached(this.eventsCache, key, load);
  }

  /** Datos completos de un evento: fechas, fases de venta, límite, precios y recinto. */
  eventDetails(q: AiDetailsQuery): Promise<AiEventDetails> {
    const provider = this.provider(q.providerId);
    const venues = this.vaultVenues();
    const knownVenue = (q.venue ? bestVenueMatch(venues, q.venue, q.city ?? null) : null) ?? venueMentioned(venues, `${q.venue ?? ''} ${q.name}`);
    // Zonas de nuestro plano del recinto: Claude dice a cuál corresponde cada zona de la venta.
    const ourZones = knownVenue ? this.venueZones(knownVenue) : [];
    const key = JSON.stringify([q.providerId, q.name, q.startsAtLocal ?? '', q.venue ?? '', q.url ?? '']);
    const load = async (): Promise<AiEventDetails> => {
      const prompt = [
        `Web de venta: ${provider.name}${provider.url ? ` — ${provider.url}` : ''}`,
        `Evento: ${q.name}${q.startsAtLocal ? ` · ${q.startsAtLocal.replace('T', ' ')}` : ''}${q.venue ? ` · ${q.venue}` : ''}${q.city ? ` (${q.city})` : ''}`,
        q.url ? `Página del evento: ${q.url} (léela primero con web_fetch).` : 'Busca primero su página oficial de venta.',
        'Analízalo todo, con fuentes, para preparar la compra:',
        '1. Nombre exacto, fecha y hora (España), recinto y ciudad.',
        '2. El enlace DIRECTO a la página de COMPRA de entradas de este evento en la web oficial que lo vende (club, ticketera oficial, UEFA, RFEF…) y quién la vende. Nunca una web de reventa (Viagogo, StubHub, Ticketswap…) ni una noticia.',
        '3. Todas las fases de venta con su fecha y hora de apertura (socios, abonados, preventas, venta general…) y, si lo dicen, cuántas entradas por persona en cada fase.',
        '4. Cuántas entradas se pueden comprar por persona: busca en las condiciones de venta de ESTE evento (y si no, en las condiciones generales de la web de venta) el máximo por cuenta, persona, socio o pedido. Copia la frase literal y su enlace. Si no aparece en ningún sitio oficial, null (no lo supongas).',
        '5. Precios (mínimo, máximo y moneda) y si está a la venta, agotado, cancelado o aplazado.',
        '6. Cómo está estructurada la venta de ESTE evento en la web: sus zonas (gradas, sectores, pista, VIP…) y dentro de cada una sus secciones o niveles, con los nombres exactos que usa la web, si es de pie y el precio de cada zona si se ve. Si no lo encuentras en fuentes fiables, null.',
        ourZones.length > 0
          ? `   Nuestro plano de este recinto tiene estas zonas: ${ourZones.join(', ')}. Para cada zona de la venta, pon en venueZone a cuál de las nuestras corresponde (null si no está en nuestro plano).`
          : '   (El recinto no está en nuestra sala: venueZone = null.)',
        '7. La imagen del plano oficial de asientos tal cual se ve al comprar (enlace directo a la imagen, de la web de venta o del recinto). Si no hay, null.',
        `Cuando acabes, llama a ${DETAILS_TOOL_NAME}.`,
      ].join('\n');
      const { input, cost } = await this.research(prompt, detailsTool(ourZones), { effort: 'high', searches: 8, fetches: 8 });
      const r = input as Record<string, unknown>;
      const when = localFrom(r.date, r.time);
      const venue = str(r.venue, 160) ?? q.venue ?? null;
      const city = str(r.city, 80) ?? q.city ?? null;
      // El enlace de compra: nunca una reventa (si Claude trae una, se avisa y se usa el que ya teníamos).
      let urlWarning: string | null = null;
      let url = httpUrl(r.url);
      if (url && isResale(url)) {
        urlWarning = `Claude encontró un enlace de reventa (${hostOf(url)}): no se usa. Compra solo en la web oficial.`;
        url = null;
      }
      url = url ?? (q.url && !isResale(q.url) ? httpUrl(q.url) : null);
      const sales = (Array.isArray(r.sales) ? r.sales : [])
        .map((x) => x as Record<string, unknown>)
        .map((x) => ({
          name: str(x.name, 80) ?? 'Venta',
          opensAtLocal: str(x.opensAt, 20) ?? '',
          limit: typeof x.limit === 'number' && Number.isInteger(x.limit) && x.limit >= 1 && x.limit <= 50 ? x.limit : null,
        }))
        .filter((x) => isRealLocalDateTime(x.opensAtLocal))
        .sort((a, b) => a.opensAtLocal.localeCompare(b.opensAtLocal));
      // Telegram y el dashboard eligen la fase por su nombre: si se repite, la siguiente lleva su fecha.
      const saleNames = new Set<string>();
      for (const x of sales) {
        let name = x.name;
        if (saleNames.has(name.toLowerCase())) name = `${x.name} (${x.opensAtLocal.slice(8, 10)}/${x.opensAtLocal.slice(5, 7)} ${x.opensAtLocal.slice(11, 16)})`;
        for (let n = 2; saleNames.has(name.toLowerCase()); n++) name = `${x.name} (${n})`;
        saleNames.add(name.toLowerCase());
        x.name = name;
      }
      const lim = (r.limit ?? {}) as Record<string, unknown>;
      const perPerson = typeof lim.perPerson === 'number' && Number.isInteger(lim.perPerson) && lim.perPerson >= 1 && lim.perPerson <= 50 ? lim.perPerson : null;
      const scope = typeof lim.scope === 'string' ? lim.scope : null;
      const quote = str(lim.quote, 300);
      const limitSourceRaw = httpUrl(lim.sourceUrl);
      const limitSource = limitSourceRaw && !isResale(limitSourceRaw) ? limitSourceRaw : null;
      // «Oficial» solo si la frase sale de la web del proveedor o del enlace que ha elegido una persona:
      // el enlace que da el propio Claude no sirve de referencia (podría ser una noticia).
      const official = Boolean(perPerson && quote && limitSource && sameSite(limitSource, [provider.url, q.url]));
      const price = r.price && typeof r.price === 'object' ? (r.price as Record<string, unknown>) : null;
      const zoneByKey = new Map(ourZones.map((z) => [z.toLowerCase(), z]));
      const layout = Array.isArray(r.layout)
        ? r.layout
            .map((z) => z as Record<string, unknown>)
            .map((z) => ({
              zone: str(z.zone, 80) ?? '',
              sections: (Array.isArray(z.sections) ? z.sections : []).map((s) => str(s, 80)).filter((s): s is string => s !== null).slice(0, 40),
              standing: z.standing === true,
              price: str(z.price, 40),
              venueZone: typeof z.venueZone === 'string' ? (zoneByKey.get(z.venueZone.trim().toLowerCase()) ?? null) : null,
            }))
            .filter((z) => z.zone !== '')
            .slice(0, 40)
        : null;
      const status = typeof r.status === 'string' && ['ON_SALE', 'UPCOMING', 'SOLD_OUT', 'CANCELLED', 'POSTPONED'].includes(r.status) ? (r.status as AiEventStatus) : null;
      return {
        name: str(r.name, 200) ?? q.name,
        startsAtLocal: when.local ?? q.startsAtLocal ?? null,
        timeTBA: when.local ? when.timeTBA : true,
        venue,
        city,
        url,
        seller: str(r.seller, 120),
        urlWarning,
        sales,
        limit: { perPerson, semantics: perPerson && scope ? (SCOPE[scope] ?? 'PER_HOLDER') : perPerson ? 'PER_HOLDER' : null, quote, sourceUrl: limitSource, official },
        price: price
          ? {
              min: typeof price.min === 'number' ? price.min : null,
              max: typeof price.max === 'number' ? price.max : null,
              currency: (str(price.currency, 3) ?? 'EUR').toUpperCase(),
            }
          : null,
        layout: layout && layout.length > 0 ? layout : null,
        planImageUrl: imageUrl(r.planImage),
        status,
        notes: str(r.notes, 800) ?? '',
        sources: (Array.isArray(r.sources) ? r.sources : [])
          .map(httpUrl)
          .filter((u): u is string => u !== null && !isResale(u))
          .slice(0, 12),
        vaultVenueId: knownVenue ?? (venue ? bestVenueMatch(venues, venue, city) : null),
        cost,
        cached: false,
      };
    };
    if (q.fresh) this.detailsCache.delete(key);
    return this.cached(this.detailsCache, key, load);
  }

  /** Zonas del plano de un recinto de la sala (para que Claude haga corresponder las de la venta). */
  private venueZones(venueId: string): string[] {
    const artifact = [...this.opts.runtime.store.artifacts.values()].find((a) => a.venueId === venueId && a.eventId === null);
    return artifact ? artifact.zones.map((z) => z.name).slice(0, 60) : [];
  }

  /**
   * Grandes partidos de un tipo (Clásico y derbis, Champions, Copa…) entre dos
   * fechas. Los junta y ordena el servicio de grandes partidos.
   */
  async topMatches(q: { focus: string; from: string; to: string; max: number }): Promise<{ matches: AiTopMatch[]; notes: string; cost: AiCost }> {
    const prompt = [
      `Hoy es ${q.from} (hora de Madrid). Busca los partidos de fútbol más importantes entre ${q.from} y ${q.to} de este tipo:`,
      q.focus,
      'Son para un grupo de aficionados en España que quiere conseguir entradas: prioriza los que se juegan en España o con equipos españoles, y los más difíciles de conseguir.',
      'Usa fuentes oficiales (LaLiga, UEFA, RFEF, FIFA, webs de los clubes) y prensa fiable para el calendario. Si la fecha o la hora aún no están fijadas, pon null (no la inventes).',
      `Como mucho ${q.max} partidos. Para cada uno: equipos, competición y ronda, categoría, importancia (1-100) y por qué, fecha y hora, estadio, ciudad, país, la página oficial de venta de entradas y, si ya se sabe, cuándo abre la venta.`,
      'Cuando acabes, llama a entregar_partidos.',
    ].join('\n');
    const { input, cost } = await this.research(prompt, TOP_TOOL, { effort: 'medium', searches: 6, fetches: 3 });
    const raw = input as { matches?: unknown[]; notes?: unknown };
    const matches: AiTopMatch[] = [];
    for (const item of Array.isArray(raw.matches) ? raw.matches : []) {
      const m = item as Record<string, unknown>;
      const home = str(m.home, 80);
      const away = str(m.away, 80);
      const competition = str(m.competition, 120) ?? '';
      const name = home && away ? `${home} - ${away}` : (str(m.competition, 120) ?? '');
      if (name.length < 3) continue;
      const when = localFrom(m.date, m.time);
      if (when.local && (when.local.slice(0, 10) < q.from || when.local.slice(0, 10) > q.to)) continue;
      const category = typeof m.category === 'string' && (TOP_CATEGORIES as readonly string[]).includes(m.category) ? (m.category as TopCategory) : 'OTRO';
      const importance = typeof m.importance === 'number' && Number.isFinite(m.importance) ? Math.max(1, Math.min(100, Math.round(m.importance))) : 50;
      const sale = str(m.saleOpens, 20);
      matches.push({
        name,
        home,
        away,
        competition,
        category,
        importance,
        why: str(m.why, 200) ?? '',
        startsAtLocal: when.local,
        timeTBA: when.timeTBA,
        venue: str(m.venue, 160),
        city: str(m.city, 80),
        country: str(m.country, 60),
        ticketUrl: httpUrl(m.ticketUrl),
        saleOpensLocal: sale && isRealLocalDateTime(sale) ? sale : null,
      });
    }
    return { matches: matches.slice(0, q.max), notes: str(raw.notes, 400) ?? '', cost };
  }

  /**
   * Dónde está cada zona en la imagen del plano oficial (Claude la mira): así se
   * puede tocar la zona sobre el plano tal cual se ve al comprar.
   */
  seatMap(q: AiSeatMapQuery): Promise<AiSeatMap> {
    const image = imageUrl(q.imageUrl);
    if (!image) throw new AiError('BAD_REQUEST', 'La imagen del plano tiene que ser un enlace https:// público.');
    const zones = [...new Set(q.zones.map((z) => z.trim()).filter(Boolean))].slice(0, 80);
    const key = JSON.stringify([image, zones]);
    const load = async (): Promise<AiSeatMap> => {
      const empty: AiCost = { usd: 0, searches: 0, fetches: 0, inputTokens: 0, outputTokens: 0, seconds: 0 };
      if (!VISION_RE.test(new URL(image).pathname)) {
        return { imageUrl: image, points: [], notes: 'El plano no es una foto (png, jpg o webp): se enseña tal cual y las zonas se eligen en la lista.', cost: empty, cached: false };
      }
      const prompt = [
        `Esta es la imagen del plano oficial${q.venue ? ` de ${q.venue}` : ''}, tal cual se ve al comprar las entradas.`,
        'Para cada una de estas zonas, di dónde está su centro en la imagen, en porcentaje del ancho (x) y del alto (y):',
        ...zones.map((z) => `- ${z}`),
        'Si una zona no aparece en la imagen, no la pongas. Cuando acabes, llama a entregar_plano.',
      ].join('\n');
      const content: Anthropic.Beta.BetaContentBlockParam[] = [
        { type: 'image', source: { type: 'url', url: image } },
        { type: 'text', text: prompt },
      ];
      const { input, cost } = await this.research(content, planTool(zones), { effort: 'medium', searches: 0, fetches: 0 });
      const raw = input as { points?: unknown[]; notes?: unknown };
      const byKey = new Map(zones.map((z) => [z.toLowerCase(), z]));
      const seen = new Set<string>();
      const points: PlanPoint[] = [];
      for (const item of Array.isArray(raw.points) ? raw.points : []) {
        const p = item as Record<string, unknown>;
        const zone = typeof p.zone === 'string' ? byKey.get(p.zone.trim().toLowerCase()) : undefined;
        const x = typeof p.x === 'number' ? p.x : Number.NaN;
        const y = typeof p.y === 'number' ? p.y : Number.NaN;
        if (!zone || seen.has(zone) || !(x >= 0 && x <= 100 && y >= 0 && y <= 100)) continue;
        seen.add(zone);
        points.push({ zone, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
      }
      return { imageUrl: image, points, notes: str(raw.notes, 400) ?? '', cost, cached: false };
    };
    if (q.fresh) this.planCache.delete(key);
    return this.cached(this.planCache, key, load);
  }

  // ---------------------------------------------------------------------------
  // Conversación con Claude
  // ---------------------------------------------------------------------------

  /**
   * Una investigación: Claude busca y lee en la web (en los servidores de
   * Anthropic) y al final entrega el resultado llamando a `tool`. Si la vuelta
   * se pausa (búsquedas largas), se reanuda; si termina sin entregar, se le pide.
   */
  private async research(
    prompt: string | Anthropic.Beta.BetaContentBlockParam[],
    tool: Anthropic.Beta.BetaTool,
    opts: { effort: 'medium' | 'high'; searches: number; fetches: number },
  ): Promise<{ input: unknown; cost: AiCost }> {
    const client = this.need();
    const started = Date.now();
    const cost: AiCost = { usd: 0, searches: 0, fetches: 0, inputTokens: 0, outputTokens: 0, seconds: 0 };
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
    const tools: Anthropic.Beta.BetaToolUnion[] = [];
    if (opts.searches > 0) {
      tools.push({
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: opts.searches,
        user_location: { type: 'approximate', city: 'Madrid', country: 'ES', timezone: 'Europe/Madrid' },
      });
    }
    if (opts.fetches > 0) tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: opts.fetches, max_content_tokens: 30_000 });
    tools.push(tool);
    let asked = false;
    try {
      const model = (await this.pickModel(client)).id;
      for (let turn = 0; turn < 8; turn++) {
        const res = await this.ask(client, {
          model,
          max_tokens: 16000,
          system: SYSTEM,
          output_config: { effort: opts.effort },
          tools,
          messages,
        });
        this.addUsage(cost, res.usage);
        if (res.stop_reason === 'refusal') {
          throw new AiError('REFUSED', 'Claude no ha hecho esta búsqueda (la ha rechazado por seguridad). Prueba a escribirla de otra forma.');
        }
        const call = res.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
        if (call && call.type === 'tool_use') {
          if (this.health.ok !== true) {
            this.health = { ok: true, detail: `Funcionando (última consulta a las ${this.clock()}).` };
          }
          return { input: call.input, cost };
        }
        if (res.stop_reason === 'max_tokens') throw new AiError('INCOMPLETE', 'La respuesta de Claude era demasiado larga y se ha cortado: prueba con menos días o afina la búsqueda.');
        // La vuelta sigue tal cual (sin tocar lo anterior): así Claude continúa donde lo dejó.
        messages.push({ role: 'assistant', content: res.content });
        if (res.stop_reason === 'pause_turn') continue;
        if (asked) break;
        asked = true;
        messages.push({ role: 'user', content: `Entrega ahora el resultado llamando a ${tool.name} con lo que has encontrado (null donde no lo sepas).` });
      }
      throw new AiError('INCOMPLETE', 'Claude no ha terminado la búsqueda. Vuelve a intentarlo en un momento.');
    } catch (err) {
      if (err instanceof AiError) throw err;
      throw this.explain(err);
    } finally {
      cost.seconds = Math.round((Date.now() - started) / 100) / 10;
      cost.usd = Math.round(cost.usd * 10_000) / 10_000;
      this.spentUsd += cost.usd;
      this.publish();
    }
  }

  /**
   * Una petición a la API, en streaming (una búsqueda con varias lecturas puede
   * tardar minutos: así la conexión no se queda callada). Si el modelo declina
   * por seguridad, el servidor de Anthropic la repite con su modelo de respaldo.
   */
  private async ask(client: Anthropic, params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage> {
    const withFallback: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = this.noFallback
      ? params
      : { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
    try {
      return await client.beta.messages.stream(withFallback).finalMessage();
    } catch (err) {
      // Un modelo sin respaldo configurado lo rechaza: se repite sin él (y ya no se pide más).
      if (!this.noFallback && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
        this.noFallback = true;
        log.warn('Claude: este modelo no admite el respaldo del servidor; se sigue sin él');
        return client.beta.messages.stream(params).finalMessage();
      }
      throw err;
    }
  }

  /**
   * Modelo para esta clave: el fijado en ANTHROPIC_MODEL o, si no, el Opus más
   * reciente de la lista de la cuenta (la consulta es gratuita).
   */
  private async pickModel(client: Anthropic): Promise<{ id: string; name: string }> {
    if (client === this.client && this.model) return this.model;
    const all: Anthropic.ModelInfo[] = [];
    for await (const m of client.models.list({ limit: 100 })) {
      all.push(m);
      if (all.length >= 500) break;
    }
    const byDate = (a: Anthropic.ModelInfo, b: Anthropic.ModelInfo) => Date.parse(b.created_at) - Date.parse(a.created_at);
    let chosen: Anthropic.ModelInfo | undefined;
    if (this.opts.model) {
      chosen = all.find((m) => m.id === this.opts.model);
      if (!chosen) throw new AiError('BAD_REQUEST', `Tu cuenta de Claude no tiene el modelo «${this.opts.model}» (ANTHROPIC_MODEL en .env): quítalo o pon otro.`);
    } else {
      chosen = all.filter((m) => PREFERRED_FAMILY.test(m.id)).sort(byDate)[0] ?? [...all].sort(byDate)[0];
    }
    if (!chosen) throw new AiError('AUTH', 'Tu cuenta de Claude no tiene ningún modelo disponible: revisa la cuenta en platform.claude.com.');
    const model = { id: chosen.id, name: chosen.display_name || chosen.id };
    if (client === this.client) this.model = model;
    return model;
  }

  private addUsage(cost: AiCost, usage: Anthropic.Beta.BetaUsage | undefined): void {
    if (!usage) return;
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const tools = (usage as { server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null }).server_tool_use ?? null;
    const searches = tools?.web_search_requests ?? 0;
    const fetches = tools?.web_fetch_requests ?? 0;
    cost.inputTokens += input + cacheRead + cacheWrite;
    cost.outputTokens += output;
    cost.searches += searches;
    cost.fetches += fetches;
    cost.usd += (input * PRICE.input + output * PRICE.output + cacheRead * PRICE.cacheRead + cacheWrite * PRICE.cacheWrite) / 1_000_000 + searches * PRICE.perSearch;
  }

  /** Error de la API → mensaje claro (nunca con la clave). */
  private explain(err: unknown): AiError {
    let out: AiError;
    if (err instanceof Anthropic.AuthenticationError) {
      out = new AiError('AUTH', 'Claude no acepta la clave: crea otra en platform.claude.com → API keys y pégala en Ajustes · Claude.');
    } else if (err instanceof Anthropic.PermissionDeniedError) {
      out = new AiError('AUTH', 'Esta clave no tiene permiso para usar Claude (¿cuenta sin saldo o sin acceso al modelo?). Revisa Billing en platform.claude.com.');
    } else if (err instanceof Anthropic.RateLimitError) {
      out = new AiError('RATE', 'Claude: demasiadas consultas seguidas o límite de gasto alcanzado. Espera un poco (o revisa el saldo en platform.claude.com).');
    } else if (err instanceof Anthropic.BadRequestError) {
      // err.message es «400 {"type":"error","error":{…}}»: solo el texto de la API.
      const body = err.error as { error?: { message?: unknown } } | undefined;
      const m = typeof body?.error?.message === 'string' ? body.error.message : (err.message ?? '');
      out = /credit|balance|billing/i.test(m)
        ? new AiError('AUTH', 'Tu cuenta de Claude no tiene saldo: añade crédito en platform.claude.com → Billing.')
        : /image|download|url/i.test(m)
          ? new AiError('BAD_REQUEST', 'Claude no ha podido abrir la imagen del plano (la web no la deja descargar): se enseña tal cual y las zonas se eligen en la lista.')
          : new AiError('BAD_REQUEST', `Claude ha rechazado la consulta: ${m.slice(0, 200)}`);
    } else if (err instanceof Anthropic.APIConnectionError) {
      const code = errorDetail(err);
      const hint = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/i.test(code)
        ? 'tu antivirus o un proxy está interceptando las conexiones seguras: desactiva su «análisis HTTPS/SSL» o añade una excepción para node.exe'
        : /ENOTFOUND|EAI_AGAIN/i.test(code)
          ? 'no se encuentra api.anthropic.com: revisa la conexión a internet'
          : /timed? ?out|ETIMEDOUT|ConnectTimeout/i.test(code)
            ? 'no responde a tiempo: revisa la conexión o si un cortafuegos o antivirus bloquea a Node.js'
            : 'revisa la conexión a internet o si un antivirus o cortafuegos bloquea a Node.js';
      out = new AiError('NETWORK', `No se pudo conectar con Claude (api.anthropic.com)${code ? ` [${code}]` : ''}: ${hint}.`);
    } else if (err instanceof Anthropic.APIError) {
      out = new AiError('NETWORK', `Claude no está respondiendo bien ahora mismo (error ${err.status ?? '?'}). Vuelve a intentarlo en un minuto.`);
    } else {
      out = new AiError('NETWORK', `Error al hablar con Claude: ${(err as Error).message}`);
    }
    if (out.code === 'AUTH' || out.code === 'NETWORK') {
      const changed = this.health.detail !== out.message;
      this.health = { ok: false, detail: out.message };
      if (changed) this.publish();
    }
    return out;
  }

  // ---------------------------------------------------------------------------

  private cached<T extends { cached: boolean }>(cache: TtlCache<T>, key: string, load: () => Promise<T>): Promise<T> {
    let fresh = false;
    return cache
      .get(key, () => {
        fresh = true;
        return load();
      })
      .then((v) => (fresh ? v : { ...v, cached: true }));
  }

  private provider(providerId: string): { name: string; url: string | null } {
    const p = this.opts.runtime.store.providerAuthorizations.find((x) => x.providerId === providerId);
    if (!p) throw new AiError('BAD_REQUEST', `La web de venta ${providerId} no está en la sala.`);
    return { name: p.name, url: p.url };
  }

  private vaultVenues() {
    return (this.opts.runtime.store.vaultReport?.venues ?? []).map((v) => ({
      venueId: v.venueId,
      name: v.name,
      city: v.city ?? null,
      aliases: v.aliases ?? [],
    }));
  }

  private need(): Anthropic {
    if (!this.client) throw new AiError('NOT_CONFIGURED', 'Falta la clave de Claude: ponla en Ajustes · Claude (IA).');
    return this.client;
  }

  private makeClient(apiKey: string): Anthropic {
    return new Anthropic({ apiKey, baseURL: this.opts.baseURL, timeout: 5 * 60_000, maxRetries: 2 });
  }

  private today(): string {
    return localDateTime(this.opts.runtime.ctx.now(), this.opts.timeZone).slice(0, 10);
  }

  private clock(): string {
    return new Intl.DateTimeFormat('es-ES', { timeZone: this.opts.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(this.opts.runtime.ctx.now()));
  }

  private clearCaches(): void {
    this.eventsCache.clear();
    this.detailsCache.clear();
    this.planCache.clear();
  }

  private publish(): void {
    const { ctx } = this.opts.runtime;
    ctx.hub.publish({ type: 'system', data: ctx.ops.systemStatus() });
  }

  private result(ok: boolean, message: string): AiKeyResult {
    return { ok, message, status: this.status() };
  }

  private async persist(changes: Record<string, string | null>): Promise<string | null> {
    if (!this.opts.envFile) return null;
    try {
      await updateEnvFile(this.opts.envFile, changes, this.opts.envTemplate ?? null);
      return null;
    } catch (err) {
      const message = (err as Error).message;
      log.warn('No se pudo guardar la clave de Claude en .env', { error: message });
      return `Aviso: no se pudo guardar en el archivo .env (${message}); funciona ahora, pero al reiniciar habrá que ponerla otra vez.`;
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** ¿Es el enlace de la misma web (o subdominio) que alguna de las oficiales? */
function sameSite(url: string, officials: Array<string | null | undefined>): boolean {
  const h = hostOf(url);
  if (!h) return false;
  return officials.some((o) => {
    const oh = hostOf(o ?? null);
    if (!oh) return false;
    const base = registrableDomain(oh);
    return h === oh || h.endsWith(`.${base}`) || h === base;
  });
}

/** Sufijos de dos niveles habituales (co.uk, com.ar…): la web es el nivel siguiente. */
const SECOND_LEVEL = /^(co|com|org|net|gov|gob|ac|edu|or|ne|go)$/;

/** «tickets.realmadrid.com» → «realmadrid.com»; «www.eticketing.co.uk» → «eticketing.co.uk». */
function registrableDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length >= 3 && (parts.at(-1) ?? '').length === 2 && SECOND_LEVEL.test(parts.at(-2) ?? '')) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

/** Código técnico de un fallo de red (ECONNRESET, SELF_SIGNED_CERT_IN_CHAIN…) para el mensaje y la ventana negra. */
function errorDetail(err: unknown): string {
  let e = err as { cause?: unknown; code?: unknown; message?: unknown } | undefined;
  const parts: string[] = [];
  for (let i = 0; e && i < 4; i++) {
    if (typeof e.code === 'string') parts.push(e.code);
    else if (i > 0 && typeof e.message === 'string') parts.push(e.message.slice(0, 80));
    e = e.cause as typeof e;
  }
  return [...new Set(parts)].join(' · ');
}

/** ¿Es una web de reventa? (nunca vale como enlace oficial). */
function isResale(url: string): boolean {
  const h = hostOf(url);
  return h !== null && RESALE.test(`${h}.`);
}
