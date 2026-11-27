"use strict";
(() => {
  // ../shell/src/events.ts
  var count = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  var text = (s, max = 64) => typeof s === "string" && s ? s.slice(0, max) : void 0;
  function normalizeEvent(raw, now2 = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    const e = raw;
    if (e.v !== void 0 && e.v !== 1) return null;
    const source = text(e.source, 32) || "unknown";
    const ts = typeof e.ts === "number" && Number.isFinite(e.ts) ? e.ts : now2;
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
    const sanitize2 = (raw, base = defaults()) => {
      const r = raw && typeof raw === "object" ? raw : {};
      return { ...sanitizeShell(r, base), ...game.sanitize(r, base) };
    };
    return {
      defaults,
      sanitize: sanitize2,
      applyPatch(cur, patch) {
        const next = sanitize2({ ...cur, ...patch }, cur);
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
  var SHELL_KEYS2 = /* @__PURE__ */ new Set(["Escape", ",", "o", "h", "1", "2", "f", "t", "d"]);
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
    tools.append(...game.barButtons || [], gear);
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
    const news = el("div", "tgh-news");
    body.append(tools, panel, news);
    let S2;
    let env = { scale: "mini", dark: false, reducedMotion: false, feed: { watching: false, files: 0 } };
    let feed2 = toFeedStatus(void 0);
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
    function applySettings2() {
      body.classList.toggle("tg-rm", S2.reducedMotion);
      if (started) game.onSettings?.(S2);
    }
    function set(patch) {
      S2 = withEnv(kit.applyPatch(S2, patch));
      persist();
      applySettings2();
    }
    function togglePanel(open = panel.hidden) {
      if (open === !panel.hidden) return;
      panel.hidden = !open;
      gear.classList.toggle("on", open);
      game.onPanel?.(open);
    }
    function pulse(text2, kind = "hot") {
      news.textContent = text2;
      news.className = "tgh-news show " + kind;
      clearTimeout(newsT);
      newsT = window.setTimeout(() => {
        news.className = "tgh-news";
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
        return feed2;
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
        applySettings2();
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
      feed2 = toFeedStatus(env.feed);
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
          applySettings2();
        }
        const f = toFeedStatus(next.feed);
        if (f.watching !== feed2.watching || f.files !== feed2.files) {
          feed2 = f;
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
  var PALETTE_IDS = ["original", "earth", "graphite", "slate", "dusk", "terminal", "blend"];
  var MAP_SIZE_IDS = ["large", "huge", "ridiculous"];
  var farmSettings = {
    defaults: (seed) => ({ palette: "blend", calm: 0, fadeIdle: false, perfReadout: false, mapSize: "ridiculous", seed: seed >>> 0 }),
    sanitize: (r, base) => ({
      palette: oneOf(PALETTE_IDS, r.palette, base.palette),
      calm: num(r.calm, 0, 1, base.calm),
      fadeIdle: bool(r.fadeIdle, base.fadeIdle),
      perfReadout: bool(r.perfReadout, base.perfReadout),
      mapSize: oneOf(MAP_SIZE_IDS, r.mapSize, base.mapSize),
      seed: typeof r.seed === "number" && Number.isFinite(r.seed) ? r.seed >>> 0 : base.seed
    }),
    // Reset puts every setting back to its default but keeps the farm's map.
    reset: (cur) => farmSettings.defaults(cur.seed)
  };
  var kit2 = settingsKit(farmSettings);
  var defaultSettings = kit2.defaults;
  var sanitize = kit2.sanitize;
  var applyPatch = kit2.applyPatch;
  var resetSettings = kit2.reset;

  // src/web/configure.ts
  configureHosted({ settings: kit2 });

  // src/sim/world.ts
  var AIR = 0;
  var DIRT = 1;
  var ROCK = 2;
  var LOOSE = 3;
  var FOOD = 4;
  var CRUMB = 5;
  var GLASS = 6;
  var SOLID = [false, true, true, true, true, true, true];
  var DIGGABLE = [false, true, false, true, true, true, false];
  var FALLS = [false, false, false, true, false, true, false];
  var CEILING = [false, true, false, false, true, false, false];
  var K = { SKY: 0, WALL: 1, SOIL: 2, GRASS: 3, LOOSE: 4, ROCK: 5, FOOD: 6, GLASS: 7, CRACK: 8, BROOD: 9, ANT: 10, QUEEN: 11, LOAD_FOOD: 12, LOAD_GRAIN: 13 };
  var TICK_HZ = 20;
  var DIG_TICKS = 4;
  var DROP_TICKS = 3;
  var BROOD_STAGES = [220, 480, 700];
  var MAX_ENERGY = 5e3;
  var LOOSE_CRUMB_CAP = 30;
  var SKY_ROWS = 12;
  var SKY_MARGIN = 6;
  var MAX_CRUMB_QUEUE = 40;
  var STORE_CAP = 80;
  var MAP_SIZES = {
    classic: { W: 420, H: 260, name: "Classic" },
    large: { W: 2048, H: 1024, name: "Large" },
    huge: { W: 8192, H: 4096, name: "Huge" },
    ridiculous: { W: 65536, H: 16384, name: "Ridiculous" }
  };
  var HOUR = 36e5;
  var ANT_LIFESPAN_MS = 48 * HOUR;
  var LIFESPAN_JITTER = 0.15;
  var QUEEN_LIFESPAN_MS = 14 * 24 * HOUR;
  var ANT_MEAL_MS = 6 * HOUR;
  var STARVE_DEATH_MS = 45 * 6e4;
  var STARVE_GRACE_MS = 7 * 24 * HOUR;
  var MIN_SURVIVORS = 2;
  var DYING_TICKS = 60;
  var LAYERS = {
    topsoil: { col: "#4d3b2d", span: 10 },
    loam: { col: "#6d5240", span: 14 },
    sand: { col: "#a2875f", span: 8 },
    clay: { col: "#8a5a43", span: 20 },
    deep: { col: "#5b4536", span: 16 }
  };
  var PAL = {
    skyTop: "#232a3a",
    skyLow: "#3a4356",
    grass: "#5f6d47",
    rock: "#6f737b",
    glass: "#1a1e27",
    seed: "#d4a65e",
    fungus: "#9fb06c",
    crumb: "#ecc87e"
  };
  function mulberry32(seed) {
    let a = seed >>> 0;
    const f = function() {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    f.state = () => a;
    return f;
  }
  function hash01(seed, x, y, salt = 0) {
    let h = Math.imul(seed ^ 2654435769, 2246822507) ^ Math.imul(x | 0, 3266489909) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt + 1, 374761393);
    h = Math.imul(h ^ h >>> 15, 739982445);
    h = Math.imul(h ^ h >>> 12, 695872825);
    return ((h ^ h >>> 15) >>> 0) / 4294967296;
  }
  function noiseAt(seed, salt, x, step) {
    const i = Math.floor(x / step), f = (x - i * step) / step, e = (1 - Math.cos(f * Math.PI)) / 2;
    const a = hash01(seed, i, 0, salt) * 2 - 1, b = hash01(seed, i + 1, 0, salt) * 2 - 1;
    return a * (1 - e) + b * e;
  }
  var clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  var rgb = (r, g, b) => (4278190080 | clamp255(b) << 16 | clamp255(g) << 8 | clamp255(r)) >>> 0;
  function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function shadeHex(h, k, jitter) {
    const [r, g, b] = hexRgb(h);
    return rgb(r * k + jitter, g * k + jitter, b * k + jitter);
  }
  var scaleCol = (c, k) => rgb((c & 255) * k, (c >>> 8 & 255) * k, (c >>> 16 & 255) * k);
  var SRC = { GLASS: 0, TOPSOIL: 1, LOAM: 2, SAND: 3, CLAY: 4, DEEP: 5, GRASS: 6, ROCK: 7, SEED: 8, FUNGUS: 9, CRUMB: 10 };
  var LAYER_OF_SRC = ["deep", "topsoil", "loam", "sand", "clay", "deep"];
  var jitterShade = (j) => Math.max(0, Math.min(255, Math.round(j) + 128));
  var COLOURS = new Uint32Array(11 * 256);
  var LOOSE_COLOURS = new Uint32Array(11 * 256);
  var WALL_COLOURS = new Uint32Array(6 * 256);
  {
    const src = [PAL.glass, LAYERS.topsoil.col, LAYERS.loam.col, LAYERS.sand.col, LAYERS.clay.col, LAYERS.deep.col, PAL.grass, PAL.rock, PAL.seed, PAL.fungus, PAL.crumb];
    for (let s = 0; s < src.length; s++) for (let b = 0; b < 256; b++) {
      const c = s === SRC.GLASS ? shadeHex(PAL.glass, 1, 0) : s <= SRC.GRASS ? shadeHex(src[s], 1, b - 128) : s === SRC.CRUMB ? shadeHex(src[s], 0.9 + b / 255 * 0.2, 0) : shadeHex(src[s], 0.85 + b / 255 * 0.3, 0);
      COLOURS[s * 256 + b] = c;
      LOOSE_COLOURS[s * 256 + b] = scaleCol(c, 1.18);
      if (s >= 1 && s <= 5) WALL_COLOURS[s * 256 + b] = shadeHex(src[s], 0.36, (b - 128) * 0.3);
    }
  }

  // src/sim/chunks.ts
  var CS = 6;
  var CHUNK = 1 << CS;
  var CM = CHUNK - 1;
  var CELLS = CHUNK * CHUNK;
  var ChunkStore = class {
    // chunks generated so far (a measure of work)
    constructor(W, H, gen) {
      this.W = W;
      this.H = H;
      this.gen = gen;
      this.cw = Math.ceil(W / CHUNK);
      this.ch = Math.ceil(H / CHUNK);
    }
    cw;
    ch;
    map = /* @__PURE__ */ new Map();
    last = null;
    scratchT = new Uint8Array(CELLS);
    scratchC = new Uint16Array(CELLS);
    tick = 0;
    made = 0;
    // The chunk, made or unpacked if it has to be. The hot path: one compare when it's the same chunk as last time.
    get(ci) {
      const l = this.last;
      if (l && l.ci === ci) return l;
      let c = this.map.get(ci);
      if (!c) {
        const cx = ci % this.cw, cy = (ci - cx) / this.cw;
        c = { ci, cx, cy, type: new Uint8Array(CELLS), col: new Uint16Array(CELLS), packed: null, modified: false, ver: 0, used: this.tick };
        this.gen(cx, cy, c.type, c.col);
        this.made++;
        this.map.set(ci, c);
      } else if (!c.type) this.unpack(c);
      c.used = this.tick;
      this.last = c;
      return c;
    }
    peek(ci) {
      return this.map.get(ci);
    }
    ver(ci) {
      const c = this.map.get(ci);
      return c ? c.ver : 0;
    }
    // A chunk's cells into the given arrays without loading it (for drawing a part of the map nobody is using).
    read(ci, type, col) {
      const c = this.map.get(ci);
      if (c && c.type) {
        type.set(c.type);
        col.set(c.col);
        return;
      }
      const cx = ci % this.cw, cy = (ci - cx) / this.cw;
      this.gen(cx, cy, type, col);
      if (c && c.packed) applyDiff(c.packed, type, col);
    }
    // Drop unused clean chunks beyond `cap`, oldest first, and pack changed ones nobody has used for `packAfter` ticks.
    // `keep(ci)` protects the chunks around the colony and the camera.
    maintain(keep, cap = 256, packAfter = 1200) {
      const clean = [];
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
    pack(c) {
      if (!c.type) return;
      this.gen(c.cx, c.cy, this.scratchT, this.scratchC);
      c.packed = diff(this.scratchT, this.scratchC, c.type, c.col);
      c.type = null;
      c.col = null;
      if (this.last === c) this.last = null;
    }
    unpack(c) {
      const t = new Uint8Array(CELLS), col = new Uint16Array(CELLS);
      this.gen(c.cx, c.cy, t, col);
      applyDiff(c.packed, t, col);
      c.type = t;
      c.col = col;
      c.packed = null;
    }
    stats() {
      let loaded = 0, modified = 0, packed = 0, bytes = 0;
      for (const c of this.map.values()) {
        if (c.modified) modified++;
        if (c.type) {
          loaded++;
          bytes += CELLS * 3;
        } else if (c.packed) {
          packed++;
          bytes += c.packed.length;
        }
      }
      return { loaded, modified, packed, bytes };
    }
    // Every changed chunk as its differences from the generated one, for the save file.
    saveChanged() {
      const out = [];
      for (const c of this.map.values()) {
        if (!c.modified) continue;
        if (c.packed) {
          out.push([c.ci, c.packed]);
          continue;
        }
        this.gen(c.cx, c.cy, this.scratchT, this.scratchC);
        out.push([c.ci, diff(this.scratchT, this.scratchC, c.type, c.col)]);
      }
      return out;
    }
    // Put back a changed chunk from the save file (kept packed until something reads it).
    restore(ci, packed, ver = 1) {
      const cx = ci % this.cw, cy = (ci - cx) / this.cw;
      this.map.set(ci, { ci, cx, cy, type: null, col: null, packed, modified: true, ver, used: this.tick });
      if (this.last && this.last.ci === ci) this.last = null;
    }
  };
  function putVar(out, v) {
    while (v >= 128) {
      out.push(v & 127 | 128);
      v >>>= 7;
    }
    out.push(v);
  }
  function diff(gt, gc, t, c) {
    const out = [];
    const same2 = (i2) => gt[i2] === t[i2] && (t[i2] === 0 || gc[i2] === c[i2]);
    let i = 0;
    while (i < CELLS) {
      let s = 0;
      while (i + s < CELLS && same2(i + s)) s++;
      let d = 0;
      while (i + s + d < CELLS && !same2(i + s + d)) d++;
      putVar(out, s);
      putVar(out, d);
      for (let j = i + s; j < i + s + d; j++) {
        const cc = t[j] === 0 ? 0 : c[j];
        out.push(t[j], cc & 255, cc >>> 8);
      }
      i += s + d;
    }
    return Uint8Array.from(out);
  }
  function applyDiff(p, t, c) {
    let at = 0, i = 0;
    const getVar = () => {
      let v = 0, sh = 0, b;
      do {
        b = p[at++];
        v |= (b & 127) << sh;
        sh += 7;
      } while (b & 128);
      return v;
    };
    while (at < p.length && i < CELLS) {
      i += getVar();
      const d = getVar();
      for (let j = 0; j < d; j++, i++) {
        t[i] = p[at];
        c[i] = p[at + 1] | p[at + 2] << 8;
        at += 3;
      }
    }
  }

  // src/sim/tokens.ts
  var TOKENS_PER_ENERGY = 15;
  var TOKENS_PER_CRUMB = 2500;
  var CACHE_READ_WEIGHT = 0.1;
  var SOFT_CAP = 2e5;
  var HOUR_MS = 36e5;
  function weigh(e) {
    const n = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
    return n(e.input) + n(e.output) + n(e.cache_write) + CACHE_READ_WEIGHT * n(e.cache_read) + n(e.tokens);
  }
  function capped(total, cap = SOFT_CAP) {
    return total <= cap ? total : cap + cap * Math.log(1 + (total - cap) / cap);
  }
  var TokenMeter = class {
    constructor(cap = SOFT_CAP) {
      this.cap = cap;
    }
    window = [];
    sum = 0;
    hourTotal() {
      return this.sum;
    }
    // The last hour's batches, for the save file, and back.
    save() {
      return this.window.map((e) => [e.ts, e.w]);
    }
    load(list) {
      this.window = Array.isArray(list) ? list.filter((e) => Array.isArray(e) && e.length === 2 && e.every(Number.isFinite)).map(([ts, w]) => ({ ts, w })) : [];
      this.sum = this.window.reduce((s, e) => s + e.w, 0);
    }
    add(e, ts) {
      while (this.window.length && this.window[0].ts <= ts - HOUR_MS) this.sum -= this.window.shift().w;
      if (this.sum < 1e-9) this.sum = 0;
      const weighted = weigh(e);
      const effective = capped(this.sum + weighted, this.cap) - capped(this.sum, this.cap);
      this.window.push({ ts, w: weighted });
      this.sum += weighted;
      return { weighted, effective, energy: effective / TOKENS_PER_ENERGY, crumbs: effective / TOKENS_PER_CRUMB };
    }
  };

  // src/sim/sim.ts
  var SMALL = 4194304;
  var STALL_TICKS = 600;
  var LOST_TICKS = 400;
  function createSim(opts2 = {}) {
    const R0 = opts2.restore && opts2.restore.v === 1 ? opts2.restore : null;
    const seed = ((R0 ? R0.seed : opts2.seed) ?? 1) >>> 0;
    const sz = opts2.size ? MAP_SIZES[opts2.size] : null;
    const W = R0 ? R0.W : opts2.W || (sz ? sz.W : 420), H = R0 ? R0.H : opts2.H || (sz ? sz.H : 260);
    let XB = 0;
    while (1 << XB < W) XB++;
    const R = 1 << XB, XM = R - 1;
    let workDone = 0, dugSeen = -1, dugAt = 0;
    const now2 = opts2.now || Date.now;
    const rnd = mulberry32(R0 ? R0.rng : seed);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const idx = (x, y) => y << XB | x;
    const inside = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
    const base = Math.round(Math.min(H, 260) * 0.17);
    const surf = new Int16Array(W), wob = new Int8Array(W);
    for (let x = 0; x < W; x++) {
      surf[x] = Math.round(base + noiseAt(seed, 1, x, 37) * 4 + noiseAt(seed, 2, x, 11) * 1.2);
      wob[x] = Math.round(noiseAt(seed, 3, x, 23) * 3);
    }
    const band = new Uint8Array(H + 8);
    {
      const br = mulberry32(seed ^ 1540483477), rr = (a, b) => a + Math.floor(br() * (b - a + 1));
      const order = [SRC.LOAM, SRC.SAND, SRC.LOAM, SRC.CLAY, SRC.SAND, SRC.DEEP, SRC.CLAY, SRC.LOAM];
      let d = rr(4, 7), oi = rr(0, 3);
      band.fill(SRC.TOPSOIL, 0, d);
      while (d < band.length) {
        const n = rr(14, 38);
        band.fill(order[oi++ % order.length], d, Math.min(band.length, d + n));
        d += n;
      }
    }
    const ex = Math.max(8, Math.min(W - 9, Math.round(W / 2 + (hash01(seed, 7, 7, 7) - 0.5) * Math.min(W, 420) * 0.3)));
    const spanOf = (x, y) => opts2.span || LAYERS[LAYER_OF_SRC[band[Math.max(0, Math.min(H, y - surf[x] + wob[x]))]]].span;
    const NONE = { x: 0, y: 0, r: 0, kind: -1 };
    const rockCache = /* @__PURE__ */ new Map(), podCache = /* @__PURE__ */ new Map();
    const PR = 96, pcw = Math.ceil(W / PR);
    function rockOf(rx, ry) {
      const key = ry * 65536 + rx;
      let b = rockCache.get(key);
      if (b) return b;
      b = NONE;
      if (opts2.rocks !== false) {
        const depth = ry * 64 - base, chance = depth < 0 ? 0 : 0.22 + 0.25 * Math.min(1, depth / 2e3);
        if (hash01(seed, rx, ry, 11) < chance) {
          const x = rx * 64 + 8 + Math.floor(hash01(seed, rx, ry, 12) * 48), y = ry * 64 + 8 + Math.floor(hash01(seed, rx, ry, 13) * 48);
          const ok = x >= 10 && x < W - 10 && y < H - 8 && y >= surf[x] + 12 && !(Math.abs(x - ex) < 30 && y < surf[ex] + 45);
          if (ok) b = { x, y, r: 2 + hash01(seed, rx, ry, 14) * 4, kind: SRC.ROCK };
        }
      }
      if (rockCache.size > 8192) rockCache.clear();
      rockCache.set(key, b);
      return b;
    }
    function podOf(id) {
      let b = podCache.get(id);
      if (b) return b;
      b = NONE;
      if (opts2.food !== false) {
        const px = id % pcw, py = (id - px) / pcw;
        if (hash01(seed, px, py, 21) < 0.8) {
          const x = px * PR + 12 + Math.floor(hash01(seed, px, py, 22) * 72), y = py * PR + 12 + Math.floor(hash01(seed, px, py, 23) * 72);
          const ok = x >= 8 && x < W - 9 && y < H - 8 && y >= surf[x] + 18 && Math.hypot(x - ex, y - surf[ex]) >= 30;
          if (ok) b = { x, y, r: 1.6 + hash01(seed, px, py, 24) * 1.8, kind: hash01(seed, px, py, 25) < 0.6 ? SRC.SEED : SRC.FUNGUS };
        }
      }
      if (podCache.size > 8192) podCache.clear();
      podCache.set(id, b);
      return b;
    }
    const podId = (x, y) => (y / PR | 0) * pcw + (x / PR | 0);
    function inBlob(b, x, y, salt) {
      if (b.kind < 0) return false;
      const dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
      if (d2 > (b.r * 1.15 + 0.5) * (b.r * 1.15 + 0.5)) return false;
      const rr = b.r * (0.85 + 0.3 * hash01(seed, x, y, salt));
      return d2 <= rr * rr;
    }
    function cellAt(x, y) {
      if (x <= 0 || x >= W - 1 || y >= H - 1 || y < 0) return GLASS;
      const s = surf[x];
      if (y < s) return AIR;
      if (y > s && inBlob(rockOf(x >> 6, y >> 6), x, y, 15)) return ROCK | (SRC.ROCK << 8 | Math.floor(hash01(seed, x, y, 16) * 256)) << 8;
      const pod = podOf(podId(x, y));
      if (y > s && inBlob(pod, x, y, 26)) return FOOD | (pod.kind << 8 | Math.floor(hash01(seed, x, y, 27) * 256)) << 8;
      const j = (hash01(seed, x, y, 17) - 0.5) * 14 + ((x * 7 + y * 13) % 5 === 0 ? -6 : 0);
      const src = y === s ? SRC.GRASS : band[Math.max(0, Math.min(H, y - s + wob[x]))];
      return DIRT | (src << 8 | jitterShade(j)) << 8;
    }
    function genChunk(cx, cy, t, c) {
      const x0 = cx << CS, y0 = cy << CS;
      for (let ly = 0, i = 0; ly < 64; ly++) for (let lx = 0; lx < 64; lx++, i++) {
        const x = x0 + lx, y = y0 + ly;
        if (x >= W || y >= H) {
          t[i] = GLASS;
          c[i] = 0;
          continue;
        }
        const v = cellAt(x, y);
        t[i] = v & 255;
        c[i] = v >>> 8;
      }
    }
    const store = new ChunkStore(W, H, genChunk), cw = store.cw;
    function T(k) {
      if (k < 0) return GLASS;
      const x = k & XM, y = k >> XB;
      if (x >= W || y >= H) return GLASS;
      return store.get((y >> CS) * cw + (x >> CS)).type[(y & CM) << CS | x & CM];
    }
    function C2(k) {
      const x = k & XM, y = k >> XB;
      return store.get((y >> CS) * cw + (x >> CS)).col[(y & CM) << CS | x & CM];
    }
    function write(k, t, c) {
      const x = k & XM, y = k >> XB, ch = store.get((y >> CS) * cw + (x >> CS)), i = (y & CM) << CS | x & CM;
      ch.type[i] = t;
      if (c !== void 0) ch.col[i] = c;
      ch.modified = true;
      ch.ver++;
      mark(x, y);
    }
    const dirty = { x0: 1, y0: 1, x1: 0, y1: 0 }, idirty = { x0: 1, y0: 1, x1: 0, y1: 0 };
    const awake = /* @__PURE__ */ new Set();
    function grow(b, x, y) {
      if (b.x0 > b.x1) {
        b.x0 = b.x1 = x;
        b.y0 = b.y1 = y;
        return;
      }
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
    function mark(x, y) {
      grow(dirty, x, y);
      grow(idirty, x, y);
      const a = (Math.max(0, y - 1) >> CS) * cw, b = (Math.min(H - 1, y + 1) >> CS) * cw, l = Math.max(0, x - 1) >> CS, r = Math.min(W - 1, x + 1) >> CS;
      awake.add(a + l);
      awake.add(a + r);
      awake.add(b + l);
      awake.add(b + r);
    }
    const occ = /* @__PURE__ */ new Map();
    const occAdd = (k, d) => {
      const n = (occ.get(k) || 0) + d;
      if (n > 0) occ.set(k, n);
      else occ.delete(k);
    };
    let lowest = H;
    for (let x = 0; x < W; x++) if (surf[x] < lowest) lowest = surf[x];
    const skyTop = Math.max(1, lowest - SKY_ROWS);
    const sim2 = {
      seed,
      W,
      H,
      XB,
      R,
      surf,
      pockets: /* @__PURE__ */ new Map(),
      ex,
      nest: { x: ex + 5, y: 0 },
      tick: 0,
      version: 0,
      rnd,
      ants: [],
      brood: [],
      projects: [],
      strains: [],
      events: [],
      energy: opts2.energy == null ? 320 : opts2.energy,
      crumbQueue: 0,
      galleryQueue: [],
      scent: 40,
      royal: null,
      broodRoom: null,
      view: null,
      top: skyTop,
      box: { x0: ex - 1, y0: surf[ex] - 1, x1: ex + 1, y1: surf[ex] + 1 },
      // everything the colony has touched
      sandAwake: false,
      moves: 0,
      falling: 0,
      crumbsOut: 0,
      stats: { dug: 0, stored: 0, eaten: 0, laid: 0, born: 0, collapses: 0, crumbsSpawned: 0, tokens: 0, tasks: 0, died: 0, starved: 0, collected: 0, deepest: 0, oldestMs: 0 },
      fields: /* @__PURE__ */ new Map(),
      nextId: 1,
      meter: new TokenMeter(),
      life: { last: now2(), hunger: 0, starve: 0, starvingSince: 0, lastTokens: 0, started: opts2.colony === false ? 0 : now2(), over: 0 },
      chunks: store,
      now: now2
    };
    function touch(x, y) {
      const b = sim2.box;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
    function pocketAt(id) {
      let p = sim2.pockets.get(id);
      if (p) return p;
      const b = podOf(id);
      if (b.kind < 0) return null;
      p = { id, x: b.x, y: b.y, kind: b.kind === SRC.SEED ? "seed" : "fungus", total: 0, remaining: 0, claimed: false };
      for (let y = b.y - 5; y <= b.y + 5; y++) for (let x = b.x - 5; x <= b.x + 5; x++) if ((cellAt(x, y) & 255) === FOOD && podId(x, y) === id) p.total++;
      if (!p.total) return null;
      p.remaining = p.total;
      sim2.pockets.set(id, p);
      return p;
    }
    sim2.pocketsIn = function(b) {
      const out = [];
      for (let py = Math.max(0, Math.floor(b.y0 / PR)); py <= Math.min(Math.ceil(H / PR) - 1, Math.floor(b.y1 / PR)); py++)
        for (let px = Math.max(0, Math.floor(b.x0 / PR)); px <= Math.min(pcw - 1, Math.floor(b.x1 / PR)); px++) {
          const p = pocketAt(py * pcw + px);
          if (p) out.push(p);
        }
      return out;
    };
    function setCell(k, t, c) {
      if (T(k) === FOOD && t !== FOOD) {
        const x = k & XM, y = k >> XB, p = pocketAt(podId(x, y));
        if (p) p.remaining--;
      }
      write(k, t, c);
      sim2.version++;
      touch(k & XM, k >> XB);
      if (t !== AIR && t !== CRUMB) raiseSky(k >> XB);
    }
    function raiseSky(y) {
      if (y < sim2.top + SKY_MARGIN) sim2.top = Math.max(1, y - SKY_MARGIN);
    }
    function swap(a, b) {
      const ta = T(a), ca = C2(a), tb = T(b), cb = C2(b);
      write(a, tb, cb);
      write(b, ta, ca);
    }
    sim2.typeAt = T;
    sim2.colAt = C2;
    sim2.setCell = setCell;
    sim2.idx = idx;
    function walkable(k) {
      if (T(k) !== AIR) return false;
      if (!inside(k & XM, k >> XB)) return false;
      return SOLID[T(k - 1)] || SOLID[T(k + 1)] || SOLID[T(k - R)] || SOLID[T(k + R)] || SOLID[T(k - R - 1)] || SOLID[T(k - R + 1)] || SOLID[T(k + R - 1)] || SOLID[T(k + R + 1)];
    }
    sim2.walkable = walkable;
    function canStep(k, dx, dy) {
      if (dx === 0 || dy === 0) return true;
      return T(k + dx) === AIR || T(k + dy * R) === AIR;
    }
    const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    let snap2 = { x0: 0, y0: 0, w: 0, h: 0, t: new Uint8Array(0), ver: -1 };
    function windowBox() {
      let { x0, y0, x1, y1 } = sim2.box;
      for (const a of sim2.ants) {
        if (a.x < x0) x0 = a.x;
        if (a.x > x1) x1 = a.x;
        if (a.y < y0) y0 = a.y;
        if (a.y > y1) y1 = a.y;
      }
      const M = 64;
      return {
        x0: Math.max(0, x0 - M >> CS) << CS,
        y0: Math.max(0, y0 - M >> CS) << CS,
        x1: (Math.min(W - 1, x1 + M) >> CS << CS) + 63,
        y1: (Math.min(H - 1, y1 + M) >> CS << CS) + 63
      };
    }
    function getSnap() {
      const b = windowBox(), w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
      if (snap2.ver === sim2.version && snap2.x0 === b.x0 && snap2.y0 === b.y0 && snap2.w === w && snap2.h === h) return snap2;
      const t = snap2.t.length === w * h ? snap2.t : new Uint8Array(w * h);
      for (let cy = b.y0 >> CS; cy <= b.y1 >> CS; cy++) for (let cx = b.x0 >> CS; cx <= b.x1 >> CS; cx++) {
        const ct = store.get(cy * cw + cx).type, ox = (cx << CS) - b.x0, oy = (cy << CS) - b.y0;
        for (let ly = 0; ly < 64; ly++) t.set(ct.subarray(ly << CS, ly + 1 << CS), (oy + ly) * w + ox);
      }
      snap2 = { x0: b.x0, y0: b.y0, w, h, t, ver: sim2.version };
      return snap2;
    }
    function walkL(s, i) {
      const t = s.t, w = s.w;
      if (t[i] !== AIR) return false;
      const lx = i % w, ly = (i - lx) / w;
      if (lx < 1 || ly < 1 || lx >= w - 1 || ly >= s.h - 1) return false;
      const x = lx + s.x0, y = ly + s.y0;
      if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
      return SOLID[t[i - 1]] || SOLID[t[i + 1]] || SOLID[t[i - w]] || SOLID[t[i + w]] || SOLID[t[i - w - 1]] || SOLID[t[i - w + 1]] || SOLID[t[i + w - 1]] || SOLID[t[i + w + 1]];
    }
    let queue = new Int32Array(0);
    function computeField(f) {
      const s = getSnap(), n = s.w * s.h, w = s.w, t = s.t;
      if (f.dist.length !== n) f.dist = new Int32Array(n);
      if (queue.length < n) queue = new Int32Array(n);
      const dist = f.dist;
      dist.fill(-1);
      f.x0 = s.x0;
      f.y0 = s.y0;
      f.w = s.w;
      f.h = s.h;
      let qh = 0, qt = 0;
      for (const k of f.sources()) {
        const lx = (k & XM) - s.x0, ly = (k >> XB) - s.y0;
        if (k < 0 || lx < 0 || ly < 0 || lx >= w || ly >= s.h) continue;
        const i = ly * w + lx;
        if (dist[i] < 0 && walkL(s, i)) {
          dist[i] = 0;
          queue[qt++] = i;
        }
      }
      while (qh < qt) {
        const i = queue[qh++], d = dist[i] + 1;
        for (let j = 0; j < 8; j++) {
          const dx = D8[j][0], dy = D8[j][1], m = i + dx + dy * w;
          if (dist[m] >= 0 || t[m] !== AIR) continue;
          if (dx !== 0 && dy !== 0 && t[i + dx] !== AIR && t[i + dy * w] !== AIR) continue;
          if (!walkL(s, m)) continue;
          dist[m] = d;
          queue[qt++] = m;
        }
      }
      f.ver = sim2.version;
      f.at = sim2.tick;
    }
    function distAt(f, k) {
      const lx = (k & XM) - f.x0, ly = (k >> XB) - f.y0;
      return lx < 0 || ly < 0 || lx >= f.w || ly >= f.h ? -1 : f.dist[ly * f.w + lx];
    }
    function field(key, sources) {
      let f = sim2.fields.get(key);
      if (!f) {
        f = { dist: new Int32Array(0), x0: 0, y0: 0, w: 0, h: 0, ver: -1, at: -99, sources };
        sim2.fields.set(key, f);
        computeField(f);
        return f;
      }
      f.sources = sources;
      if (f.ver !== sim2.version && sim2.tick - f.at >= 4) computeField(f);
      return f;
    }
    function near2(cx, cy, r) {
      const out = [];
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inside(x, y)) out.push(idx(x, y));
      return out;
    }
    function follow2(a, f) {
      const k = idx(a.x, a.y);
      let d = distAt(f, k);
      if (d === 0) return "arrived";
      if (d < 0 && sim2.tick - f.at > 0) {
        computeField(f);
        d = distAt(f, k);
        if (d === 0) return "arrived";
      }
      if (d < 0) return "stuck";
      let best = -1, bestD = d, ties = 0;
      for (const [dx, dy] of D8) {
        const n = k + dx + dy * R, nd = distAt(f, n);
        if (nd < 0 || nd > bestD || T(n) !== AIR || !canStep(k, dx, dy) || !walkable(n)) continue;
        if (nd < bestD) {
          bestD = nd;
          best = n;
          ties = 1;
        } else if (nd === bestD && best >= 0 && nd < d) {
          ties++;
          if (rnd() < 1 / ties) best = n;
        }
      }
      if (best < 0 || bestD >= d) {
        if (sim2.tick - f.at > 0) computeField(f);
        return "stuck";
      }
      moveTo(a, best);
      return "moved";
    }
    function moveTo(a, k) {
      const nx = k & XM, ny = k >> XB;
      a.hx = Math.sign(nx - a.x);
      a.hy = Math.sign(ny - a.y);
      const old = idx(a.x, a.y);
      occAdd(old, -1);
      occAdd(k, 1);
      if (FALLS[T(old - R)] || FALLS[T(old - R - 1)] || FALLS[T(old - R + 1)]) mark(a.x, a.y - 1);
      a.x = nx;
      a.y = ny;
      a.walk++;
      sim2.moves++;
    }
    function roomCells(room) {
      const cells = [];
      const { cx, cy, rx, ry, shape } = room;
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        if (!inside(x, y) || y <= surf[x] + 1) continue;
        const nx = (x - cx) / (rx + 0.5), ny = (y - cy) / (ry + 0.5);
        if (shape === "dome" && nx * nx + ny * ny > 1) continue;
        cells.push({ k: idx(x, y), o: nx * nx + ny * ny });
      }
      cells.sort((p, q) => p.o - q.o);
      return cells.map((c) => c.k);
    }
    function newProject(kind, startK, goal, room) {
      const p = {
        id: sim2.nextId++,
        kind,
        head: startK,
        goal,
        room,
        phase: goal ? "tunnel" : "room",
        ang: Math.atan2(goal ? goal.y - (startK >> XB) : 1, goal ? goal.x - (startK & XM) : 0),
        cells: room ? roomCells(room) : null,
        work: -1,
        done: false,
        stuck: 0,
        diggers: 0
      };
      sim2.projects.push(p);
      return p;
    }
    sim2.newProject = newProject;
    const hasAirNear = (k) => {
      for (const [dx, dy] of D8) if (walkable(k + dx + dy * R)) return true;
      return false;
    };
    function canDig(p, k) {
      const t = T(k);
      if (p.kind === "clear") return t === LOOSE || t === CRUMB;
      return DIGGABLE[t];
    }
    function nextCells(p) {
      p.cands = [];
      for (let guard = 0; guard < 6 && !p.done; guard++) {
        if (p.phase === "tunnel") {
          const hx = p.head & XM, hy = p.head >> XB;
          const dx = Math.round(Math.cos(p.ang)), dy = Math.round(Math.sin(p.ang));
          const nx = hx + dx, ny = hy + dy;
          if (!inside(nx, ny) || T(idx(nx, ny)) === ROCK || T(idx(nx, ny)) === GLASS || ny < surf[nx] - 1) {
            p.stuck++;
            p.ang += (p.stuck % 2 ? 1 : -1) * (Math.PI / 4) * Math.ceil(p.stuck / 2);
            if (p.stuck > 10) {
              p.done = true;
              p.failed = true;
            }
            continue;
          }
          const face = [[nx, ny], [nx - dy, ny + dx], [nx + dy, ny - dx], [nx + dx, ny + dy]];
          let solidFace = false;
          for (const [fx, fy] of face) {
            const k = idx(fx, fy);
            if (!inside(fx, fy) || fy < surf[fx] || !DIGGABLE[T(k)]) continue;
            if (hasAirNear(k)) p.cands.push(k);
            solidFace = true;
          }
          if (solidFace && !p.cands.length) {
            for (const [ox, oy] of D8) {
              const k = idx(nx + ox, ny + oy);
              if (inside(nx + ox, ny + oy) && ny + oy >= surf[nx + ox] && DIGGABLE[T(k)] && hasAirNear(k)) p.cands.push(k);
            }
            if (!p.cands.length) {
              p.stuck++;
              p.ang += (p.stuck % 2 ? 1 : -1) * (Math.PI / 4);
              if (p.stuck > 10) {
                p.done = true;
                p.failed = true;
              }
              continue;
            }
          }
          if (solidFace) return p.cands;
          p.head = idx(nx, ny);
          p.stuck = 0;
          const gx = p.goal.x - nx, gy = p.goal.y - ny;
          if (gx * gx + gy * gy <= 2) {
            if (p.cells) p.phase = "room";
            else {
              p.done = true;
              return p.cands;
            }
            continue;
          }
          let da = Math.atan2(gy, gx) - p.ang;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          p.ang += da * 0.35 + (rnd() - 0.5) * 0.7;
          continue;
        }
        for (const k of p.cells) if (canDig(p, k) && hasAirNear(k) && p.cands.push(k) >= 8) break;
        if (p.cands.length) return p.cands;
        if (p.kind === "food" && (pocketAt(p.pocket)?.remaining ?? 0) > 0) {
          const left = p.cells.find((k) => T(k) === FOOD);
          if (left != null) {
            p.phase = "tunnel";
            p.goal = { x: left & XM, y: left >> XB };
            continue;
          }
        }
        if (!p.cells.some((k) => canDig(p, k))) p.done = true;
        return p.cands;
      }
      return p.cands;
    }
    sim2.nextCells = nextCells;
    function underground(k) {
      return k >> XB > surf[k & XM];
    }
    function nearestTunnel(gx, gy) {
      let best = -1, bd = Infinity;
      const b = sim2.box, s = getSnap();
      const r = sim2.royal && sim2.royal.done && sim2.royal.room;
      for (let y = Math.max(1, b.y0); y <= Math.min(H - 2, b.y1); y++) for (let x = Math.max(1, b.x0); x <= Math.min(W - 2, b.x1); x++) {
        const i = (y - s.y0) * s.w + (x - s.x0);
        if (s.t[i] !== AIR || y <= surf[x] + 1 || !walkL(s, i)) continue;
        if (r && Math.abs(x - r.cx) <= r.rx + 2 && Math.abs(y - r.cy) <= r.ry + 2) continue;
        const d = (x - gx) * (x - gx) + (y - gy) * (y - gy);
        if (d < bd) {
          bd = d;
          best = idx(x, y);
        }
      }
      return { k: best, d: Math.sqrt(bd) };
    }
    function lifespan(role) {
      return (role === "queen" ? QUEEN_LIFESPAN_MS : ANT_LIFESPAN_MS) * (1 + (rnd() * 2 - 1) * LIFESPAN_JITTER);
    }
    function addAnt(x, y, role, born = now2()) {
      const r = role || "worker";
      const a = {
        id: sim2.nextId++,
        x,
        y,
        hx: 1,
        hy: 0,
        role: r,
        job: null,
        carry: null,
        carryCol: 0,
        busy: 0,
        acc: rnd(),
        speed: r === "queen" ? 0.25 : 0.75 + rnd() * 0.2,
        walk: 0,
        stuckT: 0,
        lost: 0,
        brood: null,
        born,
        dies: born + lifespan(r)
      };
      sim2.ants.push(a);
      occAdd(idx(x, y), 1);
      return a;
    }
    sim2.addAnt = (x, y, role) => addAnt(x, y, role);
    const queen = () => sim2.ants.find((a) => a.role === "queen" && !a.dying);
    function found(workers) {
      const sy = surf[ex] - 1;
      let qy = surf[sim2.nest.x] - 1;
      while (qy < H - 2 && T(idx(sim2.nest.x, qy + 1)) === AIR) qy++;
      sim2.nest.y = qy;
      addAnt(sim2.nest.x, qy, "queen");
      const t = now2();
      for (let i = 0; i < workers; i++) {
        const x = ex + ri(-6, 6);
        let y = sy;
        while (y < H - 2 && T(idx(x, y + 1)) === AIR) y++;
        addAnt(x, y, "worker", t - rnd() * ANT_LIFESPAN_MS * 0.5);
      }
    }
    if (opts2.colony !== false && !R0) {
      found(opts2.workers || 6);
      const sy = surf[ex] - 1;
      for (let i = 0; i < 4; i++) {
        const k = idx(ex + ri(-3, 3), sy - 6 - i);
        if (T(k) === AIR) {
          setCell(k, CRUMB, SRC.CRUMB << 8 | ri(64, 192));
          sim2.stats.crumbsSpawned++;
        }
      }
    }
    const storeRoom = () => sim2.royal && sim2.royal.done && !sim2.royal.failed ? sim2.royal.room : null;
    const storeSources = () => {
      const b = storeRect(), out = [];
      for (let y = Math.max(1, b.y0); y <= Math.min(H - 2, b.y1); y++) for (let x = Math.max(1, b.x0); x <= Math.min(W - 2, b.x1); x++) if (walkable(idx(x, y))) out.push(idx(x, y));
      if (out.length) return out;
      const r = storeRoom();
      return r ? near2(r.cx, r.cy + r.ry - 1, 3) : near2(sim2.nest.x, sim2.nest.y, 2);
    };
    const storeRect = () => {
      const r = storeRoom();
      return r ? { x0: r.cx - r.rx - 2, y0: r.cy - r.ry - 2, x1: r.cx + r.rx + 2, y1: r.cy + r.ry + 2 } : { x0: sim2.nest.x - 6, y0: sim2.nest.y - 4, x1: sim2.nest.x + 6, y1: sim2.nest.y + 4 };
    };
    const isStored = (x, y) => {
      const b = storeRect();
      return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    };
    function storedCells() {
      const b = storeRect(), out = [];
      for (let y = Math.max(1, b.y0); y <= Math.min(H - 2, b.y1); y++) for (let x = Math.max(1, b.x0); x <= Math.min(W - 2, b.x1); x++) if (T(idx(x, y)) === CRUMB) out.push(idx(x, y));
      return out;
    }
    sim2.stored = () => storedCells().length;
    function surfaceSources() {
      const out = [], s = getSnap();
      for (let x = Math.max(2, s.x0 + 1); x < Math.min(W - 2, s.x0 + s.w - 1); x++) {
        if (Math.abs(x - ex) < 4) continue;
        for (let y = Math.max(1, s.y0 + 1); y < Math.min(surf[x] + 1, s.y0 + s.h); y++) {
          if (s.t[(y - s.y0) * s.w + (x - s.x0)] !== AIR) {
            if (y > 1) out.push(idx(x, y - 1));
            break;
          }
        }
      }
      return out;
    }
    function crumbSources() {
      const out = [], s = getSnap(), b = sim2.box;
      for (let y = Math.max(s.y0 + 1, b.y0 - 2); y <= Math.min(s.y0 + s.h - 2, b.y1 + 2); y++) for (let x = s.x0 + 1; x < s.x0 + s.w - 1; x++) {
        const i = (y - s.y0) * s.w + (x - s.x0);
        if (s.t[i] === CRUMB && s.t[i + s.w] !== AIR && !isStored(x, y)) for (const [dx, dy] of D8) out.push(idx(x + dx, y + dy));
      }
      return out;
    }
    function looseCrumbs() {
      let n = 0;
      const b = sim2.box, s = getSnap();
      for (let y = Math.max(1, s.y0 + 1); y <= Math.min(b.y1 + 60, s.y0 + s.h - 2); y++) for (let x = Math.max(1, b.x0 - 60, s.x0); x <= Math.min(W - 2, b.x1 + 60, s.x0 + s.w - 1); x++) {
        const i = (y - s.y0) * s.w + (x - s.x0);
        if (s.t[i] === CRUMB && s.t[i + s.w] !== AIR && !isStored(x, y)) n++;
      }
      return n;
    }
    function dropNear(a, t, c, preferDx) {
      const k = idx(a.x, a.y);
      const tries = [[preferDx || a.hx || 1, 0], [-(preferDx || a.hx || 1), 0], [0, -1], [preferDx || 1, -1], [-(preferDx || 1), -1]];
      for (const [dx, dy] of tries) {
        const n = k + dx + dy * R;
        if (T(n) === AIR && inside(n & XM, n >> XB)) {
          setCell(n, t, c);
          return true;
        }
      }
      return false;
    }
    function assign(a) {
      const workers = sim2.ants.filter((b) => b.role === "worker" && !b.dying);
      if (sim2.broodRoom && sim2.broodRoom.done) {
        const b = sim2.brood.find((e) => !e.inRoom && !e.nurse);
        if (b) {
          b.nurse = a.id;
          a.job = { type: "nurse", id: b.id };
          return;
        }
      }
      if (sim2.crumbsOut > 0 && !(a.noForage > sim2.tick) && workers.filter((b) => b.job && b.job.type === "forage").length < Math.min(sim2.crumbsOut, Math.ceil(workers.length / 3))) {
        a.job = { type: "forage" };
        return;
      }
      if (sim2.energy >= 1) {
        const open = sim2.projects.filter((p2) => !p2.done);
        const rank = (p2) => p2.kind === "clear" ? 2 : p2.kind === "gallery" ? 1 : 0;
        open.sort((p2, q) => rank(q) - rank(p2) || p2.diggers - q.diggers);
        const p = open.find((q) => q.diggers < (q.phase === "tunnel" ? 3 : 5) && nextCells(q).length);
        if (p) {
          p.diggers++;
          a.job = { type: "dig", pid: p.id };
          return;
        }
      }
      a.job = { type: "rest", t: 30 + Math.floor(rnd() * 60) };
    }
    function release(a) {
      if (a.job && a.job.type === "dig") {
        const p = sim2.projects.find((q) => q.id === a.job.pid);
        if (p) p.diggers--;
      }
      if (a.job && a.job.type === "nurse") {
        const b = sim2.brood.find((e) => e.id === a.job.id);
        if (b && b.nurse === a.id && a.carry !== "brood") b.nurse = 0;
      }
      a.job = null;
    }
    const inView = (a) => {
      const v = sim2.view;
      return !v || a.x >= v.x0 && a.x <= v.x1 && a.y >= v.y0 && a.y <= v.y1;
    };
    function stepAnt(a) {
      const k = idx(a.x, a.y);
      if (T(k) !== AIR) {
        for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]]) {
          const n = k + dx + dy * R;
          if (T(n) === AIR && inside(n & XM, n >> XB)) {
            moveTo(a, n);
            return;
          }
        }
        if (!a.carry && a.role !== "queen" && DIGGABLE[T(k)]) {
          a.carry = T(k) === CRUMB || T(k) === FOOD ? "food" : "grain";
          a.carryCol = C2(k);
          setCell(k, AIR);
          return;
        }
        for (let y = a.y - 1; y > 0; y--) {
          const n = idx(a.x, y);
          if (T(n) === AIR) {
            const t = T(k), c = C2(k);
            setCell(k, AIR);
            setCell(n, t, c);
            return;
          }
        }
        return;
      }
      if (!walkable(k)) {
        if (T(k + R) === AIR) moveTo(a, k + R);
        return;
      }
      if (a.busy > 0) {
        a.busy--;
        return;
      }
      a.acc += a.speed * (sim2.energy >= 1 || a.carry ? 1 : 0.5);
      if (a.acc < 1) return;
      a.acc -= 1;
      if (a.role === "queen") return stepQueen(a);
      if (a.carry === "grain") {
        if (a.dumpX == null) {
          const r = follow2(a, field("surface", surfaceSources));
          if (r === "arrived") {
            const spread = 12 + Math.min(90, sim2.stats.dug / 25);
            a.dumpX = ex + (rnd() < 0.5 ? -1 : 1) * Math.round(18 + rnd() * spread);
            a.dumpAt = a.walk;
          } else if (r === "stuck") blocked(a);
          return;
        }
        if (a.x === a.dumpX || a.walk - a.dumpAt > 600 && Math.abs(a.x - ex) > 10) {
          if (dropNear(a, LOOSE, a.carryCol, a.x < ex ? -1 : 1)) {
            a.carry = null;
            a.dumpX = null;
            a.busy = DROP_TICKS;
          }
          return;
        }
        surfaceWalk(a, Math.sign(a.dumpX - a.x));
        return;
      }
      if (a.carry === "food") {
        const r = follow2(a, field("store", storeSources));
        if (r === "stuck" && (a.lost = (a.lost || 0) + 1) > LOST_TICKS) {
          a.lost = 0;
          eatCarried(a);
          return;
        }
        if (r !== "stuck") a.lost = 0;
        if (r === "arrived") {
          if (!storeRoom() || sim2.stored() >= STORE_CAP) {
            eatCarried(a);
            return;
          }
          let put = false;
          for (const [dx, dy] of [[a.hx || 1, 0], [-(a.hx || 1), 0], [0, -1], [1, -1], [-1, -1]]) {
            const n = k + dx + dy * R;
            if (T(n) === AIR && T(n + R) !== AIR && !occ.has(n) && isStored(n & XM, n >> XB)) {
              setCell(n, CRUMB, a.carryCol);
              put = true;
              break;
            }
          }
          if (put) {
            a.carry = null;
            a.busy = DROP_TICKS;
            sim2.stats.stored++;
          } else {
            const [dx, dy] = D8[Math.floor(rnd() * 8)];
            const n = k + dx + dy * R;
            if (walkable(n) && canStep(k, dx, dy) && isStored(n & XM, n >> XB)) moveTo(a, n);
          }
        } else if (r === "stuck") blocked(a);
        return;
      }
      if (!a.job) assign(a);
      const j = a.job;
      if (j.type === "rest") {
        if ((j.t = j.t - 1) <= 0) {
          release(a);
          return;
        }
        if (inView(a) && rnd() < 0.15) {
          const [dx, dy] = D8[Math.floor(rnd() * 8)];
          const n = k + dx + dy * R;
          if (walkable(n) && canStep(k, dx, dy) && underground(n) === underground(k)) moveTo(a, n);
        }
        return;
      }
      if (j.type === "forage") {
        if (sim2.crumbsOut <= 0) {
          release(a);
          return;
        }
        const r = follow2(a, field("crumbs", crumbSources));
        if (r === "arrived") {
          for (const [dx, dy] of D8) {
            const n = k + dx + dy * R;
            if (T(n) === CRUMB && !isStored(n & XM, n >> XB)) {
              a.carry = "food";
              a.carryCol = C2(n);
              setCell(n, AIR);
              a.busy = DIG_TICKS;
              sim2.crumbsOut--;
              sim2.stats.collected++;
              break;
            }
          }
          release(a);
        } else if (r === "stuck") {
          release(a);
          a.noForage = sim2.tick + 400;
          blocked(a, true);
        }
        return;
      }
      if (j.type === "nurse") {
        const b = sim2.brood.find((e) => e.id === j.id);
        if (!b) {
          release(a);
          return;
        }
        if (a.carry !== "brood") {
          const r2 = follow2(a, field("brood:" + b.id, () => near2(b.x, b.y, 1)));
          if (r2 === "arrived") {
            a.carry = "brood";
            a.brood = b;
            b.carried = true;
            sim2.fields.delete("brood:" + b.id);
          } else if (r2 === "stuck") {
            release(a);
          }
          return;
        }
        const room = sim2.broodRoom.room;
        const r = follow2(a, field("nursery", () => near2(room.cx, room.cy + room.ry - 1, 2)));
        if (r === "arrived") {
          b.x = a.x;
          b.y = a.y;
          b.carried = false;
          b.inRoom = true;
          b.nurse = 0;
          a.carry = null;
          a.brood = null;
          a.busy = DROP_TICKS;
          release(a);
        } else if (r === "stuck") blocked(a);
        return;
      }
      if (j.type === "dig") {
        const p = sim2.projects.find((q) => q.id === j.pid);
        if (!p || p.done || sim2.energy < 1) {
          release(a);
          return;
        }
        const cands = nextCells(p);
        if (!cands.length) {
          release(a);
          return;
        }
        const c = cands.find((n) => Math.max(Math.abs((n & XM) - a.x), Math.abs((n >> XB) - a.y)) <= 1);
        if (c !== void 0) {
          const cx = c & XM, cy = c >> XB, t = T(c);
          a.carry = t === FOOD || t === CRUMB ? "food" : "grain";
          a.carryCol = C2(c);
          a.hx = Math.sign(cx - a.x);
          a.hy = Math.sign(cy - a.y);
          if (t === FOOD) sim2.stats.collected++;
          if (p.kind !== "clear") sim2.stats.deepest = Math.max(sim2.stats.deepest, cy - surf[cx]);
          setCell(c, AIR);
          sim2.energy -= 1;
          sim2.stats.dug++;
          workDone++;
          a.busy = DIG_TICKS;
          release(a);
          return;
        }
        const r = follow2(a, field("work:" + p.id, () => p.cands.length ? p.cands.flatMap((n) => near2(n & XM, n >> XB, 1)) : [p.head]));
        if (r === "stuck") {
          if (++a.stuckT > 8) {
            a.stuckT = 0;
            release(a);
            blocked(a, true);
          }
        } else a.stuckT = 0;
      }
    }
    function eatCarried(a) {
      a.carry = null;
      a.busy = DROP_TICKS;
      sim2.stats.eaten++;
      sim2.life.hunger = Math.max(0, sim2.life.hunger - 1);
    }
    function blocked(a, now3) {
      const k = idx(a.x, a.y);
      if (!now3 && ++a.stuckT < 20) return;
      a.stuckT = 0;
      for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1]]) {
        const n = k + dx + dy * R;
        if (T(n) !== LOOSE) continue;
        if (!a.carry) {
          a.carry = "grain";
          a.carryCol = C2(n);
          setCell(n, AIR);
          sim2.stats.dug++;
          a.busy = DIG_TICKS;
          return;
        }
      }
      if (a.carry === "grain" && (underground(k) ? true : Math.abs(a.x - ex) > 10) && dropNear(a, LOOSE, a.carryCol)) {
        a.carry = null;
        a.dumpX = null;
      }
    }
    function surfaceWalk(a, s) {
      const k = idx(a.x, a.y);
      const opts22 = [[s, 1], [s, 0], [s, -1], [0, -1]];
      for (const [dx, dy] of opts22) {
        const n = k + dx + dy * R;
        if (walkable(n) && canStep(k, dx, dy) && T(n + R) !== AIR) {
          moveTo(a, n);
          return;
        }
      }
      for (const [dx, dy] of opts22) {
        const n = k + dx + dy * R;
        if (walkable(n) && canStep(k, dx, dy)) {
          moveTo(a, n);
          return;
        }
      }
      if (Math.abs(a.x - ex) > 10) a.dumpX = a.x;
      else a.dumpX = ex - (a.dumpX - ex);
    }
    function stepQueen(a) {
      const pop = sim2.ants.length + sim2.brood.length;
      if (sim2.royal && sim2.royal.done && !a.home) {
        const r = sim2.royal.room;
        const res = follow2(a, field("royal", () => near2(r.cx, r.cy + r.ry - 1, 1)));
        if (res === "arrived") a.home = true;
        return;
      }
      a.eggT = (a.eggT || 0) + 1;
      if (a.eggT >= 10 && pop < sim2.cap()) {
        a.eggT = 0;
        const crumbs = [];
        for (let y = a.y - 4; y <= a.y + 4; y++) for (let x = a.x - 6; x <= a.x + 6; x++) if (inside(x, y) && T(idx(x, y)) === CRUMB) crumbs.push(idx(x, y));
        if (crumbs.length >= 2) {
          setCell(crumbs[0], AIR);
          setCell(crumbs[1], AIR);
          sim2.stats.eaten += 2;
          sim2.brood.push({ id: sim2.nextId++, x: a.x, y: a.y, age: 0, stage: 0, inRoom: false, nurse: 0, carried: false });
          sim2.stats.laid++;
        }
      }
    }
    sim2.cap = () => Math.min(120, 10 + 8 * sim2.projects.filter((p) => p.done && p.room && !p.failed).length);
    function stepBrood() {
      const hungry = sim2.life.starvingSince > 0;
      for (let i = sim2.brood.length - 1; i >= 0; i--) {
        const b = sim2.brood[i];
        if (b.carried) {
          const n = sim2.ants.find((a) => a.brood === b);
          if (n) {
            b.x = n.x;
            b.y = n.y;
          }
          continue;
        }
        if (T(idx(b.x, b.y + 1)) === AIR) {
          b.y++;
          continue;
        }
        if (T(idx(b.x, b.y)) !== AIR) {
          b.y--;
          continue;
        }
        if (hungry) continue;
        b.age += b.inRoom ? 1 : 0.4;
        while (b.stage < 3 && b.age >= BROOD_STAGES[b.stage]) b.stage++;
        if (b.stage >= 3) {
          sim2.brood.splice(i, 1);
          addAnt(b.x, b.y, "worker");
          sim2.stats.born++;
        }
      }
    }
    function event(e) {
      sim2.events.push(e);
      if (sim2.events.length > 50) sim2.events.shift();
    }
    function die(a, cause, at) {
      release(a);
      a.dying = DYING_TICKS;
      if (a.carry === "grain" && !dropNear(a, LOOSE, a.carryCol)) setCell(idx(a.x, a.y - 1), LOOSE, a.carryCol);
      if (a.carry === "food" && !dropNear(a, CRUMB, a.carryCol)) setCell(idx(a.x, a.y - 1), CRUMB, a.carryCol);
      if (a.carry === "brood" && a.brood) {
        a.brood.carried = false;
        a.brood.nurse = 0;
      }
      a.carry = null;
      a.brood = null;
      if (cause === "age") sim2.stats.died++;
      else sim2.stats.starved++;
      sim2.stats.oldestMs = Math.max(sim2.stats.oldestMs, at - a.born);
      event({ type: "died", tick: sim2.tick, cause, queen: a.role === "queen" });
      if (a.role !== "queen") return;
      const heir = sim2.ants.filter((b) => b.role === "worker" && !b.dying).sort((p, q) => q.born - p.born)[0];
      if (!heir) return;
      release(heir);
      heir.role = "queen";
      heir.speed = 0.25;
      heir.home = false;
      heir.dies = at + lifespan("queen");
      event({ type: "queen", tick: sim2.tick });
    }
    function eatStored() {
      const cells = storedCells();
      if (!cells.length) return false;
      setCell(cells[0], AIR);
      sim2.stats.eaten++;
      return true;
    }
    function liveSlice(from, to) {
      const L = sim2.life, dt = to - from;
      for (const a of sim2.ants) if (!a.dying && a.dies <= to) die(a, "age", to);
      const alive = sim2.ants.filter((a) => !a.dying).length;
      if (!alive) {
        L.hunger = 0;
        L.starve = 0;
        L.starvingSince = 0;
        if (L.started && !L.over && !sim2.brood.length) {
          L.over = to;
          event({ type: "over", tick: sim2.tick });
        }
        return;
      }
      L.hunger += alive * dt / ANT_MEAL_MS;
      while (L.hunger >= 1 && eatStored()) L.hunger -= 1;
      if (L.hunger < 1) {
        L.starvingSince = 0;
        L.starve = 0;
        return;
      }
      L.hunger = Math.min(L.hunger, 3);
      if (!L.starvingSince) L.starvingSince = to;
      if (to - L.lastTokens < STARVE_DEATH_MS) return;
      L.starve += dt;
      while (L.starve >= STARVE_DEATH_MS) {
        L.starve -= STARVE_DEATH_MS;
        const workers = sim2.ants.filter((b) => b.role === "worker" && !b.dying), grace = to - L.starvingSince > STARVE_GRACE_MS;
        if (workers.length > MIN_SURVIVORS || grace && workers.length) die(workers.sort((p, q) => p.born - q.born)[0], "hunger", to);
        else if (grace) {
          const q = queen();
          if (q) die(q, "hunger", to);
        }
      }
    }
    function live() {
      const t = now2(), L = sim2.life;
      if (t < L.last) {
        L.last = t;
        return;
      }
      if (t - L.last < 1e3) return;
      for (let from = L.last; from < t; ) {
        const to = Math.min(t, from + 6e5);
        liveSlice(from, to);
        from = to;
      }
      L.last = t;
    }
    function bury() {
      for (let i = sim2.ants.length - 1; i >= 0; i--) {
        const a = sim2.ants[i];
        if (a.dying === void 0 || --a.dying > 0) continue;
        sim2.ants.splice(i, 1);
        occAdd(idx(a.x, a.y), -1);
      }
    }
    function plan() {
      for (const a of sim2.ants) raiseSky(a.y);
      const open = sim2.projects.filter((p) => !p.done);
      if (sim2.tick % 100 === 1) for (const r of sim2.projects) {
        if (!r.done || r.failed || !r.room || r.kind === "clear" || r.kind === "food") continue;
        let n = 0;
        for (const k of r.cells) if (T(k) === LOOSE) n++;
        if (n >= 6 && !open.some((p) => p.kind === "clear" && p.room.cx === r.room.cx && p.room.cy === r.room.cy)) {
          const c = newProject("clear", -1, null, r.room);
          c.cells.sort((a, b2) => a - b2);
          return;
        }
      }
      if (sim2.tick % 100 === 1 && unplug()) return;
      if (!sim2.royal || sim2.royal.failed) {
        if (sim2.royal) sim2.projects.splice(sim2.projects.indexOf(sim2.royal), 1);
        const gx = ex + ri(-10, 10), gy = surf[ex] + ri(24, 30);
        sim2.royal = newProject("royal", idx(ex, surf[ex] - 1), { x: gx, y: gy }, { cx: gx, cy: gy, rx: 7, ry: 3, shape: "dome" });
        return;
      }
      if (sim2.royal.done && (!sim2.broodRoom || sim2.broodRoom.failed)) {
        if (sim2.broodRoom) sim2.projects.splice(sim2.projects.indexOf(sim2.broodRoom), 1);
        const r = sim2.royal.room, side = rnd() < 0.5 ? -1 : 1;
        const gx = Math.max(12, Math.min(W - 12, r.cx + side * ri(14, 24))), gy = Math.min(H - 10, r.cy + ri(14, 20));
        const st = nearestTunnel(gx, gy);
        sim2.broodRoom = newProject("brood", st.k, { x: gx, y: gy }, { cx: gx, cy: gy, rx: 6, ry: 3, shape: "dome" });
        return;
      }
      if (sim2.galleryQueue.length && sim2.royal.done && !open.some((p) => p.kind === "gallery")) {
        const g = sim2.galleryQueue.shift();
        const spots = [];
        const b2 = sim2.box, s = getSnap();
        for (let y = Math.max(1, b2.y0); y <= Math.min(H - 2, b2.y1); y++) for (let x = Math.max(1, b2.x0); x <= Math.min(W - 2, b2.x1); x++) {
          const i = (y - s.y0) * s.w + (x - s.x0);
          if (s.t[i] === AIR && y > surf[x] + 8 && walkL(s, i)) spots.push(idx(x, y));
        }
        if (!spots.length) {
          sim2.galleryQueue.unshift(g);
          return;
        }
        const sp = spots[Math.floor(rnd() * spots.length)], side = rnd() < 0.5 ? -1 : 1;
        g.x = Math.max(4 + (g.w >> 1), Math.min(W - 5 - (g.w >> 1), (sp & XM) + side * ((g.w >> 1) + 3)));
        g.y = Math.min(H - 8, (sp >> XB) - 1);
        newProject("gallery", sp, { x: g.x - side * ((g.w >> 1) - 1), y: g.y + 1 }, { cx: g.x, cy: g.y, rx: g.w >> 1, ry: 2, shape: "flat" });
        return;
      }
      const workers = sim2.ants.length - 1;
      const max = Math.min(4, 1 + Math.floor(workers / 6));
      if (open.length >= max) return;
      if (!sim2.royal.done) return;
      const b = sim2.box, sc = sim2.scent;
      let best = null, bd = Infinity, bst = null;
      for (const p of sim2.pocketsIn({ x0: b.x0 - sc, y0: b.y0 - sc, x1: b.x1 + sc, y1: b.y1 + sc })) {
        if (p.claimed || p.remaining <= 0) continue;
        const st = nearestTunnel(p.x, p.y);
        if (st.k >= 0 && st.d <= sim2.scent && st.d < bd) {
          bd = st.d;
          best = p;
          bst = st;
        }
      }
      if (best) {
        best.claimed = true;
        const pr = newProject("food", bst.k, { x: best.x, y: best.y }, null);
        pr.cells = pocketCells(best);
        pr.pocket = best.id;
        return;
      }
      if (open.length === 0) {
        for (let i = 0; i < 30; i++) {
          const x = ri(b.x0, b.x1), y = ri(b.y0, b.y1), k = idx(x, y);
          if (T(k) !== AIR || y <= surf[x] + 3 || !walkable(k)) continue;
          const ang = Math.PI * (0.1 + rnd() * 0.8) + (rnd() < 0.3 ? rnd() < 0.5 ? -0.9 : 0.9 : 0), len = ri(22, 40);
          const gx = Math.max(6, Math.min(W - 7, Math.round(x + Math.cos(ang) * len))), gy = Math.max(surf[gx] + 8, Math.min(H - 6, Math.round(y + Math.sin(ang) * len)));
          newProject("scout", k, { x: gx, y: gy }, null);
          sim2.scent += 10;
          return;
        }
      }
    }
    function unplug() {
      if (workDone !== dugSeen) {
        dugSeen = workDone;
        dugAt = sim2.tick;
        return false;
      }
      if (sim2.tick - dugAt < STALL_TICKS || sim2.energy < 1) return false;
      const open = sim2.projects.filter((p) => !p.done);
      if (!open.length || open.some((p) => p.kind === "clear")) return false;
      dugAt = sim2.tick;
      const deep = Math.max(surf[ex] + 12, ...open.filter((p) => p.head >= 0).map((p) => (p.head >> XB) + 2));
      const cells = [];
      for (let y = Math.max(1, surf[ex] - 12); y <= Math.min(H - 2, deep); y++) for (let x = Math.max(1, ex - 8); x <= Math.min(W - 2, ex + 8); x++) {
        const t = T(idx(x, y));
        if (t === LOOSE || t === CRUMB) cells.push(idx(x, y));
      }
      if (!cells.length) return false;
      const c = newProject("clear", -1, null, { cx: ex, cy: surf[ex], rx: 8, ry: 2, shape: "flat" });
      c.cells = cells.sort((a, b) => a - b);
      return true;
    }
    function pocketCells(p) {
      const cells = [];
      for (let y = p.y - 5; y <= p.y + 5; y++) for (let x = p.x - 5; x <= p.x + 5; x++) if (inside(x, y) && podId(x, y) === p.id && T(idx(x, y)) === FOOD) cells.push(idx(x, y));
      return cells.sort((a, b) => Math.hypot((a & XM) - p.x, (a >> XB) - p.y) - Math.hypot((b & XM) - p.x, (b >> XB) - p.y));
    }
    function hot(cx, cy) {
      const x0 = cx << CS, y0 = cy << CS, x1 = x0 + 63, y1 = y0 + 63, b = sim2.box, v = sim2.view, M = 64;
      if (x1 >= b.x0 - M && x0 <= b.x1 + M && y1 >= b.y0 - M && y0 <= b.y1 + M) return true;
      return !v || x1 >= v.x0 && x0 <= v.x1 && y1 >= v.y0 && y0 <= v.y1;
    }
    function stepSand() {
      if (!awake.size) {
        sim2.sandAwake = false;
        sim2.falling = 0;
        return;
      }
      const list = [], later = [];
      for (const ci of awake) {
        const cx = ci % cw, cy = (ci - cx) / cw;
        if (sim2.tick % 8 && !hot(cx, cy)) later.push(ci);
        else list.push(ci);
      }
      awake.clear();
      for (const ci of later) awake.add(ci);
      const flip = sim2.tick & 1;
      list.sort((a, b) => {
        const ay = a / cw | 0, by = b / cw | 0;
        return by - ay || (flip ? b - a : a - b);
      });
      let moved = 0;
      for (let g = 0; g < list.length; ) {
        const cy = list[g] / cw | 0;
        let e = g;
        while (e < list.length && (list[e] / cw | 0) === cy) e++;
        for (let ly = 63; ly >= 0; ly--) {
          const y = (cy << CS) + ly;
          if (y < 1 || y > H - 2) continue;
          for (let c = g; c < e; c++) {
            const cx = list[c] % cw;
            for (let i = 0; i < 64; i++) {
              const x = (cx << CS) + (flip ? 63 - i : i);
              if (x < 1 || x > W - 2) continue;
              const k = y << XB | x;
              if (!FALLS[T(k)]) continue;
              const b = k + R;
              if (T(b) === AIR && !occ.has(b)) {
                swap(k, b);
                moved++;
                continue;
              }
              const d = rnd() < 0.5 ? -1 : 1;
              if (T(k + d) === AIR && T(b + d) === AIR && !occ.has(b + d)) {
                swap(k, b + d);
                moved++;
                continue;
              }
              if (T(k - d) === AIR && T(b - d) === AIR && !occ.has(b - d)) {
                swap(k, b - d);
                moved++;
              }
            }
          }
        }
        g = e;
      }
      if (moved) sim2.version++;
      sim2.sandAwake = awake.size > 0;
      sim2.falling = moved;
    }
    function checkCeilings() {
      const d = { ...dirty };
      dirty.x0 = 1;
      dirty.x1 = 0;
      const ceil = (x, y) => CEILING[T(idx(x, y))] && T(idx(x, y + 1)) === AIR;
      for (let y = Math.max(1, d.y0 - 2); y <= Math.min(H - 3, d.y1 + 1); y++) {
        let x = Math.max(1, d.x0 - 2);
        while (x > 1 && ceil(x - 1, y)) x--;
        const xe = Math.min(W - 2, d.x1 + 2);
        while (x <= xe) {
          if (ceil(x, y) && y >= surf[x]) {
            const x0 = x;
            while (x < W - 1 && ceil(x, y)) x++;
            const x1 = x - 1, L = x1 - x0 + 1, lim = spanOf(x0 + x1 >> 1, y) || 14;
            if (L > lim && !sim2.strains.some((s) => s.y === y && s.x0 <= x1 && s.x1 >= x0)) {
              const recent = sim2.events.some((e) => e.type === "collapse" && sim2.tick - e.tick < 60 && Math.abs(e.y - y) < 6);
              sim2.strains.push({ y, x0, x1, lim, t: recent ? 8 : 40 });
            }
          } else x++;
        }
      }
    }
    function stepStrains() {
      for (let i = sim2.strains.length - 1; i >= 0; i--) {
        const s = sim2.strains[i];
        if (--s.t > 0) continue;
        sim2.strains.splice(i, 1);
        const m = Math.max(1, Math.floor(s.lim / 4));
        let n = 0;
        for (let x = s.x0 + m; x <= s.x1 - m; x++) {
          const k = idx(x, s.y);
          if (CEILING[T(k)] && T(k + R) === AIR) {
            setCell(k, T(k) === FOOD ? CRUMB : LOOSE);
            n++;
          }
        }
        if (!n) continue;
        sim2.stats.collapses++;
        event({ type: "collapse", tick: sim2.tick, y: s.y, x0: s.x0 + m, x1: s.x1 - m });
        const open = sim2.projects.find((p) => p.kind === "clear" && !p.done && Math.abs(p.room.cy - s.y) < 10 && Math.abs(p.room.cx - (s.x0 + s.x1 >> 1)) < 20);
        if (!open) {
          const p = newProject("clear", -1, null, { cx: s.x0 + s.x1 >> 1, cy: s.y + 6, rx: (s.x1 - s.x0 >> 1) + 6, ry: 9, shape: "flat" });
          p.cells.sort((a, b) => a - b);
        }
      }
    }
    function checkIslands() {
      const x0 = Math.max(0, idirty.x0 - 64), y0 = Math.max(0, idirty.y0 - 64), x1 = Math.min(W - 1, idirty.x1 + 64), y1 = Math.min(H - 1, idirty.y1 + 64);
      idirty.x0 = 1;
      idirty.x1 = 0;
      const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h, t = new Uint8Array(n), seen = new Uint8Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = T(idx(x0 + x, y0 + y));
      const holds = (i) => SOLID[t[i]] && !FALLS[t[i]];
      if (queue.length < n) queue = new Int32Array(n);
      let qh = 0, qt = 0;
      for (let i = 0; i < n; i++) {
        const x = i % w, y = (i - x) / w;
        if (t[i] === GLASS || (x === 0 || y === 0 || x === w - 1 || y === h - 1) && holds(i)) {
          seen[i] = 1;
          queue[qt++] = i;
        }
      }
      while (qh < qt) {
        const i = queue[qh++], x = i % w;
        for (const m of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (m < 0 || m >= n || seen[m] || !holds(m)) continue;
          seen[m] = 1;
          queue[qt++] = m;
        }
      }
      for (let i = 0; i < n; i++) {
        if (seen[i] || !holds(i)) continue;
        const x = i % w, y = (i - x) / w;
        setCell(idx(x0 + x, y0 + y), t[i] === FOOD ? CRUMB : LOOSE);
      }
    }
    sim2.step = function() {
      sim2.tick++;
      store.tick = sim2.tick;
      sim2.moves = 0;
      live();
      if (sim2.crumbQueue >= 1 && sim2.tick % 5 === 0 && sim2.crumbsOut < LOOSE_CRUMB_CAP) {
        const x = Math.max(2, Math.min(W - 3, ex + (rnd() < 0.5 ? -1 : 1) * ri(8, 50)));
        const k = idx(x, sim2.top + 1);
        if (T(k) === AIR) {
          setCell(k, CRUMB, SRC.CRUMB << 8 | ri(0, 255));
          sim2.crumbQueue--;
          sim2.stats.crumbsSpawned++;
          sim2.crumbsOut++;
        }
      }
      if (sim2.tick % 20 === 1) {
        plan();
        sim2.crumbsOut = looseCrumbs();
      }
      for (let i = 0; i < sim2.ants.length; i++) if (sim2.ants[i].dying === void 0) stepAnt(sim2.ants[i]);
      bury();
      stepBrood();
      stepSand();
      if (sim2.tick % 5 === 0 && dirty.x0 <= dirty.x1) checkCeilings();
      stepStrains();
      if (sim2.tick % 60 === 0 && idirty.x0 <= idirty.x1) checkIslands();
      for (const [key, f] of sim2.fields) if (sim2.tick - f.at > 400) sim2.fields.delete(key);
      if (sim2.projects.length > 40) sim2.projects = sim2.projects.filter((p) => !p.done || p === sim2.royal || p === sim2.broodRoom);
      if (sim2.tick % 20 === 0) sim2.maintain();
    };
    sim2.run = function(n) {
      for (let i = 0; i < n; i++) sim2.step();
    };
    sim2.feed = function(ev) {
      if (!ev || sim2.life.over) return;
      if (ev.type === "tokens") {
        const c = sim2.meter.add(ev, ev.ts);
        sim2.stats.tokens += c.weighted;
        sim2.energy = Math.min(MAX_ENERGY, sim2.energy + c.energy);
        sim2.crumbQueue = Math.min(MAX_CRUMB_QUEUE, sim2.crumbQueue + c.crumbs);
        if (c.weighted > 0) sim2.life.lastTokens = now2();
      } else if (ev.type === "task_done") {
        sim2.stats.tasks++;
        sim2.galleryQueue.push({ w: Math.max(6, Math.min(40, ev.width || ri(10, 18))) });
      }
    };
    sim2.isBusy = () => sim2.moves > 2 || sim2.sandAwake || sim2.strains.length > 0 || sim2.ants.some((a) => a.dying !== void 0);
    sim2.interestBox = function() {
      let { x0, y0, x1, y1 } = sim2.box;
      x0 = Math.min(x0, ex - 40);
      x1 = Math.max(x1, ex + 40);
      y0 = Math.min(y0, surf[ex] - 14);
      y1 = Math.max(y1, surf[ex] + 34);
      for (const a of sim2.ants) {
        if (a.x < x0) x0 = a.x;
        if (a.x > x1) x1 = a.x;
        if (a.y < y0) y0 = a.y;
        if (a.y > y1) y1 = a.y;
      }
      x0 = Math.max(0, x0);
      y0 = Math.max(sim2.top, y0);
      x1 = Math.min(W - 1, x1);
      y1 = Math.min(H - 1, y1);
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    sim2.setView = (b) => {
      sim2.view = b;
    };
    sim2.maintain = function() {
      const w = windowBox(), v = sim2.view;
      const keep = (c) => {
        const x0 = c.cx << CS, y0 = c.cy << CS, x1 = x0 + 63, y1 = y0 + 63;
        if (x1 >= w.x0 && x0 <= w.x1 && y1 >= w.y0 && y0 <= w.y1) return true;
        return !!v && x1 >= v.x0 - 64 && x0 <= v.x1 + 64 && y1 >= v.y0 - 64 && y0 <= v.y1 + 64;
      };
      store.maintain(keep, opts2.chunkCap ?? 256);
    };
    sim2.chunkStats = () => store.stats();
    sim2.over = () => sim2.life.over > 0;
    sim2.health = function() {
      const t = now2(), live2 = sim2.ants.filter((a) => !a.dying), q = live2.find((a) => a.role === "queen");
      const workers = live2.filter((a) => a.role === "worker");
      const food = sim2.stored(), L = sim2.life;
      const mood = !live2.length ? "empty" : L.starvingSince ? "starving" : L.hunger >= 0.5 && food < Math.max(2, live2.length / 4) ? "hungry" : "fed";
      return {
        workers: workers.length,
        queen: !!q,
        brood: sim2.brood.length,
        food,
        loose: sim2.crumbsOut,
        oldestMs: workers.reduce((m, a) => Math.max(m, t - a.born), 0),
        queenAgeMs: q ? t - q.born : 0,
        mood,
        starvingMs: L.starvingSince ? t - L.starvingSince : 0
      };
    };
    const rt = new Uint8Array(CELLS), rc = new Uint16Array(CELLS);
    function eachChunk(b, fn) {
      for (let cy = Math.max(0, b.y0 >> CS); cy <= Math.min(store.ch - 1, b.y1 >> CS); cy++)
        for (let cx = Math.max(0, b.x0 >> CS); cx <= Math.min(cw - 1, b.x1 >> CS); cx++) {
          store.read(cy * cw + cx, rt, rc);
          fn(cx, cy, rt, rc);
        }
    }
    const whole = () => ({ x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
    const around = () => {
      const b = sim2.box;
      return { x0: b.x0 - 64, y0: b.y0 - 64, x1: b.x1 + 64, y1: b.y1 + 64 };
    };
    sim2.count = function(b) {
      const r = b || (W * H <= SMALL ? whole() : around());
      const c = [0, 0, 0, 0, 0, 0, 0];
      eachChunk(r, (cx, cy, t) => {
        for (let ly = 0; ly < 64; ly++) {
          const y = (cy << CS) + ly;
          if (y < r.y0 || y > r.y1 || y >= H) continue;
          for (let lx = 0; lx < 64; lx++) {
            const x = (cx << CS) + lx;
            if (x >= r.x0 && x <= r.x1 && x < W) c[t[ly << CS | lx]]++;
          }
        }
      });
      let grain = 0, food = 0;
      for (const a of sim2.ants) {
        if (a.carry === "grain") grain++;
        if (a.carry === "food") food++;
      }
      return { air: c[AIR], dirt: c[DIRT], rock: c[ROCK], loose: c[LOOSE], food: c[FOOD], crumb: c[CRUMB], carriedGrain: grain, carriedFood: food };
    };
    sim2.hash = function() {
      let h = 2166136261;
      const mix = (v) => {
        h ^= v;
        h = Math.imul(h, 16777619);
      };
      if (W * H <= SMALL) eachChunk(whole(), (_x, _y, t) => {
        for (let i = 0; i < CELLS; i++) mix(t[i]);
      });
      else {
        const cis = [...store.map.values()].filter((c) => c.modified).map((c) => c.ci).sort((a, b) => a - b);
        for (const ci of cis) {
          mix(ci);
          store.read(ci, rt, rc);
          for (let i = 0; i < CELLS; i++) mix(rt[i]);
        }
      }
      for (const a of sim2.ants) mix(a.x * 31 + a.y);
      return h >>> 0;
    };
    const [skr, skg, skb] = hexRgb(PAL.skyTop), [slr, slg, slb] = hexRgb(PAL.skyLow);
    sim2.paintChunk = function(cx, cy, px, kind) {
      store.read(cy * cw + cx, rt, rc);
      for (let ly = 0, i = 0; ly < 64; ly++) {
        const y = (cy << CS) + ly;
        for (let lx = 0; lx < 64; lx++, i++) {
          const x = (cx << CS) + lx, t = rt[i];
          if (x >= W || y >= H) {
            px[i] = COLOURS[0];
            kind[i] = K.GLASS;
            continue;
          }
          const s = surf[x];
          if (t === AIR) {
            if (y < s) {
              const f = Math.min(1, y / Math.max(1, s));
              px[i] = rgb(skr + (slr - skr) * f, skg + (slg - skg) * f, skb + (slb - skb) * f);
              kind[i] = K.SKY;
            } else {
              const j = (hash01(seed, x, y, 17) - 0.5) * 14 + ((x * 7 + y * 13) % 5 === 0 ? -6 : 0);
              px[i] = WALL_COLOURS[band[Math.max(0, Math.min(H, y - s + wob[x]))] * 256 + jitterShade(j)];
              kind[i] = K.WALL;
            }
          } else if (t === LOOSE) {
            px[i] = LOOSE_COLOURS[rc[i]];
            kind[i] = K.LOOSE;
          } else {
            px[i] = COLOURS[rc[i]];
            kind[i] = t === DIRT ? y === s ? K.GRASS : K.SOIL : t === ROCK ? K.ROCK : t === FOOD || t === CRUMB ? K.FOOD : K.GLASS;
          }
        }
      }
    };
    const BROOD = [rgb(238, 232, 214), rgb(226, 212, 182), rgb(201, 179, 140)];
    const body = rgb(158, 76, 54), gaster = rgb(104, 49, 36), head = rgb(122, 58, 42), legs = rgb(70, 36, 28);
    const qBody = rgb(196, 116, 80), qGaster = rgb(140, 72, 52);
    sim2.overlay = function(b, put) {
      const inB = (x, y) => x >= b.x0 - 3 && x <= b.x1 + 3 && y >= b.y0 - 3 && y <= b.y1 + 3;
      const p = (x, y, c, k, al) => {
        if (inside(x, y)) put(x, y, c, k, al);
      };
      for (const s of sim2.strains) {
        if (s.x1 < b.x0 || s.x0 > b.x1 || s.y < b.y0 || s.y - 2 > b.y1) continue;
        const f = 1 - s.t / 40;
        for (let x = s.x0; x <= s.x1; x++) {
          const h = (x * 7 + s.y * 3) % 5;
          for (let dy = 0; dy < 3; dy++) {
            const k = idx(x, s.y - dy);
            if (T(k) !== AIR && (h === dy || dy === 0 && (x + (sim2.tick >> 2)) % 3 === 0) && h + dy < 2 + f * 4) p(x, s.y - dy, scaleCol(COLOURS[C2(k)], 0.45), K.CRACK, 1);
          }
        }
      }
      for (const e of sim2.brood) {
        if (e.carried || !inB(e.x, e.y)) continue;
        p(e.x, e.y, BROOD[Math.min(2, e.stage)], K.BROOD, 1);
        if (e.stage > 0) p(e.x + (e.id & 1 ? 1 : -1), e.y, BROOD[Math.min(2, e.stage)], K.BROOD, 1);
      }
      for (const a of sim2.ants) {
        if (!inB(a.x, a.y)) continue;
        const al = a.dying === void 0 ? 1 : a.dying / DYING_TICKS;
        const hx = a.hx || 0, hy = a.hy || 0;
        const dx = hx === 0 && hy === 0 ? 1 : hx, dy = hx === 0 && hy === 0 ? 0 : hy;
        if (a.role === "queen") {
          p(a.x - 2 * dx, a.y - 2 * dy, qGaster, K.QUEEN, al);
          p(a.x - dx, a.y - dy, qGaster, K.QUEEN, al);
          p(a.x - dx + dy, a.y - dy - dx, qGaster, K.QUEEN, al);
          p(a.x, a.y, qBody, K.QUEEN, al);
          p(a.x + dx, a.y + dy, head, K.QUEEN, al);
          continue;
        }
        p(a.x - dx, a.y - dy, gaster, K.ANT, al);
        p(a.x, a.y, body, K.ANT, al);
        p(a.x + dx, a.y + dy, head, K.ANT, al);
        if (a.walk >> 1 & 1 && a.dying === void 0) p(a.x - dy, a.y + dx, legs, K.ANT, al);
        if (a.carry === "grain" || a.carry === "food") p(a.x + 2 * dx, a.y + 2 * dy, COLOURS[a.carryCol], a.carry === "food" ? K.LOAD_FOOD : K.LOAD_GRAIN, al);
        else if (a.carry === "brood" && a.brood) p(a.x + 2 * dx, a.y + 2 * dy, BROOD[Math.min(2, a.brood.stage)], K.BROOD, al);
      }
    };
    sim2.paint = function(px, o) {
      if (W * H > SMALL) throw new Error("paint() is for small maps: draw a big one chunk by chunk");
      const kind = o && o.kind, tp = new Uint32Array(CELLS), tk = new Uint8Array(CELLS);
      for (let cy = 0; cy < store.ch; cy++) for (let cx = 0; cx < cw; cx++) {
        sim2.paintChunk(cx, cy, tp, tk);
        for (let ly = 0; ly < 64; ly++) {
          const y = (cy << CS) + ly;
          if (y >= H) break;
          const x0 = cx << CS, n = Math.min(64, W - x0);
          px.set(tp.subarray(ly << CS, (ly << CS) + n), y * W + x0);
          if (kind) kind.set(tk.subarray(ly << CS, (ly << CS) + n), y * W + x0);
        }
      }
      sim2.overlay(whole(), (x, y, c, k, al) => {
        if (al < 0.5 || o && o.ants === false && k !== K.CRACK && k !== K.BROOD) return;
        px[y * W + x] = c;
        if (kind) kind[y * W + x] = k;
      });
    };
    sim2.save = function() {
      const b64 = (u) => {
        let s = "";
        for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
        return btoa(s);
      };
      return {
        v: 1,
        seed,
        W,
        H,
        tick: sim2.tick,
        energy: sim2.energy,
        crumbQueue: sim2.crumbQueue,
        galleryQueue: sim2.galleryQueue.map((g) => ({ w: g.w })),
        scent: sim2.scent,
        box: { ...sim2.box },
        nest: { ...sim2.nest },
        nextId: sim2.nextId,
        rng: rnd.state(),
        stats: { ...sim2.stats },
        life: { ...sim2.life },
        meter: sim2.meter.save(),
        ants: sim2.ants.filter((a) => a.dying === void 0).map((a) => ({
          id: a.id,
          x: a.x,
          y: a.y,
          hx: a.hx,
          hy: a.hy,
          role: a.role,
          born: a.born,
          dies: a.dies,
          speed: a.speed,
          home: a.home,
          carry: a.carry === "brood" ? null : a.carry,
          carryCol: a.carryCol
        })),
        brood: sim2.brood.map((e) => ({ ...e, carried: false, nurse: 0 })),
        projects: sim2.projects.map((p) => ({
          id: p.id,
          kind: p.kind,
          head: p.head,
          goal: p.goal,
          room: p.room,
          phase: p.phase,
          ang: p.ang,
          done: p.done,
          stuck: p.stuck,
          failed: p.failed,
          pocket: p.pocket,
          cells: p.kind === "food" || p.kind === "clear" ? p.cells : null
        })),
        royal: sim2.royal ? sim2.royal.id : 0,
        broodRoom: sim2.broodRoom ? sim2.broodRoom.id : 0,
        pockets: [...sim2.pockets.values()].map((p) => [p.id, p.remaining, p.claimed ? 1 : 0]),
        chunks: store.saveChanged().map(([ci, d]) => [ci, b64(d)])
      };
    };
    if (R0) {
      const u8 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
      for (const [ci, d] of R0.chunks) {
        const p = u8(d);
        store.restore(ci, p);
        const cx = ci % cw, cy = (ci - cx) / cw;
        const t = new Uint8Array(CELLS), c = new Uint16Array(CELLS);
        genChunk(cx, cy, t, c);
        applyDiff(p, t, c);
        if (t.some((v) => FALLS[v])) awake.add(ci);
      }
      Object.assign(sim2, {
        tick: R0.tick,
        energy: R0.energy,
        crumbQueue: R0.crumbQueue,
        galleryQueue: R0.galleryQueue,
        scent: R0.scent,
        box: { ...R0.box },
        nest: R0.nest,
        nextId: R0.nextId,
        stats: { ...sim2.stats, ...R0.stats },
        life: { ...sim2.life, ...R0.life }
      });
      store.tick = sim2.tick;
      sim2.meter.load(R0.meter);
      for (const [id, remaining, claimed] of R0.pockets) {
        const p = pocketAt(id);
        if (p) {
          p.remaining = remaining;
          p.claimed = !!claimed;
        }
      }
      for (const q of R0.projects) {
        const p = {
          id: q.id,
          kind: q.kind,
          head: q.head,
          goal: q.goal ?? null,
          room: q.room ?? null,
          phase: q.phase,
          ang: q.ang,
          done: !!q.done,
          stuck: q.stuck || 0,
          failed: q.failed,
          pocket: q.pocket,
          work: -1,
          diggers: 0,
          cells: q.cells ?? (q.room ? roomCells(q.room) : null)
        };
        if (p.kind === "clear" && p.cells) p.cells.sort((a, b) => a - b);
        sim2.projects.push(p);
        if (p.id === R0.royal) sim2.royal = p;
        if (p.id === R0.broodRoom) sim2.broodRoom = p;
      }
      for (const q of R0.ants) {
        const a = {
          id: q.id,
          x: q.x,
          y: q.y,
          hx: q.hx ?? 1,
          hy: q.hy ?? 0,
          role: q.role,
          job: null,
          carry: q.carry ?? null,
          carryCol: q.carryCol || 0,
          busy: 0,
          acc: 0,
          speed: q.speed,
          walk: 0,
          stuckT: 0,
          lost: 0,
          brood: null,
          born: q.born,
          dies: q.dies,
          home: q.home
        };
        sim2.ants.push(a);
        occAdd(idx(a.x, a.y), 1);
      }
      sim2.brood = R0.brood.map((e) => ({ ...e }));
      if (!R0.life.started) sim2.life.started = Math.min(now2(), ...sim2.ants.filter((a) => a.role === "queen").map((a) => a.born));
      cutSky();
      sim2.version = 1;
    }
    function cutSky() {
      const b = sim2.box, x0 = Math.max(1, b.x0 - 64), x1 = Math.min(W - 2, b.x1 + 64);
      for (let x = x0; x <= x1; x++) for (let y = 1; y < surf[x]; y++) {
        const t = T(idx(x, y));
        if (t !== AIR && (t !== CRUMB || T(idx(x, y + 1)) !== AIR)) {
          raiseSky(y);
          break;
        }
      }
      for (const a of sim2.ants) raiseSky(a.y);
      for (const e of sim2.brood) raiseSky(e.y);
      for (let x = x0; x <= x1; x++) for (let y = 1; y <= sim2.top; y++) {
        const k = idx(x, y);
        if (T(k) !== CRUMB) continue;
        const to = idx(x, sim2.top + 1), c = C2(k);
        write(k, AIR, 0);
        if (T(to) === AIR) write(to, CRUMB, c);
        else sim2.crumbQueue++;
      }
      b.y0 = Math.max(b.y0, sim2.top);
    }
    return sim2;
  }
  function readSave(raw, seed, W, H) {
    if (!raw || typeof raw !== "object") return null;
    const s = raw;
    if (s.v !== 1 || s.seed !== seed || s.W !== W || s.H !== H) return null;
    if (!Array.isArray(s.ants) || !Array.isArray(s.chunks) || !Array.isArray(s.projects) || !Array.isArray(s.brood) || !Array.isArray(s.pockets)) return null;
    if (!s.life || typeof s.life.last !== "number" || !s.box || !s.nest) return null;
    return s;
  }

  // src/sim/score.ts
  var HOUR2 = 36e5;
  var DAY = 24 * HOUR2;
  var RULES = [
    { key: "born", label: "ants born", points: 10, per: 1 },
    { key: "dug", label: "blocks dug", points: 1, per: 1 },
    { key: "deepest", label: "rows deep", points: 5, per: 1 },
    { key: "collected", label: "food collected", points: 2, per: 1 },
    { key: "tokens", label: "thousand tokens fed", points: 1, per: 1e3 },
    { key: "oldestMs", label: "hours, the oldest ant", points: 20, per: HOUR2 },
    { key: "aliveMs", label: "days survived", points: 100, per: DAY },
    { key: "rooms", label: "rooms", points: 100, per: 1 },
    { key: "tunnels", label: "tunnels", points: 25, per: 1 }
  ];
  function score(i) {
    const parts2 = RULES.map((r) => {
      const count2 = Math.max(0, Math.floor((i[r.key] || 0) / r.per));
      return { key: r.key, label: r.label, count: count2, points: count2 * r.points };
    });
    return { total: parts2.reduce((s, p) => s + p.points, 0), parts: parts2 };
  }
  function scoreInput(sim2) {
    const t = sim2.life.over || sim2.now(), done = sim2.projects.filter((p) => p.done && !p.failed);
    const alive = sim2.ants.filter((a) => a.dying === void 0);
    return {
      born: sim2.stats.born,
      dug: sim2.stats.dug,
      deepest: sim2.stats.deepest,
      collected: sim2.stats.collected,
      tokens: sim2.stats.tokens,
      oldestMs: alive.reduce((m, a) => Math.max(m, t - a.born), sim2.stats.oldestMs || 0),
      aliveMs: sim2.life.started ? Math.max(0, t - sim2.life.started) : 0,
      rooms: done.filter((p) => p.kind === "royal" || p.kind === "brood" || p.kind === "gallery").length,
      tunnels: done.filter((p) => p.kind === "food" || p.kind === "scout").length
    };
  }
  var RUNS_KEPT = 20;
  var emptyRuns = () => ({ best: null, list: [] });
  var isRun = (x) => !!x && typeof x.score === "number" && typeof x.ended === "number";
  var same = (a, b) => a.started === b.started && a.seed === b.seed;
  function readRuns(raw) {
    const r = raw;
    if (!r || typeof r !== "object" || !Array.isArray(r.list)) return emptyRuns();
    const list = r.list.filter(isRun).slice(0, RUNS_KEPT);
    const best = [isRun(r.best) ? r.best : null, ...list].reduce((b, x) => x && (!b || x.score > b.score) ? x : b, null);
    return { best, list };
  }
  function recordRun(runs2, run) {
    if (runs2.list.some((x) => same(x, run))) return runs2;
    return { best: !runs2.best || run.score > runs2.best.score ? run : runs2.best, list: [run, ...runs2.list].slice(0, RUNS_KEPT) };
  }
  function compare(runs2, run) {
    const others = runs2.list.filter((x) => !same(x, run) && x.ended <= run.ended);
    const prevBest = Math.max(runs2.best && !same(runs2.best, run) ? runs2.best.score : 0, ...others.map((x) => x.score));
    const last = others[0] ?? null;
    return {
      best: Math.max(prevBest, run.score),
      isBest: run.score > prevBest,
      last,
      vsLast: last ? run.score - last.score : null,
      vsBest: run.score - prevBest
    };
  }

  // src/game/camera.ts
  function fit(box, vw2, vh2, o = {}) {
    const pad = o.pad == null ? 8 : o.pad, min = o.min || 0.5, max = o.max || 12;
    let s = Math.min((vw2 - pad * 2) / Math.max(1, box.w), (vh2 - pad * 2) / Math.max(1, box.h));
    s = Math.max(min, Math.min(max, s));
    if (s >= 2) s = Math.floor(s);
    return { x: box.x + box.w / 2 - vw2 / s / 2, y: box.y + box.h / 2 - vh2 / s / 2, s };
  }
  function zoomAt(cam2, sx, sy, f, o = {}) {
    const min = o.min || 0.5, max = o.max || 24;
    const s = Math.max(min, Math.min(max, cam2.s * f));
    const wx = cam2.x + sx / cam2.s, wy = cam2.y + sy / cam2.s;
    return { x: wx - sx / s, y: wy - sy / s, s };
  }
  var MAX_VIEW = { w: 768, h: 432 };
  var MIN_VIEW = 12;
  var MAX_SCALE = 24;
  function limits(vw2, vh2, world2, floor = 0) {
    const min = Math.max(floor, vw2 / MAX_VIEW.w, vh2 / MAX_VIEW.h, Math.min(vw2 / (world2.x1 - world2.x0), vh2 / (world2.y1 - world2.y0)));
    return { min, max: Math.max(min, Math.min(MAX_SCALE, Math.min(vw2, vh2) / MIN_VIEW)) };
  }
  function clamp(cam2, world2, vw2, vh2, top = 0) {
    const w = vw2 / cam2.s, h = vh2 / cam2.s, t = top / cam2.s;
    const fitIn = (v, lo, hi, size) => hi - lo <= size ? (lo + hi - size) / 2 : Math.min(hi - size, Math.max(lo, v));
    return { x: fitIn(cam2.x, world2.x0, world2.x1, w), y: fitIn(cam2.y, world2.y0 - t, world2.y1, h), s: cam2.s };
  }
  function lerp(cam2, target2, t, vw2, vh2) {
    const s = Math.exp(Math.log(cam2.s) + (Math.log(target2.s) - Math.log(cam2.s)) * t);
    const cx = cam2.x + vw2 / cam2.s / 2, cy = cam2.y + vh2 / cam2.s / 2;
    const tx = target2.x + vw2 / target2.s / 2, ty = target2.y + vh2 / target2.s / 2;
    const nx = cx + (tx - cx) * t, ny = cy + (ty - cy) * t;
    return { x: nx - vw2 / s / 2, y: ny - vh2 / s / 2, s };
  }
  var near = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.s - b.s) < 2e-3;

  // src/game/input.ts
  var LINE_PX = 16;
  var FOLLOW_PAUSE_MS = 3e4;
  var FRICTION_MS = 325;
  var MIN_FLING = 0.08;
  function classifyWheel(e) {
    if (e.ctrlKey) return "pinch";
    if (e.deltaMode !== 0) return "wheel";
    if (e.wheelDeltaY !== void 0 && e.deltaX === 0 && e.deltaY !== 0 && e.wheelDeltaY === -3 * e.deltaY) return "wheel";
    return "pan";
  }
  function wheelPixels(e, pageH) {
    const k = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageH : 1;
    return { dx: e.deltaX * k, dy: e.deltaY * k };
  }
  function panBy(cam2, dx, dy) {
    return { x: cam2.x + dx / cam2.s, y: cam2.y + dy / cam2.s, s: cam2.s };
  }
  var pinchFactor = (dy) => Math.exp(-dy * 0.01);
  var wheelFactor = (dy) => Math.exp(-dy * 2e-3);
  function easeZoom(cam2, goal, dtMs, o = {}) {
    const k = o.instant ? 1 : 1 - Math.exp(-dtMs / 70);
    const f = Math.exp((Math.log(goal.s) - Math.log(cam2.s)) * k);
    return zoomAt(cam2, goal.sx, goal.sy, f, o);
  }
  var zoomDone = (cam2, goal) => Math.abs(Math.log(cam2.s / goal.s)) < 2e-3;
  var Inertia = class {
    samples = [];
    vx = 0;
    vy = 0;
    // px/ms, in the direction the camera moves
    reset() {
      this.samples = [];
      this.vx = this.vy = 0;
    }
    // a drag moved the camera by (dx, dy) screen pixels at time t
    track(dx, dy, t) {
      this.samples.push({ t, dx, dy });
      while (this.samples.length && t - this.samples[0].t > 100) this.samples.shift();
    }
    // the pointer let go at time t: start gliding if it was moving
    release(t) {
      const s = this.samples.filter((p) => t - p.t <= 100);
      this.samples = [];
      if (s.length < 2) {
        this.vx = this.vy = 0;
        return false;
      }
      const span = Math.max(16, t - s[0].t);
      let dx = 0, dy = 0;
      for (const p of s.slice(1)) {
        dx += p.dx;
        dy += p.dy;
      }
      this.vx = dx / span;
      this.vy = dy / span;
      if (Math.hypot(this.vx, this.vy) < MIN_FLING) {
        this.vx = this.vy = 0;
        return false;
      }
      return true;
    }
    get moving() {
      return this.vx !== 0 || this.vy !== 0;
    }
    // how far to move this frame (screen pixels); null once it has stopped
    step(dtMs) {
      if (!this.moving) return null;
      const decay = Math.exp(-dtMs / FRICTION_MS), k = FRICTION_MS * (1 - decay);
      const out = { dx: this.vx * k, dy: this.vy * k };
      this.vx *= decay;
      this.vy *= decay;
      if (Math.hypot(this.vx, this.vy) < 0.01) this.vx = this.vy = 0;
      return out;
    }
  };

  // src/game/palettes.ts
  var RAMP_OF = ["sky", "wall", "soil", "soil", "soil", "soil", "food", "wall", "soil", "brood", "ant", "queen", "food", "soil"];
  var RANGE = {
    sky: [0.15, 0.27],
    wall: [0.06, 0.22],
    soil: [0.1, 0.66],
    food: [0.5, 0.85],
    ant: [0.15, 0.4],
    queen: [0.3, 0.56],
    brood: [0.68, 0.93]
  };
  var PALETTES = {
    original: {
      name: "Original",
      note: "the prototype colours, for comparison",
      identity: true,
      mid: "#3b2f28",
      ui: { back: "#12151d", bar: "rgba(12,14,20,0.78)", ink: "#cfd3dc", dim: "#9aa3b5", hot: "#e8b45e", task: "#88c58f", line: "rgba(255,255,255,0.12)" }
    },
    earth: {
      name: "Quiet Earth",
      note: "soil, food and ants in one low warm brown",
      ramps: {
        sky: ["#2b2724", "#322d29"],
        wall: ["#1f1c19", "#2c2723"],
        soil: ["#443b33", "#5f5347", "#7b6d5e"],
        food: ["#86775f", "#998868"],
        ant: ["#6f5f50", "#8a7663"],
        queen: ["#8a7663", "#9c8670"],
        brood: ["#958a7a", "#a69a88"]
      },
      ui: { back: "#1f1c19", bar: "rgba(31,28,25,0.72)", ink: "#b3a796", dim: "#8a7f71", hot: "#a8916c", task: "#8f9473", line: "rgba(255,240,220,0.06)" }
    },
    graphite: {
      name: "Graphite",
      note: "grey only, with one soft ochre for food",
      ramps: {
        sky: ["#28292b", "#2e2f32"],
        wall: ["#1c1d1f", "#28292c"],
        soil: ["#3c3e41", "#55575b", "#6f7175"],
        food: ["#8c7a58", "#a28d66"],
        ant: ["#7c7e82", "#93959a"],
        queen: ["#93959a", "#a3a5a9"],
        brood: ["#8e9094", "#9c9ea2"]
      },
      ui: { back: "#1c1d1f", bar: "rgba(28,29,31,0.72)", ink: "#aeb0b4", dim: "#7f8186", hot: "#a28d66", task: "#a28d66", line: "rgba(255,255,255,0.06)" }
    },
    slate: {
      name: "Slate",
      note: "cool blue-grey, the lowest contrast of the dark ones",
      ramps: {
        sky: ["#262b32", "#2b313a"],
        wall: ["#1d2127", "#272c33"],
        soil: ["#353c45", "#454e58", "#56606b"],
        food: ["#6f7e83", "#7f8f92"],
        ant: ["#6c7884", "#7d8995"],
        queen: ["#7d8995", "#8a97a2"],
        brood: ["#848f99", "#8f9aa4"]
      },
      ui: { back: "#1d2127", bar: "rgba(29,33,39,0.72)", ink: "#a5afba", dim: "#78828e", hot: "#8fa0a8", task: "#8fa0a8", line: "rgba(220,235,255,0.06)" }
    },
    dusk: {
      name: "Sepia Dusk",
      note: "faded photo browns under a dull mauve sky",
      ramps: {
        sky: ["#3a3138", "#43393b"],
        wall: ["#261f1f", "#33292a"],
        soil: ["#55473f", "#6d5c4f", "#86735f"],
        food: ["#a08a68", "#b09a76"],
        ant: ["#7c6758", "#937c6a"],
        queen: ["#937c6a", "#a58d78"],
        brood: ["#ad9e88", "#baab94"]
      },
      ui: { back: "#261f1f", bar: "rgba(38,31,31,0.72)", ink: "#c0b09c", dim: "#93816f", hot: "#b09a76", task: "#a3a07c", line: "rgba(255,235,215,0.07)" }
    },
    terminal: {
      name: "Terminal",
      note: "faint green on near-black, like a dimmed terminal",
      ramps: {
        sky: ["#0f1311", "#131815"],
        wall: ["#0c0f0d", "#121714"],
        soil: ["#18211b", "#202c24", "#2a382e"],
        food: ["#4e6142", "#5c7150"],
        ant: ["#3e5747", "#4a6654"],
        queen: ["#4a6654", "#557360"],
        brood: ["#46584b", "#506456"]
      },
      ui: { back: "#0c0f0d", bar: "rgba(12,15,13,0.75)", ink: "#6f8a76", dim: "#4d6153", hot: "#7f9860", task: "#7f9860", line: "rgba(150,255,180,0.05)" }
    },
    blend: {
      name: "Desktop Blend",
      note: "follows light or dark mode and sits close to the desktop’s own greys",
      dark: {
        ramps: {
          sky: ["#222327", "#26282c"],
          wall: ["#1b1c1f", "#232428"],
          soil: ["#323438", "#3e4045", "#4b4d52"],
          food: ["#706a5c", "#7d7666"],
          ant: ["#64676d", "#73767c"],
          queen: ["#73767c", "#7f8288"],
          brood: ["#6f7277", "#7a7d82"]
        },
        ui: { back: "#1b1c1f", bar: "rgba(30,31,35,0.7)", ink: "#a2a5ab", dim: "#76797f", hot: "#8f8671", task: "#8f8671", line: "rgba(255,255,255,0.07)" }
      },
      light: {
        ramps: {
          sky: ["#dcdcdf", "#d4d4d7"],
          wall: ["#bdbab5", "#c8c5c0"],
          soil: ["#a29e98", "#b0aca5", "#bebab3"],
          food: ["#a69676", "#b3a483"],
          ant: ["#76726c", "#86817b"],
          queen: ["#6d6964", "#7b7671"],
          brood: ["#d3cfc8", "#dbd7d0"]
        },
        ui: { back: "#c8c5c0", bar: "rgba(236,235,232,0.78)", ink: "#5d5a55", dim: "#86827c", hot: "#8f7c55", task: "#8f7c55", line: "rgba(0,0,0,0.08)" }
      }
    }
  };
  var ORDER = ["original", "earth", "graphite", "slate", "dusk", "terminal", "blend"];
  var hex = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  var luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  var clamp2 = (v) => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  var pack = (r, g, b) => (4278190080 | clamp2(b) << 16 | clamp2(g) << 8 | clamp2(r)) >>> 0;
  function resolve(id, dark2) {
    const known = Object.prototype.hasOwnProperty.call(PALETTES, id);
    const P = known ? PALETTES[id] : PALETTES.original;
    const v = P.dark || P.light ? dark2 ? P.dark : P.light : { ramps: P.ramps, ui: P.ui };
    const out = { id: known ? id : "original", name: P.name, note: P.note, identity: !!P.identity, ui: v.ui, ramps: null, mid: [0, 0, 0] };
    if (v.ramps) {
      const ramps = {};
      for (const [k, stops] of Object.entries(v.ramps)) ramps[k] = stops.map(hex);
      out.ramps = ramps;
      const w = ramps.wall[1], s = ramps.soil[0];
      out.mid = [(w[0] + s[0]) / 2, (w[1] + s[1]) / 2, (w[2] + s[2]) / 2];
    } else out.mid = hex(P.mid);
    return out;
  }
  function sampleRamp(stops, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), u = f - i, a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }
  function mapColour(p, kind, c, calm) {
    let r = c & 255, g = c >>> 8 & 255, b = c >>> 16 & 255;
    if (!p.identity && p.ramps) {
      const name = RAMP_OF[kind] || "soil", [lo, hi] = RANGE[name];
      [r, g, b] = sampleRamp(p.ramps[name], (luma(r, g, b) - lo) / (hi - lo));
    }
    if (calm > 0) {
      const y = luma(r, g, b) * 255, ks = 1 - 0.85 * calm, kc = 1 - 0.5 * calm, m = p.mid;
      r = m[0] + (y + (r - y) * ks - m[0]) * kc;
      g = m[1] + (y + (g - y) * ks - m[1]) * kc;
      b = m[2] + (y + (b - y) * ks - m[2]) * kc;
    }
    return pack(r, g, b);
  }
  function mapper(id, o = {}) {
    const p = resolve(id, !!o.dark), calm = Math.max(0, Math.min(1, o.calm || 0));
    const cache = /* @__PURE__ */ new Map();
    let ps = null, pk = null;
    function apply(src, kind, out) {
      if (p.identity && calm === 0) {
        out.set(src);
        return;
      }
      const n = src.length;
      if (!ps || !pk || ps.length !== n) {
        ps = new Uint32Array(n);
        pk = new Uint8Array(n).fill(255);
      }
      for (let i = 0; i < n; i++) {
        const s = src[i], kd = kind[i];
        if (s === ps[i] && kd === pk[i]) continue;
        ps[i] = s;
        pk[i] = kd;
        const key = kd * 16777216 + (s & 16777215);
        let v = cache.get(key);
        if (v === void 0) {
          v = mapColour(p, kd, s, calm);
          cache.set(key, v);
        }
        out[i] = v;
      }
    }
    function map(kd, s) {
      if (p.identity && calm === 0) return s;
      const key = kd * 16777216 + (s & 16777215);
      let v = cache.get(key);
      if (v === void 0) {
        v = mapColour(p, kd, s, calm);
        cache.set(key, v);
      }
      return v;
    }
    function paint(src, kind, out) {
      if (p.identity && calm === 0) {
        out.set(src);
        return;
      }
      let ls = -1, lk = -1, lv = 0;
      for (let i = 0; i < src.length; i++) {
        const s = src[i], kd = kind[i];
        if (s !== ls || kd !== lk) {
          ls = s;
          lk = kd;
          lv = map(kd, s);
        }
        out[i] = lv;
      }
    }
    return { id: p.id, palette: p, calm, dark: !!o.dark, apply, map, paint };
  }

  // src/game/render.ts
  var cssMemo = /* @__PURE__ */ new Map();
  var css = (c) => {
    let v = cssMemo.get(c);
    if (v === void 0) {
      v = "rgb(" + (c & 255) + "," + (c >>> 8 & 255) + "," + (c >>> 16 & 255) + ")";
      if (cssMemo.size > 4096) cssMemo.clear();
      cssMemo.set(c, v);
    }
    return v;
  };
  var now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
  function visibleBox(cam2, vw2, vh2, dpr, W, H) {
    const s = cam2.s * dpr;
    return {
      x0: Math.max(0, Math.floor(cam2.x)),
      y0: Math.max(0, Math.floor(cam2.y)),
      x1: Math.min(W - 1, Math.ceil(cam2.x + vw2 / s)),
      y1: Math.min(H - 1, Math.ceil(cam2.y + vh2 / s))
    };
  }
  function visibleChunks(b) {
    return { cx0: b.x0 >> CS, cy0: b.y0 >> CS, cx1: b.x1 >> CS, cy1: b.y1 >> CS };
  }
  var MAX_TILES = 600;
  function minScale(vw2, vh2) {
    let s = 0.25;
    while (s < 4 && (vw2 / (s * CHUNK) + 1) * (vh2 / (s * CHUNK) + 1) > MAX_TILES) s *= 1.1;
    return s;
  }
  var View = class {
    tiles = /* @__PURE__ */ new Map();
    mapper = null;
    mapperKey = "";
    frame = 0;
    px = new Uint32Array(CHUNK * CHUNK);
    kind = new Uint8Array(CHUNK * CHUNK);
    out;
    img;
    edges = { key: "", fills: [] };
    // the soft edges, made once per size
    constructor() {
      this.img = new ImageData(CHUNK, CHUNK);
      this.out = new Uint32Array(this.img.data.buffer);
    }
    tile() {
      const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(CHUNK, CHUNK) : Object.assign(document.createElement("canvas"), { width: CHUNK, height: CHUNK });
      return { canvas, ctx: canvas.getContext("2d"), ver: -1, key: "", used: 0 };
    }
    draw(ctx, sim2, cam2, dpr, o) {
      const t0 = now();
      this.frame++;
      const key = o.palette + "|" + o.calm + "|" + o.dark;
      if (!this.mapper || this.mapperKey !== key) {
        this.mapper = mapper(o.palette, { calm: o.calm, dark: o.dark });
        this.mapperKey = key;
      }
      const m = this.mapper, back = m.palette.ui.back;
      const W = ctx.canvas.width, H = ctx.canvas.height, s = cam2.s * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = back;
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
      const box = visibleBox(cam2, W, H, dpr, sim2.W, sim2.H), cc = visibleChunks(box);
      const sx = (wx) => Math.round((wx - cam2.x) * s), sy = (wy) => Math.round((wy - cam2.y) * s);
      const budget = o.budgetMs ?? 8;
      let visible = 0, painted = 0, waiting = 0;
      for (let cy = cc.cy0; cy <= cc.cy1; cy++) for (let cx = cc.cx0; cx <= cc.cx1; cx++) {
        visible++;
        const ci = cy * sim2.chunks.cw + cx, ver = sim2.chunks.ver(ci);
        let t = this.tiles.get(ci);
        const stale = !t || t.ver !== ver || t.key !== key;
        if (stale && (painted < 4 || now() - t0 < budget)) {
          if (!t) {
            t = this.tile();
            this.tiles.set(ci, t);
          }
          sim2.paintChunk(cx, cy, this.px, this.kind);
          m.paint(this.px, this.kind, this.out);
          t.ctx.putImageData(this.img, 0, 0);
          t.ver = ver;
          t.key = key;
          painted++;
        } else if (stale) waiting++;
        if (!t || t.ver < 0) continue;
        t.used = this.frame;
        const x0 = sx(cx << CS), y0 = sy(cy << CS);
        ctx.drawImage(t.canvas, x0, y0, sx(cx + 1 << CS) - x0, sy(cy + 1 << CS) - y0);
      }
      const cap = Math.max(256, visible * 2);
      if (this.tiles.size > cap) {
        const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used);
        for (let i = 0; i < old.length && this.tiles.size > cap; i++) if (old[i][1].used !== this.frame) this.tiles.delete(old[i][0]);
      }
      let drawn = 0, alpha = 1, fill = "";
      sim2.overlay(box, (x, y, c, kind, a) => {
        if (a !== alpha) {
          ctx.globalAlpha = alpha = a;
        }
        const f = css(m.map(kind, c));
        if (f !== fill) ctx.fillStyle = fill = f;
        const x0 = sx(x), y0 = sy(y);
        ctx.fillRect(x0, y0, sx(x + 1) - x0, sy(y + 1) - y0);
      });
      ctx.globalAlpha = 1;
      for (const a of sim2.ants) if (a.x >= box.x0 && a.x <= box.x1 && a.y >= box.y0 && a.y <= box.y1) drawn++;
      if (o.dim && o.dim > 0) {
        ctx.globalAlpha = Math.min(1, o.dim);
        ctx.fillStyle = back;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      if (o.soft) this.feather(ctx, back, Math.max(4, Math.round(Math.min(W, H) * 0.07)));
      const stats = { visible, painted, waiting, tiles: this.tiles.size, tileMB: this.tiles.size * CHUNK * CHUNK * 4 / 1048576, ms: now() - t0 };
      return { drawn, mapper: m, stats, box };
    }
    clear() {
      this.tiles.clear();
    }
    // Edges that fade into the window's backdrop instead of ending in a hard line. The four gradients only change with
    // the canvas size and the backdrop colour.
    feather(ctx, col, d) {
      const W = ctx.canvas.width, H = ctx.canvas.height, key = W + "x" + H + "|" + d + "|" + col;
      if (this.edges.key !== key) {
        const g = (x0, y0, x1, y1) => {
          const v = ctx.createLinearGradient(x0, y0, x1, y1);
          v.addColorStop(0, col);
          v.addColorStop(1, "rgba(0,0,0,0)");
          return v;
        };
        this.edges = { key, fills: [g(0, 0, d, 0), g(W, 0, W - d, 0), g(0, H, 0, H - d), g(0, 0, 0, d)] };
      }
      const f = this.edges.fills;
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = f[0];
      ctx.fillRect(0, 0, d, H);
      ctx.fillStyle = f[1];
      ctx.fillRect(W - d, 0, d, H);
      ctx.fillStyle = f[2];
      ctx.fillRect(0, H - d, W, d);
      ctx.fillStyle = f[3];
      ctx.fillRect(0, 0, W, d);
      ctx.globalAlpha = 1;
    }
  };

  // src/game/meter.ts
  var FrameMeter = class {
    constructor(windowMs = 2e3, keep = 600) {
      this.windowMs = windowMs;
      this.keep = keep;
    }
    at = [];
    // when each recent frame started
    ms = [];
    // and how long it took
    total = 0;
    slowN = 0;
    maxMs = 0;
    n = 0;
    add(start, ms) {
      this.at.push(start);
      this.ms.push(ms);
      if (this.at.length > this.keep) {
        this.at.shift();
        this.ms.shift();
      }
      this.n++;
      this.total += ms;
      if (ms > this.maxMs) this.maxMs = ms;
      if (ms > 16.7) this.slowN++;
    }
    // The last `windowMs` (at `now`): frames a second and the average cost. A frame counts while it is in the window.
    recent(now2) {
      let i = this.at.length, sum = 0;
      while (i > 0 && now2 - this.at[i - 1] <= this.windowMs) {
        i--;
        sum += this.ms[i];
      }
      const n = this.at.length - i;
      return { fps: n * 1e3 / this.windowMs, ms: n ? sum / n : 0 };
    }
    // Everything since the last reset, and the 95th percentile of the frames kept.
    summary(sinceMs) {
      const sorted = [...this.ms].sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
      return { fps: sinceMs > 0 ? this.n * 1e3 / sinceMs : 0, ms: this.n ? this.total / this.n : 0, p95, max: this.maxMs, frames: this.n, slow: this.slowN };
    }
    reset() {
      this.at = [];
      this.ms = [];
      this.total = 0;
      this.slowN = 0;
      this.maxMs = 0;
      this.n = 0;
    }
  };

  // src/game/quality.ts
  var LEVELS = [
    { level: 0, dprCap: 1.5, soft: true, tileBudgetMs: 6 },
    { level: 1, dprCap: 1, soft: true, tileBudgetMs: 4 },
    { level: 2, dprCap: 1, soft: false, tileBudgetMs: 2 }
  ];
  var Governor = class {
    // when it dropped well under
    // budgetMs: a frame should take at most this much of the page's time. Step down after downAfterMs over it, back up
    // after upAfterMs well under it (much longer, so it never flips back and forth).
    constructor(budgetMs = 10, downAfterMs = 1500, upAfterMs = 1e4) {
      this.budgetMs = budgetMs;
      this.downAfterMs = downAfterMs;
      this.upAfterMs = upAfterMs;
    }
    lvl = 0;
    ema = 0;
    // a running average of the frame time
    overSince = -1;
    // when the average went over budget
    underSince = -1;
    get quality() {
      return LEVELS[this.lvl];
    }
    get average() {
      return this.ema;
    }
    add(ms, now2) {
      this.ema = this.ema ? this.ema * 0.9 + ms * 0.1 : ms;
      if (this.ema > this.budgetMs) {
        this.underSince = -1;
        if (this.overSince < 0) this.overSince = now2;
        else if (now2 - this.overSince >= this.downAfterMs && this.lvl < LEVELS.length - 1) {
          this.lvl++;
          this.overSince = now2;
        }
      } else if (this.ema < this.budgetMs * 0.4) {
        this.overSince = -1;
        if (this.underSince < 0) this.underSince = now2;
        else if (now2 - this.underSince >= this.upAfterMs && this.lvl > 0) {
          this.lvl--;
          this.underSince = now2;
        }
      } else {
        this.overSince = -1;
        this.underSince = -1;
      }
      return LEVELS[this.lvl];
    }
    reset() {
      this.lvl = 0;
      this.ema = 0;
      this.overSince = -1;
      this.underSince = -1;
    }
  };

  // src/game/app.ts
  var $ = (id) => document.getElementById(id);
  var farm = $("farm");
  var view = $("view");
  var g2d = view.getContext("2d");
  var FADE = { after: 5e3, depth: 0.5, down: 3500, up: 600 };
  var SAVE_EVERY = 3e4;
  var ANT = '<svg viewBox="0 0 16 10" fill="currentColor"><ellipse cx="3" cy="5" rx="2.2" ry="1.9"/><ellipse cx="7.4" cy="5" rx="1.6" ry="1.4"/><ellipse cx="12" cy="5.2" rx="3" ry="2.3"/><path d="M6 6.2 4 9M7.4 6.4V9.4M8.8 6.2l2 2.8M6 3.8 4.4 1M8.8 3.8 10.6 1.2M1.6 3.6.4 1.2" stroke="currentColor" stroke-width=".9" fill="none"/></svg>';
  var C;
  var S;
  var dark = true;
  var smoke = false;
  var feed = null;
  var scale = "mini";
  var sim = createSim({ size: "classic", colony: false });
  var simSize = "";
  var ready = false;
  var main = new View();
  var cam = null;
  var auto = true;
  var snap = true;
  var pausedUntil = 0;
  var zoomGoal = null;
  var acc = 0;
  var lastT = performance.now();
  var timer = 0;
  var dim = 0;
  var lastEvt = performance.now();
  var lastThumbs = 0;
  var lastSave = 0;
  var lastFrame = 0;
  var drag = null;
  var showStats = false;
  var runs = readRuns(null);
  var runsRead = false;
  var points = 0;
  var shownOver = false;
  var inertia = new Inertia();
  var thumbs = /* @__PURE__ */ new Map();
  var counts = { events: 0, tokens: 0, tasks: 0, frames: 0 };
  var perf = { tickMs: 0, drawMs: 0, view: null };
  var meter = new FrameMeter();
  var parts = { since: performance.now(), tick: 0, ticks: 0, draw: 0, status: 0, thumbs: 0 };
  var realBudget = false;
  var governor = new Governor();
  var raf = 0;
  var asleep = false;
  var lastDraw = 0;
  var lastStatus = 0;
  var fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));
  var age = (ms) => ms >= 48 * 36e5 ? Math.round(ms / 864e5) + " d" : ms >= 36e5 ? Math.round(ms / 36e5) + " h" : Math.round(ms / 6e4) + " min";
  var opts = (palette = S.palette) => ({ palette, calm: S.calm, dark, dim, soft: !resolve(palette, dark).identity });
  var vw = () => Math.max(1, farm.clientWidth);
  var vh = () => Math.max(1, farm.clientHeight);
  var mini = () => scale === "mini";
  var world = () => ({ x0: 0, y0: sim.top, x1: sim.W, y1: sim.H });
  var limits2 = (w = vw(), h = vh()) => limits(w, h, world(), minScale(w, h));
  var keepIn = (c, w = vw(), h = vh()) => clamp(c, world(), w, h, C ? C.topInset : 0);
  function inBounds(c, w, h) {
    const l = limits2(w, h), s = Math.max(l.min, Math.min(l.max, c.s));
    if (s !== c.s) c = { x: c.x + w / c.s / 2 - w / s / 2, y: c.y + h / c.s / 2 - h / s / 2, s };
    return keepIn(c, w, h);
  }
  function target(w, h) {
    const top = C ? C.topInset : 0, l = limits2(w, h);
    const t = fit(sim.interestBox(), w, h - top, { pad: mini() ? 1 : 8, min: Math.max(mini() ? 0.1 : 0.5, l.min), max: Math.min(10, l.max) });
    return keepIn({ x: t.x, y: t.y - top / t.s, s: t.s }, w, h);
  }
  function manual() {
    auto = false;
    pausedUntil = performance.now() + FOLLOW_PAUSE_MS;
    followBtn.hidden = false;
  }
  function follow() {
    auto = true;
    zoomGoal = null;
    inertia.reset();
    if (cam) {
      const t = target(vw(), vh());
      if (Math.abs(t.x - cam.x) * cam.s > vw() * 2 || Math.abs(t.y - cam.y) * cam.s > vh() * 2) snap = true;
    }
    followBtn.hidden = true;
    wake(true);
  }
  function draw(dt) {
    const q = governor.quality, dpr = Math.min(window.devicePixelRatio || 1, q.dprCap), w0 = vw(), h0 = vh();
    const w = Math.max(1, Math.round(w0 * dpr)), h = Math.max(1, Math.round(h0 * dpr));
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
      snap = true;
    }
    if (!auto && !drag && !inertia.moving && !zoomGoal && performance.now() > pausedUntil) follow();
    if (cam && zoomGoal) {
      cam = keepIn(easeZoom(cam, zoomGoal, dt, { ...limits2(), instant: S.reducedMotion }));
      if (zoomDone(cam, zoomGoal)) zoomGoal = null;
    }
    if (cam && !drag) {
      const d = inertia.step(dt);
      if (d) cam = keepIn(panBy(cam, d.dx, d.dy));
    }
    if (auto || mini()) {
      const t = target(w0, h0);
      cam = !cam || snap || S.reducedMotion || mini() || near(cam, t) ? t : lerp(cam, t, 0.12, w0, h0);
    }
    if (cam && !mini()) cam = inBounds(cam, w0, h0);
    snap = false;
    const o = opts();
    const r = main.draw(g2d, sim, cam, dpr, { ...o, soft: o.soft && q.soft, budgetMs: smoke && !realBudget ? 1e3 : mini() ? 4 : q.tileBudgetMs });
    sim.setView(r.box);
    perf.drawMs = perf.drawMs * 0.9 + r.stats.ms * 0.1;
    perf.view = r.stats;
    C.setTheme(r.mapper.palette.ui);
    counts.frames++;
    const ts = performance.now();
    if (mini() || ts - lastStatus >= 250) {
      lastStatus = ts;
      status();
      if (showStats) statsText();
      perfText(ts);
    }
    parts.status += performance.now() - ts;
  }
  function perfText(t) {
    const el = $("perf"), on = S.perfReadout && !mini();
    if (el.hidden !== !on) el.hidden = !on;
    if (!on) return;
    const r = meter.recent(t), lvl = governor.quality.level;
    el.textContent = `${Math.round(r.fps)} fps · ${r.ms.toFixed(1)} ms` + (lvl ? ` · lighter ${lvl}` : "");
  }
  var MOOD = { fed: "", hungry: " · hungry", starving: " · starving", empty: " · empty" };
  var num2 = (n) => Math.round(n).toLocaleString("en-US");
  function status() {
    const h = sim.health();
    points = score(scoreInput(sim)).total;
    if (sim.over()) {
      C.setStatus({ count: "0", title: "ants", warm: true, lead: "★ " + num2(points), line: "game over" + (runs.best ? " · best " + num2(Math.max(points, runs.best.score)) : "") });
      return;
    }
    C.setStatus({
      count: String(h.workers),
      title: h.workers === 1 ? "ant" : "ants",
      warm: h.mood !== "fed",
      lead: "⚡" + Math.floor(sim.energy),
      line: h.workers + " ants · " + h.food + " food" + MOOD[h.mood] + " · ★ " + num2(points) + (feed && (feed.error || !feed.files) ? " · waiting for Claude Code" : "")
    });
  }
  function statsText() {
    const v = perf.view, c = sim.chunkStats(), m = performance.memory;
    $("stats").textContent = [
      `map ${sim.W} × ${sim.H} (${MAP_SIZES[S.mapSize].name})`,
      `frame ${perf.drawMs.toFixed(1)} ms draw · ${perf.tickMs.toFixed(2)} ms/tick`,
      v ? `chunks on screen ${v.visible} · painted ${v.painted} · waiting ${v.waiting}` : "",
      v ? `tiles ${v.tiles} (${v.tileMB.toFixed(1)} MB)` : "",
      `chunks loaded ${c.loaded} · changed ${c.modified} · packed ${c.packed} (${(c.bytes / 1048576).toFixed(1)} MB)`,
      m ? `heap ${(m.usedJSHeapSize / 1048576).toFixed(0)} MB` : "",
      cam ? `camera ${Math.round(cam.x)}, ${Math.round(cam.y)} × ${cam.s.toFixed(2)}${auto ? " (following)" : ""}` : ""
    ].filter(Boolean).join("\n");
  }
  function drawThumbs() {
    for (const id of ORDER) {
      const t = thumbs.get(id);
      if (!t) continue;
      const w = t.canvas.clientWidth || 80, h = Math.round(w * 9 / 16), dpr = window.devicePixelRatio || 1;
      if (t.canvas.width !== Math.round(w * dpr)) {
        t.canvas.width = Math.round(w * dpr);
        t.canvas.height = Math.round(h * dpr);
      }
      const c = t.canvas.getContext("2d");
      t.view.draw(c, sim, fit(sim.interestBox(), w, h, { pad: 2, min: 0.2, max: 6 }), dpr, { ...opts(id), dim: 0, soft: false, budgetMs: 4 });
    }
  }
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
    acc += dt * TICK_HZ / 1e3;
    let n = 0;
    const t0 = performance.now();
    while (acc >= 1 && n < 80) {
      sim.step();
      acc -= 1;
      n++;
    }
    const t1 = performance.now();
    if (n) perf.tickMs = perf.tickMs * 0.8 + (t1 - t0) / n * 0.2;
    parts.tick += t1 - t0;
    parts.ticks += n;
    if (n >= 80) acc = 0;
    lifeNews();
    const moving = !!drag || inertia.moving || !!zoomGoal;
    const busy = sim.isBusy() || moving;
    C.setCalm(!busy);
    const want = S.fadeIdle && t - lastEvt > FADE.after && !C.panelOpen ? FADE.depth : 0;
    const rate = dt / (want > dim ? FADE.down : FADE.up) * FADE.depth;
    dim = want > dim ? Math.min(want, dim + rate) : Math.max(want, dim - rate);
    const fps = mini() ? S.reducedMotion ? 1 : busy ? 4 : 2 : moving ? 60 : S.reducedMotion ? busy ? 10 : 2 : busy || dim !== want ? TICK_HZ : 8;
    if (moving || t - lastDraw >= 1e3 / fps - 5) {
      lastDraw = t;
      const t2 = performance.now();
      draw(dt);
      const t3 = performance.now();
      parts.draw += t3 - t2;
      if (C.panelOpen && t - lastThumbs > 1e3) {
        lastThumbs = t;
        drawThumbs();
        renderHealth();
      }
      parts.thumbs += performance.now() - t3;
      const ms = performance.now() - t;
      meter.add(t, ms);
      if (!mini() && (!smoke || realBudget)) governor.add(ms, t);
    }
    if (t - lastSave > SAVE_EVERY) save();
    if (moving && !smoke) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const steps = mini() ? TICK_HZ / 4 : Math.max(1, Math.round(TICK_HZ / fps));
    timer = window.setTimeout(frame, moving ? 1e3 / fps : Math.max(4, (steps - acc) * 1e3 / TICK_HZ));
  }
  function stop() {
    clearTimeout(timer);
    timer = 0;
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function wake(now2 = false) {
    if (!running()) return;
    if (raf || timer && !now2) return;
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
  function save() {
    if (!ready) return;
    lastSave = performance.now();
    void C.save(saveData());
  }
  var saveData = () => ({ ...sim.save(), runs });
  async function newFarm() {
    ready = false;
    const size = S.mapSize, { W, H } = MAP_SIZES[size];
    const raw = await C.load();
    if (!runsRead) {
      runs = readRuns(raw && raw.runs);
      runsRead = true;
    }
    const restore = readSave(raw, S.seed, W, H);
    sim = createSim({ seed: S.seed, size, restore });
    simSize = size;
    main = new View();
    for (const t of thumbs.values()) t.view = new View();
    cam = null;
    auto = true;
    zoomGoal = null;
    inertia.reset();
    followBtn.hidden = true;
    shownOver = false;
    overEl.hidden = true;
    ready = true;
    if (!restore) save();
    wake();
  }
  var seenEvents = 0;
  function lifeNews() {
    const evs = sim.events;
    for (const e of evs) {
      if (e.tick <= seenEvents) continue;
      if (e.type === "died") C.pulse(e.queen ? "the old queen died" : e.cause === "age" ? "an old ant died" : "an ant starved", "task");
      else if (e.type === "queen") C.pulse("a new queen took over", "task");
    }
    if (evs.length) seenEvents = Math.max(seenEvents, evs[evs.length - 1].tick);
    if (sim.over() && !shownOver) gameOver();
  }
  var overEl = $("over");
  var thisRun = () => {
    const s = score(scoreInput(sim));
    return { score: s.total, started: sim.life.started, ended: sim.life.over, seed: sim.seed, parts: s.parts.filter((p) => p.count > 0) };
  };
  var when = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  var signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±") + num2(Math.abs(n));
  var esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  function gameOver() {
    shownOver = true;
    const run = thisRun(), cmp = compare(runs, run), s = score(scoreInput(sim));
    runs = recordRun(runs, run);
    save();
    $("overScore").textContent = num2(run.score);
    $("overNote").textContent = cmp.isBest ? cmp.last ? "A new best on this computer." : "Your first run: the best so far." : "Best " + num2(cmp.best) + " · " + signed(cmp.vsBest) + " from the best";
    $("overParts").innerHTML = s.parts.map((p) => `<div class="hrow"><span>${p.count.toLocaleString("en-US")} ${esc(p.label)}</span><span>${num2(p.points)}</span></div>`).join("");
    $("overCompare").innerHTML = [
      ["This run", num2(run.score) + " · " + age(run.ended - run.started)],
      ["Last run", cmp.last ? num2(cmp.last.score) + " (" + signed(cmp.vsLast) + ")" : "–"],
      ["Best", num2(cmp.best) + (cmp.isBest ? " ★" : "")]
    ].map(([k, v]) => `<div class="hrow"><span>${k}</span><span>${v}</span></div>`).join("");
    $("overRuns").innerHTML = runs.list.slice(0, 5).map((r) => `<div class="hrow${r === run || r.started === run.started && r.seed === run.seed ? " now" : ""}"><span>${when(r.ended)} · ${age(r.ended - r.started)}</span><span>${num2(r.score)}</span></div>`).join("");
    overEl.hidden = mini();
    wake(true);
  }
  $("overRestart").onclick = restart;
  function restart() {
    if (!sim.over()) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    overEl.hidden = true;
    C.set({ seed });
  }
  function onEvent(ev) {
    sim.feed(ev);
    counts.events++;
    lastEvt = performance.now();
    let text2 = "", kind = "hot";
    if (ev.type === "tokens") {
      counts.tokens++;
      text2 = "+" + fmt(ev.input + ev.output + ev.cache_write + 0.1 * ev.cache_read) + " tokens";
    } else if (ev.type === "task_done") {
      counts.tasks++;
      text2 = ev.width && ev.width > 24 ? "task done → a wide room" : "task done → new gallery";
      kind = "task";
    } else return;
    C.pulse(text2, kind);
    if (!S.reducedMotion && !mini() && running()) {
      const f = document.createElement("div");
      f.className = "floater";
      f.textContent = text2;
      f.style.bottom = 8 + 14 * farm.querySelectorAll(".floater").length + "px";
      farm.appendChild(f);
      setTimeout(() => f.remove(), 1700);
    }
    wake();
  }
  function applySettings() {
    if (ready && (sim.seed !== S.seed || simSize !== S.mapSize)) {
      save();
      void newFarm();
    }
    if (C.panelOpen) renderPanel();
    wake();
  }
  function buildPanel() {
    const host = $("pals");
    for (const id of ORDER) {
      const b = document.createElement("button");
      b.className = "pal";
      b.dataset.pal = id;
      b.title = PALETTES[id].note;
      const c = document.createElement("canvas"), s = document.createElement("span");
      s.textContent = PALETTES[id].name;
      b.append(c, s);
      b.onclick = () => C.set({ palette: id });
      host.appendChild(b);
      thumbs.set(id, { canvas: c, view: new View() });
    }
    const calm = $("calm");
    calm.oninput = () => C.set({ calm: +calm.value / 100 });
    const fade = $("fadeIdle");
    fade.onchange = () => C.set({ fadeIdle: fade.checked });
    const pr = $("perfReadout");
    pr.onchange = () => C.set({ perfReadout: pr.checked });
    for (const b of $("maps").querySelectorAll("[data-map]")) b.onclick = () => C.set({ mapSize: b.dataset.map });
  }
  function renderPanel() {
    for (const b of $("pals").querySelectorAll(".pal")) b.classList.toggle("on", b.dataset.pal === S.palette);
    $("palNote").textContent = PALETTES[S.palette].name + ": " + PALETTES[S.palette].note;
    const calm = $("calm");
    if (document.activeElement !== calm) calm.value = String(Math.round(S.calm * 100));
    $("calmV").textContent = Math.round(S.calm * 100) + "%";
    $("fadeIdle").checked = S.fadeIdle;
    $("perfReadout").checked = S.perfReadout;
    for (const b of $("maps").querySelectorAll("[data-map]")) b.classList.toggle("on", b.dataset.map === S.mapSize);
    const m = MAP_SIZES[S.mapSize];
    $("mapNote").textContent = `${m.W.toLocaleString()} × ${m.H.toLocaleString()} cells. Only what's on screen is drawn. Another size starts a new farm.`;
    $("feedNote").textContent = feed && feed.error ? feed.error : feed && feed.files > 0 ? `Watching ${feed.files} Claude Code transcripts on this computer. Only token counts and times are read; nothing leaves it.` : "Waiting for Claude Code transcripts (~/.claude/projects). The farm grows only from your Claude Code use. Nothing leaves this computer.";
    renderHealth();
  }
  function renderHealth() {
    const h = sim.health();
    const mood = sim.over() ? "Game over: start a new farm" : h.mood === "fed" ? "Fed" : h.mood === "hungry" ? "Hungry: the store is low" : h.mood === "starving" ? `Starving for ${age(h.starvingMs)}: tokens bring food` : "Empty";
    $("health").innerHTML = [
      ["Ants", h.workers + (h.queen ? " + queen" : "") + (h.brood ? ` · ${h.brood} brood` : "")],
      ["Food stored", h.food + (h.loose ? ` · ${h.loose} still outside` : "")],
      ["Oldest ant", h.workers ? age(h.oldestMs) : "–"],
      ["Queen", h.queen ? age(h.queenAgeMs) + " old" : "–"],
      ["State", mood],
      ["Score", num2(points) + (runs.best ? ` · best ${num2(Math.max(points, runs.best.score))}` : "")]
    ].map(([k, v]) => `<div class="hrow"><span>${k}</span><span>${v}</span></div>`).join("");
  }
  function cycle(list, cur) {
    return list[(list.indexOf(cur) + 1) % list.length];
  }
  function zoomBy(f, sx = vw() / 2, sy = vh() / 2) {
    if (!cam || mini()) return;
    manual();
    const l = limits2(), s = Math.max(l.min, Math.min(l.max, (zoomGoal ? zoomGoal.s : cam.s) * f));
    zoomGoal = { s, sx, sy };
    wake(true);
  }
  function panScreen(dx, dy) {
    if (!cam || mini()) return;
    manual();
    cam = keepIn(panBy(cam, dx, dy));
    wake(true);
  }
  function onKey(k) {
    const step = Math.min(vw(), vh()) * 0.2;
    if (k === "p") C.set({ palette: cycle(PALETTE_IDS, S.palette) });
    else if (k === "m") C.set({ mapSize: cycle(MAP_SIZE_IDS, S.mapSize) });
    else if (k === "a") follow();
    else if (k === "i") {
      showStats = !showStats;
      $("stats").hidden = !showStats;
      wake(true);
    } else if (k === "ArrowLeft") panScreen(-step, 0);
    else if (k === "ArrowRight") panScreen(step, 0);
    else if (k === "ArrowUp") panScreen(0, -step);
    else if (k === "ArrowDown") panScreen(0, step);
    else if (k === "+" || k === "=") zoomBy(1.25);
    else if (k === "-" || k === "_") zoomBy(1 / 1.25);
    else return false;
    return true;
  }
  var followBtn = document.createElement("button");
  followBtn.className = "tg-wbtn";
  followBtn.id = "bFollow";
  followBtn.hidden = true;
  followBtn.title = "Follow the colony again (A, or double-click)";
  followBtn.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6" cy="6" r="3.2"/><circle cx="6" cy="6" r=".9" fill="currentColor"/><path d="M6 .8v1.8M6 9.4v1.8M.8 6h1.8M9.4 6h1.8"/></svg>';
  followBtn.onclick = () => follow();
  view.addEventListener("wheel", (e) => {
    if (mini()) return;
    e.preventDefault();
    if (!cam) return;
    const w = { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, wheelDeltaY: e.wheelDeltaY };
    const kind = classifyWheel(w), d = wheelPixels(w, vh());
    inertia.reset();
    if (kind === "pan") panScreen(d.dx, d.dy);
    else zoomBy(kind === "pinch" ? pinchFactor(d.dy) : wheelFactor(d.dy), e.offsetX, e.offsetY);
  }, { passive: false });
  var gesture = 1;
  view.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    gesture = 1;
  });
  view.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    const g = e;
    zoomBy(g.scale / gesture, g.clientX, g.clientY);
    gesture = g.scale;
  });
  view.addEventListener("pointerdown", (e) => {
    if (!cam || e.button !== 0 || mini()) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    inertia.reset();
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = drag.x - e.clientX, dy = drag.y - e.clientY;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!dx && !dy) return;
    inertia.track(dx, dy, e.timeStamp);
    panScreen(dx, dy);
  });
  var endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    if (!S.reducedMotion && inertia.release(e.timeStamp)) wake(true);
    else inertia.reset();
  };
  view.addEventListener("pointerup", endDrag);
  view.addEventListener("pointercancel", endDrag);
  view.addEventListener("dblclick", () => {
    if (!mini()) follow();
  });
  new ResizeObserver(() => {
    snap = true;
    wake();
  }).observe(farm);
  document.addEventListener("mousemove", () => {
    if (S && S.fadeIdle && dim > 0) {
      lastEvt = performance.now();
      wake();
    }
  });
  mountShell({
    name: "Ant Farm",
    root: farm,
    icon: ANT,
    settingsPanel: $("afPanel"),
    barButtons: [followBtn],
    keysHelp: "Two fingers pan · pinch or wheel zooms · drag pans · double-click follows the colony · arrows pan · + − zoom · A follow · P palette · M map size · I stats",
    async start(ctx) {
      C = ctx;
      S = ctx.settings;
      dark = ctx.dark;
      feed = ctx.feed;
      smoke = ctx.smoke;
      scale = ctx.scale;
      buildPanel();
      await newFarm();
    },
    onEvent,
    onSettings(s) {
      S = s;
      if (C) applySettings();
    },
    onScale(s) {
      scale = s;
      farm.classList.toggle("mini", s === "mini");
      if (shownOver) overEl.hidden = s === "mini";
      snap = true;
      if (C) wake(true);
    },
    onDark(d) {
      dark = d;
      wake();
    },
    onFeed(f) {
      feed = f;
      if (C.panelOpen) renderPanel();
    },
    onPanel(open) {
      if (open) {
        renderPanel();
        lastThumbs = 0;
      }
      wake();
    },
    onFullscreen() {
      snap = true;
      wake();
    },
    onKey,
    onHide() {
      if (ready) {
        lastSave = performance.now();
        C.saveNow(saveData());
      }
    },
    onSleep(a) {
      asleep = a;
      if (a) {
        stop();
        save();
      } else wake(true);
    },
    // the screen locked or the Mac slept
    testHooks
  });
  function testHooks() {
    return {
      state: () => ({
        ready,
        energy: sim.energy,
        tokens: sim.stats.tokens,
        tick: sim.tick,
        ants: sim.ants.length,
        galleries: sim.galleryQueue.length,
        palette: S.palette,
        mapSize: S.mapSize,
        W: sim.W,
        H: sim.H,
        counts: { ...counts },
        scale,
        w: vw(),
        h: vh(),
        auto,
        cam: cam && { ...cam },
        view: perf.view,
        drawMs: perf.drawMs,
        tickMs: perf.tickMs,
        chunks: sim.chunkStats(),
        health: sim.health(),
        heapMB: (performance.memory?.usedJSHeapSize || 0) / 1048576,
        ages: sim.ants.map((a) => a.born),
        seed: sim.seed
      }),
      colours: () => {
        const d = g2d.getImageData(0, 0, view.width, view.height).data, seen = /* @__PURE__ */ new Set();
        for (let i = 0; i < d.length; i += 4 * 7) seen.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
        return seen.size;
      },
      clickPalette: (id) => $("pals").querySelector(`[data-pal="${id}"]`).click(),
      wheel: (o) => view.dispatchEvent(new WheelEvent("wheel", { cancelable: true, clientX: 100, clientY: 80, ...o })),
      look: (x, y) => {
        manual();
        cam = keepIn({ x, y, s: cam ? cam.s : 1 });
        wake(true);
      },
      // jump the camera far away
      save: () => {
        save();
        return sim.tick;
      },
      feed: () => $("feedNote").textContent || "",
      score: () => ({ points, over: sim.over(), shown: shownOver && !overEl.hidden, runs, text: overEl.innerText }),
      // The smoke test's way to the game over screen without waiting two days: every ant's life ends now. It exists only
      // in the hidden smoke run (the shell sets window.gameTest there and nowhere else) and takes nothing from the feed.
      endColony: () => {
        for (const a of sim.ants) a.dies = sim.now() - 1;
        sim.brood.length = 0;
        sim.life.last = Math.min(sim.life.last, sim.now() - 1e3);
        wake(true);
      },
      restart: () => $("overRestart").click(),
      // the perf run: what frames cost since the last reset, and the canvas they draw into
      perfReset: () => {
        realBudget = true;
        meter.reset();
        governor.reset();
        Object.assign(parts, { since: performance.now(), tick: 0, ticks: 0, draw: 0, status: 0, thumbs: 0 });
      },
      perf: () => {
        const since = performance.now() - parts.since, f = meter.summary(since), r = (v) => Math.round(v * 100) / 100, per = (v) => r(f.frames ? v / f.frames : 0);
        return {
          fps: r(f.fps),
          frameMs: r(f.ms),
          p95: r(f.p95),
          maxMs: r(f.max),
          frames: f.frames,
          slow: f.slow,
          tickMs: per(parts.tick),
          ticksPerFrame: per(parts.ticks),
          drawMs: per(parts.draw),
          statusMs: per(parts.status),
          thumbsMs: per(parts.thumbs),
          canvas: [view.width, view.height],
          css: [vw(), vh()],
          dpr: window.devicePixelRatio,
          quality: governor.quality.level,
          scale: cam ? r(cam.s) : 0,
          view: perf.view,
          heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576)
        };
      },
      // the camera moving as a player moves it: the pan a drag makes, every frame
      pan: (dx, dy) => panScreen(dx, dy),
      zoomOut: () => {
        for (let i = 0; i < 40; i++) zoomBy(1 / 1.25);
      },
      zoomIn: () => {
        for (let i = 0; i < 40; i++) zoomBy(1.25);
      },
      // the zoom range and the world the camera may show, to check it stays inside them
      bounds: () => ({ ...limits2(), world: world(), topInset: C ? C.topInset : 0, perf: !$("perf").hidden && $("perf").textContent })
    };
  }
})();
