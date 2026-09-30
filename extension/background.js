'use strict';
importScripts('cart-evidence.js');
const BASE = 'http://127.0.0.1:8787';
const locks = new Map();
const key = (tabId) => 'binding:' + tabId;
const read = async (tabId) => (await chrome.storage.session.get(key(tabId)))[key(tabId)] || null;
const save = (tabId, value) => chrome.storage.session.set({ [key(tabId)]: value });
const credentials = (b) => ({ connectionId: b.connectionId, token: b.token, sessionId: b.sessionId, tabId: b.tabId });
const publicBinding = (b) => ({ connectionId: b.connectionId, accountId: b.accountId, eventId: b.eventId, eventRef: b.eventRef, eventUrl: b.eventUrl, recipe: b.recipe });
const pageUrl = (value) => { const url = new URL(value); url.hash = ''; return url.href; };

async function api(path, body) {
  const response = await fetch(BASE + '/api/browser/bridge/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error?.message || result.message || (typeof result.error === 'string' ? result.error : 'El panel local no pudo completar la conexión.'));
  return result;
}
async function status(tabId, detail) {
  const binding = await read(tabId);
  if (!binding) return;
  binding.detail = detail;
  await save(tabId, binding);
  await chrome.action.setBadgeText({ tabId, text: detail.startsWith('Conectad') ? 'ON' : '!' });
}
function serial(tabId, fn) {
  const task = (locks.get(tabId) || Promise.resolve()).catch(() => {}).then(fn);
  locks.set(tabId, task);
  task.finally(() => { if (locks.get(tabId) === task) locks.delete(tabId); }).catch(() => {});
  return task;
}
async function pair(message) {
  const tab = await chrome.tabs.get(message.tabId);
  const url = new URL(tab.url || '');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Abre la página del evento.');
  const previous = await read(tab.id);
  if (previous?.pending) throw new Error('Hay un intento pendiente en esta pestaña; resuélvelo antes de emparejar otra cuenta.');
  const sessionId = crypto.randomUUID();
  const response = await api('connect', { pairingCode: message.pairingCode, sessionId, tabId: tab.id, url: tab.url });
  const data = response.connection || response;
  if (!data.connectionId || !data.token || !data.recipe || !data.recipe.allowedOrigins?.includes(url.origin)) throw new Error('El panel no devolvió una conexión válida para esta página.');
  const binding = { ...data, sessionId, tabId: tab.id, pending: null, completed: [], completedKeys: [], detail: 'Conectada. Comprobando si la página permite verificar el carrito…' };
  await save(tab.id, binding);
  // Dynamic script registration grants access only to the host explicitly chosen in the popup.
  const scriptId = 'site-' + url.origin.replace(/[^a-z0-9_-]/gi, '-');
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
  if (!registered.length) await chrome.scripting.registerContentScripts([{ id: scriptId, matches: [url.origin + '/*'], js: ['cart-evidence.js', 'content.js'], runAt: 'document_idle', persistAcrossSessions: false }]);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['cart-evidence.js', 'content.js'] });
  await chrome.tabs.sendMessage(tab.id, { type: 'wake' }).catch(() => {});
  return { ok: true };
}
async function report(tabId, binding, snapshot, outcome) {
  const result = await api('report', { ...credentials(binding), snapshot, ...(outcome ? { commandId: binding.pending.command.id, outcome } : {}) });
  if (outcome && result.commandAccepted) {
    binding.completed = [...(binding.completed || []), binding.pending.command.id].slice(-200);
    binding.completedKeys = [...(binding.completedKeys || []), binding.pending.command.idempotencyKey].slice(-200);
    binding.pending = null;
    await save(tabId, binding);
  }
  return result;
}
async function tick(tabId, snapshot) {
  let binding = await read(tabId);
  if (!binding) return { connected: false };
  const liveTab = await chrome.tabs.get(tabId);
  if (!liveTab.url || pageUrl(liveTab.url) !== pageUrl(snapshot.url)) {
    await status(tabId, 'La pestaña cambió de página. Esperando una lectura nueva; no se ha confirmado ningún carrito.');
    return { connected: true, stop: true };
  }
  const currentOrigin = new URL(snapshot.url).origin;
  if (!binding.recipe.allowedOrigins.includes(currentOrigin)) {
    await status(tabId, 'Página fuera del evento autorizado. Vuelve a la pestaña conectada.');
    return { connected: true, stop: true };
  }
  let pending = binding.pending;
  if (pending && !pending.submitted && !pending.outcome) {
    if (snapshot.session === 'CHALLENGE_REQUIRED') pending.receivedAt = Date.now();
    else if (Date.now() - pending.receivedAt > 15000) pending.outcome = { status: 'REJECTED', detail: 'La orden caducó antes de pulsar. Se necesita una orden nueva después de revisar la conexión.' };
    await save(tabId, binding);
  }
  if (pending?.submitted) {
    if (snapshot.session === 'CHALLENGE_REQUIRED' || snapshot.queue === 'WAITING') {
      pending.challengeAt = Date.now();
      await save(tabId, binding);
    } else if (pending.challengeAt) {
      pending.submittedAt = Date.now();
      delete pending.challengeAt;
      await save(tabId, binding);
    }
    if (snapshot.session === 'READY' && TicketCartEvidence.confirms(pending.command, pending.beforeCart, snapshot.cart, publicBinding(binding))) {
      await report(tabId, binding, snapshot, { status: 'ADDED', beforeCart: pending.beforeCart });
    } else if (!pending.challengeAt && Date.now() - pending.submittedAt > 15000) {
      await report(tabId, binding, snapshot, { status: 'AMBIGUOUS', beforeCart: pending.beforeCart, detail: 'Se pulsó una vez, pero no se ha podido verificar el carrito completo. No se repite el envío.' });
    } else await report(tabId, binding, snapshot);
  } else if (pending?.outcome) await report(tabId, binding, snapshot, pending.outcome);
  else await report(tabId, binding, snapshot);

  binding = await read(tabId);
  const response = await api('poll', credentials(binding));
  const commands = response.commands || [];
  for (const command of commands) {
    if (command.accountId !== binding.accountId || command.eventRef !== binding.eventRef) continue;
    if (command.type === 'FOCUS') {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      continue;
    }
    if (command.type !== 'ADD_TO_CART' || binding.completed.includes(command.id) || (binding.completedKeys || []).includes(command.idempotencyKey) || binding.pending) continue;
    if (command.accountId !== binding.accountId || command.eventRef !== binding.eventRef || !command.idempotencyKey) continue;
    binding.pending = { command, receivedAt: Date.now(), submitted: false };
    await save(tabId, binding);
  }
  pending = binding.pending;
  if (pending && !pending.submitted && !pending.outcome && snapshot.session === 'READY' && snapshot.queue === 'PASSED') {
    // Delivery can disappear on navigation: the persisted pre-click ledger prevents a repeat.
    const result = await chrome.tabs.sendMessage(tabId, { type: 'execute', command: pending.command, binding: publicBinding(binding) }).catch(() => null);
    binding = await read(tabId);
    if (!result && binding?.pending && !binding.pending.submitted) {
      binding.pending.outcome = { status: 'REJECTED', detail: 'La pestaña cambió o la extensión dejó de estar disponible antes del clic. Revisa la conexión.' };
      await save(tabId, binding);
      await report(tabId, binding, snapshot, binding.pending.outcome);
    }
    if (result?.outcome && binding?.pending && !binding.pending.submitted) {
      binding.pending.outcome = result.outcome;
      await save(tabId, binding);
      await report(tabId, binding, result.snapshot || snapshot, result.outcome);
    }
  }
  const detail = snapshot.session === 'CHALLENGE_REQUIRED' ? 'Resuelve la comprobación humana en esta pestaña. Continuará automáticamente.'
    : !snapshot.supported ? (snapshot.detail || 'Página incompatible: falta una lectura verificable de inventario y carrito.')
    : 'Conectada. ' + (snapshot.cart?.items?.length ? 'Carrito leído en esta pestaña.' : 'Esperando la orden de la sala.');
  await status(tabId, detail);
  return { connected: true, detail };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const tabId = sender.tab?.id ?? message.tabId;
  (async () => {
    if (message.type === 'binding') { const binding = await read(tabId); return binding ? publicBinding(binding) : null; }
    if (message.type === 'status' && !sender.tab) { const binding = await read(tabId); return { connected: !!binding, detail: binding?.detail }; }
    if (message.type === 'pair' && !sender.tab) return serial(tabId, () => pair(message));
    if (message.type === 'disconnect' && !sender.tab) {
      const binding = await read(tabId);
      if (binding?.pending) throw new Error('Hay un intento pendiente: comprueba el carrito antes de desconectar.');
      await chrome.storage.session.remove(key(tabId));
      await chrome.action.setBadgeText({ tabId, text: '' });
      return { ok: true };
    }
    if (message.type === 'tick' && sender.tab) return serial(tabId, () => tick(tabId, message.snapshot));
    if (message.type === 'before-click' && sender.tab) {
      // Deliberately outside serial(): execute is waiting for this durable acknowledgement.
      const binding = await read(tabId);
      const pending = binding?.pending;
      if (!pending || pending.command.id !== message.commandId || pending.submitted || !TicketCartEvidence.validCart(message.beforeCart, publicBinding(binding)) || message.beforeCart.items.length) return { ok: false };
      pending.submitted = true;
      pending.submittedAt = Date.now();
      pending.beforeCart = message.beforeCart;
      await save(tabId, binding);
      return { ok: true };
    }
    return { ok: false };
  })().then(respond).catch(async (error) => {
    const detail = String(error.message || error);
    if (sender.tab) await status(tabId, 'Conexión interrumpida. ' + detail).catch(() => {});
    respond({ ok: false, error: detail });
  });
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => { void chrome.storage.session.remove(key(tabId)); });
