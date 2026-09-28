import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { AuditEvent } from '@to/shared';
import { Card, Empty } from '../components/ui';
import { Api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { useLive } from '../lib/store';

export function AuditPage() {
  const s = useLive();
  const [operationId, setOperationId] = useState('');
  const [type, setType] = useState('');
  const [before, setBefore] = useState<number | undefined>(undefined);
  const page = useAsync(() => Api.audit({ operationId, type, before, limit: 150 }), [operationId, type, before]);
  const rows = useMemo(() => {
    const base = page.data ?? [];
    if (before !== undefined) return base;
    // En la primera página se añaden en vivo los eventos que lleguen por el stream.
    const seen = new Set(base.map((e) => e.seq));
    const fresh = s.audit.filter((e) => !seen.has(e.seq) && (!operationId || e.operationId === operationId) && (!type || e.type === type));
    return [...fresh, ...base].sort((a, b) => b.seq - a.seq);
  }, [page.data, s.audit, operationId, type, before]);
  const types = useMemo(() => [...new Set([...(page.data ?? []), ...s.audit].map((e) => e.type))].sort(), [page.data, s.audit]);
  const last = rows.at(-1);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Auditoría</h1>
          <div className="sub">Journal append-only: cada decisión, reserva, cambio de estado, respuesta humana y pago marcado, con quién lo hizo. Es la base del replay.</div>
        </div>
      </div>
      <div className="row">
        <select className="input" style={{ width: 'auto', maxWidth: 360 }} value={operationId} onChange={(e) => { setOperationId(e.target.value); setBefore(undefined); }} aria-label="Operación">
          <option value="">Todas las operaciones</option>
          {Object.values(s.operations).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => { setType(e.target.value); setBefore(undefined); }} aria-label="Tipo">
          <option value="">Cualquier tipo</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {before !== undefined ? (
          <button type="button" className="btn sm" onClick={() => setBefore(undefined)}>
            Volver a lo último
          </button>
        ) : null}
      </div>
      <Card flush>
        {rows.length === 0 ? (
          <Empty title="Sin eventos">{page.loading ? 'Cargando…' : 'No hay eventos con estos filtros.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Cuándo</th>
                  <th>Tipo</th>
                  <th>Quién</th>
                  <th>Operación</th>
                  <th>Datos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e: AuditEvent) => (
                  <tr key={e.seq}>
                    <td className="num">{e.seq}</td>
                    <td className="mono nowrap small">{fmtDateTime(e.at)}</td>
                    <td className="mono small">{e.type}</td>
                    <td className="small">{e.actor}</td>
                    <td className="small">{e.operationId ? <Link to={`/operaciones/${e.operationId}`}>{s.operations[e.operationId]?.name ?? e.operationId}</Link> : '—'}</td>
                    <td className="mono small" style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(e.payload)}>
                      {JSON.stringify(e.payload)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {last && (page.data?.length ?? 0) >= 150 ? (
        <div className="row">
          <button type="button" className="btn" onClick={() => setBefore(last.seq)}>
            Cargar anteriores
          </button>
        </div>
      ) : null}
    </div>
  );
}
