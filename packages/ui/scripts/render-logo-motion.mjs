// Renders the intro "Fit to tolerance" to clips for the bot and for Reels: the same scene as on the site, frame by frame.
//   packages/ui/media/logo-motion/logo-intro-1x1.mp4    1080 x 1080, no sound (the bot)
//   packages/ui/media/logo-motion/logo-intro-9x16.mp4   1080 x 1920, with the clicks (the start of Reels)
//   packages/ui/media/logo-motion/logo-intro-1x1.png, logo-intro-9x16.png   posters: the last frame
// H.264, yuv420p, faststart; each clip must weigh at most 1.5 MB.
//
// Usage: pnpm exec node packages/ui/scripts/render-logo-motion.mjs [--out <dir>] [--only 1x1|9x16] [--shots <dir>]
//                                                                    [--at 0.5,1.2,...] [--profile <dir>]
//   --shots <dir>   also writes PNG frames at the times of --at (default: every seat and the end) for review
//   --crf, --tune   x264 quality (default 16) and tune (default grain)
//   --no-video      only the posters and --shots (a quick look at the frames)
//   --no-check      do not fail when a gate on the final frame is missed (the numbers are printed anyway)
//   --profile <dir> user data dir of the browser (default: a new temporary folder, removed at the end)
//
// The browser is Microsoft Edge in a new HIDDEN profile (headless): no window opens for the owner. The scene runs from
// the source files: a small local server turns .ts into .js (Node strips the types) and serves three from node_modules,
// so no bundler is needed and no dependency is added. Needs ffmpeg in PATH and Playwright from the repo root.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { renderClickTrack, SAMPLE_RATE, wavBytes } from "../src/logo-motion/click-sound.ts";
import { CLICKS, finalFramePoint, INTRO_DURATION } from "../src/logo-motion/timeline.ts";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// three/build/three.module.js -> the package folder
const THREE_DIR = dirname(dirname(fileURLToPath(import.meta.resolve("three"))));
const FPS = 30;
/** Length of a clip: the intro (3.3 s) and a short hold on the still lockup. */
const CLIP_SECONDS = 3.4;
const MAX_BYTES = 1.5 * 1024 * 1024;
const FORMATS = {
  "1x1": { width: 1080, height: 1080, sound: false },
  "9x16": { width: 1080, height: 1920, sound: true },
};

const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(PKG, "media", "logo-motion") },
    only: { type: "string" },
    shots: { type: "string" },
    at: { type: "string" },
    profile: { type: "string" },
    crf: { type: "string", default: "16" },
    tune: { type: "string", default: "grain" },
    "no-video": { type: "boolean", default: false },
    "no-check": { type: "boolean", default: false },
  },
});

/**
 * Gates on the final frame (the "known limits" of the concept, fixed for the night): the pool of the lamp must not
 * look like a vignette, and the lower chamfers of the letters must not leave a hairline shadow.
 */
const GATES = { poolEdgeToCentre: 0.5, chamferToFace: 0.9 };
/** The stem of the letter "l": x 320.56 - 332.61, its foot is at y = 0 of the lockup (scene units, Y up). */
const L_STEM = { x: 326.585, footY: 0.7, faceY: 10 };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".html": "text/html" };

/** Local server: the page, the package sources (types stripped), fonts and three. */
function serve() {
  const page = `<!doctype html><html lang="ru" data-theme="night"><head><meta charset="utf-8">
<link rel="stylesheet" href="/ui/src/styles/index.css">
<script type="importmap">${JSON.stringify({ imports: { three: "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } })}</script>
<style>html,body{margin:0;height:100%;overflow:hidden;background:var(--bg)}</style></head>
<body><div class="nv-logo-intro" style="position:fixed;inset:0" data-state="playing">
<canvas class="nv-logo-intro__canvas" id="c"></canvas><span class="nv-logo-intro__caption" id="cap" aria-hidden="true">±0.000</span></div>
<script type="module">
import { createLogoMotion } from "/ui/src/logo-motion/index.ts";
window.__start = async () => {
  const m = createLogoMotion(document.getElementById("c"), { mode: "intro", autoplay: false, caption: document.getElementById("cap") });
  await m.ready;
  window.__m = m;
  return true;
};
window.__seek = async (t) => {
  window.__m.seek(t);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};
window.__ready = true;
</script></body></html>`;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" }).end(page);
        return;
      }
      const roots = { "/ui/": PKG, "/three/": THREE_DIR };
      const prefix = Object.keys(roots).find((p) => url.pathname.startsWith(p));
      if (!prefix) throw new Error("not found");
      const file = normalize(join(roots[prefix], decodeURIComponent(url.pathname.slice(prefix.length))));
      if (!file.startsWith(roots[prefix])) throw new Error("outside the root");
      let body = await readFile(file);
      let type = MIME[extname(file)] ?? "application/octet-stream";
      if (file.endsWith(".ts")) {
        body = stripTypeScriptTypes(body.toString("utf8"));
        type = MIME[".js"];
      }
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** ffmpeg fed with PNG frames on stdin; resolves with the size of the file. */
function encoder(file, wavFile) {
  const args = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-"];
  if (wavFile) args.push("-i", wavFile);
  // RGB frames to BT.709 limited-range yuv420p with error diffusion (the dark lamp pool has few levels, plain rounding
  // bands it), and the colour tags a player needs to show the orange and the paper as the page does
  const convert =
    "scale=flags=accurate_rnd+full_chroma_int+error_diffusion:out_color_matrix=bt709:out_range=tv,format=yuv420p";
  args.push("-vf", convert, "-c:v", "libx264", "-preset", "slow", "-crf", values.crf, "-r", String(FPS));
  // `grain` keeps the dither of the dark gradient: without it the encoder smooths the noise out and the lamp pool bands
  args.push("-tune", values.tune, "-profile:v", "high", "-movflags", "+faststart");
  args.push("-x264-params", "colorprim=bt709:transfer=iec61966-2-1:colormatrix=bt709");
  if (wavFile) args.push("-c:a", "aac", "-b:a", "160k", "-shortest");
  else args.push("-an");
  args.push(file);
  const child = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((ok, fail) => {
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? ok(statSync(file).size) : fail(new Error(`ffmpeg exited with ${code}`))));
  });
  return { stdin: child.stdin, done };
}

/** Luminance (0-255) of pixels of a PNG, read in the page (no PNG decoder in Node). */
async function luminance(page, png, points) {
  return page.evaluate(
    async ({ b64, list }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      return list.map(([x, y]) => {
        const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
      });
    },
    { b64: png.toString("base64"), list: points },
  );
}

/** Measures the final frame and returns the problems (empty when the gates hold). */
async function check(page, name, png, width, height) {
  const foot = finalFramePoint(width, height, L_STEM.x, L_STEM.footY);
  const face = finalFramePoint(width, height, L_STEM.x, L_STEM.faceY);
  const [edge, centre, chamfer, body] = await luminance(page, png, [
    [width * 0.1, height * 0.04],
    [width * 0.1, height * 0.5],
    [foot.px, foot.py],
    [face.px, face.py],
  ]);
  const pool = edge / centre;
  const bevel = chamfer / body;
  console.info(
    `${name}: lamp pool edge/centre ${pool.toFixed(2)} (gate >= ${GATES.poolEdgeToCentre}), lower chamfer/face ${bevel.toFixed(2)} (gate >= ${GATES.chamferToFace})`,
  );
  const problems = [];
  if (pool < GATES.poolEdgeToCentre) problems.push(`${name}: the lamp pool looks like a vignette (${pool.toFixed(2)})`);
  if (bevel < GATES.chamferToFace) problems.push(`${name}: hairline shadow under the letters (${bevel.toFixed(2)})`);
  return problems;
}

const parseTimes = (text) =>
  text
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);

async function main() {
  const names = values.only ? [values.only] : Object.keys(FORMATS);
  for (const n of names) if (!FORMATS[n]) throw new Error(`unknown format ${n}; use 1x1 or 9x16`);
  mkdirSync(values.out, { recursive: true });
  const shotTimes = values.at ? parseTimes(values.at) : [0, 0.3, ...CLICKS.map((c) => c.t), INTRO_DURATION];
  if (values.shots) mkdirSync(values.shots, { recursive: true });

  const problems = [];
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const profile = values.profile ?? mkdtempSync(join(tmpdir(), "nivel-logo-motion-"));
  const tmp = mkdtempSync(join(tmpdir(), "nivel-logo-wav-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "msedge",
    headless: true,
    deviceScaleFactor: 1,
    viewport: { width: 1080, height: 1080 },
    args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--force-color-profile=srgb"],
  });
  try {
    for (const name of names) {
      const { width, height, sound } = FORMATS[name];
      const page = await context.newPage();
      page.on(
        "console",
        (m) => (m.type() === "error" || m.type() === "warning") && console.warn(`[page ${m.type()}] ${m.text()}`),
      );
      page.on("pageerror", (e) => console.error(`[page error] ${e.message}`));
      await page.setViewportSize({ width, height });
      await page.goto(base);
      await page.waitForFunction("window.__ready === true");
      await page.evaluate("window.__start()");

      let wav = null;
      if (sound) {
        wav = join(tmp, `${name}.wav`);
        writeFileSync(wav, wavBytes(renderClickTrack(CLIP_SECONDS), SAMPLE_RATE));
      }
      const file = join(values.out, `logo-intro-${name}.mp4`);
      const frames = Math.round(CLIP_SECONDS * FPS);
      let size = 0;
      if (!values["no-video"]) {
        const enc = encoder(file, wav);
        for (let i = 0; i < frames; i++) {
          await page.evaluate(`window.__seek(${i / FPS})`);
          const png = await page.screenshot({ type: "png" });
          if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once("drain", r));
        }
        enc.stdin.end();
        size = await enc.done;
      }

      await page.evaluate(`window.__seek(${INTRO_DURATION})`);
      const poster = await page.screenshot({ type: "png" });
      writeFileSync(join(values.out, `logo-intro-${name}.png`), poster);
      problems.push(...(await check(page, name, poster, width, height)));
      if (values.shots) {
        for (const t of shotTimes) {
          await page.evaluate(`window.__seek(${t})`);
          writeFileSync(
            join(values.shots, `${name}-t${String(Math.round(t * 1000)).padStart(4, "0")}.png`),
            await page.screenshot({ type: "png" }),
          );
        }
      }
      if (!values["no-video"])
        console.info(`${name}: ${file} ${(size / 1024).toFixed(0)} KB (${frames} frames, ${width}x${height})`);
      if (size > MAX_BYTES) throw new Error(`${name}: ${size} bytes is over the limit of ${MAX_BYTES}; raise --crf`);
      await page.close();
    }
    if (problems.length && !values["no-check"]) throw new Error(problems.join("; "));
  } finally {
    await context.close();
    server.close();
    rmSync(tmp, { recursive: true, force: true });
    if (!values.profile) rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
