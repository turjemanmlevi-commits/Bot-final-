import type { LatencyStats } from '@to/shared';

/** Percentil por rango más cercano sobre una muestra ya ordenada. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const rank = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[rank] as number;
}

export function summarize(samples: ArrayLike<number>, count = samples.length, sum?: number, max?: number): LatencyStats | null {
  const n = samples.length;
  if (n === 0) return null;
  const sorted = Float64Array.from(samples as ArrayLike<number>).sort();
  let total = sum;
  if (total === undefined) {
    total = 0;
    for (let i = 0; i < n; i++) total += sorted[i] as number;
  }
  return {
    count,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    p999: percentile(sorted, 0.999),
    max: max ?? (sorted[n - 1] as number),
    mean: total / count,
  };
}

/** Histograma de latencias con ventana circular acotada (memoria constante). */
export class LatencyRecorder {
  private readonly buffer: Float64Array;
  private size = 0;
  private cursor = 0;
  count = 0;
  sum = 0;
  max = 0;

  constructor(capacity = 4096) {
    this.buffer = new Float64Array(capacity);
  }

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.buffer[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % this.buffer.length;
    if (this.size < this.buffer.length) this.size++;
    this.count++;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
  }

  stats(): LatencyStats | null {
    if (this.size === 0) return null;
    return summarize(this.buffer.subarray(0, this.size), this.count, this.sum, this.max);
  }
}

/** Mide una sección síncrona con reloj de alta resolución (ms con decimales). */
export function timeSync<T>(fn: () => T): { value: T; ms: number } {
  const start = process.hrtime.bigint();
  const value = fn();
  return { value, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

export function hrNowMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}
