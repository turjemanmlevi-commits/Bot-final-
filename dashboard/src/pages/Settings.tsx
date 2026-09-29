import { useState } from 'react';
import { Link } from 'react-router';
import type { ProviderAuthorization, ProviderDescriptor, ProviderMode } from '@to/shared';
import { Icon, type IconName } from '../components/Icon';
import { Callout, Card, Pill, type Tone } from '../components/ui';
import { Api } from '../lib/api';
import { fmtDateTime, fmtTime } from '../lib/format';
import { useToast } from '../lib/hooks';
import { useLive } from '../lib/store';

/** Mismo formato que acepta el servidor (TelegramTestSchema). */
const CHAT_ID_RE = /^-?\d{1,20}$/;

const MODE_PILL: Record<ProviderMode, { label: string; tone: Tone; icon: IconName | null }> = {
  SIMULATED: { label: 'Simulado', tone: 'neutral', icon: null },
  MANUAL_ASSIST: { label: 'Asistencia manual', tone: 'good', icon: 'user' },
  AUTHORIZED_API: { label: 'API autorizada', tone: 'neutral', icon: 'lock' },
};

const JOURNAL_DRIVER: Record<string, string> = {
  postgres: 'PostgreSQL',
  pglite: 'PGlite (carpeta data/)',
  memory: 'En memoria',
};

/** Copia al portapapeles; si el navegador no lo permite, usa un textarea temporal. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // se intenta el método alternativo
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

interface TestResult {
  ok: boolean;
  message: string;
  target: string;
  at: string;
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

function TelegramCard() {
  const s = useLive();
  const toast = useToast();
  const tg = s.system?.telegram ?? null;
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState('');
  const [last, setLast] = useState<TestResult | null>(null);

  const otherTrim = other.trim();
  const otherValid = CHAT_ID_RE.test(otherTrim);
  const enabled = Boolean(tg?.enabled);
  const bot = tg?.bot ? tg.bot.replace(/^@/, '') : null;
  const chats = tg?.recentChats ?? [];

  const sendTest = async (chatId?: string) => {
    if (chatId !== undefined && !CHAT_ID_RE.test(chatId)) {
      toast('El chat ID debe ser un número (los de grupo empiezan por «-»).', 'error');
      return;
    }
    const target = chatId === undefined ? 'Chat principal' : `Chat ${chatId}`;
    setBusy(true);
    try {
      const r = await Api.telegramTest(chatId);
      setLast({ ok: r.ok, message: r.message, target, at: new Date().toISOString() });
      toast(r.message, r.ok ? 'info' : 'error');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLast({ ok: false, message, target, at: new Date().toISOString() });
      toast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? 'Copiado' : 'No se pudo copiar: selecciónalo y cópialo a mano.', ok ? 'info' : 'error');
  };

  return (
    <Card title="Telegram">
      {!tg ? (
        <div className="muted">Cargando el estado de Telegram…</div>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row">
              {tg.enabled ? <Pill tone="good">Token configurado</Pill> : <Pill tone="critical">Sin token</Pill>}
              {tg.enabled ? tg.connected ? <Pill tone="good">Conectado</Pill> : <Pill tone="warning">Sin conexión</Pill> : null}
              {tg.mainChatConfigured ? <Pill tone="good">Chat principal configurado</Pill> : <Pill tone="warning">Falta TELEGRAM_CHAT_ID</Pill>}
              {bot ? (
                <Pill icon="send">
                  <span className="mono">@{bot}</span>
                </Pill>
              ) : null}
              {bot ? (
                <a className="btn sm ghost" href={`https://t.me/${encodeURIComponent(bot)}`} target="_blank" rel="noreferrer">
                  <Icon name="external" size={13} /> Abrir el bot en Telegram
                </a>
              ) : null}
            </div>
            {tg.detail ? <div className="small ink2">{tg.detail}</div> : null}
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <button type="button" className="btn primary" disabled={!enabled || busy} onClick={() => void sendTest()}>
                <Icon name="send" size={15} /> Enviar mensaje de prueba
              </button>
              <div className="field" style={{ width: 220 }}>
                <label htmlFor="tg-other">Otro chat ID (opcional)</label>
                <input
                  id="tg-other"
                  className="input mono"
                  inputMode="numeric"
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && enabled && !busy && otherValid) void sendTest(otherTrim);
                  }}
                  placeholder="-1001234567890"
                  aria-invalid={otherTrim !== '' && !otherValid}
                />
              </div>
              <button type="button" className="btn" disabled={!enabled || busy || !otherValid} onClick={() => void sendTest(otherTrim)}>
                Probar ese chat
              </button>
            </div>
            {otherTrim !== '' && !otherValid ? (
              <div className="small" style={{ color: 'var(--critical-ink)' }}>
                El chat ID es solo un número (hasta 20 cifras). Los de grupo empiezan por «-».
              </div>
            ) : null}
            {!enabled ? (
              <div className="small muted">Para enviar pruebas primero configura el token (pasos 1 a 3 de «Cómo configurarlo»).</div>
            ) : !tg.mainChatConfigured ? (
              <div className="small muted">Sin TELEGRAM_CHAT_ID la prueba principal no tiene destino: usa «Probar ese chat» o completa los pasos 4 y 5.</div>
            ) : null}
            {last ? (
              <Callout tone={last.ok ? 'good' : 'critical'}>
                <b>{last.target}</b> · {fmtTime(last.at)} — {last.message}
              </Callout>
            ) : null}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <h3 className="sign">Chats que han escrito al bot</h3>
            {chats.length === 0 ? (
              <div className="muted small">Cuando alguien escriba /start a tu bot aparecerá aquí con su chat ID.</div>
            ) : (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Chat ID</th>
                      <th>Estado</th>
                      <th>Hora</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {chats.map((c) => (
                      <tr key={c.chatId}>
                        <td>{c.name || '—'}</td>
                        <td>
                          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <span className="mono">{c.chatId}</span>
                            <button type="button" className="btn sm ghost" title="Copiar chat ID" aria-label={`Copiar chat ID ${c.chatId}`} onClick={() => void copy(c.chatId)}>
                              <Icon name="copy" size={13} />
                            </button>
                          </span>
                        </td>
                        <td>{c.known ? <Pill tone="good">ya configurado</Pill> : <Pill>nuevo</Pill>}</td>
                        <td className="mono small">{fmtTime(c.at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn sm" disabled={!enabled || busy} onClick={() => void sendTest(c.chatId)}>
                            <Icon name="send" size={13} /> Probar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="small muted">Solo en memoria: se borra al reiniciar el servidor.</div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <h3 className="sign">Cómo configurarlo (10 minutos)</h3>
            <ol style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 8, fontSize: 13 }}>
              <li>
                En Telegram, abre <b>@BotFather</b>, envía <code>/newbot</code>, ponle un nombre y un usuario que termine en «bot». Copia el token que te da (parece{' '}
                <code>123456789:AA…</code>).
              </li>
              <li>
                En la carpeta del proyecto abre el archivo <code>.env</code> con el Bloc de notas (lo crea <code>INICIAR.bat</code> la primera vez; si no lo ves, activa
                «Extensiones de nombre de archivo» en el Explorador) y escribe <code>TELEGRAM_BOT_TOKEN=&lt;tu token&gt;</code>. Guarda.
              </li>
              <li>
                Cierra la ventana negra del servidor y vuelve a abrir <code>INICIAR.bat</code>.
              </li>
              <li>
                En Telegram abre tu bot y pulsa <b>Iniciar</b>. Te contestará con tu chat ID (también aparece arriba, en «Chats que han escrito al bot»).
              </li>
              <li>
                Añade <code>TELEGRAM_CHAT_ID=&lt;ese número&gt;</code> al <code>.env</code>, guarda y reinicia otra vez.
              </li>
              <li>Pulsa «Enviar mensaje de prueba»: debe llegarte un mensaje.</li>
            </ol>
            <div className="stack small ink2" style={{ gap: 8 }}>
              <p style={{ margin: 0 }}>
                <b>Grupo (opcional):</b> crea un grupo, añade el bot y escribe <code>/id</code> en el grupo. El ID de un grupo empieza por «-»; úsalo como{' '}
                <code>TELEGRAM_CHAT_ID</code> y todo el grupo verá alertas y tareas.
              </p>
              <p style={{ margin: 0 }}>
                <b>Cada persona en su chat:</b> cada persona escribe <code>/start</code> al bot, te pasa su número y lo pones en <Link to="/cuentas">Cuentas</Link> → editar →
                «Chat de Telegram». Solo recibirá (y podrá responder) las tareas de su cuenta.
              </p>
              <p style={{ margin: 0 }}>
                <b>Comandos:</b> <code>/estado</code>, <code>/tareas</code>, <code>/pausa</code> y <code>/parar_todo</code> (solo el chat principal), <code>/id</code>,{' '}
                <code>/ayuda</code>.
              </p>
              <p style={{ margin: 0 }}>
                <b>Seguridad:</b> el token es secreto. El archivo <code>.env</code> no se sube a GitHub. Si se filtra, en @BotFather usa <code>/revoke</code> y pon el nuevo.
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

function automatedLabel(auth: ProviderAuthorization, providers: ProviderDescriptor[]): { text: string; title?: string } {
  const p = providers.find((x) => x.id === auth.providerId);
  if (!p) return { text: '—', title: 'Proveedor no registrado en el servidor' };
  const automated = p.capabilities.filter((c) => c.executor === 'AUTOMATED');
  if (automated.length === 0) return { text: 'nada' };
  const n = automated.length;
  const text = `${n} ${n === 1 ? 'capacidad' : 'capacidades'}${p.mode === 'SIMULATED' ? ' (solo simulación)' : ''}`;
  return { text, title: automated.map((c) => c.name).join(', ') };
}

function ProvidersCard() {
  const s = useLive();
  const providers = s.system?.providers ?? [];
  const auths = [...s.providerAuthorizations].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return (
    <Card title="Proveedores">
      <div className="stack">
        <Callout icon="shield">
          Ticketmaster, entradas.com y Real Madrid funcionan en asistencia manual: el sistema no entra en sus webs, no inicia sesión, no añade al carrito y nunca paga. Cada
          persona compra en la web oficial con su cuenta y aquí se coordina todo.
        </Callout>
        {auths.length === 0 ? (
          <div className="muted small">No hay proveedores cargados desde el vault.</div>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Modo</th>
                  <th>Web oficial</th>
                  <th>Automatizado</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {auths.map((a) => {
                  const mode = MODE_PILL[a.mode];
                  const auto = automatedLabel(a, providers);
                  return (
                    <tr key={a.providerId}>
                      <td>
                        <div className="stack" style={{ gap: 2 }}>
                          <b>{a.name}</b>
                          <span className="small muted mono">{a.providerId}</span>
                        </div>
                      </td>
                      <td>
                        <Pill tone={mode.tone} icon={mode.icon}>
                          {mode.label}
                        </Pill>
                      </td>
                      <td>
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noreferrer" className="row" style={{ gap: 4, flexWrap: 'nowrap', display: 'inline-flex' }}>
                            {a.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} <Icon name="external" size={13} />
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td title={auto.title}>{auto.text}</td>
                      <td className="small mono muted">{a.sourceFile}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="small muted">
          Se definen en el vault, carpeta <code>30 Proveedores</code>.
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------

function SystemCard() {
  const s = useLive();
  const sys = s.system;
  const journal = sys?.journal;
  return (
    <Card title="Sistema">
      <div className="stack">
        <dl className="kv">
          <dt>Versión</dt>
          <dd className="mono">{sys?.version ?? '—'}</dd>
          <dt>Journal</dt>
          <dd>
            {journal ? (
              <span className="row" style={{ gap: 8 }}>
                <span>{JOURNAL_DRIVER[journal.driver] ?? journal.driver}</span>
                {journal.healthy ? <Pill tone="good">correcto</Pill> : <Pill tone="warning">degradado</Pill>}
                {journal.pending > 0 ? <span className="small muted">{journal.pending} pendientes de guardar</span> : null}
              </span>
            ) : (
              '—'
            )}
          </dd>
          <dt>Vault</dt>
          <dd className="mono small">{s.vault?.vaultDir ?? '—'}</dd>
          <dt>Hora del servidor</dt>
          <dd>{fmtDateTime(sys?.now)}</dd>
          <dt>En marcha desde</dt>
          <dd>{fmtDateTime(sys?.startedAt)}</dd>
        </dl>
        {journal?.driver === 'memory' ? (
          <Callout tone="warning">
            Los datos están solo en memoria (<code>JOURNAL_DRIVER=memory</code>): al cerrar el servidor se pierde todo. Para guardarlos pon{' '}
            <code>JOURNAL_DRIVER=pglite</code> en el <code>.env</code> y reinicia antes de preparar la compra.
          </Callout>
        ) : journal?.driver === 'postgres' ? (
          <Callout icon="info">Todo se guarda en la base de datos PostgreSQL configurada en el <code>.env</code> (cuentas, operaciones, carritos y auditoría).</Callout>
        ) : (
          <Callout icon="info">
            Todo se guarda en la carpeta <code>data/</code> del proyecto (cuentas, operaciones, carritos y auditoría). No la borres entre la preparación y la compra.
          </Callout>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function SettingsPage() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Ajustes</h1>
          <div className="sub">Telegram, proveedores y datos del sistema.</div>
        </div>
      </div>
      <TelegramCard />
      <ProvidersCard />
      <SystemCard />
    </div>
  );
}
