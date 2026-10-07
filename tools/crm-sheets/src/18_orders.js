/**
 * Orders: the money state of an order (from Платежи and Закупки), the creation, and the automaton of the statuses.
 * One function changes a status: nvApplyOrderEvent. The menu, the "Действие" column and the webhook all call it.
 */

/** Estimate inputs of an order row as numbers. */
function nvOrderInputs(o) {
  const n = (v) => {
    const x = nvNum(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
  };
  return {
    kind: nvStr(o.kind) || "ПК",
    basePc: n(o.basePc),
    baseMount: n(o.baseMount),
    outside: n(o.outside),
    purchased: n(o.purchased),
    memory: n(o.memory),
    complex: o.complex === true,
    freeWindow: nvStr(o.slot) === "Свободное окно",
  };
}

/**
 * Money state of one order from its payments and purchases (the same sums as the formula columns).
 * `orders` is needed only for the "first order of the client" flag.
 */
function nvOrderState(o, payments, purchases, orders, s, holidays) {
  const set = s || nvSettings();
  const q = nvComputeQuote(nvOrderInputs(o), set);
  const own = (payments || []).filter((p) => p.order === o.num);
  const confirmed = (p) => p.status === "Подтверждён";
  const sumOf = (pred) => own.filter((p) => confirmed(p) && pred(p)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const kindOf = (p) => nvPaymentKindByLabel(p.kind);
  const groupOf = (p) => (kindOf(p) ? kindOf(p).group : "");
  const advancePaid = own
    .filter((p) => confirmed(p) && p.kind === "Аванс платы 30 %" && nvStr(p.receipt) !== "")
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const fundsGot = sumOf((p) => groupOf(p) === "Закупка");
  const receipts = (purchases || []).filter((p) => p.order === o.num).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const purchaseCount = (purchases || []).filter((p) => p.order === o.num).length;
  const refunded = sumOf((p) => groupOf(p) === "Возврат денег");
  const feeNet = sumOf((p) => groupOf(p) === "Плата") - sumOf((p) => groupOf(p) === "Возврат платы");
  const remainder = fundsGot - receipts - refunded;
  const fundsOk = q.purchaseLimit > 0 && fundsGot >= q.purchaseLimit;
  let notBefore = null;
  if (fundsOk) {
    let latest = null;
    own.forEach((p) => {
      if (confirmed(p) && groupOf(p) === "Закупка") {
        const d = nvToDate(p.confirmedAt) || nvToDate(p.date);
        if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
      }
    });
    if (latest) notBefore = nvNextWorkingDayStart(latest, holidays || nvHolidays(), nvParseHm(set.responseFrom));
  }
  const created = nvToDate(o.created);
  const firstOrder = !(orders || []).some(
    (x) =>
      x.client &&
      x.client === o.client &&
      x.num !== o.num &&
      x.code !== "cancelled" &&
      nvToDate(x.created) &&
      created &&
      nvToDate(x.created).getTime() < created.getTime(),
  );
  const meetingNeeded = firstOrder && q.grandTotal >= set.meetingFrom;
  const finalPaid = own.some((p) => confirmed(p) && p.kind === "Финал платы 70 %" && nvStr(p.receipt) !== "");
  const podborPaid = own.some((p) => confirmed(p) && p.kind === "Плата «Подбор»" && nvStr(p.receipt) !== "");
  return {
    quote: q,
    feePaid: advancePaid >= q.advance,
    advancePaid: advancePaid,
    fundsGot: fundsGot,
    fundsOk: fundsOk,
    notBefore: notBefore,
    firstOrder: firstOrder,
    meetingNeeded: meetingNeeded,
    receipts: receipts,
    purchaseCount: purchaseCount,
    refunded: refunded,
    remainder: remainder,
    feeNet: feeNet,
    // The rule of the domain: money received = receipts + refunded (nothing received and nothing spent also reconciles)
    reconciled: fundsGot === receipts + refunded,
    recon: fundsGot === 0 ? "—" : fundsGot === receipts + refunded ? "Сходится" : "Остаток " + remainder + " сум",
    finalPaid: finalPaid,
    podborPaid: podborPaid,
  };
}

/** Loads everything an order needs: the row, the payments, the purchases, all orders (for the first-order flag). */
function nvLoadOrderContext(num) {
  const orders = nvReadTable("orders");
  const order = orders.find((r) => r.num === num);
  if (!order) return null;
  const payments = nvReadTable("payments");
  const purchases = nvReadTable("purchases");
  const s = nvSettings();
  const holidays = nvHolidays();
  return {
    order: order,
    orders: orders,
    payments: payments,
    purchases: purchases,
    settings: s,
    holidays: holidays,
    state: nvOrderState(order, payments, purchases, orders, s, holidays),
  };
}

/* ---------------------------------------------------------------- creation */

/** Creates an order in "Смета: черновик". Returns the number. */
function nvCreateOrder(fields, opts) {
  const o = opts || {};
  const now = o.now || nvNow();
  return nvWithLock(() => {
    let rowNo = 0;
    const issue = o.number
      ? (cb) => {
          nvBumpCounter(o.number);
          return cb(o.number);
        }
      : (cb) => nvIssueNumber("NV", { date: now, demo: o.demo }, cb);
    const number = issue((num) => {
      const kind = nvStr(fields.kind) || "ПК";
      rowNo = nvAppendRow("orders", {
        num: num,
        created: now,
        lead: fields.lead || "",
        client: fields.client || "",
        kind: kind,
        slot: fields.slot || "Обычный",
        complex: !!fields.complex,
        furn: !!fields.furn,
        status: nvStatusByCode("estimate_draft").label,
        action: "",
        code: "estimate_draft",
        basePc: fields.basePc || 0,
        baseMount: fields.baseMount || 0,
        outside: fields.outside || 0,
        purchased: fields.purchased || 0,
        memory: fields.memory || 0,
        meetingDone: false,
        reportAccepted: "",
        nextStep: fields.nextStep || "",
        nextDate: fields.nextDate || "",
        adminUrl: fields.adminUrl || "",
        tgTopic: fields.tgTopic || "",
        notes: fields.notes || "",
        src: o.src || "Вручную",
        seq: o.seq === undefined ? "" : o.seq,
        updated: now,
        demo: !!o.demo,
      });
      return num;
    });
    nvRefreshOrderActions(number);
    nvHistoryAppend({
      time: now,
      object: "Заказ",
      num: number,
      from: "",
      to: nvStatusByCode("estimate_draft").label,
      event: "ORDER_CREATED",
      eventLabel: "Заказ создан",
      actor: o.actorLabel || "Владелец",
      how: o.how || "Вручную",
      reason: fields.lead ? "Из заявки " + fields.lead : "",
    });
    return number;
  });
}

/** Puts the list of the allowed events of the current status into the "Действие" cell of an order. */
function nvRefreshOrderActions(num) {
  const ctx = nvLoadOrderContext(num);
  if (!ctx) return;
  const labels = nvActionLabels(ctx.order, ctx.state);
  nvSetActionValidation("orders", ctx.order._row, labels);
}

/** The events the owner may pick in a status; a flag event that is already done is not offered again. */
function nvActionLabels(order, state) {
  const st = order.code;
  const list = nvAllowedEvents(st).filter((ev) => {
    if (st === "accepted") {
      if (ev.code === "FEE_PREPAID" && state && state.feePaid && nvOrderFlagLogged(order.num, "FEE_PREPAID"))
        return false;
      if (ev.code === "FUNDS_RECEIVED" && state && state.fundsOk && nvOrderFlagLogged(order.num, "FUNDS_RECEIVED"))
        return false;
      if (ev.code === "MEETING_DONE" && order.meetingDone === true) return false;
    }
    if (ev.code === "PODBOR_DELIVERED" && order.kind !== "Подбор") return false;
    if (ev.code === "ACCEPT" && order.kind === "Подбор") return false;
    if (ev.code === "SEND_ESTIMATE" || ev.code === "REVISE") return true;
    return true;
  });
  return list.map((e) => e.label);
}

/** Has this flag event been written to the history of the order already. */
function nvOrderFlagLogged(num, eventCode) {
  return nvReadTable("history").some((h) => h.num === num && h.event === eventCode);
}

/* ---------------------------------------------------------------- the automaton */

/** Texts the owner must give for an event: name of the note and the prompt. */
const NV_EVENT_INPUT = {
  ACCEPT: "Ссылка на подтверждение клиента (чат, сообщение)",
  OBJECTION: "Текст возражения клиента",
  MATERIALS_ACCEPTED: "Номер акта приёма материала",
  TESTS_PASSED: "Номер паспорта сборки",
  HANDOVER: "Номер акта сдачи",
  CANCEL: "Причина отмены по заявлению клиента",
};

/** Violations of the soft checks before an event: [{code, text, hard}]. */
function nvOrderChecks(ctx, eventCode, input, now) {
  const o = ctx.order;
  const st = ctx.state;
  const out = [];
  const add = (code, text, hard) => out.push({ code: code, text: text, hard: !!hard });
  const q = st.quote;
  switch (eventCode) {
    case "SEND_ESTIMATE":
      if (q.grandTotal <= 0) add("estimate_empty", "Смета пуста: заполните базы и закупку");
      if (
        o.kind !== "Подбор" &&
        (q.eligibility.indexOf("Только «Подбор»") === 0 || q.eligibility === "Сетап ниже минимума")
      )
        add("not_eligible", "Допуск: " + q.eligibility);
      break;
    case "ACCEPT": {
      const until = nvToDate(o.validUntil);
      if (!until || now.getTime() > until.getTime())
        add("estimate_expired", "Смета истекла или без срока: пересмотрите смету");
      if (!nvStr(input)) add("consent_missing", "Нужна ссылка на подтверждение клиента");
      if (o.kind === "Подбор") add("invalid_transition", "«Подбор» не принимается в закупку", true);
      break;
    }
    case "FEE_PREPAID":
      if (!st.feePaid) add("payments_incomplete", "Нет подтверждённого аванса платы с фискальным чеком");
      break;
    case "FUNDS_RECEIVED":
      if (!st.fundsOk)
        add(
          "payments_incomplete",
          "Деньги на закупку получены не полностью: " + st.fundsGot + " из " + q.purchaseLimit,
        );
      break;
    case "START_PURCHASE":
      if (!st.feePaid || !st.fundsOk) add("payments_incomplete", "Нужны оба флага: аванс платы и деньги на закупку");
      if (!st.notBefore || now.getTime() < st.notBefore.getTime())
        add(
          "purchase_too_early",
          "Закупка не раньше " + (st.notBefore ? nvFormat(st.notBefore, "dd.MM.yyyy HH:mm") : "поступления денег"),
        );
      if (st.meetingNeeded && o.meetingDone !== true)
        add("meeting_required", "Первый заказ от 15 млн: нужна встреча или видеозвонок");
      break;
    case "PURCHASE_RECORDED":
      if (st.receipts > st.fundsGot)
        add("funds_exceeded", "Чеки больше полученных денег: своими деньгами за клиента не платим", true);
      else if (st.receipts > q.purchaseLimit) add("limit_exceeded", "Чеки выше лимита закупки: нужно согласие клиента");
      break;
    case "PURCHASE_DONE":
      if (st.purchaseCount === 0) add("purchases_incomplete", "По заказу нет ни одного чека");
      break;
    case "SEND_REPORT":
      if (st.purchaseCount === 0) add("purchases_incomplete", "По заказу нет ни одного чека");
      break;
    case "OBJECTION": {
      if (!nvStr(input)) add("invalid_transition", "Нужен текст возражения", true);
      const until = nvToDate(o.objectionUntil);
      if (until && now.getTime() > until.getTime()) add("invalid_transition", "Срок возражений истёк", true);
      break;
    }
    case "REPORT_ACCEPTED":
      if (nvStr(o.objection)) add("report_objection_open", "Есть открытое возражение клиента");
      break;
    case "REPORT_DEEMED_ACCEPTED": {
      const until = nvToDate(o.objectionUntil);
      if (nvStr(o.objection)) add("report_objection_open", "Есть открытое возражение клиента", true);
      if (!until || now.getTime() <= until.getTime())
        add("report_objection_open", "Срок возражений ещё не истёк", true);
      break;
    }
    case "REMAINDER_SETTLED":
      if (nvStr(o.reportAccepted) === "" || nvStr(o.reportAccepted) === "Нет" || nvStr(o.objection))
        add("report_objection_open", "Отчёт не принят или есть возражение");
      if (!st.reconciled) add("not_reconciled", "Сверка не сходится: " + st.recon);
      break;
    case "MATERIALS_ACCEPTED":
      if (!nvStr(input)) add("act_missing", "Нужен номер акта приёма материала");
      break;
    case "TESTS_PASSED":
      if (!nvStr(input)) add("passport_missing", "Нужен номер паспорта сборки");
      break;
    case "HANDOVER":
      if (!nvStr(input)) add("act_missing", "Нужен номер акта сдачи");
      if (!st.finalPaid) add("final_payment_missing", "Нет подтверждённого финала платы с фискальным чеком");
      break;
    case "CLOSE":
      if (nvStr(o.objection)) add("report_objection_open", "Есть открытое возражение клиента", true);
      if (!st.reconciled) add("not_reconciled", "Сверка не сходится: " + st.recon);
      break;
    case "PODBOR_DELIVERED":
      if (o.kind !== "Подбор") add("invalid_transition", "Только для вида «Подбор»", true);
      if (!st.podborPaid) add("payments_incomplete", "Нет подтверждённой платы «Подбор» с фискальным чеком");
      break;
    case "CANCEL": {
      if (!nvStr(input)) add("cancel_reason_missing", "Нужна причина отмены");
      const point = nvCancelPointFor(o.code);
      if (!point) add("invalid_transition", "Из этого статуса отмена не предусмотрена", true);
      if (point === "during_assembly") {
        const done = Number(o.doneBp);
        if (o.doneBp === "" || !Number.isInteger(done) || done < 0 || done > 10000)
          add("assembly_done_missing", "Укажите «Выполнено сборки, бп» (0–10 000)", true);
      }
      break;
    }
    case "CANCEL_SETTLED": {
      const owed = st.fundsGot - st.receipts - (Number(o.losses) || 0);
      if (owed > 0 && st.refunded < owed)
        add(
          "not_reconciled",
          "Клиенту возвращено меньше, чем «получено − чеки − потери»: " + st.refunded + " из " + owed,
        );
      break;
    }
    default:
      break;
  }
  return out;
}

/** Settlement of a cancellation. The point comes from the status, or is given (an order that is already in "Отмена: расчёт"). */
function nvCancelSettlement(ctx, now, pointCode) {
  const o = ctx.order;
  const st = ctx.state;
  const point = pointCode || nvCancelPointFor(o.code);
  if (!point) throw new RangeError("Точка отмены не определена для статуса " + o.code);
  return {
    point: point,
    settlement: nvSettleCancellation(
      {
        point: point,
        fee: st.quote.feeTotal,
        feePaid: Math.max(0, st.feeNet),
        fundsReceived: st.fundsGot,
        receiptsTotal: st.receipts,
        shopRefunds: Number(o.shopRefunds) || 0,
        documentedLosses: Number(o.losses) || 0,
        assemblyDoneBp: o.doneBp === "" || o.doneBp === undefined ? undefined : Number(o.doneBp),
      },
      ctx.settings,
      now,
      ctx.holidays,
    ),
  };
}

/**
 * Applies an event to an order. Returns {ok, error?, violations?, needConfirm?, status?}.
 * opts: actor (owner | assistant | customer | system | platform), how, force, reason, input (text of the event),
 * now, eventId, seq.
 */
function nvApplyOrderEvent(num, eventCode, opts) {
  const o = opts || {};
  return nvWithLock(() => {
    const now = o.now || nvNow();
    const actor = o.actor || "owner";
    const ctx = nvLoadOrderContext(num);
    if (!ctx) return { ok: false, error: "order_not_found" };
    const order = ctx.order;
    const t = nvFindTransition(order.code, eventCode);
    if (!t) {
      const allowed = nvActionLabels(order, ctx.state);
      return {
        ok: false,
        error: "invalid_transition",
        allowed: allowed,
        text: "Из «" + order.status + "» доступно: " + (allowed.join(", ") || "ничего"),
      };
    }
    const ev = nvEventByCode(eventCode);
    if (actor === "assistant" && NV_MONEY_EVENTS.indexOf(eventCode) >= 0)
      return { ok: false, error: "actor_not_allowed", text: "Денежные события недоступны помощнику" };
    if (!ev.ui && actor !== "system" && actor !== "platform")
      return { ok: false, error: "actor_not_allowed", text: "Это событие выполняет система" };
    const input = o.input !== undefined ? o.input : o.reason;
    const violations = actor === "platform" ? [] : nvOrderChecks(ctx, eventCode, input, now);
    const hard = violations.filter((v) => v.hard);
    if (hard.length)
      return { ok: false, error: hard[0].code, violations: violations, text: hard.map((v) => v.text).join("; ") };
    const forced = violations.length > 0;
    if (forced && !o.force)
      return {
        ok: false,
        needConfirm: true,
        error: violations[0].code,
        violations: violations,
        text: violations.map((v) => v.text).join("; "),
      };
    if (forced && !nvStr(o.reason))
      return {
        ok: false,
        error: "force_reason_missing",
        violations: violations,
        text: "Принудительное действие требует причину",
      };

    const s = ctx.settings;
    const set = {};
    const to = nvStatusByCode(t.to);
    const stamp = (key) => {
      if (key) set[key] = now;
    };
    set.status = to.label;
    set.code = to.code;
    set.updated = now;
    if (order.code !== t.to) stamp(to.dateKey);
    switch (eventCode) {
      case "SEND_ESTIMATE": {
        const hours = order.furn === true ? s.shelfHoursFurniture : s.shelfHours;
        set.validUntil = new Date(now.getTime() + hours * 3600000);
        break;
      }
      case "REVISE":
        set.validUntil = "";
        break;
      case "ACCEPT":
        set.notes = nvAppendNote(order.notes, "Принято от имени клиента: " + nvStr(input), now);
        break;
      case "MEETING_DONE":
        set.meetingDone = true;
        break;
      case "PURCHASE_DONE":
        set.reportTarget = new Date(now.getTime() + s.reportTargetHours * 3600000);
        set.reportDeadline = new Date(now.getTime() + s.reportDeadlineHours * 3600000);
        break;
      case "SEND_REPORT":
        set.reportSent = now;
        set.objectionUntil = nvAddWorkingDays(now, s.objectionDays, ctx.holidays);
        set.refundDue = nvAddWorkingDays(now, s.refundDays, ctx.holidays);
        set.reportAccepted = "Нет";
        break;
      case "OBJECTION":
        set.objection = nvStr(input);
        break;
      case "REPORT_ACCEPTED":
        set.reportAccepted = "Клиентом";
        break;
      case "REPORT_DEEMED_ACCEPTED":
        set.reportAccepted = "По сроку";
        break;
      case "HANDOVER":
        set.warrantyUntil = nvMidnightDate(nvAddMonths(now, s.warrantyMonths));
        set.aftercare1 = new Date(now.getTime() + s.aftercareShort * NV_DAY_MS);
        set.aftercare2 = new Date(now.getTime() + s.aftercareLong * NV_DAY_MS);
        break;
      case "PODBOR_DELIVERED":
        set.podborUntil = new Date(now.getTime() + s.podborCreditDays * NV_DAY_MS);
        break;
      case "CANCEL": {
        // The point comes from the status the order is in now, not from "Отмена: расчёт" that the event sets
        const res = nvCancelSettlement({ order: order, state: ctx.state, settings: s, holidays: ctx.holidays }, now);
        const pointLabel = NV_CANCEL_POINTS.find((p) => p.code === res.point).label;
        Object.assign(set, nvSettlementCells(res, pointLabel));
        set.cancelReason = nvStr(input);
        break;
      }
      default:
        break;
    }
    nvWriteCells("orders", order._row, set);
    // The ledger of the reserves
    if (eventCode === "REMAINDER_SETTLED") {
      const amount = nvTaxRiskReserve(ctx.state.receipts, s.taxRiskActive === true, s);
      nvLedgerAppend({
        date: now,
        fund: "Налоговый риск",
        ref: num,
        amount: amount,
        basis: "Взнос при сверке",
        who: "Скрипт",
        demo: order.demo === true,
      });
    }
    if (eventCode === "HANDOVER") {
      const fund = nvWarrantyFundState(order.demo === true, now);
      const amount = nvWarrantyContribution(ctx.state.receipts, fund, s);
      nvLedgerAppend({
        date: now,
        fund: "Гарантийный",
        ref: num,
        amount: amount,
        basis: "Взнос при сдаче",
        who: "Скрипт",
        demo: order.demo === true,
      });
    }
    nvHistoryAppend({
      time: now,
      object: "Заказ",
      num: num,
      from: order.status,
      to: to.label,
      event: eventCode,
      eventLabel: ev.label,
      actor: NV_ACTOR_LABEL[actor] || "Владелец",
      how: forced
        ? "Принудительно"
        : o.how || (actor === "platform" ? "Платформа" : actor === "system" ? "Система" : "Вручную"),
      reason: forced ? nvStr(o.reason) + " (нарушено: " + violations.map((v) => v.code).join(", ") + ")" : nvStr(input),
      eventId: o.eventId || "",
      seq: o.seq === undefined ? "" : o.seq,
    });
    nvRefreshOrderActions(num);
    return { ok: true, status: to.code, label: to.label, forced: forced, violations: violations };
  });
}

function nvAppendNote(old, text, now) {
  const stamp = nvFormat(now || nvNow(), "dd.MM.yyyy");
  const line = stamp + ": " + text;
  return nvStr(old) ? nvStr(old) + "\n" + line : line;
}

/** The cells of the cancellation block for a settlement. */
function nvSettlementCells(res, pointLabel) {
  const s = res.settlement;
  const parts = NV_CANCEL_PARTS.find((p) => p.code === s.partsGoTo);
  return {
    cancelPoint: pointLabel,
    feeEarned: s.feeEarned,
    feeToRefund: s.feeToRefund,
    feeToInvoice: s.feeToInvoice,
    fundsToRefund: s.fundsToRefund,
    partsTo: parts ? parts.label : "",
    cancelDue: s.dueBy,
  };
}

/** Menu: recalculates the cancellation block of an order in "Отмена: расчёт" (after the shop refunds and the losses are filled). */
function nvRecalculateCancel(num) {
  return nvWithLock(() => {
    const ctx = nvLoadOrderContext(num);
    if (!ctx) return { ok: false, error: "order_not_found" };
    const o = ctx.order;
    if (o.code === "cancelling") {
      const known = NV_CANCEL_POINTS.find((x) => x.label === nvStr(o.cancelPoint));
      if (!known) return { ok: false, error: "cancel_point_missing", text: "Не указана точка отмены" };
      const res = nvCancelSettlement(ctx, nvNow(), known.code);
      nvWriteCells("orders", o._row, Object.assign(nvSettlementCells(res, known.label), { updated: nvNow() }));
      return { ok: true, settlement: res.settlement, point: res.point };
    }
    const res = nvCancelSettlement(ctx, nvNow());
    return { ok: true, preview: true, settlement: res.settlement, point: res.point };
  });
}

/* ---------------------------------------------------------------- flags of "Принят" */

/**
 * After a payment or a flag changes: writes FEE_PREPAID and FUNDS_RECEIVED (and MEETING_DONE) into the history once,
 * by the same rules the formula columns use. The status stays "Принят" until the owner starts the purchase.
 */
function nvSyncAcceptedFlags(num, opts) {
  return nvWithLock(() => {
    const ctx = nvLoadOrderContext(num);
    if (ctx?.order.code !== "accepted") return [];
    const o = opts || {};
    const written = [];
    const log = (code, label, reason) => {
      if (nvOrderFlagLogged(num, code)) return;
      nvHistoryAppend({
        object: "Заказ",
        num: num,
        from: ctx.order.status,
        to: ctx.order.status,
        event: code,
        eventLabel: label,
        actor: "Система",
        how: o.how || "Вручную",
        reason: reason,
      });
      written.push(code);
    };
    if (ctx.state.feePaid) log("FEE_PREPAID", "Аванс получен", "Подтверждён аванс платы с фискальным чеком");
    if (ctx.state.fundsOk)
      log(
        "FUNDS_RECEIVED",
        "Деньги на закупку получены",
        "Получено " +
          ctx.state.fundsGot +
          " сум, закупка не раньше " +
          (ctx.state.notBefore ? nvFormat(ctx.state.notBefore, "dd.MM.yyyy HH:mm") : ""),
      );
    if (ctx.order.meetingDone === true) log("MEETING_DONE", "Встреча проведена", "Отмечено в заказе");
    if (written.length) nvRefreshOrderActions(num);
    return written;
  });
}
