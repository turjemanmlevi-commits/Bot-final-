/**
 * Métricas por operación (§8, §24, Apéndice A): latencia por etapa (interna o
 * externa), contadores, motivos de rechazo y throughput.
 */

import { STAGES, type Id, type OperationMetrics, type RejectionReason, type StageName } from '@to/shared';
import { LatencyRecorder } from '../util/stats';
import { iso } from '../util/time';
import type { Ctx } from './context';

type Counter = keyof OperationMetrics['counters'];

class OpMetrics {
  readonly stages = new Map<StageName, LatencyRecorder>();
  readonly counters: OperationMetrics['counters'] = {
    decisions: 0,
    claims: 0,
    confirmed: 0,
    rejected: 0,
    ambiguous: 0,
    reconciled: 0,
    inventoryPolls: 0,
    candidatesSeen: 0,
    duplicateResponses: 0,
  };
  readonly rejectionReasons: Partial<Record<RejectionReason, number>> = {};
  readonly providerErrors: Record<string, number> = {};
  startedAtMs: number | null = null;
  endedAtMs: number | null = null;
}

export class MetricsService {
  private readonly ops = new Map<Id, OpMetrics>();

  constructor(private readonly ctx: Ctx) {}

  private get(opId: Id): OpMetrics {
    let m = this.ops.get(opId);
    if (!m) {
      m = new OpMetrics();
      this.ops.set(opId, m);
    }
    return m;
  }

  start(opId: Id): void {
    const m = this.get(opId);
    m.startedAtMs ??= this.ctx.now();
    m.endedAtMs = null;
  }

  stop(opId: Id): void {
    const m = this.get(opId);
    m.endedAtMs ??= this.ctx.now();
    this.publish(opId);
  }

  record(opId: Id, stage: StageName, ms: number): void {
    const m = this.get(opId);
    let r = m.stages.get(stage);
    if (!r) {
      r = new LatencyRecorder();
      m.stages.set(stage, r);
    }
    r.record(ms);
  }

  count(opId: Id, counter: Counter, n = 1): void {
    this.get(opId).counters[counter] += n;
  }

  rejections(opId: Id, reasons: Partial<Record<RejectionReason, number>>): void {
    const m = this.get(opId);
    for (const [k, v] of Object.entries(reasons) as Array<[RejectionReason, number]>) m.rejectionReasons[k] = (m.rejectionReasons[k] ?? 0) + v;
  }

  providerError(opId: Id, code: string): void {
    const m = this.get(opId);
    m.providerErrors[code] = (m.providerErrors[code] ?? 0) + 1;
  }

  snapshot(opId: Id): OperationMetrics {
    const m = this.get(opId);
    const stages: OperationMetrics['stages'] = {};
    for (const [name, rec] of m.stages) {
      const s = rec.stats();
      if (s) stages[name] = { ...s, kind: STAGES[name] };
    }
    const end = m.endedAtMs ?? this.ctx.now();
    const elapsedSec = m.startedAtMs === null ? 0 : Math.max(0.001, (end - m.startedAtMs) / 1000);
    return {
      operationId: opId,
      stages,
      counters: { ...m.counters },
      rejectionReasons: { ...m.rejectionReasons },
      providerErrors: { ...m.providerErrors },
      throughput: {
        claimsPerSecond: elapsedSec === 0 ? 0 : m.counters.claims / elapsedSec,
        decisionsPerSecond: elapsedSec === 0 ? 0 : m.counters.decisions / elapsedSec,
      },
      updatedAt: iso(this.ctx.now()),
    };
  }

  has(opId: Id): boolean {
    return this.ops.has(opId);
  }

  publish(opId: Id): void {
    this.ctx.hub.upsertThrottled('metrics', opId, this.snapshot(opId));
  }
}
