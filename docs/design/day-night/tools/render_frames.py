# Статичные кадры для телефонов и постер: 5 состояний x 2 режима x 2 раскладки,
# рендерятся той же сценой (index.html?render) через NV.scene.renderFrames.
# Заодно снимаются координаты подписей деталей на кадре 03 — они вписываются в index.html между /*FL*/.
import base64, json, pathlib, re
from playwright.sync_api import sync_playwright
D=pathlib.Path(__file__).parent; URL=(D/'index.html').as_uri(); OUT=D/'frames'; OUT.mkdir(exist_ok=True)
FL={}
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',args=['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11'])
    for L,vw,vh,dpr,q in [('d',1440,900,1,.8),('m',390,844,1.5,.78)]:
        pg=b.new_page(viewport={'width':vw,'height':vh},is_mobile=L=='m',has_touch=L=='m')
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(URL+'?render&nolenis&theme=day'); pg.wait_for_load_state('networkidle')
        pg.wait_for_function('NV.sceneReady',timeout=40000); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(500)
        for t in ['day','night']:
            res=pg.evaluate(f'NV.scene.renderFrames({{theme:"{t}",dpr:{dpr},q:{q}}})')
            FL[L]=res['fl']
            for i,u in enumerate(res['frames']):
                f=OUT/f'{t}-{L}{i+1}.webp'; f.write_bytes(base64.b64decode(u.split(',',1)[1]))
                print(f.name, f.stat().st_size//1024,'KB')
        print(L,'errors',errs)
        pg.close()
    b.close()
h=(D/'index.html').read_text(encoding='utf-8')
h2=re.sub(r'/\*FL\*/.*?/\*FL\*/','/*FL*/'+json.dumps(FL,separators=(',',':'))+'/*FL*/',h,count=1,flags=re.S)
assert h2!=h or '/*FL*/'+json.dumps(FL,separators=(',',':')) in h
(D/'index.html').write_text(h2,encoding='utf-8'); print('FL written', json.dumps(FL)[:200])
