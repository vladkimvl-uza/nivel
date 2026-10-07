/**
 * Demo data: 12 leads, 8 orders in the key statuses, payments, receipts, 2 warranty cases, the ledger of the reserves,
 * the history and the promotion. Every row has "Демо" = TRUE, the clients are "Демо-клиент N", the numbers come from
 * separate demo counters (L-2026-D001). The money is computed by the same functions as everywhere else.
 * "Очистить" removes only the rows with "Демо" = TRUE (and their history and reserves), the real rows and counters stay.
 */

/** Timeline of the eight demo orders: offsets in days before today (null = not reached). */
const NV_DEMO_ORDERS = [
  {
    final: "closed",
    kind: "ПК",
    pc: 14200000,
    mem: 2100000,
    channel: "Telegram-бот",
    district: "Чиланзарский",
    t: {
      created: 58,
      sent: 57,
      accepted: 56,
      adv: 56,
      funds: 56,
      start: 54,
      done: 52,
      report: 51,
      settled: 48,
      assembling: 48,
      testing: 47,
      ready: 47,
      delivery: 47,
      handed: 47,
      closed: 42,
    },
    ratio: 97,
  },
  {
    final: "closed",
    kind: "Сетап",
    pc: 21800000,
    mount: 9400000,
    outside: 1200000,
    purchased: 24100000,
    mem: 3400000,
    channel: "Instagram",
    district: "Юнусабадский",
    t: {
      created: 50,
      sent: 49,
      accepted: 47,
      adv: 47,
      funds: 47,
      start: 45,
      done: 43,
      report: 42,
      settled: 38,
      assembling: 37,
      testing: 36,
      ready: 36,
      delivery: 36,
      handed: 35,
      closed: 30,
    },
    ratio: 96,
  },
  {
    final: "handed_over",
    kind: "ПК",
    pc: 32600000,
    mem: 8900000,
    channel: "Рекомендация",
    district: "Мирзо-Улугбекский",
    t: {
      created: 30,
      sent: 29,
      accepted: 28,
      adv: 28,
      funds: 28,
      start: 26,
      done: 24,
      report: 23,
      settled: 21,
      assembling: 21,
      testing: 20,
      ready: 20,
      delivery: 19,
      handed: 19,
    },
    ratio: 98,
  },
  {
    final: "testing",
    kind: "ПК",
    pc: 26400000,
    mem: 4300000,
    channel: "Посев в Telegram",
    district: "Яккасарайский",
    t: {
      created: 22,
      sent: 21,
      accepted: 20,
      adv: 20,
      funds: 20,
      start: 18,
      done: 15,
      report: 14,
      settled: 11,
      assembling: 9,
      testing: 3,
    },
    ratio: 99,
    next: "Сдать по акту после теста 8 ч",
    nextOffset: -2,
  },
  {
    final: "report_sent",
    kind: "ПК",
    pc: 11700000,
    mem: 1900000,
    channel: "Telegram-бот",
    district: "Алмазарский",
    t: { created: 16, sent: 15, accepted: 14, adv: 14, funds: 14, start: 11, done: 7, report: 2 },
    ratio: 96,
    next: "Узнать, есть ли возражения по отчёту",
    nextOffset: 1,
  },
  {
    final: "purchasing",
    kind: "Сетап",
    pc: 28400000,
    mount: 9600000,
    outside: 900000,
    purchased: 30100000,
    mem: 5800000,
    channel: "Сайт",
    district: "Мирабадский",
    t: { created: 13, sent: 12, accepted: 10, adv: 10, funds: 9, start: 5 },
    ratio: 55,
    next: "Записать чеки закупки",
    nextOffset: 1,
  },
  {
    final: "accepted",
    kind: "Апгрейд",
    pc: 9100000,
    mem: 2600000,
    channel: "OLX",
    district: "Шайхантахурский",
    t: { created: 6, sent: 5, accepted: 4, adv: 4 },
    ratio: 0,
    next: "Напомнить об авансе и деньгах на закупку",
    nextOffset: 2,
  },
  {
    final: "estimate_sent",
    kind: "Подбор",
    pc: 12000000,
    purchased: 0,
    mem: 0,
    channel: "Рекомендация",
    district: "Учтепинский",
    t: { created: 1, sent: 1 },
    ratio: 0,
    next: "Спросить клиента про смету",
    nextOffset: 0,
  },
];

/** Budget range of the demo lead by the grand total. */
function nvDemoBand(total) {
  if (total >= 60000000) return "от 60 млн";
  if (total >= 40000000) return "40–60 млн";
  if (total >= 20000000) return "20–40 млн";
  if (total >= 10000000) return "10–20 млн";
  if (total >= 5000000) return "5–10 млн";
  return "до 5 млн";
}

/** The chain of the events up to the final status: [from, to, event, key of the time]. */
function nvDemoChain(finalCode) {
  const chain = [
    [null, "estimate_draft", "ORDER_CREATED", "created"],
    ["estimate_draft", "estimate_sent", "SEND_ESTIMATE", "sent"],
    ["estimate_sent", "accepted", "ACCEPT", "accepted"],
    ["accepted", "accepted", "FEE_PREPAID", "adv"],
    ["accepted", "accepted", "FUNDS_RECEIVED", "funds"],
    ["accepted", "purchasing", "START_PURCHASE", "start"],
    ["purchasing", "report_due", "PURCHASE_DONE", "done"],
    ["report_due", "report_sent", "SEND_REPORT", "report"],
    ["report_sent", "settled", "REMAINDER_SETTLED", "settled"],
    ["settled", "assembling", "MATERIALS_ACCEPTED", "assembling"],
    ["assembling", "testing", "ASSEMBLED", "testing"],
    ["testing", "ready", "TESTS_PASSED", "ready"],
    ["ready", "delivering", "DISPATCH", "delivery"],
    ["delivering", "handed_over", "HANDOVER", "handed"],
    ["handed_over", "closed", "CLOSE", "closed"],
  ];
  const order = [
    "estimate_draft",
    "estimate_sent",
    "accepted",
    "purchasing",
    "report_due",
    "report_sent",
    "settled",
    "assembling",
    "testing",
    "ready",
    "delivering",
    "handed_over",
    "closed",
  ];
  const last = order.indexOf(finalCode);
  return chain.filter(
    (c) =>
      order.indexOf(c[1]) <= last &&
      !(finalCode === "accepted" && c[2] === "FUNDS_RECEIVED") &&
      !(finalCode === "estimate_sent" && c[1] !== "estimate_draft" && c[1] !== "estimate_sent"),
  );
}

function nvDemoCount() {
  let n = 0;
  ["clients", "leads", "orders", "payments", "purchases", "warranty", "reserves", "promo"].forEach((key) => {
    n += nvReadTable(key).filter((r) => r.demo === true).length;
  });
  n += nvDemoHistoryRows().length;
  return n;
}

/** Is a history row about a demo object (the demo numbers carry the letter D). */
function nvIsDemoHistory(h) {
  const p = nvParseNumber(h.num);
  return !!p?.demo || /-D\d{3}/.test(String(h.reason || ""));
}

/** History rows of the demo objects. */
function nvDemoHistoryRows() {
  return nvReadTable("history").filter(nvIsDemoHistory);
}

/** Rewrites a table without the given rows: the body is cleared (not the formulas) and the rest written again. */
function nvRewriteTable(sheetKey, keepRows) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const rows = sh.getMaxRows() - NV_LAYOUT.firstRow + 1;
  let i = 0;
  while (i < def.cols.length) {
    if (def.cols[i].calc) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < def.cols.length && !def.cols[j + 1].calc) j++;
    sh.getRange(NV_LAYOUT.firstRow, NV_LAYOUT.firstCol + i, rows, j - i + 1).clearContent();
    i = j + 1;
  }
  def.cols.forEach((c, k) => {
    if (c.type === "flag") sh.getRange(NV_LAYOUT.firstRow, NV_LAYOUT.firstCol + k, rows, 1).clearDataValidations();
  });
  if (keepRows.length) nvWriteRowsMatrix(sheetKey, NV_LAYOUT.firstRow, keepRows);
}

function nvDemoClear() {
  return nvWithLock(() => {
    const removed = {};
    ["history", "clients", "leads", "orders", "payments", "purchases", "warranty", "reserves", "promo"].forEach(
      (key) => {
        const rows = nvReadTable(key);
        const drop = key === "history" ? nvIsDemoHistory : (r) => r.demo === true;
        const remove = rows.filter(drop);
        if (!remove.length) return;
        nvRewriteTable(
          key,
          rows.filter((r) => !drop(r)),
        );
        removed[key] = remove.length;
      },
    );
    // The demo counters start over; the real counters are not touched.
    const props = nvScriptProps();
    Object.keys(props.getProperties())
      .filter((k) => k.indexOf(NV_COUNTER_PREFIX + "DEMO_") === 0)
      .forEach((k) => {
        props.deleteProperty(k);
      });
    nvReadTable("orders").forEach((o) => {
      nvRefreshOrderActions(o.num);
    });
    nvReadTable("warranty").forEach((w) => {
      nvSetActionValidation("warranty", w._row, nvWarrantyActionLabels(w.status));
    });
    return removed;
  });
}

/** Adds the demo data. Returns counts. Does nothing if demo rows are already there. */
function nvDemoFill() {
  return nvWithLock(() => {
    if (nvDemoCount() > 0) return { ok: false, error: "demo_exists" };
    const now = nvNow();
    const today = nvMidnightDate(now);
    const s = nvSettings();
    const holidays = nvHolidays();
    const year = nvYear(now);
    const at = (daysAgo, hour, minute) => {
      const t = nvYmd(today);
      return nvLocalDate(t.y, t.m, t.d - daysAgo, hour === undefined ? 11 : hour, minute || 0);
    };
    const num = (prefix, n) => nvFormatNumber(prefix, year, n, true);
    const clients = [];
    const leads = [];
    const orders = [];
    const payments = [];
    const purchases = [];
    const warranty = [];
    const reserves = [];
    const history = [];
    let payN = 0;
    let purN = 0;
    const counters = { K: 0, L: 0, NV: 0, P: 0, Z: 0, G: 0 };
    const nextNo = (p) => {
      counters[p] += 1;
      return p === "K" ? nvFormatNumber("K", year, counters[p], true) : num(p, counters[p]);
    };
    const hist = (o) => history.push(nvHistoryRow(o));
    const receiptNo = (n) => "FS-" + nvPad(100200 + n, 6);
    const itemsFor = (kind) =>
      kind === "Сетап"
        ? [
            ["Процессор", "Процессор"],
            ["Видеокарта", "Видеокарта"],
            ["Материнская плата", "Материнская плата"],
            ["Память", "Память 32 ГБ"],
            ["Монитор", 'Монитор 27"'],
            ["Мебель", "Стол и кресло"],
          ]
        : [
            ["Процессор", "Процессор"],
            ["Видеокарта", "Видеокарта"],
            ["Материнская плата", "Материнская плата"],
            ["Память", "Память 32 ГБ"],
            ["SSD / накопитель", "SSD 1 ТБ"],
            ["Блок питания", "Блок питания"],
            ["Корпус", "Корпус"],
          ];
    const fundState = { balance: 0, closed: 0 };
    // The start contribution of the warranty fund: the real one is the first line of the ledger since the setup;
    // a book without it gets a demo line, so that the demo fund has its balance
    if (!nvReadTable("reserves").some((r) => r.basis === "Стартовый взнос" && r.demo !== true)) {
      reserves.push({
        date: at(70, 10),
        fund: "Гарантийный",
        ref: "",
        amount: s.warrantyStart,
        basis: "Стартовый взнос",
        who: "Владелец",
        comment: "Стартовый взнос по решению владельца",
        demo: true,
      });
    }
    fundState.balance = s.warrantyStart;

    NV_DEMO_ORDERS.forEach((spec, idx) => {
      const n = idx + 1;
      const clientCode = nextNo("K");
      const name = "Демо-клиент " + n;
      clients.push({
        code: clientCode,
        name: name,
        tg: "@demo_client_" + n,
        lang: n % 2 ? "ru" : "uz",
        district: spec.district,
        firstContact: at(spec.t.created + 1, 0),
        firstChannel: spec.channel,
        notes: "Демо-данные",
        demo: true,
      });
      const purchased = spec.purchased === undefined ? spec.pc : spec.purchased;
      const input = {
        kind: spec.kind,
        basePc: spec.pc,
        baseMount: spec.mount || 0,
        outside: spec.outside || 0,
        purchased: purchased,
        memory: spec.mem || 0,
        complex: false,
        freeWindow: false,
      };
      const q = nvComputeQuote(input, s);
      // Lead
      const leadNo = nextNo("L");
      const scope = { Сетап: "Сетап", Подбор: "Подбор", Апгрейд: "Апгрейд" }[spec.kind] || "ПК";
      leads.push({
        num: leadNo,
        created: at(spec.t.created + 1, 15),
        channel: spec.channel,
        source: (NV_CHANNELS.find((c) => c.label === spec.channel) || { code: "" }).code,
        client: clientCode,
        name: name,
        tg: "@demo_client_" + n,
        lang: n % 2 ? "ru" : "uz",
        district: spec.district,
        scope: scope,
        band: nvDemoBand(q.grandTotal),
        budget: q.grandTotal,
        wanted: at(-14, 0),
        status: "В заказе",
        reason: "",
        firstReply: at(spec.t.created + 1, 15, 40),
        next: "",
        nextDate: "",
        order: "",
        note: "",
        src: "Вручную",
        updated: at(spec.t.created, 12),
        demo: true,
      });
      hist({
        time: at(spec.t.created + 1, 15),
        object: "Заявка",
        num: leadNo,
        to: "Новая",
        event: "LEAD_CREATED",
        eventLabel: "Заявка создана",
        how: "Вручную",
      });
      hist({
        time: at(spec.t.created, 12),
        object: "Заявка",
        num: leadNo,
        from: "Новая",
        to: "В заказе",
        event: "LEAD_CONVERTED",
        eventLabel: "Заявка превращена в заказ",
      });
      // Order
      const orderNo = nextNo("NV");
      leads[leads.length - 1].order = orderNo;
      const code = spec.final;
      const status = nvStatusByCode(code);
      const t = spec.t;
      const row = {
        num: orderNo,
        created: at(t.created, 12),
        lead: leadNo,
        client: clientCode,
        kind: spec.kind,
        slot: "Обычный",
        complex: false,
        furn: false,
        status: status.label,
        action: "",
        code: code,
        basePc: spec.pc,
        baseMount: spec.mount || 0,
        outside: spec.outside || 0,
        purchased: purchased,
        memory: spec.mem || 0,
        meetingDone: q.grandTotal >= s.meetingFrom,
        reportAccepted: "",
        nextStep: spec.next || "",
        nextDate: "",
        adminUrl: "",
        tgTopic: "",
        notes: "Демо-данные",
        src: "Вручную",
        seq: "",
        updated: at(0, 9),
        demo: true,
        warrantyUntil: "",
      };
      if (spec.next) {
        const d = nvYmd(today);
        row.nextDate = nvDay(d.y, d.m, d.d + (spec.nextOffset === undefined ? 0 : spec.nextOffset));
      }
      if (t.sent !== undefined) row.dEstimate = at(t.sent, 18);
      if (code === "estimate_sent") row.validUntil = new Date(now.getTime() + 5 * 3600000);
      else if (t.sent !== undefined) row.validUntil = new Date(at(t.sent, 18).getTime() + s.shelfHours * 3600000);
      if (t.accepted !== undefined) row.dAccepted = at(t.accepted, 10);
      if (t.start !== undefined) row.dPurchase = at(t.start, 10, 30);
      if (t.done !== undefined) {
        row.dPurchaseDone = at(t.done, 17);
        row.reportTarget = new Date(row.dPurchaseDone.getTime() + s.reportTargetHours * 3600000);
        row.reportDeadline = new Date(row.dPurchaseDone.getTime() + s.reportDeadlineHours * 3600000);
      }
      if (t.report !== undefined) {
        row.reportSent = at(t.report, 12);
        row.objectionUntil = nvAddWorkingDays(row.reportSent, s.objectionDays, holidays);
        row.refundDue = nvAddWorkingDays(row.reportSent, s.refundDays, holidays);
        row.reportAccepted = t.settled !== undefined ? "По сроку" : "Нет";
      }
      if (t.settled !== undefined) row.dSettled = at(t.settled, 12);
      if (t.assembling !== undefined) row.dAssembly = at(t.assembling, 10);
      if (t.testing !== undefined) row.dTest = at(t.testing, 10);
      if (t.ready !== undefined) row.dReady = at(t.ready, 16);
      if (t.delivery !== undefined) row.dDelivery = at(t.delivery, 12);
      if (t.handed !== undefined) {
        row.dHandover = at(t.handed, 15);
        row.warrantyUntil = nvMidnightDate(nvAddMonths(row.dHandover, s.warrantyMonths));
        row.aftercare1 = new Date(row.dHandover.getTime() + s.aftercareShort * NV_DAY_MS);
        row.aftercare2 = new Date(row.dHandover.getTime() + s.aftercareLong * NV_DAY_MS);
      }
      if (t.closed !== undefined) row.dClosed = at(t.closed, 3);
      orders.push(row);

      // Payments
      const pay = (kindLabel, amount, daysAgo, hour, status) => {
        const k = nvPaymentKindByLabel(kindLabel);
        payN += 1;
        const confirmed = status === "Подтверждён";
        const d = at(daysAgo, hour);
        payments.push({
          id: nextNo("P"),
          order: orderNo,
          kind: k.label,
          method: k.methods[0],
          amount: amount,
          status: status,
          date: d,
          receipt: confirmed && k.group === "Плата" ? receiptNo(payN) : "",
          bankDoc: k.group !== "Плата" ? "БД-" + nvPad(5000 + payN, 5) : "",
          payerIsClient: true,
          thirdParty: "",
          confirmedBy: confirmed ? "Владелец" : "",
          confirmedAt: confirmed ? d : "",
          reversal: "",
          voidReason: "",
          src: "Вручную",
          demo: true,
        });
      };
      if (t.adv !== undefined) pay("Аванс платы 30 %", q.advance, t.adv, 11, "Подтверждён");
      if (t.funds !== undefined && code !== "accepted")
        pay("Деньги на закупку", q.purchaseLimit, t.funds, 12, "Подтверждён");
      if (code === "accepted") pay("Деньги на закупку", q.purchaseLimit, 0, 12, "Ожидается");
      // Receipts
      let receiptsTotal = 0;
      if (spec.ratio > 0 && t.start !== undefined) {
        const target = Math.floor((q.purchaseLimit * spec.ratio) / 100 / 1000) * 1000;
        const items = itemsFor(spec.kind).slice(0, code === "purchasing" ? 4 : 99);
        const shares = items.map((_, i) => 5 + ((i * 7) % 11));
        const sharesSum = shares.reduce((a, x) => a + x, 0);
        let left = target;
        items.forEach((it, i) => {
          const amount = i === items.length - 1 ? left : Math.floor((target * shares[i]) / sharesSum / 1000) * 1000;
          left -= amount;
          purN += 1;
          const bought = at(Math.max(0, t.start - Math.floor(i / 3)), 13);
          receiptsTotal += amount;
          purchases.push({
            id: nextNo("Z"),
            order: orderNo,
            item: it[1],
            category: it[0],
            shop: NV_SHOPS[i % NV_SHOPS.length],
            qty: 1,
            amount: amount,
            paidWith: i % 2 ? "Перевод" : "Корпоративная карта",
            docKind: "Фискальный чек",
            receipt: "ЧК-" + nvPad(30000 + purN, 6),
            esf: "",
            esfStatus: "",
            discount: 0,
            bonus: "",
            serials: "",
            warrantyMonths: it[0] === "Блок питания" || it[0] === "Видеокарта" ? 36 : 12,
            photo: "",
            verified: true,
            bought: bought,
            boughtBy: "Владелец",
            src: "Вручную",
            demo: true,
          });
        });
        if (spec.kind === "Сетап") {
          const lastP = purchases[purchases.length - 1];
          lastP.esf = "ЭСФ-" + nvPad(7000 + purN, 6);
          lastP.esfStatus = code === "closed" || code === "handed_over" ? "Подписана" : "Ожидается";
        }
      }
      const remainder = q.purchaseLimit - receiptsTotal;
      if (t.settled !== undefined && remainder > 0) pay("Возврат остатка", remainder, t.settled + 1, 14, "Подтверждён");
      if (code === "report_sent" && remainder > 0) pay("Возврат остатка", remainder, 0, 14, "Ожидается");
      if (t.handed !== undefined) pay("Финал платы 70 %", q.final, t.handed, 15, "Подтверждён");
      if (code === "testing") pay("Финал платы 70 %", q.final, 0, 15, "Ожидается");
      // Reserves
      if (t.settled !== undefined)
        reserves.push({
          date: at(t.settled, 12),
          fund: "Налоговый риск",
          ref: orderNo,
          amount: nvTaxRiskReserve(receiptsTotal, s.taxRiskActive === true, s),
          basis: "Взнос при сверке",
          who: "Скрипт",
          comment: "",
          demo: true,
        });
      if (t.handed !== undefined) {
        const contribution = nvWarrantyContribution(
          receiptsTotal,
          { balance: fundState.balance, closedOrders: fundState.closed, lossesBp: 0 },
          s,
        );
        reserves.push({
          date: at(t.handed, 15),
          fund: "Гарантийный",
          ref: orderNo,
          amount: contribution,
          basis: "Взнос при сдаче",
          who: "Скрипт",
          comment: "",
          demo: true,
        });
        fundState.balance += contribution;
        if (t.closed !== undefined) fundState.closed += 1;
      }
      // History of the order
      nvDemoChain(code).forEach((c) => {
        const when = at(t[c[3]], 12);
        const ev = nvEventByCode(c[2]);
        hist({
          time: when,
          object: "Заказ",
          num: orderNo,
          from: c[0] ? nvStatusByCode(c[0]).label : "",
          to: nvStatusByCode(c[1]).label,
          event: c[2],
          eventLabel: ev ? ev.label : "Заказ создан",
          actor: c[2] === "CLOSE" ? "Система" : c[2] === "ACCEPT" ? "Владелец" : "Владелец",
          how: c[2] === "CLOSE" ? "Система" : "Вручную",
          reason: c[2] === "ACCEPT" ? "Подтверждение клиента в чате" : "",
        });
      });
    });

    // Leads that have not become orders
    const extra = [
      {
        status: "Новая",
        created: new Date(now.getTime() - 30 * 3600000),
        channel: "Telegram-бот",
        scope: "ПК",
        band: "10–20 млн",
        budget: 15000000,
        name: "Демо-клиент 9",
        district: "Сергелийский",
        note: "Без ответа дольше цели",
      },
      {
        status: "В работе",
        created: at(3, 14),
        channel: "Instagram",
        scope: "Сетап",
        band: "20–40 млн",
        budget: 28000000,
        name: "Демо-клиент 10",
        district: "Бектемирский",
        next: "Позвонить, уточнить рабочее место",
        nextDate: nvDay(nvYmd(today).y, nvYmd(today).m, nvYmd(today).d + 1),
        firstReply: at(3, 14, 25),
      },
      {
        status: "Отказ",
        created: at(8, 13),
        channel: "Яндекс",
        scope: "ПК",
        band: "до 5 млн",
        budget: 4200000,
        name: "Демо-клиент 11",
        district: "Яшнабадский",
        reason: "Ниже минимальной сметы",
        firstReply: at(8, 13, 50),
      },
      {
        status: "Спам",
        created: at(5, 2),
        channel: "Telegram-бот",
        scope: "Апгрейд",
        band: "",
        budget: "",
        name: "Демо-клиент 12",
        district: "Регион",
        firstReply: at(5, 10, 5),
      },
    ];
    extra.forEach((x) => {
      const no = nextNo("L");
      const clientCode = nextNo("K");
      clients.push({
        code: clientCode,
        name: x.name,
        tg: "@demo_client_" + (clients.length + 1),
        lang: "ru",
        district: x.district,
        firstContact: nvMidnightDate(x.created),
        firstChannel: x.channel,
        notes: "Демо-данные",
        demo: true,
      });
      leads.push({
        num: no,
        created: x.created,
        channel: x.channel,
        source: (NV_CHANNELS.find((c) => c.label === x.channel) || { code: "" }).code,
        client: clientCode,
        name: x.name,
        tg: "@demo_client_" + clients.length,
        lang: "ru",
        district: x.district,
        scope: x.scope,
        band: x.band,
        budget: x.budget,
        wanted: "",
        status: x.status,
        reason: x.reason || "",
        firstReply: x.firstReply || "",
        next: x.next || "",
        nextDate: x.nextDate || "",
        order: "",
        note: x.note || "",
        src: "Вручную",
        updated: x.created,
        demo: true,
      });
      hist({
        time: x.created,
        object: "Заявка",
        num: no,
        to: "Новая",
        event: "LEAD_CREATED",
        eventLabel: "Заявка создана",
      });
      if (x.status !== "Новая")
        hist({
          time: x.firstReply || x.created,
          object: "Заявка",
          num: no,
          from: "Новая",
          to: x.status,
          event: "LEAD_STATUS",
          eventLabel: "Статус заявки",
          reason: x.reason || "",
        });
    });

    // Warranty cases: one closed with a cost, one in diagnostics
    const w1order = orders[0];
    const w2order = orders[2];
    const mkWarranty = (order, openedAgo, status, extraFields) => {
      const opened = at(openedAgo, 12);
      const d = nvWarrantyDeadlines(opened, holidays);
      const no = nextNo("G");
      warranty.push(
        Object.assign(
          {
            num: no,
            order: order.num,
            purchase: "",
            opened: opened,
            channel: "Бот",
            desc: "Демо: описание без персональных данных",
            status: status,
            action: "",
            fixType: "Работа",
            replyBy: d.reply,
            diagBy: d.diagnosis,
            loanerBy: d.loaner,
            fixBy: d.fixWork,
            src: "Вручную",
            demo: true,
          },
          extraFields || {},
        ),
      );
      hist({
        time: opened,
        object: "Гарантия",
        num: no,
        to: "Открыт",
        event: "WARRANTY_OPENED",
        eventLabel: "Гарантийный случай открыт",
        reason: order.num,
      });
      return no;
    };
    const g1 = mkWarranty(w1order, 20, "Закрыт", {
      cost: 150000,
      closed: nvMidnightDate(at(15, 0)),
      desc: "Демо: шум вентилятора, замена",
    });
    reserves.push({
      date: at(15, 12),
      fund: "Гарантийный",
      ref: g1,
      amount: -150000,
      basis: "Расход на гарантийный случай",
      who: "Скрипт",
      comment: "",
      demo: true,
    });
    mkWarranty(w2order, 2, "Диагностика");
    hist({
      time: at(1, 10),
      object: "Гарантия",
      num: warranty[1].num,
      from: "Открыт",
      to: "Диагностика",
      event: "START_DIAGNOSIS",
      eventLabel: "Начать диагностику",
    });
    hist({
      time: at(15, 12),
      object: "Гарантия",
      num: g1,
      from: "Устранён",
      to: "Закрыт",
      event: "CLOSE",
      eventLabel: "Закрыть",
    });

    // Promotion of the month
    const t0 = nvYmd(today);
    const promo = [
      {
        month: nvDay(t0.y, t0.m, 1),
        channel: "Реклама Telegram",
        campaign: "tgads-uz-1",
        spend: 897750,
        note: "Демо",
        demo: true,
      },
      {
        month: nvDay(t0.y, t0.m, 1),
        channel: "Посев в Telegram",
        campaign: "seed-1",
        spend: 750000,
        note: "Демо",
        demo: true,
      },
      {
        month: nvDay(t0.y, t0.m - 1, 1),
        channel: "Instagram-реклама",
        campaign: "igads-dec",
        spend: 1730000,
        note: "Демо",
        demo: true,
      },
    ];

    // Write everything in one batch per sheet
    const bump = (prefix, n, demo) => {
      nvScriptProps().setProperty(nvCounterKey(prefix, year, demo), String(n));
    };
    nvAppendRows("clients", clients);
    nvAppendRows("leads", leads);
    nvAppendRows("orders", orders);
    nvAppendRows("payments", payments);
    nvAppendRows("purchases", purchases);
    nvAppendRows("warranty", warranty);
    nvAppendRows("reserves", reserves);
    nvAppendRows("promo", promo);
    // The history is sorted by the time of the events
    history.sort((a, b) => a.time.getTime() - b.time.getTime());
    nvAppendRows("history", history);
    ["K", "L", "NV", "P", "Z", "G"].forEach((p) => {
      bump(p, counters[p], true);
    });
    orders.forEach((o) => {
      nvRefreshOrderActions(o.num);
    });
    warranty.forEach((w) => {
      nvSetActionValidation(
        "warranty",
        nvReadTable("warranty").find((x) => x.num === w.num)._row,
        nvWarrantyActionLabels(w.status),
      );
    });
    return {
      ok: true,
      clients: clients.length,
      leads: leads.length,
      orders: orders.length,
      payments: payments.length,
      purchases: purchases.length,
      warranty: warranty.length,
      reserves: reserves.length,
      history: history.length,
    };
  });
}
