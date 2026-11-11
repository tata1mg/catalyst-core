# usage: python3 harness/extract_lighthouse_images.py benchmarks/pokedex/results
# Pulls the images Lighthouse itself embeds in each report (filmstrip frames and final screenshot) into <framework>/lighthouse-images/<mode>/.
import json,base64,os,sys
R=sys.argv[1]
for n in ("catalyst-1.0.0","catalyst-1.1.0","exact","sveltekit"):
    for m in ("simulated","applied"):
        f=f"{R}/{n}/lighthouse.{m}.html"
        if not os.path.exists(f): continue
        j=json.JSONDecoder().raw_decode(open(f).read().split('window.__LIGHTHOUSE_JSON__ = ',1)[1])[0]; a=j['audits']; d=f"{R}/{n}/lighthouse-images/{m}"; os.makedirs(d,exist_ok=True)
        for it in a['screenshot-thumbnails']['details']['items']: open(f"{d}/filmstrip-{it['timing']:05d}ms.jpg","wb").write(base64.b64decode(it['data'].split(',',1)[1]))
        open(f"{d}/final-screenshot.jpg","wb").write(base64.b64decode(a['final-screenshot']['details']['data'].split(',',1)[1]))
        # the full-page screenshot stays inside the HTML report (it is large); extract it from j['fullPageScreenshot'] if you want the file
