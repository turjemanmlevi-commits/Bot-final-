import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { LIMIT_SEMANTICS_LABEL, type OperationConfig } from '@to/shared';
import { Icon } from '../components/Icon';
import { Callout, Card, Pill } from '../components/ui';
import { Api } from '../lib/api';
import { euros, formatMoney, fromLocalInput, parseEuros, toLocalInput } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import { useLive } from '../lib/store';

interface FormState {
  name: string;
  eventId: string;
  t0: string;
  runWindowMinutes: string;
  freezeLeadSeconds: string;
  requestedQty: string;
  maxUnitPrice: string;
  budget: string;
  targets: string[];
  excludeSections: string[];
  requireContiguous: boolean;
  minGroupSize: string;
  allowStanding: boolean;
  allowObstructed: boolean;
  allowAccessible: boolean;
  maxAmbiguity: string;
  accountIds: string[];
  cartExpiryAlertsSeconds: string;
  scenarioId: string;
  seed: string;
}

function defaults(): FormState {
  return {
    name: '',
    eventId: '',
    t0: toLocalInput(new Date(Date.now() + 10 * 60_000).toISOString()),
    runWindowMinutes: '15',
    freezeLeadSeconds: '30',
    requestedQty: '4',
    maxUnitPrice: '100',
    budget: '400',
    targets: [],
    excludeSections: [],
    requireContiguous: true,
    minGroupSize: '2',
    allowStanding: true,
    allowObstructed: false,
    allowAccessible: false,
    maxAmbiguity: '0.3',
    accountIds: [],
    cartExpiryAlertsSeconds: '300, 120, 60',
    scenarioId: 'demo',
    seed: String(Math.floor(Math.random() * 100_000)),
  };
}

function fromConfig(c: OperationConfig): FormState {
  return {
    name: c.name,
    eventId: c.eventId,
    t0: toLocalInput(c.t0),
    runWindowMinutes: String(c.runWindowMinutes),
    freezeLeadSeconds: String(c.freezeLeadSeconds),
    requestedQty: String(c.requestedQty),
    maxUnitPrice: euros(c.maxUnitPrice),
    budget: euros(c.budget),
    targets: c.preferences.targets,
    excludeSections: c.preferences.excludeSections,
    requireContiguous: c.preferences.requireContiguous,
    minGroupSize: String(c.preferences.minGroupSize),
    allowStanding: c.preferences.allowStanding,
    allowObstructed: c.preferences.allowObstructed,
    allowAccessible: c.preferences.allowAccessible,
    maxAmbiguity: String(c.preferences.maxAmbiguity),
    accountIds: c.accountIds,
    cartExpiryAlertsSeconds: c.cartExpiryAlertsSeconds.join(', '),
    scenarioId: c.simulation?.scenarioId ?? 'demo',
    seed: String(c.simulation?.seed ?? 1),
  };
}

export function OperationFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const s = useLive();
  const { run, busy } = useAction();
  const [f, setF] = useState<FormState>(defaults);
  const existing = useAsync(() => (id ? Api.operation(id) : Promise.resolve(null)), [id]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (existing.data) setF(fromConfig(existing.data.config));
  }, [existing.data]);

  const events = useMemo(() => Object.values(s.events).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [s.events]);
  const event = s.events[f.eventId];

  // Evento por defecto: el de la URL o el primero verificado.
  useEffect(() => {
    if (id || f.eventId) return;
    const wanted = params.get('evento');
    const ev = (wanted ? s.events[wanted] : undefined) ?? events.find((e) => e.limits.verified) ?? events[0];
    if (ev) {
      const manual = s.system?.providers.find((p) => p.id === ev.providerId)?.mode === 'MANUAL_ASSIST';
      setF((x) => ({
        ...x,
        eventId: ev.id,
        name: x.name || ev.name,
        t0: ev.onSaleAt && Date.parse(ev.onSaleAt) > Date.now() ? toLocalInput(ev.onSaleAt) : x.t0,
        requestedQty: String(Math.min(Number(x.requestedQty), ev.limits.perOperation || Number(x.requestedQty))),
        // Las colas de las webs reales son largas: la ventana por defecto se amplía.
        runWindowMinutes: manual && x.runWindowMinutes === '15' ? '60' : x.runWindowMinutes,
      }));
    }
  }, [id, f.eventId, params, s.events, s.system, events]);

  const provider = event ? s.system?.providers.find((p) => p.id === event.providerId) : undefined;
  const artifactSummary = event
    ? (Object.values(s.venues).find((v) => v.active && v.venueId === event.venueId && v.eventId === event.id) ??
      Object.values(s.venues).find((v) => v.active && v.venueId === event.venueId && v.eventId === null))
    : undefined;
  const artifact = useAsync(() => (artifactSummary ? Api.venue(artifactSummary.hash) : Promise.resolve(null)), [artifactSummary?.hash]);
  const suggestions = useMemo(() => {
    const a = artifact.data;
    if (!a) return [];
    return [
      ...a.zones.map((z) => ({ label: z.name, kind: 'zona' })),
      ...a.sections.filter((x) => !x.closed).map((x) => ({ label: x.name, kind: 'sección' })),
    ];
  }, [artifact.data]);
  const accounts = useMemo(() => Object.values(s.accounts).filter((a) => !event || a.providerId === event.providerId), [s.accounts, event]);
  const providerName = event ? (provider?.name ?? s.providerAuthorizations.find((p) => p.providerId === event.providerId)?.name ?? event.providerId) : null;

  // Cambio de evento (solo al crear): los objetivos y las cuentas del evento anterior ya no valen.
  const changeEvent = (eventId: string) =>
    setF((x) => {
      const prev = s.events[x.eventId];
      const next = s.events[eventId];
      const nextMode = next ? s.system?.providers.find((p) => p.id === next.providerId)?.mode : undefined;
      const nameFollowsEvent = !x.name.trim() || (prev !== undefined && x.name === prev.name);
      const qty = Number(x.requestedQty);
      return {
        ...x,
        eventId,
        targets: [],
        accountIds: next ? x.accountIds.filter((aid) => s.accounts[aid]?.providerId === next.providerId) : [],
        name: nameFollowsEvent ? (next?.name ?? '') : x.name,
        t0: next?.onSaleAt && Date.parse(next.onSaleAt) > Date.now() ? toLocalInput(next.onSaleAt) : x.t0,
        requestedQty: next && Number.isFinite(qty) && qty > 0 && next.limits.perOperation > 0 ? String(Math.min(qty, next.limits.perOperation)) : x.requestedQty,
        runWindowMinutes: nextMode === 'MANUAL_ASSIST' && x.runWindowMinutes === '15' ? '60' : x.runWindowMinutes,
      };
    });

  const toggleAccount = (aid: string) =>
    setF((x) => ({ ...x, accountIds: x.accountIds.includes(aid) ? x.accountIds.filter((y) => y !== aid) : x.accountIds.length >= 10 ? x.accountIds : [...x.accountIds, aid] }));
  const moveTarget = (i: number, dir: -1 | 1) =>
    setF((x) => {
      const t = [...x.targets];
      const j = i + dir;
      if (j < 0 || j >= t.length) return x;
      [t[i], t[j]] = [t[j] as string, t[i] as string];
      return { ...x, targets: t };
    });

  const build = (): OperationConfig | null => {
    if (!event) return null;
    const maxUnitPrice = parseEuros(f.maxUnitPrice);
    const budget = parseEuros(f.budget);
    if (maxUnitPrice === null || budget === null) return null;
    const isSim = provider?.mode === 'SIMULATED';
    return {
      name: f.name.trim() || event.name,
      eventId: event.id,
      providerId: event.providerId,
      t0: fromLocalInput(f.t0),
      runWindowMinutes: Math.trunc(Number(f.runWindowMinutes)),
      freezeLeadSeconds: Math.trunc(Number(f.freezeLeadSeconds)),
      requestedQty: Math.trunc(Number(f.requestedQty)),
      currency: event.currency,
      maxUnitPrice,
      budget,
      preferences: {
        targets: f.targets,
        excludeSections: f.excludeSections,
        requireContiguous: f.requireContiguous,
        minGroupSize: Math.trunc(Number(f.minGroupSize)),
        allowStanding: f.allowStanding,
        allowObstructed: f.allowObstructed,
        allowAccessible: f.allowAccessible,
        maxAmbiguity: Number(f.maxAmbiguity),
      },
      accountIds: f.accountIds,
      cartExpiryAlertsSeconds: f.cartExpiryAlertsSeconds
        .split(/[,\s]+/)
        .map((x) => Math.trunc(Number(x)))
        .filter((x) => Number.isFinite(x) && x > 0),
      ...(isSim ? { simulation: { scenarioId: f.scenarioId, seed: Math.trunc(Number(f.seed)) || 1 } } : {}),
    };
  };

  const submit = async () => {
    const config = build();
    if (!config) return;
    const saved = await run(() => (id ? Api.updateConfig(id, config) : Api.createOperation(config)), id ? 'Nueva versión guardada' : 'Operación creada');
    if (!saved) return;
    const opId = saved.summary.id;
    await run(() => Api.command(opId, { command: 'validate' }), (r) => (r.ok ? 'Configuración válida: ya puedes armarla' : 'Guardada, pero la validación tiene errores'));
    navigate(`/operaciones/${opId}`);
  };

  const ready = Boolean(event) && f.accountIds.length > 0;
  const qty = Number(f.requestedQty);
  const maxPrice = parseEuros(f.maxUnitPrice) ?? 0;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link to="/operaciones">Operaciones</Link> / {id ? 'editar' : 'nueva'}
          </div>
          <h1>{id ? 'Editar operación' : 'Nueva operación'}</h1>
          <div className="sub">Se guarda como borrador y se valida contra el vault, las cuentas y los límites. Nada se ejecuta hasta que la armes.</div>
        </div>
      </div>

      <Card flush>
        <div className="form-section">
          <h3 className="sign">1 · Evento</h3>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="op-event">Evento (del vault)</label>
              <select id="op-event" className="input" value={f.eventId} onChange={(e) => changeEvent(e.target.value)} disabled={Boolean(id)}>
                <option value="">Elige un evento…</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="op-name">Nombre de la operación</label>
              <input id="op-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} />
            </div>
          </div>
          {event ? (
            <div className="row" style={{ marginTop: 12 }}>
              <Pill tone={event.limits.verified && event.limits.semantics !== 'UNKNOWN' ? 'good' : 'critical'}>
                {event.limits.verified && event.limits.semantics !== 'UNKNOWN' ? 'Límites verificados' : 'Límites sin verificar: no se podrá armar'}
              </Pill>
              <span className="small ink2">
                {event.limits.perAccount}/cuenta · {event.limits.perGroup}/grupo · {event.limits.perOperation}/operación · {LIMIT_SEMANTICS_LABEL[event.limits.semantics]} ·
                proveedor <b>{provider?.name ?? event.providerId}</b> ({provider?.mode === 'SIMULATED' ? 'simulado' : provider?.mode === 'MANUAL_ASSIST' ? 'asistencia manual' : 'API'})
              </span>
            </div>
          ) : null}
          {event && provider?.mode === 'MANUAL_ASSIST' ? (
            <div style={{ marginTop: 12 }}>
              <Callout icon="info">
                <b>Asistencia manual en {providerName}:</b> al armar, cada cuenta recibe la tarea de iniciar sesión en la web oficial. En T0 cada persona recibe aquí y en
                Telegram qué zona intentar, cuántas entradas y el precio máximo, con el enlace oficial. Nadie paga desde aquí: se paga en la web oficial.
              </Callout>
            </div>
          ) : null}
        </div>

        <div className="form-section">
          <h3 className="sign">2 · Cuándo</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="op-t0">T0 (apertura de venta, hora local)</label>
              <input id="op-t0" className="input" type="datetime-local" step={1} value={f.t0} onChange={(e) => set('t0', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="op-win">Ventana (minutos)</label>
              <input id="op-win" className="input" type="number" min={1} value={f.runWindowMinutes} onChange={(e) => set('runWindowMinutes', e.target.value)} />
              <span className="hint">Cuánto tiempo sigue activa la operación tras T0 (cuenta la cola virtual).</span>
            </div>
            <div className="field">
              <label htmlFor="op-freeze">Congelar antes de T0 (s)</label>
              <input id="op-freeze" className="input" type="number" min={0} value={f.freezeLeadSeconds} onChange={(e) => set('freezeLeadSeconds', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="sign">3 · Cuánto y a qué precio</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="op-qty">Entradas</label>
              <input id="op-qty" className="input" type="number" min={1} value={f.requestedQty} onChange={(e) => set('requestedQty', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="op-max">Máximo por entrada ({event?.currency ?? 'EUR'}, con gastos)</label>
              <input id="op-max" className="input" type="number" step="0.01" value={f.maxUnitPrice} onChange={(e) => set('maxUnitPrice', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="op-budget">Presupuesto total</label>
              <input id="op-budget" className="input" type="number" step="0.01" value={f.budget} onChange={(e) => set('budget', e.target.value)} />
              <span className="hint">A precio máximo: {Number.isFinite(qty) ? formatMoney(qty * maxPrice, event?.currency ?? 'EUR') : '—'}</span>
            </div>
            <div className="field">
              <label htmlFor="op-min">Grupo mínimo por carrito</label>
              <input id="op-min" className="input" type="number" min={1} value={f.minGroupSize} onChange={(e) => set('minGroupSize', e.target.value)} />
              <span className="hint">Evita entradas sueltas.</span>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="sign">4 · Dónde (en orden de preferencia)</h3>
          <div className="stack">
            <div className="chips" aria-label="Objetivos en orden">
              {f.targets.length === 0 ? <span className="small muted">Sin objetivos = cualquier sección permitida del recinto.</span> : null}
              {f.targets.map((t, i) => (
                <span key={`${t}-${i}`} className="chip">
                  <span className="rank">{i + 1}</span> {t}
                  <button type="button" aria-label={`Subir ${t}`} onClick={() => moveTarget(i, -1)}>
                    <Icon name="up" size={13} />
                  </button>
                  <button type="button" aria-label={`Bajar ${t}`} onClick={() => moveTarget(i, 1)}>
                    <Icon name="down" size={13} />
                  </button>
                  <button type="button" aria-label={`Quitar ${t}`} onClick={() => set('targets', f.targets.filter((_, j) => j !== i))}>
                    <Icon name="x" size={13} />
                  </button>
                </span>
              ))}
            </div>
            {suggestions.length > 0 ? (
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">Añadir desde el vault ({artifact.data?.name}):</span>
                <div className="chips">
                  {suggestions
                    .filter((x) => !f.targets.includes(x.label))
                    .map((x) => (
                      <button key={`${x.kind}-${x.label}`} type="button" className="chip suggest" onClick={() => set('targets', [...f.targets, x.label])}>
                        + {x.label} <span className="small muted">{x.kind}</span>
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
            <div className="form-grid">
              <div className="field">
                <label htmlFor="op-excl">Excluir secciones (separadas por comas)</label>
                <input
                  id="op-excl"
                  className="input"
                  value={f.excludeSections.join(', ')}
                  onChange={(e) => set('excludeSections', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
                />
              </div>
              <div className="field">
                <label htmlFor="op-amb">Ambigüedad máxima (0–1)</label>
                <input id="op-amb" className="input" type="number" step="0.05" min={0} max={1} value={f.maxAmbiguity} onChange={(e) => set('maxAmbiguity', e.target.value)} />
                <span className="hint">0 = solo etiquetas que coinciden exactamente con el vault.</span>
              </div>
            </div>
            <div className="row" style={{ gap: 18 }}>
              <label className="check">
                <input type="checkbox" checked={f.requireContiguous} onChange={(e) => set('requireContiguous', e.target.checked)} />
                <span>Asientos juntos</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={f.allowStanding} onChange={(e) => set('allowStanding', e.target.checked)} />
                <span>Admitir de pie</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={f.allowObstructed} onChange={(e) => set('allowObstructed', e.target.checked)} />
                <span>Admitir visión reducida</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={f.allowAccessible} onChange={(e) => set('allowAccessible', e.target.checked)} />
                <span>Usar plazas accesibles (solo si alguien del grupo las necesita)</span>
              </label>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="sign">5 · Con qué cuentas (máx. 10)</h3>
          {accounts.length === 0 ? (
            <Callout tone="warning">
              {event ? `No hay cuentas de ${providerName ?? event.providerId}. ` : 'Todavía no hay cuentas. '}
              <Link to="/cuentas">Crea una cuenta</Link> por persona
              {provider?.mode === 'SIMULATED' ? ' o usa «Nueva demo» en el resumen para ensayar.' : '.'}
            </Callout>
          ) : (
            <div className="form-grid">
              {accounts.map((a) => (
                <label key={a.id} className="check" style={{ opacity: a.enabled ? 1 : 0.5 }}>
                  <input type="checkbox" checked={f.accountIds.includes(a.id)} onChange={() => toggleAccount(a.id)} disabled={!a.enabled} />
                  <span>
                    <b>{a.label}</b>
                    <br />
                    <span className="small muted">
                      titular {a.holderRef}
                      {a.leasedBy && a.leasedBy !== id ? ' · en otra operación' : ''}
                      {a.verification !== 'VERIFIED' ? ' · sin verificar' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="form-section">
          <h3 className="sign">6 · Avisos{provider?.mode === 'SIMULATED' ? ' y simulación' : ''}</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="op-alerts">Avisar antes de que caduque un carrito (s)</label>
              <input id="op-alerts" className="input" value={f.cartExpiryAlertsSeconds} onChange={(e) => set('cartExpiryAlertsSeconds', e.target.value)} />
            </div>
            {provider?.mode === 'SIMULATED' ? (
              <>
                <div className="field">
                  <label htmlFor="op-scn">Escenario del simulador</label>
                  <select id="op-scn" className="input" value={f.scenarioId} onChange={(e) => set('scenarioId', e.target.value)}>
                    {s.scenarios.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <span className="hint">{s.scenarios.find((x) => x.id === f.scenarioId)?.description}</span>
                </div>
                <div className="field">
                  <label htmlFor="op-seed">Semilla</label>
                  <input id="op-seed" className="input mono" value={f.seed} onChange={(e) => set('seed', e.target.value)} />
                  <span className="hint">Misma semilla = misma simulación.</span>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="form-section row">
          <button type="button" className="btn primary lg" disabled={busy || !ready} onClick={() => void submit()}>
            <Icon name="check" size={16} /> {id ? 'Guardar y validar' : 'Crear y validar'}
          </button>
          <Link className="btn lg" to={id ? `/operaciones/${id}` : '/operaciones'}>
            Cancelar
          </Link>
          {!ready ? <span className="small muted">Elige un evento y al menos una cuenta.</span> : null}
        </div>
      </Card>
    </div>
  );
}
