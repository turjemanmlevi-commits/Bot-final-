import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { LabelResolutionResult, VenueSection } from '@to/shared';
import { Icon } from '../components/Icon';
import { Callout, Card, Empty, Pill, ViewDots } from '../components/ui';
import { Api } from '../lib/api';
import { fmtDate, fmtDateTime, shortHash } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import { useLive } from '../lib/store';

export function VenuesPage() {
  const s = useLive();
  const { run, busy } = useAction();
  const venues = useMemo(() => Object.values(s.venues), [s.venues]);
  const v = s.vault;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Recintos · vault</h1>
          <div className="sub">
            Venue Intelligence sale de tu vault de Obsidian (<code>10 Recintos</code>): una nota por recinto, zona y sección. Guarda en Obsidian y aquí se actualiza solo.
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => Api.compileVault(), (r) => (r.applied ? 'Vault recompilado' : (r.reason ?? 'Vault con errores')))}>
            <Icon name="refresh" size={14} /> Recompilar vault
          </button>
        </div>
      </div>

      {v ? (
        <Card title="Última compilación">
          <div className="stack">
            <div className="row">
              <Pill tone={v.errors.length ? 'critical' : 'good'}>{v.errors.length ? `${v.errors.length} errores` : 'Sin errores'}</Pill>
              <span className="small ink2">
                {fmtDateTime(v.at)} · {v.notes} notas · {v.durationMs} ms · compilador {v.compilerVersion}
              </span>
              <span className="small muted mono">{v.vaultDir}</span>
            </div>
            {v.errors.map((e, i) => (
              <Callout key={`e${i}`} tone="critical">
                <span className="mono small">{e.file}</span> — {e.message}
              </Callout>
            ))}
            {v.warnings.slice(0, 12).map((w, i) => (
              <Callout key={`w${i}`} tone="warning">
                <span className="mono small">{w.file}</span> — {w.message}
              </Callout>
            ))}
            {v.warnings.length > 12 ? <div className="small muted">…y {v.warnings.length - 12} avisos más.</div> : null}
          </div>
        </Card>
      ) : null}

      {venues.length === 0 ? (
        <Card>
          <Empty title="Sin recintos">Crea una carpeta en «10 Recintos» con la plantilla Recinto, sus zonas y sus secciones.</Empty>
        </Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Recinto</th>
                  <th>Para</th>
                  <th className="num">Zonas</th>
                  <th className="num">Secciones</th>
                  <th className="num">Confianza</th>
                  <th>Verificado</th>
                  <th>Hash</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((a) => (
                  <tr key={a.hash}>
                    <td>
                      <Link to={`/recintos/${a.hash}`}>
                        <b>{a.name}</b>
                      </Link>
                      {a.warnings.length ? <div className="small muted">{a.warnings.length} avisos</div> : null}
                    </td>
                    <td className="small">{a.eventId ? `evento ${a.eventId}` : 'base'}</td>
                    <td className="num">{a.zones}</td>
                    <td className="num">{a.sections}</td>
                    <td className="num">{a.confidence.toFixed(2)}</td>
                    <td className="small">{fmtDate(a.verifiedAt)}</td>
                    <td className="mono small">{shortHash(a.hash, 12)}</td>
                    <td>{a.active ? <Pill tone="good">Activo</Pill> : <Pill icon="lock">Congelado por una operación</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ResolverTester({ hash }: { hash: string }) {
  const [label, setLabel] = useState('SEC 101');
  const [result, setResult] = useState<LabelResolutionResult | null>(null);
  const { run, busy } = useAction();
  const test = () => void run(() => Api.resolveLabel(hash, label)).then((r) => r && setResult(r));
  return (
    <Card title="Probar una etiqueta del proveedor">
      <div className="stack">
        <div className="ink2 small">Escribe la etiqueta tal y como la muestra la ticketera («GRADA BAJA - 103», «Sector 204», «PISTA»…) y mira a qué sección la resuelve el sistema.</div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            test();
          }}
        >
          <input className="input" style={{ maxWidth: 320 }} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Etiqueta" />
          <button className="btn primary" type="submit" disabled={busy}>
            <Icon name="search" size={14} /> Resolver
          </button>
        </form>
        {result ? (
          <dl className="kv">
            <dt>Normalizada</dt>
            <dd className="mono">{result.normalized || '—'}</dd>
            <dt>Sección</dt>
            <dd>{result.sectionName ?? <span className="muted">sin resolver</span>}</dd>
            <dt>Zona</dt>
            <dd>{result.zoneName ?? '—'}</dd>
            <dt>Método</dt>
            <dd className="mono">{result.method}</dd>
            <dt>Ambigüedad</dt>
            <dd>
              <Pill tone={result.ambiguity === 0 ? 'good' : result.ambiguity <= 0.3 ? 'warning' : 'critical'}>{result.ambiguity}</Pill>{' '}
              <span className="small muted">{result.reasons.join(', ')}</span>
            </dd>
          </dl>
        ) : null}
      </div>
    </Card>
  );
}

export function VenueDetailPage() {
  const { hash = '' } = useParams();
  const art = useAsync(() => Api.venue(hash), [hash]);
  const a = art.data;
  const byZone = useMemo(() => {
    const out = new Map<string, VenueSection[]>();
    for (const s of a?.sections ?? []) out.set(s.zoneId, [...(out.get(s.zoneId) ?? []), s]);
    return out;
  }, [a]);
  if (art.error) return <Callout tone="critical">{art.error}</Callout>;
  if (!a) return <div className="muted">Cargando…</div>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link to="/recintos">Recintos</Link> / <code>{a.venueId}</code>
          </div>
          <h1>{a.name}</h1>
          <div className="sub">
            {a.city ?? ''} · {a.zones.length} zonas · {a.sections.length} secciones · {a.eventId ? `con overrides del evento ${a.eventId}` : 'artefacto base'} · hash{' '}
            <code>{shortHash(a.hash, 14)}</code>
          </div>
        </div>
      </div>
      <div className="grid cols-2">
        <Card title="Procedencia">
          <dl className="kv">
            <dt>Fuente</dt>
            <dd>{a.provenance.source}</dd>
            <dt>Verificado</dt>
            <dd>
              {fmtDate(a.provenance.verifiedAt)}
              {a.provenance.verifiedBy ? ` por ${a.provenance.verifiedBy}` : ''} (lo más antiguo del recinto)
            </dd>
            <dt>Confianza</dt>
            <dd>{a.provenance.confidence}</dd>
            <dt>Compilado</dt>
            <dd>
              {fmtDateTime(a.compiledAt)} · {a.compilerVersion}
            </dd>
            <dt>Notas</dt>
            <dd className="small mono">{a.sourceFiles.length} ficheros del vault</dd>
          </dl>
          {a.warnings.length || a.overrideNotes.length ? <div className="divider" /> : null}
          <div className="stack" style={{ gap: 6 }}>
            {a.overrideNotes.map((n, i) => (
              <Callout key={`o${i}`} icon="calendar">
                {n}
              </Callout>
            ))}
            {a.warnings.map((w, i) => (
              <Callout key={`w${i}`} tone="warning">
                {w}
              </Callout>
            ))}
          </div>
        </Card>
        <ResolverTester hash={a.hash} />
      </div>
      {a.zones.map((z) => (
        <Card
          key={z.id}
          title={
            <div className="row">
              <h2>{z.name}</h2>
              {z.aliases.length ? <span className="small muted">también: {z.aliases.join(', ')}</span> : null}
            </div>
          }
          flush
        >
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Sección</th>
                  <th>Tipo</th>
                  <th>Nivel</th>
                  <th className="num">Aforo</th>
                  <th>Visión</th>
                  <th className="num">Distancia</th>
                  <th>Marcas</th>
                  <th>Aliases del proveedor</th>
                  <th className="num">Confianza</th>
                </tr>
              </thead>
              <tbody>
                {(byZone.get(z.id) ?? []).map((sec) => (
                  <tr key={sec.id}>
                    <td>
                      <b>{sec.name}</b>
                      <div className="small muted mono">{sec.id}</div>
                    </td>
                    <td>{sec.kind === 'STANDING' ? 'De pie' : 'Sentado'}</td>
                    <td className="small">{sec.level ?? '—'}</td>
                    <td className="num">
                      {sec.capacity ?? '—'}
                      {sec.rows && sec.seatsPerRow ? <div className="small muted">{sec.rows}×{sec.seatsPerRow}</div> : null}
                    </td>
                    <td>
                      <ViewDots value={sec.attributes.view} />
                    </td>
                    <td className="num">{sec.attributes.distance !== undefined ? `${sec.attributes.distance} m` : '—'}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {sec.closed ? <Pill tone="critical">Cerrada</Pill> : null}
                        {sec.attributes.obstructed ? <Pill tone="warning">Visión reducida</Pill> : null}
                        {sec.attributes.accessible ? <Pill icon="user">Accesible</Pill> : null}
                      </div>
                    </td>
                    <td className="small">{sec.aliases.join(' · ') || <span className="muted">—</span>}</td>
                    <td className="num">{sec.provenance.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
