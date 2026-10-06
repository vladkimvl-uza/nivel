import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { NBSP } from "../format/format.ts";
import { findAll, render } from "../test-support/render.ts";
import { Badge, Tag } from "./Badge.tsx";
import { Button, Mark } from "./Button.tsx";
import { EstimateRow, EstimateTable } from "./Estimate.tsx";
import { Select, TextField } from "./Field.tsx";
import { badgeKinds } from "./kinds.ts";
import { Money } from "./Money.tsx";
import { Paper } from "./Paper.tsx";
import { RoundStamp, Stamp, StampInkDefs } from "./Stamp.tsx";
import { SumsTable } from "./SumsTable.tsx";

/** The first opening tag of `name` in `html`. */
function tag(html: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>`).exec(html);
  if (!m) throw new Error(`<${name}> not found in ${html}`);
  return m[0];
}
const h = createElement;

describe("Button", () => {
  it("is a real button that does not submit forms unless asked", () => {
    const html = render(h(Button, {}, "Рассчитать сетап"));
    expect(html).toBe('<button type="button" class="nv-btn">Рассчитать сетап</button>');
    expect(tag(render(h(Button, { type: "submit" }, "Отправить")), "button")).toContain('type="submit"');
  });

  it("has ghost and small variants through classes only", () => {
    expect(tag(render(h(Button, { variant: "ghost" }, "x")), "button")).toContain('class="nv-btn nv-btn--ghost"');
    expect(tag(render(h(Button, { size: "sm" }, "x")), "button")).toContain('class="nv-btn nv-btn--sm"');
    expect(tag(render(h(Button, { variant: "ghost", size: "sm", className: "extra" }, "x")), "button")).toContain(
      'class="nv-btn nv-btn--ghost nv-btn--sm extra"',
    );
  });

  it("becomes a link with an href, and keeps the same classes", () => {
    const html = render(h(Button, { href: "/uz/configurator", variant: "ghost" }, "Konfigurator"));
    expect(html).toBe('<a class="nv-btn nv-btn--ghost" href="/uz/configurator">Konfigurator</a>');
  });

  it("puts the triangle mark before the label of a call to action, hidden from readers", () => {
    const html = render(h(Button, { mark: true }, "Смета в Telegram"));
    expect(html).toContain('<span class="nv-mk" aria-hidden="true"></span>Смета в Telegram');
    expect(render(h(Mark, {}))).toBe('<span class="nv-mk" aria-hidden="true"></span>');
  });

  it("passes disabled and aria attributes through, and escapes the label", () => {
    const html = render(h(Button, { disabled: true, "aria-label": "Закрыть" }, '<b>x</b> & "y" ʻ 😀'));
    expect(tag(html, "button")).toContain("disabled");
    expect(tag(html, "button")).toContain('aria-label="Закрыть"');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; ʻ 😀");
  });

  it("hands onClick to the element", () => {
    let clicks = 0;
    const tree = Button({ onClick: () => clicks++, children: "go" });
    (tree.props.onClick as () => void)();
    expect(clicks).toBe(1);
  });
});

describe("TextField", () => {
  it("ties the label to the input by id", () => {
    const html = render(h(TextField, { id: "name", label: "Имя", name: "name" }));
    expect(html).toContain('<label class="nv-field__label" for="name">Имя</label>');
    expect(tag(html, "input")).toContain('id="name"');
    expect(tag(html, "input")).toContain('name="name"');
    expect(tag(html, "input")).toContain('type="text"');
  });

  it("describes the input by the hint and the error, and marks it invalid", () => {
    const html = render(
      h(TextField, { id: "tel", label: "Телефон", hint: "С кодом страны", error: "Не хватает цифр", type: "tel" }),
    );
    const input = tag(html, "input");
    expect(input).toContain('aria-describedby="tel-hint tel-error"');
    expect(input).toContain('aria-invalid="true"');
    expect(html).toContain('<p class="nv-field__hint" id="tel-hint">С кодом страны</p>');
    expect(html).toContain('<p class="nv-field__error" id="tel-error" role="alert">Не хватает цифр</p>');
    expect(html).toContain("nv-field--invalid");
  });

  it("has no description and no invalid mark when there is no hint and no error", () => {
    const html = render(h(TextField, { id: "a", label: "A" }));
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("nv-field--invalid");
  });

  it("describes by the hint alone when the error is absent", () => {
    expect(tag(render(h(TextField, { id: "a", label: "A", hint: "h" })), "input")).toContain(
      'aria-describedby="a-hint"',
    );
  });

  it("passes the usual input attributes", () => {
    const html = render(
      h(TextField, {
        id: "q",
        label: "Бюджет",
        required: true,
        inputMode: "numeric",
        autoComplete: "off",
        placeholder: "12 000 000",
        defaultValue: "7",
        maxLength: 12,
      }),
    );
    const input = tag(html, "input");
    for (const part of [
      "required",
      'inputMode="numeric"',
      'autoComplete="off"',
      'placeholder="12 000 000"',
      'value="7"',
      'maxLength="12"',
    ]) {
      expect(input, part).toContain(part);
    }
  });

  it("refuses a field without a label: it would be unusable for a screen reader", () => {
    expect(() => TextField({ id: "x", label: "" })).toThrow(/label/);
    expect(() => TextField({ id: "x", label: "   " })).toThrow(/label/);
    expect(() => TextField({ id: "", label: "L" })).toThrow(/id/);
  });

  it("escapes what the visitor typed and the texts", () => {
    const html = render(
      h(TextField, { id: "x", label: "L", defaultValue: '"><script>alert(1)</script>', error: "<i>" }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;i&gt;");
  });
});

describe("Select", () => {
  const options = [
    { value: "pc", label: "Сборка ПК" },
    { value: "setup", label: "Сетап" },
    { value: "off", label: "Недоступно", disabled: true },
  ];

  it("renders a native select tied to its label, with every option", () => {
    const html = render(h(Select, { id: "kind", label: "Что нужно", options, defaultValue: "setup" }));
    expect(html).toContain('<label class="nv-field__label" for="kind">Что нужно</label>');
    expect(tag(html, "select")).toContain('id="kind"');
    expect(html).toContain('<option value="pc">Сборка ПК</option>');
    expect(html).toContain('<option value="setup" selected="">Сетап</option>');
    expect(html).toContain('<option value="off" disabled="">Недоступно</option>');
  });

  it("can start with an empty placeholder option that cannot be chosen again", () => {
    const html = render(h(Select, { id: "k", label: "K", options, placeholder: "Выберите", defaultValue: "" }));
    expect(html).toContain('<option value="" disabled="" selected="">Выберите</option>');
  });

  it("shares the hint and error semantics of TextField", () => {
    const html = render(h(Select, { id: "k", label: "K", options, error: "Нужно выбрать" }));
    expect(tag(html, "select")).toContain('aria-invalid="true"');
    expect(tag(html, "select")).toContain('aria-describedby="k-error"');
    expect(html).toContain('role="alert"');
  });

  it("renders with no options and escapes option text", () => {
    expect(render(h(Select, { id: "k", label: "K", options: [] }))).toContain("<select");
    const html = render(h(Select, { id: "k", label: "K", options: [{ value: "a&b", label: "<img onerror=x>" }] }));
    expect(html).toContain('value="a&amp;b"');
    expect(html).toContain("&lt;img onerror=x&gt;");
  });

  it("refuses a missing label", () => {
    expect(() => Select({ id: "k", label: "", options })).toThrow(/label/);
  });
});

describe("Money", () => {
  it("writes the whole sum in mono with the unit after a non-breaking space and the raw number in value", () => {
    expect(render(h(Money, { amount: 26_830_000, unit: "сум" }))).toBe(
      `<data class="nv-num nv-money" value="26830000">26${NBSP}830${NBSP}000${NBSP}сум</data>`,
    );
  });

  it("works without a unit (the column header carries it)", () => {
    expect(render(h(Money, { amount: 3_000_000 }))).toContain(`>3${NBSP}000${NBSP}000</data>`);
  });

  it("shows a refund with the minus sign", () => {
    expect(render(h(Money, { amount: -140_000, unit: "soʻm" }))).toContain(`−140${NBSP}000${NBSP}soʻm`);
  });

  it("refuses fractions: a sum is a whole number of soʻm", () => {
    expect(() => Money({ amount: 99.5 })).toThrow(RangeError);
  });
});

describe("EstimateRow and EstimateTable", () => {
  const labels = { index: "№", name: "Позиция", amount: "Сумма, сум" };

  it("renders a row with a two-digit index, the name, a note and the amount", () => {
    const html = render(
      h(
        "table",
        {},
        h(
          "tbody",
          {},
          h(EstimateRow, { index: 3, name: "Видеокарта RTX 5070 12 ГБ", note: "пример", amount: 9_650_000 }),
        ),
      ),
    );
    expect(html).toContain('<td class="nv-est__i">03</td>');
    expect(html).toContain('<td class="nv-est__name">Видеокарта RTX 5070 12 ГБ<small>пример</small></td>');
    expect(html).toContain(`value="9650000">9${NBSP}650${NBSP}000</data>`);
  });

  it("keeps the column when there is no index or note", () => {
    const html = render(h("table", {}, h("tbody", {}, h(EstimateRow, { name: "Монтаж", amount: 400_000 }))));
    expect(html).toContain('<td class="nv-est__i"></td>');
    expect(html).not.toContain("<small>");
  });

  it("marks a refund row and shows it with the minus", () => {
    const html = render(
      h("table", {}, h("tbody", {}, h(EstimateRow, { name: "Возврат по чекам", amount: -140_000, kind: "refund" }))),
    );
    expect(html).toContain("nv-est__row--refund");
    expect(html).toContain("−140");
  });

  it("is a table with a hidden caption and column headers a reader can use", () => {
    const html = render(
      h(
        EstimateTable,
        { caption: "Смета NV-0001", labels },
        h(EstimateRow, { index: "01", name: "Корпус", amount: 1_200_000 }),
      ),
    );
    expect(html).toContain('<caption class="nv-sr">Смета NV-0001</caption>');
    expect(html.match(/<th scope="col"/g)).toHaveLength(3);
    expect(html).toContain(">Сумма, сум</th>");
    expect(html).toContain("<tbody>");
  });

  it("renders 10 000 rows in reasonable time", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      h(EstimateRow, { key: i, index: i + 1, name: `Позиция ${i}`, amount: i * 1000 }),
    );
    const t0 = performance.now();
    const html = render(h(EstimateTable, { caption: "Большая смета", labels }, rows));
    expect(html.match(/<tr class="nv-est__row/g)).toHaveLength(10_000);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe("SumsTable", () => {
  const lines = [
    { id: "parts", label: "Детали по чекам", amount: 26_690_000 },
    { id: "fee", label: "Плата, 10 % (минимум 3 млн)", amount: 3_000_000 },
    { id: "sum", label: "Итого к оплате", amount: 29_690_000, kind: "subtotal" as const },
    { id: "ref", label: "Возврат клиенту", amount: -140_000, kind: "refund" as const },
    { id: "tot", label: "Итого", amount: 29_550_000, kind: "total" as const },
  ];

  it("puts plain lines in the body and subtotals, refunds and the total in the footer, in order", () => {
    const html = render(h(SumsTable, { caption: "Итоги", unit: "сум", lines }));
    const body = /<tbody>(.*?)<\/tbody>/.exec(html)?.[1] ?? "";
    const foot = /<tfoot>(.*?)<\/tfoot>/.exec(html)?.[1] ?? "";
    expect(body.match(/<tr/g)).toHaveLength(2);
    expect(foot.match(/<tr/g)).toHaveLength(3);
    expect(foot.indexOf("Итого к оплате")).toBeLessThan(foot.indexOf("Возврат клиенту"));
    expect(foot.indexOf("Возврат клиенту")).toBeLessThan(foot.lastIndexOf("Итого<"));
  });

  it("labels rows as row headers and writes every amount with the unit", () => {
    const html = render(h(SumsTable, { caption: "Итоги", unit: "сум", lines }));
    expect(html.match(/<th scope="row"/g)).toHaveLength(5);
    expect(html.match(/<data /g)).toHaveLength(5);
    expect(html).toContain(`26${NBSP}690${NBSP}000${NBSP}сум`);
    expect(html).toContain('<caption class="nv-sr">Итоги</caption>');
  });

  it("styles the refund and the total by modifier classes", () => {
    const html = render(h(SumsTable, { caption: "c", unit: "сум", lines }));
    expect(html).toContain("nv-sums__row--refund");
    expect(html).toContain("nv-sums__row--total");
    expect(html).toContain("nv-sums__row--subtotal");
  });

  it("renders an empty table without a footer", () => {
    const html = render(h(SumsTable, { caption: "c", unit: "сум", lines: [] }));
    expect(html).not.toContain("<tfoot");
  });

  it("refuses a duplicate row id: rows are keyed by it", () => {
    expect(() => SumsTable({ caption: "c", unit: "сум", lines: [lines[0] as never, lines[0] as never] })).toThrow(
      /duplicate/,
    );
  });

  it("refuses a fractional amount", () => {
    expect(() =>
      render(h(SumsTable, { caption: "c", unit: "сум", lines: [{ id: "x", label: "x", amount: 1.5 }] })),
    ).toThrow(RangeError);
  });
});

describe("Stamp (neutral, no business meaning)", () => {
  it("is a double frame with the word and the date or number", () => {
    const html = render(h(Stamp, { word: "Утверждено", meta: "05.10.2026 · 15:02" }));
    expect(html).toBe('<div class="nv-stamp-r"><span><b>Утверждено</b><em>05.10.2026 · 15:02</em></span></div>');
  });

  it("has a small form for the steps and a decorative mode for the screen readers", () => {
    const small = render(h(Stamp, { variant: "small", word: "Смета", meta: "05.10", decorative: true }));
    expect(small).toBe('<div class="nv-sstamp" aria-hidden="true"><b>Смета</b><i>05.10</i></div>');
  });

  it("works without meta", () => {
    expect(render(h(Stamp, { word: "Сдано" }))).not.toContain("<em>");
  });

  it("refuses a stamp without a word", () => {
    expect(() => Stamp({ word: "" })).toThrow(/word/);
  });

  it("carries no raw colors and no inline style: the ink color comes from the --stamp role", () => {
    const html = render(h(Stamp, { word: "Сдано", meta: "12.10.2026 · NV-0001" }));
    expect(html).not.toMatch(/style=|#[0-9a-f]{3,6}/i);
  });
});

describe("RoundStamp", () => {
  it("writes the ring text on a circle path and the date in the middle, with an accessible name", () => {
    const html = render(
      h(RoundStamp, {
        id: "rs",
        ring: "NIVEL · ТАШКЕНТ · ТЕСТ ПРОЙДЕН · 8 Ч ·",
        date: "10.10.2026",
        label: "Тест пройден",
      }),
    );
    expect(tag(html, "svg")).toContain('role="img"');
    expect(tag(html, "svg")).toContain('aria-label="Тест пройден"');
    expect(html).toContain('<path id="rs"');
    expect(html).toContain('href="#rs"');
    expect(html).toContain("NIVEL · ТАШКЕНТ · ТЕСТ ПРОЙДЕН · 8 Ч ·");
    expect(html).toContain(">10.10.2026</text>");
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("refuses an empty id or label", () => {
    expect(() => RoundStamp({ id: "", ring: "r", date: "d", label: "l" })).toThrow(/id/);
    expect(() => RoundStamp({ id: "x", ring: "r", date: "d", label: "" })).toThrow(/label/);
  });
});

describe("StampInkDefs", () => {
  it("defines the #ink filter once: uneven print by noise, no blur", () => {
    const html = render(h(StampInkDefs, {}));
    expect(html).toContain('<filter id="ink"');
    expect(html).toContain("feTurbulence");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/blur/i);
  });
});

describe("Tag and Badge (honesty marks)", () => {
  it("Tag is a mono bordered label", () => {
    expect(render(h(Tag, {}, "пример · не оферта"))).toBe('<span class="nv-tag">пример · не оферта</span>');
  });

  it("has the four plaques: demo, draft, visualization, sample", () => {
    expect([...badgeKinds]).toEqual(["demo", "draft", "visualization", "sample"]);
    const labels = { demo: "демо", draft: "черновик", visualization: "визуализация", sample: "образец" };
    for (const kind of badgeKinds) {
      const html = render(h(Badge, { kind, label: labels[kind] }));
      expect(html).toBe(`<span class="nv-badge nv-badge--${kind}" data-kind="${kind}">${labels[kind]}</span>`);
    }
  });

  it("takes the words from the caller: there is no default text to forget to translate", () => {
    expect(render(h(Badge, { kind: "demo", label: "demo" }))).toContain(">demo<");
    expect(render(h(Badge, { kind: "sample", label: "namuna" }))).toContain(">namuna<");
  });

  it("refuses a plaque without a label: the mark of honesty cannot be silently empty", () => {
    expect(() => Badge({ kind: "demo", label: "" })).toThrow(/label/);
    expect(() => Badge({ kind: "sample", label: "  " })).toThrow(/label/);
  });

  it("refuses an unknown kind", () => {
    expect(() => Badge({ kind: "promo" as never, label: "x" })).toThrow(/kind/);
  });

  it("requires the label at compile time", () => {
    // @ts-expect-error `label` is required
    expect(() => Badge({ kind: "demo" })).toThrow();
    // @ts-expect-error `kind` is required
    expect(() => Badge({ label: "x" })).toThrow();
  });
});

describe("Paper", () => {
  it("is the document surface: an article with a tilt option and room for the sample plate", () => {
    const html = render(
      h(Paper, { tilt: "left", badge: h(Badge, { kind: "sample", label: "образец" }) }, h("p", {}, "тело")),
    );
    expect(html).toContain('<article class="nv-paper nv-paper--tilt-left">');
    expect(html).toContain('<span class="nv-badge nv-badge--sample"');
    expect(html).toContain("<p>тело</p>");
    expect(render(h(Paper, {}, "x"))).toBe('<article class="nv-paper">x</article>');
    expect(render(h(Paper, { tilt: "right" }, "x"))).toContain("nv-paper--tilt-right");
  });
});

describe("components do not know the theme (switching is by data-theme only)", () => {
  const samples: ReactNode[] = [
    h(Button, { mark: true }, "Go"),
    h(TextField, { id: "a", label: "A", error: "e" }),
    h(Select, { id: "s", label: "S", options: [{ value: "1", label: "One" }] }),
    h(SumsTable, { caption: "c", unit: "сум", lines: [{ id: "1", label: "x", amount: 1, kind: "total" }] }),
    h(Stamp, { word: "Сдано", meta: "1" }),
    h(Badge, { kind: "visualization", label: "v" }),
    h(Paper, { badge: h(Badge, { kind: "sample", label: "s" }) }, "x"),
  ];

  it("emit no theme names, inline colors or style attributes", () => {
    for (const el of samples) {
      const html = render(el);
      expect(html).not.toMatch(/\b(day|night|dark|light)\b/i);
      expect(html).not.toMatch(/style=|rgba?\(|#[0-9a-f]{6}\b/i);
    }
  });

  it("findAll finds elements of a plain tree", () => {
    const tree = h("div", {}, h("p", {}, "a"), h("p", {}, h("span", {}, "b")));
    expect(findAll(tree, (e) => e.type === "p")).toHaveLength(2);
    expect(findAll(tree, (e) => e.type === "span")).toHaveLength(1);
    expect(findAll("text", () => true)).toHaveLength(0);
  });
});
