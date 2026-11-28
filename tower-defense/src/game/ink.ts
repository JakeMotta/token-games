// The pen: hand-drawn lines that "boil" (redraw a little differently four times a second, like hand-drawn animation),
// and the two papers they go on. Everything is drawn as vector strokes, so it stays crisp at any size.

export interface Palette {
  paper: string; speck: string; rule: string; margin: string;
  ink: string; soft: string; faint: string; red: string; blue: string; chill: string; gold: string;
  card: string; tape: string; shadow: string; flame: string;
}

// Ink on cream paper: the mock-up's colours.
export const LIGHT: Palette = {
  paper: '#f6efdf', speck: '120,100,60', rule: 'rgba(80,120,170,.18)', margin: 'rgba(210,58,42,.35)',
  ink: '#1d1c22', soft: 'rgba(29,28,34,.45)', faint: 'rgba(29,28,34,.16)', red: '#d23a2a', blue: '#3a6ea5', chill: '#dbe9f6', gold: '#b8871b',
  card: '#fffdf6', tape: 'rgba(240,220,120,.55)', shadow: 'rgba(0,0,0,.12)', flame: 'rgba(232,120,40,.22)',
};

// Pale ink on a dark, inky page (the default): the same drawing, the values turned over, the red kept warm.
export const DARK: Palette = {
  paper: '#1c1b21', speck: '200,190,170', rule: 'rgba(120,160,210,.10)', margin: 'rgba(224,90,70,.28)',
  ink: '#ebe3d1', soft: 'rgba(235,227,209,.45)', faint: 'rgba(235,227,209,.14)', red: '#e0604a', blue: '#7fa8d8', chill: '#2a3646', gold: '#e2b44a',
  card: '#27262d', tape: 'rgba(214,190,100,.35)', shadow: 'rgba(0,0,0,.35)', flame: 'rgba(240,140,60,.20)',
};

export const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const HAND = (px: number): string => `700 ${px}px Caveat, 'Bradley Hand', cursive`;

export class Pen {
  boil = 0;
  constructor(public c: CanvasRenderingContext2D, public P: Palette) {}

  // a wobble for point `i`, the same for the whole boil
  j(i: number, amp: number): number { return (hash(i * 12.9898 + this.boil * 78.233) - 0.5) * 2 * amp; }

  // Adds a slightly bent line to the current path. Callers batch many into one stroke (one beginPath, one stroke).
  l(x1: number, y1: number, x2: number, y2: number, seed: number): void {
    const c = this.c;
    c.moveTo(x1 + this.j(seed, 1), y1 + this.j(seed + 1, 1));
    c.quadraticCurveTo((x1 + x2) / 2 + this.j(seed + 2, 2), (y1 + y2) / 2 + this.j(seed + 3, 2), x2 + this.j(seed + 4, 1), y2 + this.j(seed + 5, 1));
  }

  // one line on its own
  line(x1: number, y1: number, x2: number, y2: number, seed: number, w = 2.2): void {
    const c = this.c;
    c.lineWidth = w; c.beginPath(); this.l(x1, y1, x2, y2, seed); c.stroke();
  }

  // Adds a wobbly circle (a 14-point loop) to the current path.
  o(x: number, y: number, r: number, seed: number): void {
    const c = this.c, amp = Math.max(0.8, r * 0.06);
    for (let k = 0; k <= 14; k++) {
      const a = (k / 14) * Math.PI * 2 + 0.3, rr = r + this.j(seed + (k % 14), amp);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (k) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.closePath();
  }

  circle(x: number, y: number, r: number, seed: number, fill?: string, w = 2.2): void {
    const c = this.c;
    c.beginPath(); this.o(x, y, r, seed);
    if (fill) { c.fillStyle = fill; c.fill(); }
    c.lineWidth = w; c.stroke();
  }

  text(s: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left'): void {
    const c = this.c;
    c.font = HAND(px); c.fillStyle = color; c.textAlign = align; c.fillText(s, x, y);
  }
}
