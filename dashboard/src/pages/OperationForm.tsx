import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { LIMIT_SEMANTICS_LABEL, perAccountRequestedQty, PREFERENCE_COLORS, type Account, type EventLimits, type LimitSemantics, type OperationConfig } from '@to/shared';
import { Icon } from '../components/Icon';
import { VenueMap } from '../components/VenueMap';
import { Callout, Card, Empty, Pill } from '../components/ui';
import { Api } from '../lib/api';
import { eurosEs, formatMoney, parseEuros, toLocalInput } from '../lib/format';
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
    maxUnitPrice: eurosEs(c.maxUnitPrice),
    budget: eurosEs(c.budget),
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

/** T0 escrito en el campo de fecha y hora local → ISO, o null si está vacío o no es una fecha. */
function parseT0(value: string): string | null {
  if (!value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Misma clave de grupo de límite que usa el servidor (domain/limits.ts). */
function groupKeyOf(a: Account, semantics: LimitSemantics): string | null {
  switch (semantics) {
    case 'PER_ACCOUNT':
      return `cuenta:${a.id}`;
    case 'PER_HOLDER':
      return a.holderRef ? `titular:${a.holderRef.trim().toLowerCase()}` : null;
    case 'PER_HOUSEHOLD':
      return a.householdRef ? `hogar:${a.householdRef.trim().toLowerCase()}` : null;
    case 'PER_PAYMENT_METHOD':
      return a.paymentRef ? `pago:${a.paymentRef.trim().toLowerCase()}` : null;
    default:
      return null;
  }
}

const GROUP_NOUN: Record<LimitSemantics, string> = {
  PER_ACCOUNT: 'cuenta',
  PER_HOLDER: 'titular',
  PER_HOUSEHOLD: 'hogar',
  PER_PAYMENT_METHOD: 'medio de pago',
  UNKNOWN: 'grupo',
};

/**
 * ¿Se pueden sumar exactamente `qty` entradas con carritos de al menos `minGroup`,
 * sin pasar el límite por cuenta ni por grupo? Devuelve un aviso o null.
 */
function qtyWarning(qty: number, minGroup: number, limits: EventLimits, accounts: Account[]): string | null {
  if (!Number.isInteger(qty) || qty < 1 || !Number.isInteger(minGroup) || minGroup < 1) return null;
  const perAccount = limits.perAccount;
  if (perAccount < 1) return null;
  if (limits.perOperation >= 1 && qty > limits.perOperation) return `El evento permite como máximo ${limits.perOperation} entradas por operación.`;
  if (minGroup > qty) return `El grupo mínimo (${minGroup}) es mayor que las entradas pedidas (${qty}): ningún carrito podría cumplirlo.`;
  if (minGroup > perAccount) return `Ninguna cuenta puede comprar grupos de ${minGroup}: el límite es ${perAccount} por cuenta.`;

  // Lo que puede sumar un conjunto de cuentas: cada una aporta 0 o entre minGroup y su límite.
  const addAccount = (reach: boolean[], cap: number): boolean[] => {
    const next = [...reach];
    reach.forEach((ok, t) => {
      if (!ok) return;
      for (let k = minGroup; k <= perAccount && t + k <= cap; k++) next[t + k] = true;
    });
    return next;
  };

  if (accounts.length === 0) {
    // Sin cuentas elegidas: ¿lo permite algún número de cuentas?
    let possible = false;
    for (let n = 1; n * minGroup <= qty; n++) if (qty <= n * perAccount) possible = true;
    return possible ? null : `Con grupos de al menos ${minGroup} y un máximo de ${perAccount} por cuenta no se puede sumar exactamente ${qty}.`;
  }

  const groups = new Map<string, number>();
  for (const a of accounts) {
    const key = groupKeyOf(a, limits.semantics);
    if (key !== null) groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  if (groups.size === 0) return null;
  const perGroup = limits.perGroup >= 1 ? limits.perGroup : Number.POSITIVE_INFINITY;
  let total: boolean[] = Array.from({ length: qty + 1 }, (_, i) => i === 0);
  let capacity = 0;
  for (const n of groups.values()) {
    const cap = Math.min(qty, perGroup);
    let inGroup: boolean[] = Array.from({ length: cap + 1 }, (_, i) => i === 0);
    for (let i = 0; i < n; i++) inGroup = addAccount(inGroup, cap);
    capacity += Math.min(perGroup, n * perAccount);
    const next: boolean[] = Array.from({ length: qty + 1 }, () => false);
    total.forEach((ok, t) => {
      if (!ok) return;
      inGroup.forEach((ok2, k) => {
        if (ok2 && t + k <= qty) next[t + k] = true;
      });
    });
    total = next;
  }
  if (total[qty]) return null;
  const nAcc = [...groups.values()].reduce((a, b) => a + b, 0);
  const limitText = `límite: ${perAccount} por cuenta${limits.semantics !== 'PER_ACCOUNT' && limits.perGroup >= 1 ? `, ${limits.perGroup} por ${GROUP_NOUN[limits.semantics]}` : ''}`;
  if (capacity < qty) return `Con ${nAcc === 1 ? 'esta cuenta' : `estas ${nAcc} cuentas`} se pueden comprar como máximo ${capacity} entradas (${limitText}).`;
  let best = 0;
  for (let t = qty; t > 0; t--) {
    if (total[t]) {
      best = t;
      break;
    }
  }
  if (best === 0) return `Con estos límites (${limitText}) no se puede formar ni un grupo de ${minGroup}.`;
  return `Con grupos de al menos ${minGroup} (${limitText}), ${nAcc === 1 ? 'esta cuenta no puede' : `estas ${nAcc} cuentas no pueden`} sumar exactamente ${qty}: lo más cercano es ${best}.`;
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
  /** Entradas por cuenta que pide el evento (1 en los grandes partidos), o null = hasta el límite oficial. */
  const perAccountQty = event?.perAccountQty ?? null;
  const allAccountsOf = (providerId: string) =>
    Object.values(s.accounts)
      .filter((a) => a.providerId === providerId && a.enabled)
      .map((a) => a.id)
      .slice(0, 10);

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
        // Dónde queréis las entradas, elegido al crear el evento (1ª, 2ª y 3ª preferencia).
        targets: x.targets.length > 0 ? x.targets : (ev.preferredTargets ?? []),
        // Gran partido (1 por cuenta): van todas las cuentas de esa web.
        accountIds: ev.perAccountQty && x.accountIds.length === 0 ? allAccountsOf(ev.providerId) : x.accountIds,
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
        targets: next?.preferredTargets ?? [],
        accountIds: next
          ? next.perAccountQty
            ? allAccountsOf(next.providerId)
            : x.accountIds.filter((aid) => s.accounts[aid]?.providerId === next.providerId)
          : [],
        name: nameFollowsEvent ? (next?.name ?? '') : x.name,
        t0: next?.onSaleAt && Date.parse(next.onSaleAt) > Date.now() ? toLocalInput(next.onSaleAt) : x.t0,
        requestedQty: next && Number.isFinite(qty) && qty > 0 && next.limits.perOperation > 0 ? String(Math.min(qty, next.limits.perOperation)) : x.requestedQty,
        runWindowMinutes: nextMode === 'MANUAL_ASSIST' && x.runWindowMinutes === '15' ? '60' : x.runWindowMinutes,
      };
    });

  const toggleAccount = (aid: string) =>
    setF((x) => ({ ...x, accountIds: x.accountIds.includes(aid) ? x.accountIds.filter((y) => y !== aid) : x.accountIds.length >= 10 ? x.accountIds : [...x.accountIds, aid] }));
  // Último objetivo añadido desde el plano o las sugerencias, para poder deshacerlo.
  const [added, setAdded] = useState<{ name: string; duplicate: boolean; seq: number } | null>(null);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 8000);
    return () => clearTimeout(t);
  }, [added]);
  const addTarget = (name: string) => {
    const duplicate = f.targets.includes(name);
    if (!duplicate) setF((x) => (x.targets.includes(name) ? x : { ...x, targets: [...x.targets, name] }));
    setAdded((prev) => ({ name, duplicate, seq: (prev?.seq ?? 0) + 1 }));
  };
  const undoAdd = (name: string) => {
    setF((x) => {
      const i = x.targets.lastIndexOf(name);
      return i < 0 ? x : { ...x, targets: x.targets.filter((_, j) => j !== i) };
    });
    setAdded(null);
  };
  const moveTarget = (i: number, dir: -1 | 1) =>
    setF((x) => {
      const t = [...x.targets];
      const j = i + dir;
      if (j < 0 || j >= t.length) return x;
      [t[i], t[j]] = [t[j] as string, t[i] as string];
      return { ...x, targets: t };
    });

  const currency = event?.currency ?? 'EUR';
  const maxCents = parseEuros(f.maxUnitPrice);
  const budgetCents = parseEuros(f.budget);
  const t0Iso = parseT0(f.t0);

  const build = (): OperationConfig | null => {
    if (!event) return null;
    const maxUnitPrice = maxCents;
    const budget = budgetCents;
    if (maxUnitPrice === null || budget === null || t0Iso === null) return null;
    const isSim = provider?.mode === 'SIMULATED';
    return {
      name: f.name.trim() || event.name,
      eventId: event.id,
      providerId: event.providerId,
      t0: t0Iso,
      runWindowMinutes: Math.trunc(Number(f.runWindowMinutes)),
      freezeLeadSeconds: Math.trunc(Number(f.freezeLeadSeconds)),
      requestedQty: perAccountQty ? perAccountRequestedQty(f.accountIds.length, perAccountQty, event.limits.perOperation) : Math.trunc(Number(f.requestedQty)),
      currency: event.currency,
      maxUnitPrice,
      budget,
      preferences: {
        targets: f.targets,
        excludeSections: f.excludeSections,
        requireContiguous: perAccountQty === 1 ? false : f.requireContiguous,
        minGroupSize: perAccountQty ? Math.min(Math.trunc(Number(f.minGroupSize)) || 1, perAccountQty) : Math.trunc(Number(f.minGroupSize)),
        allowStanding: f.allowStanding,
        allowObstructed: f.allowObstructed,
        allowAccessible: f.allowAccessible,
        maxAmbiguity: Number(f.maxAmbiguity),
        maxPerAccount: perAccountQty,
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

  // «N por cuenta»: N por cada cuenta elegida, sin pasar del tope por operación del evento.
  const perAccountWanted = perAccountQty ? f.accountIds.length * perAccountQty : 0;
  const qty = perAccountQty ? (f.accountIds.length > 0 && event ? perAccountRequestedQty(f.accountIds.length, perAccountQty, event.limits.perOperation) : 0) : Number(f.requestedQty);
  const perAccountCapped = perAccountQty !== null && perAccountWanted > qty;
  const spareAccounts = perAccountQty ? f.accountIds.length - Math.ceil(qty / perAccountQty) : 0;
  const accountsFull = f.accountIds.length >= 10;
  // Con «N por cuenta», el grupo mínimo no pasa de N (1 por cuenta: entradas sueltas, una cada cuenta).
  const minGroup = perAccountQty ? Math.min(Number(f.minGroupSize) || 1, perAccountQty) : Number(f.minGroupSize);
  const maxPrice = maxCents ?? 0;
  const blocking = [
    !event ? 'elige un evento' : null,
    f.accountIds.length === 0 ? 'elige al menos una cuenta' : null,
    t0Iso === null ? 'indica T0' : null,
    maxCents === null ? 'revisa el máximo por entrada' : null,
    budgetCents === null ? 'revisa el presupuesto' : null,
  ].filter((x): x is string => x !== null);
  const ready = blocking.length === 0;
  const selectedAccounts = f.accountIds.map((aid) => s.accounts[aid]).filter((a): a is Account => a !== undefined);
  const qtyWarn = event
    ? qtyWarning(
        Math.trunc(qty),
        Math.trunc(minGroup),
        perAccountQty ? { ...event.limits, perAccount: Math.min(event.limits.perAccount, perAccountQty) } : event.limits,
        selectedAccounts,
      )
    : null;
  const budgetShort = Number.isFinite(qty) && qty > 0 && maxCents !== null && budgetCents !== null && budgetCents < Math.trunc(qty) * maxCents;
  const t0Past = t0Iso !== null && Date.parse(t0Iso) < Date.now();

  if (id && existing.error) {
    return (
      <Empty title={s.operations[id] ? 'No se pudo cargar la operación' : 'Operación no encontrada'} action={<Link to="/operaciones">Volver a operaciones</Link>}>
        {existing.error}
      </Empty>
    );
  }

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
              <input
                id="op-t0"
                className="input"
                type="datetime-local"
                step={1}
                value={f.t0}
                onChange={(e) => set('t0', e.target.value)}
                aria-invalid={t0Iso === null}
                aria-describedby="op-t0-hint"
              />
              {t0Iso === null ? (
                <span id="op-t0-hint" className="hint error" role="alert">
                  Indica la fecha y la hora de T0.
                </span>
              ) : (
                <span id="op-t0-hint" className={`hint ${t0Past ? 'warn' : ''}`}>
                  {new Date(t0Iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  {t0Past ? ' · esta hora ya ha pasado' : ''}
                </span>
              )}
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
              {perAccountQty ? (
                <>
                  <input id="op-qty" className="input" type="number" value={qty} readOnly disabled />
                  <span className={`hint ${perAccountCapped ? 'warn' : ''}`}>
                    {perAccountQty} por cuenta × {f.accountIds.length} cuenta{f.accountIds.length === 1 ? '' : 's'}
                    {perAccountCapped ? ` = ${perAccountWanted}, pero el evento permite ${qty} por operación.` : ': todas van a la vez, cada una a por la suya.'}
                  </span>
                </>
              ) : (
                <input id="op-qty" className="input" type="number" min={1} value={f.requestedQty} onChange={(e) => set('requestedQty', e.target.value)} />
              )}
            </div>
            <div className="field">
              <label htmlFor="op-max">Máximo por entrada ({currency}, con gastos)</label>
              <MoneyInput id="op-max" value={f.maxUnitPrice} cents={maxCents} currency={currency} onChange={(v) => set('maxUnitPrice', v)} />
            </div>
            <div className="field">
              <label htmlFor="op-budget">Presupuesto total</label>
              <MoneyInput id="op-budget" value={f.budget} cents={budgetCents} currency={currency} onChange={(v) => set('budget', v)} />
              <span className={`hint ${budgetShort ? 'warn' : ''}`}>
                {Number.isFinite(qty) && qty > 0 && maxCents !== null
                  ? `${Math.trunc(qty)} a precio máximo: ${formatMoney(Math.trunc(qty) * maxPrice, currency)}${budgetShort ? ' · el presupuesto no llega' : ''}`
                  : '—'}
              </span>
            </div>
            {perAccountQty === 1 ? null : (
              <div className="field">
                <label htmlFor="op-min">Grupo mínimo por carrito</label>
                <input id="op-min" className="input" type="number" min={1} value={f.minGroupSize} onChange={(e) => set('minGroupSize', e.target.value)} />
                <span className="hint">Evita entradas sueltas.</span>
              </div>
            )}
          </div>
          {perAccountCapped && perAccountQty ? (
            <div style={{ marginTop: 12 }}>
              <Callout tone="warning">
                Se piden <b>{qty} entradas</b>, el máximo por operación del evento (no {perAccountWanted}): van a la vez las cuentas que hacen falta para {qty} y
                {spareAccounts === 1 ? ' la otra entra' : ` las otras ${spareAccounts} entran`} si alguna falla. Si las condiciones oficiales permiten más, súbelo en «Por
                operación» del evento.
              </Callout>
            </div>
          ) : null}
          {qtyWarn ? (
            <div style={{ marginTop: 12 }}>
              <Callout tone="warning">{qtyWarn}</Callout>
            </div>
          ) : null}
        </div>

        <div className="form-section">
          <h3 className="sign">4 · Dónde (en orden de preferencia)</h3>
          <div className="stack">
            <div className="chips" aria-label="Objetivos en orden">
              {f.targets.length === 0 ? <span className="small muted">Sin objetivos = cualquier sección permitida del recinto.</span> : null}
              {f.targets.map((t, i) => (
                <span key={`${t}-${i}`} className="chip" style={PREFERENCE_COLORS[i] ? { borderColor: PREFERENCE_COLORS[i], borderWidth: 2 } : undefined}>
                  <span className="rank" style={PREFERENCE_COLORS[i] ? { color: PREFERENCE_COLORS[i], fontWeight: 800 } : undefined}>
                    {i + 1}
                  </span>{' '}
                  {t}
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
            {artifact.data ? (
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">Toca una zona del plano para añadirla como objetivo (el número es el orden en que se intentará):</span>
                <div className="pick-note small" aria-live="polite">
                  {added ? (
                    added.duplicate ? (
                      <span>
                        <b>{added.name}</b> ya estaba en la lista.
                      </span>
                    ) : (
                      <>
                        <span>
                          Añadido: <b>{added.name}</b>
                        </span>
                        <span aria-hidden>·</span>
                        <button type="button" className="btn sm ghost" onClick={() => undoAdd(added.name)}>
                          Deshacer
                        </button>
                      </>
                    )
                  ) : null}
                </div>
                <VenueMap artifact={artifact.data} targets={f.targets} onPick={addTarget} rankColors={PREFERENCE_COLORS} />
              </div>
            ) : null}
            {suggestions.length > 0 ? (
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">Añadir desde el vault ({artifact.data?.name}):</span>
                <div className="chips">
                  {suggestions
                    .filter((x) => !f.targets.includes(x.label))
                    .map((x) => (
                      <button key={`${x.kind}-${x.label}`} type="button" className="chip suggest" onClick={() => addTarget(x.label)}>
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
          {accountsFull && accounts.some((a) => a.enabled && !f.accountIds.includes(a.id)) ? (
            <div className="small" role="status" style={{ color: 'var(--warning-ink)', marginBottom: 10 }}>
              Ya hay 10 cuentas elegidas, el máximo por operación: desmarca una para elegir otra.
            </div>
          ) : null}
          {accounts.length === 0 ? (
            <Callout tone="warning">
              {event ? `No hay cuentas de ${providerName ?? event.providerId}. ` : 'Todavía no hay cuentas. '}
              <Link to="/cuentas">Crea una cuenta</Link> por persona
              {provider?.mode === 'SIMULATED' ? ' o usa «Nueva demo» en el resumen para ensayar.' : '.'}
            </Callout>
          ) : (
            <div className="form-grid">
              {accounts.map((a) => (
                <label
                  key={a.id}
                  className="check"
                  style={{ opacity: a.enabled && (!accountsFull || f.accountIds.includes(a.id)) ? 1 : 0.5 }}
                  title={a.enabled && accountsFull && !f.accountIds.includes(a.id) ? 'Máximo 10 cuentas: desmarca una para elegir esta' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={f.accountIds.includes(a.id)}
                    onChange={() => toggleAccount(a.id)}
                    disabled={!a.enabled || (accountsFull && !f.accountIds.includes(a.id))}
                  />
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
          {!ready ? <span className="small muted">Falta: {blocking.join(' · ')}.</span> : null}
        </div>
      </Card>
    </div>
  );
}

/** Importe en texto libre ('119,50', '119.50', '1.234,50') con su lectura al lado: «= 119,50 €». */
function MoneyInput({ id, value, cents, currency, onChange }: { id: string; value: string; cents: number | null; currency: string; onChange: (v: string) => void }) {
  const invalid = cents === null;
  return (
    <>
      <div className="money-row">
        <input
          id={id}
          className="input mono"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          aria-describedby={`${id}-read`}
        />
        <span id={`${id}-read`} className={`money-read ${invalid ? 'error' : ''}`}>
          {invalid ? 'no válido' : `= ${formatMoney(cents, currency)}`}
        </span>
      </div>
      {invalid ? (
        <span className="hint error" role="alert">
          Escribe un importe, por ejemplo 119,50.
        </span>
      ) : null}
    </>
  );
}
