// The game picker, in two layouts. 'window' fills the Games window (the Games buttons, the tray's Games…): every
// game shown as a card: the built-in one, the approved games the signed catalog offers, and what is on this computer
// (developer and unapproved games too only while "Show developer and unapproved games" is on). 'summary' is Settings →
// Games: a line about what is installed, that switch, and a button that opens the Games window. Both show every request
// waiting for the player (an install, update or removal they asked for, or one an agent asked for through the
// tokengames CLI) as a permission sheet with Approve and Deny; approving is only possible in the app.
// Everything from the catalog is shown as text (textContent), never as HTML.
import { updatesIn, type GamesApi, type GamesOp, type GamesView } from '../api';
import type { GameRow, PendingRequest } from '../catalog/catalog';

const TIER: Record<string, string> = { 'built-in': 'built in', verified: 'verified', community: 'community', local: 'local folder' };
const ACTION: Record<string, string> = { install: 'Install', update: 'Update', remove: 'Remove', 'add-local': 'Add' };

export interface GamesPanel {
  el: HTMLElement;
  refresh(): void; // read the view again (the panel opened)
  view(): GamesView | null;
}

export interface GamesPanelOptions {
  layout: 'window' | 'summary';
  onAgentRequest?: (r: PendingRequest) => void;
  onUpdates?: (n: number) => void; // how many installed games have a newer version, each time the view changes (the dot)
  openWindow?: () => void; // the summary's Open Games… button
}

export function gamesPanel(api: GamesApi, o: GamesPanelOptions): GamesPanel {
  const onAgentRequest = o.onAgentRequest || (() => {}), onUpdates = o.onUpdates || (() => {});
  const el = document.createElement('section');
  el.className = 'tg-games tg-games-' + o.layout;
  el.id = 'tg-games';
  let v: GamesView | null = null, busy = false, error = '';
  const seen = new Set<string>();

  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const btn = (text: string, id: string, fn: () => void, cls = ''): HTMLButtonElement => {
    const b = h('button', cls, text);
    b.dataset.games = id;
    b.disabled = busy;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  };

  async function run(op: GamesOp): Promise<void> {
    busy = true; error = ''; render();
    try {
      const r = await api.gamesDo(op);
      v = r.view;
      onUpdates(updatesIn(v.rows));
      error = r.ok ? '' : r.error || 'that did not work';
    } catch (e) { error = (e as Error).message; }
    busy = false;
    render();
  }

  function sheet(r: PendingRequest): HTMLElement {
    const s = h('div', 'tg-sheet');
    s.dataset.request = r.requestId;
    const title = h('div', 'tg-sheet-t');
    title.append(h('b', '', `${ACTION[r.action] || r.action} ${r.name}`), h('span', 'tg-ver', r.action === 'remove' ? '' : ` ${r.version}`), h('span', 'tg-tier', TIER[r.tier] || r.tier));
    s.append(title);
    if (r.from === 'agent') s.append(h('div', 'tg-agent', 'Requested by an agent. Nothing changes unless you approve.'));
    const ul = h('ul');
    for (const l of r.sheet) { const li = h('li', 'tg-l-' + l.kind, l.text); ul.append(li); }
    s.append(ul);
    const row = h('div', 'tg-chips');
    row.append(btn('Approve', 'approve:' + r.requestId, () => void run({ op: 'approve', requestId: r.requestId }), 'tg-yes'),
      btn('Deny', 'deny:' + r.requestId, () => void run({ op: 'deny', requestId: r.requestId })));
    s.append(row);
    return s;
  }

  // The game's own icon, or its first letter on a tile
  function icon(g: GameRow): HTMLElement {
    const src = v?.icons[g.id];
    if (!src) return h('div', 'tg-gicon tg-gletter', (g.name.trim()[0] || '?').toUpperCase());
    const img = h('img', 'tg-gicon');
    img.src = src; img.alt = '';
    return img;
  }

  function gameRow(g: GameRow): HTMLElement {
    const upd = g.installed && !!g.update && !g.blocked;
    const row = h('div', 'tg-game' + (g.active ? ' on' : '') + (upd ? ' upd' : ''));
    row.dataset.game = g.id;
    row.append(icon(g));
    const info = h('div', 'tg-gi');
    const t = h('div', 'tg-gt');
    t.append(h('b', '', g.name), h('span', 'tg-ver', ' ' + g.version), h('span', 'tg-tier', TIER[g.tier] || g.tier));
    if (upd) t.append(h('span', 'tg-updtag', 'Update available'));
    if (g.unapproved) t.append(h('span', 'tg-devtag', 'Not approved: ' + g.unapproved));
    info.append(t, h('div', 'tg-gd', g.blocked ? 'Blocked: ' + g.blocked : g.description));
    if (g.network.length) info.append(h('div', 'tg-gd', 'Reaches: ' + g.network.join(', ')));
    const acts = h('div', 'tg-chips');
    if (g.active) acts.append(h('span', 'tg-playing', 'Playing'));
    else if (g.installed && !g.blocked) acts.append(btn('Play', 'use:' + g.id, () => void run({ op: 'use', id: g.id })));
    if (!g.installed && !g.blocked) acts.append(btn('Install', 'install:' + g.id, () => void run({ op: 'request', action: 'install', id: g.id })));
    if (upd) acts.append(btn('Update to ' + g.update, 'update:' + g.id, () => void run({ op: 'request', action: 'update', id: g.id }), 'tg-yes'));
    if (g.installed && g.tier !== 'built-in') acts.append(btn('Remove', 'remove:' + g.id, () => void run({ op: 'request', action: 'remove', id: g.id })));
    row.append(info, acts);
    return row;
  }

  function render(): void {
    el.textContent = '';
    if (o.layout === 'summary') renderSummary(); else renderWindow();
  }

  // Settings → Games: what waits for the player, one line, and the way to the Games window
  function renderSummary(): void {
    el.append(h('h4', '', 'Games'));
    if (!v) { el.append(h('p', 'tg-note', 'Loading…')); return; }
    for (const r of v.pending) el.append(sheet(r));
    const playing = v.rows.find((g) => g.active), installed = v.rows.filter((g) => g.installed).length, updates = updatesIn(v.rows);
    const line = [playing ? 'Playing ' + playing.name : '', `${installed} game${installed === 1 ? '' : 's'} on this computer`,
      updates ? `${updates} update${updates === 1 ? '' : 's'} available` : ''].filter(Boolean).join(' · ');
    el.append(h('p', 'tg-note', line));
    if (error) el.append(h('p', 'tg-note tg-err', error));
    const acts = h('div', 'tg-chips');
    acts.append(btn('Open Games…', 'open', () => o.openWindow?.()));
    el.append(acts);
    // developer and unapproved games: local folders, community and test catalogs, copies of the built-in game
    const lab = h('label', 'tg-row tg-devrow');
    const cb = h('input');
    cb.type = 'checkbox'; cb.id = 'tg-developer'; cb.checked = v.developer; cb.disabled = busy;
    cb.onchange = () => void run({ op: 'developer', on: cb.checked });
    lab.append(cb, ' Show developer and unapproved games');
    el.append(lab, h('p', 'tg-note', v.developer
      ? 'On: the Games window also lists local folders, community games, test catalogs and copies of the built-in game, and offers Add local folder….'
      : 'Off: the Games window lists only the built-in game and approved games from the signed catalog' + (v.hiddenCount ? ` (${v.hiddenCount} hidden)` : '') + '.'));
  }

  function renderWindow(): void {
    if (!v) { el.append(h('p', 'tg-note', 'Loading…')); return; }
    if (v.pending.length) {
      const waits = h('div', 'tg-pending');
      waits.append(h('h2', '', v.pending.length === 1 ? 'Waiting for you' : `${v.pending.length} requests waiting for you`));
      for (const r of v.pending) waits.append(sheet(r));
      el.append(waits);
    }
    const bar = h('div', 'tg-gbar');
    const acts = h('div', 'tg-chips');
    acts.append(btn(busy ? 'Working…' : 'Check for games', 'refresh', () => void run({ op: 'refresh' }), 'tg-yes'));
    if (v.canAddLocal && v.developer) acts.append(btn('Add local folder…', 'add-local', () => void run({ op: 'add-local' })));
    bar.append(acts);
    if (v.developer) bar.append(h('span', 'tg-devtag', 'Showing developer and unapproved games (Settings → Games)'));
    el.append(bar);
    const c = v.catalog;
    const note = c.error ? 'The catalog could not be read: ' + c.error
      : c.fetchedAt ? `Catalog checked ${new Date(c.fetchedAt).toLocaleString()} · ${c.games} game${c.games === 1 ? '' : 's'}, signature verified`
      : 'The catalog is only fetched when you ask: Check for games.';
    const hidden = v.hiddenCount ? ` · ${v.hiddenCount} not approved, hidden (Settings → Games shows them)` : '';
    el.append(h('p', 'tg-note', note + hidden));
    if (error) el.append(h('p', 'tg-note tg-err', error));
    const list = h('div', 'tg-glist');
    for (const g of v.rows) list.append(gameRow(g));
    el.append(list);
  }

  function take(next: GamesView): void {
    v = next;
    onUpdates(updatesIn(next.rows));
    for (const r of next.pending) {
      if (seen.has(r.requestId)) continue;
      seen.add(r.requestId);
      if (r.from === 'agent') onAgentRequest(r);
    }
    render();
  }

  api.onGames(take);
  const refresh = () => { api.games().then(take, () => {}); };
  refresh();
  render();
  return { el, refresh, view: () => v };
}
