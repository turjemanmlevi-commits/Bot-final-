/**
 * Motor de selección (§16). Función PURA: mismas entradas → misma decisión.
 * Por eso cada decisión se puede reproducir (replay) y explicar.
 *
 * 1. Filtro estático por política (independiente de la cuenta), cacheado por snapshot.
 * 2. Por cuenta: overlay (en vuelo / no disponible), capacidad y presupuesto.
 * 3. Ranking lexicográfico RankKey (menor es mejor):
 *    coverageDeficit → targetRank → groupingPenalty → unitPrice → ambiguity → candidateId
 */

import type { Candidate, CompiledPolicy, Id, Minor, RankKey, RejectionReason } from '@to/shared';
import type { CandidateSnapshot } from './candidates';

export interface AccountCapacity {
  accountRemaining: number;
  groupRemaining: number;
  operationRemaining: number;
  budgetRemaining: Minor;
}

export interface DecisionOverlay {
  /** IDs de candidato con un claim en vuelo. */
  inFlight: ReadonlySet<string>;
  /** offerRefs rechazados recientemente por el proveedor (agotado, precio cambiado...). */
  unavailable: ReadonlySet<string>;
}

export interface DecisionInput {
  operationId: Id;
  accountId: Id;
  atMs: number;
  snapshot: CandidateSnapshot;
  policy: CompiledPolicy;
  closedSectionIds: ReadonlySet<Id>;
  /** Precio máximo vigente (puede haberse bajado tras armar). */
  maxUnitPrice: Minor;
  capacity: AccountCapacity;
  overlay: DecisionOverlay;
}

export interface RankedCandidate {
  candidate: Candidate;
  qty: number;
  rank: RankKey;
}

export interface DecisionResult {
  outcome: 'CLAIMED' | 'NO_CANDIDATE' | 'STALE_SNAPSHOT';
  chosen: RankedCandidate | null;
  alternatives: RankedCandidate[];
  rejectedByReason: Partial<Record<RejectionReason, number>>;
}

export const MAX_ALTERNATIVES = 3;

export function compareRank(a: RankKey, b: RankKey): number {
  return (
    a.coverageDeficit - b.coverageDeficit ||
    a.targetRank - b.targetRank ||
    a.groupingPenalty - b.groupingPenalty ||
    a.unitPrice - b.unitPrice ||
    a.ambiguity - b.ambiguity ||
    (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0)
  );
}

/** Motivo de rechazo que no depende de la cuenta, o null si el candidato pasa. */
export function staticRejection(
  c: Candidate,
  policy: CompiledPolicy,
  closed: ReadonlySet<Id>,
  excluded: ReadonlySet<Id>,
  maxUnitPrice: Minor,
): RejectionReason | null {
  if (
    !Number.isInteger(c.qtyMin) ||
    !Number.isInteger(c.qtyMax) ||
    c.qtyMin < 1 ||
    c.qtyMax < c.qtyMin ||
    !Number.isInteger(c.unitPrice) ||
    c.unitPrice <= 0
  ) {
    return 'INVALID_DATA';
  }
  if (c.currency !== policy.currency) return 'CURRENCY_MISMATCH';
  if (c.sectionId === null) return 'UNRESOLVED_SECTION';
  if (closed.has(c.sectionId)) return 'SECTION_CLOSED';
  if (excluded.has(c.sectionId)) return 'SECTION_EXCLUDED';
  if (policy.sectionRank[c.sectionId] === undefined) return 'SECTION_NOT_ALLOWED';
  if (c.ambiguity > policy.maxAmbiguity) return 'AMBIGUITY_TOO_HIGH';
  if (c.kind === 'STANDING' && !policy.allowStanding) return 'STANDING_NOT_ALLOWED';
  if (c.obstructed && !policy.allowObstructed) return 'OBSTRUCTED_VIEW';
  if (c.accessible && !policy.allowAccessible) return 'ACCESSIBLE_RESERVED';
  if (policy.requireContiguous && c.contiguous !== true) return 'NOT_CONTIGUOUS';
  if (c.unitPrice > maxUnitPrice) return 'PRICE_ABOVE_MAX';
  return null;
}

interface Prepared {
  eligible: Candidate[];
  rejected: Partial<Record<RejectionReason, number>>;
}

const preparedCache = new WeakMap<CandidateSnapshot, WeakMap<CompiledPolicy, Map<string, Prepared>>>();

export function prepareSnapshot(
  snapshot: CandidateSnapshot,
  policy: CompiledPolicy,
  closed: ReadonlySet<Id>,
  maxUnitPrice: Minor,
): Prepared {
  let byPolicy = preparedCache.get(snapshot);
  if (!byPolicy) {
    byPolicy = new WeakMap();
    preparedCache.set(snapshot, byPolicy);
  }
  let byKey = byPolicy.get(policy);
  if (!byKey) {
    byKey = new Map();
    byPolicy.set(policy, byKey);
  }
  const key = `${maxUnitPrice}|${[...closed].sort().join(',')}`;
  const hit = byKey.get(key);
  if (hit) return hit;

  const excluded = new Set(policy.excludedSectionIds);
  const eligible: Candidate[] = [];
  const rejected: Partial<Record<RejectionReason, number>> = {};
  if (snapshot.duplicates > 0) rejected.DUPLICATE = snapshot.duplicates;
  for (const c of snapshot.candidates) {
    const r = staticRejection(c, policy, closed, excluded, maxUnitPrice);
    if (r) rejected[r] = (rejected[r] ?? 0) + 1;
    else eligible.push(c);
  }
  const prepared = { eligible, rejected };
  byKey.set(key, prepared);
  return prepared;
}

export function decide(input: DecisionInput): DecisionResult {
  const { snapshot, policy, capacity, overlay } = input;
  if (input.atMs - snapshot.observedAtMs > policy.maxSnapshotAgeMs) {
    return { outcome: 'STALE_SNAPSHOT', chosen: null, alternatives: [], rejectedByReason: {} };
  }
  const prepared = prepareSnapshot(snapshot, policy, input.closedSectionIds, input.maxUnitPrice);
  const rejected: Partial<Record<RejectionReason, number>> = { ...prepared.rejected };
  const bump = (r: RejectionReason) => {
    rejected[r] = (rejected[r] ?? 0) + 1;
  };
  const want = Math.min(capacity.accountRemaining, capacity.groupRemaining, capacity.operationRemaining);
  const capacityReason: RejectionReason =
    capacity.groupRemaining < capacity.accountRemaining ? 'NO_GROUP_CAPACITY' : 'NO_ACCOUNT_CAPACITY';

  const top: RankedCandidate[] = [];
  for (const c of prepared.eligible) {
    if (overlay.inFlight.has(c.id)) {
      bump('IN_FLIGHT');
      continue;
    }
    if (overlay.unavailable.has(c.offerRef)) {
      bump('UNAVAILABLE_OVERLAY');
      continue;
    }
    if (want <= 0) {
      bump(capacityReason);
      continue;
    }
    const byBudget = Math.floor(capacity.budgetRemaining / c.unitPrice);
    const take = Math.min(want, c.qtyMax, byBudget);
    if (take < c.qtyMin) {
      bump(byBudget < c.qtyMin ? 'OVER_BUDGET' : capacityReason);
      continue;
    }
    if (take < policy.minGroupSize) {
      bump(byBudget < policy.minGroupSize && byBudget < want ? 'OVER_BUDGET' : 'QTY_BELOW_MIN_GROUP');
      continue;
    }
    const rank: RankKey = {
      coverageDeficit: want - take,
      targetRank: policy.sectionRank[c.sectionId as Id] as number,
      groupingPenalty: c.kind === 'STANDING' || c.contiguous === true ? 0 : c.contiguous === null ? 1 : 2,
      unitPrice: c.unitPrice,
      ambiguity: c.ambiguity,
      candidateId: c.id,
    };
    insertTop(top, { candidate: c, qty: take, rank }, MAX_ALTERNATIVES + 1);
  }

  if (top.length === 0) return { outcome: 'NO_CANDIDATE', chosen: null, alternatives: [], rejectedByReason: rejected };
  return { outcome: 'CLAIMED', chosen: top[0] as RankedCandidate, alternatives: top.slice(1), rejectedByReason: rejected };
}

function insertTop(top: RankedCandidate[], item: RankedCandidate, limit: number): void {
  let i = top.length;
  while (i > 0 && compareRank(item.rank, (top[i - 1] as RankedCandidate).rank) < 0) i--;
  if (i >= limit) return;
  top.splice(i, 0, item);
  if (top.length > limit) top.pop();
}
