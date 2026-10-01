/**
 * «¿Dónde queréis las entradas?»: el recinto tal cual se ve al comprar y se
 * tocan hasta 3 sitios en orden: 🟢 1ª preferencia, 🟠 2ª, 🔵 3ª.
 *
 * - Con el plano oficial (la imagen que ha encontrado Claude): cada zona es un
 *   punto sobre la imagen. Si aún no están situadas, Claude las sitúa.
 * - Sin plano oficial (o si la web no deja ver la imagen): el plano de la sala.
 * - Siempre, debajo, todas las zonas en botones (por si alguna no sale en la imagen).
 *
 * El bot usa este orden: al abrir la venta manda a cada persona a la 1ª; si no
 * hay entradas, a la 2ª y después a la 3ª, al instante.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MAX_PREFERENCES, PREFERENCE_COLORS, PREFERENCE_NAME, type PlanPoint, type VenueArtifact } from '@to/shared';
import { Api } from '../lib/api';
import { useAsync, useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { Icon } from './Icon';
import { Callout } from './ui';
import { VenueMap } from './VenueMap';

export interface PlanState {
  image: string;
  points: PlanPoint[];
}

const prefStyle = (i: number): CSSProperties => ({ ['--pref' as string]: PREFERENCE_COLORS[i] ?? 'var(--ink)' });

/** Artefacto base del recinto (el plano de la sala). */
export function useVenueArtifact(venueId: string | null): { artifact: VenueArtifact | null; loading: boolean } {
  const s = useLive();
  const summary = venueId ? Object.values(s.venues).find((v) => v.active && v.venueId === venueId && v.eventId === null) : undefined;
  const a = useAsync(() => (summary ? Api.venue(summary.hash) : Promise.resolve(null)), [summary?.hash]);
  return { artifact: a.data ?? null, loading: Boolean(summary) && a.loading };
}

export function SeatPicker({
  venueId,
  value,
  onChange,
  plan,
  onPlan,
  autoLocate,
}: {
  venueId: string | null;
  /** Zonas elegidas, en orden (como mucho 3). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Plano oficial (imagen) y dónde está cada zona en él. */
  plan: PlanState | null;
  onPlan: (next: PlanState | null) => void;
  /** Pedir a Claude que sitúe las zonas en cuanto el recinto esté listo (plano recién encontrado). */
  autoLocate: boolean;
}) {
  const s = useLive();
  const aiReady = Boolean(s.system?.ai.configured);
  const { artifact, loading } = useVenueArtifact(venueId);
  const zones = useMemo(() => (artifact ? artifact.zones.map((z) => z.name) : []), [artifact]);
  const [view, setView] = useState<'official' | 'sala'>(plan ? 'official' : 'sala');
  const [imgFailed, setImgFailed] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [locating, setLocating] = useState<{ since: number } | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);
  const now = useNow(1000);

  // Otro plano: se vuelve a intentar enseñar la imagen.
  useEffect(() => {
    setImgFailed(false);
    if (plan) setView('official');
  }, [plan?.image]);

  const locate = async () => {
    if (!plan || zones.length === 0 || locating) return;
    setLocating({ since: Date.now() });
    setLocateError(null);
    try {
      const r = await Api.aiSeatMap({ imageUrl: plan.image, zones, venue: artifact?.name });
      onPlan({ image: plan.image, points: r.points });
      if (r.points.length === 0) setLocateError(r.notes || 'Claude no ha encontrado las zonas en la imagen: elige en los botones de abajo o en el plano de la sala.');
    } catch (e) {
      setLocateError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocating(null);
    }
  };

  // Plano recién encontrado por Claude: se sitúan las zonas una vez, en cuanto se conocen.
  const autoDone = useRef<string | null>(null);
  useEffect(() => {
    if (!autoLocate || !aiReady || !plan || plan.points.length > 0 || zones.length === 0) return;
    const key = `${plan.image}|${zones.join('|')}`;
    if (autoDone.current === key) return;
    autoDone.current = key;
    void locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate, aiReady, plan?.image, plan?.points.length, zones.join('|')]);

  const toggle = (label: string) => {
    setHint(null);
    const i = value.indexOf(label);
    if (i >= 0) {
      onChange(value.filter((_, j) => j !== i));
      return;
    }
    if (value.length >= MAX_PREFERENCES) {
      setHint(`Ya hay ${MAX_PREFERENCES} sitios elegidos: quita uno (toca el mismo sitio o la ✕) para elegir otro.`);
      return;
    }
    onChange([...value, label]);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    onChange(next);
  };

  if (!venueId) {
    return <div className="small muted">Elige antes el evento (o el recinto): aquí aparecerá su plano para tocar dónde queréis las entradas.</div>;
  }
  if (loading && !artifact) return <div className="small muted">Cargando el plano del recinto…</div>;

  const showOfficial = plan !== null && view === 'official' && !imgFailed;
  const pointed = new Set(plan?.points.map((p) => p.zone));

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="small ink2">
        Toca hasta {MAX_PREFERENCES} sitios en orden:{' '}
        {PREFERENCE_COLORS.map((c, i) => (
          <span key={c} style={{ color: c, fontWeight: 700 }}>
            {i + 1}ª preferencia ({PREFERENCE_NAME[i]}){i < PREFERENCE_COLORS.length - 1 ? ', ' : ''}
          </span>
        ))}
        . Otra vez para quitarlo. Al abrir la venta, el bot manda a cada persona a la 1ª; si no hay entradas, a la 2ª y después a la 3ª.
      </div>

      <div className="row" style={{ gap: 8, minHeight: 32 }} aria-live="polite">
        {value.length === 0 ? <span className="small muted">Aún no has elegido: sin preferencias, se podrá intentar cualquier zona.</span> : null}
        {value.map((z, i) => (
          <span key={z} className="pref-chip" style={prefStyle(i)}>
            <span className="pref-rank">{i + 1}</span>
            {z}
            <button type="button" aria-label={`Subir ${z}`} onClick={() => move(i, -1)} disabled={i === 0}>
              <Icon name="up" size={13} />
            </button>
            <button type="button" aria-label={`Bajar ${z}`} onClick={() => move(i, 1)} disabled={i === value.length - 1}>
              <Icon name="down" size={13} />
            </button>
            <button type="button" aria-label={`Quitar ${z}`} onClick={() => toggle(z)}>
              <Icon name="x" size={13} />
            </button>
          </span>
        ))}
      </div>
      {hint ? <Callout tone="warning">{hint}</Callout> : null}

      {plan ? (
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className={`btn sm ${view === 'official' ? 'primary' : ''}`} onClick={() => setView('official')} disabled={imgFailed}>
            Plano oficial
          </button>
          <button type="button" className={`btn sm ${view === 'sala' ? 'primary' : ''}`} onClick={() => setView('sala')} disabled={!artifact}>
            Plano de la sala
          </button>
          <a className="btn sm ghost" href={plan.image} target="_blank" rel="noreferrer">
            <Icon name="external" size={13} /> Abrir la imagen
          </a>
        </div>
      ) : null}

      {showOfficial ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="plan-official">
            <img src={plan.image} alt={`Plano oficial de ${artifact?.name ?? 'el recinto'}`} referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
            {plan.points.map((p) => {
              const i = value.indexOf(p.zone);
              return (
                <button
                  key={p.zone}
                  type="button"
                  className={`plan-pin${i >= 0 ? ' on' : ''}${p.x > 62 ? ' end' : p.x < 38 ? ' start' : ''}`}
                  style={{ left: `${p.x}%`, top: `${p.y}%`, ...(i >= 0 ? prefStyle(i) : {}) }}
                  title={p.zone}
                  aria-label={i >= 0 ? `${p.zone}: ${i + 1}ª preferencia (quitar)` : `Elegir ${p.zone}`}
                  aria-pressed={i >= 0}
                  onClick={() => toggle(p.zone)}
                >
                  {i >= 0 ? i + 1 : '+'}
                  <span className="plan-pin-name">{p.zone}</span>
                </button>
              );
            })}
          </div>
          {locating ? (
            <div className="small">
              🤖 Claude está situando las zonas sobre el plano… {Math.max(0, Math.round((now - locating.since) / 1000))} s
            </div>
          ) : plan.points.length === 0 ? (
            <div className="row small" style={{ gap: 8 }}>
              <span className="muted">Las zonas aún no están situadas en la imagen: elige en los botones de abajo.</span>
              {aiReady && zones.length > 0 ? (
                <button type="button" className="btn sm" onClick={() => void locate()}>
                  🤖 Situarlas con Claude
                </button>
              ) : null}
            </div>
          ) : (
            <div className="small muted">Toca el «+» de cada zona sobre el plano. Los puntos los ha situado Claude: si alguno no cuadra, elige en los botones de abajo.</div>
          )}
          {locateError ? <div className="small" style={{ color: 'var(--warning-ink)' }}>{locateError}</div> : null}
        </div>
      ) : artifact ? (
        <>
          {plan && imgFailed ? (
            <Callout tone="warning">
              La web oficial no deja ver su plano desde aquí:{' '}
              <a href={plan.image} target="_blank" rel="noreferrer">
                ábrelo en otra pestaña
              </a>{' '}
              y elige en este plano o en los botones.
            </Callout>
          ) : null}
          <VenueMap artifact={artifact} targets={value} onPick={toggle} rankColors={PREFERENCE_COLORS} />
        </>
      ) : (
        <div className="small muted">El recinto aún no tiene plano en la sala: elige en los botones.</div>
      )}

      {zones.length > 0 ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">Todas las zonas{plan && plan.points.length > 0 ? ' (las que no salen en la imagen, también)' : ''}:</span>
          <div className="row" style={{ gap: 6 }}>
            {zones.map((z) => {
              const i = value.indexOf(z);
              return (
                <button
                  key={z}
                  type="button"
                  className={`pref-option${i >= 0 ? ' on' : ''}`}
                  style={i >= 0 ? prefStyle(i) : undefined}
                  aria-pressed={i >= 0}
                  onClick={() => toggle(z)}
                  title={plan && showOfficial && !pointed.has(z) ? 'No está situada en la imagen' : undefined}
                >
                  {i >= 0 ? <b>{i + 1}ª</b> : null} {z}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
