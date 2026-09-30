/**
 * Kill switches y circuit breakers (§26).
 *
 * Kill switch: parada inmediata por ámbito (global, proveedor, operación,
 * cuenta). El gateway lo comprueba antes de CADA llamada al proveedor.
 *
 * Circuit breaker por proveedor+capability: se abre tras N fallos seguidos y
 * se reabre a prueba tras un enfriamiento. Un cambio de esquema lo abre con
 * reinicio manual obligatorio.
 */

import { killSwitchKey, type CapabilityName, type CircuitState, type Id, type KillScope, type KillSwitch } from '@to/shared';
import { iso } from '../util/time';
import type { Ctx } from './context';

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class SafetyService {
  private readonly halfOpenTrial = new Set<string>();

  constructor(private readonly ctx: Ctx) {}

  // -------------------------------------------------------------------------
  // Kill switches
  // -------------------------------------------------------------------------

  setKillSwitch(scope: KillScope, targetId: string | null, engaged: boolean, reason: string | null, actor: string): KillSwitch {
    if (scope !== 'GLOBAL' && !targetId) throw new Error('Este ámbito necesita un objetivo');
    const key = killSwitchKey(scope, targetId);
    const ks: KillSwitch = {
      key,
      scope,
      targetId: scope === 'GLOBAL' ? null : targetId,
      engaged,
      reason: reason ?? null,
      actor,
      at: iso(this.ctx.now()),
    };
    this.ctx.store.putKillSwitch(ks);
    this.ctx.journal.audit(engaged ? 'kill_switch.engaged' : 'kill_switch.released', { key, scope, targetId, reason }, {
      actor,
      operationId: scope === 'OPERATION' ? targetId : null,
    });
    if (engaged) {
      this.ctx.alerts.raise({
        kind: 'KILL_SWITCH',
        severity: 'CRITICAL',
        title: `Kill switch ${this.describe(ks)} activado`,
        message: reason ? `Motivo: ${reason}` : 'Toda acción automática en este ámbito está detenida.',
        operationId: scope === 'OPERATION' ? targetId : null,
        accountId: scope === 'ACCOUNT' ? targetId : null,
        dedupeKey: `kill:${key}`,
      });
      this.ctx.runners?.onKillSwitch(ks);
      if (ks.scope === 'ACCOUNT' && ks.targetId) this.tellAccountToStop(ks.targetId, reason);
    } else {
      this.ctx.alerts.resolveKey(`kill:${key}`, actor);
    }
    this.ctx.hub.publish({ type: 'system', data: this.ctx.ops.systemStatus() });
    return ks;
  }

  /** Ámbito con nombres, no ids: «global», «de la cuenta «Eva»», «de la operación «Real Madrid»». */
  private describe(ks: Pick<KillSwitch, 'scope' | 'targetId'>): string {
    const id = ks.targetId ?? '';
    switch (ks.scope) {
      case 'GLOBAL':
        return 'global';
      case 'PROVIDER':
        return `del proveedor ${this.ctx.registry.descriptor(id)?.name ?? id}`;
      case 'OPERATION':
        return `de la operación «${this.ctx.store.operations.get(id)?.config.name ?? id}»`;
      case 'ACCOUNT':
        return `de la cuenta «${this.ctx.store.accounts.get(id)?.label ?? id}»`;
    }
  }

  /**
   * Parar una cuenta no pausa la operación, pero si esa persona tiene una tarea de compra
   * abierta (asistencia manual) está comprando ahora mismo en la web oficial: se le dice que pare.
   */
  private tellAccountToStop(accountId: Id, reason: string | null): void {
    const buying = [...this.ctx.store.humanTasks.values()].some((t) => t.accountId === accountId && t.kind === 'ADD_TO_CART' && t.state === 'OPEN');
    if (!buying) return;
    const label = this.ctx.store.accounts.get(accountId)?.label ?? accountId;
    this.ctx.notifier?.announce?.(
      `⏸ <b>Cuenta «${esc(label)}» parada</b>${reason ? ` (${esc(reason)})` : ''}\n` +
        'No añadas nada más al carrito con esta cuenta. Si ya tienes entradas en el carrito, respóndelo en tu tarea; si no, pulsa «No pude» para que se repartan.',
      [accountId],
      null,
    );
  }

  engagedFor(scope: { providerId?: string | null; operationId?: Id | null; accountId?: Id | null }): KillSwitch | null {
    const ks = this.ctx.store.killSwitches;
    const check = (key: string) => {
      const k = ks.get(key);
      return k?.engaged ? k : null;
    };
    return (
      check('global') ??
      (scope.providerId ? check(killSwitchKey('PROVIDER', scope.providerId)) : null) ??
      (scope.operationId ? check(killSwitchKey('OPERATION', scope.operationId)) : null) ??
      (scope.accountId ? check(killSwitchKey('ACCOUNT', scope.accountId)) : null)
    );
  }

  engagedList(providerId: string, operationId: Id, accountIds: Id[]): KillSwitch[] {
    const out: KillSwitch[] = [];
    const keys = [
      'global',
      killSwitchKey('PROVIDER', providerId),
      killSwitchKey('OPERATION', operationId),
      ...accountIds.map((a) => killSwitchKey('ACCOUNT', a)),
    ];
    for (const k of keys) {
      const s = this.ctx.store.killSwitches.get(k);
      if (s?.engaged) out.push(s);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Circuitos
  // -------------------------------------------------------------------------

  circuit(providerId: string, capability: CapabilityName): CircuitState {
    const key = `${providerId}:${capability}`;
    const existing = this.ctx.store.circuits.get(key);
    if (existing) return existing;
    const c: CircuitState = {
      key,
      providerId,
      capability,
      state: 'CLOSED',
      reason: null,
      requiresManualReset: false,
      openedAt: null,
      failures: 0,
      updatedAt: iso(this.ctx.now()),
    };
    this.ctx.store.circuits.set(key, c);
    return c;
  }

  /** ¿Se puede llamar ahora? En HALF_OPEN deja pasar una única llamada de prueba. */
  allow(providerId: string, capability: CapabilityName): boolean {
    const c = this.circuit(providerId, capability);
    if (c.state === 'CLOSED') return true;
    if (c.requiresManualReset) return false;
    if (c.state === 'OPEN') {
      const opened = c.openedAt ? Date.parse(c.openedAt) : 0;
      if (this.ctx.now() - opened < this.ctx.cfg.circuitCooldownMs) return false;
      this.update(c, { state: 'HALF_OPEN' });
    }
    if (this.halfOpenTrial.has(c.key)) return false;
    this.halfOpenTrial.add(c.key);
    return true;
  }

  recordSuccess(providerId: string, capability: CapabilityName): void {
    const c = this.circuit(providerId, capability);
    this.halfOpenTrial.delete(c.key);
    if (c.state === 'CLOSED' && c.failures === 0) return;
    const wasOpen = c.state !== 'CLOSED';
    this.update(c, { state: 'CLOSED', failures: 0, reason: null, openedAt: null });
    if (wasOpen) this.ctx.alerts.resolveKey(`circuit:${c.key}`);
  }

  recordFailure(providerId: string, capability: CapabilityName, reason: string, opts: { manualReset?: boolean } = {}): void {
    const c = this.circuit(providerId, capability);
    this.halfOpenTrial.delete(c.key);
    const failures = c.failures + 1;
    const shouldOpen = opts.manualReset || c.state === 'HALF_OPEN' || failures >= this.ctx.cfg.circuitFailureThreshold;
    if (!shouldOpen) {
      this.update(c, { failures, reason });
      return;
    }
    const alreadyOpen = c.state === 'OPEN';
    this.update(c, {
      state: 'OPEN',
      failures,
      reason,
      openedAt: iso(this.ctx.now()),
      requiresManualReset: c.requiresManualReset || Boolean(opts.manualReset),
    });
    if (!alreadyOpen || opts.manualReset) {
      this.ctx.journal.audit('circuit.opened', { key: c.key, reason, manualReset: Boolean(opts.manualReset) });
      this.ctx.alerts.raise({
        kind: 'CIRCUIT_OPEN',
        severity: opts.manualReset ? 'CRITICAL' : 'WARNING',
        title: `Circuito abierto: ${capability} (${providerId})`,
        message: opts.manualReset
          ? `${reason}. Necesita revisión humana: reinícialo desde Seguridad cuando esté resuelto.`
          : `${reason}. Se reintentará sola en ${Math.round(this.ctx.cfg.circuitCooldownMs / 1000)} s.`,
        dedupeKey: `circuit:${c.key}`,
      });
    }
  }

  reset(key: string, actor: string): CircuitState | null {
    const c = this.ctx.store.circuits.get(key);
    if (!c) return null;
    this.halfOpenTrial.delete(key);
    const updated = this.update(c, { state: 'CLOSED', failures: 0, reason: null, openedAt: null, requiresManualReset: false });
    this.ctx.journal.audit('circuit.reset', { key }, { actor });
    this.ctx.alerts.resolveKey(`circuit:${key}`, actor);
    return updated;
  }

  openCircuitsFor(providerId: string): CircuitState[] {
    return [...this.ctx.store.circuits.values()].filter((c) => c.providerId === providerId && c.state !== 'CLOSED');
  }

  private update(c: CircuitState, patch: Partial<CircuitState>): CircuitState {
    const next: CircuitState = { ...c, ...patch, updatedAt: iso(this.ctx.now()) };
    this.ctx.store.putCircuit(next);
    return next;
  }
}
