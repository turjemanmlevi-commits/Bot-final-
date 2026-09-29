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

interface Outcome {
  ok: boolean;
  message: string;
  at: string;
}

/** El token dentro de lo pegado, aunque venga con el texto de @BotFather alrededor. */
function extractToken(raw: string): string | null {
  const m = /\d{3,20}:[A-Za-z0-9_-]{20,100}/.exec(raw);
  return m ? m[0] : null;
}

const BOT_COMMANDS: Array<[string, string]> = [
  ['/tareas', 'tus tareas abiertas, con botones'],
  ['/estado', 'cómo va cada operación'],
  ['/ayuda', 'cómo responder rápido'],
  ['/pausa', 'pausar lo que está en marcha (chat principal)'],
  ['/parar_todo', 'parar todo al instante (chat principal)'],
  ['/id', 'número de este chat'],
];

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

function StepHead({ n, done, title }: { n: number; done: boolean; title: string }) {
  return (
    <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
      <span
        aria-hidden
        style={{
          flex: '0 0 auto',
          width: 28,
          height: 28,
          borderRadius: 14,
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          fontSize: 14,
          background: done ? 'var(--good)' : 'var(--ink)',
          color: done ? '#fff' : 'var(--surface)',
        }}
      >
        {done ? <Icon name="check" size={15} /> : n}
      </span>
      <b style={{ fontSize: 15 }}>{title}</b>
      {done ? <span className="sr-only">(hecho)</span> : null}
    </div>
  );
}

function TelegramCard() {
  const s = useLive();
  const toast = useToast();
  const tg = s.system?.telegram ?? null;
  const [busy, setBusy] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [changingToken, setChangingToken] = useState(false);
  const [manualChat, setManualChat] = useState('');
  const [changingChat, setChangingChat] = useState(false);
  const [other, setOther] = useState('');
  const [last, setLast] = useState<Outcome | null>(null);

  const bot = tg?.bot ? tg.bot.replace(/^@/, '') : null;
  const chats = tg?.recentChats ?? [];
  const accounts = Object.values(s.accounts).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  const botDone = Boolean(tg?.enabled && tg.connected && bot);
  const mainDone = Boolean(tg?.mainChatConfigured);
  const mainName = tg?.mainChatId ? chats.find((c) => c.chatId === tg.mainChatId)?.name : undefined;
  const manualTrim = manualChat.trim();
  const manualValid = CHAT_ID_RE.test(manualTrim);
  const otherTrim = other.trim();
  const otherValid = CHAT_ID_RE.test(otherTrim);

  const report = (ok: boolean, message: string) => {
    setLast({ ok, message, at: new Date().toISOString() });
    toast(message, ok ? 'info' : 'error');
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      report(false, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    guard(async () => {
      const token = extractToken(tokenInput);
      if (!token) {
        report(false, 'Eso no parece un token de @BotFather. Copia entera la línea larga que va debajo de «Use this token to access the HTTP API».');
        return;
      }
      const r = await Api.telegramSetToken(token);
      report(r.ok, r.message);
      if (r.ok) {
        setTokenInput('');
        setChangingToken(false);
      }
    });

  const adoptMain = (chatId: string) =>
    guard(async () => {
      if (!CHAT_ID_RE.test(chatId)) {
        report(false, 'El chat ID es un número (los de grupo empiezan por «-»).');
        return;
      }
      const r = await Api.telegramSetMainChat(chatId);
      report(r.ok, r.message);
      setChangingChat(false);
      setManualChat('');
    });

  const sendTest = (chatId?: string) =>
    guard(async () => {
      if (chatId !== undefined && !CHAT_ID_RE.test(chatId)) {
        report(false, 'El chat ID debe ser un número (los de grupo empiezan por «-»).');
        return;
      }
      const r = await Api.telegramTest(chatId);
      report(r.ok, r.message);
    });

  const assign = (chatId: string, accountId: string) =>
    guard(async () => {
      const acc = s.accounts[accountId];
      if (!acc) return;
      await Api.updateAccount(accountId, { telegramChatId: chatId });
      report(true, `Chat ${chatId} asignado a «${acc.label}»: recibirá sus tareas y le ha llegado un mensaje de bienvenida.`);
    });

  const copy = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? 'Copiado' : 'No se pudo copiar: selecciónalo y cópialo a mano.', ok ? 'info' : 'error');
  };

  const roleOf = (chatId: string): { text: string; tone: Tone } => {
    if (chatId === tg?.mainChatId) return { text: 'chat principal', tone: 'good' };
    const acc = accounts.filter((a) => a.telegramChatId === chatId);
    if (acc.length > 0) return { text: `cuenta ${acc.map((a) => a.label).join(', ')}`, tone: 'good' };
    return { text: 'nuevo', tone: 'neutral' };
  };

  if (!tg) {
    return (
      <Card title="Telegram">
        <div className="muted">Cargando el estado de Telegram…</div>
      </Card>
    );
  }

  if (!tg.configurable) {
    return (
      <Card title="Telegram">
        <div className="stack">
          <div className="row">
            {tg.enabled ? <Pill tone="good">Token configurado</Pill> : <Pill tone="critical">Sin token</Pill>}
            {tg.mainChatConfigured ? <Pill tone="good">Chat principal configurado</Pill> : <Pill tone="warning">Falta el chat principal</Pill>}
          </div>
          <div className="small ink2">{tg.detail}</div>
          <Callout tone="warning">
            Este servidor no permite configurar Telegram desde aquí: pon <code>TELEGRAM_BOT_TOKEN</code> y <code>TELEGRAM_CHAT_ID</code> en el archivo <code>.env</code> y reinicia.
          </Callout>
        </div>
      </Card>
    );
  }

  const tokenForm = (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <label htmlFor="tg-token">Token del bot (te lo da @BotFather)</label>
          <input
            id="tg-token"
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy && tokenInput.trim()) void connect();
            }}
            placeholder="1234567890:AAE…"
          />
        </div>
        <button type="button" className="btn primary" disabled={busy || !tokenInput.trim()} onClick={() => void connect()}>
          <Icon name="link" size={15} /> Conectar
        </button>
        {changingToken ? (
          <button type="button" className="btn" disabled={busy} onClick={() => setChangingToken(false)}>
            Cancelar
          </button>
        ) : null}
      </div>
      <div className="small muted">
        Es la línea larga que va debajo de «Use this token to access the HTTP API». Se comprueba con Telegram y se guarda solo en este ordenador (archivo <code>.env</code>, que
        no se sube a ningún sitio). No hace falta reiniciar.
      </div>
    </div>
  );

  return (
    <Card title="Telegram">
      <div className="stack" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            {!tg.enabled ? <Pill tone="warning">Sin configurar</Pill> : tg.connected ? <Pill tone="good">Bot conectado</Pill> : <Pill tone="warning">Sin conexión</Pill>}
            {tg.mainChatConfigured ? <Pill tone="good">Chat principal listo</Pill> : <Pill tone="warning">Falta el chat principal</Pill>}
            {bot ? (
              <Pill icon="send">
                <span className="mono">@{bot}</span>
              </Pill>
            ) : null}
          </div>
          {tg.detail ? <div className="small ink2">{tg.detail}</div> : null}
        </div>

        {/* 1 · Token */}
        <div className="stack" style={{ gap: 10 }}>
          <StepHead n={1} done={botDone} title="Conecta tu bot" />
          {tg.enabled && !changingToken ? (
            <div className="stack" style={{ gap: 8 }}>
              {botDone ? (
                <div className="row" style={{ gap: 10 }}>
                  <span>
                    Conectado como <b className="mono">@{bot}</b>. El menú de comandos y la descripción del bot se han puesto solos.
                  </span>
                  <button type="button" className="btn sm ghost" disabled={busy} onClick={() => setChangingToken(true)}>
                    Cambiar token
                  </button>
                </div>
              ) : (
                <>
                  <Callout tone="warning">{tg.detail || 'Conectando con Telegram…'}</Callout>
                  {tokenForm}
                </>
              )}
            </div>
          ) : (
            tokenForm
          )}
        </div>

        {/* 2 · Iniciar */}
        <div className="stack" style={{ gap: 10 }}>
          <StepHead n={2} done={mainDone || chats.length > 0} title="Abre el bot en Telegram y pulsa «Iniciar»" />
          {bot ? (
            <div className="row" style={{ gap: 10 }}>
              <a className="btn" href={`https://t.me/${encodeURIComponent(bot)}`} target="_blank" rel="noreferrer">
                <Icon name="external" size={14} /> Abrir @{bot}
              </a>
              <span className="small ink2">Pulsa «Iniciar» (o escribe /start). Tu nombre aparece abajo al momento.</span>
            </div>
          ) : (
            <div className="small muted">Primero conecta el bot (paso 1).</div>
          )}
        </div>

        {/* 3 · Chat principal */}
        <div className="stack" style={{ gap: 10 }}>
          <StepHead n={3} done={mainDone} title="Elige tu chat principal" />
          {mainDone && !changingChat ? (
            <div className="row" style={{ gap: 10 }}>
              <span>
                Chat principal: <b>{mainName ?? 'tu chat'}</b> <span className="mono small muted">({tg.mainChatId})</span>. Aquí llega todo y desde aquí se puede pausar o parar.
              </span>
              <button type="button" className="btn sm ghost" disabled={busy} onClick={() => setChangingChat(true)}>
                Cambiar
              </button>
            </div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {chats.length === 0 ? (
                <div className="small muted">{tg.enabled ? 'Esperando a que alguien escriba /start al bot…' : 'Cuando el bot esté conectado, los chats que le escriban aparecerán aquí.'}</div>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {chats.map((c) => (
                    <div key={c.chatId} className="row" style={{ gap: 10 }}>
                      <button type="button" className="btn primary sm" disabled={busy} onClick={() => void adoptMain(c.chatId)}>
                        <Icon name="check" size={13} /> Usar como chat principal
                      </button>
                      <b>{c.name || '—'}</b>
                      <span className="mono small muted">{c.chatId}</span>
                      <span className="small muted">escribió a las {fmtTime(c.at)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
                <div className="field" style={{ width: 240 }}>
                  <label htmlFor="tg-main-manual">O escribe el chat ID (grupos: empieza por «-»)</label>
                  <input
                    id="tg-main-manual"
                    className="input mono"
                    inputMode="numeric"
                    value={manualChat}
                    onChange={(e) => setManualChat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy && manualValid) void adoptMain(manualTrim);
                    }}
                    placeholder="123456789"
                    aria-invalid={manualTrim !== '' && !manualValid}
                  />
                </div>
                <button type="button" className="btn" disabled={busy || !manualValid} onClick={() => void adoptMain(manualTrim)}>
                  Usar este chat
                </button>
                {changingChat ? (
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => setChangingChat(false)}>
                    Cancelar
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* 4 · Prueba */}
        <div className="stack" style={{ gap: 10 }}>
          <StepHead n={4} done={false} title="Prueba" />
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn primary" disabled={busy || !tg.enabled || !tg.mainChatConfigured} onClick={() => void sendTest()}>
              <Icon name="send" size={15} /> Enviar mensaje de prueba
            </button>
            <span className="small ink2">Te llegará un mensaje al chat principal. Escribe /ayuda al bot para ver cómo responder rápido.</span>
          </div>
          {last ? (
            <Callout tone={last.ok ? 'good' : 'critical'}>
              {fmtTime(last.at)} — {last.message}
            </Callout>
          ) : null}
        </div>

        {/* Cada persona en su chat */}
        <div className="stack" style={{ gap: 8 }}>
          <h3 className="sign">Cada persona en su chat (opcional)</h3>
          <div className="small ink2">
            Cada persona que vaya a comprar abre el bot y pulsa «Iniciar». Aparece aquí: elige su cuenta y recibirá solo sus tareas (y podrá responderlas con un toque).
          </div>
          {chats.length === 0 ? (
            <div className="muted small">Todavía no ha escrito nadie al bot.</div>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Chat ID</th>
                    <th>Ahora</th>
                    <th>Asignar a una cuenta</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {chats.map((c) => {
                    const role = roleOf(c.chatId);
                    return (
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
                        <td>
                          <Pill tone={role.tone}>{role.text}</Pill>
                        </td>
                        <td>
                          <select
                            className="input"
                            aria-label={`Asignar el chat ${c.chatId} a una cuenta`}
                            value=""
                            disabled={busy || accounts.length === 0}
                            onChange={(e) => {
                              if (e.target.value) void assign(c.chatId, e.target.value);
                            }}
                          >
                            <option value="">{accounts.length === 0 ? 'Crea antes las cuentas' : 'Elegir cuenta…'}</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id} disabled={a.telegramChatId === c.chatId}>
                                {a.label}
                                {a.telegramChatId && a.telegramChatId !== c.chatId ? ' (tiene otro chat)' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn sm" disabled={busy || !tg.enabled} onClick={() => void sendTest(c.chatId)}>
                            <Icon name="send" size={13} /> Probar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="small muted">
            La lista se guarda solo en memoria: tras reiniciar el servidor, quien no esté asignado vuelve a escribir /start. También se puede poner en{' '}
            <Link to="/cuentas">Cuentas</Link> → editar → «Chat de Telegram».
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ width: 220 }}>
              <label htmlFor="tg-other">Probar otro chat ID</label>
              <input
                id="tg-other"
                className="input mono"
                inputMode="numeric"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tg.enabled && !busy && otherValid) void sendTest(otherTrim);
                }}
                placeholder="-1001234567890"
                aria-invalid={otherTrim !== '' && !otherValid}
              />
            </div>
            <button type="button" className="btn" disabled={!tg.enabled || busy || !otherValid} onClick={() => void sendTest(otherTrim)}>
              Probar ese chat
            </button>
          </div>
        </div>

        {/* Ayuda */}
        <div className="stack small ink2" style={{ gap: 8 }}>
          <h3 className="sign">Cómo funciona</h3>
          <p style={{ margin: 0 }}>
            <b>Crear el bot:</b> en Telegram abre <b>@BotFather</b>, envía <code>/newbot</code>, ponle un nombre y un usuario que termine en «bot» y copia el token en el paso 1.
          </p>
          <p style={{ margin: 0 }}>
            <b>Comandos del bot</b> (el menú se pone solo al conectar):{' '}
            {BOT_COMMANDS.map(([cmd, text], i) => (
              <span key={cmd}>
                <code>{cmd}</code> {text}
                {i < BOT_COMMANDS.length - 1 ? ' · ' : '.'}
              </span>
            ))}
          </p>
          <p style={{ margin: 0 }}>
            <b>Grupo (opcional):</b> crea un grupo, añade el bot y escribe <code>/id</code> en el grupo; usa ese número (empieza por «-») como chat principal y todo el grupo verá
            alertas y tareas.
          </p>
          <p style={{ margin: 0 }}>
            <b>Seguridad:</b> el token es secreto; solo está en el archivo <code>.env</code> de este ordenador. Si se filtra, en @BotFather usa <code>/revoke</code> y pega aquí el
            nuevo. Otros chats que escriban al bot solo reciben su número: no ven nada ni pueden tocar nada.
          </p>
        </div>
      </div>
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
