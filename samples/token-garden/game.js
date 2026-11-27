// Token Garden: the sample catalog game. A plain web page with no build step. It talks to Token Games only through
// window.tokenGame (docs/publishing-a-game.md): usage counts in, its own save, and the number on the orb.
// A seed is sown for every thousand tokens; every finished turn grows the oldest seedling a stage.
(function () {
  'use strict';
  const tg = window.tokenGame;
  const TOKENS_PER_SEED = 1000;
  const MAX_PLANTS = 48;
  const PETALS = ['#d9a5a0', '#b8b0d8', '#e8d48a', '#a8c8d8', '#e0b890'];
  const W = 160, H = 90, GROUND = 74;

  const $ = (id) => document.getElementById(id);
  const bed = $('bed'), g = bed.getContext('2d');
  let state = { tokens: 0, carry: 0, sown: 0, flowers: 0, plants: [] };
  let env = { scale: 'expanded', dark: false, reducedMotion: false };
  let dirty = false;

  // Where the nth seed lands: spread along the bed without randomness, so a save always redraws the same garden.
  const spot = (n) => 8 + ((n * 37) % (W - 16));

  function sow() {
    state.plants.push({ x: spot(state.sown), stage: 0, hue: state.sown % PETALS.length });
    state.sown++;
    if (state.plants.length > MAX_PLANTS) state.plants.shift(); // the oldest goes back to the soil
  }

  function grow() {
    const p = state.plants.find((q) => q.stage < 3);
    if (!p) return;
    p.stage++;
    if (p.stage === 3) state.flowers++;
  }

  function onUsage(ev) {
    if (ev.type === 'tokens') {
      const n = ev.input + ev.output + ev.cache_write; // cache reads are cheap re-reads; they don't sow
      state.tokens += n;
      state.carry += n;
      while (state.carry >= TOKENS_PER_SEED) { state.carry -= TOKENS_PER_SEED; sow(); }
    } else if (ev.type === 'task_done') grow();
    else return;
    dirty = true;
    show();
  }

  const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : String(n));

  function show() {
    $('tokens').textContent = state.tokens.toLocaleString('en-US');
    $('flowers').textContent = String(state.flowers);
    tg.setStatus({ count: short(state.flowers), title: 'Token Garden', line: `${state.flowers} flowers · ${state.plants.length} plants` });
    draw(performance.now());
  }

  function draw(t) {
    if (env.scale === 'mini') return; // the orb shows our icon and count; nobody sees the canvas
    g.fillStyle = env.dark ? '#1d1c1a' : '#f3efe6';
    g.fillRect(0, 0, W, H);
    g.fillStyle = env.dark ? '#5a4c3a' : '#8a7558';
    g.fillRect(0, GROUND, W, H - GROUND);
    for (const p of state.plants) {
      const sway = env.reducedMotion ? 0 : Math.round(Math.sin(t / 1400 + p.x) * 0.6);
      const stem = [0, 3, 7, 10][p.stage];
      g.fillStyle = env.dark ? '#6f8a5e' : '#7d9a6a';
      if (p.stage === 0) { g.fillStyle = env.dark ? '#8f7a5c' : '#5e4d38'; g.fillRect(p.x, GROUND, 1, 1); continue; }
      g.fillRect(p.x + sway, GROUND - stem, 1, stem);
      if (p.stage >= 2) g.fillRect(p.x + sway + 1, GROUND - stem + 4, 1, 1);
      if (p.stage === 3) {
        g.fillStyle = PETALS[p.hue];
        g.fillRect(p.x + sway - 1, GROUND - stem - 2, 3, 3);
        g.fillStyle = env.dark ? '#e8d48a' : '#c8a84a';
        g.fillRect(p.x + sway, GROUND - stem - 1, 1, 1);
      }
    }
  }

  function applyEnv(e) {
    env = e;
    document.documentElement.classList.toggle('dark', !!e.dark);
    draw(performance.now());
  }

  // A slow sway, a few frames a second; nothing moves with Reduced motion on.
  setInterval(() => { if (!env.reducedMotion && !document.hidden) draw(performance.now()); }, 250);
  // Save now and then, and only when something changed.
  setInterval(() => { if (dirty) { dirty = false; void tg.save(state); } }, 5000);
  window.addEventListener('pagehide', () => { if (dirty) void tg.save(state); });

  Promise.all([tg.load(), tg.env()]).then(([saved, e]) => {
    if (saved && Array.isArray(saved.plants)) state = { ...state, ...saved };
    applyEnv(e);
    tg.onEnv(applyEnv);
    tg.onUsage(onUsage);
    show();
  });
})();
