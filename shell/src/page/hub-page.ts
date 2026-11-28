// The Games and Settings window's page: one window, two tabs at the top. Games is the catalog with room to breathe
// (games-panel.ts); Settings is a copy of the game page's Settings sheet (its own sections, Display, Games, Reset),
// which stays in the game's page, hidden: this page shows it (page/mirror.ts) and sends every click and new value
// back, so the game's and the shell's own code handle them. It talks to the main process only through
// window.tokenHub (hub-window-preload.ts). Esc, Cmd/Ctrl+W and Close close it; Cmd/Ctrl+1 and +2, or ←/→ on the
// tabs, switch tabs (hub.ts).
import type { HubWindowApi, SettingsInput, SettingsSnap } from '../api';
import { HUB_LABELS, HUB_TABS, hubKey, isHubTab, type HubTab } from '../hub';
import { gamesPanel } from './games-panel';
import { morph, pathOf } from './mirror';

declare global {
  interface Window { tokenHub: HubWindowApi; hubTest?: unknown; gamesTest?: unknown; settingsTest?: unknown }
}

const api = window.tokenHub;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
const mac = /Mac/.test(navigator.platform);

// the tabs: real buttons in a tablist, each naming the panel it shows
const head = el('header', 'gw-head'), sub = el('span', 'gw-sub'), close = el('button', 'gw-close', 'Close');
const list = el('div', 'hw-tabs');
list.setAttribute('role', 'tablist');
list.setAttribute('aria-label', 'Games and Settings');
close.id = 'gw-close'; close.title = 'Close (Esc)';
close.onclick = () => api.close();
const main = el('main', 'hw-main');
const tabs = {} as Record<HubTab, HTMLButtonElement>, panels = {} as Record<HubTab, HTMLDivElement>;
HUB_TABS.forEach((t, i) => {
  const b = tabs[t] = el('button', 'hw-tab', HUB_LABELS[t]), p = panels[t] = el('div', 'gw-main hw-panel');
  b.type = 'button'; b.id = 'hw-tab-' + t; p.id = 'hw-' + t;
  b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', p.id);
  b.title = `${HUB_LABELS[t]} (${mac ? '⌘' : 'Ctrl+'}${i + 1})`;
  p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', b.id);
  b.onclick = () => pick(t, true);
  list.append(b);
  main.append(p);
});
head.append(list, sub, el('span', 'gw-sp'), close);
document.body.append(head, main);

const games = gamesPanel(api, { layout: 'window' });
panels.games.append(games.el);
const sheet = el('div', 'tg-panel sw-sheet');
sheet.id = 'sw-sheet';
panels.settings.classList.add('sw-main');
panels.settings.append(sheet);

let tab: HubTab = 'games', name = '', told = false;
// Show a tab. The player's own picks are told to the main process (which tells the game's page whether Settings shows);
// a tab the main process asked for is already known there.
function pick(t: HubTab, byPlayer: boolean): void {
  const changed = t !== tab;
  tab = t;
  for (const x of HUB_TABS) {
    const on = x === t;
    tabs[x].setAttribute('aria-selected', String(on));
    tabs[x].tabIndex = on ? 0 : -1;
    tabs[x].classList.toggle('on', on);
    panels[x].hidden = !on;
  }
  document.title = HUB_LABELS[t] + (name ? ' · ' + name : '');
  if (byPlayer && changed) api.tab(t);
  if (changed && t === 'games') games.refresh();
  if (changed) scrollTo(0, 0);
}
pick('games', false);

// the Settings sheet: the game's page draws it, this page shows the copy and sends the player's input back
const css = new Set<string>();
function show(s: SettingsSnap): void {
  for (const f of s.css) {
    if (css.has(f)) continue;
    css.add(f);
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = f;
    document.head.insertBefore(l, document.head.querySelector('link[href="hub.css"]'));
  }
  morph(sheet, s.html);
}
const send = (e: Event, i: Omit<SettingsInput, 'path'>) => {
  const path = pathOf(sheet, e.target as Element);
  if (path && path.length) api.input({ path, ...i });
};
// Nothing in the sheet changes by itself: a click asks the game's page, which answers with the new sheet.
sheet.addEventListener('click', (e) => { e.preventDefault(); send(e, { type: 'click' }); });
sheet.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.type !== 'checkbox' && t.type !== 'radio') send(e, { type: 'input', value: t.value });
});
sheet.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.type !== 'checkbox' && t.type !== 'radio') send(e, { type: 'change', value: t.value });
});

const onTab = () => document.activeElement instanceof HTMLElement && document.activeElement.getAttribute('role') === 'tab';
addEventListener('keydown', (e) => {
  const a = hubKey({ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, onTab: onTab() }, tab);
  if (!a) return;
  e.preventDefault();
  if (a.do === 'close') return api.close();
  const focus = onTab();
  pick(a.tab, true);
  if (focus) tabs[a.tab].focus(); // arrows move the focus with the tab, as tabs do
});
// coming back to the window: read the catalog again (it may have changed behind it)
addEventListener('focus', () => { if (tab === 'games') games.refresh(); });
api.onTab((t) => { told = true; if (isHubTab(t)) pick(t, false); });
api.onSnap(show);

api.boot().then((b) => {
  name = b.name;
  sub.textContent = 'for ' + b.name;
  if (!told && isHubTab(b.tab)) pick(b.tab, false);
  document.title = HUB_LABELS[tab] + ' · ' + name;
  if (b.snap) show(b.snap);
  if (!b.smoke) return;
  // for the hidden smoke test only: the tabs, a key like the player's, and each tab's own helpers
  const key = (k: string, meta = false) => dispatchEvent(new KeyboardEvent('keydown', { key: k, metaKey: meta }));
  window.hubTest = {
    tab: () => tab,
    tabs: () => HUB_TABS.map((t) => ({ tab: t, tag: tabs[t].tagName, role: tabs[t].getAttribute('role'), name: tabs[t].textContent, selected: tabs[t].getAttribute('aria-selected'),
      controls: tabs[t].getAttribute('aria-controls'), tabIndex: tabs[t].tabIndex, shown: !panels[t].hidden && panels[t].getClientRects().length > 0 })),
    click: (t: HubTab) => tabs[t].click(),
    focus: (t: HubTab) => tabs[t].focus(),
    focused: () => (onTab() ? (document.activeElement as HTMLElement).id.replace('hw-tab-', '') : null),
    key,
    look: () => {
      const st = (e: Element) => getComputedStyle(e);
      return { back: st(document.body).backgroundColor, ink: st(document.body).color, on: st(tabs[tab]).color, off: st(tabs[tab === 'games' ? 'settings' : 'games']).color,
        line: st(tabs[tab]).borderBottomColor, dark: matchMedia('(prefers-color-scheme: dark)').matches };
    },
  };
  // the Games tab: what it shows, and its buttons by their data-games name
  window.gamesTest = {
    view: () => games.view(),
    text: () => panels.games.innerText,
    click: (n: string) => {
      const btn = games.el.querySelector<HTMLButtonElement>(`[data-games="${CSS.escape(n)}"]`);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    },
    key,
    look: () => {
      const px = (sel: string) => { const e = document.querySelector(sel); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; };
      return {
        name: px('.tg-gt b'), desc: px('.tg-gd'), button: px('.tg-chips button'), cards: document.querySelectorAll('.tg-game').length,
        icons: document.querySelectorAll('img.tg-gicon').length, back: getComputedStyle(document.body).backgroundColor,
      };
    },
  };
  // the Settings tab: what it shows, a click like the player's, a slider moved
  window.settingsTest = {
    text: () => panels.settings.innerText,
    has: (sel: string) => !!sheet.querySelector(sel),
    click: (sel: string) => {
      const e = sheet.querySelector<HTMLElement>(sel);
      if (!e) return false;
      e.click();
      return true;
    },
    slide: (sel: string, value: number) => {
      const e = sheet.querySelector<HTMLInputElement>(sel);
      if (!e) return false;
      e.focus();
      e.value = String(value);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    value: (sel: string) => { const e = sheet.querySelector<HTMLInputElement>(sel); return e ? (e.type === 'checkbox' ? e.checked : e.value) : null; },
    key,
    look: () => ({
      body: parseFloat(getComputedStyle(document.body).fontSize), back: getComputedStyle(document.body).backgroundColor,
      images: sheet.querySelectorAll('img').length, sections: sheet.querySelectorAll('section').length,
    }),
  };
});
