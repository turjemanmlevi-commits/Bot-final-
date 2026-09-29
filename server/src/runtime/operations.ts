/**
 * Operaciones: máquina de estados (§4), validación (§5), ARM con snapshot
 * reproducible (§1, §5, §25), readiness (§6), enmiendas monotónicas y resumen.
 */

import {
  COMMAND_LABEL,
  OPERATION_STATE_LABEL,
  commandAllowed,
  transitionAllowed,
  type AlertKind,
  type ArmSnapshot,
  type CommandRequest,
  type CommandResult,
  type EndReason,
  type Id,
  type OperationConfig,
  type OperationDetail,
  type OperationState,
  type OperationSummary,
  type ReadinessPhase,
  type ReadinessReport,
  type SystemStatus,
  type ValidationReport,
} from '@to/shared';
import { formatMoney } from '@to/shared';
import { initAllocation } from '../domain/allocation';
import { groupKeyFor } from '../domain/limits';
import { POLICY_VERSION } from '../domain/policy';
import { evaluateReadiness } from '../domain/readiness';
import { validateConfig } from '../domain/validation';
import { scenarioInfos } from '../providers/scenarios';
import { COMPILER_VERSION } from '../vault/compiler';
import { hashOf } from '../util/hash';
import { seedFrom } from '../util/rng';
import { iso } from '../util/time';
import type { TimerHandle } from '../util/clock';
import type { Ctx } from './context';
import type { OperationRecord } from './store';

export const RULES_VERSION = 'rules-4.0.0';

export class OperationError extends Error {
  constructor(
    message: string,
    readonly code = 'OPERATION_ERROR',
  ) {
    super(message);
  }
}

/** Alertas de preparación/ejecución que dejan de tener sentido cuando la automatización termina. */
const STALE_AFTER_AUTOMATION = new Set<AlertKind>([
  'SESSION_CHALLENGE',
  'SESSION_EXPIRED',
  'SESSION_NOT_READY',
  'QUEUE_PROBLEM',
  'READINESS_FAILED',
  'READINESS_WARN',
  'NO_PROGRESS',
  'RATE_LIMITED',
  'HUMAN_TASK',
]);

const READINESS_PHASES: Array<{ phase: ReadinessPhase; beforeMs: number }> = [
  { phase: 'T-12h', beforeMs: 12 * 3600_000 },
  { phase: 'T-1h', beforeMs: 3600_000 },
  { phase: 'T-5m', beforeMs: 5 * 60_000 },
];

export class OperationService {
  constructor(private readonly ctx: Ctx) {}

  get(id: Id): OperationRecord {
    const r = this.ctx.store.operations.get(id);
    if (!r) throw new OperationError(`La operación ${id} no existe`, 'NOT_FOUND');
    return r;
  }

  // -------------------------------------------------------------------------
  // Resumen y publicación
  // -------------------------------------------------------------------------

  summary(r: OperationRecord): OperationSummary {
    const alloc = this.ctx.store.allocations.get(r.id);
    const event = this.ctx.store.events.get(r.config.eventId);
    return {
      id: r.id,
      name: r.config.name,
      eventId: r.config.eventId,
      eventName: event?.name ?? r.eventName,
      providerId: r.config.providerId,
      state: r.state,
      configVersion: r.configVersion,
      armedSnapshotHash: r.armSnapshot?.hash ?? null,
      t0: r.config.t0,
      runWindowMinutes: r.config.runWindowMinutes,
      requestedQty: alloc?.requestedQty ?? r.config.requestedQty,
      cartedQty: alloc?.cartedQty ?? 0,
      currency: r.config.currency,
      accountIds: r.config.accountIds,
      openAlerts: this.ctx.alerts.openCount(r.id),
      endReason: r.endReason,
      pausedReason: r.pausedReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      version: r.version,
    };
  }

  summaries(): OperationSummary[] {
    return [...this.ctx.store.operations.values()].map((r) => this.summary(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  publishSummary(id: Id): void {
    const r = this.ctx.store.operations.get(id);
    if (r) this.ctx.hub.upsertThrottled('operation', id, this.summary(r));
  }

  private save(r: OperationRecord): OperationRecord {
    const next: OperationRecord = { ...r, updatedAt: iso(this.ctx.now()), version: r.version + 1 };
    this.ctx.store.putOperationRecord(next);
    this.ctx.hub.upsert('operation', next.id, this.summary(next));
    return next;
  }

  // -------------------------------------------------------------------------
  // Alta y edición
  // -------------------------------------------------------------------------

  create(config: OperationConfig, actor: string): OperationRecord {
    const now = iso(this.ctx.now());
    const event = this.ctx.store.events.get(config.eventId);
    const r: OperationRecord = {
      id: this.ctx.ids.next('op'),
      state: 'DRAFT',
      config,
      configVersion: 1,
      versions: [{ version: 1, at: now, actor, note: 'Creada' }],
      armSnapshot: null,
      validation: null,
      readiness: [],
      readinessPhasesDone: [],
      amendments: [],
      endReason: null,
      pausedReason: null,
      eventName: event?.name ?? config.eventId,
      providerEventRef: null,
      startedAt: null,
      securedAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 0,
    };
    const saved = this.save(r);
    this.ctx.journal.audit('operation.created', { name: config.name, eventId: config.eventId, providerId: config.providerId }, { operationId: r.id, actor });
    return saved;
  }

  updateConfig(id: Id, config: OperationConfig, actor: string, note?: string): OperationRecord {
    const r = this.get(id);
    if (r.state !== 'DRAFT' && r.state !== 'VALIDATED') {
      throw new OperationError(`No se puede editar en estado ${OPERATION_STATE_LABEL[r.state]}: desarma primero`, 'LOCKED');
    }
    const version = r.configVersion + 1;
    const next = this.save({
      ...r,
      state: 'DRAFT',
      config,
      configVersion: version,
      versions: [...r.versions, { version, at: iso(this.ctx.now()), actor, note: note ?? null }],
      validation: null,
      eventName: this.ctx.store.events.get(config.eventId)?.name ?? r.eventName,
    });
    this.ctx.journal.audit('operation.config_updated', { version, from: r.state }, { operationId: id, actor });
    return next;
  }

  // -------------------------------------------------------------------------
  // Transiciones
  // -------------------------------------------------------------------------

  private transition(
    r: OperationRecord,
    to: OperationState,
    meta: { actor: string; reason?: string | null; endReason?: EndReason | null; pausedReason?: string | null } = { actor: 'system' },
  ): OperationRecord {
    if (r.state === to) return r;
    if (!transitionAllowed(r.state, to)) throw new OperationError(`Transición no permitida: ${r.state} → ${to}`, 'BAD_TRANSITION');
    const now = iso(this.ctx.now());
    const next = this.save({
      ...r,
      state: to,
      endReason: meta.endReason ?? r.endReason,
      pausedReason: to === 'PAUSED' || to === 'RECOVERING' ? (meta.pausedReason ?? meta.reason ?? null) : null,
      startedAt: to === 'RUNNING' ? (r.startedAt ?? now) : r.startedAt,
      securedAt: to === 'CART_SECURED' ? now : r.securedAt,
      endedAt: to === 'ENDED' || to === 'CANCELLED' || to === 'CLOSED' ? (r.endedAt ?? now) : r.endedAt,
    });
    this.ctx.journal.audit('operation.state_changed', { from: r.state, to, reason: meta.reason ?? null, endReason: meta.endReason ?? null }, { operationId: r.id, actor: meta.actor });
    this.afterTransition(r.state, next);
    return this.ctx.store.operations.get(next.id) ?? next;
  }

  private afterTransition(from: OperationState, r: OperationRecord): void {
    const { ctx } = this;
    if (['CART_SECURED', 'ENDED', 'CANCELLED', 'CLOSED'].includes(r.state)) {
      // La automatización ha terminado: los avisos de preparación ya no aplican.
      const accounts = new Set(r.config.accountIds);
      ctx.alerts.resolveWhere(
        (a) =>
          STALE_AFTER_AUTOMATION.has(a.kind) &&
          (a.operationId === r.id || (a.operationId === null && a.accountId !== null && accounts.has(a.accountId))),
      );
    }
    switch (r.state) {
      case 'ARMED':
        // Despertador exacto para congelar y para T0 (el tick de 250 ms queda de respaldo).
        this.wakeAt(r.id, this.effectiveT0(r) - r.config.freezeLeadSeconds * 1000);
        this.wakeAt(r.id, this.effectiveT0(r));
        break;
      case 'FROZEN':
        this.wakeAt(r.id, this.effectiveT0(r));
        break;
      case 'RUNNING':
        ctx.metrics.start(r.id);
        ctx.runners.start(r.id);
        if ((from === 'ARMED' || from === 'FROZEN') && ctx.runners.kind(r.id) === 'MANUAL') {
          const event = ctx.store.events.get(r.config.eventId);
          const provider = ctx.registry.descriptor(r.config.providerId)?.name ?? r.config.providerId;
          const notReady = r.config.accountIds.filter((id) => ctx.store.accounts.get(id)?.session.state !== 'READY').length;
          const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          ctx.notifier?.announce?.(
            `🚦 <b>¡Abre la venta! ${esc(r.config.name)}</b>\nEntrad ya en la web oficial de ${esc(provider)} (cola incluida). Las tareas con la zona, la cantidad y el precio máximo llegan ahora.` +
              (notReady > 0 ? `\n⚠️ ${notReady} cuenta${notReady === 1 ? '' : 's'} sin «Sesión lista»: inicia sesión y púlsalo para recibir tu tarea.` : ''),
            r.config.accountIds,
            event?.url ?? ctx.registry.authorization(r.config.providerId)?.url ?? null,
          );
        }
        break;
      case 'PAUSED':
      case 'RECOVERING':
        ctx.runners.stop(r.id);
        break;
      case 'CART_SECURED': {
        ctx.runners.stop(r.id);
        ctx.metrics.stop(r.id);
        ctx.tasks.cancelOpenFor(r.id, 'Operación asegurada');
        const alloc = ctx.store.allocations.get(r.id);
        ctx.alerts.raise({
          kind: 'CART_SECURED',
          severity: 'CRITICAL',
          title: `${r.config.name}: ¡${alloc?.cartedQty ?? 0} entradas aseguradas en carrito!`,
          message: `Paga ahora cada carrito (${formatMoney(alloc?.budget.committed ?? 0, r.config.currency)} en total). El sistema no paga: hazlo tú antes de que caduquen.`,
          actions: ['OPEN_CART'],
          operationId: r.id,
          dedupeKey: `op:${r.id}:secured`,
        });
        break;
      }
      case 'ENDED': {
        ctx.runners.stop(r.id);
        ctx.metrics.stop(r.id);
        ctx.tasks.cancelOpenFor(r.id, 'Operación finalizada');
        const alloc = ctx.store.allocations.get(r.id);
        const reasonText: Record<EndReason, string> = {
          RUN_WINDOW_ELAPSED: 'se agotó la ventana de ejecución',
          OPERATOR_STOP: 'la paró una persona',
          READINESS_FAILED: 'el readiness falló en T0',
          NOT_STARTED_IN_WINDOW: 'no llegó a arrancar dentro de la ventana',
        };
        ctx.alerts.raise({
          kind: 'OPERATION_ENDED',
          severity: (alloc?.cartedQty ?? 0) > 0 ? 'WARNING' : 'INFO',
          title: `${r.config.name}: finalizada (${alloc?.cartedQty ?? 0}/${alloc?.requestedQty ?? r.config.requestedQty})`,
          message: `Terminó porque ${r.endReason ? reasonText[r.endReason] : 'sí'}.${(alloc?.cartedQty ?? 0) > 0 ? ' Paga los carritos que quieras conservar.' : ''}`,
          actions: (alloc?.cartedQty ?? 0) > 0 ? ['OPEN_CART'] : [],
          operationId: r.id,
          dedupeKey: `op:${r.id}:ended`,
        });
        break;
      }
      case 'CANCELLED':
        ctx.runners.stop(r.id);
        ctx.metrics.stop(r.id);
        ctx.tasks.cancelOpenFor(r.id, 'Operación cancelada');
        ctx.accounts.release(r.id);
        break;
      case 'CLOSED':
        ctx.accounts.release(r.id);
        ctx.alerts.resolveWhere((a) => a.operationId === r.id && a.kind !== 'CART_EXPIRING' && a.kind !== 'CART_REVIEW');
        break;
      case 'VALIDATED':
        if (from === 'ARMED' || from === 'FROZEN') ctx.accounts.release(r.id);
        break;
      default:
        break;
    }
  }

  pauseFor(id: Id, reason: string): void {
    const r = this.ctx.store.operations.get(id);
    if (!r || (r.state !== 'RUNNING' && r.state !== 'RECOVERING')) return;
    this.transition(r, 'PAUSED', { actor: 'system', reason, pausedReason: reason });
  }

  /** Comprueba si la operación ya tiene todo en carrito. */
  onProgress(id: Id): void {
    const r = this.ctx.store.operations.get(id);
    const alloc = this.ctx.store.allocations.get(id);
    if (!r || !alloc) return;
    this.ctx.alerts.resolveKey(`noprogress:${id}`);
    if (alloc.cartedQty >= alloc.requestedQty && ['RUNNING', 'PAUSED', 'RECOVERING'].includes(r.state)) {
      this.transition(r, 'CART_SECURED', { actor: 'system', reason: 'Cantidad completa en carrito' });
    }
  }

  /**
   * Un carrito de una operación ya «asegurada» se ha perdido (liberado o
   * caducado): si la ventana sigue abierta vuelve a EN MARCHA y el runner
   * reparte de nuevo lo que falta.
   */
  reopenAfterLoss(id: Id, cart: { accountId: Id; qty: number }): void {
    const r = this.ctx.store.operations.get(id);
    if (!r || r.state !== 'CART_SECURED') return;
    this.ctx.alerts.resolveKey(`op:${id}:secured`);
    if (this.ctx.now() >= this.windowEnd(r)) return;
    const label = this.ctx.store.accounts.get(cart.accountId)?.label ?? cart.accountId;
    this.transition(r, 'RUNNING', { actor: 'system', reason: `Carrito perdido (${label}, ${cart.qty}): se vuelve a repartir` });
  }

  // -------------------------------------------------------------------------
  // Validación, snapshot y readiness
  // -------------------------------------------------------------------------

  validate(r: OperationRecord, forArm: boolean): ValidationReport {
    const { store } = this.ctx;
    const event = store.events.get(r.config.eventId) ?? null;
    const artifact = event ? store.artifactFor(event.venueId, event.id) : null;
    return validateConfig(r.config, {
      now: this.ctx.now(),
      operationId: r.id,
      configVersion: r.configVersion,
      event,
      artifact,
      provider: this.ctx.registry.descriptor(r.config.providerId),
      accounts: store.accounts,
      scenarioIds: scenarioInfos().map((s) => s.id),
      leasedBy: (accountId) => {
        const leased = store.accounts.get(accountId)?.leasedBy ?? null;
        return leased && leased !== r.id ? leased : null;
      },
      forArm,
    });
  }

  private effectiveT0(r: OperationRecord): number {
    const skew = this.ctx.store.clockSkew.get(r.config.providerId) ?? 0;
    // Si el proveedor va adelantado, su T0 llega antes en nuestro reloj.
    return Date.parse(r.config.t0) - skew;
  }

  private windowEnd(r: OperationRecord): number {
    return this.effectiveT0(r) + r.config.runWindowMinutes * 60_000;
  }

  runReadiness(r: OperationRecord, phase: ReadinessPhase): ReadinessReport {
    const ctx = this.ctx;
    const store = ctx.store;
    const event = store.events.get(r.config.eventId) ?? null;
    const artifact = r.armSnapshot ? (store.artifacts.get(r.armSnapshot.venueArtifactHash) ?? null) : event ? store.artifactFor(event.venueId, event.id) : null;
    const provider = ctx.registry.descriptor(r.config.providerId);
    const report = evaluateReadiness({
      operationId: r.id,
      phase,
      now: ctx.now(),
      t0Ms: Date.parse(r.config.t0),
      limits: r.armSnapshot?.eventLimits ?? event?.limits ?? null,
      artifact: artifact ? { hash: artifact.hash, name: artifact.name, confidence: artifact.provenance.confidence } : null,
      accounts: r.config.accountIds.map((id) => store.accounts.get(id)).filter((a) => a !== undefined),
      provider,
      circuits: ctx.safety.openCircuitsFor(r.config.providerId),
      killSwitchesEngaged: ctx.safety.engagedList(r.config.providerId, r.id, r.config.accountIds),
      journal: { healthy: ctx.journal.healthy, driver: ctx.journal.driver.name },
      telegram: { enabled: ctx.notifier?.enabled ?? false, connected: ctx.notifier?.connected ?? false },
      clockSkewMs: store.clockSkew.get(r.config.providerId) ?? null,
    });
    const current = this.get(r.id);
    this.save({
      ...current,
      readiness: [...current.readiness.filter((x) => x.phase !== phase), report],
      readinessPhasesDone: current.readinessPhasesDone.includes(phase) ? current.readinessPhasesDone : [...current.readinessPhasesDone, phase],
    });
    ctx.hub.upsert('readiness', `${r.id}:${phase}`, report);
    ctx.journal.audit('readiness.evaluated', { phase, overall: report.overall, failed: report.checks.filter((c) => c.status === 'FAIL').map((c) => c.id) }, { operationId: r.id });
    if (report.overall === 'FAIL') {
      ctx.alerts.raise({
        kind: 'READINESS_FAILED',
        severity: 'CRITICAL',
        title: `${r.config.name}: readiness ${phase} FALLA`,
        message: report.checks.filter((c) => c.status === 'FAIL').map((c) => `${c.label}: ${c.detail}`).join(' · '),
        actions: ['REVALIDATE', 'CANCEL'],
        operationId: r.id,
        dedupeKey: `readiness:${r.id}`,
      });
    } else {
      ctx.alerts.resolveKey(`readiness:${r.id}`);
      if (report.overall === 'WARN') {
        ctx.alerts.raise({
          kind: 'READINESS_WARN',
          severity: 'WARNING',
          title: `${r.config.name}: readiness ${phase} con avisos`,
          message: report.checks.filter((c) => c.status === 'WARN').map((c) => `${c.label}: ${c.detail}`).join(' · '),
          actions: report.checks.some((c) => c.action === 'OPEN_SESSION') ? ['OPEN_SESSION'] : [],
          operationId: r.id,
          dedupeKey: `readiness-warn:${r.id}`,
        });
      } else {
        ctx.alerts.resolveKey(`readiness-warn:${r.id}`);
      }
    }
    return report;
  }

  private buildArmSnapshot(r: OperationRecord, validation: ValidationReport, actor: string): { snapshot: ArmSnapshot; eventRef: string } {
    const { store, registry } = this.ctx;
    const event = store.events.get(r.config.eventId);
    const artifact = event ? store.artifactFor(event.venueId, event.id) : null;
    const descriptor = registry.descriptor(r.config.providerId);
    if (!event || !artifact || !descriptor || !validation.compiledPolicy) throw new OperationError('Faltan datos para armar', 'ARM_FAILED');
    const body: Omit<ArmSnapshot, 'hash'> = {
      operationId: r.id,
      configVersion: r.configVersion,
      config: r.config,
      compiledPolicy: validation.compiledPolicy,
      venueArtifactHash: artifact.hash,
      eventLimits: event.limits,
      adapter: { providerId: descriptor.id, adapterVersion: descriptor.adapterVersion, capabilities: descriptor.capabilities },
      versions: { rules: RULES_VERSION, selectionPolicy: POLICY_VERSION, venue: COMPILER_VERSION, adapter: descriptor.adapterVersion },
      armedAt: iso(this.ctx.now()),
      armedBy: actor,
    };
    store.persistArtifact(artifact);
    return { snapshot: { hash: hashOf(body), ...body }, eventRef: event.providerEventRef };
  }

  // -------------------------------------------------------------------------
  // Comandos
  // -------------------------------------------------------------------------

  async command(id: Id, req: CommandRequest, actor: string): Promise<CommandResult> {
    let r = this.get(id);
    const fail = (message: string, extra: Partial<CommandResult> = {}): CommandResult => ({ ok: false, message, operation: this.summary(this.get(id)), ...extra });
    if (!commandAllowed(req.command, r.state)) {
      return fail(`"${COMMAND_LABEL[req.command]}" no está disponible en estado ${OPERATION_STATE_LABEL[r.state]}.`);
    }
    this.ctx.journal.audit('operation.command', { command: req.command, value: req.value ?? null, reason: req.reason ?? null }, { operationId: id, actor });
    const ok = (message: string, extra: Partial<CommandResult> = {}): CommandResult => ({ ok: true, message, operation: this.summary(this.get(id)), ...extra });

    switch (req.command) {
      case 'validate': {
        const validation = this.validate(r, false);
        r = this.save({ ...this.get(id), validation });
        this.ctx.hub.upsert('validation', id, validation);
        if (validation.ok) {
          this.transition(r, 'VALIDATED', { actor });
          return ok('Configuración válida.', { validation });
        }
        if (r.state === 'VALIDATED') this.transition(r, 'DRAFT', { actor, reason: 'Revalidación con errores' });
        return fail('La configuración tiene errores.', { validation });
      }

      case 'arm': {
        const validation = this.validate(r, true);
        r = this.save({ ...this.get(id), validation });
        this.ctx.hub.upsert('validation', id, validation);
        if (!validation.ok) return fail('No se puede armar: hay errores de validación.', { validation });
        const ks = this.ctx.safety.engagedFor({ providerId: r.config.providerId, operationId: r.id });
        if (ks) return fail(`No se puede armar con el kill switch ${ks.key} activo.`);
        if (!this.ctx.journal.healthy) return fail('No se puede armar: el journal no está persistiendo.');
        const { snapshot, eventRef } = this.buildArmSnapshot(r, validation, actor);
        const event = this.ctx.store.events.get(r.config.eventId);
        if (!event) return fail('El evento ya no está en el vault.');
        const limits = snapshot.eventLimits;
        const accounts = r.config.accountIds.map((aid) => this.ctx.accounts.get(aid));
        const alloc = initAllocation({
          operationId: r.id,
          currency: r.config.currency,
          requestedQty: r.config.requestedQty,
          maxUnitPrice: r.config.maxUnitPrice,
          budget: r.config.budget,
          limits,
          accounts: accounts.map((a) => ({ id: a.id, groupKey: groupKeyFor(a, limits.semantics) ?? `cuenta:${a.id}` })),
        });
        this.ctx.store.putAllocation(alloc);
        this.ctx.journal.audit('allocation.init', { state: alloc, hash: hashOf(alloc) }, { operationId: r.id });
        this.ctx.accounts.lease(r.config.accountIds, r.id);
        const armedArtifact = this.ctx.store.artifacts.get(snapshot.venueArtifactHash);
        if (!armedArtifact) return fail('El artefacto del recinto no está disponible.');
        const adapter = this.ctx.registry.get(r.config.providerId);
        adapter?.prepareEvent?.({
          eventRef,
          artifact: armedArtifact,
          t0Ms: Date.parse(r.config.t0),
          currency: r.config.currency,
          perAccountLimit: limits.perAccount,
          scenarioId: r.config.simulation?.scenarioId ?? null,
          seed: r.config.simulation?.seed ?? seedFrom(r.id),
        });
        r = this.save({ ...this.get(id), armSnapshot: snapshot, providerEventRef: eventRef, readiness: [], readinessPhasesDone: [], amendments: [], endReason: null });
        r = this.transition(r, 'ARMED', { actor, reason: `Snapshot ${snapshot.hash.slice(0, 12)}` });
        this.ctx.journal.audit('operation.armed', { snapshotHash: snapshot.hash, venueArtifactHash: snapshot.venueArtifactHash, policyHash: hashOf(snapshot.compiledPolicy), snapshot }, { operationId: id, actor });
        this.ctx.accounts.warmUp(r.config.accountIds);
        void this.syncClock(r.config.providerId);
        // El readiness se evalúa cuando las sesiones han tenido tiempo de abrirse.
        this.ctx.clock.setTimeout(() => {
          const cur = this.ctx.store.operations.get(id);
          if (cur && (cur.state === 'ARMED' || cur.state === 'FROZEN')) this.runReadiness(cur, 'MANUAL');
        }, 3000);
        return ok(`Armada. Snapshot ${snapshot.hash.slice(0, 12)}. Abriendo sesiones…`, { validation });
      }

      case 'disarm': {
        // Las tareas de inicio de sesión llevaban el plan de esta versión: fuera.
        this.ctx.tasks.cancelOpenFor(id, 'Operación desarmada');
        this.ctx.store.allocations.delete(id);
        this.ctx.journal.remove('allocation', id);
        this.ctx.hub.remove('allocation', id);
        r = this.save({ ...this.get(id), armSnapshot: null });
        this.transition(r, 'VALIDATED', { actor, reason: req.reason ?? 'Desarmada' });
        return ok('Desarmada: las cuentas quedan libres.');
      }

      case 'readiness': {
        const readiness = this.runReadiness(r, 'MANUAL');
        return ok(`Readiness: ${readiness.overall}.`, { readiness });
      }

      case 'start-now': {
        const readiness = this.runReadiness(r, 'MANUAL');
        if (readiness.overall === 'FAIL') return fail('No se puede empezar: el readiness falla.', { readiness });
        this.transition(this.get(id), 'RUNNING', { actor, reason: 'Inicio manual' });
        return ok('En ejecución.', { readiness });
      }

      case 'pause':
        this.transition(r, 'PAUSED', { actor, reason: req.reason ?? 'Pausa manual', pausedReason: req.reason ?? 'Pausa manual' });
        return ok('Pausada.');

      case 'resume': {
        if (this.ctx.now() >= this.windowEnd(r)) return fail('La ventana de ejecución ya terminó.');
        const ks = this.ctx.safety.engagedFor({ providerId: r.config.providerId, operationId: r.id });
        if (ks) return fail(`Kill switch ${ks.key} activo: suéltalo antes de reanudar.`);
        if (!this.ctx.journal.healthy) return fail('El journal no está persistiendo.');
        const manual = this.ctx.safety.openCircuitsFor(r.config.providerId).find((c) => c.requiresManualReset);
        if (manual) return fail(`El circuito ${manual.key} necesita reinicio manual.`);
        this.transition(r, 'RUNNING', { actor, reason: 'Reanudada' });
        return ok('Reanudada.');
      }

      case 'stop':
        this.transition(r, 'ENDED', { actor, reason: req.reason ?? 'Parada manual', endReason: 'OPERATOR_STOP' });
        return ok('Finalizada.');

      case 'cancel':
        this.transition(r, 'CANCELLED', { actor, reason: req.reason ?? 'Cancelada' });
        return ok('Cancelada.');

      case 'reduce-qty': {
        const value = req.value;
        const alloc = this.ctx.store.allocations.get(id);
        if (value === undefined || !alloc) return fail('Indica la nueva cantidad.');
        if (value >= alloc.requestedQty) return fail('Solo se puede reducir la cantidad.');
        const res = this.ctx.claims.applyAllocation(id, { op: 'SET_REQUESTED', qty: value });
        if (!res.ok) return fail(res.error);
        this.amend(id, actor, 'reduce-qty', alloc.requestedQty, value, req.reason);
        this.onProgress(id);
        return ok(`Cantidad reducida a ${value}.`);
      }

      case 'lower-max-price': {
        const value = req.value;
        const alloc = this.ctx.store.allocations.get(id);
        if (value === undefined || !alloc) return fail('Indica el nuevo precio máximo.');
        const res = this.ctx.claims.applyAllocation(id, { op: 'SET_MAX_PRICE', maxUnitPrice: value });
        if (!res.ok) return fail(res.error);
        this.amend(id, actor, 'lower-max-price', alloc.maxUnitPrice, value, req.reason);
        return ok(`Precio máximo bajado a ${formatMoney(value, r.config.currency)}.`);
      }

      case 'close':
        this.transition(r, 'CLOSED', { actor, reason: req.reason ?? 'Cerrada' });
        return ok('Cerrada.');
    }
  }

  private amend(id: Id, actor: string, kind: 'reduce-qty' | 'lower-max-price', from: number, to: number, reason?: string): void {
    const r = this.get(id);
    this.save({ ...r, amendments: [...r.amendments, { at: iso(this.ctx.now()), actor, kind, from, to, reason: reason ?? null }] });
    this.ctx.journal.audit('operation.amended', { kind, from, to }, { operationId: id, actor });
  }

  // -------------------------------------------------------------------------
  // Scheduler (transiciones por tiempo)
  // -------------------------------------------------------------------------

  async syncClock(providerId: string): Promise<void> {
    if (!this.ctx.registry.automated(providerId, 'clock.server_time')) return;
    const before = this.ctx.now();
    const r = await this.ctx.gateway.call({ providerId, capability: 'clock.server_time', stage: 'network' }, (a) => a.serverTime?.());
    if (!r.ok) return;
    const after = this.ctx.now();
    const skew = r.value - (before + after) / 2;
    this.ctx.store.clockSkew.set(providerId, Math.round(skew));
    // Reprograma al momento los despertadores de T0 con el nuevo desfase.
    this.scheduleTick();
  }

  private readonly wakeTimers = new Map<string, TimerHandle>();

  /**
   * Ejecuta el scheduler justo en `atMs` (congelado y T0 al milisegundo, sin
   * esperar al siguiente tick). Un despertador por operación e instante.
   */
  private wakeAt(id: Id, atMs: number): void {
    const key = `${id}@${atMs}`;
    if (this.wakeTimers.has(key)) return;
    // Como mucho una hora: setTimeout no admite esperas de más de ~24,8 días y el
    // scheduler vuelve a programar el despertador al disparar.
    const delay = Math.min(Math.max(0, atMs - this.ctx.now()), 3_600_000);
    const handle = this.ctx.clock.setTimeout(() => {
      this.wakeTimers.delete(key);
      this.scheduleTick();
    }, delay);
    this.wakeTimers.set(key, handle);
  }

  private lastClockSync = new Map<string, number>();
  private lastNoProgressCheck = new Map<Id, number>();

  scheduleTick(): void {
    const now = this.ctx.now();
    for (const r0 of [...this.ctx.store.operations.values()]) {
      const r = this.ctx.store.operations.get(r0.id);
      if (!r) continue;
      const t0 = this.effectiveT0(r);
      const end = this.windowEnd(r);
      try {
        if (r.state === 'ARMED' || r.state === 'FROZEN') {
          // El desfase con el reloj del proveedor puede cambiar tras cada sincronización:
          // el despertador sigue siempre al T0 efectivo vigente (no crea timers repetidos).
          if (r.state === 'ARMED') this.wakeAt(r.id, t0 - r.config.freezeLeadSeconds * 1000);
          if (now < t0) this.wakeAt(r.id, t0);
          const last = this.lastClockSync.get(r.config.providerId) ?? 0;
          if (now - last > this.ctx.cfg.clockSyncMs) {
            this.lastClockSync.set(r.config.providerId, now);
            void this.syncClock(r.config.providerId);
          }
          // Si se arma tarde y vencen varias fases a la vez, solo se evalúa la más reciente.
          const due = READINESS_PHASES.filter((p) => now >= t0 - p.beforeMs && now < t0 && !r.readinessPhasesDone.includes(p.phase));
          const latest = due.at(-1);
          if (latest) {
            const skipped = due.slice(0, -1).map((p) => p.phase);
            if (skipped.length > 0) {
              const cur = this.get(r.id);
              this.save({ ...cur, readinessPhasesDone: [...new Set([...cur.readinessPhasesDone, ...skipped])] });
            }
            this.runReadiness(this.get(r.id), latest.phase);
          }
        }
        if (r.state === 'ARMED') {
          if (now > end) this.transition(this.get(r.id), 'ENDED', { actor: 'scheduler', endReason: 'NOT_STARTED_IN_WINDOW' });
          else if (now >= t0 - r.config.freezeLeadSeconds * 1000) this.transition(this.get(r.id), 'FROZEN', { actor: 'scheduler', reason: 'T0 − congelado' });
        } else if (r.state === 'FROZEN') {
          if (now > end) this.transition(this.get(r.id), 'ENDED', { actor: 'scheduler', endReason: 'NOT_STARTED_IN_WINDOW' });
          else if (now >= t0) {
            const report = this.runReadiness(this.get(r.id), 'T-5m');
            if (report.overall === 'FAIL') this.transition(this.get(r.id), 'ENDED', { actor: 'scheduler', endReason: 'READINESS_FAILED', reason: 'Readiness FAIL en T0' });
            else this.transition(this.get(r.id), 'RUNNING', { actor: 'scheduler', reason: 'T0' });
          }
        } else if (r.state === 'RUNNING' || r.state === 'PAUSED' || r.state === 'RECOVERING') {
          if (now >= end) this.transition(this.get(r.id), 'ENDED', { actor: 'scheduler', endReason: 'RUN_WINDOW_ELAPSED' });
          else if (r.state === 'RUNNING') this.checkNoProgress(r, now);
          else if (r.state === 'RECOVERING' && this.ctx.claims.inFlightCount(r.id) === 0) {
            this.transition(this.get(r.id), 'RUNNING', { actor: 'system', reason: 'Recuperación completada' });
          }
        }
      } catch (err) {
        this.ctx.journal.audit('scheduler.error', { error: (err as Error).message }, { operationId: r.id });
      }
    }
  }

  private checkNoProgress(r: OperationRecord, now: number): void {
    const last = this.lastNoProgressCheck.get(r.id) ?? 0;
    if (now - last < 5000) return;
    this.lastNoProgressCheck.set(r.id, now);
    const started = r.startedAt ? Date.parse(r.startedAt) : now;
    // En asistencia manual una persona tarda minutos (cola, selección): se avisa
    // cuando ha pasado al menos el plazo de una tarea sin nada nuevo en carrito.
    const manual = this.ctx.runners.kind(r.id) === 'MANUAL';
    const threshold = manual ? Math.max(this.ctx.cfg.noProgressMs, this.ctx.cfg.humanTaskDeadlineMs) : this.ctx.cfg.noProgressMs;
    const confirmedRecently = [...this.ctx.store.claims.values()].some(
      (c) => c.operationId === r.id && c.state === 'CONFIRMED' && now - Date.parse(c.updatedAt) < threshold,
    );
    if (now - started > threshold && !confirmedRecently) {
      const alloc = this.ctx.store.allocations.get(r.id);
      this.ctx.alerts.raise({
        kind: 'NO_PROGRESS',
        severity: 'WARNING',
        title: `${r.config.name}: sin progreso`,
        message: `Llevamos ${Math.round((now - started) / 1000)} s sin nuevas entradas en carrito (${alloc?.cartedQty ?? 0}/${alloc?.requestedQty ?? 0}). Revisa sesiones, colas y si el precio máximo es realista.`,
        actions: ['PAUSE'],
        operationId: r.id,
        dedupeKey: `noprogress:${r.id}`,
      });
    }
  }

  /** Arranque: operaciones que estaban en marcha pasan a RECOVERING y se reconcilian. */
  recoverAfterRestart(): void {
    for (const r of [...this.ctx.store.operations.values()]) {
      if (r.state !== 'RUNNING') continue;
      const next = this.transition(r, 'RECOVERING', { actor: 'system', reason: 'Reinicio del servidor', pausedReason: 'RECOVERY' });
      const n = this.ctx.claims.recoverInFlight(next.id, next.providerEventRef);
      this.ctx.alerts.raise({
        kind: 'RECOVERY_REQUIRED',
        severity: 'CRITICAL',
        title: `${r.config.name}: recuperando tras reinicio`,
        message: `${n} claims en vuelo se están reconciliando antes de continuar.`,
        operationId: r.id,
        dedupeKey: `recovery:${r.id}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Vistas
  // -------------------------------------------------------------------------

  detail(id: Id): OperationDetail {
    const r = this.get(id);
    const { store } = this.ctx;
    return {
      summary: this.summary(r),
      config: r.config,
      versions: r.versions,
      armSnapshot: r.armSnapshot,
      allocation: store.allocations.get(id) ?? null,
      claims: [...store.claims.values()].filter((c) => c.operationId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      carts: [...store.carts.values()].filter((c) => c.operationId === id),
      decisions: [...(store.decisions.get(id) ?? [])].reverse().slice(0, 100),
      validation: r.validation,
      readiness: r.readiness,
      metrics: this.ctx.metrics.has(id) ? this.ctx.metrics.snapshot(id) : null,
      inventory: store.inventory.get(id) ?? null,
      humanTasks: [...store.humanTasks.values()].filter((t) => t.operationId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      amendments: r.amendments,
      timeline: this.ctx.journal.recentAudit({ operationId: id, limit: 200 }).filter((e) => !['decision.recorded', 'inventory.snapshot', 'allocation.step'].includes(e.type)),
    };
  }

  systemStatus(): SystemStatus {
    const { ctx } = this;
    const providers = ctx.registry.descriptors();
    const modes = new Set(providers.map((p) => p.mode));
    const j = ctx.journal.status();
    return {
      version: ctx.cfg.version,
      mode: modes.has('MANUAL_ASSIST') && modes.size > 1 ? 'MIXED' : modes.has('MANUAL_ASSIST') ? 'MANUAL_ASSIST' : 'SIMULATION',
      now: iso(ctx.now()),
      startedAt: iso(ctx.startedAt),
      providers,
      killSwitches: [...ctx.store.killSwitches.values()],
      circuits: [...ctx.store.circuits.values()],
      journal: { healthy: j.healthy, pending: j.pending, lagMs: j.lagMs, lastCommitAt: j.lastCommitAt, driver: j.driver },
      telegram: ctx.notifier?.status?.() ?? {
        enabled: ctx.notifier?.enabled ?? false,
        connected: ctx.notifier?.connected ?? false,
        detail: ctx.notifier?.detail ?? 'Desactivado: falta TELEGRAM_BOT_TOKEN en .env',
        bot: null,
        mainChatConfigured: false,
        recentChats: [],
      },
    };
  }
}
