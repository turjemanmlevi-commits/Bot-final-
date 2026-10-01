import type {
  Account,
  AccountInput,
  AiDetailsQuery,
  AiEventDetails,
  AiEventsQuery,
  AiEventsResult,
  AiKeyResult,
  AiModelsResult,
  AiSeatMap,
  AiSeatMapQuery,
  TopMatchesState,
  AccountPatch,
  Alert,
  ApiErrorBody,
  AuditEvent,
  BootstrapState,
  Cart,
  CircuitState,
  CommandRequest,
  CommandResult,
  EventNoteInput,
  EventNoteResult,
  FeedEvent,
  FeedEventsResult,
  FeedId,
  FeedKeyResult,
  FeedSearchBy,
  GatesReport,
  HumanTask,
  HumanTaskResponseInput,
  KillSwitch,
  KillSwitchInput,
  LabelResolutionResult,
  OperationConfig,
  OperationDetail,
  ReplayReport,
  SaleZonesInput,
  TelegramConfigResult,
  TelegramTestResult,
  VaultCompileReport,
  VenueArtifact,
  VenueQuickInput,
  VenueQuickResult,
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
  const method = opts.method ?? 'GET';
  const send = () =>
    fetch(path, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        'x-actor': encodeURIComponent(getActor()),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res: Response;
  try {
    res = await send();
  } catch {
    // Corte momentáneo con la sala (p. ej. una conexión que el servidor acababa de cerrar): se repite una vez
    // si repetir no hace daño (consultas y cambios de configuración; no las altas con POST).
    await new Promise((r) => setTimeout(r, 800));
    try {
      if (method === 'POST') throw new Error('no se repite');
      res = await send();
    } catch {
      throw new ApiError(
        0,
        'NETWORK',
        'No se pudo hablar con la sala de control (el servidor de la ventana negra no ha respondido). Comprueba que la ventana negra sigue abierta y sin «Seleccionar» en el título (pulsa Esc), recarga esta página (F5) y vuelve a probar. Si tienes un bloqueador de anuncios, desactívalo para localhost.',
      );
    }
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', `La sala respondió algo inesperado (${res.status}). Cierra la ventana negra, vuelve a abrir «Sala de control» y prueba otra vez.`);
  }
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
  carts: () => api<Cart[]>('/api/carts'),
  /** Marca el carrito como pagado (también si ya había caducado) o liberado. */
  markCart: (id: string, state: 'PAID' | 'RELEASED', note?: string) => post<Cart>(`/api/carts/${id}/mark`, { state, ...(note ? { note } : {}) }),
  /** Minutos que le quedan al carrito según la web oficial (1..60): caduca en ahora + minutos. */
  setCartExpiry: (id: string, minutes: number) => post<Cart>(`/api/carts/${id}/expiry`, { minutes }),
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
  /** Prueba real con el Real Madrid: arma una operación de prueba con las cuentas del Real Madrid. */
  realTest: (body: { startInSeconds?: number }) => post<{ operationId: string; eventName: string; t0: string; telegram: boolean; message: string }>('/api/demo/real-test', body),
  /** Crea la nota del evento en el vault (20 Eventos) y recompila. */
  createEventNote: (input: EventNoteInput) => post<EventNoteResult>('/api/vault/events', input),
  /** Actualiza las propiedades de la nota del evento conservando el resto. */
  updateEventNote: (eventId: string, input: EventNoteInput) =>
    api<EventNoteResult>(`/api/vault/events/${encodeURIComponent(eventId)}`, { method: 'PUT', body: input }),
  /** Crea un recinto (carpeta con zonas y secciones) en el vault y recompila. */
  createVenue: (input: VenueQuickInput) => post<VenueQuickResult>('/api/vault/venues', input),
  /** Envía un mensaje de prueba por Telegram (al chat principal si no se indica otro). */
  telegramTest: (chatId?: string | null) => post<TelegramTestResult>('/api/telegram/test', chatId ? { chatId } : {}),
  /** Comprueba el token del bot con Telegram, lo guarda en .env y conecta sin reiniciar. */
  telegramSetToken: (token: string) => api<TelegramConfigResult>('/api/telegram/token', { method: 'PUT', body: { token } }),
  /** Elige (o quita, con null) el chat principal de Telegram. */
  telegramSetMainChat: (chatId: string | null) => api<TelegramConfigResult>('/api/telegram/main-chat', { method: 'PUT', body: { chatId } }),
  /** Clave de una fuente oficial de eventos (null = quitarla). */
  feedSetKey: (feed: FeedId, key: string | null) => api<FeedKeyResult>(`/api/feeds/${feed}/key`, { method: 'PUT', body: { key } }),
  /** Próximos eventos de un recinto (o por nombre) en una fuente oficial. */
  feedEvents: (p: { feed: FeedId; venueId?: string | null; days: number; by?: FeedSearchBy; q?: string | null; club?: string | null }) => {
    const qs = new URLSearchParams({ feed: p.feed, days: String(p.days), by: p.by ?? 'event' });
    if (p.venueId) qs.set('venueId', p.venueId);
    if (p.q) qs.set('q', p.q);
    if (p.club) qs.set('club', p.club);
    return api<FeedEventsResult>(`/api/feeds/events?${qs.toString()}`);
  },
  feedEvent: (feed: FeedId, id: string) => api<FeedEvent>(`/api/feeds/${feed}/events/${encodeURIComponent(id)}`),
  /** Clave de la API de Claude (null = quitarla): se comprueba y se guarda en .env. */
  aiSetKey: (key: string | null) => api<AiKeyResult>('/api/ai/key', { method: 'PUT', body: { key } }),
  /** Modelos de la cuenta de Claude que sirven para las búsquedas, con su precio (gratis). */
  aiModels: () => api<AiModelsResult>('/api/ai/models'),
  /** Modelo de las búsquedas (null = el Opus más reciente): se guarda en .env. */
  aiSetModel: (model: string | null) => api<AiKeyResult>('/api/ai/model', { method: 'PUT', body: { model } }),
  /** Claude mira la web de venta y trae sus próximos eventos (tarda 1–2 min). */
  aiEvents: (q: AiEventsQuery) => post<AiEventsResult>('/api/ai/events', q),
  /** Claude lee el evento: fechas, fases de venta, límite por persona, precios, recinto y plano oficial. */
  aiEvent: (q: AiDetailsQuery) => post<AiEventDetails>('/api/ai/event', q),
  /** Claude sitúa cada zona sobre la imagen del plano oficial. */
  aiSeatMap: (q: AiSeatMapQuery) => post<AiSeatMap>('/api/ai/seatmap', q),
  /** ⭐ Grandes partidos: la lista guardada. */
  top: () => api<TopMatchesState>('/api/top'),
  /** Pedir a Claude la lista otra vez (en segundo plano: 2–4 min). */
  topRefresh: () => post<TopMatchesState>('/api/top/refresh'),
  /** Dónde queréis las entradas (zonas en orden de preferencia). */
  setEventTargets: (eventId: string, targets: string[]) =>
    api<EventNoteResult>(`/api/vault/events/${encodeURIComponent(eventId)}/targets`, { method: 'PUT', body: { targets } }),
  /** Añade al recinto las zonas de la venta que no tenía y, a las que sí, el nombre de la web como alias. */
  addSaleZones: (venueId: string, zones: SaleZonesInput['zones']) =>
    post<{ zones: number; aliases: number; report: VaultCompileReport }>(`/api/vault/venues/${encodeURIComponent(venueId)}/sale-zones`, { zones }),
};
