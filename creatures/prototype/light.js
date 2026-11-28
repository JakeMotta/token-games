/* Creatures prototype: the light. A sun crosses the sky from up-left (dawn, 6:00) over the top (noon) to up-right
   (dusk, 18:00) on a tilted arc a little behind the floor; at night a faint moon takes the same path. The light gives:
   the direction the shadow is cast along (towards the light, in the world: +x is screen right, +y up, +z towards us),
   how strong the direct light is, how soft its shadow is, and a warm or cool tint for the whole stage.
   Pure maths, no DOM: render.js projects the creature's real body onto the ground along `dir` and app.js tints the stage.
   CreatureLight.at(hours) -> { hours, kind, dir, elev, strength, soft, tint, shadowRgb, sky, phase }. */
(function (root) {
  'use strict';
  const DEG = Math.PI / 180;
  const SUN_TILT = 62 * DEG;     // the sun's highest point (noon), a little behind the floor so noon shadows fall towards us
  const MOON_TILT = 48 * DEG;    // the moon rides lower
  const MIN_ELEV = 18 * DEG;     // shadows are cast as if the light were at least this high, so they stay on the floor
  const MOON_LIGHT = 0.32;       // moonlight is this strong next to the sun
  const SUNRISE = 6, SUNSET = 18;

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const wrap24 = (h) => ((h % 24) + 24) % 24;

  // A body on an arc: u = 0 rises on the left, 0.5 is the top, 1 sets on the right. Returns the unit vector towards it
  // (below the horizon when u is outside 0..1).
  function arc(u, tilt) {
    const a = Math.PI * u;
    return [-Math.cos(a), Math.sin(a) * Math.sin(tilt), -Math.sin(a) * Math.cos(tilt)];
  }
  // The direction a shadow is cast along: the light's own compass direction, lifted to at least MIN_ELEV.
  function castDir(v) {
    const h = Math.hypot(v[0], v[2]) || 1e-9, e = Math.max(MIN_ELEV, Math.asin(Math.max(-1, Math.min(1, v[1]))));
    return [v[0] / h * Math.cos(e), Math.sin(e), v[2] / h * Math.cos(e)];
  }

  function at(hours) {
    const h = wrap24(hours);
    const sun = arc((h - SUNRISE) / (SUNSET - SUNRISE), SUN_TILT);
    const moon = arc(wrap24(h - SUNSET) / (24 - (SUNSET - SUNRISE)), MOON_TILT);
    const sunElev = Math.asin(sun[1]), moonElev = Math.asin(moon[1]);
    // The sun fades in over its first few degrees; the moon is dimmer and only counts once the sun is gone.
    const sunI = smooth(-1 * DEG, 9 * DEG, sunElev);
    const moonI = MOON_LIGHT * smooth(-1 * DEG, 9 * DEG, moonElev) * smooth(2 * DEG, -6 * DEG, sunElev);
    const useSun = sunI >= moonI;
    const v = useSun ? sun : moon, elev = useSun ? sunElev : moonElev;
    // Warm light near the horizon at dawn and dusk; cool and darker at night.
    const warm = smooth(-8 * DEG, 1 * DEG, sunElev) * (1 - smooth(5 * DEG, 22 * DEG, sunElev));
    const night = smooth(3 * DEG, -9 * DEG, sunElev);
    let tint = [255, 255, 255];
    tint = mix(tint, [255, 196, 150], warm * 0.42);
    tint = mix(tint, [108, 122, 182], night * 0.62);
    const amount = Math.max(warm * 0.42, night * 0.62);
    const shadowRgb = mix(mix([22, 26, 52], [52, 26, 44], warm), [6, 10, 28], night);
    const phase = night > 0.5 ? 'night' : warm > 0.35 ? (h < 12 ? 'dawn' : 'dusk') : h < 10.5 ? 'morning' : h < 13.5 ? 'noon' : 'afternoon';
    return {
      hours: h, kind: useSun ? 'sun' : 'moon', phase,
      dir: castDir(v), elev,
      strength: useSun ? sunI : moonI,
      // Penumbra sharpness for the soft look: a high sun is crisp, a low sun or the moon is soft.
      soft: useSun ? 5 + 9 * smooth(MIN_ELEV, 60 * DEG, elev) : 3,
      tint: tint.map(Math.round), tintAmount: amount, shadowRgb: shadowRgb.map(Math.round),
      // Where the light sits in the sky picture: x 0 (left) .. 1 (right), up 0 (horizon) .. 1 (top), and if it is up.
      sky: { x: clamp01(0.5 + v[0] * 0.5), up: clamp01(Math.sin(Math.max(0, elev)) / Math.sin(useSun ? SUN_TILT : MOON_TILT)), visible: elev > -2 * DEG },
    };
  }

  // A world direction seen from the body's own frame: the body faces +x along its heading, so turn by -heading.
  // (A heading turns the walker counter-clockwise seen from above; heading pi/2 walks towards -z.)
  function toBody(d, heading) {
    const c = Math.cos(-heading), s = Math.sin(-heading);
    return [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c];
  }
  // Where a point lands on the ground (y = 0) along the light direction.
  function ground(p, dir) {
    const t = p[1] / Math.max(1e-6, dir[1]);
    return [p[0] - dir[0] * t, 0, p[2] - dir[2] * t];
  }
  // How far a point at this height throws its shadow along the floor.
  const shadowLength = (height, dir) => height * Math.hypot(dir[0], dir[2]) / Math.max(1e-6, dir[1]);
  // The longest shadow any time of day can throw, as a multiple of height.
  const MAX_REACH = 1 / Math.tan(MIN_ELEV);

  // A clock string for the time-of-day control.
  function clock(hours) {
    const h = wrap24(hours), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  const api = { at, toBody, ground, shadowLength, clock, MIN_ELEV, MAX_REACH, SUNRISE, SUNSET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureLight = api;
})(typeof window !== 'undefined' ? window : globalThis);
