// The preview: the book with the demo data drawn in both themes from the mock of Google Sheets. The file on disk must
// be the one the script draws now (run: node tools/crm-sheets/scripts/preview.mjs).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { generatePreview } from "../crm-sheets/scripts/preview.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let result;
beforeAll(() => {
  result = generatePreview();
}, 180_000);

describe("preview/index.html", () => {
  it("is up to date with the sources", () => {
    const onDisk = readFileSync(join(here, "..", "crm-sheets", "preview", "index.html"), "utf8");
    expect(onDisk).toBe(result.html);
  });

  it("every formula of the calculated columns evaluated without an error", () => {
    expect(result.errors).toEqual([]);
  });

  it("holds 17 sheets in each of the two themes", () => {
    const sections = [...result.html.matchAll(/<section data-theme="(\w+)" data-sheet="([^"]+)"/g)];
    expect(sections).toHaveLength(34);
    expect(sections.filter((s) => s[1] === "passport")).toHaveLength(17);
    expect(sections.filter((s) => s[1] === "night")).toHaveLength(17);
    expect(new Set(sections.map((s) => s[2])).size).toBe(17);
  });

  it("the panel has twelve tiles with their figures, eight charts, the logo and the sparklines in both themes", () => {
    for (const theme of ["passport", "night"]) {
      const start = result.html.indexOf(`<section data-theme="${theme}" data-sheet="Панель"`);
      const panel = result.html.slice(start, result.html.indexOf("</section>", start));
      expect((panel.match(/<svg[^>]*width="576"[^>]*height="300"/g) || []).length).toBe(8);
      expect(panel).toContain("data:image/png;base64,");
      for (const label of [
        "Плата за период",
        "Заказы в работе (закупка – доставка)",
        "Сдано за период",
        "Заявки без спама",
        "Порог года",
        "Средства клиентов на счёте ИП",
        "Резерв гарантии",
        "Налог 1 % (оценка)",
        "Конверсия заявка → заказ",
        "Средняя плата",
        "Время первого ответа",
        "Просрочено задач",
      ]) {
        expect(panel).toContain(label);
      }
      expect(panel).toContain("Nivel · CRM");
      expect(panel).toMatch(/\d\d,\d%/);
      expect(panel).toContain("Воронка за период");
      expect(panel).toContain("Состав заказов за период");
      expect(
        (panel.match(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+">/g) || []).length,
      ).toBeGreaterThanOrEqual(8);
    }
  });

  it("the colours of the themes: paper and asphalt, one orange; nothing from the anti-list", () => {
    expect(result.html).toContain("#F1EFEA");
    expect(result.html).toContain("#1D1D1B");
    expect(result.html).toContain("#D9501A");
    expect(result.html).toContain("#F06A30");
    for (const bad of [
      "#0C1230",
      "#111A3E",
      "#0070C8",
      "#378ADD",
      "#7C6FF7",
      "#7F77DD",
      "#12BCB7",
      "#1D9E75",
      "Geist",
      "Manrope",
    ]) {
      expect(result.html).not.toContain(bad);
    }
    expect(result.html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("the orders sheet shows the stamp «Сдан», the overdue marks and the money in the format «12 500 000 сум»", () => {
    const start = result.html.indexOf('<section data-theme="passport" data-sheet="Заказы"');
    const orders = result.html.slice(start, result.html.indexOf("</section>", start));
    expect(orders).toContain("Сдан");
    expect(orders).toMatch(/14 200 000 сум/);
    expect(orders).toContain("NV-2026-D001");
    // the stamp of the handover (asphalt fill, paper text, bold) is one of the classes of the sheet
    expect(result.html).toMatch(/td\.s\w+\{[^}]*background:#1D1D1B;color:#F1EFEA[^}]*font-weight:700/);
  });

  it("the sheet Телефон shows six figures in a column and no chart", () => {
    for (const theme of ["passport", "night"]) {
      const start = result.html.indexOf(`<section data-theme="${theme}" data-sheet="Телефон"`);
      const phone = result.html.slice(start, result.html.indexOf("</section>", start));
      for (const label of [
        "Плата за период",
        "Средства клиентов на счёте ИП",
        "Заказы в работе (закупка – доставка)",
        "Заявки без спама",
        "Просрочено задач",
        "Порог года",
      ])
        expect(phone, label).toContain(label);
      expect(phone).not.toContain('width="576"');
    }
  });

  it("the sheet Сегодня lists the tasks with the state of the term", () => {
    const start = result.html.indexOf('<section data-theme="passport" data-sheet="Сегодня"');
    const today = result.html.slice(start, result.html.indexOf("</section>", start));
    for (const s of ["Просрочено", "Сегодня", "Завтра", "На неделе"]) expect(today).toContain(s);
    expect(today).toContain("Мои задачи");
  });
});
