# usage: python3 compose.py <recDir> <outDir> — builds side-by-side GIFs from record.mjs output (real recordings, not simulations)
import json,os,subprocess,sys,tempfile,shutil
from PIL import Image,ImageDraw,ImageFont
rec,out=sys.argv[1],sys.argv[2]; os.makedirs(out,exist_ok=True)
def font(sz,bold=False):
    for p in ("/System/Library/Fonts/Helvetica.ttc","/System/Library/Fonts/Supplemental/Arial.ttf","/Library/Fonts/Arial.ttf"):
        if os.path.exists(p):
            try: return ImageFont.truetype(p,sz,index=(1 if bold and p.endswith('.ttc') else 0))
            except Exception: return ImageFont.truetype(p,sz)
    return ImageFont.load_default()
F,FB,FS,FT=font(13),font(14,True),font(11),font(16,True)
NAMES={"catalyst-1.1.0":"Catalyst 1.1.0","exact":"Exact","sveltekit":"SvelteKit"}
SC=0.55; PW,PH=int(412*SC),int(823*SC); M=16; GAP=20; HEAD=90; FOOT=118
def load(label,scn):
    m=json.load(open(f"{rec}/{label}-{scn}/meta.json")); m["imgs"]=[(f["ts"],f["file"]) for f in m["frames"]]; return m
def frame_at(m,t):
    best=None
    for ts,f in m["imgs"]:
        if ts<=t: best=f
        else: break
    return Image.open(best).convert("RGB").resize((PW,PH),Image.LANCZOS) if best else Image.new("RGB",(PW,PH),(255,255,255))
def jskib(m,t): return sum(x["b"] for x in m["js"] if x["t"]<=t)/1024
def events(m,scn,t,end):
    ev=m["ev"]; L=[]
    def add(k,txt,col):
        if k in ev and t>=ev[k]: L.append((f"{(ev[k]-origin(m,scn))*1000:,.0f} ms  {txt}",col))
    if scn=="load":
        add("fcp","first paint",(40,120,60)); add("lcp",f"LCP ({m.get('extra',{}).get('lcpEl','')})",(110,40,190)); add("dcl","DOMContentLoaded",(30,100,190)); add("load","load event",(190,40,40)); return L
    if scn=="early": add("input","search box visible",(40,120,60)); add("tapStart","tap, start typing 'pika'",(150,100,0)); add("typed","finished typing",(150,100,0)); add("load","load event (hydration can start)",(190,40,40))
    else: add("tapStart","tap the search box",(150,100,0)); add("typed","finished typing 'pika'",(150,100,0))
    if "filtered" in ev and t>=ev["filtered"]: L.append((f"{(ev['filtered']-origin(m,scn))*1000:,.0f} ms  list filtered",(30,100,190)))
    elif "filtered" not in ev and t>=end-0.05: L.append(("never filtered in this recording",(190,40,40)))
    return L
def origin(m,scn): return m["wall0"] if scn in ("early","load") else m["ev"]["tapStart"]
def build(labels,scn,title,fname):
    ms=[load(l,scn) for l in labels]
    if scn=="early": t0,t1=0.0,5.0
    elif scn=="load": t0,t1=0.0,4.4
    else: t0,t1=-0.5,2.3
    n=len(ms); W=M*2+PW*n+GAP*(n-1); H=HEAD+PH+FOOT; tmp=tempfile.mkdtemp(); i=0; tick=0.05
    t=t0
    while t<=t1+1e-9:
        img=Image.new("RGB",(W,H),(250,250,250)); d=ImageDraw.Draw(img)
        d.text((M,8),title,font=FT,fill=(20,20,20)); d.text((M,30),"Real recording at 1x speed: Lighthouse applied Slow 4G + 4x CPU slowdown.",font=FS,fill=(100,100,100)); d.text((M,44),"Exact follows the system dark mode; that does not affect timing.",font=FS,fill=(100,100,100))
        clock=f"t = {t*1000:,.0f} ms"+(" from navigation start" if scn in ("early","load") else " from the tap"); d.text((M,66),clock,font=FB,fill=(20,20,20))
        for k,m in enumerate(ms):
            x=M+k*(PW+GAP); o=origin(m,scn); ts=o+t
            img.paste(frame_at(m,ts),(x,HEAD)); d.rectangle([x-1,HEAD-1,x+PW,HEAD+PH],outline=(180,180,180))
            y=HEAD+PH+8; d.text((x,y),NAMES[m["label"]],font=FB,fill=(20,20,20))
            d.text((x,y+20),f"JS downloaded: {jskib(m,ts):.0f} KiB",font=F,fill=(80,80,80))
            for j,(txt,col) in enumerate(events(m,scn,ts,m["wall0"]+5.0 if scn=="early" else o+2.3)[:5]): d.text((x,y+40+j*14),txt,font=FS,fill=col)
        img.save(f"{tmp}/{i:04d}.png"); i+=1; t+=tick
    for _ in range(30): shutil.copy(f"{tmp}/{i-1:04d}.png",f"{tmp}/{i:04d}.png"); i+=1   # hold the last frame 1.5 s
    pal=f"{tmp}/p.png"; src=f"{tmp}/%04d.png"
    subprocess.run(["ffmpeg","-y","-loglevel","error","-framerate","20","-i",src,"-vf","palettegen=max_colors=96","-update","1",pal],check=True)
    subprocess.run(["ffmpeg","-y","-loglevel","error","-framerate","20","-i",src,"-i",pal,"-lavfi","paletteuse=dither=bayer:bayer_scale=4","-loop","0",f"{out}/{fname}"],check=True)
    shutil.rmtree(tmp); print(fname,os.path.getsize(f"{out}/{fname}")//1024,"KiB",i,"frames")
if len(sys.argv)>3 and sys.argv[3]=="load":
    build(["catalyst-1.1.0","exact"],"load","Page load: first paint and LCP","catalyst-vs-exact-page-load.gif")
    build(["catalyst-1.1.0","exact","sveltekit"],"load","Page load: first paint and LCP","all-three-page-load.gif")
else:
    build(["catalyst-1.1.0","exact"],"early","Typing 'pika' as soon as the search box appears","catalyst-vs-exact-early-typing.gif")
    build(["catalyst-1.1.0","exact"],"late","Typing 'pika' after the page has loaded","catalyst-vs-exact-after-load-typing.gif")
    build(["catalyst-1.1.0","exact","sveltekit"],"early","Typing 'pika' the moment the search box appears","all-three-early-typing.gif")
    build(["catalyst-1.1.0","exact","sveltekit"],"late","Typing 'pika' after the page has loaded","all-three-after-load-typing.gif")
