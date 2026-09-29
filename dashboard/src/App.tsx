import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { DialogProvider, useDialog } from './components/Dialog';
import { Icon, type IconName } from './components/Icon';
import { Api, getActor, setActor, setToken } from './lib/api';
import { fmtTime } from './lib/format';
import { ToastProvider, useAction, useNow } from './lib/hooks';
import { live, useLive } from './lib/store';
import { AccountsPage } from './pages/Accounts';
import { AlertsPage } from './pages/Alerts';
import { AuditPage } from './pages/Audit';
import { CartsPage } from './pages/Carts';
import { EventsPage } from './pages/Events';
import { GuidePage } from './pages/Guide';
import { OperationDetailPage } from './pages/OperationDetail';
import { OperationFormPage } from './pages/OperationForm';
import { OperationsPage } from './pages/Operations';
import { OverviewPage } from './pages/Overview';
import { QualityPage } from './pages/Quality';
import { SafetyPage } from './pages/Safety';
import { SettingsPage } from './pages/Settings';
import { TasksPage } from './pages/Tasks';
import { VenueDetailPage, VenuesPage } from './pages/Venues';

type Theme = 'auto' | 'light' | 'dark';

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('to.theme') as Theme | null) ?? 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem('to.theme', theme);
    } catch {
      // sin almacenamiento: el tema no se recuerda
    }
  }, [theme]);
  return [theme, setTheme];
}

function NavItem({ to, icon, label, count, hot }: { to: string; icon: IconName; label: string; count?: number; hot?: boolean }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      <Icon name={icon} size={17} />
      <span className="label">{label}</span>
      {count ? <span className={`count ${hot ? 'hot' : ''}`}>{count}</span> : null}
    </NavLink>
  );
}

/** Pantalla estrecha: la navegación es una tira horizontal (mismo corte que styles.css). */
const NARROW_QUERY = '(max-width: 900px)';

/**
 * true cuando se ha perdido la conexión en vivo tras haber cargado datos. Espera
 * un momento antes de avisar para no parpadear en cada reconexión breve.
 */
function useConnectionLost(ready: boolean, connected: boolean): boolean {
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (!ready || connected) {
      setLost(false);
      return;
    }
    const t = setTimeout(() => setLost(true), 1500);
    return () => clearTimeout(t);
  }, [ready, connected]);
  return lost;
}

function Shell() {
  const s = useLive();
  const now = useNow(1000);
  const ask = useDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const { run, busy } = useAction();
  const [theme, setTheme] = useTheme();
  const [actor, setActorState] = useState(getActor());
  const navScrollRef = useRef<HTMLDivElement>(null);
  const connectionLost = useConnectionLost(s.ready, s.connected) && !s.unauthorized;

  // En móvil la navegación es una tira que se desplaza: el enlace activo se trae a la vista.
  useEffect(() => {
    let narrow = false;
    try {
      narrow = window.matchMedia(NARROW_QUERY).matches;
    } catch {
      narrow = false;
    }
    if (!narrow) return;
    const el = navScrollRef.current?.querySelector<HTMLElement>('.nav-link.active');
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [location.pathname]);

  const counts = useMemo(() => {
    const alerts = Object.values(s.alerts).filter((a) => a.state !== 'RESOLVED');
    return {
      alerts: alerts.length,
      critical: alerts.filter((a) => a.severity === 'CRITICAL').length,
      tasks: Object.values(s.humanTasks).filter((t) => t.state === 'OPEN').length,
      carts: Object.values(s.carts).filter((c) => c.state === 'ACTIVE' || c.state === 'REVIEW_REQUIRED').length,
      running: Object.values(s.operations).filter((o) => ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING'].includes(o.state)).length,
    };
  }, [s.alerts, s.humanTasks, s.carts, s.operations]);

  const globalKill = s.killSwitches.global?.engaged ? s.killSwitches.global : null;
  const journal = s.system?.journal;

  useEffect(() => {
    document.title = counts.critical > 0 ? `(${counts.critical}) Sala de control` : 'Sala de control · Ticket Orchestrator';
  }, [counts.critical]);

  const changeActor = async () => {
    const v = await ask({
      title: '¿Quién opera?',
      body: 'Tu nombre queda en la auditoría de cada acción (quién armó, quién pagó...). Usa un alias.',
      input: { label: 'Nombre o alias', defaultValue: actor },
      confirmText: 'Guardar',
    });
    if (typeof v === 'string' && v.trim()) {
      setActor(v);
      setActorState(v.trim());
    }
  };

  const newDemo = async () => {
    const scenario = await ask({
      title: 'Nueva demo contra el simulador',
      body: 'Crea cuentas ficticias y una operación que arranca en 60 s. Escenarios: demo, alta-demanda, caos, tranquilo.',
      input: { label: 'Escenario', defaultValue: 'demo' },
      confirmText: 'Crear demo',
    });
    if (typeof scenario !== 'string') return;
    const r = await run(() => Api.seedDemo({ startInSeconds: 60, scenarioId: scenario.trim() || 'demo' }), (x) => x.message);
    if (r) navigate(`/operaciones/${r.operationId}`);
  };

  return (
    <div className="shell">
      <nav className="nav" aria-label="Secciones">
        <div className="nav-scroll" ref={navScrollRef}>
          <NavLink to="/" className={`brand ${s.connected ? '' : 'off'}`} title={s.connected ? undefined : 'Sin conexión con el servidor'}>
            <span className="brand-mark">
              <Icon name="ticket" size={18} />
              {s.connected ? null : <span className="sr-only">Sin conexión con el servidor</span>}
            </span>
            <span className="brand-text">
              <span className="brand-name">Sala de control</span>
              <br />
              <span className="brand-sub">Ticket Orchestrator v4</span>
            </span>
          </NavLink>
          <div className="nav-group">
            <span className="sign">Operar</span>
            <NavItem to="/" icon="gauge" label="Resumen" />
            <NavItem to="/operaciones" icon="ops" label="Operaciones" count={counts.running} />
            <NavItem to="/tareas" icon="task" label="Tareas humanas" count={counts.tasks} hot={counts.tasks > 0} />
            <NavItem to="/carritos" icon="cart" label="Carritos" count={counts.carts} hot={counts.carts > 0} />
            <NavItem to="/alertas" icon="bell" label="Alertas" count={counts.alerts} hot={counts.critical > 0} />
          </div>
          <div className="nav-group">
            <span className="sign">Preparar</span>
            <NavItem to="/guia" icon="book" label="Cómo se compra" />
            <NavItem to="/cuentas" icon="users" label="Cuentas" />
            <NavItem to="/eventos" icon="calendar" label="Eventos" />
            <NavItem to="/recintos" icon="map" label="Recintos · vault" />
          </div>
          <div className="nav-group">
            <span className="sign">Controlar</span>
            <NavItem to="/seguridad" icon="shield" label="Seguridad" hot={Boolean(globalKill)} count={globalKill ? 1 : undefined} />
            <NavItem to="/calidad" icon="beaker" label="Calidad · gates" />
            <NavItem to="/auditoria" icon="scroll" label="Auditoría" />
            <NavItem to="/ajustes" icon="gear" label="Ajustes · Telegram" hot={Boolean(s.system && !s.system.telegram.enabled)} />
          </div>
          <div className="nav-foot">
            <button type="button" className="btn" onClick={() => void newDemo()} disabled={busy}>
              <Icon name="demo" size={15} /> Nueva demo
            </button>
            <div className="row small muted">
              <span className={`conn ${s.connected ? '' : 'off'}`}>
                <span className="dot" aria-hidden />
                {s.connected ? 'En vivo' : 'Sin conexión'}
              </span>
              <span className="mono">{s.system?.version ?? ''}</span>
            </div>
          </div>
        </div>
        <span className="nav-fade" aria-hidden />
      </nav>

      <div className="main">
        {connectionLost ? (
          <div className="banner warning offline" role="alert">
            <Icon name="alert" size={18} />
            <span className="banner-text">Sin conexión con el servidor: los datos pueden estar desactualizados</span>
          </div>
        ) : null}
        {globalKill ? (
          <div className="banner critical" role="alert">
            <Icon name="power" size={18} />
            <span className="banner-text">
              Kill switch GLOBAL activo{globalKill.reason ? ` — ${globalKill.reason}` : ''}: no se envía ninguna acción automática.
            </span>
            <NavLink to="/seguridad" className="btn sm" style={{ marginLeft: 'auto', background: '#fff', color: '#000', borderColor: '#fff' }}>
              Ir a Seguridad
            </NavLink>
          </div>
        ) : null}
        {journal && !journal.healthy ? (
          <div className="banner critical" role="alert">
            <Icon name="octagon" size={18} />
            <span className="banner-text">El journal no está guardando: la automatización está pausada hasta que se recupere.</span>
          </div>
        ) : null}
        <header className="topbar">
          <span className="clock" title="Hora local">
            {fmtTime(new Date(now).toISOString())}
          </span>
          {s.system ? (
            <span className="small ink2">
              Modo <b>{s.system.mode === 'SIMULATION' ? 'simulación' : s.system.mode === 'MANUAL_ASSIST' ? 'asistencia manual' : 'mixto'}</b> · journal <b>{journal?.driver}</b>
              {journal?.healthy ? '' : ' (degradado)'} · Telegram{' '}
              <NavLink to="/ajustes" title={s.system.telegram.detail}>
                <b>
                  {!s.system.telegram.enabled
                    ? 'desactivado'
                    : !s.system.telegram.connected
                      ? 'sin conexión'
                      : s.system.telegram.mainChatConfigured
                        ? 'conectado'
                        : 'falta el chat'}
                </b>
              </NavLink>
            </span>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn sm ghost" onClick={() => void changeActor()} title="Quién opera">
            <Icon name="user" size={14} /> {actor}
          </button>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => setTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')}
            title={`Tema: ${theme === 'auto' ? 'automático' : theme === 'dark' ? 'oscuro' : 'claro'}`}
          >
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={14} /> {theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Oscuro' : 'Claro'}
          </button>
        </header>
        <main className="content" id="contenido">
          {s.unauthorized ? (
            <TokenGate />
          ) : !s.ready ? (
            <div className="empty">
              <div className="big">Conectando…</div>
              <div>Si no conecta, arranca el servidor con <code>npm start</code> (o <code>npm run dev</code>).</div>
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/operaciones" element={<OperationsPage />} />
              <Route path="/operaciones/nueva" element={<OperationFormPage />} />
              <Route path="/operaciones/:id" element={<OperationDetailPage />} />
              <Route path="/operaciones/:id/editar" element={<OperationFormPage />} />
              <Route path="/tareas" element={<TasksPage />} />
              <Route path="/carritos" element={<CartsPage />} />
              <Route path="/alertas" element={<AlertsPage />} />
              <Route path="/cuentas" element={<AccountsPage />} />
              <Route path="/eventos" element={<EventsPage />} />
              <Route path="/recintos" element={<VenuesPage />} />
              <Route path="/recintos/:hash" element={<VenueDetailPage />} />
              <Route path="/seguridad" element={<SafetyPage />} />
              <Route path="/calidad" element={<QualityPage />} />
              <Route path="/auditoria" element={<AuditPage />} />
              <Route path="/ajustes" element={<SettingsPage />} />
              <Route path="/guia" element={<GuidePage />} />
              <Route path="*" element={<div className="empty"><div className="big">No existe</div><NavLink to="/">Volver al resumen</NavLink></div>} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  );
}

function TokenGate() {
  const [value, setValue] = useState('');
  return (
    <form
      className="card"
      style={{ maxWidth: 440, margin: '40px auto', padding: 20 }}
      onSubmit={(e) => {
        e.preventDefault();
        setToken(value.trim() || null);
        live.connect();
      }}
    >
      <h2 className="display" style={{ fontSize: 22, marginBottom: 10 }}>
        Token de operador
      </h2>
      <p className="ink2">El servidor tiene OPERATOR_TOKEN activado. Escribe el token para entrar.</p>
      <div className="field">
        <label htmlFor="tok">Token</label>
        <input id="tok" className="input mono" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" type="submit">
          Entrar
        </button>
      </div>
    </form>
  );
}

export function App() {
  useEffect(() => {
    live.connect();
  }, []);
  return (
    <ToastProvider>
      <DialogProvider>
        <Shell />
      </DialogProvider>
    </ToastProvider>
  );
}
