/**
 * ⭐ Grandes partidos: los 50 partidos más importantes de los próximos 12 meses
 * (Clásico, Champions y su final, Copa del Rey, Supercopa, selección…), que
 * busca Claude. Cada uno se prepara con un toque: Claude lee sus datos, se elige
 * dónde sentarse en el plano y queda vigilado desde 2 semanas antes de la venta,
 * con 1 entrada por cuenta (todas las cuentas a la vez).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { TOP_CATEGORIES, TOP_CATEGORY_LABEL, TOP_PER_ACCOUNT, TOP_WATCH_DAYS, type TopCategory, type TopMatch, type TopMatchesState } from '@to/shared';
import { fmtLocalDate } from '../components/ClaudeEventPicker';
import { Icon } from '../components/Icon';
import { Callout, Card, Pill, type Tone } from '../components/ui';
import { Api } from '../lib/api';
import { fmtRel } from '../lib/format';
import { useNow, useToast } from '../lib/hooks';
import { useLive } from '../lib/store';

const CAT_TONE: Record<TopCategory, Tone> = {
  CLASICO: 'critical',
  CHAMPIONS: 'good',
  FINAL: 'warning',
  COPA: 'neutral',
  SUPERCOPA: 'neutral',
  SELECCION: 'neutral',
  LALIGA: 'neutral',
  OTRO: 'neutral',
};

function Stars({ value }: { value: number }) {
  const n = Math.max(1, Math.min(5, Math.round(value / 20)));
  return (
    <span title={`Importancia ${value}/100`} aria-label={`Importancia ${value} de 100`} style={{ color: 'var(--warning-ink)', letterSpacing: 1 }}>
      {'★'.repeat(n)}
      <span style={{ opacity: 0.25 }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}

function MatchCard({ m, venueName, onPrepare }: { m: TopMatch; venueName: string | null; onPrepare: (m: TopMatch) => void }) {
  return (
    <div
      className="stack"
      style={{ gap: 8, padding: 14, border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', minWidth: 0 }}
      id={`top-${m.id}`}
    >
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <Pill tone={CAT_TONE[m.category]}>{TOP_CATEGORY_LABEL[m.category]}</Pill>
        <Stars value={m.importance} />
      </div>
      <b style={{ fontSize: 16, lineHeight: 1.25 }}>{m.name}</b>
      <div className="small ink2">{m.competition}</div>
      <div className="small">
        📅 {fmtLocalDate(m.startsAtLocal, m.timeTBA)}
        <br />
        🏟 {m.venue ?? 'Estadio por confirmar'}
        {m.city ? ` (${m.city}${m.country && !/espa/i.test(m.country) ? `, ${m.country}` : ''})` : ''}
        {venueName ? (
          <>
            {' '}
            <Pill tone="good">En la sala</Pill>
          </>
        ) : null}
      </div>
      {m.saleOpensLocal ? <div className="small">🕐 Venta: {fmtLocalDate(m.saleOpensLocal)}</div> : <div className="small muted">🕐 Venta aún sin anunciar</div>}
      {m.why ? <div className="small muted">{m.why}</div> : null}
      <div className="row" style={{ gap: 6, marginTop: 'auto', paddingTop: 4 }}>
        {m.eventId ? (
          <>
            <Link className="btn sm" to={`/eventos#${encodeURIComponent(m.eventId)}`}>
              <Icon name="check" size={13} /> Preparado
            </Link>
            <Link className="btn sm primary" to={`/operaciones/nueva?evento=${encodeURIComponent(m.eventId)}`}>
              Preparar la compra
            </Link>
          </>
        ) : (
          <button type="button" className="btn sm primary" onClick={() => onPrepare(m)}>
            🎟 Preparar
          </button>
        )}
        {m.ticketUrl ? (
          <a className="btn sm ghost" href={m.ticketUrl} target="_blank" rel="noreferrer" title="Web oficial de venta">
            <Icon name="external" size={13} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function TopMatchesPage() {
  const s = useLive();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [state, setState] = useState<TopMatchesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<TopCategory | 'ALL'>('ALL');
  const [order, setOrder] = useState<'date' | 'importance'>('date');
  const aiReady = Boolean(s.system?.ai.configured);

  const load = async () => {
    try {
      setState(await Api.top());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  // Mientras Claude busca, se consulta cada 3 s.
  useEffect(() => {
    if (!state?.refreshing) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [state?.refreshing]);

  const refresh = async () => {
    try {
      setState(await Api.topRefresh());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const venueName = (id: string | null) => (id ? (s.vault?.venues.find((v) => v.venueId === id)?.name ?? null) : null);
  const counts = useMemo(() => {
    const c = new Map<TopCategory, number>();
    for (const m of state?.matches ?? []) c.set(m.category, (c.get(m.category) ?? 0) + 1);
    return c;
  }, [state]);
  const shown = useMemo(() => {
    const list = (state?.matches ?? []).filter((m) => cat === 'ALL' || m.category === cat);
    return order === 'importance' ? [...list].sort((a, b) => b.importance - a.importance) : list;
  }, [state, cat, order]);

  const prepare = (m: TopMatch) => navigate(`/eventos?nuevo=1&top=${encodeURIComponent(m.id)}`);
  const secs = state?.startedAt ? Math.max(0, Math.round((now - Date.parse(state.startedAt)) / 1000)) : 0;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>⭐ Grandes partidos</h1>
          <div className="sub">
            Los partidos más importantes de los próximos 12 meses: Clásico, Champions y su final, Copa del Rey, Supercopa, selección… Cada uno se prepara con un toque:
            se vigila desde <b>{TOP_WATCH_DAYS / 7} semanas antes de la venta</b>, eliges dónde sentaros en el plano y va <b>{TOP_PER_ACCOUNT} entrada por cuenta</b>{' '}
            (todas las cuentas a la vez). También en Telegram: <b>/top</b>.
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled={!aiReady || state?.refreshing} onClick={() => void refresh()} title="Claude vuelve a buscar la lista (cuesta otra consulta)">
            <Icon name="refresh" size={14} /> {state?.at ? 'Actualizar' : 'Buscar con Claude'}
          </button>
        </div>
      </div>

      {!aiReady ? (
        <Callout tone="warning">
          Conecta Claude en <Link to="/ajustes#claude">Ajustes → Claude (IA)</Link> para que busque los grandes partidos.
        </Callout>
      ) : null}
      {error ? <Callout tone="critical">{error}</Callout> : null}
      {state?.error ? <Callout tone="critical">La última búsqueda ha fallado: {state.error}</Callout> : null}
      {state?.refreshing ? (
        <Callout icon="info">
          🤖 Claude está buscando los grandes partidos (Clásico y derbis, Champions, Copa y Supercopa, selección y finales)… <b>{secs} s</b>
          <div className="small muted">Suele tardar 2–4 minutos. Puedes seguir usando la sala; la lista aparece aquí sola.</div>
        </Callout>
      ) : null}

      {state && state.matches.length === 0 && !state.refreshing ? (
        <Card>
          <div className="stack" style={{ gap: 10, alignItems: 'flex-start' }}>
            <b style={{ fontSize: 16 }}>Aún no hay lista</b>
            <div className="small ink2">
              Claude busca a la vez en el calendario de LaLiga, la Champions, la Copa del Rey y la Supercopa, y los partidos de selecciones y finales, y se queda con los 50
              más importantes. Tarda 2–4 minutos y cuesta una consulta (se guarda: no se paga otra vez hasta que pulses «Actualizar»).
            </div>
            <button type="button" className="btn primary" disabled={!aiReady} onClick={() => void refresh()}>
              🤖 Buscar los grandes partidos con Claude
            </button>
          </div>
        </Card>
      ) : null}

      {state && state.matches.length > 0 ? (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`btn sm ${cat === 'ALL' ? 'primary' : ''}`} onClick={() => setCat('ALL')}>
              Todos ({state.matches.length})
            </button>
            {TOP_CATEGORIES.filter((c) => counts.get(c)).map((c) => (
              <button key={c} type="button" className={`btn sm ${cat === c ? 'primary' : ''}`} onClick={() => setCat(c)}>
                {TOP_CATEGORY_LABEL[c]} ({counts.get(c)})
              </button>
            ))}
            <select className="input" style={{ width: 'auto', marginLeft: 'auto' }} value={order} onChange={(e) => setOrder(e.target.value as 'date' | 'importance')} aria-label="Orden">
              <option value="date">Por fecha</option>
              <option value="importance">Por importancia</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {shown.map((m) => (
              <MatchCard key={m.id} m={m} venueName={venueName(m.vaultVenueId)} onPrepare={prepare} />
            ))}
          </div>
          {state.notes.length > 0 ? <div className="small ink2">ℹ️ {state.notes.join(' · ')}</div> : null}
          <div className="small muted">
            Lista de Claude {state.at ? fmtRel(state.at, now) : ''}
            {state.cost ? ` · ${state.cost.usd.toFixed(2).replace('.', ',')} $ · ${state.cost.searches} búsquedas` : ''}. Revisa cada partido al prepararlo: Claude lee su página
            oficial y sus condiciones.
          </div>
        </>
      ) : null}
    </div>
  );
}
