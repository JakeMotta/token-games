// The Settings window's page: the Settings sheet with room to breathe, centred on the screen like the Games window.
// The sheet itself stays in the game's page (its own sections, Display, Games, Reset), hidden; this page shows a copy
// of it (page/mirror.ts) and sends every click and new value back through window.tokenSettings
// (settings-window-preload.ts), so the game's and the shell's own code handle them. Esc (or Cmd/Ctrl+W) closes it.
import type { SettingsInput, SettingsSnap, SettingsWindowApi } from '../api';
import { morph, pathOf } from './mirror';

declare global {
  interface Window { tokenSettings: SettingsWindowApi; settingsTest?: unknown }
}

const api = window.tokenSettings;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

const head = el('header', 'gw-head'), sub = el('span', 'gw-sub'), close = el('button', 'gw-close', 'Close');
close.id = 'gw-close'; close.title = 'Close (Esc)';
close.onclick = () => api.close();
head.append(el('h1', '', 'Settings'), sub, el('span', 'gw-sp'), close);
const main = el('main', 'gw-main sw-main');
const sheet = el('div', 'tg-panel sw-sheet');
sheet.id = 'sw-sheet';
main.append(sheet);
document.body.append(head, main);

const css = new Set<string>();
function show(s: SettingsSnap): void {
  for (const f of s.css) {
    if (css.has(f)) continue;
    css.add(f);
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = f;
    document.head.insertBefore(l, document.head.querySelector('link[href="settings.css"]'));
  }
  morph(sheet, s.html);
}

const send = (e: Event, i: Omit<SettingsInput, 'path'>) => {
  const path = pathOf(sheet, e.target as Element);
  if (path && path.length) api.input({ path, ...i });
};
// Nothing here changes by itself: a click asks the game's page, which answers with the new sheet.
sheet.addEventListener('click', (e) => { e.preventDefault(); send(e, { type: 'click' }); });
sheet.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.type !== 'checkbox' && t.type !== 'radio') send(e, { type: 'input', value: t.value });
});
sheet.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.type !== 'checkbox' && t.type !== 'radio') send(e, { type: 'change', value: t.value });
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'w' || e.key === ','))) { e.preventDefault(); api.close(); }
});
api.onSnap(show);

api.boot().then((b) => {
  sub.textContent = 'for ' + b.name;
  if (b.snap) show(b.snap);
  if (!b.smoke) return;
  // for the hidden smoke test only: what the window shows, a click like the player's, a slider moved, a key
  window.settingsTest = {
    text: () => document.body.innerText,
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
    key: (key: string, meta = false) => dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: meta })),
    look: () => ({
      body: parseFloat(getComputedStyle(document.body).fontSize), back: getComputedStyle(document.body).backgroundColor,
      images: sheet.querySelectorAll('img').length, sections: sheet.querySelectorAll('section').length,
    }),
  };
});
