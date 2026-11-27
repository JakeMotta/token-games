// The marker window's page (see marker.html): the game's icon, its count and a warm dot; a click docks the game.
import type { ShellApi } from '../api';

const api = (window as unknown as { tokenShell: ShellApi }).tokenShell;
const q = new URLSearchParams(location.search);
const $ = (id: string) => document.getElementById(id)!;
document.body.classList.toggle('pill', q.get('notch') !== '1');
($('icon') as HTMLImageElement).src = q.get('icon') || '';
$('mk').title = (q.get('name') || '') + ' is popped out: click to put it back in the notch';
$('mk').addEventListener('click', () => api.intent('dock'));
api.onStatus((s) => { $('count').textContent = s.count; });
