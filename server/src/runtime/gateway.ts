/**
 * Puerta única hacia los adapters. Antes de CADA llamada comprueba:
 *   1. kill switches (global, proveedor, operación, cuenta),
 *   2. que la capability esté autorizada para ejecución AUTOMÁTICA,
 *   3. el circuit breaker.
 * Mide la latencia externa y cuenta las llamadas (lo usa el gate G6).
 */

import type { CapabilityName, Id, StageName } from '@to/shared';
import type { ProviderAdapter } from '../providers/types';
import type { Ctx } from './context';

export type GatewayBlock = 'KILL_SWITCH' | 'NOT_AUTOMATED' | 'CIRCUIT_OPEN' | 'NO_ADAPTER';

export type GatewayResult<T> =
  | { ok: true; value: T; ms: number }
  | { ok: false; blocked: GatewayBlock; detail: string }
  | { ok: false; blocked: null; error: Error; ms: number };

export interface CallSpec {
  providerId: string;
  capability: CapabilityName;
  stage: StageName;
  operationId?: Id | null;
  accountId?: Id | null;
  /** Por defecto un error lanzado cuenta como fallo del circuito. */
  countErrorAsFailure?: boolean;
}

export class ProviderGateway {
  /** Llamadas realmente enviadas a un adapter, por proveedor. */
  readonly callsSent = new Map<string, number>();

  constructor(private readonly ctx: Ctx) {}

  totalCalls(): number {
    let n = 0;
    for (const v of this.callsSent.values()) n += v;
    return n;
  }

  async call<T>(spec: CallSpec, fn: (adapter: ProviderAdapter) => Promise<T> | undefined): Promise<GatewayResult<T>> {
    const { ctx } = this;
    const adapter = ctx.registry.get(spec.providerId);
    if (!adapter) return { ok: false, blocked: 'NO_ADAPTER', detail: `Sin adapter para ${spec.providerId}` };
    const ks = ctx.safety.engagedFor({ providerId: spec.providerId, operationId: spec.operationId, accountId: spec.accountId });
    if (ks) return { ok: false, blocked: 'KILL_SWITCH', detail: `Kill switch ${ks.key}` };
    if (!ctx.registry.automated(spec.providerId, spec.capability)) {
      return { ok: false, blocked: 'NOT_AUTOMATED', detail: `${spec.capability} no está autorizada para automatización` };
    }
    if (!ctx.safety.allow(spec.providerId, spec.capability)) {
      return { ok: false, blocked: 'CIRCUIT_OPEN', detail: `Circuito ${spec.providerId}:${spec.capability} abierto` };
    }
    const promise = fn(adapter);
    if (!promise) return { ok: false, blocked: 'NOT_AUTOMATED', detail: `El adapter no implementa ${spec.capability}` };
    this.callsSent.set(spec.providerId, (this.callsSent.get(spec.providerId) ?? 0) + 1);
    const started = ctx.now();
    try {
      const value = await promise;
      const ms = ctx.now() - started;
      if (spec.operationId) ctx.metrics.record(spec.operationId, spec.stage, ms);
      ctx.safety.recordSuccess(spec.providerId, spec.capability);
      return { ok: true, value, ms };
    } catch (err) {
      const ms = ctx.now() - started;
      const error = err instanceof Error ? err : new Error(String(err));
      if (spec.operationId) {
        ctx.metrics.record(spec.operationId, spec.stage, ms);
        ctx.metrics.providerError(spec.operationId, `${spec.capability}:${(error as { code?: string }).code ?? error.name}`);
      }
      // "No has pasado la cola" o "sesión caducada" son estados a respetar, no fallos del proveedor.
      const code = (error as { code?: string }).code;
      const benign = code === 'NOT_IN_QUEUE' || code === 'SESSION_INVALID';
      if (spec.countErrorAsFailure !== false && !benign) ctx.safety.recordFailure(spec.providerId, spec.capability, error.message);
      else ctx.safety.recordSuccess(spec.providerId, spec.capability);
      return { ok: false, blocked: null, error, ms };
    }
  }
}
