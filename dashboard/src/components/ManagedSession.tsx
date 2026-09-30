import { useEffect, useState } from 'react';
import type { Account, ManagedSessionStatus } from '@to/shared';
import { Api } from '../lib/api';

const labels: Record<ManagedSessionStatus['state'], string> = {
  CLOSED: 'Navegador cerrado', OPENING: 'Abriendo…', LOGIN_REQUIRED: 'Inicia sesión',
  CAPTCHA: 'CAPTCHA pendiente', AUTHENTICATED: 'Acceso observado', UNKNOWN: 'Acceso sin comprobar', ERROR: 'Revisar navegador',
};

export function ManagedSession({ account }: { account: Account }) {
  const [status, setStatus] = useState<ManagedSessionStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const all = await Api.managedStatus(); if (active) setStatus(all.find((s) => s.accountId === account.id)); }
      catch { if (active) setError('No se pudo comprobar el navegador.'); }
      finally { if (active) timer = setTimeout(() => void poll(), 5000); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [account.id]);
  const open = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { setStatus(await Api.managedOpen(account.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el navegador.'); }
    finally { setBusy(false); }
  };
  return <div className="stack small" style={{ maxWidth: 290, gap: 6 }}>
    <b>{status?.connectedTab && status.state === 'UNKNOWN' ? 'Pestaña de Chrome conectada' : status ? labels[status.state] : 'Comprobando…'}</b>
    <span className="muted">{status?.detail}</span>
    {status?.savedUrl ? <span className="muted" style={{ overflowWrap: 'anywhere' }}>Última página guardada: {status.savedUrl}</span> : null}
    <button type="button" className="btn sm" disabled={busy || !account.enabled || account.archived} onClick={() => void open()}>
      {busy ? 'Abriendo…' : status?.connectedTab ? 'Abrir mi pestaña de Chrome' : 'Abrir navegador / iniciar sesión'}
    </button>
    <span className="muted">{status?.connectedTab ? 'Usa la pestaña que vinculaste en tu perfil habitual. No se copian cookies ni se abre otro perfil.' : 'Perfil separado del bot. Para usar tu Chrome habitual, conecta su pestaña desde Opciones técnicas.'}</span>
    {error ? <span role="alert">{error}</span> : null}
  </div>;
}
