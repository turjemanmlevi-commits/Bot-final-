import { randomBytes } from 'node:crypto';
import type { Clock } from './clock';

export interface IdGen {
  next(prefix: string): string;
}

/** IDs ordenables por tiempo: `<prefijo>_<ms base36><secuencia><aleatorio>`. */
export class TimeIdGen implements IdGen {
  private lastMs = -1;
  private seq = 0;

  constructor(private readonly clock: Clock) {}

  next(prefix: string): string {
    const ms = this.clock.now();
    if (ms === this.lastMs) this.seq++;
    else {
      this.lastMs = ms;
      this.seq = 0;
    }
    return `${prefix}_${ms.toString(36).padStart(9, '0')}${this.seq.toString(36).padStart(2, '0')}${randomBytes(3).toString('hex')}`;
  }
}

/** IDs secuenciales deterministas (tests, gates, replay). */
export class SeqIdGen implements IdGen {
  private n = 0;

  next(prefix: string): string {
    this.n++;
    return `${prefix}_${this.n.toString(36).padStart(6, '0')}`;
  }
}
