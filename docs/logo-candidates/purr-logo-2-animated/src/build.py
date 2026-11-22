import json, math
eyes=json.load(open('eyes.json'))
cats=[eyes[i:i+2] for i in range(0,8,2)]
names=['Boots','Tau','Mu','Chi']   # left→right: black, tuxedo, ginger, tabby
N=120; WALL=689
S=[]
def c(cmd,**p): S.append({"cmd":cmd,"params":p})
def ext(): c("timeline.insert_frame",frame=1,count=N-1)

# --- background
c("layer.rename",name="Cats (background)")
c("file.import",path="bg.png",x=0,y=0,layer="active")
ext()

# --- pupils (one layer per cat), drawn absolute, then tweened
def almond(cx,cy,w,h):
    return (f"M{cx:.1f},{cy-h/2:.1f} C{cx+w/2:.1f},{cy-h/4:.1f} {cx+w/2:.1f},{cy+h/4:.1f} {cx:.1f},{cy+h/2:.1f} "
            f"C{cx-w/2:.1f},{cy+h/4:.1f} {cx-w/2:.1f},{cy-h/4:.1f} {cx:.1f},{cy-h/2:.1f} Z")
def mouse_x(t):  # nose position
    t0,t1=12,72
    if t<t0: return 1110
    if t>t1: return -110
    return 1110+(t-t0)/(t1-t0)*(-1220)
def smooth(a,b,t):
    u=min(1,max(0,(t-a)/(b-a))); return u*u*(3-2*u)
def attention(t):
    return smooth(6,15,t)*(1-smooth(90,104,t))
for ci,(L,R) in enumerate(cats):
    c("layer.new",name=f"Pupils – {names[ci]}")
    for e in (L,R):
        c("draw.path",d=almond(e['cx'],e['cy'],0.30*e['w'],1.25*e['h']),fill="#15130f",stroke=None)
    c("timeline.create_motion_tween",frame=0)
    bx=(L['cx']+R['cx'])/2; by=(L['cy']+R['cy'])/2
    # symbol centre = bbox centre of the two pupils
    by_sym=by
    A=0.27*min(L['w'],R['w'])
    for t in range(0,N,2):
        mx=mouse_x(t-2)+25             # lag a couple of frames, aim at the body
        g=math.tanh((mx-bx)/170)
        w=attention(t)
        dx=A*w*g
        dy=1.8*w                       # glance down at the wall top
        c("motion.set_key",property="x",value=round(bx+dx,2),frame=t)
        c("motion.set_key",property="y",value=round(by_sym+dy,2),frame=t)

# --- iris mask above the pupils
c("layer.new",name="Iris mask")
for e in eyes:
    pts=e['hull']; d="M"+" L".join(f"{x},{y}" for x,y in pts)+" Z"
    c("draw.path",d=d,fill="#00ff00",stroke=None)
json.dump(dict(cats=[[ (e['cx'],e['cy']) for e in p] for p in cats]),open('meta.json','w'))

# --- mouse: a 4-pose run cycle inside a graphic symbol
def mouse_pose(fl,bl,bob):
    o=[]; Y=lambda y:y+bob
    # far legs (darker, behind)
    for hx,dx in ((16,-fl*0.6),(42,-bl*0.6)):
        o.append(dict(d=f"M{hx},{Y(-6)} L{hx+dx},0",stroke="#5d5a57",stroke_width=3.2))
    # tail
    o.append(dict(d=f"M52,{Y(-11)} C64,{Y(-8)} 70,{Y(-20)} 80,{Y(-22)} C87,{Y(-23)} 92,{Y(-19)} 97,{Y(-16)}",stroke="#d7a09a",stroke_width=2.4))
    # body
    o.append(dict(d=f"M0,{Y(-12)} C6,{Y(-22)} 20,{Y(-29)} 34,{Y(-27)} C48,{Y(-25)} 57,{Y(-17)} 55,{Y(-9)} C53,{Y(-4)} 44,{Y(-3)} 30,{Y(-3)} L14,{Y(-4)} C6,{Y(-5)} 1,{Y(-8)} 0,{Y(-12)} Z",fill="#8e8a86"))
    # belly highlight
    o.append(dict(d=f"M10,{Y(-6)} C20,{Y(-3)} 40,{Y(-3)} 50,{Y(-7)} C42,{Y(-5)} 22,{Y(-5)} 10,{Y(-6)} Z",fill="#bdb7b0"))
    # ear
    o.append(dict(ellipse=(18,Y(-27),13,13),fill="#8e8a86"))
    o.append(dict(ellipse=(19,Y(-26.5),7.5,7.5),fill="#e3aaa3"))
    # eye, nose
    o.append(dict(ellipse=(7,Y(-18.5),3.4,3.4),fill="#141210"))
    o.append(dict(ellipse=(0.5,Y(-12.5),4,4),fill="#d98f88"))
    # near legs
    for hx,dx in ((14,fl),(44,bl)):
        o.append(dict(d=f"M{hx},{Y(-6)} L{hx+dx},0",stroke="#77736f",stroke_width=3.4))
    # whiskers
    o.append(dict(d=f"M2,{Y(-13)} L-9,{Y(-17)} M2,{Y(-12)} L-10,{Y(-12)}",stroke="#e8e2da",stroke_width=0.8))
    return o
poses=[(-9,9,0),(-3,3,-1.5),(6,-6,0),(-3,3,-1.5)]
c("layer.new",name="Mouse")
def draw_pose(p):
    for s in mouse_pose(*p):
        if 'ellipse' in s:
            x,y,w,h=s['ellipse']; c("draw.ellipse",x=x-w/2,y=y-h/2,w=w,h=h,fill=s['fill'],stroke=None)
        elif 'fill' in s: c("draw.path",d=s['d'],fill=s['fill'],stroke=None)
        else: c("draw.path",d=s['d'],fill=None,stroke=s['stroke'],stroke_width=s['stroke_width'],cap="round")
draw_pose(poses[0])
c("select.all") if False else None
S.append({"cmd":"__SELECT_LAYER_ALL__"})
c("modify.convert_to_symbol",name="Mouse run cycle",kind="graphic")
S.append({"cmd":"__EDIT_SYMBOL__"})
# Redraw pose 0 from inside the symbol, so all four poses share the symbol's
# coordinate space. (Converting re-registers the original artwork about its
# centre, whilst artwork drawn inside the symbol is not, so the first pose sat
# ~47px left of the others and the mouse jumped back every cycle.)
c("timeline.goto",frame=0)
c("edit.select_all")
c("edit.delete")
draw_pose(poses[0])
for i,p in enumerate(poses[1:],1):
    c("timeline.insert_blank_keyframe",frame=i)
    c("timeline.goto",frame=i)
    draw_pose(p)
c("symbol.exit",all=True)
json.dump(S,open('script_raw.json','w'),indent=0)
print(len(S))

# ---- assemble final script with real layer ids
def finish(mouse_layer, mask_layer, pupil_layers):
    out=[]
    for s in S:
        if s['cmd']=='__SELECT_LAYER_ALL__':
            out.append({"cmd":"layer.select","params":{"layer":mouse_layer,"select":True}})
        elif s['cmd']=='__EDIT_SYMBOL__':
            out.append({"cmd":"symbol.edit","params":{}})
        else: out.append(s)
    T=[]
    def t(cmd,**p): T.append({"cmd":cmd,"params":p})
    t("layer.select",layer=mouse_layer)
    t("timeline.create_motion_tween",frame=0)
    CX,CY=0,WALL
    t("motion.set_key",property="scale_x",value=140,frame=0)
    t("motion.set_key",property="scale_y",value=140,frame=0)
    for f in (0,12,72,N-1):
        t("motion.set_key",property="x",value=round(mouse_x(f)*1+CX,1),frame=f)
        t("motion.set_key",property="y",value=CY,frame=f)
    t("layer.set_type",type="mask",layer=mask_layer)
    for L in pupil_layers: t("layer.set_type",type="masked",layer=L)
    t("doc.info")
    return out+T
if __name__=='__main__':
    import sys
    if len(sys.argv)>1:
        a=json.loads(sys.argv[1])
        json.dump(finish(a['mouse'],a['mask'],a['pupils']),open('script.json','w'))
