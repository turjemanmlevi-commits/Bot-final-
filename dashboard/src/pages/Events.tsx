import { useMemo } from 'react';
import { Link } from 'react-router';
import { LIMIT_SEMANTICS_LABEL } from '@to/shared';
import { Icon } from '../components/Icon';
import { Card, Empty, Pill } from '../components/ui';
import { fmtDate, fmtDateTime, fmtRel } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useLive } from '../lib/store';

export function EventsPage() {
  const s = useLive();
  const now = useNow(30_000);
  const events = useMemo(() => Object.values(s.events).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [s.events]);
  const venueName = (venueId: string) => Object.values(s.venues).find((v) => v.venueId === venueId && v.eventId === null)?.name ?? venueId;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Eventos</h1>
          <div className="sub">
            Salen del vault (<code>20 Eventos</code>). Edítalos en Obsidian: fechas, proveedor, límites y secciones cerradas. Sin límites verificados no se puede armar
            (fail-closed).
          </div>
        </div>
      </div>
      {events.length === 0 ? (
        <Card>
          <Empty title="Sin eventos">Crea una nota con la plantilla «Evento» en la carpeta 20 Eventos del vault.</Empty>
        </Card>
      ) : (
        <div className="grid cols-2">
          {events.map((e) => {
            const verified = e.limits.verified && e.limits.semantics !== 'UNKNOWN';
            const provider = s.system?.providers.find((p) => p.id === e.providerId);
            return (
              <Card
                key={e.id}
                title={
                  <div className="stack" style={{ gap: 2 }}>
                    <h2 style={{ letterSpacing: '0.03em' }}>{e.name}</h2>
                    <span className="small muted">
                      {venueName(e.venueId)} · {provider?.name ?? e.providerId}
                    </span>
                  </div>
                }
                actions={
                  <Link className={`btn sm ${verified ? 'primary' : ''}`} to={`/operaciones/nueva?evento=${encodeURIComponent(e.id)}`}>
                    <Icon name="plus" size={13} /> Operación
                  </Link>
                }
              >
                <div className="stack">
                  <dl className="kv">
                    <dt>Evento</dt>
                    <dd>{fmtDate(e.startsAt)}</dd>
                    <dt>Venta (T0)</dt>
                    <dd>{e.onSaleAt ? `${fmtDateTime(e.onSaleAt)} · ${fmtRel(e.onSaleAt, now)}` : 'sin fecha'}</dd>
                    <dt>Límites</dt>
                    <dd>
                      {e.limits.perAccount}/cuenta · {e.limits.perGroup}/grupo · {e.limits.perOperation}/operación · {LIMIT_SEMANTICS_LABEL[e.limits.semantics]}
                    </dd>
                    <dt>Fuente</dt>
                    <dd className="small">{e.limits.source || '—'}</dd>
                    {e.closedSectionIds.length ? (
                      <>
                        <dt>Cerradas</dt>
                        <dd className="small">{e.closedSectionIds.map((x) => x.split('.').pop()).join(', ')}</dd>
                      </>
                    ) : null}
                    <dt>Nota</dt>
                    <dd className="small mono">{e.sourceFile}</dd>
                  </dl>
                  <div className="row">
                    <Pill tone={verified ? 'good' : 'critical'}>{verified ? 'Límites verificados' : 'Límites sin verificar: no se puede armar'}</Pill>
                    {e.limits.notes ? <span className="small ink2">{e.limits.notes}</span> : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
