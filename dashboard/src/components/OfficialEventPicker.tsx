/**
 * «Elige el evento oficial»: al elegir recinto y dónde se vende salen los
 * próximos eventos de ese recinto en Ticketmaster, o los próximos partidos del
 * club si es un estadio de LaLiga. Al elegir uno, el formulario se rellena con
 * los datos oficiales (nombre, enlace, fecha y hora, apertura de la venta o de
 * la preventa, límite de compra) y queda vinculado para vigilarlo.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FEED_EVENT_STATUS_LABEL, FEED_LABEL, type FeedEvent, type FeedEventsResult, type FeedId, type FeedSale, type FeedSearchBy } from '@to/shared';
import { Api } from '../lib/api';
import { fmtRel } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { Icon } from './Icon';
import { Callout, Pill, type Tone } from './ui';

const madrid = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const madridTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });

/** «sáb, 10 oct 2026 · 21:00» en hora de Madrid. */
export function fmtMadrid(iso: string | null, withTime = true): string {
  if (!iso) return 'sin fecha';
  const d = new Date(iso);
  return withTime ? `${madrid.format(d)} · ${madridTime.format(d)}` : madrid.format(d);
}

const STATUS_TONE: Record<FeedEvent['status'], Tone> = {
  SCHEDULED: 'neutral',
  ONSALE: 'good',
  OFFSALE: 'neutral',
  CANCELLED: 'critical',
  POSTPONED: 'critical',
  RESCHEDULED: 'warning',
  FINISHED: 'neutral',
  UNKNOWN: 'neutral',
};

interface Window {
  key: string;
  by: FeedSearchBy;
  days: number;
  label: string;
}

const TM_WINDOWS: Window[] = [
  { key: 'e14', by: 'event', days: 14, label: 'Eventos de las próximas 2 semanas' },
  { key: 'e30', by: 'event', days: 30, label: 'Eventos del próximo mes' },
  { key: 'e90', by: 'event', days: 90, label: 'Eventos de los próximos 3 meses' },
  { key: 's14', by: 'sale', days: 14, label: 'Ventas que abren en las próximas 2 semanas' },
  { key: 's30', by: 'sale', days: 30, label: 'Ventas que abren en el próximo mes' },
];

const FD_WINDOWS: Window[] = [
  { key: 'e14', by: 'event', days: 14, label: 'Partidos de las próximas 2 semanas' },
  { key: 'e30', by: 'event', days: 30, label: 'Partidos del próximo mes' },
  { key: 'e60', by: 'event', days: 60, label: 'Partidos de los próximos 2 meses' },
];

/** Estado de la venta en una línea: «Venta general: jue, 1 oct · 10:00 (en 2 d)». */
function saleLine(s: FeedSale, now: number): string {
  if (!s.startsAt) return `${s.name}: sin fecha publicada`;
  const past = Date.parse(s.startsAt) <= now;
  return `${s.name}: ${past ? 'abrió' : 'abre'} ${fmtMadrid(s.startsAt)} (${fmtRel(s.startsAt, now)})`;
}

export interface LinkedEvent {
  feed: FeedId;
  id: string;
  name: string | null;
  sale: string | null;
}

interface Props {
  venueId: string;
  providerId: string;
  linked: LinkedEvent | null;
  onPick: (event: FeedEvent, sale: FeedSale | null) => void;
  onUnlink: () => void;
}

export function OfficialEventPicker({ venueId, providerId, linked, onPick, onUnlink }: Props) {
  const s = useLive();
  const now = useNow(30_000);
  const feeds = s.system?.feeds ?? null;
  const venue = s.vault?.venues.find((v) => v.venueId === venueId) ?? null;
  const clubs = venue?.clubs ?? [];
  const provider = s.providerAuthorizations.find((p) => p.providerId === providerId) ?? null;

  const available = useMemo(() => {
    const out: FeedId[] = [];
    if (providerId === 'ticketmaster') out.push('ticketmaster');
    if (clubs.length > 0) out.push('football');
    return out;
  }, [providerId, clubs.length]);

  const [feed, setFeed] = useState<FeedId | null>(available[0] ?? null);
  const [windowKey, setWindowKey] = useState('e14');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [result, setResult] = useState<FeedEventsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(linked === null);

  // Si cambia lo que se puede consultar, se elige la primera fuente disponible.
  useEffect(() => {
    if (feed === null || !available.includes(feed)) setFeed(available[0] ?? null);
  }, [available, feed]);

  const windows = feed === 'football' ? FD_WINDOWS : TM_WINDOWS;
  const win = windows.find((w) => w.key === windowKey) ?? (windows[0] as Window);
  const configured = feed ? Boolean(feeds?.[feed].configured) : false;
  const q = feed === 'ticketmaster' ? submitted.trim() : '';

  useEffect(() => {
    if (!open || !feed || !configured || (!venueId && !q)) {
      setResult(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setShowAll(false);
    Api.feedEvents({ feed, venueId: venueId || null, days: win.days, by: win.by, q: q || null })
      .then((r) => {
        if (alive) setResult(r);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, feed, configured, venueId, win.days, win.by, q]);

  // --- Sin fuente para esta combinación: se explica por qué y qué hacer.
  if (available.length === 0) {
    if (!venueId || !providerId) return null;
    let text: string;
    if (providerId === 'entradas-com') {
      text =
        'entradas.com no tiene una API pública oficial, así que la sala no puede listar sus eventos: busca el evento en su web (enlace de abajo) y copia aquí la fecha, la hora y la apertura de la venta. La vigilancia te mandará igualmente los recordatorios.';
    } else if (providerId === 'real-madrid') {
      text =
        'Los partidos del Real Madrid salen al elegir el recinto «Estadio Santiago Bernabéu». Para otros eventos del club (baloncesto…) no hay fuente oficial: escribe los datos a mano desde realmadrid.com.';
    } else if (provider?.mode === 'SIMULATED') {
      return null;
    } else {
      text = `${provider?.name ?? 'Esta web'} no tiene fuente oficial conectada: escribe los datos a mano desde su web. Si el evento se vende en Ticketmaster, elige «Ticketmaster» en «Dónde se vende» y te saldrán sus próximos eventos.`;
    }
    return (
      <Callout icon="info">
        <b>Datos a mano.</b> {text}
      </Callout>
    );
  }

  if (!open && linked) {
    return (
      <Callout tone="good" icon="check">
        <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
          <span>
            <b>Evento oficial vinculado</b> ({FEED_LABEL[linked.feed]}){linked.name ? `: ${linked.name}` : ''} <span className="mono small">· {linked.id}</span>
            {linked.sale ? <span className="small"> · apertura: {linked.sale}</span> : null}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => setOpen(true)}>
              Cambiar
            </button>
            <button type="button" className="btn sm ghost" onClick={onUnlink} title="Los datos se quedan; solo deja de estar vinculado (no se vigilará en la fuente)">
              Desvincular
            </button>
          </span>
        </div>
      </Callout>
    );
  }

  const list = result?.events ?? [];
  const shown = showAll ? list : list.slice(0, 12);
  const pick = (e: FeedEvent, sale: FeedSale | null) => {
    onPick(e, sale);
    setOpen(false);
  };

  return (
    <div className="stack" style={{ gap: 10, border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)', padding: 14, background: 'var(--surface-2)' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <b style={{ fontSize: 15 }}>
          <Icon name="search" size={15} /> Elige el evento oficial
        </b>
        {linked ? (
          <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>
            Cerrar
          </button>
        ) : null}
      </div>

      {available.length > 1 ? (
        <div className="tabs" style={{ marginBottom: 0 }} role="tablist">
          {available.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={feed === f} className={`tab ${feed === f ? 'active' : ''}`} onClick={() => setFeed(f)}>
              {FEED_LABEL[f]}
            </button>
          ))}
        </div>
      ) : null}

      {!feed ? null : !configured ? (
        <Callout tone="warning" icon="link">
          {feed === 'ticketmaster' ? (
            <>
              Para ver aquí los próximos eventos de Ticketmaster (con su hora de venta y su límite de compra oficiales), pon tu <b>clave gratuita</b> de Ticketmaster en{' '}
              <Link to="/ajustes#fuentes">Ajustes · Fuentes de eventos</Link> (5 minutos). Mientras, puedes escribir los datos a mano.
            </>
          ) : (
            <>
              Para ver aquí los próximos partidos de {clubs[0] ?? 'este estadio'} (LaLiga y Champions) con su fecha y hora oficiales, pon el <b>token gratuito</b> de football-data.org en{' '}
              <Link to="/ajustes#fuentes">Ajustes · Fuentes de eventos</Link>. Mientras, puedes escribir los datos a mano.
            </>
          )}
        </Callout>
      ) : (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 240px', minWidth: 0 }}>
              <label htmlFor="oep-window">Qué buscar</label>
              <select id="oep-window" className="input" value={win.key} onChange={(e) => setWindowKey(e.target.value)}>
                {windows.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
            {feed === 'ticketmaster' ? (
              <div className="field" style={{ flex: '1 1 220px', minWidth: 0 }}>
                <label htmlFor="oep-q">Artista o nombre (opcional)</label>
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <input
                    id="oep-q"
                    className="input"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setSubmitted(query);
                      }
                    }}
                    placeholder="Morat, Aitana…"
                  />
                  <button type="button" className="btn" onClick={() => setSubmitted(query)} aria-label="Buscar">
                    <Icon name="search" size={14} />
                  </button>
                  {submitted ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setQuery('');
                        setSubmitted('');
                      }}
                      title="Volver a los eventos del recinto"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {!venueId && !q ? <div className="small muted">Elige el recinto (o escribe el artista) y salen los eventos.</div> : null}
          {loading ? <div className="small muted">Consultando {FEED_LABEL[feed]}…</div> : null}
          {error ? <Callout tone="critical">{error}</Callout> : null}
          {result && !loading ? (
            <>
              {result.matched.length > 0 ? (
                <div className="small ink2">
                  {feed === 'football' ? 'Partidos en casa de' : 'Recinto en Ticketmaster'}:{' '}
                  {result.matched.map((m) => `${m.name}${m.city ? ` (${m.city})` : ''}`).join(' · ')}
                </div>
              ) : null}
              {result.message ? <div className="small ink2">{result.message}</div> : null}
              <div className="stack" style={{ gap: 8 }}>
                {shown.map((e) => (
                  <EventRow key={`${e.feed}-${e.id}`} e={e} now={now} linkedId={linked?.feed === e.feed ? linked.id : null} onPick={pick} />
                ))}
              </div>
              {list.length > shown.length ? (
                <button type="button" className="btn sm" onClick={() => setShowAll(true)}>
                  Ver los {list.length - shown.length} restantes
                </button>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function EventRow({ e, now, linkedId, onPick }: { e: FeedEvent; now: number; linkedId: string | null; onPick: (e: FeedEvent, sale: FeedSale | null) => void }) {
  const general = e.sales.find((x) => x.kind === 'PUBLIC') ?? null;
  const presales = e.sales.filter((x) => x.kind === 'PRESALE' && x.startsAt && (!x.endsAt || Date.parse(x.endsAt) > now));
  const phases = [general, ...presales].filter((x): x is FeedSale => x !== null);
  const isLinked = linkedId === e.id;
  const bad = e.status === 'CANCELLED' || e.status === 'POSTPONED';
  return (
    <div className="task-card" style={{ padding: 12, gap: 8, ...(isLinked ? { borderColor: 'var(--good)' } : {}) }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>{e.name}</b>
          <span className="small">
            <Icon name="calendar" size={12} /> {fmtMadrid(e.startsAt, !e.timeTBA)}
            {e.timeTBA ? <b style={{ color: 'var(--warning-ink)' }}> · hora sin confirmar</b> : null}
            {e.venueLocalTime ? <span className="muted"> (hora de Madrid; allí {e.venueLocalTime})</span> : null}
            {e.startsAt ? <span className="muted"> · {fmtRel(e.startsAt, now)}</span> : null}
          </span>
          {e.venue ? (
            <span className="small muted">
              {e.venue.name}
              {e.venue.city ? `, ${e.venue.city}` : ''}
              {e.category ? ` · ${e.category}` : ''}
              {e.atVenue === false ? <b style={{ color: 'var(--warning-ink)' }}> · otro recinto</b> : null}
            </span>
          ) : e.category ? (
            <span className="small muted">{e.category}</span>
          ) : null}
        </div>
        <Pill tone={STATUS_TONE[e.status]}>{FEED_EVENT_STATUS_LABEL[e.status]}</Pill>
      </div>

      {e.feed === 'ticketmaster' ? (
        <div className="stack small" style={{ gap: 2 }}>
          {phases.length === 0 ? <span className="muted">Venta: sin fecha publicada todavía.</span> : phases.map((p) => <span key={p.name}>{saleLine(p, now)}</span>)}
          <span>
            {e.limit.perCustomer ? (
              <>
                <b>Límite: {e.limit.perCustomer} por cliente</b>
                {e.limit.text ? <span className="muted"> — «{e.limit.text}»</span> : null}
              </>
            ) : e.limit.text ? (
              <>Condiciones: «{e.limit.text}»</>
            ) : (
              <span className="muted">Límite: Ticketmaster no lo publica en su API (mira la página del evento).</span>
            )}
          </span>
          {e.price && (e.price.min !== null || e.price.max !== null) ? (
            <span className="muted">
              Precio: {e.price.min !== null ? e.price.min.toLocaleString('es-ES') : '¿?'}
              {e.price.max !== null && e.price.max !== e.price.min ? `–${e.price.max.toLocaleString('es-ES')}` : ''} {e.price.currency === 'EUR' ? '€' : e.price.currency}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="small muted">La apertura de la venta y el límite los publica el club en su web: escríbelos después en el formulario.</div>
      )}
      {e.info ? <div className="small muted">{e.info}</div> : null}

      <div className="row" style={{ gap: 6 }}>
        {bad ? (
          <span className="small" style={{ color: 'var(--critical-ink)' }}>
            {FEED_EVENT_STATUS_LABEL[e.status]}: no se puede elegir.
          </span>
        ) : phases.length > 1 ? (
          phases.map((p) => (
            <button key={p.name} type="button" className={`btn sm ${p.kind === 'PUBLIC' ? 'primary' : ''}`} onClick={() => onPick(e, p)} title={`La apertura (T0) será la de «${p.name}»`}>
              <Icon name="check" size={13} /> Usar · {p.name}
            </button>
          ))
        ) : (
          <button type="button" className="btn sm primary" onClick={() => onPick(e, phases[0] ?? null)}>
            <Icon name="check" size={13} /> {isLinked ? 'Volver a cargar este evento' : 'Usar este evento'}
          </button>
        )}
        {e.url ? (
          <a className="btn sm ghost" href={e.url} target="_blank" rel="noreferrer">
            <Icon name="external" size={13} /> Ver en {FEED_LABEL[e.feed]}
          </a>
        ) : null}
        <span className="small muted mono">ID {e.id}</span>
      </div>
    </div>
  );
}
