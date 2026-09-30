/**
 * Límites del proveedor (§12, §17): a qué grupo de límite pertenece cada cuenta
 * y cuánta cantidad es legalmente alcanzable con un conjunto de cuentas.
 */

import type { Account, AllocationState, Cart, Claim, EventLimits, Id, LimitSemantics } from '@to/shared';

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
 * min(pedido, porOperación, Σ_grupos min(porGrupo, Σ_cuentas porCuenta)),
 * descontando lo que ya tienen otras operaciones del evento si se indica.
 */
export function effectiveCapacity(
  accounts: Array<Pick<Account, 'id' | 'holderRef' | 'householdRef' | 'paymentRef'>>,
  limits: EventLimits,
  requestedQty: number,
  used?: Pick<EventUsage, 'perAccount' | 'perGroup'>,
): number {
  const perGroup = new Map<string, number>();
  for (const a of accounts) {
    const key = groupKeyFor(a, limits.semantics);
    if (key === null) continue;
    perGroup.set(key, (perGroup.get(key) ?? 0) + Math.max(0, limits.perAccount - (used?.perAccount.get(a.id) ?? 0)));
  }
  let total = 0;
  for (const [key, sum] of perGroup) total += Math.min(Math.max(0, limits.perGroup - (used?.perGroup.get(key) ?? 0)), sum);
  return Math.max(0, Math.min(requestedQty, limits.perOperation, total));
}

/** Carritos y claims que ocupan cupo del evento: en carrito, pagados, en vuelo o dudosos. */
const CART_HOLDS: ReadonlySet<Cart['state']> = new Set(['ACTIVE', 'REVIEW_REQUIRED', 'PAID']);
const CLAIM_HOLDS: ReadonlySet<Claim['state']> = new Set(['PENDING', 'SENT', 'AMBIGUOUS']);

/**
 * Cupo de un evento que ya ocupan otras operaciones: el límite por cuenta y por
 * titular, hogar o medio de pago es del evento, no de cada operación.
 */
export interface EventUsage {
  /** Entradas por cuenta. */
  perAccount: Map<Id, number>;
  /** Entradas por grupo de límite (clave de `groupKeyFor`). */
  perGroup: Map<string, number>;
  /** Operaciones (por su nombre) que ocupan el cupo de cada cuenta o grupo, para explicarlo. */
  where: Map<string, string[]>;
}

/**
 * Suma por cuenta y por grupo (con la semántica del evento) lo que tienen las
 * demás operaciones del evento: carritos activos, en revisión o pagados y claims
 * en vuelo o dudosos. Una operación que aún puede comprar (se pasa su asignación)
 * retiene además lo que su asignación le deja comprar: así dos operaciones armadas
 * a la vez tampoco suman más que el límite.
 */
export function eventUsage(params: {
  semantics: LimitSemantics;
  accounts: ReadonlyMap<Id, Pick<Account, 'id' | 'holderRef' | 'householdRef' | 'paymentRef'>>;
  operations: Array<{ id: Id; name: string; allocation: AllocationState | null }>;
  carts: Iterable<Pick<Cart, 'operationId' | 'accountId' | 'qty' | 'state'>>;
  claims: Iterable<Pick<Claim, 'operationId' | 'accountId' | 'qty' | 'state'>>;
}): EventUsage {
  const add = <K>(m: Map<K, number>, k: K, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  const keyOf = (id: Id) => {
    const a = params.accounts.get(id);
    return (a ? groupKeyFor(a, params.semantics) : null) ?? `cuenta:${id}`;
  };
  // Lo que tiene cada operación, por cuenta.
  const held = new Map<Id, Map<Id, number>>(params.operations.map((o) => [o.id, new Map()]));
  const hold = (c: { operationId: Id; accountId: Id; qty: number }) => {
    const m = held.get(c.operationId);
    if (m) add(m, c.accountId, c.qty);
  };
  for (const c of params.carts) if (CART_HOLDS.has(c.state)) hold(c);
  for (const c of params.claims) if (CLAIM_HOLDS.has(c.state)) hold(c);
  const usage: EventUsage = { perAccount: new Map(), perGroup: new Map(), where: new Map() };
  const note = (k: string, name: string) => {
    const names = usage.where.get(k) ?? [];
    if (!names.includes(name)) usage.where.set(k, [...names, name]);
  };
  for (const o of params.operations) {
    const byAccount = new Map(held.get(o.id));
    const byGroup = new Map<string, number>();
    for (const [id, n] of byAccount) add(byGroup, keyOf(id), n);
    if (o.allocation) {
      // Aún puede comprar: retiene lo que su asignación le permite (nunca menos de lo que ya tiene).
      const reachable = new Map<string, number>();
      for (const [id, a] of Object.entries(o.allocation.perAccount)) {
        byAccount.set(id, Math.max(byAccount.get(id) ?? 0, a.cap));
        add(reachable, keyOf(id), a.cap);
      }
      for (const [k, n] of reachable) {
        const cap = Math.min(n, o.allocation.requestedQty, o.allocation.perGroup[k]?.cap ?? n);
        byGroup.set(k, Math.max(byGroup.get(k) ?? 0, cap));
      }
    }
    for (const [id, n] of byAccount) {
      if (n <= 0) continue;
      add(usage.perAccount, id, n);
      note(id, o.name);
    }
    for (const [k, n] of byGroup) {
      if (n <= 0) continue;
      add(usage.perGroup, k, n);
      note(k, o.name);
    }
  }
  return usage;
}
