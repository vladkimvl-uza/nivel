// Review round 2, the webhook: the journal and the idempotency under one lock, limits of the fields, an event that is
// applied whole or not at all, a repeatable «internal» error, the purchase and payment events.
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00");
const SECRET = "dGVzdC1rZXktbm90LWEtcmVhbC1zZWNyZXQ="; // gitleaks:allow test value, not a secret

function newProject() {
  const q = createProject({
    now: T0,
    scriptProps: { OWNER_EMAIL: "owner@example.com", NIVEL_HMAC_SECRET: SECRET },
  });
  q.call("nvSetup");
  return q;
}

const iso5 = (ms) => `${new Date(ms + 5 * 3600000).toISOString().slice(0, 19)}+05:00`;
let seqN = 0;
function signed(q, type, data, o = {}) {
  seqN += 1;
  const nowMs = q.env.now.getTime();
  const ts = String(o.ts ?? Math.floor(nowMs / 1000));
  const envelope = {
    v: 1,
    id: o.id ?? `0198b000-0000-7000-8000-${String(seqN).padStart(12, "0")}`,
    type,
    env: "production",
    source: "nivel-platform",
    occurred_at: iso5(nowMs),
    sent_at: iso5(Number(ts) * 1000),
    data,
  };
  const body = o.body ?? JSON.stringify(envelope);
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`, "utf8").digest("hex");
  return { envelope, e: { postData: { contents: body, type: "application/json" }, parameter: { v: "1", ts, sig } } };
}
const post = (q, req) => JSON.parse(q.call("doPost", req.e).getContent());
const table = (q, key) => q.call("nvReadTable", key);
const blank = (v) => v === null || v === undefined || String(v).trim() === "";

describe("the journal and the memory of the idempotency", () => {
  let q;
  beforeAll(() => {
    q = newProject();
  }, 60_000);

  it("the row of the journal is written by the same lock that applies the event", () => {
    const heldAtWrite = [];
    q.env.ss.onTouch = (sh) => {
      if (sh.getName() === "Журнал вебхука") heldAtWrite.push(q.env.locked);
    };
    const lead = {
      number: "L-2026-0900",
      created_at: "2026-10-07T10:50:00+05:00",
      channel: "bot",
      scope: "pc",
      customer: { ref: "0198a111-2222-7333-8444-555566667700", display_name: "Тест", telegram_username: "@t_a" },
    };
    expect(post(q, signed(q, "lead.created", lead)).result).toBe("applied");
    q.env.ss.onTouch = null;
    expect(heldAtWrite.length).toBeGreaterThan(0);
    expect(heldAtWrite.every((x) => x === true)).toBe(true);
  });

  it("an id that is not 8-64 letters, digits, _ or - is refused before anything is applied (the cache key cannot overflow)", () => {
    const data = { number: "L-2026-0901", channel: "bot", scope: "pc" };
    for (const id of [
      "short",
      "x".repeat(65),
      "x".repeat(300),
      "id with space",
      "ид-кириллицей-1234",
      "a/b/c/d/e/f/g/h",
    ]) {
      const before = table(q, "leads").length;
      const r = post(q, signed(q, "lead.created", data, { id }));
      expect(r.ok, id).toBe(false);
      expect(r.error, id).toBe("bad_payload");
      expect(r.id, id).toBeNull();
      expect(table(q, "leads").length).toBe(before);
    }
  });

  it("a type, a number and a text field above the limit are refused, and a long text never reaches a sheet in full", () => {
    expect(post(q, signed(q, "x".repeat(60), {})).error).toBe("bad_payload");
    expect(
      post(q, signed(q, "lead.created", { number: `L-2026-${"9".repeat(40)}`, channel: "bot", scope: "pc" })).error,
    ).toBe("bad_payload");
    const long = "я".repeat(5000);
    const r = post(
      q,
      signed(q, "lead.created", {
        number: "L-2026-0902",
        channel: "bot",
        scope: "pc",
        district: long,
        configuration_code: long,
        customer: { ref: "0198a111-2222-7333-8444-555566667702", display_name: long, telegram_username: long },
      }),
    );
    expect(r.ok).toBe(true);
    const lead = table(q, "leads").find((l) => l.num === "L-2026-0902");
    expect(lead.name.length).toBeLessThanOrEqual(100);
    expect(lead.district.length).toBeLessThanOrEqual(60);
    for (const row of table(q, "webhook")) expect(String(row.summary).length).toBeLessThanOrEqual(200);
  });

  it("an event with a Cyrillic text is signed over UTF-8 bytes and accepted", () => {
    const r = post(
      q,
      signed(q, "lead.created", {
        number: "L-2026-0903",
        channel: "bot",
        scope: "pc",
        customer: {
          ref: "0198a111-2222-7333-8444-555566667703",
          display_name: "Ёжик · №5 — тест",
          telegram_username: "@yozh",
        },
      }),
    );
    expect(r.ok).toBe(true);
    expect(table(q, "leads").find((l) => l.num === "L-2026-0903").name).toBe("Ёжик · №5 — тест");
  });
});

describe("order.status_changed is all or nothing, and a failure can be repeated", () => {
  let q;
  const order = (num, seq, o = {}) => ({
    number: num,
    lead_number: null,
    customer_ref: "0198a111-2222-7333-8444-555566668800",
    kind: "pc",
    seq,
    from: null,
    to: "estimate_draft",
    event: null,
    actor: "owner",
    at: "2026-10-07T10:00:00+05:00",
    quote: {
      pc_base: 10_000_000,
      mount_base: 0,
      outside_scale_sum: 0,
      purchased_by_ip: 10_000_000,
      memory_ssd: 0,
      reserve_sum: 300_000,
    },
    ledger: [],
    ...o,
  });
  beforeAll(() => {
    q = newProject();
  }, 60_000);

  it("a bad fund of the ledger refuses the event before the first write: no order, no client, no history", () => {
    const orders = table(q, "orders").length;
    const clients = table(q, "clients").length;
    const history = table(q, "history").length;
    const reserves = table(q, "reserves").length;
    const r = post(
      q,
      signed(q, "order.status_changed", order("NV-2026-0800", 1, { ledger: [{ fund: "banana", amount: 1000 }] })),
    );
    expect(r.error).toBe("bad_payload");
    expect(table(q, "orders").length).toBe(orders);
    expect(table(q, "clients").length).toBe(clients);
    expect(table(q, "history").length).toBe(history);
    expect(table(q, "reserves").length).toBe(reserves);
  });

  it("the corrected event with the same seq is applied, not taken for a stale one", () => {
    const r = post(
      q,
      signed(q, "order.status_changed", order("NV-2026-0800", 1, { ledger: [{ fund: "warranty", amount: 150_000 }] })),
    );
    expect(r.result).toBe("applied");
    const row = table(q, "orders").find((o) => o.num === "NV-2026-0800");
    expect(row.seq).toBe(1);
    expect(table(q, "reserves").filter((x) => x.ref === "NV-2026-0800")).toHaveLength(1);
  });

  it("an amount that is not a whole sum is refused", () => {
    const bad = order("NV-2026-0801", 1);
    bad.quote.pc_base = 10_000_000.5;
    expect(post(q, signed(q, "order.status_changed", bad)).error).toBe("bad_payload");
  });

  it("a failure of Sheets in the middle of a write is answered «internal» (repeat), and the repeat applies everything", () => {
    const ev = order("NV-2026-0802", 1, { ledger: [{ fund: "tax_risk", amount: 100_000 }] });
    const req = signed(q, "order.status_changed", ev);
    let armed = true;
    q.env.ss.onTouch = (sh) => {
      if (armed && sh.getName() === "Резервы") {
        armed = false;
        throw new Error("Service Spreadsheets timed out while accessing document with id x");
      }
    };
    const first = post(q, req);
    q.env.ss.onTouch = null;
    expect(first).toEqual({ ok: false, id: req.envelope.id, result: null, error: "internal" });
    // the journal says what happened, and does not count the id as handled
    const jr = table(q, "webhook").filter((r) => r.eventId === req.envelope.id);
    expect(jr.map((r) => r.error)).toEqual(["internal"]);
    // the platform repeats the same event with the same id
    const second = post(q, req);
    expect(second.result).toBe("applied");
    const row = table(q, "orders").find((o) => o.num === "NV-2026-0802");
    expect(row.seq).toBe(1);
    expect(row.code).toBe("estimate_draft");
    expect(table(q, "reserves").filter((x) => x.ref === "NV-2026-0802")).toHaveLength(1);
    expect(table(q, "history").filter((h) => h.eventId === req.envelope.id)).toHaveLength(1);
    // and a third repeat is a duplicate
    expect(post(q, req).result).toBe("duplicate");
  });

  it("a failure after the order was created, before the status was written, is repaired by the repeat (the seq is written last)", () => {
    const ev = order("NV-2026-0803", 4, { to: "estimate_sent", from: "estimate_draft", event: "SEND_ESTIMATE" });
    const req = signed(q, "order.status_changed", ev);
    let armed = true;
    q.env.ss.onTouch = (sh) => {
      if (armed && sh.getName() === "История" && table(q, "orders").some((o) => o.num === "NV-2026-0803")) {
        armed = false;
        throw new Error("Service Spreadsheets timed out");
      }
    };
    expect(post(q, req).error).toBe("internal");
    q.env.ss.onTouch = null;
    const mid = table(q, "orders").find((o) => o.num === "NV-2026-0803");
    expect(mid).toBeTruthy();
    expect(blank(mid.seq)).toBe(true);
    const second = post(q, req);
    expect(second.result).toBe("applied");
    const row = table(q, "orders").find((o) => o.num === "NV-2026-0803");
    expect(row.seq).toBe(4);
    expect(row.code).toBe("estimate_sent");
  });

  it("a busy lock still answers «locked»; the same event is applied when the platform repeats it", () => {
    const req = signed(q, "lead.created", { number: "L-2026-0950", channel: "bot", scope: "pc" });
    q.env.lockHeldElsewhere = true;
    expect(post(q, req).error).toBe("locked");
    q.env.lockHeldElsewhere = false;
    expect(post(q, req).result).toBe("applied");
  });
});

describe("purchase.recorded", () => {
  let q;
  beforeAll(() => {
    q = newProject();
  }, 60_000);
  const purchase = (id, o = {}) => ({
    purchase_id: id,
    order_number: "NV-2026-0810",
    title: "Видеокарта",
    category_code: "gpu",
    vendor_name: "Мир компьютеров на Чиланзаре",
    qty: 1,
    amount_sum: 5_000_000,
    paid_via: "bank_transfer",
    receipt_kind: "fiscal",
    receipt_no: "FS-77",
    bought_at: "2026-10-07T10:00:00+05:00",
    ...o,
  });

  it("the Latin category code of the platform is mapped to the label of the sheet; every code of the catalog has one", () => {
    expect(post(q, signed(q, "purchase.recorded", purchase("Z-2026-0810"))).result).toBe("applied");
    const row = table(q, "purchases").find((x) => x.id === "Z-2026-0810");
    expect(row.category).toBe("Видеокарта");
    const codes = [
      "cpu",
      "mb",
      "ram",
      "ssd",
      "gpu",
      "psu",
      "case",
      "cooler_air",
      "aio",
      "fan",
      "monitor",
      "arm",
      "desk",
      "desk_frame",
      "desk_top",
      "chair",
      "keyboard",
      "mouse",
      "mousepad",
      "headset",
      "microphone",
      "webcam",
      "light",
      "speakers",
      "acoustic_panel",
      "cable_mgmt",
      "ups",
      "decor",
      "os_license",
    ];
    const dict = JSON.parse(q.run("JSON.stringify(NV_CATEGORIES)"));
    for (const c of codes) expect(dict, c).toContain(q.call("nvCategoryLabel", c));
    expect(q.call("nvCategoryLabel", "something_new")).toBe("Другое");
  });

  it("the shop is free text and the column accepts it (the list «Магазин 1-3» is a hint)", () => {
    const row = table(q, "purchases").find((x) => x.id === "Z-2026-0810");
    expect(row.shop).toBe("Мир компьютеров на Чиланзаре");
    const idx = JSON.parse(q.run("JSON.stringify(NV_SCHEMA.purchases.cols.map((c) => c.key))")).indexOf("shop");
    const dv = q.env.ss.getSheetByName("Закупки")._cell(6, 2 + idx).dv;
    expect(dv.allowInvalid).toBe(true);
  });

  it("a document «ЭСФ» without a number starts the term of the signing", () => {
    post(
      q,
      signed(q, "purchase.recorded", purchase("Z-2026-0811", { receipt_kind: "esf", receipt_no: null, esf_no: null })),
    );
    const row = table(q, "purchases").find((x) => x.id === "Z-2026-0811");
    expect(row.docKind).toBe("ЭСФ");
    expect(row.esfStatus).toBe("Ожидается");
  });
});

describe("payment.confirmed never counts a pair that is not allowed", () => {
  let q;
  beforeAll(() => {
    q = newProject();
  }, 60_000);
  const payment = (id, o = {}) => ({
    payment_id: id,
    order_number: "NV-2026-0820",
    kind: "purchase_funds",
    direction: "in",
    method: "xolis_qr",
    amount_sum: 12_000_000,
    status: "confirmed",
    fiscal_receipt_no: "FS-1",
    occurred_at: "2026-10-07T10:00:00+05:00",
    confirmed_at: "2026-10-07T10:05:00+05:00",
    payer_is_customer: true,
    ...o,
  });

  it("money for the purchase through QR Xolis is written as «Ожидается», the owner is told, and nothing is counted", () => {
    const req = signed(q, "payment.confirmed", payment("P-2026-0820"));
    const r = post(q, req);
    expect(r.ok).toBe(true);
    const row = table(q, "payments").find((x) => x.id === "P-2026-0820");
    expect(row.status).toBe("Ожидается");
    expect(blank(row.confirmedAt)).toBe(true);
    const j = table(q, "webhook").find((x) => x.eventId === req.envelope.id);
    expect(j.summary).toContain("ПРОВЕРКА");
    expect(q.env.mails.length + q.env.fetches.length).toBeGreaterThan(0);
  });

  it("a fee without the fiscal receipt is written as «Ожидается» too", () => {
    const r = post(
      q,
      signed(
        q,
        "payment.confirmed",
        payment("P-2026-0821", { kind: "fee_advance", method: "xolis_qr", fiscal_receipt_no: null }),
      ),
    );
    expect(r.ok).toBe(true);
    expect(table(q, "payments").find((x) => x.id === "P-2026-0821").status).toBe("Ожидается");
  });

  it("a right pair is confirmed as before", () => {
    const r = post(q, signed(q, "payment.confirmed", payment("P-2026-0822", { method: "bank_transfer_ip" })));
    expect(r.ok).toBe(true);
    expect(table(q, "payments").find((x) => x.id === "P-2026-0822").status).toBe("Подтверждён");
  });
});
