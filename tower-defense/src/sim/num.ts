// Numbers for a game that never ends: a compact way to show them (1.2K, 3.4M, 5.6B, 7.8T, then aa, ab, … zz) and a
// guard that keeps every value a plain finite number. Pure.

// Far above anything weeks of play reach (late waves sit near 1e90), far below where doubles break (1.8e308).
export const LIMIT = 1e300;

// A finite, non-negative number: NaN and Infinity never reach the save file or the screen.
export function fin(x: number): number {
  if (Number.isNaN(x) || x < 0) return 0;
  return x > LIMIT ? LIMIT : x;
}

// a ** b without leaving the safe range: the exponent is clamped in log space first
export function powSafe(a: number, b: number): number {
  return fin(Math.exp(Math.min(690, b * Math.log(a))));
}

const NAMED = ['', 'K', 'M', 'B', 'T'];

// The suffix for 1000^k: K, M, B, T, then two letters (aa = 1e15, ab = 1e18, …), as idle games do.
export function suffix(k: number): string {
  if (k < NAMED.length) return NAMED[k];
  const i = k - NAMED.length, a = Math.floor(i / 26), b = i % 26;
  return a < 26 ? String.fromCharCode(97 + a, 97 + b) : 'e' + k * 3; // past zz (1e2043) only exponents; never reached
}

// Three significant digits: 7, 12, 999, 1.23K, 45.6M, 789B, 1.00aa.
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '0';
  const neg = n < 0;
  n = Math.abs(n);
  let s: string;
  if (n < 10 && n % 1 !== 0 && n > 0) s = n.toFixed(1).replace(/\.0$/, '');
  else if (n < 1000) s = String(Math.round(n) === 1000 ? 999 : Math.round(n));
  else {
    let k = Math.floor(Math.log10(n) / 3), m = n / Math.pow(10, k * 3);
    if (m >= 999.5) { k++; m /= 1000; } // 999,999 shows as 1.00M, not 1000K
    s = (m < 10 ? m.toFixed(2) : m < 100 ? m.toFixed(1) : m.toFixed(0)) + suffix(k);
  }
  return neg ? '-' + s : s;
}
