import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const code = readFileSync(new URL('../../../extension/cart-evidence.js', import.meta.url), 'utf8');
const sandbox = vm.createContext({ URL });
vm.runInContext(code, sandbox);
const evidence = sandbox.TicketCartEvidence as {
  money(value: string): number | null;
  confirms(command: unknown, before: unknown, after: unknown, binding: unknown): boolean;
};
const binding = { accountId: 'account-a', eventRef: 'event-1', recipe: { allowedOrigins: ['https://tickets.example.test'] } };
const command = { accountId: 'account-a', eventRef: 'event-1', offerRef: 'offer-1', qty: 2, unitPrice: 12500 };
const before = { verified: true, accountId: 'account-a', eventRef: 'event-1', cartRef: 'cart-1', items: [], openUrl: 'https://tickets.example.test/cart' };
const after = { ...before, items: [{ offerRef: 'offer-1', sectionLabel: 'Pista', qty: 2, unitPrice: 12500 }] };

test('only an empty before-cart and exact verified event/account/offer/qty/price confirms', () => {
  assert.equal(evidence.confirms(command, before, after, binding), true);
  assert.equal(evidence.confirms(command, before, null, binding), false);
  assert.equal(evidence.confirms(command, before, { ...after, verified: false }, binding), false);
  assert.equal(evidence.confirms(command, after, after, binding), false);
  assert.equal(evidence.confirms(command, null, after, binding), false);
  assert.equal(evidence.confirms(command, before, { ...after, eventRef: 'other' }, binding), false);
  assert.equal(evidence.confirms(command, before, { ...after, accountId: 'other' }, binding), false);
  assert.equal(evidence.confirms(command, before, { ...after, openUrl: 'https://unrelated.example/cart' }, binding), false);
  for (const wrong of [{ qty: 1 }, { qty: 3 }, { unitPrice: 12501 }, { offerRef: 'offer-2' }]) {
    assert.equal(evidence.confirms(command, before, { ...after, items: [{ ...after.items[0], ...wrong }] }, binding), false);
  }
});

test('a navigation or selected quantity alone cannot count as a cart', () => {
  assert.equal(evidence.confirms(command, before, { openUrl: 'https://tickets.example.test/login', qty: 2 }, binding), false);
  assert.equal(evidence.confirms(command, before, { ...after, cartRef: '' }, binding), false);
  assert.equal(evidence.confirms(command, before, { ...after, items: [] }, binding), false);
});

test('European and decimal currency values use integer minor units', () => {
  assert.equal(evidence.money('1.250,00 €'), 125000);
  assert.equal(evidence.money('125,50 €'), 12550);
  assert.equal(evidence.money('125.50 €'), 12550);
  assert.equal(evidence.money('Agotado'), null);
});

test('every extension script parses and manifest points to existing files', () => {
  const root = new URL('../../../extension/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  for (const name of ['background.js', 'content.js', 'cart-evidence.js', 'popup.js']) {
    new vm.Script(readFileSync(new URL(name, root), 'utf8'), { filename: resolve(name) });
  }
  assert.ok(readFileSync(new URL(manifest.action.default_popup, root), 'utf8').includes('Conecta esta pestaña'));
});

test('a worker restart and a lost confirmation response never repeat an already submitted click', async () => {
  const background = readFileSync(new URL('../../../extension/background.js', import.meta.url), 'utf8');
  const stored: Record<string, any> = {
    'binding:17': { ...binding, connectionId: 'connection-test', token: 'test-only', sessionId: 'session-test', tabId: 17,
      eventUrl: 'https://tickets.example.test/event', pending: null, completed: [] },
  };
  const add = { ...command, id: 'command-1', type: 'ADD_TO_CART', idempotencyKey: 'once-only' };
  let clicks = 0, loseResponse = true, reports = 0;
  function worker() {
    let handler: (message: any, sender: any, respond: (value: any) => void) => unknown;
    let context: vm.Context;
    const dispatch = (message: any): Promise<any> => new Promise((resolve) => handler(message, { tab: { id: 17 } }, resolve));
    const chrome = {
      storage: { session: {
        get: async (key: string) => structuredClone({ [key]: stored[key] }),
        set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); },
        remove: async (key: string) => { delete stored[key]; },
      } },
      runtime: { onMessage: { addListener: (listener: typeof handler) => { handler = listener; } } },
      action: { setBadgeText: async () => {} },
      tabs: {
        get: async () => ({ id: 17, windowId: 3, url: before.openUrl }),
        onRemoved: { addListener: () => {} },
        sendMessage: async (_tabId: number, message: any) => {
          assert.equal(message.type, 'execute');
          const ack = await dispatch({ type: 'before-click', commandId: message.command.id, beforeCart: before });
          if (ack.ok) clicks++;
          return { submitted: true };
        },
      },
    };
    context = vm.createContext({ chrome, URL, AbortSignal, Date, setTimeout, clearTimeout,
      importScripts: () => vm.runInContext(code, context),
      fetch: async (url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        if (url.endsWith('/poll')) return { ok: true, json: async () => ({ commands: [add] }) };
        if (body.outcome?.status === 'ADDED') {
          reports++;
          if (loseResponse) { loseResponse = false; throw new Error('response lost after server accepted'); }
        }
        return { ok: true, json: async () => ({ ok: true, commandAccepted: !!body.outcome }) };
      },
    });
    vm.runInContext(background, context);
    return dispatch;
  }
  const snap = { observedAt: new Date().toISOString(), url: before.openUrl, supported: true, session: 'READY', queue: 'PASSED', offers: [], cart: before };
  await worker()({ type: 'tick', snapshot: snap });
  assert.equal(clicks, 1);
  assert.equal(stored['binding:17'].pending.submitted, true);
  const restarted = worker();
  await restarted({ type: 'tick', snapshot: { ...snap, cart: after } });
  assert.equal(clicks, 1);
  assert.ok(stored['binding:17'].pending);
  await restarted({ type: 'tick', snapshot: { ...snap, cart: after } });
  assert.equal(clicks, 1);
  assert.equal(reports, 2);
  assert.equal(stored['binding:17'].pending, null);
  await restarted({ type: 'tick', snapshot: { ...snap, cart: after } });
  assert.equal(clicks, 1);
  add.id = 'another-delivery-of-same-idempotent-request';
  await restarted({ type: 'tick', snapshot: snap });
  assert.equal(clicks, 1);
});

async function backgroundScenario(mode: 'focus' | 'missing-script' | 'navigated' | 'expired-command') {
  const add = { ...command, id: 'add-1', type: 'ADD_TO_CART', idempotencyKey: 'once' };
  const stored: Record<string, any> = { 'binding:17': { ...binding, connectionId: 'test-connection', token: 'test-only', sessionId: 'session', tabId: 17,
    eventUrl: 'https://tickets.example.test/event', completed: [], pending: mode === 'expired-command' ? { command: add, receivedAt: Date.now() - 16000, submitted: false } : null } };
  const effects: { tab: Array<{ id: number; active: boolean }>; window: number[]; outcomes: string[]; execute: number; requests: number } = { tab: [], window: [], outcomes: [], execute: 0, requests: 0 };
  let handler: (message: any, sender: any, respond: (value: any) => void) => unknown;
  let context: vm.Context;
  const chrome = {
    storage: { session: { get: async (key: string) => structuredClone({ [key]: stored[key] }), set: async (values: object) => { Object.assign(stored, structuredClone(values)); } } },
    runtime: { onMessage: { addListener: (listener: typeof handler) => { handler = listener; } } },
    action: { setBadgeText: async () => {} },
    tabs: {
      onRemoved: { addListener: () => {} },
      get: async () => ({ id: 17, windowId: 8, url: mode === 'navigated' ? 'https://tickets.example.test/login' : before.openUrl }),
      update: async (id: number, options: { active: boolean }) => { effects.tab.push({ id, active: options.active }); },
      sendMessage: async () => { effects.execute++; throw new Error('Receiving end does not exist'); },
    },
    windows: { update: async (id: number) => { effects.window.push(id); } },
  };
  context = vm.createContext({ chrome, URL, AbortSignal, Date, setTimeout, clearTimeout, importScripts: () => vm.runInContext(code, context),
    fetch: async (url: string, init: { body: string }) => {
      effects.requests++;
      const body = JSON.parse(init.body);
      if (body.outcome) effects.outcomes.push(body.outcome.status);
      return { ok: true, json: async () => url.endsWith('/poll')
        ? { commands: mode === 'focus' ? [{ id: 'focus-1', type: 'FOCUS', accountId: binding.accountId, eventRef: binding.eventRef }] : mode === 'missing-script' ? [add] : [] }
        : { ok: true, commandAccepted: !!body.outcome } };
    },
  });
  vm.runInContext(readFileSync(new URL('../../../extension/background.js', import.meta.url), 'utf8'), context);
  await new Promise((resolve) => handler({ type: 'tick', snapshot: { observedAt: new Date().toISOString(), url: before.openUrl, supported: true, session: 'READY', queue: 'PASSED', offers: [], cart: before } }, { tab: { id: 17 } }, resolve));
  return { effects, state: stored['binding:17'] };
}

test('FOCUS activates the retained tab and window without navigation or cart confirmation', async () => {
  const { effects, state } = await backgroundScenario('focus');
  assert.deepEqual(effects.tab, [{ id: 17, active: true }]);
  assert.deepEqual(effects.window, [8]);
  assert.equal(effects.execute, 0);
  assert.deepEqual(effects.outcomes, []);
  assert.equal(state.pending, null);
});

test('missing content script rejects before-click delivery instead of reporting a cart', async () => {
  const { effects, state } = await backgroundScenario('missing-script');
  assert.equal(effects.execute, 1);
  assert.deepEqual(effects.outcomes, ['REJECTED']);
  assert.equal(state.pending, null);
});

test('a snapshot from the previous page is never forwarded after navigation', async () => {
  const { effects } = await backgroundScenario('navigated');
  assert.equal(effects.requests, 0);
  assert.equal(effects.execute, 0);
  assert.deepEqual(effects.outcomes, []);
});

test('an unsent command retained beyond its deadline cannot execute after reconnect', async () => {
  const { effects, state } = await backgroundScenario('expired-command');
  assert.equal(effects.execute, 0);
  assert.deepEqual(effects.outcomes, ['REJECTED']);
  assert.equal(state.pending, null);
});
