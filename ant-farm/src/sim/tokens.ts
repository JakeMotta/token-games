// How agent tokens become colony energy and food (docs/ant-farm-design.md, "How tokens feed it").
// Pure and deterministic: the same events give the same energy, so a farm can be replayed from its event log.

export const TOKENS_PER_ENERGY = 15; // one grain dug per 15 weighted tokens: digging shows every bit of work
export const TOKENS_PER_CRUMB = 2500; // one food crumb per 2,500 weighted tokens: food is scarcer than digging
export const CACHE_READ_WEIGHT = 0.1; // cache reads are cheap re-reads of the same context
export const SOFT_CAP = 200_000; // weighted tokens an hour before conversion turns logarithmic
export const HOUR_MS = 3_600_000;

export interface TokenCounts { input?: number; output?: number; cache_read?: number; cache_write?: number; tokens?: number }

// Weighted tokens of one request: input + output + cache writes + a tenth of cache reads.
export function weigh(e: TokenCounts): number {
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return n(e.input) + n(e.output) + n(e.cache_write) + CACHE_READ_WEIGHT * n(e.cache_read) + n(e.tokens);
}

// The soft cap's curve: linear up to `cap` weighted tokens in the hour, logarithmic past it, so a heavy day reads as
// a busy farm instead of a flood. Continuous and increasing, with slope 1 at the cap.
export function capped(total: number, cap = SOFT_CAP): number {
  return total <= cap ? total : cap + cap * Math.log(1 + (total - cap) / cap);
}

export interface Conversion { weighted: number; effective: number; energy: number; crumbs: number }

// Tracks the last hour of weighted tokens (by event time) and converts each new batch under the soft cap.
export class TokenMeter {
  private window: { ts: number; w: number }[] = [];
  private sum = 0;
  constructor(private cap = SOFT_CAP) {}

  hourTotal(): number { return this.sum; }

  // The last hour's batches, for the save file, and back.
  save(): [number, number][] { return this.window.map((e) => [e.ts, e.w]); }
  load(list: unknown): void {
    this.window = Array.isArray(list) ? list.filter((e) => Array.isArray(e) && e.length === 2 && e.every(Number.isFinite)).map(([ts, w]) => ({ ts, w })) : [];
    this.sum = this.window.reduce((s, e) => s + e.w, 0);
  }

  add(e: TokenCounts, ts: number): Conversion {
    while (this.window.length && this.window[0].ts <= ts - HOUR_MS) this.sum -= this.window.shift()!.w;
    if (this.sum < 1e-9) this.sum = 0;
    const weighted = weigh(e);
    const effective = capped(this.sum + weighted, this.cap) - capped(this.sum, this.cap);
    this.window.push({ ts, w: weighted });
    this.sum += weighted;
    return { weighted, effective, energy: effective / TOKENS_PER_ENERGY, crumbs: effective / TOKENS_PER_CRUMB };
  }
}
