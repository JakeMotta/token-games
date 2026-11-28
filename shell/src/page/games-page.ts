// The Games window's page: the catalog with room to breathe. It talks to the main process only through
// window.tokenGames (games-window-preload.ts: the catalog calls, boot and close), so it can list, ask for and approve
// games, and nothing else. Esc (or Cmd/Ctrl+W) closes it.
import type { GamesWindowApi } from '../api';
import { gamesPanel } from './games-panel';

declare global {
  interface Window { tokenGames: GamesWindowApi; gamesTest?: unknown }
}

const api = window.tokenGames;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

const head = el('header', 'gw-head'), sub = el('span', 'gw-sub'), close = el('button', 'gw-close', 'Close');
close.id = 'gw-close'; close.title = 'Close (Esc)';
close.onclick = () => api.close();
head.append(el('h1', '', 'Games'), sub, el('span', 'gw-sp'), close);
const main = el('main', 'gw-main');
const games = gamesPanel(api, { layout: 'window' });
main.append(games.el);
document.body.append(head, main);

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w')) { e.preventDefault(); api.close(); }
});
// coming back to the window: read the view again (the catalog may have changed behind it)
addEventListener('focus', () => games.refresh());

api.boot().then((b) => {
  sub.textContent = 'for ' + b.name;
  if (!b.smoke) return;
  // for the hidden smoke test only: what the window shows, and its buttons by their data-games name
  window.gamesTest = {
    view: () => games.view(),
    text: () => document.body.innerText,
    click: (name: string) => {
      const btn = games.el.querySelector<HTMLButtonElement>(`[data-games="${CSS.escape(name)}"]`);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    },
    key: (key: string, meta = false) => dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: meta })),
    look: () => {
      const px = (sel: string) => { const e = document.querySelector(sel); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; };
      return {
        name: px('.tg-gt b'), desc: px('.tg-gd'), button: px('.tg-chips button'), cards: document.querySelectorAll('.tg-game').length,
        icons: document.querySelectorAll('img.tg-gicon').length, back: getComputedStyle(document.body).backgroundColor,
      };
    },
  };
});
