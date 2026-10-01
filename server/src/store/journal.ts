/**
 * Journal write-behind (§20, §25). El camino caliente (decidir, reservar,
 * enviar) nunca espera a disco: las escrituras se encolan y se confirman en
 * lotes cada pocos ms. Si la persistencia falla, el journal se marca como no
 * sano y el runtime pausa la automatización (sin auditoría no se actúa).
 */

import type { AuditEvent, Id } from '@to/shared';
import type { Clock, TimerHandle } from '../util/clock';
import type { IdGen } from '../util/ids';
import { log } from '../util/log';
import { LatencyRecorder } from '../util/stats';
import { iso } from '../util/time';
import type { AuditQuery, DriverName, EntityRow, JournalDriver } from './drivers';

export interface JournalStatus {
  healthy: boolean;
  pending: number;
  lagMs: number;
  lastCommitAt: string | null;
  driver: DriverName;
  lastError: string | null;
}

export interface JournalOptions {
  flushIntervalMs?: number;
  maxBatch?: number;
  recentAudit?: number;
}

export class Journal {
  private readonly pendingEntities = new Map<string, EntityRow>();
  private readonly pendingDeletes = new Map<string, { kind: string; id: string }>();
  private pendingAudit: AuditEvent[] = [];
  private oldestPendingAt: number | null = null;
  private seq = 0;
  private flushing: Promise<void> | null = null;
  private timer: TimerHandle | null = null;
  private readonly recent: AuditEvent[] = [];
  private readonly listeners = new Set<(e: AuditEvent) => void>();
  private healthListeners = new Set<(healthy: boolean) => void>();
  readonly commitLatency = new LatencyRecorder(2048);
  healthy = true;
  lastCommitAt: string | null = null;
  lastError: string | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBatch: number;
  private readonly recentLimit: number;

  constructor(
    readonly driver: JournalDriver,
    private readonly clock: Clock,
    private readonly ids: IdGen,
    opts: JournalOptions = {},
  ) {
    this.flushIntervalMs = opts.flushIntervalMs ?? 20;
    this.maxBatch = opts.maxBatch ?? 1000;
    this.recentLimit = opts.recentAudit ?? 5000;
  }

  /** Inicializa el driver y devuelve las entidades guardadas para hidratar el estado. */
  async init(): Promise<EntityRow[]> {
    await this.driver.init();
    this.seq = await this.driver.maxSeq();
    const rows = await this.driver.loadEntities();
    const recent = await this.driver.queryAudit({ order: 'desc', limit: Math.min(this.recentLimit, 2000) });
    this.recent.push(...recent.reverse());
    return rows;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = this.clock.setInterval(() => void this.flush(), this.flushIntervalMs);
  }

  onAudit(fn: (e: AuditEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onHealthChange(fn: (healthy: boolean) => void): () => void {
    this.healthListeners.add(fn);
    return () => this.healthListeners.delete(fn);
  }

  persist(kind: string, id: string, data: unknown): void {
    const key = `${kind}|${id}`;
    this.pendingDeletes.delete(key);
    this.pendingEntities.set(key, { kind, id, data });
    this.markPending();
  }

  remove(kind: string, id: string): void {
    const key = `${kind}|${id}`;
    this.pendingEntities.delete(key);
    this.pendingDeletes.set(key, { kind, id });
    this.markPending();
  }

  audit(type: string, payload: unknown, meta: { operationId?: Id | null; correlationId?: string | null; actor?: string } = {}): AuditEvent {
    const event: AuditEvent = {
      seq: ++this.seq,
      id: this.ids.next('aud'),
      at: iso(this.clock.now()),
      operationId: meta.operationId ?? null,
      correlationId: meta.correlationId ?? null,
      type,
      actor: meta.actor ?? 'system',
      payload,
    };
    this.pendingAudit.push(event);
    this.recent.push(event);
    if (this.recent.length > this.recentLimit) this.recent.splice(0, this.recent.length - this.recentLimit);
    this.markPending();
    for (const fn of this.listeners) fn(event);
    return event;
  }

  private markPending(): void {
    if (this.oldestPendingAt === null) this.oldestPendingAt = this.clock.now();
    if (this.pendingEntities.size + this.pendingAudit.length >= this.maxBatch) void this.flush();
  }

  get pending(): number {
    return this.pendingEntities.size + this.pendingDeletes.size + this.pendingAudit.length;
  }

  status(): JournalStatus {
    return {
      healthy: this.healthy,
      pending: this.pending,
      lagMs: this.oldestPendingAt === null ? 0 : this.clock.now() - this.oldestPendingAt,
      lastCommitAt: this.lastCommitAt,
      driver: this.driver.name,
      lastError: this.lastError,
    };
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.pending === 0) return Promise.resolve();
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const entities = [...this.pendingEntities.values()];
    const deletes = [...this.pendingDeletes.values()];
    const audit = this.pendingAudit;
    this.pendingEntities.clear();
    this.pendingDeletes.clear();
    this.pendingAudit = [];
    const oldest = this.oldestPendingAt;
    this.oldestPendingAt = null;
    const started = performance.now();
    try {
      await this.driver.commit({ entities, deletes, audit });
      this.commitLatency.record(performance.now() - started);
      this.lastCommitAt = iso(this.clock.now());
      if (!this.healthy) {
        this.healthy = true;
        this.lastError = null;
        log.info('Journal recuperado');
        for (const fn of this.healthListeners) fn(true);
      }
    } catch (err) {
      // Reencola lo que no se pudo guardar sin pisar escrituras más nuevas.
      for (const e of entities) {
        const key = `${e.kind}|${e.id}`;
        if (!this.pendingEntities.has(key) && !this.pendingDeletes.has(key)) this.pendingEntities.set(key, e);
      }
      for (const d of deletes) {
        const key = `${d.kind}|${d.id}`;
        if (!this.pendingEntities.has(key)) this.pendingDeletes.set(key, d);
      }
      this.pendingAudit = [...audit, ...this.pendingAudit];
      this.oldestPendingAt = oldest ?? this.clock.now();
      this.lastError = (err as Error).message;
      if (this.healthy) {
        this.healthy = false;
        log.error('Journal degradado', { error: this.lastError });
        for (const fn of this.healthListeners) fn(false);
      }
    }
  }

  recentAudit(filter: { operationId?: Id | undefined; types?: string[] | undefined; limit?: number | undefined; beforeSeq?: number | undefined } = {}): AuditEvent[] {
    const out: AuditEvent[] = [];
    for (let i = this.recent.length - 1; i >= 0 && out.length < (filter.limit ?? 200); i--) {
      const e = this.recent[i] as AuditEvent;
      if (filter.operationId !== undefined && e.operationId !== filter.operationId) continue;
      if (filter.types !== undefined && !filter.types.includes(e.type)) continue;
      if (filter.beforeSeq !== undefined && e.seq >= filter.beforeSeq) continue;
      out.push(e);
    }
    return out;
  }

  /** Consulta histórica: primero vacía la cola para ver todo lo escrito. */
  async query(q: AuditQuery): Promise<AuditEvent[]> {
    await this.flush();
    return this.driver.queryAudit(q);
  }

  async close(): Promise<void> {
    if (this.timer !== null) this.clock.clearInterval(this.timer);
    this.timer = null;
    await this.flush();
    if (this.pending > 0) await this.flush();
    await this.driver.close();
  }
}
