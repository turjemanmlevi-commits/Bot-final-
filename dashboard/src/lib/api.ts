import type {
  Account,
  AccountInput,
  AccountPatch,
  Alert,
  ApiErrorBody,
  AuditEvent,
  BootstrapState,
  Cart,
  CircuitState,
  CommandRequest,
  CommandResult,
  GatesReport,
  HumanTask,
  HumanTaskResponseInput,
  KillSwitch,
  KillSwitchInput,
  LabelResolutionResult,
  OperationConfig,
  OperationDetail,
  ReplayReport,
  VaultCompileReport,
  VenueArtifact,
} from '@to/shared';

const ACTOR_KEY = 'to.actor';
const TOKEN_KEY = 'to.token';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // almacenamiento no disponible (modo privado): se sigue sin recordar
  }
}

export function getActor(): string {
  return read(ACTOR_KEY) || 'operador';
}

export function setActor(value: string): void {
  write(ACTOR_KEY, value.trim() || null);
}

export function getToken(): string | null {
  return read(TOKEN_KEY);
}

export function setToken(value: string | null): void {
  write(TOKEN_KEY, value);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; accept?: number[] } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-actor': encodeURIComponent(getActor()),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!res.ok && !(opts.accept ?? []).includes(res.status)) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP', err?.message ?? `${res.status} ${res.statusText}`);
  }
  return json as T;
}

const post = <T>(path: string, body: unknown = {}, accept?: number[]) => api<T>(path, { method: 'POST', body, accept });

export const Api = {
  state: () => api<BootstrapState>('/api/state'),
  operation: (id: string) => api<OperationDetail>(`/api/operations/${id}`),
  createOperation: (config: OperationConfig) => post<OperationDetail>('/api/operations', config),
  updateConfig: (id: string, config: OperationConfig) => api<OperationDetail>(`/api/operations/${id}/config`, { method: 'PUT', body: config }),
  command: (id: string, req: CommandRequest) => post<CommandResult>(`/api/operations/${id}/commands`, req, [422]),
  replay: (id: string) => post<ReplayReport>(`/api/operations/${id}/replay`),
  compileVault: () => post<{ report: VaultCompileReport; applied: boolean; reason: string | null }>('/api/vault/compile'),
  venue: (hash: string) => api<VenueArtifact>(`/api/venues/${hash}`),
  resolveLabel: (hash: string, label: string) => api<LabelResolutionResult>(`/api/venues/${hash}/resolve?label=${encodeURIComponent(label)}`),
  createAccount: (input: AccountInput) => post<Account>('/api/accounts', input),
  updateAccount: (id: string, patch: AccountPatch) => api<Account>(`/api/accounts/${id}`, { method: 'PATCH', body: patch }),
  openSession: (id: string) => post<Account>(`/api/accounts/${id}/session/open`),
  sessionReady: (id: string, note?: string) => post<Account>(`/api/accounts/${id}/session/ready`, note ? { note } : {}),
  ackAlert: (id: string) => post<Alert>(`/api/alerts/${id}/ack`),
  resolveAlert: (id: string) => post<Alert>(`/api/alerts/${id}/resolve`),
  respondTask: (id: string, input: HumanTaskResponseInput) => post<HumanTask>(`/api/human-tasks/${id}/respond`, input),
  markCart: (id: string, state: 'PAID' | 'RELEASED', note?: string) => post<Cart>(`/api/carts/${id}/mark`, { state, ...(note ? { note } : {}) }),
  setKillSwitch: (input: KillSwitchInput) => post<KillSwitch>('/api/kill-switches', input),
  resetCircuit: (key: string) => post<CircuitState>(`/api/circuits/${encodeURIComponent(key)}/reset`),
  audit: (params: { operationId?: string; type?: string; limit?: number; before?: number }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return api<AuditEvent[]>(`/api/audit?${qs.toString()}`);
  },
  gates: () => api<GatesReport | null>('/api/gates'),
  runGates: (full = false) => post<GatesReport>(`/api/gates/run${full ? '?full=1' : ''}`),
  seedDemo: (body: { startInSeconds?: number; scenarioId?: string }) => post<{ operationId: string; message: string }>('/api/demo/seed', body),
};
