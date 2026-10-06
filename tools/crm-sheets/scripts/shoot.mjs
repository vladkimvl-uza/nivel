// Takes screenshots of the preview with a hidden browser (Playwright, headless Edge, its own profile).
// Usage: node scripts/shoot.mjs --out <dir> [--theme passport|night] [--sheet "Панель"] [--max-width 1900]
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "..", "package.json"));
const { chromium } = require("@playwright/test");

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    theme: { type: "string" },
    sheet: { type: "string" },
    "max-width": { type: "string" },
    file: { type: "string" },
    x: { type: "string" },
  },
});
const out = resolve(values.out || join(here, "..", "preview", "shots"));
mkdirSync(out, { recursive: true });
const file = values.file ? resolve(values.file) : join(here, "..", "preview", "index.html");
const themes = values.theme ? [values.theme] : ["passport", "night"];
const sheets = values.sheet
  ? [values.sheet]
  : [
      "Панель",
      "Сегодня",
      "Заявки",
      "Заказы",
      "Платежи",
      "Закупки",
      "Гарантия",
      "Клиенты",
      "Калькулятор",
      "Порог и налоги",
      "Резервы",
      "Продвижение",
      "История",
      "Справочники",
      "Настройки",
      "Самопроверка",
    ];
const maxWidth = Number(values["max-width"] || 1900);

const profile = mkdtempSync(join(tmpdir(), "nivel-shoot-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: "msedge",
  viewport: { width: 6400, height: 1100 },
});
try {
  const page = await context.newPage();
  for (const theme of themes) {
    for (const sheet of sheets) {
      const url = `${pathToFileURL(file).href}?theme=${theme}&sheet=${encodeURIComponent(sheet)}`;
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const frame = page.locator("section.on .frame");
      const box = await frame.boundingBox();
      const x0 = Number(values.x || 0);
      const clip = { x: box.x + x0, y: box.y, width: Math.min(box.width - x0, maxWidth), height: box.height };
      const name = `${theme === "night" ? "n" : "p"}-${sheet.replace(/\s+/g, "_")}${x0 ? `-x${x0}` : ""}.png`;
      await page.screenshot({ path: join(out, name), clip, fullPage: true });
    }
  }
  console.log("shots:", out);
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
