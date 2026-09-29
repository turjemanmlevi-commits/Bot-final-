import { useNavigate } from 'react-router';
import { ALERT_KIND_LABEL, type Alert, type Cart } from '@to/shared';
import { Api } from '../lib/api';
import { fmtCountdown, fmtRel } from '../lib/format';
import { useAction, useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      Number(a.state === 'RESOLVED') - Number(b.state === 'RESOLVED') ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** Cuenta atrás en vivo del carrito de la alerta (solo mientras está por pagar). */
function CartCountdown({ cart }: { cart: Cart }) {
  const now = useNow(1000);
  if (!cart.expiresAt || (cart.state !== 'ACTIVE' && cart.state !== 'REVIEW_REQUIRED')) return null;
  const left = Date.parse(cart.expiresAt) - now;
  return (
    <span className={`countdown small ${left < 120_000 ? 'hot' : ''}`} style={{ marginLeft: 8, whiteSpace: 'nowrap' }} title="Tiempo que le queda al carrito">
      <Icon name="clock" size={12} /> {left > 0 ? `caduca en ${fmtCountdown(left)}` : 'tiempo agotado'}
    </span>
  );
}

export function AlertRow({ alert, compact = false }: { alert: Alert; compact?: boolean }) {
  const now = useNow(15_000);
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const ask = useDialog();
  const live = useLive();
  const cart = alert.cartId ? live.carts[alert.cartId] : undefined;
  const op = alert.operationId ? live.operations[alert.operationId] : undefined;
  const account = alert.accountId ? live.accounts[alert.accountId] : undefined;

  const doAction = async (action: Alert['actions'][number]) => {
    switch (action) {
      case 'OPEN_SESSION':
        navigate(account ? `/cuentas#${account.id}` : '/tareas');
        break;
      case 'OPEN_CART':
        if (cart?.openUrl) window.open(cart.openUrl, '_blank', 'noopener');
        else navigate('/carritos');
        break;
      case 'REVALIDATE':
        navigate(op ? `/operaciones/${op.id}` : '/operaciones');
        break;
      case 'PAUSE':
        if (op) await run(() => Api.command(op.id, { command: 'pause', reason: `Alerta: ${alert.title}` }), 'Operación pausada');
        break;
      case 'CANCEL':
        if (op && (await ask({ title: '¿Cancelar la operación?', body: op.name, confirmText: 'Cancelar operación', danger: true }))) {
          await run(() => Api.command(op.id, { command: 'cancel', reason: `Alerta: ${alert.title}` }), 'Operación cancelada');
        }
        break;
    }
  };

  const icon = alert.severity === 'CRITICAL' ? 'octagon' : alert.severity === 'WARNING' ? 'alert' : 'info';
  const actionLabel: Record<Alert['actions'][number], string> = {
    OPEN_SESSION: 'Abrir sesión',
    OPEN_CART: 'Abrir carrito',
    REVALIDATE: 'Revisar',
    PAUSE: 'Pausar',
    CANCEL: 'Cancelar',
  };

  return (
    <div className={`alert-row ${alert.severity} ${alert.state === 'RESOLVED' ? 'resolved' : ''}`}>
      <span className="icon">
        <Icon name={icon} size={18} title={alert.severity} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="title">
          {alert.title}
          {cart && alert.state !== 'RESOLVED' ? <CartCountdown cart={cart} /> : null}
        </div>
        {!compact || alert.severity !== 'INFO' ? <div className="msg">{alert.message}</div> : null}
        <div className="meta">
          {ALERT_KIND_LABEL[alert.kind]} · {fmtRel(alert.updatedAt, now)}
          {op && !compact ? ` · ${op.name}` : ''}
          {alert.state === 'ACKED' ? ' · vista' : alert.state === 'RESOLVED' ? ' · resuelta' : ''}
        </div>
        {alert.state !== 'RESOLVED' && alert.actions.length > 0 ? (
          <div className="row" style={{ marginTop: 8 }}>
            {alert.actions.map((a) => (
              <button key={a} type="button" className="btn sm" disabled={busy} onClick={() => void doAction(a)}>
                {a === 'OPEN_CART' ? <Icon name="external" size={13} /> : null}
                {actionLabel[a]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {alert.state !== 'RESOLVED' ? (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {alert.state === 'OPEN' ? (
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void run(() => Api.ackAlert(alert.id))} title="Marcar como vista">
              <Icon name="eye" size={14} />
            </button>
          ) : null}
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void run(() => Api.resolveAlert(alert.id))} title="Resolver">
            <Icon name="check" size={14} />
          </button>
        </div>
      ) : (
        <span />
      )}
    </div>
  );
}
