// The game's page: it draws the jar into #game, which the shell moves between the notch ('mini'), the drop-down
// ('expanded') and the popped-out window ('window'). The shell owns everything around it. Keep 'mini' cheap: it runs
// all day in the notch, so draw only when something changed.
import type { GameContext, Scale } from '@token-games/shell/game';
import type { UsageEvent } from '@token-games/shell/events';
import { mountShell } from '@token-games/shell/page/shell-page';
import { Jar, JAR_GRAINS } from '../shared/jar';
import { SANDS, SAND_IDS, type Settings } from '../shared/settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $('game'), canvas = $<HTMLCanvasElement>('view'), g = canvas.getContext('2d')!;
const ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 2h6v1H5zM4 3h1v10H4zm7 0h1v10h-1zM4 13h8v1H4zm1-4h6v4H5z"/></svg>';

let C: GameContext<Settings>, S: Settings, scale: Scale = 'mini', jar = new Jar(), frames = 0, dirty = true;

function draw(): void {
  if (!dirty || !C) return;
  dirty = false; frames++;
  const dpr = devicePixelRatio || 1, w = root.clientWidth, h = root.clientHeight - C.topInset;
  if (w <= 0 || h <= 0) return;
  canvas.style.top = C.topInset + 'px'; canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = scale === 'mini' ? 2 : 12, jw = Math.min(w - pad * 2, (h - pad * 2) * (scale === 'mini' ? 3 : 0.8)), jh = h - pad * 2;
  const x = (w - jw) / 2, y = pad, fill = jh * jar.fill;
  g.clearRect(0, 0, w, h);
  g.fillStyle = SANDS[S.sand];
  g.fillRect(x, y + jh - fill, jw, fill);
  g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--g-dim') || '#888';
  g.lineWidth = scale === 'mini' ? 1 : 2;
  g.strokeRect(x, y, jw, jh);
}

function status(): void {
  C.setStatus({ count: String(jar.grains), title: 'grains', lead: `${Math.round(jar.fill * 100)}%`, line: `${jar.jars} jars · ${jar.tasks} turns` });
}

function onEvent(ev: UsageEvent): void {
  const added = jar.feed(ev);
  if (added > 0) { C.pulse(`+${added} grain${added > 1 ? 's' : ''}`); C.save(jar.save()); }
  if (ev.type === 'task_done') C.pulse('turn done', 'task');
  status(); dirty = true;
}

function renderPanel(): void {
  for (const b of $('sands').querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.sand === S.sand);
  $('jarNote').textContent = `${jar.grains} of ${JAR_GRAINS} grains · ${jar.jars} jars filled`;
}

$('sands').innerHTML = SAND_IDS.map((id) => `<button data-sand="${id}">${id[0].toUpperCase() + id.slice(1)}</button>`).join('');
$('sands').addEventListener('click', (e) => { const id = (e.target as HTMLElement).dataset.sand; if (id) C.set({ sand: id } as Partial<Settings>); });
new ResizeObserver(() => { dirty = true; }).observe(root);
setInterval(draw, 250); // a few frames a second is plenty for a jar; a real game should drop to ~1–2 fps in 'mini'

mountShell<Settings>({
  name: '__GAME_NAME__',
  root,
  icon: ICON,
  settingsPanel: $('gamePanel'),
  keysHelp: 'S changes the sand',
  async start(ctx) {
    C = ctx; S = ctx.settings; scale = ctx.scale;
    jar = Jar.load(await ctx.load());
    C.setTheme({ back: '#1c1c1e', bar: '#232326', ink: '#e6e1d8', dim: '#8a857c', hot: SANDS[S.sand], line: '#3a3a3e', panel: '#1f1f22' });
    status(); renderPanel();
  },
  onEvent,
  onSettings(s) { S = s; renderPanel(); dirty = true; },
  onScale(s) { scale = s; dirty = true; },
  onPanel(open) { if (open) renderPanel(); },
  onKey(key) { if (key !== 's') return false; C.set({ sand: SAND_IDS[(SAND_IDS.indexOf(S.sand) + 1) % SAND_IDS.length] } as Partial<Settings>); return true; },
  onHide() { C.saveNow(jar.save()); },
  // read-only views for the smoke test; never a way to feed the game
  testHooks: () => ({ state: () => ({ grains: jar.grains, jars: jar.jars, frames, scale, sand: S.sand }), save: () => C.save(jar.save()) }),
});
