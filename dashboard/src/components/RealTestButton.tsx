import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ManagedTestPlan } from '@to/shared';
import { Icon } from './Icon';
import { Callout } from './ui';
import { Api } from '../lib/api';
import { useLive } from '../lib/store';

const states: Record<ManagedTestPlan['state'], string> = {
  AWAITING_APPROVAL: 'Pendiente de tu aprobación', OPENING: 'Abriendo navegador',
  WAITING_LOGIN: 'Necesita comprobar el acceso', WAITING_CAPTCHA: 'CAPTCHA pendiente',
  BLOCKED: 'Selección automática no disponible', STOPPED: 'Detenida',
};

export function RealTestButton({ className = 'btn', size = 15 }: { className?: string; size?: number }) {
  const live = useLive();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [eventId, setEventId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [plan, setPlan] = useState<ManagedTestPlan>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const accounts = Object.values(live.accounts).filter((a) => a.providerId === 'real-madrid' && a.enabled && !a.archived);
  const events = Object.values(live.events).filter((e) => e.providerId === 'real-madrid' && Date.parse(e.startsAt) > Date.now() && /femenin|women/i.test(e.name));
  const show = () => {
    setEventId(events[0]?.id ?? ''); setAccountId(accounts[0]?.id ?? '');
    setPlan(undefined); setError(''); setOpen(true); dialog.current?.showModal();
  };
  const close = () => { setOpen(false); dialog.current?.close(); };
  const changed = () => { setPlan(undefined); setError(''); };
  useEffect(() => {
    if (!open || !eventId || !accountId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const plans = await Api.managedTests();
        if (active && !submitting.current) setPlan(plans.find((p) => p.eventId === eventId && p.accountId === accountId && p.state !== 'STOPPED'));
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'No se pudo leer la prueba.'); }
      finally { if (active) timer = setTimeout(() => void poll(), 3000); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [open, eventId, accountId]);
  const action = async (fn: () => Promise<ManagedTestPlan>) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { setPlan(await fn()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la petición.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <>
    <button type="button" className={className} onClick={show}><Icon name="beaker" size={size} /> Hacer prueba</button>
    <dialog ref={dialog} className="modal" style={{ width: 'min(680px, calc(100vw - 32px))' }} aria-labelledby={`${id}-title`} onCancel={() => setOpen(false)}>
      {open ? <>
        <div className="modal-head"><h2 id={`${id}-title`} className="display">Prueba · Real Madrid femenino</h2></div>
        <div className="modal-body stack">
          <Callout tone="warning">Todavía no reserva entradas. La comprobación usa exclusivamente la pestaña vinculada en tu perfil de Chrome. La selección automática del plano y la lectura del carrito siguen pendientes de integración.</Callout>
          <fieldset disabled={busy || Boolean(plan && plan.state !== 'STOPPED')} className="stack" style={{ border: 0, padding: 0 }}>
            <div className="field"><label htmlFor={`${id}-event`}>Evento</label>
              <select id={`${id}-event`} className="input" value={eventId} onChange={(e) => { setEventId(e.target.value); changed(); }}>
                <option value="">Elige el evento</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor={`${id}-account`}>Tu cuenta</label>
              <select id={`${id}-account`} className="input" value={accountId} onChange={(e) => { setAccountId(e.target.value); changed(); }}>
                <option value="">Elige la cuenta</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          </fieldset>
          <p>Pedido previsto: máximo permitido por la venta oficial, sin filtro de precio. Nunca realiza el pago. El máximo aún debe comprobarse en la venta; no se deduce de los datos de prueba del catálogo.</p>
          {plan ? <div aria-live="polite"><b>{states[plan.state]}</b><p>{plan.detail}</p></div> : <p className="muted">Preparar solo guarda el evento y la cuenta. No abre la web ni envía mensajes.</p>}
          <p className="small muted">Al aprobar, se enfoca tu pestaña conectada; nunca se abre un perfil separado. Telegram pide ayuda únicamente si la página informa de acceso pendiente o CAPTCHA. Tú lo resuelves en ese Chrome. Una conexión o un clic no confirman entradas reservadas.</p>
          {error ? <Callout tone="critical">{error}</Callout> : null}
          <Link to={`/cuentas?perfil=${encodeURIComponent(accountId)}`} onClick={close}>Ver la sesión de mi cuenta</Link>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>Cerrar</button>
          {plan && plan.state !== 'STOPPED' ? <button type="button" className="btn" disabled={busy} onClick={() => void action(() => Api.managedStop(plan.id))}>Detener / descartar prueba</button> : null}
          {!plan || plan.state === 'STOPPED' ? <button type="button" className="btn primary" disabled={busy || !live.connected || !eventId || !accountId} onClick={() => void action(() => Api.managedPrepare(eventId, accountId))}>{busy ? 'Preparando…' : 'Preparar prueba'}</button> : null}
          {plan?.state === 'AWAITING_APPROVAL' ? <button type="button" className="btn primary" disabled={busy || !live.connected} onClick={() => void action(() => Api.managedApprove(plan.id))}>{busy ? 'Comprobando…' : 'Aprobar y comprobar mi pestaña'}</button> : null}
        </div>
      </> : null}
    </dialog>
  </>;
}
