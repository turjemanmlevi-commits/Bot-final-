import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Account, CatalogEvent, OperationSummary } from '@to/shared';
import { manualConfig } from '../gates/harness';
import { realTestCanExecute, realTestDefaults, type BrowserRealTestInput, type BrowserRealTestPreflight } from '../../../dashboard/src/lib/real-test';

const account = (id: string, verified = true) => ({ id, label: 'Misma etiqueta', providerId: 'real-madrid', enabled: true, verification: verified ? 'VERIFIED' : 'UNVERIFIED' }) as Account;
const event = { id: 'paris', name: 'Real Madrid Femenino - Paris FC', providerId: 'real-madrid' } as CatalogEvent;
const operation = (ids: string[]) => ({ id: 'old', accountIds: ids, eventId: 'paris', providerId: 'real-madrid', createdAt: '2026-09-30T10:00:00Z' }) as OperationSummary;

describe('botón de prueba real', () => {
  it('recupera las cuentas por sus IDs anteriores; nunca elige las primeras cuentas ni una etiqueta repetida', () => {
    const accounts = [account('other'), account('second'), account('first')];
    assert.deepEqual(realTestDefaults(accounts, [event], [operation(['first', 'second'])]), { eventId: 'paris', accountIds: ['first', 'second'] });
    assert.deepEqual(realTestDefaults(accounts, [event], []).accountIds, []);
    assert.deepEqual(realTestDefaults([account('first'), account('second', false)], [event], [operation(['first', 'second'])]).accountIds, []);
    assert.deepEqual(realTestDefaults([account('first'), account('other')], [event], [operation(['first', 'second'])]).accountIds, []);
  });

  const input: BrowserRealTestInput = { eventId: 'paris', accountIds: ['first', 'second'], maxUnitPrice: 6000, requestId: 'client-request-id-123' };
  const good: BrowserRealTestPreflight = {
    ok: true, blockers: [],
    plannedConfig: { ...manualConfig(input.accountIds, 0), providerId: 'real-madrid', eventId: 'paris', requestedQty: 2, maxUnitPrice: 6000, budget: 12000,
      preferences: { ...manualConfig(input.accountIds, 0).preferences, maxPerAccount: 1 } },
    bindings: input.accountIds.map((accountId) => ({ accountId, label: accountId, connected: true, supported: true, recipeId: 'entradas-fastbooking-v1', detail: null })),
  };

  it('solo habilita una comprobación reciente del mismo pedido, con todas las pestañas compatibles', () => {
    assert.equal(realTestCanExecute(input, good, 1000, 2000), true);
    assert.equal(realTestCanExecute(input, null, 1000, 2000), false);
    assert.equal(realTestCanExecute(input, good, 1000, 12000), false);
    assert.equal(realTestCanExecute(input, { ...good, blockers: [{ code: 'CART_NOT_EMPTY', message: 'El carrito tiene entradas' }] }, 1000, 2000), false);
    assert.equal(realTestCanExecute(input, { ...good, bindings: good.bindings.map((b) => ({ ...b, supported: false })) }, 1000, 2000), false);
    assert.equal(realTestCanExecute(input, { ...good, bindings: [] }, 1000, 2000), false);
    assert.equal(realTestCanExecute({ ...input, eventId: 'another-event' }, good, 1000, 2000), false);
    assert.equal(realTestCanExecute({ ...input, accountIds: ['first', 'other'] }, good, 1000, 2000), false);
    assert.equal(realTestCanExecute({ ...input, maxUnitPrice: 5000 }, good, 1000, 2000), false);
  });

  it('no habilita dos entradas por cuenta ni un precio superior al mostrado', () => {
    assert.equal(realTestCanExecute(input, { ...good, plannedConfig: { ...good.plannedConfig!, preferences: { ...good.plannedConfig!.preferences, maxPerAccount: 2 } } }, 1000, 2000), false);
    assert.equal(realTestCanExecute(input, { ...good, plannedConfig: { ...good.plannedConfig!, maxUnitPrice: 7000 } }, 1000, 2000), false);
    assert.equal(realTestCanExecute({ ...input, maxUnitPrice: 7000 }, { ...good, plannedConfig: { ...good.plannedConfig!, maxUnitPrice: 7000, budget: 14000 } }, 1000, 2000), false);
  });
});
