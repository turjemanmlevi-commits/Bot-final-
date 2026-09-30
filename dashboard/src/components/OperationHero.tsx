import { Link } from 'react-router';
import { END_REASON_LABEL, pausedReasonText, type OperationSummary } from '@to/shared';
import { formatMoney } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { Icon } from './Icon';
import { OperationActions } from './OperationActions';
import { Callout, Meter, OpStatePill, StateRail, T0Board } from './ui';

const PRE_T0 = ['DRAFT', 'VALIDATED', 'ARMED', 'FROZEN'];

export function OperationHero({ op, link = false, compact = false, onChanged }: { op: OperationSummary; link?: boolean; compact?: boolean; onChanged?: () => void }) {
  const s = useLive();
  const now = useNow(250);
  const alloc = s.allocations[op.id];
  const event = s.events[op.eventId];
  const t0 = Date.parse(op.t0);
  const windowEnd = t0 + op.runWindowMinutes * 60_000;
  const inFlight = alloc ? alloc.claimedQty : 0;
  const carted = alloc?.cartedQty ?? op.cartedQty;
  const requested = alloc?.requestedQty ?? op.requestedQty;
  const running = ['RUNNING', 'PAUSED', 'RECOVERING'].includes(op.state);
  const boardTarget = PRE_T0.includes(op.state) ? op.t0 : running ? new Date(windowEnd).toISOString() : null;
  const caption = PRE_T0.includes(op.state)
    ? now < t0
      ? 'Cuenta atrás a T0 · apertura de venta'
      : 'T0 alcanzado'
    : running
      ? 'Tiempo que queda de ventana'
      : null;
  /** Nombre de lo parado por un kill switch (web de venta, operación o cuenta) para el motivo de pausa. */
  const nameOf = (scope: 'PROVIDER' | 'OPERATION' | 'ACCOUNT', id: string): string | null =>
    scope === 'OPERATION'
      ? (s.operations[id]?.name ?? null)
      : scope === 'ACCOUNT'
        ? (s.accounts[id]?.label ?? null)
        : (s.providerAuthorizations.find((p) => p.providerId === id)?.name ?? s.system?.providers.find((p) => p.id === id)?.name ?? null);

  return (
    <section className="card hero">
      <header className="card-head">
        <OpStatePill state={op.state} />
        {compact ? null : link ? (
          <Link to={`/operaciones/${op.id}`} style={{ textDecoration: 'none' }}>
            <h2 style={{ fontSize: 15, letterSpacing: '0.04em' }}>{op.name}</h2>
          </Link>
        ) : (
          <h2 style={{ fontSize: 15, letterSpacing: '0.04em' }}>{op.name}</h2>
        )}
        {compact ? null : <span className="small muted">{event?.name ?? op.eventName}</span>}
        <div className="actions">
          {link ? (
            <Link className="btn sm" to={`/operaciones/${op.id}`}>
              Abrir <Icon name="right" size={13} />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="card-body stack" style={{ gap: 18 }}>
        {op.pausedReason ? (
          <Callout tone="warning" icon="pause">
            <b>Motivo:</b> {pausedReasonText(op.pausedReason, nameOf)}
          </Callout>
        ) : null}
        {op.state === 'ENDED' && op.endReason ? (
          <Callout icon="info">
            <b>Finalizada:</b> {END_REASON_LABEL[op.endReason]}.
          </Callout>
        ) : null}
        <StateRail state={op.state} />
        <div className="grid hero-grid">
          <div className="stack hero-clock" style={{ gap: 10 }}>
            {boardTarget ? <T0Board t0={boardTarget} now={now} caption={caption ?? undefined} mode={running ? 'window' : 't0'} /> : null}
            <div className="small ink2 hero-note">
              T0 <b className="mono">{new Date(op.t0).toLocaleString('es-ES')}</b> · ventana {op.runWindowMinutes} min
            </div>
          </div>
          <div className="stack" style={{ gap: 14, minWidth: 0 }}>
            <div className="row" style={{ alignItems: 'baseline', gap: '4px 14px' }}>
              <span className="hero-figure" aria-label={`${carted} de ${requested} entradas en carrito`}>
                {carted}
                <small>/{requested}</small>
              </span>
              <span className="ink2">entradas en carrito</span>
            </div>
            <Meter
              ariaLabel={`Progreso: ${carted} en carrito, ${inFlight} en vuelo de ${requested}`}
              total={requested}
              segments={[
                { value: carted, kind: 'fill', label: 'En carrito' },
                { value: inFlight, kind: 'soft', label: 'En vuelo' },
              ]}
              trackLabel="Pendientes"
            />
            {alloc ? (
              <Meter
                ariaLabel="Presupuesto"
                thin
                total={alloc.budget.total}
                segments={[
                  { value: alloc.budget.committed, kind: 'fill', label: 'Comprometido', display: formatMoney(alloc.budget.committed, alloc.currency) },
                  { value: alloc.budget.reserved, kind: 'soft', label: 'Reservado', display: formatMoney(alloc.budget.reserved, alloc.currency) },
                ]}
                legend
              />
            ) : null}
            {alloc ? (
              <div className="small muted hero-note">
                Presupuesto {formatMoney(alloc.budget.total, alloc.currency)} · quedan {formatMoney(alloc.budget.remaining, alloc.currency)} · máx.{' '}
                {formatMoney(alloc.maxUnitPrice, alloc.currency)}/entrada
              </div>
            ) : null}
          </div>
        </div>
        <OperationActions op={op} maxUnitPrice={alloc?.maxUnitPrice} onDone={onChanged} />
      </div>
    </section>
  );
}
