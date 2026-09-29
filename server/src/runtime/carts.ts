/**
 * Carritos (§18). Un carrito por cuenta y operación. Se crea cuando un claim
 * queda confirmado con el nivel mínimo que exige el proveedor (ACK, READBACK
 * o HUMAN). El pago lo hace SIEMPRE una persona; aquí solo se marca.
 */

import type { Cart, CartItem, ConfirmationLevel, Id, IsoDateTime } from '@to/shared';
import { formatDuration, formatMoney } from '@to/shared';
import { iso } from '../util/time';
import type { Ctx } from './context';

const LEVEL_ORDER: Record<ConfirmationLevel, number> = { ACK: 0, READBACK: 1, HUMAN: 2 };

export class CartError extends Error {
  constructor(
    message: string,
    readonly code = 'CART_ERROR',
  ) {
    super(message);
  }
}

export interface CartAddition {
  operationId: Id;
  accountId: Id;
  item: CartItem;
  level: ConfirmationLevel;
  providerCartRef: string;
  expiresAt: IsoDateTime | null;
  openUrl: string | null;
  review: string | null;
}

export class CartService {
  /** Umbrales de aviso ya enviados por carrito. */
  private readonly warned = new Set<string>();

  constructor(private readonly ctx: Ctx) {}

  openCartFor(operationId: Id, accountId: Id): Cart | undefined {
    for (const c of this.ctx.store.carts.values()) {
      if (c.operationId === operationId && c.accountId === accountId && (c.state === 'ACTIVE' || c.state === 'REVIEW_REQUIRED')) return c;
    }
    return undefined;
  }

  add(add: CartAddition): Cart {
    const now = iso(this.ctx.now());
    const op = this.ctx.store.operations.get(add.operationId);
    const currency = op?.config.currency ?? 'EUR';
    const existing = this.openCartFor(add.operationId, add.accountId);
    const base: Cart = existing ?? {
      id: this.ctx.ids.next('cart'),
      operationId: add.operationId,
      accountId: add.accountId,
      providerCartRef: add.providerCartRef,
      items: [],
      qty: 0,
      total: 0,
      currency,
      confirmation: add.level,
      state: 'ACTIVE',
      reviewReason: null,
      expiresAt: add.expiresAt,
      confirmedAt: now,
      updatedAt: now,
      openUrl: add.openUrl,
    };
    const items = [...base.items, add.item];
    const cart: Cart = {
      ...base,
      items,
      qty: items.reduce((n, i) => n + i.qty, 0),
      total: items.reduce((n, i) => n + i.qty * i.unitPrice, 0),
      confirmation: LEVEL_ORDER[add.level] < LEVEL_ORDER[base.confirmation] ? add.level : base.confirmation,
      expiresAt: add.expiresAt ?? base.expiresAt,
      openUrl: add.openUrl ?? base.openUrl,
      state: add.review ? 'REVIEW_REQUIRED' : base.state,
      reviewReason: add.review ?? base.reviewReason,
      updatedAt: now,
    };
    this.ctx.store.putCart(cart);
    this.ctx.journal.audit('cart.updated', { cartId: cart.id, accountId: cart.accountId, qty: cart.qty, total: cart.total, level: cart.confirmation, review: add.review }, { operationId: cart.operationId });
    const account = this.ctx.store.accounts.get(cart.accountId);
    const label = account?.label ?? cart.accountId;
    this.ctx.alerts.raise({
      kind: 'CART_CONFIRMED',
      severity: 'INFO',
      title: `${label}: ${cart.qty} entrada${cart.qty === 1 ? '' : 's'} en carrito`,
      message: `${cart.items.map((i) => `${i.qty}× ${i.sectionLabel}${i.row ? ` fila ${i.row}` : ''}`).join(' · ')} — ${formatMoney(cart.total, cart.currency)}`,
      actions: ['OPEN_CART'],
      operationId: cart.operationId,
      accountId: cart.accountId,
      cartId: cart.id,
      dedupeKey: `cart:${cart.id}:confirmed`,
    });
    if (add.review) {
      this.ctx.alerts.raise({
        kind: 'CART_REVIEW',
        severity: 'CRITICAL',
        title: `${label}: revisa el carrito`,
        message: add.review,
        actions: ['OPEN_CART', 'PAUSE'],
        operationId: cart.operationId,
        accountId: cart.accountId,
        cartId: cart.id,
        dedupeKey: `cart:${cart.id}:review`,
      });
    }
    return cart;
  }

  /** Marca el carrito como pagado o liberado. Solo lo hace una persona. */
  mark(cartId: Id, state: 'PAID' | 'RELEASED', actor: string, note?: string): Cart {
    const cart = this.ctx.store.carts.get(cartId);
    if (!cart) throw new CartError('El carrito no existe', 'NOT_FOUND');
    const paidAfterExpiry = cart.state === 'EXPIRED' && state === 'PAID';
    if (cart.state !== 'ACTIVE' && cart.state !== 'REVIEW_REQUIRED' && !paidAfterExpiry) throw new CartError('El carrito ya está cerrado', 'NOT_ACTIVE');
    const next: Cart = { ...cart, state, updatedAt: iso(this.ctx.now()) };
    this.ctx.store.putCart(next);
    if (paidAfterExpiry) this.ctx.claims.recommitPaidAfterExpiry(next);
    this.ctx.journal.audit(state === 'PAID' ? 'cart.paid_by_human' : 'cart.released', { cartId, qty: cart.qty, total: cart.total, note: note ?? null }, { operationId: cart.operationId, actor });
    this.ctx.alerts.resolveWhere((a) => a.cartId === cartId && a.kind !== 'CART_CONFIRMED', actor);
    if (state === 'RELEASED') this.ctx.claims.onCartReleased(next);
    this.checkAllSettled(cart.operationId);
    return next;
  }

  private clock(isoTime: string): string {
    return new Intl.DateTimeFormat('es-ES', { timeZone: this.ctx.cfg.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(isoTime));
  }

  /** Una persona indica cuándo caduca el carrito en la web (p. ej. desde Telegram). */
  setExpiry(cartId: Id, expiresAt: string, actor: string): Cart {
    const cart = this.ctx.store.carts.get(cartId);
    if (!cart) throw new CartError('El carrito no existe', 'NOT_FOUND');
    if (cart.state !== 'ACTIVE' && cart.state !== 'REVIEW_REQUIRED') throw new CartError('El carrito ya está cerrado', 'NOT_ACTIVE');
    const next: Cart = { ...cart, expiresAt, updatedAt: iso(this.ctx.now()) };
    for (const key of [...this.warned]) if (key.startsWith(`${cartId}:`)) this.warned.delete(key);
    this.ctx.alerts.resolveWhere((a) => a.cartId === cartId && a.kind === 'CART_EXPIRING', actor);
    this.ctx.store.putCart(next);
    this.ctx.journal.audit('cart.expiry_set', { cartId, expiresAt }, { operationId: cart.operationId, actor });
    return next;
  }

  /** Avisos de caducidad y paso a EXPIRED. */
  expiryTick(): void {
    const now = this.ctx.now();
    for (const cart of [...this.ctx.store.carts.values()]) {
      if ((cart.state !== 'ACTIVE' && cart.state !== 'REVIEW_REQUIRED') || !cart.expiresAt) continue;
      const left = Date.parse(cart.expiresAt) - now;
      const account = this.ctx.store.accounts.get(cart.accountId);
      const label = account?.label ?? cart.accountId;
      if (left <= 0 && cart.confirmation === 'HUMAN') {
        // La hora la indicó una persona (es una estimación): no se da por perdido
        // ni se vuelve a repartir; se pregunta. «Ya lo he pagado» o «Liberar».
        const key = `${cart.id}:timeup`;
        if (!this.warned.has(key)) {
          this.warned.add(key);
          this.ctx.alerts.resolveWhere((a) => a.cartId === cart.id && a.kind === 'CART_EXPIRING');
          this.ctx.alerts.raise({
            kind: 'CART_EXPIRING',
            severity: 'CRITICAL',
            title: `${label}: se acabó el tiempo del carrito, ¿lo has pagado?`,
            message: `${cart.qty} entrada${cart.qty === 1 ? '' : 's'} · ${formatMoney(cart.total, cart.currency)}. Si lo pagaste, pulsa «Ya lo he pagado». Si se perdió, pulsa «Liberar» y esas entradas se volverán a repartir.`,
            actions: ['OPEN_CART'],
            operationId: cart.operationId,
            accountId: cart.accountId,
            cartId: cart.id,
            dedupeKey: `cart:${cart.id}:timeup`,
          });
        }
        continue;
      }
      if (left <= 0) {
        const next: Cart = { ...cart, state: 'EXPIRED', updatedAt: iso(now) };
        this.ctx.store.putCart(next);
        this.ctx.journal.audit('cart.expired', { cartId: cart.id, qty: cart.qty }, { operationId: cart.operationId });
        this.ctx.alerts.resolveWhere((a) => a.cartId === cart.id && a.kind === 'CART_EXPIRING');
        this.ctx.alerts.raise({
          kind: 'CART_EXPIRED',
          severity: 'CRITICAL',
          title: `${label}: el carrito ha caducado`,
          message: `Se han perdido ${cart.qty} entradas (${formatMoney(cart.total, cart.currency)}).`,
          operationId: cart.operationId,
          accountId: cart.accountId,
          cartId: cart.id,
        });
        this.ctx.claims.onCartExpired(next);
        this.checkAllSettled(cart.operationId);
        continue;
      }
      const op = this.ctx.store.operations.get(cart.operationId);
      const thresholds = [...(op?.config.cartExpiryAlertsSeconds ?? [300, 120, 60])].sort((a, b) => b - a);
      // Cada umbral (5, 2, 1 min…) es un aviso nuevo (y llega a Telegram); si al
      // anotar el carrito ya se habían pasado varios, solo se avisa del más cercano.
      const due = thresholds.filter((t) => left <= t * 1000 && !this.warned.has(`${cart.id}:${t}`));
      const t = due.at(-1);
      if (t !== undefined) {
        for (const d of due) this.warned.add(`${cart.id}:${d}`);
        this.ctx.alerts.resolveWhere((a) => a.cartId === cart.id && a.kind === 'CART_EXPIRING');
        this.ctx.alerts.raise({
          kind: 'CART_EXPIRING',
          severity: t <= 120 ? 'CRITICAL' : 'WARNING',
          title: `${label}: el carrito caduca a las ${this.clock(cart.expiresAt)}`,
          message: `${cart.qty} entrada${cart.qty === 1 ? '' : 's'} · ${formatMoney(cart.total, cart.currency)}. Quedaban ${formatDuration(left)} al avisar. Ábrelo y paga antes de que caduque.`,
          actions: ['OPEN_CART'],
          operationId: cart.operationId,
          accountId: cart.accountId,
          cartId: cart.id,
          dedupeKey: `cart:${cart.id}:expiring:${t}`,
        });
      }
    }
  }

  private checkAllSettled(operationId: Id): void {
    const op = this.ctx.store.operations.get(operationId);
    if (!op || (op.state !== 'CART_SECURED' && op.state !== 'ENDED')) return;
    const carts = [...this.ctx.store.carts.values()].filter((c) => c.operationId === operationId);
    if (carts.length > 0 && carts.every((c) => c.state === 'PAID' || c.state === 'RELEASED' || c.state === 'EXPIRED')) {
      this.ctx.alerts.raise({
        kind: 'OPERATION_ENDED',
        severity: 'INFO',
        title: `${op.config.name}: todos los carritos cerrados`,
        message: `${carts.filter((c) => c.state === 'PAID').reduce((n, c) => n + c.qty, 0)} entradas pagadas. Ya puedes cerrar la operación.`,
        operationId,
        dedupeKey: `op:${operationId}:settled`,
      });
    }
  }
}
