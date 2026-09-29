import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { LIMIT_SEMANTICS_LABEL, type CatalogEvent, type ProviderMode } from '@to/shared';
import { EventForm } from '../components/EventForm';
import { Icon } from '../components/Icon';
import { Card, Empty, Pill } from '../components/ui';
import { fmtDate, fmtDateTime, fmtRel } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useLive } from '../lib/store';

const MODE_TAG: Record<ProviderMode, string> = {
  MANUAL_ASSIST: 'asistencia manual',
  SIMULATED: 'simulado',
  AUTHORIZED_API: 'API autorizada',
};

export function EventsPage() {
  const s = useLive();
  const now = useNow(30_000);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<CatalogEvent | 'new' | null>(null);
  const [flash, setFlash] = useState<{ id: string; seq: number } | null>(null);
  const flashSeq = useRef(0);
  const scrolledFor = useRef<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const events = useMemo(() => Object.values(s.events).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [s.events]);
  const venueName = (venueId: string) =>
    Object.values(s.venues).find((v) => v.venueId === venueId && v.eventId === null)?.name ?? s.vault?.venues.find((v) => v.venueId === venueId)?.name ?? venueId;

  const highlight = (id: string) => {
    flashSeq.current += 1;
    setFlash({ id, seq: flashSeq.current });
  };

  const open = (target: CatalogEvent | 'new') => {
    setFlash(null);
    setEditing(target);
  };

  const done = (id: string | null) => {
    setEditing(null);
    if (id) highlight(id);
  };

  // /eventos?nuevo=1 abre el formulario de alta.
  useEffect(() => {
    if (params.get('nuevo') !== '1') return;
    setEditing('new');
    const next = new URLSearchParams(params);
    next.delete('nuevo');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // /eventos#<id> resalta ese evento.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) highlight(id);
  }, [location.hash]);

  // Al abrir el formulario (nuevo o editar), llevarlo a la vista.
  useEffect(() => {
    if (editing) formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [editing]);

  // Tras guardar: desplazar hasta la tarjeta (puede tardar un instante en llegar por el stream) y quitar el resaltado a los 4 s.
  useEffect(() => {
    if (!flash || scrolledFor.current === flash.seq) return;
    const el = document.getElementById(`ev-${flash.id}`);
    if (!el) return;
    scrolledFor.current = flash.seq;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flash, events]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Eventos</h1>
          <div className="sub">
            Salen del vault (<code>20 Eventos</code>). Créalos aquí —se guarda una nota en Obsidian— o en Obsidian con la plantilla «Evento». Sin límites verificados no se
            puede armar (fail-closed).
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => open('new')}>
            <Icon name="plus" size={15} /> Nuevo evento
          </button>
        </div>
      </div>

      {editing ? (
        <div ref={formRef} style={{ scrollMarginTop: 16 }}>
          <EventForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={done} />
        </div>
      ) : null}

      {events.length === 0 ? (
        <Card>
          <Empty
            title="Sin eventos"
            action={
              <button type="button" className="btn primary" onClick={() => open('new')}>
                <Icon name="plus" size={15} /> Crear evento
              </button>
            }
          >
            Crea el primero aquí (se guarda como nota en la carpeta 20 Eventos del vault) o en Obsidian con la plantilla «Evento».
          </Empty>
        </Card>
      ) : (
        <div className="grid cols-2">
          {events.map((e) => {
            const verified = e.limits.verified && e.limits.semantics !== 'UNKNOWN';
            const auth = s.providerAuthorizations.find((p) => p.providerId === e.providerId);
            const provider = s.system?.providers.find((p) => p.id === e.providerId);
            const mode = auth?.mode ?? provider?.mode;
            const lit = flash?.id === e.id;
            return (
              <div
                key={e.id}
                style={{
                  display: 'grid',
                  borderRadius: 'var(--radius-lg)',
                  outline: `2px solid ${lit ? 'var(--data-1)' : 'transparent'}`,
                  outlineOffset: 2,
                  transition: 'outline-color 0.4s ease',
                }}
              >
                <Card
                  id={`ev-${e.id}`}
                  title={
                    <div className="stack" style={{ gap: 2 }}>
                      <h2 style={{ letterSpacing: '0.03em' }}>{e.name}</h2>
                      <span className="small muted">
                        {venueName(e.venueId)} · {auth?.name ?? provider?.name ?? e.providerId} {mode ? <span className="tag">{MODE_TAG[mode]}</span> : null}
                      </span>
                    </div>
                  }
                  actions={
                    <>
                      {e.url ? (
                        <a className="btn sm ghost" href={e.url} target="_blank" rel="noreferrer" title="Abrir la página oficial del evento">
                          <Icon name="external" size={13} /> Web oficial
                        </a>
                      ) : null}
                      <button type="button" className="btn sm ghost" onClick={() => open(e)} title="Editar fechas, enlace y límites">
                        <Icon name="edit" size={13} /> Editar
                      </button>
                      <Link className={`btn sm ${verified ? 'primary' : ''}`} to={`/operaciones/nueva?evento=${encodeURIComponent(e.id)}`}>
                        <Icon name="plus" size={13} /> Operación
                      </Link>
                    </>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
