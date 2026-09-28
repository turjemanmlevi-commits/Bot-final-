/**
 * Tareas humanas (§14, gate G5). Todo lo que el sistema no puede o no debe
 * hacer solo (iniciar sesión, resolver retos, añadir al carrito en modo manual,
 * verificar un carrito dudoso) se convierte en una tarea con instrucciones
 * concretas para una persona, que responde desde el dashboard o Telegram.
 */

import type { Account, HumanTask, HumanTaskKind, HumanTaskResponse, HumanTaskResponseInput, Id } from '@to/shared';
import { iso } from '../util/time';
import type { Ctx } from './context';

export class TaskError extends Error {
  constructor(
    message: string,
    readonly code = 'TASK_ERROR',
  ) {
    super(message);
  }
}

export interface CreateTaskInput {
  operationId: Id | null;
  accountId: Id;
  kind: HumanTaskKind;
  claimId?: Id | null;
  title: string;
  instructions: string;
  target?: HumanTask['target'];
  deadlineMs?: number | null;
  /** false cuando ya existe otra alerta que explica el problema (reto, reconciliación). */
  alert?: boolean;
  /** Enlace oficial para la persona; si no se indica, el del evento o el del proveedor. */
  link?: string | null;
}

export class HumanTaskService {
  constructor(private readonly ctx: Ctx) {}

  create(input: CreateTaskInput): HumanTask {
    const now = this.ctx.now();
    const task: HumanTask = {
      id: this.ctx.ids.next('tsk'),
      operationId: input.operationId,
      accountId: input.accountId,
      kind: input.kind,
      claimId: input.claimId ?? null,
      title: input.title,
      instructions: input.instructions,
      target: input.target ?? null,
      state: 'OPEN',
      deadlineAt: input.deadlineMs === null || input.deadlineMs === undefined ? null : iso(now + input.deadlineMs),
      createdAt: iso(now),
      respondedAt: null,
      response: null,
      link: input.link === undefined ? this.officialLink(input.operationId, input.accountId) : input.link,
    };
    this.ctx.store.putHumanTask(task);
    this.ctx.journal.audit('human_task.created', { taskId: task.id, kind: task.kind, accountId: task.accountId, claimId: task.claimId }, { operationId: task.operationId });
    const account = this.ctx.store.accounts.get(task.accountId);
    if (input.alert !== false) this.ctx.alerts.raise({
      kind: 'HUMAN_TASK',
      severity: 'WARNING',
      title: `Tarea para ${account?.label ?? task.accountId}: ${task.title}`,
      message: task.instructions,
      actions: input.kind === 'OPEN_SESSION' ? ['OPEN_SESSION'] : input.kind === 'VERIFY_CART' ? ['OPEN_CART'] : [],
      operationId: task.operationId,
      accountId: task.accountId,
      claimId: task.claimId,
      dedupeKey: `task:${task.id}`,
    });
    this.ctx.notifier?.notifyTask(task);
    return task;
  }

  /**
   * Página oficial donde la persona hace la acción: la del evento de la
   * operación si el vault la tiene; si no, la web del proveedor de la cuenta.
   */
  officialLink(operationId: Id | null, accountId: Id): string | null {
    const { store, registry } = this.ctx;
    const op = operationId ? store.operations.get(operationId) : undefined;
    const event = op ? store.events.get(op.config.eventId) : undefined;
    if (event?.url) return event.url;
    const account = store.accounts.get(accountId);
    const providerId = op?.config.providerId ?? account?.providerId;
    return providerId ? (registry.authorization(providerId)?.url ?? null) : null;
  }

  openFor(accountId: Id, kind: HumanTaskKind, operationId?: Id | null): HumanTask | undefined {
    for (const t of this.ctx.store.humanTasks.values()) {
      if (t.accountId === accountId && t.kind === kind && t.state === 'OPEN' && (operationId === undefined || t.operationId === operationId)) return t;
    }
    return undefined;
  }

  /** Crea (si no existe ya) la tarea de abrir sesión / resolver reto para una cuenta. */
  ensureSessionTask(account: Account, operationId: Id | null, title: string): HumanTask {
    const existing = this.openFor(account.id, 'OPEN_SESSION');
    if (existing) return existing;
    const provider = this.ctx.registry.descriptor(account.providerId)?.name ?? account.providerId;
    const challenge = account.session.challenge;
    return this.create({
      operationId,
      accountId: account.id,
      kind: 'OPEN_SESSION',
      alert: !challenge,
      title,
      instructions: challenge
        ? `Entra en ${provider} con la cuenta "${account.label}", resuelve el ${challenge.type} y pulsa "Sesión lista".`
        : `Inicia sesión en ${provider} con la cuenta "${account.label}" en tu navegador (en la web oficial) y pulsa "Sesión lista".`,
    });
  }

  /** La sesión quedó lista por otra vía: da por hechas sus tareas de sesión. */
  completeSessionTasks(accountId: Id): void {
    for (const t of [...this.ctx.store.humanTasks.values()]) {
      if (t.accountId === accountId && t.kind === 'OPEN_SESSION' && t.state === 'OPEN') {
        this.finish(t, 'DONE', { result: 'READY', actor: 'system', note: 'Sesión lista' });
      }
    }
  }

  private finish(t: HumanTask, state: HumanTask['state'], response: HumanTaskResponse | null): HumanTask {
    const now = this.ctx.now();
    const next: HumanTask = { ...t, state, response, respondedAt: iso(now) };
    this.ctx.store.putHumanTask(next);
    this.ctx.alerts.resolveKey(`task:${t.id}`, response?.actor ?? 'system');
    if (t.operationId && response && response.actor !== 'system') {
      this.ctx.metrics.record(t.operationId, 'human_task', now - Date.parse(t.createdAt));
    }
    return next;
  }

  respond(taskId: Id, input: HumanTaskResponseInput, actor: string): HumanTask {
    const t = this.ctx.store.humanTasks.get(taskId);
    if (!t) throw new TaskError('La tarea no existe', 'NOT_FOUND');
    if (t.state !== 'OPEN' && t.state !== 'UNKNOWN') throw new TaskError('La tarea ya no está abierta', 'NOT_OPEN');
    const allowed: Record<HumanTaskKind, HumanTaskResponse['result'][]> = {
      OPEN_SESSION: ['READY', 'FAILED'],
      ADD_TO_CART: ['IN_CART', 'FAILED', 'UNKNOWN'],
      VERIFY_CART: ['IN_CART', 'FAILED', 'UNKNOWN'],
    };
    if (!allowed[t.kind].includes(input.result)) throw new TaskError(`Respuesta no válida para esta tarea: ${input.result}`, 'BAD_RESPONSE');
    if (input.result === 'IN_CART' && (input.qty === undefined || input.unitPrice === undefined)) {
      throw new TaskError('Indica cuántas entradas y a qué precio quedaron en el carrito', 'BAD_RESPONSE');
    }
    const response: HumanTaskResponse = { ...input, actor };
    const state: HumanTask['state'] =
      input.result === 'IN_CART' || input.result === 'READY' ? 'DONE' : input.result === 'FAILED' ? 'FAILED' : 'UNKNOWN';
    const done = this.finish(t, state, response);
    this.ctx.journal.audit('human_task.responded', { taskId, kind: t.kind, result: input.result, qty: input.qty ?? null, unitPrice: input.unitPrice ?? null }, { operationId: t.operationId, actor });

    if (t.kind === 'OPEN_SESSION') {
      if (input.result === 'READY') this.ctx.accounts.humanReady(t.accountId, actor, input.note);
    } else if (t.kind === 'ADD_TO_CART') {
      this.ctx.claims.onManualAddResponse(done);
    } else {
      this.ctx.claims.onVerifyResponse(done);
    }
    return this.ctx.store.humanTasks.get(taskId) ?? done;
  }

  /** Cancela las tareas abiertas de una operación que ya no las necesita. */
  cancelOpenFor(operationId: Id, reason: string): void {
    for (const t of [...this.ctx.store.humanTasks.values()]) {
      if (t.operationId !== operationId || t.state !== 'OPEN') continue;
      if (t.kind === 'VERIFY_CART') continue; // una verificación pendiente sigue siendo necesaria
      const next = this.finish(t, 'CANCELLED', { result: 'FAILED', actor: 'system', note: reason });
      if (t.kind === 'ADD_TO_CART') this.ctx.claims.onManualTaskCancelled(next);
    }
  }

  expireTick(): void {
    const now = this.ctx.now();
    for (const t of [...this.ctx.store.humanTasks.values()]) {
      if (t.state !== 'OPEN' || !t.deadlineAt || Date.parse(t.deadlineAt) > now) continue;
      const next = this.finish(t, 'EXPIRED', null);
      this.ctx.journal.audit('human_task.expired', { taskId: t.id, kind: t.kind }, { operationId: t.operationId });
      if (t.kind === 'ADD_TO_CART') this.ctx.claims.onManualTaskExpired(next);
    }
  }
}
