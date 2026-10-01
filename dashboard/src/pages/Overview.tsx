import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertRow, sortAlerts } from '../components/AlertList';
import { useDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { OperationHero } from '../components/OperationHero';
import { RealTestButton } from '../components/RealTestButton';
import { Callout, Card, CartPill, Empty, Pill, Stat } from '../components/ui';
import { Api } from '../lib/api';
import { fmtCountdown, formatMoney, fmtDateTime, fmtRel } from '../lib/format';
import { useAction, useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { isOpenCart, isSimCart, isTimeUp } from './Carts';

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
  // Carritos abiertos: primero los reales (por caducidad) y después los del simulador, que no se pagan.
  const pendingCarts = useMemo(
    () =>
      Object.values(s.carts)
        .filter(isOpenCart)
        .map((c) => ({ c, sim: isSimCart(c, s) }))
        .sort((a, b) => Number(a.sim) - Number(b.sim) || (a.c.expiresAt ?? '9').localeCompare(b.c.expiresAt ?? '9')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.carts, s.operations, s.system],
  );
  const realCarts = pendingCarts.filter((x) => !x.sim).map((x) => x.c);
  const openTasks = useMemo(() => Object.values(s.humanTasks).filter((t) => t.state === 'OPEN'), [s.humanTasks]);
  const critical = openAlerts.filter((a) => a.severity === 'CRITICAL').length;
  const ticketsInCarts = realCarts.reduce((n, c) => n + c.qty, 0);
  const totalInCarts = realCarts.reduce((n, c) => n + c.total, 0);
  const simInCarts = pendingCarts.length - realCarts.length;
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
                <RealTestButton className="btn primary lg" size={17} />
                <button type="button" className="btn lg" onClick={() => void newDemo()} disabled={busy}>
                  <Icon name="demo" size={17} /> Crear demo (arranca en 60 s)
                </button>
                <Link className="btn lg" to="/operaciones/nueva">
                  <Icon name="plus" size={16} /> Nueva operación
                </Link>
              </div>
            }
          >
            El flujo es: <b>vault</b> (recintos, eventos y límites en Obsidian) → <b>operación</b> (qué, cuánto, a qué precio y con qué cuentas) → <b>armar</b> →
            en T0 cada persona pone sus entradas en el carrito de la web oficial → <b>paga allí</b> y lo marca aquí.
          </Empty>
        </Card>
        <RealPurchaseChecklist />
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
          <RealTestButton />
          <button type="button" className="btn" onClick={() => void newDemo()} disabled={busy}>
            <Icon name="demo" size={15} /> Nueva demo
          </button>
          <Link className="btn primary" to="/operaciones/nueva">
            <Icon name="plus" size={15} /> Nueva operación
          </Link>
        </div>
      </div>

      <div className="grid cols-4">
        <Stat
          label="Entradas por pagar"
          value={ticketsInCarts}
          detail={
            realCarts.length
              ? `${realCarts.length} carrito${realCarts.length === 1 ? '' : 's'} · ${formatMoney(totalInCarts, realCarts[0]?.currency ?? 'EUR')}`
              : simInCarts
                ? `Ningún carrito real · ${simInCarts} de simulación`
                : 'Ningún carrito pendiente'
          }
        />
        <Stat label="Operaciones activas" value={active.length} detail={nextT0 ? `Próximo T0 ${fmtRel(nextT0.t0, now)}` : `${ops.length} en total`} />
        <Stat label="Alertas críticas" value={critical} detail={`${openAlerts.length} abiertas en total`} />
        <Stat label="Tareas humanas" value={openTasks.length} detail={openTasks.length ? 'Te esperan en Tareas' : 'Nada pendiente'} />
      </div>

      <RealPurchaseChecklist />

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
            <div className="card-body muted">Cuando alguien consiga entradas, aparecerán aquí con su cuenta atrás.</div>
          ) : (
            <table className="t">
              <tbody>
                {pendingCarts.slice(0, 6).map(({ c, sim }) => {
                  const left = c.expiresAt ? Date.parse(c.expiresAt) - now : null;
                  const timeUp = isTimeUp(c, now);
                  return (
                    <tr key={c.id}>
                      <td>
                        <b>{s.accounts[c.accountId]?.label ?? c.accountId}</b> {sim ? <span className="tag">Simulación (no se paga)</span> : null}
                        <div className="small muted">{c.items.map((i) => `${i.qty}× ${i.sectionLabel}`).join(' · ')}</div>
                      </td>
                      <td>
                        <CartPill state={c.state} />
                      </td>
                      <td className="num">{formatMoney(c.total, c.currency)}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {left === null ? (
                          '—'
                        ) : (
                          <span className={`countdown ${timeUp || left < 120_000 ? 'hot' : ''}`}>
                            {left > 0 ? fmtCountdown(left) : c.confirmation === 'HUMAN' ? 'tiempo agotado: ¿pagado?' : 'caducando…'}
                          </span>
                        )}
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

const REAL_ARMED = ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED'];

interface CheckStep {
  title: string;
  done: boolean;
  text: string;
  to: string;
  cta: string;
}

/** Lo mínimo para comprar entradas reales en asistencia manual, en orden. */
function RealPurchaseChecklist() {
  const s = useLive();
  const now = useNow(5000);
  const steps = useMemo<CheckStep[]>(() => {
    const providers = s.system?.providers ?? [];
    const modeOf = (pid: string) => providers.find((p) => p.id === pid)?.mode;
    const isReal = (pid: string) => {
      const mode = modeOf(pid);
      return mode !== undefined && mode !== 'SIMULATED';
    };

    const tg = s.system?.telegram;
    const tgDone = Boolean(tg?.enabled && tg.connected && tg.mainChatConfigured);
    const tgText = !tg
      ? 'Conectando con el servidor…'
      : tgDone
        ? `${tg.bot ? `Bot @${tg.bot.replace(/^@/, '')}` : 'Bot'} conectado y chat principal configurado.`
        : !tg.enabled
          ? 'Pega el token de tu bot en Ajustes · Telegram.'
          : !tg.connected
            ? tg.detail || 'El bot no responde: revisa el token.'
            : 'Abre el bot en Telegram, pulsa «Iniciar» y elige tu chat en Ajustes · Telegram.';

    const realAccounts = Object.values(s.accounts).filter(
      (a) => a.enabled && a.verification === 'VERIFIED' && a.providerId !== 'manual' && modeOf(a.providerId) === 'MANUAL_ASSIST',
    );

    // Proveedor genérico «manual», simulador o nota de demo: sirven para ensayar, no para la compra real.
    const isDemoLike = (providerId: string, eventId: string) =>
      providerId === 'sim' || providerId === 'manual' || (s.events[eventId]?.tags.includes('demo') ?? false);
    // Operaciones reales armadas, por T0.
    // Las de ensayo (proveedor «manual», simulador o evento demo) no cuentan para la compra real.
    const armedOps = Object.values(s.operations)
      .filter((o) => isReal(o.providerId) && REAL_ARMED.includes(o.state) && !isDemoLike(o.providerId, o.eventId))
      .sort((a, b) => a.t0.localeCompare(b.t0));
    const firstOp = armedOps[0];

    // El evento de la operación real armada; si no hay, el próximo evento real (ni simulador, ni
    // proveedor genérico «manual», ni notas de demo).
    const upcomingReal = Object.values(s.events)
      .filter((e) => !isDemoLike(e.providerId, e.id) && isReal(e.providerId) && Date.parse(e.startsAt) > now)
      .sort((a, b) => (a.onSaleAt ?? a.startsAt).localeCompare(b.onSaleAt ?? b.startsAt));
    const nextEvent = (firstOp ? s.events[firstOp.eventId] : undefined) ?? upcomingReal[0];
    const eventVerified = nextEvent !== undefined && nextEvent.limits.verified && nextEvent.limits.semantics !== 'UNKNOWN';
    const armedIds = new Set(armedOps.map((o) => o.id));
    const leased = Object.values(s.accounts).filter((a) => a.leasedBy !== null && armedIds.has(a.leasedBy));
    const readyCount = leased.filter((a) => a.session.state === 'READY').length;
    const sessionsDone = leased.length > 0 && readyCount === leased.length;
    const sessionsHint = 'Cada persona: inicia sesión en la web oficial y pulsa «Sesión lista» en Tareas.';

    return [
      { title: 'Telegram conectado', done: tgDone, text: tgText, to: '/ajustes', cta: 'Configurar' },
      {
        title: 'Cuentas reales',
        done: realAccounts.length > 0,
        text:
          realAccounts.length > 0
            ? `${realAccounts.length} cuenta${realAccounts.length === 1 ? '' : 's'} verificada${realAccounts.length === 1 ? '' : 's'} en webs oficiales.`
            : 'Crea una cuenta verificada por persona, con su proveedor real (no el simulador).',
        to: '/cuentas',
        cta: 'Cuentas',
      },
      {
        title: 'Evento con límites verificados',
        done: eventVerified,
        text: nextEvent
          ? `${nextEvent.name} · ${nextEvent.onSaleAt ? `venta ${fmtDateTime(nextEvent.onSaleAt)}` : `empieza ${fmtDateTime(nextEvent.startsAt)}`}.${
              eventVerified ? '' : ' Faltan los límites comprobados en la web oficial.'
            }`
          : 'Crea el evento con la hora de venta y los límites comprobados en la web oficial.',
        to: nextEvent ? `/eventos#${encodeURIComponent(nextEvent.id)}` : '/eventos',
        cta: 'Eventos',
      },
      {
        title: 'Operación armada',
        done: firstOp !== undefined,
        text: firstOp ? `${firstOp.name} · T0 ${fmtRel(firstOp.t0, now)}.` : 'Crea la operación (zonas, cantidad, precio máximo y cuentas) y pulsa «Armar».',
        to: firstOp ? `/operaciones/${firstOp.id}` : '/operaciones',
        cta: 'Operaciones',
      },
      {
        title: 'Sesiones listas',
        done: sessionsDone,
        text: leased.length > 0 ? `${readyCount}/${leased.length} cuentas con sesión lista.${sessionsDone ? '' : ` ${sessionsHint}`}` : sessionsHint,
        to: '/tareas',
        cta: 'Tareas',
      },
    ];
  }, [s.system, s.accounts, s.events, s.operations, now]);
  const doneCount = steps.filter((x) => x.done).length;

  return (
    <Card title="Compra real · lista de comprobación" actions={<span className="small muted mono">{doneCount}/{steps.length}</span>} flush>
      <div className="table-wrap">
        <table className="t">
          <tbody>
            {steps.map((st, i) => (
              <tr key={st.title}>
                <td style={{ width: 1, whiteSpace: 'nowrap' }}>
                  <Pill tone={st.done ? 'good' : 'warning'}>{st.done ? 'Hecho' : 'Pendiente'}</Pill>
                </td>
                <td>
                  <b>
                    {i + 1}. {st.title}
                  </b>
                  <div className="small muted">{st.text}</div>
                </td>
                <td style={{ width: 1, textAlign: 'right' }}>
                  <Link className="btn sm" to={st.to}>
                    {st.cta}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-body small muted">
        Paso a paso visual: <Link to="/guia">Cómo se compra</Link> · guía completa en la nota «Comprar entradas reales (paso a paso)» del vault.
      </div>
    </Card>
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
