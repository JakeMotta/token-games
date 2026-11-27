// The game's own checks in the shell's hidden smoke test (npm run test:smoke). The shell checks the notch, the
// drop-down, popping out and docking, the tray and the settings file; these run while the game is popped out.
// No window is ever shown. Feed the game only the real way: k.transcript() writes a Claude Code transcript line.
import type { GameSmoke, SmokeKit } from '@token-games/shell/main/smoke';
import type { Settings } from '../shared/settings';

const state = (k: SmokeKit<Settings>) => k.js('gameTest.state()');

export const gameSmoke: GameSmoke<Settings> = {
  async full(k) {
    let st = await state(k);
    k.check('the game draws in the window', st.scale === 'window' && st.frames > 0, st);
    k.check('no cheat controls anywhere', !/add tokens|free sand|cheat/i.test(await k.js<string>('shellTest.text()')));
    const g0 = st.grains + st.jars * 4000;
    k.transcript({ input_tokens: 3000, output_tokens: 2500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'msg_smoke_template');
    k.check('a real transcript line adds sand', await k.until(async () => { st = await state(k); return st.grains + st.jars * 4000 > g0; }, 6000), st);
    k.check('the island shows the grains', await k.until(async () => (await k.js('shellTest.state()')).count === String(st.grains)), await k.js('shellTest.state()'));
    k.update({ sand: 'sea' } as Partial<Settings>);
    k.check('a setting reaches the page', await k.until(async () => (await state(k)).sand === 'sea'));
    await k.shot('window-game');
  },
  async reset(k) {
    k.check('Reset brings back the game\'s defaults', k.store.get().sand === 'sand', k.store.get());
  },
  async leave(k) {
    await k.js('gameTest.save()');
  },
  async reopen(k) {
    k.check('the jar comes back after a restart', await k.until(async () => (await state(k)).grains > 0), await state(k));
  },
};
