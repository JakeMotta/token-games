// The settings file: one small JSON file in the app's user data folder. A missing or broken file means defaults; a
// change is written a moment later (so dragging a slider doesn't write on every step) and always on quit.
import fs from 'node:fs';
import path from 'node:path';
import { applyPatch, defaultSettings, resetSettings, sanitize, type Settings } from '../shared/settings';

export class SettingsStore {
  private cur: Settings;
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly file: string, private delayMs = 400, newSeed = () => (Math.random() * 2 ** 32) >>> 0) {
    let raw: unknown = null;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run or a broken file */ }
    const base = defaultSettings(newSeed());
    this.cur = raw ? sanitize(raw, base) : base;
    if (!raw) this.save();
  }

  get(): Settings { return this.cur; }

  set(patch: Partial<Settings>): Settings {
    this.cur = applyPatch(this.cur, patch);
    this.later();
    return this.cur;
  }

  reset(): Settings {
    this.cur = resetSettings(this.cur);
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

// The colony itself (ants, their birth times, food, what was dug), saved by the page now and then and on hide, so the
// farm and its ants' ages carry on across restarts. Only the chunks the colony changed are in it, so it stays small.
export class ColonyFile {
  constructor(readonly file: string) {}

  load(): unknown {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; } // none yet, or broken: a new farm
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
