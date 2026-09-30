import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { AiModelOption, FeedId, FeedStatus, ProviderAuthorization, ProviderDescriptor, ProviderMode } from '@to/shared';
import { Icon, type IconName } from '../components/Icon';
import { useDialog } from '../components/Dialog';
import { SendToSalaButton } from '../components/SendToSala';
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
  pglite: 'PGlite (en este ordenador)',
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
        Es la línea larga que va debajo de «Use this token to access the HTTP API». Se comprueba con Telegram y se guarda en el archivo <code>.env</code> de la carpeta del
        proyecto; si esa carpeta está en OneDrive (el Escritorio suele estarlo), OneDrive también sube ese archivo a tu nube. No hace falta reiniciar.
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
          {tg.enabled && tg.detail ? <div className="small ink2">{tg.detail}</div> : null}
          {last ? (
            <Callout tone={last.ok ? 'good' : 'critical'}>
              {fmtTime(last.at)} — {last.message}
            </Callout>
          ) : null}
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
            <b>Seguridad:</b> el token es secreto; está en el archivo <code>.env</code> de la carpeta del proyecto (y en tu nube, si esa carpeta está en OneDrive). Si se
            filtra, en @BotFather usa <code>/revoke</code> y pega aquí el nuevo. Otros chats que escriban al bot solo reciben su número: no ven nada ni pueden tocar nada.
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
            Todo se guarda en este ordenador (cuentas, operaciones, carritos y auditoría). La carpeta exacta sale al arrancar en la ventana negra, en la línea «Journal»: no la
            borres entre la preparación y la compra.
          </Callout>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Claude (IA): busca y lee los eventos de cada web de venta
// ---------------------------------------------------------------------------

/** La clave de Claude dentro de lo pegado (sk-ant-…). */
function extractAiKey(raw: string): string | null {
  return raw.match(/sk-ant-[A-Za-z0-9_-]{20,}/)?.[0] ?? null;
}

/** «4 $» / «0,5 $». */
function usd(n: number): string {
  return `${n.toLocaleString('es-ES', { maximumFractionDigits: 2 })} $`;
}

/**
 * Modelo de las búsquedas: el Sonnet más reciente (por defecto: el más
 * barato que lee bien los eventos) u otro de la cuenta. Se guarda en .env.
 */
function ClaudeModelPicker({ current, fixed }: { current: string | null; fixed: boolean }) {
  const toast = useToast();
  const [options, setOptions] = useState<AiModelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState(fixed ? (current ?? '') : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Api.aiModels()
      .then((r) => {
        if (alive) setOptions(r.options);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => setChoice(fixed ? (current ?? '') : ''), [current, fixed]);

  const saved = fixed ? (current ?? '') : '';
  const save = async () => {
    setBusy(true);
    try {
      const r = await Api.aiSetModel(choice || null);
      toast(r.message, r.ok ? 'info' : 'error');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="small muted">No se ha podido ver la lista de modelos: {error}</div>;
  if (!options) return <div className="small muted">Mirando los modelos de tu cuenta…</div>;
  const inList = options.some((o) => o.id === choice);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <label htmlFor="ai-model">Modelo para buscar y leer los eventos</label>
          <select id="ai-model" className="input" value={choice} disabled={busy} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Automático (lo más barato): el Sonnet más reciente de tu cuenta</option>
            {choice && !inList ? <option value={choice}>{choice}</option> : null}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {usd(o.input)} leer / {usd(o.output)} escribir (por millón)
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn" disabled={busy || choice === saved} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Usar este modelo'}
        </button>
      </div>
      <div className="small muted">
        <b>Sonnet</b> cuesta la mitad que <b>Opus</b> y es el que se usa por defecto. Si un evento sale incompleto (por ejemplo, sin el límite por persona), elige
        Opus y pulsa «Volver a analizar con Claude»; luego vuelve a Automático.
      </div>
    </div>
  );
}

function ClaudeCard() {
  const s = useLive();
  const toast = useToast();
  const ask = useDialog();
  const status = s.system?.ai ?? null;
  const [input, setInput] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Outcome | null>(null);

  const report = (ok: boolean, message: string) => {
    setLast({ ok, message, at: new Date().toISOString() });
    toast(message, ok ? 'info' : 'error');
  };
  const save = async (key: string | null) => {
    setBusy(true);
    try {
      const r = await Api.aiSetKey(key);
      report(r.ok, r.message);
      if (r.ok) {
        setInput('');
        setChanging(false);
      }
    } catch (e) {
      report(false, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  /** Quitar se confirma: la clave se borra del .env y habría que volver a pegarla. */
  const remove = async () => {
    const ok = await ask({
      title: '¿Quitar la clave de Claude?',
      body: 'Se borra del archivo .env de este ordenador y Claude deja de buscar y leer eventos hasta que pegues otra.',
      confirmText: 'Quitar la clave',
      danger: true,
    });
    if (ok) void save(null);
  };
  const connect = () => {
    const key = extractAiKey(input);
    if (!key) {
      report(false, 'Eso no parece una clave de Claude: empieza por «sk-ant-». Cópiala entera.');
      return;
    }
    void save(key);
  };

  const pill = !status?.configured ? (
    <Pill tone="warning">Sin clave</Pill>
  ) : status.ok === false ? (
    <Pill tone="critical">No funciona</Pill>
  ) : (
    <Pill tone="good">Conectado</Pill>
  );

  return (
    <Card title="Claude (IA)" id="claude" actions={pill}>
      {!status ? (
        <div className="muted">Cargando…</div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="small ink2">
            Al crear un evento eliges la web de venta y <b>Claude</b> mira sus próximos eventos. Al elegir uno, lee sus datos: la fecha y la hora, la apertura de la
            venta, <b>cuántas entradas se pueden comprar por persona</b> (con la frase de las condiciones), el recinto y su plano oficial, para que elijáis dónde queréis
            las entradas. Solo lee páginas públicas: no entra en ninguna cuenta ni compra nada. En Telegram también funciona: escribe <b>/evento</b> al bot.
          </div>
          {status.configured ? (
            <div className="small">
              {status.detail} · Modelo: <b>{status.model}</b> · Gastado desde que se abrió la sala: <b>{status.spentUsd.toFixed(2)} $</b> (aprox.)
            </div>
          ) : null}
          {status.configured && status.configurable ? <ClaudeModelPicker current={status.modelId} fixed={status.modelFixed} /> : null}
          {last ? (
            <Callout tone={last.ok ? 'good' : 'critical'}>
              {fmtTime(last.at)} — {last.message}
            </Callout>
          ) : null}
          {!status.configurable ? (
            <Callout tone="warning">
              Este servidor no permite ponerla desde aquí: escribe <code>ANTHROPIC_API_KEY</code> en el archivo <code>.env</code> y reinicia.
            </Callout>
          ) : status.configured && !changing ? (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn sm" disabled={busy} onClick={() => setChanging(true)}>
                Cambiar la clave
              </button>
              <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void remove()}>
                Quitar
              </button>
            </div>
          ) : (
            <>
              <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
                <li>
                  Entra en <b>platform.claude.com</b> con tu cuenta y, en <b>Billing</b>, añade crédito (se paga por consulta).
                </li>
                <li>
                  En <b>API keys</b> pulsa <b>Create key</b>, ponle un nombre (p. ej. «Sala de control») y copia la clave (empieza por <code>sk-ant-</code>).
                </li>
                <li>Pégala aquí y pulsa «Conectar».</li>
              </ol>
              <div>
                <a className="btn sm" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
                  <Icon name="external" size={13} /> Abrir API keys
                </a>
              </div>
              <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <label htmlFor="ai-key">Clave de la API de Claude</label>
                  <input
                    id="ai-key"
                    className="input mono"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy && input.trim()) connect();
                    }}
                    placeholder="sk-ant-…"
                  />
                </div>
                <button type="button" className="btn primary" disabled={busy || !input.trim()} onClick={connect}>
                  <Icon name="link" size={15} /> {busy ? 'Comprobando…' : 'Conectar'}
                </button>
                {changing ? (
                  <button type="button" className="btn" disabled={busy} onClick={() => setChanging(false)}>
                    Cancelar
                  </button>
                ) : null}
              </div>
              <div className="small muted">
                Se comprueba al momento y se guarda en el archivo .env de la carpeta del proyecto; si esa carpeta está en OneDrive (el Escritorio suele estarlo), OneDrive
                también sube ese archivo a tu nube. Nunca la pegues en un chat: si lo has hecho, bórrala en platform.claude.com y crea otra.
              </div>
            </>
          )}
          <div className="small muted">
            Cada búsqueda cuesta unos céntimos (lo cobra Anthropic a tu cuenta; el total real está en platform.claude.com). Las respuestas se guardan, también al
            reiniciar: repetir la misma búsqueda es gratis (la lista de eventos durante 6 horas; los datos de un evento, 12 horas). «Buscar otra vez» pregunta de nuevo y
            se paga. Claude no interviene en la compra: al abrir la venta, el bot avisa al segundo.
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fuentes oficiales de eventos
// ---------------------------------------------------------------------------

/** La clave dentro de lo pegado (sin espacios, comillas ni «Consumer Key:» delante). */
function extractKey(raw: string): string | null {
  const words = raw.match(/[A-Za-z0-9_-]{20,100}/g) ?? [];
  return words.sort((a, b) => b.length - a.length)[0] ?? null;
}

const FEED_STEPS: Record<FeedId, { title: string; what: string; steps: ReactNode; label: string; placeholder: string; signup: string; signupLabel: string }> = {
  ticketmaster: {
    title: 'Ticketmaster',
    what: 'Próximos eventos de cada recinto en Ticketmaster, con la hora de la venta (y las preventas) y el límite de compra oficiales. Y la vigilancia antes de la venta.',
    steps: (
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        <li>
          Entra en <b>developer.ticketmaster.com</b> y pulsa <b>Get your API key</b> (crear cuenta: nombre, email y contraseña; es gratis).
        </li>
        <li>
          Confirma el email. Arriba a la derecha, tu nombre → <b>My Apps</b>: ya hay una app creada.
        </li>
        <li>
          Copia la <b>Consumer Key</b> (la primera clave larga; la «Consumer Secret» no hace falta) y pégala aquí.
        </li>
      </ol>
    ),
    label: 'Consumer Key de Ticketmaster',
    placeholder: 'p. ej. 7elxdku9GGG5k8j0Xm8KWdANDgecHMV0',
    signup: 'https://developer-acct.ticketmaster.com/user/register',
    signupLabel: 'Crear la clave gratis',
  },
  football: {
    title: 'Partidos de LaLiga y Champions',
    what: 'Próximos partidos en casa de cada estadio de LaLiga (Real Madrid en el Bernabéu, Atlético en el Metropolitano…), con la fecha y la hora oficiales, y aviso cuando LaLiga fija o cambia la hora.',
    steps: (
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        <li>
          Entra en <b>football-data.org</b> → <b>Register</b> (nombre y email; plan <b>Free</b>).
        </li>
        <li>Te llega un email con tu «API token» (una clave larga).</li>
        <li>Cópialo y pégalo aquí.</li>
      </ol>
    ),
    label: 'Token de football-data.org',
    placeholder: 'p. ej. 0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    signup: 'https://www.football-data.org/client/register',
    signupLabel: 'Pedir el token gratis',
  },
};

function FeedBlock({ feed, status, configurable }: { feed: FeedId; status: FeedStatus; configurable: boolean }) {
  const toast = useToast();
  const ask = useDialog();
  const info = FEED_STEPS[feed];
  const [input, setInput] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Outcome | null>(null);

  const report = (ok: boolean, message: string) => {
    setLast({ ok, message, at: new Date().toISOString() });
    toast(message, ok ? 'info' : 'error');
  };

  const save = async (key: string | null) => {
    setBusy(true);
    try {
      const r = await Api.feedSetKey(feed, key);
      report(r.ok, r.message);
      if (r.ok) {
        setInput('');
        setChanging(false);
      }
    } catch (e) {
      report(false, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await ask({
      title: `¿Quitar la clave de ${info.title}?`,
      body: 'Se borra del archivo .env de este ordenador: la lista oficial y la vigilancia con consultas dejan de funcionar hasta que pongas otra.',
      confirmText: 'Quitar la clave',
      danger: true,
    });
    if (ok) void save(null);
  };

  const connect = () => {
    const key = extractKey(input);
    if (!key) {
      report(false, 'Eso no parece una clave: copia la clave larga entera (solo letras y números).');
      return;
    }
    void save(key);
  };

  const pill = !status.configured ? (
    <Pill tone="warning">Sin clave</Pill>
  ) : status.ok === false ? (
    <Pill tone="critical">No funciona</Pill>
  ) : status.ok ? (
    <Pill tone="good">Conectado</Pill>
  ) : (
    <Pill tone="good">Clave puesta</Pill>
  );

  const form = (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <label htmlFor={`feed-${feed}`}>{info.label}</label>
          <input
            id={`feed-${feed}`}
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy && input.trim()) connect();
            }}
            placeholder={info.placeholder}
          />
        </div>
        <button type="button" className="btn primary" disabled={busy || !input.trim()} onClick={connect}>
          <Icon name="link" size={15} /> {busy ? 'Comprobando…' : 'Conectar'}
        </button>
        {changing ? (
          <button type="button" className="btn" disabled={busy} onClick={() => setChanging(false)}>
            Cancelar
          </button>
        ) : null}
      </div>
      <div className="small muted">
        Se comprueba al momento y se guarda en el archivo .env de la carpeta del proyecto; si esa carpeta está en OneDrive (el Escritorio suele estarlo), OneDrive también
        sube ese archivo a tu nube. No hace falta reiniciar.
      </div>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <b style={{ fontSize: 16 }}>{info.title}</b>
        {pill}
      </div>
      <div className="small ink2">{info.what}</div>
      {status.configured ? <div className="small">{status.detail}</div> : null}
      {last ? (
        <Callout tone={last.ok ? 'good' : 'critical'}>
          {fmtTime(last.at)} — {last.message}
        </Callout>
      ) : null}
      {!configurable ? (
        <Callout tone="warning">
          Este servidor no permite ponerla desde aquí: escribe <code>{feed === 'ticketmaster' ? 'TICKETMASTER_API_KEY' : 'FOOTBALL_DATA_TOKEN'}</code> en el archivo{' '}
          <code>.env</code> y reinicia.
        </Callout>
      ) : status.configured && !changing ? (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn sm" disabled={busy} onClick={() => setChanging(true)}>
            Cambiar la clave
          </button>
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void remove()}>
            Quitar
          </button>
        </div>
      ) : (
        <>
          <div className="small">{info.steps}</div>
          <div>
            <a className="btn sm" href={info.signup} target="_blank" rel="noreferrer">
              <Icon name="external" size={13} /> {info.signupLabel}
            </a>
          </div>
          {form}
        </>
      )}
    </div>
  );
}

function FeedsCard() {
  const s = useLive();
  const feeds = s.system?.feeds ?? null;
  return (
    <Card title="Fuentes de eventos (gratis)" id="fuentes">
      {!feeds ? (
        <div className="muted">Cargando…</div>
      ) : (
        <div className="stack" style={{ gap: 22 }}>
          <div className="stack" style={{ gap: 8 }}>
            <b style={{ fontSize: 16 }}>Sin claves: botón «📥 Enviar a la sala»</b>
            <div className="small ink2">
              Funciona con cualquier web oficial (Ticketmaster, entradas.com, realmadrid.com…): abres el evento en tu navegador, pulsas el botón y la sala se abre con el
              evento relleno (nombre, fecha, recinto, enlace, apertura de la venta y límite, si la página los enseña). Solo lee lo que tú estás viendo, cuando lo pulsas.
            </div>
            <SendToSalaButton compact />
          </div>
          <div className="divider" />
          <div className="small ink2">
            <b>Opcional, con clave gratuita:</b> la lista de próximos eventos de Ticketmaster (toda España) y de los partidos de LaLiga y Champions dentro de la sala, y la
            vigilancia de cambios oficiales (hora de venta, preventas, límite, cancelación). Solo leen datos públicos: no entran en ninguna web de venta ni compran nada.
          </div>
          <FeedBlock feed="ticketmaster" status={feeds.ticketmaster} configurable={feeds.configurable} />
          <div className="divider" />
          <FeedBlock feed="football" status={feeds.football} configurable={feeds.configurable} />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function SettingsPage() {
  const location = useLocation();
  // /ajustes#fuentes lleva directamente a esa tarjeta.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [location.hash]);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Ajustes</h1>
          <div className="sub">Claude (IA), Telegram, fuentes de eventos, proveedores y datos del sistema.</div>
        </div>
      </div>
      <ClaudeCard />
      <TelegramCard />
      <FeedsCard />
      <ProvidersCard />
      <SystemCard />
    </div>
  );
}
