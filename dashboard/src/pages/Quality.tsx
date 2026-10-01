import { useState } from 'react';
import type { GatesReport } from '@to/shared';
import { Icon } from '../components/Icon';
import { Callout, Card, CheckPill, Empty, Stat } from '../components/ui';
import { Api } from '../lib/api';
import { formatLatency, fmtDateTime } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';

export function QualityPage() {
  const initial = useAsync(() => Api.gates(), []);
  const [report, setReport] = useState<GatesReport | null>(null);
  const { run, busy } = useAction();
  const r = report ?? initial.data;

  const exec = async (full: boolean) => {
    const res = await run(() => Api.runGates(full), (x) => (x.gates.every((g) => g.status === 'PASS') ? 'Todos los gates en verde' : 'Hay gates en rojo'));
    if (res) setReport(res);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Calidad · gates</h1>
          <div className="sub">
            Pruebas de producción G0–G6: se simulan operaciones completas con reloj virtual y un vault de pruebas independiente del tuyo. También con{' '}
            <code>npm run gates</code>.
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void exec(false)}>
            <Icon name="beaker" size={15} /> {busy ? 'Ejecutando…' : 'Ejecutar (rápido)'}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void exec(true)}>
            Ejecutar completo
          </button>
        </div>
      </div>
      {!r ? (
        <Card>
          <Empty title="Sin informe">Ejecuta los gates para ver el estado del sistema.</Empty>
        </Card>
      ) : (
        <>
          <Callout tone={r.gates.every((g) => g.status === 'PASS') ? 'good' : 'critical'}>
            {r.gates.filter((g) => g.status === 'PASS').length}/{r.gates.length} gates en verde · {fmtDateTime(r.generatedAt)} · Node {r.nodeVersion}
            {r.commit ? ` · commit ${r.commit}` : ''}
          </Callout>
          <div className="grid cols-4">
            <Stat label="Decisión p99" value={r.slo.decision ? formatLatency(r.slo.decision.p99) : '—'} detail="Motor de selección, 2.000 candidatos" />
            <Stat label="Asignación p99" value={r.slo.allocation ? formatLatency(r.slo.allocation.p99) : '—'} detail="Reserva/liberación con invariantes" />
            <Stat label="Corrección" value={r.slo.correctness === null ? '—' : `${(r.slo.correctness * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`} detail="Frente a un oráculo por fuerza bruta" />
            <Stat
              label="Violaciones"
              value={r.slo.overAllocation + r.slo.priceViolations + r.slo.autoPayments}
              detail={`sobreasignación ${r.slo.overAllocation} · precio ${r.slo.priceViolations} · pagos automáticos ${r.slo.autoPayments}`}
            />
          </div>
          <Card title="Gates" flush>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Gate</th>
                    <th>Estado</th>
                    <th>Resultado</th>
                    <th className="num">Tiempo</th>
                  </tr>
                </thead>
                <tbody>
                  {r.gates.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <b className="mono">{g.id}</b> {g.name}
                      </td>
                      <td>
                        <CheckPill status={g.status} />
                      </td>
                      <td className="small">{g.detail}</td>
                      <td className="num">{g.durationMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Definition of done">
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }} className="stack">
              {r.definitionOfDone.map((d) => (
                <li key={d.item} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <CheckPill status={d.met ? 'PASS' : 'FAIL'} />
                  <span>{d.item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
