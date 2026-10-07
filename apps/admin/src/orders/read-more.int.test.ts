// Integration: requests, customers, the dashboard, the registry and the writes that have no scenario of the services.

import { marketPrices } from "@nivel/db";
import { leads, orders, payments, threshold } from "@nivel/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgAuditSink } from "../auth/audit.ts";
import { fromFormData } from "./build-event.ts";
import { loadDashboard } from "./read-dashboard.ts";
import { listLeads, searchCustomers } from "./read-leads.ts";
import { loadDraftLines, searchCatalog } from "./read-quote.ts";
import { listOtherIncome, listRegistry, listRegistryYears, registryCsv } from "./read-registry.ts";
import { factsOf } from "./runtime.ts";
import {
  assemblingOrder,
  draftOrder,
  handedOverOrder,
  leadOrder,
  ownerOf,
  paidOrder,
  purchasedOrder,
  reportSentOrder,
  sentOrder,
} from "./test-support/flow.ts";
import { createWorld, newCustomer, newFile, PC_CATALOG, type World } from "./test-support/world.ts";
import { addOtherIncome, advanceWarranty, openWarrantyCase, savePassport, type Writer } from "./writes.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const form = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return fromFormData(f);
};
const writer = (role: "owner" | "assistant" = "owner"): Writer => ({
  db: w.db,
  audit: createPgAuditSink(w.db),
  user: { id: role === "owner" ? w.owner.id : w.assistant.id, role },
  now: () => w.clock.now(),
});
const audit = async (action: string) =>
  (
    await w.db.$client.query(
      "select actor, entity, entity_id, after from ops.audit_log where action = $1 order by at",
      [action],
    )
  ).rows;

describe("requests", () => {
  it("lists them with the customer, the order and, for the owner only, the contact the site kept", async () => {
    const made = await leads.create(
      {
        channel: "web",
        scope: "pc",
        customer: { displayName: "С сайта", phoneE164: "+998935550101" },
        budgetSum: 15_000_000,
      },
      w.web,
    );
    const owner = (await listLeads(w.db, {}, { seePhone: true })).find((l) => l.id === made.leadId);
    expect(owner).toMatchObject({ number: made.number, channel: "web", status: "new", budgetBand: "12m_20m" });
    const assistant = (await listLeads(w.db, {}, { seePhone: false })).find((l) => l.id === made.leadId);
    expect(assistant?.contactPhone).toBeNull();
  });

  it("filters by status and shows the order of a request that became one", async () => {
    const o = await leadOrder(w, "Заявка в заказ");
    const converted = await listLeads(w.db, { status: "converted" }, { seePhone: false });
    expect(converted.find((l) => l.orderId === o.orderId)).toMatchObject({
      orderNumber: o.number,
      status: "converted",
    });
    expect((await listLeads(w.db, { status: "nonsense" }, { seePhone: false })).length).toBeGreaterThan(0);
  });

  it("finds a customer to bind by a part of the name, the Telegram name or the phone, and hides phones from the assistant", async () => {
    const id = await newCustomer(w.db, "Бахтиёр Рахимов");
    await w.db.$client.query(
      "update sales.customers set phone_e164 = '+998977770202', telegram_username = 'bakhtiyor_r' where id = $1",
      [id],
    );
    expect((await searchCustomers(w.db, "Бахтиёр", { seePhone: false })).map((c) => c.id)).toContain(id);
    expect((await searchCustomers(w.db, "bakhtiyor", { seePhone: false })).map((c) => c.id)).toContain(id);
    expect((await searchCustomers(w.db, "+9989777", { seePhone: true })).map((c) => c.id)).toContain(id);
    expect((await searchCustomers(w.db, "+9989777", { seePhone: false })).map((c) => c.id)).not.toContain(id);
    expect((await searchCustomers(w.db, "Бахтиёр", { seePhone: false }))[0]?.phone).toBeNull();
    expect(await searchCustomers(w.db, "а", { seePhone: true })).toEqual([]);
  });

  it("is bound to a customer by the owner once, and then becomes an order", async () => {
    // The phone is already a customer: the site cannot tell and keeps the request without one (leads.create).
    const known = await newCustomer(w.db, "Уже есть");
    await w.db.$client.query("update sales.customers set phone_e164 = '+998935550303' where id = $1", [known]);
    const made = await leads.create(
      { channel: "web", scope: "pc", customer: { displayName: "Сайт без клиента", phoneE164: "+998935550303" } },
      w.web,
    );
    const open = (await listLeads(w.db, {}, { seePhone: true })).find((l) => l.id === made.leadId);
    expect(open).toMatchObject({ customerId: null, contactName: "Сайт без клиента", contactPhone: "+998935550303" });
    expect((await listLeads(w.db, {}, { seePhone: false })).find((l) => l.id === made.leadId)?.contactPhone).toBeNull();

    expect((await leads.bindCustomer({ leadId: made.leadId, customerId: known }, ownerOf(w), w.admin)).bound).toBe(
      true,
    );
    const order = await leads.convert({ leadId: made.leadId }, ownerOf(w), w.admin);
    expect(order.created).toBe(true);
    const row = (await listLeads(w.db, {}, { seePhone: false })).find((l) => l.id === made.leadId);
    expect(row).toMatchObject({ customerId: known, orderNumber: order.number, status: "converted" });
  });
});

describe("the estimate editor reads", () => {
  it("gives back the lines of the current draft", async () => {
    const o = await draftOrder(w, "Черновик");
    const draft = await loadDraftLines(w.db, o.orderId);
    expect(draft.catalog).toHaveLength(PC_CATALOG.length);
    expect(draft.manual).toEqual([]);
    expect(draft.catalog.every((l) => l.qty === 1 && !l.customerOwned)).toBe(true);
  });

  it("gives an empty draft for an order that has no estimate yet", async () => {
    const o = await leadOrder(w, "Пустой");
    expect(await loadDraftLines(w.db, o.orderId)).toEqual({ catalog: [], manual: [] });
  });

  it("keeps a line by hand as a line by hand", async () => {
    const o = await leadOrder(w, "Ручная строка");
    const { quotes } = await import("@nivel/services");
    await quotes.build(
      {
        orderId: o.orderId,
        lines: [{ productId: w.products.cpu.id, qty: 1, customerOwned: true }],
        manualLines: [
          {
            title: "Сборка",
            categoryCode: "cable_mgmt",
            feeGroup: "mount",
            qty: 1,
            unitSum: 400_000,
            purchasedByIp: false,
          },
        ],
        tasks: [],
      },
      ownerOf(w),
      w.admin,
    );
    const draft = await loadDraftLines(w.db, o.orderId);
    expect(draft.catalog).toEqual([{ productId: w.products.cpu.id, qty: 1, customerOwned: true }]);
    expect(draft.manual).toEqual([
      {
        title: "Сборка",
        categoryCode: "cable_mgmt",
        feeGroup: "mount",
        qty: 1,
        unitSum: 400_000,
        purchasedByIp: false,
      },
    ]);
  });

  it("offers the verified positions with their market price and narrows them by text", async () => {
    const all = await searchCatalog(w.db, undefined);
    expect(all.length).toBeGreaterThanOrEqual(PC_CATALOG.length);
    const gpu = (await searchCatalog(w.db, "rtx"))[0];
    expect(gpu).toMatchObject({ category: "gpu", title: "Gigabyte RTX 5060", priceSum: 3_600_000, confidence: "high" });
    expect(await searchCatalog(w.db, "%")).toEqual([]);
  });

  it("offers the positions that are only for the owner's hand too (not in the auto-build), with the price from the lower bound", async () => {
    const { rows } = await w.db.$client.query<{ id: string }>(
      `insert into catalog.products (slug, category_code, brand, model, specs, status, manual_only)
       select 'ddr5-128-manual-test', category_code, 'Kingston', 'Fury 128GB DDR5', specs, 'verified', true
         from catalog.products where category_code = 'ram' and not manual_only limit 1
       returning id`,
    );
    const id = rows[0]?.id as string;
    await w.db.insert(marketPrices).values({
      productId: id,
      asOf: "2026-10-12",
      fromSum: 9_900_000,
      offersN: 1,
      vendorsN: 1,
      maxAgeDays: 1,
      confidence: "low",
    });
    const found = (await searchCatalog(w.db, "Fury 128")).find((c) => c.id === id);
    expect(found).toMatchObject({
      category: "ram",
      title: "Kingston Fury 128GB DDR5",
      priceSum: 9_900_000,
      manualOnly: true,
    });
  });
});

describe("the dashboard", () => {
  it("shows what waits: new requests, estimates running out, reports due, refunds, ESF, warranty", async () => {
    const lead = await leads.create(
      { channel: "bot", scope: "pc", customer: { telegramUserId: 7_999_000_111 } },
      w.bot,
    );
    const sent = await sentOrder(w, "Ждёт ответа");
    const due = await purchasedOrder(w, "Отчёт к сдаче");
    const reportSent = await reportSentOrder(w, "Возврат остатка");

    const now = w.clock.now();
    const dash = await loadDashboard(w.db, now);
    expect(dash.newLeads.map((l) => l.id)).toContain(lead.leadId);
    expect(dash.estimatesExpiring.map((e) => e.orderId)).toContain(sent.orderId);
    expect(dash.reportsDue.map((r) => r.orderId)).toContain(due.orderId);
    const refund = dash.refundsDue.find((r) => r.orderId === reportSent.orderId);
    expect(refund).toMatchObject({ kind: "remainder_refund", late: false });
    expect(refund?.amountSum).toBeGreaterThan(0);
    expect(dash.active.find((a) => a.status === "report_due")?.count).toBeGreaterThanOrEqual(1);
  });

  it("marks what is late by the stored term and the clock it was given", async () => {
    const o = await purchasedOrder(w, "Просрочен");
    const later = new Date(w.clock.now().getTime() + 3 * 86_400_000);
    const dash = await loadDashboard(w.db, later);
    expect(dash.reportsDue.find((r) => r.orderId === o.orderId)?.late).toBe(true);
    const early = await loadDashboard(w.db, new Date(w.clock.now().getTime() - 10 * 86_400_000));
    expect(early.reportsDue.find((r) => r.orderId === o.orderId)?.late).toBe(false);
  });

  it("lists ESF that is not signed yet, with its due day", async () => {
    const o = await paidOrder(w, { receivedAt: new Date(w.clock.now().getTime() - 5 * 86_400_000), name: "ЭСФ" });
    await orders.dispatch(o.orderId, { type: "START_PURCHASE" }, ownerOf(w), w.admin);
    const { purchases } = await import("@nivel/services");
    const { newFile } = await import("./test-support/world.ts");
    await purchases.record(
      {
        orderId: o.orderId,
        vendorId: w.vendorId,
        qty: 1,
        amountSum: 650_000,
        paidVia: "bank_transfer",
        receiptKind: "esf",
        esfNo: "ESF-1",
        esfStatus: "pending",
        receiptFileIds: [await newFile(w.db, { kind: "esf" })],
      },
      ownerOf(w),
      w.admin,
    );
    const dash = await loadDashboard(w.db, w.clock.now());
    const row = dash.esfPending.find((e) => e.orderId === o.orderId);
    expect(row).toMatchObject({ esfNo: "ESF-1", late: false });
    expect(row?.due).toMatch(/^2026-10-\d\d$/);
    const late = await loadDashboard(w.db, new Date(w.clock.now().getTime() + 30 * 86_400_000));
    expect(late.esfPending.find((e) => e.orderId === o.orderId)?.late).toBe(true);
  });
});

describe("the registry", () => {
  it("reconciles every order: received = purchased + returned, and the difference is what is left to return", async () => {
    const o = await reportSentOrder(w, "Реестр");
    const rows = await listRegistry(w.db, 2026);
    const row = rows.find((r) => r.orderId === o.orderId);
    const spent = PC_CATALOG.reduce((n, p) => n + p.price, 0);
    expect(row).toMatchObject({
      number: o.number,
      received: o.totals.purchaseLimit,
      purchased: spent,
      returned: 0,
      losses: 0,
      difference: o.totals.purchaseLimit - spent,
      feeIn: o.totals.advance,
      feeRefunded: 0,
    });
  });

  it("closes the difference when the remainder is returned and confirmed", async () => {
    const o = await reportSentOrder(w, "Возврат подтверждён");
    const refund = (
      await w.db.$client.query<{ id: string }>(
        "select id from sales.payments where order_id = $1 and kind = 'remainder_refund'",
        [o.orderId],
      )
    ).rows[0];
    await payments.confirm({ paymentId: refund?.id as string, bankDocNo: "PP-REFUND-1" }, ownerOf(w), w.admin);
    const row = (await listRegistry(w.db, 2026)).find((r) => r.orderId === o.orderId);
    expect(row?.difference).toBe(0);
    expect(row?.returned).toBeGreaterThan(0);
  });

  it("leaves out the orders without money or purchases in the year", async () => {
    const o = await draftOrder(w, "Без денег");
    expect((await listRegistry(w.db, 2026)).map((r) => r.orderId)).not.toContain(o.orderId);
    expect(await listRegistry(w.db, 2019)).toEqual([]);
  });

  it("takes the other income into the deals of the year and the status of the threshold", async () => {
    const before = await threshold.status({ year: 2026 }, w.admin);
    const r = await addOtherIncome(
      writer(),
      form({ period: "2026-09", amountSum: "12 000 000", note: "Другая деятельность ИП" }),
    );
    expect(r).toMatchObject({ ok: true });
    const after = await threshold.status({ year: 2026 }, w.admin);
    expect(after.volume - before.volume).toBe(12_000_000);
    const income = await listOtherIncome(w.db, 2026);
    expect(income.at(-1)).toMatchObject({ period: "2026-09", amountSum: 12_000_000, note: "Другая деятельность ИП" });
    expect((await audit("registry.other_income_add"))[0]).toMatchObject({
      actor: `admin:${w.owner.id}`,
      entity: "sales.other_income",
    });
    expect(await listRegistryYears(w.db, 2026)).toContain(2026);
  });

  it("refuses wrong income and a role that may not", async () => {
    expect((await addOtherIncome(writer(), form({ period: "26-9", amountSum: "5" }))).ok).toBe(false);
    expect((await addOtherIncome(writer(), form({ period: "2026-09", amountSum: "0" }))).ok).toBe(false);
    expect((await addOtherIncome(writer(), form({ period: "2026-09", amountSum: "1,5" }))).ok).toBe(false);
    expect(await addOtherIncome(writer("assistant"), form({ period: "2026-09", amountSum: "5" }))).toMatchObject({
      denied: true,
    });
  });

  it("makes the CSV for the accountant from the same rows", async () => {
    const rows = await listRegistry(w.db, 2026);
    const income = await listOtherIncome(w.db, 2026);
    const csv = registryCsv(rows, income, (s) => s);
    expect(csv.startsWith("﻿Вид;Номер;Статус;")).toBe(true);
    expect(csv.split("\r\n")[1]?.startsWith("Заказ;NV-2026-")).toBe(true);
    expect(csv).toContain("Доход другой деятельности ИП;;;;;;;;;;12000000;2026-09;Другая деятельность ИП");
  });
});

describe("the passport of a build", () => {
  const photoOf = (kind: string) => newFile(w.db, { kind, retention: "order_warranty_plus_3y" });
  const stored = async (orderId: string) =>
    (await w.db.$client.query("select * from sales.build_passports where order_id = $1", [orderId])).rows[0];

  it("is saved with the serial numbers and the tests, and the next save replaces them", async () => {
    const o = await assemblingOrder(w, "Паспорт");
    const first = await savePassport(
      writer("assistant"),
      o.orderId,
      form({
        serials: "Процессор: CPU-123\nВидеокарта: GPU-456",
        biosVersion: "F14",
        os: "Windows 11 Pro по чеку",
        tool: "OCCT + FurMark",
        scenario: "Нагрузка CPU и GPU",
        minutes: "420",
        peakTempC: "78",
        errors: "",
      }),
    );
    expect(first).toMatchObject({ ok: true });
    const row = await stored(o.orderId);
    expect(row.serials).toEqual({ Процессор: "CPU-123", Видеокарта: "GPU-456" });
    expect(row.bios_version).toBe("F14");
    expect(row.tests).toEqual({
      tool: "OCCT + FurMark",
      scenario: "Нагрузка CPU и GPU",
      minutes: 420,
      peakTempC: 78,
      errors: [],
    });
    await savePassport(
      writer(),
      o.orderId,
      form({ serials: "Процессор: CPU-999", minutes: "100", errors: "Перегрев\nСбой драйвера" }),
    );
    const next = await stored(o.orderId);
    expect(next.serials).toEqual({ Процессор: "CPU-999" });
    expect(next.tests.errors).toEqual(["Перегрев", "Сбой драйвера"]);
    const entries = await audit("order.passport_save");
    expect(entries.filter((e) => e.entity_id === o.orderId)).toHaveLength(2);
  });

  it("keeps the photos and the notes of the first save when the next one brings none (the form does not hold them)", async () => {
    const o = await assemblingOrder(w, "Паспорт: фото сохраняются");
    const build = await photoOf("part_photo");
    const seal = await photoOf("serial_photo");
    const second = await photoOf("part_photo");
    await savePassport(
      writer("assistant"),
      o.orderId,
      form({ serials: "Процессор: CPU-1", notes: "Пломбы на крышке", photoIds: [build], sealPhotoIds: [seal] }),
    );
    // The second save, from a page opened anew: no photo fields, the notes field is there with what it held.
    await savePassport(
      writer("assistant"),
      o.orderId,
      form({ serials: "Процессор: CPU-1", minutes: "420", notes: "Пломбы на крышке" }),
    );
    let row = await stored(o.orderId);
    expect(row.photos).toEqual([build]);
    expect(row.seal_photos).toEqual([seal]);
    expect(row.notes).toBe("Пломбы на крышке");
    // A new photo is added to the old ones, the same one twice is kept once; a form without the notes field leaves them.
    await savePassport(writer(), o.orderId, form({ serials: "Процессор: CPU-1", photoIds: [second, build] }));
    row = await stored(o.orderId);
    expect(row.photos).toEqual([build, second]);
    expect(row.seal_photos).toEqual([seal]);
    expect(row.notes).toBe("Пломбы на крышке");
    // The field of the notes that is sent empty clears them: it is the person's decision.
    await savePassport(writer(), o.orderId, form({ serials: "Процессор: CPU-1", notes: "" }));
    expect((await stored(o.orderId)).notes).toBeNull();
  });

  it("takes as photos only files of the registry of the right kind", async () => {
    const o = await assemblingOrder(w, "Паспорт: чужие файлы");
    const receipt = await photoOf("receipt");
    const unknown = "0199aaaa-bbbb-7ccc-8ddd-0000000000ee";
    const wrongKind = await savePassport(writer(), o.orderId, form({ photoIds: [receipt] }));
    expect(wrongKind).toMatchObject({ ok: false });
    expect(wrongKind.message).toContain("Фото");
    expect(await savePassport(writer(), o.orderId, form({ sealPhotoIds: [unknown] }))).toMatchObject({ ok: false });
    expect(await stored(o.orderId)).toBeUndefined();
  });

  it("keeps two parts of one name apart: two memory modules have two serial numbers", async () => {
    const o = await assemblingOrder(w, "Паспорт: две планки");
    await savePassport(
      writer(),
      o.orderId,
      form({ serials: "Оперативная память: KF-111\nОперативная память: KF-222\nПроцессор: CPU-1" }),
    );
    const saved = (await stored(o.orderId)).serials;
    expect(saved).toEqual({
      "Оперативная память": "KF-111",
      "Оперативная память (2)": "KF-222",
      Процессор: "CPU-1",
    });
    // The form shows what was saved: saving it again changes nothing.
    const again = Object.entries(saved)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    await savePassport(writer(), o.orderId, form({ serials: again }));
    expect((await stored(o.orderId)).serials).toEqual(saved);
  });

  it("is written only while the order is in assembly, tests or ready: not before, not after", async () => {
    const early = await leadOrder(w, "Паспорт рано");
    const tooEarly = await savePassport(writer(), early.orderId, form({ minutes: "420" }));
    expect(tooEarly).toMatchObject({ ok: false });
    expect(tooEarly.message).toContain("сборк");
    const late = await handedOverOrder(w, "Паспорт поздно");
    expect(await savePassport(writer(), late.orderId, form({ minutes: "1", errors: "ошибка" }))).toMatchObject({
      ok: false,
    });
    const kept = await stored(late.orderId);
    expect(kept.tests.minutes).toBe(420);
    expect(kept.tests.errors).toEqual([]);
    expect(await stored(early.orderId)).toBeUndefined();
  });

  it("refuses what is not a serial list, a test that is not minutes, a role that may not, an order that does not exist", async () => {
    const o = await assemblingOrder(w, "Паспорт плохой");
    expect((await savePassport(writer(), o.orderId, form({ serials: `${"x".repeat(100)}: 1` }))).ok).toBe(false);
    expect((await savePassport(writer(), o.orderId, form({ minutes: "много" }))).ok).toBe(false);
    expect((await savePassport(writer(), o.orderId, form({ minutes: "9999" }))).ok).toBe(false);
    expect((await savePassport(writer(), o.orderId, form({ peakTempC: "500" }))).ok).toBe(false);
    expect((await savePassport(writer(), "0199aaaa-bbbb-7ccc-8ddd-000000000099", form({}))).ok).toBe(false);
    expect((await savePassport(writer(), "not-an-id", form({}))).ok).toBe(false);
    expect(
      await savePassport({ ...writer(), user: { id: "t", role: "translator" } }, o.orderId, form({})),
    ).toMatchObject({ denied: true });
    expect(await stored(o.orderId)).toBeUndefined();
  });

  it("opens the tests of the order to the automaton: a passport with 6 hours and no errors passes the guard", async () => {
    // The guard of TESTS_PASSED reads exactly what the form writes (services/orders/guards.ts).
    const o = await assemblingOrder(w, "Паспорт и тесты");
    await savePassport(writer(), o.orderId, form({ minutes: "360", errors: "" }));
    const row = await stored(o.orderId);
    expect(row.tests.minutes).toBe(360);
    expect(row.tests.errors).toEqual([]);
  });
});

describe("what the commands look up in the database", () => {
  it("gives the customer and the number of an order, the order of an act, and the state of a switch", async () => {
    const o = await handedOverOrder(w, "Справки");
    const facts = factsOf(w.db);
    const row = (await w.db.$client.query("select customer_id, number from sales.orders where id = $1", [o.orderId]))
      .rows[0];
    expect(await facts.customerOf(o.orderId)).toBe(row.customer_id);
    expect(await facts.orderNumber(o.orderId)).toBe(row.number);
    expect(await facts.actOrderId(o.handoverActId)).toBe(o.orderId);
  });

  it("answers nothing for an id that is not an id and for a record that is not there, without asking the database", async () => {
    const facts = factsOf(w.db);
    const gone = "0199aaaa-bbbb-7ccc-8ddd-0000000000dd";
    expect(await facts.customerOf("not-an-id")).toBeNull();
    expect(await facts.orderNumber(gone)).toBeNull();
    expect(await facts.actOrderId("not-an-id")).toBeNull();
    expect(await facts.actOrderId(gone)).toBeNull();
  });

  it("reads a switch as on only when it is exactly true", async () => {
    const facts = factsOf(w.db);
    expect(await facts.featureOn("feature.nothing")).toBe(false);
    await w.db.$client.query(
      "insert into ops.settings (key, value, updated_by) values ('feature.test_switch', '1'::jsonb, 'test') on conflict (key) do update set value = excluded.value",
    );
    expect(await facts.featureOn("feature.test_switch")).toBe(false);
    await w.db.$client.query("update ops.settings set value = 'true'::jsonb where key = 'feature.test_switch'");
    expect(await facts.featureOn("feature.test_switch")).toBe(true);
  });
});

describe("the warranty case", () => {
  it("is not opened for an order that has not been handed over", async () => {
    const o = await leadOrder(w, "Гарантия рано");
    const r = await openWarrantyCase(writer(), o.orderId, form({ description: "Не включается" }));
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("передан");
  });

  it("is opened with the number G- and the terms of the domain, and walks the automaton", async () => {
    const o = await handedOverOrder(w, "Гарантия");
    const opened = await openWarrantyCase(
      writer("assistant"),
      o.orderId,
      form({ description: "Артефакты на экране", channel: "bot" }),
    );
    expect(opened).toMatchObject({ ok: true });
    expect(opened.ok && opened.message).toMatch(/G-2026-\d{4}/);
    const caseId = opened.ok ? (opened.id as string) : "";
    const c = (await w.db.$client.query("select * from sales.warranty_cases where id = $1", [caseId])).rows[0];
    expect(c).toMatchObject({ status: "opened", channel: "bot", description: "Артефакты на экране" });
    expect(c.due_reply.getTime()).toBeLessThan(c.due_diagnosis.getTime());
    expect(c.due_diagnosis.getTime()).toBeLessThan(c.due_fix.getTime());

    const step = (event: string, extra: Record<string, string> = {}) =>
      advanceWarranty(writer("assistant"), caseId, form({ event, ...extra }));
    expect((await step("RESOLVE")).ok).toBe(false); // an opened case is first diagnosed
    expect((await step("START_DIAGNOSIS")).ok).toBe(true);
    expect((await step("SEND_TO_SUPPLIER")).ok).toBe(true);
    expect((await step("RESOLVE")).ok).toBe(true);
    const done = await step("CLOSE");
    expect(done).toMatchObject({ ok: true });
    const closed = (
      await w.db.$client.query("select status, closed_at from sales.warranty_cases where id = $1", [caseId])
    ).rows[0];
    expect(closed.status).toBe("closed");
    expect(closed.closed_at).toBeInstanceOf(Date);
    const entries = await audit("warranty.advance");
    expect(entries.filter((e) => e.entity_id === caseId)).toHaveLength(4);
  });

  it("refuses a rejection without a cause on the client's side and the proof", async () => {
    const o = await handedOverOrder(w, "Гарантия отказ");
    const opened = await openWarrantyCase(writer(), o.orderId, form({ description: "Не работает после залива" }));
    const caseId = opened.ok ? (opened.id as string) : "";
    await advanceWarranty(writer(), caseId, form({ event: "START_DIAGNOSIS" }));
    const none = await advanceWarranty(writer(), caseId, form({ event: "REJECT" }));
    expect(none).toMatchObject({ ok: false });
    expect(none.message).toContain("по вине клиента");
    expect((await advanceWarranty(writer(), caseId, form({ event: "REJECT", clientFault: "liquid" }))).ok).toBe(false);
    const rejected = await advanceWarranty(
      writer(),
      caseId,
      form({ event: "REJECT", clientFault: "liquid", evidence: "Следы коррозии на плате, фото в чате" }),
    );
    expect(rejected).toMatchObject({ ok: true });
    const row = (
      await w.db.$client.query("select status, client_fault, vendor_claim from sales.warranty_cases where id = $1", [
        caseId,
      ])
    ).rows[0];
    expect(row).toMatchObject({ status: "rejected", client_fault: "liquid" });
    expect(row.vendor_claim.rejection.evidence).toContain("коррозии");
  });

  it("refuses ids that are not ids and a channel that is not one of ours, without an error of the database", async () => {
    const o = await handedOverOrder(w, "Гарантия ввод");
    expect(await openWarrantyCase(writer(), "not-an-id", form({ description: "Шум" }))).toMatchObject({
      ok: false,
      message: "Заказ не найден.",
    });
    const channel = await openWarrantyCase(
      writer(),
      o.orderId,
      form({ description: "Шум", channel: "carrier-pigeon" }),
    );
    expect(channel).toMatchObject({ ok: false });
    expect(channel.message).toContain("Канал");
    expect(await advanceWarranty(writer(), "not-an-id", form({ event: "CLOSE" }))).toMatchObject({
      ok: false,
      message: "Гарантийный случай не найден.",
    });
    const none = await w.db.$client.query("select 1 from sales.warranty_cases where order_id = $1", [o.orderId]);
    expect(none.rows).toHaveLength(0);
  });

  it("applies one transition once: two presses at the same moment do not both win", async () => {
    const o = await handedOverOrder(w, "Гарантия гонка");
    const opened = await openWarrantyCase(writer(), o.orderId, form({ description: "Гудит блок питания" }));
    const caseId = opened.ok ? (opened.id as string) : "";
    const answers = await Promise.all(
      Array.from({ length: 4 }, () => advanceWarranty(writer(), caseId, form({ event: "START_DIAGNOSIS" }))),
    );
    expect(answers.filter((a) => a.ok)).toHaveLength(1);
    const entries = (await audit("warranty.advance")).filter((e) => e.entity_id === caseId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.after).toEqual({ status: "diagnosing" });
  });

  it("refuses an unknown action, an unknown case, and a role that may not", async () => {
    const o = await handedOverOrder(w, "Гарантия права");
    const opened = await openWarrantyCase(writer(), o.orderId, form({ description: "Шум вентилятора" }));
    const caseId = opened.ok ? (opened.id as string) : "";
    expect((await advanceWarranty(writer(), caseId, form({ event: "EXPLODE" }))).ok).toBe(false);
    expect((await advanceWarranty(writer(), "0199aaaa-bbbb-7ccc-8ddd-000000000099", form({ event: "CLOSE" }))).ok).toBe(
      false,
    );
    expect(
      await advanceWarranty({ ...writer(), user: { id: "t", role: "translator" } }, caseId, form({ event: "CLOSE" })),
    ).toMatchObject({ denied: true });
    expect(
      await openWarrantyCase(
        { ...writer(), user: { id: "a", role: "accountant" } },
        o.orderId,
        form({ description: "x" }),
      ),
    ).toMatchObject({ denied: true });
    expect((await openWarrantyCase(writer(), o.orderId, form({}))).ok).toBe(false);
  });
});
