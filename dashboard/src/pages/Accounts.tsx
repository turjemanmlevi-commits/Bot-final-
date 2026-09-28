import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { Account, AccountInput } from '@to/shared';
import { useDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Callout, Card, Empty, Pill, QueuePill, SessionPill } from '../components/ui';
import { Api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useLive } from '../lib/store';

const EMPTY_FORM: AccountInput = {
  label: '',
  providerId: 'sim',
  holderRef: '',
  householdRef: null,
  paymentRef: null,
  verification: 'VERIFIED',
  eligibility: ['*'],
  enabled: true,
  telegramChatId: null,
};

function AccountForm({ initial, onDone }: { initial?: Account; onDone: () => void }) {
  const s = useLive();
  const { run, busy } = useAction();
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
  const providers = s.system?.providers ?? [];
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    const body: AccountInput = {
      ...f,
      householdRef: f.householdRef?.trim() ? f.householdRef.trim() : null,
      paymentRef: f.paymentRef?.trim() ? f.paymentRef.trim() : null,
      telegramChatId: f.telegramChatId?.trim() ? f.telegramChatId.trim() : null,
    };
    const r = await run(() => (initial ? Api.updateAccount(initial.id, body) : Api.createAccount(body)), initial ? 'Cuenta actualizada' : 'Cuenta creada');
    if (r) onDone();
  };
  return (
    <Card title={initial ? `Editar ${initial.label}` : 'Nueva cuenta'} actions={<button type="button" className="btn sm ghost" onClick={onDone}><Icon name="x" size={14} /></button>}>
      <div className="stack">
        <Callout icon="lock">
          Solo cuentas <b>legítimas</b> de personas del grupo. Aquí no se guardan contraseñas ni datos personales: el titular, el hogar y el medio de pago son <b>alias</b> que
          sirven para aplicar los límites del evento (por titular, por hogar o por medio de pago).
        </Callout>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="acc-label">Nombre visible</label>
            <input id="acc-label" className="input" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="Ana · principal" />
          </div>
          <div className="field">
            <label htmlFor="acc-provider">Proveedor</label>
            <select id="acc-provider" className="input" value={f.providerId} onChange={(e) => set('providerId', e.target.value)} disabled={Boolean(initial?.leasedBy)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.mode === 'SIMULATED' ? 'simulado' : p.mode === 'MANUAL_ASSIST' ? 'manual' : 'API'})
                </option>
              ))}
            </select>
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
            <input id="acc-tg" className="input mono" value={f.telegramChatId ?? ''} onChange={(e) => set('telegramChatId', e.target.value)} placeholder="123456789" />
            <span className="hint">Esta persona recibirá sus tareas en su chat.</span>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.enabled ?? true} onChange={(e) => set('enabled', e.target.checked)} />
          <span>Activa</span>
        </label>
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !f.label.trim() || !f.holderRef.trim()} onClick={() => void submit()}>
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
                  <th>En uso por</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const killed = s.killSwitches[`account:${a.id}`]?.engaged ?? false;
                  const op = a.leasedBy ? s.operations[a.leasedBy] : undefined;
                  return (
                    <tr key={a.id} id={`acc-${a.id}`} style={highlight === a.id ? { outline: '2px solid var(--data-1)', outlineOffset: -2 } : undefined}>
                      <td>
                        <b>{a.label}</b> {a.enabled ? null : <span className="tag">desactivada</span>} {killed ? <span className="tag">parada</span> : null}
                        <div className="small muted">
                          {a.providerId} · <span className="mono">{a.id}</span>
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
                        <QueuePill state={a.session.queue.state} position={a.session.queue.position} etaMs={a.session.queue.etaMs} />
                      </td>
                      <td className="small">{op ? <Link to={`/operaciones/${op.id}`}>{op.name}</Link> : '—'}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {a.session.state !== 'READY' ? (
                            <>
                              <button type="button" className="btn sm" disabled={busy} onClick={() => void run(() => Api.openSession(a.id), 'Abriendo sesión…')} title="Pedir al proveedor (o a una persona) que abra sesión">
                                Abrir sesión
                              </button>
                              <button type="button" className="btn sm primary" disabled={busy} onClick={() => void run(() => Api.sessionReady(a.id), 'Sesión marcada como lista')} title="Ya has iniciado sesión o resuelto el reto">
                                <Icon name="check" size={13} /> Lista
                              </button>
                            </>
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
