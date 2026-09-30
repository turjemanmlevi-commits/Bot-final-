/**
 * Ciclo de vida de los claims (§17, §18) y reconciliación.
 *
 *   PENDING (reservado) → SENT → CONFIRMED | REJECTED | AMBIGUOUS
 *   AMBIGUOUS → (reconciliación con cart.read o una persona) → CONFIRMED | REJECTED
 *
 * Un resultado ambiguo NUNCA libera la reserva hasta saber la verdad: así no se
 * compra dos veces lo mismo (no hay sobreasignación).
 */

import type { Cart, Claim, ClaimResolution, ConfirmationLevel, HumanTask, Id, Minor } from '@to/shared';
import { formatMoney } from '@to/shared';
import { applyAllocation, type AllocationOp, type AllocationResult, type AllocationWarning } from '../domain/allocation';
import type { AddToCartResult, ProviderCart, ProviderCartItem } from '../providers/types';
import type { TimerHandle } from '../util/clock';
import { hashOf } from '../util/hash';
import { hrNowMs } from '../util/stats';
import { iso } from '../util/time';
import type { Ctx } from './context';
import type { GatewayResult } from './gateway';
import type { OperationRecord } from './store';

export type AddOutcome =
  | { kind: 'CONFIRMED' }
  | { kind: 'REJECTED'; reason: string; offerUnavailable: boolean; retireAccount: boolean; backoffMs: number }
  | { kind: 'AMBIGUOUS'; reason: string }
  | { kind: 'BLOCKED'; reason: string };

interface ConfirmedItem {
  qty: number;
  unitPrice: Minor;
  seats: string[];
  row: string | null;
  sectionLabel: string;
}

const REVIEW_TEXT: Record<AllocationWarning, string> = {
  PRICE_ABOVE_MAX: 'El precio en el carrito supera el precio máximo de la operación.',
  OVER_BUDGET: 'El carrito hace superar el presupuesto de la operación.',
  OVER_ACCOUNT_LIMIT: 'La cuenta supera su límite de entradas.',
  OVER_GROUP_LIMIT: 'El grupo de límite (titular/hogar/pago) supera su cupo.',
  OVER_REQUESTED: 'Hay más entradas en carrito que las pedidas.',
};

const RECONCILE_MAX_ATTEMPTS = 4;

export class ClaimService {
  private readonly reconcileTimers = new Map<Id, TimerHandle>();

  constructor(private readonly ctx: Ctx) {}

  // -------------------------------------------------------------------------
  // Asignación
  // -------------------------------------------------------------------------

  applyAllocation(operationId: Id, op: AllocationOp, correlationId: string | null = null): AllocationResult {
    const state = this.ctx.store.allocations.get(operationId);
    if (!state) return { ok: false, error: 'La operación no tiene asignación (¿no está armada?)' };
    const t = hrNowMs();
    const res = applyAllocation(state, op);
    this.ctx.metrics.record(operationId, 'allocation', hrNowMs() - t);
    if (res.ok) {
      this.ctx.store.putAllocation(res.state);
      this.ctx.journal.audit('allocation.step', { op, version: res.state.version, hash: hashOf(res.state) }, { operationId, correlationId });
      this.ctx.ops.publishSummary(operationId);
    } else {
      this.ctx.journal.audit('allocation.rejected', { op, error: res.error }, { operationId, correlationId });
    }
    return res;
  }

  private save(claim: Claim, patch: Partial<Claim>): Claim {
    const next: Claim = { ...claim, ...patch, updatedAt: iso(this.ctx.now()) };
    this.ctx.store.putClaim(next);
    return next;
  }

  private label(accountId: Id): string {
    return this.ctx.store.accounts.get(accountId)?.label ?? accountId;
  }

  // -------------------------------------------------------------------------
  // Automático
  // -------------------------------------------------------------------------

  /** Crea el claim y reserva capacidad. null si la asignación lo rechaza. */
  reserve(params: {
    operationId: Id;
    accountId: Id;
    candidateId: string;
    offerRef: string;
    sectionId: Id | null;
    sectionLabel: string;
    row: string | null;
    qty: number;
    unitPrice: Minor;
    attempt: number;
  }): Claim | null {
    const id = this.ctx.ids.next('clm');
    const res = this.applyAllocation(
      params.operationId,
      { op: 'RESERVE', claimId: id, accountId: params.accountId, qty: params.qty, unitPrice: params.unitPrice },
      id,
    );
    if (!res.ok) return null;
    const now = iso(this.ctx.now());
    const claim: Claim = {
      id,
      operationId: params.operationId,
      accountId: params.accountId,
      candidateId: params.candidateId,
      offerRef: params.offerRef,
      sectionId: params.sectionId,
      sectionLabel: params.sectionLabel,
      row: params.row,
      qty: params.qty,
      unitPrice: params.unitPrice,
      idempotencyKey: hashOf([params.operationId, params.accountId, params.candidateId, params.attempt], 24),
      state: 'PENDING',
      reason: null,
      resolution: null,
      cartId: null,
      allocationVersion: res.state.version,
      correlationId: id,
      createdAt: now,
      updatedAt: now,
    };
    this.ctx.store.putClaim(claim);
    this.ctx.metrics.count(params.operationId, 'claims');
    this.ctx.journal.audit('claim.reserved', { claimId: id, accountId: claim.accountId, offerRef: claim.offerRef, qty: claim.qty, unitPrice: claim.unitPrice }, { operationId: claim.operationId, correlationId: id });
    return claim;
  }

  markSent(claim: Claim): Claim {
    return this.save(claim, { state: 'SENT' });
  }

  /** Procesa la respuesta de cart.add (ya pasada por el gateway). */
  async handleAddResult(claim: Claim, op: OperationRecord, eventRef: string, result: GatewayResult<AddToCartResult>): Promise<AddOutcome> {
    const { ctx } = this;
    if (!result.ok) {
      if (result.blocked) {
        this.reject(claim, `BLOCKED:${result.blocked}`, null);
        return { kind: 'BLOCKED', reason: result.detail };
      }
      // Error de red / timeout: no sabemos si se añadió.
      this.markAmbiguous(claim, `ERROR:${result.error.message}`, eventRef);
      return { kind: 'AMBIGUOUS', reason: result.error.message };
    }
    const r = result.value;
    const providerId = op.config.providerId;
    switch (r.status) {
      case 'ADDED': {
        if (r.duplicate) ctx.metrics.count(op.id, 'duplicateResponses');
        const adapter = ctx.registry.get(providerId);
        if (adapter?.confirmationPolicy === 'READBACK') return this.confirmByReadback(claim, eventRef, r.cart);
        this.confirm(claim, this.itemFrom(r.item), 'ACK', 'PROVIDER_RESPONSE', r.cart);
        return { kind: 'CONFIRMED' };
      }
      case 'REJECTED': {
        this.reject(claim, r.reason, 'PROVIDER_RESPONSE');
        if (r.reason === 'LIMIT_REACHED') {
          ctx.alerts.raise({
            kind: 'SESSION_NOT_READY',
            severity: 'WARNING',
            title: `${this.label(claim.accountId)}: el proveedor dice que ya alcanzó su límite`,
            message: 'La cuenta deja de participar en esta operación. Revisa si tiene compras previas.',
            operationId: op.id,
            accountId: claim.accountId,
            dedupeKey: `limit:${op.id}:${claim.accountId}`,
          });
        }
        if (r.reason === 'SESSION_INVALID') void ctx.accounts.pollSession(claim.accountId);
        return {
          kind: 'REJECTED',
          reason: r.reason,
          offerUnavailable: r.reason === 'SOLD_OUT' || r.reason === 'PRICE_CHANGED',
          retireAccount: r.reason === 'LIMIT_REACHED',
          backoffMs: r.reason === 'NOT_IN_QUEUE' || r.reason === 'SESSION_INVALID' ? 1000 : 0,
        };
      }
      case 'AMBIGUOUS':
        this.markAmbiguous(claim, r.detail, eventRef);
        return { kind: 'AMBIGUOUS', reason: r.detail };
      case 'RATE_LIMITED':
        this.reject(claim, 'RATE_LIMITED', 'PROVIDER_RESPONSE');
        ctx.safety.recordFailure(providerId, 'cart.add', 'Rate limit del proveedor');
        ctx.alerts.raise({
          kind: 'RATE_LIMITED',
          severity: 'WARNING',
          title: 'El proveedor está limitando peticiones',
          message: `Se espera ${Math.round(r.retryAfterMs)} ms antes de reintentar con esa cuenta.`,
          operationId: op.id,
          dedupeKey: `ratelimit:${op.id}`,
        });
        return { kind: 'REJECTED', reason: 'RATE_LIMITED', offerUnavailable: false, retireAccount: false, backoffMs: r.retryAfterMs };
      case 'SCHEMA_DRIFT':
        this.markAmbiguous(claim, `SCHEMA_DRIFT: ${r.detail}`, eventRef);
        ctx.safety.recordFailure(providerId, 'cart.add', `Cambio de esquema: ${r.detail}`, { manualReset: true });
        ctx.alerts.raise({
          kind: 'SCHEMA_DRIFT',
          severity: 'CRITICAL',
          title: 'El proveedor ha cambiado el formato de sus respuestas',
          message: 'Se pausa la operación: no se interpreta una respuesta que no se entiende. Revisa el adapter y reinicia el circuito.',
          actions: ['PAUSE'],
          operationId: op.id,
          dedupeKey: `drift:${providerId}`,
        });
        ctx.ops.pauseFor(op.id, 'SCHEMA_DRIFT');
        return { kind: 'AMBIGUOUS', reason: 'SCHEMA_DRIFT' };
    }
  }

  private itemFrom(i: ProviderCartItem): ConfirmedItem {
    return { qty: i.qty, unitPrice: i.unitPrice, seats: i.seats, row: i.row, sectionLabel: i.sectionLabel };
  }

  private findItem(claim: Claim, cart: ProviderCart): ProviderCartItem | undefined {
    // Una clave coincidente identifica el intento, pero no demuestra qué se añadió.
    // También deben coincidir la oferta, la cantidad y el precio observado.
    return cart.items.find((i) =>
      (i.idempotencyKey === null || i.idempotencyKey === claim.idempotencyKey) &&
      i.offerRef === claim.offerRef && i.qty === claim.qty && i.unitPrice === claim.unitPrice,
    );
  }

  private async readCart(claim: Claim, eventRef: string): Promise<GatewayResult<ProviderCart>> {
    const account = this.ctx.store.accounts.get(claim.accountId);
    return this.ctx.gateway.call(
      {
        providerId: account?.providerId ?? '',
        capability: 'cart.read',
        stage: 'provider.read_cart',
        operationId: claim.operationId,
        accountId: claim.accountId,
      },
      (a) => a.readCart?.(claim.accountId, eventRef),
    );
  }

  private async confirmByReadback(claim: Claim, eventRef: string, ackCart: ProviderCart): Promise<AddOutcome> {
    const rb = await this.readCart(claim, eventRef);
    if (!rb.ok) {
      this.markAmbiguous(claim, 'READBACK_FAILED', eventRef);
      return { kind: 'AMBIGUOUS', reason: 'READBACK_FAILED' };
    }
    const item = this.findItem(claim, rb.value);
    if (!item) {
      this.markAmbiguous(claim, 'READBACK_MISSING', eventRef);
      return { kind: 'AMBIGUOUS', reason: 'READBACK_MISSING' };
    }
    this.confirm(claim, this.itemFrom(item), 'READBACK', 'PROVIDER_RESPONSE', { ...ackCart, ...rb.value });
    return { kind: 'CONFIRMED' };
  }

  confirm(
    claim: Claim,
    item: ConfirmedItem,
    level: ConfirmationLevel,
    resolution: ClaimResolution,
    providerCart: Pick<ProviderCart, 'cartRef' | 'expiresAt' | 'openUrl'> | null,
  ): Claim {
    const current = this.ctx.store.claims.get(claim.id) ?? claim;
    if (current.state === 'CONFIRMED' || current.state === 'REJECTED' || current.state === 'CANCELLED') return current;
    if (current.state === 'AMBIGUOUS') this.applyAllocation(current.operationId, { op: 'UNFREEZE', claimId: current.id, qty: current.qty }, current.id);
    const res = this.applyAllocation(
      current.operationId,
      {
        op: 'CONFIRM',
        claimId: current.id,
        accountId: current.accountId,
        reservedQty: current.qty,
        reservedUnitPrice: current.unitPrice,
        qty: item.qty,
        unitPrice: item.unitPrice,
      },
      current.id,
    );
    const warnings = res.ok ? res.warnings : [];
    const review = !res.ok ? `No se pudo registrar en la asignación: ${res.error}` : warnings.length > 0 ? warnings.map((w) => REVIEW_TEXT[w]).join(' ') : null;
    const cart = this.ctx.carts.add({
      operationId: current.operationId,
      accountId: current.accountId,
      item: { claimId: current.id, sectionId: current.sectionId, sectionLabel: item.sectionLabel, row: item.row, seats: item.seats, qty: item.qty, unitPrice: item.unitPrice },
      level,
      providerCartRef: providerCart?.cartRef ?? `manual-${current.accountId}`,
      expiresAt: providerCart?.expiresAt ?? null,
      openUrl: providerCart?.openUrl ?? null,
      review,
    });
    const next = this.save(current, { state: 'CONFIRMED', resolution, cartId: cart.id, reason: review, allocationVersion: this.ctx.store.allocations.get(current.operationId)?.version ?? current.allocationVersion });
    this.ctx.metrics.count(current.operationId, 'confirmed');
    if (resolution === 'RECONCILIATION') this.ctx.metrics.count(current.operationId, 'reconciled');
    this.ctx.journal.audit('claim.confirmed', { claimId: current.id, qty: item.qty, unitPrice: item.unitPrice, level, resolution, cartId: cart.id }, { operationId: current.operationId, correlationId: current.id });
    this.ctx.alerts.resolveWhere((a) => a.claimId === current.id && (a.kind === 'AMBIGUOUS_RESULT' || a.kind === 'RECONCILIATION_NEEDS_HUMAN'));
    this.ctx.ops.onProgress(current.operationId);
    return next;
  }

  reject(claim: Claim, reason: string, resolution: ClaimResolution, state: 'REJECTED' | 'CANCELLED' = 'REJECTED'): Claim {
    const current = this.ctx.store.claims.get(claim.id) ?? claim;
    if (current.state === 'CONFIRMED' || current.state === 'REJECTED' || current.state === 'CANCELLED') return current;
    if (current.state === 'AMBIGUOUS') this.applyAllocation(current.operationId, { op: 'UNFREEZE', claimId: current.id, qty: current.qty }, current.id);
    this.applyAllocation(current.operationId, { op: 'RELEASE', claimId: current.id, accountId: current.accountId, qty: current.qty, unitPrice: current.unitPrice }, current.id);
    const next = this.save(current, { state, reason, resolution });
    this.ctx.metrics.count(current.operationId, 'rejected');
    if (resolution === 'RECONCILIATION') this.ctx.metrics.count(current.operationId, 'reconciled');
    this.ctx.journal.audit(state === 'REJECTED' ? 'claim.rejected' : 'claim.cancelled', { claimId: current.id, reason, resolution }, { operationId: current.operationId, correlationId: current.id });
    this.ctx.alerts.resolveWhere((a) => a.claimId === current.id && (a.kind === 'AMBIGUOUS_RESULT' || a.kind === 'RECONCILIATION_NEEDS_HUMAN'));
    this.ctx.ops.onProgress(current.operationId);
    return next;
  }

  markAmbiguous(claim: Claim, reason: string, eventRef: string | null): Claim {
    const current = this.ctx.store.claims.get(claim.id) ?? claim;
    if (current.state === 'CONFIRMED' || current.state === 'REJECTED' || current.state === 'CANCELLED' || current.state === 'AMBIGUOUS') return current;
    this.applyAllocation(current.operationId, { op: 'FREEZE', claimId: current.id, qty: current.qty }, current.id);
    const next = this.save(current, { state: 'AMBIGUOUS', reason });
    this.ctx.metrics.count(current.operationId, 'ambiguous');
    this.ctx.journal.audit('claim.ambiguous', { claimId: current.id, reason }, { operationId: current.operationId, correlationId: current.id });
    this.ctx.alerts.raise({
      kind: 'AMBIGUOUS_RESULT',
      severity: 'WARNING',
      title: `${this.label(current.accountId)}: resultado dudoso (${current.qty} × ${current.sectionLabel})`,
      message: 'No se sabe si entró en el carrito. La reserva se mantiene hasta comprobarlo: no se volverá a comprar lo mismo.',
      operationId: current.operationId,
      accountId: current.accountId,
      claimId: current.id,
    });
    const account = this.ctx.store.accounts.get(current.accountId);
    if (eventRef && account && this.ctx.registry.automated(account.providerId, 'cart.read')) this.scheduleReconcile(current.id, eventRef, 1);
    else this.askHumanToVerify(next, 'No se pudo confirmar automáticamente.');
    return next;
  }

  private scheduleReconcile(claimId: Id, eventRef: string, attempt: number): void {
    const prev = this.reconcileTimers.get(claimId);
    if (prev !== undefined) this.ctx.clock.clearTimeout(prev);
    const delay = 400 * 2 ** (attempt - 1);
    this.reconcileTimers.set(
      claimId,
      this.ctx.clock.setTimeout(() => {
        this.reconcileTimers.delete(claimId);
        void this.reconcile(claimId, eventRef, attempt);
      }, delay),
    );
  }

  async reconcile(claimId: Id, eventRef: string, attempt: number): Promise<void> {
    const claim = this.ctx.store.claims.get(claimId);
    if (!claim || claim.state !== 'AMBIGUOUS') return;
    const rb = await this.readCart(claim, eventRef);
    const current = this.ctx.store.claims.get(claimId);
    if (!current || current.state !== 'AMBIGUOUS') return;
    if (rb.ok) {
      const item = this.findItem(current, rb.value);
      if (item) this.confirm(current, this.itemFrom(item), 'READBACK', 'RECONCILIATION', rb.value);
      else if (rb.value.items.some((i) => i.idempotencyKey === current.idempotencyKey || i.offerRef === current.offerRef)) {
        // Hay entradas relacionadas, pero diferentes de las solicitadas. Liberar
        // la reserva permitiría añadirlas de nuevo mientras siguen en el carrito.
        this.askHumanToVerify(current, 'El carrito contiene una cantidad, oferta o precio distinto del solicitado.');
      } else this.reject(current, 'NOT_IN_CART', 'RECONCILIATION');
      return;
    }
    if (attempt < RECONCILE_MAX_ATTEMPTS) {
      this.scheduleReconcile(claimId, eventRef, attempt + 1);
      return;
    }
    this.askHumanToVerify(current, rb.blocked ? rb.detail : rb.error.message);
  }

  private askHumanToVerify(claim: Claim, why: string): void {
    if (this.ctx.tasks.openFor(claim.accountId, 'VERIFY_CART', claim.operationId)) return;
    const op = this.ctx.store.operations.get(claim.operationId);
    const money = formatMoney(claim.unitPrice, op?.config.currency ?? 'EUR');
    this.ctx.alerts.raise({
      kind: 'RECONCILIATION_NEEDS_HUMAN',
      severity: 'CRITICAL',
      title: `${this.label(claim.accountId)}: comprueba el carrito a mano`,
      message: `${why} ¿Hay ${claim.qty} entrada${claim.qty === 1 ? '' : 's'} de ${claim.sectionLabel} (${money}/u) en el carrito?`,
      actions: ['OPEN_CART'],
      operationId: claim.operationId,
      accountId: claim.accountId,
      claimId: claim.id,
    });
    this.ctx.tasks.create({
      operationId: claim.operationId,
      accountId: claim.accountId,
      kind: 'VERIFY_CART',
      alert: false,
      claimId: claim.id,
      title: claim.qty === 1 ? `¿Está la entrada de ${claim.sectionLabel} en el carrito?` : `¿Están las ${claim.qty} entradas de ${claim.sectionLabel} en el carrito?`,
      instructions: `Abre el carrito de la cuenta "${this.label(claim.accountId)}" en el proveedor y responde qué hay. No pagues todavía si no estás seguro.`,
      target: { sectionLabel: claim.sectionLabel, row: claim.row, seats: [], qty: claim.qty, maxUnitPrice: claim.unitPrice, currency: op?.config.currency ?? 'EUR' },
    });
  }

  // -------------------------------------------------------------------------
  // Asistencia manual
  // -------------------------------------------------------------------------

  /** Reserva capacidad al precio máximo y crea la tarea ADD_TO_CART para una persona. */
  createManualClaim(op: OperationRecord, accountId: Id, target: { label: string; sectionId: Id | null; key: string }, qty: number): HumanTask | null {
    const maxUnitPrice = this.ctx.store.allocations.get(op.id)?.maxUnitPrice ?? op.config.maxUnitPrice;
    const claim = this.reserve({
      operationId: op.id,
      accountId,
      candidateId: `manual:${target.key}`,
      offerRef: `manual:${target.key}:${this.ctx.now()}`,
      sectionId: target.sectionId,
      sectionLabel: target.label,
      row: null,
      qty,
      unitPrice: maxUnitPrice,
      attempt: this.ctx.now(),
    });
    if (!claim) return null;
    this.markSent(claim);
    const money = formatMoney(maxUnitPrice, op.config.currency);
    const prefs = op.config.preferences;
    const extras = [
      prefs.requireContiguous ? 'juntas (misma fila)' : null,
      prefs.allowObstructed ? null : 'sin visión reducida',
      prefs.allowAccessible ? null : 'sin usar plazas accesibles',
    ].filter(Boolean);
    return this.ctx.tasks.create({
      operationId: op.id,
      accountId,
      kind: 'ADD_TO_CART',
      claimId: claim.id,
      title: `Añade ${qty} entrada${qty === 1 ? '' : 's'} · ${target.label}`,
      instructions:
        `Con la cuenta "${this.label(accountId)}", en la web oficial, añade ${qty} entrada${qty === 1 ? '' : 's'} de ${target.label} al carrito` +
        `${extras.length ? ` (${extras.join(', ')})` : ''}. Máximo ${money} por entrada con gastos incluidos. ` +
        'En cuanto estén en el carrito, responde aquí cuántas son, a qué precio y cuántos minutos le quedan al carrito; ' +
        'después paga en la web oficial y márcalo como pagado en Carritos. Si no hay entradas en esa zona por ese precio, pulsa «No pude» y te daremos la siguiente zona.',
      target: { sectionLabel: target.label, row: null, seats: [], qty, maxUnitPrice, currency: op.config.currency },
      deadlineMs: this.ctx.cfg.humanTaskDeadlineMs,
    });
  }

  onManualAddResponse(task: HumanTask): void {
    const claim = task.claimId ? this.ctx.store.claims.get(task.claimId) : undefined;
    if (!claim || claim.state !== 'SENT' || !task.response) return;
    const r = task.response;
    if (r.result === 'IN_CART') {
      const qty = r.qty ?? claim.qty;
      this.confirm(
        claim,
        { qty, unitPrice: r.unitPrice ?? claim.unitPrice, seats: r.seats ?? [], row: null, sectionLabel: task.target?.sectionLabel ?? claim.sectionLabel },
        'HUMAN',
        'HUMAN',
        { cartRef: `manual-${claim.accountId}`, expiresAt: r.expiresAt ?? null, openUrl: null },
      );
    } else if (r.result === 'FAILED') {
      this.reject(claim, r.note ? `HUMAN_FAILED: ${r.note}` : 'HUMAN_FAILED', 'HUMAN');
    } else {
      this.markAmbiguous(claim, 'La persona no está segura de si entraron', null);
    }
  }

  onVerifyResponse(task: HumanTask): void {
    const claim = task.claimId ? this.ctx.store.claims.get(task.claimId) : undefined;
    if (!claim || claim.state !== 'AMBIGUOUS' || !task.response) return;
    const r = task.response;
    if (r.result === 'IN_CART') {
      this.confirm(
        claim,
        { qty: r.qty ?? claim.qty, unitPrice: r.unitPrice ?? claim.unitPrice, seats: r.seats ?? [], row: claim.row, sectionLabel: claim.sectionLabel },
        'HUMAN',
        'HUMAN',
        { cartRef: `manual-${claim.accountId}`, expiresAt: r.expiresAt ?? null, openUrl: null },
      );
    } else if (r.result === 'FAILED') {
      this.reject(claim, 'NOT_IN_CART', 'HUMAN');
    } else {
      this.askHumanToVerify(claim, 'Sigue sin saberse.');
    }
  }

  onManualTaskExpired(task: HumanTask): void {
    const claim = task.claimId ? this.ctx.store.claims.get(task.claimId) : undefined;
    if (!claim || claim.state !== 'SENT') return;
    this.markAmbiguous(claim, 'Nadie respondió a tiempo a la tarea', null);
  }

  onManualTaskCancelled(task: HumanTask): void {
    const claim = task.claimId ? this.ctx.store.claims.get(task.claimId) : undefined;
    if (!claim || claim.state !== 'SENT') return;
    this.reject(claim, 'TASK_CANCELLED', null, 'CANCELLED');
  }

  // -------------------------------------------------------------------------
  // Carritos que se pierden y recuperación
  // -------------------------------------------------------------------------

  /** El carrito se ha perdido: devuelve su cantidad para volver a repartirla. */
  private uncommitIfActive(cart: Cart): void {
    const op = this.ctx.store.operations.get(cart.operationId);
    if (!op || !['RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED'].includes(op.state)) return;
    this.applyAllocation(cart.operationId, { op: 'UNCOMMIT', ref: cart.id, accountId: cart.accountId, qty: cart.qty, amount: cart.total });
    // Si ya estaba «asegurada», vuelve a la carga mientras dure la ventana.
    if (op.state === 'CART_SECURED') this.ctx.ops.reopenAfterLoss(op.id, cart);
  }

  /** Se pagó un carrito que ya había caducado (en el último segundo): vuelve a contar. */
  recommitPaidAfterExpiry(cart: Cart): void {
    const op = this.ctx.store.operations.get(cart.operationId);
    if (!op || !['RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED'].includes(op.state)) return;
    this.applyAllocation(cart.operationId, { op: 'COMMIT_EXTERNAL', ref: cart.id, accountId: cart.accountId, qty: cart.qty, unitPrice: Math.round(cart.total / Math.max(1, cart.qty)) });
    this.ctx.ops.onProgress(cart.operationId);
  }

  onCartReleased(cart: Cart): void {
    this.uncommitIfActive(cart);
  }

  onCartExpired(cart: Cart): void {
    this.uncommitIfActive(cart);
  }

  /** Tras un reinicio: los claims que estaban en vuelo pasan a ambiguos y se reconcilian. */
  recoverInFlight(operationId: Id, eventRef: string | null): number {
    let n = 0;
    for (const c of [...this.ctx.store.claims.values()]) {
      if (c.operationId !== operationId) continue;
      if (c.state === 'PENDING' || (c.state === 'SENT' && !c.candidateId.startsWith('manual:'))) {
        this.markAmbiguous(c, 'RECOVERY: el servidor se reinició con el claim en vuelo', eventRef);
        n++;
      } else if (c.state === 'AMBIGUOUS' && eventRef) {
        const account = this.ctx.store.accounts.get(c.accountId);
        if (account && this.ctx.registry.automated(account.providerId, 'cart.read')) this.scheduleReconcile(c.id, eventRef, 1);
        n++;
      }
    }
    return n;
  }

  inFlightCount(operationId: Id): number {
    let n = 0;
    for (const c of this.ctx.store.claims.values()) {
      if (c.operationId === operationId && (c.state === 'PENDING' || c.state === 'SENT' || c.state === 'AMBIGUOUS')) n++;
    }
    return n;
  }

  cancelTimers(): void {
    for (const t of this.reconcileTimers.values()) this.ctx.clock.clearTimeout(t);
    this.reconcileTimers.clear();
  }
}
