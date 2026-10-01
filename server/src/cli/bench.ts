/**
 * npm run bench — mide la latencia interna del motor (normalización, decisión
 * y asignación) con inventarios sintéticos de distintos tamaños, y el
 * throughput de operaciones completas simuladas con reloj virtual.
 */

import { formatLatency, type Candidate } from '@to/shared';
import { applyAllocation, initAllocation } from '../domain/allocation';
import { decide, type DecisionInput } from '../domain/decision';
import { withFixtureVault } from '../gates/fixtures';
import { simulateOperation } from '../gates/harness';
import { Rng } from '../util/rng';
import { LatencyRecorder, hrNowMs } from '../util/stats';
import { iso } from '../util/time';

function input(rng: Rng, n: number): DecisionInput {
  const now = 1_800_000_000_000;
  const sections = Array.from({ length: 20 }, (_, i) => `s${i}`);
  const sectionRank: Record<string, number> = {};
  sections.slice(0, 12).forEach((s, i) => (sectionRank[s] = i));
  const candidates: Candidate[] = Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    offerRef: `o${i}`,
    sectionId: rng.pick(sections),
    sectionLabelRaw: 'x',
    zoneId: null,
    kind: 'SEATED',
    row: '1',
    seats: [],
    contiguous: rng.chance(0.85),
    qtyMin: 1,
    qtyMax: rng.int(1, 6),
    unitPrice: rng.int(4000, 16000),
    currency: 'EUR',
    obstructed: rng.chance(0.05),
    accessible: rng.chance(0.03),
    ambiguity: rng.pick([0, 0, 0.1, 0.25]),
    ambiguityReasons: [],
    observedAt: iso(now),
  }));
  return {
    operationId: 'bench',
    accountId: 'a',
    atMs: now,
    snapshot: { id: 'snap', contentHash: 'bench', operationId: 'bench', observedAt: iso(now), observedAtMs: now, offers: n, candidates, duplicates: 0, unresolvedLabels: [] },
    policy: {
      policyVersion: 'bench', requestedQty: 12, currency: 'EUR', maxUnitPrice: 13000, budget: 200000, sectionRank,
      excludedSectionIds: [], requireContiguous: true, minGroupSize: 2, allowStanding: true, allowObstructed: false,
      allowAccessible: false, maxAmbiguity: 0.3, maxSnapshotAgeMs: 2000, resolution: [],
    },
    closedSectionIds: new Set(),
    maxUnitPrice: 13000,
    capacity: { accountRemaining: 4, groupRemaining: 4, operationRemaining: 12, budgetRemaining: 100000 },
    overlay: { inFlight: new Set(), unavailable: new Set() },
  };
}

async function main(): Promise<void> {
  const rng = new Rng(42);
  console.log('\nLatencia interna (ms)\n');
  console.log('  candidatos   p50        p95        p99        máx');
  for (const n of [100, 500, 2000, 10000]) {
    const base = input(rng, n);
    const rec = new LatencyRecorder(4096);
    for (let i = 0; i < 30; i++) decide({ ...base, accountId: `w${i}` });
    for (let i = 0; i < 1000; i++) {
      const snap = i % 10 === 0 ? { ...base.snapshot, id: `snap${i}` } : base.snapshot;
      const t = hrNowMs();
      decide({ ...base, snapshot: snap, accountId: `a${i % 10}` });
      rec.record(hrNowMs() - t);
    }
    const s = rec.stats();
    if (s) console.log(`  ${String(n).padStart(10)}   ${formatLatency(s.p50).padEnd(10)} ${formatLatency(s.p95).padEnd(10)} ${formatLatency(s.p99).padEnd(10)} ${formatLatency(s.max)}`);
  }
  let state = initAllocation({
    operationId: 'b', currency: 'EUR', requestedQty: 12, maxUnitPrice: 20000, budget: 1e7,
    limits: { perAccount: 6, perGroup: 6, perOperation: 12, semantics: 'PER_ACCOUNT', verified: true, source: '', verifiedAt: null, verifiedBy: null, notes: '' },
    accounts: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, groupKey: `g${i}` })),
  });
  const alloc = new LatencyRecorder(8192);
  for (let i = 0; i < 5000; i++) {
    const t = hrNowMs();
    const r = applyAllocation(state, { op: 'RESERVE', claimId: `c${i}`, accountId: `a${i % 10}`, qty: 1, unitPrice: 1000 });
    alloc.record(hrNowMs() - t);
    if (r.ok) {
      const r2 = applyAllocation(r.state, { op: 'RELEASE', claimId: `c${i}`, accountId: `a${i % 10}`, qty: 1, unitPrice: 1000 });
      if (r2.ok) state = r2.state;
    }
  }
  const a = alloc.stats();
  if (a) console.log(`\n  asignación   p50 ${formatLatency(a.p50)} · p99 ${formatLatency(a.p99)} · máx ${formatLatency(a.max)}`);

  console.log('\nOperaciones completas simuladas (reloj virtual)\n');
  await withFixtureVault(async (dir) => {
    for (const scenarioId of ['tranquilo', 'demo', 'alta-demanda', 'caos']) {
      const t = hrNowMs();
      const r = await simulateOperation(dir, { scenarioId, seed: 3 });
      const m = r.harness.app.runtime.ctx.metrics.snapshot(r.operationId);
      console.log(
        `  ${scenarioId.padEnd(13)} ${r.finalState.padEnd(13)} ${r.carted}/${r.requested} entradas · ${r.claims} claim${r.claims === 1 ? "" : "s"} · decisión p99 ${formatLatency(m.stages.decision?.p99 ?? NaN)} · cart.add p50 ${formatLatency(m.stages['provider.add_to_cart']?.p50 ?? NaN)} (virtual) · ${Math.round(hrNowMs() - t)} ms reales`,
      );
    }
  });
  console.log('');
}

void main();
