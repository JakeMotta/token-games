// __GAME_NAME__: a sand jar, the starter for a catalog (web) game. A plain page with no build step. It talks to
// Token Games only through window.tokenGame (docs/publishing-a-game.md): usage counts in, its own save and
// settings, and the number on the orb. No Node, no files, no network: the shell's sandbox blocks them.
(function () {
  'use strict';
  const tg = window.tokenGame;
  const TOKENS_PER_GRAIN = 1000;
  const JAR_GRAINS = 4000;
  const CACHE_READ_WEIGHT = 0.1; // cache reads are cheap re-reads, so they count for a tenth

  const $ = (id) => document.getElementById(id);
  let state = { carry: 0, grains: 0, jars: 0 };
  let env = { scale: 'expanded', dark: false, reducedMotion: false };
  let dirty = false;

  function onUsage(ev) {
    if (ev.type !== 'tokens') return; // also: task_done, session_start, agent_waiting
    state.carry += ev.input + ev.output + ev.cache_write + ev.cache_read * CACHE_READ_WEIGHT;
    while (state.carry >= TOKENS_PER_GRAIN) {
      state.carry -= TOKENS_PER_GRAIN;
      if (++state.grains >= JAR_GRAINS) { state.grains = 0; state.jars++; } // a full jar is put on the shelf
    }
    dirty = true;
    show();
  }

  function show() {
    tg.setStatus({ count: String(state.jars), title: '__GAME_NAME__', line: `${state.grains} grains · ${state.jars} jars` });
    if (env.scale === 'mini') return; // the orb shows our icon and count; skip work nobody sees
    $('grains').textContent = state.grains.toLocaleString('en-US');
    $('jars').textContent = String(state.jars);
    $('sand').style.height = `${(100 * state.grains) / JAR_GRAINS}%`;
  }

  function applyEnv(e) {
    env = e;
    document.documentElement.classList.toggle('dark', !!e.dark);
    document.documentElement.classList.toggle('still', !!e.reducedMotion);
    show();
  }

  // Save now and then, and only when something changed.
  setInterval(() => { if (dirty) { dirty = false; void tg.save(state); } }, 5000);
  window.addEventListener('pagehide', () => { if (dirty) void tg.save(state); });

  Promise.all([tg.load(), tg.env()]).then(([saved, e]) => {
    if (saved && typeof saved.grains === 'number') state = { ...state, ...saved };
    applyEnv(e);
    tg.onEnv(applyEnv);
    tg.onUsage(onUsage);
  });
})();
