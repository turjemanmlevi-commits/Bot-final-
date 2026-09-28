/**
 * Readiness (§6): lista de comprobaciones antes de T0. Pura: recibe una foto
 * del sistema y devuelve PASS/WARN/FAIL por comprobación con la acción que
 * debe hacer una persona.
 */

import type {
  Account,
  CircuitState,
  EventLimits,
  Id,
  KillSwitch,
  ProviderDescriptor,
  ReadinessCheck,
  ReadinessPhase,
  ReadinessReport,
  ReadinessStatus,
} from '@to/shared';
import { formatDuration, SESSION_STATE_LABEL } from '@to/shared';
import { iso } from '../util/time';

export const CLOCK_SKEW_WARN_MS = 250;
export const CLOCK_SKEW_FAIL_MS = 2000;

export interface ReadinessInput {
  operationId: Id;
  phase: ReadinessPhase;
  now: number;
  t0Ms: number;
  limits: EventLimits | null;
  artifact: { hash: string; name: string; confidence: number } | null;
  accounts: Account[];
  provider: ProviderDescriptor | null;
  circuits: CircuitState[];
  killSwitchesEngaged: KillSwitch[];
  journal: { healthy: boolean; driver: string };
  telegram: { enabled: boolean; connected: boolean };
  clockSkewMs: number | null;
}

const ORDER: Record<ReadinessStatus, number> = { PASS: 0, WARN: 1, FAIL: 2 };

export function worst(statuses: ReadinessStatus[]): ReadinessStatus {
  return statuses.reduce<ReadinessStatus>((acc, s) => (ORDER[s] > ORDER[acc] ? s : acc), 'PASS');
}

export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  const add = (id: string, label: string, status: ReadinessStatus, detail: string, action: ReadinessCheck['action'] = null, accountId: Id | null = null) =>
    checks.push({ id, label, status, detail, action, accountId });
  // Solo es "la última oportunidad" en T-5m o en una comprobación manual cerca de T0.
  const lastPhase = input.phase === 'T-5m' || (input.phase === 'MANUAL' && input.t0Ms - input.now <= 5 * 60_000);

  // Límites
  if (!input.limits) add('limits', 'Límites del evento', 'FAIL', 'El evento ya no está en el vault.', 'REVALIDATE');
  else if (!input.limits.verified || input.limits.semantics === 'UNKNOWN') {
    add('limits', 'Límites del evento', 'FAIL', 'Límites sin verificar o con semántica desconocida (fail-closed).', 'REVALIDATE');
  } else {
    add('limits', 'Límites del evento', 'PASS', `${input.limits.perAccount}/cuenta · ${input.limits.perGroup}/grupo · ${input.limits.perOperation}/operación (${input.limits.semantics})`);
  }

  // Recinto
  if (!input.artifact) add('venue', 'Recinto compilado', 'FAIL', 'No hay artefacto del recinto.', 'REVALIDATE');
  else if (input.artifact.confidence < 0.6) add('venue', 'Recinto compilado', 'WARN', `${input.artifact.name}: confianza ${input.artifact.confidence}.`);
  else add('venue', 'Recinto compilado', 'PASS', `${input.artifact.name} · ${input.artifact.hash.slice(0, 12)}`);

  // Proveedor y capabilities
  const p = input.provider;
  if (!p) add('provider', 'Proveedor', 'FAIL', 'Adapter no registrado.');
  else {
    const cartAdd = p.capabilities.find((c) => c.name === 'cart.add');
    if (!cartAdd || cartAdd.executor === 'DISABLED') add('provider', 'Proveedor', 'FAIL', 'Añadir al carrito no está disponible.');
    else add('provider', 'Proveedor', 'PASS', `${p.name} (${p.mode}) · cart.add: ${cartAdd.executor === 'AUTOMATED' ? 'automático' : 'humano'}`);
  }

  // Circuitos
  const open = input.circuits.filter((c) => c.state !== 'CLOSED');
  if (open.length === 0) add('circuits', 'Circuitos', 'PASS', 'Todos cerrados.');
  else {
    const manual = open.some((c) => c.requiresManualReset);
    add('circuits', 'Circuitos', manual || open.some((c) => c.state === 'OPEN') ? 'FAIL' : 'WARN', open.map((c) => `${c.capability}: ${c.state}${c.reason ? ` (${c.reason})` : ''}`).join(' · '));
  }

  // Kill switches
  if (input.killSwitchesEngaged.length === 0) add('kill', 'Kill switches', 'PASS', 'Ninguno activo.');
  else add('kill', 'Kill switches', 'FAIL', input.killSwitchesEngaged.map((k) => `${k.scope}${k.targetId ? `:${k.targetId}` : ''}${k.reason ? ` — ${k.reason}` : ''}`).join(' · '));

  // Journal
  if (!input.journal.healthy) add('journal', 'Journal', 'FAIL', 'El journal no está persistiendo: sin auditoría no se automatiza.');
  else if (input.journal.driver === 'memory') add('journal', 'Journal', 'WARN', 'Journal en memoria: un reinicio pierde el estado.');
  else add('journal', 'Journal', 'PASS', `Persistiendo en ${input.journal.driver}.`);

  // Telegram
  if (!input.telegram.enabled) add('telegram', 'Telegram', 'PASS', 'Desactivado (solo dashboard).');
  else if (!input.telegram.connected) add('telegram', 'Telegram', 'WARN', 'Configurado pero sin conexión: las alertas solo llegarán al dashboard.');
  else add('telegram', 'Telegram', 'PASS', 'Conectado.');

  // Reloj
  const clockCap = p?.capabilities.find((c) => c.name === 'clock.server_time');
  if (!clockCap || clockCap.executor !== 'AUTOMATED') add('clock', 'Reloj del proveedor', 'PASS', 'No aplica en este modo.');
  else if (input.clockSkewMs === null) add('clock', 'Reloj del proveedor', 'WARN', 'Todavía no se ha medido el desfase.');
  else {
    const skew = Math.abs(input.clockSkewMs);
    const status: ReadinessStatus = skew > CLOCK_SKEW_FAIL_MS ? 'FAIL' : skew > CLOCK_SKEW_WARN_MS ? 'WARN' : 'PASS';
    add('clock', 'Reloj del proveedor', status, `Desfase ${Math.round(input.clockSkewMs)} ms (se compensa en T0).`);
  }

  // Cuentas
  let ready = 0;
  let opening = 0;
  for (const a of input.accounts) {
    if (a.session.state === 'OPENING') opening++;
    const s = a.session.state;
    if (s === 'READY') {
      ready++;
      add(`session:${a.id}`, `Sesión ${a.label}`, 'PASS', 'Lista.', null, a.id);
    } else if (s === 'BLOCKED') {
      add(`session:${a.id}`, `Sesión ${a.label}`, 'WARN', 'Bloqueada por el proveedor: no participará.', null, a.id);
    } else {
      const detail =
        s === 'CHALLENGE_REQUIRED'
          ? `Reto ${a.session.challenge?.type ?? ''} pendiente: resuélvelo tú en el proveedor.`
          : `${SESSION_STATE_LABEL[s]}${a.session.detail ? ` — ${a.session.detail}` : ''}`;
      add(`session:${a.id}`, `Sesión ${a.label}`, 'WARN', detail, 'OPEN_SESSION', a.id);
    }
  }
  const t = input.t0Ms - input.now;
  const when = t > 0 ? `faltan ${formatDuration(t)}` : 'T0 alcanzado';
  // En asistencia manual nada se automatiza: una persona puede iniciar sesión
  // después de T0 y el runner le abrirá la tarea. No hay motivo para abortar.
  const manual = p?.mode === 'MANUAL_ASSIST';
  if (input.accounts.length === 0) add('accounts', 'Cuentas listas', 'FAIL', 'La operación no tiene cuentas.');
  else if (ready === 0 && opening > 0) add('accounts', 'Cuentas listas', 'WARN', `Abriendo sesiones (${opening}/${input.accounts.length})…`);
  else if (ready === 0) {
    add(
      'accounts',
      'Cuentas listas',
      lastPhase && !manual ? 'FAIL' : 'WARN',
      `0/${input.accounts.length} cuentas listas (${when}).${manual ? ' Cada persona: inicia sesión en la web oficial y pulsa «Sesión lista».' : ''}`,
      'OPEN_SESSION',
    );
  } else add('accounts', 'Cuentas listas', ready === input.accounts.length ? 'PASS' : 'WARN', `${ready}/${input.accounts.length} cuentas listas (${when}).`);

  return {
    operationId: input.operationId,
    phase: input.phase,
    at: iso(input.now),
    overall: worst(checks.map((c) => c.status)),
    checks,
  };
}
