/**
 * Piezas visuales del dashboard: píldoras de estado, tarjetas, medidores,
 * barras, cifras, el tablero de salidas (T0) y la línea de estados.
 */

import { useState, type ReactNode } from 'react';
import {
  CART_STATE_LABEL,
  OPERATION_STATE_LABEL,
  QUEUE_STATE_LABEL,
  SESSION_STATE_LABEL,
  type AlertSeverity,
  type CartState,
  type GateStatus,
  type OperationState,
  type QueueState,
  type ReadinessStatus,
  type SessionState,
} from '@to/shared';
import { formatClock } from '../lib/format';
import { Icon, type IconName } from './Icon';

export type Tone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'live';

const TONE_ICON: Record<Tone, IconName | null> = {
  neutral: null,
  good: 'check',
  warning: 'alert',
  serious: 'alert',
  critical: 'octagon',
  live: null,
};

export function Pill({ tone = 'neutral', icon, children, title }: { tone?: Tone; icon?: IconName | null; children: ReactNode; title?: string }) {
  const ic = icon === undefined ? TONE_ICON[tone] : icon;
  return (
    <span className={`pill ${tone === 'neutral' ? '' : tone}`} title={title}>
      {ic ? <Icon name={ic} size={13} /> : <span className="dot" aria-hidden />}
      {children}
    </span>
  );
}

const OP_TONE: Record<OperationState, Tone> = {
  DRAFT: 'neutral',
  VALIDATED: 'neutral',
  ARMED: 'neutral',
  FROZEN: 'neutral',
  RUNNING: 'live',
  PAUSED: 'warning',
  RECOVERING: 'warning',
  CART_SECURED: 'good',
  ENDED: 'neutral',
  CANCELLED: 'neutral',
  CLOSED: 'neutral',
};

const OP_ICON: Partial<Record<OperationState, IconName>> = {
  ARMED: 'lock',
  FROZEN: 'snow',
  PAUSED: 'pause',
  RECOVERING: 'refresh',
  CART_SECURED: 'cart',
  ENDED: 'stop',
  CANCELLED: 'x',
  CLOSED: 'check',
};

export function OpStatePill({ state }: { state: OperationState }) {
  const tone = OP_TONE[state];
  return (
    <Pill tone={tone} icon={tone === 'live' ? null : (OP_ICON[state] ?? null)}>
      {OPERATION_STATE_LABEL[state]}
    </Pill>
  );
}

export function SeverityPill({ severity }: { severity: AlertSeverity }) {
  const tone: Tone = severity === 'CRITICAL' ? 'critical' : severity === 'WARNING' ? 'warning' : 'neutral';
  const label = severity === 'CRITICAL' ? 'Crítica' : severity === 'WARNING' ? 'Aviso' : 'Info';
  return (
    <Pill tone={tone} icon={severity === 'INFO' ? 'info' : undefined}>
      {label}
    </Pill>
  );
}

const SESSION_TONE: Record<SessionState, Tone> = {
  LOGGED_OUT: 'neutral',
  OPENING: 'neutral',
  CHALLENGE_REQUIRED: 'critical',
  READY: 'good',
  EXPIRED: 'serious',
  BLOCKED: 'critical',
  UNKNOWN: 'neutral',
};

export function SessionPill({ state }: { state: SessionState }) {
  return <Pill tone={SESSION_TONE[state]} icon={state === 'OPENING' ? 'refresh' : undefined}>{SESSION_STATE_LABEL[state]}</Pill>;
}

export function QueuePill({ state, position, etaMs }: { state: QueueState; position: number | null; etaMs: number | null }) {
  const tone: Tone = state === 'PASSED' ? 'good' : state === 'EXPIRED' || state === 'BLOCKED' ? 'critical' : 'neutral';
  const extra = state === 'WAITING' && position !== null ? ` · #${position.toLocaleString('es-ES')}${etaMs ? ` · ${formatClock(etaMs)}` : ''}` : '';
  return (
    <Pill tone={tone} icon={state === 'WAITING' ? 'queue' : undefined}>
      {QUEUE_STATE_LABEL[state]}
      {extra}
    </Pill>
  );
}

const CART_TONE: Record<CartState, Tone> = {
  ACTIVE: 'warning',
  REVIEW_REQUIRED: 'critical',
  PAID: 'good',
  RELEASED: 'neutral',
  EXPIRED: 'critical',
};

export function CartPill({ state }: { state: CartState }) {
  return (
    <Pill tone={CART_TONE[state]} icon={state === 'ACTIVE' ? 'clock' : undefined}>
      {state === 'ACTIVE' ? 'Pendiente de pago' : CART_STATE_LABEL[state]}
    </Pill>
  );
}

export function CheckPill({ status }: { status: ReadinessStatus | GateStatus }) {
  const tone: Tone = status === 'PASS' ? 'good' : status === 'WARN' ? 'warning' : status === 'FAIL' ? 'critical' : 'neutral';
  const label: Record<string, string> = { PASS: 'OK', WARN: 'Aviso', FAIL: 'Falla', BLOCKED: 'Bloqueado', NOT_RUN: 'Sin ejecutar' };
  return <Pill tone={tone}>{label[status] ?? status}</Pill>;
}

// ---------------------------------------------------------------------------

export function Card({
  title,
  actions,
  children,
  className = '',
  flush = false,
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className={`card ${className}`} id={id}>
      {title || actions ? (
        <header className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions ? <div className="actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{title}</div>
      {children ? <div style={{ maxWidth: 520 }}>{children}</div> : null}
      {action}
    </div>
  );
}

export function Callout({ tone = 'neutral', icon, children }: { tone?: 'neutral' | 'good' | 'warning' | 'critical'; icon?: IconName; children: ReactNode }) {
  const ic: IconName = icon ?? (tone === 'critical' ? 'octagon' : tone === 'warning' ? 'alert' : tone === 'good' ? 'check' : 'info');
  return (
    <div className={`callout ${tone === 'neutral' ? '' : tone}`}>
      <Icon name={ic} size={16} />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Medidores y barras
// ---------------------------------------------------------------------------

export interface MeterSegment {
  value: number;
  kind: 'fill' | 'soft';
  label: string;
  display?: string;
}

/** Medidor ordinal de una sola rampa: relleno fuerte, relleno suave y pista. */
export function Meter({
  segments,
  total,
  trackLabel,
  legend = true,
  thin = false,
  ariaLabel,
}: {
  segments: MeterSegment[];
  total: number;
  trackLabel?: string;
  legend?: boolean;
  thin?: boolean;
  ariaLabel: string;
}) {
  const safeTotal = Math.max(total, 1);
  const used = segments.reduce((n, s) => n + s.value, 0);
  const rest = Math.max(0, total - used);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={`meter ${thin ? 'thin' : ''}`} role="img" aria-label={ariaLabel}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.label} className={`seg ${s.kind}`} style={{ width: `${(Math.min(s.value, safeTotal) / safeTotal) * 100}%` }} title={`${s.label}: ${s.display ?? s.value}`} />
          ))}
        <div className="seg rest" />
      </div>
      {legend ? (
        <div className="legend">
          {segments.map((s) => (
            <span className="key" key={s.label}>
              <span className={`swatch ${s.kind === 'soft' ? 'soft' : ''}`} aria-hidden />
              {s.label} <b className="mono">{s.display ?? s.value}</b>
            </span>
          ))}
          {trackLabel ? (
            <span className="key">
              <span className="swatch track" aria-hidden />
              {trackLabel} <b className="mono">{rest}</b>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: number;
  display: string;
}

/** Barras horizontales de una serie: valor en la punta, detalle al pasar o enfocar. */
export function BarList({ items, emptyText = 'Sin datos todavía.', ariaLabel }: { items: BarItem[]; emptyText?: string; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  if (items.length === 0) return <div className="muted small">{emptyText}</div>;
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  return (
    <div className="barlist" role="list" aria-label={ariaLabel}>
      {items.map((it) => (
        <div
          key={it.key}
          role="listitem"
          tabIndex={0}
          className="barrow"
          aria-label={`${it.label}: ${it.display}`}
          onMouseEnter={() => setHover(it.key)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(it.key)}
          onBlur={() => setHover(null)}
          style={{ position: 'relative' }}
        >
          <span className="blabel" title={it.label}>
            {it.label}
          </span>
          <span className="btrack">
            <span className="bar" style={{ width: `${Math.max(1.5, (it.value / max) * 82)}%` }} />
            <span className="bvalue">{it.display}</span>
          </span>
          {hover === it.key ? (
            <span
              role="tooltip"
              style={{
                position: 'absolute',
                right: 6,
                top: -30,
                zIndex: 5,
                padding: '4px 8px',
                borderRadius: 6,
                background: 'var(--ink)',
                color: 'var(--surface)',
                fontSize: 12,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              <b className="mono">{it.display}</b> · {it.label}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, unit, detail, children }: { label: string; value: ReactNode; unit?: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card stat">
      <span className="sign">{label}</span>
      <span className="value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
      {detail ? <span className="detail">{detail}</span> : null}
      {children}
    </div>
  );
}

/** Visión 0–5 como puntos. */
export function ViewDots({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="muted">—</span>;
  return (
    <span className="dots5" role="img" aria-label={`Visión ${value} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= value ? 'on' : ''} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tablero de salidas: cuenta atrás a T0
// ---------------------------------------------------------------------------

export function T0Board({ t0, now, size = 'lg', caption }: { t0: string; now: number; size?: 'lg' | 'sm'; caption?: string }) {
  const diff = Date.parse(t0) - now;
  const text = formatClock(Math.abs(diff)).padStart(5, '0');
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className={`board ${size === 'sm' ? 'sm' : ''}`} role="timer" aria-label={`${diff >= 0 ? 'Faltan' : 'Han pasado'} ${text} ${diff >= 0 ? 'para' : 'desde'} T0`}>
        <span className="board-prefix" aria-hidden>
          T{diff >= 0 ? '−' : '+'}
        </span>
        {text.split('').map((c, i) => (
          <span key={i} className={`flap ${c === ':' ? 'sep' : ''}`} aria-hidden>
            <span className="char" key={`${i}-${c}`}>
              {c}
            </span>
          </span>
        ))}
      </div>
      {caption ? <span className="board-caption">{caption}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Línea de estados (plano de metro)
// ---------------------------------------------------------------------------

const STATIONS: Array<{ key: string; label: string }> = [
  { key: 'DRAFT', label: 'Borrador' },
  { key: 'VALIDATED', label: 'Validada' },
  { key: 'ARMED', label: 'Armada' },
  { key: 'FROZEN', label: 'Congelada' },
  { key: 'RUNNING', label: 'En marcha' },
  { key: 'CART_SECURED', label: 'Asegurada' },
  { key: 'CLOSED', label: 'Cerrada' },
];

const STATION_INDEX: Record<OperationState, number> = {
  DRAFT: 0,
  VALIDATED: 1,
  ARMED: 2,
  FROZEN: 3,
  RUNNING: 4,
  PAUSED: 4,
  RECOVERING: 4,
  CART_SECURED: 5,
  ENDED: 5,
  CANCELLED: 6,
  CLOSED: 6,
};

export function StateRail({ state }: { state: OperationState }) {
  const idx = STATION_INDEX[state];
  const tone =
    state === 'CART_SECURED' ? 'good' : state === 'PAUSED' || state === 'RECOVERING' ? 'warning' : state === 'CANCELLED' ? 'critical' : state === 'RUNNING' ? 'live' : '';
  return (
    <div className="rail" role="img" aria-label={`Estado: ${OPERATION_STATE_LABEL[state]}`}>
      <div className="progress-line" style={{ width: `calc(${(idx / 6) * 100}% * 6 / 7)` }} />
      {STATIONS.map((s, i) => {
        let label = s.label;
        if (i === 5 && state === 'ENDED') label = 'Finalizada';
        if (i === 6 && state === 'CANCELLED') label = 'Cancelada';
        if (i === 4 && (state === 'PAUSED' || state === 'RECOVERING')) label = OPERATION_STATE_LABEL[state];
        const cls = i < idx ? 'done' : i === idx ? `current ${tone}` : '';
        return (
          <div key={s.key} className={`station ${cls}`}>
            <span className="node">{i < idx ? <Icon name="check" size={12} /> : null}</span>
            <span className="sname">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
