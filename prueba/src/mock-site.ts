/**
 * Réplica local de la web de entradas del Real Madrid (plataforma Onebox «channels-client»),
 * con el MISMO DOM que usa el bot: componentes `ob-*`, `data-testid`, plano SVG con
 * `circle.interactive.seat.available`, diálogo de tarifa, resumen del carrito con cuenta atrás…
 *
 *   /mock/realmadrid_femenino/                      → catálogo (ob-page-events)
 *   /mock/realmadrid_femenino/events/700            → ficha del partido con sus sesiones
 *   /mock/realmadrid_femenino/select/9000001        → selección (plano o lista con ?lista=1)
 *   /mock/realmadrid_femenino/checkout              → checkout (el bot NUNCA llega aquí solo)
 *   /mock/cola, /mock/login, /mock/reto/ok           → cola virtual, login y verificación
 *
 * Banderas (en la URL, se arrastran por los enlaces): ?cola=1 ?reto=1 ?login=0 ?auto=1 ?lista=1
 * Sirve para probar el bot y Telegram de principio a fin sin tocar la web real.
 * El botón «Pagar» solo marca `paid=true` (lo comprueba la prueba de humo): el pago nunca se automatiza.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const MOCK_CHANNEL_PATH = '/mock/realmadrid_femenino/';
export const MOCK_EVENT_ID = '9000001';
export const MOCK_EVENT_PATH = `/mock/realmadrid_femenino/select/${MOCK_EVENT_ID}`;
const MAX_PER_CART = 4;
const CART_TTL_MS = 10 * 60_000;
const FLAG_KEYS = ['cola', 'reto', 'login', 'auto', 'lista'] as const;

export interface MockZone {
  id: string;
  name: string;
  priceCents: number;
  kind: 'seats' | 'nnz';
  rows: number;
  perRow: number;
  /** Claves "fila-asiento" vendidas. */
  sold: Set<string>;
  capacity: number;
}

function soldRows(spec: Record<number, number[] | 'all'>, perRow: number): Set<string> {
  const out = new Set<string>();
  for (const [row, seats] of Object.entries(spec)) {
    const list = seats === 'all' ? Array.from({ length: perRow }, (_, i) => i + 1) : seats;
    for (const s of list) out.add(`${row}-${s}`);
  }
  return out;
}

export const ZONES: MockZone[] = [
  { id: '11', name: 'Tribuna Central', priceCents: 4000, kind: 'seats', rows: 4, perRow: 10, sold: soldRows({ 1: 'all', 2: [1, 2, 3, 7], 3: [5] }, 10), capacity: 40 },
  { id: '12', name: 'Tribuna Lateral', priceCents: 3000, kind: 'seats', rows: 3, perRow: 10, sold: soldRows({ 1: [2, 4, 6, 8, 10], 2: [1, 2, 3, 4, 5] }, 10), capacity: 30 },
  { id: '13', name: 'Lateral Oeste', priceCents: 2500, kind: 'seats', rows: 4, perRow: 12, sold: soldRows({ 1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 2: [1, 2, 3, 4, 10, 11, 12], 3: [6], 4: [2, 5] }, 12), capacity: 48 },
  { id: '14', name: 'Fondo Sur', priceCents: 1500, kind: 'seats', rows: 3, perRow: 8, sold: soldRows({ 1: [1, 3, 5, 7] }, 8), capacity: 24 },
  { id: '15', name: 'Fondo Norte', priceCents: 1200, kind: 'seats', rows: 2, perRow: 8, sold: soldRows({ 1: 'all', 2: 'all' }, 8), capacity: 16 },
  { id: '16', name: 'Grada de pie', priceCents: 1000, kind: 'nnz', rows: 0, perRow: 0, sold: new Set(), capacity: 50 },
];

function nextSunday(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  d.setHours(18, 0, 0, 0);
  return d;
}

export const MOCK_EVENT = {
  id: '700',
  name: 'Real Madrid Femenino - FC Barcelona',
  venue: 'Estadio Alfredo Di Stéfano',
  startsAt: nextSunday(),
};

export interface MockCartItem {
  id: string;
  zoneId: string;
  zoneName: string;
  row: number | null;
  seat: number | null;
  qty: number;
  priceCents: number;
  rate: string;
}

interface MockCart {
  sid: string;
  items: MockCartItem[];
  expiresAt: number;
}

const sessions = new Map<string, { email: string }>();
const carts = new Map<string, MockCart>();
const flags = { paid: false, checkoutVisited: false, pays: 0 };

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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(html);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { location, ...headers });
  res.end();
}

function safeNext(next: string | null): string {
  return next && next.startsWith('/mock/') ? next : MOCK_EVENT_PATH;
}

/** Banderas de la URL que se arrastran por todos los enlaces del mock. */
function carry(url: URL): string {
  const q = new URLSearchParams();
  q.set('hl', 'es-ES');
  for (const k of FLAG_KEYS) if (url.searchParams.has(k)) q.set(k, url.searchParams.get(k)!);
  return `?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Estado de asientos y carritos
// ---------------------------------------------------------------------------

function seatId(zone: MockZone, row: number, seat: number): string {
  return `s-${zone.id}-${row}-${seat}`;
}

function parseSeatId(id: string): { zone: MockZone; row: number; seat: number } | null {
  const m = /^s-(\d+)-(\d+)-(\d+)$/.exec(id);
  if (!m) return null;
  const zone = ZONES.find((z) => z.id === m[1]);
  if (!zone || zone.kind !== 'seats') return null;
  const row = Number(m[2]);
  const seat = Number(m[3]);
  if (row < 1 || row > zone.rows || seat < 1 || seat > zone.perRow) return null;
  return { zone, row, seat };
}

function expireCarts(): void {
  const now = Date.now();
  for (const [id, c] of carts) if (c.expiresAt < now) carts.delete(id);
}

/** Asiento ocupado por otro carrito (o vendido). */
function heldBy(zone: MockZone, row: number, seat: number): string | null {
  if (zone.sold.has(`${row}-${seat}`)) return 'sold';
  for (const c of carts.values()) if (c.items.some((i) => i.zoneId === zone.id && i.row === row && i.seat === seat)) return c.sid;
  return null;
}

function cartOf(sid: string): MockCart {
  expireCarts();
  let c = carts.get(sid);
  if (!c) {
    c = { sid, items: [], expiresAt: Date.now() + CART_TTL_MS };
    carts.set(sid, c);
  }
  return c;
}

function cartQty(c: MockCart): number {
  return c.items.reduce((s, i) => s + i.qty, 0);
}

function cartView(sid: string): { items: MockCartItem[]; qty: number; totalCents: number; expiresAt: string | null } {
  expireCarts();
  const c = carts.get(sid);
  if (!c || c.items.length === 0) return { items: [], qty: 0, totalCents: 0, expiresAt: null };
  return { items: c.items, qty: cartQty(c), totalCents: c.items.reduce((s, i) => s + i.qty * i.priceCents, 0), expiresAt: new Date(c.expiresAt).toISOString() };
}

function zoneAvailability(zone: MockZone): number {
  if (zone.kind === 'nnz') {
    let used = 0;
    for (const c of carts.values()) for (const i of c.items) if (i.zoneId === zone.id) used += i.qty;
    return Math.max(0, zone.capacity - used);
  }
  let n = 0;
  for (let r = 1; r <= zone.rows; r++) for (let s = 1; s <= zone.perRow; s++) if (!heldBy(zone, r, s)) n++;
  return n;
}

function zoneSeats(zone: MockZone, sid: string): Array<{ id: string; row: number; seat: number; state: 'available' | 'sold-out' | 'selected' }> {
  const out: Array<{ id: string; row: number; seat: number; state: 'available' | 'sold-out' | 'selected' }> = [];
  for (let r = 1; r <= zone.rows; r++) {
    for (let s = 1; s <= zone.perRow; s++) {
      const h = heldBy(zone, r, s);
      out.push({ id: seatId(zone, r, s), row: r, seat: s, state: h === null ? 'available' : h === sid ? 'selected' : 'sold-out' });
    }
  }
  return out;
}

type AddResult = { ok: true; cart: ReturnType<typeof cartView> } | { ok: false; alert?: 'NON_CONSECUTIVE' | 'ORPHAN'; error?: string };

function addSeat(sid: string, id: string, rate: string, force: boolean): AddResult {
  const parsed = parseSeatId(id);
  if (!parsed) return { ok: false, error: 'Asiento desconocido' };
  const { zone, row, seat } = parsed;
  const held = heldBy(zone, row, seat);
  if (held === sid) return { ok: true, cart: cartView(sid) };
  if (held) return { ok: false, error: 'Ese asiento ya no está disponible' };
  const cart = cartOf(sid);
  if (cartQty(cart) >= MAX_PER_CART) return { ok: false, error: `Máximo ${MAX_PER_CART} entradas por compra` };
  if (!force) {
    const mine = cart.items.filter((i) => i.zoneId === zone.id && i.row === row).map((i) => i.seat!);
    if (mine.length && !mine.some((s) => Math.abs(s - seat) === 1)) return { ok: false, alert: 'NON_CONSECUTIVE' };
    // ¿Deja un asiento suelto entre este y uno ocupado?
    const free = (s: number): boolean => s >= 1 && s <= zone.perRow && heldBy(zone, row, s) === null;
    const orphanLeft = free(seat - 1) && !free(seat - 2);
    const orphanRight = free(seat + 1) && !free(seat + 2);
    if ((orphanLeft && !mine.includes(seat - 1)) || (orphanRight && !mine.includes(seat + 1))) {
      // Solo avisa si el hueco que queda es exactamente 1 asiento (como la web real).
      if ((orphanLeft && seat - 1 >= 1 && !free(seat - 2)) || (orphanRight && seat + 1 <= zone.perRow && !free(seat + 2))) return { ok: false, alert: 'ORPHAN' };
    }
  }
  cart.items.push({ id: randomBytes(4).toString('hex'), zoneId: zone.id, zoneName: zone.name, row, seat, qty: 1, priceCents: zone.priceCents, rate });
  return { ok: true, cart: cartView(sid) };
}

/** Selección automática: primer tramo de `qty` asientos seguidos que no deje huérfanos. */
function addAuto(sid: string, zoneId: string, qty: number, rate: string): AddResult {
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone || zone.kind !== 'seats') return { ok: false, error: 'Zona desconocida' };
  const cart = cartOf(sid);
  if (cartQty(cart) + qty > MAX_PER_CART) return { ok: false, error: `Máximo ${MAX_PER_CART} entradas por compra` };
  const candidates: Array<{ row: number; start: number; score: number }> = [];
  for (let r = 1; r <= zone.rows; r++) {
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= qty) {
        for (let st = 0; st + qty <= run.length; st++) {
          const left = st;
          const right = run.length - (st + qty);
          candidates.push({ row: r, start: run[st]!, score: (left === 1 || right === 1 ? 1000 : 0) + (left + right) * 10 + st });
        }
      }
      run = [];
    };
    for (let s = 1; s <= zone.perRow; s++) {
      if (heldBy(zone, r, s) === null) run.push(s);
      else flush();
    }
    flush();
  }
  if (candidates.length === 0) return { ok: false, error: `No hay ${qty} asientos seguidos en ${zone.name}` };
  candidates.sort((a, b) => a.score - b.score || a.row - b.row || a.start - b.start);
  const best = candidates[0]!;
  for (let s = best.start; s < best.start + qty; s++) {
    cart.items.push({ id: randomBytes(4).toString('hex'), zoneId: zone.id, zoneName: zone.name, row: best.row, seat: s, qty: 1, priceCents: zone.priceCents, rate });
  }
  return { ok: true, cart: cartView(sid) };
}

function setZoneQty(sid: string, zoneId: string, qty: number): AddResult {
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone) return { ok: false, error: 'Zona desconocida' };
  const cart = cartOf(sid);
  const others = cart.items.filter((i) => i.zoneId !== zone.id);
  const otherQty = others.reduce((s, i) => s + i.qty, 0);
  if (qty < 0 || otherQty + qty > MAX_PER_CART) return { ok: false, error: `Máximo ${MAX_PER_CART} entradas por compra` };
  if (zone.kind === 'nnz') {
    cart.items = qty === 0 ? others : [...others, { id: `z-${zone.id}`, zoneId: zone.id, zoneName: zone.name, row: null, seat: null, qty, priceCents: zone.priceCents, rate: 'General' }];
    return { ok: true, cart: cartView(sid) };
  }
  // Lista sin plano: la web asigna los asientos (seguidos si puede).
  cart.items = others;
  if (qty === 0) return { ok: true, cart: cartView(sid) };
  const r = addAuto(sid, zone.id, qty, 'General');
  if (!r.ok) {
    cart.items = others;
    return { ok: false, error: zoneAvailability(zone) < qty ? 'Sin disponibilidad' : r.error ?? 'No disponible' };
  }
  return r;
}

export function resetMock(): void {
  carts.clear();
  flags.paid = false;
  flags.checkoutVisited = false;
  flags.pays = 0;
}

export function mockState(): { carts: Array<{ sid: string; items: MockCartItem[] }>; paid: boolean; checkoutVisited: boolean; pays: number } {
  expireCarts();
  return { carts: [...carts.values()].filter((c) => c.items.length).map((c) => ({ sid: c.sid, items: c.items })), ...flags };
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

const BASE_CSS = `
  body{font-family:"Nunito Sans",system-ui,sans-serif;margin:0;background:#f4f5f8;color:#1c1c1c}
  .sim{background:#ffe08a;color:#553;padding:6px 24px;font-size:13px}
  app-nav-bar{display:flex;justify-content:space-between;align-items:center;background:#fff;border-bottom:1px solid #dde;padding:12px 24px}
  .main-container{max-width:1200px;margin:16px auto;display:flex;gap:16px;padding:0 16px}
  .main-content{flex:1;min-width:0}
  #sidebar,.sidebar-content{width:380px;flex:none;display:flex;flex-direction:column;gap:12px}
  .card,ob-view-list,ob-select-graphic-cart-summary,ob-select-cart-summary,ob-price-zones-selection{display:block;background:#fff;border:1px solid #dde;border-radius:12px;padding:12px}
  .view-item{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #eee;cursor:pointer}
  .view-item.opened{background:#eef0ff}.view-item.ob-sold-out{opacity:.55;cursor:default}
  .view-main-info-texts-title{font-weight:700}
  ob-button{display:inline-block}ob-button button{font:inherit;border:1px solid #3b28e0;background:#fff;color:#3b28e0;border-radius:8px;padding:8px 14px;cursor:pointer}
  ob-button[color=primary] button{background:#3b28e0;color:#fff}ob-button[type=ghost] button{border-color:transparent}
  ob-button button:disabled{opacity:.45;cursor:not-allowed}
  .ob-svg-container{background:#fff;border:1px solid #dde;border-radius:12px;padding:8px;min-height:420px}
  svg.ob-venue{width:100%;height:420px}
  .link.available{fill:#cfd8ff;stroke:#3b28e0;cursor:pointer}.link.available:hover{fill:#b5c2ff}
  .seat.available{fill:#2ecc71;cursor:pointer}.seat.available:hover{fill:#27ae60}.seat.sold-out{fill:#bbb}.seat.selected{fill:#3b28e0}
  mat-dialog-container{position:fixed;inset:0;margin:auto;width:460px;height:max-content;background:#fff;border-radius:12px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3);z-index:50;display:block}
  .cdk-overlay-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:40}
  mat-select{display:block;border:1px solid #999;border-radius:8px;padding:8px;cursor:pointer;margin:8px 0}
  .ob-select-rate-options{position:fixed;left:50%;top:50%;transform:translate(-50%,-30%);background:#fff;border:1px solid #999;border-radius:8px;z-index:60;min-width:260px}
  mat-option{display:block;padding:10px;cursor:pointer}mat-option:hover{background:#eef}
  mat-dialog-actions,.automatic-seat-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
  .ob-location-card{border:1px solid #eee;border-radius:8px;padding:8px;margin:6px 0}
  .ob-item-card-header{display:flex;justify-content:space-between;align-items:center}
  .ob-counter-container{display:inline-flex;align-items:center;gap:6px}.ob-quantity{min-width:1.5em;text-align:center;font-weight:700}
  .ob-selection-card{border-bottom:1px solid #eee;padding:10px 0;display:flex;justify-content:space-between;align-items:center}
  .ob-unavailable-tag{background:#fee;color:#b00;border-radius:6px;padding:2px 6px;font-size:12px}
  ob-pricezone-box{display:block;border:1px solid #ccc;border-radius:8px;padding:8px;margin:6px 0;cursor:pointer}ob-pricezone-box.selected{border-color:#3b28e0;background:#eef0ff}
  .ob-flat-countdown{font-weight:700;color:#b54708}
  .reto{max-width:420px;margin:60px auto;background:#fff;padding:24px;border-radius:12px}
  ob-turnstile-challenge{display:block;width:300px;height:65px;border:1px solid #ccc;border-radius:6px;padding:12px;box-sizing:border-box}
  .ob-catalog-card,[data-testid=catalog-item-card]{display:block;background:#fff;border:1px solid #dde;border-radius:12px;padding:16px;margin:12px 0;text-decoration:none;color:inherit}
`;

function shell(title: string, body: string, opts: { email?: string | null; script?: string } = {}): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Real Madrid Femenino (SIMULADO)</title>
<style>${BASE_CSS}</style></head><body class="mat-typography">
<div class="sim">Entorno SIMULADO local — réplica del DOM de Onebox, no es la web real del Real Madrid</div>
<app-root><app-nav-bar><strong>Real Madrid Femenino · Entradas</strong><span>${opts.email ? `<ob-login-partner-button>Sesión: ${esc(opts.email)}</ob-login-partner-button>` : '<ob-login-partner-button><ob-button type="ghost" data-testid="external-login-button"><button>Login</button></ob-button></ob-login-partner-button>'}</span></app-nav-bar>
${body}
</app-root>${opts.script ? `<script>${opts.script}</script>` : ''}</body></html>`;
}

function catalogPage(url: URL, email: string | null): string {
  const q = carry(url);
  const d = MOCK_EVENT.startsAt.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' });
  return shell(
    'Eventos',
    `<ob-page-events><h1 class="ob-heading-sr-only">Eventos</h1><ob-catalog-list><div class="catalog-container" role="list" style="max-width:720px;margin:0 auto">
      <a class="ob-catalog-card" role="listitem" href="/mock/realmadrid_femenino/events/699${q}"><div class="title" data-testid="catalog-card-title">Real Madrid Femenino - Levante UD</div><div class="dates">Jornada anterior</div><span class="ob-unavailable-tag">Agotado</span></a>
      <a class="ob-catalog-card" role="listitem" href="/mock/realmadrid_femenino/events/${MOCK_EVENT.id}${q}"><div class="title" data-testid="catalog-card-title">${esc(MOCK_EVENT.name)}</div><div class="dates">${esc(d)}</div><div class="min-price-label" data-testid="ob-catalog-card-min-price">Desde 10,00 €</div><ob-button color="primary"><button>Comprar entradas</button></ob-button></a>
    </div></ob-catalog-list></ob-page-events>`,
    { email },
  );
}

function eventPage(url: URL, email: string | null): string {
  const q = carry(url);
  const d = MOCK_EVENT.startsAt.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' });
  return shell(
    MOCK_EVENT.name,
    `<ob-page-event><ob-page-header-item><h1 class="title">${esc(MOCK_EVENT.name)}</h1><div>${esc(MOCK_EVENT.venue)}</div></ob-page-header-item>
     <ob-page-event-two-step><div class="main-container"><div class="main-content"><h2>Sesiones</h2>
      <ob-sessions-picker><ob-sessions-list data-testid="ob-sessions-list">
        <div data-testid="catalog-item-card" class="ob-catalog-item-card"><div class="title">${esc(MOCK_EVENT.name)} · partido de ida</div><div class="date-time">Pasado</div><span class="ob-unavailable-tag">Agotado</span></div>
        <div data-testid="catalog-item-card" class="ob-catalog-item-card"><div class="title">${esc(MOCK_EVENT.name)}</div><div class="date-time">${esc(d)} · ${esc(MOCK_EVENT.venue)}</div>
          <ob-button color="primary" data-testid="catalog-item-card-action-button"><a href="${MOCK_EVENT_PATH}${q}" style="display:inline-block;background:#3b28e0;color:#fff;border-radius:8px;padding:8px 14px;text-decoration:none">Comprar entradas</a></ob-button></div>
      </ob-sessions-list></ob-sessions-picker></div></div></ob-page-event-two-step></ob-page-event>`,
    { email },
  );
}

function loginDialog(next: string): string {
  return `<div class="cdk-overlay-backdrop"></div><mat-dialog-container role="dialog"><ob-onebox-login-dialog>
    <h2 id="login-dialog-title">Iniciar sesión</h2>
    <p>Accede con tu cuenta Real Madrid (simulado: vale cualquier email).</p>
    <form data-testid="ob-login-form" method="post" action="/mock/login?next=${encodeURIComponent(next)}">
      <label>Email<br><input type="email" name="email" autocomplete="username" style="width:100%;padding:8px;margin:4px 0 12px"></label>
      <label>Contraseña<br><input type="password" name="password" autocomplete="current-password" style="width:100%;padding:8px;margin:4px 0 12px"></label>
      <mat-dialog-actions><ob-button color="primary"><button type="submit">Iniciar sesión</button></ob-button></mat-dialog-actions>
    </form></ob-onebox-login-dialog></mat-dialog-container>`;
}

function challengePage(): string {
  return shell(
    'Verificación',
    `<div class="reto"><h1>Verifica que eres humano</h1><p>Completa la verificación de seguridad para continuar (simulado: se resuelve sola en unos segundos, como si la pulsaras tú).</p>
     <ob-turnstile-challenge><span id="chk">Verificando…</span></ob-turnstile-challenge></div>`,
    { script: `setTimeout(async () => { await fetch('/mock/reto/ok', { method: 'POST' }); location.reload(); }, 3500);` },
  );
}

function queuePage(next: string): string {
  return shell(
    'Cola virtual',
    `<div class="reto"><h1>Estás en la cola virtual</h1><p>Sala de espera: te damos paso en cuanto haya sitio. Posición aproximada: <span id="pos">3</span>. No cierres esta página.</p></div>`,
    { script: `let n=3;const t=setInterval(()=>{n--;document.getElementById('pos').textContent=n;if(n<=0){clearInterval(t);location.href='/mock/cola/ok?next='+encodeURIComponent(${JSON.stringify(next)})}},1000);` },
  );
}

function checkoutPage(sid: string, email: string | null): string {
  const cart = cartView(sid);
  const rows = cart.items.map((i) => `<li>${i.qty} × ${esc(i.zoneName)}${i.row ? ` · Fila ${i.row} Asiento ${i.seat}` : ''} — ${euros(i.priceCents)}</li>`).join('');
  return shell(
    'Checkout',
    `<ob-page-pre-checkout><div class="main-container"><div class="main-content"><h1>Datos del comprador</h1><p>${esc(MOCK_EVENT.name)}</p><ul>${rows}</ul>
     <p><b>Total: <span data-testid="cart-summary-total">${euros(cart.totalCents)}</span></b></p>
     <ob-button color="primary" data-testid="checkout-payment-button"><button id="pay">Pagar ${euros(cart.totalCents)}</button></ob-button></div></div></ob-page-pre-checkout>`,
    { email, script: `document.getElementById('pay').addEventListener('click', async () => { await fetch('/mock/api/pay', { method: 'POST' }); alert('Pago SIMULADO: en la web real aquí pagarías tú.'); });` },
  );
}

function selectPage(url: URL, sid: string, email: string): string {
  const list = url.searchParams.get('lista') === '1';
  const auto = url.searchParams.get('auto') === '1';
  const zones = ZONES.map((z) => ({ id: z.id, name: z.name, priceCents: z.priceCents, kind: z.kind, available: zoneAvailability(z) }));
  const cfg = JSON.stringify({ list, auto, zones, maxPerCart: MAX_PER_CART, checkoutUrl: `/mock/realmadrid_femenino/checkout${carry(url)}`, cart: cartView(sid) });
  const header = `<ob-page-header-item class="page-header-item"><h1 class="title">${esc(MOCK_EVENT.name)}</h1><div>${esc(MOCK_EVENT.venue)} · ${esc(MOCK_EVENT.startsAt.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' }))}</div></ob-page-header-item>`;
  const body = list
    ? `<ob-page-select-locations>${header}<ob-not-graphic-selection><div class="main-container"><div class="main-content"><h2 id="selectYourTickets" class="ob-selection-title">Selecciona tus entradas</h2>
         <ob-price-zones-selection data-testid="ob-price-zones-selection" id="pzs"></ob-price-zones-selection></div>
         <div class="sidebar-content"><ob-select-cart-summary id="cart"></ob-select-cart-summary></div></div></ob-not-graphic-selection></ob-page-select-locations>`
    : `<ob-page-select-locations>${header}<ob-graphic-selection><div class="main-container"><div class="main-content"><div class="viewer-container">
         <ob-venue-viewer id="ob-channels-venue-viewer"><ob-venue-template-svg><div class="ob-svg-container" id="svgc"></div></ob-venue-template-svg></ob-venue-viewer></div></div>
         <div id="sidebar" class="sidebar-content"><ob-graphic-selection-tabs><div class="tabs-group ob-segmented-button-group"><button value="view-list" class="flex-1">Zonas</button><button value="summary" class="flex-1">Resumen</button></div></ob-graphic-selection-tabs>
         <ob-view-list><div class="view-list" id="viewList"></div></ob-view-list>
         <ob-select-graphic-cart-summary id="cart"></ob-select-graphic-cart-summary></div></div></ob-graphic-selection></ob-page-select-locations>`;
  return shell(MOCK_EVENT.name, body, { email, script: `window.__cfg=${cfg};\n${SELECT_JS}` });
}

/** JS de la página de selección: imita el comportamiento del front de Onebox. */
const SELECT_JS = String.raw`
(() => {
  const cfg = window.__cfg; let cart = cfg.cart; let opened = null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const eur = (c) => (c/100).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' €';
  const api = async (path, body) => { const r = await fetch('/mock/api/' + path, body ? { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) } : {}); return r.json(); };
  const counter = (zoneId, qty, max, extra = '') => '<ob-counter-input class="tiny" data-zone="' + zoneId + '" ' + extra + '><div class="ob-counter-container" role="group">'
    + '<ob-button type="icon-stroked" data-testid="counter-remove"><button aria-label="Quitar"' + (qty <= 0 ? ' disabled' : '') + '>−</button></ob-button>'
    + '<span data-testid="counter-quantity" class="ob-quantity">' + qty + '</span>'
    + '<ob-button data-testid="counter-add"><button aria-label="Añadir"' + (qty >= max ? ' disabled' : '') + '>+</button></ob-button></div></ob-counter-input>';

  // ---- carrito ------------------------------------------------------------
  let countdownTimer = null;
  function renderCart() {
    const el = document.getElementById('cart'); if (!el) return;
    const items = cart.items.map((i) => '<ob-cart-summary-card-item><div class="ob-location-card" data-item="' + i.id + '"><div class="ob-item-card-header"><div class="ob-item-card-title"><span class="ob-item-card-name">' + esc(i.zoneName) + '</span></div>'
      + '<div class="ob-item-card-icons"><ob-button type="icon" data-testid="cart-summary-delete" data-item="' + i.id + '"><button aria-label="Eliminar">🗑</button></ob-button></div></div>'
      + (i.row ? '<div class="ob-location"><span class="ob-location-key">Fila ' + i.row + '</span> <span class="ob-location-key">Asiento ' + i.seat + '</span></div>' : '<div class="ob-not-numbered">' + counter(i.zoneId, i.qty, cfg.maxPerCart, 'data-cart="1"') + ' entradas</div>')
      + '<div class="ob-price-container"><span class="ob-price" data-testid="ob-summary-item-price">' + eur(i.priceCents) + '</span></div></div></ob-cart-summary-card-item>').join('');
    el.innerHTML = '<div class="summary-container"><div class="summary-info"><span class="quantity">' + cart.qty + ' entradas</span> · <span class="total" data-testid="cart-summary-total">' + eur(cart.totalCents) + '</span></div>'
      + (cart.expiresAt ? '<div class="ob-flat-countdown">⏳ <span class="ob-countdown-value" id="cd"></span></div>' : '')
      + '<div data-testid="ob-card-items-container" class="ob-card-items-container">' + (items || '<div class="muted">Carrito vacío</div>') + '</div>'
      + '<ob-cart-summary-actions-bar><div class="ob-summary-buttons"><ob-button color="primary" data-testid="' + (cfg.list ? 'sidebar-pzs-selection-payment-btn' : 'cart-summary-payment-btn') + '" class="ob-action-btn"><button id="pay"' + (cart.qty ? '' : ' disabled') + '>Comprar entradas</button></ob-button></div></ob-cart-summary-actions-bar></div>';
    document.getElementById('pay').addEventListener('click', () => { location.href = cfg.checkoutUrl; });
    el.querySelectorAll('[data-testid="cart-summary-delete"]').forEach((b) => b.addEventListener('click', async () => { const r = await api('cart/remove', { itemId: b.dataset.item }); if (r.ok) { cart = r.cart; renderCart(); refreshSeats(); renderList(); } }));
    clearInterval(countdownTimer);
    if (cart.expiresAt) { const end = Date.parse(cart.expiresAt); const tick = () => { const s = Math.max(0, Math.round((end - Date.now())/1000)); const n = document.getElementById('cd'); if (n) n.textContent = String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0'); }; tick(); countdownTimer = setInterval(tick, 1000); }
  }

  // ---- diálogos -----------------------------------------------------------
  function closeDialogs() { document.querySelectorAll('mat-dialog-container, .cdk-overlay-backdrop, .ob-select-rate-options').forEach((d) => d.remove()); }
  function openDialog(html) { closeDialogs(); const bd = document.createElement('div'); bd.className = 'cdk-overlay-backdrop'; document.body.appendChild(bd); const d = document.createElement('mat-dialog-container'); d.setAttribute('role', 'dialog'); d.innerHTML = html; document.body.appendChild(d); return d; }
  function alertDialog(title, message, cancelLabel, actionLabel, onAction) {
    const d = openDialog('<h2 mat-dialog-title>' + esc(title) + '</h2><div mat-dialog-content><p>' + esc(message) + '</p></div><mat-dialog-actions><ob-button type="ghost" id="dlgCancel"><button>' + esc(cancelLabel) + '</button></ob-button><ob-button color="primary" id="dlgAction"><button>' + esc(actionLabel) + '</button></ob-button></mat-dialog-actions>');
    d.querySelector('#dlgCancel').addEventListener('click', closeDialogs);
    d.querySelector('#dlgAction').addEventListener('click', () => { closeDialogs(); onAction(); });
  }
  function rateSelect(preselected) {
    return '<mat-select class="ob-field ob-select-rate" role="combobox" tabindex="0" data-rate="' + (preselected ? 'General' : '') + '">' + (preselected ? 'General · ' + eur(preselected) : 'Selecciona tarifa') + '</mat-select>';
  }
  function wireRateSelects(root, price, onChange) {
    root.querySelectorAll('mat-select').forEach((sel) => sel.addEventListener('click', () => {
      document.querySelectorAll('.ob-select-rate-options').forEach((p) => p.remove());
      const panel = document.createElement('div'); panel.className = 'cdk-overlay-pane ob-select-rate-options'; panel.setAttribute('role', 'listbox');
      panel.innerHTML = '<mat-option role="option" data-rate="General"><span class="ob-rate-title">General</span> <span class="ob-rate-final-price">' + eur(price) + '</span></mat-option><mat-option role="option" data-rate="Infantil"><span class="ob-rate-title">Infantil (hasta 12 años)</span> <span class="ob-rate-final-price">' + eur(Math.round(price/2)) + '</span></mat-option>';
      document.body.appendChild(panel);
      panel.querySelectorAll('mat-option').forEach((o) => o.addEventListener('click', () => { sel.dataset.rate = o.dataset.rate; sel.textContent = o.textContent.trim(); panel.remove(); onChange(); }));
    }));
  }

  // ---- plano --------------------------------------------------------------
  function seatDialog(seat, zone) {
    const d = openDialog('<ob-select-seat-dialog><h2 mat-dialog-title id="dialog-title">' + esc(zone.name) + '</h2><ob-button type="icon" data-testid="select-rate-dialog-close"><button aria-label="Cerrar">×</button></ob-button>'
      + '<div class="ob-allocation"><div class="ob-row"><span class="ob-label">Fila</span> <span class="ob-value">' + seat.row + '</span></div><div class="ob-seat"><span class="ob-label">Asiento</span> <span class="ob-value">' + seat.seat + '</span></div></div>'
      + '<div class="ob-rate-info-container">' + rateSelect(null) + '</div>'
      + '<mat-dialog-actions><ob-button color="primary" data-testid="select-rate-dialog-confirm"><button disabled>Seleccionar</button></ob-button></mat-dialog-actions></ob-select-seat-dialog>');
    const confirm = d.querySelector('[data-testid="select-rate-dialog-confirm"] button');
    wireRateSelects(d, zone.priceCents, () => { confirm.disabled = !d.querySelector('mat-select').dataset.rate; });
    d.querySelector('[data-testid="select-rate-dialog-close"]').addEventListener('click', closeDialogs);
    confirm.addEventListener('click', async () => {
      const rate = d.querySelector('mat-select').dataset.rate; closeDialogs();
      const go = async (force) => { const r = await api('cart/add', { seatId: seat.id, rate, force }); if (r.ok) { cart = r.cart; renderCart(); refreshSeats(); return; }
        if (r.alert === 'NON_CONSECUTIVE') alertDialog('Asientos no consecutivos', 'Los asientos seleccionados no son consecutivos. ¿Quieres continuar igualmente?', 'Volver atrás', 'Continuar', () => go(true));
        else if (r.alert === 'ORPHAN') alertDialog('Asiento suelto', 'Con esta selección dejarías un asiento suelto (huérfano) que será difícil de vender. ¿Confirmas?', 'Volver', 'Confirmar', () => go(true));
        else alertDialog('No disponible', r.error || 'No se ha podido añadir', 'Cerrar', 'Entendido', () => {}); };
      await go(false);
    });
  }
  async function refreshSeats() { if (opened) await loadView(opened, true); }
  async function loadView(zoneId, silent) {
    const zone = cfg.zones.find((z) => z.id === zoneId); if (!zone) return;
    opened = zoneId; document.querySelectorAll('.view-item').forEach((v) => v.classList.toggle('opened', v.id === 'view-item-' + zoneId));
    if (zone.kind !== 'seats') return;
    const data = await api('view/' + zoneId);
    const w = 60 + zone.perRow * 22, h = 60 + zone.rows * 26;
    const circles = data.seats.map((s) => '<circle id="' + s.id + '" obType="seat" class="interactive seat ' + s.state + '" role="checkbox" aria-checked="' + (s.state === 'selected') + '" aria-label="Fila ' + s.row + ' Asiento ' + s.seat + '" cx="' + (30 + s.seat * 22) + '" cy="' + (30 + s.row * 26) + '" r="8"></circle>').join('');
    document.getElementById('svgc').innerHTML = '<svg class="ob-venue" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '"><text x="20" y="20" font-size="12">' + esc(zone.name) + ' — escenario arriba</text>' + circles + '</svg>';
    document.querySelectorAll('circle.seat.available').forEach((c) => c.addEventListener('click', () => seatDialog({ id: c.id, row: Number(c.getAttribute('aria-label').match(/Fila (\d+)/)[1]), seat: Number(c.getAttribute('aria-label').match(/Asiento (\d+)/)[1]) }, zone)));
    if (!silent) window.scrollTo(0, 0);
  }
  function renderOverview() {
    const seatZones = cfg.zones.filter((z) => z.kind === 'seats');
    document.getElementById('svgc').innerHTML = '<svg class="ob-venue" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300">' + seatZones.map((z, i) => '<path id="' + z.id + '" obType="link" class="interactive link ' + (z.available ? 'available' : 'sold-out') + '" d="M' + (20 + i * 115) + ',40 h100 v180 h-100 z"></path><text x="' + (30 + i * 115) + '" y="140" font-size="11">' + esc(z.name) + '</text>').join('') + '</svg>';
    document.querySelectorAll('path.link.available').forEach((p) => p.addEventListener('click', () => loadView(p.id)));
  }
  function autoDialog(zone) {
    let step = 1, qty = 1, pzSelected = false;
    const d = openDialog('<ob-select-automatic-seat-dialog><h2 mat-dialog-title>Buscar asientos · ' + esc(zone.name) + '</h2><ob-button type="icon" class="ob-close-btn"><button aria-label="Cerrar">×</button></ob-button><div id="autoBody"></div><div class="automatic-seat-actions"><ob-button type="ghost" id="autoBack"><button>Cancelar</button></ob-button><ob-button color="primary" id="autoNext"><button>Siguiente</button></ob-button></div></ob-select-automatic-seat-dialog>');
    d.querySelector('.ob-close-btn').addEventListener('click', closeDialogs);
    const render = () => {
      const body = d.querySelector('#autoBody'); const next = d.querySelector('#autoNext button');
      if (step === 1) { body.innerHTML = '<p>¿Cuántas entradas?</p>' + counter(zone.id, qty, cfg.maxPerCart, 'data-auto="1"'); next.textContent = 'Siguiente'; next.disabled = false;
        body.querySelector('[data-testid="counter-add"]').addEventListener('click', () => { if (qty < cfg.maxPerCart) { qty++; render(); } });
        body.querySelector('[data-testid="counter-remove"]').addEventListener('click', () => { if (qty > 1) { qty--; render(); } }); }
      else if (step === 2) { body.innerHTML = '<p>Elige la zona de precio</p><ob-pricezone-box data-testid="ob-price-zone-box" class="' + (pzSelected ? 'selected' : '') + '"><div class="ob-pz-box"><span class="ob-pz-name">' + esc(zone.name) + '</span> <span class="ob-base-price" data-testid="ob-price-zone-base-price">' + eur(zone.priceCents) + '</span></div></ob-pricezone-box>'; next.textContent = 'Siguiente'; next.disabled = !pzSelected;
        body.querySelector('ob-pricezone-box').addEventListener('click', () => { pzSelected = true; render(); }); }
      else { body.innerHTML = '<ob-select-automatic-seat-rates><p>Tarifa de cada entrada</p>' + Array.from({ length: qty }, (_, i) => '<div class="ob-automatic-seat-rates-card">Entrada ' + (i + 1) + rateSelect(zone.priceCents) + '</div>').join('') + '</ob-select-automatic-seat-rates>'; next.textContent = 'Añadir al carrito'; next.disabled = false; wireRateSelects(body, zone.priceCents, () => {}); }
    };
    d.querySelector('#autoBack').addEventListener('click', () => { if (step === 1) closeDialogs(); else { step--; render(); } });
    d.querySelector('#autoNext').addEventListener('click', async () => {
      if (step < 3) { step++; render(); return; }
      const r = await api('cart/auto', { zoneId: zone.id, qty, rate: 'General' }); closeDialogs();
      if (r.ok) { cart = r.cart; renderCart(); await loadView(zone.id, true); } else alertDialog('No disponible', r.error || 'No hay asientos', 'Cerrar', 'Entendido', () => {});
    });
    render();
  }
  function renderViewList() {
    const el = document.getElementById('viewList'); if (!el) return;
    el.innerHTML = cfg.zones.map((z) => {
      const soldOut = z.available <= 0;
      const nnz = z.kind === 'nnz';
      const myQty = cart.items.filter((i) => i.zoneId === z.id).reduce((n, i) => n + i.qty, 0);
      return '<div class="view-item' + (soldOut ? ' ob-sold-out' : ' clickable') + (nnz ? ' ob-view-list-intermediate-nnz' : '') + '" id="view-item-' + z.id + '" role="button" tabindex="0"><div class="view-main-info"><div class="view-main-info-texts"><div class="view-main-info-texts-title">' + esc(z.name) + '</div>'
        + '<ob-price-item><span class="ob-from-label">Desde</span> <span class="ob-base-price">' + eur(z.priceCents) + '</span></ob-price-item> <ob-availability-item><span class="ob-availability' + (soldOut ? ' ob-sold-out-text' : '') + '">' + (soldOut ? 'Agotado' : z.available + ' disponibles') + '</span></ob-availability-item></div></div>'
        + (nnz && !soldOut ? '<ob-not-numbered-zone-selection><div class="ob-selection-item"><span class="ob-rate-title">General</span> <span class="ob-rate-final-price">' + eur(z.priceCents) + '</span> ' + counter(z.id, myQty, cfg.maxPerCart, 'data-nnz="1"') + '</div></ob-not-numbered-zone-selection><ob-confirm-button><ob-button color="primary" data-zone="' + z.id + '"><button>Añadir al carrito</button></ob-button></ob-confirm-button>' : '')
        + (cfg.auto && !nnz && !soldOut ? '<ob-button class="ob-automatic-selection-btn" aria-label="Buscar asientos - ' + esc(z.name) + '" data-zone="' + z.id + '"><button>Buscar asientos</button></ob-button>' : '')
        + '</div>';
    }).join('');
    el.querySelectorAll('.view-item.clickable .view-main-info').forEach((v) => v.addEventListener('click', () => loadView(v.parentElement.id.replace('view-item-', ''))));
    el.querySelectorAll('.ob-automatic-selection-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); autoDialog(cfg.zones.find((z) => z.id === b.dataset.zone)); }));
    el.querySelectorAll('ob-counter-input[data-nnz]').forEach((c) => { const q = c.querySelector('[data-testid="counter-quantity"]');
      c.querySelector('[data-testid="counter-add"]').addEventListener('click', (e) => { e.stopPropagation(); const n = Number(q.textContent); if (n < cfg.maxPerCart) { q.textContent = n + 1; c.querySelector('[data-testid="counter-remove"] button').disabled = false; c.querySelector('[data-testid="counter-add"] button').disabled = n + 1 >= cfg.maxPerCart; } });
      c.querySelector('[data-testid="counter-remove"]').addEventListener('click', (e) => { e.stopPropagation(); const n = Number(q.textContent); if (n > 0) { q.textContent = n - 1; c.querySelector('[data-testid="counter-remove"] button').disabled = n - 1 <= 0; c.querySelector('[data-testid="counter-add"] button').disabled = false; } }); });
    el.querySelectorAll('ob-confirm-button ob-button').forEach((b) => b.addEventListener('click', async (e) => { e.stopPropagation(); const item = b.closest('.view-item'); const qty = Number(item.querySelector('[data-testid="counter-quantity"]').textContent); const r = await api('cart/zone', { zoneId: b.dataset.zone, qty }); if (r.ok) { cart = r.cart; renderCart(); } else alertDialog('No disponible', r.error || 'No se ha podido añadir', 'Cerrar', 'Entendido', () => {}); }));
  }

  // ---- lista sin plano ----------------------------------------------------
  function renderList() {
    const el = document.getElementById('pzs'); if (!el) return;
    el.innerHTML = cfg.zones.map((z) => { const soldOut = z.available <= 0; const myQty = cart.items.filter((i) => i.zoneId === z.id).reduce((n, i) => n + i.qty, 0);
      return '<div class="ob-selection-card" id="pz-' + z.id + '"><div><div class="ob-zone-label" data-testid="single-rate-title">' + esc(z.name) + '</div><div class="ob-pz-prices"><span class="ob-rate-final-price" data-testid="ob-pzs-rate-final-price">' + eur(z.priceCents) + '</span></div>' + (soldOut ? '<span class="ob-unavailable-tag">Agotado</span>' : '<span class="ob-availability">' + z.available + ' disponibles</span>') + '</div>' + (soldOut ? '' : counter(z.id, myQty, cfg.maxPerCart, 'data-list="1"')) + '</div>'; }).join('');
    el.querySelectorAll('ob-counter-input[data-list]').forEach((c) => { const zoneId = c.dataset.zone; const q = c.querySelector('[data-testid="counter-quantity"]');
      const set = async (n) => { const r = await api('cart/zone', { zoneId, qty: n }); if (r.ok) { cart = r.cart; renderCart(); renderList(); } else alertDialog('No disponible', r.error || 'No se ha podido añadir', 'Cerrar', 'Entendido', () => { renderList(); }); };
      c.querySelector('[data-testid="counter-add"]').addEventListener('click', () => set(Number(q.textContent) + 1));
      c.querySelector('[data-testid="counter-remove"]').addEventListener('click', () => set(Math.max(0, Number(q.textContent) - 1))); });
  }

  renderCart();
  if (cfg.list) renderList(); else { renderViewList(); renderOverview(); }
})();
`;

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

/** Atiende las rutas /mock/*. Devuelve false si la ruta no es suya. */
export async function handleMock(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/mock')) return false;
  const jar = cookies(req);
  let sid = jar['rm_mock_sid'] ?? null;
  const session = sid ? sessions.get(sid) ?? null : null;
  const email = session?.email ?? null;
  expireCarts();

  // --- API JSON ----------------------------------------------------------
  if (url.pathname.startsWith('/mock/api/')) {
    const body = req.method === 'POST' ? ((await readBody(req)) || '{}') : '{}';
    const data = JSON.parse(body) as Record<string, unknown>;
    const needSid = (): string => sid ?? 'anon';
    if (url.pathname === '/mock/api/state') return json(res, 200, mockState()), true;
    if (url.pathname === '/mock/api/reset') return resetMock(), json(res, 200, { ok: true }), true;
    if (url.pathname === '/mock/api/pay') return (flags.paid = true), flags.pays++, json(res, 200, { ok: true }), true;
    if (url.pathname === '/mock/api/cart') return json(res, 200, { ok: true, cart: cartView(needSid()) }), true;
    if (url.pathname.startsWith('/mock/api/view/')) {
      const zone = ZONES.find((z) => z.id === url.pathname.split('/').pop());
      if (!zone) return json(res, 404, { ok: false, error: 'Zona desconocida' }), true;
      return json(res, 200, { ok: true, zone: { id: zone.id, name: zone.name, priceCents: zone.priceCents }, seats: zoneSeats(zone, needSid()) }), true;
    }
    if (url.pathname === '/mock/api/cart/add') return json(res, 200, addSeat(needSid(), String(data['seatId'] ?? ''), String(data['rate'] ?? 'General'), data['force'] === true)), true;
    if (url.pathname === '/mock/api/cart/auto') return json(res, 200, addAuto(needSid(), String(data['zoneId'] ?? ''), Number(data['qty'] ?? 1), String(data['rate'] ?? 'General'))), true;
    if (url.pathname === '/mock/api/cart/zone') return json(res, 200, setZoneQty(needSid(), String(data['zoneId'] ?? ''), Number(data['qty'] ?? 0))), true;
    if (url.pathname === '/mock/api/cart/remove') {
      const c = cartOf(needSid());
      c.items = c.items.filter((i) => i.id !== String(data['itemId'] ?? ''));
      return json(res, 200, { ok: true, cart: cartView(needSid()) }), true;
    }
    return json(res, 404, { ok: false, error: 'No encontrado' }), true;
  }

  // --- Login (formulario del diálogo) -------------------------------------
  if (url.pathname === '/mock/login' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    const next = safeNext(url.searchParams.get('next'));
    const em = form.get('email')?.trim() ?? '';
    const password = form.get('password') ?? '';
    if (!em.includes('@') || !password) return send(res, 400, shell('Acceder', `<div class="reto"><h1>Datos incorrectos</h1><p>Introduce un email y una contraseña.</p><a href="${esc(next)}">Volver</a></div>`)), true;
    const newSid = randomBytes(16).toString('hex');
    sessions.set(newSid, { email: em });
    return redirect(res, next, { 'set-cookie': `rm_mock_sid=${newSid}; Path=/mock; HttpOnly; SameSite=Lax` }), true;
  }

  // --- Cola virtual y verificación -----------------------------------------
  if (url.pathname === '/mock/cola') return send(res, 200, queuePage(safeNext(url.searchParams.get('next')))), true;
  if (url.pathname === '/mock/cola/ok') return redirect(res, safeNext(url.searchParams.get('next')), { 'set-cookie': 'rm_mock_queue_ok=1; Path=/mock; SameSite=Lax' }), true;
  if (url.pathname === '/mock/reto/ok' && req.method === 'POST') {
    res.writeHead(204, { 'set-cookie': 'rm_mock_reto_ok=1; Path=/mock; SameSite=Lax' });
    res.end();
    return true;
  }

  // --- Catálogo y ficha ----------------------------------------------------
  if (url.pathname === '/mock/realmadrid_femenino' || url.pathname === MOCK_CHANNEL_PATH) return redirect(res, `/mock/realmadrid_femenino/events${carry(url)}`), true;
  if (url.pathname === '/mock/realmadrid_femenino/events') return send(res, 200, catalogPage(url, email)), true;
  if (url.pathname === `/mock/realmadrid_femenino/events/${MOCK_EVENT.id}`) return send(res, 200, eventPage(url, email)), true;
  if (url.pathname.startsWith('/mock/realmadrid_femenino/events/')) return send(res, 200, shell('Agotado', `<ob-page-event><div class="reto"><h1>Entradas agotadas</h1><a href="/mock/realmadrid_femenino/events${carry(url)}">Volver al catálogo</a></div></ob-page-event>`, { email })), true;

  // --- Selección -------------------------------------------------------------
  if (url.pathname === MOCK_EVENT_PATH) {
    const here = url.pathname + url.search;
    if (url.searchParams.get('cola') === '1' && jar['rm_mock_queue_ok'] !== '1') return redirect(res, `/mock/cola?next=${encodeURIComponent(here)}`), true;
    if (url.searchParams.get('reto') === '1' && jar['rm_mock_reto_ok'] !== '1') return send(res, 200, challengePage()), true;
    if (!session && url.searchParams.get('login') !== '0') {
      return send(res, 200, shell(MOCK_EVENT.name, `<ob-page-select-locations><ob-page-header-item><h1 class="title">${esc(MOCK_EVENT.name)}</h1></ob-page-header-item><div class="ob-viewport-spinner" role="status"></div>${loginDialog(here)}</ob-page-select-locations>`)), true;
    }
    if (!session) {
      // login=0: sesión anónima con cookie propia.
      sid = randomBytes(16).toString('hex');
      sessions.set(sid, { email: 'invitado@ejemplo.com' });
      res.setHeader('set-cookie', `rm_mock_sid=${sid}; Path=/mock; HttpOnly; SameSite=Lax`);
      return send(res, 200, selectPage(url, sid, 'invitado@ejemplo.com')), true;
    }
    return send(res, 200, selectPage(url, sid!, session.email)), true;
  }

  // --- Checkout (el bot nunca llega aquí solo) ------------------------------
  if (url.pathname === '/mock/realmadrid_femenino/checkout') {
    flags.checkoutVisited = true;
    return send(res, 200, checkoutPage(sid ?? 'anon', email)), true;
  }

  send(res, 404, shell('No encontrado', '<div class="reto"><h1>Página no encontrada</h1></div>'));
  return true;
}
