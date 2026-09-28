/**
 * Arnés de simulación: monta el sistema completo con reloj virtual y journal
 * en memoria y ejecuta una operación de principio a fin en milisegundos.
 */

import type { AccountInput, AllocationState, Id, OperationConfig, OperationState } from '@to/shared';
import { createApp, type App } from '../app';
import { allocationViolations } from '../domain/allocation';
import { MemoryDriver } from '../store/drivers';
import { VirtualClock } from '../util/clock';
import { SeqIdGen } from '../util/ids';
import { setLogSilent } from '../util/log';
import { iso } from '../util/time';
import { compileVault } from '../vault/compiler';
import { FIXTURE_MANUAL_EVENT, FIXTURE_SIM_EVENT } from './fixtures';

export const SIM_START = Date.parse('2026-10-09T08:00:00Z');

export interface Harness {
  app: App;
  clock: VirtualClock;
  driver: MemoryDriver;
  violations: string[];
  /** Una "persona" que resuelve los retos de sesión (lo que haría el operador). */
  humanSolvesChallenges(): void;
  stop(): Promise<void>;
}

export async function createHarness(vaultDir: string, opts: { seed?: number; driver?: MemoryDriver; start?: number } = {}): Promise<Harness> {
  setLogSilent(true);
  const clock = new VirtualClock(opts.start ?? SIM_START);
  const driver = opts.driver ?? new MemoryDriver();
  const app = await createApp({
    driver,
    vaultDir: null,
    timeZone: 'Europe/Madrid',
    publicBaseUrl: 'http://sim.local',
    clock,
    ids: new SeqIdGen(),
    simSeed: opts.seed ?? 1,
    journalFlushMs: 100,
  });
  const compiled = await compileVault({ vaultDir, timeZone: 'Europe/Madrid', now: () => clock.now() });
  app.runtime.applyVault(compiled, { force: true });
  const violations: string[] = [];
  const store = app.runtime.store;
  const original = store.putAllocation.bind(store);
  store.putAllocation = (a: AllocationState) => {
    for (const v of allocationViolations(a)) violations.push(`${a.operationId}@${a.version}:${v}`);
    original(a);
  };
  let humanTimer: number | null = null;
  return {
    app,
    clock,
    driver,
    violations,
    humanSolvesChallenges() {
      if (humanTimer !== null) return;
      humanTimer = clock.setInterval(() => {
        for (const a of store.accounts.values()) {
          if (a.session.state === 'CHALLENGE_REQUIRED') app.runtime.ctx.accounts.humanReady(a.id, 'persona-simulada');
        }
      }, 700);
    },
    async stop() {
      if (humanTimer !== null) clock.clearInterval(humanTimer);
      await app.stop();
    },
  };
}

export const SIM_ACCOUNTS: AccountInput[] = [
  { label: 'A1', providerId: 'sim', holderRef: 'ana', householdRef: 'h1', paymentRef: 'p-ana', verification: 'VERIFIED' },
  { label: 'A2', providerId: 'sim', holderRef: 'ana', householdRef: 'h1', paymentRef: 'p-ana', verification: 'VERIFIED' },
  { label: 'B1', providerId: 'sim', holderRef: 'bruno', householdRef: 'h1', paymentRef: 'p-bruno', verification: 'VERIFIED' },
  { label: 'C1', providerId: 'sim', holderRef: 'carla', householdRef: 'h2', paymentRef: 'p-carla', verification: 'VERIFIED' },
  { label: 'D1', providerId: 'sim', holderRef: 'dani', householdRef: 'h2', paymentRef: 'p-dani', verification: 'VERIFIED' },
  { label: 'E1', providerId: 'sim', holderRef: 'eva', householdRef: 'h3', paymentRef: 'p-eva', verification: 'VERIFIED' },
];

export function simConfig(accountIds: Id[], now: number, overrides: Partial<OperationConfig> = {}): OperationConfig {
  return {
    name: 'Gate sim',
    eventId: FIXTURE_SIM_EVENT,
    providerId: 'sim',
    t0: iso(now + 60_000),
    runWindowMinutes: 10,
    freezeLeadSeconds: 30,
    requestedQty: 8,
    currency: 'EUR',
    maxUnitPrice: 13_000,
    budget: 104_000,
    preferences: {
      targets: ['Pista Frontal', 'T3', 'T4', 'Tribuna', 'Pista Fondo'],
      excludeSections: [],
      requireContiguous: true,
      minGroupSize: 2,
      allowStanding: true,
      allowObstructed: false,
      allowAccessible: false,
      maxAmbiguity: 0.3,
    },
    accountIds,
    cartExpiryAlertsSeconds: [300, 120, 60],
    simulation: { scenarioId: 'demo', seed: 1 },
    ...overrides,
  };
}

export function manualConfig(accountIds: Id[], now: number): OperationConfig {
  return {
    name: 'Gate manual',
    eventId: FIXTURE_MANUAL_EVENT,
    providerId: 'manual',
    t0: iso(now + 60_000),
    runWindowMinutes: 30,
    freezeLeadSeconds: 30,
    requestedQty: 4,
    currency: 'EUR',
    maxUnitPrice: 6_000,
    budget: 24_000,
    preferences: {
      targets: ['T3', 'Tribuna'],
      excludeSections: [],
      requireContiguous: true,
      minGroupSize: 2,
      allowStanding: false,
      allowObstructed: false,
      allowAccessible: false,
      maxAmbiguity: 0.2,
    },
    accountIds,
    cartExpiryAlertsSeconds: [300, 60],
  };
}

export interface SimResult {
  operationId: Id;
  finalState: OperationState;
  requested: number;
  carted: number;
  claims: number;
  ambiguousLeft: number;
  violations: string[];
  priceViolations: number;
  providerCalls: number;
  harness: Harness;
}

const DONE: OperationState[] = ['CART_SECURED', 'ENDED', 'CANCELLED', 'CLOSED'];

/** Simula una operación completa contra el simulador y devuelve el resultado. */
export async function simulateOperation(
  vaultDir: string,
  opts: { scenarioId: string; seed: number; requestedQty?: number; keepRunning?: boolean },
): Promise<SimResult> {
  const h = await createHarness(vaultDir, { seed: opts.seed });
  const rt = h.app.runtime;
  const accounts = SIM_ACCOUNTS.map((a) => rt.ctx.accounts.create(a, 'gate'));
  const now = h.clock.now();
  const op = rt.ctx.ops.create(
    simConfig(accounts.map((a) => a.id), now, {
      requestedQty: opts.requestedQty ?? 8,
      simulation: { scenarioId: opts.scenarioId, seed: opts.seed },
    }),
    'gate',
  );
  await rt.ctx.ops.command(op.id, { command: 'validate' }, 'gate');
  const armed = await rt.ctx.ops.command(op.id, { command: 'arm' }, 'gate');
  if (!armed.ok) throw new Error(`No se pudo armar la simulación: ${armed.message}`);
  h.humanSolvesChallenges();
  await h.clock.runUntil(() => DONE.includes(rt.ctx.ops.get(op.id).state), 12 * 60_000, 100);
  // Deja terminar reconciliaciones pendientes.
  await h.clock.advance(15_000);
  const r = rt.ctx.ops.get(op.id);
  const alloc = rt.store.allocations.get(op.id);
  const claims = [...rt.store.claims.values()].filter((c) => c.operationId === op.id);
  const maxPrice = alloc?.maxUnitPrice ?? r.config.maxUnitPrice;
  let priceViolations = 0;
  for (const cart of rt.store.carts.values()) {
    if (cart.operationId !== op.id) continue;
    for (const item of cart.items) if (item.unitPrice > maxPrice) priceViolations++;
  }
  const result: SimResult = {
    operationId: op.id,
    finalState: r.state,
    requested: alloc?.requestedQty ?? r.config.requestedQty,
    carted: alloc?.cartedQty ?? 0,
    claims: claims.length,
    ambiguousLeft: claims.filter((c) => c.state === 'AMBIGUOUS').length,
    violations: [...h.violations],
    priceViolations,
    providerCalls: rt.ctx.gateway.totalCalls(),
    harness: h,
  };
  if (!opts.keepRunning) await h.stop();
  return result;
}
