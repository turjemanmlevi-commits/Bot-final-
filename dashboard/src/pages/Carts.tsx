import { useMemo } from 'react';
import { Link } from 'react-router';
import type { Cart } from '@to/shared';
import { useDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Callout, Card, CartPill, Empty, Pill } from '../components/ui';
import { Api } from '../lib/api';
import { formatDuration, formatMoney, fmtDateTime } from '../lib/format';
import { useAction, useNow } from '../lib/hooks';
import { useLive } from '../lib/store';

const LEVEL: Record<Cart['confirmation'], string> = {
  ACK: 'Confirmado por el proveedor',
  READBACK: 'Verificado leyendo el carrito',
  HUMAN: 'Confirmado por una persona',
};

export function CartCard({ cart }: { cart: Cart }) {
  const s = useLive();
  const now = useNow(1000);
  const ask = useDialog();
  const { run, busy } = useAction();
  const account = s.accounts[cart.accountId];
  const op = s.operations[cart.operationId];
  const left = cart.expiresAt ? Date.parse(cart.expiresAt) - now : null;
  const open = cart.state === 'ACTIVE' || cart.state === 'REVIEW_REQUIRED';

  const markPaid = async () => {
    const ok = await ask({
      title: '¿Lo has pagado tú?',
      body: `Márcalo solo después de pagar en la web del proveedor con la cuenta «${account?.label ?? cart.accountId}». El sistema nunca paga.`,
      confirmText: 'Sí, está pagado',
    });
    if (ok) await run(() => Api.markCart(cart.id, 'PAID'), 'Carrito marcado como pagado');
  };
  const release = async () => {
    const ok = await ask({
      title: '¿Liberar estas entradas?',
      body: 'Quítalas del carrito en el proveedor. Si la operación sigue en marcha, ese cupo vuelve a estar disponible.',
      confirmText: 'Liberar',
      danger: true,
    });
    if (ok) await run(() => Api.markCart(cart.id, 'RELEASED'), 'Carrito liberado');
  };

  return (
    <div className={`task-card ${open && left !== null && left < 120_000 ? 'urgent' : ''}`}>
      <div className="row">
        <CartPill state={cart.state} />
        <b style={{ fontSize: 15 }}>{account?.label ?? cart.accountId}</b>
        <span className="small muted">{op?.name}</span>
        <span style={{ marginLeft: 'auto' }} />
        {open && left !== null ? (
          <span className={`countdown ${left < 120_000 ? 'hot' : ''}`} aria-label="Tiempo hasta que caduque">
            <Icon name="clock" size={14} /> {left > 0 ? formatDuration(left) : 'caducado'}
          </span>
        ) : null}
      </div>
      {cart.reviewReason ? <Callout tone="critical">{cart.reviewReason}</Callout> : null}
      <div className="task-target">
        <div>
          <div className="sign">Entradas</div>
          <div className="big">{cart.qty}</div>
        </div>
        <div>
          <div className="sign">Total</div>
          <div className="big">{formatMoney(cart.total, cart.currency)}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="sign">Detalle</div>
          {cart.items.map((i, idx) => (
            <div key={idx} className="small">
              {i.qty}× {i.sectionLabel}
              {i.row ? ` · fila ${i.row}` : ''}
              {i.seats.length ? ` · asientos ${i.seats.join(', ')}` : ''} · {formatMoney(i.unitPrice, cart.currency)}/u
            </div>
          ))}
        </div>
      </div>
      <div className="row small ink2">
        <Pill tone="neutral" icon="shield">
          {LEVEL[cart.confirmation]}
        </Pill>
        <span className="mono muted">{cart.providerCartRef}</span>
        <span className="muted">confirmado {fmtDateTime(cart.confirmedAt)}</span>
      </div>
      {open ? (
        <div className="row">
          {cart.openUrl ? (
            <a className="btn primary" href={cart.openUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> {cart.confirmation === 'HUMAN' ? 'Abrir la web oficial para pagar' : 'Abrir carrito'}
            </a>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={() => void markPaid()}>
            <Icon name="check" size={14} /> Ya lo he pagado
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void release()}>
            Liberar
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CartsTable({ operationId }: { operationId?: string }) {
  const s = useLive();
  const carts = useMemo(
    () =>
      Object.values(s.carts)
        .filter((c) => !operationId || c.operationId === operationId)
        .sort((a, b) => Number(!['ACTIVE', 'REVIEW_REQUIRED'].includes(a.state)) - Number(!['ACTIVE', 'REVIEW_REQUIRED'].includes(b.state)) || (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '')),
    [s.carts, operationId],
  );
  if (carts.length === 0) {
    return (
      <Card>
        <Empty title="Sin carritos">Cuando una operación asegure entradas, cada carrito aparecerá aquí con su cuenta atrás. El pago lo haces tú en el proveedor.</Empty>
      </Card>
    );
  }
  return (
    <div className="grid cols-2">
      {carts.map((c) => (
        <CartCard key={c.id} cart={c} />
      ))}
    </div>
  );
}

export function CartsPage() {
  const s = useLive();
  const pending = Object.values(s.carts).filter((c) => c.state === 'ACTIVE' || c.state === 'REVIEW_REQUIRED');
  const total = pending.reduce((n, c) => n + c.total, 0);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Carritos</h1>
          <div className="sub">
            Alcance automático terminal: carrito asegurado. <b>El pago es siempre humano</b>: abre cada carrito, paga en el proveedor y márcalo aquí.
          </div>
        </div>
      </div>
      {pending.length > 0 ? (
        <Callout tone="warning" icon="cart">
          <b>
            {pending.length} carrito{pending.length === 1 ? '' : 's'} por pagar
          </b>{' '}
          · {pending.reduce((n, c) => n + c.qty, 0)} entradas · {formatMoney(total, pending[0]?.currency ?? 'EUR')}. Ordenados por caducidad. <Link to="/alertas">Ver alertas</Link>
        </Callout>
      ) : null}
      <CartsTable />
    </div>
  );
}
