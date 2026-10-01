import { VenueMap } from '../components/VenueMap';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { parseVenueLayout, type LabelResolutionResult, type VaultCompileReport, type VaultIssue, type VenueSection } from '@to/shared';
import { Icon } from '../components/Icon';
import { Callout, Card, Empty, Pill, ViewDots } from '../components/ui';
import { Api } from '../lib/api';
import { fmtDate, fmtDateTime, shortHash } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import { live, useLive } from '../lib/store';

// ---------------------------------------------------------------------------
// Nuevo recinto (recinto rápido)
// ---------------------------------------------------------------------------

const EXAMPLE_PABELLON = ['Pista (de pie): Front Stage, General', 'Grada baja: Izquierda, Central, Derecha', 'Grada alta: Izquierda, Central, Derecha'].join('\n');
const EXAMPLE_ESTADIO = ['Tribuna: Grada baja, Grada alta', 'Preferencia: Grada baja, Grada alta', 'Fondo Norte: Grada baja, Grada alta', 'Fondo Sur: Grada baja, Grada alta'].join(
  '\n',
);
const EXAMPLE_FESTIVAL = ['Pista (de pie): Front Stage, General', 'VIP (de pie)', 'Zona PMR (de pie)'].join('\n');

/**
 * Si la compilación trae errores (en esta u otras notas), el servidor puede
 * mantener el catálogo anterior. Se espera como mucho esto a que el recinto
 * llegue por el stream antes de explicar por qué no aparece.
 */
const WAIT_FOR_CATALOG_MS = 2000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface PendingVenue {
  venueId: string;
  folder: string;
  report: VaultCompileReport;
}

function VenueQuickForm({ onClose }: { onClose: () => void }) {
  const s = useLive();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('');
  const [layoutText, setLayoutText] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdWithErrors, setCreatedWithErrors] = useState<{ folder: string; issues: VaultIssue[] } | null>(null);
  const [pending, setPending] = useState<PendingVenue | null>(null);
  const [notListed, setNotListed] = useState<{ folder: string; report: VaultCompileReport } | null>(null);

  const layout = useMemo(() => parseVenueLayout(layoutText), [layoutText]);
  const sectionCount = layout.zones.reduce((n, z) => n + z.sections.length, 0);
  const hasLayout = layoutText.trim() !== '';
  const canSubmit =
    !busy && pending === null && layout.errors.length === 0 && layout.zones.length > 0 && name.trim().length >= 3 && source.trim().length >= 3;

  // En cuanto el recinto nuevo llega al catálogo en vivo, se abre su ficha.
  useEffect(() => {
    if (!pending) return;
    const found = Object.values(s.venues).find((v) => v.venueId === pending.venueId && v.eventId === null && v.active);
    if (found) {
      setPending(null);
      void navigate(`/recintos/${found.hash}`);
    }
  }, [pending, s.venues, navigate]);

  // Si no llega, se explica por qué (normalmente, errores en otras notas del vault).
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      setPending(null);
      setNotListed({ folder: pending.folder, report: pending.report });
    }, WAIT_FOR_CATALOG_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);
    setCreatedWithErrors(null);
    setNotListed(null);
    const r = await run(
      async () => {
        try {
          return await Api.createVenue({ name: name.trim(), city: city.trim() || undefined, source: source.trim(), layout: layoutText });
        } catch (e) {
          setSubmitError(e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
      (res) => `Recinto creado: ${res.files} notas en ${res.folder}`,
    );
    if (!r) return;
    const errs = r.issues.filter((i) => i.severity === 'ERROR');
    if (errs.length > 0) {
      setCreatedWithErrors({ folder: r.folder, issues: errs });
      return;
    }
    if (r.venueId === null) {
      setNotListed({ folder: r.folder, report: r.report });
      return;
    }
    const venueId = r.venueId;
    const inStore = Object.values(live.getSnapshot().venues).find((v) => v.venueId === venueId && v.eventId === null && v.active);
    if (inStore) {
      void navigate(`/recintos/${inStore.hash}`);
      return;
    }
    // Compilación sin errores: el servidor ya ha cargado el catálogo antes de responder,
    // así que la ficha se puede abrir al instante aunque el stream aún no haya llegado.
    const compiled = r.report.ok ? r.report.venues.find((v) => v.venueId === venueId) : undefined;
    if (compiled) {
      void navigate(`/recintos/${compiled.hash}`);
      return;
    }
    setPending({ venueId, folder: r.folder, report: r.report });
  };

  const fillExample = (text: string) => {
    setLayoutText(text);
    setSubmitError(null);
  };

  return (
    <Card
      title="Nuevo recinto"
      actions={
        <button type="button" className="btn sm ghost" onClick={onClose} aria-label="Cerrar">
          <Icon name="x" size={14} />
        </button>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Callout icon="map">
          Se crea una carpeta en «10 Recintos» de tu vault con una nota por zona y por sección. Luego puedes retocarlas en Obsidian (alias de la web, aforo, visión). El Estadio
          Santiago Bernabéu ya está creado.
        </Callout>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="venue-name">Nombre del recinto</label>
            <input
              id="venue-name"
              className="input"
              value={name}
              maxLength={100}
              required
              onChange={(e) => setName(e.target.value)}
              placeholder="WiZink Center"
              autoFocus
            />
            {name !== '' && name.trim().length < 3 ? <span className="hint">Mínimo 3 caracteres.</span> : null}
          </div>
          <div className="field">
            <label htmlFor="venue-city">Ciudad (opcional)</label>
            <input id="venue-city" className="input" value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" />
          </div>
          <div className="field">
            <label htmlFor="venue-source">De dónde sale el plano</label>
            <input
              id="venue-source"
              className="input"
              value={source}
              maxLength={300}
              required
              onChange={(e) => setSource(e.target.value)}
              placeholder="Plano oficial del evento: https://…"
            />
            <span className="hint">Para saber de dónde salen los datos.</span>
          </div>
        </div>

        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div className="field">
            <label htmlFor="venue-layout">Zonas y secciones</label>
            <textarea
              id="venue-layout"
              className="input mono"
              rows={10}
              maxLength={20_000}
              value={layoutText}
              onChange={(e) => setLayoutText(e.target.value)}
              placeholder={EXAMPLE_PABELLON}
              spellCheck={false}
              style={{ width: '100%' }}
            />
            <span className="hint">
              Una zona por línea. Detrás de «:» sus secciones separadas por comas. «(de pie)» marca una zona de pie. Una zona sin secciones tiene una sola sección con su
              nombre.
            </span>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn ghost sm" onClick={() => fillExample(EXAMPLE_PABELLON)}>
                Ejemplo: pabellón
              </button>
              <button type="button" className="btn ghost sm" onClick={() => fillExample(EXAMPLE_ESTADIO)}>
                Ejemplo: estadio
              </button>
              <button type="button" className="btn ghost sm" onClick={() => fillExample(EXAMPLE_FESTIVAL)}>
                Ejemplo: festival
              </button>
            </div>
          </div>

          <div className="field">
            <span className="label">Vista previa · lo que se va a crear</span>
            {!hasLayout ? (
              <div className="small muted">Escribe las zonas (o pulsa un ejemplo) y aquí verás las zonas y secciones exactas que se crearán.</div>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <div className="row">
                  <b>
                    {plural(layout.zones.length, 'zona', 'zonas')} · {plural(sectionCount, 'sección', 'secciones')}
                  </b>
                </div>
                {layout.errors.length > 0 ? (
                  <Callout tone="critical">
                    <div className="stack" style={{ gap: 4 }}>
                      {layout.errors.map((err, i) => (
                        <div key={i}>{err}</div>
                      ))}
                    </div>
                  </Callout>
                ) : null}
                {layout.zones.map((z) => (
                  <div key={z.name} className="stack" style={{ gap: 6 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <b>{z.name}</b>
                      {z.standing ? <Pill icon="users">de pie</Pill> : null}
                      <span className="small muted">{plural(z.sections.length, 'sección', 'secciones')}</span>
                    </div>
                    <div className="chips">
                      {z.sections.map((sec) => (
                        <span key={sec.name} className="chip" style={{ paddingRight: 10 }}>
                          {sec.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {layout.zones.some((z) => z.sections.some((sec) => sec.name.startsWith(`${z.name} · `))) ? (
                  <div className="small muted">
                    Las secciones que se repiten en varias zonas llevan delante el nombre de la zona para no confundirlas.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {submitError ? <Callout tone="critical">No se ha creado el recinto: {submitError}</Callout> : null}

        {createdWithErrors ? (
          <Callout tone="critical">
            <div className="stack" style={{ gap: 6 }}>
              <div>
                Las notas se han creado en <span className="mono small">{createdWithErrors.folder}</span>, pero el vault encuentra errores en ellas. Corrígelos en Obsidian (al
                guardar se recompila solo):
              </div>
              {createdWithErrors.issues.map((i, n) => (
                <div key={n}>
                  <span className="mono small">{i.file}</span> — {i.message}
                </div>
              ))}
            </div>
          </Callout>
        ) : null}

        {notListed ? (
          <Callout tone="warning">
            <div className="stack" style={{ gap: 6 }}>
              <div>
                Las notas se han creado en <span className="mono small">{notListed.folder}</span>, pero el catálogo no se ha recargado porque el vault tiene errores en otras
                notas. Corrígelos en Obsidian y pulsa «Recompilar vault»; el recinto aparecerá en la lista.
              </div>
              {notListed.report.errors.slice(0, 5).map((i, n) => (
                <div key={n}>
                  <span className="mono small">{i.file}</span> — {i.message}
                </div>
              ))}
              {notListed.report.errors.length > 5 ? <div className="small">…y {notListed.report.errors.length - 5} errores más (abajo, en «Última compilación»).</div> : null}
            </div>
          </Callout>
        ) : null}

        <div className="row">
          <button type="submit" className="btn primary lg" disabled={!canSubmit}>
            <Icon name="check" size={16} /> {pending ? 'Cargando el recinto…' : busy ? 'Creando…' : 'Crear recinto'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function VenuesPage() {
  const s = useLive();
  const { run, busy } = useAction();
  const [params, setParams] = useSearchParams();
  const wantsNew = params.get('nuevo') === '1';
  const [formOpen, setFormOpen] = useState(wantsNew);
  const venues = useMemo(() => Object.values(s.venues), [s.venues]);
  const v = s.vault;

  useEffect(() => {
    if (wantsNew) setFormOpen(true);
  }, [wantsNew]);

  const openForm = () => {
    setFormOpen(true);
    window.scrollTo({ top: 0 });
  };
  const closeForm = () => {
    setFormOpen(false);
    if (wantsNew)
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete('nuevo');
          return next;
        },
        { replace: true },
      );
  };

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
          <button type="button" className="btn primary" onClick={openForm}>
            <Icon name="plus" size={14} /> Nuevo recinto
          </button>
        </div>
      </div>

      {formOpen ? <VenueQuickForm onClose={closeForm} /> : null}

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
          <Empty
            title="Sin recintos"
            action={
              formOpen ? null : (
                <button type="button" className="btn primary" onClick={openForm}>
                  <Icon name="plus" size={14} /> Nuevo recinto
                </button>
              )
            }
          >
            Pulsa «Nuevo recinto» o crea en Obsidian una carpeta en «10 Recintos» con la plantilla Recinto, sus zonas y sus secciones.
          </Empty>
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
      <Card title="Plano del recinto">
        <VenueMap artifact={a} />
      </Card>
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
