import type { QueueInfo, SessionInfo } from '@to/shared';
import { BrowserBridge, BrowserBridgeError } from '../browser/bridge';
import type { AddToCartRequest, AddToCartResult, InventoryRead, ProviderAdapter, ProviderCart } from './types';

/** Only normal, observable page controls; payment and challenge solving are not implemented. */
export class BrowserSessionProvider implements ProviderAdapter {
  readonly mode = 'BROWSER_SESSION' as const;
  readonly adapterVersion = 'browser-session-1.0.0';
  readonly confirmationPolicy = 'READBACK' as const;
  readonly declared = ['session.open', 'session.status', 'queue.status', 'inventory.read', 'cart.add', 'cart.read'] as const;

  constructor(readonly id: string, readonly name: string, private readonly bridge: BrowserBridge) {}

  async openSession(accountId: string): Promise<SessionInfo> { return this.sessionStatus(accountId); }

  private canAutomate(accountId: string, supported: boolean): boolean {
    const recipe = this.bridge.recipe(accountId);
    return supported && recipe !== null && recipe.id !== 'observe-only-v1' && (recipe.id === 'fixture-v1' || Boolean(recipe.cart));
  }

  async sessionStatus(accountId: string): Promise<SessionInfo> {
    try {
      const s = this.bridge.snapshot(accountId);
      if (s.session === 'CHALLENGE_REQUIRED') this.bridge.focus(accountId);
      const compatible = this.canAutomate(accountId, s.supported);
      return {
        state: s.session === 'READY' && !compatible ? 'UNKNOWN' : s.session,
        challenge: s.session === 'CHALLENGE_REQUIRED' ? { type: s.challenge ?? 'CAPTCHA', since: s.observedAt } : null,
        queue: { state: compatible ? s.queue : 'UNKNOWN', position: null, etaMs: null, updatedAt: s.observedAt },
        lastCheckedAt: s.observedAt,
        detail: compatible ? (s.detail ?? 'Pestaña conectada') : `Página no compatible con añadir al carrito automáticamente: falta una receta comprobada.${s.detail ? ` ${s.detail}` : ''}`,
      };
    } catch (error) {
      return { state: 'LOGGED_OUT', challenge: null, queue: { state: 'UNKNOWN', position: null, etaMs: null, updatedAt: new Date().toISOString() }, lastCheckedAt: null, detail: (error as Error).message };
    }
  }

  async queueStatus(accountId: string, eventRef: string): Promise<QueueInfo> {
    const s = this.bridge.snapshot(accountId, eventRef);
    return { state: this.canAutomate(accountId, s.supported) ? s.queue : 'UNKNOWN', position: null, etaMs: null, updatedAt: s.observedAt };
  }

  async readInventory(accountId: string, eventRef: string): Promise<InventoryRead> {
    const s = this.bridge.snapshot(accountId, eventRef);
    if (s.session !== 'READY') throw new BrowserBridgeError('Sesión o comprobación pendiente', 'SESSION_INVALID');
    if (s.queue !== 'PASSED') throw new BrowserBridgeError('La cola no ha terminado', 'NOT_IN_QUEUE');
    if (!this.canAutomate(accountId, s.supported)) throw new BrowserBridgeError('Página no soportada: falta receta comprobada', 'UNSUPPORTED_PAGE');
    return { observedAtMs: Date.parse(s.observedAt), offers: s.offers, schemaVersion: `browser:${this.bridge.recipe(accountId)?.id}:1` };
  }

  async addToCart(req: AddToCartRequest): Promise<AddToCartResult> {
    try {
      const { outcome, snapshot } = await this.bridge.add(req);
      if (outcome.status === 'ADDED' && snapshot?.cart) {
        const item = snapshot.cart.items.find((i) => i.offerRef === req.offerRef && i.qty === req.qty && i.unitPrice === req.unitPrice);
        if (item) return { status: 'ADDED', item, cart: snapshot.cart, duplicate: false };
      }
      if (outcome.status === 'REJECTED') return { status: 'REJECTED', reason: 'INVALID_REQUEST', detail: outcome.detail ?? 'La página rechazó la selección' };
      return { status: 'AMBIGUOUS', detail: outcome.detail ?? 'Falta confirmación verificable del carrito' };
    } catch (error) {
      if (error instanceof BrowserBridgeError) return { status: 'REJECTED', reason: error.code === 'SESSION_INVALID' ? 'SESSION_INVALID' : 'INVALID_REQUEST', detail: error.message };
      throw error;
    }
  }

  async readCart(accountId: string, eventRef: string): Promise<ProviderCart> {
    return this.bridge.readCart(accountId, eventRef);
  }
}
