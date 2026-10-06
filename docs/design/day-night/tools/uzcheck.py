import pathlib,re
from playwright.sync_api import sync_playwright
D=pathlib.Path(__file__).parent; URL=(D/'index.html').as_uri()
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge')
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(URL+'?theme=night&lang=uz&motion=off'); pg.wait_for_load_state('networkidle')
    r=pg.evaluate('''()=>{const cyr=/[А-Яа-яЁё]/;const out=[];
      document.querySelectorAll('[aria-label],[title]').forEach(e=>{['aria-label','title'].forEach(a=>{const v=e.getAttribute(a);if(v&&cyr.test(v)&&!e.closest('svg title'))out.push(a+': '+v)})});
      const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(cyr.test(n.data)&&!n.parentElement.closest('script,style,title,.lg-n,.lg-d'))out.push('text: '+n.data.trim().slice(0,60)+' <'+n.parentElement.className)}
      return {t:document.title,d:document.querySelector('meta[name=description]').content.slice(0,60),out}}''')
    print(r['t'],'|',r['d']); print('\n'.join(r['out'][:40])); print(len(r['out']),errs)
    b.close()
