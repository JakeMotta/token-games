// The quality governor: when frames keep running long, the farm draws a little less; when there is room again for a
// while, it draws more. The ants are never what gives: each level first gives up sharpness on high-density screens,
// then the soft edges and how fast newly changed soil (falling sand) is repainted. Pure: the caller passes the times.

export interface Quality {
  level: number;
  dprCap: number; // the canvas never has more pixels than this many per CSS pixel
  soft: boolean; // feathered edges
  tileBudgetMs: number; // time a frame may spend repainting changed soil; the rest waits a frame
}

export const LEVELS: readonly Quality[] = [
  { level: 0, dprCap: 1.5, soft: true, tileBudgetMs: 6 },
  { level: 1, dprCap: 1, soft: true, tileBudgetMs: 4 },
  { level: 2, dprCap: 1, soft: false, tileBudgetMs: 2 },
];

export class Governor {
  private lvl = 0;
  private ema = 0; // a running average of the frame time
  private overSince = -1; // when the average went over budget
  private underSince = -1; // when it dropped well under

  // budgetMs: a frame should take at most this much of the page's time. Step down after downAfterMs over it, back up
  // after upAfterMs well under it (much longer, so it never flips back and forth).
  constructor(private budgetMs = 10, private downAfterMs = 1500, private upAfterMs = 10_000) {}

  get quality(): Quality { return LEVELS[this.lvl]; }
  get average(): number { return this.ema; }

  add(ms: number, now: number): Quality {
    this.ema = this.ema ? this.ema * 0.9 + ms * 0.1 : ms;
    if (this.ema > this.budgetMs) {
      this.underSince = -1;
      if (this.overSince < 0) this.overSince = now;
      else if (now - this.overSince >= this.downAfterMs && this.lvl < LEVELS.length - 1) { this.lvl++; this.overSince = now; }
    } else if (this.ema < this.budgetMs * 0.4) {
      this.overSince = -1;
      if (this.underSince < 0) this.underSince = now;
      else if (now - this.underSince >= this.upAfterMs && this.lvl > 0) { this.lvl--; this.underSince = now; }
    } else { this.overSince = -1; this.underSince = -1; }
    return LEVELS[this.lvl];
  }

  reset(): void { this.lvl = 0; this.ema = 0; this.overSince = -1; this.underSince = -1; }
}
