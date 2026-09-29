/**
 * Asignación (§17). Mantiene los invariantes de la operación:
 *
 *   carted + claimed ≤ requested
 *   usado(cuenta) ≤ límite por cuenta,   usado(grupo) ≤ límite por grupo
 *   comprometido + reservado ≤ presupuesto
 *
 * Todas las operaciones son puras (devuelven un estado nuevo con versión +1) y
 * se registran en el journal para poder reproducirlas en el replay.
 */

import type { AllocationState, EventLimits, Id, Minor } from '@to/shared';
import type { AccountCapacity } from './decision';

export type AllocationOp =
  | { op: 'RESERVE'; claimId: Id; accountId: Id; qty: number; unitPrice: Minor }
  | { op: 'CONFIRM'; claimId: Id; accountId: Id; reservedQty: number; reservedUnitPrice: Minor; qty: number; unitPrice: Minor }
  | { op: 'RELEASE'; claimId: Id; accountId: Id; qty: number; unitPrice: Minor }
  | { op: 'FREEZE'; claimId: Id; qty: number }
  | { op: 'UNFREEZE'; claimId: Id; qty: number }
  | { op: 'COMMIT_EXTERNAL'; ref: Id; accountId: Id; qty: number; unitPrice: Minor }
  | { op: 'UNCOMMIT'; ref: Id; accountId: Id; qty: number; amount: Minor }
  | { op: 'SET_REQUESTED'; qty: number }
  | { op: 'SET_MAX_PRICE'; maxUnitPrice: Minor };

export type AllocationWarning = 'PRICE_ABOVE_MAX' | 'OVER_BUDGET' | 'OVER_ACCOUNT_LIMIT' | 'OVER_GROUP_LIMIT' | 'OVER_REQUESTED';

export type AllocationResult =
  | { ok: true; state: AllocationState; warnings: AllocationWarning[] }
  | { ok: false; error: string };

export function initAllocation(params: {
  operationId: Id;
  currency: string;
  requestedQty: number;
  maxUnitPrice: Minor;
  budget: Minor;
  limits: EventLimits;
  accounts: Array<{ id: Id; groupKey: string }>;
  /** Tope por cuenta de esta operación (más estricto que el oficial), o null. */
  perAccountCap?: number | null;
}): AllocationState {
  const perAccount: AllocationState['perAccount'] = {};
  const perGroup: AllocationState['perGroup'] = {};
  for (const a of params.accounts) {
    const cap = params.perAccountCap && params.perAccountCap > 0 ? Math.min(params.limits.perAccount, params.perAccountCap) : params.limits.perAccount;
    perAccount[a.id] = { cap, used: 0, groupKey: a.groupKey };
    perGroup[a.groupKey] ??= { cap: params.limits.perGroup, used: 0 };
  }
  const requestedQty = Math.min(params.requestedQty, params.limits.perOperation);
  return {
    operationId: params.operationId,
    version: 0,
    currency: params.currency,
    requestedQty,
    cartedQty: 0,
    claimedQty: 0,
    frozenQty: 0,
    remainingQty: requestedQty,
    budget: { total: params.budget, committed: 0, reserved: 0, remaining: params.budget },
    maxUnitPrice: params.maxUnitPrice,
    perAccount,
    perGroup,
  };
}

export function capacityOf(state: AllocationState, accountId: Id): AccountCapacity {
  const acct = state.perAccount[accountId];
  if (!acct) return { accountRemaining: 0, groupRemaining: 0, operationRemaining: 0, budgetRemaining: 0 };
  const group = state.perGroup[acct.groupKey];
  return {
    accountRemaining: Math.max(0, acct.cap - acct.used),
    groupRemaining: group ? Math.max(0, group.cap - group.used) : 0,
    operationRemaining: state.remainingQty,
    budgetRemaining: state.budget.remaining,
  };
}

/** Cantidad máxima que una cuenta puede pedir ahora mismo. */
export function wantFor(state: AllocationState, accountId: Id): number {
  const c = capacityOf(state, accountId);
  return Math.min(c.accountRemaining, c.groupRemaining, c.operationRemaining);
}

function clone(state: AllocationState): AllocationState {
  const perAccount: AllocationState['perAccount'] = {};
  for (const [k, v] of Object.entries(state.perAccount)) perAccount[k] = { ...v };
  const perGroup: AllocationState['perGroup'] = {};
  for (const [k, v] of Object.entries(state.perGroup)) perGroup[k] = { ...v };
  return { ...state, budget: { ...state.budget }, perAccount, perGroup };
}

function finish(s: AllocationState): AllocationState {
  s.remainingQty = Math.max(0, s.requestedQty - s.cartedQty - s.claimedQty);
  s.budget.remaining = s.budget.total - s.budget.committed - s.budget.reserved;
  s.version += 1;
  return s;
}

function usage(s: AllocationState, accountId: Id): { acct: AllocationState['perAccount'][string]; group: AllocationState['perGroup'][string] } | null {
  const acct = s.perAccount[accountId];
  if (!acct) return null;
  const group = s.perGroup[acct.groupKey];
  if (!group) return null;
  return { acct, group };
}

export function applyAllocation(state: AllocationState, op: AllocationOp): AllocationResult {
  const s = clone(state);
  const warnings: AllocationWarning[] = [];
  switch (op.op) {
    case 'RESERVE': {
      const u = usage(s, op.accountId);
      if (!u) return { ok: false, error: `Cuenta ${op.accountId} fuera de la operación` };
      if (!Number.isInteger(op.qty) || op.qty < 1) return { ok: false, error: 'Cantidad inválida' };
      if (u.acct.used + op.qty > u.acct.cap) return { ok: false, error: 'Supera el límite por cuenta' };
      if (u.group.used + op.qty > u.group.cap) return { ok: false, error: 'Supera el límite del grupo' };
      if (s.cartedQty + s.claimedQty + op.qty > s.requestedQty) return { ok: false, error: 'Supera la cantidad pedida' };
      if (op.unitPrice > s.maxUnitPrice) return { ok: false, error: 'Supera el precio máximo' };
      if (s.budget.committed + s.budget.reserved + op.qty * op.unitPrice > s.budget.total) return { ok: false, error: 'Supera el presupuesto' };
      u.acct.used += op.qty;
      u.group.used += op.qty;
      s.claimedQty += op.qty;
      s.budget.reserved += op.qty * op.unitPrice;
      break;
    }
    case 'CONFIRM': {
      const u = usage(s, op.accountId);
      if (!u) return { ok: false, error: `Cuenta ${op.accountId} fuera de la operación` };
      if (op.reservedQty > s.claimedQty) return { ok: false, error: 'Confirmación sin reserva' };
      if (op.qty < 0) return { ok: false, error: 'Cantidad inválida' };
      s.claimedQty -= op.reservedQty;
      s.budget.reserved -= op.reservedQty * op.reservedUnitPrice;
      u.acct.used += op.qty - op.reservedQty;
      u.group.used += op.qty - op.reservedQty;
      s.cartedQty += op.qty;
      s.budget.committed += op.qty * op.unitPrice;
      if (op.unitPrice > s.maxUnitPrice) warnings.push('PRICE_ABOVE_MAX');
      if (u.acct.used > u.acct.cap) warnings.push('OVER_ACCOUNT_LIMIT');
      if (u.group.used > u.group.cap) warnings.push('OVER_GROUP_LIMIT');
      if (s.cartedQty + s.claimedQty > s.requestedQty) warnings.push('OVER_REQUESTED');
      if (s.budget.committed + s.budget.reserved > s.budget.total) warnings.push('OVER_BUDGET');
      break;
    }
    case 'RELEASE': {
      const u = usage(s, op.accountId);
      if (!u) return { ok: false, error: `Cuenta ${op.accountId} fuera de la operación` };
      if (op.qty > s.claimedQty) return { ok: false, error: 'Liberación sin reserva' };
      u.acct.used -= op.qty;
      u.group.used -= op.qty;
      s.claimedQty -= op.qty;
      s.budget.reserved -= op.qty * op.unitPrice;
      break;
    }
    case 'FREEZE':
      s.frozenQty += op.qty;
      break;
    case 'UNFREEZE':
      s.frozenQty = Math.max(0, s.frozenQty - op.qty);
      break;
    case 'COMMIT_EXTERNAL': {
      // Entradas que una persona puso en el carrito (manual-assist): se registran tal cual.
      const u = usage(s, op.accountId);
      if (!u) return { ok: false, error: `Cuenta ${op.accountId} fuera de la operación` };
      u.acct.used += op.qty;
      u.group.used += op.qty;
      s.cartedQty += op.qty;
      s.budget.committed += op.qty * op.unitPrice;
      if (op.unitPrice > s.maxUnitPrice) warnings.push('PRICE_ABOVE_MAX');
      if (u.acct.used > u.acct.cap) warnings.push('OVER_ACCOUNT_LIMIT');
      if (u.group.used > u.group.cap) warnings.push('OVER_GROUP_LIMIT');
      if (s.cartedQty + s.claimedQty > s.requestedQty) warnings.push('OVER_REQUESTED');
      if (s.budget.committed + s.budget.reserved > s.budget.total) warnings.push('OVER_BUDGET');
      break;
    }
    case 'UNCOMMIT': {
      const u = usage(s, op.accountId);
      if (!u) return { ok: false, error: `Cuenta ${op.accountId} fuera de la operación` };
      const qty = Math.min(op.qty, s.cartedQty);
      u.acct.used = Math.max(0, u.acct.used - qty);
      u.group.used = Math.max(0, u.group.used - qty);
      s.cartedQty -= qty;
      s.budget.committed = Math.max(0, s.budget.committed - op.amount);
      break;
    }
    case 'SET_REQUESTED':
      if (op.qty > s.requestedQty) return { ok: false, error: 'Solo se puede reducir la cantidad' };
      if (op.qty < s.cartedQty + s.claimedQty) return { ok: false, error: 'Ya hay más entradas en carrito o en vuelo' };
      s.requestedQty = op.qty;
      break;
    case 'SET_MAX_PRICE':
      if (op.maxUnitPrice > s.maxUnitPrice) return { ok: false, error: 'Solo se puede bajar el precio máximo' };
      if (op.maxUnitPrice <= 0) return { ok: false, error: 'Precio inválido' };
      s.maxUnitPrice = op.maxUnitPrice;
      break;
  }
  return { ok: true, state: finish(s), warnings };
}

/** Comprueba los invariantes duros (lo usan los gates G2 y los tests). */
export function allocationViolations(s: AllocationState): string[] {
  const out: string[] = [];
  if (s.cartedQty + s.claimedQty > s.requestedQty) out.push('OVER_REQUESTED');
  if (s.budget.committed + s.budget.reserved > s.budget.total) out.push('OVER_BUDGET');
  for (const [id, a] of Object.entries(s.perAccount)) if (a.used > a.cap) out.push(`OVER_ACCOUNT_LIMIT:${id}`);
  for (const [k, g] of Object.entries(s.perGroup)) if (g.used > g.cap) out.push(`OVER_GROUP_LIMIT:${k}`);
  if (s.claimedQty < 0 || s.cartedQty < 0 || s.budget.reserved < 0) out.push('NEGATIVE');
  return out;
}
