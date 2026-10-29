/** Small deterministic PRNG (mulberry32) so a simulation can be reproduced from its seed. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T extends string>(weights: Record<T, number>): T {
    const entries = Object.entries(weights) as [T, number][];
    const total = entries.reduce((s, [, w]) => s + Math.max(w, 0), 0);
    let roll = this.next() * total;
    for (const [key, w] of entries) {
      roll -= Math.max(w, 0);
      if (roll < 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  /** Standard normal via Box–Muller. */
  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-normal sample with the given median and spread (sigma of the underlying normal). */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }
}
