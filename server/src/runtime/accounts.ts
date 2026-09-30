/**
 * Cuentas y sesiones (§12, §13, §14). Las cuentas son legítimas y de personas
 * reales del grupo: aquí solo se guardan alias, nunca datos personales ni
 * contraseñas. Los retos (CAPTCHA, OTP, 2FA) los resuelve siempre una persona.
 */

import type { Account, AccountInput, AccountPatch, Id, QueueInfo, SessionInfo } from '@to/shared';
import { iso } from '../util/time';
import type { Ctx } from './context';

export class AccountError extends Error {
  constructor(
    message: string,
    readonly code = 'ACCOUNT_ERROR',
  ) {
    super(message);
  }
}

const ACTIVE_STATES = new Set(['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING']);

export class AccountService {
  private readonly lastSessionPoll = new Map<Id, number>();
  private readonly queueWaitStart = new Map<Id, number>();

  constructor(private readonly ctx: Ctx) {}

  private initialSession(): SessionInfo {
    return {
      state: 'LOGGED_OUT',
      challenge: null,
      queue: { state: 'NOT_OPEN', position: null, etaMs: null, updatedAt: iso(this.ctx.now()) },
      lastCheckedAt: null,
      detail: null,
    };
  }

  get(id: Id): Account {
    const a = this.ctx.store.accounts.get(id);
    if (!a) throw new AccountError(`La cuenta ${id} no existe`, 'NOT_FOUND');
    return a;
  }

  create(input: AccountInput, actor: string): Account {
    if (!this.ctx.registry.get(input.providerId)) throw new AccountError(`Proveedor desconocido: ${input.providerId}`);
    const now = iso(this.ctx.now());
    const account: Account = {
      id: this.ctx.ids.next('acc'),
      label: input.label,
      providerId: input.providerId,
      holderRef: input.holderRef,
      householdRef: input.householdRef ?? null,
      paymentRef: input.paymentRef ?? null,
      verification: input.verification ?? 'UNVERIFIED',
      eligibility: input.eligibility && input.eligibility.length > 0 ? input.eligibility : ['*'],
      enabled: input.enabled ?? true,
      hasSecret: false,
      telegramChatId: input.telegramChatId ?? null,
      session: this.initialSession(),
      leasedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.ctx.store.putAccount(account);
    this.ctx.journal.audit('account.created', { accountId: account.id, label: account.label, providerId: account.providerId }, { actor });
    if (account.telegramChatId) this.ctx.notifier?.accountLinked?.(account);
    return account;
  }

  update(id: Id, patch: AccountPatch, actor: string): Account {
    const a = this.get(id);
    if (a.archived) throw new AccountError('Restaura la cuenta antes de editarla.', 'ARCHIVED');
    const identityChange =
      (patch.providerId !== undefined && patch.providerId !== a.providerId) ||
      (patch.holderRef !== undefined && patch.holderRef !== a.holderRef) ||
      (patch.householdRef !== undefined && patch.householdRef !== a.householdRef) ||
      (patch.paymentRef !== undefined && patch.paymentRef !== a.paymentRef);
    if (a.leasedBy && identityChange) {
      throw new AccountError('La cuenta está en una operación armada: no se puede cambiar su proveedor ni sus grupos de límite', 'LEASED');
    }
    if (patch.providerId !== undefined && !this.ctx.registry.get(patch.providerId)) throw new AccountError(`Proveedor desconocido: ${patch.providerId}`);
    const next: Account = {
      ...a,
      label: patch.label ?? a.label,
      providerId: patch.providerId ?? a.providerId,
      holderRef: patch.holderRef ?? a.holderRef,
      householdRef: patch.householdRef === undefined ? a.householdRef : patch.householdRef,
      paymentRef: patch.paymentRef === undefined ? a.paymentRef : patch.paymentRef,
      verification: patch.verification ?? a.verification,
      eligibility: patch.eligibility ?? a.eligibility,
      enabled: patch.enabled ?? a.enabled,
      telegramChatId: patch.telegramChatId === undefined ? a.telegramChatId : patch.telegramChatId,
      updatedAt: iso(this.ctx.now()),
    };
    this.ctx.store.putAccount(next);
    this.ctx.journal.audit('account.updated', { accountId: id, fields: Object.keys(patch) }, { actor });
    if (next.telegramChatId && next.telegramChatId !== a.telegramChatId) this.ctx.notifier?.accountLinked?.(next);
    return next;
  }

  archive(id: Id, archived: boolean, actor: string): Account {
    const a = this.get(id);
    if (Boolean(a.archived) === archived) return a;
    if (archived) {
      const used = [...this.ctx.store.operations.values()].some((op) =>
        op.config.accountIds.includes(id) && ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED', 'ENDED'].includes(op.state));
      if (used) throw new AccountError('Cierra o elimina primero la operación que utiliza esta cuenta.', 'LEASED');
      if ([...this.ctx.store.carts.values()].some((c) => c.accountId === id && ['ACTIVE', 'REVIEW_REQUIRED'].includes(c.state)) ||
          [...this.ctx.store.claims.values()].some((c) => c.accountId === id && ['PENDING', 'SENT', 'AMBIGUOUS'].includes(c.state))) {
        throw new AccountError('Hay un carrito o intento pendiente de revisar para esta cuenta.', 'PENDING');
      }
    }
    const next = { ...a, archived, enabled: false, updatedAt: iso(this.ctx.now()) };
    this.ctx.store.putAccount(next);
    this.ctx.journal.audit(archived ? 'account.archived' : 'account.restored', { accountId: id }, { actor });
    return next;
  }

  /** Operación activa (armada o en curso) que usa la cuenta. */
  private activeOperation(accountId: Id): Id | null {
    const a = this.ctx.store.accounts.get(accountId);
    if (!a?.leasedBy) return null;
    const op = this.ctx.store.operations.get(a.leasedBy);
    return op && ACTIVE_STATES.has(op.state) ? op.id : null;
  }

  setSession(accountId: Id, patch: Partial<SessionInfo>): Account {
    const a = this.get(accountId);
    const prev = a.session.state;
    const session: SessionInfo = { ...a.session, ...patch };
    const next: Account = { ...a, session, updatedAt: iso(this.ctx.now()) };
    this.ctx.store.putAccount(next);
    if (session.state !== prev) this.onSessionChange(next, prev);
    if (session.state === 'READY' && prev !== 'READY') {
      const opId = this.activeOperation(accountId);
      if (opId) this.ctx.runners.nudge(opId);
    }
    return next;
  }

  private onSessionChange(a: Account, prev: SessionInfo['state']): void {
    const opId = this.activeOperation(a.id);
    const { alerts } = this.ctx;
    this.ctx.journal.audit('session.changed', { accountId: a.id, from: prev, to: a.session.state }, { operationId: opId });
    if (a.session.state === 'READY') {
      alerts.resolveWhere((al) => al.accountId === a.id && ['SESSION_CHALLENGE', 'SESSION_EXPIRED', 'SESSION_NOT_READY'].includes(al.kind));
      this.ctx.tasks.completeSessionTasks(a.id);
      return;
    }
    if (a.session.state === 'CHALLENGE_REQUIRED') {
      alerts.raise({
        kind: 'SESSION_CHALLENGE',
        severity: opId ? 'CRITICAL' : 'WARNING',
        title: `${a.label}: el proveedor pide un ${a.session.challenge?.type ?? 'reto'}`,
        message: 'Resuélvelo tú en la web del proveedor y confirma en el dashboard. El sistema nunca resuelve retos.',
        actions: ['OPEN_SESSION'],
        operationId: opId,
        accountId: a.id,
      });
      this.ctx.tasks.ensureSessionTask(a, opId, 'Resuelve el reto de sesión');
    } else if (a.session.state === 'EXPIRED') {
      alerts.raise({
        kind: 'SESSION_EXPIRED',
        severity: opId ? 'CRITICAL' : 'WARNING',
        title: `${a.label}: sesión caducada`,
        message: 'Se intentará reabrir; si pide un reto tendrás que resolverlo tú.',
        actions: ['OPEN_SESSION'],
        operationId: opId,
        accountId: a.id,
      });
      if (opId) void this.openSession(a.id, 'system');
    } else if (a.session.state === 'BLOCKED') {
      alerts.raise({
        kind: 'SESSION_NOT_READY',
        severity: 'WARNING',
        title: `${a.label}: sesión bloqueada por el proveedor`,
        message: 'La cuenta no participará. Revisa la cuenta en el proveedor.',
        operationId: opId,
        accountId: a.id,
      });
    }
  }

  /** Abre sesión: automática si está autorizada; si no, tarea para una persona. */
  async openSession(accountId: Id, actor: string): Promise<Account> {
    const a = this.get(accountId);
    if (a.archived) throw new AccountError('Restaura la cuenta antes de iniciar sesión.', 'ARCHIVED');
    const opId = this.activeOperation(accountId);
    if (!this.ctx.registry.automated(a.providerId, 'session.open')) {
      this.ctx.tasks.ensureSessionTask(a, opId, 'Inicia sesión');
      return a;
    }
    if (a.session.state === 'READY' || a.session.state === 'OPENING') return a;
    this.setSession(accountId, { state: 'OPENING', detail: null });
    const r = await this.ctx.gateway.call(
      { providerId: a.providerId, capability: 'session.open', stage: 'provider.session', operationId: opId, accountId },
      (ad) => ad.openSession?.(accountId),
    );
    this.ctx.journal.audit('session.open_requested', { accountId, ok: r.ok }, { operationId: opId, actor });
    if (r.ok) return this.setSession(accountId, { ...r.value, queue: this.get(accountId).session.queue });
    return this.setSession(accountId, {
      state: 'UNKNOWN',
      detail: r.blocked ? r.detail : r.error.message,
      lastCheckedAt: iso(this.ctx.now()),
    });
  }

  /** Una persona confirma que la sesión está lista (resolvió el reto, inició sesión o volvió a entrar en la cola). */
  humanReady(accountId: Id, actor: string, note?: string): Account {
    const a = this.get(accountId);
    if (a.archived) throw new AccountError('Restaura la cuenta antes de utilizarla.', 'ARCHIVED');
    this.ctx.sim?.humanCompletedChallenge(accountId);
    this.ctx.journal.audit('session.human_ready', { accountId, note: note ?? null }, { operationId: this.activeOperation(accountId), actor });
    const manual = !this.ctx.registry.automated(a.providerId, 'queue.status');
    const opId = this.activeOperation(accountId);
    let next = this.setSession(accountId, {
      state: 'READY',
      challenge: null,
      detail: note ?? 'Confirmada por una persona',
      lastCheckedAt: iso(this.ctx.now()),
      // En asistencia manual la cola la gestiona la persona: se considera dentro.
      ...(manual ? { queue: { state: 'PASSED', position: null, etaMs: null, updatedAt: iso(this.ctx.now()) } } : {}),
    });
    // Cola automática caducada o bloqueada: la persona ha vuelto a entrar y se consulta de nuevo.
    if (!manual && opId && (a.session.queue.state === 'EXPIRED' || a.session.queue.state === 'BLOCKED')) {
      this.resetQueue(accountId);
      this.ctx.alerts.resolveWhere((al) => al.accountId === accountId && al.kind === 'QUEUE_PROBLEM', actor);
      next = this.get(accountId);
    }
    if (opId) this.ctx.runners.nudge(opId);
    return next;
  }

  async pollSession(accountId: Id): Promise<void> {
    const a = this.get(accountId);
    if (!this.ctx.registry.automated(a.providerId, 'session.status')) return;
    if (a.session.state === 'OPENING') return;
    this.lastSessionPoll.set(accountId, this.ctx.now());
    const r = await this.ctx.gateway.call(
      { providerId: a.providerId, capability: 'session.status', stage: 'provider.session', operationId: this.activeOperation(accountId), accountId },
      (ad) => ad.sessionStatus?.(accountId),
    );
    if (!r.ok) return;
    const current = this.get(accountId);
    this.setSession(accountId, { state: r.value.state, challenge: r.value.challenge, detail: r.value.detail, lastCheckedAt: r.value.lastCheckedAt, queue: current.session.queue });
  }

  async pollQueue(accountId: Id, operationId: Id, eventRef: string): Promise<QueueInfo | null> {
    const a = this.get(accountId);
    const r = await this.ctx.gateway.call(
      { providerId: a.providerId, capability: 'queue.status', stage: 'provider.queue', operationId, accountId },
      (ad) => ad.queueStatus?.(accountId, eventRef),
    );
    if (!r.ok) return null;
    const q = r.value;
    const prev = this.get(accountId).session.queue;
    if (q.state === 'WAITING' && !this.queueWaitStart.has(accountId)) this.queueWaitStart.set(accountId, this.ctx.now());
    if (q.state === 'PASSED' && prev.state !== 'PASSED') {
      const started = this.queueWaitStart.get(accountId);
      if (started !== undefined) this.ctx.metrics.record(operationId, 'queue_wait', this.ctx.now() - started);
      this.queueWaitStart.delete(accountId);
      this.ctx.journal.audit('queue.passed', { accountId }, { operationId });
    }
    if ((q.state === 'EXPIRED' || q.state === 'BLOCKED') && prev.state !== q.state) {
      this.ctx.alerts.raise({
        kind: 'QUEUE_PROBLEM',
        severity: 'WARNING',
        title: `${a.label}: cola ${q.state === 'EXPIRED' ? 'caducada' : 'bloqueada'}`,
        message: 'Esta cuenta no sigue en la operación hasta que una persona vuelva a entrar en la cola y lo confirme en Cuentas («De vuelta en la cola»).',
        actions: ['OPEN_SESSION'],
        operationId,
        accountId,
      });
    }
    this.setSession(accountId, { queue: q });
    return q;
  }

  /** Reinicia el estado de cola (nueva operación sobre la misma cuenta). */
  resetQueue(accountId: Id): void {
    this.queueWaitStart.delete(accountId);
    this.setSession(accountId, { queue: { state: 'NOT_OPEN', position: null, etaMs: null, updatedAt: iso(this.ctx.now()) } });
  }

  lease(accountIds: Id[], operationId: Id): void {
    for (const id of accountIds) {
      const a = this.get(id);
      this.ctx.store.putAccount({ ...a, leasedBy: operationId, updatedAt: iso(this.ctx.now()) });
      this.resetQueue(id);
      // En asistencia manual «Sesión lista» lo dice una persona: cada compra
      // exige confirmarlo de nuevo (una confirmación de un ensayo no vale).
      if (!this.ctx.registry.automated(a.providerId, 'session.open') && a.session.state === 'READY') {
        this.setSession(id, { state: 'LOGGED_OUT', challenge: null, detail: 'Confirma «Sesión lista» para esta compra' });
      }
    }
  }

  release(operationId: Id): void {
    for (const a of this.ctx.store.accounts.values()) {
      if (a.leasedBy === operationId) this.ctx.store.putAccount({ ...a, leasedBy: null, updatedAt: iso(this.ctx.now()) });
    }
  }

  /** Prepara las sesiones de una operación recién armada. */
  warmUp(accountIds: Id[]): void {
    for (const id of accountIds) {
      const a = this.ctx.store.accounts.get(id);
      if (!a || a.session.state === 'READY') continue;
      void this.openSession(id, 'system');
    }
  }

  /** Mantenimiento periódico: refresca sesiones de las cuentas en operaciones activas. */
  maintenanceTick(): void {
    const now = this.ctx.now();
    for (const a of this.ctx.store.accounts.values()) {
      if (!this.activeOperation(a.id)) continue;
      const last = this.lastSessionPoll.get(a.id) ?? 0;
      if (now - last < this.ctx.cfg.sessionPollMs) continue;
      const observedBrowser = this.ctx.registry.get(a.providerId)?.mode === 'BROWSER_SESSION';
      if (!observedBrowser && (a.session.state === 'CHALLENGE_REQUIRED' || a.session.state === 'LOGGED_OUT')) {
        this.lastSessionPoll.set(a.id, now);
        continue;
      }
      void this.pollSession(a.id);
    }
  }
}
