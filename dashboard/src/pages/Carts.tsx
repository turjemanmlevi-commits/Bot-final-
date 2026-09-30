import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Cart } from '@to/shared';
import { useDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Callout, Card, CartPill, Empty, Pill } from '../components/ui';
import { Api } from '../lib/api';
import { fmtCountdown, fmtDateTime, formatMoney } from '../lib/format';
import { useAction, useNow } from '../lib/hooks';
import { useLive, type LiveState } from '../lib/store';

const LEVEL: Record<Cart['confirmation'], string> = {
  ACK: 'Confirmado por el proveedor',
  READBACK: 'Verificado leyendo el carrito',
  HUMAN: 'Registro manual · reserva no verificada',
};

/** Pendiente de pagar o de revisar. */
export const isOpenCart = (c: Cart): boolean => c.state === 'ACTIVE' || c.state === 'REVIEW_REQUIRED';

/** Carrito de una operación contra el simulador: es un ensayo, no se paga nada. */
export function isSimCart(cart: Cart, s: Pick<LiveState, 'operations' | 'system'>): boolean {
  const pid = s.operations[cart.operationId]?.providerId;
  if (!pid) return false;
  return pid === 'sim' || s.system?.providers.find((p) => p.id === pid)?.mode === 'SIMULATED';
}

/**
 * Carrito confirmado por una persona cuyo tiempo ya pasó. No caduca solo:
 * sigue abierto hasta que alguien diga si lo pagó o lo libera.
 */
export function isTimeUp(cart: Cart, now: number): boolean {
  return isOpenCart(cart) && cart.confirmation === 'HUMAN' && cart.expiresAt !== null && Date.parse(cart.expiresAt) <= now;
}

const SIM_LABEL = 'Simulación (no se paga)';
const errStyle = { color: 'var(--critical-ink)' } as const;

/** «Minutos que quedan»: +5 min o un número de 1 a 60 según lo que marque la web oficial. */
function ExpiryControl({ cart, left }: { cart: Cart; left: number | null }) {
  const { run, busy } = useAction();
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const minutes = /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null;
  const invalid = trimmed !== '' && (minutes === null || minutes < 1 || minutes > 60);
  const plus5 = Math.min(60, Math.max(1, Math.floor((Math.max(0, left ?? 0) + 5 * 60_000) / 60_000)));
  const save = async () => {
    if (minutes === null || invalid) return;
    const r = await run(() => Api.setCartExpiry(cart.id, minutes), `Cuenta atrás puesta a ${minutes} min`);
    if (r) setValue('');
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="small ink2" id={`exp-l-${cart.id}`}>
        Minutos que quedan
      </span>
      <button
        type="button"
        className="btn sm"
        disabled={busy}
        onClick={() => void run(() => Api.setCartExpiry(cart.id, plus5), `Cuenta atrás puesta a ${plus5} min`)}
        title={`Suma 5 minutos a la cuenta atrás (quedará en ${plus5} min)`}
      >
        +5 min
      </button>
      <input
        className="input"
        style={{ width: 70, height: 28 }}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="1–60"
        aria-labelledby={`exp-l-${cart.id}`}
        aria-invalid={invalid ? true : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
      />
      <button type="button" className="btn sm" disabled={busy || minutes === null || invalid} onClick={() => void save()}>
        Guardar
      </button>
      {invalid ? (
        <span className="small" style={errStyle}>
          Entre 1 y 60 minutos
        </span>
      ) : null}
    </div>
  );
}

export function CartCard({ cart }: { cart: Cart }) {
  const s = useLive();
  const now = useNow(1000);
  const ask = useDialog();
  const { run, busy } = useAction();
  const account = s.accounts[cart.accountId];
  const op = s.operations[cart.operationId];
  const who = account?.label ?? cart.accountId;
  const sim = isSimCart(cart, s);
  const browserSession = s.system?.providers.find((p) => p.id === op?.providerId)?.mode === 'BROWSER_SESSION';
  const canFocus = browserSession && cart.confirmation === 'READBACK';
  const open = isOpenCart(cart);
  const left = cart.expiresAt ? Date.parse(cart.expiresAt) - now : null;
  const timeUp = isTimeUp(cart, now);
  const hot = open && (timeUp || (left !== null && left < 120_000));

  const markPaid = async (late: boolean) => {
    const ok = await ask({
      title: late ? 'Lo pagué a tiempo' : '¿Lo has pagado tú?',
      body: sim
        ? 'Es una simulación: no hay nada que pagar. Márcalo solo para completar el ensayo.'
        : `Márcalo solo después de pagar en la web oficial con la cuenta «${who}»: ${cart.qty} entradas · ${formatMoney(cart.total, cart.currency)}. El sistema nunca paga.`,
      confirmText: 'Sí, está pagado',
    });
    if (ok) await run(() => Api.markCart(cart.id, 'PAID', late ? 'Pagado a tiempo (marcado después de caducar)' : undefined), 'Carrito marcado como pagado');
  };
  const release = async () => {
    const ok = await ask({
      title: '¿Liberar estas entradas?',
      body: 'Úsalo si se han perdido o no las vas a pagar. Si la venta sigue abierta, esas entradas se vuelven a asignar. Si ya lo has pagado, cancela y pulsa «Ya lo he pagado».',
      confirmText: 'Liberar',
      danger: true,
    });
    if (ok) await run(() => Api.markCart(cart.id, 'RELEASED'), 'Carrito liberado');
  };

  return (
    <div className={`task-card ${hot ? 'urgent' : ''}`}>
      <div className="row">
        <CartPill state={cart.state} />
        <b style={{ fontSize: 15 }}>{who}</b>
        <span className="small muted">{op?.name}</span>
        {sim ? <span className="tag">{SIM_LABEL}</span> : null}
        <span style={{ marginLeft: 'auto' }} />
        {open && left !== null ? (
          <span className={`countdown ${hot ? 'hot' : ''}`} aria-label="Tiempo hasta que caduque">
            <Icon name="clock" size={14} /> {left > 0 ? fmtCountdown(left) : cart.confirmation === 'HUMAN' ? 'tiempo agotado' : 'caducando…'}
          </span>
        ) : null}
      </div>
      {timeUp ? (
        <Callout tone="critical" icon="clock">
          <div style={{ fontSize: 16, fontWeight: 700 }}>Tiempo agotado: ¿lo has pagado?</div>
          <div>
            Si lo pagaste en la web oficial, pulsa «Ya lo he pagado». Si se perdió o no lo vas a pagar, pulsa «Liberar» y esas entradas se vuelven a repartir mientras
            la venta siga abierta.
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn primary lg" disabled={busy} onClick={() => void markPaid(false)}>
              <Icon name="check" size={15} /> Ya lo he pagado
            </button>
            <button type="button" className="btn danger lg" disabled={busy} onClick={() => void release()}>
              Liberar
            </button>
          </div>
        </Callout>
      ) : null}
      {cart.reviewReason && cart.state !== 'RELEASED' ? <Callout tone={open ? 'critical' : 'neutral'}>{cart.reviewReason}</Callout> : null}
      {open && cart.confirmation === 'HUMAN' ? (
        <Callout tone="warning">Este registro lo indicó una persona. No se ha leído el carrito ni guardado una sesión de pago. Abre la pestaña donde añadiste las entradas con esa cuenta para comprobarlas.</Callout>
      ) : null}
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
        <>
          {cart.openUrl || canFocus || !timeUp ? (
            <div className="row">
              {canFocus ? (
                <button type="button" className={`btn ${timeUp ? '' : 'primary'}`} disabled={busy}
                  onClick={() => void run(() => Api.focusCart(cart.id), `Solicitado: abrir la pestaña de ${who}`)}>
                  <Icon name="external" size={14} /> Abrir carrito en la sesión de {who}
                </button>
              ) : cart.openUrl ? (
              <a className={`btn ${timeUp ? '' : 'primary'}`} href={cart.openUrl} target="_blank" rel="noreferrer">
                <Icon name="external" size={14} /> {sim ? 'Abrir carrito (simulador)' : cart.confirmation === 'HUMAN' ? 'Abrir página del evento (no es el carrito)' : 'Abrir carrito'}
              </a>
            ) : null}
              {!timeUp ? (
                <>
                  <button type="button" className="btn" disabled={busy} onClick={() => void markPaid(false)}>
                    <Icon name="check" size={14} /> Ya lo he pagado
                  </button>
                  <button type="button" className="btn danger" disabled={busy} onClick={() => void release()}>
                    Liberar
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <ExpiryControl cart={cart} left={left} />
        </>
      ) : cart.state === 'EXPIRED' ? (
        <div className="row">
          <span className="small ink2">¿Lo pagaste antes de que caducara?</span>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void markPaid(true)} title="Lo pagué a tiempo">
            <Icon name="check" size={13} /> Ya lo he pagado
          </button>
        </div>
      ) : null}
    </div>
  );
}

const STATE_RANK: Record<Cart['state'], number> = { ACTIVE: 0, REVIEW_REQUIRED: 0, PAID: 1, EXPIRED: 2, RELEASED: 2 };

export function CartsTable({ operationId }: { operationId?: string }) {
  const s = useLive();
  const carts = useMemo(
    () =>
      Object.values(s.carts)
        .filter((c) => !operationId || c.operationId === operationId)
        .map((c) => ({ c, sim: isSimCart(c, s) }))
        .sort(
          (a, b) =>
            STATE_RANK[a.c.state] - STATE_RANK[b.c.state] ||
            Number(a.sim) - Number(b.sim) ||
            (isOpenCart(a.c) ? (a.c.expiresAt ?? '9').localeCompare(b.c.expiresAt ?? '9') : b.c.updatedAt.localeCompare(a.c.updatedAt)),
        )
        .map((x) => x.c),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.carts, s.operations, s.system, operationId],
  );
  if (carts.length === 0) {
    return (
      <Card>
        <Empty title="Sin carritos">Cuando alguien consiga entradas, cada carrito aparecerá aquí con su cuenta atrás. El pago se hace siempre en la web oficial.</Empty>
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
  const [params] = useSearchParams();
  const focusId = params.get('focus');
  const focused = useRef<string | null>(null);
  const [focusResult, setFocusResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!focusId || focused.current === focusId) return;
    focused.current = focusId;
    setFocusResult({ ok: true, text: 'Abriendo el carrito en la pestaña y cuenta originales…' });
    void Api.focusCart(focusId).then(
      () => setFocusResult({ ok: true, text: 'Solicitado: abrir el carrito en su pestaña original. Completa el pago en esa ventana.' }),
      (error: unknown) => setFocusResult({ ok: false, text: error instanceof Error ? error.message : 'No se pudo abrir la sesión original del carrito.' }),
    );
  }, [focusId]);
  const now = useNow(1000);
  const pending = Object.values(s.carts).filter(isOpenCart);
  const real = pending.filter((c) => !isSimCart(c, s));
  const simCount = pending.length - real.length;
  const total = real.reduce((n, c) => n + c.total, 0);
  const realQty = real.reduce((n, c) => n + c.qty, 0);
  const timeUp = real.filter((c) => isTimeUp(c, now));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Carritos</h1>
          <div className="sub">Comprueba las entradas y abre el carrito en la sesión de su cuenta para pagar en la web oficial.</div>
        </div>
      </div>
      {focusResult ? <Callout tone={focusResult.ok ? 'neutral' : 'critical'}>{focusResult.text}</Callout> : null}
      {timeUp.length > 0 ? (
        <Callout tone="critical" icon="clock">
          <b>
            {timeUp.length === 1 ? 'Un carrito con el tiempo agotado' : `${timeUp.length} carritos con el tiempo agotado`}:{' '}
            {timeUp.map((c) => s.accounts[c.accountId]?.label ?? c.accountId).join(', ')}.
          </b>{' '}
          Di si se pagó («Ya lo he pagado») o libéralo para que esas entradas se vuelvan a repartir.
        </Callout>
      ) : null}
      {real.length > 0 ? (
        <Callout tone="warning" icon="cart">
          <b>
            {real.length} carrito{real.length === 1 ? '' : 's'} por pagar
          </b>{' '}
          · {realQty} entrada{realQty === 1 ? '' : 's'} · {formatMoney(total, real[0]?.currency ?? 'EUR')}. Ordenados por caducidad.
          {simCount > 0 ? ` Además, ${simCount} de simulación (no se pagan).` : ''} <Link to="/alertas">Ver alertas</Link>
        </Callout>
      ) : simCount > 0 ? (
        <Callout icon="info">
          Nada por pagar. Hay {simCount} carrito{simCount === 1 ? '' : 's'} de simulación: son ensayos, no se pagan.
        </Callout>
      ) : null}
      <CartsTable />
    </div>
  );
}
