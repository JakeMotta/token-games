// The whole game as a fixed-step simulation, separate from drawing: Claude Code usage fills the ink bucket, a full
// bucket sends the next wave, towers shoot, doodles walk. step() always advances STEP seconds; the page calls it
// as often as real time (and the speed) asks and draws between steps by interpolation (x/px, y/py).
// Objects are pooled (walkers, shots, effects), so a busy wave makes no garbage. Pure: no DOM, no clock.
import { ENEMIES, rollWave, turnGold, waveCost, waveGold, waveHp, speedMult, weigh, type EnemyId } from './enemies';
import { CELL, COLS, ROWS, ROAD_LEN, along } from './map';
import { fin, LIMIT } from './num';
import { Grid, nearest } from './placement';
import { AIMS, TOWERS, TOWER_IDS, affordable, sellValue, stats, upgradeCost, unlockedAt, type Aim, type TowerId, type TowerStats } from './towers';

export const STEP = 1 / 30; // seconds a step
export const START_GOLD = 160, START_LIVES = 20;
const SETBACK = 5; // waves a torn page sends you back

export interface Tower {
  id: number; type: TowerId; level: number; cx: number; cy: number; aim: Aim; kills: number;
  x: number; y: number; // centre on the page
  st: TowerStats; cheer: number; // its numbers, and the Banners' cheer on it (0.3 = +30%)
  cd: number; heading: number; recoil: number; firing: number; // for drawing: where it looks, its kick, the flame
  cranes: Crane[];
}
export interface Crane { x: number; y: number; px: number; py: number; target: Enemy | null; tid: number; cd: number }

export interface Enemy {
  uid: number; alive: boolean; type: EnemyId; wave: number;
  d: number; x: number; y: number; px: number; py: number; dir: number; // along the road; its facing (-1 left, 1 right)
  hp: number; max: number; speed: number; gold: number;
  slow: number; slowT: number; poison: number; stacks: number; poisonT: number; burn: number; burnT: number;
  flash: number; numAcc: number; numT: number; tackT: number; wellBonus: number;
}

export type ShotKind = 'dart' | 'blot' | 'seed';
export interface Shot {
  alive: boolean; kind: ShotKind; x: number; y: number; px: number; py: number; sx: number; sy: number; tx: number; ty: number;
  target: Enemy | null; tid: number; dmg: number; area: number; t: number; life: number; speed: number; from: Tower | null;
}

export type FxKind = 'splat' | 'blast' | 'chill' | 'beam' | 'chain' | 'trace' | 'num' | 'crit' | 'stab' | 'tear' | 'coin';
export interface Fx { kind: FxKind; x: number; y: number; x2: number; y2: number; t: number; life: number; size: number; value: number; seed: number; n: number; pts: Float32Array }

interface Spawner { wave: number; list: EnemyId[]; i: number; gap: number; t: number }

export interface SaveData {
  v: 1; seed: number; wave: number; ink: number; gold: number; lives: number; auto: boolean; speed: number; tips: number;
  towers: { type: TowerId; level: number; cx: number; cy: number; aim: Aim; kills: number }[];
  stats: { tokens: number; turns: number; kills: number; leaks: number; tears: number; best: number; spent: number };
}

export class TDGame {
  seed: number;
  wave = 0; // the last wave sent
  ink = 0; // tokens in the bucket
  gold = START_GOLD;
  lives = START_LIVES;
  auto = true;
  speed = 1;
  paused = false;
  tips = 0; // how far the first-time hints have got
  numbers = true; // make damage-number effects
  time = 0;
  stats = { tokens: 0, turns: 0, kills: 0, leaks: 0, tears: 0, best: 0, spent: 0 };

  readonly grid = new Grid();
  towers: Tower[] = [];
  readonly enemies: Enemy[] = []; // pooled: dead ones are reused
  readonly shots: Shot[] = [];
  readonly fx: Fx[] = [];
  private fxNext = 0;
  private spawners: Spawner[] = [];
  private left = new Map<number, number>(); // walkers still to come or alive, per wave
  private uid = 1;
  private nextId = 1;
  private sinceSend = 0;
  private tmp = { x: 0, y: 0 };
  // what happened since the page last looked: for pulses and sounds
  events: { kind: 'wave' | 'clear' | 'leak' | 'tear' | 'unlock' | 'turn'; value: number }[] = [];

  constructor(seed = 1) {
    this.seed = seed >>> 0;
    for (let i = 0; i < 360; i++) this.fx.push({ kind: 'splat', x: 0, y: 0, x2: 0, y2: 0, t: 1, life: 0, size: 0, value: 0, seed: 0, n: 0, pts: new Float32Array(32) });
  }

  // ---- usage: the only thing that moves the game forward --------------------------------------------------------

  // Tokens fill the bucket; a finished turn pays gold. Returns what it paid (tokens weighed, gold).
  feed(ev: { type: string; input?: number; output?: number; cache_read?: number; cache_write?: number }): { tokens: number; gold: number } {
    if (ev.type === 'tokens') {
      const t = weigh(ev as { input: number; output: number; cache_read: number; cache_write: number });
      this.ink = fin(this.ink + t); this.stats.tokens = fin(this.stats.tokens + t);
      return { tokens: t, gold: 0 };
    }
    if (ev.type === 'task_done') {
      const g = turnGold(Math.max(1, this.wave));
      this.gold = fin(this.gold + g); this.stats.turns++;
      this.events.push({ kind: 'turn', value: g });
      return { tokens: 0, gold: g };
    }
    return { tokens: 0, gold: 0 };
  }

  nextCost(): number { return waveCost(this.wave + 1); }
  ready(): boolean { return this.ink >= this.nextCost(); }
  // how many waves the bucket holds right now
  queued(): number {
    let n = 0, ink = this.ink;
    while (n < 99 && ink >= waveCost(this.wave + 1 + n)) { ink -= waveCost(this.wave + 1 + n); n++; }
    return n;
  }
  busy(): boolean { return this.spawners.length > 0 || this.alive() > 0; }
  alive(): number { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }

  // Send the next wave if the bucket holds enough ink.
  send(): boolean {
    if (!this.ready()) return false;
    const before = unlockedAt(this.wave).length;
    this.ink = fin(this.ink - this.nextCost());
    this.wave++;
    this.stats.best = Math.max(this.stats.best, this.wave);
    const w = rollWave(this.wave, this.seed);
    this.spawners.push({ wave: w.n, list: w.list, i: 0, gap: w.gap, t: 0 });
    this.left.set(w.n, w.list.length);
    this.sinceSend = 0;
    if (this.tips === 1) this.tips = 2;
    this.events.push({ kind: 'wave', value: this.wave });
    if (unlockedAt(this.wave).length > before) this.events.push({ kind: 'unlock', value: this.wave });
    return true;
  }

  // ---- building ------------------------------------------------------------------------------------------------

  canBuild(type: TowerId): boolean { return TOWERS[type].unlock <= Math.max(1, this.stats.best) && this.gold >= TOWERS[type].cost; }

  build(type: TowerId, cx: number, cy: number): Tower | null {
    if (!this.canBuild(type) || !this.grid.ok(type, cx, cy)) return null;
    this.gold = fin(this.gold - TOWERS[type].cost); this.stats.spent = fin(this.stats.spent + TOWERS[type].cost);
    const t = this.place(type, 1, cx, cy, type === 'glass' ? 'strong' : 'first', 0);
    if (this.tips < 1) this.tips = 1;
    return t;
  }

  private place(type: TowerId, level: number, cx: number, cy: number, aim: Aim, kills: number): Tower {
    const size = TOWERS[type].size;
    const t: Tower = {
      id: this.nextId++, type, level, cx, cy, aim, kills, x: (cx + size / 2) * CELL, y: (cy + size / 2) * CELL,
      st: stats(type, level), cheer: 0, cd: 0.3, heading: -0.6, recoil: 0, firing: 0, cranes: [],
    };
    this.grid.fill(cx, cy, size, t.id);
    this.towers.push(t);
    this.recheer();
    return t;
  }

  // Upgrade by up to `n` levels (Infinity: as many as the gold buys). Returns the levels bought.
  upgrade(t: Tower, n = 1): number {
    const a = affordable(t.type, t.level, this.gold, n);
    if (!a.levels) return 0;
    this.gold = fin(this.gold - a.cost); this.stats.spent = fin(this.stats.spent + a.cost);
    t.level += a.levels; t.st = stats(t.type, t.level);
    if (t.type === 'flag') this.recheer();
    return a.levels;
  }
  upgradeCost(t: Tower): number { return upgradeCost(t.type, t.level); }

  sell(t: Tower): number {
    const i = this.towers.indexOf(t);
    if (i < 0) return 0;
    const g = sellValue(t.type, t.level);
    this.towers.splice(i, 1);
    this.grid.fill(t.cx, t.cy, TOWERS[t.type].size, 0);
    this.gold = fin(this.gold + g);
    for (const s of this.shots) if (s.from === t) s.from = null;
    this.recheer();
    return g;
  }

  move(t: Tower, cx: number, cy: number): boolean {
    if (!this.grid.ok(t.type, cx, cy, t.id)) return false;
    const size = TOWERS[t.type].size;
    this.grid.fill(t.cx, t.cy, size, 0);
    t.cx = cx; t.cy = cy; t.x = (cx + size / 2) * CELL; t.y = (cy + size / 2) * CELL;
    this.grid.fill(cx, cy, size, t.id);
    for (const c of t.cranes) { c.x = c.px = t.x; c.y = c.py = t.y; }
    this.recheer();
    return true;
  }

  setAim(t: Tower, aim?: Aim): void { t.aim = aim ?? AIMS[(AIMS.indexOf(t.aim) + 1) % AIMS.length]; }

  towerAt(x: number, y: number): Tower | null {
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    const id = c >= 0 && r >= 0 && c < COLS && r < ROWS ? this.grid.occ[r * COLS + c] : 0;
    return id ? this.towers.find((t) => t.id === id) ?? null : null;
  }

  // The Banners' cheer on every tower, summed: refreshed whenever a tower comes, goes, moves or a Banner levels.
  private recheer(): void {
    for (const t of this.towers) t.cheer = 0;
    for (const f of this.towers) if (f.type === 'flag') for (const t of this.towers) {
      if (t !== f && t.type !== 'flag' && Math.hypot(t.x - f.x, t.y - f.y) <= f.st.range) t.cheer += f.st.aura;
    }
  }

  // ---- the simulation ------------------------------------------------------------------------------------------

  step(): void {
    if (this.paused) return;
    const dt = STEP;
    this.time += dt; this.sinceSend += dt;
    for (const s of this.spawners) {
      s.t -= dt;
      while (s.t <= 0 && s.i < s.list.length) { this.spawn(s.list[s.i++], s.wave, 0, null); s.t += s.gap; }
    }
    if (this.spawners.length) this.spawners = this.spawners.filter((s) => s.i < s.list.length);
    this.walk(dt);
    for (const t of this.towers) this.act(t, dt);
    this.fly(dt);
    for (const f of this.fx) if (f.t < f.life) f.t += dt;
    // auto: the next wave walks in once the last one is all out and the field is clear, or after a while anyway
    if (this.auto && this.ready() && !this.spawners.length && (this.alive() === 0 || this.sinceSend > 30)) this.send();
  }

  private spawn(type: EnemyId, wave: number, d: number, parent: Enemy | null): Enemy {
    let e = this.enemies.find((x) => !x.alive);
    if (!e) {
      e = { uid: 0, alive: false, type, wave, d: 0, x: 0, y: 0, px: 0, py: 0, dir: 1, hp: 0, max: 0, speed: 0, gold: 0, slow: 0, slowT: 0, poison: 0, stacks: 0, poisonT: 0, burn: 0, burnT: 0, flash: 0, numAcc: 0, numT: 0, tackT: 0, wellBonus: 0 };
      this.enemies.push(e);
    }
    const def = ENEMIES[type], jitter = 0.95 + ((this.uid * 2654435761) % 1000) / 10000;
    e.uid = this.uid++; e.alive = true; e.type = type; e.wave = wave; e.d = d;
    e.max = e.hp = fin(def.hp * waveHp(wave) * (parent ? 0.35 : 1));
    e.speed = def.speed * speedMult(wave) * jitter; e.gold = fin(def.gold * waveGold(wave) * (parent ? 0.3 : 1));
    e.slow = e.slowT = e.poison = e.stacks = e.poisonT = e.burn = e.burnT = e.flash = e.numAcc = e.numT = e.tackT = e.wellBonus = 0;
    along(d, this.tmp); e.x = e.px = this.tmp.x; e.y = e.py = this.tmp.y; e.dir = 1;
    return e;
  }

  private walk(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.px = e.x; e.py = e.y;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
      if (e.flash > 0) e.flash -= dt;
      if (e.tackT > 0) e.tackT -= dt;
      if (e.poisonT > 0) { e.poisonT -= dt; this.hurt(e, e.poison * e.stacks * dt, null, true); if (e.poisonT <= 0) { e.stacks = 0; e.poison = 0; } }
      if (e.burnT > 0) { e.burnT -= dt; this.hurt(e, e.burn * dt, null, true); }
      if (!e.alive) continue;
      const heal = ENEMIES[e.type].heals;
      if (heal) for (const o of this.enemies) if (o.alive && o !== e && Math.abs(o.d - e.d) < 60) o.hp = Math.min(o.max, o.hp + o.max * heal * dt);
      e.d += e.speed * (1 - e.slow) * dt;
      if (e.numT > 0) e.numT -= dt;
      if (e.numAcc > 0 && e.numT <= 0) { this.num(e, e.numAcc, false); e.numAcc = 0; e.numT = 0.35; }
      if (e.d >= ROAD_LEN) { this.leak(e); continue; }
      along(e.d, this.tmp);
      if (Math.abs(this.tmp.x - e.x) > 0.05) e.dir = this.tmp.x < e.x ? -1 : 1;
      e.x = this.tmp.x; e.y = this.tmp.y;
    }
  }

  private leak(e: Enemy): void {
    e.alive = false;
    this.lives -= ENEMIES[e.type].lives; this.stats.leaks++;
    this.done(e.wave);
    this.events.push({ kind: 'leak', value: ENEMIES[e.type].lives });
    if (this.lives <= 0) this.tear();
  }

  // Out of lives: the page tears. The field clears, the bucket keeps its ink, and you go back a few waves.
  private tear(): void {
    let low = this.wave;
    for (const e of this.enemies) if (e.alive) { low = Math.min(low, e.wave); e.alive = false; }
    for (const s of this.spawners) low = Math.min(low, s.wave);
    this.spawners = []; this.left.clear();
    for (const s of this.shots) s.alive = false;
    this.wave = Math.max(0, low - 1 - SETBACK);
    this.lives = START_LIVES; this.stats.tears++;
    this.addFx('tear', 480, 264, 0, 0, 1.6, 0, 0);
    this.events.push({ kind: 'tear', value: this.wave + 1 });
  }

  private done(wave: number): void {
    const n = (this.left.get(wave) ?? 1) - 1;
    if (n > 0) { this.left.set(wave, n); return; }
    this.left.delete(wave);
    // a cleared wave pays a little, and every Inkwell pays its share
    let g = waveGold(wave) * 2;
    for (const t of this.towers) if (t.type === 'well') { g += waveGold(wave) * 6 * t.st.aura; this.addFx('coin', t.x, t.y - 20, 0, 0, 1.2, waveGold(wave) * 6 * t.st.aura, t.id); }
    this.gold = fin(this.gold + g);
    this.events.push({ kind: 'clear', value: wave });
    if (this.tips < 3 && this.tips >= 2) this.tips = 3;
  }

  // Damage `e` by `amount` (armour applies unless `pierce`).
  hurt(e: Enemy, amount: number, from: Tower | null, pierce = false): void {
    if (!e.alive || !(amount > 0)) return;
    const armor = pierce ? 0 : ENEMIES[e.type].armor ?? 0;
    const dmg = fin(amount * (1 - armor));
    e.hp -= dmg;
    if (dmg > e.max * 0.002) e.flash = 0.12;
    e.numAcc = Math.min(LIMIT, e.numAcc + dmg);
    if (from) from.recoil = 1;
    if (e.hp <= 0) this.kill(e, from);
  }

  private kill(e: Enemy, from: Tower | null): void {
    e.alive = false; e.hp = 0;
    if (e.numAcc > 0) { this.num(e, e.numAcc, false); e.numAcc = 0; }
    let bonus = 0;
    for (const t of this.towers) if (t.type === 'well' && Math.hypot(t.x - e.x, t.y - e.y) <= t.st.range) bonus += 0.1 + 0.02 * Math.log(1 + t.level);
    this.gold = fin(this.gold + e.gold * (1 + bonus));
    this.stats.kills++;
    if (from) from.kills++;
    this.addFx('splat', e.x, e.y, 0, 0, 0.5, ENEMIES[e.type].r, e.uid);
    const splits = ENEMIES[e.type].splits;
    if (splits) for (let i = 0; i < splits; i++) {
      const c = this.spawn('scribble', e.wave, Math.max(0, e.d - 8 - i * 10), e);
      c.flash = 0.2;
      this.left.set(e.wave, (this.left.get(e.wave) ?? 0) + 1);
    }
    this.done(e.wave);
  }

  private num(e: Enemy, v: number, crit: boolean): void {
    if (this.numbers) this.addFx(crit ? 'crit' : 'num', e.x, e.y - ENEMIES[e.type].r * 2, 0, 0, crit ? 1.1 : 0.8, v, e.uid);
  }

  addFx(kind: FxKind, x: number, y: number, x2: number, y2: number, life: number, value: number, seed: number): Fx {
    const f = this.fx[this.fxNext];
    this.fxNext = (this.fxNext + 1) % this.fx.length;
    f.kind = kind; f.x = x; f.y = y; f.x2 = x2; f.y2 = y2; f.t = 0; f.life = life; f.value = value; f.size = value; f.seed = seed; f.n = 0;
    return f;
  }

  // ---- towers --------------------------------------------------------------------------------------------------

  // The walker `t` should shoot at, by its aim; skips fliers when `ground`, and `skip` (already hit).
  private pick(t: Tower, range: number, ground = false, skip?: Enemy[]): Enemy | null {
    let best: Enemy | null = null, score = -Infinity;
    for (const e of this.enemies) {
      if (!e.alive || (ground && ENEMIES[e.type].flies) || (skip && skip.includes(e))) continue;
      const dx = e.x - t.x, dy = e.y - t.y, d2 = dx * dx + dy * dy, r = range + ENEMIES[e.type].r;
      if (d2 > r * r) continue;
      const s = t.aim === 'first' ? e.d : t.aim === 'last' ? -e.d : t.aim === 'strong' ? e.hp : -d2;
      if (s > score) { score = s; best = e; }
    }
    return best;
  }

  private act(t: Tower, dt: number): void {
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 4);
    if (t.firing > 0) t.firing -= dt;
    const st = t.st, boost = 1 + t.cheer, dmg = fin(st.dmg * boost), rate = st.rate * (1 + t.cheer * 0.5);
    if (t.type === 'flag' || t.type === 'well') return;
    if (t.type === 'crane') { this.cranes(t, dt, dmg, rate); return; }
    if (t.type === 'tack') { this.tack(t, dmg); return; }
    t.cd -= dt;
    if (t.cd > 0) return;
    const e = this.pick(t, st.range);
    if (!e) { t.cd = 0; return; }
    t.heading = Math.atan2(e.y - t.y, e.x - t.x);
    t.cd += 1 / rate;
    if (t.cd < 0) t.cd = 0;
    switch (t.type) {
      case 'quill': {
        const hit: Enemy[] = [e];
        for (let i = 1; i < st.multi; i++) { const o = this.pick(t, st.range, false, hit); if (!o) break; hit.push(o); }
        for (let i = 0; i < st.multi; i++) this.shoot('dart', t, hit[i % hit.length], dmg, 0, 560);
        t.recoil = 1;
        break;
      }
      case 'bomb': this.shoot('blot', t, e, dmg, st.area, 0); t.recoil = 1; break;
      case 'thorn': this.shoot('seed', t, e, dmg, st.time, 320); break;
      case 'frost': {
        for (const o of this.enemies) if (o.alive && Math.hypot(o.x - t.x, o.y - t.y) <= st.range + ENEMIES[o.type].r) {
          this.hurt(o, dmg, t);
          if (st.area >= o.slow) { o.slow = st.area; o.slowT = st.time; } else o.slowT = Math.max(o.slowT, st.time);
        }
        this.addFx('chill', t.x, t.y, 0, 0, 0.6, st.range, t.id);
        break;
      }
      case 'ruler': {
        // a straight line from the tower through the target out to its reach; everything on it is hit, armour or not
        const len = st.range, ux = Math.cos(t.heading), uy = Math.sin(t.heading), ex = t.x + ux * len, ey = t.y + uy * len;
        for (const o of this.enemies) {
          if (!o.alive) continue;
          const px = o.x - t.x, py = o.y - t.y, along_ = px * ux + py * uy;
          if (along_ < 0 || along_ > len + ENEMIES[o.type].r) continue;
          if (Math.abs(px * uy - py * ux) <= st.area + ENEMIES[o.type].r) this.hurt(o, dmg, t, true);
        }
        this.addFx('beam', t.x, t.y, ex, ey, 0.35, st.area, t.id);
        t.recoil = 1;
        break;
      }
      case 'spark': {
        const f = this.addFx('chain', t.x, t.y - 14, 0, 0, 0.3, 0, t.id), hit: Enemy[] = [];
        let cur: Enemy | null = e, k = dmg;
        while (cur && hit.length < st.multi && hit.length < 15) {
          hit.push(cur);
          f.pts[f.n * 2] = cur.x; f.pts[f.n * 2 + 1] = cur.y; f.n++;
          this.hurt(cur, k, t);
          k *= 0.85;
          let next: Enemy | null = null, nd = 90 * 90;
          for (const o of this.enemies) {
            if (!o.alive || hit.includes(o)) continue;
            const d2 = (o.x - cur.x) ** 2 + (o.y - cur.y) ** 2;
            if (d2 < nd) { nd = d2; next = o; }
          }
          cur = next;
        }
        break;
      }
      case 'glass': {
        const crit = st.crit > 0 && ((this.time * 1000 + t.id * 7919) % 1000) / 1000 < st.crit;
        const amount = crit ? dmg * 3 : dmg;
        this.addFx('trace', t.x, t.y - 16, e.x, e.y, 0.4, 0, t.id);
        if (crit && this.numbers) { e.numAcc = 0; this.hurt(e, amount, t, true); this.num(e, amount, true); e.numAcc = 0; } else this.hurt(e, amount, t, true);
        t.recoil = 1;
        break;
      }
      case 'candle': {
        // every enemy in the cone takes the tick and catches fire
        t.firing = 0.25;
        for (const o of this.enemies) {
          if (!o.alive) continue;
          const dx = o.x - t.x, dy = o.y - t.y, dist = Math.hypot(dx, dy);
          if (dist > st.range + ENEMIES[o.type].r) continue;
          let da = Math.atan2(dy, dx) - t.heading;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) <= st.area || dist < 14) { this.hurt(o, dmg, t); o.burn = Math.max(o.burn, dmg * 0.8); o.burnT = st.time; }
        }
        break;
      }
    }
  }

  private tack(t: Tower, dmg: number): void {
    for (const e of this.enemies) {
      if (!e.alive || e.tackT > 0 || ENEMIES[e.type].flies) continue;
      if (Math.hypot(e.x - t.x, e.y - t.y) > t.st.range + ENEMIES[e.type].r) continue;
      for (let i = 0; i < t.st.multi && e.alive; i++) this.hurt(e, dmg, t);
      if (e.alive) { e.slow = Math.max(e.slow, t.st.area); e.slowT = Math.max(e.slowT, t.st.time); }
      e.tackT = 0.6; t.recoil = 1;
      this.addFx('stab', t.x, t.y, 0, 0, 0.3, 0, t.id);
    }
  }

  private cranes(t: Tower, dt: number, dmg: number, rate: number): void {
    while (t.cranes.length < t.st.multi && t.cranes.length < 24) t.cranes.push({ x: t.x, y: t.y, px: t.x, py: t.y, target: null, tid: 0, cd: 0 });
    let i = 0;
    for (const c of t.cranes) {
      c.px = c.x; c.py = c.y; i++;
      if (c.target && (!c.target.alive || c.target.uid !== c.tid || Math.hypot(c.target.x - t.x, c.target.y - t.y) > t.st.range * 1.3)) c.target = null;
      if (!c.target) { const e = this.pick(t, t.st.range); if (e) { c.target = e; c.tid = e.uid; } }
      // circle home when there's nothing to peck
      const a = this.time * 1.6 + i * 2.1;
      const gx = c.target ? c.target.x : t.x + Math.cos(a) * 26, gy = c.target ? c.target.y - 8 : t.y - 18 + Math.sin(a) * 10;
      const dx = gx - c.x, dy = gy - c.y, d = Math.hypot(dx, dy), v = 190 * dt;
      if (d > v) { c.x += (dx / d) * v; c.y += (dy / d) * v; } else { c.x = gx; c.y = gy; }
      c.cd -= dt;
      if (c.target && d < 14 && c.cd <= 0) { this.hurt(c.target, dmg, t); c.cd = 1 / rate; }
    }
  }

  private shoot(kind: ShotKind, from: Tower, e: Enemy, dmg: number, area: number, speed: number): void {
    let s = this.shots.find((x) => !x.alive);
    if (!s) { s = { alive: false, kind, x: 0, y: 0, px: 0, py: 0, sx: 0, sy: 0, tx: 0, ty: 0, target: null, tid: 0, dmg: 0, area: 0, t: 0, life: 0, speed: 0, from: null }; this.shots.push(s); }
    const sy = from.y - (kind === 'blot' ? 18 : 14);
    s.alive = true; s.kind = kind; s.x = s.px = s.sx = from.x; s.y = s.py = s.sy = sy; s.target = e; s.tid = e.uid;
    s.tx = e.x; s.ty = e.y; s.dmg = dmg; s.area = area; s.t = 0; s.speed = speed; s.from = from;
    // a blot is lobbed at where the walker will be when it lands
    s.life = kind === 'blot' ? 0.7 : 2;
    if (kind === 'blot') { along(e.d + e.speed * (1 - e.slow) * s.life, this.tmp); s.tx = this.tmp.x; s.ty = this.tmp.y; }
  }

  private fly(dt: number): void {
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.px = s.x; s.py = s.y; s.t += dt;
      if (s.kind === 'blot') {
        const k = Math.min(1, s.t / s.life);
        s.x = s.sx + (s.tx - s.sx) * k; s.y = s.sy + (s.ty - s.sy) * k;
        if (k >= 1) {
          s.alive = false;
          for (const o of this.enemies) {
            if (!o.alive) continue;
            const d = Math.hypot(o.x - s.x, o.y - s.y);
            if (d <= s.area + ENEMIES[o.type].r) this.hurt(o, s.dmg * (1 - 0.5 * Math.min(1, d / s.area)), s.from);
          }
          this.addFx('blast', s.x, s.y, 0, 0, 0.55, s.area, Math.floor(s.x * 7));
        }
        continue;
      }
      const e = s.target && s.target.alive && s.target.uid === s.tid ? s.target : null;
      if (e) { s.tx = e.x; s.ty = e.y - ENEMIES[e.type].r * 0.6; }
      const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy), v = s.speed * dt;
      if (d <= v + 2 || s.t > s.life) {
        s.alive = false;
        if (!e) continue;
        if (s.kind === 'seed') {
          e.stacks = Math.min(s.from ? s.from.st.multi : 3, e.stacks + 1);
          e.poison = Math.max(e.poison, s.dmg); e.poisonT = s.area;
        } else this.hurt(e, s.dmg, s.from);
        continue;
      }
      s.x += (dx / d) * v; s.y += (dy / d) * v;
    }
  }

  // ---- saving --------------------------------------------------------------------------------------------------

  save(): SaveData {
    // a wave still walking is given back to the bucket, so closing the app never loses tokens
    let wave = this.wave, ink = this.ink;
    const open = new Set<number>([...this.left.keys()]);
    while (wave > 0 && open.has(wave)) { ink += waveCost(wave); wave--; }
    return {
      v: 1, seed: this.seed, wave, ink: fin(ink), gold: this.gold, lives: this.lives, auto: this.auto, speed: this.speed, tips: this.tips,
      towers: this.towers.map((t) => ({ type: t.type, level: t.level, cx: t.cx, cy: t.cy, aim: t.aim, kills: t.kills })),
      stats: { ...this.stats },
    };
  }

  static load(raw: unknown, seed = 1): TDGame {
    const g = new TDGame(seed);
    if (!raw || typeof raw !== 'object' || (raw as SaveData).v !== 1) return g;
    const r = raw as Partial<SaveData>;
    const n = (v: unknown, lo: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(LIMIT, v)) : fb);
    g.seed = n(r.seed, 0, seed) >>> 0;
    g.wave = Math.floor(n(r.wave, 0, 0)); g.ink = n(r.ink, 0, 0); g.gold = n(r.gold, 0, START_GOLD);
    g.lives = Math.floor(n(r.lives, 1, START_LIVES)); g.auto = r.auto !== false; g.speed = [1, 2, 4].includes(r.speed as number) ? (r.speed as number) : 1;
    g.tips = Math.floor(n(r.tips, 0, 0));
    const s = (r.stats ?? {}) as Partial<SaveData['stats']>;
    for (const k of Object.keys(g.stats) as (keyof SaveData['stats'])[]) g.stats[k] = n(s[k], 0, 0);
    g.stats.best = Math.max(g.stats.best, g.wave);
    for (const t of Array.isArray(r.towers) ? r.towers : []) {
      if (!t || !TOWER_IDS.includes(t.type)) continue;
      const level = Math.floor(n(t.level, 1, 1));
      const at = Number.isInteger(t.cx) && Number.isInteger(t.cy) ? nearest(g.grid, t.type, t.cx, t.cy, 0) : null;
      // a tower that no longer fits (a changed map, a hand-edited save) is sold back rather than lost
      if (!at) { g.gold = fin(g.gold + sellValue(t.type, level)); continue; }
      g.place(t.type, level, at[0], at[1], AIMS.includes(t.aim) ? t.aim : 'first', Math.floor(n(t.kills, 0, 0)));
    }
    return g;
  }
}
