/**
 * Contrato de un adapter de proveedor (§11).
 *
 * Un adapter solo puede declarar las capabilities de CAPABILITIES. No existe
 * método de pago, de resolución de retos ni de salto de cola: el registro
 * rechaza cualquier adapter que lo intente (§26).
 */

import type {
  CapabilityDescriptor,
  ConfirmationLevel,
  Id,
  IsoDateTime,
  Minor,
  ProviderMode,
  QueueInfo,
  SessionInfo,
  VenueArtifact,
} from '@to/shared';
import type { RawOffer } from '../domain/candidates';

export interface InventoryRead {
  /** Instante (reloj local) en que se leyó. */
  observedAtMs: number;
  offers: RawOffer[];
  /** Versión del esquema de respuesta: si cambia, se abre el circuito (drift). */
  schemaVersion: string;
}

export interface ProviderCartItem {
  offerRef: string;
  sectionLabel: string;
  row: string | null;
  seats: string[];
  qty: number;
  unitPrice: Minor;
  idempotencyKey: string | null;
}

export interface ProviderCart {
  cartRef: string;
  items: ProviderCartItem[];
  expiresAt: IsoDateTime | null;
  openUrl: string | null;
}

export interface AddToCartRequest {
  accountId: Id;
  eventRef: string;
  offerRef: string;
  qty: number;
  unitPrice: Minor;
  idempotencyKey: string;
}

export type AddToCartResult =
  | { status: 'ADDED'; cart: ProviderCart; item: ProviderCartItem; duplicate: boolean }
  | {
      status: 'REJECTED';
      reason: 'SOLD_OUT' | 'PRICE_CHANGED' | 'LIMIT_REACHED' | 'NOT_IN_QUEUE' | 'SESSION_INVALID' | 'INVALID_REQUEST';
      detail: string;
    }
  | { status: 'AMBIGUOUS'; detail: string }
  | { status: 'RATE_LIMITED'; retryAfterMs: number }
  | { status: 'SCHEMA_DRIFT'; detail: string };

/** Datos que un adapter necesita para preparar un evento (el simulador genera inventario). */
export interface EventPreparation {
  eventRef: string;
  artifact: VenueArtifact;
  t0Ms: number;
  currency: string;
  perAccountLimit: number;
  scenarioId: string | null;
  seed: number;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly mode: ProviderMode;
  readonly adapterVersion: string;
  readonly confirmationPolicy: ConfirmationLevel;
  /** Capabilities que el adapter implementa (antes de aplicar la autorización del vault). */
  readonly declared: readonly string[];

  prepareEvent?(prep: EventPreparation): void;
  openSession?(accountId: Id): Promise<SessionInfo>;
  sessionStatus?(accountId: Id): Promise<SessionInfo>;
  queueStatus?(accountId: Id, eventRef: string): Promise<QueueInfo>;
  readInventory?(accountId: Id, eventRef: string): Promise<InventoryRead>;
  addToCart?(req: AddToCartRequest): Promise<AddToCartResult>;
  readCart?(accountId: Id, eventRef: string): Promise<ProviderCart>;
  serverTime?(): Promise<number>;
}

export interface RegisteredProvider {
  adapter: ProviderAdapter;
  capabilities: CapabilityDescriptor[];
}
