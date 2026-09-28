import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertRow, sortAlerts } from '../components/AlertList';
import { useDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { OperationHero } from '../components/OperationHero';
import { Callout, Card, CartPill, Empty, Stat } from '../components/ui';
import { Api } from '../lib/api';
import { formatDuration, formatMoney, fmtRel } from '../lib/format';
import { useAction, useNow } from '../lib/hooks';
import { useLive } from '../lib/store';

const ACTIVE = ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING'];

export function OverviewPage() {
  const s = useLive();
  const now = useNow(1000);
  const navigate = useNavigate();
  const ask = useDialog();
  const { run, busy } = useAction();

  const ops = useMemo(() => Object.values(s.operations), [s.operations]);
  const active = useMemo(() => ops.filter((o) => ACTIVE.includes(o.state)).sort((a, b) => a.t0.localeCompare(b.t0)), [ops]);
  const recentSecured = useMemo(
    () => ops.filter((o) => o.state === 'CART_SECURED').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [ops],
  );
  const focus = active.find((o) => o.state === 'RUNNING') ?? active[0] ?? recentSecured[0] ?? null;
  const others = [...active, ...recentSecured].filter((o) => o.id !== focus?.id).slice(0, 4);
  const openAlerts = useMemo(() => sortAlerts(Object.values(s.alerts).filter((a) => a.state !== 'RESOLVED')), [s.alerts]);
  const pendingCarts = useMemo(
    () =>
      Object.values(s.carts)
        .filter((c) => c.state === 'ACTIVE' || c.state === 'REVIEW_REQUIRED')
        .sort((a, b) => (a.expiresAt ?? '9').localeCompare(b.expiresAt ?? '9')),
    [s.carts],
  );
  const openTasks = useMemo(() => Object.values(s.humanTasks).filter((t) => t.state === 'OPEN'), [s.humanTasks]);
  const critical = openAlerts.filter((a) => a.severity === 'CRITICAL').length;
  const ticketsInCarts = pendingCarts.reduce((n, c) => n + c.qty, 0);
  const totalInCarts = pendingCarts.reduce((n, c) => n + c.total, 0);
  const nextT0 = active.filter((o) => Date.parse(o.t0) > now)[0];

  const newDemo = async () => {
    const ok = await ask({
      title: 'Crear una demo',
      body: 'Se crean 8 cuentas ficticias y una operación contra el simulador que arranca en 60 segundos. Podrás ver colas, retos de sesión, selección, carritos y el pago humano.',
      confirmText: 'Crear demo',
    });
    if (!ok) return;
    const r = await run(() => Api.seedDemo({ startInSeconds: 60 }), (x) => x.message);
    if (r) navigate(`/operaciones/${r.operationId}`);
  };

  if (ops.length === 0) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="page-head">
          <div>
            <h1>Sala de control</h1>
            <div className="sub">Todavía no hay operaciones. Empieza por una demo o prepara una operación real.</div>
          </div>
        </div>
        <Card>
          <Empty
            title="Nada en marcha"
            action={
              <div className="row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn primary lg" onClick={() => void newDemo()} disabled={busy}>
                  <Icon name="demo" size={17} /> Crear demo (arranca en 60 s)
                </button>
                <Link className="btn lg" to="/operaciones/nueva">
                  <Icon name="plus" size={16} /> Nueva operación
                </Link>
              </div>
            }
          >
            El flujo es: <b>vault</b> (recintos, eventos y límites en Obsidian) → <b>operación</b> (qué, cuánto, a qué precio y con qué cuentas) → <b>armar</b> →
            en T0 el sistema asegura carritos → <b>pagas tú</b>.
          </Empty>
        </Card>
        <VaultCard />
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Sala de control</h1>
          <div className="sub">
            {active.length > 0 ? `${active.length} operación${active.length === 1 ? '' : 'es'} activa${active.length === 1 ? '' : 's'}` : 'Sin operaciones activas'}
            {nextT0 ? ` · próximo T0 ${fmtRel(nextT0.t0, now)}` : ''}
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void newDemo()} disabled={busy}>
            <Icon name="demo" size={15} /> Nueva demo
          </button>
          <Link className="btn primary" to="/operaciones/nueva">
            <Icon name="plus" size={15} /> Nueva operación
          </Link>
        </div>
      </div>

      <div className="grid cols-4">
        <Stat label="Entradas por pagar" value={ticketsInCarts} detail={pendingCarts.length ? `${pendingCarts.length} carritos · ${formatMoney(totalInCarts, pendingCarts[0]?.currency ?? 'EUR')}` : 'Ningún carrito pendiente'} />
        <Stat label="Operaciones activas" value={active.length} detail={nextT0 ? `Próximo T0 ${fmtRel(nextT0.t0, now)}` : `${ops.length} en total`} />
        <Stat label="Alertas críticas" value={critical} detail={`${openAlerts.length} abiertas en total`} />
        <Stat label="Tareas humanas" value={openTasks.length} detail={openTasks.length ? 'Te esperan en Tareas' : 'Nada pendiente'} />
      </div>

      {openTasks.length > 0 ? (
        <Callout tone="warning" icon="task">
          <b>{openTasks.length} tarea{openTasks.length === 1 ? '' : 's'} para una persona.</b> {openTasks[0]?.title}.{' '}
          <Link to="/tareas">Resolver ahora</Link>
        </Callout>
      ) : null}

      {focus ? <OperationHero op={focus} link /> : null}

      <div className="grid cols-2">
        <Card
          title="Carritos por pagar"
          actions={
            <Link className="btn sm" to="/carritos">
              Ver todos
            </Link>
          }
          flush
        >
          {pendingCarts.length === 0 ? (
            <div className="card-body muted">Cuando el sistema asegure entradas, aparecerán aquí con su cuenta atrás.</div>
          ) : (
            <table className="t">
              <tbody>
                {pendingCarts.slice(0, 6).map((c) => {
                  const left = c.expiresAt ? Date.parse(c.expiresAt) - now : null;
                  return (
                    <tr key={c.id}>
                      <td>
                        <b>{s.accounts[c.accountId]?.label ?? c.accountId}</b>
                        <div className="small muted">{c.items.map((i) => `${i.qty}× ${i.sectionLabel}`).join(' · ')}</div>
                      </td>
                      <td>
                        <CartPill state={c.state} />
                      </td>
                      <td className="num">{formatMoney(c.total, c.currency)}</td>
                      <td className="num">
                        {left === null ? '—' : <span className={`countdown ${left < 120_000 ? 'hot' : ''}`}>{left > 0 ? formatDuration(left) : 'caducado'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card
          title="Alertas abiertas"
          actions={
            <Link className="btn sm" to="/alertas">
              Ver todas
            </Link>
          }
          flush
        >
          {openAlerts.length === 0 ? <div className="card-body muted">Todo en orden.</div> : openAlerts.slice(0, 6).map((a) => <AlertRow key={a.id} alert={a} compact />)}
        </Card>
      </div>

      {others.length > 0 ? (
        <div className="grid cols-2">
          {others.map((o) => (
            <OperationHero key={o.id} op={o} link />
          ))}
        </div>
      ) : null}

      <VaultCard />
    </div>
  );
}

function VaultCard() {
  const s = useLive();
  const { run, busy } = useAction();
  const v = s.vault;
  return (
    <Card
      title="Vault de Obsidian"
      actions={
        <>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void run(() => Api.compileVault(), (r) => (r.applied ? 'Vault recompilado' : (r.reason ?? 'Vault con errores')))}>
            <Icon name="refresh" size={13} /> Recompilar
          </button>
          <Link className="btn sm" to="/recintos">
            Recintos
          </Link>
        </>
      }
    >
      {v ? (
        <div className="row" style={{ gap: 18 }}>
          <span className={`pill ${v.errors.length ? 'critical' : 'good'}`}>
            <Icon name={v.errors.length ? 'octagon' : 'check'} size={13} />
            {v.errors.length ? `${v.errors.length} errores` : 'Compilado sin errores'}
          </span>
          <span className="small ink2">
            {v.venues.length} recintos · {v.events} eventos · {v.providers} proveedores · {v.notes} notas · {v.durationMs} ms
          </span>
          <span className="small muted mono" title={v.vaultDir}>
            {v.vaultDir}
          </span>
          <span className="small muted">Se recompila solo cuando guardas una nota en Obsidian.</span>
        </div>
      ) : (
        <div className="muted">No hay vault configurado.</div>
      )}
    </Card>
  );
}
