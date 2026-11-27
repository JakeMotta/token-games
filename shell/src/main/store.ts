// The settings file: one small JSON file in the app's user data folder. A missing or broken file means defaults; a
// change is written a moment later (so dragging a slider doesn't write on every step) and always on quit.
import fs from 'node:fs';
import path from 'node:path';
import type { SettingsKit, ShellSettings } from '../settings';

export class SettingsStore<S extends ShellSettings = ShellSettings> {
  private cur: S;
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly file: string, private kit: SettingsKit<S>, private delayMs = 400, newSeed = () => (Math.random() * 2 ** 32) >>> 0) {
    let raw: unknown = null;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run or a broken file */ }
    const base = kit.defaults(newSeed());
    this.cur = raw ? kit.sanitize(raw, base) : base;
    if (!raw) this.save();
  }

  get(): S { return this.cur; }

  set(patch: Partial<S>): S {
    this.cur = this.kit.applyPatch(this.cur, patch);
    this.later();
    return this.cur;
  }

  reset(): S {
    this.cur = this.kit.reset(this.cur);
    this.later();
    return this.cur;
  }

  // Write now (on quit, and in tests).
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.save();
  }

  private later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, this.delayMs);
    this.timer.unref?.();
  }

  private save(): void {
    writeAtomic(this.file, JSON.stringify(this.cur, null, 2) + '\n'); // a read-only disk: keep running on the in-memory settings
  }
}

// The game's own state (an ant farm's colony, say), saved by the page now and then and on hide, so the game carries
// on across restarts. Games keep it small.
export class SaveFile {
  constructor(readonly file: string) {}

  load(): unknown {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; } // none yet, or broken: a new game
  }

  save(data: unknown): boolean {
    return !!data && typeof data === 'object' && writeAtomic(this.file, JSON.stringify(data));
  }
}

// Write a whole file or nothing: a crash mid-write leaves the old file.
function writeAtomic(file: string, text: string): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}
