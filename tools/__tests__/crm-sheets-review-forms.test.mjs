// Review round 2, the forms of the sidebar: text of the sheet never becomes HTML, and the server takes from the client only
// the fields that the form declares (no «demo», «src», «number» or «status» smuggled in).

import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00");
let p;
const read = (k) => p.call("nvReadTable", k);

beforeAll(() => {
  p = createProject({ now: T0, scriptProps: { OWNER_EMAIL: "owner@example.com" } });
  p.call("nvSetup");
}, 60_000);

/** A very small fake of the DOM: it records every assignment to innerHTML and keeps the text nodes. */
function fakeDom() {
  const assigned = [];
  const all = [];
  const make = (tag) => {
    const el = {
      tag,
      children: [],
      attrs: {},
      _text: "",
      className: "",
      style: {},
      value: "",
      appendChild(c) {
        el.children.push(c);
        return c;
      },
      setAttribute(k, v) {
        el.attrs[k] = String(v);
      },
      addEventListener() {},
      get textContent() {
        return el._text + el.children.map((c) => c.textContent).join("");
      },
      set textContent(v) {
        el._text = String(v);
        el.children = [];
      },
      set innerHTML(v) {
        assigned.push(String(v));
      },
      get innerHTML() {
        return "";
      },
    };
    all.push(el);
    return el;
  };
  const byId = {};
  const document = {
    createElement: make,
    createTextNode: (t) => ({ tag: "#text", textContent: String(t), children: [] }),
    getElementById: (id) => (byId[id] ||= Object.assign(make("div"), { id })),
    addEventListener() {},
    elements: all,
  };
  return { document, assigned, all, byId };
}

describe("the panel «Действие по заказу» puts the text of the sheet into text nodes, never into HTML", () => {
  it("the code of the panel has no innerHTML at all", () => {
    const html = p.call("nvFormHtml", "action");
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("document.write");
  });

  it("a hostile status, event, check and placeholder stay text", () => {
    const html = p.call("nvFormHtml", "action");
    const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
    const dom = fakeDom();
    const sandbox = {
      document: dom.document,
      google: { script: { run: { withSuccessHandler: () => ({ nvOrderPanelInfo() {}, nvOrderPanelRun() {} }) } } },
      confirm: () => false,
      prompt: () => "",
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    const evil = '<img src=x onerror="alert(1)">';
    sandbox.show({
      status: evil,
      events: [{ code: "ACCEPT", label: evil, input: evil, violations: [evil, "<b>x</b>"] }],
    });
    expect(dom.assigned).toEqual([]);
    const text = dom.byId.panel.textContent;
    expect(text).toContain(evil);
    // the string is a text node: no element was made out of it
    expect(dom.all.some((e) => e.tag === "img")).toBe(false);
    expect(dom.all.some((e) => e.tag === "script")).toBe(false);
    const input = dom.all.find((e) => e.tag === "input");
    expect(input.attrs.placeholder).toBe(evil);
  });

  it("the result of an action is shown as text", () => {
    const html = p.call("nvFormHtml", "action");
    const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
    const dom = fakeDom();
    const sandbox = {
      document: dom.document,
      google: { script: { run: { withSuccessHandler: () => ({ nvOrderPanelInfo() {} }) } } },
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    sandbox.done({ ok: false, text: "<script>alert(1)</script>" });
    expect(dom.byId.msg.textContent).toBe("<script>alert(1)</script>");
    expect(dom.assigned).toEqual([]);
  });
});

describe("the server takes only the fields that the form declares", () => {
  it("a lead: demo, src, number, status, order and created are ignored", () => {
    const r = p.call("nvFormSubmit", "lead", {
      channel: "Сайт",
      scope: "ПК",
      name: "Форма",
      demo: true,
      src: "Платформа",
      number: "L-2026-9999",
      status: "В заказе",
      order: "NV-2026-0001",
      created: "2020-01-01",
      client: "K-0001",
    });
    expect(r.ok).toBe(true);
    const lead = read("leads").find((l) => l.name === "Форма");
    expect(lead.demo).toBe(false);
    expect(lead.src).toBe("Вручную");
    expect(lead.num).toMatch(/^L-2026-0001$/);
    expect(lead.status).toBe("Новая");
    expect(lead.order).toBe("");
    expect(new Date(lead.created).getTime()).toBe(T0.getTime());
  });

  it("a payment: the status «Подтверждён» of a fee still needs the receipt, and confirmedBy, src, reversal are ignored", () => {
    const num = p.call("nvCreateOrder", { kind: "ПК", basePc: 10_000_000, purchased: 10_000_000 });
    const bad = p.call("nvFormSubmit", "payment", {
      order: num,
      kind: "Аванс платы 30 %",
      method: "QR Xolis",
      amount: "900000",
      status: "Подтверждён",
    });
    expect(bad.ok).toBe(false);
    const ok = p.call("nvFormSubmit", "payment", {
      order: num,
      kind: "Аванс платы 30 %",
      method: "QR Xolis",
      amount: "900000",
      status: "Подтверждён",
      receipt: "FS-1",
      confirmedBy: "Платформа",
      src: "Платформа",
      demo: true,
      reversal: "P-2026-0001",
      voidReason: "x",
    });
    expect(ok.ok).toBe(true);
    const pay = read("payments").find((x) => x.order === num);
    expect(pay.confirmedBy).toBe("Владелец");
    expect(pay.src).toBe("Вручную");
    expect(pay.demo).toBe(false);
    expect(pay.reversal).toBe("");
  });

  it("a purchase and a warranty case: the same", () => {
    const num = p.call("nvCreateOrder", { kind: "ПК", basePc: 10_000_000, purchased: 10_000_000 });
    const r = p.call("nvFormSubmit", "purchase", {
      order: num,
      item: "Кабель",
      amount: "100000",
      receipt: "FS-9",
      src: "Платформа",
      demo: true,
      verified: true,
      boughtBy: "Помощник",
      esfStatus: "Подписана",
    });
    expect(r.ok).toBe(true);
    const pu = read("purchases").find((x) => x.item === "Кабель");
    expect(pu.src).toBe("Вручную");
    expect(pu.demo).toBe(false);
    expect(pu.verified).toBe(false);
    expect(pu.esfStatus).toBe("");
    const w = p.call("nvFormSubmit", "warranty", {
      order: num,
      desc: "Шумит",
      status: "Закрыт",
      src: "Платформа",
      demo: true,
    });
    expect(w.ok).toBe(true);
    const g = read("warranty").find((x) => x.desc === "Шумит");
    expect(g.status).toBe("Открыт");
    expect(g.src).toBe("Вручную");
    expect(g.demo).toBe(false);
  });

  it("the names that nvPickFields lets through are the fields the form shows", () => {
    for (const kind of ["lead", "convert", "payment", "purchase", "warranty", "action"]) {
      const shown = JSON.parse(p.run(`JSON.stringify(NV_FORMS.${kind}.fields().map((f) => f.name))`));
      const allowed = JSON.parse(p.run(`JSON.stringify(NV_FORMS.${kind}.names)`));
      expect(allowed.slice().sort(), kind).toEqual(shown.slice().sort());
    }
  });

  it("the list of fields of every form is what nvPickFields lets through", () => {
    const picked = p.call("nvPickFields", "lead", { channel: "Сайт", demo: true, __proto__x: 1, constructor: "x" });
    expect(Object.keys(picked)).toEqual(["channel"]);
    expect(p.call("nvPickFields", "nothing", { a: 1 })).toEqual({});
  });
});
