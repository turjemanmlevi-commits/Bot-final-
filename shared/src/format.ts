/**
 * Etiquetas en castellano y formateadores compartidos (dashboard, Telegram, informes).
 */

import type {
  AlertKind,
  CartState,
  ClaimState,
  EndReason,
  GateId,
  HumanTaskKind,
  HumanTaskState,
  LimitSemantics,
  Minor,
  OperationCommand,
  OperationState,
  QueueState,
  RejectionReason,
  SessionState,
} from './domain';

export const OPERATION_STATE_LABEL: Record<OperationState, string> = {
  DRAFT: 'Borrador',
  VALIDATED: 'Validada',
  ARMED: 'Armada',
  FROZEN: 'Congelada',
  RUNNING: 'En ejecución',
  PAUSED: 'Pausada',
  RECOVERING: 'Recuperando',
  CART_SECURED: 'Carrito asegurado',
  ENDED: 'Finalizada',
  CANCELLED: 'Cancelada',
  CLOSED: 'Cerrada',
};

export const COMMAND_LABEL: Record<OperationCommand, string> = {
  validate: 'Validar',
  arm: 'Armar',
  disarm: 'Desarmar',
  readiness: 'Comprobación previa',
  'start-now': 'Empezar ya',
  pause: 'Pausar',
  resume: 'Reanudar',
  stop: 'Parar',
  cancel: 'Cancelar',
  'reduce-qty': 'Reducir cantidad',
  'lower-max-price': 'Bajar precio máx.',
  close: 'Cerrar',
};

export const SESSION_STATE_LABEL: Record<SessionState, string> = {
  LOGGED_OUT: 'Sin sesión',
  OPENING: 'Abriendo',
  CHALLENGE_REQUIRED: 'Reto pendiente',
  READY: 'Lista',
  EXPIRED: 'Caducada',
  BLOCKED: 'Bloqueada',
  UNKNOWN: 'Desconocido',
};

export const QUEUE_STATE_LABEL: Record<QueueState, string> = {
  NOT_OPEN: 'Sin abrir',
  WAITING: 'En cola',
  PASSED: 'Dentro',
  EXPIRED: 'Caducada',
  BLOCKED: 'Bloqueada',
  UNKNOWN: 'Desconocido',
};

export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  PENDING: 'Pendiente',
  SENT: 'Enviado',
  CONFIRMED: 'Confirmado',
  REJECTED: 'Rechazado',
  AMBIGUOUS: 'Ambiguo',
  CANCELLED: 'Cancelado',
};

export const CART_STATE_LABEL: Record<CartState, string> = {
  ACTIVE: 'Activo',
  REVIEW_REQUIRED: 'Revisar',
  PAID: 'Pagado',
  RELEASED: 'Liberado',
  EXPIRED: 'Caducado',
};

export const LIMIT_SEMANTICS_LABEL: Record<LimitSemantics, string> = {
  PER_ACCOUNT: 'Por cuenta',
  PER_HOLDER: 'Por titular',
  PER_HOUSEHOLD: 'Por hogar',
  PER_PAYMENT_METHOD: 'Por medio de pago',
  UNKNOWN: 'Desconocida',
};

export const HUMAN_TASK_KIND_LABEL: Record<HumanTaskKind, string> = {
  ADD_TO_CART: 'Añadir al carrito',
  OPEN_SESSION: 'Abrir sesión',
  VERIFY_CART: 'Verificar carrito',
};

export const HUMAN_TASK_STATE_LABEL: Record<HumanTaskState, string> = {
  OPEN: 'Abierta',
  DONE: 'Hecha',
  FAILED: 'Fallida',
  UNKNOWN: 'Sin confirmar',
  EXPIRED: 'Caducada',
  CANCELLED: 'Cancelada',
};

export const REJECTION_REASON_LABEL: Record<RejectionReason, string> = {
  UNRESOLVED_SECTION: 'Sección no resuelta',
  SECTION_NOT_ALLOWED: 'Sección fuera de objetivos',
  SECTION_EXCLUDED: 'Sección excluida',
  SECTION_CLOSED: 'Sección cerrada',
  PRICE_ABOVE_MAX: 'Precio por encima del máximo',
  CURRENCY_MISMATCH: 'Moneda distinta',
  NOT_CONTIGUOUS: 'Asientos no contiguos',
  OBSTRUCTED_VIEW: 'Visión reducida',
  ACCESSIBLE_RESERVED: 'Plaza accesible reservada',
  STANDING_NOT_ALLOWED: 'De pie no permitido',
  AMBIGUITY_TOO_HIGH: 'Demasiado ambiguo',
  INVALID_DATA: 'Datos inválidos',
  DUPLICATE: 'Duplicado',
  QTY_BELOW_MIN_GROUP: 'Grupo demasiado pequeño',
  OVER_BUDGET: 'Fuera de presupuesto',
  NO_ACCOUNT_CAPACITY: 'Sin cupo en la cuenta',
  NO_GROUP_CAPACITY: 'Sin cupo en el grupo',
  IN_FLIGHT: 'Ya en curso',
  UNAVAILABLE_OVERLAY: 'No disponible (reciente)',
};

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  SESSION_CHALLENGE: 'Reto de sesión',
  SESSION_EXPIRED: 'Sesión caducada',
  SESSION_NOT_READY: 'Sesión no lista',
  QUEUE_PROBLEM: 'Problema de cola',
  CART_CONFIRMED: 'Carrito confirmado',
  CART_EXPIRING: 'Carrito a punto de caducar',
  CART_EXPIRED: 'Carrito caducado',
  CART_SECURED: 'Carrito asegurado',
  CART_REVIEW: 'Carrito a revisar',
  AMBIGUOUS_RESULT: 'Resultado ambiguo',
  RECONCILIATION_NEEDS_HUMAN: 'Reconciliación manual',
  CIRCUIT_OPEN: 'Circuito abierto',
  SCHEMA_DRIFT: 'Cambio de esquema',
  RATE_LIMITED: 'Limitado por el proveedor',
  READINESS_FAILED: 'Readiness fallido',
  READINESS_WARN: 'Readiness con avisos',
  KILL_SWITCH: 'Kill switch',
  JOURNAL_DEGRADED: 'Journal degradado',
  OPERATION_ENDED: 'Operación finalizada',
  RECOVERY_REQUIRED: 'Recuperación necesaria',
  NO_PROGRESS: 'Sin progreso',
  HUMAN_TASK: 'Tarea humana',
  EVENT_WATCH: 'Vigilancia del evento',
};

export const GATE_NAME: Record<GateId, string> = {
  G0: 'Guardarraíles de diseño',
  G1: 'Corrección de la selección',
  G2: 'Seguridad de la asignación',
  G3: 'Latencia (SLO)',
  G4: 'Replay determinista',
  G5: 'Manual-assist y pago humano',
  G6: 'Resiliencia',
};

/** Por qué terminó una operación (se enseña junto a «Finalizada»). */
export const END_REASON_LABEL: Record<EndReason, string> = {
  RUN_WINDOW_ELAPSED: 'se agotó la ventana',
  OPERATOR_STOP: 'la paró una persona',
  READINESS_FAILED: 'falló la comprobación previa en T0 (el detalle está en «Preparación»)',
  NOT_STARTED_IN_WINDOW: 'no llegó a arrancar dentro de la ventana',
};

/**
 * Motivo de pausa legible y qué hacer. El servidor guarda códigos
 * («KILL_SWITCH operation:op_…», «SCHEMA_DRIFT»…) o el texto de quien pausó.
 * `nameOf` pone el nombre de la web de venta, la operación o la cuenta.
 */
export function pausedReasonText(reason: string, nameOf: (scope: 'PROVIDER' | 'OPERATION' | 'ACCOUNT', id: string) => string | null = () => null): string {
  const resume = 'suéltala en Seguridad y pulsa «Reanudar»';
  const ks = /^KILL_SWITCH (\S+)$/.exec(reason.trim());
  if (ks) {
    const key = ks[1] as string;
    if (key === 'global') return `Parada global (kill switch): ${resume}.`;
    const i = key.indexOf(':');
    const scope = key.slice(0, i).toUpperCase();
    const id = key.slice(i + 1);
    if (scope === 'PROVIDER' || scope === 'OPERATION' || scope === 'ACCOUNT') {
      const name = nameOf(scope, id);
      const what = scope === 'PROVIDER' ? 'de la web de venta' : scope === 'OPERATION' ? 'de la operación' : 'de la cuenta';
      return `Parada ${what}${name ? ` «${name}»` : ''} (kill switch): ${resume}.`;
    }
    return `Parada por kill switch (${key}): ${resume}.`;
  }
  switch (reason.trim()) {
    case 'JOURNAL_DEGRADED':
      return 'El journal no está guardando (sin auditoría no se automatiza): revisa el disco y pulsa «Reanudar» cuando vuelva.';
    case 'ARTEFACTO_NO_DISPONIBLE':
      return 'No está el recinto compilado de esta operación: revisa «Recintos · vault» y pulsa «Reanudar».';
    case 'SCHEMA_DRIFT':
      return 'La web de venta cambió el formato de sus respuestas: reinicia su circuito en Seguridad y pulsa «Reanudar».';
    case 'RECOVERY':
      return 'Reinicio del servidor: se están reconciliando los carritos en vuelo antes de seguir.';
    default:
      return reason;
  }
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Formatea unidades menores (céntimos) como moneda. */
export function formatMoney(minor: Minor, currency: string, locale = 'es-ES'): string {
  const key = `${locale}|${currency}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { style: 'currency', currency });
    } catch {
      f = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormatters.set(key, f);
  }
  return f.format(minor / 100);
}

/** Convierte un importe decimal introducido por una persona a unidades menores. */
export function toMinor(amount: number): Minor {
  return Math.round(amount * 100);
}

/** Duración compacta: 950 ms, 12,3 s, 4 min 05 s, 2 h 10 min. */
export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const a = Math.abs(ms);
  if (a < 1000) return `${sign}${Math.round(a)} ms`;
  if (a < 60_000) return `${sign}${(a / 1000).toFixed(1).replace('.', ',')} s`;
  if (a < 3_600_000) {
    const m = Math.floor(a / 60_000);
    const s = Math.floor((a % 60_000) / 1000);
    return `${sign}${m} min ${String(s).padStart(2, '0')} s`;
  }
  const h = Math.floor(a / 3_600_000);
  const m = Math.floor((a % 3_600_000) / 60_000);
  if (h < 48) return `${sign}${h} h ${String(m).padStart(2, '0')} min`;
  return `${sign}${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Cuenta atrás tipo reloj: 01:02:03 o 02:03. */
export function formatClock(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`;
}

/** Latencias pequeñas: 0,042 ms, 1,8 ms, 250 ms. */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1) return `${ms.toFixed(3).replace('.', ',')} ms`;
  if (ms < 10) return `${ms.toFixed(1).replace('.', ',')} ms`;
  return `${Math.round(ms)} ms`;
}
