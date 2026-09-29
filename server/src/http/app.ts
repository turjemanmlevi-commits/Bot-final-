/**
 * API HTTP + stream SSE para el dashboard (Hono).
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  AccountInputSchema,
  AccountPatchSchema,
  CartExpirySchema,
  CartMarkSchema,
  CommandRequestSchema,
  DemoSeedSchema,
  EventNoteInputSchema,
  HumanTaskResponseInputSchema,
  KillSwitchInputSchema,
  OperationConfigSchema,
  parseVenueLayout,
  SessionHumanSchema,
  TelegramTestSchema,
  VenueQuickInputSchema,
  type ApiErrorBody,
  type EventNoteInput,
  type EventNoteResult,
  type LabelResolutionResult,
  type OperationConfig,
  type StreamMessage,
  type TelegramTestResult,
  type VenueQuickResult,
} from '@to/shared';
import type { z } from 'zod';
import type { App, CompileResult } from '../app';
import { resolveLabel, venueIndex } from '../domain/venue';
import { runGates } from '../gates/gates';
import { AccountError } from '../runtime/accounts';
import { CartError } from '../runtime/carts';
import { seedDemo } from '../runtime/demo';
import { OperationError } from '../runtime/operations';
import { TaskError } from '../runtime/tasks';
import { log } from '../util/log';
import { normalizeLabel, slugify } from '../util/normalize';
import { createEventNote, createVenueNotes, updateEventNote, VaultWriteError, type EventWriteContext } from '../vault/writer';

export interface HttpOptions {
  dashboardDist: string | null;
  operatorToken: string | null;
}

class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 422 | 500,
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

/** Nombres de campo legibles en los mensajes de error (los formularios los muestran tal cual). */
const FIELD_LABEL: Record<string, string> = {
  label: 'Nombre visible',
  holderRef: 'Titular',
  householdRef: 'Hogar',
  paymentRef: 'Medio de pago',
  telegramChatId: 'Chat de Telegram',
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
    requireVault();
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
  const requireVault = (): string => {
    if (!app.vaultDir) throw new ApiError(409, 'NO_VAULT', 'No hay vault configurado (VAULT_DIR)');
    return app.vaultDir;
  };
  const noteBase = (file: string) => path.posix.basename(file, '.md');
  const eventCtx = (input: EventNoteInput, actor: string): EventWriteContext => {
    const venue = runtime.store.vaultReport?.venues.find((v) => v.venueId === input.venueId);
    if (!venue) throw new ApiError(400, 'BAD_REQUEST', `El recinto ${input.venueId} no está en el vault`);
    const provider = runtime.store.providerAuthorizations.find((p) => p.providerId === input.providerId);
    if (!provider) throw new ApiError(400, 'BAD_REQUEST', `El proveedor ${input.providerId} no está en el vault (30 Proveedores)`);
    return { vaultDir: requireVault(), timeZone: app.timeZone, actor, venueNote: noteBase(venue.sourceFile), providerNote: noteBase(provider.sourceFile) };
  };
  const issuesFor = (result: CompileResult, match: (file: string) => boolean) =>
    [...result.compiled.report.errors, ...result.compiled.report.warnings].filter((i) => match(i.file));
  const eventResult = (file: string, created: boolean, result: CompileResult): EventNoteResult => ({
    file,
    created,
    event: result.compiled.events.find((e) => e.sourceFile === file) ?? null,
    issues: issuesFor(result, (f) => f === file),
    report: result.compiled.report,
  });

  http.post('/api/vault/events', async (c) => {
    const input = await body(c, EventNoteInputSchema);
    const wctx = eventCtx(input, actorOf(c));
    const base = `evt-${slugify(input.name)}`.slice(0, 90);
    let id = base;
    for (let n = 2; runtime.store.events.has(id); n++) id = `${base}-${n}`;
    const file = await createEventNote(input, id, wctx);
    ctx.journal.audit('vault.event_created', { file, eventId: id }, { actor: actorOf(c) });
    return c.json(eventResult(file, true, await app.compileAndApply()), 201);
  });

  http.put('/api/vault/events/:id', async (c) => {
    const input = await body(c, EventNoteInputSchema);
    const event = runtime.store.events.get(c.req.param('id'));
    if (!event) throw new ApiError(404, 'NOT_FOUND', 'El evento no existe (¿se ha borrado la nota?)');
    const file = await updateEventNote(event.sourceFile, event.id, input, eventCtx(input, actorOf(c)));
    ctx.journal.audit('vault.event_updated', { file, eventId: event.id }, { actor: actorOf(c) });
    return c.json(eventResult(file, false, await app.compileAndApply()));
  });

  http.post('/api/vault/venues', async (c) => {
    const input = await body(c, VenueQuickInputSchema);
    const vaultDir = requireVault();
    const layout = parseVenueLayout(input.layout);
    if (layout.errors.length > 0) throw new ApiError(400, 'BAD_LAYOUT', layout.errors.join(' · '));
    const venues = runtime.store.vaultReport?.venues ?? [];
    if (venues.some((v) => normalizeLabel(v.name) === normalizeLabel(input.name))) {
      throw new ApiError(409, 'VAULT_CONFLICT', `Ya existe un recinto llamado «${input.name}»`);
    }
    const base = slugify(input.name) || 'recinto';
    let venueId = base;
    for (let n = 2; venues.some((v) => v.venueId === venueId); n++) venueId = `${base}-${n}`;
    const { folder, files } = await createVenueNotes(input, layout.zones, venueId, { vaultDir, timeZone: app.timeZone, actor: actorOf(c) });
    ctx.journal.audit('vault.venue_created', { folder, venueId, files }, { actor: actorOf(c) });
    const result = await app.compileAndApply();
    const out: VenueQuickResult = {
      folder,
      files,
      venueId: result.compiled.report.venues.some((v) => v.venueId === venueId) ? venueId : null,
      issues: issuesFor(result, (f) => f.startsWith(`${folder}/`)),
      report: result.compiled.report,
    };
    return c.json(out, 201);
  });

  // Telegram: mensaje de prueba al chat principal (o al indicado).
  http.post('/api/telegram/test', async (c) => {
    const b = await body(c, TelegramTestSchema);
    const n = ctx.notifier;
    const result: TelegramTestResult = n?.sendTest
      ? await n.sendTest(b.chatId ?? null)
      : { ok: false, message: 'Telegram está desactivado: pon TELEGRAM_BOT_TOKEN en el archivo .env y reinicia (ver la guía «Configurar Telegram»).' };
    return c.json(result);
  });

  // ---------------------------------------------------------------------------
  // Cuentas
  // ---------------------------------------------------------------------------

  http.get('/api/accounts', (c) => c.json([...runtime.store.accounts.values()]));
  http.post('/api/accounts', async (c) => c.json(ctx.accounts.create(await body(c, AccountInputSchema), actorOf(c)), 201));
  http.patch('/api/accounts/:id', async (c) => c.json(ctx.accounts.update(c.req.param('id'), await body(c, AccountPatchSchema), actorOf(c))));
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
