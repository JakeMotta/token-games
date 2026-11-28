// The Games and Settings window: one window, two tabs. Which tab every way in opens, that opening it again never makes
// a second window, what the game's page is told, and the keys in the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTRY_TAB, HUB_LABELS, HUB_TABS, hubKey, isHubTab, openHub, pickTab, settingsShowing, type HubEntry, type HubState, type HubTab } from '../src/hub';

const closed: HubState = { open: false, tab: 'games' };

test('two tabs, Games then Settings, with their names', () => {
  assert.deepEqual([...HUB_TABS], ['games', 'settings']);
  assert.deepEqual(HUB_TABS.map((t) => HUB_LABELS[t]), ['Games', 'Settings']);
  assert.ok(isHubTab('games') && isHubTab('settings'));
  for (const t of ['', 'Games', 'store', 1, null, undefined, {}]) assert.equal(isHubTab(t), false, String(t));
});

test('every way in opens its own tab', () => {
  const want: Record<HubEntry, HubTab> = {
    'games-button': 'games', 'tray-games': 'games', 'open-games': 'games',
    'settings-button': 'settings', comma: 'settings', 'tray-settings': 'settings',
  };
  assert.deepEqual(ENTRY_TAB, want);
  for (const [entry, tab] of Object.entries(ENTRY_TAB)) {
    const o = openHub(closed, tab);
    assert.deepEqual(o, { next: { open: true, tab }, create: true, switched: false }, entry);
  }
});

test('closed, it opens a new window on the tab asked for, whatever it showed last', () => {
  assert.deepEqual(openHub({ open: false, tab: 'settings' }, 'games'), { next: { open: true, tab: 'games' }, create: true, switched: false });
  assert.deepEqual(openHub({ open: false, tab: 'games' }, 'settings'), { next: { open: true, tab: 'settings' }, create: true, switched: false });
});

test('open, every way in brings the same window forward and switches it to its tab: never a second window', () => {
  for (const from of HUB_TABS) {
    for (const [entry, tab] of Object.entries(ENTRY_TAB)) {
      const o = openHub({ open: true, tab: from }, tab);
      assert.equal(o.create, false, `${entry} from ${from}`);
      assert.equal(o.switched, from !== tab, `${entry} from ${from}`);
      assert.deepEqual(o.next, { open: true, tab }, `${entry} from ${from}`);
    }
  }
});

test('a run of opens makes one window only', () => {
  let s = closed, made = 0;
  for (const entry of ['games-button', 'comma', 'tray-games', 'tray-settings', 'open-games', 'settings-button'] as HubEntry[]) {
    const o = openHub(s, ENTRY_TAB[entry]);
    if (o.create) made++;
    s = o.next;
  }
  assert.equal(made, 1);
  assert.deepEqual(s, { open: true, tab: 'settings' });
});

test('picking a tab inside the window switches it, and does nothing on the tab already shown', () => {
  assert.deepEqual(pickTab({ open: true, tab: 'games' }, 'settings'), { next: { open: true, tab: 'settings' }, create: false, switched: true });
  assert.deepEqual(pickTab({ open: true, tab: 'settings' }, 'games'), { next: { open: true, tab: 'games' }, create: false, switched: true });
  assert.deepEqual(pickTab({ open: true, tab: 'games' }, 'games'), { next: { open: true, tab: 'games' }, create: false, switched: false });
  // a late message from a window already closed opens nothing
  assert.deepEqual(pickTab(closed, 'settings'), { next: { open: false, tab: 'settings' }, create: false, switched: false });
});

test('the game\'s page mirrors its Settings sheet only while the Settings tab shows', () => {
  assert.equal(settingsShowing({ open: true, tab: 'settings' }), true);
  assert.equal(settingsShowing({ open: true, tab: 'games' }), false);
  assert.equal(settingsShowing({ open: false, tab: 'settings' }), false);
  assert.equal(settingsShowing({ open: false, tab: 'games' }), false);
});

test('Esc, Cmd+W and Ctrl+W close the window from either tab', () => {
  for (const cur of HUB_TABS) {
    assert.deepEqual(hubKey({ key: 'Escape' }, cur), { do: 'close' });
    assert.deepEqual(hubKey({ key: 'Escape', onTab: true }, cur), { do: 'close' });
    assert.deepEqual(hubKey({ key: 'w', meta: true }, cur), { do: 'close' });
    assert.deepEqual(hubKey({ key: 'W', meta: true }, cur), { do: 'close' });
    assert.deepEqual(hubKey({ key: 'w', ctrl: true }, cur), { do: 'close' });
  }
  assert.equal(hubKey({ key: 'w' }, 'games'), null); // a plain w is typing, not closing
  assert.equal(hubKey({ key: 'Escape', meta: true }, 'games'), null);
});

test('Cmd+1 and Cmd+2 (Ctrl on other systems) pick the tabs, Cmd+, picks Settings', () => {
  for (const cur of HUB_TABS) {
    assert.deepEqual(hubKey({ key: '1', meta: true }, cur), { do: 'tab', tab: 'games' });
    assert.deepEqual(hubKey({ key: '2', meta: true }, cur), { do: 'tab', tab: 'settings' });
    assert.deepEqual(hubKey({ key: '1', ctrl: true }, cur), { do: 'tab', tab: 'games' });
    assert.deepEqual(hubKey({ key: '2', ctrl: true }, cur), { do: 'tab', tab: 'settings' });
    assert.deepEqual(hubKey({ key: ',', meta: true }, cur), { do: 'tab', tab: 'settings' });
  }
  for (const key of ['0', '3', '9']) assert.equal(hubKey({ key, meta: true }, 'games'), null, key);
  assert.equal(hubKey({ key: '1' }, 'settings'), null); // a plain 1 is typing
  assert.equal(hubKey({ key: '1', meta: true, alt: true }, 'settings'), null);
  assert.equal(hubKey({ key: 'q', meta: true }, 'games'), null); // other shortcuts are left alone
});

test('the arrow keys, Home and End move between the tabs while a tab has the focus, wrapping', () => {
  assert.deepEqual(hubKey({ key: 'ArrowRight', onTab: true }, 'games'), { do: 'tab', tab: 'settings' });
  assert.deepEqual(hubKey({ key: 'ArrowRight', onTab: true }, 'settings'), { do: 'tab', tab: 'games' });
  assert.deepEqual(hubKey({ key: 'ArrowLeft', onTab: true }, 'settings'), { do: 'tab', tab: 'games' });
  assert.deepEqual(hubKey({ key: 'ArrowLeft', onTab: true }, 'games'), { do: 'tab', tab: 'settings' });
  assert.deepEqual(hubKey({ key: 'Home', onTab: true }, 'settings'), { do: 'tab', tab: 'games' });
  assert.deepEqual(hubKey({ key: 'End', onTab: true }, 'games'), { do: 'tab', tab: 'settings' });
});

test('the arrow keys do nothing to the tabs elsewhere: sliders and lists keep them', () => {
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'ArrowUp', 'ArrowDown']) {
    assert.equal(hubKey({ key }, 'games'), null, key);
    assert.equal(hubKey({ key, onTab: false }, 'settings'), null, key);
  }
  assert.equal(hubKey({ key: 'ArrowUp', onTab: true }, 'games'), null);
  assert.equal(hubKey({ key: 'ArrowRight', onTab: true, alt: true }, 'games'), null);
  assert.equal(hubKey({ key: 'ArrowRight', onTab: true, meta: true }, 'games'), null);
});
