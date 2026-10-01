import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { Account, AccountInput, ProviderMode } from '@to/shared';
import { useDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Callout, Card, Empty, Pill, QueuePill, SessionPill } from '../components/ui';
import { Api, ApiError } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useLive } from '../lib/store';

const EMPTY_FORM: AccountInput = {
  label: '',
  providerId: '',
  holderRef: '',
  householdRef: null,
  paymentRef: null,
  verification: 'VERIFIED',
  eligibility: ['*'],
  enabled: true,
  telegramChatId: null,
};

const MODE_ORDER: Record<ProviderMode, number> = { MANUAL_ASSIST: 0, AUTHORIZED_API: 1, SIMULATED: 2 };

const MODE_SUFFIX: Record<ProviderMode, string> = {
  MANUAL_ASSIST: 'asistencia manual',
  AUTHORIZED_API: 'API autorizada',
  SIMULATED: 'simulador (solo ensayos)',
};

const FIELD_LABEL: Record<string, string> = {
  holderRef: 'Titular',
  householdRef: 'Hogar',
  paymentRef: 'Medio de pago',
  telegramChatId: 'Chat de Telegram',
  label: 'Nombre visible',
};

/** Mensajes de zod en inglés que puede devolver el servidor, en castellano. */
function zodToSpanish(msg: string): string {
  const min = /^Too small: expected string to have >=?(\d+) characters?$/i.exec(msg);
  if (min) return min[1] === '1' ? 'no puede estar vacío' : `mínimo ${min[1]} caracteres`;
  const max = /^Too big: expected string to have <=?(\d+) characters?$/i.exec(msg);
  if (max) return `máximo ${max[1]} caracteres`;
  if (/^Invalid input: expected string/i.test(msg)) return 'tiene que ser un texto';
  return msg;
}

/** «holderRef: Usa un alias…; label: Too small…» → «Titular: Usa un alias…; Nombre visible: no puede estar vacío». */
function accountErrorText(message: string): string {
  return message
    .split('; ')
    .map((part) => {
      const m = /^(holderRef|householdRef|paymentRef|telegramChatId|label)(?:\.\S*)?: (.*)$/s.exec(part);
      if (!m) return part;
      return `${FIELD_LABEL[m[1] ?? ''] ?? m[1]}: ${zodToSpanish(m[2] ?? '')}`;
    })
    .join('; ');
}

/** Ejecuta una llamada de cuentas traduciendo los nombres de campo del error. */
async function withFieldLabels<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) throw new ApiError(e.status, e.code, accountErrorText(e.message));
    throw e;
  }
}

function AccountForm({ initial, onDone }: { initial?: Account; onDone: () => void }) {
  const s = useLive();
  const { run, busy } = useAction();
  // Chats que han escrito al bot: se eligen en el campo «Chat de Telegram» sin copiar números.
  const tgChats = s.system?.telegram.recentChats ?? [];
  const [f, setF] = useState<AccountInput>(
    initial
      ? {
          label: initial.label,
          providerId: initial.providerId,
          holderRef: initial.holderRef,
          householdRef: initial.householdRef,
          paymentRef: initial.paymentRef,
          verification: initial.verification,
          eligibility: initial.eligibility,
          enabled: initial.enabled,
          telegramChatId: initial.telegramChatId,
        }
      : EMPTY_FORM,
  );
  const providers = useMemo(
    () => [...(s.system?.providers ?? [])].sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode] || a.name.localeCompare(b.name, 'es')),
    [s.system?.providers],
  );
  const chosen = providers.find((p) => p.id === f.providerId);
  const officialUrl = s.providerAuthorizations.find((a) => a.providerId === f.providerId)?.url ?? null;
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    const body: AccountInput = {
      ...f,
      householdRef: f.householdRef?.trim() ? f.householdRef.trim() : null,
      paymentRef: f.paymentRef?.trim() ? f.paymentRef.trim() : null,
      telegramChatId: f.telegramChatId?.trim() ? f.telegramChatId.trim() : null,
    };
    const r = await run(
      () => withFieldLabels(() => (initial ? Api.updateAccount(initial.id, body) : Api.createAccount(body))),
      initial ? 'Cuenta actualizada' : 'Cuenta creada',
    );
    if (r) onDone();
  };
  return (
    <Card title={initial ? `Editar ${initial.label}` : 'Nueva cuenta'} actions={<button type="button" className="btn sm ghost" onClick={onDone}><Icon name="x" size={14} /></button>}>
      <div className="stack">
        <Callout icon="lock">
          Solo cuentas <b>legítimas</b> de personas del grupo. Aquí no se guardan contraseñas ni datos personales: el titular, el hogar y el medio de pago son <b>alias</b> que
          sirven para aplicar los límites del evento (por titular, por hogar o por medio de pago). Cada cuenta debe ser de la persona que va a usar la entrada (en el Real
          Madrid, las entradas de socio son personales e intransferibles).
        </Callout>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="acc-label">Nombre visible</label>
            <input id="acc-label" className="input" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="Ana · principal" />
          </div>
          <div className="field">
            <label htmlFor="acc-provider">Proveedor</label>
            <select id="acc-provider" className="input" value={f.providerId} onChange={(e) => set('providerId', e.target.value)} disabled={Boolean(initial?.leasedBy)}>
              <option value="">Elige dónde compra esta cuenta…</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {MODE_SUFFIX[p.mode]}
                </option>
              ))}
              {f.providerId && !chosen ? <option value={f.providerId}>{f.providerId}</option> : null}
            </select>
            {chosen?.mode === 'MANUAL_ASSIST' ? (
              <span className="hint">
                Asistencia manual: cada persona inicia sesión y compra en la web oficial; el sistema reparte las tareas y te avisa.
                {officialUrl ? (
                  <>
                    {' '}
                    <a href={officialUrl} target="_blank" rel="noreferrer" style={{ whiteSpace: 'nowrap' }}>
                      Web oficial <Icon name="external" size={12} />
                    </a>
                  </>
                ) : null}
              </span>
            ) : chosen?.mode === 'SIMULATED' ? (
              <span className="hint">Simulador interno: solo para ensayar.</span>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="acc-holder">Titular (alias)</label>
            <input id="acc-holder" className="input" value={f.holderRef} onChange={(e) => set('holderRef', e.target.value)} placeholder="ana" />
            <span className="hint">Dos cuentas del mismo titular comparten el límite «por titular».</span>
          </div>
          <div className="field">
            <label htmlFor="acc-house">Hogar (alias)</label>
            <input id="acc-house" className="input" value={f.householdRef ?? ''} onChange={(e) => set('householdRef', e.target.value)} placeholder="casa-norte" />
          </div>
          <div className="field">
            <label htmlFor="acc-pay">Medio de pago (alias)</label>
            <input id="acc-pay" className="input" value={f.paymentRef ?? ''} onChange={(e) => set('paymentRef', e.target.value)} placeholder="tarjeta-ana" />
          </div>
          <div className="field">
            <label htmlFor="acc-ver">Verificación</label>
            <select id="acc-ver" className="input" value={f.verification} onChange={(e) => set('verification', e.target.value as AccountInput['verification'])}>
              <option value="VERIFIED">Verificada (legítima)</option>
              <option value="NEEDS_ATTENTION">Requiere atención</option>
              <option value="UNVERIFIED">Sin verificar (no se puede usar)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="acc-elig">Elegible para</label>
            <input
              id="acc-elig"
              className="input"
              value={(f.eligibility ?? []).join(', ')}
              onChange={(e) => set('eligibility', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
              placeholder="* o ids/etiquetas de evento"
            />
            <span className="hint">«*» = cualquier evento. Etiquetas como presale:fanclub.</span>
          </div>
          <div className="field">
            <label htmlFor="acc-tg">Chat de Telegram (opcional)</label>
            <input
              id="acc-tg"
              className="input mono"
              list="acc-tg-chats"
              value={f.telegramChatId ?? ''}
              onChange={(e) => set('telegramChatId', e.target.value)}
              placeholder="123456789"
            />
            <datalist id="acc-tg-chats">
              {tgChats.map((c) => (
                <option key={c.chatId} value={c.chatId}>
                  {c.name}
                </option>
              ))}
            </datalist>
            <span className="hint">
              Esta persona abre el bot y pulsa «Iniciar»; su chat sale en la lista de este campo (o en Ajustes · Telegram). Recibirá solo sus tareas.
            </span>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.enabled ?? true} onChange={(e) => set('enabled', e.target.checked)} />
          <span>Activa</span>
        </label>
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !f.providerId || !f.label.trim() || !f.holderRef.trim()} onClick={() => void submit()}>
            {initial ? 'Guardar cambios' : 'Crear cuenta'}
          </button>
          <button type="button" className="btn" onClick={onDone}>
            Cancelar
          </button>
        </div>
      </div>
    </Card>
  );
}

export function AccountsPage() {
  const s = useLive();
  const location = useLocation();
  const ask = useDialog();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const accounts = useMemo(() => Object.values(s.accounts).sort((a, b) => a.providerId.localeCompare(b.providerId) || a.label.localeCompare(b.label)), [s.accounts]);
  const highlight = location.hash.slice(1);
  const providerName = (pid: string) =>
    s.providerAuthorizations.find((p) => p.providerId === pid)?.name ?? s.system?.providers.find((p) => p.id === pid)?.name ?? pid;
  /** Asistencia manual: la sesión y la cola las lleva la persona en la web oficial. */
  const isManual = (pid: string) =>
    pid === 'manual' || (s.system?.providers.find((p) => p.id === pid)?.mode ?? s.providerAuthorizations.find((p) => p.providerId === pid)?.mode) === 'MANUAL_ASSIST';

  useEffect(() => {
    if (highlight) document.getElementById(`acc-${highlight}`)?.scrollIntoView({ block: 'center' });
  }, [highlight]);

  const kill = async (a: Account) => {
    const engaged = s.killSwitches[`account:${a.id}`]?.engaged ?? false;
    if (!engaged) {
      const reason = await ask({ title: `Parar la cuenta ${a.label}`, body: 'Ninguna acción automática usará esta cuenta hasta que la sueltes.', input: { label: 'Motivo', defaultValue: '' }, danger: true, confirmText: 'Parar cuenta' });
      if (reason === null || reason === false) return;
      await run(() => Api.setKillSwitch({ scope: 'ACCOUNT', targetId: a.id, engaged: true, reason: typeof reason === 'string' ? reason : undefined }), 'Cuenta parada');
    } else {
      await run(() => Api.setKillSwitch({ scope: 'ACCOUNT', targetId: a.id, engaged: false }), 'Cuenta liberada');
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Cuentas</h1>
          <div className="sub">Hasta 10 cuentas legítimas por operación. Las sesiones y los retos (CAPTCHA, SMS) los gestiona siempre una persona.</div>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={15} /> Nueva cuenta
          </button>
        </div>
      </div>
      {editing ? <AccountForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} /> : null}
      <Card flush>
        {accounts.length === 0 ? (
          <Empty title="Sin cuentas" action={<button type="button" className="btn primary" onClick={() => setEditing('new')}>Añadir cuenta</button>}>
            Añade las cuentas del grupo, o crea una demo desde el resumen.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Titular · hogar · pago</th>
                  <th>Verificación</th>
                  <th>Sesión</th>
                  <th>Cola</th>
                  <th>Telegram</th>
                  <th>En uso por</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const killed = s.killSwitches[`account:${a.id}`]?.engaged ?? false;
                  const op = a.leasedBy ? s.operations[a.leasedBy] : undefined;
                  const manual = isManual(a.providerId);
                  return (
                    <tr key={a.id} id={`acc-${a.id}`} style={highlight === a.id ? { outline: '2px solid var(--data-1)', outlineOffset: -2 } : undefined}>
                      <td>
                        <b>{a.label}</b> {a.enabled ? null : <span className="tag">desactivada</span>} {killed ? <span className="tag">parada</span> : null}
                        <div className="small muted">
                          {providerName(a.providerId)} · <span className="mono">{a.id}</span>
                        </div>
                      </td>
                      <td className="small">
                        {a.holderRef} · {a.householdRef ?? '—'} · {a.paymentRef ?? '—'}
                      </td>
                      <td>
                        <Pill tone={a.verification === 'VERIFIED' ? 'good' : a.verification === 'NEEDS_ATTENTION' ? 'warning' : 'critical'}>
                          {a.verification === 'VERIFIED' ? 'Verificada' : a.verification === 'NEEDS_ATTENTION' ? 'Revisar' : 'Sin verificar'}
                        </Pill>
                      </td>
                      <td>
                        <SessionPill state={a.session.state} />
                        {a.session.detail ? <div className="small muted" style={{ maxWidth: 260 }}>{a.session.detail}</div> : null}
                      </td>
                      <td>
                        {manual ? (
                          <div className="small muted" style={{ minWidth: 110 }} title="En asistencia manual la cola de la web oficial la gestiona la persona">
                            — (la gestiona la persona)
                          </div>
                        ) : (
                          <QueuePill state={a.session.queue.state} position={a.session.queue.position} etaMs={a.session.queue.etaMs} />
                        )}
                      </td>
                      <td>
                        {a.telegramChatId ? (
                          <span className="tag mono" title="Esta persona recibe sus tareas en este chat de Telegram">
                            <Icon name="send" size={12} />
                            &nbsp;{a.telegramChatId}
                          </span>
                        ) : (
                          <span className="muted" title="Sin chat propio: sus tareas llegan al chat principal">
                            —
                          </span>
                        )}
                      </td>
                      <td className="small" style={{ minWidth: 130 }}>
                        {op ? <Link to={`/operaciones/${op.id}`}>{op.name}</Link> : '—'}
                      </td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6, minWidth: 150 }}>
                          {a.session.state !== 'READY' ? (
                            <>
                              {manual ? (
                                <button
                                  type="button"
                                  className="btn sm"
                                  disabled={busy}
                                  onClick={() => void run(() => Api.openSession(a.id), 'Tarea enviada: inicia sesión en la web oficial y pulsa «Sesión lista»')}
                                  title="Crea la tarea para que la persona inicie sesión en la web oficial"
                                >
                                  Pedir inicio de sesión
                                </button>
                              ) : (
                                <button type="button" className="btn sm" disabled={busy} onClick={() => void run(() => Api.openSession(a.id), 'Abriendo sesión…')} title="Pedir al proveedor que abra sesión">
                                  Abrir sesión
                                </button>
                              )}
                              <button type="button" className="btn sm primary" disabled={busy} onClick={() => void run(() => Api.sessionReady(a.id), 'Sesión marcada como lista')} title="Ya has iniciado sesión o resuelto el reto">
                                <Icon name="check" size={13} /> Lista
                              </button>
                            </>
                          ) : op && !manual && (a.session.queue.state === 'EXPIRED' || a.session.queue.state === 'BLOCKED') ? (
                            <button
                              type="button"
                              className="btn sm primary"
                              disabled={busy}
                              onClick={() => void run(() => Api.sessionReady(a.id, 'Ha vuelto a entrar en la cola'), 'La cuenta vuelve a la cola')}
                              title="La persona ha vuelto a entrar en la cola de la web: el sistema la vuelve a consultar"
                            >
                              <Icon name="check" size={13} /> De vuelta en la cola
                            </button>
                          ) : null}
                          <button type="button" className="btn sm ghost" onClick={() => setEditing(a)} title="Editar">
                            <Icon name="edit" size={14} />
                          </button>
                          <button type="button" className={`btn sm ${killed ? 'danger solid' : 'ghost'}`} disabled={busy} onClick={() => void kill(a)} title={killed ? 'Soltar kill switch de la cuenta' : 'Parar esta cuenta'}>
                            <Icon name="power" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
