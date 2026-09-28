/**
 * Estado en vivo del dashboard: se carga con el mensaje `hello` del stream SSE
 * y se mantiene al día con los lotes de cambios que envía el servidor.
 */

import { useSyncExternalStore } from 'react';
import type {
  Account,
  Alert,
  AllocationState,
  AuditEvent,
  BootstrapState,
  Cart,
  CatalogEvent,
  CircuitState,
  Claim,
  DecisionRecord,
  HumanTask,
  InventorySnapshotSummary,
  KillSwitch,
  OperationMetrics,
  OperationSummary,
  ProviderAuthorization,
  ReadinessReport,
  ScenarioInfo,
  StreamMessage,
  SystemStatus,
  ValidationReport,
  VaultCompileReport,
  VenueArtifactSummary,
} from '@to/shared';
import { getToken } from './api';

type Rec<T> = Readonly<Record<string, T>>;

export interface LiveState {
  ready: boolean;
  connected: boolean;
  unauthorized: boolean;
  system: SystemStatus | null;
  operations: Rec<OperationSummary>;
  accounts: Rec<Account>;
  events: Rec<CatalogEvent>;
  venues: Rec<VenueArtifactSummary>;
  alerts: Rec<Alert>;
  carts: Rec<Cart>;
  claims: Rec<Claim>;
  humanTasks: Rec<HumanTask>;
  allocations: Rec<AllocationState>;
  decisions: Rec<DecisionRecord[]>;
  metrics: Rec<OperationMetrics>;
  inventory: Rec<InventorySnapshotSummary>;
  readiness: Rec<ReadinessReport>;
  validation: Rec<ValidationReport>;
  killSwitches: Rec<KillSwitch>;
  circuits: Rec<CircuitState>;
  vault: VaultCompileReport | null;
  scenarios: ScenarioInfo[];
  providerAuthorizations: ProviderAuthorization[];
  audit: AuditEvent[];
}

const EMPTY: LiveState = {
  ready: false,
  connected: false,
  unauthorized: false,
  system: null,
  operations: {},
  accounts: {},
  events: {},
  venues: {},
  alerts: {},
  carts: {},
  claims: {},
  humanTasks: {},
  allocations: {},
  decisions: {},
  metrics: {},
  inventory: {},
  readiness: {},
  validation: {},
  killSwitches: {},
  circuits: {},
  vault: null,
  scenarios: [],
  providerAuthorizations: [],
  audit: [],
};

const byId = <T,>(items: T[], key: (t: T) => string): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const it of items) out[key(it)] = it;
  return out;
};

function fromBootstrap(b: BootstrapState, prev: LiveState): LiveState {
  return {
    ...EMPTY,
    ready: true,
    connected: true,
    system: b.system,
    operations: byId(b.operations, (o) => o.id),
    accounts: byId(b.accounts, (a) => a.id),
    events: byId(b.events, (e) => e.id),
    venues: byId(b.venues, (v) => v.hash),
    alerts: byId(b.alerts, (a) => a.id),
    carts: byId(b.carts, (c) => c.id),
    claims: byId(b.claims, (c) => c.id),
    humanTasks: byId(b.humanTasks, (t) => t.id),
    allocations: byId(b.allocations, (a) => a.operationId),
    killSwitches: byId(b.system.killSwitches, (k) => k.key),
    circuits: byId(b.system.circuits, (c) => c.key),
    vault: b.vault,
    scenarios: b.scenarios,
    providerAuthorizations: b.providerAuthorizations,
    decisions: prev.decisions,
    metrics: prev.metrics,
    audit: prev.audit,
  };
}

const MAP_KEYS = {
  operation: 'operations',
  account: 'accounts',
  event: 'events',
  venue: 'venues',
  alert: 'alerts',
  cart: 'carts',
  claim: 'claims',
  humanTask: 'humanTasks',
  allocation: 'allocations',
  metrics: 'metrics',
  inventory: 'inventory',
  readiness: 'readiness',
  validation: 'validation',
  killSwitch: 'killSwitches',
  circuit: 'circuits',
} as const;

function apply(state: LiveState, messages: StreamMessage[]): LiveState {
  let s: LiveState = state;
  const touched = new Set<string>();
  const draft = (key: keyof LiveState): Record<string, unknown> => {
    if (!touched.has(key)) {
      touched.add(key);
      s = { ...s, [key]: { ...(s[key] as Record<string, unknown>) } };
    }
    return s[key] as Record<string, unknown>;
  };
  for (const m of messages) {
    switch (m.type) {
      case 'hello':
        s = fromBootstrap(m.state, s);
        touched.clear();
        break;
      case 'system':
        s = { ...s, system: m.data, killSwitches: byId(m.data.killSwitches, (k) => k.key), circuits: byId(m.data.circuits, (c) => c.key) };
        touched.delete('killSwitches');
        touched.delete('circuits');
        break;
      case 'vault':
        s = { ...s, vault: m.data };
        break;
      case 'audit':
        s = { ...s, audit: [m.data, ...s.audit].slice(0, 400) };
        break;
      case 'remove': {
        if (m.kind === 'decision') break;
        const key = MAP_KEYS[m.kind];
        delete draft(key)[m.id];
        break;
      }
      case 'upsert': {
        if (m.kind === 'decision') {
          const d = draft('decisions') as Record<string, DecisionRecord[]>;
          const list = d[m.id] ?? [];
          if (!list.some((x) => x.id === m.data.id)) d[m.id] = [m.data, ...list].slice(0, 60);
          break;
        }
        draft(MAP_KEYS[m.kind])[m.id] = m.data;
        break;
      }
    }
  }
  return s;
}

class LiveStore {
  state: LiveState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private source: EventSource | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): LiveState => this.state;

  private set(next: LiveState): void {
    if (next === this.state) return;
    this.state = next;
    for (const fn of this.listeners) fn();
  }

  connect(): void {
    this.source?.close();
    const token = getToken();
    const es = new EventSource(`/api/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    this.source = es;
    es.addEventListener('hello', (e) => {
      const msg = JSON.parse((e as MessageEvent<string>).data) as StreamMessage;
      this.set(apply({ ...this.state, unauthorized: false }, [msg]));
    });
    es.addEventListener('batch', (e) => {
      this.set(apply(this.state, JSON.parse((e as MessageEvent<string>).data) as StreamMessage[]));
    });
    es.onopen = () => this.set({ ...this.state, connected: true });
    es.onerror = () => {
      if (this.state.connected) this.set({ ...this.state, connected: false });
      if (es.readyState === EventSource.CLOSED) {
        // Probablemente 401: se comprueba y, si hace falta, se pide el token.
        void fetch('/api/health', { headers: token ? { authorization: `Bearer ${token}` } : {} })
          .then((r) => {
            if (r.status === 401) this.set({ ...this.state, unauthorized: true });
            else setTimeout(() => this.connect(), 2000);
          })
          .catch(() => setTimeout(() => this.connect(), 3000));
      }
    };
  }
}

export const live = new LiveStore();

export function useLive(): LiveState {
  return useSyncExternalStore(live.subscribe, live.getSnapshot);
}
