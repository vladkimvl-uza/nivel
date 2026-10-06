const { chromium } = require('C:/Users/v.kim/setup-studio/node_modules/@playwright/test');
const W = 'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad/hv/w2';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 1620 }, deviceScaleFactor: 2 });
  await p.goto('file:///' + W + '/screens.html'); await p.waitForLoadState('networkidle'); await p.evaluate('document.fonts.ready');
  await p.locator('#main').screenshot({ path: W + '/ui-main.png' });
  await p.locator('#left').screenshot({ path: W + '/ui-left.png' });
  await b.close();
})();
