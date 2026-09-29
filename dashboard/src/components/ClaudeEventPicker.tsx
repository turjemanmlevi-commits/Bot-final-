/**
 * «🤖 Claude»: al elegir la web de venta, Claude mira sus próximos eventos; al
 * elegir uno, lee sus datos (fechas, apertura, cuántas entradas por persona,
 * recinto y plano oficial) y el formulario se rellena solo.
 *
 * Tarda: la lista, 1–2 minutos; cada evento, otro tanto. Se ve el tiempo que
 * lleva. Lo mismo al rato sale de lo guardado (gratis).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiEventDetails, AiEventsResult, AiEventSummary, ProviderAuthorization } from '@to/shared';
import { Api } from '../lib/api';
import { useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { Icon } from './Icon';
import { Callout, Pill } from './ui';

const DAY_FMT = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** «2026-10-25T16:15» (hora de Madrid) → «dom, 25 oct 2026 · 16:15». */
export function fmtLocalDate(local: string | null, timeTBA = false): string {
  if (!local) return 'fecha sin publicar';
  const d = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return local;
  return `${DAY_FMT.format(d)}${timeTBA ? ' · hora por confirmar' : ` · ${local.slice(11, 16)}`}`;
}

const WINDOWS: Array<[number, string]> = [
  [30, 'Próximo mes'],
  [60, 'Próximos 2 meses'],
  [120, 'Próximos 4 meses'],
];

function money(usd: number): string {
  return `${usd.toFixed(2).replace('.', ',')} $`;
}

export function ClaudeEventPicker({
  provider,
  picked,
  onPicked,
}: {
  provider: ProviderAuthorization;
  /** Nombre del evento ya elegido (para marcarlo en la lista). */
  picked: string | null;
  onPicked: (details: AiEventDetails) => void;
}) {
  const s = useLive();
  const now = useNow(1000);
  const [days, setDays] = useState(60);
  const [list, setList] = useState<AiEventsResult | null>(null);
  const [busy, setBusy] = useState<{ what: 'list' | 'event'; name?: string; since: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(picked === null);
  const run = useRef(0);

  const search = async (fresh: boolean, windowDays = days) => {
    const id = ++run.current;
    setBusy({ what: 'list', since: Date.now() });
    setError(null);
    try {
      const r = await Api.aiEvents({ providerId: provider.providerId, days: windowDays, ...(fresh ? { fresh: true } : {}) });
      if (id === run.current) setList(r);
    } catch (e) {
      if (id === run.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === run.current) setBusy(null);
    }
  };

  // Al elegir la web de venta, Claude se pone a buscar solo.
  useEffect(() => {
    if (picked === null) void search(false);
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.providerId]);

  const choose = async (e: AiEventSummary) => {
    const id = ++run.current;
    setBusy({ what: 'event', name: e.name, since: Date.now() });
    setError(null);
    try {
      const d = await Api.aiEvent({ providerId: provider.providerId, name: e.name, startsAtLocal: e.startsAtLocal, venue: e.venue, city: e.city, url: e.url });
      if (id !== run.current) return;
      onPicked(d);
      setOpen(false);
    } catch (err) {
      if (id === run.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === run.current) setBusy(null);
    }
  };

  const shown = useMemo(() => {
    const q = filter
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
    if (!list) return [];
    if (!q) return list.events;
    return list.events.filter((e) =>
      `${e.name} ${e.venue ?? ''} ${e.city ?? ''}`
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .includes(q),
    );
  }, [list, filter]);

  const venueName = (id: string | null) => (id ? (s.vault?.venues.find((v) => v.venueId === id)?.name ?? null) : null);
  const secs = busy ? Math.max(0, Math.round((now - busy.since) / 1000)) : 0;
  const host = (() => {
    try {
      return provider.url ? new URL(provider.url).hostname.replace(/^www\./, '') : provider.name;
    } catch {
      return provider.name;
    }
  })();

  if (!open && picked) {
    return (
      <Callout tone="good" icon="check">
        <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
          <span>
            <b>🤖 Datos de Claude:</b> {picked}. Revisa abajo y elige dónde queréis las entradas.
          </span>
          <button type="button" className="btn sm" onClick={() => setOpen(true)}>
            Elegir otro evento
          </button>
        </div>
      </Callout>
    );
  }

  return (
    <div className="stack" style={{ gap: 10, border: '2px solid var(--accent, var(--ink))', borderRadius: 'var(--radius-lg)', padding: 14, background: 'var(--surface-2)' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <b style={{ fontSize: 15 }}>🤖 Claude: eventos de {provider.name}</b>
        <div className="row" style={{ gap: 6 }}>
          <select
            className="input"
            style={{ width: 'auto' }}
            value={days}
            disabled={busy !== null}
            aria-label="Días"
            onChange={(e) => {
              const d = Number(e.target.value);
              setDays(d);
              void search(false, d);
            }}
          >
            {WINDOWS.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn sm" disabled={busy !== null} onClick={() => void search(true)} title="Volver a preguntar a Claude (cuesta otra consulta)">
            <Icon name="refresh" size={13} /> Buscar otra vez
          </button>
        </div>
      </div>

      {busy?.what === 'list' ? (
        <Callout icon="info">
          Claude está mirando <b>{host}</b> y las webs oficiales de sus eventos… <b>{secs} s</b>
          <div className="small muted">Suele tardar 1–2 minutos. Puedes seguir rellenando otras cosas mientras tanto.</div>
        </Callout>
      ) : null}
      {busy?.what === 'event' ? (
        <Callout icon="info">
          Claude está leyendo <b>{busy.name}</b>: las condiciones (cuántas entradas por persona), las fases de venta, el recinto y su plano oficial… <b>{secs} s</b>
          <div className="small muted">Suele tardar 1–2 minutos.</div>
        </Callout>
      ) : null}
      {error ? <Callout tone="critical">{error}</Callout> : null}

      {list && busy?.what !== 'event' ? (
        <>
          {list.notes ? <div className="small ink2">ℹ️ {list.notes}</div> : null}
          {list.events.length > 6 ? (
            <input className="input" placeholder="Filtrar por nombre, recinto o ciudad…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          ) : null}
          {list.events.length === 0 ? (
            <div className="small muted">Claude no ha encontrado eventos en estas fechas. Prueba con más días o «Buscar otra vez».</div>
          ) : (
            <div className="stack" style={{ gap: 6, maxHeight: 460, overflowY: 'auto' }}>
              {shown.map((e) => {
                const known = venueName(e.vaultVenueId);
                return (
                  <div
                    key={`${e.name}-${e.startsAtLocal}`}
                    className="row"
                    style={{ justifyContent: 'space-between', gap: 10, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}
                  >
                    <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <b>{e.name}</b>
                      <span className="small ink2">
                        {fmtLocalDate(e.startsAtLocal, e.timeTBA)}
                        {e.venue ? ` · ${e.venue}` : ''}
                        {e.city ? ` (${e.city})` : ''}
                      </span>
                      <span className="row small" style={{ gap: 6 }}>
                        {known ? <Pill tone="good">Recinto en la sala</Pill> : e.venue ? <Pill>Recinto nuevo: se crea solo</Pill> : null}
                        {e.saleOpensLocal ? <span className="muted">Venta: {fmtLocalDate(e.saleOpensLocal)}</span> : null}
                      </span>
                    </div>
                    <button type="button" className="btn sm primary" disabled={busy !== null} onClick={() => void choose(e)}>
                      Elegir
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="small muted">
            {list.cached ? 'Respuesta de hace un rato (gratis).' : `Consulta: ${money(list.cost.usd)} · ${list.cost.seconds} s · ${list.cost.searches} búsquedas.`} Claude solo lee
            páginas públicas: revisa los datos antes de guardar.
          </div>
        </>
      ) : null}
    </div>
  );
}
