// Tower defense rules shared by every variant: token meter, waves, enemies, towers, upgrades.
// No drawing here. Deterministic per seed. Runs in Node (tests) and the browser (window.TD).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HZ = 20;
  const DT = 1 / HZ;
  const MAX_LEVEL = 4;

  // Enemies by token cost. Speed is in tiles a second.
  const ENEMIES = {
    small: { cost: 100, hp: 12, speed: 1.15, gold: 2, xp: 1, radius: 0.22, weight: 0.86 },
    medium: { cost: 1000, hp: 80, speed: 0.8, gold: 8, xp: 10, radius: 0.32, weight: 0.11 },
    big: { cost: 5000, hp: 320, speed: 0.55, gold: 25, xp: 50, radius: 0.42, weight: 0.026, minLevel: 2 },
    boss: { cost: 20000, hp: 1100, speed: 0.4, gold: 80, xp: 200, radius: 0.55, weight: 0.004, minLevel: 3 },
  };
  const ENEMY_TYPES = Object.keys(ENEMIES);

  // Three tower roles. Index 0 is level 1. Range and splash are in tiles.
  const TOWERS = {
    rapid: {
      cost: [50, 40, 70, 110], dmg: [6, 9, 14, 22], rate: [2.5, 2.8, 3.2, 3.6],
      range: [2.6, 2.9, 3.2, 3.6], projSpeed: 9,
    },
    splash: {
      cost: [80, 60, 100, 150], dmg: [16, 26, 40, 60], rate: [0.6, 0.65, 0.7, 0.8],
      range: [2.4, 2.6, 2.9, 3.2], splash: [0.9, 1.0, 1.15, 1.3], projSpeed: 4.5,
    },
    frost: {
      cost: [60, 50, 80, 120], dmg: [2, 3, 5, 8], rate: [1, 1.1, 1.2, 1.3],
      range: [2.2, 2.4, 2.7, 3.0], slow: [0.35, 0.45, 0.55, 0.6], targets: [1, 2, 3, 4], projSpeed: 7,
    },
  };
  const TOWER_TYPES = Object.keys(TOWERS);
  const SELL_BACK = 0.7;
  const START_GOLD = 140;
  const START_LIVES = 20;

  const threshold = (wave) => Math.min(8000, 1000 + 500 * (wave - 1));
  const hpMult = (wave) => 1 + 0.15 * (wave - 1);
  const xpForLevel = (n) => 30 * n * (n - 1) / 2;

  // The ant farm's token event: cache reads count at a tenth. { tokens: N } also works.
  function weighTokens(ev) {
    if (!ev) return 0;
    if (typeof ev === 'number') return Math.max(0, ev);
    if (ev.tokens != null) return Math.max(0, +ev.tokens || 0);
    return Math.max(0, (+ev.input || 0) + (+ev.output || 0) + (+ev.cache_write || 0) + (+ev.cache_read || 0) / 10);
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function towerStats(type, level) {
    const d = TOWERS[type], i = level - 1;
    return {
      dmg: d.dmg[i], rate: d.rate[i], range: d.range[i],
      splash: d.splash ? d.splash[i] : 0, slow: d.slow ? d.slow[i] : 0, targets: d.targets ? d.targets[i] : 1,
      dps: Math.round(d.dmg[i] * d.rate[i] * 10) / 10,
    };
  }
  const buildCost = (type) => TOWERS[type].cost[0];
  const upgradeCost = (type, level) => (level >= MAX_LEVEL ? null : TOWERS[type].cost[level]);
  const spentOn = (type, level) => TOWERS[type].cost.slice(0, level).reduce((a, b) => a + b, 0);
  const sellValue = (type, level) => Math.floor(spentOn(type, level) * SELL_BACK);

  // A path is a list of tile-centre waypoints [[x, y], ...]. Positions along it are in tiles.
  function makePath(points) {
    const segs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      const len = Math.hypot(bx - ax, by - ay);
      segs.push({ ax, ay, bx, by, len, start: total });
      total += len;
    }
    function at(d) {
      if (d <= 0) return { x: segs[0].ax, y: segs[0].ay };
      for (const s of segs) {
        if (d <= s.start + s.len) {
          const f = (d - s.start) / s.len;
          return { x: s.ax + (s.bx - s.ax) * f, y: s.ay + (s.by - s.ay) * f };
        }
      }
      const s = segs[segs.length - 1];
      return { x: s.bx, y: s.by };
    }
    // Every grid tile the path crosses (segments are axis-aligned).
    function tiles() {
      const out = new Set();
      for (const s of segs) {
        const n = Math.ceil(s.len);
        for (let k = 0; k <= n; k++) {
          const f = n ? k / n : 0;
          out.add(Math.round(s.ax + (s.bx - s.ax) * f) + ',' + Math.round(s.ay + (s.by - s.ay) * f));
        }
      }
      return out;
    }
    return { length: total, at, tiles };
  }

  function createGame(opts) {
    const map = opts.map;
    const rnd = mulberry32((opts.seed >>> 0) || 1);
    const path = makePath(map.path);
    const g = {
      mode: opts.mode === 'interactive' ? 'interactive' : 'endless',
      autoBuild: opts.autoBuild != null ? !!opts.autoBuild : opts.mode !== 'interactive',
      tick: 0, wave: 0, level: 1, xp: 0, gold: START_GOLD, lives: START_LIVES,
      meter: { tokens: 0, queue: [] }, // queue: enemy types waiting in the meter
      forming: null, credit: 0, // a big enemy being paid for by incoming tokens
      ready: null, // Interactive: { wave, list } waiting for Fight
      spawnQueue: [], spawnTimer: 0,
      enemies: [], towers: [], shots: [], fx: [],
      events: [], nextId: 1,
      stats: { fed: 0, killed: 0, leaked: 0, waves: 0, falls: 0 },
      map, path, spots: map.spots,
    };

    const emit = (type, data) => g.events.push(Object.assign({ type, tick: g.tick }, data || {}));

    function rollType() {
      const ok = ENEMY_TYPES.filter((t) => (ENEMIES[t].minLevel || 1) <= g.level);
      const sum = ok.reduce((s, t) => s + ENEMIES[t].weight, 0);
      let r = rnd() * sum;
      for (const t of ok) { r -= ENEMIES[t].weight; if (r <= 0) return t; }
      return ok[0];
    }

    // Roll, then form: every enemy is rolled first; a bigger one waits until enough tokens
    // have arrived to pay its cost, so many small requests still bring the odd boss.
    g.feed = function (ev) {
      let n = weighTokens(ev);
      if (n <= 0) return 0;
      g.stats.fed += n;
      g.credit += n;
      for (let guard = 0; guard < 2000; guard++) {
        if (!g.forming) g.forming = rollType();
        const cost = ENEMIES[g.forming].cost;
        if (g.credit < cost) break;
        g.credit -= cost;
        g.meter.queue.push(g.forming);
        g.meter.tokens += cost;
        g.forming = null;
      }
      emit('feed', { tokens: n });
      return n;
    };

    g.threshold = () => threshold(g.wave + 1);
    g.fill = () => Math.min(1, g.meter.tokens / g.threshold());
    g.formingProgress = () => (g.forming ? Math.min(1, g.credit / ENEMIES[g.forming].cost) : 0);
    g.levelProgress = () => (g.xp - xpForLevel(g.level)) / (xpForLevel(g.level + 1) - xpForLevel(g.level));
    g.waveActive = () => g.enemies.length > 0 || g.spawnQueue.length > 0;
    g.isBusy = () => g.waveActive() || g.shots.length > 0 || g.fx.length > 0;

    function takeWave() {
      const cap = 2 * g.threshold();
      const list = [];
      let sum = 0;
      // Biggest first so a boss is never left behind by a cap of small ones.
      const sorted = g.meter.queue.slice().sort((a, b) => ENEMIES[b].cost - ENEMIES[a].cost);
      for (const t of sorted) {
        if (list.length >= 40 || (sum + ENEMIES[t].cost > cap && list.length)) continue;
        list.push(t); sum += ENEMIES[t].cost;
      }
      for (const t of list) g.meter.queue.splice(g.meter.queue.indexOf(t), 1);
      g.meter.tokens -= sum;
      // Small ones lead, the big ones follow.
      list.sort((a, b) => ENEMIES[a].cost - ENEMIES[b].cost);
      return { list, tokens: sum };
    }

    function maybeRelease() {
      if (g.ready || g.meter.tokens < g.threshold()) return;
      if (g.mode === 'interactive') {
        if (g.waveActive()) return;
        const w = takeWave();
        g.ready = { wave: g.wave + 1, list: w.list, tokens: w.tokens };
        g.gold += 20 + Math.floor(w.tokens / 200);
        emit('ready', { wave: g.ready.wave, count: w.list.length });
        return;
      }
      if (g.spawnQueue.length) return; // Endless overlaps waves, but never two spawning at once.
      launch(takeWave().list);
    }

    function launch(list) {
      g.wave++;
      g.stats.waves++;
      const mult = hpMult(g.wave);
      for (const t of list) g.spawnQueue.push({ t, hp: Math.round(ENEMIES[t].hp * mult), wave: g.wave });
      g.spawnTimer = 0;
      emit('wave', { wave: g.wave, count: list.length });
    }

    g.fight = function () {
      if (!g.ready) return false;
      const r = g.ready;
      g.ready = null;
      launch(r.list);
      return true;
    };

    g.setMode = function (mode) {
      g.mode = mode === 'interactive' ? 'interactive' : 'endless';
      if (g.mode === 'endless' && g.ready) { const r = g.ready; g.ready = null; launch(r.list); }
    };

    g.towerAt = (spot) => g.towers.find((t) => t.spot === spot) || null;
    g.canAfford = (n) => n != null && g.gold >= n;

    g.build = function (spot, type) {
      if (spot < 0 || spot >= g.spots.length || g.towerAt(spot) || !TOWERS[type]) return null;
      const c = buildCost(type);
      if (g.gold < c) return null;
      g.gold -= c;
      const [x, y] = g.spots[spot];
      const t = { id: g.nextId++, spot, type, level: 1, x, y, cool: 0, aim: 0, kills: 0 };
      g.towers.push(t);
      emit('build', { spot, type });
      return t;
    };

    g.upgrade = function (tower) {
      const c = upgradeCost(tower.type, tower.level);
      if (c == null || g.gold < c) return false;
      g.gold -= c;
      tower.level++;
      emit('upgrade', { spot: tower.spot, level: tower.level });
      return true;
    };

    g.sell = function (tower) {
      const i = g.towers.indexOf(tower);
      if (i < 0) return 0;
      const v = sellValue(tower.type, tower.level);
      g.towers.splice(i, 1);
      g.gold += v;
      emit('sell', { spot: tower.spot, gold: v });
      return v;
    };

    // Endless plays itself: fill empty spots in a rotating role order, then raise the weakest.
    const ROTATION = ['rapid', 'splash', 'rapid', 'frost'];
    function autoSpend() {
      for (let guard = 0; guard < 20; guard++) {
        const free = g.spots.findIndex((_, i) => !g.towerAt(i));
        const type = ROTATION[g.towers.length % ROTATION.length];
        if (free >= 0 && g.gold >= buildCost(type)) { g.build(free, type); continue; }
        const weakest = g.towers.filter((t) => t.level < MAX_LEVEL)
          .sort((a, b) => a.level - b.level || a.spot - b.spot)[0];
        if (free < 0 && weakest && g.upgrade(weakest)) continue;
        break;
      }
    }

    function gainXp(n) {
      g.xp += n;
      while (g.xp >= xpForLevel(g.level + 1)) { g.level++; emit('level', { level: g.level }); }
    }

    function hit(e, dmg, slow) {
      if (e.dead) return;
      e.hp -= dmg;
      e.flash = 3;
      if (slow) { e.slow = Math.max(e.slow, slow); e.slowT = 1.5; }
      if (e.hp <= 0) {
        e.dead = true;
        g.gold += ENEMIES[e.t].gold;
        g.stats.killed++;
        gainXp(ENEMIES[e.t].xp);
        g.fx.push({ kind: 'pop', x: e.x, y: e.y, t: 0, life: 0.4, size: ENEMIES[e.t].radius });
        emit('kill', { t: e.t });
      }
    }

    function step() {
      g.tick++;
      // Spawning: one enemy every 0.6 s while a wave lasts.
      if (g.spawnQueue.length) {
        g.spawnTimer -= DT;
        if (g.spawnTimer <= 0) {
          const s = g.spawnQueue.shift();
          const p = path.at(0);
          g.enemies.push({ id: g.nextId++, t: s.t, hp: s.hp, maxHp: s.hp, d: 0, x: p.x, y: p.y, slow: 0, slowT: 0, flash: 0, wave: s.wave });
          g.spawnTimer = 0.6;
        }
      }
      // Walking.
      for (const e of g.enemies) {
        if (e.slowT > 0) { e.slowT -= DT; if (e.slowT <= 0) e.slow = 0; }
        if (e.flash > 0) e.flash--;
        e.d += ENEMIES[e.t].speed * (1 - e.slow) * DT;
        const p = path.at(e.d);
        e.x = p.x; e.y = p.y;
        if (e.d >= path.length) {
          e.dead = true; e.leaked = true;
          g.stats.leaked++;
          g.lives -= e.t === 'boss' ? 5 : e.t === 'big' ? 3 : 1;
          emit('leak', { t: e.t });
        }
      }
      if (g.lives <= 0) {
        // Forgiving: the wave is cleared away and the base is rebuilt; towers and levels stay.
        g.stats.falls++;
        for (const e of g.enemies) e.dead = true;
        g.spawnQueue.length = 0;
        g.lives = START_LIVES;
        emit('fall', {});
      }
      // Towers pick the enemy furthest along the path in range.
      for (const tw of g.towers) {
        const st = towerStats(tw.type, tw.level);
        tw.cool -= DT;
        if (tw.cool > 0) continue;
        const inRange = g.enemies.filter((e) => !e.dead && Math.hypot(e.x - tw.x, e.y - tw.y) <= st.range)
          .sort((a, b) => b.d - a.d);
        if (!inRange.length) continue;
        tw.cool = 1 / st.rate;
        const picks = inRange.slice(0, st.targets);
        tw.aim = Math.atan2(picks[0].y - tw.y, picks[0].x - tw.x);
        for (const e of picks) {
          g.shots.push({ kind: tw.type, x: tw.x, y: tw.y - 0.3, target: e, tx: e.x, ty: e.y, dmg: st.dmg, splash: st.splash,
            slow: st.slow, speed: TOWERS[tw.type].projSpeed, from: tw, sx: tw.x, sy: tw.y - 0.3, t: 0 });
        }
      }
      // Shots fly to where the target is now; splash lands where it was aimed.
      for (const s of g.shots) {
        if (s.kind !== 'splash' && s.target && !s.target.dead) { s.tx = s.target.x; s.ty = s.target.y; }
        const dx = s.tx - s.x, dy = s.ty - s.y, dist = Math.hypot(dx, dy), stepLen = s.speed * DT;
        s.t += DT;
        if (dist <= stepLen) {
          s.done = true;
          if (s.kind === 'splash') {
            for (const e of g.enemies) if (!e.dead && Math.hypot(e.x - s.tx, e.y - s.ty) <= s.splash) hit(e, s.dmg, 0);
            g.fx.push({ kind: 'blast', x: s.tx, y: s.ty, t: 0, life: 0.45, size: s.splash });
          } else if (s.target && !s.target.dead) {
            hit(s.target, s.dmg, s.slow);
            if (s.kind === 'frost') g.fx.push({ kind: 'chill', x: s.tx, y: s.ty, t: 0, life: 0.3, size: 0.4 });
          }
        } else { s.x += dx / dist * stepLen; s.y += dy / dist * stepLen; }
      }
      g.shots = g.shots.filter((s) => !s.done);
      for (const f of g.fx) f.t += DT;
      g.fx = g.fx.filter((f) => f.t < f.life);
      g.enemies = g.enemies.filter((e) => !e.dead);
      if (g.mode === 'endless' && g.autoBuild) autoSpend();
      maybeRelease();
      if (g.lives < START_LIVES && !g.waveActive() && g.tick % (HZ * 4) === 0) g.lives++;
    }

    g.step = function (n) { for (let i = 0; i < (n || 1); i++) step(); };
    g.takeEvents = () => g.events.splice(0);
    // Forces a wave on the path at once (used by the demo states and tests).
    g.demoWave = function (list) { launch(list); };
    return g;
  }

  return {
    HZ, DT, MAX_LEVEL, ENEMIES, ENEMY_TYPES, TOWERS, TOWER_TYPES, SELL_BACK, START_GOLD, START_LIVES,
    threshold, hpMult, xpForLevel, weighTokens, towerStats, buildCost, upgradeCost, sellValue, makePath, createGame,
  };
});
