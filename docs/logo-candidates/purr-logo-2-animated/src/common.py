"""Pieces shared by the animations: the mouse, the pupils, the timing helpers.

(build.py, the original run-past animation, predates this and keeps its own
copies; the drawings are identical.)
"""
import json, math

WALL = 689            # where the mouse's feet land
NAMES = ['Kappa', 'Tau', 'Mu', 'Chi']   # left to right
PUPIL = '#15130f'
MOUSE_SCALE = 140     # %
MOUSE_SPEED = 1220 / 60   # px per frame
MOUSE_IN = 12         # frame the mouse starts across
MOUSE_START = 1110    # nose x when it starts


def load_eyes():
    eyes = json.load(open('eyes.json'))
    return eyes, [eyes[i:i + 2] for i in range(0, 8, 2)]


def mouse_x(t):
    """Nose x at frame t (it keeps going: callers decide when it stops)."""
    return MOUSE_START if t < MOUSE_IN else MOUSE_START - (t - MOUSE_IN) * MOUSE_SPEED


def frame_at_nose(x):
    return MOUSE_IN + (MOUSE_START - x) / MOUSE_SPEED


def smooth(a, b, t):
    u = min(1, max(0, (t - a) / (b - a)))
    return u * u * (3 - 2 * u)


def almond(cx, cy, w, h):
    return (f"M{cx:.1f},{cy-h/2:.1f} C{cx+w/2:.1f},{cy-h/4:.1f} {cx+w/2:.1f},{cy+h/4:.1f} {cx:.1f},{cy+h/2:.1f} "
            f"C{cx-w/2:.1f},{cy+h/4:.1f} {cx-w/2:.1f},{cy-h/4:.1f} {cx:.1f},{cy-h/2:.1f} Z")


def pupil_path(e, dx=0, dy=0):
    return almond(e['cx'] + dx, e['cy'] + dy, 0.30 * e['w'], 1.25 * e['h'])


def hull_path(e, dx=0, dy=0, grow=0):
    cx, cy = e['cx'], e['cy']
    pts = []
    for x, y in e['hull']:
        vx, vy = x - cx, y - cy
        n = math.hypot(vx, vy) or 1
        pts.append((x + vx / n * grow + dx, y + vy / n * grow + dy))
    return 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + ' Z'


def gaze_amplitude(L, R):
    return 0.27 * min(L['w'], R['w'])


def mouse_pose(fl, bl, bob):
    o = []
    Y = lambda y: y + bob
    for hx, dx in ((16, -fl * 0.6), (42, -bl * 0.6)):          # far legs
        o.append(dict(d=f"M{hx},{Y(-6)} L{hx+dx},0", stroke="#5d5a57", stroke_width=3.2))
    o.append(dict(d=f"M52,{Y(-11)} C64,{Y(-8)} 70,{Y(-20)} 80,{Y(-22)} C87,{Y(-23)} 92,{Y(-19)} 97,{Y(-16)}",
                  stroke="#d7a09a", stroke_width=2.4))                   # tail
    o.append(dict(d=f"M0,{Y(-12)} C6,{Y(-22)} 20,{Y(-29)} 34,{Y(-27)} C48,{Y(-25)} 57,{Y(-17)} 55,{Y(-9)} "
                    f"C53,{Y(-4)} 44,{Y(-3)} 30,{Y(-3)} L14,{Y(-4)} C6,{Y(-5)} 1,{Y(-8)} 0,{Y(-12)} Z",
                  fill="#8e8a86"))                                       # body
    o.append(dict(d=f"M10,{Y(-6)} C20,{Y(-3)} 40,{Y(-3)} 50,{Y(-7)} C42,{Y(-5)} 22,{Y(-5)} 10,{Y(-6)} Z",
                  fill="#bdb7b0"))                                       # belly
    o.append(dict(ellipse=(18, Y(-27), 13, 13), fill="#8e8a86"))         # ear
    o.append(dict(ellipse=(19, Y(-26.5), 7.5, 7.5), fill="#e3aaa3"))
    o.append(dict(ellipse=(7, Y(-18.5), 3.4, 3.4), fill="#141210"))      # eye
    o.append(dict(ellipse=(0.5, Y(-12.5), 4, 4), fill="#d98f88"))        # nose
    for hx, dx in ((14, fl), (44, bl)):                                  # near legs
        o.append(dict(d=f"M{hx},{Y(-6)} L{hx+dx},0", stroke="#77736f", stroke_width=3.4))
    o.append(dict(d=f"M2,{Y(-13)} L-9,{Y(-17)} M2,{Y(-12)} L-10,{Y(-12)}", stroke="#e8e2da", stroke_width=0.8))
    return o


POSES = [(-9, 9, 0), (-3, 3, -1.5), (6, -6, 0), (-3, 3, -1.5)]


def draw_shapes(ac, shapes):
    for s in shapes:
        if 'ellipse' in s:
            x, y, w, h = s['ellipse']
            ac('draw.ellipse', x=x - w / 2, y=y - h / 2, w=w, h=h, fill=s['fill'], stroke=None)
        elif 'fill' in s:
            ac('draw.path', d=s['d'], fill=s['fill'], stroke=None)
        else:
            ac('draw.path', d=s['d'], fill=None, stroke=s['stroke'],
               stroke_width=s['stroke_width'], cap='round')


def new_symbol_at(ac, layer, x, y, name):
    """An empty graphic symbol whose origin sits at (x, y) on the stage.

    Converting artwork re-registers it about its centre, but artwork drawn
    inside a symbol is not, so we convert a 1 px placeholder centred on the
    point we want, open the symbol and delete it. Everything drawn inside
    afterwards is in coordinates relative to (x, y).
    """
    ac('draw.rect', x=x - 0.5, y=y - 0.5, w=1, h=1, fill='#000000', stroke=None)
    ac('layer.select', layer=layer, select=True)
    r = ac('modify.convert_to_symbol', name=name, kind='graphic')
    ac('symbol.edit')
    ac('timeline.goto', frame=0)
    ac('edit.select_all')
    ac('edit.delete')
    return r


def build_mouse(ac, layer):
    """The 4-pose run cycle, as a symbol on `layer`, origin at the nose/feet."""
    draw_shapes(ac, mouse_pose(*POSES[0]))
    ac('layer.select', layer=layer, select=True)
    ac('modify.convert_to_symbol', name='Mouse run cycle', kind='graphic')
    ac('symbol.edit')
    ac('timeline.goto', frame=0)       # see build.py: redraw pose 0 inside
    ac('edit.select_all')
    ac('edit.delete')
    draw_shapes(ac, mouse_pose(*POSES[0]))
    for i, p in enumerate(POSES[1:], 1):
        ac('timeline.insert_blank_keyframe', frame=i)
        ac('timeline.goto', frame=i)
        draw_shapes(ac, mouse_pose(*p))
    ac('symbol.exit', all=True)
