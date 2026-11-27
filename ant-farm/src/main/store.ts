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
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.cur, null, 2) + '\n');
      fs.renameSync(tmp, this.file);
    } catch { /* a read-only disk: keep running on the in-memory settings */ }
  }
}
