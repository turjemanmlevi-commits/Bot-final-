/**
 * Replay determinista (§25). Reproduce, a partir del journal, cada decisión
 * (snapshot de inventario + política congelada + capacidad + overlay) y cada
 * paso de asignación, y comprueba que el resultado es idéntico.
 */

import type { AllocationState, ArmSnapshot, CompiledPolicy, DecisionRecord, Id, ReplayReport } from '@to/shared';
import { applyAllocation, type AllocationOp } from '../domain/allocation';
import type { CandidateSnapshot } from '../domain/candidates';
import { decide, type AccountCapacity } from '../domain/decision';
import type { AuditQuery } from '../store/drivers';
import { canonicalJson, hashOf } from '../util/hash';
import { iso } from '../util/time';
import type { AuditEvent } from '@to/shared';

interface ReplayInput {
  snapshotId: string;
  policyHash: string | null;
  atMs: number;
  maxUnitPrice: number;
  capacity: AccountCapacity;
  overlay: { inFlight: string[]; unavailable: string[] };
  closed: Id[];
}

export interface ReplaySource {
  query(q: AuditQuery): Promise<AuditEvent[]>;
}

export const REPLAY_TYPES = ['operation.armed', 'inventory.snapshot', 'decision.recorded', 'allocation.init', 'allocation.step'];

function comparable(d: Pick<DecisionRecord, 'outcome' | 'chosen' | 'alternatives' | 'rejectedByReason'>): unknown {
  return {
    outcome: d.outcome,
    chosen: d.chosen ? { candidateId: d.chosen.candidateId, qty: d.chosen.qty, rank: d.chosen.rank } : null,
    alternatives: d.alternatives.map((a) => ({ candidateId: a.candidateId, qty: a.qty, rank: a.rank })),
    rejectedByReason: d.rejectedByReason,
  };
}

export async function replayOperation(source: ReplaySource, operationId: Id, now: number): Promise<ReplayReport> {
  const events = await source.query({ operationId, types: REPLAY_TYPES, limit: 1_000_000, order: 'asc' });
  const policies = new Map<string, CompiledPolicy>();
  const snapshots = new Map<string, CandidateSnapshot>();
  let armedSnapshotHash: string | null = null;
  const mismatches: ReplayReport['mismatches'] = [];
  let decisionsChecked = 0;
  let decisionsMatched = 0;
  let allocationStepsChecked = 0;
  let allocationStepsMatched = 0;
  let missingSnapshots = 0;
  let alloc: AllocationState | null = null;

  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case 'operation.armed': {
        const snap = p.snapshot as ArmSnapshot | undefined;
        if (snap) {
          policies.set(hashOf(snap.compiledPolicy), snap.compiledPolicy);
          armedSnapshotHash = snap.hash;
        }
        break;
      }
      case 'inventory.snapshot': {
        const s = p.snapshot as CandidateSnapshot;
        snapshots.set(s.id, s);
        break;
      }
      case 'decision.recorded': {
        decisionsChecked++;
        const d = p.decision as DecisionRecord;
        const input = p.input as ReplayInput;
        const snapshot = snapshots.get(input.snapshotId);
        const policy = input.policyHash ? policies.get(input.policyHash) : undefined;
        if (!snapshot || !policy) {
          missingSnapshots++;
          mismatches.push({ kind: 'DECISION', ref: d.id, expected: 'snapshot+política', actual: !snapshot ? 'falta el snapshot' : 'falta la política' });
          break;
        }
        const result = decide({
          operationId,
          accountId: d.accountId,
          atMs: input.atMs,
          snapshot,
          policy,
          closedSectionIds: new Set(input.closed),
          maxUnitPrice: input.maxUnitPrice,
          capacity: input.capacity,
          overlay: { inFlight: new Set(input.overlay.inFlight), unavailable: new Set(input.overlay.unavailable) },
        });
        const actual = comparable({
          outcome: result.outcome,
          chosen: result.chosen
            ? { candidateId: result.chosen.candidate.id, qty: result.chosen.qty, rank: result.chosen.rank, sectionId: result.chosen.candidate.sectionId, unitPrice: result.chosen.candidate.unitPrice }
            : null,
          alternatives: result.alternatives.map((a) => ({ candidateId: a.candidate.id, qty: a.qty, rank: a.rank })),
          rejectedByReason: result.rejectedByReason,
        });
        const expected = comparable(d);
        const hashOk = hashOf(input) === d.inputHash;
        if (hashOk && canonicalJson(actual) === canonicalJson(expected)) decisionsMatched++;
        else mismatches.push({ kind: 'DECISION', ref: d.id, expected, actual: hashOk ? actual : { inputHash: 'no coincide' } });
        break;
      }
      case 'allocation.init': {
        alloc = p.state as AllocationState;
        allocationStepsChecked++;
        if (hashOf(alloc) === p.hash) allocationStepsMatched++;
        else mismatches.push({ kind: 'ALLOCATION', ref: `init@${e.seq}`, expected: p.hash, actual: hashOf(alloc) });
        break;
      }
      case 'allocation.step': {
        allocationStepsChecked++;
        if (!alloc) {
          mismatches.push({ kind: 'ALLOCATION', ref: `step@${e.seq}`, expected: 'estado inicial', actual: 'sin allocation.init' });
          break;
        }
        const res = applyAllocation(alloc, p.op as AllocationOp);
        if (!res.ok) {
          mismatches.push({ kind: 'ALLOCATION', ref: `step@${e.seq}`, expected: p.hash, actual: res.error });
          break;
        }
        alloc = res.state;
        const h = hashOf(alloc);
        if (h === p.hash && alloc.version === p.version) allocationStepsMatched++;
        else mismatches.push({ kind: 'ALLOCATION', ref: `step@${e.seq}`, expected: { hash: p.hash, version: p.version }, actual: { hash: h, version: alloc.version } });
        break;
      }
      default:
        break;
    }
  }

  return {
    operationId,
    at: iso(now),
    armedSnapshotHash,
    decisionsChecked,
    decisionsMatched,
    allocationStepsChecked,
    allocationStepsMatched,
    missingSnapshots,
    ok: mismatches.length === 0,
    mismatches: mismatches.slice(0, 50),
  };
}
