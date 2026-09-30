import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { BrowserConnectionStatus, BrowserRecipe } from '@to/shared';
import { Api } from '../lib/api';
import { useLive } from '../lib/store';
import { Card, Callout } from './ui';

export function BrowserConnection() {
  const live = useLive();
  const [params] = useSearchParams();
  const requestedAccount = params.get('browserAccountId');
  const requestedEvent = params.get('browserEventId');
  const appliedPreset = useRef('');
  const [accountId, setAccount] = useState('');
  const [eventId, setEvent] = useState('');
  const [url, setUrl] = useState('');
  const [recipeText, setRecipeText] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState<BrowserConnectionStatus[]>([]);
  const accounts = Object.values(live.accounts).filter((a) => a.enabled && a.providerId !== 'sim');
  const account = live.accounts[accountId];
  const events = Object.values(live.events).filter((e) => e.providerId === account?.providerId);
  useEffect(() => {
    const key = `${requestedAccount ?? ''}:${requestedEvent ?? ''}`;
    if (!requestedAccount || !requestedEvent || appliedPreset.current === key) return;
    const a = live.accounts[requestedAccount];
    const e = live.events[requestedEvent];
    if (!a?.enabled || !e || a.providerId !== e.providerId) return;
    appliedPreset.current = key;
    setAccount(a.id); setEvent(e.id); setUrl(e.url ?? ''); setCode(''); setRecipeText('');
  }, [requestedAccount, requestedEvent, live.accounts, live.events]);
  useEffect(() => {
    let active = true;
    const refresh = () => void Api.browserStatus().then((r) => { if (active) setConnections(r); }).catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function pair() {
    setBusy(true); setError(''); setCode('');
    try {
      const origin = new URL(url).origin;
      const recipe: BrowserRecipe = recipeText.trim() ? JSON.parse(recipeText) : { id: 'observe-only-v1', allowedOrigins: [origin] };
      const result = await Api.browserPair({ accountId, eventId, eventUrl: url, recipe });
      setCode(result.pairingCode);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <Card title="Conexión avanzada del navegador">
    <div className="stack" style={{ gap: 12 }}>
      <p>La sesión y el carrito permanecen en el navegador donde iniciaste sesión. El acceso al carrito abre esa misma pestaña; no copia tus cookies ni abre otra cuenta.</p>
      <Callout tone="warning">Primero hay que comprobar que la página de venta tiene una integración compatible. El plano gráfico del Real Madrid todavía no está automatizado: vincularlo permite comprobar la conexión, pero no reserva asientos.</Callout>
      <ol>
        <li>En Chrome o Edge, abre Extensiones, activa el modo desarrollador y carga la carpeta <code>extension</code> de esta instalación con «Cargar descomprimida».</li>
        <li>Abre la venta en el perfil de la cuenta que vas a usar y copia su dirección exacta.</li>
        <li>Elige aquí la cuenta y el evento, genera el código y pégalo en la extensión desde esa pestaña.</li>
      </ol>
      <div className="field"><label htmlFor="browser-account">Cuenta</label><select id="browser-account" className="input" value={accountId} onChange={(e) => { setAccount(e.target.value); setEvent(''); setUrl(''); setCode(''); }}><option value="">Selecciona una cuenta</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.providerId}</option>)}</select></div>
      <div className="field"><label htmlFor="browser-event">Evento</label><select id="browser-event" className="input" value={eventId} onChange={(e) => { setEvent(e.target.value); setUrl(live.events[e.target.value]?.url ?? ''); setCode(''); }}><option value="">Selecciona el evento</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
      <div className="field"><label htmlFor="browser-url">Dirección de la pestaña de venta</label><input id="browser-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tickets…" /></div>
      <details><summary>Integración de la página (configuración técnica)</summary><p>Déjalo vacío para comprobar la conexión sin añadir entradas. Solo se debe habilitar una receta después de comprobar los controles y la lectura del carrito en esa web.</p><textarea className="input mono" rows={5} aria-label="Receta de la página" value={recipeText} onChange={(e) => setRecipeText(e.target.value)} /></details>
      <div><button type="button" className="btn primary" disabled={busy || !accountId || !eventId || !url} onClick={() => void pair()}>{busy ? 'Preparando…' : 'Generar código de vinculación'}</button></div>
      {code && <Callout tone="good">Código de un solo uso, válido durante 2 minutos: <strong className="mono">{code}</strong>. La extensión conecta con este PC en el puerto <code>8787</code>.</Callout>}
      {error && <Callout tone="critical">{error}</Callout>}
      {connections.map((c) => <div key={c.connectionId} className="stack" style={{ gap: 6 }}><b>{live.accounts[c.accountId]?.label ?? c.accountId}</b><div>{c.supported ? 'Página compatible' : 'Conectada sin automatización de esta página'} · {c.session}</div><div className="small muted">{c.detail ?? 'Esperando la primera lectura de la pestaña'}</div><button type="button" className="btn sm" onClick={() => void Api.browserDisconnect(c.accountId).then(() => setConnections((old) => old.filter((x) => x.accountId !== c.accountId))).catch((e: Error) => setError(e.message))}>Desconectar esta cuenta</button></div>)}
      <div className="small muted">CAPTCHA y acceso: los completas tú en esa pestaña. Telegram solo avisa cuando toda la cantidad solicitada está verificada en el carrito. Los enlaces locales se abren desde Telegram en este PC.</div>
    </div>
  </Card>;
}
