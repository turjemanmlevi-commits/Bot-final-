import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { END_REASON_LABEL } from '@to/shared';
import { Icon } from '../components/Icon';
import { Card, Empty, Meter, OpStatePill } from '../components/ui';
import { fmtDateTime, fmtRel } from '../lib/format';
import { useNow, useAction } from '../lib/hooks';
import { Api } from '../lib/api';
import { useDialog } from '../components/Dialog';
import { RealTestButton } from '../components/RealTestButton';
import { RowActions } from '../components/RowActions';
import { useLive } from '../lib/store';

const FILTERS = {
  activas: ['DRAFT', 'VALIDATED', 'ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED', 'ENDED'],
  todas: null,
  cerradas: ['CLOSED', 'CANCELLED'],
  eliminadas: null,
} as const;

export function OperationsPage() {
  const s = useLive();
  const now = useNow(5000);
  const navigate = useNavigate();
  const ask = useDialog();
  const { run, busy } = useAction();
  const remove = async (id: string) => {
    const op = s.operations[id];
    if (!op) return;
    const confirmed = await ask({ title: op.archived ? 'Restaurar operación' : `Eliminar ${op.name}`, body: op.archived ? 'La operación volverá a la lista sin iniciarse.' : 'Se quitará de la lista y se cerrará si ya ha terminado. El historial se conserva y puedes restaurarla en «Eliminadas». No libera ni cancela entradas en la web oficial.', danger: !op.archived, confirmText: op.archived ? 'Restaurar' : 'Eliminar' });
    if (confirmed) await run(() => Api.archiveOperation(id, !op.archived), op.archived ? 'Operación restaurada' : 'Operación eliminada de la lista');
  };
  const [filter, setFilter] = useState<keyof typeof FILTERS>('activas');
  const ops = useMemo(() => {
    const allowed = FILTERS[filter] as readonly string[] | null;
    return Object.values(s.operations)
      .filter((o) => Boolean(o.archived) === (filter === 'eliminadas'))
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
          <RealTestButton />
          <Link className="btn primary" to="/operaciones/nueva">
            <Icon name="plus" size={15} /> Nueva operación
          </Link>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(Object.keys(FILTERS) as Array<keyof typeof FILTERS>).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'activas' ? 'En curso' : f === 'todas' ? 'Todas' : f === 'eliminadas' ? 'Eliminadas' : 'Cerradas'}
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
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => navigate(`/operaciones/${o.id}`)}>
                    <td>
                      <OpStatePill state={o.state} />
                      {o.state === 'ENDED' && o.endReason ? (
                        <div className="small muted" style={{ marginTop: 4, minWidth: 140 }}>
                          {END_REASON_LABEL[o.endReason]}
                        </div>
                      ) : null}
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
                    <td><RowActions label={o.name}><button type="button" className={`btn sm ${o.archived ? '' : 'danger'}`} disabled={busy} onClick={(e) => { e.stopPropagation(); void remove(o.id); }}>{o.archived ? 'Restaurar' : 'Eliminar'}</button></RowActions></td>
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
