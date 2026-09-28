/**
 * Límites del proveedor (§12, §17): a qué grupo de límite pertenece cada cuenta
 * y cuánta cantidad es legalmente alcanzable con un conjunto de cuentas.
 */

import type { Account, EventLimits, LimitSemantics } from '@to/shared';

/**
 * Clave del grupo de límite de una cuenta. `null` cuando la semántica no se
 * puede aplicar (desconocida o falta la referencia) → la validación falla cerrada.
 */
export function groupKeyFor(account: Pick<Account, 'id' | 'holderRef' | 'householdRef' | 'paymentRef'>, semantics: LimitSemantics): string | null {
  switch (semantics) {
    case 'PER_ACCOUNT':
      return `cuenta:${account.id}`;
    case 'PER_HOLDER':
      return account.holderRef ? `titular:${account.holderRef.trim().toLowerCase()}` : null;
    case 'PER_HOUSEHOLD':
      return account.householdRef ? `hogar:${account.householdRef.trim().toLowerCase()}` : null;
    case 'PER_PAYMENT_METHOD':
      return account.paymentRef ? `pago:${account.paymentRef.trim().toLowerCase()}` : null;
    case 'UNKNOWN':
      return null;
  }
}

/**
 * Capacidad alcanzable respetando límite por cuenta, por grupo y por operación:
 * min(pedido, porOperación, Σ_grupos min(porGrupo, Σ_cuentas porCuenta)).
 */
export function effectiveCapacity(
  accounts: Array<Pick<Account, 'id' | 'holderRef' | 'householdRef' | 'paymentRef'>>,
  limits: EventLimits,
  requestedQty: number,
): number {
  const perGroup = new Map<string, number>();
  for (const a of accounts) {
    const key = groupKeyFor(a, limits.semantics);
    if (key === null) continue;
    perGroup.set(key, (perGroup.get(key) ?? 0) + limits.perAccount);
  }
  let total = 0;
  for (const sum of perGroup.values()) total += Math.min(limits.perGroup, sum);
  return Math.max(0, Math.min(requestedQty, limits.perOperation, total));
}
