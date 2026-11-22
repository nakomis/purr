"""Cut one cat's head out of the pupil-less background so it can move.

Usage: python3 prep_grab.py <cat index 0-3>   (run in the folder holding bg.png
and eyes.json, which prep.py writes)

Writes:
  head_<name>.png     the head with alpha, extended 40 px below the wall line
                      (a smoothed "neck") so it can rise without a gap showing
  bg_no_<name>.png    the background with that head painted out in peach
  wall.png            the foreground wall, to sit above the head
  grab_<name>.json    where the cut-out sits on the stage
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

CATS = [  # left to right; box = the column band the head may occupy
    dict(name='Boots', box=(30, 470, 300, 688), mouth=(172, 668)),
    dict(name='Tau',   box=(298, 485, 515, 688), mouth=(403, 670)),
    dict(name='Mu',    box=(510, 485, 742, 688), mouth=(625, 668)),
    dict(name='Chi',   box=(737, 460, 995, 688), mouth=(860, 668)),
]
WALL = 688
EXT = 40
PEACH = np.array([248, 194, 155])

cat = CATS[int(sys.argv[1])]
x0, y0, x1, y1 = cat['box']
bg = np.asarray(Image.open('bg.png').convert('RGB')).astype(float)

# --- alpha: distance from the peach backdrop, then keep the biggest blob and
# everything touching it (the whiskers)
crop = bg[y0:y1, x0:x1]
dist = np.sqrt(((crop - PEACH) ** 2).sum(-1))
alpha = np.clip((dist - 10) / 22, 0, 1)
solid = dist > 18
lab, n = nd.label(nd.binary_dilation(solid, iterations=1))
sizes = nd.sum(np.ones_like(lab), lab, range(1, n + 1))
keep = lab == (1 + int(np.argmax(sizes)))
alpha *= nd.binary_dilation(keep, iterations=1)

# --- the neck: the bottom rows, median-smoothed sideways so whiskers don't
# streak, repeated downwards
base = np.median(crop[-6:-1], axis=0)
base = nd.median_filter(base, size=(15, 1))
base = nd.gaussian_filter1d(base, 7, axis=0)      # soft, so the neck doesn't read as a block
neck_a = nd.maximum_filter1d(alpha[-3], 5)
# un-mix the peach from semi-transparent edge pixels so no fringe shows
a3 = np.maximum(alpha, 1e-3)[..., None]
clean = np.where(alpha[..., None] > 0, (crop - (1 - a3) * PEACH) / a3, crop).clip(0, 255)
head_rgb = np.concatenate([clean, np.repeat(base[None], EXT, 0)], 0)
head_a = np.concatenate([alpha, np.repeat(neck_a[None], EXT, 0)], 0)
rgba = np.dstack([head_rgb, head_a * 255]).clip(0, 255).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(f"head_{cat['name']}.png")

# --- background without the head: peach with a little matching grain
rng = np.random.default_rng(1)
hole = nd.binary_dilation((dist > 6) & nd.binary_dilation(keep, iterations=3), iterations=3)
# fill from the surrounding backdrop (normalised convolution), so the faint
# shading around the cats carries on through the hole instead of a flat patch
pad = 60
X0, Y0 = max(0, x0 - pad), max(0, y0 - pad)
big = bg[Y0:y1, X0:x1 + pad]
bigdist = np.sqrt(((big - PEACH) ** 2).sum(-1))
known = (bigdist < 22).astype(float)
hy, hx = y0 - Y0, x0 - X0
known[hy:hy + crop.shape[0], hx:hx + crop.shape[1]][hole] = 0
smooth = np.zeros_like(big); got = np.zeros(known.shape)
for sigma in (14, 40, 120):      # widen until every hole pixel has neighbours
    num = np.stack([nd.gaussian_filter(big[..., k] * known, sigma) for k in range(3)], -1)
    den = nd.gaussian_filter(known, sigma)
    take = (got == 0) & (den > 0.02)
    smooth[take] = (num / np.maximum(den, 1e-6)[..., None])[take]
    got[take] = 1
fill = smooth[hy:hy + crop.shape[0], hx:hx + crop.shape[1]] + rng.normal(0, 1.3, crop.shape)
out = bg.copy()
region = out[y0:y1, x0:x1]
region[hole] = fill[hole]
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(f"bg_no_{cat['name']}.png")

# --- the wall in front
wall = np.zeros((bg.shape[0], bg.shape[1], 4), np.uint8)
wall[WALL:, :, :3] = bg[WALL:].astype(np.uint8)
wall[WALL:, :, 3] = 255
Image.fromarray(wall, 'RGBA').save('wall.png')

json.dump(dict(cat, origin=[x0, y0], size=[x1 - x0, y1 - y0 + EXT], wall=WALL),
          open(f"grab_{cat['name']}.json", 'w'), indent=1)
print('ok', cat['name'], rgba.shape)
