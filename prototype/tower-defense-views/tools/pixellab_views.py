#!/usr/bin/env python3
"""Generate the pixel art for the isometric, hex, side-lane and toy views with PixelLab.

Every picture is one `POST /v2/create-image-pixflux` call (1 generation each), on the monthly
free generations only: the script reads `GET /v2/balance` first, refuses to start unless the
free generations left cover the batch, re-reads it before every call, and stops if the paid
credits move, so it never spends money.

Each view has its own camera (pixflux's `view`, plus `isometric` for the iso view), palette
(passed as the colour image) and prompts. A tower's four levels share one seed, so they read
as the same building growing. Sprites are cropped to their pixels and shrunk, by commonest
colour, into the box the page draws them in. The PNGs go to assets/<view>/<name>.png, and
art.js is rewritten with every PNG under assets/ as a data URI, so the page works from the
file system and its canvas stays readable.

Usage:
  python3 tools/pixellab_views.py --dry-run                     # the plan, no calls
  python3 tools/pixellab_views.py [--only iso] [--names tower-rapid-1] [--force] [--limit N]
  python3 tools/pixellab_views.py --pack                         # only rewrite art.js

The key comes from PIXELLAB_API_KEY, or from the `export PIXELLAB_API_KEY=` line in ~/.zshrc.
"""
import argparse
import base64
import json
import os
import re
import struct
import sys
import urllib.error
import urllib.request
import zlib

API = "https://api.pixellab.ai/v2"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
TOWER_TYPES = ["rapid", "splash", "frost"]
ENEMY_TYPES = ["small", "medium", "big", "boss"]

# The look of each view. `boxes` is the largest box (w, h) the page draws each kind in.
VIEWS = {
	"iso": {
		"style": "isometric pixel art, desert outpost at dusk, warm sand and terracotta with teal accents",
		"camera": {"view": "high top-down", "isometric": True},
		"palette": ["#f6e3b4", "#e8b878", "#c8643c", "#7a3428", "#2f8f8a", "#7fd1c4", "#3b2a4a", "#f49a5a", "#1d1420"],
		"boxes": {"tower": (30, 40), "small": (12, 12), "medium": (16, 16), "big": (22, 22), "boss": (32, 30), "shot": (8, 8), "base": (44, 44), "prop": (22, 26)},
		"towers": {
			"rapid": ["small mud-brick post with a brass crossbow on top", "taller adobe watchtower with a twin crossbow and a cloth awning",
				"stone and adobe tower with a triple crossbow and teal banners", "grand adobe fortress tower with a repeating crossbow, gold trim and teal flags"],
			"splash": ["small clay kiln mortar with a short barrel", "bigger clay kiln mortar with a bronze barrel",
				"twin-barrel kiln mortar on a stone base, glowing coals", "huge glowing kiln mortar with three barrels and brass bands"],
			"frost": ["small stone well with a teal crystal", "fountain spire with a teal crystal on top",
				"tall fountain obelisk with two teal crystals and water", "grand oasis obelisk with a floating teal crystal and waterfalls"],
		},
		"enemies": {"small": "tiny sand beetle", "medium": "armored desert scorpion", "big": "red rock golem", "boss": "giant purple sandworm rising from the sand"},
		"shots": {"rapid": "brass crossbow bolt", "splash": "flaming clay pot", "frost": "teal water orb"},
		"base": "desert fort gate with a tall well tower, the outpost keep",
		"props": {"cactus": "saguaro cactus", "rocks": "pile of red desert rocks"},
	},
	"hex": {
		"style": "pixel art, top-down, inside a honeycomb beehive, amber honey and dark brown",
		"camera": {"view": "high top-down"},
		"palette": ["#fff1b8", "#ffd35c", "#f2a51a", "#c27510", "#6b3e12", "#2a1606", "#7fb03c", "#c4362b", "#ffffff"],
		"boxes": {"tower": (26, 30), "small": (10, 10), "medium": (14, 14), "big": (20, 20), "boss": (28, 28), "shot": (7, 7), "base": (36, 36), "prop": (16, 16)},
		"towers": {
			"rapid": ["small beeswax post with one stinger launcher", "beeswax post with a twin stinger launcher",
				"beeswax tower with a bee gunner and a stinger launcher", "golden royal beeswax tower with wings and a triple stinger launcher"],
			"splash": ["small honey pot catapult", "wooden catapult with a big honey pot",
				"twin honey pot catapult on a wax base", "golden honey trebuchet with dripping honey"],
			"frost": ["small green flower bud dripping sticky sap", "open green flower dripping sticky sap",
				"large flower with sticky sap drips and leaves", "giant glowing nectar flower with sticky sap pools"],
		},
		"enemies": {"small": "small red ant", "medium": "black shiny beetle", "big": "striped hornet", "boss": "giant hornet queen with a crown"},
		"shots": {"rapid": "bee stinger dart", "splash": "glob of golden honey", "frost": "drop of green sap"},
		"base": "royal honey cell with a fat queen bee",
		"props": {"puddle": "small honey puddle", "clover": "clover leaf"},
	},
	"lanes": {
		"style": "pixel art, side view, underground mine, dark earth lit by lanterns",
		"camera": {"view": "side"},
		"palette": ["#120c08", "#2b1d14", "#5a3b25", "#8a5f3a", "#6e6a66", "#b8b0a4", "#ffcf4a", "#e07a2e", "#5fd4e8"],
		"boxes": {"tower": (26, 30), "small": (12, 10), "medium": (16, 18), "big": (24, 26), "boss": (40, 26), "shot": (8, 8), "base": (36, 44), "prop": (18, 20)},
		"towers": {
			"rapid": ["small rivet gun on a wooden crate", "rivet gun on a wooden stand with a lantern",
				"steam rivet gun with copper pipes on a scaffold", "brass steam gatling gun with a lantern and gears"],
			"splash": ["small dynamite crate launcher", "minecart mortar loaded with dynamite",
				"double barrel minecart mortar with a fuse", "huge steam-powered dynamite cannon on rails"],
			"frost": ["small cyan crystal on a wooden stand", "cyan crystal lamp with copper coils",
				"big cyan crystal with copper coils and pipes", "giant floating cyan crystal cryo engine with coils"],
		},
		"enemies": {"small": "small green cave slime, walking right", "medium": "mole miner with goggles walking right",
			"big": "rock troll walking right", "boss": "giant armored drill worm crawling right"},
		"shots": {"rapid": "metal rivet bolt", "splash": "lit stick of dynamite", "frost": "cyan ice shard"},
		"base": "round steel gold vault door set in rock",
		"props": {"lantern": "hanging oil lantern glowing", "cart": "minecart full of gold ore"},
	},
	"toy": {
		"style": "chunky cartoon pixel art, cute toy box style, bright pastel colours, thick dark outline, big simple shapes",
		"camera": {"view": "low top-down"},
		"palette": ["#fffaf0", "#ffe27a", "#ff8fb1", "#ff6b5b", "#7fe0b5", "#8fd3ff", "#b49cff", "#5b7cff", "#2b2550"],
		"boxes": {"tower": (36, 44), "small": (14, 14), "medium": (20, 22), "big": (28, 26), "boss": (40, 40), "shot": (9, 9), "base": (52, 52), "prop": (24, 28)},
		"towers": {
			"rapid": ["small toy block tower with a pop gun", "taller toy block tower with a pop gun and a flag",
				"toy block castle turret with a striped flag and two pop guns", "big rainbow toy block castle with twin cannons and stars"],
			"splash": ["small toy spring catapult with a jelly ball", "toy catapult with a big jelly ball",
				"double toy catapult with jelly balls", "giant rainbow jelly catapult with a crown"],
			"frost": ["small ice cream cone", "double scoop ice cream cone",
				"triple scoop ice cream cone with sprinkles", "giant ice cream sundae with a cherry and sprinkles"],
		},
		"enemies": {"small": "small round blue jelly blob toy", "medium": "wind-up tin toy robot",
			"big": "green toy dinosaur", "boss": "giant grumpy brown teddy bear"},
		"shots": {"rapid": "small red rubber ball", "splash": "wobbly pink jelly blob", "frost": "rainbow sprinkle"},
		"base": "tiny cute toy castle with pink roofs",
		"props": {"tree": "round lollipop tree", "mushroom": "red spotted mushroom"},
	},
}


# Each view's token bucket, the thing that fills with tokens and lets a wave out. The pixel view's
# towers, enemies, tiles and icons come from the forest-glade set made for the earlier variants,
# so only its bucket is made here, in that set's style and palette.
VIEWS["pixel"] = {
	"style": "cozy fantasy pixel art, high top-down view, soft muted greens and warm earth tones",
	"camera": {"view": "high top-down"},
	"palette": ["#3d5a39", "#44633f", "#a8916a", "#7d6a4b", "#2b4430", "#5f7f4b", "#cbb57a", "#7fb3c9", "#c8e6f0"],
}
EXTRAS = {
	"pixel": [("bucket", "big wooden water bucket with iron bands, empty, seen from above at an angle", 48, (30, 30))],
	"iso": [("bucket", "wooden water tower on stilts with a big round tank", 64, (36, 52))],
	"lanes": [("bucket", "big wooden ore hopper with a sliding iron gate at the bottom, side view", 64, (44, 48))],
	"toy": [("bucket", "big toy sand pail, pink plastic with a yellow handle, empty", 64, (44, 44))],
}
# Ground textures (no outline, no cut-out). The forest-glade ground tile has a dirt track painted
# through it, which stripes the field when it repeats. Small canvases come back framed like a
# single tile, so these are made as a wide field and only the middle is kept: 48 x 48, which the
# page cuts into four 24 x 24 cells.
TILES = {
	"pixel": [
		("tile-grass", "a wide open lawn of short meadow grass with tiny tufts seen from straight above, even texture all over, no objects, no border"),
		("tile-dirt", "a wide open patch of packed brown dirt with small pebbles seen from straight above, even texture all over, no objects, no border"),
	],
}


def plan(vid):
	v = VIEWS[vid]
	jobs = [{"name": name, "desc": desc + ", single object, centred, " + v["style"], "canvas": canvas, "box": box, "seed": None}
		for name, desc, canvas, box in EXTRAS.get(vid, [])]
	jobs += [{"name": name, "desc": desc + ", " + v["style"], "canvas": 128, "box": (48, 48), "seed": None, "tile": True}
		for name, desc in TILES.get(vid, [])]
	if "towers" not in v:
		return jobs
	b = v["boxes"]
	for t in TOWER_TYPES:
		for lvl, desc in enumerate(v["towers"][t], 1):
			jobs.append({"name": "tower-%s-%d" % (t, lvl), "desc": desc + ", one tower, level %d of 4, centred, %s" % (lvl, v["style"]),
				"canvas": 48 if vid != "toy" else 64, "box": b["tower"], "seed": 400 + TOWER_TYPES.index(t)})
	for e in ENEMY_TYPES:
		jobs.append({"name": "enemy-" + e, "desc": v["enemies"][e] + ", single creature, centred, " + v["style"],
			"canvas": 32 if e in ("small", "medium") else 48 if e == "big" else 64, "box": b[e], "seed": None})
	for t in TOWER_TYPES:
		jobs.append({"name": "shot-" + t, "desc": v["shots"][t] + ", small projectile, centred, " + v["style"],
			"canvas": 32, "box": b["shot"], "seed": None})
	jobs.append({"name": "base", "desc": v["base"] + ", centred, " + v["style"], "canvas": 64, "box": b["base"], "seed": None})
	for name, desc in v["props"].items():
		jobs.append({"name": "prop-" + name, "desc": desc + ", single object, centred, " + v["style"], "canvas": 32, "box": b["prop"], "seed": None})
	return jobs


# --- PNG in and out, standard library only -------------------------------------------------

def png(w, h, rows):
	raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in rows)
	chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
	return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + \
		chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def unpng(data):
	"""(w, h, rows of RGBA tuples) from an 8-bit, non-interlaced PNG."""
	assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
	pos, idat, plte, trns = 8, b"", None, None
	while pos < len(data):
		n, t = struct.unpack(">I4s", data[pos:pos + 8])
		d = data[pos + 8:pos + 8 + n]
		if t == b"IHDR":
			w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", d)
		elif t == b"IDAT":
			idat += d
		elif t == b"PLTE":
			plte = [tuple(d[i:i + 3]) for i in range(0, len(d), 3)]
		elif t == b"tRNS":
			trns = d
		pos += 12 + n
	assert depth == 8 and not interlace, "only 8-bit, non-interlaced PNGs"
	bpp = {6: 4, 2: 3, 3: 1, 0: 1, 4: 2}[ctype]
	raw, stride, prev, rows, i = zlib.decompress(idat), w * bpp, bytearray(w * bpp), [], 0
	for _ in range(h):
		f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
		i += 1 + stride
		for x in range(stride):
			a = line[x - bpp] if x >= bpp else 0
			b, c = prev[x], prev[x - bpp] if x >= bpp else 0
			if f == 1: line[x] = (line[x] + a) & 255
			elif f == 2: line[x] = (line[x] + b) & 255
			elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
			elif f == 4:
				p = a + b - c
				pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
				line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
		prev = line
		if ctype == 6: rows.append([tuple(line[x:x + 4]) for x in range(0, stride, 4)])
		elif ctype == 2: rows.append([tuple(line[x:x + 3]) + (255,) for x in range(0, stride, 3)])
		elif ctype == 3: rows.append([plte[v] + ((trns[v] if trns and v < len(trns) else 255),) for v in line])
		elif ctype == 0: rows.append([(v, v, v, 255) for v in line])
		else: rows.append([(line[x], line[x], line[x], line[x + 1]) for x in range(0, stride, 2)])
	return w, h, rows


def crop(rows):
	ys = [y for y, row in enumerate(rows) if any(p[3] for p in row)]
	xs = [x for x in range(len(rows[0])) if any(row[x][3] for row in rows)]
	if not ys:
		return rows
	return [row[xs[0]:xs[-1] + 1] for row in rows[ys[0]:ys[-1] + 1]]


def shrink(rows, box_w, box_h):
	"""Scaled down to fit the box; each new pixel is the commonest colour it covers (ties to the
	darker, which keeps outlines), or clear when most of it is clear."""
	h, w = len(rows), len(rows[0])
	f = max(w / box_w, h / box_h)
	if f <= 1:
		return rows
	nw, nh = max(1, round(w / f)), max(1, round(h / f))
	out = []
	for y in range(nh):
		row = []
		for x in range(nw):
			cells = [rows[sy][sx] for sy in range(int(y * h / nh), max(int(y * h / nh) + 1, int((y + 1) * h / nh)))
				for sx in range(int(x * w / nw), max(int(x * w / nw) + 1, int((x + 1) * w / nw)))]
			solid = [c for c in cells if c[3]]
			if len(solid) * 2 < len(cells):
				row.append((0, 0, 0, 0))
				continue
			counts = {}
			for c in solid:
				counts[c] = counts.get(c, 0) + 1
			row.append(max(counts, key=lambda c: (counts[c], -sum(c[:3]))))
		out.append(row)
	return out


def hard_alpha(rows):
	return [[(r, g, b, 255) if a > 96 else (0, 0, 0, 0) for (r, g, b, a) in row] for row in rows]


def swatch(hexes):
	"""The palette as a strip of 4 x 4 blocks, for pixflux's colour image."""
	cols = [tuple(int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) + (255,) for h in hexes]
	w = 4 * len(cols)
	rows = [[cols[x // 4] for x in range(w)] for _ in range(4)]
	return png(w, 4, rows)


# --- PixelLab ------------------------------------------------------------------------------

_KEY = None


def key():
	global _KEY
	if _KEY:
		return _KEY
	k = os.environ.get("PIXELLAB_API_KEY", "").strip()
	if not k:
		try:
			for line in open(os.path.expanduser("~/.zshrc"), encoding="utf8"):
				m = re.match(r'\s*export\s+PIXELLAB_API_KEY=["\']?([^"\'\s]+)', line)
				if m:
					k = m.group(1)
		except OSError:
			pass
	if not k:
		sys.exit("PIXELLAB_API_KEY is not set; nothing was generated.")
	_KEY = k
	return k


def call(method, path, body=None):
	data = json.dumps(body).encode() if body is not None else None
	req = urllib.request.Request(API + path, data=data, method=method, headers={
		"Authorization": "Bearer " + key(), "Content-Type": "application/json"})
	try:
		with urllib.request.urlopen(req, timeout=180) as resp:
			return json.loads(resp.read())
	except urllib.error.HTTPError as e:
		# Never echo the request: it carries the key.
		detail = e.read()[:300].decode("utf8", "replace")
		if e.code in (401, 403):
			sys.exit("PixelLab rejected the key (HTTP %d); nothing more was generated." % e.code)
		raise SystemExit("PixelLab %s %s failed: HTTP %d %s" % (method, path, e.code, detail))


def balance():
	b = call("GET", "/balance")
	return float(b["subscription"]["generations"]), float(b["credits"]["usd"])


def b64(data):
	return {"type": "base64", "base64": base64.b64encode(data).decode(), "format": "png"}


def generate(vid, job):
	v = VIEWS[vid]
	body = {"description": job["desc"], "image_size": {"width": job["canvas"], "height": job["canvas"]},
		"no_background": not job.get("tile"), "outline": "lineless" if job.get("tile") else "single color black outline",
		"shading": "basic shading",
		"detail": "low detail" if vid == "toy" else "medium detail", "color_image": b64(swatch(v["palette"]))}
	body.update(v["camera"])
	if job["seed"] is not None:
		body["seed"] = job["seed"]
	resp = call("POST", "/create-image-pixflux", body)
	img = resp.get("image") or (resp.get("images") or [None])[0]
	if not (isinstance(img, dict) and img.get("base64")):
		raise SystemExit("PixelLab answered without an image: keys " + ", ".join(sorted(resp)))
	return base64.b64decode(img["base64"].split(",", 1)[-1])


def finish(job, data):
	_, _, rows = unpng(data)
	if job.get("tile"):
		q = len(rows) // 4
		rows = shrink([row[q:-q] for row in hard_alpha(rows)[q:-q]], *job["box"])
	else:
		rows = shrink(crop(hard_alpha(rows)), *job["box"])
	return png(len(rows[0]), len(rows), rows)


def pack():
	"""art.js: every PNG under assets/ as a data URI, keyed '<view>/<name>'."""
	art = {}
	for vid in sorted(os.listdir(ASSETS)) if os.path.isdir(ASSETS) else []:
		folder = os.path.join(ASSETS, vid)
		if not os.path.isdir(folder):
			continue
		for f in sorted(os.listdir(folder)):
			if f.endswith(".png"):
				with open(os.path.join(folder, f), "rb") as fh:
					art[vid + "/" + f[:-4]] = "data:image/png;base64," + base64.b64encode(fh.read()).decode()
	with open(os.path.join(ROOT, "art.js"), "w", encoding="utf8") as fh:
		fh.write("// Generated by tools/pixellab_views.py --pack from assets/. Do not edit.\n")
		fh.write("window.ART = " + json.dumps(art, indent=0) + ";\n")
	print("art.js: %d pictures" % len(art))


def main():
	ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
	ap.add_argument("--dry-run", action="store_true")
	ap.add_argument("--only", help="one view: " + ", ".join(VIEWS))
	ap.add_argument("--names", help="comma-separated picture names")
	ap.add_argument("--force", action="store_true", help="redo pictures that already exist")
	ap.add_argument("--limit", type=int, help="make at most N pictures")
	ap.add_argument("--pack", action="store_true", help="only rewrite art.js")
	args = ap.parse_args()
	if args.pack:
		return pack()

	names = set(args.names.split(",")) if args.names else None
	todo = []
	for vid in VIEWS:
		if args.only and vid != args.only:
			continue
		for job in plan(vid):
			out = os.path.join(ASSETS, vid, job["name"] + ".png")
			if (names is None or job["name"] in names) and (args.force or not os.path.exists(out)):
				todo.append((vid, job, out))
	if args.limit:
		todo = todo[:args.limit]
	print("%d pictures to make, %d generations" % (len(todo), len(todo)))
	if args.dry_run:
		for vid, job, _ in todo:
			print("  %s/%s %dpx -> %dx%d: %s" % (vid, job["name"], job["canvas"], job["box"][0], job["box"][1], job["desc"][:80]))
		return
	if not todo:
		return pack()

	left, credits = balance()
	if left < len(todo):
		sys.exit("Only %d free generations left for %d pictures; stopping rather than spend credits." % (left, len(todo)))
	print("%d free generations left; going ahead." % left)
	for i, (vid, job, out) in enumerate(todo, 1):
		left_now, credits_now = balance()
		if left_now < 1 or credits_now < credits:
			sys.exit("Stopped after %d pictures: free generations ran out or paid credits moved." % (i - 1))
		data = finish(job, generate(vid, job))
		os.makedirs(os.path.dirname(out), exist_ok=True)
		with open(out, "wb") as f:
			f.write(data)
		print("[%d/%d] %s/%s" % (i, len(todo), vid, job["name"]))
	left_end, credits_end = balance()
	print("Done. Free generations used: %d. Paid credits moved: %s." % (left - left_end, "no" if credits_end >= credits else "YES"))
	pack()


if __name__ == "__main__":
	main()
