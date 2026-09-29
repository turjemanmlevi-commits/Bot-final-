/**
 * API HTTP + stream SSE para el dashboard (Hono).
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  AccountInputSchema,
  AiDetailsQuerySchema,
  AiEventsQuerySchema,
  AiKeySchema,
  AiSeatMapQuerySchema,
  AccountPatchSchema,
  CartExpirySchema,
  CartMarkSchema,
  CommandRequestSchema,
  DemoSeedSchema,
  EventNoteInputSchema,
  FEEDS,
  FeedKeySchema,
  HumanTaskResponseInputSchema,
  KillSwitchInputSchema,
  OperationConfigSchema,
  PreferredTargetsSchema,
  SaleZonesSchema,
  SessionHumanSchema,
  TelegramMainChatSchema,
  TelegramTestSchema,
  TelegramTokenSchema,
  VenueQuickInputSchema,
  type AiKeyResult,
  type ApiErrorBody,
  type FeedId,
  type FeedKeyResult,
  type LabelResolutionResult,
  type OperationConfig,
  type StreamMessage,
  type TelegramConfigResult,
  type TelegramTestResult,
} from '@to/shared';
import type { z } from 'zod';
import type { App } from '../app';
import { resolveLabel, venueIndex } from '../domain/venue';
import { runGates } from '../gates/gates';
import { AiError, type ClaudeControl } from '../ai/claude';
import { FeedError } from '../feeds/common';
import { FeedUsageError, type FeedControl } from '../feeds/control';
import { AccountError } from '../runtime/accounts';
import { CartError } from '../runtime/carts';
import { seedDemo } from '../runtime/demo';
import { OperationError } from '../runtime/operations';
import { TaskError } from '../runtime/tasks';
import type { TelegramControl } from '../telegram/control';
import { log } from '../util/log';
import { normalizeLabel } from '../util/normalize';
import { AuthoringError, VaultAuthoring } from '../vault/authoring';
import { VaultWriteError } from '../vault/writer';

export interface HttpOptions {
  dashboardDist: string | null;
  operatorToken: string | null;
  /** Configuración de Telegram desde el dashboard (token y chat principal). */
  telegram?: TelegramControl | null;
  /** Fuentes oficiales de eventos (Ticketmaster, partidos). */
  feeds?: FeedControl | null;
  /** Claude (API de Anthropic): busca los eventos de cada web de venta. */
  ai?: ClaudeControl | null;
  /** Alta de eventos y recintos (compartida con el bot de Telegram). */
  authoring?: VaultAuthoring | null;
}

class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function actorOf(c: Context): string {
  let raw = c.req.header('x-actor') ?? '';
  try {
    // El dashboard lo envía con encodeURIComponent (las cabeceras no admiten cualquier carácter).
    raw = decodeURIComponent(raw);
  } catch {
    // cabecera sin codificar: se usa tal cual
  }
  const clean = raw.replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 40);
  return clean === '' ? 'operador' : clean;
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'El cuerpo no es JSON válido');
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const message = r.error.issues.map((i) => `${FIELD_LABEL[i.path.join('.')] ?? (i.path.join('.') || '(raíz)')}: ${i.message}`).join('; ');
    throw new ApiError(400, 'BAD_REQUEST', message, r.error.issues);
  }
  return r.data;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Cambios de configuración (el token del bot): solo desde el propio dashboard.
 * Exige JSON (otra web no puede mandarlo sin permiso del navegador) y, si el
 * navegador indica el origen, que sea esta misma página o localhost.
 */
function sameSite(c: Context): void {
  const type = (c.req.header('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/json')) throw new ApiError(400, 'BAD_CONTENT_TYPE', 'Se esperaba JSON');
  const origin = c.req.header('origin');
  if (!origin) return;
  let url: URL | null = null;
  try {
    url = new URL(origin);
  } catch {
    url = null;
  }
  const host = c.req.header('host') ?? '';
  if (!url || (url.host !== host && !LOOPBACK.has(url.hostname))) {
    throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'Esta petición viene de otra web: solo se puede configurar desde el dashboard.');
  }
}

const AI_ERROR_STATUS: Record<AiError['code'], ApiError['status']> = {
  NOT_CONFIGURED: 409,
  BAD_REQUEST: 400,
  REFUSED: 422,
  RATE: 429,
  AUTH: 502,
  NETWORK: 502,
  INCOMPLETE: 502,
};

/** Nombres de campo legibles en los mensajes de error (los formularios los muestran tal cual). */
const FIELD_LABEL: Record<string, string> = {
  label: 'Nombre visible',
  holderRef: 'Titular',
  householdRef: 'Hogar',
  paymentRef: 'Medio de pago',
  telegramChatId: 'Chat de Telegram',
  token: 'Token del bot',
  chatId: 'Chat',
  qty: 'Cantidad',
  unitPrice: 'Precio por entrada',
  minutes: 'Minutos',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function createHttpApp(app: App, opts: HttpOptions): Hono {
  const { runtime } = app;
  const { ctx } = runtime;
  const http = new Hono();

  http.onError((err, c) => {
    let status: ApiError['status'] = 500;
    let code = 'INTERNAL';
    let details: unknown;
    if (err instanceof ApiError) {
      status = err.status;
      code = err.code;
      details = err.details;
    } else if (err instanceof OperationError || err instanceof AccountError || err instanceof TaskError || err instanceof CartError) {
      status = err.code === 'NOT_FOUND' ? 404 : 409;
      code = err.code;
    } else if (err instanceof FeedUsageError) {
      status = err.code === 'NOT_FOUND' ? 404 : err.code === 'NOT_CONFIGURED' ? 409 : 400;
      code = `FEED_${err.code}`;
    } else if (err instanceof FeedError) {
      status = err.kind === 'RATE' ? 429 : 502;
      code = `FEED_${err.kind}`;
    } else if (err instanceof AiError) {
      status = AI_ERROR_STATUS[err.code];
      code = `AI_${err.code}`;
    } else if (err instanceof AuthoringError) {
      status = err.status;
      code = err.code;
    } else if (err instanceof VaultWriteError) {
      status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400;
      code = `VAULT_${err.code}`;
    } else {
      log.error('Error en la API', { path: c.req.path, error: err.message });
    }
    const payload: ApiErrorBody = { error: { code, message: err.message, details } };
    return c.json(payload, status);
  });

  if (opts.operatorToken) {
    const token = opts.operatorToken;
    http.use('/api/*', async (c, next) => {
      const header = c.req.header('authorization') ?? '';
      const query = c.req.query('token') ?? '';
      if (header !== `Bearer ${token}` && query !== token) throw new ApiError(401, 'UNAUTHORIZED', 'Falta el token de operador');
      await next();
    });
  }

  // ---------------------------------------------------------------------------
  // Sistema, estado y stream
  // ---------------------------------------------------------------------------

  http.get('/api/health', (c) => c.json({ ok: true, version: ctx.cfg.version, journal: ctx.journal.status() }));
  http.get('/api/system', (c) => c.json(ctx.ops.systemStatus()));
  http.get('/api/state', (c) => c.json(runtime.bootstrap()));

  http.get('/api/stream', (c) =>
    streamSSE(c, async (stream) => {
      let queue: StreamMessage[] = [];
      let wake: (() => void) | null = null;
      let alive = true;
      const unsubscribe = runtime.hub.subscribe((m) => {
        queue.push(m);
        if (queue.length > 5000) queue = [{ type: 'hello', state: runtime.bootstrap() }];
        wake?.();
      });
      stream.onAbort(() => {
        alive = false;
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ type: 'hello', state: runtime.bootstrap() }) });
      while (alive) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 15_000);
            wake = () => {
              clearTimeout(t);
              resolve();
            };
          });
          wake = null;
        }
        if (!alive) break;
        if (queue.length === 0) {
          await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
          continue;
        }
        const batch = queue;
        queue = [];
        await stream.writeSSE({ event: 'batch', data: JSON.stringify(batch) });
      }
    }),
  );

  // ---------------------------------------------------------------------------
  // Vault, recintos y eventos
  // ---------------------------------------------------------------------------

  http.get('/api/vault', (c) => c.json(runtime.store.vaultReport));
  http.post('/api/vault/compile', async (c) => {
    const force = c.req.query('force') === '1';
    if (!app.vaultDir) throw new ApiError(409, 'NO_VAULT', 'No hay vault configurado (VAULT_DIR)');
    const { compiled, applied, reason } = await app.compileAndApply({ force });
    return c.json({ report: compiled.report, applied, reason });
  });

  http.get('/api/venues', (c) => c.json(runtime.venueSummaries()));
  http.get('/api/venues/:hash', (c) => {
    const a = runtime.store.artifacts.get(c.req.param('hash'));
    if (!a) throw new ApiError(404, 'NOT_FOUND', 'Artefacto no encontrado');
    return c.json(a);
  });
  http.get('/api/venues/:hash/resolve', (c) => {
    const a = runtime.store.artifacts.get(c.req.param('hash'));
    if (!a) throw new ApiError(404, 'NOT_FOUND', 'Artefacto no encontrado');
    const label = c.req.query('label') ?? '';
    const r = resolveLabel(label, a);
    const idx = venueIndex(a);
    const result: LabelResolutionResult = {
      label,
      normalized: normalizeLabel(label),
      sectionId: r.sectionId,
      sectionName: r.sectionId ? (idx.sectionsById.get(r.sectionId)?.name ?? null) : null,
      zoneId: r.zoneId,
      zoneName: r.zoneId ? (idx.zonesById.get(r.zoneId)?.name ?? null) : null,
      ambiguity: r.ambiguity,
      method: r.method,
      reasons: r.reasons,
    };
    return c.json(result);
  });
  http.get('/api/events', (c) => c.json([...runtime.store.events.values()]));

  // Alta y edición de eventos / recintos desde el dashboard (se escriben notas en el vault).
  const authoring = opts.authoring ?? new VaultAuthoring(app);

  http.post('/api/vault/events', async (c) => {
    const input = await body(c, EventNoteInputSchema);
    return c.json(await authoring.createEvent(input, actorOf(c)), 201);
  });

  http.put('/api/vault/events/:id', async (c) => {
    const input = await body(c, EventNoteInputSchema);
    return c.json(await authoring.updateEvent(c.req.param('id'), input, actorOf(c)));
  });

  http.put('/api/vault/events/:id/targets', async (c) => {
    const b = await body(c, PreferredTargetsSchema);
    return c.json(await authoring.setPreferredTargets(c.req.param('id'), b.targets, actorOf(c)));
  });

  // La estructura de la venta de un evento completa su recinto (zonas que faltan y nombres de la web como alias).
  http.post('/api/vault/venues/:id/sale-zones', async (c) => {
    const b = await body(c, SaleZonesSchema);
    return c.json(await authoring.addSaleZones(c.req.param('id'), b.zones, actorOf(c)));
  });

  http.post('/api/vault/venues', async (c) => {
    const input = await body(c, VenueQuickInputSchema);
    return c.json(await authoring.createVenue(input, actorOf(c)), 201);
  });

  // Telegram: mensaje de prueba al chat principal (o al indicado).
  http.post('/api/telegram/test', async (c) => {
    const b = await body(c, TelegramTestSchema);
    const n = ctx.notifier;
    const result: TelegramTestResult = n?.sendTest
      ? await n.sendTest(b.chatId ?? null)
      : { ok: false, message: 'Telegram no está configurado: pega el token de tu bot en Ajustes · Telegram.' };
    return c.json(result);
  });

  // Telegram desde el dashboard: token del bot y chat principal (se guardan en .env, sin reiniciar).
  const telegramControl = () => {
    if (!opts.telegram) throw new ApiError(409, 'TELEGRAM_UNAVAILABLE', 'Este servidor no permite configurar Telegram desde el dashboard: usa el archivo .env.');
    return opts.telegram;
  };
  http.put('/api/telegram/token', async (c) => {
    sameSite(c);
    const b = await body(c, TelegramTokenSchema);
    const result: TelegramConfigResult = await telegramControl().setToken(b.token, actorOf(c));
    return c.json(result);
  });
  http.put('/api/telegram/main-chat', async (c) => {
    sameSite(c);
    const b = await body(c, TelegramMainChatSchema);
    const result: TelegramConfigResult = await telegramControl().setMainChat(b.chatId, actorOf(c));
    return c.json(result);
  });

  // ---------------------------------------------------------------------------
  // Claude (API de Anthropic): busca y lee los eventos de cada web de venta
  // ---------------------------------------------------------------------------

  const aiControl = () => {
    if (!opts.ai) throw new ApiError(409, 'AI_UNAVAILABLE', 'Este servidor no tiene Claude activado.');
    return opts.ai;
  };
  http.get('/api/ai', (c) => c.json(aiControl().status()));
  // Clave de la API de Claude (null = quitarla). Se comprueba y se guarda en .env; nunca se devuelve.
  http.put('/api/ai/key', async (c) => {
    sameSite(c);
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new ApiError(400, 'BAD_JSON', 'El cuerpo no es JSON válido');
    }
    let key: string | null = null;
    if (!(json && typeof json === 'object' && (json as { key?: unknown }).key === null)) {
      const r = AiKeySchema.safeParse(json);
      if (!r.success) throw new ApiError(400, 'BAD_REQUEST', `Clave: ${r.error.issues[0]?.message ?? 'no válida'}`);
      key = r.data.key;
    }
    const result: AiKeyResult = await aiControl().setKey(key, actorOf(c));
    return c.json(result);
  });
  // Cuestan dinero (se paga a Anthropic por consulta): solo desde el propio dashboard.
  http.post('/api/ai/events', async (c) => {
    sameSite(c);
    const q = await body(c, AiEventsQuerySchema);
    return c.json(await aiControl().findEvents(q));
  });
  http.post('/api/ai/event', async (c) => {
    sameSite(c);
    const q = await body(c, AiDetailsQuerySchema);
    return c.json(await aiControl().eventDetails(q));
  });
  // ⭐ Grandes partidos: la lista guardada y buscarla otra vez (Claude, en segundo plano).
  const topControl = () => {
    if (!ctx.topMatches) throw new ApiError(409, 'TOP_UNAVAILABLE', 'Este servidor no tiene «Grandes partidos» activado.');
    return ctx.topMatches;
  };
  http.get('/api/top', (c) => c.json(topControl().state()));
  http.post('/api/top/refresh', async (c) => {
    sameSite(c);
    return c.json(topControl().refresh(actorOf(c)), 202);
  });
  http.post('/api/ai/seatmap', async (c) => {
    sameSite(c);
    const q = await body(c, AiSeatMapQuerySchema);
    return c.json(await aiControl().seatMap(q));
  });

  // ---------------------------------------------------------------------------
  // Fuentes oficiales de eventos (Ticketmaster, partidos): solo lectura
  // ---------------------------------------------------------------------------

  const feedControl = () => {
    if (!opts.feeds) throw new ApiError(409, 'FEEDS_UNAVAILABLE', 'Este servidor no tiene las fuentes de eventos activadas.');
    return opts.feeds;
  };
  const feedParam = (raw: string | undefined): FeedId => {
    if (!raw || !(FEEDS as readonly string[]).includes(raw)) throw new ApiError(400, 'BAD_REQUEST', 'Fuente desconocida (ticketmaster o football)');
    return raw as FeedId;
  };
  http.get('/api/feeds', (c) => c.json(feedControl().status()));
  // Clave de la fuente (null = quitarla). Se comprueba con la fuente y se guarda en .env.
  http.put('/api/feeds/:feed/key', async (c) => {
    sameSite(c);
    const feed = feedParam(c.req.param('feed'));
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new ApiError(400, 'BAD_JSON', 'El cuerpo no es JSON válido');
    }
    let key: string | null = null;
    if (!(json && typeof json === 'object' && (json as { key?: unknown }).key === null)) {
      const r = FeedKeySchema.safeParse(json);
      if (!r.success) throw new ApiError(400, 'BAD_REQUEST', `Clave: ${r.error.issues[0]?.message ?? 'no válida'}`);
      key = r.data.key;
    }
    const result: FeedKeyResult = await feedControl().setKey(feed, key, actorOf(c));
    return c.json(result);
  });
  // Próximos eventos: ?feed=ticketmaster|football&days=14&by=event|sale[&venueId=…][&q=…][&club=…] (sin recinto: toda España)
  http.get('/api/feeds/events', async (c) => {
    const feed = feedParam(c.req.query('feed'));
    const days = Number(c.req.query('days') ?? 14);
    if (!Number.isFinite(days) || days < 1 || days > 400) throw new ApiError(400, 'BAD_REQUEST', 'days: entre 1 y 400');
    const by = c.req.query('by') === 'sale' ? 'sale' : 'event';
    const q = (c.req.query('q') ?? '').trim().slice(0, 100) || null;
    const venueId = (c.req.query('venueId') ?? '').trim() || null;
    const club = (c.req.query('club') ?? '').trim().slice(0, 80) || null;
    return c.json(await feedControl().upcoming({ feed, venueId, days, by, q, club }));
  });
  http.get('/api/feeds/:feed/events/:id', async (c) => {
    const feed = feedParam(c.req.param('feed'));
    const id = c.req.param('id');
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'Identificador no válido');
    const event = await feedControl().lookup(feed, id);
    if (!event) throw new ApiError(404, 'NOT_FOUND', 'La fuente ya no tiene ese evento');
    return c.json(event);
  });
  http.get('/api/watches', (c) => c.json([...runtime.store.watches.values()]));

  // ---------------------------------------------------------------------------
  // Cuentas
  // ---------------------------------------------------------------------------

  http.get('/api/accounts', (c) => c.json([...runtime.store.accounts.values()]));
  // El número del propio bot (el principio del token) no es el chat de ninguna persona.
  const checkChat = (chatId: string | null | undefined) => {
    if (opts.telegram?.isBotChat(chatId)) {
      throw new ApiError(
        400,
        'BAD_REQUEST',
        `telegramChatId: ${chatId} es el número del propio bot, no el de la persona. Pon el número que el bot le contesta a esa persona al pulsar «Iniciar» (sale en la lista del campo y en Ajustes · Telegram).`,
      );
    }
  };
  http.post('/api/accounts', async (c) => {
    const b = await body(c, AccountInputSchema);
    checkChat(b.telegramChatId);
    return c.json(ctx.accounts.create(b, actorOf(c)), 201);
  });
  http.patch('/api/accounts/:id', async (c) => {
    const b = await body(c, AccountPatchSchema);
    checkChat(b.telegramChatId);
    return c.json(ctx.accounts.update(c.req.param('id'), b, actorOf(c)));
  });
  http.post('/api/accounts/:id/session/open', async (c) => c.json(await ctx.accounts.openSession(c.req.param('id'), actorOf(c))));
  http.post('/api/accounts/:id/session/ready', async (c) => {
    const b = await body(c, SessionHumanSchema);
    return c.json(ctx.accounts.humanReady(c.req.param('id'), actorOf(c), b.note));
  });

  // ---------------------------------------------------------------------------
  // Operaciones
  // ---------------------------------------------------------------------------

  http.get('/api/operations', (c) => c.json(ctx.ops.summaries()));
  http.post('/api/operations', async (c) => {
    const config = (await body(c, OperationConfigSchema)) as OperationConfig;
    const r = ctx.ops.create(config, actorOf(c));
    return c.json(ctx.ops.detail(r.id), 201);
  });
  http.get('/api/operations/:id', (c) => c.json(ctx.ops.detail(c.req.param('id'))));
  http.put('/api/operations/:id/config', async (c) => {
    const config = (await body(c, OperationConfigSchema)) as OperationConfig;
    ctx.ops.updateConfig(c.req.param('id'), config, actorOf(c));
    return c.json(ctx.ops.detail(c.req.param('id')));
  });
  http.post('/api/operations/:id/commands', async (c) => {
    const req = await body(c, CommandRequestSchema);
    const result = await ctx.ops.command(c.req.param('id'), req, actorOf(c));
    return c.json(result, result.ok ? 200 : 422);
  });
  http.post('/api/operations/:id/replay', async (c) => c.json(await runtime.replay(c.req.param('id'))));
  http.get('/api/operations/:id/decisions', (c) => {
    const limit = Math.min(500, Number(c.req.query('limit') ?? 100) || 100);
    return c.json([...(runtime.store.decisions.get(c.req.param('id')) ?? [])].reverse().slice(0, limit));
  });

  // ---------------------------------------------------------------------------
  // Alertas, tareas, carritos y seguridad
  // ---------------------------------------------------------------------------

  http.get('/api/alerts', (c) => c.json([...runtime.store.alerts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
  http.post('/api/alerts/:id/ack', (c) => c.json(ctx.alerts.ack(c.req.param('id'), actorOf(c))));
  http.post('/api/alerts/:id/resolve', (c) => c.json(ctx.alerts.resolve(c.req.param('id'), actorOf(c))));

  http.get('/api/human-tasks', (c) => c.json([...runtime.store.humanTasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
  http.post('/api/human-tasks/:id/respond', async (c) => c.json(ctx.tasks.respond(c.req.param('id'), await body(c, HumanTaskResponseInputSchema), actorOf(c))));

  http.get('/api/carts', (c) => c.json([...runtime.store.carts.values()]));
  http.post('/api/carts/:id/expiry', async (c) => {
    const b = await body(c, CartExpirySchema);
    return c.json(ctx.carts.setExpiry(c.req.param('id'), new Date(ctx.now() + b.minutes * 60_000).toISOString(), actorOf(c)));
  });
  http.post('/api/carts/:id/mark', async (c) => {
    const b = await body(c, CartMarkSchema);
    return c.json(ctx.carts.mark(c.req.param('id'), b.state, actorOf(c), b.note));
  });

  http.post('/api/kill-switches', async (c) => {
    const b = await body(c, KillSwitchInputSchema);
    try {
      return c.json(ctx.safety.setKillSwitch(b.scope, b.targetId ?? null, b.engaged, b.reason ?? null, actorOf(c)));
    } catch (err) {
      throw new ApiError(400, 'BAD_REQUEST', (err as Error).message);
    }
  });
  http.post('/api/circuits/:key/reset', (c) => {
    const r = ctx.safety.reset(decodeURIComponent(c.req.param('key')), actorOf(c));
    if (!r) throw new ApiError(404, 'NOT_FOUND', 'Circuito no encontrado');
    return c.json(r);
  });

  // ---------------------------------------------------------------------------
  // Auditoría, calidad y demo
  // ---------------------------------------------------------------------------

  http.get('/api/audit', async (c) => {
    const operationId = c.req.query('operationId') || undefined;
    const type = c.req.query('type') || undefined;
    const limit = Math.min(1000, Number(c.req.query('limit') ?? 200) || 200);
    const before = c.req.query('before') ? Number(c.req.query('before')) : undefined;
    const rows = await ctx.journal.query({ operationId, types: type ? [type] : undefined, beforeSeq: before, limit, order: 'desc' });
    return c.json(rows);
  });

  let gatesRunning: Promise<unknown> | null = null;
  http.get('/api/gates', (c) => c.json(runtime.store.gatesReport));
  http.post('/api/gates/run', async (c) => {
    if (gatesRunning) throw new ApiError(409, 'BUSY', 'Los gates ya se están ejecutando');
    const quick = c.req.query('full') !== '1';
    const vault = runtime.store.vaultReport?.vaultDir ?? null;
    const p = runGates({ vaultDir: vault, quick });
    gatesRunning = p;
    try {
      const report = await p;
      runtime.store.putGatesReport(report);
      ctx.journal.audit('gates.run', { passed: report.gates.filter((g) => g.status === 'PASS').length, total: report.gates.length }, { actor: actorOf(c) });
      return c.json(report);
    } finally {
      gatesRunning = null;
    }
  });

  http.post('/api/demo/seed', async (c) => {
    const b = await body(c, DemoSeedSchema);
    try {
      return c.json(await seedDemo(runtime, { ...b, actor: actorOf(c) }));
    } catch (err) {
      throw new ApiError(409, 'DEMO_FAILED', (err as Error).message);
    }
  });

  http.get('/sim/cart/:eventRef/:accountId', (c) => c.html(app.sim.renderCartPage(c.req.param('eventRef'), c.req.param('accountId'))));

  // ---------------------------------------------------------------------------
  // Dashboard compilado (SPA)
  // ---------------------------------------------------------------------------

  if (opts.dashboardDist) {
    const root = path.resolve(opts.dashboardDist);
    http.get('*', async (c) => {
      const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
      if (urlPath.startsWith('/api/')) throw new ApiError(404, 'NOT_FOUND', 'Ruta no encontrada');
      const candidate = path.resolve(root, `.${urlPath}`);
      const inside = candidate === root || candidate.startsWith(root + path.sep);
      let file = path.join(root, 'index.html');
      if (inside) {
        const st = await stat(candidate).catch(() => null);
        if (st?.isFile()) file = candidate;
      }
      const data = await readFile(file).catch(() => null);
      if (!data) {
        return c.html(
          '<!doctype html><meta charset="utf-8"><title>Ticket Orchestrator</title><body style="font-family:system-ui;padding:32px"><h1>Dashboard sin compilar</h1><p>Ejecuta <code>npm run build</code> o, para desarrollo, <code>npm run dev:dashboard</code> y abre <a href="http://localhost:5173">http://localhost:5173</a>.</p></body>',
          200,
        );
      }
      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      return c.body(new Uint8Array(data), 200, { 'content-type': type, 'cache-control': cache });
    });
  }

  return http;
}
