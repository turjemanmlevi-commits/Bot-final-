import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  decodeCapture,
  FEED_LABEL,
  LIMIT_SEMANTICS_LABEL,
  parsePageCapture,
  PREFERENCE_EMOJI,
  watchStartMs,
  type CatalogEvent,
  type EventWatch,
  type PageImport,
  type ProviderMode,
  type TopMatch,
} from '@to/shared';
import { EventForm } from '../components/EventForm';
import { Icon } from '../components/Icon';
import { Card, Empty, Pill } from '../components/ui';
import { Api } from '../lib/api';
import { fmtDateTime, fmtRel, fmtTime } from '../lib/format';
import { useNow, useToast } from '../lib/hooks';
import { useLive } from '../lib/store';

/** Enlace sin «?…», «#…» ni barra final, para reconocer el mismo evento. */
/** «realmadrid.com/entradas/partido-123» (sin https ni www, recortado). */
function shortLink(url: string): string {
  try {
    const u = new URL(url);
    const text = `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  } catch {
    return url;
  }
}

function sameLink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

const MODE_TAG: Record<ProviderMode, string> = {
  BROWSER_SESSION: 'pestaña conectada',
  MANUAL_ASSIST: 'asistencia manual',
  SIMULATED: 'simulado',
  AUTHORIZED_API: 'API autorizada',
};

/** Vigilancia antes de la venta: si toca, desde cuándo, última consulta y últimos cambios oficiales. */
function WatchLine({ event, watch, now }: { event: CatalogEvent; watch: EventWatch | undefined; now: number }) {
  const days = event.watchDaysBefore ?? 0;
  if (days <= 0) return <div className="small muted">Sin vigilancia (en «Editar» → «Vigilar desde»).</div>;
  const what = event.onSaleAt ? 'de la venta' : 'del evento';
  const source = event.officialFeed ? FEED_LABEL[event.officialFeed] : null;
  if (!watch || watch.state === 'WAITING') {
    const anchor = Date.parse(event.onSaleAt ?? event.startsAt);
    // A la misma hora de reloj de Madrid aunque entre medias cambie la hora (como la vigilancia del servidor).
    const from = new Date(watchStartMs(anchor, days, 'Europe/Madrid')).toISOString();
    if (anchor <= now) return <div className="small muted">Ya {event.onSaleAt ? 'abrió la venta' : 'pasó el evento'}: no hay nada que vigilar.</div>;
    if (Date.parse(from) <= now) {
      return (
        <div className="small ink2">
          <Icon name="eye" size={12} /> Empezando la vigilancia…
        </div>
      );
    }
    return (
      <div className="small ink2">
        <Icon name="eye" size={12} /> Vigilará desde {days} {days === 1 ? 'día' : 'días'} antes {what}: {fmtDateTime(from)} ({fmtRel(from, now)})
        {source ? `, consultando ${source}` : ', con recordatorios por Telegram'}.
      </div>
    );
  }
  if (watch.state === 'DONE') return <div className="small muted">Vigilancia terminada (ya abrió).</div>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 8 }}>
        <Pill tone="live" icon="eye">
          Vigilando
        </Pill>
        <span className="small ink2">
          {source
            ? watch.lastCheckAt
              ? `Última consulta a ${source}: ${fmtTime(watch.lastCheckAt)}`
              : `Consultando ${source}…`
            : 'Recordatorios por Telegram (sin evento oficial vinculado)'}
        </span>
      </div>
      {watch.lastError ? <div className="small" style={{ color: 'var(--critical-ink)' }}>{watch.lastError}</div> : null}
      {watch.changes.slice(0, 3).map((c) => (
        <div key={`${c.at}-${c.text}`} className="small">
          <b>{fmtDateTime(c.at)}</b> · {c.text}
        </div>
      ))}
    </div>
  );
}

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

  const navigate = useNavigate();
  const toast = useToast();
  /** Página oficial enviada con «📥 Enviar a la sala» (abre el formulario relleno). */
  const [importing, setImporting] = useState<{ page: PageImport; seq: number } | null>(null);
  const importSeq = useRef(0);
  const handledHash = useRef('');

  const highlight = (id: string) => {
    flashSeq.current += 1;
    setFlash({ id, seq: flashSeq.current });
  };

  const open = (target: CatalogEvent | 'new') => {
    setFlash(null);
    setImporting(null);
    setTopMatch(null);
    setEditing(target);
  };

  const done = (id: string | null) => {
    setEditing(null);
    setImporting(null);
    if (id) highlight(id);
  };

  // /eventos#importar=… llega del marcador «📥 Enviar a la sala»: el formulario se abre relleno.
  useEffect(() => {
    const hash = location.hash;
    if (!hash.startsWith('#importar=') || handledHash.current === hash || !s.vault) return;
    handledHash.current = hash;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    const capture = decodeCapture(hash);
    if (!capture) {
      toast('No se ha podido leer lo que ha enviado el marcador: vuelve a pulsarlo en la página del evento.', 'error');
      return;
    }
    const page = parsePageCapture(capture, {
      timeZone: 'Europe/Madrid',
      venues: s.vault.venues.map((v) => ({ venueId: v.venueId, name: v.name, city: v.city ?? null, aliases: v.aliases ?? [], clubs: v.clubs ?? [] })),
      providers: s.providerAuthorizations.map((p) => ({ providerId: p.providerId, url: p.url })),
    });
    // ¿Ya existe este evento (mismo enlace oficial)? Entonces se actualiza ese en vez de crear otro.
    const key = sameLink(page.events[0]?.url ?? page.pageUrl);
    const existing = Object.values(s.events).find((e) => e.url !== null && sameLink(e.url) === key);
    importSeq.current += 1;
    setFlash(null);
    setEditing(existing ?? 'new');
    setImporting({ page, seq: importSeq.current });
  }, [location.hash, location.pathname, location.search, navigate, s.vault, s.events, s.providerAuthorizations, toast]);

  /** ⭐ Gran partido que se está preparando (de «Grandes partidos»). */
  const [topMatch, setTopMatch] = useState<{ match: TopMatch; seq: number } | null>(null);
  const topSeq = useRef(0);

  // /eventos?nuevo=1 abre el formulario de alta (con &top=<id>, preparando ese gran partido).
  useEffect(() => {
    if (params.get('nuevo') !== '1') return;
    const topId = params.get('top');
    const next = new URLSearchParams(params);
    next.delete('nuevo');
    next.delete('top');
    setParams(next, { replace: true });
    setImporting(null);
    if (!topId) {
      setTopMatch(null);
      setEditing('new');
      return;
    }
    void Api.top()
      .then((st) => {
        const match = st.matches.find((m) => m.id === topId);
        if (!match) {
          toast('Ese partido ya no está en «Grandes partidos»: actualiza la lista.', 'error');
          return;
        }
        topSeq.current += 1;
        setTopMatch({ match, seq: topSeq.current });
        setEditing('new');
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error'));
  }, [params, setParams, toast]);

  // /eventos#<id> resalta ese evento.
  useEffect(() => {
    if (location.hash.startsWith('#importar=')) return;
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
            «Nuevo evento»: elige dónde se vende y el evento (desde su página oficial con «📥 Enviar a la sala», o de la lista oficial) y se rellena todo lo demás. Se guarda
            como nota en Obsidian (<code>20 Eventos</code>). Sin límites verificados no se puede armar (fail-closed).
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
          <EventForm
            key={`${editing === 'new' ? 'new' : editing.id}-${importing?.seq ?? 0}-${topMatch?.seq ?? 0}`}
            initial={editing === 'new' ? undefined : editing}
            imported={importing?.page ?? null}
            top={editing === 'new' ? (topMatch?.match ?? null) : null}
            onDone={done}
          />
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
                      <dd>{fmtDateTime(e.startsAt)}</dd>
                      <dt>Venta (T0)</dt>
                      <dd>{e.onSaleAt ? `${fmtDateTime(e.onSaleAt)} · ${fmtRel(e.onSaleAt, now)}` : 'sin fecha'}</dd>
                      <dt>Límites</dt>
                      <dd>
                        {e.limits.perAccount}/cuenta · {e.limits.perGroup}/grupo · {e.limits.perOperation}/operación · {LIMIT_SEMANTICS_LABEL[e.limits.semantics]}
                      </dd>
                      <dt>Fuente</dt>
                      <dd className="small">{e.limits.source || '—'}</dd>
                      <dt>Compra</dt>
                      <dd className="small">
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noreferrer" title="Enlace oficial desde donde se compran las entradas">
                            {shortLink(e.url)}
                          </a>
                        ) : (
                          <span style={{ color: 'var(--warning-ink)' }}>
                            sin enlace oficial: ponlo en «Editar»{mode !== 'SIMULATED' && s.system?.ai.configured ? ' (o «Analizar con Claude»)' : ''}
                          </span>
                        )}
                      </dd>
                      {e.saleZones.length > 0 ? (
                        <>
                          <dt>Estructura</dt>
                          <dd className="small">
                            {e.saleZones.length} zona{e.saleZones.length === 1 ? '' : 's'} en la web: {e.saleZones.slice(0, 5).map((z) => z.zone).join(', ')}
                            {e.saleZones.length > 5 ? '…' : ''}
                          </dd>
                        </>
                      ) : null}
                      {e.preferredTargets.length > 0 ? (
                        <>
                          <dt>Dónde</dt>
                          <dd className="small">
                            {e.preferredTargets.map((t, i) => `${PREFERENCE_EMOJI[i] ?? ''} ${t}`).join(' · ')}
                            {e.perAccountQty ? ` · ${e.perAccountQty} por cuenta` : ''}
                          </dd>
                        </>
                      ) : e.perAccountQty ? (
                        <>
                          <dt>Por cuenta</dt>
                          <dd className="small">{e.perAccountQty} entrada{e.perAccountQty === 1 ? '' : 's'}</dd>
                        </>
                      ) : null}
                      {e.accountIds.length > 0 ? (
                        <>
                          <dt>Cuentas</dt>
                          <dd className="small">
                            {e.accountIds.map((aid) => s.accounts[aid]?.label ?? 'cuenta borrada').join(', ')}
                          </dd>
                        </>
                      ) : null}
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
                      {e.officialFeed ? (
                        <Pill tone="good" icon="link" title={`Identificador oficial: ${e.officialId ?? ''}`}>
                          Oficial: {FEED_LABEL[e.officialFeed]}
                        </Pill>
                      ) : null}
                      {e.limits.notes ? <span className="small ink2">{e.limits.notes}</span> : null}
                    </div>
                    <WatchLine event={e} watch={s.watches[e.id]} now={now} />
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
