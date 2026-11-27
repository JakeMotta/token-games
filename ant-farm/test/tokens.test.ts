// Token to energy mapping (docs/ant-farm-design.md, "How tokens feed it").
import test from 'node:test';
import assert from 'node:assert/strict';
import { capped, HOUR_MS, SOFT_CAP, TokenMeter, TOKENS_PER_CRUMB, TOKENS_PER_ENERGY, weigh } from '../src/sim/tokens';

test('weighted tokens: input + output + cache writes + a tenth of cache reads', () => {
  assert.equal(weigh({ input: 1200, output: 850, cache_read: 40000, cache_write: 3000 }), 1200 + 850 + 3000 + 4000);
  assert.equal(weigh({ input: -5, output: NaN }), 0, 'bad counts count as nothing');
});

test('under the soft cap, 40 weighted tokens dig one grain and 500 make a crumb', () => {
  const c = new TokenMeter().add({ input: 3000, output: 2000 }, 0);
  assert.equal(c.weighted, 5000);
  assert.equal(c.energy, 5000 / TOKENS_PER_ENERGY);
  assert.equal(c.crumbs, 5000 / TOKENS_PER_CRUMB);
});

test('past the soft cap an hour, conversion turns logarithmic and stays increasing', () => {
  assert.equal(capped(SOFT_CAP), SOFT_CAP);
  assert.ok(capped(SOFT_CAP * 2) < SOFT_CAP * 2);
  assert.ok(capped(SOFT_CAP * 2) > capped(SOFT_CAP * 1.5));
  const m = new TokenMeter();
  const first = m.add({ input: SOFT_CAP }, 0);
  const second = m.add({ input: SOFT_CAP }, 1000);
  assert.equal(first.effective, SOFT_CAP);
  assert.ok(second.effective < SOFT_CAP * 0.75, 'a second big hour of tokens counts for less: ' + second.effective);
  assert.ok(second.effective > 0);
});

test('the cap window slides: an hour later, tokens count in full again', () => {
  const m = new TokenMeter();
  m.add({ input: SOFT_CAP * 3 }, 0);
  assert.ok(m.add({ input: 1000 }, 10).effective < 1000);
  const later = m.add({ input: 1000 }, HOUR_MS + 20);
  assert.equal(later.effective, 1000);
  assert.equal(m.hourTotal(), 1000);
});
