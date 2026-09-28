import { useMemo, useState } from 'react';
import type { AlertSeverity } from '@to/shared';
import { AlertRow, sortAlerts } from '../components/AlertList';
import { Card, Empty } from '../components/ui';
import { useLive } from '../lib/store';

export function AlertsPage() {
  const s = useLive();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [severity, setSeverity] = useState<AlertSeverity | 'ALL'>('ALL');
  const alerts = useMemo(
    () =>
      sortAlerts(Object.values(s.alerts)).filter(
        (a) => (show === 'all' || a.state !== 'RESOLVED') && (severity === 'ALL' || a.severity === severity),
      ),
    [s.alerts, show, severity],
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Alertas</h1>
          <div className="sub">Cada alerta dice qué pasa y qué hacer. Se agrupan: el mismo problema no se repite, se actualiza.</div>
        </div>
      </div>
      <div className="row">
        <select className="input" style={{ width: 'auto' }} value={show} onChange={(e) => setShow(e.target.value as 'open' | 'all')} aria-label="Mostrar">
          <option value="open">Abiertas</option>
          <option value="all">Todas (incluidas resueltas)</option>
        </select>
        <select className="input" style={{ width: 'auto' }} value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity | 'ALL')} aria-label="Gravedad">
          <option value="ALL">Cualquier gravedad</option>
          <option value="CRITICAL">Críticas</option>
          <option value="WARNING">Avisos</option>
          <option value="INFO">Informativas</option>
        </select>
        <span className="small muted">{alerts.length} alertas</span>
      </div>
      <Card flush>{alerts.length === 0 ? <Empty title="Sin alertas">Todo en orden.</Empty> : alerts.map((a) => <AlertRow key={a.id} alert={a} />)}</Card>
    </div>
  );
}
