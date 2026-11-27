// Drawing helpers the views share. Nothing here decides how a view looks.
(function () {
  'use strict';
  const H = {};

  H.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  H.lerp = (a, b, f) => a + (b - a) * f;
  H.fmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
  H.hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // Which way an enemy is walking, from the path just ahead of it.
  H.heading = (g, e) => {
    const a = g.path.at(e.d), b = g.path.at(e.d + 0.08);
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { dx: dx / l, dy: dy / l };
  };
  // How far a shot has flown from its tower to its target, 0 to 1.
  H.flight = (s) => {
    const total = Math.hypot(s.tx - s.sx, s.ty - s.sy) || 1;
    return H.clamp(1 - Math.hypot(s.tx - s.x, s.ty - s.y) / total, 0, 1);
  };
  // 1 just after a tower fires, falling to 0.
  H.recoil = (tw) => {
    const st = TD.towerStats(tw.type, tw.level);
    return H.clamp(1 - (1 / st.rate - tw.cool) * 7, 0, 1);
  };
  H.radius = (e) => TD.ENEMIES[e.t].radius;

  // A smooth path through control points (Catmull-Rom), as a polyline every `step` units.
  H.spline = (pts, step) => {
    const out = [];
    const P = (i) => pts[H.clamp(i, 0, pts.length - 1)];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([+f(p0[0], p1[0], p2[0], p3[0]).toFixed(3), +f(p0[1], p1[1], p2[1], p3[1]).toFixed(3)]);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  };

  // Distance from a point to the nearest point of a polyline.
  H.distToPath = (pts, x, y) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const f = H.clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
      best = Math.min(best, Math.hypot(ax + dx * f - x, ay + dy * f - y));
    }
    return best;
  };

  H.rrect = (c, x, y, w, h, r) => {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  };
  H.poly = (c, pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
  H.hexPts = (x, y, r, rot) => Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 3 * i + (rot || 0);
    return [x + r * Math.cos(a), y + r * Math.sin(a)];
  });

  // A sprite drawn with its feet at (x, y). Returns false when the picture is missing.
  H.sprite = (c, im, x, y, opts) => {
    if (!im) return false;
    const o = opts || {};
    const s = o.scale || 1, sx = (o.sx || 1) * s, sy = (o.sy || 1) * s;
    c.save();
    c.translate(Math.round(x), Math.round(y));
    if (o.flip) c.scale(-1, 1);
    if (o.alpha != null) c.globalAlpha = o.alpha;
    const w = im.width * sx, h = im.height * sy;
    const box = [Math.round(-w / 2), Math.round(o.center ? -h / 2 : -h), Math.round(w), Math.round(h)];
    c.drawImage(im, ...box);
    if (o.flash) { c.globalAlpha = 0.75; c.drawImage(H.tint(im, o.flashColour || '#fff'), ...box); }
    c.restore();
    return true;
  };

  // A white silhouette of a sprite, for hit flashes (cached per image).
  const tinted = new WeakMap();
  H.tint = (im, colour) => {
    if (!im) return null;
    let m = tinted.get(im);
    if (!m) { m = {}; tinted.set(im, m); }
    if (!m[colour]) {
      const cv = document.createElement('canvas');
      cv.width = im.width; cv.height = im.height;
      const x = cv.getContext('2d');
      x.drawImage(im, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = colour; x.fillRect(0, 0, cv.width, cv.height);
      m[colour] = cv;
    }
    return m[colour];
  };

  // Enemies sorted for painting, back to front by a key.
  H.byDepth = (items, key) => items.slice().sort((a, b) => key(a) - key(b));

  window.H = H;
})();
