// Review round 2 of the CRM book: every finding of the review has a test here that failed before the fix.
// The mock of Apps Script is strict on the points the review found (the colour object of the theme, the depth of column
// groups, the encoding of text under HMAC, text of lock errors, the userinfo.email scope, a missing UI, cache limits).
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "crm-sheets", "src");
const T0 = new Date("2026-10-07T11:00:00+05:00"); // Wednesday, working hours
const SECRET = "dGVzdC1rZXktbm90LWEtcmVhbC1zZWNyZXQ="; // gitleaks:allow test value, not a secret
const manifest = JSON.parse(readFileSync(join(SRC, "appsscript.json"), "utf8"));

let p;
let ss;
const sheet = (n) => ss.getSheetByName(n);
const colOf = (key, col) =>
  2 + JSON.parse(p.run(`JSON.stringify(NV_SCHEMA.${key}.cols.map((c) => c.key))`)).indexOf(col);
const read = (key) => p.call("nvReadTable", key);
const find = (key, field, value) => read(key).find((r) => r[field] === value);

/** A user's edit of one cell: the cell gets the value and the installable trigger runs. */
function edit(sheetName, row, col, value, oldValue) {
  const sh = sheet(sheetName);
  const range = sh.getRange(row, col);
  const old = oldValue === undefined ? range.getValue() : oldValue;
  range.setValue(value);
  p.call("nvOnEdit", { range, value, oldValue: old === "" ? undefined : old, source: ss });
  return range;
}

function newProject(o = {}) {
  const q = createProject({
    now: T0,
    scriptProps: { OWNER_EMAIL: "owner@example.com", NIVEL_HMAC_SECRET: SECRET },
    ...o,
  });
  q.call("nvSetup");
  return q;
}

/** Writes a value into the cell of a setting of a project (the way the owner does it). */
function setSetting(q, key, value) {
  const layout = JSON.parse(q.run("JSON.stringify(nvSettingsLayout().map((x) => ({ k: x.def.key, row: x.row })))"));
  const row = layout.find((x) => x.k === key).row;
  q.env.ss.getSheetByName("Настройки").getRange(row, 3).setValue(value);
  q.call("nvResetSettingsCache");
}

/** An accepted order that cannot start the purchase: no advance and no money. */
function acceptedOrder(tag) {
  const client = p.call("nvEnsureClient", { name: `Клиент ${tag}`, tg: `@c_${tag}` });
  const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 });
  const row = find("orders", "num", num)._row;
  p.run(`nvWriteCells("orders", ${row}, { status: "Принят: ждём оплату", code: "accepted", dAccepted: new Date() })`);
  p.call("nvRefreshOrderActions", num);
  return { num, row };
}

beforeAll(() => {
  p = newProject();
  ss = p.env.ss;
}, 120_000);

beforeEach(() => {
  p.env.now = T0;
  p.env.uiAvailable = true;
  p.env.lockHeldElsewhere = false;
  p.env.locked = false;
  p.env.alertAnswers.length = 0;
  p.env.promptAnswers.length = 0;
  p.env.dialogsUnderLock.length = 0;
  p.env.cache.clear();
  p.env.logs.length = 0;
});

describe("blocking 1: the setup of the book works with the real signature of setConcreteColor", () => {
  it("nvSetup finishes and the six colours of the theme are those of the brand", () => {
    expect(ss.themeColors.ACCENT1).toBe("#D9501A");
    expect(ss.themeColors.ACCENT6).toBe("#F06A30");
    expect(ss.themeFont).toBe("Fira Sans");
  });

  it("the mock refuses a hex string, accepts a Color object and three integers", () => {
    const theme = ss.getSpreadsheetTheme();
    expect(() => theme.setConcreteColor("ACCENT1", "#D9501A")).toThrow(/don't match the method signature/);
    expect(() => theme.setConcreteColor("ACCENT1", 217, 80, 26)).not.toThrow();
    expect(() => theme.setConcreteColor("ACCENT1", 300, 80, 26)).toThrow();
    const color = p.run('SpreadsheetApp.newColor().setRgbColor("#1D1D1B").build()');
    expect(() => theme.setConcreteColor("ACCENT2", color)).not.toThrow();
    expect(ss.themeColors.ACCENT2).toBe("#1D1D1B");
  });

  it("a font of the theme that Google refuses does not stop the setup", () => {
    const q = createProject({ now: T0 });
    q.env.ss.getSpreadsheetTheme = () => ({
      setFontFamily() {
        throw new Error("Exception: font is not in the list of the theme");
      },
      setConcreteColor() {
        return this;
      },
    });
    expect(() => q.call("nvApplyBookTheme")).not.toThrow();
    expect(q.env.logs.join("\n")).toContain("Шрифт темы не принят");
  });
});

describe("blocking 2: styling again does not nest the column groups deeper", () => {
  const depths = () => {
    const sh = sheet("Заказы");
    const cols = JSON.parse(p.run("JSON.stringify(NV_SCHEMA.orders.cols.map((c) => c.grp || ''))"));
    return cols.map((g, i) => (g ? sh.getColumnGroupDepth(2 + i) : 0));
  };

  it("after the setup every grouped column has depth 1 and the others 0", () => {
    const d = depths();
    expect(Math.max(...d)).toBe(1);
    expect(d.filter((x) => x === 1).length).toBeGreaterThan(30);
  });

  it("twelve re-styles and six theme switches leave the depth at 1 and the theme still switches", () => {
    for (let i = 0; i < 12; i++) p.call("nvRestyle");
    for (let i = 0; i < 3; i++) {
      p.call("nvSetTheme", "night", "all");
      p.call("nvSetTheme", "passport", "all");
    }
    expect(Math.max(...depths())).toBe(1);
    expect(p.env.docProps.get("NV_THEME_DATA")).toBe("passport");
  });

  it("the mock gives the depth only through getColumnGroupDepth and refuses a depth above 8", () => {
    const sh = sheet("Клиенты");
    expect(sh.getColumnGroupDepth(3)).toBe(0);
    for (let i = 0; i < 8; i++) sh.getRange(1, 3, 1, 2).shiftColumnGroupDepth(1);
    expect(sh.getColumnGroupDepth(3)).toBe(8);
    expect(() => sh.getRange(1, 3, 1, 2).shiftColumnGroupDepth(1)).toThrow(/depth/);
    sh.getRange(1, 3, 1, 2).shiftColumnGroupDepth(-8);
  });

  it("the sources use only what Apps Script has: no internal field of the mock is read", () => {
    const internal = [
      "colGroups",
      "_groupDepth",
      "collapsedCols",
      "colW",
      "rowH",
      "hiddenCols",
      "hiddenRows",
      "frozenRows",
      "frozenCols",
      "hiddenGrid",
      "sheetProtection",
      "themeColors",
      "themeFont",
      "activeSheet",
      "onTouch",
      "dialogsUnderLock",
      "lockEvents",
      "scriptProps",
      "docProps",
      "userProps",
    ];
    const bad = [];
    for (const f of readdirSync(SRC).filter((x) => x.endsWith(".js"))) {
      const text = readFileSync(join(SRC, f), "utf8");
      for (const name of internal) if (new RegExp(`\\.${name}\\b`).test(text)) bad.push(`${f}: .${name}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("blocking 3: text under HMAC and digest names its encoding (UTF-8)", () => {
  const body = JSON.stringify({ name: "Дилшод", note: "Ёлка · №1 — тест 🙂" });
  it("the HMAC of a Cyrillic body is the one the platform makes from UTF-8 bytes", () => {
    const ts = "1790000000";
    const expected = createHmac("sha256", SECRET).update(`${ts}.${body}`, "utf8").digest("hex");
    expect(p.call("nvHmacHex", SECRET, `${ts}.${body}`)).toBe(expected);
  });

  it("the digest of the journal is SHA-256 of UTF-8", () => {
    const hash = p.call("nvSha256Hex16", body);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("the mock refuses the HMAC and the digest of a text without Utilities.Charset.UTF_8", () => {
    const gas = p.gas.globals;
    expect(() => gas.Utilities.computeHmacSha256Signature("текст", SECRET)).toThrow(/UTF_8/);
    expect(() => gas.Utilities.computeDigest("SHA_256", "текст")).toThrow(/UTF_8/);
    expect(() => gas.Utilities.computeHmacSha256Signature("текст", SECRET, "UTF_8")).not.toThrow();
  });
});

describe("scopes of the manifest", () => {
  it("has userinfo.email, which the separation of the owner and the assistant needs", () => {
    expect(manifest.oauthScopes).toContain("https://www.googleapis.com/auth/userinfo.email");
  });

  it("lists the advanced service of Sheets for the filter views", () => {
    const svc = manifest.dependencies?.enabledAdvancedServices ?? [];
    expect(svc.some((s) => s.serviceId === "sheets" && s.version === "v4")).toBe(true);
  });

  it("nothing is requested twice and every scope is a Google scope", () => {
    expect(new Set(manifest.oauthScopes).size).toBe(manifest.oauthScopes.length);
    for (const s of manifest.oauthScopes) expect(s).toMatch(/^https:\/\/www\.googleapis\.com\/auth\//);
  });
});

describe("the owner and the assistant", () => {
  it("another e-mail than OWNER_EMAIL is the assistant", () => {
    p.env.userEmail = "helper@example.com";
    expect(p.call("nvActor")).toBe("assistant");
    p.env.userEmail = "owner@example.com";
    expect(p.call("nvActor")).toBe("owner");
  });

  it("an empty address with OWNER_EMAIL set is the assistant: money events are forbidden", () => {
    p.env.userEmail = "";
    expect(p.call("nvActor")).toBe("assistant");
    const { num } = acceptedOrder("empty-mail");
    const r = p.call("nvApplyOrderEvent", num, "START_PURCHASE", { actor: p.call("nvActor") });
    expect(r.error).toBe("actor_not_allowed");
    p.env.userEmail = "owner@example.com";
  });

  it("without the scope the address cannot be read: the code does not pretend to be the owner", () => {
    const q = createProject({
      now: T0,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      scriptProps: { OWNER_EMAIL: "owner@example.com" },
    });
    expect(q.call("nvActor")).toBe("assistant");
  });

  it("without OWNER_EMAIL everyone is the owner (a book of one person)", () => {
    const q = createProject({ now: T0, userEmail: "" });
    expect(q.call("nvActor")).toBe("owner");
  });
});

describe("dialogs are never open while the script lock is held", () => {
  it("a forced event: the questions are asked outside the lock, the change is applied under it", () => {
    const { num, row } = acceptedOrder("dlg");
    p.env.alertAnswers.push("YES");
    p.env.promptAnswers.push("Клиент подтвердил по телефону");
    edit("Заказы", row, colOf("orders", "action"), "Начать закупку");
    expect(p.env.dialogsUnderLock).toEqual([]);
    expect(p.env.alerts.at(-1).title).toBe("Не выполнено");
    expect(find("orders", "num", num).code).toBe("purchasing");
    const h = read("history")
      .filter((x) => x.num === num)
      .at(-1);
    expect(h.how).toBe("Принудительно");
    expect(h.reason).toContain("Клиент подтвердил по телефону");
  });

  it("an event that needs a text: the prompt is outside the lock", () => {
    const { num, row } = acceptedOrder("prm");
    p.run(
      `nvWriteCells("orders", ${row}, { status: "Смета отправлена", code: "estimate_sent", validUntil: new Date(Date.now() + 3600000) })`,
    );
    p.call("nvRefreshOrderActions", num);
    p.env.alertAnswers.push("YES");
    p.env.promptAnswers.push("https://t.me/c/1/1", "причина");
    edit("Заказы", row, colOf("orders", "action"), "Клиент принял");
    expect(p.env.dialogsUnderLock).toEqual([]);
    expect(find("orders", "num", num).code).toBe("accepted");
  });

  it("a manual change of a platform field: the question is outside the lock", () => {
    const num = p.call(
      "nvCreateOrder",
      { kind: "ПК", basePc: 9_000_000, purchased: 9_000_000 },
      { src: "Платформа", number: "NV-2026-0777", seq: 1 },
    );
    const row = find("orders", "num", num)._row;
    p.env.alertAnswers.push("YES");
    edit("Заказы", row, colOf("orders", "basePc"), 9_500_000, 9_000_000);
    expect(p.env.dialogsUnderLock).toEqual([]);
    expect(p.env.alerts.at(-1).title).toBe("Поле платформы");
    expect(find("orders", "num", num).basePc).toBe(9_500_000);
  });

  it("a refused change of a platform field goes back, and the owner is told why", () => {
    const row = find("orders", "num", "NV-2026-0777")._row;
    p.env.alertAnswers.push("NO");
    edit("Заказы", row, colOf("orders", "basePc"), 7_000_000, 9_500_000);
    expect(find("orders", "num", "NV-2026-0777").basePc).toBe(9_500_000);
  });

  it("a platform field edited where no dialog can be shown goes back with a visible reason", () => {
    const row = find("orders", "num", "NV-2026-0777")._row;
    p.env.uiAvailable = false;
    edit("Заказы", row, colOf("orders", "basePc"), 7_000_000, 9_500_000);
    expect(find("orders", "num", "NV-2026-0777").basePc).toBe(9_500_000);
    expect(p.env.ss.toasts.at(-1).msg).toContain("платформа");
  });
});

describe("the busy lock is recognised by the lock, not by the words of an error", () => {
  it("nvWithLock throws an error that carries the mark nvLock when the lock is busy", () => {
    p.env.lockHeldElsewhere = true;
    const err = p.run(
      "(() => { try { nvWithLock(() => 1, 1); } catch (e) { return { lock: e.nvLock === true, text: String(e.message) }; } return null; })()",
    );
    expect(err.lock).toBe(true);
    expect(/lock/i.test(err.text)).toBe(false);
  });

  it("the hourly job, the digest and the forms do not crash on a busy lock", () => {
    p.env.lockHeldElsewhere = true;
    p.env.now = new Date("2026-10-07T12:00:00+05:00");
    const r = p.call("nvHourlyJob");
    expect(r.busy).toBe(true);
  });

  it("the edit trigger tells the owner that the book is busy and does not throw", () => {
    p.env.lockHeldElsewhere = true;
    expect(() => edit("Клиенты", 40, colOf("clients", "name"), "Занято")).not.toThrow();
    expect(p.env.ss.toasts.at(-1).msg).toMatch(/занят|повтор/i);
  });
});

describe("the token of the Telegram bot never reaches a log", () => {
  it("an error of UrlFetchApp that carries the address is cut before it is logged", () => {
    const token = "123456789:AAH-test_token_not_real_value_0123456789"; // gitleaks:allow test value, not a secret
    const q = createProject({
      now: T0,
      scriptProps: { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: "42", OWNER_EMAIL: "owner@example.com" },
      fetchHandler: (url) => {
        throw new Error(`Exception: DNS error: ${url}`);
      },
    });
    const r = q.call("nvNotifyOwner", "проверка");
    expect(r.ok).toBe(true);
    expect(r.via).toBe("mail");
    const logged = q.env.logs.join("\n");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("AAH-test");
    expect(logged).toContain("Telegram");
  });
});

describe("the setup survives the limit of six minutes", () => {
  it("the number of a step is saved before the step starts, and a timer that continues it is armed", () => {
    const q = createProject({ now: T0 });
    q.run(
      "globalThis.__real = nvBuildDict; nvBuildDict = () => { throw new Error('Exceeded maximum execution time'); };",
    );
    expect(() => q.call("nvSetup")).toThrow(/Exceeded/);
    const step = Number(q.env.docProps.get("NV_SETUP_STEP"));
    const names = JSON.parse(q.run("JSON.stringify(nvSetupSteps().map((s) => s[0]))"));
    expect(names[step]).toBe("Справочники");
    expect(q.env.triggers.filter((t) => t.handler === "nvSetupContinue")).toHaveLength(1);
  });

  it("the budget is 180 seconds, not 270", () => {
    expect(p.run("NV_SETUP_BUDGET_MS")).toBe(180000);
  });

  it("a start from the menu continues from the saved step when it is fresh, and starts again when it is old", () => {
    const q = createProject({ now: T0 });
    q.call("nvSetup", { budgetMs: 0 });
    expect(Number(q.env.docProps.get("NV_SETUP_STEP"))).toBe(1);
    q.call("nvMenuSetup");
    expect(q.env.docProps.get("NV_SETUP_STEP")).toBeUndefined();
    expect(q.env.triggers.filter((t) => t.handler === "nvSetupContinue")).toHaveLength(0);
    expect(q.env.ss.getSheetByName("Панель")).toBeTruthy();
    // an old trace of a stopped run is not resumed: the run starts from the first step
    q.env.docProps.set("NV_SETUP_STEP", "9");
    q.env.docProps.set("NV_SETUP_STEP_AT", String(T0.getTime() - 3 * 3600000));
    q.call("nvMenuSetup");
    expect(q.env.docProps.get("NV_SETUP_STEP")).toBeUndefined();
  });
});

describe("the quota of the triggers: fewer reads of the sheets", () => {
  it("inside one execution a table is read once, and a write makes the next read fresh", () => {
    const before = p.env.reads;
    const out = p.run(`nvCached(() => {
      const a = nvReadTable("clients").length;
      const b = nvReadTable("clients").length;
      nvAppendRow("clients", { code: "K-9001", name: "Кэш", firstContact: new Date() });
      const c = nvReadTable("clients").length;
      return [a, b, c];
    })`);
    expect(out[1]).toBe(out[0]);
    expect(out[2]).toBe(out[0] + 1);
    const reads = p.env.reads - before;
    expect(reads).toBeLessThanOrEqual(6);
  });

  it("outside the table cache a read always sees the sheet as it is", () => {
    const n = read("clients").length;
    p.run('nvAppendRow("clients", { code: "K-9002", name: "Без кэша", firstContact: new Date() })');
    expect(read("clients").length).toBe(n + 1);
  });

  it("the hourly job outside the hours of reply reads no sheet", () => {
    for (const iso of ["2026-10-07T03:00:00+05:00", "2026-10-07T22:30:00+05:00", "2026-10-11T12:00:00+05:00"]) {
      p.env.now = new Date(iso);
      const before = p.env.reads;
      const r = p.call("nvHourlyJob");
      expect(r.skipped, iso).toBe(true);
      expect(p.env.reads - before, iso).toBe(0);
    }
  });
});

describe("the freshness of the stamp of the webhook is limited from above", () => {
  function post(skewSetting, ageSec) {
    const q = newProject();
    setSetting(q, "hmacSkewSec", skewSetting);
    const nowMs = q.env.now.getTime();
    const ts = String(Math.floor(nowMs / 1000) - ageSec);
    const body = JSON.stringify({
      v: 1,
      id: "0198a000-0000-7000-8000-000000000001",
      type: "lead.created",
      env: "production",
      sent_at: new Date(Number(ts) * 1000).toISOString(),
      data: {},
    });
    const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
    const out = q.call("doPost", { postData: { contents: body }, parameter: { v: "1", ts, sig } });
    return JSON.parse(out.getContent());
  }
  it("999999 s in the sheet does not switch the check off: 301 s old is stale", () => {
    expect(post(999999, 301).error).toBe("stale");
  });
  it("a value below 60 is raised to 60", () => {
    expect(post(5, 59).error).not.toBe("stale");
    expect(post(5, 61).error).toBe("stale");
  });
});
