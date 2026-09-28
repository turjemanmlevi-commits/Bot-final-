/**
 * Datos de demostración: cuentas ficticias (solo alias) y una operación contra
 * el simulador que arranca en pocos segundos para verla entera en el dashboard.
 */

import type { Account, AccountInput, Id, OperationConfig } from '@to/shared';
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
    budget: 100_000,
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
    simulation: { scenarioId: opts.scenarioId ?? 'demo', seed: opts.seed ?? Math.floor(now % 100_000) },
  };
  const op = runtime.ctx.ops.create(config, actor);
  const validated = await runtime.ctx.ops.command(op.id, { command: 'validate' }, actor);
  if (!validated.ok) throw new Error(`La demo no valida: ${validated.validation?.issues.map((i) => i.message).join(' · ')}`);
  const armed = await runtime.ctx.ops.command(op.id, { command: 'arm' }, actor);
  if (!armed.ok) throw new Error(`La demo no se puede armar: ${armed.message}`);

  let manualOperationId: Id | null = null;
  const manualEvent = runtime.store.events.get(DEMO_MANUAL_EVENT);
  const manualBusy = manualAccounts.some((a) => a.leasedBy !== null);
  if (manualEvent && !manualBusy) {
    const manual = runtime.ctx.ops.create(
      {
        name: `Demo manual · ${manualEvent.name}`,
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
