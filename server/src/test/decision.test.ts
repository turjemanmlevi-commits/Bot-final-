import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Candidate, CompiledPolicy } from '@to/shared';
import type { CandidateSnapshot } from '../domain/candidates';
import { compareRank, decide, type DecisionInput } from '../domain/decision';

const NOW = 1_800_000_000_000;

function cand(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    offerRef: `o-${id}`,
    sectionId: 's1',
    sectionLabelRaw: 'S1',
    zoneId: 'z',
    kind: 'SEATED',
    row: '1',
    seats: ['1', '2', '3', '4'],
    contiguous: true,
    qtyMin: 1,
    qtyMax: 4,
    unitPrice: 5000,
    currency: 'EUR',
    obstructed: false,
    accessible: false,
    ambiguity: 0,
    ambiguityReasons: [],
    observedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

const policy: CompiledPolicy = {
  policyVersion: 't',
  requestedQty: 8,
  currency: 'EUR',
  maxUnitPrice: 10_000,
  budget: 100_000,
  sectionRank: { s1: 0, s2: 1 },
  excludedSectionIds: ['s9'],
  requireContiguous: true,
  minGroupSize: 2,
  allowStanding: false,
  allowObstructed: false,
  allowAccessible: false,
  maxAmbiguity: 0.3,
  maxSnapshotAgeMs: 2000,
  resolution: [],
};

function input(candidates: Candidate[], over: Partial<DecisionInput> = {}): DecisionInput {
  const snapshot: CandidateSnapshot = {
    id: 'snap',
    contentHash: 'c',
    operationId: 'op',
    observedAt: new Date(NOW).toISOString(),
    observedAtMs: NOW,
    offers: candidates.length,
    candidates,
    duplicates: 0,
    unresolvedLabels: [],
  };
  return {
    operationId: 'op',
    accountId: 'a',
    atMs: NOW + 100,
    snapshot,
    policy,
    closedSectionIds: new Set(),
    maxUnitPrice: policy.maxUnitPrice,
    capacity: { accountRemaining: 4, groupRemaining: 4, operationRemaining: 8, budgetRemaining: 100_000 },
    overlay: { inFlight: new Set(), unavailable: new Set() },
    ...over,
  };
}

describe('decide()', () => {
  it('prefiere cubrir toda la capacidad antes que la sección preferida', () => {
    const r = decide(input([cand('a', { sectionId: 's1', qtyMax: 2 }), cand('b', { sectionId: 's2', qtyMax: 4 })]));
    assert.equal(r.outcome, 'CLAIMED');
    assert.equal(r.chosen?.candidate.id, 'b');
    assert.equal(r.chosen?.qty, 4);
  });

  it('a igual cobertura gana la sección con mejor rango y luego el precio', () => {
    const r = decide(input([cand('a', { sectionId: 's2', unitPrice: 3000 }), cand('b', { sectionId: 's1', unitPrice: 9000 }), cand('c', { sectionId: 's1', unitPrice: 8000 })]));
    assert.equal(r.chosen?.candidate.id, 'c');
    assert.deepEqual(r.alternatives.map((a) => a.candidate.id), ['b', 'a']);
  });

  it('rechaza con el motivo correcto', () => {
    const r = decide(
      input([
        cand('price', { unitPrice: 20_000 }),
        cand('noncontig', { contiguous: false }),
        cand('unknown', { sectionId: null }),
        cand('excluded', { sectionId: 's9' }),
        cand('other', { sectionId: 's5' }),
        cand('ambig', { ambiguity: 0.6 }),
        cand('obst', { obstructed: true }),
        cand('acc', { accessible: true }),
        cand('stand', { kind: 'STANDING', contiguous: true }),
        cand('usd', { currency: 'USD' }),
        cand('bad', { qtyMin: 3, qtyMax: 2 }),
      ]),
    );
    assert.equal(r.outcome, 'NO_CANDIDATE');
    assert.deepEqual(r.rejectedByReason, {
      PRICE_ABOVE_MAX: 1,
      NOT_CONTIGUOUS: 1,
      UNRESOLVED_SECTION: 1,
      SECTION_EXCLUDED: 1,
      SECTION_NOT_ALLOWED: 1,
      AMBIGUITY_TOO_HIGH: 1,
      OBSTRUCTED_VIEW: 1,
      ACCESSIBLE_RESERVED: 1,
      STANDING_NOT_ALLOWED: 1,
      CURRENCY_MISMATCH: 1,
      INVALID_DATA: 1,
    });
  });

  it('respeta capacidad, presupuesto y grupo mínimo', () => {
    const r1 = decide(input([cand('a')], { capacity: { accountRemaining: 4, groupRemaining: 1, operationRemaining: 8, budgetRemaining: 100_000 } }));
    assert.equal(r1.outcome, 'NO_CANDIDATE');
    assert.equal(r1.rejectedByReason.QTY_BELOW_MIN_GROUP, 1);
    const r2 = decide(input([cand('a', { unitPrice: 9000 })], { capacity: { accountRemaining: 4, groupRemaining: 4, operationRemaining: 8, budgetRemaining: 20_000 } }));
    assert.equal(r2.chosen?.qty, 2, 'el presupuesto solo alcanza para 2');
  });

  it('no elige candidatos en vuelo ni ofertas marcadas como no disponibles', () => {
    const r = decide(input([cand('a'), cand('b')], { overlay: { inFlight: new Set(['a']), unavailable: new Set(['o-b']) } }));
    assert.equal(r.outcome, 'NO_CANDIDATE');
    assert.equal(r.rejectedByReason.IN_FLIGHT, 1);
    assert.equal(r.rejectedByReason.UNAVAILABLE_OVERLAY, 1);
  });

  it('no decide sobre un snapshot viejo', () => {
    const r = decide(input([cand('a')], { atMs: NOW + 5000 }));
    assert.equal(r.outcome, 'STALE_SNAPSHOT');
  });

  it('es determinista aunque cambie el orden del inventario', () => {
    const cs = [cand('a', { unitPrice: 5000 }), cand('b', { unitPrice: 5000 }), cand('c', { unitPrice: 4000, sectionId: 's2' })];
    const r1 = decide(input(cs));
    const r2 = decide(input([...cs].reverse(), { snapshot: { ...input(cs).snapshot, id: 'snap2', candidates: [...cs].reverse() } }));
    assert.equal(r1.chosen?.candidate.id, r2.chosen?.candidate.id);
    assert.equal(r1.chosen?.candidate.id, 'a', 'desempate por id');
  });

  it('compareRank es lexicográfico', () => {
    const base = { coverageDeficit: 0, targetRank: 0, groupingPenalty: 0, unitPrice: 100, ambiguity: 0, candidateId: 'a' };
    assert.ok(compareRank(base, { ...base, coverageDeficit: 1, targetRank: -5 }) < 0);
    assert.ok(compareRank(base, { ...base, candidateId: 'b' }) < 0);
    assert.equal(compareRank(base, { ...base }), 0);
  });
});
