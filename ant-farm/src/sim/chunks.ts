// The world's cells, stored in 64 × 64 chunks that exist only where they're needed. A chunk nobody changed is made
// from the seed when it's first read and dropped again when it hasn't been used for a while (it can always be made
// again). A chunk the colony changed is kept, and when it's far from everything it's packed down to just its
// differences from the generated one. So memory follows what the colony did, not how big the map is.
// No DOM, no Electron.

export const CS = 6, CHUNK = 1 << CS, CM = CHUNK - 1, CELLS = CHUNK * CHUNK;

export interface Chunk {
  ci: number; cx: number; cy: number;
  type: Uint8Array | null; col: Uint16Array | null; // null while packed
  packed: Uint8Array | null; // differences from the generated chunk, while it's far away
  modified: boolean; // changed since it was made: can't simply be dropped
  ver: number; // bumped on every change, so a picture of it knows when to redraw
  used: number; // the last tick anything read it
}

// Fills one chunk's cells from the seed: type and colour code per cell, row by row.
export type Generate = (cx: number, cy: number, type: Uint8Array, col: Uint16Array) => void;

export interface ChunkStats { loaded: number; modified: number; packed: number; bytes: number }

export class ChunkStore {
  readonly cw: number; readonly ch: number;
  readonly map = new Map<number, Chunk>();
  private last: Chunk | null = null;
  private scratchT = new Uint8Array(CELLS);
  private scratchC = new Uint16Array(CELLS);
  tick = 0;
  made = 0; // chunks generated so far (a measure of work)

  constructor(readonly W: number, readonly H: number, private gen: Generate) {
    this.cw = Math.ceil(W / CHUNK); this.ch = Math.ceil(H / CHUNK);
  }

  // The chunk, made or unpacked if it has to be. The hot path: one compare when it's the same chunk as last time.
  get(ci: number): Chunk {
    const l = this.last;
    if (l && l.ci === ci) return l;
    let c = this.map.get(ci);
    if (!c) {
      const cx = ci % this.cw, cy = (ci - cx) / this.cw;
      c = { ci, cx, cy, type: new Uint8Array(CELLS), col: new Uint16Array(CELLS), packed: null, modified: false, ver: 0, used: this.tick };
      this.gen(cx, cy, c.type!, c.col!);
      this.made++;
      this.map.set(ci, c);
    } else if (!c.type) this.unpack(c);
    c.used = this.tick;
    this.last = c;
    return c;
  }

  peek(ci: number): Chunk | undefined { return this.map.get(ci); }
  ver(ci: number): number { const c = this.map.get(ci); return c ? c.ver : 0; }

  // A chunk's cells into the given arrays without loading it (for drawing a part of the map nobody is using).
  read(ci: number, type: Uint8Array, col: Uint16Array): void {
    const c = this.map.get(ci);
    if (c && c.type) { type.set(c.type); col.set(c.col!); return; }
    const cx = ci % this.cw, cy = (ci - cx) / this.cw;
    this.gen(cx, cy, type, col);
    if (c && c.packed) applyDiff(c.packed, type, col);
  }

  // Drop unused clean chunks beyond `cap`, oldest first, and pack changed ones nobody has used for `packAfter` ticks.
  // `keep(ci)` protects the chunks around the colony and the camera.
  maintain(keep: (c: Chunk) => boolean, cap = 256, packAfter = 1200): void {
    const clean: Chunk[] = [];
    for (const c of this.map.values()) {
      if (keep(c)) continue;
      if (!c.modified) clean.push(c);
      else if (c.type && this.tick - c.used > packAfter) this.pack(c);
    }
    let live = 0;
    for (const c of this.map.values()) if (!c.modified) live++;
    if (live <= cap) return;
    clean.sort((a, b) => a.used - b.used);
    for (let i = 0; i < clean.length && live > cap; i++, live--) {
      this.map.delete(clean[i].ci);
      if (this.last === clean[i]) this.last = null;
    }
  }

  pack(c: Chunk): void {
    if (!c.type) return;
    this.gen(c.cx, c.cy, this.scratchT, this.scratchC);
    c.packed = diff(this.scratchT, this.scratchC, c.type, c.col!);
    c.type = null; c.col = null;
    if (this.last === c) this.last = null;
  }

  private unpack(c: Chunk): void {
    const t = new Uint8Array(CELLS), col = new Uint16Array(CELLS);
    this.gen(c.cx, c.cy, t, col);
    applyDiff(c.packed!, t, col);
    c.type = t; c.col = col; c.packed = null;
  }

  stats(): ChunkStats {
    let loaded = 0, modified = 0, packed = 0, bytes = 0;
    for (const c of this.map.values()) {
      if (c.modified) modified++;
      if (c.type) { loaded++; bytes += CELLS * 3; } else if (c.packed) { packed++; bytes += c.packed.length; }
    }
    return { loaded, modified, packed, bytes };
  }

  // Every changed chunk as its differences from the generated one, for the save file.
  saveChanged(): [number, Uint8Array][] {
    const out: [number, Uint8Array][] = [];
    for (const c of this.map.values()) {
      if (!c.modified) continue;
      if (c.packed) { out.push([c.ci, c.packed]); continue; }
      this.gen(c.cx, c.cy, this.scratchT, this.scratchC);
      out.push([c.ci, diff(this.scratchT, this.scratchC, c.type!, c.col!)]);
    }
    return out;
  }

  // Put back a changed chunk from the save file (kept packed until something reads it).
  restore(ci: number, packed: Uint8Array, ver = 1): void {
    const cx = ci % this.cw, cy = (ci - cx) / this.cw;
    this.map.set(ci, { ci, cx, cy, type: null, col: null, packed, modified: true, ver, used: this.tick });
    if (this.last && this.last.ci === ci) this.last = null;
  }
}

// ---------- packing: the cells that differ from the generated chunk ----------
// Format: repeated [same-run varint][different-run varint][type, col lo, col hi] × different-run. An air cell's
// colour code doesn't matter, so it is written as 0 and compared by type alone.

function putVar(out: number[], v: number) { while (v >= 128) { out.push((v & 127) | 128); v >>>= 7; } out.push(v); }

export function diff(gt: Uint8Array, gc: Uint16Array, t: Uint8Array, c: Uint16Array): Uint8Array {
  const out: number[] = [];
  const same = (i: number) => gt[i] === t[i] && (t[i] === 0 || gc[i] === c[i]);
  let i = 0;
  while (i < CELLS) {
    let s = 0; while (i + s < CELLS && same(i + s)) s++;
    let d = 0; while (i + s + d < CELLS && !same(i + s + d)) d++;
    putVar(out, s); putVar(out, d);
    for (let j = i + s; j < i + s + d; j++) { const cc = t[j] === 0 ? 0 : c[j]; out.push(t[j], cc & 255, cc >>> 8); }
    i += s + d;
  }
  return Uint8Array.from(out);
}

export function applyDiff(p: Uint8Array, t: Uint8Array, c: Uint16Array): void {
  let at = 0, i = 0;
  const getVar = () => { let v = 0, sh = 0, b; do { b = p[at++]; v |= (b & 127) << sh; sh += 7; } while (b & 128); return v; };
  while (at < p.length && i < CELLS) {
    i += getVar();
    const d = getVar();
    for (let j = 0; j < d; j++, i++) { t[i] = p[at]; c[i] = p[at + 1] | (p[at + 2] << 8); at += 3; }
  }
}
