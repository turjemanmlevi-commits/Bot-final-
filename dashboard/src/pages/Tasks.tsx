import { VenueMap } from '../components/VenueMap';
import { useMemo, useState } from 'react';
import { HUMAN_TASK_KIND_LABEL, HUMAN_TASK_STATE_LABEL, type HumanTask } from '@to/shared';
import { Icon } from '../components/Icon';
import { Card, Empty, Pill } from '../components/ui';
import { Api } from '../lib/api';
import { euros, formatDuration, formatMoney, fmtDateTime, parseEuros } from '../lib/format';
import { useAction, useAsync, useNow } from '../lib/hooks';
import { useLive } from '../lib/store';

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
  const [qty, setQty] = useState(String(task.target?.qty ?? 1));
  const [price, setPrice] = useState(task.target ? euros(task.target.maxUnitPrice) : '');
  const [seats, setSeats] = useState('');
  const [expiresMin, setExpiresMin] = useState('10');
  const left = task.deadlineAt ? Date.parse(task.deadlineAt) - now : null;
  const providerId = account?.providerId ?? op?.providerId;
  const providerName = providerId
    ? (s.providerAuthorizations.find((p) => p.providerId === providerId)?.name ?? s.system?.providers.find((p) => p.id === providerId)?.name ?? providerId)
    : null;

  const respondInCart = () => {
    const unitPrice = parseEuros(price);
    const q = Math.trunc(Number(qty));
    if (!unitPrice || !Number.isFinite(q) || q < 1) return;
    const mins = Number(expiresMin);
    void run(
      () =>
        Api.respondTask(task.id, {
          result: 'IN_CART',
          qty: q,
          unitPrice,
          seats: seats.split(/[,\s]+/).filter(Boolean),
          ...(Number.isFinite(mins) && mins > 0 ? { expiresAt: new Date(Date.now() + mins * 60_000).toISOString() } : {}),
        }),
      'Registrado: entradas en carrito',
    );
  };

  return (
    <div className={`task-card ${task.kind !== 'ADD_TO_CART' ? 'urgent' : ''}`}>
      <div className="row">
        <Pill tone="warning" icon={task.kind === 'OPEN_SESSION' ? 'user' : task.kind === 'VERIFY_CART' ? 'search' : 'cart'}>
          {HUMAN_TASK_KIND_LABEL[task.kind]}
        </Pill>
        <b style={{ fontSize: 15 }}>{account?.label ?? task.accountId}</b>
        {op ? <span className="small muted">{op.name}</span> : null}
        <span style={{ marginLeft: 'auto' }} />
        {left !== null ? (
          <span className={`countdown ${left < 60_000 ? 'hot' : ''}`}>
            <Icon name="clock" size={14} /> {left > 0 ? formatDuration(left) : 'caducada'}
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
        <details open>
          <summary className="small ink2" style={{ cursor: 'pointer' }}>Dónde está {task.target.sectionLabel} en el recinto</summary>
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
        <div className="stack" style={{ gap: 10 }}>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            <div className="field">
              <label htmlFor={`q-${task.id}`}>Cuántas quedaron</label>
              <input id={`q-${task.id}`} className="input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`p-${task.id}`}>Precio por entrada (€)</label>
              <input id={`p-${task.id}`} className="input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`s-${task.id}`}>Asientos (opcional)</label>
              <input id={`s-${task.id}`} className="input" placeholder="12, 13" value={seats} onChange={(e) => setSeats(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`e-${task.id}`}>Minutos que le quedan al carrito</label>
              <input id={`e-${task.id}`} className="input" type="number" min={0} value={expiresMin} onChange={(e) => setExpiresMin(e.target.value)} />
              <span className="hint">Lo indica la web; sirve para avisarte antes de que caduque.</span>
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn primary lg" disabled={busy} onClick={respondInCart}>
              <Icon name="cart" size={16} /> Están en el carrito
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => Api.respondTask(task.id, { result: 'FAILED' }), 'Anotado: se probará otra zona')}>
              No pude
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(() => Api.respondTask(task.id, { result: 'UNKNOWN' }), 'Anotado: se pedirá verificación')}>
              No estoy seguro
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TasksPage() {
  const s = useLive();
  const open = useMemo(() => Object.values(s.humanTasks).filter((t) => t.state === 'OPEN').sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [s.humanTasks]);
  const done = useMemo(
    () =>
      Object.values(s.humanTasks)
        .filter((t) => t.state !== 'OPEN')
        .sort((a, b) => (b.respondedAt ?? b.createdAt).localeCompare(a.respondedAt ?? a.createdAt))
        .slice(0, 40),
    [s.humanTasks],
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Tareas humanas</h1>
          <div className="sub">
            Lo que el sistema no hace ni debe hacer solo: iniciar sesión, resolver retos (CAPTCHA, SMS…), añadir al carrito en modo manual y verificar resultados dudosos.
          </div>
        </div>
      </div>
      {open.length === 0 ? (
        <Card>
          <Empty title="Nada pendiente">Cuando haga falta una persona, la tarea aparecerá aquí (y en Telegram si está configurado).</Empty>
        </Card>
      ) : (
        <div className="grid cols-2">
          {open.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
      <Card title="Historial" flush>
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
                    <td className="small muted">
                      {t.response ? `${t.response.result}${t.response.qty ? ` · ${t.response.qty} entradas` : ''} · ${t.response.actor}` : '—'}
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
