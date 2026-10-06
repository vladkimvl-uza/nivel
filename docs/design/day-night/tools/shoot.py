# Скриншоты для самопроверки: day/night x desktop (WebGL) / mobile (кадры по умолчанию) x состояния 1,3,5 + полная страница.
# Рабочие снимки — в shots/tmp, итоговые 8 файлов — в shots/.
import sys, io, pathlib, shutil
from playwright.sync_api import sync_playwright
from PIL import Image

D = pathlib.Path(__file__).parent
OUT = D / 'shots'; TMP = OUT / 'tmp'; TMP.mkdir(parents=True, exist_ok=True)
URL = (D / 'index.html').as_uri()
STATES = {1: 0.0, 3: 0.45, 4: 0.8, 5: 1.0}
only = sys.argv[1:]

def page(b, vw, vh, mob, q):
    pg = b.new_page(viewport={'width': vw, 'height': vh}, is_mobile=mob, has_touch=mob, device_scale_factor=1)
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('requestfailed', lambda r: errs.append('FAIL ' + r.url))
    pg.goto(URL + '?' + q)
    pg.wait_for_load_state('networkidle')
    pg.evaluate('document.fonts.ready')
    return pg, errs

def wait_scene(pg):
    try:
        pg.wait_for_function('window.NV && (NV.sceneReady || NV.mode!=="webgl")', timeout=30000)
    except Exception:
        pass
    pg.wait_for_timeout(600)

def goto_state(pg, p):
    pg.evaluate(f'NV.gotoP({p})'); pg.wait_for_timeout(1400)
    pg.evaluate(f'NV.gotoP({p})'); pg.wait_for_timeout(900)

def full(pg, path):
    vw, vh = pg.viewport_size['width'], pg.viewport_size['height']
    pg.evaluate('document.querySelectorAll(".rv,.step").forEach(e=>e.classList.add("is-in"))')
    pg.add_style_tag(content='.card{position:static!important}.cfg-bar{display:none!important}')
    tiles = []
    goto_state(pg, 0)
    tiles.append(Image.open(io.BytesIO(pg.screenshot())))
    start = pg.evaluate('(()=>{const r=document.getElementById("heroTrack").getBoundingClientRect();return r.bottom+scrollY})()')
    total = pg.evaluate('Math.min(document.documentElement.scrollHeight,Math.floor(document.querySelector(".ftr").getBoundingClientRect().bottom+scrollY))')
    y = start; hid = False
    while y < total:
        pg.evaluate(f'scrollTo(0,{y})'); pg.wait_for_timeout(350)
        if not hid:
            pg.add_style_tag(content='.hdr{visibility:hidden!important}'); hid = True
        sy = pg.evaluate('scrollY')
        im = Image.open(io.BytesIO(pg.screenshot()))
        off = int(y - sy); h = min(vh - off, total - y)
        if h <= 0: break
        tiles.append(im.crop((0, off, vw, off + h))); y += h
    H = sum(t.height for t in tiles)
    out = Image.new('RGB', (vw, H)); yy = 0
    for t in tiles: out.paste(t, (0, yy)); yy += t.height
    out.save(path)
    pg.add_style_tag(content='.hdr{visibility:visible!important}')
    return H

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', args=['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'])
    for L, vw, vh, mob, q in [('desktop', 1440, 900, False, 'nofps&nolenis'), ('mobile', 390, 844, True, 'nolenis')]:
        for t in ['day', 'night']:
            if only and f'{L}-{t}' not in only and t not in only and L not in only:
                continue
            pg, errs = page(b, vw, vh, mob, f'theme={t}&{q}')
            wait_scene(pg)
            info = pg.evaluate('({mode:NV.mode,gate:NV.gateInfo&&NV.gateInfo.why,ready:!!NV.sceneReady,probe:NV.probeMs,sw:document.documentElement.scrollWidth,iw:innerWidth,info:NV.scene&&NV.scene.info()})')
            for k, pp in STATES.items():
                goto_state(pg, pp)
                pg.screenshot(path=str(TMP / f'{L}-{t}-s{k}.png'))
            H = full(pg, str(TMP / f'{L}-{t}-full.png'))
            print(L, t, info, 'H=', H, errs[:5])
            pg.close()
    b.close()
