/**
 * Validación semántica de una configuración de operación (§5).
 *
 * Fail-closed: cualquier ERROR impide armar. Los WARNING se muestran pero no bloquean.
 */

import type {
  Account,
  CatalogEvent,
  CompiledPolicy,
  Id,
  OperationConfig,
  ProviderDescriptor,
  ValidationIssue,
  ValidationReport,
  VenueArtifact,
} from '@to/shared';
import { formatMoney } from '@to/shared';
import { iso } from '../util/time';
import { effectiveCapacity, groupKeyFor } from './limits';
import { compilePolicy } from './policy';

export const MAX_ACCOUNTS_PER_OPERATION = 10;

export interface ValidationContext {
  now: number;
  operationId: Id;
  configVersion: number;
  event: CatalogEvent | null;
  artifact: VenueArtifact | null;
  provider: ProviderDescriptor | null;
  accounts: ReadonlyMap<Id, Account>;
  scenarioIds: readonly string[];
  /** Operación (distinta de esta) que tiene arrendada la cuenta, o null. */
  leasedBy: (accountId: Id) => Id | null;
  /** Comprobaciones adicionales al armar (arrendamientos, sesiones bloqueadas). */
  forArm: boolean;
  maxSnapshotAgeMs?: number;
}

export function accountEligible(account: Account, event: CatalogEvent): boolean {
  if (account.eligibility.length === 0) return false;
  return account.eligibility.some((e) => e === '*' || e === event.id || event.tags.includes(e));
}

export function validateConfig(config: OperationConfig, ctx: ValidationContext): ValidationReport {
  const issues: ValidationIssue[] = [];
  const err = (code: string, field: string | null, message: string) => issues.push({ code, severity: 'ERROR', field, message });
  const warn = (code: string, field: string | null, message: string) => issues.push({ code, severity: 'WARNING', field, message });
  const { event, provider, artifact } = ctx;
  const money = (m: number) => formatMoney(m, config.currency);

  // Evento y proveedor -------------------------------------------------------
  if (!event) err('EVENT_NOT_FOUND', 'eventId', `El evento ${config.eventId} no está en el vault.`);
  if (!provider) err('PROVIDER_UNKNOWN', 'providerId', `No hay adapter registrado para el proveedor ${config.providerId}.`);
  if (event && event.providerId !== config.providerId) {
    err('PROVIDER_EVENT_MISMATCH', 'providerId', `El evento se vende en ${event.providerId}, no en ${config.providerId}.`);
  }
  if (provider) {
    if (provider.mode === 'SIMULATED') {
      if (config.simulation && !ctx.scenarioIds.includes(config.simulation.scenarioId)) {
        err('SIMULATION_SCENARIO_UNKNOWN', 'simulation.scenarioId', `Escenario desconocido: ${config.simulation.scenarioId}.`);
      }
    } else if (config.simulation) {
      warn('SIMULATION_IGNORED', 'simulation', 'El proveedor no es simulado: el escenario se ignora.');
    }
    const cartAdd = provider.capabilities.find((c) => c.name === 'cart.add');
    if (!cartAdd || cartAdd.executor === 'DISABLED') {
      err('CART_ADD_UNAVAILABLE', 'providerId', 'El proveedor no permite añadir al carrito ni de forma automática ni asistida.');
    }
  }

  // Límites del evento (fail-closed) ------------------------------------------
  if (event) {
    const l = event.limits;
    if (!l.verified) err('LIMITS_UNVERIFIED', 'eventId', 'Los límites del evento no están verificados en el vault (limitsVerified: false).');
    if (l.semantics === 'UNKNOWN') err('LIMITS_SEMANTICS_UNKNOWN', 'eventId', 'La semántica de los límites es UNKNOWN: no se sabe cómo agrupar cuentas.');
    if (l.perAccount < 1) err('LIMITS_MISSING', 'eventId', 'El evento no tiene límite por cuenta.');
    if (l.perOperation < 1) err('LIMITS_MISSING', 'eventId', 'El evento no tiene tope por operación.');
  }

  // Tiempo ---------------------------------------------------------------------
  const t0 = Date.parse(config.t0);
  if (Number.isNaN(t0)) err('T0_INVALID', 't0', 'T0 no es una fecha válida.');
  if (config.runWindowMinutes < 1 || config.runWindowMinutes > 24 * 60) {
    err('RUN_WINDOW_INVALID', 'runWindowMinutes', 'La ventana debe durar entre 1 minuto y 24 horas.');
  }
  if (config.freezeLeadSeconds < 0 || config.freezeLeadSeconds > 3600) {
    err('FREEZE_LEAD_INVALID', 'freezeLeadSeconds', 'El congelado previo debe estar entre 0 y 3600 s.');
  }
  if (!Number.isNaN(t0)) {
    const windowEnd = t0 + config.runWindowMinutes * 60_000;
    if (windowEnd <= ctx.now) err('T0_WINDOW_PASSED', 't0', 'La ventana de ejecución ya ha terminado.');
    else if (ctx.forArm && t0 < ctx.now) warn('T0_PASSED', 't0', 'T0 ya ha pasado: la operación arrancará en cuanto se arme.');
    if (event && Date.parse(event.startsAt) < t0) warn('T0_AFTER_EVENT', 't0', 'T0 es posterior al inicio del evento.');
  }

  // Cantidad, moneda, precio y presupuesto --------------------------------------
  if (config.requestedQty < 1) err('QTY_INVALID', 'requestedQty', 'La cantidad debe ser al menos 1.');
  if (event && event.limits.perOperation >= 1 && config.requestedQty > event.limits.perOperation) {
    err('QTY_ABOVE_OPERATION_LIMIT', 'requestedQty', `El evento permite como máximo ${event.limits.perOperation} entradas por operación.`);
  }
  if (event && config.currency !== event.currency) {
    err('CURRENCY_MISMATCH', 'currency', `El evento se vende en ${event.currency}.`);
  }
  if (config.maxUnitPrice <= 0) err('MAX_PRICE_INVALID', 'maxUnitPrice', 'El precio máximo por entrada debe ser positivo.');
  if (config.budget <= 0) err('BUDGET_INVALID', 'budget', 'El presupuesto debe ser positivo.');
  const prefs = config.preferences;
  if (config.maxUnitPrice > 0 && config.budget > 0) {
    if (config.budget < prefs.minGroupSize * config.maxUnitPrice) {
      warn('BUDGET_TIGHT', 'budget', `Con ${money(config.budget)} puede no alcanzar ni para un grupo de ${prefs.minGroupSize} a precio máximo.`);
    } else if (config.budget < config.requestedQty * config.maxUnitPrice) {
      warn('BUDGET_BELOW_MAX_SPEND', 'budget', `Si los precios llegan al máximo, ${money(config.budget)} no cubre ${config.requestedQty} entradas.`);
    }
  }

  // Preferencias -------------------------------------------------------------------
  if (prefs.minGroupSize < 1 || prefs.minGroupSize > Math.max(1, config.requestedQty)) {
    err('MIN_GROUP_INVALID', 'preferences.minGroupSize', 'El grupo mínimo debe estar entre 1 y la cantidad pedida.');
  }
  if (event && event.limits.perAccount >= 1 && prefs.minGroupSize > event.limits.perAccount) {
    err('MIN_GROUP_ABOVE_ACCOUNT_LIMIT', 'preferences.minGroupSize', `Ninguna cuenta puede comprar grupos de ${prefs.minGroupSize}: el límite por cuenta es ${event.limits.perAccount}.`);
  }
  if (prefs.maxPerAccount !== undefined && prefs.maxPerAccount !== null) {
    if (!Number.isInteger(prefs.maxPerAccount) || prefs.maxPerAccount < 1) {
      err('MAX_PER_ACCOUNT_INVALID', 'preferences.maxPerAccount', 'Las entradas por cuenta deben ser un número entero desde 1.');
    } else if (prefs.minGroupSize > prefs.maxPerAccount) {
      err('MIN_GROUP_ABOVE_PER_ACCOUNT', 'preferences.minGroupSize', `Con ${prefs.maxPerAccount} entrada${prefs.maxPerAccount === 1 ? '' : 's'} por cuenta, el grupo mínimo no puede ser ${prefs.minGroupSize}.`);
    } else if (config.accountIds.length > 0 && config.requestedQty > config.accountIds.length * prefs.maxPerAccount) {
      warn(
        'PER_ACCOUNT_BELOW_REQUESTED',
        'requestedQty',
        `Con ${prefs.maxPerAccount} por cuenta y ${config.accountIds.length} cuenta${config.accountIds.length === 1 ? '' : 's'} no se llega a ${config.requestedQty} entradas.`,
      );
    }
  }
  if (prefs.maxAmbiguity < 0 || prefs.maxAmbiguity > 1) {
    err('MAX_AMBIGUITY_INVALID', 'preferences.maxAmbiguity', 'La ambigüedad máxima va de 0 a 1.');
  } else if (prefs.maxAmbiguity > 0.5) {
    warn('MAX_AMBIGUITY_HIGH', 'preferences.maxAmbiguity', 'Una ambigüedad máxima alta puede comprar en secciones mal identificadas.');
  }

  // Cuentas ------------------------------------------------------------------------
  const validAccounts: Account[] = [];
  if (config.accountIds.length === 0) err('NO_ACCOUNTS', 'accountIds', 'Selecciona al menos una cuenta.');
  if (config.accountIds.length > MAX_ACCOUNTS_PER_OPERATION) {
    err('TOO_MANY_ACCOUNTS', 'accountIds', `Como máximo ${MAX_ACCOUNTS_PER_OPERATION} cuentas por operación.`);
  }
  const seen = new Set<Id>();
  for (const id of config.accountIds) {
    if (seen.has(id)) {
      err('DUPLICATE_ACCOUNT', 'accountIds', `Cuenta repetida: ${id}.`);
      continue;
    }
    seen.add(id);
    const a = ctx.accounts.get(id);
    if (!a) {
      err('ACCOUNT_NOT_FOUND', 'accountIds', `La cuenta ${id} no existe.`);
      continue;
    }
    let ok = true;
    const bad = (code: string, message: string) => {
      err(code, 'accountIds', `${a.label}: ${message}`);
      ok = false;
    };
    if (!a.enabled) bad('ACCOUNT_DISABLED', 'está desactivada.');
    if (a.providerId !== config.providerId) bad('ACCOUNT_PROVIDER_MISMATCH', `es de ${a.providerId}.`);
    if (a.verification === 'UNVERIFIED') bad('ACCOUNT_UNVERIFIED', 'no está verificada como cuenta legítima.');
    if (a.verification === 'NEEDS_ATTENTION') warn('ACCOUNT_NEEDS_ATTENTION', 'accountIds', `${a.label}: requiere atención.`);
    if (event && !accountEligible(a, event)) bad('ACCOUNT_NOT_ELIGIBLE', 'no es elegible para este evento.');
    if (event && event.limits.semantics !== 'UNKNOWN' && groupKeyFor(a, event.limits.semantics) === null) {
      bad('GROUP_REF_MISSING', event.limits.semantics === 'PER_HOUSEHOLD' ? 'falta la referencia de hogar.' : 'falta la referencia del medio de pago.');
    }
    if (ctx.forArm) {
      const other = ctx.leasedBy(a.id);
      if (other) bad('ACCOUNT_LEASED', `la está usando otra operación (${other}).`);
      if (a.session.state === 'BLOCKED') bad('ACCOUNT_BLOCKED', 'la sesión está bloqueada por el proveedor.');
    }
    if (ok) validAccounts.push(a);
  }

  // Recinto y política ----------------------------------------------------------------
  let compiledPolicy: CompiledPolicy | null = null;
  if (event && !artifact) err('VENUE_ARTIFACT_MISSING', 'eventId', 'No hay artefacto compilado del recinto: recompila el vault.');
  if (artifact) {
    const r = compilePolicy(config, artifact, { maxSnapshotAgeMs: ctx.maxSnapshotAgeMs });
    issues.push(...r.issues);
    compiledPolicy = r.policy;
    if (artifact.provenance.confidence < 0.6) {
      warn('VENUE_LOW_CONFIDENCE', null, `La información del recinto tiene confianza baja (${artifact.provenance.confidence}).`);
    }
  }

  // Capacidad legal ---------------------------------------------------------------------
  let capacity: number | null = null;
  if (event && event.limits.semantics !== 'UNKNOWN') {
    capacity = effectiveCapacity(validAccounts, event.limits, config.requestedQty);
    if (validAccounts.length > 0 && capacity < config.requestedQty) {
      warn('CAPACITY_SHORTFALL', 'accountIds', `Con estas cuentas y los límites del evento solo se pueden conseguir ${capacity} de ${config.requestedQty} entradas.`);
    }
  }

  return {
    operationId: ctx.operationId,
    configVersion: ctx.configVersion,
    at: iso(ctx.now),
    ok: !issues.some((i) => i.severity === 'ERROR'),
    issues,
    compiledPolicy,
    effectiveCapacity: capacity,
  };
}
