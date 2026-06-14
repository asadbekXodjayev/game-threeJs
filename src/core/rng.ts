/** Seeded PRNG (mulberry32) — deterministic, reproducible drives. */
export class RNG {
  private s: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.s = this.seed || 1;
  }

  /** float in [0,1) */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [min,max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** int in [min,max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }
}

/** A fresh random-ish seed; or read ?seed= from the URL to reproduce a drive. */
export function resolveSeed(): number {
  const url = new URLSearchParams(location.search).get('seed');
  if (url) {
    const n = parseInt(url, 10);
    if (!Number.isNaN(n)) return n >>> 0;
  }
  return (Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
