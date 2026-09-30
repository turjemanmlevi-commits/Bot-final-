/**
 * Estado en memoria del runtime (fuente de verdad en caliente). Cada escritura
 * pasa por `put*`, que además la encola en el journal y la publica en el hub.
 */

import type {
  Account,
  Alert,
  AllocationState,
  Amendment,
  ArmSnapshot,
  Cart,
  CatalogEvent,
  CircuitState,
  Claim,
  ConfigVersion,
  DecisionRecord,
  EndReason,
  EventWatch,
  GatesReport,
  HumanTask,
  Id,
  InventorySnapshotSummary,
  IsoDateTime,
  KillSwitch,
  OperationConfig,
  OperationState,
  ProviderAuthorization,
  ReadinessPhase,
  ReadinessReport,
  ValidationReport,
  VaultCompileReport,
  VenueArtifact,
} from '@to/shared';
import type { EntityRow } from '../store/drivers';
import type { Journal } from '../store/journal';
import type { Hub } from './hub';

export interface OperationRecord {
  id: Id;
  state: OperationState;
  config: OperationConfig;
  configVersion: number;
  versions: ConfigVersion[];
  armSnapshot: ArmSnapshot | null;
  validation: ValidationReport | null;
  readiness: ReadinessReport[];
  readinessPhasesDone: ReadinessPhase[];
  /** Avisos «entrad ya» enviados («T0:minutos»): no se repiten tras un reinicio y sí con otro T0. */
  entryRemindersDone?: string[];
  amendments: Amendment[];
  endReason: EndReason | null;
  pausedReason: string | null;
  /** Nombre del evento al crearla (por si luego desaparece del vault). */
  eventName: string;
  /** Referencia del evento en el proveedor, congelada al armar. */
  providerEventRef: string | null;
  startedAt: IsoDateTime | null;
  securedAt: IsoDateTime | null;
  endedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
}

const DECISIONS_IN_MEMORY = 300;

export class Store {
  readonly operations = new Map<Id, OperationRecord>();
  readonly accounts = new Map<Id, Account>();
  readonly events = new Map<Id, CatalogEvent>();
  /** Todos los artefactos conocidos, por hash (incluye los congelados por operaciones armadas). */
  readonly artifacts = new Map<string, VenueArtifact>();
  /** `${venueId}|${eventId}` → hash del artefacto activo. */
  readonly activeArtifacts = new Map<string, string>();
  providerAuthorizations: ProviderAuthorization[] = [];
  readonly alerts = new Map<Id, Alert>();
  readonly claims = new Map<Id, Claim>();
  readonly carts = new Map<Id, Cart>();
  readonly humanTasks = new Map<Id, HumanTask>();
  readonly killSwitches = new Map<string, KillSwitch>();
  readonly circuits = new Map<string, CircuitState>();
  readonly allocations = new Map<Id, AllocationState>();
  readonly decisions = new Map<Id, DecisionRecord[]>();
  readonly inventory = new Map<Id, InventorySnapshotSummary>();
  /** Desfase medido del reloj de cada proveedor (ms, positivo = el proveedor va adelantado). */
  readonly clockSkew = new Map<string, number>();
  /** Vigilancia de los eventos antes de la venta (por eventId). */
  readonly watches = new Map<Id, EventWatch>();
  vaultReport: VaultCompileReport | null = null;
  gatesReport: GatesReport | null = null;

  constructor(
    private readonly journal: Journal,
    private readonly hub: Hub,
  ) {}

  /** Carga el estado persistido al arrancar. */
  hydrate(rows: EntityRow[]): void {
    for (const row of rows) {
      switch (row.kind) {
        case 'operation':
          this.operations.set(row.id, row.data as OperationRecord);
          break;
        case 'account':
          this.accounts.set(row.id, row.data as Account);
          break;
        case 'alert':
          this.alerts.set(row.id, row.data as Alert);
          break;
        case 'claim':
          this.claims.set(row.id, row.data as Claim);
          break;
        case 'cart':
          this.carts.set(row.id, row.data as Cart);
          break;
        case 'humanTask':
          this.humanTasks.set(row.id, row.data as HumanTask);
          break;
        case 'killSwitch':
          this.killSwitches.set(row.id, row.data as KillSwitch);
          break;
        case 'circuit':
          this.circuits.set(row.id, row.data as CircuitState);
          break;
        case 'allocation':
          this.allocations.set(row.id, row.data as AllocationState);
          break;
        case 'artifact':
          this.artifacts.set(row.id, row.data as VenueArtifact);
          break;
        case 'meta':
          if (row.id === 'gates') this.gatesReport = row.data as GatesReport;
          break;
        case 'eventWatch':
          this.watches.set(row.id, row.data as EventWatch);
          break;
        default:
          break;
      }
    }
  }

  putAccount(a: Account): void {
    this.accounts.set(a.id, a);
    this.journal.persist('account', a.id, a);
    this.hub.upsert('account', a.id, a);
  }

  putWatch(w: EventWatch): void {
    this.watches.set(w.eventId, w);
    this.journal.persist('eventWatch', w.eventId, w);
    this.hub.upsert('eventWatch', w.eventId, w);
  }

  removeWatch(eventId: Id): void {
    if (!this.watches.delete(eventId)) return;
    this.journal.remove('eventWatch', eventId);
    this.hub.remove('eventWatch', eventId);
  }

  putAlert(a: Alert): void {
    this.alerts.set(a.id, a);
    this.journal.persist('alert', a.id, a);
    this.hub.upsert('alert', a.id, a);
  }

  putClaim(c: Claim): void {
    this.claims.set(c.id, c);
    this.journal.persist('claim', c.id, c);
    this.hub.upsert('claim', c.id, c);
  }

  putCart(c: Cart): void {
    this.carts.set(c.id, c);
    this.journal.persist('cart', c.id, c);
    this.hub.upsert('cart', c.id, c);
  }

  putHumanTask(t: HumanTask): void {
    this.humanTasks.set(t.id, t);
    this.journal.persist('humanTask', t.id, t);
    this.hub.upsert('humanTask', t.id, t);
  }

  putKillSwitch(k: KillSwitch): void {
    this.killSwitches.set(k.key, k);
    this.journal.persist('killSwitch', k.key, k);
    this.hub.upsert('killSwitch', k.key, k);
  }

  putCircuit(c: CircuitState): void {
    this.circuits.set(c.key, c);
    this.journal.persist('circuit', c.key, c);
    this.hub.upsert('circuit', c.key, c);
  }

  putAllocation(a: AllocationState): void {
    this.allocations.set(a.operationId, a);
    this.journal.persist('allocation', a.operationId, a);
    this.hub.upsertThrottled('allocation', a.operationId, a);
  }

  /** Persiste un artefacto (se llama al armar: el replay necesita su contenido exacto). */
  persistArtifact(a: VenueArtifact): void {
    this.artifacts.set(a.hash, a);
    this.journal.persist('artifact', a.hash, a);
  }

  putOperationRecord(r: OperationRecord): void {
    this.operations.set(r.id, r);
    this.journal.persist('operation', r.id, r);
  }

  pushDecision(d: DecisionRecord): void {
    const list = this.decisions.get(d.operationId) ?? [];
    list.push(d);
    if (list.length > DECISIONS_IN_MEMORY) list.splice(0, list.length - DECISIONS_IN_MEMORY);
    this.decisions.set(d.operationId, list);
    this.hub.upsertThrottled('decision', d.operationId, d);
  }

  putInventory(s: InventorySnapshotSummary): void {
    this.inventory.set(s.operationId, s);
    this.hub.upsertThrottled('inventory', s.operationId, s);
  }

  putGatesReport(r: GatesReport): void {
    this.gatesReport = r;
    this.journal.persist('meta', 'gates', r);
  }

  artifactFor(venueId: Id, eventId: Id): VenueArtifact | null {
    const hash = this.activeArtifacts.get(`${venueId}|${eventId}`) ?? this.activeArtifacts.get(`${venueId}|`);
    return hash ? (this.artifacts.get(hash) ?? null) : null;
  }
}
