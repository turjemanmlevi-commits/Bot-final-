import type { EntityKind, EntityMap, StreamMessage, UpsertMessage } from '@to/shared';
import type { Clock, TimerHandle } from '../util/clock';

/**
 * Bus de cambios hacia el dashboard (SSE) y Telegram. Las entidades de alta
 * frecuencia (métricas, asignación, decisiones) se agrupan para no saturar.
 */
export class Hub {
  private readonly listeners = new Set<(m: StreamMessage) => void>();
  private readonly throttled = new Map<string, UpsertMessage>();
  private timer: TimerHandle | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly throttleMs = 200,
  ) {}

  subscribe(fn: (m: StreamMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  publish(message: StreamMessage): void {
    for (const fn of this.listeners) {
      try {
        fn(message);
      } catch {
        // Un suscriptor roto no debe tumbar el runtime.
      }
    }
  }

  upsert<K extends EntityKind>(kind: K, id: string, data: EntityMap[K]): void {
    this.throttled.delete(`${kind}|${id}`);
    this.publish({ type: 'upsert', kind, id, data } as UpsertMessage);
  }

  /** Publica el último valor como mucho cada `throttleMs` por entidad. */
  upsertThrottled<K extends EntityKind>(kind: K, id: string, data: EntityMap[K]): void {
    if (this.listeners.size === 0) return;
    this.throttled.set(`${kind}|${id}`, { type: 'upsert', kind, id, data } as UpsertMessage);
    if (this.timer === null) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        const pending = [...this.throttled.values()];
        this.throttled.clear();
        for (const m of pending) this.publish(m);
      }, this.throttleMs);
    }
  }

  remove(kind: EntityKind, id: string): void {
    this.publish({ type: 'remove', kind, id });
  }
}
