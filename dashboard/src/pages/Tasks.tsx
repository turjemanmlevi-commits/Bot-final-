import { useMemo, useState } from 'react';
import { HUMAN_TASK_KIND_LABEL, HUMAN_TASK_STATE_LABEL, type Cart, type HumanTask, type HumanTaskResponse } from '@to/shared';
import { Icon } from '../components/Icon';
import { VenueMap } from '../components/VenueMap';
import { Callout, Card, Empty, Pill } from '../components/ui';
import { Api } from '../lib/api';
import { eurosEs, fmtCountdown, fmtDateTime, fmtRel, formatMoney, parseEuros } from '../lib/format';
import { useAction, useAsync, useNow, useToast } from '../lib/hooks';
import { live, useLive } from '../lib/store';

/** Respuesta de la persona, en castellano (historial). */
const RESULT_LABEL: Record<HumanTaskResponse['result'], string> = {
  READY: 'Sesión lista',
  IN_CART: 'En carrito',
  FAILED: 'No pudo',
  UNKNOWN: 'No está seguro',
};

const FILTER_KEY = 'to.tasks.account';

function readFilter(): string {
  try {
    return localStorage.getItem(FILTER_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeFilter(value: string): void {
  try {
    if (value) localStorage.setItem(FILTER_KEY, value);
    else localStorage.removeItem(FILTER_KEY);
  } catch {
    // almacenamiento no disponible: el filtro no se recuerda
  }
}

const isCartTask = (t: HumanTask) => t.kind === 'ADD_TO_CART' || t.kind === 'VERIFY_CART';

/** Entero positivo escrito a mano, o null. */
function parseCount(value: string): number | null {
  const t = value.trim();
  return /^\d{1,4}$/.test(t) ? Number(t) : null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Carrito en el que ha quedado la respuesta de la tarea (por claim; si no, el abierto de la cuenta). */
async function findCartFor(task: HumanTask): Promise<Cart | undefined> {
  let carts: Cart[];
  try {
    carts = await Api.carts();
  } catch {
    carts = Object.values(live.getSnapshot().carts);
  }
  const byClaim = task.claimId ? carts.find((c) => c.items.some((i) => i.claimId === task.claimId)) : undefined;
  return (
    byClaim ??
    carts.find((c) => c.accountId === task.accountId && c.operationId === task.operationId && (c.state === 'ACTIVE' || c.state === 'REVIEW_REQUIRED'))
  );
}

const errStyle = { color: 'var(--critical-ink)' } as const;

/** Formulario de «están en el carrito» con validación en línea y doble clic si supera lo asignado. */
function InCartForm({ task }: { task: HumanTask }) {
  const toast = useToast();
  const { run, busy } = useAction();
  const target = task.target;
  const currency = target?.currency ?? 'EUR';
  const [qty, setQty] = useState(target ? String(target.qty) : '');
  const [price, setPrice] = useState('');
  const [seats, setSeats] = useState('');
  const [minutes, setMinutes] = useState('');
  const [tried, setTried] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);

  const unitPrice = parseEuros(price);
  const q = parseCount(qty);
  const mins = parseCount(minutes);

  const priceError =
    price.trim() === ''
      ? tried
        ? 'Indica el precio por entrada'
        : null
      : unitPrice === null
        ? 'No se entiende el precio: escríbelo como 119,50'
        : unitPrice <= 0
          ? 'El precio tiene que ser mayor que 0'
          : null;
  const qtyError = q === null ? 'Indica cuántas entradas (un número)' : q < 1 || q > 100 ? 'Tiene que estar entre 1 y 100' : null;
  const minutesError = minutes.trim() === '' ? null : mins === null || mins < 1 || mins > 60 ? 'Entre 1 y 60 minutos, o déjalo vacío' : null;

  const warnings: string[] = [];
  if (target && q !== null && !qtyError && q > target.qty) warnings.push(`Has puesto ${q} y te tocaban ${target.qty}: supera tu límite.`);
  if (target && unitPrice !== null && unitPrice > 0 && unitPrice > target.maxUnitPrice) {
    warnings.push(`Precio por encima del máximo: ${formatMoney(unitPrice, currency)} y el máximo es ${formatMoney(target.maxUnitPrice, currency)}.`);
  }
  const warnKey = warnings.length > 0 ? `${q}|${unitPrice}` : null;
  const armed = warnKey !== null && confirmedKey === warnKey;

  const submit = async () => {
    setTried(true);
    if (unitPrice === null || unitPrice <= 0 || q === null || qtyError || minutesError) return;
    if (warnKey !== null && !armed) {
      setConfirmedKey(warnKey);
      return;
    }
    const r = await run(() =>
      Api.respondTask(task.id, {
        result: 'IN_CART',
        qty: q,
        unitPrice,
        seats: seats.split(/[,;\s]+/).filter(Boolean),
        ...(mins !== null && mins >= 1 ? { expiresAt: new Date(Date.now() + mins * 60_000).toISOString() } : {}),
      }),
    );
    if (!r) return;
    const cart = await findCartFor(task);
    if (!cart) {
      toast('Respuesta guardada, pero no aparece ningún carrito: revisa Carritos y Alertas.', 'error');
    } else if (cart.state === 'REVIEW_REQUIRED') {
      toast(`Registrado, pero hay que revisar el carrito: ${cart.reviewReason ?? 'algo no cuadra con lo asignado'}`, 'error');
    } else {
      toast(
        `Registrado: ${q} ${plural(q, 'entrada', 'entradas')} en el carrito. Paga en la web oficial y márcalo en Carritos.` +
          (mins === null ? ' Indica allí los minutos que le quedan.' : ''),
      );
    }
  };

  const verify = task.kind === 'VERIFY_CART';
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <div className="field">
          <label htmlFor={`q-${task.id}`}>Cuántas hay en el carrito</label>
          <input
            id={`q-${task.id}`}
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={qty}
            aria-invalid={qtyError ? true : undefined}
            onChange={(e) => setQty(e.target.value)}
          />
          {qtyError ? (
            <span className="hint" style={errStyle}>
              {qtyError}
            </span>
          ) : target ? (
            <span className="hint">Te tocaban {target.qty}</span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor={`p-${task.id}`}>Precio por entrada (con gastos)</label>
          <input
            id={`p-${task.id}`}
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={target ? `máx. ${eurosEs(target.maxUnitPrice)}` : 'p. ej. 119,50'}
            value={price}
            aria-invalid={priceError ? true : undefined}
            onChange={(e) => setPrice(e.target.value)}
          />
          {priceError ? (
            <span className="hint" style={errStyle}>
              {priceError}
            </span>
          ) : unitPrice !== null && price.trim() !== '' ? (
            <span className="hint">
              = <b className="mono">{formatMoney(unitPrice, currency)}</b>
            </span>
          ) : (
            <span className="hint">El que pone la web, por entrada</span>
          )}
        </div>
        <div className="field">
          <label htmlFor={`e-${task.id}`}>Minutos que le quedan al carrito</label>
          <input
            id={`e-${task.id}`}
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="p. ej. 10"
            value={minutes}
            aria-invalid={minutesError ? true : undefined}
            onChange={(e) => setMinutes(e.target.value)}
          />
          {minutesError ? (
            <span className="hint" style={errStyle}>
              {minutesError}
            </span>
          ) : (
            <span className="hint">Te avisaremos antes de que caduque</span>
          )}
        </div>
        <div className="field">
          <label htmlFor={`s-${task.id}`}>Asientos (opcional)</label>
          <input id={`s-${task.id}`} className="input" autoComplete="off" placeholder="12, 13" value={seats} onChange={(e) => setSeats(e.target.value)} />
        </div>
      </div>
      {warnings.length > 0 ? (
        <Callout tone={armed ? 'critical' : 'warning'}>
          {warnings.map((w) => (
            <div key={w}>
              <b>{w}</b>
            </div>
          ))}
          <div>
            {armed
              ? 'Pulsa otra vez para registrarlo tal cual: el carrito quedará para revisar.'
              : 'Si es lo que hay en el carrito, regístralo igualmente (te pediremos confirmarlo con un segundo clic).'}
          </div>
        </Callout>
      ) : null}
      <div className="row">
        <button type="button" className={`btn lg ${armed ? 'danger solid' : 'primary'}`} disabled={busy} onClick={() => void submit()}>
          <Icon name="cart" size={16} /> {armed ? 'Sí, registrar igualmente' : 'Están en el carrito'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run(() => Api.respondTask(task.id, { result: 'FAILED' }), verify ? 'Anotado: no están en el carrito' : 'Anotado: si queda otra zona, te llega ahora como tarea nueva')}
        >
          {verify ? 'No están' : 'No pude'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(() => Api.respondTask(task.id, { result: 'UNKNOWN' }), 'Anotado: se pedirá verificación')}>
          No estoy seguro
        </button>
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: HumanTask }) {
  const s = useLive();
  const now = useNow(1000);
  const { run, busy } = useAction();
  const account = s.accounts[task.accountId];
  const op = task.operationId ? s.operations[task.operationId] : undefined;
  const ev = op ? s.events[op.eventId] : undefined;
  const venueHash = ev
    ? (Object.values(s.venues).find((v) => v.active && v.venueId === ev.venueId && v.eventId === ev.id) ??
        Object.values(s.venues).find((v) => v.active && v.venueId === ev.venueId && v.eventId === null))?.hash
    : undefined;
  const venue = useAsync(() => (venueHash && task.target ? Api.venue(venueHash) : Promise.resolve(null)), [venueHash, Boolean(task.target)]);
  const left = task.deadlineAt ? Date.parse(task.deadlineAt) - now : null;
  const t0Left = op && task.kind === 'OPEN_SESSION' && ['ARMED', 'FROZEN', 'VALIDATED'].includes(op.state) ? Date.parse(op.t0) - now : null;
  const providerId = account?.providerId ?? op?.providerId;
  const providerName = providerId
    ? (s.providerAuthorizations.find((p) => p.providerId === providerId)?.name ?? s.system?.providers.find((p) => p.id === providerId)?.name ?? providerId)
    : null;

  return (
    <div className={`task-card ${isCartTask(task) ? 'urgent' : ''}`}>
      <div className="row">
        <Pill tone={isCartTask(task) ? 'critical' : 'warning'} icon={task.kind === 'OPEN_SESSION' ? 'user' : task.kind === 'VERIFY_CART' ? 'search' : 'cart'}>
          {HUMAN_TASK_KIND_LABEL[task.kind]}
        </Pill>
        <b style={{ fontSize: 15 }}>{account?.label ?? task.accountId}</b>
        {op ? <span className="small muted">{op.name}</span> : null}
        <span style={{ marginLeft: 'auto' }} />
        {left !== null ? (
          <span className={`countdown ${left < 300_000 ? 'hot' : ''}`} title="Tiempo para responder">
            <Icon name="clock" size={14} /> {left > 0 ? fmtCountdown(left) : 'tiempo agotado'}
          </span>
        ) : t0Left !== null && t0Left > 0 ? (
          <span className="small ink2" title="Hora de apertura de la venta">
            <Icon name="clock" size={13} /> venta {fmtRel(op?.t0, now)}
          </span>
        ) : null}
      </div>
      {providerName ? (
        <div className="small muted" style={{ marginTop: -4 }}>
          Proveedor: <b>{providerName}</b>
        </div>
      ) : null}
      <div style={{ fontSize: 15, fontWeight: 600 }}>{task.title}</div>
      <div className="ink2">{task.instructions}</div>
      {task.link ? (
        <div className="row">
          <a className="btn lg" href={task.link} target="_blank" rel="noreferrer">
            <Icon name="external" size={16} /> Abrir la web oficial
          </a>
        </div>
      ) : null}
      {task.target && venue.data ? (
        <details open={isCartTask(task)}>
          <summary className="small ink2" style={{ cursor: 'pointer' }}>
            Dónde está {task.target.sectionLabel} en el recinto
          </summary>
          <VenueMap artifact={venue.data} highlight={task.target.sectionLabel} compact />
        </details>
      ) : null}
      {task.target ? (
        <div className="task-target">
          <div>
            <div className="sign">Cantidad</div>
            <div className="big">{task.target.qty}</div>
          </div>
          <div>
            <div className="sign">Zona</div>
            <div className="big" style={{ fontSize: 18 }}>
              {task.target.sectionLabel}
            </div>
          </div>
          <div>
            <div className="sign">Máximo por entrada</div>
            <div className="big">{formatMoney(task.target.maxUnitPrice, task.target.currency)}</div>
          </div>
        </div>
      ) : null}
      {task.kind === 'OPEN_SESSION' ? (
        <div className="row">
          <button type="button" className="btn primary lg" disabled={busy} onClick={() => void run(() => Api.respondTask(task.id, { result: 'READY' }), 'Sesión lista')}>
            <Icon name="check" size={16} /> Sesión lista
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => Api.respondTask(task.id, { result: 'FAILED' }), 'Anotado')}>
            No puedo
          </button>
        </div>
      ) : (
        <InCartForm task={task} />
      )}
    </div>
  );
}

/** Texto de la respuesta para el historial: «En carrito · 3 entradas · 119,50 €/u · ana». */
function responseText(t: HumanTask, currency: string): string {
  const r = t.response;
  if (!r) return '—';
  const parts = [RESULT_LABEL[r.result]];
  if (r.qty) parts.push(`${r.qty} ${plural(r.qty, 'entrada', 'entradas')}`);
  if (r.unitPrice) parts.push(`${formatMoney(r.unitPrice, currency)}/u`);
  if (r.note && r.actor === 'system') parts.push(r.note);
  parts.push(r.actor === 'system' ? 'sistema' : r.actor);
  return parts.join(' · ');
}

export function TasksPage() {
  const s = useLive();
  const [filter, setFilterState] = useState<string>(readFilter);
  const setFilter = (v: string) => {
    setFilterState(v);
    writeFilter(v);
  };

  const allOpen = useMemo(
    () =>
      Object.values(s.humanTasks)
        .filter((t) => t.state === 'OPEN')
        .sort(
          (a, b) =>
            Number(!isCartTask(a)) - Number(!isCartTask(b)) ||
            (a.deadlineAt ?? '9').localeCompare(b.deadlineAt ?? '9') ||
            a.createdAt.localeCompare(b.createdAt),
        ),
    [s.humanTasks],
  );
  const accountOptions = useMemo(() => {
    const ids = new Set(allOpen.map((t) => t.accountId));
    if (filter) ids.add(filter);
    return [...ids]
      .map((id) => ({ id, label: s.accounts[id]?.label ?? id, n: allOpen.filter((t) => t.accountId === id).length }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [allOpen, filter, s.accounts]);
  const open = filter ? allOpen.filter((t) => t.accountId === filter) : allOpen;
  const hidden = allOpen.length - open.length;
  const done = useMemo(
    () =>
      Object.values(s.humanTasks)
        .filter((t) => t.state !== 'OPEN' && (!filter || t.accountId === filter))
        .sort((a, b) => (b.respondedAt ?? b.createdAt).localeCompare(a.respondedAt ?? a.createdAt))
        .slice(0, 40),
    [s.humanTasks, filter],
  );
  const filterLabel = filter ? (s.accounts[filter]?.label ?? filter) : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Tareas humanas</h1>
          <div className="sub">
            Lo que el sistema no hace ni debe hacer solo: iniciar sesión, resolver retos (CAPTCHA, SMS…), añadir al carrito en la web oficial y verificar resultados dudosos.
          </div>
        </div>
        <div className="actions">
          <div className="field" style={{ minWidth: 230 }}>
            <label htmlFor="task-filter">Solo mis tareas</label>
            <select id="task-filter" className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Todas las cuentas</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.n} {plural(a.n, 'pendiente', 'pendientes')})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {filter && hidden > 0 ? (
        <Callout icon="info">
          Ves solo las tareas de <b>{filterLabel}</b>. Hay {hidden} {plural(hidden, 'tarea', 'tareas')} de otras cuentas.{' '}
          <button type="button" className="btn sm" onClick={() => setFilter('')}>
            Ver todas
          </button>
        </Callout>
      ) : null}
      {open.length === 0 ? (
        <Card>
          <Empty title={filterLabel ? `Nada pendiente para ${filterLabel}` : 'Nada pendiente'}>
            Cuando haga falta una persona, la tarea aparecerá aquí (y en Telegram si está configurado).
          </Empty>
        </Card>
      ) : (
        <div className="grid cols-2">
          {open.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
      <Card title={filterLabel ? `Historial · ${filterLabel}` : 'Historial'} flush>
        {done.length === 0 ? (
          <div className="card-body muted">Sin historial.</div>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Creada</th>
                  <th>Tarea</th>
                  <th>Cuenta</th>
                  <th>Estado</th>
                  <th>Respuesta</th>
                </tr>
              </thead>
              <tbody>
                {done.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{fmtDateTime(t.createdAt)}</td>
                    <td>{t.title}</td>
                    <td>{s.accounts[t.accountId]?.label ?? t.accountId}</td>
                    <td>
                      <Pill tone={t.state === 'DONE' ? 'good' : t.state === 'FAILED' || t.state === 'EXPIRED' ? 'serious' : 'neutral'}>{HUMAN_TASK_STATE_LABEL[t.state]}</Pill>
                    </td>
                    <td className="small muted">{responseText(t, t.target?.currency ?? (t.operationId ? s.operations[t.operationId]?.currency : undefined) ?? 'EUR')}</td>
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
