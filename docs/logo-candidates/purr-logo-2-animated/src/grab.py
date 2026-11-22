"""One cat grabs the mouse, slurps its tail and swallows it; the others watch.

Usage: python3 grab.py <cat index 0-3> <out.anicraft>
Run prep.py and prep_grab.py <cat index> first, in the same folder.

Story (frames at 24 fps, G = the frame the jaws close):
  0..          the mouse runs in from the right as in the first animation and
               every cat follows it
  G-9..G-4     the grabber crouches slightly (anticipation)
  G-4..G       it strikes: the head lunges forward and down over the mouse
  G            the jaws close: the mouse is held crosswise in the mouth, its
               front hanging out one side and its rear out the other
  G..G+6       a little worrying shake
  G+6..G+13    the head comes up, proudly, mouse dangling and kicking
  G+13..G+30   a beat with the mouse held (it keeps wriggling)
  G+30, G+36   two jerks of the head draw the mouse in; only its tail is left
  G+42..G+54   the tail is slurped up in three gulps of breath
  G+55..G+64   the swallow: the head drops and squashes, then settles
  G+66..G+85   eyes closed contentedly; a lick of the lips
  everyone else snaps round to look at the grabber as it strikes, and looks
  back to the front after the swallow
"""
import json, math, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from matplotlib.path import Path

from ac import AC
from common import *

ci = int(sys.argv[1])
OUT = sys.argv[2]
NAME = NAMES[ci]
N = 168
meta = json.load(open(f'grab_{NAME}.json'))
eyes, cats = load_eyes()
mx0, my0 = meta['mouth']
PX, PY = mx0, meta['wall']                      # head pivot: base of the head, under the mouth
G = round(frame_at_nose(mx0 - 27.5 * MOUSE_SCALE / 100))   # the jaws close with the mouse's middle under the mouth
bg = np.asarray(Image.open('bg.png').convert('RGB')).astype(float)


def fur_around(e):
    """The fur colour just outside an eye (for the closed-eye lids)."""
    yy, xx = np.mgrid[int(e['cy']) - 25:int(e['cy']) + 25, int(e['cx']) - 30:int(e['cx']) + 30]
    pts = np.c_[xx.ravel() + .5, yy.ravel() + .5]
    big = Path([(e['cx'] + (x - e['cx']) * 1.6, e['cy'] + (y - e['cy']) * 1.9) for x, y in e['hull']])
    small = Path([(e['cx'] + (x - e['cx']) * 1.2, e['cy'] + (y - e['cy']) * 1.35) for x, y in e['hull']])
    ring = big.contains_points(pts) & ~small.contains_points(pts)
    c = np.median(bg[yy.ravel()[ring], xx.ravel()[ring]], 0)
    return '#%02x%02x%02x' % tuple(int(v) for v in c), c


# ---------------------------------------------------------------- the grabber's head
KEYS = [  # frame, dx, dy, scale, squash (y multiplier), rotation°, ease into this key
    (0, 0, 0, 1.00, 1.00, 0, 'io'),
    (G - 9, 0, 0, 1.00, 1.00, 0, 'io'),
    (G - 4, 0, 4, 0.97, 1.00, 0, 'io'),     # crouch
    (G, 0, 10, 1.14, 1.00, 0, 'in'),        # strike
    (G + 2, 0, 9, 1.13, 1.00, -3, 'io'),    # worry it
    (G + 4, 0, 10, 1.14, 1.00, 3, 'io'),
    (G + 6, 0, 9, 1.13, 1.00, 0, 'io'),
    (G + 13, 0, -18, 1.03, 1.00, 4, 'io'),  # head up, mouse dangling
    (G + 18, 0, -16, 1.03, 1.00, 1, 'io'),   # holding it: small adjustments
    (G + 23, 0, -18, 1.03, 1.00, 4, 'io'),
    (G + 28, 0, -17, 1.03, 1.00, 3, 'io'),
    (G + 30, 0, -22, 1.05, 1.00, -1, 'in'), # jerk: the mouse goes in part way
    (G + 33, 0, -16, 1.03, 1.00, 3, 'io'),
    (G + 36, 0, -20, 1.05, 1.00, -1, 'in'), # jerk: in it goes, bar the tail
    (G + 40, 0, -10, 1.03, 1.00, 4, 'io'),
    (G + 44, 0, -7, 1.03, 1.00, 3, 'io'),   # slurp
    (G + 46, 0, -10, 1.03, 1.00, 4, 'io'),
    (G + 50, 0, -7, 1.03, 1.00, 3, 'io'),   # slurp
    (G + 52, 0, -10, 1.03, 1.00, 4, 'io'),
    (G + 55, 0, -10, 1.03, 1.00, 0, 'io'),
    (G + 58, 0, -2, 1.00, 0.93, 0, 'in'),   # swallow: drop and squash
    (G + 61, 0, 0, 1.00, 1.05, 0, 'io'),    # ...and stretch
    (G + 64, 0, 0, 1.00, 1.00, 0, 'io'),
    (N - 1, 0, 0, 1.00, 1.00, 0, 'io'),
]


def head_at(t):
    for (f0, *a), (f1, *b) in zip(KEYS, KEYS[1:]):
        if f0 <= t <= f1:
            u = (t - f0) / max(1, f1 - f0)
            u = u * u if b[-1] == 'in' else u * u * (3 - 2 * u)
            return [x + (y - x) * u for x, y in zip(a[:-1], b[:-1])]
    return KEYS[-1][1:-1]


SQUINT = (G + 66, G + 85)
# (frame, how far the mouse has slid into the mouth or None once it's gone, leg pose)
HELD = [(G + f, 0, (0 if (f // 3) % 2 == 0 else 2)) for f in range(0, 30, 3)] + \
       [(G + 30, 6, 0), (G + 33, 12, 2), (G + 36, None, 0)]
FRONT_GONE = G + 30   # the first jerk takes the head end in; the mask then hides that side
TAIL_FULL = (G + 36, G + 42)
SLURP = [(G + 42, .8), (G + 44, .62), (G + 48, .45), (G + 50, .28), (G + 54, .12), (G + 55, 0)]
LICK = [(G + 69, (0, 5, 10, 7)), (G + 71, (6, 3, 10, 6.5)), (G + 73, (11, 0, 8, 5.5)), (G + 75, None)]


def tail_points(frac):
    """The mouse's tail hanging from the right corner of the mouth, mouth-relative."""
    P = [(8, 1), (14, 10), (6, 20), (12, 28), (16, 33), (22, 32), (24, 28)]
    pts = []
    for (x0, y0), (x1, y1), (x2, y2), (x3, y3) in [(P[0], P[1], P[2], P[3]), (P[3], P[4], P[5], P[6])]:
        for k in range(12):
            s = k / 12
            pts.append(((1-s)**3*x0 + 3*(1-s)**2*s*x1 + 3*(1-s)*s*s*x2 + s**3*x3,
                        (1-s)**3*y0 + 3*(1-s)**2*s*y1 + 3*(1-s)*s*s*y2 + s**3*y3))
    pts.append(P[-1])
    L = np.r_[0, np.cumsum(np.hypot(*np.diff(np.array(pts), axis=0).T))]
    keep = [p for p, l in zip(pts, L) if l <= frac * L[-1]]
    return keep if len(keep) > 1 else None


# ---------------------------------------------------------------- gaze
def watcher_gaze(c_idx, t, L, R):
    """dx, dy for a watching cat's pupils."""
    bx = (L['cx'] + R['cx']) / 2
    A = gaze_amplitude(L, R)
    at_mouse = math.tanh((mouse_x(t - 2) + 25 - bx) / 170)
    gx = (cats[ci][0]['cx'] + cats[ci][1]['cx']) / 2
    at_grabber = math.tanh((gx - bx) / 90)
    b = smooth(G - 4, G + 1, t)
    w = smooth(6, 15, t) * (1 - smooth(G + 77, G + 91, t))
    g = (1 - b) * at_mouse + b * at_grabber
    return A * w * g, w * (1.8 * (1 - b) + 0.6 * b)


def grabber_gaze(t, L, R):
    """The grabber's own pupils: on the mouse until it is caught, then front."""
    bx = (L['cx'] + R['cx']) / 2
    A = gaze_amplitude(L, R)
    w = smooth(6, 15, t) * (1 - smooth(G + 4, G + 12, t))
    g = math.tanh((mouse_x(t - 2) + 25 - bx) / 170)
    return A * w * g, w * (1.8 + 1.5 * smooth(G - 6, G - 1, t))


# ---------------------------------------------------------------- build
import os, subprocess
if os.path.exists(OUT):
    os.remove(OUT)
subprocess.run([sys.modules['ac'].CLI, 'new', '--out', OUT, '--width', '1024', '--height', '1024',
                '--fps', '24'], check=True, capture_output=True)
ac = AC(OUT)
info = ac('doc.info')
bg_layer = info['layer']
ac('layer.rename', name='Cats (background)', layer=bg_layer)
ac('file.import', path=f'bg_no_{NAME}.png', x=0, y=0, layer='active')
ac('timeline.insert_frame', frame=1, count=N - 1)

watchers = [i for i in range(4) if i != ci]
pupil_layers = {}
for i in watchers:
    L, R = cats[i]
    lid = ac('layer.new', name=f'Pupils – {NAMES[i]}')['layer']
    pupil_layers[i] = lid
    for e in (L, R):
        ac('draw.path', d=pupil_path(e), fill=PUPIL, stroke=None)
    ac('timeline.create_motion_tween', frame=0)
    bx, by = (L['cx'] + R['cx']) / 2, (L['cy'] + R['cy']) / 2
    for t in range(0, N, 2):
        dx, dy = watcher_gaze(i, t, L, R)
        ac('motion.set_key', property='x', value=round(bx + dx, 2), frame=t)
        ac('motion.set_key', property='y', value=round(by + dy, 2), frame=t)
mask = ac('layer.new', name='Iris mask')['layer']
for i in watchers:
    for e in cats[i]:
        ac('draw.path', d=hull_path(e), fill='#00ff00', stroke=None)
ac('layer.set_type', type='mask', layer=mask)
for lid in reversed(list(pupil_layers.values())):   # top down: each must sit under the mask or a masked layer
    ac('layer.set_type', type='masked', layer=lid)

# --- the grabber's head: a symbol with its own pupils, lids, tail and tongue,
# whose timeline runs in step with the scene's
head_layer = ac('layer.new', name=f'{NAME} (head)')['layer']
sym = new_symbol_at(ac, head_layer, PX, PY, f'{NAME} head')
ox, oy = meta['origin']
inner = ac('doc.info')['layer']
ac('layer.rename', name='Head', layer=inner)
ac('file.import', path=f'head_{NAME}.png', x=ox - PX, y=oy - PY, layer='active')
ac('timeline.insert_frame', frame=1, count=N - 1)

L, R = cats[ci]
rel = lambda e: dict(e, cx=e['cx'] - PX, cy=e['cy'] - PY, hull=[[x - PX, y - PY] for x, y in e['hull']])
Lr, Rr = rel(L), rel(R)
pl = ac('layer.new', name='Pupils')['layer']
for e in (Lr, Rr):
    ac('draw.path', d=pupil_path(e), fill=PUPIL, stroke=None)
ac('timeline.create_motion_tween', frame=0)
bx, by = (Lr['cx'] + Rr['cx']) / 2, (Lr['cy'] + Rr['cy']) / 2
for t in range(0, N, 2):
    dx, dy = grabber_gaze(t, L, R)
    ac('motion.set_key', property='x', value=round(bx + dx, 2), frame=t)
    ac('motion.set_key', property='y', value=round(by + dy, 2), frame=t)
im = ac('layer.new', name='Iris mask')['layer']
for e in (Lr, Rr):
    ac('draw.path', d=hull_path(e), fill='#00ff00', stroke=None)
ac('layer.set_type', type='mask', layer=im)
ac('layer.set_type', type='masked', layer=pl)


def keyed_layer(name, keys):
    """A layer whose artwork changes on given frames: keys = [(frame, draw-fn or None)]."""
    lid = ac('layer.new', name=name)['layer']
    for f, fn in keys:
        ac('layer.select', layer=lid)
        ac('timeline.insert_blank_keyframe', layer=lid, frame=f)
        ac('timeline.goto', frame=f)
        if fn:
            fn()
    return lid


def draw_lids():
    for e, ea in ((Lr, L), (Rr, R)):
        hexc, c = fur_around(ea)        # sample the fur where the eye really is
        ac('draw.path', d=hull_path(e, grow=2.5), fill=hexc, stroke=None)
        line = '#%02x%02x%02x' % tuple(int(v) for v in (c * 0.45 if c.mean() > 90 else c + 70))
        xs = [p[0] for p in e['hull']]
        lx, rx = min(xs) + 1, max(xs) - 1
        cy = e['cy'] - 1
        ac('draw.path', d=f"M{lx:.1f},{cy:.1f} Q{e['cx']:.1f},{cy + e['h'] * 0.42:.1f} {rx:.1f},{cy:.1f}",
           fill=None, stroke=line, stroke_width=2, cap='round')


keyed_layer('Closed eyes', [(SQUINT[0], draw_lids), (SQUINT[1], None)])

mrx, mry = mx0 - PX, my0 - PY
tail_w = 2.4 * MOUSE_SCALE / 100 * 0.9


def tail_fn(frac):
    def fn():
        pts = tail_points(frac)
        if pts:
            d = 'M' + ' L'.join(f'{mrx + x:.1f},{mry + y:.1f}' for x, y in pts)
            ac('draw.path', d=d, fill=None, stroke='#d7a09a', stroke_width=tail_w, cap='round')
    return fn


import re
HELD_K = 1.2      # size of the held mouse in the head's space
GAP = 9           # half-width of the open mouth: the mouse narrows inside it
TAPER = 15        # how far either side of the gap the mouse narrows into the mouth

# The open mouth: (frame, width, height) or None once it shuts. It opens as the
# head lunges, stays open round the mouse, and closes in steps with the gulps.
MOUTH = [(G - 3, 24, 16), (G, 26, 13), (G + 30, 24, 11), (G + 33, 20, 9), (G + 36, None, None)]


def held_shapes(d, pose):
    """The mouse held crosswise in the jaws, limp at both ends, each half
    narrowing as it goes into the mouth. `d` slides it in as it is gulped."""
    xc, yc = 28, -16           # middle of the mouse's body, in its own drawing

    def tr(x, y):
        u = (x - xc) * HELD_K - d                       # distance from the mouth centre
        f = min(1, max(0, (abs(u) - GAP) / TAPER))
        squeeze = 0.3 + 0.7 * f * f * (3 - 2 * f)       # gripped thin between the teeth
        droop = 0.022 * min((x - xc) ** 2, 34 ** 2)
        return mrx + u, mry + (yc + (y - yc) * squeeze + 21 + droop) * HELD_K

    out = []
    for s in mouse_pose(*POSES[pose]):
        s = dict(s)
        if 'ellipse' in s:
            x, y, w, h = s['ellipse']
            X, Y = tr(x, y)
            s['ellipse'] = (X, Y, w * HELD_K, h * HELD_K)
        else:
            s['d'] = re.sub(r'(-?[\d.]+),(-?[\d.]+)',
                            lambda m: '%.1f,%.1f' % tr(float(m[1]), float(m[2])), s['d'])
            if 'stroke_width' in s:
                s['stroke_width'] *= HELD_K
        out.append(s)
    return out


def held_fn(d, pose):
    return (lambda: draw_shapes(ac, held_shapes(d, pose))) if d is not None else None


def mouth_top():
    return mry - 1.5


def mouth_fn(w, h, teeth=False):
    """The open mouth (dark, a hint of tongue) or, with teeth=True, just its
    fangs, which go on top of the mouse so they look to be biting it."""
    if w is None:
        return None
    t = mouth_top()

    def fn():
        if teeth:
            for sx in (-1, 1):
                x = mrx + sx * w * 0.28
                ac('draw.path', d=f'M{x - 2.2:.1f},{t:.1f} L{x + 2.2:.1f},{t:.1f} L{x:.1f},{t + min(5, h * 0.45):.1f} Z',
                   fill='#fbf7ee', stroke=None)
                xb, b = mrx + sx * w * 0.2, t + h * 0.92        # lower fangs, pointing up
                ac('draw.path', d=f'M{xb - 1.8:.1f},{b:.1f} L{xb + 1.8:.1f},{b:.1f} L{xb:.1f},{b - min(4, h * 0.35):.1f} Z',
                   fill='#fbf7ee', stroke=None)
            return
        ac('draw.path', d=(f'M{mrx - w/2:.1f},{t:.1f} C{mrx - w/2:.1f},{t + h*1.25:.1f} {mrx + w/2:.1f},{t + h*1.25:.1f} {mrx + w/2:.1f},{t:.1f} '
                           f'C{mrx + w/4:.1f},{t - 2.5:.1f} {mrx - w/4:.1f},{t - 2.5:.1f} {mrx - w/2:.1f},{t:.1f} Z'),
           fill='#3b1e21', stroke=None)
        ac('draw.ellipse', x=mrx - w * 0.28, y=t + h * 0.45, w=w * 0.56, h=h * 0.42, fill='#b8636b', stroke=None)
    return fn


keyed_layer('Mouth (open)', [(f, mouth_fn(w, h)) for f, w, h in MOUTH])
held = keyed_layer('Mouse in mouth', [(f, held_fn(sx, p)) for f, sx, p in HELD])
# the mask hides nothing while the mouse is held; after the first gulp it hides
# the head end, which has gone into the mouth
WHOLE, RIGHT = (mrx - 90, mrx + 100), (mrx - 1, mrx + 100)


def gap_rects(*sides):
    def fn():
        for x0, x1 in sides:
            ac('draw.rect', x=x0, y=mry - 7, w=x1 - x0, h=70, fill='#00ff00', stroke=None)
    return fn


gap = keyed_layer('Mouth (mask)', [(0, gap_rects(WHOLE)), (FRONT_GONE, gap_rects(RIGHT))])
ac('layer.set_type', type='mask', layer=gap)
ac('layer.set_type', type='masked', layer=held)
keyed_layer('Fangs', [(f, mouth_fn(w, h, teeth=True)) for f, w, h in MOUTH])

keyed_layer('Tail',[(TAIL_FULL[0], tail_fn(1.0))] + [(f, tail_fn(fr) if fr else None) for f, fr in SLURP])


def tongue_fn(spec):
    def fn():
        x, y, w, h = spec
        ac('draw.ellipse', x=mrx + x - w / 2, y=mry + y - h / 2, w=w, h=h, fill='#e07f86', stroke=None)
    return fn


keyed_layer('Tongue', [(f, tongue_fn(s) if s else None) for f, s in LICK])
ac('symbol.exit', all=True)

ac('layer.select', layer=head_layer)
ac('timeline.create_motion_tween', frame=0)
base = ac('motion.info', layer=head_layer, frame=0)['position']
for t in range(N):
    dx, dy, s, sq, rot = head_at(t)
    ac('motion.set_key', layer=head_layer, property='x', value=round(base[0] + dx, 2), frame=t)
    ac('motion.set_key', layer=head_layer, property='y', value=round(base[1] + dy, 2), frame=t)
    ac('motion.set_key', layer=head_layer, property='scale_x', value=round(100 * s, 2), frame=t)
    ac('motion.set_key', layer=head_layer, property='scale_y', value=round(100 * s * sq, 2), frame=t)
    ac('motion.set_key', layer=head_layer, property='rotation', value=round(rot, 2), frame=t)

# --- the wall in front of the head, then the mouse on top
wall = ac('layer.new', name='Wall (front)')['layer']
ac('file.import', path='wall.png', x=0, y=0, layer='active')

mouse = ac('layer.new', name='Mouse')['layer']
build_mouse(ac, mouse)
ac('layer.select', layer=mouse)
ac('timeline.create_motion_tween', frame=0)
ac('motion.set_key', layer=mouse, property='scale_x', value=MOUSE_SCALE, frame=0)
ac('motion.set_key', layer=mouse, property='scale_y', value=MOUSE_SCALE, frame=0)
for f in (0, MOUSE_IN, G - 1):
    ac('motion.set_key', layer=mouse, property='x', value=round(mouse_x(f), 1), frame=f)
    ac('motion.set_key', layer=mouse, property='y', value=WALL, frame=f)
ac('layer.select', layer=mouse)
ac('timeline.insert_blank_keyframe', layer=mouse, frame=G)

ac('file.save', path=OUT, confirm=True)
ac.close()
print(json.dumps(dict(cat=NAME, grab_frame=G, frames=N, pivot=[PX, PY], head_base=base)))
