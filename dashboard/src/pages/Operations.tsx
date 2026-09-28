import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Card, Empty, Meter, OpStatePill } from '../components/ui';
import { fmtDateTime, fmtRel } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useLive } from '../lib/store';

const FILTERS = {
  activas: ['DRAFT', 'VALIDATED', 'ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED', 'ENDED'],
  todas: null,
  cerradas: ['CLOSED', 'CANCELLED'],
} as const;

export function OperationsPage() {
  const s = useLive();
  const now = useNow(5000);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<keyof typeof FILTERS>('activas');
  const ops = useMemo(() => {
    const allowed = FILTERS[filter] as readonly string[] | null;
    return Object.values(s.operations)
      .filter((o) => !allowed || allowed.includes(o.state))
      .sort((a, b) => b.t0.localeCompare(a.t0));
  }, [s.operations, filter]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Operaciones</h1>
          <div className="sub">Cada operación es un intento de compra para un evento: qué zonas, cuántas entradas, a qué precio máximo y con qué cuentas.</div>
        </div>
        <div className="actions">
          <Link className="btn primary" to="/operaciones/nueva">
            <Icon name="plus" size={15} /> Nueva operación
          </Link>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(Object.keys(FILTERS) as Array<keyof typeof FILTERS>).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'activas' ? 'En curso' : f === 'todas' ? 'Todas' : 'Cerradas'}
          </button>
        ))}
      </div>
      <Card flush>
        {ops.length === 0 ? (
          <Empty title="Sin operaciones" action={<Link className="btn primary" to="/operaciones/nueva">Crear la primera</Link>}>
            Crea una operación eligiendo un evento del vault.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Operación</th>
                  <th>T0</th>
                  <th style={{ width: '22%' }}>Progreso</th>
                  <th className="num">Cuentas</th>
                  <th className="num">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => navigate(`/operaciones/${o.id}`)}>
                    <td>
                      <OpStatePill state={o.state} />
                    </td>
                    <td>
                      <Link to={`/operaciones/${o.id}`} onClick={(e) => e.stopPropagation()}>
                        <b>{o.name}</b>
                      </Link>
                      <div className="small muted">
                        {o.eventName} · {o.providerId}
                      </div>
                    </td>
                    <td className="nowrap">
                      {fmtDateTime(o.t0)}
                      <div className="small muted">{fmtRel(o.t0, now)}</div>
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 80 }}>
                          <Meter
                            thin
                            legend={false}
                            total={o.requestedQty}
                            ariaLabel={`${o.cartedQty} de ${o.requestedQty}`}
                            segments={[{ value: o.cartedQty, kind: 'fill', label: 'En carrito' }]}
                          />
                        </div>
                        <span className="mono small">
                          {o.cartedQty}/{o.requestedQty}
                        </span>
                      </div>
                    </td>
                    <td className="num">{o.accountIds.length}</td>
                    <td className="num">{o.openAlerts || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
