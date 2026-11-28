// The Settings tab (of the Games and Settings window) shows a copy of the Settings sheet that lives, hidden, in the game's page: the game's own
// sections and the shell's (Display, Games, Reset) keep their code and their elements where they always were, and the
// window gets their HTML and sends the player's clicks and new values back. A game's settings work in the window
// without the game knowing it moved.
//
// snapshot() writes what only lives in properties (a slider's value, a checkbox) into the HTML and turns canvases into
// images; morph() changes the window's copy into the new HTML in place, so a slider being dragged or a focused button
// stays as it is; pathOf() and nodeAt() name an element by its place among its parent's elements, the same on both sides.
import type { SettingsInput } from '../api';

interface Tree { children: ArrayLike<Tree>; parentElement: Tree | null }

// child indexes (elements only) from root down to node; null when node is not inside root
export function pathOf(root: Tree, node: Tree | null): number[] | null {
  const path: number[] = [];
  for (let n = node; n && n !== root; n = n.parentElement) {
    const p = n.parentElement;
    if (!p) return null;
    path.unshift(Array.prototype.indexOf.call(p.children, n));
  }
  return node ? path : null;
}

export function nodeAt<T extends Tree>(root: T, path: readonly number[]): T | null {
  let n: Tree | undefined = root;
  for (const i of path) n = n?.children[i];
  return (n as T) || null;
}

export function snapshot(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  const live = root.querySelectorAll('*'), out = copy.querySelectorAll('*');
  live.forEach((e, i) => {
    const c = out[i];
    if (e instanceof HTMLInputElement) {
      if (e.type === 'checkbox' || e.type === 'radio') c.toggleAttribute('checked', e.checked);
      else c.setAttribute('value', e.value);
    } else if (e instanceof HTMLCanvasElement) {
      const img = document.createElement('img');
      for (const a of Array.from(e.attributes)) img.setAttribute(a.name, a.value);
      img.className = e.className;
      try { img.src = e.toDataURL(); } catch { /* an empty canvas */ }
      c.replaceWith(img);
    }
  });
  return copy.innerHTML;
}

// Make target's children match html. Elements of the same tag are kept and their attributes changed; a slider or a
// text field the player is using keeps its value until they let go.
export function morph(target: Element, html: string): void {
  const t = document.createElement('template');
  t.innerHTML = html;
  morphChildren(target, t.content);
}

function morphChildren(a: ParentNode, b: ParentNode): void {
  const want = Array.from(b.childNodes);
  want.forEach((w, i) => {
    const have = a.childNodes[i];
    if (!have) a.appendChild(w);
    else if (have.nodeType !== w.nodeType || have.nodeName !== w.nodeName) a.replaceChild(w, have);
    else if (have.nodeType === Node.ELEMENT_NODE) morphElement(have as Element, w as Element);
    else if (have.nodeValue !== w.nodeValue) have.nodeValue = w.nodeValue;
  });
  while (a.childNodes.length > want.length) a.lastChild!.remove();
}

function morphElement(a: Element, b: Element): void {
  for (const n of a.getAttributeNames()) if (!b.hasAttribute(n)) a.removeAttribute(n);
  for (const n of b.getAttributeNames()) if (a.getAttribute(n) !== b.getAttribute(n)) a.setAttribute(n, b.getAttribute(n)!);
  if (a instanceof HTMLInputElement) {
    if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
    else if (document.activeElement !== a) a.value = b.getAttribute('value') ?? '';
  }
  morphChildren(a, b);
}

// The player's input, done to the real element in the game's page.
export function replay(root: HTMLElement, i: SettingsInput): boolean {
  const e = nodeAt(root as unknown as Tree, i.path) as unknown as HTMLElement | null;
  if (!e) return false;
  if (i.type === 'click') {
    // a click on a label's text toggles its checkbox, as it would have in the sheet
    const label = e.closest('label');
    if (label && root.contains(label) && !(e instanceof HTMLInputElement) && !e.closest('button') && label.control) label.control.click();
    else e.click();
    return true;
  }
  if (!(e instanceof HTMLInputElement)) return false;
  if (i.value !== undefined) e.value = i.value;
  if (i.checked !== undefined) e.checked = i.checked;
  e.dispatchEvent(new Event(i.type, { bubbles: true }));
  return true;
}
