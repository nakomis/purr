from PIL import Image; import numpy as np, json, sys
from scipy import ndimage as nd
from scipy.spatial import ConvexHull
from matplotlib.path import Path
src=sys.argv[1]
im=np.asarray(Image.open(src).convert('RGB')).astype(float)
r,g,b=im[...,0],im[...,1],im[...,2]
m=(r>140)&(g>130)&(b<130)&(abs(r-g)<45)&(r-b>60)
m[:560]=0; m[650:]=0
lab,n=nd.label(m)
eyes=[]
for i in range(1,n+1):
    ys,xs=np.nonzero(lab==i)
    if len(xs)<250 or ys.mean()>625: continue
    pts=np.c_[xs,ys].astype(float)
    hull=pts[ConvexHull(pts).vertices]
    c=hull.mean(0); hull=c+(hull-c)*1.0+np.sign(hull-c)*0.5   # tiny grow
    col=np.median(im[ys,xs],0)
    # pixels inside hull (grown by ~1px) -> flat iris colour, but keep the dark rim antialias outside
    yy,xx=np.mgrid[ys.min()-3:ys.max()+4, xs.min()-3:xs.max()+4]
    inside=Path(hull).contains_points(np.c_[xx.ravel()+.5,yy.ravel()+.5]).reshape(xx.shape)
    im[yy[inside],xx[inside]]=col
    eyes.append(dict(cx=float(c[0]),cy=float(c[1]),w=float(xs.max()-xs.min()+1),h=float(ys.max()-ys.min()+1),
        hull=[[round(x,1),round(y,1)] for x,y in hull],colour='#%02x%02x%02x'%tuple(int(v) for v in col)))
eyes.sort(key=lambda e:e['cx'])
Image.fromarray(im.clip(0,255).astype(np.uint8)).save('bg.png')
json.dump(eyes,open('eyes.json','w'),indent=1)
for e in eyes: print(round(e['cx']),round(e['cy']),e['w'],e['h'],e['colour'],len(e['hull']))
