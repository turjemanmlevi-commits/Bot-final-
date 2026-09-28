import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AllocationState, EventLimits } from '@to/shared';
import { allocationViolations, applyAllocation, capacityOf, initAllocation, wantFor } from '../domain/allocation';
import { effectiveCapacity, groupKeyFor } from '../domain/limits';

const limits: EventLimits = { perAccount: 4, perGroup: 4, perOperation: 12, semantics: 'PER_HOLDER', verified: true, source: 't', verifiedAt: null, verifiedBy: null, notes: '' };

function state(): AllocationState {
  return initAllocation({
    operationId: 'op',
    currency: 'EUR',
    requestedQty: 8,
    maxUnitPrice: 10_000,
    budget: 70_000,
    limits,
    accounts: [
      { id: 'ana1', groupKey: 'titular:ana' },
      { id: 'ana2', groupKey: 'titular:ana' },
      { id: 'bruno', groupKey: 'titular:bruno' },
    ],
  });
}

function ok(r: ReturnType<typeof applyAllocation>): AllocationState {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.state;
}

describe('asignación', () => {
  it('dos cuentas del mismo titular comparten el cupo del grupo', () => {
    let s = ok(applyAllocation(state(), { op: 'RESERVE', claimId: 'c1', accountId: 'ana1', qty: 4, unitPrice: 5000 }));
    assert.equal(wantFor(s, 'ana2'), 0);
    const r = applyAllocation(s, { op: 'RESERVE', claimId: 'c2', accountId: 'ana2', qty: 1, unitPrice: 5000 });
    assert.equal(r.ok, false);
    s = ok(applyAllocation(s, { op: 'RESERVE', claimId: 'c3', accountId: 'bruno', qty: 4, unitPrice: 5000 }));
    assert.equal(s.remainingQty, 0);
    assert.deepEqual(allocationViolations(s), []);
  });

  it('reservar, confirmar y liberar mueven cantidad y presupuesto', () => {
    let s = ok(applyAllocation(state(), { op: 'RESERVE', claimId: 'c1', accountId: 'bruno', qty: 2, unitPrice: 9000 }));
    assert.equal(s.claimedQty, 2);
    assert.equal(s.budget.reserved, 18_000);
    s = ok(applyAllocation(s, { op: 'CONFIRM', claimId: 'c1', accountId: 'bruno', reservedQty: 2, reservedUnitPrice: 9000, qty: 2, unitPrice: 8500 }));
    assert.equal(s.cartedQty, 2);
    assert.equal(s.claimedQty, 0);
    assert.equal(s.budget.committed, 17_000);
    assert.equal(s.budget.remaining, 53_000);
    s = ok(applyAllocation(s, { op: 'RESERVE', claimId: 'c2', accountId: 'bruno', qty: 2, unitPrice: 9000 }));
    s = ok(applyAllocation(s, { op: 'RELEASE', claimId: 'c2', accountId: 'bruno', qty: 2, unitPrice: 9000 }));
    assert.equal(capacityOf(s, 'bruno').accountRemaining, 2);
    assert.equal(s.version, 4);
  });

  it('nunca supera presupuesto, precio máximo ni cantidad pedida', () => {
    const s = state();
    assert.equal(applyAllocation(s, { op: 'RESERVE', claimId: 'x', accountId: 'bruno', qty: 2, unitPrice: 10_001 }).ok, false);
    const big = ok(applyAllocation(s, { op: 'RESERVE', claimId: 'a', accountId: 'bruno', qty: 4, unitPrice: 10_000 }));
    assert.equal(applyAllocation(big, { op: 'RESERVE', claimId: 'b', accountId: 'ana1', qty: 4, unitPrice: 10_000 }).ok, false, '80 € > 70 € de presupuesto');
  });

  it('las enmiendas solo pueden ser más conservadoras', () => {
    const s = state();
    assert.equal(applyAllocation(s, { op: 'SET_REQUESTED', qty: 9 }).ok, false);
    assert.equal(ok(applyAllocation(s, { op: 'SET_REQUESTED', qty: 6 })).remainingQty, 6);
    assert.equal(applyAllocation(s, { op: 'SET_MAX_PRICE', maxUnitPrice: 20_000 }).ok, false);
    assert.equal(ok(applyAllocation(s, { op: 'SET_MAX_PRICE', maxUnitPrice: 8000 })).maxUnitPrice, 8000);
  });

  it('una confirmación por encima del precio máximo se marca para revisión', () => {
    let s = ok(applyAllocation(state(), { op: 'RESERVE', claimId: 'c1', accountId: 'bruno', qty: 2, unitPrice: 9000 }));
    const r = applyAllocation(s, { op: 'CONFIRM', claimId: 'c1', accountId: 'bruno', reservedQty: 2, reservedUnitPrice: 9000, qty: 2, unitPrice: 12_000 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.warnings, ['PRICE_ABOVE_MAX']);
      s = r.state;
    }
  });
});

describe('límites', () => {
  it('agrupa por la semántica del evento', () => {
    const a = { id: 'x', holderRef: 'Ana', householdRef: 'Casa', paymentRef: null };
    assert.equal(groupKeyFor(a, 'PER_ACCOUNT'), 'cuenta:x');
    assert.equal(groupKeyFor(a, 'PER_HOLDER'), 'titular:ana');
    assert.equal(groupKeyFor(a, 'PER_HOUSEHOLD'), 'hogar:casa');
    assert.equal(groupKeyFor(a, 'PER_PAYMENT_METHOD'), null, 'sin medio de pago → no se puede agrupar (fail-closed)');
    assert.equal(groupKeyFor(a, 'UNKNOWN'), null);
  });

  it('capacidad efectiva = min(pedido, operación, Σ grupos)', () => {
    const accs = [
      { id: '1', holderRef: 'ana', householdRef: null, paymentRef: null },
      { id: '2', holderRef: 'ana', householdRef: null, paymentRef: null },
      { id: '3', holderRef: 'bruno', householdRef: null, paymentRef: null },
    ];
    assert.equal(effectiveCapacity(accs, limits, 20), 8);
    assert.equal(effectiveCapacity(accs, { ...limits, semantics: 'PER_ACCOUNT' }, 20), 12);
    assert.equal(effectiveCapacity(accs, limits, 5), 5);
  });
});
