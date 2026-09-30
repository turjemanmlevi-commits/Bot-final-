import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  BrowserAuth, BrowserCartEvidence, BrowserCommand, BrowserCommandOutcome, BrowserConnectInput,
  BrowserConnection, BrowserConnectionStatus, BrowserPairInput, BrowserReportInput, BrowserSnapshot,
} from '../../../shared/src/browser';
import type { AddToCartRequest } from '../providers/types';

export class BrowserBridgeError extends Error {
  constructor(message: string, readonly code = 'BROWSER_UNAVAILABLE') { super(message); this.name = 'BrowserBridgeError'; }
}

interface Pairing { input: BrowserPairInput; expires: number }
export interface BrowserCommandResult { outcome: BrowserCommandOutcome; snapshot: BrowserSnapshot | null }
interface Pending {
  command: BrowserCommand;
  delivered: boolean;
  resolve: (result: BrowserCommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
  expectedSection: string | null;
}
interface Linked {
  connection: BrowserConnection;
  connectedAt: number;
  seenAt: number | null;
  snapshot: BrowserSnapshot | null;
  pending: Map<string, Pending>;
  results: Map<string, Promise<BrowserCommandResult>>;
  uncertain: boolean;
  confirmedCart: BrowserCartEvidence | null;
  completed: Set<string>;
}

export interface BrowserBridgeOptions {
  now?: () => number;
  pairTtlMs?: number;
  commandTimeoutMs?: number;
  snapshotMaxAgeMs?: number;
  onSnapshot?: (accountId: string, snapshot: BrowserSnapshot) => void | Promise<void>;
}

const copy = <T>(v: T): T => structuredClone(v);
const id = () => randomBytes(18).toString('base64url');
const integer = (v: unknown, min: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const short = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 500;

/** In-memory credentials: pairing never exposes browser cookies or credentials. */
export class BrowserBridge {
  private readonly pairs = new Map<string, Pairing>();
  private readonly links = new Map<string, Linked>();
  private readonly now: () => number;
  private readonly options: BrowserBridgeOptions;
  private readonly rejectedPairAttempts: number[] = [];

  constructor(options: BrowserBridgeOptions = {}) { this.options = options; this.now = options.now ?? Date.now; }

  pair(input: BrowserPairInput): { pairingCode: string; expiresAt: string } {
    if (![input.accountId, input.eventId, input.eventRef].every(short)) throw new BrowserBridgeError('Cuenta y evento obligatorios', 'INVALID_REQUEST');
    if (!['fixture-v1', 'entradas-fastbooking-v1', 'observe-only-v1'].includes(input.recipe?.id)) throw new BrowserBridgeError('Receta no revisada', 'INVALID_REQUEST');
    const eventUrl = this.url(input.eventUrl);
    if (!input.recipe.allowedOrigins.length || !input.recipe.allowedOrigins.every((origin) => this.url(origin).origin === origin)) throw new BrowserBridgeError('Orígenes inválidos', 'INVALID_REQUEST');
    if (!input.recipe.allowedOrigins.includes(eventUrl.origin)) throw new BrowserBridgeError('La receta no incluye el evento', 'INVALID_REQUEST');
    // A pairing only becomes active when its code is redeemed. Do not revoke a working tab here.
    for (const [key, pair] of this.pairs) if (pair.expires < this.now() || pair.input.accountId === input.accountId) this.pairs.delete(key);
    const pairingCode = randomBytes(6).toString('hex').toUpperCase();
    const expires = this.now() + (this.options.pairTtlMs ?? 120_000);
    this.pairs.set(pairingCode, { input: copy(input), expires });
    return { pairingCode, expiresAt: new Date(expires).toISOString() };
  }

  connect(input: BrowserConnectInput): BrowserConnection {
    const now = this.now();
    while (this.rejectedPairAttempts.length && (this.rejectedPairAttempts[0] ?? 0) < now - 60_000) this.rejectedPairAttempts.shift();
    if (this.rejectedPairAttempts.length >= 12) throw new BrowserBridgeError('Demasiados códigos inválidos; espera un minuto', 'RATE_LIMITED');
    const code = typeof input.pairingCode === 'string' ? input.pairingCode.replace(/[\s-]/g, '').toUpperCase() : '';
    const pair = this.pairs.get(code);
    if (!pair || pair.expires < now) {
      this.rejectedPairAttempts.push(now);
      throw new BrowserBridgeError('Código inválido o caducado', 'UNAUTHORIZED');
    }
    if (!short(input.sessionId) || !integer(input.tabId, 0)) throw new BrowserBridgeError('Sesión o pestaña inválida', 'INVALID_REQUEST');
    if (this.canonical(input.url) !== this.canonical(pair.input.eventUrl)) throw new BrowserBridgeError('Abre exactamente la página del evento antes de vincular', 'WRONG_PAGE');
    const old = this.forAccount(pair.input.accountId);
    if (old && (old.pending.size || old.uncertain)) throw new BrowserBridgeError('Hay un intento pendiente; comprueba el carrito antes de revincular', 'PENDING_RESULT');
    this.revoke(pair.input.accountId);
    this.pairs.delete(code);
    const connection: BrowserConnection = { ...copy(pair.input), connectionId: id(), token: randomBytes(32).toString('base64url'), sessionId: input.sessionId, tabId: input.tabId };
    this.links.set(connection.connectionId, { connection, connectedAt: now, seenAt: null, snapshot: null, pending: new Map(), results: new Map(), uncertain: false, confirmedCart: null, completed: new Set() });
    return copy(connection);
  }

  poll(auth: BrowserAuth): { commands: BrowserCommand[] } {
    const linked = this.auth(auth);
    const commands: BrowserCommand[] = [];
    for (const [key, pending] of linked.pending) if (!pending.delivered) {
      pending.delivered = true;
      commands.push(copy(pending.command));
      if (pending.command.type === 'FOCUS') {
        clearTimeout(pending.timer);
        linked.pending.delete(key);
        linked.completed.add(key);
        pending.resolve({ outcome: { status: 'REJECTED', detail: 'Foco entregado' }, snapshot: null });
      }
    }
    return { commands };
  }

  report(input: BrowserReportInput): { ok: true; commandAccepted: boolean } {
    const linked = this.auth(input);
    const snapshot = this.validateSnapshot(linked, input.snapshot);
    linked.snapshot = copy(snapshot);
    linked.seenAt = this.now();
    // Observing the challenge is harmless; the person can take as long as needed.
    // The same pending command remains in the extension, never issued a second time.
    if (snapshot.session === 'CHALLENGE_REQUIRED') {
      for (const pending of linked.pending.values()) pending.timer.refresh();
    }
    let commandAccepted = false;
    if (input.commandId && input.outcome) {
      const pending = linked.pending.get(input.commandId);
      if (pending) {
        if (!pending.delivered) throw new BrowserBridgeError('Orden no entregada', 'INVALID_REQUEST');
        let outcome = copy(input.outcome);
        if (!['ADDED', 'REJECTED', 'AMBIGUOUS', 'CHALLENGE'].includes(outcome.status)) throw new BrowserBridgeError('Resultado inválido', 'INVALID_REQUEST');
        if (pending.command.type === 'ADD_TO_CART' && outcome.status === 'ADDED') {
          const command = pending.command;
          const before = outcome.beforeCart;
          const cart = snapshot.cart;
          const beforeValid = before && this.validCart(linked, before) && before.items.length === 0;
          const item = cart?.items[0];
          if (!beforeValid || !cart || cart.items.length !== 1 || !item || item.offerRef !== command.offerRef || item.sectionLabel !== pending.expectedSection || item.qty !== command.qty || item.unitPrice !== command.unitPrice || snapshot.session !== 'READY') {
            outcome = { status: 'AMBIGUOUS', detail: 'No hay prueba de carrito vacío anterior y cantidad/oferta/precio exactos posteriores' };
          } else {
            // The key correlates verified DOM evidence; it is not a claim of server-side idempotency.
            item.idempotencyKey = command.idempotencyKey;
            linked.snapshot = copy(snapshot);
            linked.confirmedCart = copy(cart);
          }
        }
        if (pending.command.type === 'ADD_TO_CART' && (outcome.status === 'AMBIGUOUS' || outcome.status === 'CHALLENGE')) linked.uncertain = true;
        clearTimeout(pending.timer);
        linked.pending.delete(input.commandId);
        linked.completed.add(input.commandId);
        pending.resolve({ outcome, snapshot: copy(linked.snapshot) });
        commandAccepted = true;
      } else if (linked.completed.has(input.commandId)) commandAccepted = true;
    }
    const callback = this.options.onSnapshot?.(linked.connection.accountId, copy(snapshot));
    if (callback) void callback.catch(() => undefined);
    return { ok: true, commandAccepted };
  }

  snapshot(accountId: string, eventRef?: string): BrowserSnapshot {
    const linked = this.forAccount(accountId);
    if (!linked || (eventRef !== undefined && linked.connection.eventRef !== eventRef)) throw new BrowserBridgeError('Vincula la cuenta y el evento con la extensión', 'SESSION_INVALID');
    if (!linked.snapshot || linked.seenAt === null || this.now() - linked.seenAt > (this.options.snapshotMaxAgeMs ?? 10_000)) throw new BrowserBridgeError('La pestaña no ha enviado una lectura reciente', 'SESSION_INVALID');
    return copy(linked.snapshot);
  }

  recipe(accountId: string) { return copy(this.forAccount(accountId)?.connection.recipe ?? null); }

  /** Readback must not turn unproven/previous rows into a confirmation of an ambiguous click. */
  readCart(accountId: string, eventRef: string): BrowserCartEvidence {
    const snapshot = this.snapshot(accountId, eventRef);
    const linked = this.forAccount(accountId);
    const verified = linked?.confirmedCart;
    const current = snapshot.cart;
    if (!linked || linked.uncertain || !verified || !current || snapshot.session !== 'READY' || current.cartRef !== verified.cartRef || current.items.length !== verified.items.length) throw new BrowserBridgeError('Carrito sin evidencia completa de este intento', 'CART_UNVERIFIED');
    for (const item of current.items) {
      const known = verified.items.find((v) => v.offerRef === item.offerRef && v.qty === item.qty && v.unitPrice === item.unitPrice && v.row === item.row && JSON.stringify(v.seats) === JSON.stringify(item.seats));
      if (!known) throw new BrowserBridgeError('El carrito cambió después de confirmarlo', 'CART_UNVERIFIED');
      item.idempotencyKey = known.idempotencyKey;
    }
    return current;
  }

  getBinding(accountId: string): (BrowserPairInput & { connectionId: string; sessionId: string; tabId: number }) | null {
    const connection = this.forAccount(accountId)?.connection;
    if (!connection) return null;
    const { token: _token, ...binding } = connection;
    return copy(binding);
  }

  add(request: AddToCartRequest): Promise<BrowserCommandResult> {
    const linked = this.forAccount(request.accountId);
    if (!linked || linked.connection.eventRef !== request.eventRef) throw new BrowserBridgeError('La cuenta no está vinculada a este evento', 'SESSION_INVALID');
    const existing = linked.results.get(request.idempotencyKey);
    if (existing) return existing;
    if (linked.uncertain || [...linked.pending.values()].some((p) => p.command.type === 'ADD_TO_CART')) return Promise.resolve({ outcome: { status: 'AMBIGUOUS', detail: 'Ya hay un intento pendiente de comprobar; no se vuelve a pulsar' }, snapshot: null });
    const snapshot = this.snapshot(request.accountId, request.eventRef);
    if (this.canonical(snapshot.url) !== this.canonical(linked.connection.eventUrl)) throw new BrowserBridgeError('La pestaña ya no está en el evento vinculado', 'WRONG_PAGE');
    if (!snapshot.supported || linked.connection.recipe.id === 'observe-only-v1' || (linked.connection.recipe.id !== 'fixture-v1' && !linked.connection.recipe.cart)) throw new BrowserBridgeError('Falta una receta comprobada del carrito para esta página', 'UNSUPPORTED_PAGE');
    if (snapshot.session !== 'READY' || snapshot.queue !== 'PASSED') throw new BrowserBridgeError('Sesión o cola pendiente', 'SESSION_INVALID');
    if (!integer(request.qty, 1) || !integer(request.unitPrice, 0) || !short(request.idempotencyKey)) throw new BrowserBridgeError('Petición inválida', 'INVALID_REQUEST');
    const offer = snapshot.offers.find((o) => o.offerRef === request.offerRef);
    if (!offer || request.qty < offer.qtyMin || request.qty > offer.qtyMax || request.unitPrice !== offer.unitPrice) throw new BrowserBridgeError('Oferta o cantidad cambiada en esta cuenta', 'INVALID_REQUEST');
    if (snapshot.cart && snapshot.cart.items.length > 0) throw new BrowserBridgeError('El carrito ya contiene entradas: revísalo antes de empezar', 'INVALID_REQUEST');
    const command: BrowserCommand = { id: id(), type: 'ADD_TO_CART', ...request };
    const result = this.enqueue(linked, command, offer.sectionLabel);
    linked.results.set(request.idempotencyKey, result);
    return result;
  }

  focus(accountId: string, eventRef?: string): boolean {
    const linked = this.forAccount(accountId);
    if (!linked || (eventRef !== undefined && linked.connection.eventRef !== eventRef) || [...linked.pending.values()].some((p) => p.command.type === 'FOCUS')) return false;
    void this.enqueue(linked, { id: id(), type: 'FOCUS', accountId, eventRef: linked.connection.eventRef });
    return true;
  }

  revoke(accountId: string): boolean {
    for (const [code, pair] of this.pairs) if (pair.input.accountId === accountId) this.pairs.delete(code);
    const linked = this.forAccount(accountId);
    if (!linked) return false;
    for (const pending of linked.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ outcome: { status: 'AMBIGUOUS', detail: 'Vínculo desconectado' }, snapshot: null });
    }
    this.links.delete(linked.connection.connectionId);
    return true;
  }

  status(): BrowserConnectionStatus[] {
    return [...this.links.values()].map((l) => ({ connectionId: l.connection.connectionId, accountId: l.connection.accountId, eventId: l.connection.eventId, eventRef: l.connection.eventRef, eventUrl: l.connection.eventUrl, tabId: l.connection.tabId, connectedAt: new Date(l.connectedAt).toISOString(), lastSeenAt: l.seenAt === null ? null : new Date(l.seenAt).toISOString(), supported: l.snapshot?.supported ?? false, session: l.snapshot?.session ?? 'UNKNOWN', detail: l.snapshot?.detail ?? null, pendingCommands: l.pending.size, uncertain: l.uncertain }));
  }

  close(): void { for (const l of [...this.links.values()]) this.revoke(l.connection.accountId); this.pairs.clear(); }

  private enqueue(linked: Linked, command: BrowserCommand, expectedSection: string | null = null): Promise<BrowserCommandResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        linked.pending.delete(command.id);
        linked.completed.add(command.id);
        if (command.type === 'ADD_TO_CART') linked.uncertain = true;
        resolve({ outcome: { status: 'AMBIGUOUS', detail: 'La pestaña no confirmó el resultado a tiempo; se requiere comprobar el carrito' }, snapshot: null });
      }, this.options.commandTimeoutMs ?? 20_000);
      timer.unref?.();
      linked.pending.set(command.id, { command, delivered: false, resolve, timer, expectedSection });
    });
  }

  private forAccount(accountId: string): Linked | undefined { return [...this.links.values()].find((l) => l.connection.accountId === accountId); }

  private auth(auth: BrowserAuth): Linked {
    const linked = this.links.get(auth.connectionId);
    const actual = typeof auth.token === 'string' ? Buffer.from(auth.token) : Buffer.alloc(0);
    const expected = Buffer.from(linked?.connection.token ?? 'invalid');
    if (!linked || actual.length !== expected.length || !timingSafeEqual(actual, expected) || auth.sessionId !== linked.connection.sessionId || auth.tabId !== linked.connection.tabId) throw new BrowserBridgeError('Vínculo no autorizado', 'UNAUTHORIZED');
    return linked;
  }

  private url(value: string): URL {
    try {
      const u = new URL(value);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error();
      if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error();
      return u;
    } catch { throw new BrowserBridgeError('URL inválida', 'INVALID_REQUEST'); }
  }

  private canonical(value: string) { const u = this.url(value); u.hash = ''; return u.href.replace(/\/$/, ''); }

  private validCart(linked: Linked, cart: BrowserCartEvidence): boolean {
    try {
      return cart.verified === true && short(cart.cartRef) && cart.accountId === linked.connection.accountId && cart.eventRef === linked.connection.eventRef && linked.connection.recipe.allowedOrigins.includes(this.url(cart.openUrl).origin) && (cart.expiresAt === null || Number.isFinite(Date.parse(cart.expiresAt))) && Array.isArray(cart.items) && cart.items.length <= 100 && cart.items.every((i) => short(i.offerRef) && short(i.sectionLabel) && integer(i.qty, 1) && integer(i.unitPrice, 0) && Array.isArray(i.seats) && i.seats.every((s) => typeof s === 'string') && (i.row === null || typeof i.row === 'string') && (i.idempotencyKey === null || typeof i.idempotencyKey === 'string'));
    } catch { return false; }
  }

  private validateSnapshot(linked: Linked, snapshot: BrowserSnapshot): BrowserSnapshot {
    if (!snapshot || !linked.connection.recipe.allowedOrigins.includes(this.url(snapshot.url).origin)) throw new BrowserBridgeError('La pestaña salió de los orígenes vinculados', 'WRONG_PAGE');
    const observedAt = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(observedAt) || Math.abs(this.now() - observedAt) > 30_000) throw new BrowserBridgeError('Lectura caducada', 'INVALID_REQUEST');
    if (typeof snapshot.supported !== 'boolean' || !['READY', 'CHALLENGE_REQUIRED', 'LOGGED_OUT'].includes(snapshot.session) || !['NOT_OPEN', 'WAITING', 'PASSED', 'EXPIRED', 'BLOCKED', 'UNKNOWN'].includes(snapshot.queue) || !Array.isArray(snapshot.offers) || snapshot.offers.length > 2000) throw new BrowserBridgeError('Lectura inválida', 'INVALID_REQUEST');
    const refs = new Set<string>();
    for (const offer of snapshot.offers) {
      if (!short(offer.offerRef) || refs.has(offer.offerRef) || !short(offer.sectionLabel) || !integer(offer.qtyMin, 1) || !integer(offer.qtyMax, offer.qtyMin) || !integer(offer.unitPrice, 0) || typeof offer.currency !== 'string' || !/^[A-Z]{3}$/.test(offer.currency) || !Array.isArray(offer.seats) || (offer.row !== null && typeof offer.row !== 'string')) throw new BrowserBridgeError('Inventario inválido', 'INVALID_REQUEST');
      refs.add(offer.offerRef);
    }
    if (snapshot.cart !== null && !this.validCart(linked, snapshot.cart)) throw new BrowserBridgeError('La evidencia del carrito no coincide con cuenta/evento', 'INVALID_REQUEST');
    return copy(snapshot);
  }
}
