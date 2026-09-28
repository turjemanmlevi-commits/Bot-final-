import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CLAIM_STATE_LABEL,
  HUMAN_TASK_STATE_LABEL,
  LIMIT_SEMANTICS_LABEL,
  REJECTION_REASON_LABEL,
  STAGES,
  type AuditEvent,
  type OperationDetail,
  type RejectionReason,
  type StageName,
  type VenueArtifact,
} from '@to/shared';
import { Icon } from '../components/Icon';
import { OperationHero } from '../components/OperationHero';
import { CartsTable } from './Carts';
import { BarList, Callout, Card, CheckPill, Empty, Meter, Pill, QueuePill, SessionPill, type BarItem } from '../components/ui';
import { Api } from '../lib/api';
import { formatLatency, formatMoney, fmtDateTime, fmtTime, shortHash } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import { useLive } from '../lib/store';

type Tab = 'directo' | 'preparacion' | 'carritos' | 'historial' | 'replay';

const STAGE_LABEL: Record<StageName, string> = {
  normalization: 'Normalización',
  decision: 'Decisión',
  allocation: 'Asignación',
  journal_commit: 'Journal',
  'provider.inventory': 'Leer inventario',
  'provider.add_to_cart': 'Añadir al carrito',
  'provider.read_cart': 'Leer carrito',
  'provider.session': 'Sesión',
  'provider.queue': 'Cola (consulta)',
  network: 'Red / reloj',
  queue_wait: 'Espera en cola',
  human_task: 'Respuesta humana',
};

export function OperationDetailPage() {
  const { id = '' } = useParams();
  const s = useLive();
  const summary = s.operations[id];
  const detail = useAsync(() => Api.operation(id), [id, summary?.version]);
  const [tab, setTab] = useState<Tab>('directo');
  const artifactHash = detail.data?.armSnapshot?.venueArtifactHash ?? null;
  const artifact = useAsync(() => (artifactHash ? Api.venue(artifactHash) : Promise.resolve(null)), [artifactHash]);

  if (!summary) {
    return (
      <Empty title="Operación no encontrada" action={<Link to="/operaciones">Volver a operaciones</Link>}>
        Puede que se haya borrado del journal.
      </Empty>
    );
  }
  const d = detail.data;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link to="/operaciones">Operaciones</Link> / <code>{summary.id}</code>
          </div>
          <h1>{summary.name}</h1>
          <div className="sub">
            {summary.eventName} · proveedor <b>{summary.providerId}</b> · configuración v{summary.configVersion}
            {summary.armedSnapshotHash ? (
              <>
                {' '}
                · snapshot <code>{shortHash(summary.armedSnapshotHash, 12)}</code>
              </>
            ) : null}
          </div>
        </div>
        <div className="actions">
          {summary.state === 'DRAFT' || summary.state === 'VALIDATED' ? (
            <Link className="btn" to={`/operaciones/${summary.id}/editar`}>
              <Icon name="edit" size={14} /> Editar configuración
            </Link>
          ) : null}
        </div>
      </div>

      <OperationHero op={summary} compact onChanged={detail.reload} />

      <div className="tabs" role="tablist">
        {(
          [
            ['directo', 'En directo'],
            ['preparacion', 'Preparación'],
            ['carritos', 'Carritos'],
            ['historial', 'Historial'],
            ['replay', 'Replay'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {detail.error ? <Callout tone="critical">{detail.error}</Callout> : null}
      {tab === 'directo' ? <LiveTab id={id} detail={d} artifact={artifact.data} /> : null}
      {tab === 'preparacion' ? d ? <PrepTab detail={d} artifact={artifact.data} /> : <div className="muted">Cargando…</div> : null}
      {tab === 'carritos' ? <CartsTable operationId={id} /> : null}
      {tab === 'historial' ? d ? <HistoryTab id={id} detail={d} /> : <div className="muted">Cargando…</div> : null}
      {tab === 'replay' ? <ReplayTab id={id} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// En directo
// ---------------------------------------------------------------------------

function LiveTab({ id, detail, artifact }: { id: string; detail: OperationDetail | null; artifact: VenueArtifact | null }) {
  const s = useLive();
  const { run, busy } = useAction();
  const summary = s.operations[id];
  const alloc = s.allocations[id];
  const metrics = s.metrics[id] ?? detail?.metrics ?? null;
  const inventory = s.inventory[id] ?? detail?.inventory ?? null;
  const decisions = useMemo(() => {
    const liveList = s.decisions[id] ?? [];
    const seen = new Set(liveList.map((x) => x.id));
    return [...liveList, ...(detail?.decisions ?? []).filter((x) => !seen.has(x.id))].slice(0, 15);
  }, [s.decisions, id, detail?.decisions]);
  const claims = useMemo(
    () =>
      Object.values(s.claims)
        .filter((c) => c.operationId === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20),
    [s.claims, id],
  );
  const tasks = useMemo(() => Object.values(s.humanTasks).filter((t) => t.operationId === id && t.state === 'OPEN'), [s.humanTasks, id]);
  const sectionName = (sid: string | null) => (sid ? (artifact?.sections.find((x) => x.id === sid)?.name ?? sid) : '—');

  const rejectionItems: BarItem[] = inventory
    ? (Object.entries(inventory.rejectedByReason) as Array<[RejectionReason, number]>)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ key: k, label: REJECTION_REASON_LABEL[k], value: v, display: String(v) }))
    : [];

  const stageItems = (kind: 'internal' | 'external'): BarItem[] =>
    metrics
      ? (Object.entries(metrics.stages) as Array<[StageName, NonNullable<(typeof metrics.stages)[StageName]>]>)
          .filter(([name]) => STAGES[name] === kind)
          .sort((a, b) => b[1].p99 - a[1].p99)
          .map(([name, st]) => ({
            key: name,
            label: STAGE_LABEL[name],
            value: st.p99,
            display: `p99 ${formatLatency(st.p99)} · p50 ${formatLatency(st.p50)} · n=${st.count}`,
          }))
      : [];

  return (
    <div className="stack" style={{ gap: 16 }}>
      {tasks.length > 0 ? (
        <Callout tone="warning" icon="task">
          <b>
            {tasks.length} tarea{tasks.length === 1 ? '' : 's'} humana{tasks.length === 1 ? '' : 's'} en esta operación.
          </b>{' '}
          {tasks.map((t) => t.title).join(' · ')} — <Link to="/tareas">resolver</Link>
        </Callout>
      ) : null}

      <Card title="Cuentas" flush>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Grupo de límite</th>
                <th>Sesión</th>
                <th>Cola</th>
                <th style={{ width: '18%' }}>Cupo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(summary?.accountIds ?? []).map((aid) => {
                const a = s.accounts[aid];
                const cap = alloc?.perAccount[aid];
                if (!a) return null;
                return (
                  <tr key={aid}>
                    <td>
                      <b>{a.label}</b>
                      <div className="small muted mono">{aid}</div>
                    </td>
                    <td className="small">{cap?.groupKey ?? '—'}</td>
                    <td>
                      <SessionPill state={a.session.state} />
                    </td>
                    <td>
                      <QueuePill state={a.session.queue.state} position={a.session.queue.position} etaMs={a.session.queue.etaMs} />
                    </td>
                    <td>
                      {cap ? (
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <div style={{ flex: 1, minWidth: 60 }}>
                            <Meter thin legend={false} total={cap.cap} ariaLabel={`${cap.used} de ${cap.cap}`} segments={[{ value: cap.used, kind: 'fill', label: 'Usado' }]} />
                          </div>
                          <span className="mono small">
                            {cap.used}/{cap.cap}
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {a.session.state === 'CHALLENGE_REQUIRED' || a.session.state === 'LOGGED_OUT' || a.session.state === 'EXPIRED' || a.session.state === 'UNKNOWN' ? (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          {a.session.state !== 'CHALLENGE_REQUIRED' ? (
                            <button type="button" className="btn sm" disabled={busy} onClick={() => void run(() => Api.openSession(aid), 'Abriendo sesión…')}>
                              Abrir sesión
                            </button>
                          ) : null}
                          <button type="button" className="btn sm primary" disabled={busy} onClick={() => void run(() => Api.sessionReady(aid), 'Sesión marcada como lista')}>
                            <Icon name="check" size={13} /> Sesión lista
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid cols-2">
        <Card title="Inventario (último snapshot)">
          {inventory ? (
            <div className="stack">
              <div className="row small ink2" style={{ gap: 16 }}>
                <span>
                  Ofertas <b className="mono">{inventory.offers}</b>
                </span>
                <span>
                  Candidatos <b className="mono">{inventory.candidates}</b>
                </span>
                <span>
                  Elegibles <b className="mono">{inventory.eligible}</b>
                </span>
                <span className="muted">{fmtTime(inventory.observedAt)}</span>
              </div>
              <div className="sign" style={{ marginTop: 4 }}>
                Motivos de descarte
              </div>
              <BarList items={rejectionItems} ariaLabel="Candidatos descartados por motivo" emptyText="Ningún descarte." />
              {inventory.unresolvedLabels.length > 0 ? (
                <Callout tone="warning">
                  Etiquetas del proveedor que el vault no reconoce: {inventory.unresolvedLabels.map((l) => `«${l}»`).join(', ')}. Si alguna es una sección real, añádela a sus{' '}
                  <code>aliases</code> en Obsidian.
                </Callout>
              ) : null}
            </div>
          ) : (
            <div className="muted">Aparecerá cuando la operación empiece a leer inventario (en T0).</div>
          )}
        </Card>
        <Card title="Latencia por etapa">
          {metrics ? (
            <div className="stack">
              <div className="sign">Motor (interno)</div>
              <BarList items={stageItems('internal')} ariaLabel="Latencia interna por etapa" />
              <div className="sign" style={{ marginTop: 6 }}>
                Proveedor, colas y personas (externo)
              </div>
              <BarList items={stageItems('external')} ariaLabel="Latencia externa por etapa" />
              <div className="row small ink2" style={{ gap: 14 }}>
                <span>
                  Decisiones <b className="mono">{metrics.counters.decisions}</b>
                </span>
                <span>
                  Claims <b className="mono">{metrics.counters.claims}</b>
                </span>
                <span>
                  Confirmados <b className="mono">{metrics.counters.confirmed}</b>
                </span>
                <span>
                  Rechazados <b className="mono">{metrics.counters.rejected}</b>
                </span>
                <span>
                  Ambiguos <b className="mono">{metrics.counters.ambiguous}</b>
                </span>
                <span>
                  Reconciliados <b className="mono">{metrics.counters.reconciled}</b>
                </span>
                <span>
                  Lecturas <b className="mono">{metrics.counters.inventoryPolls}</b>
                </span>
              </div>
            </div>
          ) : (
            <div className="muted">Sin métricas todavía.</div>
          )}
        </Card>
      </div>

      <Card title="Decisiones del motor" flush>
        {decisions.length === 0 ? (
          <div className="card-body muted">Cada decisión se registra con su snapshot y se puede reproducir (pestaña Replay).</div>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Cuenta</th>
                  <th>Resultado</th>
                  <th>Elegido</th>
                  <th title="Cobertura · rango · agrupación · precio · ambigüedad">Clave de ranking</th>
                  <th className="num">Latencia</th>
                  <th>Descartes principales</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((dec) => {
                  const top = (Object.entries(dec.rejectedByReason) as Array<[RejectionReason, number]>).sort((a, b) => b[1] - a[1]).slice(0, 2);
                  return (
                    <tr key={dec.id}>
                      <td className="mono">{fmtTime(dec.at)}</td>
                      <td>{s.accounts[dec.accountId]?.label ?? dec.accountId}</td>
                      <td>
                        <Pill tone={dec.outcome === 'CLAIMED' ? 'good' : 'neutral'} icon={dec.outcome === 'CLAIMED' ? 'check' : null}>
                          {dec.outcome === 'CLAIMED' ? 'Reclamado' : dec.outcome === 'NO_CANDIDATE' ? 'Sin candidato' : 'Snapshot viejo'}
                        </Pill>
                      </td>
                      <td>
                        {dec.chosen ? (
                          <>
                            {dec.chosen.qty}× {sectionName(dec.chosen.sectionId)} · {formatMoney(dec.chosen.unitPrice, summary?.currency ?? 'EUR')}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="mono small">
                        {dec.chosen ? `${dec.chosen.rank.coverageDeficit}·${dec.chosen.rank.targetRank}·${dec.chosen.rank.groupingPenalty}·${dec.chosen.rank.unitPrice}·${dec.chosen.rank.ambiguity}` : '—'}
                      </td>
                      <td className="num">{dec.latencyUs} µs</td>
                      <td className="small">{top.map(([k, v]) => `${REJECTION_REASON_LABEL[k]} (${v})`).join(', ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Claims" flush>
        {claims.length === 0 ? (
          <div className="card-body muted">Un claim es una reserva de capacidad enviada al proveedor (o a una persona en modo manual).</div>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Cuenta</th>
                  <th>Sección</th>
                  <th className="num">Cant.</th>
                  <th className="num">Precio</th>
                  <th>Estado</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{fmtTime(c.createdAt)}</td>
                    <td>{s.accounts[c.accountId]?.label ?? c.accountId}</td>
                    <td>
                      {c.sectionLabel}
                      {c.row ? <span className="muted"> · fila {c.row}</span> : null}
                    </td>
                    <td className="num">{c.qty}</td>
                    <td className="num">{formatMoney(c.unitPrice, summary?.currency ?? 'EUR')}</td>
                    <td>
                      <Pill
                        tone={c.state === 'CONFIRMED' ? 'good' : c.state === 'AMBIGUOUS' ? 'warning' : c.state === 'REJECTED' ? 'serious' : 'neutral'}
                        icon={c.state === 'SENT' || c.state === 'PENDING' ? 'refresh' : undefined}
                      >
                        {CLAIM_STATE_LABEL[c.state]}
                      </Pill>
                    </td>
                    <td className="small muted">
                      {[c.resolution === 'RECONCILIATION' ? 'reconciliado' : c.resolution === 'HUMAN' ? 'por una persona' : null, c.reason].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------

function PrepTab({ detail, artifact }: { detail: OperationDetail; artifact: VenueArtifact | null }) {
  const s = useLive();
  const c = detail.config;
  const p = c.preferences;
  const snap = detail.armSnapshot;
  const policy = snap?.compiledPolicy ?? detail.validation?.compiledPolicy ?? null;
  const name = (sid: string) => artifact?.sections.find((x) => x.id === sid)?.name ?? sid.split('.').pop() ?? sid;
  return (
    <div className="grid cols-2">
      <Card title="Validación">
        {detail.validation ? (
          <div className="stack">
            <div className="row">
              <Pill tone={detail.validation.ok ? 'good' : 'critical'}>{detail.validation.ok ? 'Sin errores' : 'Con errores'}</Pill>
              <span className="small muted">
                v{detail.validation.configVersion} · {fmtDateTime(detail.validation.at)}
              </span>
              {detail.validation.effectiveCapacity !== null ? (
                <span className="small ink2">
                  Capacidad legal: <b>{detail.validation.effectiveCapacity}</b> entradas
                </span>
              ) : null}
            </div>
            {detail.validation.issues.length === 0 ? (
              <div className="muted small">Todo correcto.</div>
            ) : (
              detail.validation.issues.map((i, idx) => (
                <Callout key={`${i.code}-${idx}`} tone={i.severity === 'ERROR' ? 'critical' : 'warning'}>
                  {i.message} <span className="muted mono small">{i.code}</span>
                </Callout>
              ))
            )}
          </div>
        ) : (
          <div className="muted">Pulsa «Validar» para comprobar la configuración contra el vault, las cuentas y los límites.</div>
        )}
      </Card>

      <Card title="Readiness">
        {detail.readiness.length === 0 ? (
          <div className="muted">Se evalúa al armar y automáticamente en T−12 h, T−1 h y T−5 min.</div>
        ) : (
          <div className="stack">
            {[...detail.readiness]
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 1)
              .map((r) => (
                <div key={r.phase} className="stack" style={{ gap: 8 }}>
                  <div className="row">
                    <CheckPill status={r.overall} />
                    <span className="small muted">
                      {r.phase} · {fmtDateTime(r.at)}
                    </span>
                  </div>
                  <table className="t">
                    <tbody>
                      {r.checks.map((ch) => (
                        <tr key={ch.id}>
                          <td style={{ width: 90 }}>
                            <CheckPill status={ch.status} />
                          </td>
                          <td>
                            <b>{ch.label}</b>
                            <div className="small ink2">{ch.detail}</div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {ch.action === 'OPEN_SESSION' && ch.accountId ? (
                              <Link className="btn sm" to={`/cuentas#${ch.accountId}`}>
                                Abrir sesión
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        )}
      </Card>

      <Card title="Política compilada (preferencias → secciones)">
        {policy ? (
          <div className="stack">
            <table className="t">
              <thead>
                <tr>
                  <th className="num">Rango</th>
                  <th>Escrito</th>
                  <th>Resuelto a</th>
                </tr>
              </thead>
              <tbody>
                {policy.resolution.map((r) => (
                  <tr key={`${r.rank}-${r.input}`}>
                    <td className="num">{r.rank}</td>
                    <td>
                      <b>{r.input}</b>
                      <div className="small muted">{r.resolvedTo === 'ZONE' ? 'zona' : 'sección'}</div>
                    </td>
                    <td className="small">{r.ids.map(name).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="small ink2">
              Permitidas: <b>{Object.keys(policy.sectionRank).length}</b> secciones · excluidas: {policy.excludedSectionIds.map(name).join(', ') || 'ninguna'}
            </div>
          </div>
        ) : (
          <div className="muted">Se calcula al validar.</div>
        )}
      </Card>

      <Card title="Configuración">
        <dl className="kv">
          <dt>Cantidad</dt>
          <dd>
            {c.requestedQty} entradas · grupos de al menos {p.minGroupSize}
          </dd>
          <dt>Precio máximo</dt>
          <dd>{formatMoney(c.maxUnitPrice, c.currency)} por entrada (con gastos)</dd>
          <dt>Presupuesto</dt>
          <dd>{formatMoney(c.budget, c.currency)}</dd>
          <dt>T0 y ventana</dt>
          <dd>
            {new Date(c.t0).toLocaleString('es-ES')} · {c.runWindowMinutes} min · congelado {c.freezeLeadSeconds} s antes
          </dd>
          <dt>Asientos</dt>
          <dd>
            {p.requireContiguous ? 'juntos' : 'separados permitidos'} · de pie {p.allowStanding ? 'sí' : 'no'} · visión reducida {p.allowObstructed ? 'sí' : 'no'} · plazas accesibles{' '}
            {p.allowAccessible ? 'sí' : 'no (reservadas)'}
          </dd>
          <dt>Ambigüedad máx.</dt>
          <dd>{p.maxAmbiguity}</dd>
          <dt>Cuentas</dt>
          <dd>{c.accountIds.map((a) => s.accounts[a]?.label ?? a).join(', ')}</dd>
          <dt>Avisos de caducidad</dt>
          <dd>{c.cartExpiryAlertsSeconds.map((x) => `${x} s`).join(' · ')}</dd>
          {c.simulation ? (
            <>
              <dt>Simulación</dt>
              <dd>
                escenario <b>{c.simulation.scenarioId}</b> · semilla {c.simulation.seed}
              </dd>
            </>
          ) : null}
        </dl>
      </Card>

      <Card title="Snapshot de armado" className="span-2">
        {snap ? (
          <div className="grid cols-2">
            <dl className="kv">
              <dt>Hash</dt>
              <dd className="mono">{snap.hash}</dd>
              <dt>Armada</dt>
              <dd>
                {fmtDateTime(snap.armedAt)} por <b>{snap.armedBy}</b>
              </dd>
              <dt>Recinto</dt>
              <dd>
                <Link to={`/recintos/${snap.venueArtifactHash}`} className="mono">
                  {shortHash(snap.venueArtifactHash, 16)}
                </Link>
              </dd>
              <dt>Versiones</dt>
              <dd className="mono small">
                {snap.versions.rules} · {snap.versions.selectionPolicy} · {snap.versions.venue} · {snap.versions.adapter}
              </dd>
              <dt>Límites</dt>
              <dd>
                {snap.eventLimits.perAccount}/cuenta · {snap.eventLimits.perGroup}/grupo · {snap.eventLimits.perOperation}/operación · {LIMIT_SEMANTICS_LABEL[snap.eventLimits.semantics]}
              </dd>
            </dl>
            <table className="t">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Ejecuta</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {snap.adapter.capabilities.map((cap) => (
                  <tr key={cap.name}>
                    <td className="mono">{cap.name}</td>
                    <td>
                      <Pill tone={cap.executor === 'AUTOMATED' ? 'good' : cap.executor === 'HUMAN' ? 'warning' : 'neutral'} icon={cap.executor === 'HUMAN' ? 'user' : undefined}>
                        {cap.executor === 'AUTOMATED' ? 'Automático' : cap.executor === 'HUMAN' ? 'Persona' : 'No'}
                      </Pill>
                    </td>
                    <td className="small muted">{cap.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">Al armar se congela todo lo necesario para reproducir cada decisión: configuración, política, recinto (hash), límites y capabilities.</div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historial y replay
// ---------------------------------------------------------------------------

function describe(e: AuditEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'operation.state_changed':
      return `Estado ${String(p.from)} → ${String(p.to)}${p.reason ? ` (${String(p.reason)})` : ''}`;
    case 'operation.command':
      return `Comando «${String(p.command)}»${p.value !== null && p.value !== undefined ? ` = ${String(p.value)}` : ''}`;
    case 'claim.reserved':
      return `Reserva ${String(p.qty)} × ${String(p.offerRef)}`;
    case 'claim.confirmed':
      return `Confirmado ${String(p.qty)} entradas (${String(p.level)}${p.resolution === 'RECONCILIATION' ? ', reconciliado' : ''})`;
    case 'claim.rejected':
      return `Rechazado: ${String(p.reason)}`;
    case 'claim.ambiguous':
      return `Resultado ambiguo: ${String(p.reason)}`;
    case 'alert.raised':
      return `Alerta: ${String(p.title)}`;
    case 'readiness.evaluated':
      return `Readiness ${String(p.phase)}: ${String(p.overall)}`;
    case 'human_task.created':
      return `Tarea humana creada (${String(p.kind)})`;
    case 'human_task.responded':
      return `Tarea respondida: ${String(p.result)}`;
    case 'cart.paid_by_human':
      return 'Carrito marcado como pagado por una persona';
    default:
      return e.type;
  }
}

function HistoryTab({ id, detail }: { id: string; detail: OperationDetail }) {
  const s = useLive();
  const events = useMemo(() => {
    const liveEv = s.audit.filter((e) => e.operationId === id);
    const seen = new Set(liveEv.map((e) => e.seq));
    return [...liveEv, ...detail.timeline.filter((e) => !seen.has(e.seq))].sort((a, b) => b.seq - a.seq).slice(0, 250);
  }, [s.audit, detail.timeline, id]);
  return (
    <div className="grid cols-2">
      <Card title="Línea de tiempo" flush className="span-2">
        <ul className="timeline">
          {events.map((e) => (
            <li key={e.seq}>
              <span className="ts">{fmtTime(e.at)}</span>
              <span>
                {describe(e)} <span className="muted small">· {e.actor}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Versiones de configuración" flush>
        <ul className="timeline">
          {[...detail.versions].reverse().map((v) => (
            <li key={v.version}>
              <span className="ts">v{v.version}</span>
              <span>
                {fmtDateTime(v.at)} · {v.actor}
                {v.note ? ` · ${v.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Enmiendas en caliente" flush>
        {detail.amendments.length === 0 ? (
          <div className="card-body muted">Solo se permiten cambios conservadores: reducir cantidad o bajar precio máximo.</div>
        ) : (
          <ul className="timeline">
            {detail.amendments.map((a, i) => (
              <li key={i}>
                <span className="ts">{fmtTime(a.at)}</span>
                <span>
                  {a.kind === 'reduce-qty' ? `Cantidad ${a.from} → ${a.to}` : `Precio máx. ${formatMoney(a.from, detail.config.currency)} → ${formatMoney(a.to, detail.config.currency)}`} · {a.actor}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Tareas humanas" flush className="span-2">
        {detail.humanTasks.length === 0 ? (
          <div className="card-body muted">Sin tareas.</div>
        ) : (
          <table className="t">
            <tbody>
              {detail.humanTasks.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{fmtTime(t.createdAt)}</td>
                  <td>{t.title}</td>
                  <td>{s.accounts[t.accountId]?.label ?? t.accountId}</td>
                  <td>
                    <Pill tone={t.state === 'DONE' ? 'good' : t.state === 'OPEN' ? 'warning' : t.state === 'FAILED' || t.state === 'EXPIRED' ? 'serious' : 'neutral'}>
                      {HUMAN_TASK_STATE_LABEL[t.state]}
                    </Pill>
                  </td>
                  <td className="small muted">{t.response ? `${t.response.result} · ${t.response.actor}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ReplayTab({ id }: { id: string }) {
  const { run, busy } = useAction();
  const [report, setReport] = useState<Awaited<ReturnType<typeof Api.replay>> | null>(null);
  return (
    <Card
      title="Replay determinista"
      actions={
        <button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => Api.replay(id)).then((r) => r && setReport(r))}>
          <Icon name="replay" size={15} /> Reproducir ahora
        </button>
      }
    >
      <div className="stack">
        <div className="ink2">
          Vuelve a ejecutar cada decisión con el snapshot de inventario, la política congelada, la capacidad y el overlay que se registraron, y cada paso de asignación desde el
          estado inicial. Si todo coincide, la operación es explicable y auditable al 100 %.
        </div>
        {report ? (
          <>
            <Callout tone={report.ok ? 'good' : 'critical'}>
              {report.ok ? 'Idéntico: ' : 'Diferencias: '}
              {report.decisionsMatched}/{report.decisionsChecked} decisiones · {report.allocationStepsMatched}/{report.allocationStepsChecked} pasos de asignación · snapshots que faltan{' '}
              {report.missingSnapshots}
            </Callout>
            {report.mismatches.slice(0, 10).map((m, i) => (
              <pre key={i} className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: 10, background: 'var(--surface-2)', borderRadius: 6 }}>
                {m.kind} {m.ref}
                {'\n'}esperado: {JSON.stringify(m.expected)}
                {'\n'}obtenido: {JSON.stringify(m.actual)}
              </pre>
            ))}
          </>
        ) : null}
      </div>
    </Card>
  );
}
