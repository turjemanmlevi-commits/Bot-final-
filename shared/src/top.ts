/**
 * ⭐ Grandes partidos: los partidos más importantes de los próximos 12 meses
 * (el Clásico, la Champions y su final, la Copa del Rey, la Supercopa, la
 * selección…), que busca Claude. Se vigilan desde 2 semanas antes de la venta
 * y cada uno se prepara con su sitio en el estadio y las entradas que queréis.
 */

import type { AiCost } from './ai';

export const TOP_CATEGORIES = ['CLASICO', 'CHAMPIONS', 'FINAL', 'COPA', 'SUPERCOPA', 'SELECCION', 'LALIGA', 'OTRO'] as const;
export type TopCategory = (typeof TOP_CATEGORIES)[number];

export const TOP_CATEGORY_LABEL: Record<TopCategory, string> = {
  CLASICO: 'Clásico',
  CHAMPIONS: 'Champions',
  FINAL: 'Finales',
  COPA: 'Copa del Rey',
  SUPERCOPA: 'Supercopa',
  SELECCION: 'Selección y Mundial',
  LALIGA: 'LaLiga',
  OTRO: 'Otros',
};

/** Cuántos grandes partidos se guardan. */
export const TOP_MAX = 50;
/** Los grandes partidos se vigilan siempre desde 2 semanas antes de la venta. */
export const TOP_WATCH_DAYS = 14;
/** En los grandes partidos, 1 entrada por cuenta: todas las cuentas a la vez, para asegurar la compra. */
export const TOP_PER_ACCOUNT = 1;

/** Un gran partido tal y como lo entrega Claude (ya validado). */
export interface AiTopMatch {
  name: string;
  home: string | null;
  away: string | null;
  /** «LaLiga · Jornada 10», «Champions League · Final». */
  competition: string;
  category: TopCategory;
  /** 1–100: lo importante que es (el Clásico o una final, arriba). */
  importance: number;
  /** Por qué es de los grandes (una frase). */
  why: string;
  /** «AAAA-MM-DDTHH:mm» hora de España (00:00 si la hora no está publicada). */
  startsAtLocal: string | null;
  timeTBA: boolean;
  venue: string | null;
  city: string | null;
  country: string | null;
  /** Página oficial de venta de entradas (club, UEFA, RFEF…). */
  ticketUrl: string | null;
  saleOpensLocal: string | null;
}

export interface TopMatch extends AiTopMatch {
  /** Identificador estable (fecha + equipos). */
  id: string;
  /** Recinto de la sala que le corresponde (null: se crea al prepararlo). */
  vaultVenueId: string | null;
  /** Web de venta de la sala con la que se prepara (real-madrid, manual…). */
  providerId: string | null;
  /** Evento de la sala ya preparado para este partido (o null). */
  eventId: string | null;
}

export interface TopMatchesState {
  /** Cuándo se buscó la lista (null: nunca). */
  at: string | null;
  matches: TopMatch[];
  /** Avisos de Claude. */
  notes: string[];
  cost: AiCost | null;
  /** Claude está buscando ahora mismo (desde `startedAt`). */
  refreshing: boolean;
  startedAt: string | null;
  error: string | null;
}
