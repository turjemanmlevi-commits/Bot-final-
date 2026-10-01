/** HTML del panel local (una sola página, sin dependencias). */

export interface PanelDefaults {
  realEventUrl: string;
  quantity: number;
  zones: string;
  maxUnitPriceEur: number | null;
  contiguous: boolean;
  fallbackFewer: boolean;
}

function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function panelHtml(d: PanelDefaults): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prueba de carrito · Real Madrid Femenino</title>
<style>
  :root{--bg:#f5f6fa;--card:#fff;--ink:#101828;--muted:#667085;--line:#e4e7ec;--accent:#3b28e0;--ok:#067647;--warn:#b54708;--err:#b42318;--human:#6941c6}
  @media (prefers-color-scheme: dark){:root{--bg:#0c111d;--card:#161b26;--ink:#f5f5f6;--muted:#94969c;--line:#2a303c;--accent:#7a6cff;--ok:#47cd89;--warn:#fdb022;--err:#f97066;--human:#b692f6}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
  main{max-width:1040px;margin:0 auto;padding:24px 16px;display:grid;gap:16px;grid-template-columns:minmax(0,380px) minmax(0,1fr)}
  @media (max-width:760px){main{grid-template-columns:1fr}}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:0 0 12px;color:var(--muted);font-weight:600}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
  input[type=text],input[type=number],input[type=url],input[type=password]{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink);font:inherit}
  .modes{display:flex;gap:8px}.modes label{flex:1;margin:0;border:1px solid var(--line);border-radius:8px;padding:8px;cursor:pointer;color:var(--ink)}
  .modes input{margin-right:6px}.check{display:flex;gap:6px;align-items:center;color:var(--ink);margin-top:8px}
  button{font:inherit;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
  .primary{background:var(--accent);color:#fff;width:100%;margin-top:16px;font-weight:600;font-size:16px}
  .primary:disabled{opacity:.5;cursor:default}
  .ghost{background:transparent;border:1px solid var(--line);color:var(--ink)}
  .pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;background:var(--line)}
  .pill.RUNNING{background:#d1e0ff;color:#1d3fa8}.pill.WAITING_HUMAN{background:#ebe9fe;color:#5925dc}
  .pill.CART_SECURED,.pill.OPENED{background:#dcfae6;color:#067647}.pill.FAILED,.pill.EXPIRED{background:#fee4e2;color:#b42318}
  .muted{color:var(--muted);font-size:13px}
  #log{list-style:none;margin:0;padding:0;max-height:420px;overflow:auto;font:12.5px/1.5 ui-monospace,Menlo,monospace}
  #log li{padding:2px 0;border-bottom:1px dashed var(--line);overflow-wrap:anywhere}
  .l-ok{color:var(--ok)}.l-warn{color:var(--warn)}.l-error{color:var(--err)}.l-human{color:var(--human);font-weight:600}
  #cart{display:none;border-color:var(--ok)} #cart img{max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:8px}
  .actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.yes{background:var(--ok);color:#fff}.no{background:var(--err);color:#fff}
  .real-only{display:none} body.real .real-only{display:block} body.real .sim-only{display:none}
  .note{font-size:12.5px;color:var(--muted);margin-top:10px}
  details summary{cursor:pointer;font-weight:600}
</style></head>
<body>
<main>
  <section class="card">
    <h1>Prueba de carrito · Real Madrid Femenino</h1>
    <p class="muted">Web del Real Madrid → partido del femenino → asientos → carrito → aviso por Telegram. El pago siempre lo haces tú.</p>
    <button class="primary" id="quick" type="button" style="margin-top:4px">⚡ Prueba rápida: 3 entradas seguidas, cualquier zona</button>
    <p class="note">Entra en tickets.realmadrid.com, coge el próximo partido del femenino a la venta, mete 3 entradas seguidas (si no hay 3, las que haya) en el carrito, pulsa «Comprar entradas» para dejar abierta la pantalla de pago y te manda por Telegram la captura con el enlace. Pagar, lo pagas tú.</p>
    <details style="margin-top:12px"><summary>Prueba con mis propios requisitos</summary>
    <form id="f">
      <label>Modo</label>
      <div class="modes">
        <label><input type="radio" name="mode" value="real" checked>Web real</label>
        <label><input type="radio" name="mode" value="simulado">Simulado</label>
      </div>
      <div class="real-only">
        <label for="eventUrl">Partido (opcional)</label>
        <input id="eventUrl" type="url" placeholder="vacío = el próximo partido del femenino a la venta" value="${attr(d.realEventUrl)}">
        <p class="note">Se abre una ventana de Chrome con tu perfil guardado. Si la web pide login, cola o una verificación, hazlo tú en esa ventana: el bot sigue solo.</p>
      </div>
      <p class="note sim-only">Réplica local de la web de Onebox (catálogo, login, cola, plano con asientos, carrito). No toca la web del Real Madrid.</p>
      <label for="quantity">Entradas</label>
      <input id="quantity" type="number" min="1" max="10" value="${d.quantity}">
      <label class="check"><input id="contiguous" type="checkbox" ${d.contiguous ? 'checked' : ''}> Asientos seguidos (misma fila)</label>
      <label class="check"><input id="fallback" type="checkbox" ${d.fallbackFewer ? 'checked' : ''}> Si no hay tantas, acepta menos entradas</label>
      <label for="zones">Zonas preferidas (en orden, separadas por comas)</label>
      <input id="zones" type="text" placeholder="Lateral Oeste, Tribuna" value="${attr(d.zones)}">
      <p class="note">Vacío = la zona más barata que tenga sitio. Vale con parte del nombre («oeste», «tribuna»).</p>
      <label for="maxUnitPrice">Precio máximo por entrada (€)</label>
      <input id="maxUnitPrice" type="text" inputmode="decimal" placeholder="sin límite" value="${d.maxUnitPriceEur ?? ''}">
      <div class="sim-only">
        <label class="check"><input id="entry" type="checkbox" checked> Entrar por el catálogo (elige el partido solo)</label>
        <label class="check"><input id="queue" type="checkbox"> Simular cola virtual</label>
        <label class="check"><input id="challenge" type="checkbox"> Simular verificación (CAPTCHA)</label>
        <label class="check"><input id="auto" type="checkbox"> Zonas con «Buscar asientos» (selección automática)</label>
        <label class="check"><input id="list" type="checkbox"> Lista de zonas sin plano</label>
        <label class="check"><input id="cross" type="checkbox"> Diálogo «¿quieres añadir más?» al ir a pagar</label>
        <label class="check"><input id="headless" type="checkbox"> Navegador oculto</label>
      </div>
      <button class="primary" id="go" type="submit">▶ Hacer prueba</button>
    </form>
    </details>
    <p class="note" id="tg"></p>
    <details id="tgbox" style="margin-top:8px">
      <summary>Conectar Telegram</summary>
      <label for="tgToken">Token del bot (te lo dio @BotFather)</label>
      <input id="tgToken" type="password" autocomplete="off" placeholder="123456789:ABC…">
      <label for="tgChat">Chat ID (déjalo vacío: escribe «hola» a tu bot y lo detecto)</label>
      <input id="tgChat" type="text" placeholder="automático">
      <button class="ghost" id="tgSave" type="button" style="margin-top:10px;width:100%">Guardar y probar</button>
      <p class="note" id="tgMsg"></p>
    </details>
  </section>

  <section style="display:grid;gap:16px;align-content:start">
    <div class="card" id="cart">
      <h2 id="cartTitle">🎟️ ¡Entradas en el carrito!</h2>
      <div id="cartBody"></div>
      <p style="margin:12px 0 0;font-weight:600">¿Quieres comprar las entradas?</p>
      <div class="actions">
        <button class="yes" data-d="comprar">Sí, ábreme el carrito</button>
        <button class="no" data-d="cancelar">No, liberar</button>
        <a id="cartLink" class="ghost" style="padding:10px 16px;border-radius:8px;text-decoration:none;color:inherit" target="_blank" rel="noopener">Abrir enlace</a>
      </div>
      <img id="shot" alt="Captura del carrito">
    </div>
    <div class="card">
      <h2>Estado <span id="status" class="pill">IDLE</span> <button class="ghost" id="stop" style="float:right;padding:4px 10px">Parar</button></h2>
      <ul id="log"><li class="muted">Pulsa «Hacer prueba» para empezar.</li></ul>
    </div>
  </section>
</main>
<script>
const $ = (s) => document.querySelector(s);
const eur = (c) => c == null ? '—' : (c/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' €';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function syncMode(){ document.body.classList.toggle('real', document.querySelector('input[name=mode]:checked').value === 'real'); }
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', syncMode));
syncMode();

async function start(body) {
  const r = await fetch('/api/prueba', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
  if (!r.ok) alert((await r.json()).error);
}
$('#quick').addEventListener('click', () => start({ mode: 'real', eventUrl: '', quantity: 3, zones: '', maxUnitPrice: '', contiguous: true, fallback: true }));
$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  await start({
    mode: document.querySelector('input[name=mode]:checked').value,
    eventUrl: $('#eventUrl').value, quantity: Number($('#quantity').value), zones: $('#zones').value,
    maxUnitPrice: $('#maxUnitPrice').value, contiguous: $('#contiguous').checked, fallback: $('#fallback').checked,
    entry: $('#entry').checked ? 'canal' : 'partido', queue: $('#queue').checked, challenge: $('#challenge').checked,
    auto: $('#auto').checked, list: $('#list').checked, cross: $('#cross').checked, headless: $('#headless').checked,
  });
});
document.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
  const r = await fetch('/api/decision', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ decision: b.dataset.d }) });
  if (!r.ok) alert((await r.json()).error);
}));
$('#stop').addEventListener('click', () => fetch('/api/parar', { method: 'POST' }));
$('#tgSave').addEventListener('click', async () => {
  $('#tgMsg').textContent = 'Comprobando…';
  const r = await fetch('/api/telegram', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ token: $('#tgToken').value, chatId: $('#tgChat').value }) });
  const j = await r.json();
  $('#tgMsg').textContent = r.ok ? '¡Listo! Te he mandado un mensaje de prueba a Telegram.' : j.error;
  if (r.ok) $('#tgToken').value = '';
});
let tgOpened = false;

let shownShot = null;
function render(s) {
  $('#status').textContent = s.status; $('#status').className = 'pill ' + s.status;
  const busy = ['RUNNING','WAITING_HUMAN','CART_SECURED'].includes(s.status);
  $('#go').disabled = busy; $('#go').textContent = busy ? 'Prueba en marcha…' : '▶ Hacer prueba';
  $('#quick').disabled = busy; $('#quick').textContent = busy ? 'Prueba en marcha…' : '⚡ Prueba rápida: 3 entradas seguidas, cualquier zona';
  $('#tg').textContent = 'Telegram: ' + s.telegram.detail;
  if (!tgOpened) { tgOpened = true; $('#tgbox').open = !s.telegram.configured; }
  $('#log').innerHTML = s.log.length ? s.log.map((l) => '<li class="l-' + l.level + '">' + new Date(l.at).toLocaleTimeString('es-ES') + '  ' + esc(l.message) + '</li>').join('') : '<li class="muted">Pulsa «Hacer prueba» para empezar.</li>';
  $('#log').scrollTop = $('#log').scrollHeight;
  const c = s.cart;
  $('#cart').style.display = c ? 'block' : 'none';
  if (c) {
    $('#cartTitle').textContent = c.stage === 'checkout' ? '🎟️ ¡Entradas en el carrito y pantalla de pago abierta!' : '🎟️ ¡Entradas en el carrito!';
    $('#cartBody').innerHTML = '<div><b>' + esc(c.eventTitle) + '</b></div><div class="muted">Cuenta: ' + esc(s.account || '—') + '</div>'
      + c.items.map((i) => '<div>' + i.qty + ' × ' + esc(i.sectionLabel) + ' — ' + eur(i.unitPrice) + '</div>').join('')
      + '<div><b>Total: ' + eur(c.total) + '</b></div>'
      + (c.expiresAt ? '<div class="muted">Caduca a las ' + new Date(c.expiresAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}) + '</div>' : '')
      + (c.strategy ? '<div class="muted">Método: ' + esc(c.strategy) + '</div>' : '');
    $('#cartLink').href = c.url;
    document.querySelectorAll('[data-d]').forEach((b) => b.disabled = s.status !== 'CART_SECURED');
    if (c.screenshot && shownShot !== c.screenshot) { shownShot = c.screenshot; $('#shot').src = '/api/captura?t=' + Date.now(); }
  }
}
const es = new EventSource('/api/eventos');
es.onmessage = (e) => render(JSON.parse(e.data));
</script>
</body></html>`;
}
