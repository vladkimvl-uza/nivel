# Автоматическая проверка доступности (axe-core, WCAG 2.2 AA) в обоих режимах. Покрывает ~30–40 % требований; клавиатуру и экранный диктор проверять руками.
import pathlib, json
from playwright.sync_api import sync_playwright
D=pathlib.Path(__file__).parent; URL=(D/'index.html').as_uri()
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge')
    for t in ['day','night']:
        for lang in ['ru','uz']:
            pg=b.new_page(viewport={'width':1440,'height':900})
            pg.goto(URL+f'?theme={t}&lang={lang}&motion=off'); pg.wait_for_load_state('networkidle')
            pg.add_script_tag(url='https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js')
            r=pg.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})")
            print(t,lang,'violations:',len(r['violations']))
            for v in r['violations']:
                print('  ',v['id'],v['impact'],len(v['nodes']),'|',v['nodes'][0]['target'],'|',v['nodes'][0].get('failureSummary','')[:160].replace('\n',' '))
            pg.close()
    b.close()
