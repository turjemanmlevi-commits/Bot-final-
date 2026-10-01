/**
 * Ensambla todos los servicios del runtime y el scheduler.
 */

import {
  QUIET_AUDIT_TYPES,
  type BootstrapState,
  type Id,
  type ReplayReport,
  type VenueArtifactSummary,
} from '@to/shared';
import type { ProviderRegistry } from '../providers/registry';
import { scenarioInfos } from '../providers/scenarios';
import type { SimulatedProvider } from '../providers/simulated';
import type { EntityRow } from '../store/drivers';
import type { Journal } from '../store/journal';
import type { Clock, TimerHandle } from '../util/clock';
import type { IdGen } from '../util/ids';
import { log } from '../util/log';
import type { CompiledVault } from '../vault/compiler';
import { AccountService } from './accounts';
import { AlertService } from './alerts';
import { CartService } from './carts';
import { ClaimService } from './claims';
import { Ctx, type Notifier, type RuntimeConfig } from './context';
import { ProviderGateway } from './gateway';
import { Hub } from './hub';
import { MetricsService } from './metrics';
import { OperationService } from './operations';
import { replayOperation } from './replay';
import { RunnerManager } from './runners';
import { SafetyService } from './safety';
import { Store } from './store';
import { HumanTaskService } from './tasks';

export interface RuntimeDeps {
  clock: Clock;
  ids: IdGen;
  journal: Journal;
  registry: ProviderRegistry;
  sim: SimulatedProvider | null;
  cfg: RuntimeConfig;
  notifier?: Notifier | null;
}

export class Runtime {
  readonly ctx: Ctx;
  readonly store: Store;
  readonly hub: Hub;
  private timer: TimerHandle | null = null;
  private lastSystemPublish = 0;

  constructor(deps: RuntimeDeps) {
    this.hub = new Hub(deps.clock);
    this.store = new Store(deps.journal, this.hub);
    const ctx = new Ctx(deps.clock, deps.ids, deps.journal, deps.registry, deps.sim, this.store, this.hub, deps.cfg);
    ctx.alerts = new AlertService(ctx);
    ctx.safety = new SafetyService(ctx);
    ctx.metrics = new MetricsService(ctx);
    ctx.gateway = new ProviderGateway(ctx);
    ctx.accounts = new AccountService(ctx);
    ctx.ops = new OperationService(ctx);
    ctx.claims = new ClaimService(ctx);
    ctx.carts = new CartService(ctx);
    ctx.tasks = new HumanTaskService(ctx);
    ctx.runners = new RunnerManager(ctx);
    ctx.notifier = deps.notifier ?? null;
    this.ctx = ctx;

    deps.journal.onAudit((e) => {
      if (!QUIET_AUDIT_TYPES.includes(e.type)) this.hub.publish({ type: 'audit', data: e });
    });
    deps.journal.onHealthChange((healthy) => this.onJournalHealth(healthy));
  }

  hydrate(rows: EntityRow[]): void {
    this.store.hydrate(rows);
  }

  start(): void {
    this.ctx.journal.start();
    this.ctx.ops.recoverAfterRestart();
    this.timer = this.ctx.clock.setInterval(() => this.tick(), this.ctx.cfg.schedulerTickMs);
  }

  tick(): void {
    const { ctx } = this;
    try {
      ctx.ops.scheduleTick();
      ctx.accounts.maintenanceTick();
      ctx.carts.expiryTick();
      ctx.tasks.expireTick();
      for (const r of ctx.store.operations.values()) if (r.state === 'RUNNING') ctx.metrics.publish(r.id);
      const now = ctx.now();
      if (now - this.lastSystemPublish >= 1000 && this.hub.subscribers > 0) {
        this.lastSystemPublish = now;
        this.hub.publish({ type: 'system', data: ctx.ops.systemStatus() });
      }
    } catch (err) {
      log.error('Error en el scheduler', { error: (err as Error).message });
    }
  }

  async stop(): Promise<void> {
    if (this.timer !== null) this.ctx.clock.clearInterval(this.timer);
    this.timer = null;
    this.ctx.runners.stopAll();
    this.ctx.claims.cancelTimers();
    await this.ctx.journal.close();
  }

  private onJournalHealth(healthy: boolean): void {
    const { ctx } = this;
    if (!healthy) {
      ctx.alerts.raise({
        kind: 'JOURNAL_DEGRADED',
        severity: 'CRITICAL',
        title: 'El journal no está guardando',
        message: `Sin auditoría no se automatiza: las operaciones en marcha se pausan. Error: ${ctx.journal.lastError ?? 'desconocido'}`,
        actions: ['PAUSE'],
        dedupeKey: 'journal',
      });
      for (const r of ctx.store.operations.values()) if (r.state === 'RUNNING') ctx.ops.pauseFor(r.id, 'JOURNAL_DEGRADED');
    } else {
      ctx.alerts.resolveKey('journal');
    }
    this.hub.publish({ type: 'system', data: ctx.ops.systemStatus() });
  }

  // -------------------------------------------------------------------------
  // Vault
  // -------------------------------------------------------------------------

  /**
   * Aplica una compilación del vault. Si trae errores y ya hay un catálogo
   * cargado, se mantiene el último válido (mientras escribes en Obsidian una
   * nota puede quedar a medias).
   */
  applyVault(compiled: CompiledVault, opts: { force?: boolean } = {}): { applied: boolean; reason: string | null } {
    const { store, hub, ctx } = this;
    store.vaultReport = compiled.report;
    hub.publish({ type: 'vault', data: compiled.report });
    if (!compiled.report.ok && store.events.size > 0 && !opts.force) {
      ctx.journal.audit('vault.rejected', { errors: compiled.report.errors.length });
      return { applied: false, reason: 'El vault tiene errores: se mantiene la última compilación válida.' };
    }
    const added = ctx.registry.syncFromVault(compiled.providers);
    if (added.length > 0) ctx.journal.audit('provider.registered', { providerIds: added, mode: 'MANUAL_ASSIST' });
    ctx.registry.setAuthorizations(compiled.providers);
    store.providerAuthorizations = compiled.providers;
    hub.publish({ type: 'providers', data: compiled.providers });

    const activeKeys = new Set<string>();
    for (const a of compiled.artifacts) {
      const key = `${a.venueId}|${a.eventId ?? ''}`;
      activeKeys.add(key);
      store.artifacts.set(a.hash, a);
      store.activeArtifacts.set(key, a.hash);
    }
    for (const key of [...store.activeArtifacts.keys()]) if (!activeKeys.has(key)) store.activeArtifacts.delete(key);
    const keep = new Set([...store.activeArtifacts.values()]);
    for (const r of store.operations.values()) if (r.armSnapshot) keep.add(r.armSnapshot.venueArtifactHash);
    for (const hash of [...store.artifacts.keys()]) if (!keep.has(hash)) store.artifacts.delete(hash);

    const newIds = new Set(compiled.events.map((e) => e.id));
    for (const id of [...store.events.keys()]) {
      if (!newIds.has(id)) {
        store.events.delete(id);
        hub.remove('event', id);
      }
    }
    for (const e of compiled.events) {
      store.events.set(e.id, e);
      hub.upsert('event', e.id, e);
    }
    const summaries = this.venueSummaries();
    const summaryHashes = new Set(summaries.map((s) => s.hash));
    for (const s of summaries) hub.upsert('venue', s.hash, s);
    for (const hash of this.publishedVenues) if (!summaryHashes.has(hash)) hub.remove('venue', hash);
    this.publishedVenues = summaryHashes;
    ctx.journal.audit('vault.compiled', {
      ok: compiled.report.ok,
      venues: compiled.report.venues.map((v) => ({ venueId: v.venueId, hash: v.hash })),
      events: compiled.events.length,
      errors: compiled.report.errors.length,
      warnings: compiled.report.warnings.length,
    });
    for (const r of store.operations.values()) ctx.ops.publishSummary(r.id);
    hub.publish({ type: 'system', data: ctx.ops.systemStatus() });
    return { applied: true, reason: null };
  }

  private publishedVenues = new Set<string>();

  venueSummaries(): VenueArtifactSummary[] {
    const active = new Set(this.store.activeArtifacts.values());
    return [...this.store.artifacts.values()]
      .map((a) => ({
        hash: a.hash,
        venueId: a.venueId,
        eventId: a.eventId,
        name: a.name,
        compiledAt: a.compiledAt,
        sections: a.sections.length,
        zones: a.zones.length,
        confidence: a.provenance.confidence,
        verifiedAt: a.provenance.verifiedAt,
        warnings: a.warnings,
        active: active.has(a.hash),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || (a.eventId ?? '').localeCompare(b.eventId ?? '') || Number(b.active) - Number(a.active));
  }

  // -------------------------------------------------------------------------
  // Vistas
  // -------------------------------------------------------------------------

  bootstrap(): BootstrapState {
    const { store, ctx } = this;
    const alerts = [...store.alerts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      system: ctx.ops.systemStatus(),
      operations: ctx.ops.summaries(),
      accounts: [...store.accounts.values()].sort((a, b) => a.label.localeCompare(b.label)),
      events: [...store.events.values()],
      venues: this.venueSummaries(),
      alerts: [...alerts.filter((a) => a.state !== 'RESOLVED'), ...alerts.filter((a) => a.state === 'RESOLVED').slice(0, 100)],
      carts: [...store.carts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      claims: [...store.claims.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 300),
      humanTasks: [...store.humanTasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300),
      allocations: [...store.allocations.values()],
      vault: store.vaultReport,
      scenarios: scenarioInfos(),
      providerAuthorizations: store.providerAuthorizations,
      watches: [...store.watches.values()],
    };
  }

  replay(operationId: Id): Promise<ReplayReport> {
    this.ctx.ops.get(operationId);
    return replayOperation(this.ctx.journal, operationId, this.ctx.now());
  }
}
