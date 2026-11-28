"use strict";
(() => {
  // ../shell/src/events.ts
  var count = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  var text = (s, max = 64) => typeof s === "string" && s ? s.slice(0, max) : void 0;
  function normalizeEvent(raw, now = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    const e = raw;
    if (e.v !== void 0 && e.v !== 1) return null;
    const source = text(e.source, 32) || "unknown";
    const ts = typeof e.ts === "number" && Number.isFinite(e.ts) ? e.ts : now;
    const session = text(e.session);
    if (e.type === "tokens") {
      const ev = { v: 1, source, type: "tokens", input: count(e.input), output: count(e.output), cache_read: count(e.cache_read), cache_write: count(e.cache_write), ts };
      if (session) ev.session = session;
      const model = text(e.model);
      if (model) ev.model = model;
      return ev;
    }
    if (e.type === "task_done") {
      const ev = { v: 1, source, type: "task_done", ts };
      if (session) ev.session = session;
      if (typeof e.width === "number" && Number.isFinite(e.width)) ev.width = Math.round(e.width);
      return ev;
    }
    if (e.type === "session_start" || e.type === "agent_waiting") {
      const ev = { v: 1, source, type: e.type, ts };
      if (session) ev.session = session;
      return ev;
    }
    return null;
  }

  // ../shell/src/orb.ts
  var CORNERS = ["tl", "tr", "bl", "br"];

  // ../shell/src/settings.ts
  var PRESENTATIONS = ["orb", "floating"];
  var DOCKS = ["tl", "tr", "bl", "br", "free"];
  var SIZES = ["small", "large", "custom"];
  var PRESET_WIDTH = { small: 320, large: 640 };
  var MIN_WIDTH = 256;
  var MIN_OPACITY = 0.25;
  function shellDefaults() {
    return {
      presentation: "orb",
      reducedMotion: false,
      corner: "br",
      display: null,
      size: "small",
      width: PRESET_WIDTH.small,
      clickThrough: false,
      opacity: 1,
      dock: "br",
      bounds: null,
      alwaysOnTop: true
    };
  }
  var num = (v, lo, hi, fallback) => typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  var bool = (v, fallback) => typeof v === "boolean" ? v : fallback;
  var oneOf = (list, v, fallback) => list.includes(v) ? v : fallback;
  function cleanBounds(v) {
    if (!v || typeof v !== "object") return null;
    const b = v;
    const ok = ["x", "y", "width", "height"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k]));
    if (!ok || b.width < 1 || b.height < 1) return null;
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  }
  function sanitizeShell(r, base) {
    const size = oneOf(SIZES, r.size, base.size);
    let width = Math.round(num(r.width, MIN_WIDTH, 8192, base.width));
    if (size !== "custom") width = PRESET_WIDTH[size];
    return {
      // the orb took the notch's place: a settings file from then rests in the corner
      presentation: r.presentation === "notch" ? "orb" : oneOf(PRESENTATIONS, r.presentation, base.presentation),
      reducedMotion: bool(r.reducedMotion, base.reducedMotion),
      corner: oneOf(CORNERS, r.corner, base.corner),
      display: r.display === null ? null : typeof r.display === "number" && Number.isInteger(r.display) ? r.display : base.display,
      size,
      width,
      clickThrough: bool(r.clickThrough, base.clickThrough),
      opacity: num(r.opacity, MIN_OPACITY, 1, base.opacity),
      dock: oneOf(DOCKS, r.dock, base.dock),
      bounds: r.bounds === void 0 ? base.bounds : cleanBounds(r.bounds),
      alwaysOnTop: bool(r.alwaysOnTop, base.alwaysOnTop)
    };
  }
  function settingsKit(game) {
    const defaults = (seed = 1) => ({ ...shellDefaults(), ...game.defaults(seed >>> 0) });
    const sanitize = (raw, base = defaults()) => {
      const r = raw && typeof raw === "object" ? raw : {};
      return { ...sanitizeShell(r, base), ...game.sanitize(r, base) };
    };
    return {
      defaults,
      sanitize,
      applyPatch(cur, patch) {
        const next = sanitize({ ...cur, ...patch }, cur);
        if (patch.size && patch.size !== "custom" && patch.width === void 0) next.width = PRESET_WIDTH[patch.size];
        return next;
      },
      reset: (cur) => ({ ...shellDefaults(), ...game.reset(cur) })
    };
  }

  // ../shell/src/hosted-game.ts
  function toUsageEvent(h) {
    return normalizeEvent({ ...h, v: 1 });
  }
  function toHostedStatus(s) {
    const line = s.lead ? s.line ? `${s.lead} · ${s.line}` : s.lead : s.line;
    const out = { count: s.count, title: s.title };
    if (line) out.line = line;
    if (s.warm) out.warm = true;
    return out;
  }
  var SHELL_KEYS = new Set(Object.keys(shellDefaults()));
  function ownSettings(s) {
    const out = {};
    for (const [k, v] of Object.entries(s)) if (!SHELL_KEYS.has(k)) out[k] = v;
    return out;
  }
  function toFeedStatus(f) {
    return { watching: !!f?.watching, files: Number.isFinite(f?.files) ? Math.max(0, Math.floor(f.files)) : 0, root: "" };
  }
  function randomSeed() {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0];
  }

  // ../shell/src/page/hosted-shell.ts
  var SLIDERS = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 3h10M1 9h10"/><circle cx="4" cy="3" r="1.4" fill="currentColor"/><circle cx="8" cy="9" r="1.4" fill="currentColor"/></svg>';
  var SHELL_KEYS2 = /* @__PURE__ */ new Set(["Escape", "1", "2", "3", "g", ",", "f", "h"]);
  var kit = settingsKit({ defaults: () => ({}), sanitize: () => ({}), reset: () => ({}) });
  function configureHosted(o) {
    kit = o.settings;
  }
  var STATE = { mini: "orb", expanded: "expanded", window: "popped" };
  function alwaysVisible() {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  }
  function mountShell(game) {
    const api = window.tokenGame;
    const body = document.body;
    body.classList.add("tg", "tgh");
    game.root.classList.add("tgh-root");
    if (!api) {
      body.append(Object.assign(document.createElement("p"), { className: "tgh-alone", textContent: `${game.name} runs inside Token Games.` }));
      return;
    }
    alwaysVisible();
    const el = (tag, cls = "", html = "") => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html) e.innerHTML = html;
      return e;
    };
    const tools = el("div", "tgh-tools");
    const gear = el("button", "tg-wbtn tgh-gear", SLIDERS);
    gear.id = "tgh-gear";
    gear.title = `${game.name} settings`;
    tools.append(gear);
    const panel = el("div", "tg-panel tgh-panel");
    panel.id = "tgh-panel";
    panel.hidden = true;
    if (game.settingsPanel) {
      game.settingsPanel.hidden = false;
      panel.append(...Array.from(game.settingsPanel.children));
    }
    const foot = el("section", "", '<div class="tg-chips"><button id="tgh-reset">Reset to defaults</button><button id="tgh-close">Close</button></div>');
    if (game.keysHelp) foot.append(el("p", "tg-note tg-keys", ""));
    const keysNote = foot.querySelector(".tg-keys");
    if (keysNote) keysNote.textContent = game.keysHelp;
    panel.append(foot);
    const news2 = el("div", "tgh-news");
    body.append(tools, panel, news2);
    let S2;
    let env = { scale: "mini", dark: false, reducedMotion: false, feed: { watching: false, files: 0 } };
    let feed = toFeedStatus(void 0);
    let started = false, statusKey = "", themeKey = "", newsT = 0;
    let lastSave2 = Promise.resolve();
    const persist = () => {
      void api.setSettings(ownSettings(S2));
    };
    const withEnv = (s) => ({ ...s, reducedMotion: env.reducedMotion });
    const showScale = () => {
      body.dataset.scale = env.scale;
      tools.hidden = env.scale === "mini";
    };
    function applySettings() {
      body.classList.toggle("tg-rm", S2.reducedMotion);
      if (started) game.onSettings?.(S2);
    }
    function set(patch) {
      S2 = withEnv(kit.applyPatch(S2, patch));
      persist();
      applySettings();
    }
    function togglePanel(open = panel.hidden) {
      if (open === !panel.hidden) return;
      panel.hidden = !open;
      gear.classList.toggle("on", open);
      game.onPanel?.(open);
    }
    function pulse(text2, kind = "hot") {
      news2.textContent = text2;
      news2.className = "tgh-news show " + kind;
      clearTimeout(newsT);
      newsT = window.setTimeout(() => {
        news2.className = "tgh-news";
      }, 2600);
    }
    function setTheme(t) {
      const key = t.back + t.bar + t.ink + t.hot;
      if (key === themeKey) return;
      themeKey = key;
      const st = document.documentElement.style;
      st.setProperty("--g-back", t.back);
      st.setProperty("--g-bar", t.bar);
      st.setProperty("--g-ink", t.ink);
      st.setProperty("--g-dim", t.dim);
      st.setProperty("--g-hot", t.hot);
      st.setProperty("--g-task", t.task || t.hot);
      st.setProperty("--g-line", t.line);
      let panelBg = t.panel;
      if (!panelBg && /^#[0-9a-f]{6}$/i.test(t.back)) {
        const n = parseInt(t.back.slice(1), 16);
        panelBg = `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},0.94)`;
      }
      if (panelBg) st.setProperty("--g-panel", panelBg);
      st.background = t.back;
    }
    const ctx = {
      get settings() {
        return S2;
      },
      get scale() {
        return env.scale;
      },
      get state() {
        return STATE[env.scale];
      },
      topInset: 0,
      // the app's title bar sits above the game's view, never over it
      get dark() {
        return env.dark;
      },
      smoke: false,
      // a catalog game is never told it is being tested
      get feed() {
        return feed;
      },
      get panelOpen() {
        return !panel.hidden;
      },
      fullscreen: false,
      // the app's window is full screen or not; the game's view only grows with it
      set,
      reset: async () => {
        S2 = withEnv(kit.reset(S2));
        persist();
        applySettings();
        return S2;
      },
      setStatus: (s) => {
        const st = toHostedStatus(s), key = JSON.stringify(st);
        if (key !== statusKey) {
          statusKey = key;
          api.setStatus(st);
        }
      },
      pulse,
      setTheme,
      setCalm: (c) => {
        if (body.classList.contains("tg-calm") !== c) body.classList.toggle("tg-calm", c);
      },
      openPanel: (open) => togglePanel(open),
      save: (d) => api.save(d),
      // The bridge only saves asynchronously; onHide below waits for this save before the shell closes the game.
      saveNow: (d) => {
        lastSave2 = api.save(d).catch(() => void 0);
        return true;
      },
      load: () => api.load(),
      hide: () => api.dock(),
      // the app hides itself; the nearest a game can ask for is the corner
      quit: () => {
      }
    };
    gear.onclick = () => togglePanel();
    foot.querySelector("#tgh-close").onclick = () => togglePanel(false);
    foot.querySelector("#tgh-reset").onclick = () => {
      void ctx.reset();
    };
    window.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !started) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === "Escape" && !panel.hidden) {
        togglePanel(false);
        return;
      }
      if (SHELL_KEYS2.has(k)) return;
      const tgt = e.target;
      if (tgt.tagName === "INPUT" && tgt.type === "range" && k.startsWith("Arrow")) return;
      if (game.onKey && game.onKey(k, e)) e.preventDefault();
    });
    void (async () => {
      env = await api.env();
      feed = toFeedStatus(env.feed);
      const raw = await api.getSettings();
      S2 = withEnv(kit.sanitize(raw, kit.defaults(randomSeed())));
      if (!raw || !Object.keys(raw).length) persist();
      body.classList.toggle("tg-dark", env.dark);
      body.classList.toggle("tg-rm", S2.reducedMotion);
      showScale();
      api.onUsage((h) => {
        const ev = toUsageEvent(h);
        if (ev && started) game.onEvent(ev);
      });
      api.onEnv((next) => {
        const prev = env;
        env = next;
        if (next.scale !== prev.scale) {
          showScale();
          if (next.scale === "mini") togglePanel(false);
          game.onScale?.(next.scale);
        }
        if (next.dark !== prev.dark) {
          body.classList.toggle("tg-dark", next.dark);
          game.onDark?.(next.dark);
        }
        if (next.reducedMotion !== S2.reducedMotion) {
          S2 = withEnv(S2);
          applySettings();
        }
        const f = toFeedStatus(next.feed);
        if (f.watching !== feed.watching || f.files !== feed.files) {
          feed = f;
          game.onFeed?.(f);
        }
      });
      if (typeof api.onHide === "function") api.onHide(async () => {
        game.onHide?.();
        await lastSave2;
      });
      window.addEventListener("pagehide", () => game.onHide?.());
      await game.start(ctx);
      started = true;
      game.onScale?.(env.scale);
    })();
  }

  // src/shared/settings.ts
  var THEMES = ["dark", "light", "system"];
  var fresh = () => ({ theme: "dark", numbers: true });
  var gameSettings = {
    defaults: fresh,
    sanitize: (raw, base) => ({ theme: oneOf(THEMES, raw.theme, base.theme), numbers: bool(raw.numbers, base.numbers) }),
    reset: fresh
  };
  var kit2 = settingsKit(gameSettings);

  // src/web/configure.ts
  configureHosted({ settings: kit2 });

  // src/sim/num.ts
  var LIMIT = 1e300;
  function fin(x) {
    if (Number.isNaN(x) || x < 0) return 0;
    return x > LIMIT ? LIMIT : x;
  }
  function powSafe(a, b) {
    return fin(Math.exp(Math.min(690, b * Math.log(a))));
  }
  var NAMED = ["", "K", "M", "B", "T"];
  function suffix(k) {
    if (k < NAMED.length) return NAMED[k];
    const i = k - NAMED.length, a = Math.floor(i / 26), b = i % 26;
    return a < 26 ? String.fromCharCode(97 + a, 97 + b) : "e" + k * 3;
  }
  function fmt(n) {
    if (!Number.isFinite(n)) return n > 0 ? "∞" : "0";
    const neg = n < 0;
    n = Math.abs(n);
    let s;
    if (n < 10 && n % 1 !== 0 && n > 0) s = n.toFixed(1).replace(/\.0$/, "");
    else if (n < 1e3) s = String(Math.round(n) === 1e3 ? 999 : Math.round(n));
    else {
      let k = Math.floor(Math.log10(n) / 3), m = n / Math.pow(10, k * 3);
      if (m >= 999.5) {
        k++;
        m /= 1e3;
      }
      s = (m < 10 ? m.toFixed(2) : m < 100 ? m.toFixed(1) : m.toFixed(0)) + suffix(k);
    }
    return neg ? "-" + s : s;
  }

  // src/sim/enemies.ts
  var ENEMY_IDS = ["scribble", "dash", "blot", "plane", "gnat", "ditto", "eraser", "boss", "editor"];
  var ENEMIES = {
    scribble: { id: "scribble", name: "Scribble", hp: 1, speed: 38, gold: 1, r: 11, from: 1, weight: 10, lives: 1 },
    dash: { id: "dash", name: "Dash", hp: 0.55, speed: 70, gold: 0.8, r: 9, from: 3, weight: 6, lives: 1 },
    blot: { id: "blot", name: "Blot", hp: 2.2, speed: 28, gold: 1.8, r: 14, from: 6, weight: 5, armor: 0.5, lives: 2 },
    plane: { id: "plane", name: "Paper plane", hp: 0.8, speed: 52, gold: 1.1, r: 11, from: 9, weight: 4, flies: true, lives: 1 },
    gnat: { id: "gnat", name: "Gnat", hp: 0.3, speed: 58, gold: 0.35, r: 7, from: 12, weight: 4, lives: 1 },
    ditto: { id: "ditto", name: "Ditto", hp: 1.6, speed: 34, gold: 1.2, r: 13, from: 15, weight: 3, splits: 2, lives: 1 },
    eraser: { id: "eraser", name: "Eraser", hp: 1.4, speed: 32, gold: 1.5, r: 12, from: 20, weight: 2, heals: 0.03, lives: 1 },
    boss: { id: "boss", name: "Big Scribble", hp: 16, speed: 24, gold: 12, r: 20, from: 10, weight: 0, armor: 0.2, lives: 5 },
    editor: { id: "editor", name: "The Editor", hp: 70, speed: 20, gold: 50, r: 26, from: 50, weight: 0, armor: 0.35, heals: 0.01, lives: 10 }
  };
  var SOFT = 2e3;
  var PER_WAVE = Math.log10(1.03);
  function waveLog(w) {
    w = Math.max(1, w);
    const lin = Math.log10(1 + 0.1 * (w - 1));
    if (w <= SOFT) return lin + PER_WAVE * (w - 1);
    const at = PER_WAVE * (SOFT - 1);
    return lin + at + at * Math.log((w - 1) / (SOFT - 1));
  }
  var BASE_HP = 18;
  var BASE_GOLD = 3;
  var waveHp = (w) => fin(BASE_HP * Math.pow(10, Math.min(299, waveLog(w))));
  var waveGold = (w) => fin(BASE_GOLD * Math.pow(10, Math.min(299, 0.97 * waveLog(w))));
  var speedMult = (w) => 1 + 0.14 * Math.log(1 + Math.max(0, w - 1) / 15);
  var waveCost = (w) => fin(1500 + 600 * (Math.max(1, w) - 1));
  var weigh = (u) => fin((u.input || 0) + (u.output || 0) + (u.cache_write || 0) + (u.cache_read || 0) / 10);
  var turnGold = (w) => Math.ceil(waveGold(w) * 6);
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rollWave(n, seed) {
    const r = rng(seed * 7919 + n * 104729);
    const count2 = Math.min(34, 6 + Math.floor(n * 0.55));
    const pool = ENEMY_IDS.filter((id) => ENEMIES[id].weight > 0 && ENEMIES[id].from <= n);
    const total = pool.reduce((s, id) => s + ENEMIES[id].weight, 0);
    const list = [];
    const fresh2 = pool.find((id) => ENEMIES[id].from === n);
    if (fresh2) list.push(fresh2, fresh2);
    while (list.length < count2) {
      let x = r() * total, pick = pool[0];
      for (const id of pool) {
        x -= ENEMIES[id].weight;
        if (x < 0) {
          pick = id;
          break;
        }
      }
      if (pick === "gnat") for (let i = 0; i < 4 && list.length < count2; i++) list.push("gnat");
      else list.push(pick);
    }
    const boss = n % 10 === 0;
    if (boss) list.push(n % 50 === 0 ? "editor" : "boss");
    if (n % 50 === 0 && n >= 100) list.push("boss", "boss");
    return { n, list, gap: Math.max(0.35, 1 - n * 6e-3), boss };
  }

  // src/sim/map.ts
  var W = 960;
  var H = 528;
  var CELL = 24;
  var COLS = W / CELL;
  var ROWS = H / CELL;
  var ROAD = 23;
  var U = 54;
  var OX = 24;
  var OY = 26;
  var CTRL = [[-0.5, 2], [3, 1.5], [5.5, 3.5], [4, 6.5], [7, 8.5], [10, 6.5], [9.5, 3], [12.5, 1.8], [15, 4], [13.8, 7.5], [16.5, 8.6]];
  function spline(pts, step) {
    const out = [], P2 = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = P2(i - 1), p1 = P2(i), p2 = P2(i + 1), p3 = P2(i + 2);
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  var ROAD_PTS = spline(CTRL.map(([x, y]) => [OX + x * U, OY + y * U]), 0.25 * U);
  var CASTLE = [OX + 15.9 * U, OY + 8.9 * U];
  var BUCKET = [96, 516];
  var CUM = [0];
  for (let i = 1; i < ROAD_PTS.length; i++) CUM.push(CUM[i - 1] + Math.hypot(ROAD_PTS[i][0] - ROAD_PTS[i - 1][0], ROAD_PTS[i][1] - ROAD_PTS[i - 1][1]));
  var ROAD_LEN = CUM[CUM.length - 1];
  function along(d, out) {
    if (d <= 0) {
      out.x = ROAD_PTS[0][0];
      out.y = ROAD_PTS[0][1];
      return;
    }
    if (d >= ROAD_LEN) {
      const p = ROAD_PTS[ROAD_PTS.length - 1];
      out.x = p[0];
      out.y = p[1];
      return;
    }
    let lo = 0, hi = CUM.length - 1;
    while (hi - lo > 1) {
      const m = lo + hi >> 1;
      if (CUM[m] <= d) lo = m;
      else hi = m;
    }
    const t = (d - CUM[lo]) / (CUM[hi] - CUM[lo] || 1), a = ROAD_PTS[lo], b = ROAD_PTS[hi];
    out.x = a[0] + (b[0] - a[0]) * t;
    out.y = a[1] + (b[1] - a[1]) * t;
  }
  function segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
    return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
  }
  function distToRoad(x, y) {
    let best = Infinity;
    for (let i = 1; i < ROAD_PTS.length; i++) best = Math.min(best, segDist(x, y, ROAD_PTS[i - 1], ROAD_PTS[i]));
    return best;
  }
  var CELLS = (() => {
    const g2 = new Uint8Array(COLS * ROWS);
    const keep = [[0, 17, 5, 5], [35, 16, 5, 6]];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x0 = c * CELL, y0 = r * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      let near = Infinity;
      for (const [px, py] of ROAD_PTS) near = Math.min(near, Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1)));
      for (const [qx, qy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) near = Math.min(near, distToRoad(qx, qy));
      g2[r * COLS + c] = near < ROAD ? 1 : 0;
      for (const [kc, kr, kw, kh] of keep) if (c >= kc && c < kc + kw && r >= kr && r < kr + kh) g2[r * COLS + c] = 2;
    }
    return g2;
  })();

  // src/sim/towers.ts
  var TOWER_IDS = ["quill", "bomb", "frost", "ruler", "spark", "thorn", "glass", "flag", "well", "tack", "candle", "crane"];
  var AIMS = ["first", "strong", "near", "last"];
  var TOWERS = {
    quill: { id: "quill", name: "Quill", role: "Fast darts at one target", flavor: "+1 dart every 10 levels", size: 2, cost: 50, unlock: 1, dmg: 6, rate: 2.6, range: 120 },
    bomb: { id: "bomb", name: "Ink Bomb", role: "Lobbed blots that splash a crowd", flavor: "A wider splash every level", size: 3, cost: 90, unlock: 1, dmg: 16, rate: 0.6, range: 130 },
    frost: { id: "frost", name: "Snowflake", role: "A chill pulse that slows everyone near", flavor: "Colder and longer every 10 levels", size: 2, cost: 70, unlock: 3, dmg: 3, rate: 0.8, range: 95 },
    ruler: { id: "ruler", name: "Ruler", role: "A straight line that pierces every foe on it", flavor: "A wider line every 10 levels", size: 2, cost: 120, unlock: 5, dmg: 20, rate: 0.55, range: 170 },
    spark: { id: "spark", name: "Spark Jar", role: "Lightning that jumps between foes", flavor: "+1 jump every 5 levels", size: 2, cost: 150, unlock: 8, dmg: 12, rate: 0.9, range: 120 },
    thorn: { id: "thorn", name: "Thornbush", role: "Poison that keeps hurting, and stacks", flavor: "+1 stack every 10 levels", size: 2, cost: 130, unlock: 11, dmg: 7, rate: 1.1, range: 110 },
    glass: { id: "glass", name: "Spyglass", role: "A slow, huge shot across the page; armour no help", flavor: "More critical hits every 10 levels", size: 2, cost: 220, unlock: 14, dmg: 95, rate: 0.33, range: 360 },
    flag: { id: "flag", name: "Banner", role: "Cheers on towers nearby: more damage and speed", flavor: "A bigger cheer every level", size: 2, cost: 200, unlock: 18, dmg: 0, rate: 0, range: 115 },
    well: { id: "well", name: "Inkwell", role: "Gold after every wave, more for kills nearby", flavor: "Richer every level", size: 3, cost: 250, unlock: 22, dmg: 0, rate: 0, range: 120 },
    tack: { id: "tack", name: "Thumbtack", role: "A trap on the road: stabs and slows walkers", flavor: "Stabs twice every 10 levels", size: 2, cost: 100, unlock: 26, dmg: 30, rate: 0, range: 26, onRoad: true },
    candle: { id: "candle", name: "Candle", role: "A short flame cone that burns everything in it", flavor: "A wider flame every 10 levels", size: 2, cost: 260, unlock: 30, dmg: 5, rate: 6, range: 85 },
    crane: { id: "crane", name: "Paper Crane", role: "Folds cranes that fly out and peck", flavor: "+1 crane every 10 levels", size: 3, cost: 400, unlock: 35, dmg: 14, rate: 1.2, range: 150 }
  };
  var unlockedAt = (wave) => TOWER_IDS.filter((id) => TOWERS[id].unlock <= wave);
  var nextUnlock = (wave) => TOWER_IDS.map((id) => TOWERS[id]).find((t) => t.unlock > wave) ?? null;
  var COST_GROWTH = 1.18;
  function upgradeCost(id, level) {
    return Math.ceil(fin(TOWERS[id].cost * 0.8 * powSafe(COST_GROWTH, level - 1)));
  }
  function spent(id, level) {
    const base = TOWERS[id].cost * 0.8;
    return fin(TOWERS[id].cost + base * (powSafe(COST_GROWTH, level - 1) - 1) / (COST_GROWTH - 1));
  }
  var SELL_BACK = 0.7;
  var sellValue = (id, level) => Math.floor(spent(id, level) * SELL_BACK);
  function affordable(id, level, gold, most = Infinity) {
    let n = 0, cost = 0;
    while (n < most && n < 1e5) {
      const c = upgradeCost(id, level + n);
      if (cost + c > gold) break;
      cost += c;
      n++;
    }
    return { levels: n, cost };
  }
  var log1 = (x) => Math.log(1 + x);
  function stats(id, level) {
    const d = TOWERS[id], L = Math.max(1, level), m = Math.floor(L / 10);
    const dmg = fin(d.dmg * powSafe(1.12, L - 1) * powSafe(2, m));
    const rate = d.rate * (1 + 0.22 * log1((L - 1) / 3));
    const range = d.range * (1 + 0.13 * log1((L - 1) / 4));
    const s = { dmg, rate, range, multi: 1, area: 0, time: 0, crit: 0, aura: 0 };
    switch (id) {
      case "quill":
        s.multi = 1 + m;
        break;
      case "bomb":
        s.area = 42 * (1 + 0.25 * log1((L - 1) / 2));
        break;
      // slowing approaches 75% and never reaches it: a frozen walker would stall a wave forever
      case "frost":
        s.area = 0.75 - 0.45 * Math.pow(0.85, m + (L - 1) / 10);
        s.time = 1.4 + 0.4 * log1(L - 1) + 0.25 * m;
        break;
      case "ruler":
        s.area = 12 * (1 + 0.3 * m / (1 + m * 0.05));
        break;
      case "spark":
        s.multi = 3 + Math.floor(L / 5);
        break;
      case "thorn":
        s.multi = 3 + m;
        s.time = 4 + 0.5 * log1(L - 1);
        break;
      case "glass":
        s.crit = 1 - 1 / (1 + 0.08 * m + 4e-3 * (L - 1));
        break;
      case "flag":
        s.aura = 0.18 + 0.12 * log1(L - 1) + 0.1 * m;
        break;
      case "well":
        s.aura = fin(powSafe(1.1, L - 1) * powSafe(1.5, m));
        break;
      case "tack":
        s.multi = 1 + m;
        s.area = 0.3;
        s.time = 0.6;
        break;
      case "candle":
        s.area = 0.45 * (1 + 0.15 * log1(m));
        s.time = 1.5 + 0.2 * m;
        break;
      case "crane":
        s.multi = 2 + m;
        break;
    }
    return s;
  }
  function dps(id, s) {
    switch (id) {
      case "thorn":
        return fin(s.dmg * s.multi);
      case "flag":
      case "well":
        return 0;
      case "glass":
        return fin(s.dmg * s.rate * (1 + 2 * s.crit));
      case "quill":
      case "crane":
        return fin(s.dmg * s.rate * s.multi);
      case "tack":
        return fin(s.dmg * s.multi);
      default:
        return fin(s.dmg * s.rate);
    }
  }
  var ROMAN = (n) => {
    if (n >= 40) return String(n);
    const r = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let s = "";
    for (const [v, t] of r) while (n >= v) {
      s += t;
      n -= v;
    }
    return s;
  };

  // src/sim/placement.ts
  var Grid = class {
    // the id of the tower on each cell, or 0
    occ = new Int32Array(COLS * ROWS);
    fill(cx, cy, size, id) {
      for (let r = cy; r < cy + size; r++) for (let c = cx; c < cx + size; c++) this.occ[r * COLS + c] = id;
    }
    clear() {
      this.occ.fill(0);
    }
    // Why a tower of kind `type` can't stand with its top-left cell at (cx, cy), or '' when it can.
    // `ignore` is a tower being moved: its own cells count as free.
    why(type, cx, cy, ignore = 0) {
      const size = TOWERS[type].size;
      if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx + size > COLS || cy + size > ROWS) return "off the page";
      const onRoad = !!TOWERS[type].onRoad;
      if (onRoad) {
        const mid = (cx + size / 2) * CELL, mid2 = (cy + size / 2) * CELL;
        if (distToRoad(mid, mid2) > ROAD * 0.55) return "tacks go on the road";
      }
      for (let r = cy; r < cy + size; r++) for (let c = cx; c < cx + size; c++) {
        const i = r * COLS + c, o = this.occ[i];
        if (o && o !== ignore) return "something is there";
        if (CELLS[i] === 2) return "keep this spot clear";
        if (CELLS[i] === 1 && !onRoad) return "that is the road";
      }
      return "";
    }
    ok(type, cx, cy, ignore = 0) {
      return this.why(type, cx, cy, ignore) === "";
    }
  };
  function snap(type, x, y) {
    const s = TOWERS[type].size;
    return [Math.round(x / CELL - s / 2), Math.round(y / CELL - s / 2)];
  }
  function nearest(grid, type, cx, cy, reach = 2, ignore = 0) {
    if (grid.ok(type, cx, cy, ignore)) return [cx, cy];
    let best = null, bd = Infinity;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const d = dx * dx + dy * dy;
      if (d < bd && grid.ok(type, cx + dx, cy + dy, ignore)) {
        bd = d;
        best = [cx + dx, cy + dy];
      }
    }
    return best;
  }

  // src/sim/game.ts
  var STEP = 1 / 30;
  var START_GOLD = 160;
  var START_LIVES = 20;
  var SETBACK = 5;
  var TDGame = class _TDGame {
    seed;
    wave = 0;
    // the last wave sent
    ink = 0;
    // tokens in the bucket
    gold = START_GOLD;
    lives = START_LIVES;
    auto = true;
    speed = 1;
    paused = false;
    tips = 0;
    // how far the first-time hints have got
    numbers = true;
    // make damage-number effects
    time = 0;
    stats = { tokens: 0, turns: 0, kills: 0, leaks: 0, tears: 0, best: 0, spent: 0 };
    grid = new Grid();
    towers = [];
    enemies = [];
    // pooled: dead ones are reused
    shots = [];
    fx = [];
    fxNext = 0;
    spawners = [];
    left = /* @__PURE__ */ new Map();
    // walkers still to come or alive, per wave
    uid = 1;
    nextId = 1;
    sinceSend = 0;
    tmp = { x: 0, y: 0 };
    // what happened since the page last looked: for pulses and sounds
    events = [];
    constructor(seed = 1) {
      this.seed = seed >>> 0;
      for (let i = 0; i < 360; i++) this.fx.push({ kind: "splat", x: 0, y: 0, x2: 0, y2: 0, t: 1, life: 0, size: 0, value: 0, seed: 0, n: 0, pts: new Float32Array(32) });
    }
    // ---- usage: the only thing that moves the game forward --------------------------------------------------------
    // Tokens fill the bucket; a finished turn pays gold. Returns what it paid (tokens weighed, gold).
    feed(ev) {
      if (ev.type === "tokens") {
        const t = weigh(ev);
        this.ink = fin(this.ink + t);
        this.stats.tokens = fin(this.stats.tokens + t);
        return { tokens: t, gold: 0 };
      }
      if (ev.type === "task_done") {
        const g2 = turnGold(Math.max(1, this.wave));
        this.gold = fin(this.gold + g2);
        this.stats.turns++;
        this.events.push({ kind: "turn", value: g2 });
        return { tokens: 0, gold: g2 };
      }
      return { tokens: 0, gold: 0 };
    }
    nextCost() {
      return waveCost(this.wave + 1);
    }
    ready() {
      return this.ink >= this.nextCost();
    }
    // how many waves the bucket holds right now
    queued() {
      let n = 0, ink = this.ink;
      while (n < 99 && ink >= waveCost(this.wave + 1 + n)) {
        ink -= waveCost(this.wave + 1 + n);
        n++;
      }
      return n;
    }
    busy() {
      return this.spawners.length > 0 || this.alive() > 0;
    }
    alive() {
      let n = 0;
      for (const e of this.enemies) if (e.alive) n++;
      return n;
    }
    // Send the next wave if the bucket holds enough ink.
    send() {
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
      this.events.push({ kind: "wave", value: this.wave });
      if (unlockedAt(this.wave).length > before) this.events.push({ kind: "unlock", value: this.wave });
      return true;
    }
    // ---- building ------------------------------------------------------------------------------------------------
    canBuild(type) {
      return TOWERS[type].unlock <= Math.max(1, this.stats.best) && this.gold >= TOWERS[type].cost;
    }
    build(type, cx, cy) {
      if (!this.canBuild(type) || !this.grid.ok(type, cx, cy)) return null;
      this.gold = fin(this.gold - TOWERS[type].cost);
      this.stats.spent = fin(this.stats.spent + TOWERS[type].cost);
      const t = this.place(type, 1, cx, cy, type === "glass" ? "strong" : "first", 0);
      if (this.tips < 1) this.tips = 1;
      return t;
    }
    place(type, level, cx, cy, aim, kills) {
      const size = TOWERS[type].size;
      const t = {
        id: this.nextId++,
        type,
        level,
        cx,
        cy,
        aim,
        kills,
        x: (cx + size / 2) * CELL,
        y: (cy + size / 2) * CELL,
        st: stats(type, level),
        cheer: 0,
        cd: 0.3,
        heading: -0.6,
        recoil: 0,
        firing: 0,
        cranes: []
      };
      this.grid.fill(cx, cy, size, t.id);
      this.towers.push(t);
      this.recheer();
      return t;
    }
    // Upgrade by up to `n` levels (Infinity: as many as the gold buys). Returns the levels bought.
    upgrade(t, n = 1) {
      const a = affordable(t.type, t.level, this.gold, n);
      if (!a.levels) return 0;
      this.gold = fin(this.gold - a.cost);
      this.stats.spent = fin(this.stats.spent + a.cost);
      t.level += a.levels;
      t.st = stats(t.type, t.level);
      if (t.type === "flag") this.recheer();
      return a.levels;
    }
    upgradeCost(t) {
      return upgradeCost(t.type, t.level);
    }
    sell(t) {
      const i = this.towers.indexOf(t);
      if (i < 0) return 0;
      const g2 = sellValue(t.type, t.level);
      this.towers.splice(i, 1);
      this.grid.fill(t.cx, t.cy, TOWERS[t.type].size, 0);
      this.gold = fin(this.gold + g2);
      for (const s of this.shots) if (s.from === t) s.from = null;
      this.recheer();
      return g2;
    }
    move(t, cx, cy) {
      if (!this.grid.ok(t.type, cx, cy, t.id)) return false;
      const size = TOWERS[t.type].size;
      this.grid.fill(t.cx, t.cy, size, 0);
      t.cx = cx;
      t.cy = cy;
      t.x = (cx + size / 2) * CELL;
      t.y = (cy + size / 2) * CELL;
      this.grid.fill(cx, cy, size, t.id);
      for (const c of t.cranes) {
        c.x = c.px = t.x;
        c.y = c.py = t.y;
      }
      this.recheer();
      return true;
    }
    setAim(t, aim) {
      t.aim = aim ?? AIMS[(AIMS.indexOf(t.aim) + 1) % AIMS.length];
    }
    towerAt(x, y) {
      const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
      const id = c >= 0 && r >= 0 && c < COLS && r < ROWS ? this.grid.occ[r * COLS + c] : 0;
      return id ? this.towers.find((t) => t.id === id) ?? null : null;
    }
    // The Banners' cheer on every tower, summed: refreshed whenever a tower comes, goes, moves or a Banner levels.
    recheer() {
      for (const t of this.towers) t.cheer = 0;
      for (const f of this.towers) if (f.type === "flag") for (const t of this.towers) {
        if (t !== f && t.type !== "flag" && Math.hypot(t.x - f.x, t.y - f.y) <= f.st.range) t.cheer += f.st.aura;
      }
    }
    // ---- the simulation ------------------------------------------------------------------------------------------
    step() {
      if (this.paused) return;
      const dt = STEP;
      this.time += dt;
      this.sinceSend += dt;
      for (const s of this.spawners) {
        s.t -= dt;
        while (s.t <= 0 && s.i < s.list.length) {
          this.spawn(s.list[s.i++], s.wave, 0, null);
          s.t += s.gap;
        }
      }
      if (this.spawners.length) this.spawners = this.spawners.filter((s) => s.i < s.list.length);
      this.walk(dt);
      for (const t of this.towers) this.act(t, dt);
      this.fly(dt);
      for (const f of this.fx) if (f.t < f.life) f.t += dt;
      if (this.auto && this.ready() && !this.spawners.length && (this.alive() === 0 || this.sinceSend > 30)) this.send();
    }
    spawn(type, wave, d, parent) {
      let e = this.enemies.find((x) => !x.alive);
      if (!e) {
        e = { uid: 0, alive: false, type, wave, d: 0, x: 0, y: 0, px: 0, py: 0, dir: 1, hp: 0, max: 0, speed: 0, gold: 0, slow: 0, slowT: 0, poison: 0, stacks: 0, poisonT: 0, burn: 0, burnT: 0, flash: 0, numAcc: 0, numT: 0, tackT: 0, wellBonus: 0 };
        this.enemies.push(e);
      }
      const def = ENEMIES[type], jitter = 0.95 + this.uid * 2654435761 % 1e3 / 1e4;
      e.uid = this.uid++;
      e.alive = true;
      e.type = type;
      e.wave = wave;
      e.d = d;
      e.max = e.hp = fin(def.hp * waveHp(wave) * (parent ? 0.35 : 1));
      e.speed = def.speed * speedMult(wave) * jitter;
      e.gold = fin(def.gold * waveGold(wave) * (parent ? 0.3 : 1));
      e.slow = e.slowT = e.poison = e.stacks = e.poisonT = e.burn = e.burnT = e.flash = e.numAcc = e.numT = e.tackT = e.wellBonus = 0;
      along(d, this.tmp);
      e.x = e.px = this.tmp.x;
      e.y = e.py = this.tmp.y;
      e.dir = 1;
      return e;
    }
    walk(dt) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        e.px = e.x;
        e.py = e.y;
        if (e.slowT > 0) {
          e.slowT -= dt;
          if (e.slowT <= 0) e.slow = 0;
        }
        if (e.flash > 0) e.flash -= dt;
        if (e.tackT > 0) e.tackT -= dt;
        if (e.poisonT > 0) {
          e.poisonT -= dt;
          this.hurt(e, e.poison * e.stacks * dt, null, true);
          if (e.poisonT <= 0) {
            e.stacks = 0;
            e.poison = 0;
          }
        }
        if (e.burnT > 0) {
          e.burnT -= dt;
          this.hurt(e, e.burn * dt, null, true);
        }
        if (!e.alive) continue;
        const heal = ENEMIES[e.type].heals;
        if (heal) {
          for (const o of this.enemies) if (o.alive && o !== e && Math.abs(o.d - e.d) < 60) o.hp = Math.min(o.max, o.hp + o.max * heal * dt);
        }
        e.d += e.speed * (1 - e.slow) * dt;
        if (e.numT > 0) e.numT -= dt;
        if (e.numAcc > 0 && e.numT <= 0) {
          this.num(e, e.numAcc, false);
          e.numAcc = 0;
          e.numT = 0.35;
        }
        if (e.d >= ROAD_LEN) {
          this.leak(e);
          continue;
        }
        along(e.d, this.tmp);
        if (Math.abs(this.tmp.x - e.x) > 0.05) e.dir = this.tmp.x < e.x ? -1 : 1;
        e.x = this.tmp.x;
        e.y = this.tmp.y;
      }
    }
    leak(e) {
      e.alive = false;
      this.lives -= ENEMIES[e.type].lives;
      this.stats.leaks++;
      this.done(e.wave);
      this.events.push({ kind: "leak", value: ENEMIES[e.type].lives });
      if (this.lives <= 0) this.tear();
    }
    // Out of lives: the page tears. The field clears, the bucket keeps its ink, and you go back a few waves.
    tear() {
      let low = this.wave;
      for (const e of this.enemies) if (e.alive) {
        low = Math.min(low, e.wave);
        e.alive = false;
      }
      for (const s of this.spawners) low = Math.min(low, s.wave);
      this.spawners = [];
      this.left.clear();
      for (const s of this.shots) s.alive = false;
      this.wave = Math.max(0, low - 1 - SETBACK);
      this.lives = START_LIVES;
      this.stats.tears++;
      this.addFx("tear", 480, 264, 0, 0, 1.6, 0, 0);
      this.events.push({ kind: "tear", value: this.wave + 1 });
    }
    done(wave) {
      const n = (this.left.get(wave) ?? 1) - 1;
      if (n > 0) {
        this.left.set(wave, n);
        return;
      }
      this.left.delete(wave);
      let g2 = waveGold(wave) * 2;
      for (const t of this.towers) if (t.type === "well") {
        g2 += waveGold(wave) * 6 * t.st.aura;
        this.addFx("coin", t.x, t.y - 20, 0, 0, 1.2, waveGold(wave) * 6 * t.st.aura, t.id);
      }
      this.gold = fin(this.gold + g2);
      this.events.push({ kind: "clear", value: wave });
      if (this.tips < 3 && this.tips >= 2) this.tips = 3;
    }
    // Damage `e` by `amount` (armour applies unless `pierce`).
    hurt(e, amount, from, pierce = false) {
      if (!e.alive || !(amount > 0)) return;
      const armor = pierce ? 0 : ENEMIES[e.type].armor ?? 0;
      const dmg = fin(amount * (1 - armor));
      e.hp -= dmg;
      if (dmg > e.max * 2e-3) e.flash = 0.12;
      e.numAcc = Math.min(LIMIT, e.numAcc + dmg);
      if (from) from.recoil = 1;
      if (e.hp <= 0) this.kill(e, from);
    }
    kill(e, from) {
      e.alive = false;
      e.hp = 0;
      if (e.numAcc > 0) {
        this.num(e, e.numAcc, false);
        e.numAcc = 0;
      }
      let bonus = 0;
      for (const t of this.towers) if (t.type === "well" && Math.hypot(t.x - e.x, t.y - e.y) <= t.st.range) bonus += 0.1 + 0.02 * Math.log(1 + t.level);
      this.gold = fin(this.gold + e.gold * (1 + bonus));
      this.stats.kills++;
      if (from) from.kills++;
      this.addFx("splat", e.x, e.y, 0, 0, 0.5, ENEMIES[e.type].r, e.uid);
      const splits = ENEMIES[e.type].splits;
      if (splits) for (let i = 0; i < splits; i++) {
        const c = this.spawn("scribble", e.wave, Math.max(0, e.d - 8 - i * 10), e);
        c.flash = 0.2;
        this.left.set(e.wave, (this.left.get(e.wave) ?? 0) + 1);
      }
      this.done(e.wave);
    }
    num(e, v, crit) {
      if (this.numbers) this.addFx(crit ? "crit" : "num", e.x, e.y - ENEMIES[e.type].r * 2, 0, 0, crit ? 1.1 : 0.8, v, e.uid);
    }
    addFx(kind, x, y, x2, y2, life, value, seed) {
      const f = this.fx[this.fxNext];
      this.fxNext = (this.fxNext + 1) % this.fx.length;
      f.kind = kind;
      f.x = x;
      f.y = y;
      f.x2 = x2;
      f.y2 = y2;
      f.t = 0;
      f.life = life;
      f.value = value;
      f.size = value;
      f.seed = seed;
      f.n = 0;
      return f;
    }
    // ---- towers --------------------------------------------------------------------------------------------------
    // The walker `t` should shoot at, by its aim; skips fliers when `ground`, and `skip` (already hit).
    pick(t, range, ground = false, skip) {
      let best = null, score = -Infinity;
      for (const e of this.enemies) {
        if (!e.alive || ground && ENEMIES[e.type].flies || skip && skip.includes(e)) continue;
        const dx = e.x - t.x, dy = e.y - t.y, d2 = dx * dx + dy * dy, r = range + ENEMIES[e.type].r;
        if (d2 > r * r) continue;
        const s = t.aim === "first" ? e.d : t.aim === "last" ? -e.d : t.aim === "strong" ? e.hp : -d2;
        if (s > score) {
          score = s;
          best = e;
        }
      }
      return best;
    }
    act(t, dt) {
      if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 4);
      if (t.firing > 0) t.firing -= dt;
      const st = t.st, boost = 1 + t.cheer, dmg = fin(st.dmg * boost), rate = st.rate * (1 + t.cheer * 0.5);
      if (t.type === "flag" || t.type === "well") return;
      if (t.type === "crane") {
        this.cranes(t, dt, dmg, rate);
        return;
      }
      if (t.type === "tack") {
        this.tack(t, dmg);
        return;
      }
      t.cd -= dt;
      if (t.cd > 0) return;
      const e = this.pick(t, st.range);
      if (!e) {
        t.cd = 0;
        return;
      }
      t.heading = Math.atan2(e.y - t.y, e.x - t.x);
      t.cd += 1 / rate;
      if (t.cd < 0) t.cd = 0;
      switch (t.type) {
        case "quill": {
          const hit = [e];
          for (let i = 1; i < st.multi; i++) {
            const o = this.pick(t, st.range, false, hit);
            if (!o) break;
            hit.push(o);
          }
          for (let i = 0; i < st.multi; i++) this.shoot("dart", t, hit[i % hit.length], dmg, 0, 560);
          t.recoil = 1;
          break;
        }
        case "bomb":
          this.shoot("blot", t, e, dmg, st.area, 0);
          t.recoil = 1;
          break;
        case "thorn":
          this.shoot("seed", t, e, dmg, st.time, 320);
          break;
        case "frost": {
          for (const o of this.enemies) if (o.alive && Math.hypot(o.x - t.x, o.y - t.y) <= st.range + ENEMIES[o.type].r) {
            this.hurt(o, dmg, t);
            if (st.area >= o.slow) {
              o.slow = st.area;
              o.slowT = st.time;
            } else o.slowT = Math.max(o.slowT, st.time);
          }
          this.addFx("chill", t.x, t.y, 0, 0, 0.6, st.range, t.id);
          break;
        }
        case "ruler": {
          const len = st.range, ux = Math.cos(t.heading), uy = Math.sin(t.heading), ex = t.x + ux * len, ey = t.y + uy * len;
          for (const o of this.enemies) {
            if (!o.alive) continue;
            const px = o.x - t.x, py = o.y - t.y, along_ = px * ux + py * uy;
            if (along_ < 0 || along_ > len + ENEMIES[o.type].r) continue;
            if (Math.abs(px * uy - py * ux) <= st.area + ENEMIES[o.type].r) this.hurt(o, dmg, t, true);
          }
          this.addFx("beam", t.x, t.y, ex, ey, 0.35, st.area, t.id);
          t.recoil = 1;
          break;
        }
        case "spark": {
          const f = this.addFx("chain", t.x, t.y - 14, 0, 0, 0.3, 0, t.id), hit = [];
          let cur = e, k = dmg;
          while (cur && hit.length < st.multi && hit.length < 15) {
            hit.push(cur);
            f.pts[f.n * 2] = cur.x;
            f.pts[f.n * 2 + 1] = cur.y;
            f.n++;
            this.hurt(cur, k, t);
            k *= 0.85;
            let next = null, nd = 90 * 90;
            for (const o of this.enemies) {
              if (!o.alive || hit.includes(o)) continue;
              const d2 = (o.x - cur.x) ** 2 + (o.y - cur.y) ** 2;
              if (d2 < nd) {
                nd = d2;
                next = o;
              }
            }
            cur = next;
          }
          break;
        }
        case "glass": {
          const crit = st.crit > 0 && (this.time * 1e3 + t.id * 7919) % 1e3 / 1e3 < st.crit;
          const amount = crit ? dmg * 3 : dmg;
          this.addFx("trace", t.x, t.y - 16, e.x, e.y, 0.4, 0, t.id);
          if (crit && this.numbers) {
            e.numAcc = 0;
            this.hurt(e, amount, t, true);
            this.num(e, amount, true);
            e.numAcc = 0;
          } else this.hurt(e, amount, t, true);
          t.recoil = 1;
          break;
        }
        case "candle": {
          t.firing = 0.25;
          for (const o of this.enemies) {
            if (!o.alive) continue;
            const dx = o.x - t.x, dy = o.y - t.y, dist = Math.hypot(dx, dy);
            if (dist > st.range + ENEMIES[o.type].r) continue;
            let da = Math.atan2(dy, dx) - t.heading;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            if (Math.abs(da) <= st.area || dist < 14) {
              this.hurt(o, dmg, t);
              o.burn = Math.max(o.burn, dmg * 0.8);
              o.burnT = st.time;
            }
          }
          break;
        }
      }
    }
    tack(t, dmg) {
      for (const e of this.enemies) {
        if (!e.alive || e.tackT > 0 || ENEMIES[e.type].flies) continue;
        if (Math.hypot(e.x - t.x, e.y - t.y) > t.st.range + ENEMIES[e.type].r) continue;
        for (let i = 0; i < t.st.multi && e.alive; i++) this.hurt(e, dmg, t);
        if (e.alive) {
          e.slow = Math.max(e.slow, t.st.area);
          e.slowT = Math.max(e.slowT, t.st.time);
        }
        e.tackT = 0.6;
        t.recoil = 1;
        this.addFx("stab", t.x, t.y, 0, 0, 0.3, 0, t.id);
      }
    }
    cranes(t, dt, dmg, rate) {
      while (t.cranes.length < t.st.multi && t.cranes.length < 24) t.cranes.push({ x: t.x, y: t.y, px: t.x, py: t.y, target: null, tid: 0, cd: 0 });
      let i = 0;
      for (const c of t.cranes) {
        c.px = c.x;
        c.py = c.y;
        i++;
        if (c.target && (!c.target.alive || c.target.uid !== c.tid || Math.hypot(c.target.x - t.x, c.target.y - t.y) > t.st.range * 1.3)) c.target = null;
        if (!c.target) {
          const e = this.pick(t, t.st.range);
          if (e) {
            c.target = e;
            c.tid = e.uid;
          }
        }
        const a = this.time * 1.6 + i * 2.1;
        const gx = c.target ? c.target.x : t.x + Math.cos(a) * 26, gy = c.target ? c.target.y - 8 : t.y - 18 + Math.sin(a) * 10;
        const dx = gx - c.x, dy = gy - c.y, d = Math.hypot(dx, dy), v = 190 * dt;
        if (d > v) {
          c.x += dx / d * v;
          c.y += dy / d * v;
        } else {
          c.x = gx;
          c.y = gy;
        }
        c.cd -= dt;
        if (c.target && d < 14 && c.cd <= 0) {
          this.hurt(c.target, dmg, t);
          c.cd = 1 / rate;
        }
      }
    }
    shoot(kind, from, e, dmg, area, speed) {
      let s = this.shots.find((x) => !x.alive);
      if (!s) {
        s = { alive: false, kind, x: 0, y: 0, px: 0, py: 0, sx: 0, sy: 0, tx: 0, ty: 0, target: null, tid: 0, dmg: 0, area: 0, t: 0, life: 0, speed: 0, from: null };
        this.shots.push(s);
      }
      const sy = from.y - (kind === "blot" ? 18 : 14);
      s.alive = true;
      s.kind = kind;
      s.x = s.px = s.sx = from.x;
      s.y = s.py = s.sy = sy;
      s.target = e;
      s.tid = e.uid;
      s.tx = e.x;
      s.ty = e.y;
      s.dmg = dmg;
      s.area = area;
      s.t = 0;
      s.speed = speed;
      s.from = from;
      s.life = kind === "blot" ? 0.7 : 2;
      if (kind === "blot") {
        along(e.d + e.speed * (1 - e.slow) * s.life, this.tmp);
        s.tx = this.tmp.x;
        s.ty = this.tmp.y;
      }
    }
    fly(dt) {
      for (const s of this.shots) {
        if (!s.alive) continue;
        s.px = s.x;
        s.py = s.y;
        s.t += dt;
        if (s.kind === "blot") {
          const k = Math.min(1, s.t / s.life);
          s.x = s.sx + (s.tx - s.sx) * k;
          s.y = s.sy + (s.ty - s.sy) * k;
          if (k >= 1) {
            s.alive = false;
            for (const o of this.enemies) {
              if (!o.alive) continue;
              const d2 = Math.hypot(o.x - s.x, o.y - s.y);
              if (d2 <= s.area + ENEMIES[o.type].r) this.hurt(o, s.dmg * (1 - 0.5 * Math.min(1, d2 / s.area)), s.from);
            }
            this.addFx("blast", s.x, s.y, 0, 0, 0.55, s.area, Math.floor(s.x * 7));
          }
          continue;
        }
        const e = s.target && s.target.alive && s.target.uid === s.tid ? s.target : null;
        if (e) {
          s.tx = e.x;
          s.ty = e.y - ENEMIES[e.type].r * 0.6;
        }
        const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy), v = s.speed * dt;
        if (d <= v + 2 || s.t > s.life) {
          s.alive = false;
          if (!e) continue;
          if (s.kind === "seed") {
            e.stacks = Math.min(s.from ? s.from.st.multi : 3, e.stacks + 1);
            e.poison = Math.max(e.poison, s.dmg);
            e.poisonT = s.area;
          } else this.hurt(e, s.dmg, s.from);
          continue;
        }
        s.x += dx / d * v;
        s.y += dy / d * v;
      }
    }
    // ---- saving --------------------------------------------------------------------------------------------------
    save() {
      let wave = this.wave, ink = this.ink;
      const open = /* @__PURE__ */ new Set([...this.left.keys()]);
      while (wave > 0 && open.has(wave)) {
        ink += waveCost(wave);
        wave--;
      }
      return {
        v: 1,
        seed: this.seed,
        wave,
        ink: fin(ink),
        gold: this.gold,
        lives: this.lives,
        auto: this.auto,
        speed: this.speed,
        tips: this.tips,
        towers: this.towers.map((t) => ({ type: t.type, level: t.level, cx: t.cx, cy: t.cy, aim: t.aim, kills: t.kills })),
        stats: { ...this.stats }
      };
    }
    static load(raw, seed = 1) {
      const g2 = new _TDGame(seed);
      if (!raw || typeof raw !== "object" || raw.v !== 1) return g2;
      const r = raw;
      const n = (v, lo, fb) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(LIMIT, v)) : fb;
      g2.seed = n(r.seed, 0, seed) >>> 0;
      g2.wave = Math.floor(n(r.wave, 0, 0));
      g2.ink = n(r.ink, 0, 0);
      g2.gold = n(r.gold, 0, START_GOLD);
      g2.lives = Math.floor(n(r.lives, 1, START_LIVES));
      g2.auto = r.auto !== false;
      g2.speed = [1, 2, 4].includes(r.speed) ? r.speed : 1;
      g2.tips = Math.floor(n(r.tips, 0, 0));
      const s = r.stats ?? {};
      for (const k of Object.keys(g2.stats)) g2.stats[k] = n(s[k], 0, 0);
      g2.stats.best = Math.max(g2.stats.best, g2.wave);
      for (const t of Array.isArray(r.towers) ? r.towers : []) {
        if (!t || !TOWER_IDS.includes(t.type)) continue;
        const level = Math.floor(n(t.level, 1, 1));
        const at = Number.isInteger(t.cx) && Number.isInteger(t.cy) ? nearest(g2.grid, t.type, t.cx, t.cy, 0) : null;
        if (!at) {
          g2.gold = fin(g2.gold + sellValue(t.type, level));
          continue;
        }
        g2.place(t.type, level, at[0], at[1], AIMS.includes(t.aim) ? t.aim : "first", Math.floor(n(t.kills, 0, 0)));
      }
      return g2;
    }
  };

  // src/game/ink.ts
  var LIGHT = {
    paper: "#f6efdf",
    speck: "120,100,60",
    rule: "rgba(80,120,170,.18)",
    margin: "rgba(210,58,42,.35)",
    ink: "#1d1c22",
    soft: "rgba(29,28,34,.45)",
    faint: "rgba(29,28,34,.16)",
    red: "#d23a2a",
    blue: "#3a6ea5",
    chill: "#dbe9f6",
    gold: "#b8871b",
    card: "#fffdf6",
    tape: "rgba(240,220,120,.55)",
    shadow: "rgba(0,0,0,.12)",
    flame: "rgba(232,120,40,.22)"
  };
  var DARK = {
    paper: "#1c1b21",
    speck: "200,190,170",
    rule: "rgba(120,160,210,.10)",
    margin: "rgba(224,90,70,.28)",
    ink: "#ebe3d1",
    soft: "rgba(235,227,209,.45)",
    faint: "rgba(235,227,209,.14)",
    red: "#e0604a",
    blue: "#7fa8d8",
    chill: "#2a3646",
    gold: "#e2b44a",
    card: "#27262d",
    tape: "rgba(214,190,100,.35)",
    shadow: "rgba(0,0,0,.35)",
    flame: "rgba(240,140,60,.20)"
  };
  var hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  var HAND = (px) => `700 ${px}px Caveat, 'Bradley Hand', cursive`;
  var Pen = class {
    constructor(c, P2) {
      this.c = c;
      this.P = P2;
    }
    boil = 0;
    // a wobble for point `i`, the same for the whole boil
    j(i, amp) {
      return (hash(i * 12.9898 + this.boil * 78.233) - 0.5) * 2 * amp;
    }
    // Adds a slightly bent line to the current path. Callers batch many into one stroke (one beginPath, one stroke).
    l(x1, y1, x2, y2, seed) {
      const c = this.c;
      c.moveTo(x1 + this.j(seed, 1), y1 + this.j(seed + 1, 1));
      c.quadraticCurveTo((x1 + x2) / 2 + this.j(seed + 2, 2), (y1 + y2) / 2 + this.j(seed + 3, 2), x2 + this.j(seed + 4, 1), y2 + this.j(seed + 5, 1));
    }
    // one line on its own
    line(x1, y1, x2, y2, seed, w = 2.2) {
      const c = this.c;
      c.lineWidth = w;
      c.beginPath();
      this.l(x1, y1, x2, y2, seed);
      c.stroke();
    }
    // Adds a wobbly circle (a 14-point loop) to the current path.
    o(x, y, r, seed) {
      const c = this.c, amp = Math.max(0.8, r * 0.06);
      for (let k = 0; k <= 14; k++) {
        const a = k / 14 * Math.PI * 2 + 0.3, rr = r + this.j(seed + k % 14, amp);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (k) c.lineTo(px, py);
        else c.moveTo(px, py);
      }
      c.closePath();
    }
    circle(x, y, r, seed, fill, w = 2.2) {
      const c = this.c;
      c.beginPath();
      this.o(x, y, r, seed);
      if (fill) {
        c.fillStyle = fill;
        c.fill();
      }
      c.lineWidth = w;
      c.stroke();
    }
    text(s, x, y, px, color, align = "left") {
      const c = this.c;
      c.font = HAND(px);
      c.fillStyle = color;
      c.textAlign = align;
      c.fillText(s, x, y);
    }
  };

  // src/game/render.ts
  var TAU = Math.PI * 2;
  var lerp = (a, b, k) => a + (b - a) * k;
  var EDGES = [1, -1].map((sgn) => ROAD_PTS.map(([x, y], i) => {
    const [ax, ay] = ROAD_PTS[Math.max(0, i - 1)], [bx, by] = ROAD_PTS[Math.min(ROAD_PTS.length - 1, i + 1)];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    return [x - (by - ay) / l * ROAD * sgn, y + (bx - ax) / l * ROAD * sgn];
  }));
  var Renderer = class {
    constructor(c, P2) {
      this.c = c;
      this.pen = new Pen(c, P2);
    }
    pen;
    paperKey = "";
    paperCv = null;
    order = [];
    byY = [];
    set palette(P2) {
      this.pen.P = P2;
      this.paperKey = "";
    }
    get P() {
      return this.pen.P;
    }
    draw(g2, v, o) {
      const c = this.c, pen = this.pen, P2 = pen.P;
      pen.boil = o.reduced ? Math.floor(o.t) : Math.floor(o.t * 4);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.paper(v), 0, 0);
      c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
      c.lineCap = "round";
      c.lineJoin = "round";
      this.road();
      if (o.ghost) this.grid(o.ghost);
      this.castle();
      if (o.sel && !o.mini) this.reach(o.sel.x, o.sel.y, rangeOf(o.sel), o.sel.id * 3, P2.red);
      for (const t of g2.towers) if (t.type === "candle" && t.firing > 0) this.cone(t);
      const ts = this.byY;
      ts.length = 0;
      for (const t of g2.towers) if (t.type !== "tack") ts.push(t);
      else this.tack(t, o);
      ts.sort((a, b) => a.y + TOWERS[a.type].size * 12 - (b.y + TOWERS[b.type].size * 12));
      const es = this.order;
      es.length = 0;
      for (const e of g2.enemies) if (e.alive) es.push(e);
      es.sort((a, b) => a.y - b.y);
      let i = 0;
      for (const t of ts) {
        const foot = t.y + TOWERS[t.type].size * 12 - 7;
        while (i < es.length && lerp(es[i].py, es[i].y, o.alpha) + 6 < foot) this.enemy(es[i++], o);
        this.tower(t, o);
      }
      while (i < es.length) this.enemy(es[i++], o);
      if (o.ghost) this.ghost(o.ghost);
      this.shots(g2, o);
      this.cranes(g2, o);
      this.fx(g2, o);
      this.bucket(g2, o);
      if (o.toast && !o.mini && o.t - o.toast.at < 1.6) pen.text(o.toast.text, W / 2, 124, 38, P2.red, "center");
    }
    // ---- the paper: specks, faint rules and a red margin, drawn once per size --------------------------------------
    paper(v) {
      const key = `${v.w}x${v.h}@${v.dpr}:${v.s.toFixed(4)},${v.ox.toFixed(1)},${v.oy.toFixed(1)}:${this.P.paper}`;
      if (this.paperCv && key === this.paperKey) return this.paperCv;
      const cv = this.paperCv ?? document.createElement("canvas"), P2 = this.P;
      cv.width = Math.max(1, Math.round(v.w * v.dpr));
      cv.height = Math.max(1, Math.round(v.h * v.dpr));
      const c = cv.getContext("2d");
      c.fillStyle = P2.paper;
      c.fillRect(0, 0, cv.width, cv.height);
      c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
      const x0 = -v.ox / v.s, y0 = -v.oy / v.s, x1 = (v.w - v.ox) / v.s, y1 = (v.h - v.oy) / v.s;
      const n = Math.round(1600 * ((x1 - x0) * (y1 - y0)) / (W * H));
      for (let i = 0; i < Math.min(6e3, n); i++) {
        c.fillStyle = `rgba(${P2.speck},${(hash(i * 3) * 0.08).toFixed(3)})`;
        c.fillRect(x0 + hash(i) * (x1 - x0), y0 + hash(i + 9) * (y1 - y0), 1 + hash(i * 7) * 2, 1);
      }
      c.strokeStyle = P2.rule;
      c.lineWidth = 1;
      for (let y = 38 + Math.floor((y0 - 38) / 30) * 30; y < y1; y += 30) {
        c.beginPath();
        c.moveTo(x0, y);
        c.lineTo(x1, y);
        c.stroke();
      }
      c.strokeStyle = P2.margin;
      c.beginPath();
      c.moveTo(70, y0);
      c.lineTo(70, y1);
      c.stroke();
      this.paperCv = cv;
      this.paperKey = key;
      return cv;
    }
    // ---- the road and the castle ----------------------------------------------------------------------------------
    road() {
      const c = this.c, pen = this.pen;
      c.strokeStyle = pen.P.ink;
      c.lineWidth = 2.4;
      EDGES.forEach((s, k) => {
        const sgn = k ? -1 : 1;
        c.beginPath();
        s.forEach(([x, y], i) => i ? c.lineTo(x + pen.j(i * sgn, 1.2), y + pen.j(i * sgn + 50, 1.2)) : c.moveTo(x, y));
        c.stroke();
      });
      const [a, b] = EDGES;
      c.strokeStyle = pen.P.soft;
      c.lineWidth = 1.2;
      c.beginPath();
      for (let i = 2; i < ROAD_PTS.length - 1; i += 3) pen.l(a[i][0], a[i][1], lerp(b[i][0], a[i][0], 0.55) - 6, lerp(b[i][1], a[i][1], 0.55) + 6, i * 7);
      c.stroke();
    }
    castle() {
      const c = this.c, pen = this.pen, P2 = pen.P, [ca, cb] = CASTLE;
      c.fillStyle = P2.paper;
      c.fillRect(ca - 30, cb - 50, 60, 50);
      c.strokeStyle = P2.ink;
      c.lineWidth = 2.2;
      c.beginPath();
      pen.l(ca - 30, cb, ca - 30, cb - 50, 901);
      pen.l(ca + 30, cb, ca + 30, cb - 50, 902);
      pen.l(ca - 30, cb - 50, ca + 30, cb - 50, 903);
      for (let i = 0; i < 4; i++) pen.l(ca - 30 + i * 20, cb - 50, ca - 30 + i * 20, cb - 60, 910 + i);
      pen.l(ca, cb - 50, ca, cb - 74, 920);
      c.moveTo(ca + 11, cb);
      c.arc(ca, cb, 11, 0, Math.PI, true);
      c.stroke();
      c.fillStyle = P2.red;
      c.beginPath();
      c.moveTo(ca, cb - 60);
      c.lineTo(ca + 16, cb - 66);
      c.lineTo(ca, cb - 72);
      c.fill();
    }
    // ---- towers ---------------------------------------------------------------------------------------------------
    tower(t, o) {
      const P2 = this.P, size = TOWERS[t.type].size, half = size * CELL / 2;
      const fx = t.x, fy = t.y + half - 7;
      this.c.strokeStyle = P2.soft;
      this.pen.line(fx - half + 6, fy + 2, fx + half - 6, fy + 2, t.id * 7, 1);
      sketch(this.pen, t.type, t.level, fx, fy, size === 3 ? 1.2 : 1, t.id, t.heading, t.recoil, t.firing > 0, o.t);
      if (!o.mini) {
        const label = t.level < 40 ? ROMAN(t.level) : fmt(t.level);
        this.pen.text(label, fx + half - 8, fy - 8, 22, t.level >= 10 ? P2.red : P2.ink);
      }
    }
    // the Thumbtack sits on the road, seen from above
    tack(t, o) {
      const c = this.c, pen = this.pen, P2 = pen.P, r = 10 + Math.min(4, Math.floor(t.level / 10));
      c.fillStyle = P2.shadow;
      c.beginPath();
      c.ellipse(t.x + 3, t.y + 4, r, r * 0.8, 0, 0, TAU);
      c.fill();
      c.strokeStyle = P2.ink;
      pen.circle(t.x, t.y, r, t.id * 5, P2.red, 2);
      pen.circle(t.x - r * 0.25, t.y - r * 0.25, r * 0.35, t.id * 5 + 20, P2.paper, 1.2);
      if (t.recoil > 0 && !o.reduced) {
        c.strokeStyle = P2.ink;
        c.lineWidth = 1.4;
        c.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * TAU + 0.3;
          pen.l(t.x + Math.cos(a) * (r + 3), t.y + Math.sin(a) * (r + 3), t.x + Math.cos(a) * (r + 9), t.y + Math.sin(a) * (r + 9), k + t.id);
        }
        c.stroke();
      }
      if (!o.mini) pen.text(t.level < 40 ? ROMAN(t.level) : fmt(t.level), t.x + r + 4, t.y - r, 20, t.level >= 10 ? P2.red : P2.ink);
    }
    // the Candle's flame cone while it burns
    cone(t) {
      const c = this.c, pen = this.pen, a = t.heading, w = t.st.area, r = t.st.range, cx = t.x, cy = t.y - 20;
      c.fillStyle = pen.P.flame;
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, r, a - w, a + w);
      c.closePath();
      c.fill();
      c.strokeStyle = pen.P.red;
      c.lineWidth = 1.2;
      c.beginPath();
      pen.l(cx, cy, cx + Math.cos(a - w) * r, cy + Math.sin(a - w) * r, t.id + 1);
      pen.l(cx, cy, cx + Math.cos(a + w) * r, cy + Math.sin(a + w) * r, t.id + 2);
      c.stroke();
    }
    reach(x, y, r, seed, color) {
      const c = this.c;
      c.strokeStyle = color;
      c.setLineDash([2, 7]);
      this.pen.circle(x, y, r, seed, void 0, 1.6);
      c.setLineDash([]);
    }
    // ---- placing: the soft grid near the pointer, and the ghost (clear when it fits, red and hatched when not) ------
    grid(gh) {
      const c = this.c, size = TOWERS[gh.type].size, mx = gh.cx + size / 2, my = gh.cy + size / 2;
      c.fillStyle = this.P.soft;
      for (let r = Math.max(0, Math.floor(my - 6)); r <= Math.min(ROWS, Math.ceil(my + 6)); r++) {
        for (let k = Math.max(0, Math.floor(mx - 8)); k <= Math.min(COLS, Math.ceil(mx + 8)); k++) {
          const d = Math.hypot(k - mx, r - my);
          if (d > 7) continue;
          c.globalAlpha = 0.9 * (1 - d / 7);
          c.fillRect(k * CELL - 1, r * CELL - 1, 2, 2);
        }
      }
      c.globalAlpha = 1;
    }
    ghost(gh) {
      const c = this.c, pen = this.pen, P2 = pen.P, d = TOWERS[gh.type], size = d.size;
      const x = gh.cx * CELL, y = gh.cy * CELL, wpx = size * CELL, ok = !gh.why;
      const range = gh.moving ? rangeOf(gh.moving) : d.range;
      this.reach(x + wpx / 2, y + wpx / 2, range, 77, ok ? P2.blue : P2.red);
      c.save();
      c.beginPath();
      c.rect(x, y, wpx, wpx);
      c.clip();
      if (ok) {
        c.fillStyle = P2.faint;
        c.fillRect(x, y, wpx, wpx);
      } else {
        c.strokeStyle = P2.red;
        c.lineWidth = 1.4;
        c.beginPath();
        for (let k = -wpx; k < wpx; k += 8) pen.l(x + k, y + wpx, x + k + wpx, y, 600 + k);
        c.stroke();
      }
      c.restore();
      c.strokeStyle = ok ? P2.ink : P2.red;
      c.setLineDash([5, 5]);
      c.lineWidth = 1.6;
      c.strokeRect(x + 1, y + 1, wpx - 2, wpx - 2);
      c.setLineDash([]);
      c.globalAlpha = ok ? 0.75 : 0.35;
      if (d.onRoad) {
        c.strokeStyle = P2.ink;
        pen.circle(x + wpx / 2, y + wpx / 2, 10, 5, P2.red, 2);
      } else sketch(pen, gh.type, gh.moving?.level ?? 1, x + wpx / 2, y + wpx - 7, size === 3 ? 1.2 : 1, 3, -0.6, 0, false, 0);
      c.globalAlpha = 1;
      if (!ok) {
        const tx = Math.min(W - 90, Math.max(90, x + wpx / 2)), ty = y > 60 ? y - 10 : y + wpx + 26;
        pen.text(gh.why, tx, ty, 24, P2.red, "center");
      }
    }
    // ---- walkers --------------------------------------------------------------------------------------------------
    enemy(e, o) {
      const c = this.c, pen = this.pen, P2 = pen.P, def = ENEMIES[e.type], r = def.r;
      const x = lerp(e.px, e.x, o.alpha), y = lerp(e.py, e.y, o.alpha) + 6, id = e.uid;
      const step = !o.reduced && Math.sin(o.t * 12 + id) > 0;
      const fill = e.flash > 0 && !o.reduced ? P2.red : e.slow > 0 ? P2.chill : P2.paper;
      c.save();
      if (def.flies) {
        c.fillStyle = P2.shadow;
        c.beginPath();
        c.ellipse(x, y, r, r * 0.3, 0, 0, TAU);
        c.fill();
        c.translate(x, y - r * 2.4 - Math.sin(o.t * 3 + id) * (o.reduced ? 0 : 2));
        if (e.dir < 0) c.scale(-1, 1);
        c.beginPath();
        c.moveTo(r * 1.3, 0);
        c.lineTo(-r, -r * 0.7);
        c.lineTo(-r * 0.4, 0);
        c.lineTo(-r, r * 0.5);
        c.closePath();
        c.fillStyle = fill;
        c.fill();
        c.strokeStyle = P2.ink;
        c.lineWidth = 1.8;
        c.beginPath();
        pen.l(r * 1.3, 0, -r, -r * 0.7, id);
        pen.l(-r, -r * 0.7, -r * 0.4, 0, id + 1);
        pen.l(-r * 0.4, 0, -r, r * 0.5, id + 2);
        pen.l(-r, r * 0.5, r * 1.3, 0, id + 3);
        pen.l(r * 1.3, 0, -r * 0.4, 0, id + 4);
        c.stroke();
        c.restore();
        this.hp(e, x, y - r * 2.4 - 4, r);
        return;
      }
      c.translate(x, y - r);
      if (e.dir < 0) c.scale(-1, 1);
      c.strokeStyle = P2.ink;
      c.lineWidth = 1.8;
      c.beginPath();
      pen.l(-r * 0.4, r * 0.7, -r * 0.5 + (step ? 4 : -2), r + 4, id * 3);
      pen.l(r * 0.4, r * 0.7, r * 0.5 + (step ? -2 : 4), r + 4, id * 3 + 1);
      c.stroke();
      c.lineWidth = e.type === "boss" || e.type === "editor" ? 2.8 : 2.2;
      if (e.type === "blot" || e.type === "editor" || e.type === "eraser") {
        const h = e.type === "eraser" ? r * 0.75 : r;
        c.beginPath();
        c.rect(-r, -h, r * 2, h * 2);
        c.fillStyle = fill;
        c.fill();
        c.beginPath();
        pen.l(-r, -h, r, -h, id);
        pen.l(r, -h, r, h, id + 1);
        pen.l(r, h, -r, h, id + 2);
        pen.l(-r, h, -r, -h, id + 3);
        if (e.type === "blot") {
          pen.l(-r * 0.6, -r, -r * 0.9, -r * 1.5, id + 4);
          pen.l(r * 0.6, -r, r * 0.9, -r * 1.5, id + 5);
        }
        if (e.type === "eraser") {
          pen.l(-r * 0.2, -h, -r * 0.2, h, id + 6);
        }
        c.stroke();
        if (e.type === "blot") {
          c.strokeStyle = P2.soft;
          c.lineWidth = 1;
          c.beginPath();
          for (let k = 0; k < 4; k++) pen.l(-r + 3 + k * 5, r - 2, -r + 9 + k * 5, r - 8, id + 10 + k);
          c.stroke();
        }
      } else {
        const rr = e.type === "gnat" ? r : r;
        c.beginPath();
        pen.o(0, 0, rr, id * 5);
        c.fillStyle = fill;
        c.fill();
        c.stroke();
        if (e.type === "ditto") {
          c.lineWidth = 1.2;
          c.beginPath();
          pen.o(-3, 2, rr * 0.8, id * 5 + 30);
          c.stroke();
        }
        if (e.type === "dash" && !o.reduced) {
          c.strokeStyle = P2.soft;
          c.lineWidth = 1.2;
          c.beginPath();
          for (let k = 0; k < 3; k++) pen.l(-r - 6, -r * 0.4 + k * r * 0.4, -r - 16, -r * 0.4 + k * r * 0.4, id + k);
          c.stroke();
        }
        if (e.type === "gnat") {
          c.strokeStyle = P2.soft;
          c.lineWidth = 1.2;
          c.beginPath();
          pen.o(-3, -r - 2, r * 0.7, id + 40);
          pen.o(4, -r - 2, r * 0.7, id + 50);
          c.stroke();
        }
      }
      c.fillStyle = P2.ink;
      const eye = Math.max(1.6, r * 0.12);
      c.beginPath();
      c.arc(r * 0.3, -r * 0.2, eye, 0, TAU);
      c.arc(r * 0.62, -r * 0.2, eye, 0, TAU);
      c.fill();
      if (e.type === "editor") {
        c.strokeStyle = P2.ink;
        c.lineWidth = 1.4;
        c.beginPath();
        c.arc(r * 0.3, -r * 0.2, eye * 2.6, 0, TAU);
        c.moveTo(r * 0.62 + eye * 2.6, -r * 0.2);
        c.arc(r * 0.62, -r * 0.2, eye * 2.6, 0, TAU);
        c.stroke();
        c.strokeStyle = P2.red;
        c.lineWidth = 3;
        c.beginPath();
        pen.l(r * 0.9, r * 0.2, r * 1.5, -r * 0.6, id + 70);
        c.stroke();
      }
      if (e.type === "boss" || e.type === "editor") {
        c.strokeStyle = P2.ink;
        c.lineWidth = 1.4;
        c.beginPath();
        for (let k = 0; k < 4; k++) pen.l(r * 0.05 + k * r * 0.18, r * 0.35, r * 0.12 + k * r * 0.18, r * 0.5, id * 9 + k);
        c.stroke();
        c.fillStyle = P2.red;
        c.beginPath();
        c.moveTo(-r * 0.5, -r * 0.85);
        c.lineTo(-r * 0.3, -r * 1.35);
        c.lineTo(0, -r * 0.95);
        c.lineTo(r * 0.3, -r * 1.35);
        c.lineTo(r * 0.5, -r * 0.85);
        c.closePath();
        c.fill();
        c.lineWidth = 1.6;
        c.stroke();
      }
      if (e.slow > 0) {
        c.strokeStyle = P2.blue;
        c.lineWidth = 1;
        c.beginPath();
        for (let k = 0; k < 3; k++) pen.l(-r - 6, -r * 0.5 + k * r * 0.5, -r - 14, -r * 0.5 + k * r * 0.5, id + k);
        c.stroke();
      }
      if (e.stacks > 0) {
        c.fillStyle = P2.blue;
        for (let k = 0; k < Math.min(5, e.stacks); k++) c.fillRect(-r + k * 4, r + 1, 2, 2);
      }
      if (e.burnT > 0) {
        c.fillStyle = P2.flame;
        c.beginPath();
        pen.o(0, -r * 0.2, r * 1.1, id + 90);
        c.fill();
      }
      c.restore();
      this.hp(e, x, y - r * 2 - 4, r);
    }
    hp(e, x, top, r) {
      if (e.hp >= e.max) return;
      const c = this.c, w = Math.max(24, r * 2.2);
      c.strokeStyle = this.P.ink;
      c.lineWidth = 1;
      c.strokeRect(x - w / 2, top - 8, w, 5);
      c.fillStyle = this.P.red;
      c.fillRect(x - w / 2 + 1, top - 7, (w - 2) * Math.max(0, e.hp / e.max), 3);
    }
    // ---- shots, cranes and effects --------------------------------------------------------------------------------
    shots(g2, o) {
      const c = this.c, pen = this.pen, P2 = pen.P;
      for (const s of g2.shots) {
        if (!s.alive) continue;
        const a = lerp(s.px, s.x, o.alpha), b = lerp(s.py, s.y, o.alpha);
        c.strokeStyle = P2.ink;
        c.fillStyle = P2.ink;
        if (s.kind === "dart") {
          const ang = Math.atan2(s.ty - s.sy, s.tx - s.sx), ca = Math.cos(ang), sa = Math.sin(ang);
          c.lineWidth = 2.4;
          c.beginPath();
          pen.l(a - ca * 14, b - sa * 14, a, b, s.tid * 13 % 97);
          c.stroke();
          c.lineWidth = 1;
          c.beginPath();
          pen.l(a - ca * 26, b - sa * 26 + 3, a - ca * 18, b - sa * 18 + 3, 7);
          c.stroke();
        } else if (s.kind === "blot") {
          const f = Math.min(1, s.t / s.life), lift = Math.sin(f * Math.PI) * 50;
          c.setLineDash([2, 6]);
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(s.sx, s.sy);
          c.quadraticCurveTo(a, b - lift * 1.4, a, b - lift);
          c.stroke();
          c.setLineDash([]);
          pen.circle(a, b - lift, 6, 3, P2.ink, 1.6);
        } else {
          c.strokeStyle = P2.blue;
          c.lineWidth = 2;
          c.beginPath();
          for (let k = 0; k < 3; k++) {
            const an = k * Math.PI / 3 + (o.reduced ? 0 : o.t * 3);
            pen.l(a - Math.cos(an) * 6, b - Math.sin(an) * 6, a + Math.cos(an) * 6, b + Math.sin(an) * 6, k);
          }
          c.stroke();
        }
      }
    }
    cranes(g2, o) {
      for (const t of g2.towers) {
        if (t.type !== "crane") continue;
        for (const cr of t.cranes) {
          const x = lerp(cr.px, cr.x, o.alpha), y = lerp(cr.py, cr.y, o.alpha);
          bird(this.pen, x, y, 8, x < (cr.target?.x ?? t.x), o.reduced ? 0 : Math.sin(o.t * 10 + t.id));
        }
      }
    }
    fx(g2, o) {
      const c = this.c, pen = this.pen, P2 = pen.P;
      for (const f of g2.fx) {
        if (f.t >= f.life || f.life <= 0) continue;
        const k = f.t / f.life;
        c.globalAlpha = Math.max(0, 1 - k * 0.8);
        switch (f.kind) {
          case "splat": {
            c.strokeStyle = P2.ink;
            c.lineWidth = 1.6;
            c.beginPath();
            const r = f.size * (0.8 + k * 1.4);
            for (let i = 0; i < 6; i++) {
              const an = i / 6 * TAU + 0.4 + f.seed;
              pen.l(f.x + Math.cos(an) * r * 0.5, f.y + Math.sin(an) * r * 0.5, f.x + Math.cos(an) * r, f.y + Math.sin(an) * r, i + 500);
            }
            c.stroke();
            c.fillStyle = P2.ink;
            c.globalAlpha *= 0.5;
            c.beginPath();
            pen.o(f.x, f.y, f.size * 0.35, f.seed);
            c.fill();
            break;
          }
          case "blast": {
            c.strokeStyle = P2.red;
            c.lineWidth = 2.4;
            c.beginPath();
            for (let i = 0; i < 10; i++) {
              const an = i / 10 * TAU, r1 = f.size * (0.3 + k * 0.4), r2 = f.size * (0.6 + k * 0.6);
              pen.l(f.x + Math.cos(an) * r1, f.y + Math.sin(an) * r1, f.x + Math.cos(an) * r2, f.y + Math.sin(an) * r2, i + 300);
            }
            c.stroke();
            if (!o.reduced && !o.mini && f.seed % 3 === 0) pen.text(["BOOM", "POW", "KA-BLAM"][Math.floor(f.seed / 3) % 3], f.x, f.y - 26 - k * 14, 30, P2.red, "center");
            break;
          }
          case "chill":
            c.strokeStyle = P2.blue;
            pen.circle(f.x, f.y, f.size * (0.35 + k * 0.65), f.seed, void 0, 1.6);
            break;
          case "beam": {
            const len = Math.hypot(f.x2 - f.x, f.y2 - f.y) || 1, ux = (f.x2 - f.x) / len, uy = (f.y2 - f.y) / len;
            c.strokeStyle = P2.ink;
            c.lineWidth = Math.max(2, f.size * 0.35);
            c.beginPath();
            c.moveTo(f.x, f.y - 16);
            c.lineTo(f.x2, f.y2 - 16);
            c.stroke();
            c.lineWidth = 1;
            c.beginPath();
            for (let d = 12; d < len; d += 12) {
              const px = f.x + ux * d, py = f.y - 16 + uy * d;
              c.moveTo(px - uy * 5, py + ux * 5);
              c.lineTo(px + uy * 5, py - ux * 5);
            }
            c.stroke();
            break;
          }
          case "chain": {
            c.strokeStyle = P2.blue;
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(f.x, f.y);
            for (let i = 0; i < f.n; i++) {
              const px = f.pts[i * 2], py = f.pts[i * 2 + 1], lx = i ? f.pts[i * 2 - 2] : f.x, ly = i ? f.pts[i * 2 - 1] : f.y;
              c.lineTo((lx + px) / 2 + pen.j(i + f.seed, 8), (ly + py) / 2 + pen.j(i + f.seed + 3, 8));
              c.lineTo(px, py - 8);
            }
            c.stroke();
            break;
          }
          case "trace": {
            c.strokeStyle = P2.red;
            c.lineWidth = 1.2;
            c.setLineDash([3, 5]);
            c.beginPath();
            c.moveTo(f.x, f.y);
            c.lineTo(f.x2, f.y2 - 10);
            c.stroke();
            c.setLineDash([]);
            c.beginPath();
            pen.o(f.x2, f.y2 - 10, 9, f.seed);
            c.moveTo(f.x2 - 13, f.y2 - 10);
            c.lineTo(f.x2 + 13, f.y2 - 10);
            c.moveTo(f.x2, f.y2 - 23);
            c.lineTo(f.x2, f.y2 + 3);
            c.stroke();
            break;
          }
          case "stab": {
            c.strokeStyle = P2.red;
            c.lineWidth = 1.6;
            c.beginPath();
            for (let i = 0; i < 5; i++) {
              const an = i / 5 * TAU;
              pen.l(f.x + Math.cos(an) * 6, f.y + Math.sin(an) * 6, f.x + Math.cos(an) * (12 + k * 8), f.y + Math.sin(an) * (12 + k * 8), i + 40);
            }
            c.stroke();
            break;
          }
          case "num":
          case "crit":
            if (!o.reduced && !o.mini) pen.text(fmt(f.value) + (f.kind === "crit" ? "!" : ""), f.x, f.y - k * 18, f.kind === "crit" ? 28 : 20, f.kind === "crit" ? P2.red : P2.ink, "center");
            break;
          case "coin":
            if (!o.mini) {
              c.strokeStyle = P2.gold;
              pen.circle(f.x - 18, f.y - (o.reduced ? 0 : k * 16) - 6, 6, f.seed, void 0, 1.6);
              if (!o.reduced) pen.text("+" + fmt(f.value), f.x - 8, f.y - k * 16, 22, P2.gold);
            }
            break;
          case "tear": {
            c.strokeStyle = P2.red;
            c.lineWidth = 2.6;
            c.beginPath();
            c.moveTo(0, 250);
            for (let x = 30; x <= W; x += 30) c.lineTo(x, 250 + (hash(x + f.seed) - 0.5) * 34);
            c.stroke();
            if (!o.mini) pen.text("the page tore! back a few waves", W / 2, 228, 34, P2.red, "center");
            break;
          }
        }
        c.globalAlpha = 1;
      }
    }
    // ---- the ink bucket: hatched water for the tokens so far, tally marks for waves waiting -------------------------
    bucket(g2, o) {
      const c = this.c, pen = this.pen, P2 = pen.P, [x, y] = BUCKET, w = 92, h = 92;
      const queued = g2.queued(), fill = queued ? 1 : Math.max(0, Math.min(1, g2.ink / g2.nextCost()));
      c.save();
      c.translate(x, y);
      c.save();
      c.beginPath();
      c.moveTo(-w / 2, -h);
      c.lineTo(w / 2, -h);
      c.lineTo(w / 2 - 12, 0);
      c.lineTo(-w / 2 + 12, 0);
      c.closePath();
      c.fillStyle = P2.paper;
      c.fill();
      c.clip();
      const top = -h * fill;
      c.strokeStyle = P2.blue;
      c.lineWidth = 1.4;
      c.beginPath();
      if (fill > 0) for (let k = -w; k < w; k += 7) pen.l(k, 0, k + 26, top, k + 700);
      c.stroke();
      if (fill > 0) {
        c.lineWidth = 2;
        c.beginPath();
        pen.l(-w / 2, top, w / 2, top, 760);
        c.stroke();
      }
      c.restore();
      c.strokeStyle = P2.ink;
      c.lineWidth = 2.2;
      c.beginPath();
      pen.l(-w / 2, -h, -w / 2 + 12, 0, 771);
      pen.l(w / 2, -h, w / 2 - 12, 0, 772);
      pen.l(-w / 2 + 12, 0, w / 2 - 12, 0, 773);
      c.stroke();
      c.beginPath();
      c.ellipse(0, -h, w / 2, 8, 0, 0, TAU);
      c.stroke();
      c.beginPath();
      c.arc(0, -h, w / 2 + 2, Math.PI * 1.08, Math.PI * 1.92);
      c.stroke();
      c.restore();
      if (o.mini) return;
      pen.text(`${fmt(g2.ink)} / ${fmt(g2.nextCost())} tokens`, x + 56, y - 60, 24, P2.ink);
      c.strokeStyle = P2.ink;
      c.lineWidth = 1.8;
      c.beginPath();
      for (let i = 0; i < Math.min(queued, 20); i++) {
        const grp = Math.floor(i / 5), k = i % 5, bx = x + 58 + grp * 34;
        if (k < 4) pen.l(bx + k * 6, y - 44, bx + k * 6 + 1, y - 22, i + 800);
        else pen.l(bx - 3, y - 28, bx + 22, y - 40, i + 800);
      }
      c.stroke();
      if (queued > 20) pen.text(`+${queued - 20}`, x + 58 + 4 * 34, y - 26, 22, P2.ink);
      const line = queued ? g2.auto ? `${queued === 1 ? "a wave" : queued + " waves"} in the bucket` : `${queued === 1 ? "a wave waits" : queued + " waves wait"}: press send` : g2.busy() ? "bucket is filling…" : "bucket is filling… (your Claude Code tokens)";
      pen.text(line, x + 56, y - 4, 20, P2.soft);
    }
  };
  function rangeOf(t) {
    return t.st.range;
  }
  function bird(pen, x, y, s, flip, flap) {
    const c = pen.c, P2 = pen.P, d = flip ? -1 : 1;
    c.beginPath();
    c.moveTo(x - s * d, y);
    c.lineTo(x + s * 1.2 * d, y - s * 0.2);
    c.lineTo(x, y + s * 0.4);
    c.closePath();
    c.moveTo(x - s * 0.2 * d, y - s * 0.1);
    c.lineTo(x + s * 0.2 * d, y - s * (0.9 + flap * 0.4));
    c.lineTo(x + s * 0.5 * d, y - s * 0.1);
    c.fillStyle = P2.paper;
    c.fill();
    c.strokeStyle = P2.ink;
    c.lineWidth = 1.4;
    c.stroke();
    c.beginPath();
    c.moveTo(x + s * 1.2 * d, y - s * 0.2);
    c.lineTo(x + s * 1.5 * d, y - s * 0.8);
    c.stroke();
  }
  function sketch(pen, type, level, x, y, k, seed, aim, rec, firing, t) {
    const c = pen.c, P2 = pen.P, s = seed * 31, v = Math.min(5, Math.floor(level / 10)), hot = level >= 10;
    c.save();
    c.translate(x, y);
    c.scale(k, k);
    c.strokeStyle = P2.ink;
    c.fillStyle = P2.paper;
    c.lineWidth = 2.2;
    const ax = Math.cos(aim), ay = Math.sin(aim);
    switch (type) {
      case "quill": {
        const h = 32 + v * 5;
        c.fillRect(-12, -h, 24, h);
        c.beginPath();
        pen.l(-12, 0, -12, -h, s);
        pen.l(12, 0, 12, -h, s + 6);
        pen.l(-12, 0, 12, 0, s + 12);
        for (let i = 0; i < 3; i++) pen.l(-12 + i * 9, -h, -12 + i * 9 + 6, -h, s + 18 + i);
        pen.l(-12, -h, -12, -h - 6, s + 30);
        pen.l(-3, -h, -3, -h - 6, s + 31);
        pen.l(6, -h, 6, -h - 6, s + 32);
        pen.l(12, -h, 12, -h - 6, s + 33);
        c.stroke();
        if (v) {
          c.lineWidth = 1.2;
          c.beginPath();
          for (let i = 1; i <= Math.min(v, 4); i++) pen.l(-8, -i * 8, 8, -i * 8 - 2, s + 40 + i);
          c.stroke();
        }
        const L = 20 * (1 - rec * 0.3), bx = 0, by = -h + 10;
        c.lineWidth = 3;
        c.beginPath();
        pen.l(bx - ax * 6, by - ay * 6, bx + ax * L, by + ay * L, s + 50);
        c.stroke();
        c.fillStyle = hot ? P2.red : P2.ink;
        c.beginPath();
        c.arc(bx + ax * L, by + ay * L, 2.2, 0, TAU);
        c.fill();
        if (hot) {
          c.lineWidth = 2.2;
          c.beginPath();
          pen.l(0, -h - 6, 0, -h - 22, s + 60);
          c.stroke();
          c.fillStyle = P2.red;
          c.beginPath();
          c.moveTo(0, -h - 22);
          c.lineTo(14, -h - 18);
          c.lineTo(0, -h - 14);
          c.fill();
        }
        break;
      }
      case "bomb": {
        const w = 22 + v * 2, arm = -0.9 + rec * 0.8, len = 28 + v * 3;
        c.fillRect(-w, -16, w * 2, 12);
        c.beginPath();
        pen.l(-w, -16, w, -16, s);
        pen.l(-w, -4, w, -4, s + 3);
        pen.l(-w, -16, -w, -4, s + 5);
        pen.l(w, -16, w, -4, s + 7);
        c.stroke();
        pen.circle(-w + 7, -3, 6, s + 9, P2.paper);
        pen.circle(w - 7, -3, 6, s + 11, P2.paper);
        const ex = Math.cos(Math.PI + arm) * len, ey = Math.sin(Math.PI + arm) * len;
        c.lineWidth = 3;
        c.beginPath();
        pen.l(0, -16, -ex, -16 + ey, s + 13);
        c.stroke();
        pen.circle(-ex, -16 + ey - 4, 6, s + 15, hot ? P2.red : P2.ink);
        if (v) {
          c.lineWidth = 1.2;
          c.beginPath();
          for (let i = 1; i <= Math.min(v, 4); i++) pen.l(-w + 4 + i * 8, -14, -w + 8 + i * 8, -6, s + 20 + i);
          c.stroke();
        }
        break;
      }
      case "frost": {
        const n = 2 + Math.min(v, 4);
        for (let i = 0; i < n; i++) {
          const ox = (i - (n - 1) / 2) * 9, h = 22 + (i % 2 ? 8 : 16) + v * 2;
          c.beginPath();
          c.moveTo(ox, 0);
          c.lineTo(ox - 6, -h * 0.6);
          c.lineTo(ox, -h);
          c.lineTo(ox + 6, -h * 0.6);
          c.closePath();
          c.fillStyle = hot && i === Math.floor(n / 2) ? "rgba(210,58,42,.25)" : P2.chill;
          c.fill();
          c.beginPath();
          pen.l(ox, 0, ox - 6, -h * 0.6, s + i * 5);
          pen.l(ox - 6, -h * 0.6, ox, -h, s + i * 5 + 1);
          pen.l(ox, -h, ox + 6, -h * 0.6, s + i * 5 + 2);
          pen.l(ox + 6, -h * 0.6, ox, 0, s + i * 5 + 3);
          c.stroke();
        }
        const t2 = 1 - rec, top = -50 - v * 2;
        c.strokeStyle = P2.blue;
        c.lineWidth = 1.4;
        c.beginPath();
        for (let a = 0; a < 3; a++) {
          const an = a * Math.PI / 3;
          pen.l(-Math.cos(an) * 8 * t2, top - Math.sin(an) * 8 * t2, Math.cos(an) * 8 * t2, top + Math.sin(an) * 8 * t2, s + 80 + a);
        }
        c.stroke();
        break;
      }
      case "ruler": {
        c.fillRect(-14, -12, 28, 12);
        c.beginPath();
        pen.l(-14, 0, 14, 0, s);
        pen.l(-14, -12, 14, -12, s + 1);
        pen.l(-14, 0, -14, -12, s + 2);
        pen.l(14, 0, 14, -12, s + 3);
        c.stroke();
        const L = (36 + v * 3) * (1 - rec * 0.15), px = -ay, py = ax, bx = 0, by = -16;
        c.beginPath();
        c.moveTo(bx + px * 4, by + py * 4);
        c.lineTo(bx + ax * L + px * 4, by + ay * L + py * 4);
        c.lineTo(bx + ax * L - px * 4, by + ay * L - py * 4);
        c.lineTo(bx - px * 4, by - py * 4);
        c.closePath();
        c.fillStyle = P2.paper;
        c.fill();
        c.lineWidth = 2;
        c.stroke();
        c.lineWidth = 1;
        c.beginPath();
        for (let d = 5; d < L - 2; d += 5) {
          const big = d / 5 % 2 === 0 ? 3.5 : 2;
          c.moveTo(bx + ax * d + px * 4, by + ay * d + py * 4);
          c.lineTo(bx + ax * d + px * (4 - big), by + ay * d + py * (4 - big));
        }
        c.stroke();
        if (hot) {
          c.fillStyle = P2.red;
          c.fillRect(bx + ax * L - 3, by + ay * L - 3, 6, 6);
        }
        break;
      }
      case "spark": {
        const h = 30 + v * 2;
        c.fillRect(-11, -h, 22, h);
        c.beginPath();
        pen.l(-11, 0, -11, -h, s);
        pen.l(11, 0, 11, -h, s + 1);
        pen.l(-11, 0, 11, 0, s + 2);
        pen.l(-13, -h, 13, -h, s + 3);
        c.stroke();
        c.fillRect(-8, -h - 7, 16, 7);
        c.lineWidth = 1.6;
        c.strokeRect(-8, -h - 7, 16, 7);
        c.strokeStyle = hot ? P2.red : P2.blue;
        c.lineWidth = 2 + Math.min(v, 3) * 0.4;
        c.beginPath();
        c.moveTo(2, -h + 4);
        c.lineTo(-5, -h / 2);
        c.lineTo(3, -h / 2 + 2);
        c.lineTo(-2, -4);
        c.stroke();
        if (rec > 0) {
          c.lineWidth = 1.2;
          c.beginPath();
          for (let i = 0; i < 4; i++) {
            const an = -Math.PI / 2 + (i - 1.5) * 0.5;
            pen.l(Math.cos(an) * 12, -h - 8 + Math.sin(an) * 6, Math.cos(an) * 20, -h - 8 + Math.sin(an) * 14, s + 60 + i);
          }
          c.stroke();
        }
        break;
      }
      case "thorn": {
        const n = 3 + Math.min(v, 3);
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI, ox = -Math.cos(a) * 12, oy = -10 - Math.sin(a) * 10;
          c.strokeStyle = P2.ink;
          pen.circle(ox, oy, 10, s + i * 7, P2.paper, 2);
        }
        c.beginPath();
        c.lineWidth = 1.4;
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI + i / 7 * Math.PI, r = 20;
          pen.l(Math.cos(a) * r, -10 + Math.sin(a) * r * 0.9, Math.cos(a) * (r + 6), -10 + Math.sin(a) * (r + 6) * 0.9, s + 30 + i);
        }
        c.stroke();
        c.fillStyle = hot ? P2.red : P2.blue;
        for (let i = 0; i < 2 + Math.min(v, 4); i++) {
          c.beginPath();
          c.arc(-12 + i * 7 % 24, -18 + i * 5 % 12, 2.4, 0, TAU);
          c.fill();
        }
        break;
      }
      case "glass": {
        c.beginPath();
        pen.l(0, -20, -13, 0, s);
        pen.l(0, -20, 13, 0, s + 1);
        pen.l(0, -20, 2, 0, s + 2);
        c.stroke();
        const L = (30 + v * 2) * (1 - rec * 0.2), px = -ay, py = ax, bx = 0 - ax * 8, by = -24 - ay * 8;
        c.beginPath();
        c.moveTo(bx + px * 4, by + py * 4);
        c.lineTo(bx + ax * L + px * 6, by + ay * L + py * 6);
        c.lineTo(bx + ax * L - px * 6, by + ay * L - py * 6);
        c.lineTo(bx - px * 4, by - py * 4);
        c.closePath();
        c.fillStyle = P2.paper;
        c.fill();
        c.lineWidth = 2.2;
        c.stroke();
        c.lineWidth = 1.2;
        c.beginPath();
        for (let i = 1; i < 3; i++) {
          const d = L * i / 3;
          c.moveTo(bx + ax * d + px * 5, by + ay * d + py * 5);
          c.lineTo(bx + ax * d - px * 5, by + ay * d - py * 5);
        }
        c.stroke();
        c.strokeStyle = hot ? P2.red : P2.ink;
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(bx + ax * L, by + ay * L, 2.5, 6.5, aim, 0, TAU);
        c.stroke();
        break;
      }
      case "flag": {
        const h = 50 + v * 4, wave = Math.sin(t * 2 + seed) * 3;
        c.beginPath();
        pen.l(0, 0, 0, -h, s);
        pen.l(-10, 0, 10, 0, s + 1);
        c.stroke();
        c.fillStyle = P2.red;
        c.beginPath();
        c.moveTo(1, -h);
        c.quadraticCurveTo(12, -h - 4 + wave, 24 + v * 2, -h + 2);
        c.quadraticCurveTo(14, -h + 8 - wave, 24 + v * 2, -h + 14);
        c.quadraticCurveTo(12, -h + 10 + wave, 1, -h + 14);
        c.closePath();
        c.fill();
        c.lineWidth = 1.4;
        c.stroke();
        c.lineWidth = 1.4;
        c.beginPath();
        for (let i = 0; i < Math.min(v, 4); i++) pen.l(-5, -8 - i * 6, 5, -8 - i * 6, s + 10 + i);
        c.stroke();
        break;
      }
      case "well": {
        c.beginPath();
        c.moveTo(-22, 0);
        c.lineTo(-16, -22);
        c.lineTo(16, -22);
        c.lineTo(22, 0);
        c.closePath();
        c.fillStyle = P2.paper;
        c.fill();
        c.beginPath();
        pen.l(-22, 0, -16, -22, s);
        pen.l(16, -22, 22, 0, s + 1);
        pen.l(-22, 0, 22, 0, s + 2);
        pen.l(-16, -22, 16, -22, s + 3);
        c.stroke();
        c.fillStyle = P2.ink;
        c.fillRect(-8, -29, 16, 7);
        c.lineWidth = 1.6;
        c.strokeRect(-8, -29, 16, 7);
        c.fillStyle = P2.blue;
        c.beginPath();
        c.moveTo(-19, -8);
        c.lineTo(19, -8);
        c.lineTo(21, -2);
        c.lineTo(-21, -2);
        c.closePath();
        c.fill();
        c.strokeStyle = P2.ink;
        c.lineWidth = 2;
        c.beginPath();
        pen.l(2, -28, 18, -60, s + 5);
        c.stroke();
        c.lineWidth = 1;
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const f = 0.35 + i * 0.1, qx = 2 + 16 * f, qy = -28 - 32 * f;
          pen.l(qx, qy, qx - 7, qy + 2, s + 10 + i);
          pen.l(qx, qy, qx + 6, qy + 4, s + 20 + i);
        }
        c.stroke();
        c.strokeStyle = P2.gold;
        for (let i = 0; i < 1 + Math.min(v, 4); i++) pen.circle(28, -4 - i * 5, 5, s + 40 + i, P2.paper, 1.4);
        break;
      }
      case "tack": {
        pen.circle(0, -10, 10, s, P2.red, 2);
        break;
      }
      case "candle": {
        const h = 26 + v * 3;
        c.beginPath();
        c.ellipse(0, -2, 16, 4, 0, 0, TAU);
        c.fillStyle = P2.paper;
        c.fill();
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = P2.paper;
        c.fillRect(-6, -h, 12, h - 3);
        c.beginPath();
        pen.l(-6, -3, -6, -h, s);
        pen.l(6, -3, 6, -h, s + 1);
        pen.l(-6, -h, 6, -h, s + 2);
        pen.l(0, -h, 0, -h - 5, s + 3);
        c.stroke();
        c.lineWidth = 1.2;
        c.beginPath();
        pen.l(-6, -h + 3, -3, -h + 10, s + 4);
        pen.l(6, -h + 4, 4, -h + 14, s + 5);
        c.stroke();
        const f = firing ? 1.5 : 1, fy = -h - 6;
        c.fillStyle = hot ? P2.red : P2.flame;
        c.beginPath();
        c.moveTo(0, fy - 14 * f);
        c.quadraticCurveTo(7 * f, fy - 4, 0, fy + 2);
        c.quadraticCurveTo(-7 * f, fy - 4, 0, fy - 14 * f);
        c.fill();
        c.strokeStyle = P2.red;
        c.lineWidth = 1.4;
        c.stroke();
        break;
      }
      case "crane": {
        c.fillRect(-20, -16, 40, 16);
        c.beginPath();
        pen.l(-20, 0, 20, 0, s);
        pen.l(-20, -16, 20, -16, s + 1);
        pen.l(-20, 0, -20, -16, s + 2);
        pen.l(20, 0, 20, -16, s + 3);
        c.stroke();
        c.lineWidth = 1;
        c.beginPath();
        for (let i = 0; i < 5; i++) pen.l(-16 + i * 8, -2, -12 + i * 8, -14, s + 10 + i);
        c.stroke();
        bird(pen, 0, -24, 13, false, 0.3);
        if (hot) {
          c.fillStyle = P2.red;
          c.beginPath();
          c.arc(17, -27, 2.4, 0, TAU);
          c.fill();
        }
        break;
      }
    }
    c.restore();
  }

  // src/game/app.ts
  var $ = (id) => document.getElementById(id);
  var root = $("game");
  var canvas = $("view");
  var c2d = canvas.getContext("2d");
  var ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 14V6h8v8M4 6V3.5h1.6V5h1.6V3.5h1.6V5h1.6V3.5H12V6M7 14v-3h2v3"/></svg>';
  var SAVE_EVERY = 2e4;
  var C;
  var S;
  var scale = "mini";
  var dark = true;
  var smoke = false;
  var g = new TDGame(1);
  var ready = false;
  var asleep = false;
  var P = DARK;
  var R = new Renderer(c2d, P);
  var lastTop = -1;
  var view = { s: 1, ox: 0, oy: 0, w: 1, h: 1, dpr: 1 };
  var mini = () => scale === "mini";
  function fit() {
    const top = mini() ? 0 : C ? C.topInset : 0, w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight - top);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.top = top + "px";
    canvas.style.height = h + "px";
    if (top !== lastTop) {
      lastTop = top;
      root.style.setProperty("--td-top", top + "px");
    }
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    if (mini()) {
      let fx = 0, fy = 0, n = 0;
      for (const e of g.enemies) if (e.alive) {
        fx += e.x;
        fy += e.y;
        n++;
      }
      const [x, y] = n ? [fx / n, fy / n] : [CASTLE[0], CASTLE[1] - 30], s2 = w / 300;
      view = { s: s2, ox: w / 2 - x * s2, oy: h / 2 - y * s2, w, h, dpr };
      return;
    }
    const s = Math.min(w / W, h / H);
    view = { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2, w, h, dpr };
  }
  var toPage = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    return [(cx - r.left - view.ox) / view.s, (cy - r.top - view.oy) / view.s];
  };
  function isDark() {
    return S.theme === "dark" || S.theme === "system" && dark;
  }
  function applyTheme() {
    const d = isDark();
    P = d ? DARK : LIGHT;
    R.palette = P;
    const t = d ? { back: "#1c1b21", bar: "#232228", ink: "#ebe3d1", dim: "#9c9584", hot: "#e0604a", task: "#7fa8d8", line: "#3a3840", panel: "#27262d" } : { back: "#f6efdf", bar: "#efe6d2", ink: "#1d1c22", dim: "#77705f", hot: "#d23a2a", task: "#3a6ea5", line: "#d8ccb2", panel: "#fffdf6" };
    C.setTheme(t);
    for (const [k, v] of Object.entries(t)) document.body.style.setProperty("--g-" + k, v);
    root.classList.toggle("light", !d);
    drawIcons();
    wake(true);
  }
  var raf = 0;
  var timer = 0;
  var lastT = 0;
  var lastFrame = 0;
  var lastDraw = 0;
  var lastSave = 0;
  var acc = 0;
  var frames = 0;
  var meter = { since: 0, frames: 0, draw: 0, step: 0, steps: 0, max: 0 };
  function running() {
    return ready && !asleep && (smoke || !document.hidden);
  }
  function frame() {
    timer = 0;
    raf = 0;
    if (!running()) return;
    const t = performance.now(), dt = Math.min(1100, t - lastT);
    lastT = t;
    lastFrame = t;
    if (!g.paused) acc += dt / 1e3 / STEP * g.speed;
    let n = 0;
    const t0 = performance.now();
    while (acc >= 1 && n < 240) {
      g.step();
      acc -= 1;
      n++;
    }
    if (n >= 240) acc = 0;
    meter.step += performance.now() - t0;
    meter.steps += n;
    if (n) news();
    const busy = g.busy() && !g.paused, reduced = S.reducedMotion;
    C.setCalm(!busy);
    const handling = !!ghost || pointerDown;
    const live = !mini() && !reduced && (busy || handling || fxLive());
    const fps = mini() ? reduced ? 1 : busy ? 4 : 2 : live ? Infinity : reduced ? busy || handling ? 10 : 2 : 8;
    if (live || t - lastDraw >= 1e3 / fps - 5) {
      lastDraw = t;
      const t2 = performance.now();
      draw(t / 1e3);
      const ms = performance.now() - t2;
      meter.draw += ms;
      meter.frames++;
      meter.max = Math.max(meter.max, ms);
      if (!mini() && t - lastHud > 200) {
        lastHud = t;
        hud();
      }
    }
    if (t - lastSave > SAVE_EVERY) save();
    if (live) {
      raf = requestAnimationFrame(frame);
      return;
    }
    timer = window.setTimeout(frame, Math.max(4, 1e3 / fps - (performance.now() - t)));
  }
  function stop() {
    clearTimeout(timer);
    timer = 0;
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function wake(now = false) {
    if (!running()) return;
    if (raf || timer && !now) return;
    if (!timer) lastT = performance.now();
    clearTimeout(timer);
    lastDraw = 0;
    timer = window.setTimeout(frame, Math.max(0, 8 - (performance.now() - lastFrame)));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
      save();
    } else wake();
  });
  var fxLive = () => {
    for (const f of g.fx) if (f.t < f.life) return true;
    return false;
  };
  function draw(t) {
    frames++;
    fit();
    R.draw(g, view, { alpha: Math.min(1, acc), t, reduced: S.reducedMotion, mini: mini(), sel: mini() ? null : sel, ghost: mini() ? null : ghost, toast });
  }
  function save() {
    if (!ready) return;
    lastSave = performance.now();
    void C.save(g.save());
  }
  var toast = null;
  var lastHud = 0;
  var say = (text2) => {
    toast = { text: text2, at: performance.now() / 1e3 };
    wake(true);
  };
  function news() {
    if (!g.events.length) return;
    for (const e of g.events) {
      if (e.kind === "wave") C.pulse(`wave ${fmt(e.value)}`);
      if (e.kind === "unlock") {
        const n = TOWER_IDS.filter((id) => TOWERS[id].unlock === e.value).map((id) => TOWERS[id].name);
        if (n.length) {
          C.pulse(`new: ${n.join(", ")}`, "task");
          say(`new tower: ${n.join(", ")}`);
        }
        drawIcons();
      }
      if (e.kind === "tear") {
        C.pulse("the page tore", "hot");
      }
      if (e.kind === "turn") C.pulse(`turn done · +${fmt(e.value)} gold`, "task");
      if (e.kind === "clear") save();
    }
    g.events.length = 0;
    status();
  }
  function status() {
    C.setStatus({ count: fmt(g.wave), title: "wave", lead: `♥ ${g.lives}`, line: `${fmt(g.gold)} gold · ${g.towers.length} towers · ${g.queued()} waiting`, warm: g.busy() });
  }
  var TIPS = [
    "Tap empty paper to build a tower (or press B)",
    "Waves come from your Claude Code tokens: they fill the ink bucket",
    "Tap a tower to upgrade it: levels never end"
  ];
  function tip() {
    const el = $("tip"), text2 = TIPS[g.tips];
    el.hidden = mini() || !text2 || !!sel || !!buildAt || !!ghost;
    if (text2) $("tipText").textContent = text2;
  }
  function hud() {
    $("hLives").textContent = String(g.lives);
    $("hGold").textContent = fmt(g.gold);
    $("hWave").textContent = fmt(g.wave);
    $("bPause").classList.toggle("on", g.paused);
    $("bPause").textContent = g.paused ? "▶" : "Ⅱ";
    $("bSpeed").textContent = `${g.speed}×`;
    $("bAuto").classList.toggle("on", g.auto);
    const send = $("bSend");
    send.disabled = !g.ready();
    send.title = g.ready() ? "Send the next wave now" : `The bucket needs ${fmt(g.nextCost() - g.ink)} more tokens`;
    if (!$("buildCard").hidden) buildTiles();
    if (sel && !$("towerCard").hidden) towerCard();
    tip();
  }
  $("bPause").onclick = () => {
    g.paused = !g.paused;
    hud();
    wake(true);
  };
  $("bSpeed").onclick = () => {
    g.speed = g.speed === 1 ? 2 : g.speed === 2 ? 4 : 1;
    hud();
    save();
  };
  $("bAuto").onclick = () => {
    g.auto = !g.auto;
    hud();
    save();
  };
  $("bSend").onclick = () => {
    if (g.send()) {
      news();
      hud();
      wake(true);
    }
  };
  $("bBuild").onclick = () => {
    if ($("buildCard").hidden) openBuild(null);
    else closeAll();
  };
  var buildAt = null;
  function drawIcons() {
    for (const cv of $("buildTiles").querySelectorAll("canvas")) {
      const id = cv.dataset.t, ctx = cv.getContext("2d"), d = Math.min(2, window.devicePixelRatio || 1);
      cv.width = 44 * d;
      cv.height = 44 * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, 44, 44);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const pen = new Pen(ctx, P), k = TOWERS[id].size === 3 ? 0.55 : 0.62;
      sketch(pen, id, 1, 22, id === "tack" ? 30 : 40, k, 3, -0.6, 0, false, 0);
    }
  }
  function buildTiles() {
    const best = Math.max(1, g.stats.best);
    for (const b of $("buildTiles").querySelectorAll("button")) {
      const d = TOWERS[b.dataset.t], locked = d.unlock > best;
      b.classList.toggle("locked", locked);
      b.classList.toggle("poor", !locked && g.gold < d.cost);
      b.disabled = locked;
      b.querySelector(".cost").textContent = locked ? `wave ${d.unlock}` : `${fmt(d.cost)}g`;
    }
    const nx = nextUnlock(best);
    $("buildNote").textContent = nx ? `next: ${nx.name} at wave ${nx.unlock}` : "every tower is yours";
  }
  function openBuild(at) {
    closeAll();
    buildAt = at;
    $("buildTitle").textContent = at ? "build here?" : "build";
    $("buildCard").hidden = false;
    buildTiles();
    tip();
    wake(true);
  }
  $("buildTiles").innerHTML = TOWER_IDS.map((id) => {
    const d = TOWERS[id];
    return `<button class="tile" data-t="${id}" title="${d.name}: ${d.role}"><canvas data-t="${id}"></canvas><span class="nm">${d.name}</span><span class="cost"></span></button>`;
  }).join("");
  $("buildTiles").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const id = b.dataset.t;
    if (g.gold < TOWERS[id].cost) {
      say(`${TOWERS[id].name} costs ${fmt(TOWERS[id].cost)} gold`);
      return;
    }
    const at = buildAt;
    closeAll();
    if (at) {
      const [cx, cy] = snap(id, at[0], at[1]), spot = nearest(g.grid, id, cx, cy, 2);
      if (spot && g.build(id, spot[0], spot[1])) {
        built();
        return;
      }
    }
    startPlacing(id, at);
  });
  $("buildClose").onclick = () => closeAll();
  var ghost = null;
  var pointerDown = false;
  var lastPtr = null;
  function startPlacing(type, at, moving = null) {
    ghost = { type, cx: 0, cy: 0, why: "", moving };
    aimGhost(at ?? [W / 2, H / 2]);
    $("placing").hidden = false;
    $("placingText").textContent = moving ? `move the ${TOWERS[type].name}: tap a free spot` : `place the ${TOWERS[type].name}: tap a free spot`;
    tip();
    wake(true);
  }
  function aimGhost(p) {
    if (!ghost) return;
    const [cx, cy] = snap(ghost.type, p[0], p[1]), ign = ghost.moving?.id ?? 0;
    const spot = nearest(g.grid, ghost.type, cx, cy, 1, ign) ?? [Math.max(-1, Math.min(COLS, cx)), Math.max(-1, Math.min(ROWS, cy))];
    ghost.cx = spot[0];
    ghost.cy = spot[1];
    ghost.why = g.grid.why(ghost.type, ghost.cx, ghost.cy, ign) || (!ghost.moving && g.gold < TOWERS[ghost.type].cost ? "not enough gold" : "");
  }
  function placeGhost() {
    if (!ghost || ghost.why) {
      if (ghost) say(ghost.why);
      return false;
    }
    if (ghost.moving) {
      const t = ghost.moving;
      if (!g.move(t, ghost.cx, ghost.cy)) return false;
      closeAll();
      select(t);
      save();
      return true;
    }
    if (!g.build(ghost.type, ghost.cx, ghost.cy)) return false;
    closeAll();
    built();
    return true;
  }
  function built() {
    hud();
    status();
    save();
    wake(true);
  }
  $("placingCancel").onclick = () => closeAll();
  var sel = null;
  function select(t) {
    closeAll();
    sel = t;
    if (t) {
      $("towerCard").hidden = false;
      towerCard();
    }
    tip();
    wake(true);
  }
  function towerCard() {
    const t = sel;
    if (!t || !g.towers.includes(t)) {
      select(null);
      return;
    }
    const d = TOWERS[t.type], s = t.st, up = g.upgradeCost(t);
    $("tName").textContent = d.name;
    $("tLevel").textContent = `level ${t.level < 40 ? ROMAN(t.level) : fmt(t.level)}`;
    $("tRole").textContent = d.role;
    const cheer = t.cheer ? ` · cheered +${Math.round(t.cheer * 100)}%` : "";
    const lines = [];
    if (t.type === "flag") lines.push(`cheer +${Math.round(s.aura * 100)}% · reach ${Math.round(s.range / CELL)}`);
    else if (t.type === "well") lines.push(`gold ×${fmt(s.aura)} · reach ${Math.round(s.range / CELL)}`);
    else lines.push(`${fmt(s.dmg)} dmg · ${s.rate ? s.rate.toFixed(1) + "/s · " : ""}reach ${Math.round(s.range / CELL)}`, `≈ ${fmt(dps(t.type, s) * (1 + t.cheer))} a second${cheer}`);
    lines.push(`${fmt(t.kills)} beaten`);
    $("tStats").textContent = lines.join("\n");
    const next = (Math.floor(t.level / 10) + 1) * 10;
    $("tFlavor").textContent = `${d.flavor} · next milestone: level ${fmt(next)}`;
    const ten = affordable(t.type, t.level, Infinity, 10), most = affordable(t.type, t.level, g.gold);
    setBtn("tUp1", `+1 · ${fmt(up)}g`, g.gold >= up);
    setBtn("tUp10", `+10 · ${fmt(ten.cost)}g`, g.gold >= ten.cost);
    setBtn("tUpMax", most.levels ? `+${fmt(most.levels)} · ${fmt(most.cost)}g` : "max", most.levels > 0);
    $("tAim").textContent = `aim: ${t.aim}`;
    $("tAim").hidden = t.type === "flag" || t.type === "well" || t.type === "tack";
    $("tSell").textContent = `sell +${fmt(sellValue(t.type, t.level))}g`;
  }
  function setBtn(id, text2, on) {
    const b = $(id);
    b.textContent = text2;
    b.disabled = !on;
  }
  function upgrade(n) {
    if (!sel) return;
    const got = g.upgrade(sel, n);
    if (!got) {
      say("not enough gold");
      return;
    }
    if (g.tips === 2) g.tips = 3;
    towerCard();
    hud();
    status();
    save();
    wake(true);
  }
  $("tUp1").onclick = () => upgrade(1);
  $("tUp10").onclick = () => upgrade(10);
  $("tUpMax").onclick = () => upgrade(Infinity);
  $("tAim").onclick = () => {
    if (sel) {
      g.setAim(sel);
      towerCard();
      save();
    }
  };
  $("tMove").onclick = () => {
    const t = sel;
    if (t) {
      closeAll();
      startPlacing(t.type, [t.x, t.y], t);
    }
  };
  $("tSell").onclick = () => {
    const t = sel;
    if (t) {
      const got = g.sell(t);
      select(null);
      say(`sold for ${fmt(got)} gold`);
      built();
    }
  };
  $("tClose").onclick = () => select(null);
  function closeAll() {
    sel = null;
    ghost = null;
    buildAt = null;
    $("buildCard").hidden = true;
    $("towerCard").hidden = true;
    $("placing").hidden = true;
    tip();
    wake(true);
  }
  canvas.addEventListener("pointermove", (e) => {
    if (mini()) return;
    lastPtr = toPage(e.clientX, e.clientY);
    if (ghost && e.pointerType === "mouse") {
      aimGhost(lastPtr);
      wake(true);
    }
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (mini() || e.button !== 0) return;
    pointerDown = true;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!pointerDown || mini()) return;
    pointerDown = false;
    const p = toPage(e.clientX, e.clientY);
    if (ghost) {
      const before = [ghost.cx, ghost.cy];
      aimGhost(p);
      if (e.pointerType !== "mouse" && (before[0] !== ghost.cx || before[1] !== ghost.cy)) {
        wake(true);
        return;
      }
      placeGhost();
      return;
    }
    const t = g.towerAt(p[0], p[1]) ?? tackAt(p);
    if (t) {
      select(t === sel ? null : t);
      return;
    }
    if (sel || !$("buildCard").hidden) {
      closeAll();
      return;
    }
    if (p[0] >= 0 && p[1] >= 0 && p[0] <= W && p[1] <= H) openBuild(p);
  });
  canvas.addEventListener("pointercancel", () => {
    pointerDown = false;
  });
  canvas.addEventListener("pointerleave", () => {
    pointerDown = false;
  });
  canvas.addEventListener("contextmenu", (e) => {
    if (sel === null && ghost === null && buildAt === null) return;
    e.preventDefault();
    closeAll();
  });
  function tackAt(p) {
    for (const t of g.towers) if (t.type === "tack" && Math.hypot(t.x - p[0], t.y - p[1]) < 18) return t;
    return null;
  }
  function renderPanel() {
    for (const b of $("themes").querySelectorAll("button")) b.classList.toggle("on", b.dataset.theme === S.theme);
    $("numbers").checked = S.numbers;
    const st = g.stats;
    $("statsNote").textContent = `best wave ${fmt(st.best)} · ${fmt(st.kills)} beaten · ${fmt(st.tokens)} tokens of ink · ${fmt(st.turns)} turns · ${fmt(st.tears)} torn pages`;
  }
  $("themes").innerHTML = THEMES.map((id) => `<button data-theme="${id}">${id === "dark" ? "Ink on dark" : id === "light" ? "Ink on paper" : "Follow the system"}</button>`).join("");
  $("themes").addEventListener("click", (e) => {
    const id = e.target.dataset.theme;
    if (id) C.set({ theme: id });
  });
  $("numbers").addEventListener("change", (e) => C.set({ numbers: e.target.checked }));
  $("tipClose").onclick = () => {
    g.tips = 9;
    tip();
    save();
  };
  function onKey(key) {
    if (mini()) return false;
    if (key === "b") {
      if ($("buildCard").hidden) openBuild(null);
      else closeAll();
      return true;
    }
    if (key === "p" || key === " ") {
      $("bPause").click();
      return true;
    }
    return false;
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !mini() && (ghost || sel || !$("buildCard").hidden)) closeAll();
  });
  new ResizeObserver(() => wake(true)).observe(root);
  mountShell({
    name: "Ink Tower Defense",
    root,
    icon: ICON,
    settingsPanel: $("gamePanel"),
    keysHelp: "B builds · P or Space pauses · Esc cancels · right-click cancels placing",
    async start(ctx) {
      C = ctx;
      S = ctx.settings;
      scale = ctx.scale;
      dark = ctx.dark;
      smoke = ctx.smoke;
      root.classList.toggle("mini", scale === "mini");
      g = TDGame.load(await ctx.load(), (Date.now() & 65535) + 1);
      g.numbers = S.numbers;
      applyTheme();
      ready = true;
      lastSave = performance.now();
      status();
      hud();
      renderPanel();
      if (document.fonts) void document.fonts.load("700 20px Caveat").then(() => {
        drawIcons();
        wake(true);
      });
      wake(true);
    },
    onEvent(ev) {
      if (!ready) return;
      const before = g.queued();
      const got = g.feed(ev);
      if (got.tokens && g.queued() > before && !g.auto) C.pulse("a wave is ready to send");
      news();
      status();
      wake();
    },
    onSettings(s) {
      const theme = s.theme !== S?.theme;
      S = s;
      g.numbers = s.numbers;
      if (C) {
        if (theme) applyTheme();
        renderPanel();
        wake(true);
      }
    },
    onScale(s) {
      scale = s;
      root.classList.toggle("mini", s === "mini");
      if (s === "mini") closeAll();
      tip();
      if (C) wake(true);
    },
    onDark(d) {
      dark = d;
      if (C && S.theme === "system") applyTheme();
    },
    onPanel(open) {
      if (open) renderPanel();
    },
    onFullscreen() {
      wake(true);
    },
    onKey,
    onHide() {
      if (ready) {
        lastSave = performance.now();
        C.saveNow(g.save());
      }
    },
    onSleep(a) {
      asleep = a;
      if (a) {
        stop();
        save();
      } else wake(true);
    },
    testHooks
  });
  function testHooks() {
    return {
      state: () => ({
        ready,
        scale,
        frames,
        wave: g.wave,
        ink: g.ink,
        gold: g.gold,
        lives: g.lives,
        towers: g.towers.length,
        alive: g.alive(),
        queued: g.queued(),
        levels: g.towers.map((t) => t.level),
        tips: g.tips,
        theme: S.theme,
        dark: isDark(),
        numbers: g.numbers,
        paused: g.paused,
        speed: g.speed,
        sel: sel?.id ?? 0,
        ghost: ghost && { type: ghost.type, cx: ghost.cx, cy: ghost.cy, why: ghost.why },
        build: !$("buildCard").hidden,
        view: { ...view },
        stats: { ...g.stats }
      }),
      save: () => {
        save();
        return g.wave;
      },
      // a page point → where it is on screen, for dispatching real pointer events
      toScreen: (x, y) => {
        const r = canvas.getBoundingClientRect();
        return [r.left + view.ox + x * view.s, r.top + view.oy + y * view.s];
      },
      towerXY: (i) => [g.towers[i].x, g.towers[i].y],
      perfReset: () => Object.assign(meter, { since: performance.now(), frames: 0, draw: 0, step: 0, steps: 0, max: 0 }),
      perf: () => {
        const secs = (performance.now() - meter.since) / 1e3, r = (v) => Math.round(v * 100) / 100;
        return { fps: r(meter.frames / secs), frames: meter.frames, drawMs: r(meter.frames ? meter.draw / meter.frames : 0), maxDrawMs: r(meter.max), stepMs: r(meter.steps ? meter.step / meter.steps : 0), stepsPerFrame: r(meter.frames ? meter.steps / meter.frames : 0), canvas: [canvas.width, canvas.height], alive: g.alive(), towers: g.towers.length };
      },
      bench: (frames2 = 240) => bench(frames2)
    };
  }
  function bench(n) {
    const b = new TDGame(7);
    b.gold = 1e15;
    b.stats.best = 99;
    b.lives = 1e9;
    b.auto = false;
    b.numbers = true;
    let k = 0;
    for (let cy = 0; cy < ROWS && b.towers.length < 50; cy++) for (let cx = 0; cx < COLS && b.towers.length < 50; cx++) {
      const id = TOWER_IDS[k % TOWER_IDS.length];
      if (b.grid.ok(id, cx, cy) && b.build(id, cx, cy)) k++;
    }
    b.wave = 120;
    const fill = () => {
      while (b.alive() < 100) {
        b.ink = waveCost(b.wave + 1);
        if (!b.send()) break;
        for (let i = 0; i < 90; i++) b.step();
      }
    };
    fill();
    const cv = document.createElement("canvas");
    cv.width = canvas.width;
    cv.height = canvas.height;
    const r = new Renderer(cv.getContext("2d"), P);
    let step = 0, drawMs = 0, alive = 0;
    for (let i = 0; i < n; i++) {
      if (i % 30 === 0) fill();
      const t0 = performance.now();
      b.step();
      b.step();
      const t1 = performance.now();
      r.draw(b, { ...view, s: Math.min(view.w / W, view.h / H) }, { alpha: 0.5, t: i / 60, reduced: false, mini: false, sel: b.towers[0], ghost: null, toast: null });
      drawMs += performance.now() - t1;
      step += (t1 - t0) / 2;
      alive += b.alive();
    }
    const r2 = (v) => Math.round(v * 1e3) / 1e3;
    return { towers: b.towers.length, enemies: Math.round(alive / n), stepMs: r2(step / n), drawMs: r2(drawMs / n), frameMs: r2(drawMs / n + step / n * 2), canvasW: cv.width, canvasH: cv.height };
  }
})();
