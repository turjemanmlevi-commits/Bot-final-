/**
 * Reloj inyectable. Todo el runtime (scheduler, runners, simulador) usa este
 * reloj en lugar de Date.now/setTimeout, de modo que los gates y los tests
 * pueden ejecutar una operación completa en milisegundos con un reloj virtual
 * y obtener siempre el mismo resultado para la misma semilla.
 */

export type TimerHandle = number;

export interface Clock {
  readonly virtual: boolean;
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
  sleep(ms: number): Promise<void>;
}

export class SystemClock implements Clock {
  readonly virtual = false;
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    const t = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, Math.max(0, ms));
    this.timers.set(id, t);
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    const t = this.timers.get(handle);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(handle);
    }
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, setInterval(fn, Math.max(1, ms)));
    return id;
  }

  clearInterval(handle: TimerHandle): void {
    const t = this.timers.get(handle);
    if (t !== undefined) {
      clearInterval(t);
      this.timers.delete(handle);
    }
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }
}

interface VirtualTimer {
  id: number;
  at: number;
  order: number;
  fn: () => void;
  interval: number | null;
}

/** Deja que se resuelvan las promesas pendientes antes de disparar el siguiente timer. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

export class VirtualClock implements Clock {
  readonly virtual = true;
  private t: number;
  private seq = 0;
  private readonly timers = new Map<number, VirtualTimer>();

  constructor(startMs: number) {
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, { id, at: this.t + Math.max(0, ms), order: id, fn, interval: null });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    const interval = Math.max(1, ms);
    this.timers.set(id, { id, at: this.t + interval, order: id, fn, interval });
    return id;
  }

  clearInterval(handle: TimerHandle): void {
    this.timers.delete(handle);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }

  pendingTimers(): number {
    return this.timers.size;
  }

  private nextDue(limit: number): VirtualTimer | null {
    let best: VirtualTimer | null = null;
    for (const timer of this.timers.values()) {
      if (timer.at > limit) continue;
      if (!best || timer.at < best.at || (timer.at === best.at && timer.order < best.order)) best = timer;
    }
    return best;
  }

  /** Avanza el tiempo disparando en orden todos los timers vencidos. */
  async advance(ms: number): Promise<void> {
    const target = this.t + Math.max(0, ms);
    await flushMicrotasks();
    for (;;) {
      const next = this.nextDue(target);
      if (!next) break;
      this.t = Math.max(this.t, next.at);
      if (next.interval !== null) {
        next.at = this.t + next.interval;
        next.order = ++this.seq;
      } else {
        this.timers.delete(next.id);
      }
      next.fn();
      await flushMicrotasks();
    }
    this.t = target;
    await flushMicrotasks();
  }

  /** Avanza en pasos hasta que se cumpla la condición o se agote el tiempo máximo. */
  async runUntil(predicate: () => boolean, maxMs: number, stepMs = 50): Promise<boolean> {
    const deadline = this.t + maxMs;
    while (this.t < deadline) {
      if (predicate()) return true;
      await this.advance(Math.min(stepMs, deadline - this.t));
    }
    return predicate();
  }
}
