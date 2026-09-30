/**
 * «Elige el evento»: primero se elige dónde se vende y después el evento, sin
 * escribirlo. Dos caminos:
 *
 * - Sin claves: abrir el evento en la web oficial y pulsar el marcador
 *   «📥 Enviar a la sala» (la sala lee lo que esa página enseña).
 * - Con la clave gratuita de Ticketmaster o el token de los partidos: la lista
 *   de próximos eventos de esa web, de toda España, aquí mismo.
 *
 * Al elegir, el formulario se rellena con todo (recinto incluido: el del vault
 * o uno nuevo que se crea al guardar).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  FEED_EVENT_STATUS_LABEL,
  FEED_LABEL,
  type FeedEvent,
  type FeedEventsResult,
  type FeedId,
  type FeedSale,
  type FeedSearchBy,
  type ProviderAuthorization,
} from '@to/shared';
import { Api } from '../lib/api';
import { fmtRel } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { Icon } from './Icon';
import { SendToSalaButton } from './SendToSala';
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

/** Qué lista oficial tiene cada web de venta. */
export function feedFor(providerId: string): { feed: FeedId; club: string | null } | null {
  if (providerId === 'ticketmaster') return { feed: 'ticketmaster', club: null };
  if (providerId === 'real-madrid') return { feed: 'football', club: 'Real Madrid' };
  if (providerId === 'manual') return { feed: 'football', club: null };
  return null;
}

/** Estado de la venta en una línea: «Venta general: abre jue, 1 oct · 10:00 (en 2 d)». */
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

// ---------------------------------------------------------------------------
// Panel completo: web oficial (sin claves) + lista oficial (con clave)
// ---------------------------------------------------------------------------

interface PanelProps {
  provider: ProviderAuthorization | null;
  linked: LinkedEvent | null;
  onPick: (event: FeedEvent, sale: FeedSale | null) => void;
  onUnlink: () => void;
}

export function EventSourcePanel({ provider, linked, onPick, onUnlink }: PanelProps) {
  const [open, setOpen] = useState(linked === null);
  if (!provider || provider.mode === 'SIMULATED') return null;
  const source = feedFor(provider.providerId);

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

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="stack" style={{ gap: 10, border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)', padding: 14, background: 'var(--surface-2)' }}>
        <b style={{ fontSize: 15 }}>📥 Desde la web oficial (sin claves)</b>
        <div className="small ink2">
          Abre el evento en {provider.name}, y en esa página pulsa el marcador <b>📥 Enviar a la sala</b>: vuelve aquí con el nombre, la fecha, el recinto, el enlace, la
          apertura de la venta y el límite que enseñe la página. Funciona con cualquier web oficial.
        </div>
        {provider.url ? (
          <div>
            <a className="btn" href={provider.url} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> Abrir {provider.name}
            </a>
          </div>
        ) : null}
        <SendToSalaButton compact />
      </div>
      {source ? (
        <OfficialEventList feed={source.feed} club={source.club} linked={linked} onPick={(e, sale) => {
            onPick(e, sale);
            setOpen(false);
          }} onClose={linked ? () => setOpen(false) : undefined} />
      ) : provider.providerId === 'entradas-com' ? (
        <div className="small muted">entradas.com no tiene una API pública oficial: aquí no puede salir su lista. Usa «Enviar a la sala» desde la página del evento.</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista oficial de próximos eventos (toda España)
// ---------------------------------------------------------------------------

interface ListProps {
  feed: FeedId;
  club: string | null;
  linked: LinkedEvent | null;
  onPick: (event: FeedEvent, sale: FeedSale | null) => void;
  onClose?: () => void;
}

const ALL = '';

export function OfficialEventList({ feed, club, linked, onPick, onClose }: ListProps) {
  const s = useLive();
  const now = useNow(30_000);
  const configured = Boolean(s.system?.feeds?.[feed].configured);
  const windows = feed === 'football' ? FD_WINDOWS : TM_WINDOWS;
  const [windowKey, setWindowKey] = useState('e14');
  const win = windows.find((w) => w.key === windowKey) ?? (windows[0] as Window);
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [city, setCity] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [onlyVault, setOnlyVault] = useState(feed === 'ticketmaster');
  const [result, setResult] = useState<FeedEventsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(20);
  const venues = s.vault?.venues ?? [];
  const venueName = (id: string | null) => (id ? (venues.find((v) => v.venueId === id)?.name ?? id) : null);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Api.feedEvents({ feed, days: win.days, by: win.by, q: submitted.trim() || null, club })
      .then((r) => alive && setResult(r))
      .catch((e: unknown) => {
        if (!alive) return;
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [configured, feed, club, win.days, win.by, submitted]);

  const all = result?.events ?? [];
  const cities = useMemo(() => [...new Set(all.map((e) => e.venue?.city).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, 'es')), [all]);
  const categories = useMemo(() => [...new Set(all.map((e) => e.category?.split(' · ')[0]).filter((c): c is string => Boolean(c)))].sort(), [all]);
  const needle = search.trim().toLowerCase();
  const filtered = all.filter(
    (e) =>
      (!onlyVault || e.vaultVenueId !== null) &&
      (city === ALL || e.venue?.city === city) &&
      (category === ALL || e.category?.startsWith(category)) &&
      (needle === '' || `${e.name} ${e.venue?.name ?? ''} ${e.venue?.city ?? ''} ${e.home ?? ''}`.toLowerCase().includes(needle)),
  );

  const title = feed === 'ticketmaster' ? 'Lista de Ticketmaster (toda España)' : club ? `Próximos partidos de ${club} en casa` : 'Próximos partidos de LaLiga y Champions en España';

  return (
    <div className="stack" style={{ gap: 10, border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)', padding: 14, background: 'var(--surface-2)' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <b style={{ fontSize: 15 }}>
          <Icon name="search" size={15} /> {title}
        </b>
        {onClose ? (
          <button type="button" className="btn sm ghost" onClick={onClose}>
            Cerrar
          </button>
        ) : null}
      </div>

      {!configured ? (
        <div className="small ink2">
          {feed === 'ticketmaster' ? (
            <>
              Opcional: con la <b>clave gratuita</b> de Ticketmaster verás aquí todos sus próximos eventos, con la hora de venta y el límite oficiales, y la sala avisará si
              cambian. Se pone en <Link to="/ajustes#fuentes">Ajustes · Fuentes de eventos</Link>.
            </>
          ) : (
            <>
              Opcional: con el <b>token gratuito</b> de football-data.org verás aquí los próximos partidos con su hora oficial, y la sala avisará cuando LaLiga la fije o la
              cambie. Se pone en <Link to="/ajustes#fuentes">Ajustes · Fuentes de eventos</Link>.
            </>
          )}
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 220px', minWidth: 0 }}>
              <label htmlFor="oel-window">Qué buscar</label>
              <select id="oel-window" className="input" value={win.key} onChange={(e) => setWindowKey(e.target.value)}>
                {windows.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 220px', minWidth: 0 }}>
              <label htmlFor="oel-q">Buscar (artista, equipo, recinto…)</label>
              <input
                id="oel-q"
                className="input"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShown(20);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && feed === 'ticketmaster') {
                    e.preventDefault();
                    setSubmitted(search);
                  }
                }}
                placeholder={feed === 'ticketmaster' ? 'Morat, Aitana… (Intro busca en todo Ticketmaster)' : 'Atlético, Barcelona…'}
              />
            </div>
            {cities.length > 1 ? (
              <div className="field" style={{ flex: '0 1 170px', minWidth: 0 }}>
                <label htmlFor="oel-city">Ciudad</label>
                <select id="oel-city" className="input" value={city} onChange={(e) => setCity(e.target.value)}>
                  <option value={ALL}>Todas</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {categories.length > 1 ? (
              <div className="field" style={{ flex: '0 1 170px', minWidth: 0 }}>
                <label htmlFor="oel-cat">Tipo</label>
                <select id="oel-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value={ALL}>Todo</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          {feed === 'ticketmaster' ? (
            <label className="check">
              <input type="checkbox" checked={onlyVault} onChange={(e) => setOnlyVault(e.target.checked)} />
              <span>Solo los recintos grandes (los que ya están en la sala: estadios, pabellones, festivales…)</span>
            </label>
          ) : null}
          {loading ? <div className="small muted">Consultando {FEED_LABEL[feed]}…</div> : null}
          {error ? <Callout tone="critical">{error}</Callout> : null}
          {result && !loading ? (
            <>
              <div className="small ink2">
                {filtered.length === all.length ? `${all.length} eventos` : `${filtered.length} de ${all.length} eventos`}
                {onlyVault && filtered.length < all.length ? ' (quita «Solo los recintos grandes» para ver todos)' : ''}
                {submitted ? ` · búsqueda en Ticketmaster: «${submitted}»` : ''}
              </div>
              {result.message ? <div className="small ink2">{result.message}</div> : null}
              <div className="stack" style={{ gap: 8 }}>
                {filtered.slice(0, shown).map((e) => (
                  <EventRow key={`${e.feed}-${e.id}`} e={e} now={now} venueLabel={venueName(e.vaultVenueId)} linkedId={linked?.feed === e.feed ? linked.id : null} onPick={onPick} />
                ))}
              </div>
              {filtered.length > shown ? (
                <button type="button" className="btn sm" onClick={() => setShown((n) => n + 30)}>
                  Ver más ({filtered.length - shown} restantes)
                </button>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function EventRow({
  e,
  now,
  venueLabel,
  linkedId,
  onPick,
}: {
  e: FeedEvent;
  now: number;
  venueLabel: string | null;
  linkedId: string | null;
  onPick: (e: FeedEvent, sale: FeedSale | null) => void;
}) {
  const general = e.sales.find((x) => x.kind === 'PUBLIC') ?? null;
  const presales = e.sales.filter((x) => x.kind === 'PRESALE' && x.startsAt && (!x.endsAt || Date.parse(x.endsAt) > now));
  const phases = [general, ...presales].filter((x): x is FeedSale => x !== null);
  const isLinked = linkedId === e.id;
  const bad = e.status === 'CANCELLED' || e.status === 'POSTPONED';
  const where = e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ''}` : null;
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
          <span className="small muted">
            {venueLabel ? (
              <>
                <Icon name="map" size={12} /> {venueLabel}
                <span style={{ color: 'var(--good-ink, var(--good))' }}> · recinto de la sala</span>
              </>
            ) : where ? (
              <>
                <Icon name="map" size={12} /> {where}
                <span style={{ color: 'var(--warning-ink)' }}> · recinto nuevo (se crea al guardar)</span>
              </>
            ) : (
              <span style={{ color: 'var(--warning-ink)' }}>Recinto: elígelo después</span>
            )}
            {e.category ? ` · ${e.category}` : ''}
          </span>
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
        <div className="small muted">La apertura de la venta y el límite los publica el club en su web: tráelos con «📥 Enviar a la sala» desde la página del partido.</div>
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
