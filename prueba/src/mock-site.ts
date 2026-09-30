/**
 * Réplica local, muy simplificada, del flujo de venta de tickets.realmadrid.com (Onebox):
 *   /mock/realmadrid_femenino/select/<id>   → selección de zona y cantidad (exige sesión)
 *   /mock/login                             → login de socio/madridista (acepta cualquier dato)
 *   /mock/cola                              → cola virtual opcional (?cola=1), se pasa sola en 5 s
 *   /mock/realmadrid_femenino/checkout/<id> → resumen de compra con temporizador
 *
 * Sirve para probar el bot y Telegram de principio a fin sin tocar la web real.
 * El botón "Pagar" no hace nada: el pago nunca se automatiza.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const MOCK_EVENT_ID = '9000001';
export const MOCK_EVENT_PATH = `/mock/realmadrid_femenino/select/${MOCK_EVENT_ID}`;
const MAX_PER_ACCOUNT = 4;
const CART_TTL_MS = 10 * 60_000;

interface Zone {
  id: string;
  name: string;
  priceCents: number;
  soldOut: boolean;
}

const ZONES: Zone[] = [
  { id: 'tribuna', name: 'Tribuna Principal', priceCents: 4000, soldOut: false },
  { id: 'lateral-este', name: 'Lateral Este', priceCents: 2500, soldOut: false },
  { id: 'lateral-oeste', name: 'Lateral Oeste', priceCents: 3000, soldOut: false },
  { id: 'fondo-norte', name: 'Fondo Norte', priceCents: 1200, soldOut: true },
  { id: 'fondo-sur', name: 'Fondo Sur', priceCents: 1500, soldOut: false },
];

function nextSunday(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  d.setHours(18, 0, 0, 0);
  return d;
}

export const MOCK_EVENT = {
  name: 'Real Madrid Femenino vs FC Barcelona',
  venue: 'Estadio Alfredo Di Stéfano',
  startsAt: nextSunday(),
};

interface MockCart {
  id: string;
  sid: string;
  items: Array<{ zone: Zone; qty: number }>;
  expiresAt: number;
}

const sessions = new Map<string, { email: string }>();
const carts = new Map<string, MockCart>();

export function euros(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function page(title: string, body: string, userEmail: string | null = null): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Entradas Real Madrid (SIMULADO)</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;background:#f4f5f8;color:#0b1f4d}
  header{background:#fff;border-bottom:1px solid #dde;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
  .sim{background:#ffe08a;color:#553;padding:6px 24px;font-size:13px}
  main{max-width:760px;margin:24px auto;background:#fff;border-radius:12px;padding:24px}
  .zone{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #eee}
  .zone.sold-out{opacity:.5}
  button,.btn{background:#3b28e0;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer;text-decoration:none}
  .error{color:#b00020}
  input{padding:8px;font-size:15px;width:100%;box-sizing:border-box;margin:4px 0 12px}
</style></head><body>
<div class="sim">Entorno SIMULADO local — no es la web real del Real Madrid</div>
<header><strong>Entradas Real Madrid</strong><span>${userEmail ? `Sesión: ${esc(userEmail)}` : '<a href="/mock/login">Acceder</a>'}</span></header>
<main>${body}</main></body></html>`;
}

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { location, ...headers });
  res.end();
}

function safeNext(next: string | null): string {
  return next && next.startsWith('/mock/') ? next : MOCK_EVENT_PATH;
}

function cartTotal(cart: MockCart): number {
  return cart.items.reduce((sum, i) => sum + i.qty * i.zone.priceCents, 0);
}

function selectPage(email: string, error: string | null): string {
  const d = MOCK_EVENT.startsAt;
  const rows = ZONES.map((z) => {
    const opts = Array.from({ length: MAX_PER_ACCOUNT + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join('');
    return `<li class="zone${z.soldOut ? ' sold-out' : ''}" data-zone="${z.id}">
      <span class="zone-name">${esc(z.name)}</span>
      <span class="price">${euros(z.priceCents)}</span>
      ${
        z.soldOut
          ? '<span class="status">Agotado</span>'
          : `<label>Cantidad <select name="qty-${z.id}" aria-label="Cantidad ${esc(z.name)}">${opts}</select></label>`
      }
    </li>`;
  }).join('');
  return page(
    'Selecciona tus entradas',
    `<h1>${esc(MOCK_EVENT.name)}</h1>
     <p>${esc(MOCK_EVENT.venue)} · ${d.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })}</p>
     <h2>Selecciona tus entradas</h2>
     ${error ? `<p class="error">${esc(error)}</p>` : ''}
     <form method="post" action="${MOCK_EVENT_PATH}/add">
       <ul class="price-zones" style="list-style:none;padding:0">${rows}</ul>
       <p>Máximo ${MAX_PER_ACCOUNT} entradas por cuenta.</p>
       <button type="submit">Añadir al carrito</button>
     </form>`,
    email,
  );
}

function checkoutPage(cart: MockCart, email: string | null): string {
  const rows = cart.items
    .map((i) => `<tr><td>${esc(i.zone.name)}</td><td>${i.qty}</td><td>${euros(i.zone.priceCents)}</td><td>${euros(i.qty * i.zone.priceCents)}</td></tr>`)
    .join('');
  return page(
    'Resumen de compra',
    `<h1>Resumen de compra</h1>
     <p>${esc(MOCK_EVENT.name)} · ${esc(MOCK_EVENT.venue)}</p>
     <table style="width:100%;text-align:left"><thead><tr><th>Zona</th><th>Cantidad</th><th>Precio</th><th>Importe</th></tr></thead>
     <tbody>${rows}</tbody></table>
     <p class="cart-total"><strong>Total: ${euros(cartTotal(cart))}</strong></p>
     <p>Tiempo restante para completar la compra: <span id="timer" data-expires-at="${new Date(cart.expiresAt).toISOString()}"></span></p>
     <button onclick="alert('Pago SIMULADO: en la web real aquí pagarías tú.')">Pagar</button>
     <form method="post" action="/mock/realmadrid_femenino/checkout/${cart.id}/vaciar" style="display:inline"><button style="background:#888">Vaciar carrito</button></form>
     <script>
       const el=document.getElementById('timer');const end=Date.parse(el.dataset.expiresAt);
       const tick=()=>{const s=Math.max(0,Math.round((end-Date.now())/1000));el.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');if(s===0)location.reload()};
       tick();setInterval(tick,1000);
     </script>`,
    email,
  );
}

/** Atiende las rutas /mock/*. Devuelve false si la ruta no es suya. */
export async function handleMock(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/mock')) return false;
  const jar = cookies(req);
  const sid = jar['rm_mock_sid'] ?? null;
  const session = sid ? sessions.get(sid) ?? null : null;
  const now = Date.now();
  for (const [id, c] of carts) if (c.expiresAt < now) carts.delete(id);

  // --- Login -------------------------------------------------------------
  if (url.pathname === '/mock/login') {
    const next = safeNext(url.searchParams.get('next'));
    if (req.method === 'POST') {
      const form = await readForm(req);
      const email = form.get('email')?.trim() ?? '';
      const password = form.get('password') ?? '';
      if (!email.includes('@') || !password) {
        send(res, 400, page('Acceder', loginForm(next, 'Introduce un email y una contraseña.')));
        return true;
      }
      const newSid = randomBytes(16).toString('hex');
      sessions.set(newSid, { email });
      redirect(res, next, { 'set-cookie': `rm_mock_sid=${newSid}; Path=/mock; HttpOnly; SameSite=Lax` });
      return true;
    }
    send(res, 200, page('Acceder', loginForm(next, null)));
    return true;
  }

  // --- Cola virtual opcional ----------------------------------------------
  if (url.pathname === '/mock/cola') {
    const next = safeNext(url.searchParams.get('next'));
    send(
      res,
      200,
      page(
        'Cola virtual',
        `<h1>Estás en la cola virtual</h1><p>Posición aproximada: <span id="pos">5</span>. No cierres esta página.</p>
         <script>let n=5;const t=setInterval(()=>{n--;document.getElementById('pos').textContent=n;if(n<=0){clearInterval(t);location.href='/mock/cola/ok?next='+encodeURIComponent(${JSON.stringify(next)})}},1000)</script>`,
      ),
    );
    return true;
  }
  if (url.pathname === '/mock/cola/ok') {
    redirect(res, safeNext(url.searchParams.get('next')), { 'set-cookie': 'rm_mock_queue_ok=1; Path=/mock; SameSite=Lax' });
    return true;
  }

  // --- Selección de entradas --------------------------------------------
  if (url.pathname === MOCK_EVENT_PATH) {
    const here = url.pathname + url.search;
    if (url.searchParams.get('cola') === '1' && jar['rm_mock_queue_ok'] !== '1') {
      redirect(res, `/mock/cola?next=${encodeURIComponent(here)}`);
      return true;
    }
    if (!session) {
      redirect(res, `/mock/login?next=${encodeURIComponent(here)}`);
      return true;
    }
    send(res, 200, selectPage(session.email, null));
    return true;
  }
  if (url.pathname === `${MOCK_EVENT_PATH}/add` && req.method === 'POST') {
    if (!session || !sid) {
      redirect(res, `/mock/login?next=${encodeURIComponent(MOCK_EVENT_PATH)}`);
      return true;
    }
    const form = await readForm(req);
    const items = ZONES.filter((z) => !z.soldOut)
      .map((zone) => ({ zone, qty: Number(form.get(`qty-${zone.id}`) ?? 0) }))
      .filter((i) => Number.isInteger(i.qty) && i.qty > 0);
    const qty = items.reduce((s, i) => s + i.qty, 0);
    if (qty === 0) {
      send(res, 400, selectPage(session.email, 'Selecciona al menos una entrada.'));
      return true;
    }
    if (qty > MAX_PER_ACCOUNT) {
      send(res, 400, selectPage(session.email, `Máximo ${MAX_PER_ACCOUNT} entradas por cuenta.`));
      return true;
    }
    const cart: MockCart = { id: randomBytes(6).toString('hex'), sid, items, expiresAt: now + CART_TTL_MS };
    carts.set(cart.id, cart);
    redirect(res, `/mock/realmadrid_femenino/checkout/${cart.id}`);
    return true;
  }

  // --- Carrito / checkout -----------------------------------------------
  const m = /^\/mock\/realmadrid_femenino\/checkout\/([a-f0-9]+)(\/vaciar)?$/.exec(url.pathname);
  if (m) {
    const cart = carts.get(m[1]!);
    if (m[2] && req.method === 'POST') {
      carts.delete(m[1]!);
      send(res, 200, page('Carrito vacío', `<h1>Carrito vacío</h1><p>Las entradas se han liberado.</p><a class="btn" href="${MOCK_EVENT_PATH}">Volver</a>`, session?.email ?? null));
      return true;
    }
    if (!cart) {
      send(res, 404, page('Carrito caducado', `<h1>Tu carrito ha caducado</h1><a class="btn" href="${MOCK_EVENT_PATH}">Volver a seleccionar</a>`, session?.email ?? null));
      return true;
    }
    // Accesible sin sesión a propósito: así puedes abrir el enlace desde otro navegador de tu PC.
    send(res, 200, checkoutPage(cart, session?.email ?? null));
    return true;
  }

  send(res, 404, page('No encontrado', '<h1>Página no encontrada</h1>'));
  return true;
}

function loginForm(next: string, error: string | null): string {
  return `<h1>Acceder</h1><p>Inicia sesión con tu cuenta Real Madrid (simulado: vale cualquier email).</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/mock/login?next=${encodeURIComponent(next)}">
    <label>Email<input type="email" name="email" autocomplete="username"></label>
    <label>Contraseña<input type="password" name="password" autocomplete="current-password"></label>
    <button type="submit">Iniciar sesión</button>
  </form>`;
}

/** Libera un carrito simulado (usado cuando respondes "No" en Telegram). */
export function releaseMockCart(cartId: string): boolean {
  return carts.delete(cartId);
}
