/**
 * Proveedor SIMULADO. Genera inventario a partir del recinto compilado del
 * vault y simula colas, retos de sesión, latencias, competencia, respuestas
 * ambiguas, rate limits y cambios de esquema. Todo con PRNG determinista y el
 * reloj inyectado, así que una misma semilla reproduce la misma operación.
 *
 * Los retos (CAPTCHA) NO se resuelven aquí: quedan pendientes hasta que una
 * persona confirma en el dashboard que lo ha resuelto (humanCompletedChallenge).
 */

import type { ChallengeType, Id, QueueInfo, SessionInfo, SessionState, VenueArtifact, VenueSection } from '@to/shared';
import { CAPABILITIES } from '@to/shared';
import type { RawOffer } from '../domain/candidates';
import type { Clock } from '../util/clock';
import { slugify } from '../util/normalize';
import { Rng, seedFrom } from '../util/rng';
import { iso } from '../util/time';
import { DEFAULT_SCENARIO, SCENARIOS, type ScenarioParams } from './scenarios';
import type {
  AddToCartRequest,
  AddToCartResult,
  EventPreparation,
  InventoryRead,
  ProviderAdapter,
  ProviderCart,
  ProviderCartItem,
} from './types';

export const SIM_ADAPTER_VERSION = 'sim-1.0.0';
export const SIM_SCHEMA_VERSION = 'sim-inventory-v1';

interface SimOffer {
  ref: string;
  sectionId: Id;
  label: string;
  row: string | null;
  seats: string[];
  remaining: number;
  qtyMax: number;
  unitPrice: number;
  obstructed: boolean;
  accessible: boolean;
  standing: boolean;
  contiguous: boolean | null;
  view: number;
  listedTwice: boolean;
}

interface SimQueue {
  state: 'WAITING' | 'PASSED' | 'EXPIRED';
  joinedAt: number;
  passAt: number;
  expiresAt: number | null;
  position: number;
}

interface SimAccountEvent {
  queue: SimQueue | null;
  cartRef: string;
  items: ProviderCartItem[];
  expiresAtMs: number | null;
  purchasedQty: number;
  results: Map<string, AddToCartResult>;
}

interface SimEvent {
  eventRef: string;
  params: ScenarioParams;
  rng: Rng;
  t0Ms: number;
  currency: string;
  perAccountLimit: number;
  artifact: VenueArtifact;
  offers: Map<string, SimOffer> | null;
  lastCompetitionMs: number;
  accounts: Map<Id, SimAccountEvent>;
}

interface SimSession {
  state: SessionState;
  challenge: { type: ChallengeType; since: string } | null;
  detail: string | null;
  checkedAt: number | null;
}

export class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly code: 'TIMEOUT' | 'NOT_IN_QUEUE' | 'SESSION_INVALID' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'ProviderCallError';
  }
}

export class SimulatedProvider implements ProviderAdapter {
  readonly id = 'sim';
  readonly name = 'Simulador';
  readonly mode = 'SIMULATED' as const;
  readonly adapterVersion = SIM_ADAPTER_VERSION;
  readonly confirmationPolicy = 'READBACK' as const;
  readonly declared: readonly string[] = [...CAPABILITIES];

  private readonly sessions = new Map<Id, SimSession>();
  private readonly events = new Map<string, SimEvent>();
  private readonly sessionRng: Rng;
  private challengeRate = SCENARIOS[DEFAULT_SCENARIO]?.challengeRate ?? 0.2;
  private skewMs = SCENARIOS[DEFAULT_SCENARIO]?.serverSkewMs ?? 0;
  private readLatency = SCENARIOS[DEFAULT_SCENARIO]?.latency.read ?? { median: 60, p95: 160 };

  constructor(
    private readonly clock: Clock,
    private readonly publicBaseUrl: string,
    seed = 1,
  ) {
    this.sessionRng = new Rng(seedFrom(seed, 'sessions'));
  }

  // -------------------------------------------------------------------------
  // Preparación
  // -------------------------------------------------------------------------

  prepareEvent(prep: EventPreparation): void {
    const params = SCENARIOS[prep.scenarioId ?? DEFAULT_SCENARIO] ?? (SCENARIOS[DEFAULT_SCENARIO] as ScenarioParams);
    this.challengeRate = params.challengeRate;
    this.skewMs = params.serverSkewMs;
    this.readLatency = params.latency.read;
    const existing = this.events.get(prep.eventRef);
    if (existing && existing.t0Ms === prep.t0Ms && existing.params.id === params.id) {
      existing.artifact = prep.artifact;
      existing.perAccountLimit = prep.perAccountLimit;
      return;
    }
    this.events.set(prep.eventRef, {
      eventRef: prep.eventRef,
      params,
      rng: new Rng(seedFrom(prep.seed, prep.eventRef, params.id)),
      t0Ms: prep.t0Ms,
      currency: prep.currency,
      perAccountLimit: prep.perAccountLimit,
      artifact: prep.artifact,
      offers: null,
      lastCompetitionMs: prep.t0Ms,
      accounts: new Map(),
    });
  }

  private event(eventRef: string): SimEvent {
    const ev = this.events.get(eventRef);
    if (!ev) throw new ProviderCallError(`Evento desconocido en el simulador: ${eventRef}`, 'NOT_FOUND');
    return ev;
  }

  private account(ev: SimEvent, accountId: Id): SimAccountEvent {
    let a = ev.accounts.get(accountId);
    if (!a) {
      a = {
        queue: null,
        cartRef: `SIMCART-${slugify(ev.eventRef)}-${accountId.slice(-6)}`,
        items: [],
        expiresAtMs: null,
        purchasedQty: 0,
        results: new Map(),
      };
      ev.accounts.set(accountId, a);
    }
    return a;
  }

  private session(accountId: Id): SimSession {
    let s = this.sessions.get(accountId);
    if (!s) {
      s = { state: 'LOGGED_OUT', challenge: null, detail: null, checkedAt: null };
      this.sessions.set(accountId, s);
    }
    return s;
  }

  private async latency(kind: 'read' | 'add', ev?: SimEvent): Promise<void> {
    const l = kind === 'add' ? (ev?.params.latency.add ?? { median: 180, p95: 450 }) : (ev?.params.latency.read ?? this.readLatency);
    const rng = ev?.rng ?? this.sessionRng;
    await this.clock.sleep(Math.min(5000, rng.lognormal(l.median, l.p95)));
  }

  private sessionInfo(accountId: Id, queue: QueueInfo | null = null): SessionInfo {
    const s = this.session(accountId);
    return {
      state: s.state,
      challenge: s.challenge,
      queue: queue ?? { state: 'NOT_OPEN', position: null, etaMs: null, updatedAt: iso(this.clock.now()) },
      lastCheckedAt: iso(this.clock.now()),
      detail: s.detail,
    };
  }

  // -------------------------------------------------------------------------
  // Sesión y cola
  // -------------------------------------------------------------------------

  async openSession(accountId: Id): Promise<SessionInfo> {
    const s = this.session(accountId);
    if (s.state === 'READY' || s.state === 'CHALLENGE_REQUIRED') return this.sessionInfo(accountId);
    s.state = 'OPENING';
    await this.latency('read');
    if (this.sessionRng.chance(this.challengeRate)) {
      s.state = 'CHALLENGE_REQUIRED';
      s.challenge = { type: 'CAPTCHA', since: iso(this.clock.now()) };
      s.detail = 'El proveedor pide un CAPTCHA: resuélvelo tú y confirma en el dashboard.';
    } else {
      s.state = 'READY';
      s.challenge = null;
      s.detail = null;
    }
    s.checkedAt = this.clock.now();
    return this.sessionInfo(accountId);
  }

  async sessionStatus(accountId: Id): Promise<SessionInfo> {
    await this.latency('read');
    this.session(accountId).checkedAt = this.clock.now();
    return this.sessionInfo(accountId);
  }

  /** Acción HUMANA simulada: la persona resolvió el reto en la web del proveedor. */
  humanCompletedChallenge(accountId: Id): void {
    const s = this.session(accountId);
    s.state = 'READY';
    s.challenge = null;
    s.detail = null;
  }

  /** Simula que el proveedor caduca una sesión (tests y escenarios). */
  expireSession(accountId: Id): void {
    const s = this.session(accountId);
    s.state = 'EXPIRED';
    s.detail = 'Sesión caducada por el proveedor.';
  }

  async queueStatus(accountId: Id, eventRef: string): Promise<QueueInfo> {
    const ev = this.event(eventRef);
    await this.clock.sleep(Math.min(1000, ev.rng.lognormal(ev.params.latency.read.median / 2, ev.params.latency.read.p95 / 2)));
    const now = this.clock.now();
    const updatedAt = iso(now);
    if (now < ev.t0Ms) return { state: 'NOT_OPEN', position: null, etaMs: ev.t0Ms - now, updatedAt };
    if (this.session(accountId).state !== 'READY') return { state: 'UNKNOWN', position: null, etaMs: null, updatedAt };
    const a = this.account(ev, accountId);
    if (!a.queue) {
      const q = ev.params.queue;
      const passIn = ev.rng.int(q.minPassMs, q.maxPassMs);
      a.queue = {
        state: 'WAITING',
        joinedAt: now,
        passAt: now + passIn,
        expiresAt: ev.rng.chance(q.expireRate) ? now + Math.floor(passIn / 2) : null,
        position: ev.rng.int(1, q.maxPosition),
      };
    }
    const q = a.queue;
    if (q.state === 'WAITING' && q.expiresAt !== null && now >= q.expiresAt) q.state = 'EXPIRED';
    if (q.state === 'WAITING' && now >= q.passAt) q.state = 'PASSED';
    if (q.state === 'EXPIRED') return { state: 'EXPIRED', position: null, etaMs: null, updatedAt };
    if (q.state === 'PASSED') return { state: 'PASSED', position: 0, etaMs: 0, updatedAt };
    const frac = Math.max(0, (q.passAt - now) / Math.max(1, q.passAt - q.joinedAt));
    return { state: 'WAITING', position: Math.max(1, Math.ceil(q.position * frac)), etaMs: q.passAt - now, updatedAt };
  }

  // -------------------------------------------------------------------------
  // Inventario
  // -------------------------------------------------------------------------

  private requireInside(ev: SimEvent, accountId: Id): void {
    if (this.session(accountId).state !== 'READY') throw new ProviderCallError('Sesión no válida', 'SESSION_INVALID');
    const q = ev.accounts.get(accountId)?.queue;
    if (!q || q.state !== 'PASSED') throw new ProviderCallError('La cuenta no ha pasado la cola', 'NOT_IN_QUEUE');
  }

  async readInventory(accountId: Id, eventRef: string): Promise<InventoryRead> {
    const ev = this.event(eventRef);
    await this.latency('read', ev);
    const now = this.clock.now();
    if (now < ev.t0Ms) return { observedAtMs: now, offers: [], schemaVersion: SIM_SCHEMA_VERSION };
    this.requireInside(ev, accountId);
    if (ev.rng.chance(ev.params.failures.readFailRate)) throw new ProviderCallError('Timeout leyendo inventario', 'TIMEOUT');
    const drift = ev.params.failures.driftAfterMs;
    if (drift !== null && now >= ev.t0Ms + drift) {
      return { observedAtMs: now, offers: [], schemaVersion: 'sim-inventory-v2' };
    }
    const offers = this.ensureOffers(ev);
    this.applyCompetition(ev, now);
    const out: RawOffer[] = [];
    for (const o of offers.values()) {
      if (o.remaining < 1) continue;
      const raw: RawOffer = {
        offerRef: o.ref,
        sectionLabel: o.label,
        row: o.row,
        seats: o.standing ? [] : o.seats.slice(0, o.remaining),
        qtyMin: 1,
        qtyMax: Math.min(o.qtyMax, o.remaining),
        unitPrice: o.unitPrice,
        currency: ev.currency,
        obstructed: o.obstructed,
        accessible: o.accessible,
        standing: o.standing,
      };
      if (o.contiguous === null) raw.seats = [];
      else if (o.contiguous === false) raw.contiguous = false;
      out.push(raw);
      if (o.listedTwice) out.push({ ...raw });
    }
    return { observedAtMs: this.clock.now(), offers: out, schemaVersion: SIM_SCHEMA_VERSION };
  }

  private ensureOffers(ev: SimEvent): Map<string, SimOffer> {
    if (ev.offers) return ev.offers;
    const offers = new Map<string, SimOffer>();
    const inv = ev.params.inventory;
    const zoneName = new Map(ev.artifact.zones.map((z) => [z.id, z.name] as const));
    for (const s of ev.artifact.sections) {
      if (s.closed) continue;
      const n = ev.rng.int(inv.offersPerSection[0], inv.offersPerSection[1]);
      for (let i = 0; i < n; i++) {
        const offer = this.makeOffer(ev, s, zoneName.get(s.zoneId) ?? '', i);
        offers.set(offer.ref, offer);
      }
    }
    ev.offers = offers;
    return offers;
  }

  private makeOffer(ev: SimEvent, s: VenueSection, zone: string, i: number): SimOffer {
    const inv = ev.params.inventory;
    const rng = ev.rng;
    const view = s.attributes.view ?? 3;
    const distance = s.attributes.distance ?? 40;
    const base = s.kind === 'STANDING' ? 55 + view * 8 : 35 + view * 12 + Math.max(0, 60 - distance) * 0.6;
    const price = Math.round((base * 1.1 * (0.92 + rng.next() * 0.16)) * 2) / 2;
    const ref = `${ev.eventRef}:${slugify(s.name)}:${i + 1}`;
    const label = this.labelFor(ev, s, zone);
    if (s.kind === 'STANDING') {
      const remaining = rng.int(inv.standingRemaining[0], inv.standingRemaining[1]);
      return {
        ref,
        sectionId: s.id,
        label,
        row: null,
        seats: [],
        remaining,
        qtyMax: 6,
        unitPrice: Math.round(price * 100),
        obstructed: false,
        accessible: false,
        standing: true,
        contiguous: true,
        view,
        listedTwice: rng.chance(inv.duplicateRate),
      };
    }
    const rows = Math.max(1, s.rows ?? 10);
    const perRow = Math.max(2, s.seatsPerRow ?? 20);
    const block = Math.min(perRow, rng.int(inv.seatedBlock[0], inv.seatedBlock[1]));
    const start = rng.int(1, Math.max(1, perRow - block + 1));
    let seats = Array.from({ length: block }, (_, k) => String(start + k));
    let contiguous: boolean | null = true;
    const roll = rng.next();
    if (roll < inv.bestAvailableRate) contiguous = null;
    else if (roll < inv.bestAvailableRate + inv.splitRate && block >= 2) {
      const half = Math.floor(block / 2);
      seats = [...seats.slice(0, half), ...seats.slice(half).map((x) => String(Number(x) + 3))];
      contiguous = false;
    }
    return {
      ref,
      sectionId: s.id,
      label,
      row: String(rng.int(1, rows)),
      seats,
      remaining: block,
      qtyMax: block,
      unitPrice: Math.round(price * 100),
      obstructed: Boolean(s.attributes.obstructed) || rng.chance(inv.obstructedRate),
      accessible: Boolean(s.attributes.accessible) || rng.chance(inv.accessibleRate),
      standing: false,
      contiguous,
      view,
      listedTwice: rng.chance(inv.duplicateRate),
    };
  }

  private labelFor(ev: SimEvent, s: VenueSection, zone: string): string {
    const rng = ev.rng;
    const inv = ev.params.inventory;
    const r = rng.next();
    if (r < inv.unknownLabelRate) return `BLOQUE ${String.fromCharCode(65 + rng.int(0, 7))}-${rng.int(10, 99)}`;
    if (r < inv.unknownLabelRate + inv.zoneOnlyRate) return zone.toUpperCase();
    const variants = [s.name, ...s.aliases, `${zone.toUpperCase()} - ${s.name}`, `SEC ${s.name}`.toUpperCase()];
    return rng.pick(variants);
  }

  private applyCompetition(ev: SimEvent, now: number): void {
    const dt = (now - ev.lastCompetitionMs) / 1000;
    if (dt <= 0 || !ev.offers) return;
    ev.lastCompetitionMs = now;
    const rate = ev.params.competitionPerSec;
    if (rate <= 0) return;
    for (const o of ev.offers.values()) {
      if (o.remaining < 1) continue;
      const p = 1 - Math.exp(-rate * (1 + o.view / 5) * dt);
      if (ev.rng.chance(p)) {
        const take = ev.rng.int(1, o.remaining);
        o.remaining -= take;
        if (!o.standing) o.seats.splice(0, take);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Carrito
  // -------------------------------------------------------------------------

  private cartOf(ev: SimEvent, accountId: Id, a: SimAccountEvent): ProviderCart {
    return {
      cartRef: a.cartRef,
      items: a.items.map((i) => ({ ...i, seats: [...i.seats] })),
      expiresAt: a.expiresAtMs === null ? null : iso(a.expiresAtMs),
      openUrl: `${this.publicBaseUrl}/sim/cart/${encodeURIComponent(ev.eventRef)}/${encodeURIComponent(accountId)}`,
    };
  }

  private expireCart(a: SimAccountEvent, now: number): void {
    if (a.expiresAtMs !== null && now >= a.expiresAtMs) {
      a.items = [];
      a.expiresAtMs = null;
    }
  }

  async addToCart(req: AddToCartRequest): Promise<AddToCartResult> {
    const ev = this.event(req.eventRef);
    const a = this.account(ev, req.accountId);
    const previous = a.results.get(req.idempotencyKey);
    if (previous) {
      await this.latency('read', ev);
      return previous.status === 'ADDED' ? { ...previous, cart: this.cartOf(ev, req.accountId, a), duplicate: true } : previous;
    }
    if (this.session(req.accountId).state !== 'READY') {
      return { status: 'REJECTED', reason: 'SESSION_INVALID', detail: 'Sesión no válida' };
    }
    if (a.queue?.state !== 'PASSED') return { status: 'REJECTED', reason: 'NOT_IN_QUEUE', detail: 'La cuenta no ha pasado la cola' };

    await this.latency('add', ev);
    const now = this.clock.now();
    const f = ev.params.failures;
    if (ev.rng.chance(f.rateLimitRate)) return { status: 'RATE_LIMITED', retryAfterMs: ev.rng.int(500, 1500) };
    if (f.driftAfterMs !== null && now >= ev.t0Ms + f.driftAfterMs) {
      return { status: 'SCHEMA_DRIFT', detail: 'Respuesta con un formato desconocido (sim-cart-v2)' };
    }
    const ambiguous = ev.rng.chance(f.ambiguousRate);
    this.applyCompetition(ev, now);
    const truth = this.tryAdd(ev, a, req, now);
    a.results.set(req.idempotencyKey, truth);
    if (ambiguous) return { status: 'AMBIGUOUS', detail: 'Timeout esperando la respuesta del proveedor' };
    return truth;
  }

  private tryAdd(ev: SimEvent, a: SimAccountEvent, req: AddToCartRequest, now: number): AddToCartResult {
    const offer = this.ensureOffers(ev).get(req.offerRef);
    if (!offer || offer.remaining < req.qty) return { status: 'REJECTED', reason: 'SOLD_OUT', detail: 'Ya no quedan esas entradas' };
    if (req.unitPrice !== offer.unitPrice) return { status: 'REJECTED', reason: 'PRICE_CHANGED', detail: 'El precio ha cambiado' };
    if (ev.rng.chance(ev.params.failures.priceChangeRate)) {
      offer.unitPrice = Math.round(offer.unitPrice * 1.1);
      return { status: 'REJECTED', reason: 'PRICE_CHANGED', detail: 'El precio ha cambiado' };
    }
    this.expireCart(a, now);
    if (a.purchasedQty + req.qty > ev.perAccountLimit) {
      return { status: 'REJECTED', reason: 'LIMIT_REACHED', detail: `Límite de ${ev.perAccountLimit} por cuenta` };
    }
    const seats = offer.standing ? [] : offer.seats.splice(0, req.qty);
    offer.remaining -= req.qty;
    const item: ProviderCartItem = {
      offerRef: offer.ref,
      sectionLabel: offer.label,
      row: offer.row,
      seats,
      qty: req.qty,
      unitPrice: offer.unitPrice,
      idempotencyKey: req.idempotencyKey,
    };
    a.items.push(item);
    a.purchasedQty += req.qty;
    if (a.expiresAtMs === null) a.expiresAtMs = now + ev.params.cartHoldMs;
    return { status: 'ADDED', cart: this.cartOf(ev, req.accountId, a), item, duplicate: false };
  }

  async readCart(accountId: Id, eventRef: string): Promise<ProviderCart> {
    const ev = this.event(eventRef);
    await this.latency('read', ev);
    if (ev.rng.chance(ev.params.failures.readFailRate)) throw new ProviderCallError('Timeout leyendo el carrito', 'TIMEOUT');
    const a = this.account(ev, accountId);
    this.expireCart(a, this.clock.now());
    return this.cartOf(ev, accountId, a);
  }

  async serverTime(): Promise<number> {
    await this.clock.sleep(10);
    return this.clock.now() + this.skewMs;
  }

  // -------------------------------------------------------------------------
  // Página de carrito simulada (OPEN CART)
  // -------------------------------------------------------------------------

  renderCartPage(eventRef: string, accountId: Id): string {
    const ev = this.events.get(eventRef);
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    if (!ev) return `<!doctype html><meta charset="utf-8"><title>Carrito</title><p>Evento desconocido.</p>`;
    const a = this.account(ev, accountId);
    this.expireCart(a, this.clock.now());
    const rows = a.items
      .map((i) => `<tr><td>${esc(i.sectionLabel)}</td><td>${esc(i.row ?? '—')}</td><td>${esc(i.seats.join(', ') || 'de pie')}</td><td>${i.qty}</td><td>${(i.unitPrice / 100).toFixed(2)} ${esc(ev.currency)}</td></tr>`)
      .join('');
    const left = a.expiresAtMs === null ? '' : `<p>Caduca en ${Math.max(0, Math.round((a.expiresAtMs - this.clock.now()) / 1000))} s.</p>`;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Carrito simulado</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#1d232b;background:#f6f7f9}table{border-collapse:collapse;width:100%;background:#fff}td,th{border-bottom:1px solid #e3e6ea;padding:8px;text-align:left}.note{background:#fff4e0;border:1px solid #f0c36d;padding:12px;border-radius:8px}</style></head>
<body><h1>Carrito simulado</h1><p><b>${esc(ev.eventRef)}</b> · cuenta ${esc(accountId)} · ${esc(a.cartRef)}</p>${left}
<table><thead><tr><th>Sección</th><th>Fila</th><th>Asientos</th><th>Cant.</th><th>Precio</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Carrito vacío</td></tr>'}</tbody></table>
<p class="note">Esto es el <b>simulador</b>. En un proveedor real, aquí es donde una persona revisa y paga. El sistema nunca paga: cuando hayas pagado, márcalo en el dashboard.</p></body></html>`;
  }
}
