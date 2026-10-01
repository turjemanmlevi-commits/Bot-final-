import { useMemo } from 'react';
import { PROHIBITED_CAPABILITIES, type KillScope } from '@to/shared';
import { useDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Callout, Card, Pill } from '../components/ui';
import { Api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useAction } from '../lib/hooks';
import { useLive } from '../lib/store';

const PROHIBITED_TEXT: Record<(typeof PROHIBITED_CAPABILITIES)[number], string> = {
  'checkout.pay': 'Pagar: siempre lo hace una persona.',
  'challenge.solve': 'Resolver CAPTCHA, SMS o 2FA: lo hace una persona.',
  'queue.bypass': 'Saltarse la cola virtual.',
  'limit.override': 'Sobrepasar los límites de compra del evento.',
  'identity.spoof': 'Suplantar identidades o fabricar cuentas.',
};

export function SafetyPage() {
  const s = useLive();
  const ask = useDialog();
  const { run, busy } = useAction();
  const kills = useMemo(() => Object.values(s.killSwitches).filter((k) => k.engaged), [s.killSwitches]);
  const circuits = useMemo(() => Object.values(s.circuits).sort((a, b) => a.key.localeCompare(b.key)), [s.circuits]);
  const global = s.killSwitches.global;
  const activeOps = Object.values(s.operations).filter((o) => ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING'].includes(o.state));

  const toggle = async (scope: KillScope, targetId: string | null, engaged: boolean, what: string) => {
    if (engaged) {
      const reason = await ask({
        title: `Parar ${what}`,
        body: 'Se detiene en el acto toda acción automática en este ámbito. Las operaciones afectadas pasan a pausa.',
        input: { label: 'Motivo', defaultValue: '' },
        danger: true,
        confirmText: 'Activar kill switch',
      });
      if (reason === null || reason === false) return;
      await run(() => Api.setKillSwitch({ scope, targetId, engaged: true, reason: typeof reason === 'string' && reason ? reason : undefined }), 'Kill switch activado');
    } else {
      await run(() => Api.setKillSwitch({ scope, targetId, engaged: false }), 'Kill switch soltado');
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Seguridad</h1>
          <div className="sub">Kill switches (parada inmediata), circuit breakers del proveedor y los guardarraíles que el sistema no puede saltarse por diseño.</div>
        </div>
      </div>

      <Card className="hero">
        <div className="row" style={{ gap: 20, justifyContent: 'space-between' }}>
          <div className="stack" style={{ gap: 6 }}>
            <span className="sign">Kill switch global</span>
            <div className="display" style={{ fontSize: 28 }}>
              {global?.engaged ? 'Todo parado' : 'Automatización permitida'}
            </div>
            <span className="ink2 small">
              {global?.engaged ? `Activado por ${global.actor ?? '—'} · ${fmtDateTime(global.at)}${global.reason ? ` · ${global.reason}` : ''}` : 'Ninguna parada global activa.'}
            </span>
          </div>
          <button
            type="button"
            className={`btn lg ${global?.engaged ? '' : 'danger solid'}`}
            disabled={busy}
            onClick={() => void toggle('GLOBAL', null, !global?.engaged, 'todo')}
          >
            <Icon name="power" size={18} /> {global?.engaged ? 'Soltar parada global' : 'PARAR TODO'}
          </button>
        </div>
      </Card>

      <div className="grid cols-2">
        <Card title="Por proveedor y operación" flush>
          <table className="t">
            <tbody>
              {(s.system?.providers ?? []).map((p) => {
                const k = s.killSwitches[`provider:${p.id}`];
                return (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b> <span className="small muted">proveedor</span>
                    </td>
                    <td>{k?.engaged ? <Pill tone="critical">Parado</Pill> : <Pill tone="good">Activo</Pill>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className={`btn sm ${k?.engaged ? '' : 'danger'}`} disabled={busy} onClick={() => void toggle('PROVIDER', p.id, !k?.engaged, `el proveedor ${p.name}`)}>
                        {k?.engaged ? 'Soltar' : 'Parar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {activeOps.map((o) => {
                const k = s.killSwitches[`operation:${o.id}`];
                return (
                  <tr key={o.id}>
                    <td>
                      <b>{o.name}</b> <span className="small muted">operación</span>
                    </td>
                    <td>{k?.engaged ? <Pill tone="critical">Parada</Pill> : <Pill tone="good">Activa</Pill>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className={`btn sm ${k?.engaged ? '' : 'danger'}`} disabled={busy} onClick={() => void toggle('OPERATION', o.id, !k?.engaged, `la operación ${o.name}`)}>
                        {k?.engaged ? 'Soltar' : 'Parar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="card-body small muted">Las cuentas se paran individualmente desde Cuentas. Activas ahora: {kills.length}.</div>
        </Card>

        <Card title="Circuit breakers" flush>
          {circuits.length === 0 ? (
            <div className="card-body muted">Se crean al hablar con un proveedor. Se abren tras 5 fallos seguidos; un cambio de formato exige reinicio manual.</div>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>Circuito</th>
                  <th>Estado</th>
                  <th className="num">Fallos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {circuits.map((c) => (
                  <tr key={c.key}>
                    <td className="mono small">
                      {c.key}
                      {c.reason ? <div className="muted">{c.reason}</div> : null}
                    </td>
                    <td>
                      <Pill tone={c.state === 'CLOSED' ? 'good' : c.requiresManualReset ? 'critical' : 'warning'}>
                        {c.state === 'CLOSED' ? 'Cerrado' : c.state === 'OPEN' ? 'Abierto' : 'Probando'}
                        {c.requiresManualReset ? ' · reinicio manual' : ''}
                      </Pill>
                    </td>
                    <td className="num">{c.failures}</td>
                    <td style={{ textAlign: 'right' }}>
                      {c.state !== 'CLOSED' ? (
                        <button type="button" className="btn sm" disabled={busy} onClick={() => void run(() => Api.resetCircuit(c.key), 'Circuito reiniciado')}>
                          Reiniciar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Guardarraíles de diseño (no configurables)">
        <div className="stack">
          <Callout icon="shield">
            Estas capacidades <b>no existen</b> en el sistema: el registro de proveedores rechaza cualquier adapter que las declare y el compilador del vault rechaza
            cualquier proveedor que intente autorizarlas. Colas, retos, límites y pagos son estados que se respetan, no controles que se evaden.
          </Callout>
          <table className="t">
            <tbody>
              {PROHIBITED_CAPABILITIES.map((c) => (
                <tr key={c}>
                  <td className="mono" style={{ width: 180 }}>
                    {c}
                  </td>
                  <td>{PROHIBITED_TEXT[c]}</td>
                  <td>
                    <Pill tone="critical" icon="x">
                      Prohibida
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ink2 small">
            Además: límites sin verificar bloquean el armado, las plazas accesibles están reservadas salvo que se habiliten, y cada acción queda en la auditoría con quién la hizo.
          </div>
        </div>
      </Card>
    </div>
  );
}
