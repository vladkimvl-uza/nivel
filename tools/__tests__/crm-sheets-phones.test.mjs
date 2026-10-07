// The decision of the owner of 07.10.2026: «телефоны да». The phones of the clients are kept in the table (the sheet
// «Клиенты», typed by hand). No message of the script carries them: not the digest, not the urgent reminders, not the
// note of the monthly job. The README says where they are kept (Google, USA) and that the site must tell it.
import { beforeAll, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-11-04T11:00:00+05:00");
const PHONE = "+998901234567";
let p;
const read = (key) => p.call("nvReadTable", key);

beforeAll(() => {
  // No Telegram: every message of the script goes by mail, and the mock keeps it in env.mails
  p = createProject({ now: T0, scriptProps: { OWNER_EMAIL: "owner@example.com" } });
  p.call("nvSetup");
}, 60_000);

describe("the phones of the clients are kept in the table", () => {
  it("the sheet «Клиенты» has the column «Телефон» with the rule +998 and nine digits, and its caption says that the phone is kept", () => {
    const cols = JSON.parse(
      p.run("JSON.stringify(NV_SCHEMA.clients.cols.map((c) => [c.key, c.title, c.regex || null]))"),
    );
    expect(cols).toContainEqual(["phone", "Телефон", "^\\+998\\d{9}$"]);
    expect(p.run("NV_SCHEMA.clients.captionRight")).toContain("телефон");
  });

  it("a phone given with a client is kept as +998XXXXXXXXX, however it was written", () => {
    const code = p.call("nvEnsureClient", { name: "Тест", tg: "@phone_a", phone: "+998 (90) 123-45-67" });
    expect(read("clients").find((c) => c.code === code).phone).toBe(PHONE);
  });

  it("a phone typed into the cell of the sheet is brought to the same form and stays text", () => {
    const code = p.call("nvEnsureClient", { name: "Тест 2", tg: "@phone_b" });
    const row = read("clients").find((c) => c.code === code)._row;
    const keys = JSON.parse(p.run("JSON.stringify(NV_SCHEMA.clients.cols.map((c) => c.key))"));
    const range = p.env.ss.getSheetByName("Клиенты").getRange(row, 2 + keys.indexOf("phone"));
    range.setValue("+998 90 765 43 21");
    p.call("nvOnEdit", { range, value: "+998 90 765 43 21", oldValue: undefined, source: p.env.ss });
    const phone = read("clients").find((c) => c.code === code).phone;
    expect(phone).toBe("+998907654321");
    expect(typeof phone).toBe("string");
  });
});

describe("no message to the owner carries a phone", () => {
  it("the digest, the urgent reminders and the note of the monthly job hold no phone, no name, no nick", () => {
    const code = p.call("nvEnsureClient", { name: "Секретный Клиент", tg: "@secret_one", phone: PHONE });
    expect(read("clients").find((c) => c.code === code).phone).toBe(PHONE);
    // a lead of the same person that nobody has answered for more than a year, and a task of the sheet «Сегодня»
    // about it (its «Клиент» cell holds the phone, as the formulas would put it)
    const num = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Секретный Клиент", tg: "@secret_one" });
    const lead = read("leads").find((l) => l.num === num);
    p.ctx.__set = { created: p.date("2025-09-01T10:00:00+05:00") };
    p.run(`nvWriteCells("leads", ${lead._row}, __set)`);
    const today = p.env.ss.getSheetByName("Сегодня");
    ["04.11.2026", `Позвонить ${PHONE}`, num, 0, "Сегодня", "Заявка", PHONE, "next_step"].forEach((v, j) => {
      today._cell(6, 2 + j).v = v;
    });

    p.env.mails.length = 0;
    expect(p.call("nvDailyDigest", { force: true }).sent).toBe(true);
    expect(p.call("nvHourlyJob", { force: true }).reminders).toBeGreaterThanOrEqual(1);
    expect(p.call("nvMonthlyJob").stale).toBeGreaterThanOrEqual(1);
    expect(p.env.mails.length).toBeGreaterThanOrEqual(3);
    const all = p.env.mails.map((m) => `${m.subject}\n${m.body}`).join("\n");
    for (const secret of [PHONE, "901234567", "Секретный", "@secret_one"]) expect(all).not.toContain(secret);
  });
});
