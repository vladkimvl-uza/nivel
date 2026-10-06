# Смена режима: та же сцена без перезагрузки; на состояниях 03 и 05 меняется только свет (лампа не двигается).
import pathlib
from playwright.sync_api import sync_playwright
D=pathlib.Path(__file__).parent; URL=(D/'index.html').as_uri(); OUT=D/'shots'/'tmp'; OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',args=['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11'])
    pg=b.new_page(viewport={'width':1440,'height':900})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(URL+'?theme=night&nofps&nolenis'); pg.wait_for_load_state('networkidle')
    pg.wait_for_function('NV.sceneReady',timeout=30000)
    for st in [0.45,1.0]:
        pg.evaluate(f'NV.gotoP({st})'); pg.wait_for_timeout(1500)
        pg.evaluate('window.__sc=NV.scene; window.__cv=document.getElementById("scene")')
        to='day' if pg.evaluate('NV.theme')=='night' else 'night'
        pg.click(f'#tod button[data-t="{to}"]')
        pg.wait_for_timeout(450); pg.screenshot(path=str(OUT/f'toggle-{st}-mid.png'))
        pg.wait_for_timeout(1500); pg.screenshot(path=str(OUT/f'toggle-{st}-done.png'))
        print(st, to, pg.evaluate('({same:window.__sc===NV.scene&&window.__cv===document.getElementById("scene"),theme:document.documentElement.dataset.theme})'))
    print(errs)
    b.close()
