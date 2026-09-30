/**
 * Runners de operaciones en RUNNING.
 *
 * AutomatedRunner (proveedor simulado o API autorizada): bucle speed-first.
 *   cola → inventario → normalización → decisión pura → reserva → cart.add →
 *   confirmación (ACK/READBACK) o reconciliación. Una llamada en vuelo por cuenta.
 *
 * ManualRunner (asistencia manual): reparte tareas humanas por cuenta con la
 * siguiente mejor sección según la política, respetando límites y presupuesto.
 */

import type { Account, Claim, DecisionRecord, Id, KillSwitch, VenueArtifact } from '@to/shared';
import { capacityOf, wantFor } from '../domain/allocation';
import { normalizeInventory, type CandidateSnapshot } from '../domain/candidates';
import { decide, prepareSnapshot, type DecisionInput, type RankedCandidate } from '../domain/decision';
import type { TimerHandle } from '../util/clock';
import { hashOf } from '../util/hash';
import { hrNowMs } from '../util/stats';
import { iso } from '../util/time';
import type { Ctx } from './context';
import type { OperationRecord } from './store';

export interface Runner {
  readonly kind: 'AUTOMATED' | 'MANUAL';
  start(): void;
  stop(): void;
  tick(): void;
}

interface AccountRunState {
  inFlight: boolean;
  queuePolling: boolean;
  nextQueuePollAt: number;
  backoffUntil: number;
  retired: string | null;
  lastDecisionKey: string | null;
  browserSnapshot: CandidateSnapshot | null;
  browserReading: boolean;
  browserSchemaVersion: string | null;
  nextInventoryPollAt: number;
  unavailable: Map<string, number>;
  inFlightCandidates: Set<string>;
  invalidRequestFailures: number;
  rejectedSnapshotHash: string | null;
}

/** Tiempo que una oferta rechazada (agotada, precio cambiado) se considera no disponible. */
const UNAVAILABLE_MS = 5000;

/** Espera mínima entre dos consultas de la cola cuando el proveedor da una estimación (ms). */
const QUEUE_POLL_MIN_MS = 2;

export class AutomatedRunner implements Runner {
  readonly kind = 'AUTOMATED' as const;
  private timer: TimerHandle | null = null;
  private stopped = false;
  private readonly accounts = new Map<Id, AccountRunState>();
  private readonly unavailable = new Map<string, number>();
  private readonly inFlightCandidates = new Set<string>();
  private readonly journaledSnapshots = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private snapshot: CandidateSnapshot | null = null;
  private reading = false;
  private schemaVersion: string | null = null;
  private policyHash: string | null = null;
  private artifact: VenueArtifact | null = null;
  private closed: ReadonlySet<Id> = new Set();

  constructor(
    private readonly ctx: Ctx,
    readonly operationId: Id,
  ) {}

  start(): void {
    this.stopped = false;
    this.timer = this.ctx.clock.setInterval(() => this.tick(), this.ctx.cfg.runnerTickMs);
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.ctx.clock.clearInterval(this.timer);
    this.timer = null;
  }

  private state(accountId: Id): AccountRunState {
    let s = this.accounts.get(accountId);
    if (!s) {
      s = { inFlight: false, queuePolling: false, nextQueuePollAt: 0, backoffUntil: 0, retired: null, lastDecisionKey: null,
        browserSnapshot: null, browserReading: false, browserSchemaVersion: null, nextInventoryPollAt: 0,
        unavailable: new Map(), inFlightCandidates: new Set(), invalidRequestFailures: 0, rejectedSnapshotHash: null };
      this.accounts.set(accountId, s);
    }
    return s;
  }

  private op(): OperationRecord | null {
    const r = this.ctx.store.operations.get(this.operationId);
    return r && r.state === 'RUNNING' && r.armSnapshot && r.providerEventRef ? r : null;
  }

  private loadArtifact(r: OperationRecord): VenueArtifact | null {
    if (!this.artifact && r.armSnapshot) {
      this.artifact = this.ctx.store.artifacts.get(r.armSnapshot.venueArtifactHash) ?? null;
      this.closed = new Set(this.artifact?.sections.filter((s) => s.closed).map((s) => s.id) ?? []);
      this.policyHash = hashOf(r.armSnapshot.compiledPolicy);
    }
    return this.artifact;
  }

  tick(): void {
    if (this.stopped) return;
    const r = this.op();
    if (!r || !r.armSnapshot || !r.providerEventRef) return;
    const { ctx } = this;
    const providerId = r.config.providerId;
    const ks = ctx.safety.engagedFor({ providerId, operationId: r.id });
    if (ks) {
      ctx.ops.pauseFor(r.id, `KILL_SWITCH ${ks.key}`);
      return;
    }
    if (!ctx.journal.healthy) {
      ctx.ops.pauseFor(r.id, 'JOURNAL_DEGRADED');
      return;
    }
    const artifact = this.loadArtifact(r);
    if (!artifact) {
      ctx.ops.pauseFor(r.id, 'ARTEFACTO_NO_DISPONIBLE');
      return;
    }
    const alloc = ctx.store.allocations.get(r.id);
    if (!alloc) return;
    if (alloc.cartedQty >= alloc.requestedQty) {
      ctx.ops.onProgress(r.id);
      return;
    }
    const policy = r.armSnapshot.compiledPolicy;
    const now = ctx.now();
    const ready: Account[] = [];
    for (const accountId of r.config.accountIds) {
      const st = this.state(accountId);
      if (st.retired) continue;
      const acc = ctx.store.accounts.get(accountId);
      if (!acc || !acc.enabled || acc.session.state !== 'READY') continue;
      if (ctx.safety.engagedFor({ accountId })) continue;
      const q = acc.session.queue.state;
      if (q !== 'PASSED') {
        if (q === 'EXPIRED' || q === 'BLOCKED') continue;
        if (!st.queuePolling && now >= st.nextQueuePollAt) {
          st.queuePolling = true;
          void ctx.accounts
            .pollQueue(accountId, r.id, r.providerEventRef)
            .catch(() => null)
            .then((info) => {
              st.queuePolling = false;
              // Si el proveedor da una estimación, se vuelve a mirar justo cuando toca (mínimo
              // QUEUE_POLL_MIN_MS, máximo queuePollMs): se detecta la salida de la cola al momento.
              // Con un mínimo de 20 ms, «aún no abre, faltan 4 ms» costaba 16 ms de más en T0.
              const eta = info && (info.state === 'WAITING' || info.state === 'NOT_OPEN') ? info.etaMs : null;
              const delay = eta !== null && eta !== undefined ? Math.min(ctx.cfg.queuePollMs, Math.max(QUEUE_POLL_MIN_MS, eta)) : ctx.cfg.queuePollMs;
              st.nextQueuePollAt = ctx.now() + delay;
              if (info?.state === 'PASSED') this.tick();
              else if (!this.stopped) ctx.clock.setTimeout(() => this.tick(), delay);
            });
        }
        continue;
      }
      if (st.inFlight || now < st.backoffUntil) continue;
      if (wantFor(alloc, accountId) < policy.minGroupSize) continue;
      ready.push(acc);
    }
    if (ready.length === 0) return;
    if (ctx.registry.descriptor(providerId)?.mode === 'BROWSER_SESSION') {
      // A browser inventory belongs to one logged-in tab, not to the whole provider.
      // Its offer ids, prices, seat availability and rejection overlay cannot cross accounts.
      for (const acc of ready) {
        const st = this.state(acc.id);
        const age = st.browserSnapshot ? now - st.browserSnapshot.observedAtMs : Number.POSITIVE_INFINITY;
        if (age > Math.min(ctx.cfg.inventoryPollMs, policy.maxSnapshotAgeMs) && !st.browserReading && now >= st.nextInventoryPollAt) {
          void this.refreshInventory(r, acc, true);
        }
        if (st.browserSnapshot && age <= policy.maxSnapshotAgeMs && st.rejectedSnapshotHash !== st.browserSnapshot.contentHash) {
          this.decideFor(r, [acc], st.browserSnapshot, st.unavailable, st.inFlightCandidates);
        }
      }
      return;
    }
    const age = this.snapshot ? now - this.snapshot.observedAtMs : Number.POSITIVE_INFINITY;
    if (age > Math.min(ctx.cfg.inventoryPollMs, policy.maxSnapshotAgeMs) && !this.reading) {
      void this.refreshInventory(r, ready[0] as Account);
    }
    if (this.snapshot && age <= policy.maxSnapshotAgeMs) this.decideFor(r, ready);
  }

  private async refreshInventory(r: OperationRecord, acc: Account, browser = false): Promise<void> {
    const { ctx } = this;
    const eventRef = r.providerEventRef as string;
    const st = this.state(acc.id);
    if (browser) {
      st.browserReading = true;
      st.nextInventoryPollAt = ctx.now() + Math.max(100, ctx.cfg.inventoryPollMs);
    } else this.reading = true;
    try {
      const res = await ctx.gateway.call(
        { providerId: r.config.providerId, capability: 'inventory.read', stage: 'provider.inventory', operationId: r.id, accountId: acc.id },
        (a) => a.readInventory?.(acc.id, eventRef),
      );
      if (this.stopped) return;
      ctx.metrics.count(r.id, 'inventoryPolls');
      if (!res.ok) {
        if (browser) {
          st.browserSnapshot = null;
          st.backoffUntil = ctx.now() + 1000;
        }
        if (res.blocked === null && (res.error as { code?: string }).code === 'NOT_IN_QUEUE') {
          ctx.accounts.setSession(acc.id, { queue: { ...acc.session.queue, state: 'WAITING' } });
        }
        return;
      }
      const read = res.value;
      const schemaVersion = browser ? st.browserSchemaVersion : this.schemaVersion;
      if (schemaVersion === null) {
        if (browser) st.browserSchemaVersion = read.schemaVersion;
        else this.schemaVersion = read.schemaVersion;
      } else if (read.schemaVersion !== schemaVersion) {
        ctx.safety.recordFailure(r.config.providerId, 'inventory.read', `Esquema de inventario inesperado: ${read.schemaVersion}`, { manualReset: true });
        ctx.alerts.raise({
          kind: 'SCHEMA_DRIFT',
          severity: 'CRITICAL',
          title: 'El inventario del proveedor ha cambiado de formato',
          message: `Se esperaba ${schemaVersion} y llegó ${read.schemaVersion}. Operación en pausa hasta revisar el adapter.`,
          actions: ['PAUSE'],
          operationId: r.id,
          dedupeKey: `drift:${r.config.providerId}`,
        });
        ctx.ops.pauseFor(r.id, 'SCHEMA_DRIFT');
        return;
      }
      const artifact = this.loadArtifact(r);
      const policy = r.armSnapshot?.compiledPolicy;
      const alloc = ctx.store.allocations.get(r.id);
      if (!artifact || !policy || !alloc) return;
      const t = hrNowMs();
      const snap = normalizeInventory(r.id, read.offers, read.observedAtMs, artifact);
      if (browser) snap.id = hashOf([snap.id, acc.id], 16);
      ctx.metrics.record(r.id, 'normalization', hrNowMs() - t);
      ctx.metrics.count(r.id, 'candidatesSeen', snap.candidates.length);
      if (browser) st.browserSnapshot = snap;
      else this.snapshot = snap;
      const prepared = prepareSnapshot(snap, policy, this.closed, alloc.maxUnitPrice);
      ctx.metrics.rejections(r.id, prepared.rejected);
      ctx.store.putInventory({
        id: snap.id,
        operationId: r.id,
        observedAt: snap.observedAt,
        offers: snap.offers,
        candidates: snap.candidates.length,
        eligible: prepared.eligible.length,
        rejectedByReason: prepared.rejected,
        unresolvedLabels: snap.unresolvedLabels,
      });
      ctx.metrics.publish(r.id);
    } finally {
      if (browser) st.browserReading = false;
      else this.reading = false;
    }
    this.tick();
  }

  private decideFor(r: OperationRecord, ready: Account[], snapshot = this.snapshot, unavailableUntil = this.unavailable, inFlightCandidates = this.inFlightCandidates): void {
    const { ctx } = this;
    const policy = r.armSnapshot?.compiledPolicy;
    if (!snapshot || !policy) return;
    const now = ctx.now();
    for (const [ref, until] of unavailableUntil) if (until <= now) unavailableUntil.delete(ref);
    const unavailable = new Set(unavailableUntil.keys());
    for (const acc of ready) {
      const st = this.state(acc.id);
      if (st.inFlight) continue;
      const alloc = ctx.store.allocations.get(r.id);
      if (!alloc) return;
      const capacity = capacityOf(alloc, acc.id);
      if (Math.min(capacity.accountRemaining, capacity.groupRemaining, capacity.operationRemaining) < policy.minGroupSize) continue;
      // La decisión es pura: si ni el inventario, ni la asignación, ni el overlay han
      // cambiado para esta cuenta, el resultado sería el mismo → no se repite ni se registra.
      const key = `${snapshot.contentHash}|${alloc.version}|${[...inFlightCandidates].sort().join(',')}|${[...unavailable].sort().join(',')}`;
      if (key === st.lastDecisionKey) continue;
      st.lastDecisionKey = key;
      const input: DecisionInput = {
        operationId: r.id,
        accountId: acc.id,
        atMs: now,
        snapshot,
        policy,
        closedSectionIds: this.closed,
        maxUnitPrice: alloc.maxUnitPrice,
        capacity,
        overlay: { inFlight: inFlightCandidates, unavailable },
      };
      const t = hrNowMs();
      const result = decide(input);
      const ms = hrNowMs() - t;
      ctx.metrics.record(r.id, 'decision', ms);
      ctx.metrics.count(r.id, 'decisions');
      const record = this.record(input, result, ms);
      if (result.outcome === 'CLAIMED' && result.chosen) void this.claim(r, acc, result.chosen, record, snapshot.contentHash);
    }
  }

  private record(input: DecisionInput, result: ReturnType<typeof decide>, ms: number): DecisionRecord {
    const { ctx } = this;
    if (!this.journaledSnapshots.has(input.snapshot.id)) {
      this.journaledSnapshots.add(input.snapshot.id);
      ctx.journal.audit('inventory.snapshot', { snapshot: input.snapshot }, { operationId: input.operationId });
    }
    const replayInput = {
      snapshotId: input.snapshot.id,
      policyHash: this.policyHash,
      atMs: input.atMs,
      maxUnitPrice: input.maxUnitPrice,
      capacity: input.capacity,
      overlay: { inFlight: [...input.overlay.inFlight].sort(), unavailable: [...input.overlay.unavailable].sort() },
      closed: [...input.closedSectionIds].sort(),
    };
    const rec: DecisionRecord = {
      id: ctx.ids.next('dec'),
      operationId: input.operationId,
      accountId: input.accountId,
      at: iso(input.atMs),
      snapshotId: input.snapshot.id,
      policyVersion: input.policy.policyVersion,
      inputHash: hashOf(replayInput),
      outcome: result.outcome,
      chosen: result.chosen
        ? {
            candidateId: result.chosen.candidate.id,
            qty: result.chosen.qty,
            rank: result.chosen.rank,
            sectionId: result.chosen.candidate.sectionId,
            unitPrice: result.chosen.candidate.unitPrice,
          }
        : null,
      alternatives: result.alternatives.map((a) => ({ candidateId: a.candidate.id, qty: a.qty, rank: a.rank })),
      rejectedByReason: result.rejectedByReason,
      claimId: null,
      latencyUs: Math.round(ms * 1000),
    };
    ctx.store.pushDecision(rec);
    ctx.journal.audit('decision.recorded', { decision: rec, input: replayInput }, { operationId: input.operationId, correlationId: rec.id });
    return rec;
  }

  private async claim(r: OperationRecord, acc: Account, chosen: RankedCandidate, record: DecisionRecord, sourceSnapshotHash: string): Promise<void> {
    const { ctx } = this;
    const st = this.state(acc.id);
    const c = chosen.candidate;
    const browser = ctx.registry.descriptor(r.config.providerId)?.mode === 'BROWSER_SESSION';
    const inFlightCandidates = browser ? st.inFlightCandidates : this.inFlightCandidates;
    const unavailable = browser ? st.unavailable : this.unavailable;
    st.inFlight = true;
    inFlightCandidates.add(c.id);
    const attemptKey = `${acc.id}|${c.id}`;
    const attempt = (this.attempts.get(attemptKey) ?? 0) + 1;
    this.attempts.set(attemptKey, attempt);
    try {
      const claim = ctx.claims.reserve({
        operationId: r.id,
        accountId: acc.id,
        candidateId: c.id,
        offerRef: c.offerRef,
        sectionId: c.sectionId,
        sectionLabel: c.sectionLabelRaw,
        row: c.row,
        qty: chosen.qty,
        unitPrice: c.unitPrice,
        attempt,
      });
      if (!claim) return;
      record.claimId = claim.id;
      ctx.journal.audit('decision.claimed', { decisionId: record.id, claimId: claim.id }, { operationId: r.id, correlationId: claim.id });
      const sent = ctx.claims.markSent(claim);
      const eventRef = r.providerEventRef as string;
      const res = await ctx.gateway.call(
        { providerId: r.config.providerId, capability: 'cart.add', stage: 'provider.add_to_cart', operationId: r.id, accountId: acc.id },
        (a) => a.addToCart?.({ accountId: acc.id, eventRef, offerRef: c.offerRef, qty: chosen.qty, unitPrice: c.unitPrice, idempotencyKey: sent.idempotencyKey }),
      );
      const outcome = await ctx.claims.handleAddResult(sent, r, eventRef, res);
      const now = ctx.now();
      if (outcome.kind === 'REJECTED') {
        if (outcome.offerUnavailable) unavailable.set(c.offerRef, now + UNAVAILABLE_MS);
        if (outcome.retireAccount) st.retired = outcome.reason;
        if (outcome.backoffMs > 0) st.backoffUntil = now + outcome.backoffMs;
        if (browser && outcome.reason === 'INVALID_REQUEST') {
          st.invalidRequestFailures++;
          st.rejectedSnapshotHash = sourceSnapshotHash;
          st.browserSnapshot = null;
          st.backoffUntil = now + 1000;
          // Re-read only this account. No new claim for unchanged evidence, and at most
          // one retry on changed inventory before the person must inspect the tab.
          if (st.invalidRequestFailures >= 2) {
            st.retired = 'BROWSER_INVALID_REQUEST';
            ctx.alerts.raise({ kind: 'SESSION_NOT_READY', severity: 'WARNING',
              title: `${acc.label}: revisa la pestaña conectada`,
              message: 'La página rechazó dos selecciones verificadas. Esta cuenta se detiene para evitar repetir intentos; revisa evento, oferta y carrito antes de reanudar.',
              operationId: r.id, accountId: acc.id, dedupeKey: `browser-rejected:${r.id}:${acc.id}` });
          }
        }
      } else if (browser && outcome.kind === 'AMBIGUOUS') {
        st.retired = 'BROWSER_RESULT_UNCERTAIN';
      } else if (outcome.kind === 'BLOCKED') {
        st.backoffUntil = now + 1000;
      }
      ctx.metrics.publish(r.id);
    } finally {
      st.inFlight = false;
      inFlightCandidates.delete(c.id);
      if (!this.stopped) ctx.clock.setTimeout(() => this.tick(), 0);
    }
  }
}

export class ManualRunner implements Runner {
  readonly kind = 'MANUAL' as const;
  private timer: TimerHandle | null = null;

  constructor(
    private readonly ctx: Ctx,
    readonly operationId: Id,
  ) {}

  /**
   * Zona por la que va una cuenta, deducida de su último claim manual en la operación
   * (no de memoria del runner, que se crea de nuevo en cada arranque): sobrevive a pausas,
   * kill switches, «carrito perdido» y reinicios. Se pasa a la siguiente zona cuando esa
   * reserva acabó rechazada: «No pude» en la tarea o «no está» en su verificación.
   */
  private zoneIndex(accountId: Id, targets: Array<{ key: string }>): number {
    let last: Claim | undefined;
    for (const c of this.ctx.store.claims.values()) {
      if (c.operationId !== this.operationId || c.accountId !== accountId || !c.candidateId.startsWith('manual:')) continue;
      if (!last || c.createdAt >= last.createdAt) last = c;
    }
    if (!last) return 0;
    const candidateId = last.candidateId;
    const idx = targets.findIndex((t) => `manual:${t.key}` === candidateId);
    if (idx < 0) return 0;
    return last.state === 'REJECTED' ? idx + 1 : idx;
  }

  start(): void {
    // 250 ms: en cuanto una persona marca «Sesión lista» o «No pude», recibe su siguiente tarea.
    this.timer = this.ctx.clock.setInterval(() => this.tick(), 250);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) this.ctx.clock.clearInterval(this.timer);
    this.timer = null;
  }

  private targets(r: OperationRecord): Array<{ label: string; sectionId: Id | null; key: string }> {
    const policy = r.armSnapshot?.compiledPolicy;
    if (!policy) return [];
    const allowed = new Set(Object.keys(policy.sectionRank));
    return [...policy.resolution]
      .sort((a, b) => a.rank - b.rank)
      .filter((t) => t.ids.some((id) => allowed.has(id)))
      .map((t) => ({
        label: t.input === '(todo el recinto)' ? 'cualquier sección permitida' : t.input,
        sectionId: t.resolvedTo === 'SECTION' ? (t.ids[0] ?? null) : null,
        key: `${t.rank}:${t.input}`,
      }));
  }

  tick(): void {
    const { ctx } = this;
    const r = ctx.store.operations.get(this.operationId);
    if (!r || r.state !== 'RUNNING' || !r.armSnapshot) return;
    if (ctx.safety.engagedFor({ providerId: r.config.providerId, operationId: r.id })) return;
    let alloc = ctx.store.allocations.get(r.id);
    if (!alloc) return;
    if (alloc.cartedQty >= alloc.requestedQty) {
      ctx.ops.onProgress(r.id);
      return;
    }
    const targets = this.targets(r);
    const minGroup = r.armSnapshot.compiledPolicy.minGroupSize;
    for (const accountId of r.config.accountIds) {
      const acc = ctx.store.accounts.get(accountId);
      if (!acc || !acc.enabled || ctx.safety.engagedFor({ accountId })) continue;
      if (acc.session.state !== 'READY') {
        ctx.tasks.ensureSessionTask(acc, r.id, 'Inicia sesión');
        continue;
      }
      if (ctx.tasks.openFor(accountId, 'ADD_TO_CART', r.id) || ctx.tasks.openFor(accountId, 'VERIFY_CART', r.id)) continue;
      const target = targets[this.zoneIndex(accountId, targets)];
      if (!target) continue;
      const want = wantFor(alloc, accountId);
      const byBudget = Math.floor(alloc.budget.remaining / Math.max(1, alloc.maxUnitPrice));
      let qty = Math.min(want, byBudget);
      // Reparto en paralelo: que lo que quede sin asignar sea 0 o al menos un
      // grupo mínimo, para que otra cuenta lista pueda ir a por ello a la vez.
      const rest = alloc.remainingQty - qty;
      if (rest > 0 && rest < minGroup && qty - (minGroup - rest) >= minGroup) qty -= minGroup - rest;
      if (qty < minGroup) continue;
      ctx.claims.createManualClaim(r, accountId, target, qty);
      alloc = ctx.store.allocations.get(r.id) ?? alloc;
    }
  }
}

export class RunnerManager {
  private readonly runners = new Map<Id, Runner>();

  constructor(private readonly ctx: Ctx) {}

  start(operationId: Id): void {
    if (this.runners.has(operationId)) return;
    const kind = this.kindFor(operationId);
    if (!kind) return;
    const runner: Runner = kind === 'AUTOMATED' ? new AutomatedRunner(this.ctx, operationId) : new ManualRunner(this.ctx, operationId);
    this.runners.set(operationId, runner);
    this.ctx.journal.audit('runner.started', { kind: runner.kind }, { operationId });
    runner.start();
  }

  stop(operationId: Id): void {
    const runner = this.runners.get(operationId);
    if (!runner) return;
    runner.stop();
    this.runners.delete(operationId);
    this.ctx.journal.audit('runner.stopped', { kind: runner.kind }, { operationId });
  }

  stopAll(): void {
    for (const id of [...this.runners.keys()]) this.stop(id);
  }

  /** Reacciona ya (sin esperar al siguiente tick) tras una respuesta humana. */
  nudge(operationId: Id): void {
    this.runners.get(operationId)?.tick();
  }

  kind(operationId: Id): Runner['kind'] | null {
    return this.runners.get(operationId)?.kind ?? null;
  }

  /** Tipo de runner que le toca a la operación, aunque aún no haya arrancado. */
  kindFor(operationId: Id): Runner['kind'] | null {
    const r = this.ctx.store.operations.get(operationId);
    if (!r) return null;
    const p = r.config.providerId;
    return this.ctx.registry.automated(p, 'cart.add') && this.ctx.registry.automated(p, 'inventory.read') ? 'AUTOMATED' : 'MANUAL';
  }

  /** Un kill switch global, de proveedor u operación pausa en el acto las operaciones afectadas. */
  onKillSwitch(ks: KillSwitch): void {
    if (ks.scope === 'ACCOUNT') return; // el gateway bloquea esa cuenta; el resto sigue
    for (const r of this.ctx.store.operations.values()) {
      if (r.state !== 'RUNNING' && r.state !== 'RECOVERING') continue;
      const affected =
        ks.scope === 'GLOBAL' ||
        (ks.scope === 'PROVIDER' && ks.targetId === r.config.providerId) ||
        (ks.scope === 'OPERATION' && ks.targetId === r.id);
      if (affected) this.ctx.ops.pauseFor(r.id, `KILL_SWITCH ${ks.key}`);
    }
  }
}
