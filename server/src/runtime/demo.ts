/**
 * Datos de demostración: cuentas ficticias (solo alias) y una operación contra
 * el simulador que arranca en pocos segundos para verla entera en el dashboard.
 */

import type { Account, AccountInput, Id, OperationConfig } from '@to/shared';
import { scenarioInfos } from '../providers/scenarios';
import { iso } from '../util/time';
import type { Runtime } from './runtime';

const SIM_ACCOUNTS: AccountInput[] = [
  { label: 'Ana · principal', providerId: 'sim', holderRef: 'ana', householdRef: 'casa-norte', paymentRef: 'tarjeta-ana', verification: 'VERIFIED' },
  { label: 'Ana · segunda', providerId: 'sim', holderRef: 'ana', householdRef: 'casa-norte', paymentRef: 'tarjeta-ana', verification: 'VERIFIED' },
  { label: 'Bruno', providerId: 'sim', holderRef: 'bruno', householdRef: 'casa-norte', paymentRef: 'tarjeta-bruno', verification: 'VERIFIED' },
  { label: 'Carla', providerId: 'sim', holderRef: 'carla', householdRef: 'casa-sur', paymentRef: 'tarjeta-carla', verification: 'VERIFIED' },
  { label: 'Dani', providerId: 'sim', holderRef: 'dani', householdRef: 'casa-sur', paymentRef: 'tarjeta-dani', verification: 'VERIFIED' },
  { label: 'Eva', providerId: 'sim', holderRef: 'eva', householdRef: 'piso-centro', paymentRef: 'tarjeta-eva', verification: 'VERIFIED' },
];

const MANUAL_ACCOUNTS: AccountInput[] = [
  { label: 'Fer (manual)', providerId: 'manual', holderRef: 'fer', householdRef: null, paymentRef: 'tarjeta-fer', verification: 'VERIFIED' },
  { label: 'Gala (manual)', providerId: 'manual', holderRef: 'gala', householdRef: null, paymentRef: 'tarjeta-gala', verification: 'VERIFIED' },
];

export const DEMO_SIM_EVENT = 'evt-gira-demo-2026-madrid';
export const DEMO_MANUAL_EVENT = 'evt-noche-flamenca-demo-sevilla';

function ensureAccounts(runtime: Runtime, inputs: AccountInput[], actor: string): Account[] {
  const out: Account[] = [];
  for (const input of inputs) {
    const existing = [...runtime.store.accounts.values()].find((a) => a.label === input.label && a.providerId === input.providerId);
    out.push(existing ?? runtime.ctx.accounts.create({ ...input, eligibility: ['*'] }, actor));
  }
  return out;
}

/** Una sola demo de cada tipo: la de una demo anterior que se quedó sin armar (borrador o validada) se cancela. */
async function cancelUnarmed(runtime: Runtime, eventId: Id, name: string, actor: string): Promise<void> {
  for (const r of [...runtime.store.operations.values()]) {
    if (r.config.eventId === eventId && r.config.name === name && (r.state === 'DRAFT' || r.state === 'VALIDATED')) {
      await runtime.ctx.ops.command(r.id, { command: 'cancel', reason: 'Sustituida por una demo nueva' }, actor);
    }
  }
}

export interface DemoResult {
  operationId: Id;
  manualOperationId: Id | null;
  accounts: number;
  t0: string;
  message: string;
}

export async function seedDemo(
  runtime: Runtime,
  opts: { startInSeconds?: number; scenarioId?: string; seed?: number; actor?: string } = {},
): Promise<DemoResult> {
  const actor = opts.actor ?? 'demo';
  const now = runtime.ctx.now();
  // Antes de crear nada: un escenario que no existe no deja cuentas ni operaciones a medias.
  const scenarioId = opts.scenarioId ?? 'demo';
  const scenarios = scenarioInfos().map((s) => s.id);
  if (!scenarios.includes(scenarioId)) throw new Error(`Escenario desconocido: «${scenarioId}». Usa uno de estos: ${scenarios.join(', ')}.`);
  const simAccounts = ensureAccounts(runtime, SIM_ACCOUNTS, actor);
  const manualAccounts = ensureAccounts(runtime, MANUAL_ACCOUNTS, actor);

  const event = runtime.store.events.get(DEMO_SIM_EVENT);
  if (!event) throw new Error(`Falta el evento de demo ${DEMO_SIM_EVENT} en el vault (20 Eventos)`);
  // Una demo anterior ya terminada se cierra sola; una en marcha hay que pararla antes.
  for (const a of simAccounts) {
    const leasedBy = runtime.store.accounts.get(a.id)?.leasedBy;
    const prev = leasedBy ? runtime.store.operations.get(leasedBy) : undefined;
    if (!prev) continue;
    if (prev.state === 'ENDED' || prev.state === 'CART_SECURED') await runtime.ctx.ops.command(prev.id, { command: 'close' }, actor);
    else if (!['CANCELLED', 'CLOSED'].includes(prev.state)) {
      throw new Error(`Las cuentas de demo están en "${prev.config.name}" (${prev.state}). Párala o cancélala antes de crear otra demo.`);
    }
  }
  // El cupo por titular es del evento y en el simulador no se paga nada: los carritos que
  // dejaron las demos anteriores (ya cerradas) se liberan para que la nueva tenga su cupo.
  for (const c of [...runtime.store.carts.values()]) {
    const prev = runtime.store.operations.get(c.operationId);
    if (prev?.config.eventId !== event.id || (prev.state !== 'CLOSED' && prev.state !== 'CANCELLED')) continue;
    if (c.state === 'ACTIVE' || c.state === 'REVIEW_REQUIRED') runtime.ctx.carts.mark(c.id, 'RELEASED', actor, 'Demo anterior');
  }

  const t0 = iso(now + (opts.startInSeconds ?? 90) * 1000);
  const config: OperationConfig = {
    name: `Demo · ${event.name}`,
    eventId: event.id,
    providerId: 'sim',
    t0,
    runWindowMinutes: 10,
    freezeLeadSeconds: 30,
    requestedQty: 8,
    currency: 'EUR',
    maxUnitPrice: 13_000,
    // 8 × 130 €: cubre las 8 entradas aunque todas lleguen al máximo (sin aviso de presupuesto).
    budget: 104_000,
    preferences: {
      targets: ['Pista A', '103', '104', 'Grada Baja', 'Pista B'],
      excludeSections: [],
      requireContiguous: true,
      minGroupSize: 2,
      allowStanding: true,
      allowObstructed: false,
      allowAccessible: false,
      maxAmbiguity: 0.3,
    },
    accountIds: simAccounts.map((a) => a.id),
    cartExpiryAlertsSeconds: [300, 120, 60],
    simulation: { scenarioId, seed: opts.seed ?? Math.floor(now % 100_000) },
  };
  await cancelUnarmed(runtime, event.id, config.name, actor);
  const op = runtime.ctx.ops.create(config, actor);
  // Si no valida o no se arma, no se deja una operación huérfana en borrador.
  const validated = await runtime.ctx.ops.command(op.id, { command: 'validate' }, actor);
  if (!validated.ok) {
    await runtime.ctx.ops.command(op.id, { command: 'cancel', reason: 'La demo no valida' }, actor);
    throw new Error(`La demo no valida: ${validated.validation?.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message).join(' · ')}`);
  }
  const armed = await runtime.ctx.ops.command(op.id, { command: 'arm' }, actor);
  if (!armed.ok) {
    await runtime.ctx.ops.command(op.id, { command: 'cancel', reason: 'La demo no se puede armar' }, actor);
    throw new Error(`La demo no se puede armar: ${armed.message}`);
  }

  let manualOperationId: Id | null = null;
  const manualEvent = runtime.store.events.get(DEMO_MANUAL_EVENT);
  const manualBusy = manualAccounts.some((a) => a.leasedBy !== null);
  if (manualEvent && !manualBusy) {
    const name = `Demo manual · ${manualEvent.name}`;
    await cancelUnarmed(runtime, manualEvent.id, name, actor);
    const manual = runtime.ctx.ops.create(
      {
        name,
        eventId: manualEvent.id,
        providerId: 'manual',
        t0: iso(now + 15 * 60_000),
        runWindowMinutes: 30,
        freezeLeadSeconds: 60,
        requestedQty: 4,
        currency: 'EUR',
        maxUnitPrice: 6_000,
        budget: 24_000,
        preferences: {
          targets: ['Platea Central', 'Platea'],
          excludeSections: [],
          requireContiguous: true,
          minGroupSize: 2,
          allowStanding: false,
          allowObstructed: false,
          allowAccessible: false,
          maxAmbiguity: 0.2,
        },
        accountIds: manualAccounts.map((a) => a.id),
        cartExpiryAlertsSeconds: [300, 60],
      },
      actor,
    );
    await runtime.ctx.ops.command(manual.id, { command: 'validate' }, actor);
    manualOperationId = manual.id;
  }

  return {
    operationId: op.id,
    manualOperationId,
    accounts: simAccounts.length + manualAccounts.length,
    t0,
    message: `Demo armada: arranca a las ${new Date(t0).toLocaleTimeString('es-ES')} (T0). Mira el dashboard.`,
  };
}
