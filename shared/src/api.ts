/**
 * Contrato HTTP/SSE entre el servidor y el dashboard.
 *
 * Todo lo que viaja por la API está tipado aquí para que ambos lados fallen en
 * compilación si el contrato cambia.
 */

import type {
  Account,
  Alert,
  AllocationState,
  ArmSnapshot,
  AuditEvent,
  CapabilityName,
  Cart,
  CircuitState,
  Claim,
  DecisionRecord,
  HumanTask,
  Id,
  InventorySnapshotSummary,
  IsoDateTime,
  KillSwitch,
  OperationCommand,
  OperationConfig,
  OperationMetrics,
  OperationSummary,
  ProviderMode,
  ReadinessReport,
  SystemStatus,
  TicketEvent,
  ValidationReport,
  VenueArtifactSummary,
} from './domain';
import type { EventWatch, FeedId } from './feeds';

export const API_PREFIX = '/api';

/** Cuerpo homogéneo de error de la API. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Catálogo (vault)
// ---------------------------------------------------------------------------

/** Evento del catálogo tal y como sale del vault: TicketEvent + metadatos editoriales. */
export interface CatalogEvent extends TicketEvent {
  /** Apertura de venta sugerida (prellena T0 en el dashboard). */
  onSaleAt: IsoDateTime | null;
  /** Secciones cerradas por override del evento. */
  closedSectionIds: Id[];
  /** Nota de Obsidian de la que sale el evento (ruta relativa al vault). */
  sourceFile: string;
  tags: string[];
  /** Página oficial del evento (http/https) o null. Solo se muestra como enlace. */
  url: string | null;
  /** Evento elegido de una fuente oficial (Ticketmaster o partidos), o null si se escribió a mano. */
  officialFeed: FeedId | null;
  /** Identificador del evento en esa fuente. */
  officialId: string | null;
  /** Fase de venta elegida de la fuente («Venta general» o el nombre de la preventa): su hora es la apertura. */
  officialSale: string | null;
  /** Días antes de la venta desde los que se vigila el evento (null o 0 = no se vigila). */
  watchDaysBefore: number | null;
  /** Dónde queréis sentaros, en orden (zonas o secciones): la operación empieza con estos objetivos. */
  preferredTargets: string[];
  /** Plano oficial (imagen tal cual se ve al comprar) y dónde está cada zona en él, o null. */
  seatMap: { image: string; points: Array<{ zone: string; x: number; y: number }> } | null;
}

/** Autorización humana de capabilities por proveedor, declarada en el vault. */
export interface ProviderAuthorization {
  providerId: string;
  name: string;
  mode: ProviderMode;
  authorized: CapabilityName[];
  source: string;
  verifiedAt: IsoDateTime | null;
  notes: string;
  sourceFile: string;
  /** Web oficial del proveedor (http/https) o null. */
  url: string | null;
}

export interface VaultIssue {
  file: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface VaultCompileReport {
  at: IsoDateTime;
  ok: boolean;
  vaultDir: string;
  compilerVersion: string;
  durationMs: number;
  notes: number;
  venues: Array<{
    venueId: Id;
    name: string;
    hash: string;
    zones: number;
    sections: number;
    sourceFile: string;
    city: string | null;
    aliases: string[];
    /** Clubes que juegan allí como locales (estadios de fútbol). */
    clubs: string[];
  }>;
  events: number;
  providers: number;
  errors: VaultIssue[];
  warnings: VaultIssue[];
}

/** Resultado de probar cómo se resuelve una etiqueta cruda del proveedor. */
export interface LabelResolutionResult {
  label: string;
  normalized: string;
  sectionId: Id | null;
  sectionName: string | null;
  zoneId: Id | null;
  zoneName: string | null;
  ambiguity: number;
  method: string;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

export interface ConfigVersion {
  version: number;
  at: IsoDateTime;
  actor: string;
  note: string | null;
}

export interface Amendment {
  at: IsoDateTime;
  actor: string;
  kind: 'reduce-qty' | 'lower-max-price';
  from: number;
  to: number;
  reason: string | null;
}

export interface OperationDetail {
  summary: OperationSummary;
  config: OperationConfig;
  versions: ConfigVersion[];
  armSnapshot: ArmSnapshot | null;
  allocation: AllocationState | null;
  claims: Claim[];
  carts: Cart[];
  decisions: DecisionRecord[];
  validation: ValidationReport | null;
  readiness: ReadinessReport[];
  metrics: OperationMetrics | null;
  inventory: InventorySnapshotSummary | null;
  humanTasks: HumanTask[];
  amendments: Amendment[];
  timeline: AuditEvent[];
}

export interface CommandRequest {
  command: OperationCommand;
  /** Nuevo valor para reduce-qty (entradas) o lower-max-price (unidades menores). */
  value?: number | undefined;
  reason?: string | undefined;
}

export interface CommandResult {
  ok: boolean;
  message: string;
  operation: OperationSummary;
  validation?: ValidationReport | undefined;
  readiness?: ReadinessReport | undefined;
}

// ---------------------------------------------------------------------------
// Simulación
// ---------------------------------------------------------------------------

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Estado inicial + stream en tiempo real
// ---------------------------------------------------------------------------

export interface EntityMap {
  operation: OperationSummary;
  account: Account;
  event: CatalogEvent;
  venue: VenueArtifactSummary;
  alert: Alert;
  cart: Cart;
  claim: Claim;
  humanTask: HumanTask;
  killSwitch: KillSwitch;
  circuit: CircuitState;
  allocation: AllocationState;
  decision: DecisionRecord;
  readiness: ReadinessReport;
  validation: ValidationReport;
  metrics: OperationMetrics;
  inventory: InventorySnapshotSummary;
  eventWatch: EventWatch;
}
export type EntityKind = keyof EntityMap;

export interface BootstrapState {
  system: SystemStatus;
  operations: OperationSummary[];
  accounts: Account[];
  events: CatalogEvent[];
  venues: VenueArtifactSummary[];
  alerts: Alert[];
  carts: Cart[];
  claims: Claim[];
  humanTasks: HumanTask[];
  allocations: AllocationState[];
  vault: VaultCompileReport | null;
  scenarios: ScenarioInfo[];
  providerAuthorizations: ProviderAuthorization[];
  /** Vigilancia de los eventos antes de la venta. */
  watches: EventWatch[];
}

export type UpsertMessage = {
  [K in EntityKind]: { type: 'upsert'; kind: K; id: string; data: EntityMap[K] };
}[EntityKind];

export type StreamMessage =
  | { type: 'hello'; state: BootstrapState }
  | UpsertMessage
  | { type: 'remove'; kind: EntityKind; id: string }
  | { type: 'system'; data: SystemStatus }
  | { type: 'audit'; data: AuditEvent }
  | { type: 'vault'; data: VaultCompileReport }
  | { type: 'providers'; data: ProviderAuthorization[] };

/** Tipos de auditoría de alto volumen que no se emiten por el stream. */
export const QUIET_AUDIT_TYPES: readonly string[] = [
  'decision.recorded',
  'inventory.snapshot',
  'allocation.step',
];
