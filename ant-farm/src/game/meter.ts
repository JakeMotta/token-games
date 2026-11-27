// What frames cost, for the performance readout (Settings → Performance) and the perf run: how many frames a second,
// and how long each one kept the page busy. Pure: the caller passes the times.
export interface FrameSummary { fps: number; ms: number; p95: number; max: number; frames: number; slow: number }

export class FrameMeter {
  private at: number[] = []; // when each recent frame started
  private ms: number[] = []; // and how long it took
  private total = 0; private slowN = 0; private maxMs = 0; private n = 0;

  constructor(private windowMs = 2000, private keep = 600) {}

  add(start: number, ms: number): void {
    this.at.push(start); this.ms.push(ms);
    if (this.at.length > this.keep) { this.at.shift(); this.ms.shift(); }
    this.n++; this.total += ms;
    if (ms > this.maxMs) this.maxMs = ms;
    if (ms > 16.7) this.slowN++;
  }

  // The last `windowMs` (at `now`): frames a second and the average cost. A frame counts while it is in the window.
  recent(now: number): { fps: number; ms: number } {
    let i = this.at.length, sum = 0;
    while (i > 0 && now - this.at[i - 1] <= this.windowMs) { i--; sum += this.ms[i]; }
    const n = this.at.length - i;
    return { fps: (n * 1000) / this.windowMs, ms: n ? sum / n : 0 };
  }

  // Everything since the last reset, and the 95th percentile of the frames kept.
  summary(sinceMs: number): FrameSummary {
    const sorted = [...this.ms].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    return { fps: sinceMs > 0 ? (this.n * 1000) / sinceMs : 0, ms: this.n ? this.total / this.n : 0, p95, max: this.maxMs, frames: this.n, slow: this.slowN };
  }

  reset(): void { this.at = []; this.ms = []; this.total = 0; this.slowN = 0; this.maxMs = 0; this.n = 0; }
}
