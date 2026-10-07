// Finale below the page: "fit to tolerance" logo motion (docs/design/logo-motion/fit/index.html), night,
// rendered frame by frame through NV_LOGO.seek(t) in hidden Edge. No audio. Frames go to the scratch folder,
// then encode-logo.sh builds the videos with the edges faded into the footer colour #0B0A09.
// Run: node render-logo.cjs <framesDir>
const { chromium } = require('C:/Users/v.kim/setup-studio/node_modules/@playwright/test');
const fs = require('fs'), path = require('path');
const FIT = 'file:///' + path.resolve(__dirname, '../../../logo-motion/fit/index.html').replace(/\\/g, '/');
const OUT = process.argv[2]; if (!OUT) throw new Error('frames dir?');
const LAYOUTS = [
  { k: 'd', vp: { width: 1280, height: 720 }, loopFps: 25 },
  { k: 'm', vp: { width: 720, height: 1280 }, loopFps: 20 },
];
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  const boxes = {};
  for (const L of LAYOUTS) {
    for (const mode of ['intro', 'loop']) {
      const dir = path.join(OUT, `${L.k}-${mode}`); fs.mkdirSync(dir, { recursive: true });
      const pg = await b.newPage({ viewport: L.vp });
      const errs = []; pg.on('pageerror', e => errs.push(String(e)));
      await pg.goto(`${FIT}?theme=night&mode=${mode}&ui=0&autoplay=0&rm=ignore`);
      await pg.waitForFunction('window.NV_LOGO && NV_LOGO.ready && NV_LOGO.seek', null, { timeout: 60000 });
      await pg.evaluate('document.fonts.ready'); await pg.waitForTimeout(900);
      const fps = mode === 'intro' ? 25 : L.loopFps, dur = mode === 'intro' ? 3.3 : 12;
      const n = mode === 'intro' ? Math.round(dur * fps) + 1 : Math.round(dur * fps);
      for (let i = 0; i < n; i++) {
        const t = Math.min(dur, i / fps);
        await pg.evaluate(t => NV_LOGO.seek(t), t);
        await pg.screenshot({ path: path.join(dir, String(i).padStart(4, '0') + '.png') });
      }
      if (mode === 'intro') {
        boxes[L.k] = { vp: L.vp, at: {} };
        for (const t of [0, 0.1, 0.52, 3.3]) {
          await pg.evaluate(t => NV_LOGO.seek(t), t);
          boxes[L.k].at[t] = {};
          for (const nm of ['line', 'tri', 'shelf', 'word', 'dot']) boxes[L.k].at[t][nm] = (await pg.evaluate(nm => NV_LOGO.box(nm), nm)).map(v => +v.toFixed(1));
        }
      }
      console.log(L.k, mode, n, 'frames', 'errors', errs.length ? errs : 'none');
      await pg.close();
    }
  }
  fs.writeFileSync(path.join(OUT, 'boxes.json'), JSON.stringify(boxes, null, 1));
  await b.close();
})();
