'use strict';
const status = document.getElementById('status');
let currentTab;
async function load() {
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await chrome.runtime.sendMessage({ type: 'status', tabId: currentTab?.id });
  status.textContent = result?.detail || 'Esta pestaña todavía no está conectada.';
  document.getElementById('disconnect').hidden = !result?.connected;
}
document.getElementById('pair').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('connect');
  button.disabled = true;
  try {
    const url = new URL(currentTab?.url || '');
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Abre primero la página del evento.');
    const allowed = await chrome.permissions.request({ origins: [url.origin + '/*'] });
    if (!allowed) throw new Error('Hace falta acceso a esta web para leer y manejar esta pestaña.');
    const result = await chrome.runtime.sendMessage({ type: 'pair', tabId: currentTab.id, pairingCode: document.getElementById('code').value.trim() });
    if (!result?.ok) throw new Error(result?.error || 'No se pudo conectar.');
    document.getElementById('code').value = '';
    await load();
  } catch (error) { status.textContent = error.message || String(error); }
  finally { button.disabled = false; }
});
document.getElementById('disconnect').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'disconnect', tabId: currentTab.id });
  if (result?.ok === false) status.textContent = result.error;
  else await load();
});
load().catch(() => { status.textContent = 'Abre la página del evento y vuelve a abrir esta ventana.'; });
