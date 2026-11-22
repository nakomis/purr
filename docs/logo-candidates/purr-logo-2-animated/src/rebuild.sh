set -e
C=/Applications/AniCraft.app/Contents/MacOS/anicraft-cli
python3 build.py >/dev/null
python3 -c "
import json;S=json.load(open('script_raw.json'));i=[k for k,s in enumerate(S) if s['cmd']=='__SELECT_LAYER_ALL__'][0]
json.dump(S[:i]+[{'cmd':'doc.info','params':{}}],open('pass1.json','w'))"
rm -f purr.anicraft purr-full.anicraft
$C new --out purr.anicraft --width 1024 --height 1024 --fps 24 >/dev/null
IDS=$($C run purr.anicraft pass1.json | python3 -c "
import json,sys;d=json.load(sys.stdin)[-1];L={l['name']:l['id'] for l in d['layers']}
print(json.dumps({'mouse':L['Mouse'],'mask':L['Iris mask'],'pupils':[v for k,v in L.items() if k.startswith('Pupils')]}))")
python3 build.py "$IDS" >/dev/null
$C run purr.anicraft script.json --save purr-full.anicraft > full.out 2>&1
rm -f f*.png
for f in "$@"; do $C render purr-full.anicraft --out f$f.png --frame $f >/dev/null; done
