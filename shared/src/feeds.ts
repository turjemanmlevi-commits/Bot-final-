/**
 * Fuentes oficiales de eventos (solo lectura): Ticketmaster (Discovery API) y
 * los partidos de LaLiga y Champions (football-data.org).
 *
 * Sirven para elegir el evento exacto al crearlo (nombre, fecha y hora, apertura
 * de la venta y límite de compra tal y como los publica la fuente) y para
 * vigilarlo los días antes de la venta. Nunca entran en ninguna web de venta,
 * ni inician sesión, ni compran: solo leen datos públicos con una clave gratuita.
 */

import { z } from 'zod';
import type { Id, IsoDateTime, LimitSemantics } from './domain';

export const FEEDS = ['ticketmaster', 'football'] as const;
export type FeedId = (typeof FEEDS)[number];

export const FEED_LABEL: Record<FeedId, string> = {
  ticketmaster: 'Ticketmaster',
  football: 'Partidos de LaLiga y Champions',
};

/** Una fase de venta: la general o una preventa. */
export interface FeedSale {
  kind: 'PUBLIC' | 'PRESALE';
  name: string;
  startsAt: IsoDateTime | null;
  /** La misma hora en la zona del vault, «AAAA-MM-DDTHH:mm» (lo que usa el formulario). */
  startsAtLocal: string | null;
  endsAt: IsoDateTime | null;
}

export const FEED_EVENT_STATUS = ['SCHEDULED', 'ONSALE', 'OFFSALE', 'CANCELLED', 'POSTPONED', 'RESCHEDULED', 'FINISHED', 'UNKNOWN'] as const;
export type FeedEventStatus = (typeof FEED_EVENT_STATUS)[number];

export const FEED_EVENT_STATUS_LABEL: Record<FeedEventStatus, string> = {
  SCHEDULED: 'Programado',
  ONSALE: 'A la venta',
  OFFSALE: 'Sin venta ahora',
  CANCELLED: 'Cancelado',
  POSTPONED: 'Aplazado',
  RESCHEDULED: 'Cambio de fecha',
  FINISHED: 'Ya jugado',
  UNKNOWN: 'Estado desconocido',
};

export interface FeedEvent {
  feed: FeedId;
  /** Identificador del evento en la fuente (p. ej. Z698xZq2Za4Fk en Ticketmaster). */
  id: string;
  name: string;
  /** Página oficial del evento (solo se enseña como enlace). */
  url: string | null;
  startsAt: IsoDateTime | null;
  /** Fecha y hora del evento en la zona del vault, «AAAA-MM-DDTHH:mm». */
  startsAtLocal: string | null;
  /** Solo se sabe el día: la hora todavía no está publicada. */
  timeTBA: boolean;
  /** Hora local del recinto si no es la del vault (p. ej. Canarias), «HH:mm». */
  venueLocalTime: string | null;
  status: FeedEventStatus;
  /** Venta general primero y después las preventas, por fecha. */
  sales: FeedSale[];
  /** La venta general todavía no tiene fecha publicada. */
  saleTBD: boolean;
  /** Límite de compra tal y como lo publica la fuente, y lo que se ha entendido de él. */
  limit: { text: string | null; perCustomer: number | null; semantics: LimitSemantics | null };
  price: { min: number | null; max: number | null; currency: string } | null;
  venue: { id: string | null; name: string; city: string | null } | null;
  /** Música, Deportes, LaLiga… */
  category: string | null;
  seatmapUrl: string | null;
  /** «A tener en cuenta» de la fuente (recortado). */
  info: string | null;
  /** En los resultados de una búsqueda por nombre: ¿es en el recinto elegido? */
  atVenue?: boolean;
  /** Recinto del vault donde es (null si no está en el vault: se puede crear al guardar). */
  vaultVenueId: string | null;
  /** Partidos: equipo local (el club que vende las entradas). */
  home: string | null;
}

export interface FeedStatus {
  feed: FeedId;
  /** Hay clave puesta. */
  configured: boolean;
  /** true: la última consulta funcionó; false: falló; null: sin probar todavía. */
  ok: boolean | null;
  detail: string;
}

export interface FeedsStatus {
  ticketmaster: FeedStatus;
  football: FeedStatus;
  /** Las claves se pueden poner desde el dashboard (el servidor las guarda en .env). */
  configurable: boolean;
}

export type FeedSearchBy = 'event' | 'sale';

export interface FeedEventsResult {
  feed: FeedId;
  /** Lo que se ha buscado en la fuente (recintos o club), para que se vea que es el sitio correcto. */
  matched: Array<{ id: string; name: string; city: string | null }>;
  from: IsoDateTime;
  to: IsoDateTime;
  by: FeedSearchBy;
  events: FeedEvent[];
  /** Explicación cuando no hay resultados o falta algo (clave, club…). */
  message: string | null;
  /** Había más eventos de los que se pueden traer de una vez: afina con el buscador. */
  truncated: boolean;
}

/** Clave de una fuente: la «Consumer Key» de Ticketmaster o el token de football-data.org. */
export const FeedKeySchema = z.object({
  key: z
    .string()
    .trim()
    .min(10, 'La clave es demasiado corta: cópiala entera')
    .max(100, 'La clave es demasiado larga: copia solo la clave')
    .regex(/^[A-Za-z0-9_-]+$/, 'La clave solo lleva letras y números: cópiala sin espacios ni comillas'),
});

export interface FeedKeyResult {
  ok: boolean;
  message: string;
  status: FeedsStatus;
}

// ---------------------------------------------------------------------------
// Vigilancia de un evento antes de la venta
// ---------------------------------------------------------------------------

/** Lo que se compara en cada consulta para detectar cambios. */
export interface FeedSnapshot {
  name: string;
  startsAt: IsoDateTime | null;
  timeTBA: boolean;
  status: FeedEventStatus;
  sales: Array<{ name: string; startsAt: IsoDateTime | null }>;
  saleTBD: boolean;
  limitText: string | null;
}

export interface EventWatch {
  eventId: Id;
  eventName: string;
  feed: FeedId | null;
  feedEventId: string | null;
  daysBefore: number;
  /** Hora de referencia: apertura de la venta (o el evento, si no hay apertura). */
  anchor: IsoDateTime;
  anchorKind: 'SALE' | 'EVENT';
  /** Desde cuándo se vigila (anchor − daysBefore). */
  from: IsoDateTime;
  state: 'WAITING' | 'WATCHING' | 'DONE';
  lastCheckAt: IsoDateTime | null;
  lastError: string | null;
  snapshot: FeedSnapshot | null;
  /** Últimos cambios detectados (el más reciente primero). */
  changes: Array<{ at: IsoDateTime; text: string }>;
  /** Avisos ya enviados, para no repetirlos (también tras reiniciar). */
  sent: string[];
  updatedAt: IsoDateTime;
}
