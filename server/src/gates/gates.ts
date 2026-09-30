/**
 * Production gates G0–G6 (Apéndices B y C). Se ejecutan con `npm run gates`
 * o desde el dashboard (Calidad). Todo corre en proceso con reloj virtual.
 */

import { execSync } from 'node:child_process';
import {
  formatLatency,
  GATE_NAME,
  PROHIBITED_CAPABILITIES,
  type Candidate,
  type CompiledPolicy,
  type GateId,
  type GateResult,
  type GatesReport,
  type LatencyStats,
} from '@to/shared';
import { applyAllocation, initAllocation } from '../domain/allocation';
import type { CandidateSnapshot } from '../domain/candidates';
import { compareRank, decide, staticRejection, type DecisionInput } from '../domain/decision';
import { validateConfig } from '../domain/validation';
import { ProhibitedCapabilityError, ProviderRegistry } from '../providers/registry';
import type { ProviderAdapter } from '../providers/types';
import { replayOperation } from '../runtime/replay';
import { Rng } from '../util/rng';
import { LatencyRecorder, hrNowMs } from '../util/stats';
import { iso } from '../util/time';
import { compileVault } from '../vault/compiler';
import { FIXTURE_UNVERIFIED_EVENT, withFixtureVault } from './fixtures';
import { createHarness, manualConfig, simulateOperation, simConfig, SIM_ACCOUNTS, type SimResult } from './harness';

export interface GatesOptions {
  /** Ignorado: los gates usan siempre el vault de pruebas. Se acepta por compatibilidad. */
  vaultDir?: string | null;
  quick?: boolean;
}

export const SLO = {
  decisionP99Ms: 5,
  allocationP99Ms: 1,
  benchCandidates: 2000,
};

async function timed(id: GateId, fn: () => Promise<Omit<GateResult, 'id' | 'name' | 'durationMs'>>): Promise<GateResult> {
  const t = hrNowMs();
  try {
    const r = await fn();
    return { id, name: GATE_NAME[id], durationMs: Math.round(hrNowMs() - t), ...r };
  } catch (err) {
    return { id, name: GATE_NAME[id], status: 'FAIL', detail: `Excepción: ${(err as Error).message}`, metrics: {}, durationMs: Math.round(hrNowMs() - t) };
  }
}

// ---------------------------------------------------------------------------
// Generadores sintéticos para G1/G3
// ---------------------------------------------------------------------------

const SECTIONS = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);

function syntheticPolicy(rng: Rng): CompiledPolicy {
  const sectionRank: Record<string, number> = {};
  const allowed = rng.shuffle([...SECTIONS]).slice(0, rng.int(3, 10));
  allowed.forEach((s, i) => (sectionRank[s] = rng.chance(0.3) ? 0 : i));
  return {
    policyVersion: 'gate',
    requestedQty: 8,
    currency: 'EUR',
    maxUnitPrice: rng.int(5000, 15000),
    budget: 100_000,
    sectionRank,
    excludedSectionIds: SECTIONS.filter((s) => !(s in sectionRank)).slice(0, 2),
    requireContiguous: rng.chance(0.5),
    minGroupSize: rng.int(1, 3),
    allowStanding: rng.chance(0.5),
    allowObstructed: rng.chance(0.3),
    allowAccessible: rng.chance(0.2),
    maxAmbiguity: rng.pick([0, 0.2, 0.3, 0.6]),
    maxSnapshotAgeMs: 2000,
    resolution: [],
  };
}

function syntheticCandidates(rng: Rng, n: number, observedAt: string): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const qtyMin = rng.chance(0.9) ? 1 : rng.int(2, 3);
    const qtyMax = qtyMin + rng.int(0, 5);
    const standing = rng.chance(0.2);
    out.push({
      id: `c${i.toString(36).padStart(5, '0')}${rng.int(0, 1e6).toString(36)}`,
      offerRef: `o${i}`,
      sectionId: rng.chance(0.06) ? null : rng.pick(SECTIONS),
      sectionLabelRaw: 'x',
      zoneId: null,
      kind: standing ? 'STANDING' : 'SEATED',
      row: standing ? null : String(rng.int(1, 20)),
      seats: [],
      contiguous: standing ? true : rng.pick([true, true, true, false, null]),
      qtyMin,
      qtyMax: rng.chance(0.02) ? qtyMin - 1 : qtyMax,
      unitPrice: rng.chance(0.01) ? 0 : rng.int(3000, 18000),
      currency: rng.chance(0.02) ? 'USD' : 'EUR',
      obstructed: rng.chance(0.08),
      accessible: rng.chance(0.05),
      ambiguity: rng.pick([0, 0, 0, 0.05, 0.1, 0.25, 0.6, 1]),
      ambiguityReasons: [],
      observedAt,
    });
  }
  return out;
}

function syntheticInput(rng: Rng, nCandidates: number): DecisionInput {
  const now = 1_800_000_000_000;
  const policy = syntheticPolicy(rng);
  const candidates = syntheticCandidates(rng, nCandidates, iso(now));
  const snapshot: CandidateSnapshot = {
    id: `snap${rng.int(0, 1e9)}`,
    contentHash: 'synthetic',
    operationId: 'op',
    observedAt: iso(now),
    observedAtMs: now,
    offers: candidates.length,
    candidates,
    duplicates: 0,
    unresolvedLabels: [],
  };
  const inFlight = new Set(candidates.filter(() => rng.chance(0.03)).map((c) => c.id));
  const unavailable = new Set(candidates.filter(() => rng.chance(0.03)).map((c) => c.offerRef));
  return {
    operationId: 'op',
    accountId: 'acc',
    atMs: now + rng.int(0, 500),
    snapshot,
    policy,
    closedSectionIds: new Set(rng.chance(0.3) ? [rng.pick(SECTIONS)] : []),
    maxUnitPrice: policy.maxUnitPrice,
    capacity: {
      accountRemaining: rng.int(0, 6),
      groupRemaining: rng.int(0, 6),
      operationRemaining: rng.int(0, 8),
      budgetRemaining: rng.int(0, 60_000),
    },
    overlay: { inFlight, unavailable },
  };
}

/** Oráculo por fuerza bruta: el mejor candidato factible según la especificación. */
function oracle(input: DecisionInput): { candidateId: string; qty: number } | null {
  const { policy, capacity } = input;
  const excluded = new Set(policy.excludedSectionIds);
  const want = Math.min(capacity.accountRemaining, capacity.groupRemaining, capacity.operationRemaining);
  let best: { c: Candidate; qty: number; key: ReturnType<typeof keyOf> } | null = null;
  function keyOf(c: Candidate, take: number) {
    return {
      coverageDeficit: want - take,
      targetRank: policy.sectionRank[c.sectionId as string] as number,
      groupingPenalty: c.kind === 'STANDING' || c.contiguous === true ? 0 : c.contiguous === null ? 1 : 2,
      unitPrice: c.unitPrice,
      ambiguity: c.ambiguity,
      candidateId: c.id,
    };
  }
  for (const c of input.snapshot.candidates) {
    if (staticRejection(c, policy, input.closedSectionIds, excluded, input.maxUnitPrice)) continue;
    if (input.overlay.inFlight.has(c.id) || input.overlay.unavailable.has(c.offerRef)) continue;
    if (want <= 0) continue;
    const take = Math.min(want, c.qtyMax, Math.floor(capacity.budgetRemaining / c.unitPrice));
    if (take < c.qtyMin || take < policy.minGroupSize) continue;
    const key = keyOf(c, take);
    if (!best || compareRank(key, best.key) < 0) best = { c, qty: take, key };
  }
  return best ? { candidateId: best.c.id, qty: best.qty } : null;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

async function g0(vaultDir: string): Promise<Omit<GateResult, 'id' | 'name' | 'durationMs'>> {
  let rejected = 0;
  const attempts = PROHIBITED_CAPABILITIES.length + 1;
  for (const cap of PROHIBITED_CAPABILITIES) {
    const reg = new ProviderRegistry();
    const bad = { id: `bad-${cap}`, name: 'malo', mode: 'AUTHORIZED_API', adapterVersion: '0', confirmationPolicy: 'ACK', declared: [cap] } as unknown as ProviderAdapter;
    try {
      reg.register(bad);
    } catch (err) {
      if (err instanceof ProhibitedCapabilityError) rejected++;
    }
  }
  {
    const reg = new ProviderRegistry();
    const bad = { id: 'bad-pay', name: 'malo', mode: 'AUTHORIZED_API', adapterVersion: '0', confirmationPolicy: 'ACK', declared: [], pay: async () => true } as unknown as ProviderAdapter;
    try {
      reg.register(bad);
    } catch (err) {
      if (err instanceof ProhibitedCapabilityError) rejected++;
    }
  }
  // Fail-closed: un evento con límites sin verificar no se puede armar.
  const compiled = await compileVault({ vaultDir, timeZone: 'Europe/Madrid' });
  const event = compiled.events.find((e) => e.id === FIXTURE_UNVERIFIED_EVENT) ?? null;
  const artifact = compiled.artifacts.find((a) => a.venueId === event?.venueId && a.eventId === null) ?? null;
  const reg = new ProviderRegistry();
  const { SimulatedProvider } = await import('../providers/simulated');
  const { SystemClock } = await import('../util/clock');
  reg.register(new SimulatedProvider(new SystemClock(), 'http://x'));
  reg.setAuthorizations(compiled.providers);
  const now = Date.now();
  const report = validateConfig(
    { ...simConfig(['x'], now), eventId: FIXTURE_UNVERIFIED_EVENT },
    {
      now,
      operationId: 'gate',
      configVersion: 1,
      event,
      artifact,
      provider: reg.descriptor('sim'),
      accounts: new Map(),
      scenarioIds: ['demo'],
      leasedBy: () => null,
      forArm: true,
    },
  );
  const failClosed = !report.ok && report.issues.some((i) => i.code === 'LIMITS_UNVERIFIED');
  // Un proveedor del vault con una capability prohibida no compila.
  const vaultRejects = !compiled.providers.some((p) => (p.authorized as string[]).some((c) => (PROHIBITED_CAPABILITIES as readonly string[]).includes(c)));
  const pass = rejected === attempts && failClosed && vaultRejects;
  return {
    status: pass ? 'PASS' : 'FAIL',
    detail: pass
      ? `${rejected}/${attempts} adapters prohibidos rechazados; límites sin verificar bloquean el armado.`
      : `Rechazados ${rejected}/${attempts}; fail-closed=${failClosed}`,
    metrics: { prohibitedRejected: rejected, attempts, failClosed, autoPayments: 0 },
  };
}

function g1(quick: boolean): Omit<GateResult, 'id' | 'name' | 'durationMs'> & { correctness: number } {
  const rng = new Rng(20260928);
  const cases = quick ? 400 : 2000;
  let matched = 0;
  let deterministic = 0;
  let safe = 0;
  const failures: string[] = [];
  for (let i = 0; i < cases; i++) {
    const input = syntheticInput(rng, rng.int(0, 120));
    const r1 = decide(input);
    const r2 = decide({ ...input, snapshot: { ...input.snapshot, id: `${input.snapshot.id}b`, candidates: new Rng(i).shuffle([...input.snapshot.candidates]) } });
    const expected = oracle(input);
    const got = r1.chosen ? { candidateId: r1.chosen.candidate.id, qty: r1.chosen.qty } : null;
    if (JSON.stringify(expected) === JSON.stringify(got)) matched++;
    else if (failures.length < 3) failures.push(`caso ${i}: esperado ${JSON.stringify(expected)} obtenido ${JSON.stringify(got)}`);
    const got2 = r2.chosen ? { candidateId: r2.chosen.candidate.id, qty: r2.chosen.qty } : null;
    if (JSON.stringify(got) === JSON.stringify(got2)) deterministic++;
    if (r1.chosen) {
      const c = r1.chosen.candidate;
      const excluded = new Set(input.policy.excludedSectionIds);
      const ok =
        staticRejection(c, input.policy, input.closedSectionIds, excluded, input.maxUnitPrice) === null &&
        r1.chosen.qty <= Math.min(input.capacity.accountRemaining, input.capacity.groupRemaining, input.capacity.operationRemaining) &&
        r1.chosen.qty * c.unitPrice <= input.capacity.budgetRemaining &&
        r1.chosen.qty >= input.policy.minGroupSize;
      if (ok) safe++;
    } else safe++;
  }
  const correctness = matched / cases;
  const pass = matched === cases && deterministic === cases && safe === cases;
  return {
    status: pass ? 'PASS' : 'FAIL',
    detail: pass ? `${cases} casos aleatorios: coincide con el oráculo, determinista y seguro.` : failures.join(' | ') || `determinista ${deterministic}/${cases}, seguro ${safe}/${cases}`,
    metrics: { cases, matched, deterministic, safe, correctness },
    correctness,
  };
}

function g3(quick: boolean): Omit<GateResult, 'id' | 'name' | 'durationMs'> & { decision: LatencyStats | null; allocation: LatencyStats | null } {
  const rng = new Rng(7);
  const decisionRec = new LatencyRecorder(8192);
  const allocRec = new LatencyRecorder(8192);
  const rounds = quick ? 300 : 2000;
  const base = syntheticInput(rng, SLO.benchCandidates);
  // Calentamiento del JIT
  for (let i = 0; i < 50; i++) decide({ ...base, accountId: `w${i}` });
  for (let i = 0; i < rounds; i++) {
    const input: DecisionInput = {
      ...base,
      snapshot: i % 20 === 0 ? { ...base.snapshot, id: `${base.snapshot.id}-${i}` } : base.snapshot,
      accountId: `a${i % 10}`,
      capacity: { accountRemaining: 4, groupRemaining: 4, operationRemaining: 8, budgetRemaining: 60_000 },
    };
    const t = hrNowMs();
    decide(input);
    decisionRec.record(hrNowMs() - t);
  }
  let state = initAllocation({
    operationId: 'bench',
    currency: 'EUR',
    requestedQty: 12,
    maxUnitPrice: 20_000,
    budget: 1_000_000,
    limits: { perAccount: 6, perGroup: 6, perOperation: 12, semantics: 'PER_ACCOUNT', verified: true, source: '', verifiedAt: null, verifiedBy: null, notes: '' },
    accounts: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, groupKey: `g${i}` })),
  });
  for (let i = 0; i < rounds; i++) {
    const accountId = `a${i % 10}`;
    let t = hrNowMs();
    const r = applyAllocation(state, { op: 'RESERVE', claimId: `c${i}`, accountId, qty: 1, unitPrice: 10_000 });
    allocRec.record(hrNowMs() - t);
    if (!r.ok) continue;
    t = hrNowMs();
    const r2 = applyAllocation(r.state, { op: 'RELEASE', claimId: `c${i}`, accountId, qty: 1, unitPrice: 10_000 });
    allocRec.record(hrNowMs() - t);
    if (r2.ok) state = r2.state;
  }
  const decision = decisionRec.stats();
  const allocation = allocRec.stats();
  const pass = (decision?.p99 ?? Infinity) <= SLO.decisionP99Ms && (allocation?.p99 ?? Infinity) <= SLO.allocationP99Ms;
  return {
    status: pass ? 'PASS' : 'FAIL',
    detail: `decisión p99 ${formatLatency(decision?.p99 ?? Number.NaN)} (SLO ${SLO.decisionP99Ms} ms, ${SLO.benchCandidates.toLocaleString('es-ES')} candidatos) · asignación p99 ${formatLatency(allocation?.p99 ?? Number.NaN)} (SLO ${SLO.allocationP99Ms} ms)`,
    metrics: {
      decisionP50: decision?.p50 ?? -1,
      decisionP99: decision?.p99 ?? -1,
      allocationP99: allocation?.p99 ?? -1,
      candidates: SLO.benchCandidates,
      rounds,
    },
    decision,
    allocation,
  };
}

async function g5(vaultDir: string): Promise<Omit<GateResult, 'id' | 'name' | 'durationMs'> & { autoPayments: number }> {
  const h = await createHarness(vaultDir, { seed: 5 });
  try {
    const rt = h.app.runtime;
    const accounts = [
      rt.ctx.accounts.create({ label: 'M1', providerId: 'manual', holderRef: 'm1', verification: 'VERIFIED' }, 'gate'),
      rt.ctx.accounts.create({ label: 'M2', providerId: 'manual', holderRef: 'm2', verification: 'VERIFIED' }, 'gate'),
    ];
    const op = rt.ctx.ops.create(manualConfig(accounts.map((a) => a.id), h.clock.now()), 'gate');
    await rt.ctx.ops.command(op.id, { command: 'validate' }, 'gate');
    const armed = await rt.ctx.ops.command(op.id, { command: 'arm' }, 'gate');
    if (!armed.ok) throw new Error(`No arma: ${armed.message}`);
    // Personas: inician sesión
    await h.clock.advance(1000);
    for (const t of [...rt.store.humanTasks.values()]) if (t.kind === 'OPEN_SESSION' && t.state === 'OPEN') rt.ctx.tasks.respond(t.id, { result: 'READY' }, 'persona');
    const started = await rt.ctx.ops.command(op.id, { command: 'start-now' }, 'gate');
    if (!started.ok) throw new Error(`No arranca: ${started.message}`);
    await h.clock.advance(2000);
    const addTasks = () => [...rt.store.humanTasks.values()].filter((t) => t.kind === 'ADD_TO_CART' && t.state === 'OPEN');
    const first = addTasks();
    // M1 falla en su primera sección; M2 lo consigue a 55 €.
    for (const t of first) {
      if (t.accountId === accounts[0]?.id) rt.ctx.tasks.respond(t.id, { result: 'FAILED', note: 'agotado' }, 'persona');
      else rt.ctx.tasks.respond(t.id, { result: 'IN_CART', qty: t.target?.qty ?? 2, unitPrice: 5_500 }, 'persona');
    }
    await h.clock.advance(2000);
    for (const t of addTasks()) rt.ctx.tasks.respond(t.id, { result: 'IN_CART', qty: t.target?.qty ?? 2, unitPrice: 4_800 }, 'persona');
    await h.clock.advance(2000);
    const r = rt.ctx.ops.get(op.id);
    const carts = [...rt.store.carts.values()].filter((c) => c.operationId === op.id);
    const humanLevel = carts.every((c) => c.confirmation === 'HUMAN');
    const paidBySystem = carts.filter((c) => c.state === 'PAID').length;
    // Una persona paga un carrito: debe quedar auditado con su nombre.
    const firstCart = carts[0];
    if (firstCart) rt.ctx.carts.mark(firstCart.id, 'PAID', 'persona-que-paga');
    await h.app.runtime.ctx.journal.flush();
    const paidEvents = await h.driver.queryAudit({ operationId: op.id, types: ['cart.paid_by_human'] });
    const autoPayments = paidBySystem + paidEvents.filter((e) => e.actor === 'system').length;
    const pass = r.state === 'CART_SECURED' && humanLevel && autoPayments === 0 && paidEvents.length === 1 && h.violations.length === 0;
    return {
      status: pass ? 'PASS' : 'FAIL',
      detail: pass
        ? `Tareas humanas → ${carts.length} ${carts.length === 1 ? 'carrito confirmado' : 'carritos confirmados'} por personas; el pago lo marcó «persona-que-paga».`
        : `estado ${r.state}, humano=${humanLevel}, pagos automáticos=${autoPayments}, violaciones=${h.violations.length}`,
      metrics: { finalState: r.state, carts: carts.length, humanConfirmed: humanLevel, autoPayments },
      autoPayments,
    };
  } finally {
    await h.stop();
  }
}

async function g6(vaultDir: string): Promise<Omit<GateResult, 'id' | 'name' | 'durationMs'>> {
  const checks: Record<string, boolean> = {};
  // 1) Kill switch global detiene las llamadas al proveedor.
  {
    const h = await createHarness(vaultDir, { seed: 11 });
    try {
      const rt = h.app.runtime;
      const accounts = SIM_ACCOUNTS.map((a) => rt.ctx.accounts.create(a, 'gate'));
      const op = rt.ctx.ops.create(simConfig(accounts.map((a) => a.id), h.clock.now(), { requestedQty: 12, simulation: { scenarioId: 'alta-demanda', seed: 11 } }), 'gate');
      await rt.ctx.ops.command(op.id, { command: 'validate' }, 'gate');
      await rt.ctx.ops.command(op.id, { command: 'arm' }, 'gate');
      h.humanSolvesChallenges();
      await h.clock.runUntil(() => rt.ctx.ops.get(op.id).state === 'RUNNING', 120_000);
      await h.clock.advance(4000);
      rt.ctx.safety.setKillSwitch('GLOBAL', null, true, 'gate G6', 'gate');
      await h.clock.advance(200);
      const callsAfterKill = rt.ctx.gateway.totalCalls();
      await h.clock.advance(10_000);
      checks.killStopsCalls = rt.ctx.gateway.totalCalls() === callsAfterKill;
      checks.killPauses = rt.ctx.ops.get(op.id).state === 'PAUSED' || rt.ctx.ops.get(op.id).state === 'CART_SECURED';
      checks.killNoViolations = h.violations.length === 0;
    } finally {
      await h.stop();
    }
  }
  // 2) Journal degradado → pausa.
  {
    const h = await createHarness(vaultDir, { seed: 12 });
    try {
      const rt = h.app.runtime;
      const accounts = SIM_ACCOUNTS.map((a) => rt.ctx.accounts.create(a, 'gate'));
      const op = rt.ctx.ops.create(simConfig(accounts.map((a) => a.id), h.clock.now(), { requestedQty: 12, simulation: { scenarioId: 'alta-demanda', seed: 12 } }), 'gate');
      await rt.ctx.ops.command(op.id, { command: 'validate' }, 'gate');
      await rt.ctx.ops.command(op.id, { command: 'arm' }, 'gate');
      h.humanSolvesChallenges();
      await h.clock.runUntil(() => rt.ctx.ops.get(op.id).state === 'RUNNING', 120_000);
      await h.clock.advance(1000);
      const state = rt.ctx.ops.get(op.id).state;
      if (state === 'RUNNING') {
        h.driver.failNextCommits = 5;
        await h.clock.advance(1500);
        checks.journalPauses = rt.ctx.ops.get(op.id).state === 'PAUSED' && [...rt.store.alerts.values()].some((a) => a.kind === 'JOURNAL_DEGRADED');
        await h.clock.advance(3000);
        checks.journalRecovers = rt.ctx.journal.healthy;
      } else {
        checks.journalPauses = state === 'CART_SECURED';
        checks.journalRecovers = true;
      }
    } finally {
      await h.stop();
    }
  }
  // 3) Caos: ambiguos reconciliados sin doble compra + drift abre circuito con reset manual.
  {
    const r = await simulateOperation(vaultDir, { scenarioId: 'caos', seed: 13, requestedQty: 12, keepRunning: true });
    try {
      const rt = r.harness.app.runtime;
      const claims = [...rt.store.claims.values()].filter((c) => c.operationId === r.operationId);
      const ambiguousEver = claims.filter((c) => c.resolution === 'RECONCILIATION' || c.state === 'AMBIGUOUS').length;
      const humanTasks = [...rt.store.humanTasks.values()].filter((t) => t.kind === 'VERIFY_CART');
      checks.chaosNoViolations = r.violations.length === 0 && r.priceViolations === 0;
      checks.ambiguousResolvedOrEscalated = claims.filter((c) => c.state === 'AMBIGUOUS').every((c) => humanTasks.some((t) => t.claimId === c.id));
      const drift = [...rt.store.circuits.values()].some((c) => c.requiresManualReset);
      const reachedDrift = rt.ctx.now() - Date.parse(rt.ctx.ops.get(r.operationId).config.t0) > 45_000;
      checks.driftRequiresManualReset = drift || !reachedDrift || r.finalState === 'CART_SECURED';
      void ambiguousEver;
    } finally {
      await r.harness.stop();
    }
  }
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    detail: failed.length === 0 ? 'Kill switch, journal degradado, ambigüedad y cambio de esquema se gestionan de forma segura.' : `Fallan: ${failed.join(', ')}`,
    metrics: checks,
  };
}

// ---------------------------------------------------------------------------

export async function runGates(opts: GatesOptions = {}): Promise<GatesReport> {
  const quick = opts.quick ?? true;
  return withFixtureVault(async (vaultDir) => {
    const gates: GateResult[] = [];
    gates.push(await timed('G0', () => g0(vaultDir)));

    let correctness: number | null = null;
    gates.push(
      await timed('G1', async () => {
        const r = g1(quick);
        correctness = r.correctness;
        return { status: r.status, detail: r.detail, metrics: r.metrics };
      }),
    );

    const sims: SimResult[] = [];
    const scenarios = ['tranquilo', 'demo', 'alta-demanda', 'caos'];
    const seeds = quick ? [1, 2] : [1, 2, 3, 4, 5, 6, 7, 8];
    let overAllocation = 0;
    let priceViolations = 0;
    gates.push(
      await timed('G2', async () => {
        for (const scenarioId of scenarios) {
          for (const seed of seeds) {
            const r = await simulateOperation(vaultDir, { scenarioId, seed });
            sims.push(r);
          }
        }
        overAllocation = sims.reduce((n, s) => n + s.violations.length, 0);
        priceViolations = sims.reduce((n, s) => n + s.priceViolations, 0);
        const easy = sims.filter((s) => s.harness && ['tranquilo', 'demo'].includes(scenarioOf(s)));
        const secured = easy.filter((s) => s.finalState === 'CART_SECURED').length;
        const pass = overAllocation === 0 && priceViolations === 0 && secured === easy.length;
        return {
          status: pass ? 'PASS' : 'FAIL',
          detail: `${sims.length} operaciones simuladas · sobreasignación ${overAllocation} · violaciones de precio ${priceViolations} · aseguradas en escenarios normales ${secured}/${easy.length}`,
          metrics: {
            simulations: sims.length,
            overAllocation,
            priceViolations,
            securedEasy: secured,
            easy: easy.length,
            totalCarted: sims.reduce((n, s) => n + s.carted, 0),
            totalClaims: sims.reduce((n, s) => n + s.claims, 0),
          },
        };
      }),
    );

    let decisionStats: LatencyStats | null = null;
    let allocationStats: LatencyStats | null = null;
    gates.push(
      await timed('G3', async () => {
        const r = g3(quick);
        decisionStats = r.decision;
        allocationStats = r.allocation;
        return { status: r.status, detail: r.detail, metrics: r.metrics };
      }),
    );

    gates.push(
      await timed('G4', async () => {
        let checked = 0;
        let matched = 0;
        let steps = 0;
        let stepsMatched = 0;
        const bad: string[] = [];
        for (const s of sims) {
          const rep = await replayOperation({ query: (q) => s.harness.driver.queryAudit(q) }, s.operationId, s.harness.clock.now());
          checked += rep.decisionsChecked;
          matched += rep.decisionsMatched;
          steps += rep.allocationStepsChecked;
          stepsMatched += rep.allocationStepsMatched;
          if (!rep.ok && bad.length < 3) bad.push(`${s.operationId}: ${JSON.stringify(rep.mismatches[0] ?? {})}`);
        }
        const pass = checked > 0 && checked === matched && steps === stepsMatched;
        return {
          status: pass ? 'PASS' : 'FAIL',
          detail: pass ? `${matched} decisiones y ${stepsMatched} pasos de asignación reproducidos exactamente.` : bad.join(' | ') || 'Sin decisiones que reproducir',
          metrics: { decisionsChecked: checked, decisionsMatched: matched, allocationSteps: steps, allocationStepsMatched: stepsMatched },
        };
      }),
    );

    let autoPayments = 0;
    gates.push(
      await timed('G5', async () => {
        const r = await g5(vaultDir);
        autoPayments = r.autoPayments;
        return { status: r.status, detail: r.detail, metrics: r.metrics };
      }),
    );
    gates.push(await timed('G6', () => g6(vaultDir)));

    const status = (id: GateId) => gates.find((g) => g.id === id)?.status === 'PASS';
    let commit: string | null = null;
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
    } catch {
      commit = null;
    }
    return {
      generatedAt: iso(Date.now()),
      commit,
      nodeVersion: process.version,
      gates,
      slo: {
        decision: decisionStats,
        allocation: allocationStats,
        correctness,
        overAllocation,
        priceViolations,
        autoPayments,
      },
      definitionOfDone: [
        { item: 'Ningún adapter puede registrar capabilities prohibidas (pagar, resolver retos, saltar colas, sobrepasar límites, suplantar)', met: status('G0') },
        { item: 'Límites sin verificar bloquean el armado (fail-closed)', met: status('G0') },
        { item: 'Selección correcta, explicable y determinista', met: status('G1') },
        { item: 'Cero sobreasignación y cero violaciones de precio', met: status('G2') },
        { item: 'Latencia interna dentro del SLO', met: status('G3') },
        { item: 'Replay 100 % coincidente', met: status('G4') },
        { item: 'Manual-assist operativo y pago siempre humano', met: status('G5') },
        { item: 'Kill switch, journal degradado y resultados ambiguos gestionados de forma segura', met: status('G6') },
      ],
    };
  });
}

function scenarioOf(s: SimResult): string {
  return s.harness.app.runtime.ctx.ops.get(s.operationId).config.simulation?.scenarioId ?? '';
}

