/**
 * Modelo de dominio canónico del Ticket Orchestrator (spec v4 §4, §9, §12, §15–§19).
 *
 * Este módulo solo contiene tipos y constantes: lo consumen el servidor (runtime)
 * y el dashboard. No debe importar nada de Node ni del DOM.
 */

export type Id = string;
/** ISO-8601 con zona horaria. */
export type IsoDateTime = string;
/** Importes siempre en unidades menores enteras (céntimos) para evitar errores de coma flotante. */
export type Minor = number;

// ---------------------------------------------------------------------------
// Operación (máquina de estados principal)
// ---------------------------------------------------------------------------

export const OPERATION_STATES = [
  'DRAFT',
  'VALIDATED',
  'ARMED',
  'FROZEN',
  'RUNNING',
  'PAUSED',
  'RECOVERING',
  'CART_SECURED',
  'ENDED',
  'CANCELLED',
  'CLOSED',
] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

/** Estados en los que la automatización puede enviar acciones al proveedor. */
export const AUTOMATION_ACTIVE_STATES: readonly OperationState[] = ['RUNNING'];
/** Estados en los que la configuración está congelada (snapshot de ARM vigente). */
export const CONFIG_LOCKED_STATES: readonly OperationState[] = [
  'ARMED',
  'FROZEN',
  'RUNNING',
  'PAUSED',
  'RECOVERING',
  'CART_SECURED',
  'ENDED',
  'CANCELLED',
  'CLOSED',
];
export const TERMINAL_OPERATION_STATES: readonly OperationState[] = ['CANCELLED', 'CLOSED'];

export const OPERATION_COMMANDS = [
  'validate',
  'arm',
  'disarm',
  'readiness',
  'start-now',
  'pause',
  'resume',
  'stop',
  'cancel',
  'reduce-qty',
  'lower-max-price',
  'close',
] as const;
export type OperationCommand = (typeof OPERATION_COMMANDS)[number];

export type EndReason =
  | 'RUN_WINDOW_ELAPSED'
  | 'OPERATOR_STOP'
  | 'READINESS_FAILED'
  | 'NOT_STARTED_IN_WINDOW';

export interface OperationPreferences {
  /** Lista ordenada de zonas o secciones (nombre o alias). La primera es la preferida. Vacía = todo el recinto. */
  targets: string[];
  /** Secciones excluidas explícitamente (nombre o alias). */
  excludeSections: string[];
  /** Exigir asientos contiguos (bloque en la misma fila). Las secciones de pie cuentan como contiguas. */
  requireContiguous: boolean;
  /** Tamaño mínimo de cada carrito (evita entradas sueltas). */
  minGroupSize: number;
  allowStanding: boolean;
  allowObstructed: boolean;
  /** Las plazas accesibles quedan reservadas salvo que se habilite explícitamente. */
  allowAccessible: boolean;
  /** Ambigüedad máxima tolerada de un candidato (0 = ninguna, 1 = total). */
  maxAmbiguity: number;
  /**
   * Tope de entradas por cuenta en ESTA operación (más estricto que el límite
   * oficial; 1 = una cada cuenta, todas a la vez). null/ausente = el límite oficial.
   */
  maxPerAccount?: number | null;
}

/** Configuración editable de una operación. Cada edición en DRAFT crea una versión inmutable nueva. */
export interface OperationConfig {
  name: string;
  eventId: Id;
  providerId: string;
  t0: IsoDateTime;
  runWindowMinutes: number;
  freezeLeadSeconds: number;
  requestedQty: number;
  currency: string;
  /** Precio máximo por entrada, total con gastos, en unidades menores. */
  maxUnitPrice: Minor;
  /** Presupuesto total máximo en unidades menores. */
  budget: Minor;
  preferences: OperationPreferences;
  accountIds: Id[];
  cartExpiryAlertsSeconds: number[];
  simulation?: { scenarioId: string; seed: number } | undefined;
}

export interface OperationSummary {
  id: Id;
  name: string;
  eventId: Id;
  eventName: string;
  providerId: string;
  state: OperationState;
  configVersion: number;
  armedSnapshotHash: string | null;
  t0: IsoDateTime;
  runWindowMinutes: number;
  requestedQty: number;
  cartedQty: number;
  currency: string;
  accountIds: Id[];
  openAlerts: number;
  endReason: EndReason | null;
  pausedReason: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
}

// ---------------------------------------------------------------------------
// Snapshot de ARM: todo lo que hace reproducible una decisión (§1, §5, §25)
// ---------------------------------------------------------------------------

export interface ArmSnapshot {
  hash: string;
  operationId: Id;
  configVersion: number;
  config: OperationConfig;
  compiledPolicy: CompiledPolicy;
  venueArtifactHash: string;
  eventLimits: EventLimits;
  adapter: { providerId: string; adapterVersion: string; capabilities: CapabilityDescriptor[] };
  versions: RuntimeVersions;
  armedAt: IsoDateTime;
  armedBy: string;
}

export interface RuntimeVersions {
  rules: string;
  selectionPolicy: string;
  venue: string;
  adapter: string;
}

/** Preferencias humanas compiladas a IDs canónicos antes de T0 (no hay interpretación libre durante T0). */
export interface CompiledPolicy {
  policyVersion: string;
  requestedQty: number;
  currency: string;
  maxUnitPrice: Minor;
  budget: Minor;
  /** sectionId -> rango de preferencia (0 = mejor). Solo las secciones presentes están permitidas. */
  sectionRank: Record<Id, number>;
  excludedSectionIds: Id[];
  requireContiguous: boolean;
  minGroupSize: number;
  allowStanding: boolean;
  allowObstructed: boolean;
  allowAccessible: boolean;
  maxAmbiguity: number;
  maxSnapshotAgeMs: number;
  /** Explicación legible de cómo se resolvió cada preferencia. */
  resolution: Array<{ input: string; resolvedTo: 'ZONE' | 'SECTION'; ids: Id[]; rank: number }>;
}

// ---------------------------------------------------------------------------
// Evento (catálogo) y límites
// ---------------------------------------------------------------------------

export const LIMIT_SEMANTICS = [
  'PER_ACCOUNT',
  'PER_HOLDER',
  'PER_HOUSEHOLD',
  'PER_PAYMENT_METHOD',
  'UNKNOWN',
] as const;
export type LimitSemantics = (typeof LIMIT_SEMANTICS)[number];

export interface EventLimits {
  /** Máximo de entradas por cuenta que impone el proveedor. */
  perAccount: number;
  /**
   * Máximo por grupo de límite según la semántica (titular, hogar o medio de pago).
   * Con PER_ACCOUNT el grupo es la propia cuenta.
   */
  perGroup: number;
  /** Tope agregado duro de toda la operación, sume lo que sumen las cuentas. */
  perOperation: number;
  semantics: LimitSemantics;
  /** Si la semántica no está verificada la operación no se puede armar (fail-closed). */
  verified: boolean;
  source: string;
  verifiedAt: IsoDateTime | null;
  verifiedBy: string | null;
  notes: string;
}

export interface TicketEvent {
  id: Id;
  name: string;
  venueId: Id;
  providerId: string;
  providerEventRef: string;
  startsAt: IsoDateTime;
  currency: string;
  limits: EventLimits;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Venue Intelligence (§9, §10)
// ---------------------------------------------------------------------------

export interface Provenance {
  source: string;
  verifiedAt: IsoDateTime;
  /** 0..1 */
  confidence: number;
  verifiedBy?: string | undefined;
}

export interface VenueZone {
  id: Id;
  name: string;
  aliases: string[];
}

export type SectionKind = 'SEATED' | 'STANDING';

export interface SectionAttributes {
  /** Calidad de visión 0..5 */
  view?: number | undefined;
  obstructed?: boolean | undefined;
  accessible?: boolean | undefined;
  covered?: boolean | undefined;
  /** Distancia aproximada al escenario en metros */
  distance?: number | undefined;
}

export interface VenueSection {
  id: Id;
  name: string;
  zoneId: Id;
  level: string | null;
  kind: SectionKind;
  aliases: string[];
  rows: number | null;
  seatsPerRow: number | null;
  capacity: number | null;
  attributes: SectionAttributes;
  provenance: Provenance;
  /** true si un override de evento cierra la sección */
  closed: boolean;
}

export interface VenueArtifact {
  hash: string;
  venueId: Id;
  /** null para el artefacto base del recinto; eventId si incluye overrides específicos. */
  eventId: Id | null;
  name: string;
  city: string | null;
  compilerVersion: string;
  compiledAt: IsoDateTime;
  sourceFiles: string[];
  provenance: Provenance;
  zones: VenueZone[];
  sections: VenueSection[];
  /** alias normalizado -> sectionId */
  sectionAliasIndex: Record<string, Id>;
  /** alias normalizado -> zoneId */
  zoneAliasIndex: Record<string, Id>;
  overrideNotes: string[];
  warnings: string[];
}

export interface VenueArtifactSummary {
  hash: string;
  venueId: Id;
  eventId: Id | null;
  name: string;
  compiledAt: IsoDateTime;
  sections: number;
  zones: number;
  confidence: number;
  verifiedAt: IsoDateTime;
  warnings: string[];
  active: boolean;
}

// ---------------------------------------------------------------------------
// Cuentas y sesiones (§12, §13, §14)
// ---------------------------------------------------------------------------

export const SESSION_STATES = [
  'LOGGED_OUT',
  'OPENING',
  'CHALLENGE_REQUIRED',
  'READY',
  'EXPIRED',
  'BLOCKED',
  'UNKNOWN',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const CHALLENGE_TYPES = ['CAPTCHA', 'OTP', 'TWO_FACTOR', 'IDENTITY'] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

export const QUEUE_STATES = ['NOT_OPEN', 'WAITING', 'PASSED', 'EXPIRED', 'BLOCKED', 'UNKNOWN'] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export interface QueueInfo {
  state: QueueState;
  position: number | null;
  etaMs: number | null;
  updatedAt: IsoDateTime;
}

export interface SessionInfo {
  state: SessionState;
  challenge: { type: ChallengeType; since: IsoDateTime } | null;
  queue: QueueInfo;
  lastCheckedAt: IsoDateTime | null;
  detail: string | null;
}

export type VerificationState = 'UNVERIFIED' | 'VERIFIED' | 'NEEDS_ATTENTION';

export interface Account {
  id: Id;
  label: string;
  providerId: string;
  /** Referencia mínima al titular (alias, nunca datos personales completos). */
  holderRef: string;
  householdRef: string | null;
  paymentRef: string | null;
  verification: VerificationState;
  /** IDs de evento o etiquetas (p. ej. "presale:fanclub") para las que la cuenta es elegible. "*" = cualquiera. */
  eligibility: string[];
  enabled: boolean;
  hasSecret: boolean;
  telegramChatId: string | null;
  session: SessionInfo;
  /** Operación que tiene la cuenta arrendada (ARMED..RUNNING) o null. */
  leasedBy: Id | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Proveedores y capabilities (§11)
// ---------------------------------------------------------------------------

export const CAPABILITIES = [
  'session.open',
  'session.status',
  'queue.status',
  'inventory.read',
  'cart.add',
  'cart.read',
  'clock.server_time',
] as const;
export type CapabilityName = (typeof CAPABILITIES)[number];

/**
 * Capabilities prohibidas por diseño: el framework rechaza registrar un adapter que las declare.
 * CAPTCHA, colas, límites y pagos son estados a respetar, no controles a evadir (§26).
 */
export const PROHIBITED_CAPABILITIES = [
  'checkout.pay',
  'challenge.solve',
  'queue.bypass',
  'limit.override',
  'identity.spoof',
] as const;

export type CapabilityExecutor = 'AUTOMATED' | 'HUMAN' | 'DISABLED';

export interface CapabilityDescriptor {
  name: CapabilityName;
  declared: boolean;
  authorized: boolean;
  executor: CapabilityExecutor;
  notes: string;
}

export type ProviderMode = 'SIMULATED' | 'MANUAL_ASSIST' | 'AUTHORIZED_API';

export interface ProviderDescriptor {
  id: string;
  name: string;
  mode: ProviderMode;
  adapterVersion: string;
  capabilities: CapabilityDescriptor[];
  /** Confirmación mínima para que un carrito cuente. */
  confirmationPolicy: ConfirmationLevel;
}

export const CIRCUIT_STATES = ['CLOSED', 'OPEN', 'HALF_OPEN'] as const;
export type CircuitStateName = (typeof CIRCUIT_STATES)[number];

export interface CircuitState {
  key: string;
  providerId: string;
  capability: CapabilityName;
  state: CircuitStateName;
  reason: string | null;
  /** true cuando la reapertura exige revisión humana (p. ej. drift de schema). */
  requiresManualReset: boolean;
  openedAt: IsoDateTime | null;
  failures: number;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Inventario normalizado y selección (§15, §16)
// ---------------------------------------------------------------------------

export interface Candidate {
  /** Hash estable del contenido de la oferta: permite desempates deterministas y replay. */
  id: string;
  offerRef: string;
  sectionId: Id | null;
  sectionLabelRaw: string;
  zoneId: Id | null;
  kind: SectionKind | null;
  row: string | null;
  seats: string[];
  /** true contiguo, false no contiguo, null desconocido */
  contiguous: boolean | null;
  qtyMin: number;
  qtyMax: number;
  unitPrice: Minor;
  currency: string;
  obstructed: boolean;
  accessible: boolean;
  ambiguity: number;
  ambiguityReasons: string[];
  observedAt: IsoDateTime;
}

export const REJECTION_REASONS = [
  'UNRESOLVED_SECTION',
  'SECTION_NOT_ALLOWED',
  'SECTION_EXCLUDED',
  'SECTION_CLOSED',
  'PRICE_ABOVE_MAX',
  'CURRENCY_MISMATCH',
  'NOT_CONTIGUOUS',
  'OBSTRUCTED_VIEW',
  'ACCESSIBLE_RESERVED',
  'STANDING_NOT_ALLOWED',
  'AMBIGUITY_TOO_HIGH',
  'INVALID_DATA',
  'DUPLICATE',
  'QTY_BELOW_MIN_GROUP',
  'OVER_BUDGET',
  'NO_ACCOUNT_CAPACITY',
  'NO_GROUP_CAPACITY',
  'IN_FLIGHT',
  'UNAVAILABLE_OVERLAY',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface InventorySnapshotSummary {
  id: string;
  operationId: Id;
  observedAt: IsoDateTime;
  offers: number;
  candidates: number;
  eligible: number;
  rejectedByReason: Partial<Record<RejectionReason, number>>;
  unresolvedLabels: string[];
}

/** Tupla lexicográfica de ranking (menor es mejor). Registrada para explicar cada decisión. */
export interface RankKey {
  coverageDeficit: number;
  targetRank: number;
  groupingPenalty: number;
  unitPrice: Minor;
  ambiguity: number;
  candidateId: string;
}

export interface DecisionRecord {
  id: Id;
  operationId: Id;
  accountId: Id;
  at: IsoDateTime;
  snapshotId: string;
  policyVersion: string;
  inputHash: string;
  outcome: 'CLAIMED' | 'NO_CANDIDATE' | 'STALE_SNAPSHOT';
  chosen: { candidateId: string; qty: number; rank: RankKey; sectionId: Id | null; unitPrice: Minor } | null;
  /** Mejores alternativas consideradas, en orden. */
  alternatives: Array<{ candidateId: string; qty: number; rank: RankKey }>;
  rejectedByReason: Partial<Record<RejectionReason, number>>;
  claimId: Id | null;
  latencyUs: number;
}

// ---------------------------------------------------------------------------
// Asignación (§17)
// ---------------------------------------------------------------------------

export interface AllocationState {
  operationId: Id;
  version: number;
  currency: string;
  requestedQty: number;
  cartedQty: number;
  claimedQty: number;
  frozenQty: number;
  remainingQty: number;
  budget: { total: Minor; committed: Minor; reserved: Minor; remaining: Minor };
  maxUnitPrice: Minor;
  perAccount: Record<Id, { cap: number; used: number; groupKey: string }>;
  perGroup: Record<string, { cap: number; used: number }>;
}

export const CLAIM_STATES = ['PENDING', 'SENT', 'CONFIRMED', 'REJECTED', 'AMBIGUOUS', 'CANCELLED'] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export type ClaimResolution = 'PROVIDER_RESPONSE' | 'RECONCILIATION' | 'HUMAN' | 'RECOVERY' | null;

export interface Claim {
  id: Id;
  operationId: Id;
  accountId: Id;
  candidateId: string;
  offerRef: string;
  sectionId: Id | null;
  sectionLabel: string;
  row: string | null;
  qty: number;
  unitPrice: Minor;
  idempotencyKey: string;
  state: ClaimState;
  /** Motivo de rechazo o ambigüedad */
  reason: string | null;
  resolution: ClaimResolution;
  cartId: Id | null;
  allocationVersion: number;
  correlationId: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Carritos (§18)
// ---------------------------------------------------------------------------

export const CONFIRMATION_LEVELS = ['ACK', 'READBACK', 'HUMAN'] as const;
export type ConfirmationLevel = (typeof CONFIRMATION_LEVELS)[number];

export const CART_STATES = ['ACTIVE', 'REVIEW_REQUIRED', 'PAID', 'RELEASED', 'EXPIRED'] as const;
export type CartState = (typeof CART_STATES)[number];

export interface CartItem {
  claimId: Id | null;
  sectionId: Id | null;
  sectionLabel: string;
  row: string | null;
  seats: string[];
  qty: number;
  unitPrice: Minor;
}

export interface Cart {
  id: Id;
  operationId: Id;
  accountId: Id;
  providerCartRef: string;
  items: CartItem[];
  qty: number;
  total: Minor;
  currency: string;
  confirmation: ConfirmationLevel;
  state: CartState;
  reviewReason: string | null;
  expiresAt: IsoDateTime | null;
  confirmedAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** URL para que el operador abra el carrito (OPEN CART). */
  openUrl: string | null;
}

// ---------------------------------------------------------------------------
// Alertas accionables (§4, §22, §23)
// ---------------------------------------------------------------------------

export const ALERT_ACTIONS = ['OPEN_SESSION', 'OPEN_CART', 'REVALIDATE', 'PAUSE', 'CANCEL'] as const;
export type AlertAction = (typeof ALERT_ACTIONS)[number];

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertState = 'OPEN' | 'ACKED' | 'RESOLVED';

export const ALERT_KINDS = [
  'SESSION_CHALLENGE',
  'SESSION_EXPIRED',
  'SESSION_NOT_READY',
  'QUEUE_PROBLEM',
  'CART_CONFIRMED',
  'CART_EXPIRING',
  'CART_EXPIRED',
  'CART_SECURED',
  'CART_REVIEW',
  'AMBIGUOUS_RESULT',
  'RECONCILIATION_NEEDS_HUMAN',
  'CIRCUIT_OPEN',
  'SCHEMA_DRIFT',
  'RATE_LIMITED',
  'READINESS_FAILED',
  'READINESS_WARN',
  'KILL_SWITCH',
  'JOURNAL_DEGRADED',
  'OPERATION_ENDED',
  'RECOVERY_REQUIRED',
  'NO_PROGRESS',
  'HUMAN_TASK',
  'EVENT_WATCH',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface Alert {
  id: Id;
  operationId: Id | null;
  accountId: Id | null;
  cartId: Id | null;
  claimId: Id | null;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
  actions: AlertAction[];
  state: AlertState;
  dedupeKey: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Kill switches (§26)
// ---------------------------------------------------------------------------

export const KILL_SCOPES = ['GLOBAL', 'PROVIDER', 'OPERATION', 'ACCOUNT'] as const;
export type KillScope = (typeof KILL_SCOPES)[number];

export interface KillSwitch {
  key: string;
  scope: KillScope;
  targetId: string | null;
  engaged: boolean;
  reason: string | null;
  actor: string | null;
  at: IsoDateTime;
}

export function killSwitchKey(scope: KillScope, targetId?: string | null): string {
  return scope === 'GLOBAL' ? 'global' : `${scope.toLowerCase()}:${targetId ?? ''}`;
}

// ---------------------------------------------------------------------------
// Readiness (§6)
// ---------------------------------------------------------------------------

export type ReadinessStatus = 'PASS' | 'WARN' | 'FAIL';
export type ReadinessPhase = 'T-12h' | 'T-1h' | 'T-5m' | 'MANUAL';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  action: AlertAction | null;
  accountId: Id | null;
}

export interface ReadinessReport {
  operationId: Id;
  phase: ReadinessPhase;
  at: IsoDateTime;
  overall: ReadinessStatus;
  checks: ReadinessCheck[];
}

// ---------------------------------------------------------------------------
// Validación de configuración (§5)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  field: string | null;
  message: string;
}

export interface ValidationReport {
  operationId: Id;
  configVersion: number;
  at: IsoDateTime;
  ok: boolean;
  issues: ValidationIssue[];
  compiledPolicy: CompiledPolicy | null;
  /** Capacidad legalmente alcanzable considerando límites por cuenta, grupo y operación. */
  effectiveCapacity: number | null;
}

// ---------------------------------------------------------------------------
// Métricas y latencia (§8, §24, Apéndice A)
// ---------------------------------------------------------------------------

export type StageKind = 'internal' | 'external';

export const STAGES = {
  normalization: 'internal',
  decision: 'internal',
  allocation: 'internal',
  journal_commit: 'internal',
  'provider.inventory': 'external',
  'provider.add_to_cart': 'external',
  'provider.read_cart': 'external',
  'provider.session': 'external',
  'provider.queue': 'external',
  network: 'external',
  queue_wait: 'external',
  human_task: 'external',
} as const satisfies Record<string, StageKind>;
export type StageName = keyof typeof STAGES;

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  max: number;
  mean: number;
}

export interface OperationMetrics {
  operationId: Id;
  /** Latencias en milisegundos. */
  stages: Partial<Record<StageName, LatencyStats & { kind: StageKind }>>;
  counters: {
    decisions: number;
    claims: number;
    confirmed: number;
    rejected: number;
    ambiguous: number;
    reconciled: number;
    inventoryPolls: number;
    candidatesSeen: number;
    duplicateResponses: number;
  };
  rejectionReasons: Partial<Record<RejectionReason, number>>;
  providerErrors: Record<string, number>;
  throughput: { claimsPerSecond: number; decisionsPerSecond: number };
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Manual-assist: tareas humanas (§14, gate G5)
// ---------------------------------------------------------------------------

export type HumanTaskKind = 'ADD_TO_CART' | 'OPEN_SESSION' | 'VERIFY_CART';
export type HumanTaskState = 'OPEN' | 'DONE' | 'FAILED' | 'UNKNOWN' | 'EXPIRED' | 'CANCELLED';

export interface HumanTask {
  id: Id;
  operationId: Id | null;
  accountId: Id;
  kind: HumanTaskKind;
  claimId: Id | null;
  title: string;
  instructions: string;
  target: {
    sectionLabel: string;
    row: string | null;
    seats: string[];
    qty: number;
    maxUnitPrice: Minor;
    currency: string;
  } | null;
  state: HumanTaskState;
  deadlineAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  respondedAt: IsoDateTime | null;
  response: HumanTaskResponse | null;
  /**
   * Página oficial donde hacer la acción (la del evento o la del proveedor,
   * según el vault). Solo es un enlace para la persona: el sistema no la visita.
   */
  link?: string | null | undefined;
}

export interface HumanTaskResponse {
  result: 'IN_CART' | 'FAILED' | 'UNKNOWN' | 'READY';
  qty?: number | undefined;
  unitPrice?: Minor | undefined;
  seats?: string[] | undefined;
  expiresAt?: IsoDateTime | undefined;
  note?: string | undefined;
  actor: string;
}

// ---------------------------------------------------------------------------
// Auditoría (§20, §25)
// ---------------------------------------------------------------------------

export interface AuditEvent {
  seq: number;
  id: Id;
  at: IsoDateTime;
  operationId: Id | null;
  correlationId: string | null;
  type: string;
  actor: string;
  payload: unknown;
}

export interface ReplayReport {
  operationId: Id;
  at: IsoDateTime;
  armedSnapshotHash: string | null;
  decisionsChecked: number;
  decisionsMatched: number;
  allocationStepsChecked: number;
  allocationStepsMatched: number;
  missingSnapshots: number;
  ok: boolean;
  mismatches: Array<{ kind: 'DECISION' | 'ALLOCATION'; ref: string; expected: unknown; actual: unknown }>;
}

// ---------------------------------------------------------------------------
// Production gates (Apéndice B, C)
// ---------------------------------------------------------------------------

export type GateId = 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
export type GateStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';

export interface GateResult {
  id: GateId;
  name: string;
  status: GateStatus;
  detail: string;
  metrics: Record<string, number | string | boolean>;
  durationMs: number;
}

export interface GatesReport {
  generatedAt: IsoDateTime;
  commit: string | null;
  nodeVersion: string;
  gates: GateResult[];
  slo: {
    decision: LatencyStats | null;
    allocation: LatencyStats | null;
    correctness: number | null;
    overAllocation: number;
    priceViolations: number;
    autoPayments: number;
  };
  definitionOfDone: Array<{ item: string; met: boolean }>;
}

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------

export interface SystemStatus {
  version: string;
  mode: 'SIMULATION' | 'MANUAL_ASSIST' | 'MIXED';
  now: IsoDateTime;
  startedAt: IsoDateTime;
  providers: ProviderDescriptor[];
  killSwitches: KillSwitch[];
  circuits: CircuitState[];
  journal: { healthy: boolean; pending: number; lagMs: number; lastCommitAt: IsoDateTime | null; driver: 'postgres' | 'pglite' | 'memory' };
  telegram: TelegramStatus;
  /** Fuentes oficiales de eventos (Ticketmaster, partidos). */
  feeds: import('./feeds').FeedsStatus;
  /** Claude (API de Anthropic): investiga los eventos por ti. */
  ai: import('./ai').AiStatus;
}

export interface TelegramChatSeen {
  chatId: string;
  /** Nombre del chat o de la persona (solo en memoria, para ayudarte a configurar). */
  name: string;
  at: IsoDateTime;
  /** true si ya es el chat principal o el de alguna cuenta. */
  known: boolean;
}

export interface TelegramStatus {
  /** Hay token configurado (TELEGRAM_BOT_TOKEN). */
  enabled: boolean;
  connected: boolean;
  detail: string;
  /** Usuario del bot (@...), cuando se ha podido comprobar el token. */
  bot: string | null;
  /** Hay chat principal configurado (TELEGRAM_CHAT_ID). */
  mainChatConfigured: boolean;
  /** Chat principal actual, o null. */
  mainChatId: string | null;
  /** Últimos chats que han escrito al bot, para averiguar su chat ID. */
  recentChats: TelegramChatSeen[];
  /** El token y el chat principal se pueden poner desde el dashboard (el servidor los guarda en .env). */
  configurable: boolean;
}
