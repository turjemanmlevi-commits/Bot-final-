import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { BrowserTestState, BrowserTestStatus } from '@to/shared';
import { Api, ApiError } from '../lib/api';
import { fmtCountdown, formatMoney } from '../lib/format';
import { useAction, useNow } from '../lib/hooks';
import { useDialog } from './Dialog';
import { Icon } from './Icon';
import { Callout, Card, Pill, type Tone } from './ui';
import { RealTestButton } from './RealTestButton';

const STATUS: Record<BrowserTestStatus, { label: string; tone: Tone }> = {
  IDLE: { label: 'Sin prueba', tone: 'neutral' },
  RUNNING: { label: 'En marcha', tone: 'live' },
  WAITING_HUMAN: { label: 'Te necesita', tone: 'warning' },
  CART_SECURED: { label: 'Carrito listo · ¿pagas?', tone: 'good' },
  OPENED: { label: 'Ventana abierta para pagar', tone: 'good' },
  CANCELLED: { label: 'Liberado', tone: 'neutral' },
  EXPIRED: { label: 'Caducó', tone: 'serious' },
  FAILED: { label: 'Falló', tone: 'critical' },
};

const LEVEL_ICON = { info: '·', ok: '✓', warn: '!', error: '✕', human: '🖐' } as const;

const BUSY: BrowserTestStatus[] = ['RUNNING', 'WAITING_HUMAN', 'CART_SECURED'];

/** Estado en vivo de la prueba real con el navegador del bot (se consulta al servidor cada 1,5 s). */
export function BrowserTestCard() {
  const [st, setSt] = useState<BrowserTestState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow(1000);
  const ask = useDialog();
  const { run, busy } = useAction();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const s = await Api.browserTest();
        if (!alive) return;
        setSt(s);
        setErr(null);
        timer = setTimeout(() => void tick(), BUSY.includes(s.status) ? 1500 : 5000);
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof ApiError && e.code === 'BROWSER_TEST_UNAVAILABLE' ? null : e instanceof Error ? e.message : String(e));
        if (e instanceof ApiError && e.code === 'BROWSER_TEST_UNAVAILABLE') setSt(null);
        timer = setTimeout(() => void tick(), 6000);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st?.log.length]);

  if (!st) {
    return (
      <Card id="prueba-navegador" title="Prueba real con el navegador del bot">
        <div className="muted small">{err ?? 'Este servidor no tiene el navegador del bot: cierra la ventana negra y vuelve a abrir «Sala de control».'}</div>
      </Card>
    );
  }

  const status = STATUS[st.status];
  const busyNow = BUSY.includes(st.status);
  const cart = st.cart;
  const left = cart?.expiresAt ? Date.parse(cart.expiresAt) - now : null;

  const decide = async (decision: 'comprar' | 'cancelar') => {
    if (decision === 'cancelar') {
      const ok = await ask({ title: 'Liberar el carrito', body: 'El bot quita las entradas del carrito y cierra su ventana. No se paga nada.', confirmText: 'Sí, liberar', danger: true });
      if (!ok) return;
    }
    await run(() => Api.browserTestDecide(decision), decision === 'comprar' ? 'La ventana del bot queda abierta: paga allí (el bot no paga).' : 'Carrito liberado');
  };
  const stop = async () => {
    const ok = await ask({ title: 'Parar la prueba', body: 'Se cierra el navegador del bot. Si había entradas en el carrito, se liberan.', confirmText: 'Parar', danger: true });
    if (ok) await run(() => Api.browserTestStop(), 'Prueba parada');
  };

  return (
    <Card
      id="prueba-navegador"
      title={
        <h2 className="row" style={{ gap: 10 }}>
          Prueba real con el navegador del bot <Pill tone={status.tone}>{status.label}</Pill>
        </h2>
      }
      actions={
        busyNow ? (
          <button type="button" className="btn sm danger" disabled={busy} onClick={() => void stop()}>
            <Icon name="stop" size={13} /> Parar
          </button>
        ) : (
          <RealTestButton className="btn sm primary" size={13} />
        )
      }
    >
      {!st.available ? <Callout tone="warning">{st.detail}</Callout> : null}

      {st.status === 'IDLE' ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="ink2">
            Pulsa <b>Prueba Real Madrid</b>: el bot abre su Chrome con tu cuenta, mete <b>3 entradas seguidas</b> del próximo partido del femenino en el carrito, pulsa «Comprar
            entradas» y te manda la captura por Telegram con los botones <b>Sí</b> / <b>No</b>. Nunca paga.
          </div>
          <div className="small muted">
            Antes, una sola vez por cuenta: <Link to="/cuentas">Cuentas → Abrir navegador</Link> (se abre tu Google Chrome con un perfil del bot), inicia sesión ahí (Google, Apple o email) y cierra la ventana. Queda guardada.
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
            <span>
              Cuenta: <b>{st.accountLabel ?? '—'}</b>
              {st.accountHasCredentials ? <span className="tag">con contraseña guardada</span> : null}
            </span>
            {st.options ? (
              <span className="muted">
                {st.options.quantity} entrada{st.options.quantity === 1 ? '' : 's'}
                {st.options.contiguous && st.options.quantity > 1 ? ' seguidas' : ''} · {st.options.zones.length ? st.options.zones.join(' > ') : 'cualquier zona'} ·{' '}
                {st.options.maxUnitPrice === null ? 'sin tope' : `máx. ${formatMoney(st.options.maxUnitPrice, 'EUR')}`}
                {st.options.fallbackFewer && st.options.quantity > 1 ? ' · si no hay, menos' : ''}
              </span>
            ) : null}
            <span className={st.telegram.sent ? 'ink2' : 'muted'}>
              <Icon name="send" size={12} /> {st.telegram.detail}
            </span>
          </div>

          {st.status === 'WAITING_HUMAN' ? (
            <Callout tone="warning">
              <b>El bot te necesita en su ventana de Chrome</b> (inicia sesión, pasa la cola o resuelve la verificación). En cuanto lo hagas, sigue solo. Mira el último mensaje del
              registro.
            </Callout>
          ) : null}
          {st.error ? <Callout tone="critical">{st.error}</Callout> : null}

          {cart ? (
            <div className="grid cols-2" style={{ alignItems: 'start' }}>
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <b>{cart.eventTitle || 'Partido'}</b>
                  <div className="small muted">
                    {cart.stage === 'checkout' ? 'Pantalla de pago abierta en la ventana del bot' : 'Entradas en el carrito (no llegó a la pantalla de pago)'} · {cart.strategy}
                  </div>
                </div>
                <table className="t">
                  <tbody>
                    {cart.items.map((i, k) => (
                      <tr key={k}>
                        <td>
                          {i.qty}× {i.label}
                          {i.row ? <span className="small muted"> · fila {i.row}</span> : null}
                          {i.seats.length ? <span className="small muted"> · asientos {i.seats.join(', ')}</span> : null}
                        </td>
                        <td className="num">{formatMoney(i.unitPrice, 'EUR')}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <b>Total · {cart.qty} entrada{cart.qty === 1 ? '' : 's'}</b>
                      </td>
                      <td className="num">
                        <b>{cart.total === null ? '—' : formatMoney(cart.total, 'EUR')}</b>
                      </td>
                    </tr>
                  </tbody>
                </table>
                {left !== null ? (
                  <div className={`countdown ${left < 120_000 ? 'hot' : ''}`}>{left > 0 ? `El carrito caduca en ${fmtCountdown(left)}` : 'Tiempo del carrito agotado'}</div>
                ) : null}
                {cart.url.startsWith('http') ? (
                  <a className="btn sm" href={cart.url} target="_blank" rel="noreferrer">
                    Abrir el enlace en mi navegador <Icon name="external" size={12} />
                  </a>
                ) : null}
                {st.status === 'CART_SECURED' ? (
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn primary" disabled={busy} onClick={() => void decide('comprar')}>
                      <Icon name="check" size={14} /> Sí, voy a pagar (dejar la ventana)
                    </button>
                    <button type="button" className="btn danger" disabled={busy} onClick={() => void decide('cancelar')}>
                      <Icon name="x" size={14} /> No, liberar
                    </button>
                  </div>
                ) : st.status === 'OPENED' ? (
                  <div className="small ink2">La ventana del bot sigue abierta con la pantalla de pago: paga allí tú mismo. El bot no paga.</div>
                ) : null}
              </div>
              {cart.hasScreenshot ? (
                <a href={Api.browserTestCaptureUrl(`${st.id ?? ''}-${cart.expiresAt ?? ''}`)} target="_blank" rel="noreferrer" title="Abrir la captura a tamaño completo">
                  <img
                    src={Api.browserTestCaptureUrl(`${st.id ?? ''}-${cart.expiresAt ?? ''}`)}
                    alt="Captura de la pantalla de pago en la ventana del bot"
                    style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line, #ddd)' }}
                  />
                </a>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>
              Registro
            </div>
            <div ref={logRef} className="mono small" style={{ maxHeight: 220, overflow: 'auto', background: 'var(--bg-sunken, rgba(0,0,0,0.04))', borderRadius: 8, padding: '8px 10px' }}>
              {st.log.length === 0 ? <span className="muted">Arrancando el navegador…</span> : null}
              {st.log.map((l, i) => (
                <div
                  key={i}
                  style={{ whiteSpace: 'pre-wrap', color: l.level === 'error' ? 'var(--critical, #b00020)' : l.level === 'warn' || l.level === 'human' ? 'var(--warning, #9a6700)' : undefined }}
                >
                  <span className="muted">{l.at.slice(11, 19)}</span> {LEVEL_ICON[l.level]} {l.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
