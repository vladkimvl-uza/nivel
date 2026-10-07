// Integration: the gateway against the real database of the tests, as the role `web` (column rights, triggers, the outbox).
import { createDb, type Db } from "@nivel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServicesGateway, fieldsOfIssues, subjectHash } from "./gateway.ts";
import { gatewayFromEnv } from "./runtime.ts";
import { createSubmitDeps, processLeadForm } from "./submit.ts";
import type { LeadCommand } from "./types.ts";

let web: Db;
let admin: Db;
const KEY = "x".repeat(32);

beforeAll(() => {
  const w = process.env.DATABASE_URL_WEB;
  const a = process.env.DATABASE_URL_ADMIN;
  if (!w || !a)
    throw new Error("DATABASE_URL_WEB and DATABASE_URL_ADMIN are set by the harness of the integration project");
  web = createDb(w, { max: 2 });
  admin = createDb(a, { max: 2 });
});
afterAll(async () => {
  await web.$client.end();
  await admin.$client.end();
});

let n = 0;
const command = (over: Partial<LeadCommand> = {}): LeadCommand => {
  n += 1;
  return {
    channel: "web",
    scope: "pc",
    lang: "uz",
    district: "Yunusobod",
    budgetSum: 14_000_000,
    comment: "Oʻyin uchun",
    utm: { utm_source: "ads" },
    customer: { displayName: "Aziz", phoneE164: `+99890${String(7_000_000 + n)}` },
    consent: { kind: "pd_processing", granted: true, textVersion: "builtin-2026-10-07" },
    ...over,
  };
};

describe("createServicesGateway", () => {
  it("opens a lead of the site with a number, the customer made from the contact, the consent evidence and the task for the owner topic", async () => {
    const gateway = createServicesGateway({ db: web, subjectKey: KEY });
    const c = command();
    const r = await gateway.submit(c);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.number).toMatch(/^L-\d{4}-\d{4}$/);

    // the site names no customer: the services made a new one from the contact of the form
    const lead = await admin.$client.query(
      `select l.channel, l.scope, l.lang, l.district, l.budget_band, l.utm, c.phone_e164, c.display_name
         from sales.leads l join sales.customers c on c.id = l.customer_id where l.number = $1`,
      [r.number],
    );
    expect(lead.rows[0]).toMatchObject({
      channel: "web",
      scope: "pc",
      lang: "uz",
      district: "Yunusobod",
      budget_band: "12m_20m",
      utm: { utm_source: "ads" },
      phone_e164: c.customer.phoneE164,
      display_name: "Aziz",
    });

    const consent = await admin.$client.query(
      "select kind, granted, channel, lang, subject_ref_hash, evidence from ops.consents where evidence->>'lead' = $1",
      [r.number],
    );
    expect(consent.rows).toHaveLength(1);
    expect(consent.rows[0]).toMatchObject({
      kind: "pd_processing",
      granted: true,
      channel: "web",
      lang: "uz",
      subject_ref_hash: subjectHash(KEY, c),
      evidence: { textVersion: "builtin-2026-10-07", lead: r.number },
    });
    // the evidence holds no contact data
    expect(JSON.stringify(consent.rows[0])).not.toContain(c.customer.phoneE164 as string);

    const task = await admin.$client.query(
      "select kind, payload from ops.outbox where payload->>'templateKey' = 'lead.created' and payload->'params'->>'number' = $1",
      [r.number],
    );
    expect(task.rows).toHaveLength(1);
    expect(task.rows[0].payload).toMatchObject({ target: "owner_topic" });
  });

  it("names the document and the fingerprint of the consent text that the visitor was shown", async () => {
    const sha = "ab".repeat(32);
    const doc = await admin.$client.query(
      `insert into content.legal_documents (kind, version, lang, body_md, status, text_sha256)
       values ('consent_pd', 'int-test-1', 'uz', 'text', 'stub', $1) returning id`,
      [sha],
    );
    const documentId = doc.rows[0].id as string;
    const gateway = createServicesGateway({ db: web, subjectKey: KEY });
    const r = await gateway.submit(
      command({
        consent: { kind: "pd_processing", granted: true, textVersion: "int-test-1", textSha256: sha, documentId },
      }),
    );
    if (!r.ok) throw new Error("not ok");
    const consent = await admin.$client.query(
      "select document_id, text_sha256, evidence from ops.consents where evidence->>'lead' = $1",
      [r.number],
    );
    expect(consent.rows[0]).toMatchObject({
      document_id: documentId,
      text_sha256: sha,
      evidence: { textVersion: "int-test-1" },
    });
  });

  it("keeps the numbers one after another for two requests", async () => {
    const gateway = createServicesGateway({ db: web, subjectKey: KEY });
    const a = await gateway.submit(command());
    const b = await gateway.submit(command());
    if (!a.ok || !b.ok) throw new Error("not ok");
    const num = (s: string) => Number(s.split("-")[2]);
    expect(num(b.number)).toBe(num(a.number) + 1);
  });

  it("writes neither the lead nor the consent when the services refuse the request", async () => {
    const gateway = createServicesGateway({ db: web, subjectKey: KEY });
    const before = await admin.$client.query("select count(*)::int as n from ops.consents");
    const r = await gateway.submit(command({ customer: { phoneE164: "not a phone" } }));
    expect(r).toEqual({ ok: false, reason: "invalid", fields: { phone: "phone_invalid" } });
    const after = await admin.$client.query("select count(*)::int as n from ops.consents");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("rolls the lead back when the consent cannot be written", async () => {
    const gateway = createServicesGateway({ db: web, subjectKey: KEY, log: () => {} });
    const before = await admin.$client.query("select count(*)::int as n from sales.leads");
    // a money consent is refused by the database for the role web: the whole transaction goes back
    const r = await gateway.submit(
      command({ consent: { kind: "limit_overrun" as never, granted: true, textVersion: "x" } }),
    );
    expect(r).toEqual({ ok: false, reason: "unavailable" });
    const after = await admin.$client.query("select count(*)::int as n from sales.leads");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("answers unavailable, not an exception, when the database does not answer", async () => {
    const dead = createDb("postgres://nivel_web:x@127.0.0.1:1/none", { max: 1 });
    try {
      const gateway = createServicesGateway({ db: dead, subjectKey: KEY, log: () => {} });
      expect(await gateway.submit(command())).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      await dead.$client.end().catch(() => {});
    }
  });
});

describe("the whole path of the form", () => {
  it("takes a good form to a lead with a number and a repeated press to the same number", async () => {
    const deps = createSubmitDeps({ gateway: createServicesGateway({ db: web, subjectKey: KEY }) });
    const form = new FormData();
    for (const [k, v] of Object.entries({
      name: "Dilnoza",
      phone: "+998 91 555 66 77",
      scope: "setup",
      consent: "on",
      locale: "ru",
    }))
      form.set(k, v);
    const first = await processLeadForm(form, { ip: "203.0.113.5" }, deps);
    expect(first).toMatchObject({ status: "ok", number: expect.stringMatching(/^L-/) });
    const again = await processLeadForm(form, { ip: "203.0.113.5" }, deps);
    expect(again).toEqual(first);
  });
});

describe("gatewayFromEnv", () => {
  it("is the unavailable gateway without the database or the key", async () => {
    expect(await gatewayFromEnv({}).submit(command())).toEqual({ ok: false, reason: "unavailable" });
    expect(await gatewayFromEnv({ DATABASE_URL_WEB: "postgres://x" }).submit(command())).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("fieldsOfIssues", () => {
  it("names the field of the form for each path of the services", () => {
    expect(
      fieldsOfIssues([
        { path: "customer.phoneE164", code: "phone_invalid" },
        { path: "customer.telegramUsername", code: "text_invalid" },
        { path: "budgetSum", code: "sum_invalid" },
        { path: "comment", code: "text_invalid" },
        { path: "district", code: "text_invalid" },
        { path: "scope", code: "scope_unknown" },
        { path: "customer.displayName", code: "text_invalid" },
        { path: "something", code: "x" },
      ]),
    ).toEqual({
      phone: "phone_invalid",
      telegram: "telegram_invalid",
      budget: "budget_invalid",
      comment: "too_long",
      district: "too_long",
      scope: "scope_invalid",
      name: "too_long",
    });
  });
});
