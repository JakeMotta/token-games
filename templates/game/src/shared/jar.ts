// The whole game, kept free of the DOM so it can be tested: a jar that fills with sand from real tokens. Replace it
// with yours. The one rule that stays: only real usage events (UsageEvent) may move the game forward.
import type { UsageEvent } from '@token-games/shell/events';

export const TOKENS_PER_GRAIN = 1000; // weighted tokens for one grain
export const JAR_GRAINS = 4000; // a full jar; it then empties and starts again
export const CACHE_READ_WEIGHT = 0.1; // cached input is cheap, so it counts for less

export interface JarSave { v: 1; grains: number; carry: number; jars: number; tasks: number }

export class Jar {
  grains = 0; // in the jar now
  carry = 0; // weighted tokens toward the next grain
  jars = 0; // jars filled so far
  tasks = 0; // turns the agent finished

  feed(ev: UsageEvent): number { // returns the grains this event added
    if (ev.type === 'task_done') { this.tasks++; return 0; }
    if (ev.type !== 'tokens') return 0;
    this.carry += ev.input + ev.output + ev.cache_write + CACHE_READ_WEIGHT * ev.cache_read;
    const add = Math.floor(this.carry / TOKENS_PER_GRAIN);
    this.carry -= add * TOKENS_PER_GRAIN;
    this.grains += add;
    while (this.grains >= JAR_GRAINS) { this.grains -= JAR_GRAINS; this.jars++; }
    return add;
  }

  get fill(): number { return this.grains / JAR_GRAINS; }

  save(): JarSave { return { v: 1, grains: this.grains, carry: this.carry, jars: this.jars, tasks: this.tasks }; }

  static load(raw: unknown): Jar {
    const j = new Jar(), s = raw as Partial<JarSave> | null;
    if (!s || s.v !== 1) return j;
    const n = (v: unknown, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0);
    j.grains = Math.floor(n(s.grains, JAR_GRAINS - 1)); j.carry = n(s.carry, TOKENS_PER_GRAIN); j.jars = Math.floor(n(s.jars)); j.tasks = Math.floor(n(s.tasks));
    return j;
  }
}
