/**
 * Alertas accionables (§22, §23): deduplicadas por clave, con acciones
 * concretas para una persona y reenviadas a Telegram si está configurado.
 */

import type { Alert, AlertAction, AlertKind, AlertSeverity, Id } from '@to/shared';
import { iso } from '../util/time';
import type { Ctx } from './context';

export interface RaiseInput {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
  actions?: AlertAction[];
  operationId?: Id | null;
  accountId?: Id | null;
  cartId?: Id | null;
  claimId?: Id | null;
  dedupeKey?: string;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
const MAX_RESOLVED = 500;

export class AlertService {
  constructor(private readonly ctx: Ctx) {}

  private openByKey(key: string): Alert | undefined {
    for (const a of this.ctx.store.alerts.values()) if (a.dedupeKey === key && a.state !== 'RESOLVED') return a;
    return undefined;
  }

  raise(input: RaiseInput): Alert {
    const { store, journal } = this.ctx;
    const key =
      input.dedupeKey ??
      [input.kind, input.operationId ?? '', input.accountId ?? '', input.cartId ?? '', input.claimId ?? ''].join(':');
    const now = iso(this.ctx.now());
    const existing = this.openByKey(key);
    if (existing) {
      const escalated = SEVERITY_ORDER[input.severity] > SEVERITY_ORDER[existing.severity];
      const updated: Alert = {
        ...existing,
        title: input.title,
        message: input.message,
        severity: escalated ? input.severity : existing.severity,
        actions: input.actions ?? existing.actions,
        state: escalated ? 'OPEN' : existing.state,
        updatedAt: now,
      };
      store.putAlert(updated);
      if (escalated) this.ctx.notifier?.notifyAlert(updated);
      this.touchOperation(updated.operationId);
      return updated;
    }
    const alert: Alert = {
      id: this.ctx.ids.next('alr'),
      operationId: input.operationId ?? null,
      accountId: input.accountId ?? null,
      cartId: input.cartId ?? null,
      claimId: input.claimId ?? null,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      message: input.message,
      actions: input.actions ?? [],
      state: 'OPEN',
      dedupeKey: key,
      createdAt: now,
      updatedAt: now,
    };
    store.putAlert(alert);
    journal.audit('alert.raised', { alertId: alert.id, kind: alert.kind, severity: alert.severity, title: alert.title }, { operationId: alert.operationId });
    this.ctx.notifier?.notifyAlert(alert);
    this.touchOperation(alert.operationId);
    this.prune();
    return alert;
  }

  ack(id: Id, actor: string): Alert | null {
    const a = this.ctx.store.alerts.get(id);
    if (!a || a.state !== 'OPEN') return a ?? null;
    const updated: Alert = { ...a, state: 'ACKED', updatedAt: iso(this.ctx.now()) };
    this.ctx.store.putAlert(updated);
    this.ctx.journal.audit('alert.acked', { alertId: id }, { operationId: a.operationId, actor });
    this.touchOperation(a.operationId);
    return updated;
  }

  resolve(id: Id, actor = 'system'): Alert | null {
    const a = this.ctx.store.alerts.get(id);
    if (!a || a.state === 'RESOLVED') return a ?? null;
    const updated: Alert = { ...a, state: 'RESOLVED', updatedAt: iso(this.ctx.now()) };
    this.ctx.store.putAlert(updated);
    this.ctx.journal.audit('alert.resolved', { alertId: id, kind: a.kind }, { operationId: a.operationId, actor });
    this.touchOperation(a.operationId);
    return updated;
  }

  resolveKey(key: string, actor = 'system'): void {
    const a = this.openByKey(key);
    if (a) this.resolve(a.id, actor);
  }

  /** Resuelve todas las alertas abiertas que cumplan la condición (p. ej. la sesión ya está lista). */
  resolveWhere(pred: (a: Alert) => boolean, actor = 'system'): void {
    for (const a of [...this.ctx.store.alerts.values()]) if (a.state !== 'RESOLVED' && pred(a)) this.resolve(a.id, actor);
  }

  openCount(operationId: Id): number {
    let n = 0;
    for (const a of this.ctx.store.alerts.values()) if (a.operationId === operationId && a.state !== 'RESOLVED') n++;
    return n;
  }

  private touchOperation(operationId: Id | null): void {
    if (operationId) this.ctx.ops?.publishSummary(operationId);
  }

  private prune(): void {
    const resolved = [...this.ctx.store.alerts.values()].filter((a) => a.state === 'RESOLVED');
    if (resolved.length <= MAX_RESOLVED) return;
    resolved.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const a of resolved.slice(0, resolved.length - MAX_RESOLVED)) {
      this.ctx.store.alerts.delete(a.id);
      this.ctx.journal.remove('alert', a.id);
      this.ctx.hub.remove('alert', a.id);
    }
  }
}
