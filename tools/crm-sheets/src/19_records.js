/**
 * Records: leads, payments, purchases and warranty cases. Creation, the rules of a row, the conversion of a lead.
 * The same functions serve the owner's forms, the "onEdit" trigger and the webhook.
 */

/* ---------------------------------------------------------------- leads */

/** Creates a lead L-ГГГГ-NNNN. opts.number: the number of the platform (it is senior; the counter is raised to it). */
function nvCreateLead(fields, opts) {
  const o = opts || {};
  const now = o.now || nvNow();
  return nvWithLock(() => {
    const write = (num) => {
      const scope = nvScopeByLabel(fields.scope);
      const client =
        fields.client ||
        (fields.name || fields.tg
          ? nvEnsureClient(
              {
                name: fields.name,
                tg: fields.tg,
                lang: fields.lang,
                district: fields.district,
                channel: fields.channel,
                ref: fields.clientRef,
                adminUrl: "",
              },
              { demo: o.demo },
            )
          : "");
      nvAppendRow("leads", {
        num: num,
        created: nvToDate(fields.created) || now,
        channel: fields.channel || "",
        source: fields.source || "",
        client: client,
        name: fields.name || "",
        tg: nvNormalizeTg(fields.tg),
        lang: fields.lang || "",
        district: fields.district || "",
        scope: scope ? scope.label : fields.scope || "",
        band: fields.band || "",
        budget: fields.budget || "",
        wanted: nvToDate(fields.wanted) || "",
        status: "Новая",
        reason: "",
        firstReply: "",
        next: fields.next || "",
        nextDate: nvToDate(fields.nextDate) || "",
        order: "",
        config: fields.config || "",
        note: fields.note || "",
        src: o.src || "Вручную",
        updated: now,
        demo: !!o.demo,
      });
      nvHistoryAppend({
        time: now,
        object: "Заявка",
        num: num,
        from: "",
        to: "Новая",
        event: "LEAD_CREATED",
        eventLabel: "Заявка создана",
        actor: o.actorLabel || "Владелец",
        how: o.how || "Вручную",
        eventId: o.eventId || "",
      });
      return num;
    };
    if (o.number) {
      nvBumpCounter(o.number);
      return write(o.number);
    }
    return nvIssueNumber("L", { date: now, demo: o.demo }, write);
  });
}

/** Rules of a lead row after an edit: the time of the first reply, the updated stamp. Returns messages for the owner. */
function nvLeadAfterEdit(rowNo, oldStatus) {
  const lead = nvReadTable("leads").find((l) => l._row === rowNo);
  if (!lead) return [];
  const now = nvNow();
  const set = { updated: now };
  const msgs = [];
  if (lead.status !== "Новая" && nvStr(lead.firstReply) === "" && lead.status !== "") set.firstReply = now;
  if (lead.status === "Отказ" && nvStr(lead.reason) === "")
    msgs.push("Укажите причину отказа: без неё заявка не считается закрытой");
  nvWriteCells("leads", rowNo, set);
  if (oldStatus !== undefined && oldStatus !== lead.status && lead.status !== "") {
    nvHistoryAppend({
      time: now,
      object: "Заявка",
      num: lead.num,
      from: oldStatus || "Новая",
      to: lead.status,
      event: "LEAD_STATUS",
      eventLabel: "Статус заявки",
      actor: "Владелец",
      how: "Вручную",
      reason: lead.reason || "",
    });
  }
  return msgs;
}

/** A lead becomes an order: client found or created, order in "Смета: черновик", the number written back. */
function nvConvertLead(num, opts) {
  const o = opts || {};
  return nvWithLock(() => {
    const lead = nvReadTable("leads").find((l) => l.num === num);
    if (!lead) return { ok: false, error: "lead_not_found" };
    if (nvStr(lead.order)) return { ok: true, order: lead.order, existing: true };
    const now = nvNow();
    const client =
      lead.client ||
      nvEnsureClient(
        { name: lead.name, tg: lead.tg, lang: lead.lang, district: lead.district, channel: lead.channel },
        { demo: lead.demo === true },
      );
    const scope = nvScopeByLabel(lead.scope);
    const kind = scope ? scope.kind : "ПК";
    const order = nvCreateOrder(
      {
        lead: num,
        client: client,
        kind: kind,
        nextStep: "Собрать смету",
        notes: lead.config ? "Код сборки: " + lead.config : "",
      },
      { demo: lead.demo === true, now: now },
    );
    nvWriteCells("leads", lead._row, {
      order: order,
      client: client,
      status: "В заказе",
      firstReply: nvStr(lead.firstReply) ? lead.firstReply : now,
      updated: now,
    });
    nvHistoryAppend({
      time: now,
      object: "Заявка",
      num: num,
      from: lead.status,
      to: "В заказе",
      event: "LEAD_CONVERTED",
      eventLabel: "Заявка превращена в заказ",
      actor: o.actorLabel || "Владелец",
      how: o.how || "Вручную",
      reason: order,
    });
    return { ok: true, order: order, client: client };
  });
}

/* ---------------------------------------------------------------- payments */

/** Creates a payment P-ГГГГ-NNNN (the id of the platform if given). Checks the pair kind x method x direction. */
function nvCreatePayment(fields, opts) {
  const o = opts || {};
  const now = o.now || nvNow();
  return nvWithLock(() => {
    const kind = nvPaymentKindByLabel(fields.kind);
    const method = fields.method || (kind && kind.methods.length === 1 ? kind.methods[0] : "");
    const write = (id) => {
      nvAppendRow("payments", {
        id: id,
        order: fields.order || "",
        kind: kind ? kind.label : fields.kind || "",
        method: method,
        amount: fields.amount || "",
        status: fields.status || "Ожидается",
        date: nvToDate(fields.date) || now,
        receipt: fields.receipt || "",
        bankDoc: fields.bankDoc || "",
        payerIsClient: fields.payerIsClient !== false,
        thirdParty: fields.thirdParty || "",
        confirmedBy: fields.status === "Подтверждён" ? fields.confirmedBy || "Владелец" : "",
        confirmedAt: fields.status === "Подтверждён" ? nvToDate(fields.confirmedAt) || now : "",
        reversal: fields.reversal || "",
        voidReason: fields.voidReason || "",
        src: o.src || "Вручную",
        demo: !!o.demo,
      });
      return id;
    };
    const id = o.number ? write(o.number) : nvIssueNumber("P", { date: now, demo: o.demo }, write);
    if (fields.order) nvSyncAcceptedFlags(fields.order, { how: o.how });
    return id;
  });
}

/**
 * Rules of a payment row after an edit. Returns messages; may revert a status that is not allowed.
 * `old` is {key: oldValue} of the edited column.
 */
function nvPaymentAfterEdit(rowNo, editedKey, oldValue) {
  const pay = nvReadTable("payments").find((p) => p._row === rowNo);
  if (!pay) return [];
  const msgs = [];
  const set = {};
  const kind = nvPaymentKindByLabel(pay.kind);
  if (editedKey === "kind" && kind && kind.methods.length === 1) set.method = kind.methods[0];
  if (editedKey === "kind" && kind && kind.methods.indexOf(pay.method) < 0 && kind.methods.length > 1) set.method = "";
  const method = set.method !== undefined ? set.method : pay.method;
  if (editedKey === "status" || editedKey === "receipt" || editedKey === "method") {
    if (pay.status === "Подтверждён") {
      const check = nvCheckPayment(pay.kind, method, pay.status, pay.receipt);
      if (check !== "ОК") {
        set.status = oldValue && oldValue !== "Подтверждён" ? oldValue : "Ожидается";
        msgs.push("Платёж не подтверждён: " + check);
      } else {
        if (nvStr(pay.confirmedAt) === "") set.confirmedAt = nvNow();
        if (nvStr(pay.confirmedBy) === "") set.confirmedBy = "Владелец";
        if (pay.payerIsClient !== true && nvStr(pay.thirdParty) === "")
          msgs.push("Плательщик не клиент и нет заявления третьего лица: проверьте платёж (защита от мошенничества)");
      }
    }
    if (pay.status === "Аннулирован" && nvStr(pay.voidReason) === "") {
      set.status = oldValue && oldValue !== "Аннулирован" ? oldValue : "Ожидается";
      msgs.push("Для аннулирования укажите причину");
    }
  }
  if (nvStr(pay.id) === "") {
    // A row typed by hand without an id: the script issues it.
  }
  nvWriteCells("payments", rowNo, set);
  if (pay.order) nvSyncAcceptedFlags(pay.order);
  return msgs;
}

/* ---------------------------------------------------------------- purchases */

/** Creates a purchase (a receipt) of an order. */
function nvCreatePurchase(fields, opts) {
  const o = opts || {};
  const now = o.now || nvNow();
  return nvWithLock(() => {
    const write = (id) => {
      nvAppendRow("purchases", {
        id: id,
        order: fields.order || "",
        item: fields.item || "",
        category: fields.category || "",
        shop: fields.shop || "",
        qty: fields.qty || 1,
        amount: fields.amount || "",
        paidWith: fields.paidWith || "",
        docKind: fields.docKind || "",
        receipt: fields.receipt || "",
        esf: fields.esf || "",
        esfStatus: fields.esfStatus || (fields.esf ? "Ожидается" : ""),
        discount: fields.discount || 0,
        bonus: fields.bonus || "",
        serials: fields.serials || "",
        warrantyMonths: fields.warrantyMonths || "",
        photo: fields.photo || "",
        verified: fields.verified === true,
        bought: nvToDate(fields.bought) || nvToday(),
        boughtBy: fields.boughtBy || "Владелец",
        src: o.src || "Вручную",
        demo: !!o.demo,
      });
      return id;
    };
    const id = o.number ? write(o.number) : nvIssueNumber("Z", { date: now, demo: o.demo }, write);
    if (fields.order) nvPurchaseHistory(fields.order, id, fields, o);
    return id;
  });
}

/** The history row "Чек записан" (the event stays in the status "Закупка"). Returns the warnings of the limit. */
function nvPurchaseHistory(orderNum, purchaseId, fields, opts) {
  const ctx = nvLoadOrderContext(orderNum);
  if (!ctx) return [];
  const label = ctx.order.status;
  nvHistoryAppend({
    object: "Заказ",
    num: orderNum,
    from: label,
    to: label,
    event: "PURCHASE_RECORDED",
    eventLabel: "Чек записан",
    actor: fields.boughtBy === "Помощник" ? "Помощник" : "Владелец",
    how: opts?.how || "Вручную",
    reason: purchaseId,
  });
  return nvPurchaseWarnings(ctx);
}

/** Warnings about the receipts of an order: more than the money received (never), more than the limit (consent). */
function nvPurchaseWarnings(ctx) {
  const msgs = [];
  const st = ctx.state;
  if (ctx.order.code !== "purchasing" && st.purchaseCount > 0)
    msgs.push("Чек добавлен вне статуса «Закупка»: PURCHASE_RECORDED допустим только при закупке");
  if (st.receipts > st.fundsGot)
    msgs.push(
      "Чеки больше полученных денег (" + st.receipts + " > " + st.fundsGot + "): своими деньгами за клиента не платим",
    );
  else if (st.receipts > st.quote.purchaseLimit) msgs.push("Чеки выше лимита закупки: получите согласие клиента");
  return msgs;
}

function nvPurchaseAfterEdit(rowNo) {
  const p = nvReadTable("purchases").find((x) => x._row === rowNo);
  if (!p) return [];
  const set = {};
  if (nvStr(p.bought) === "") set.bought = nvToday();
  if (nvStr(p.esf) !== "" && nvStr(p.esfStatus) === "") set.esfStatus = "Ожидается";
  nvWriteCells("purchases", rowNo, set);
  const msgs = [];
  if (p.docKind !== "Без чека с согласием" && nvStr(p.receipt) === "" && nvStr(p.esf) === "")
    msgs.push("Нужен № чека или № ЭСФ (кроме «Без чека с согласием»)");
  if (p.order) {
    const ctx = nvLoadOrderContext(p.order);
    if (!ctx) msgs.push("Заказ " + p.order + " не найден");
    else
      nvPurchaseWarnings(ctx).forEach((m) => {
        msgs.push(m);
      });
  }
  return msgs;
}

/* ---------------------------------------------------------------- warranty */

function nvWarrantyStatusByLabel(label) {
  return NV_WARRANTY_STATUSES.find((s) => s.label === label || s.code === label) || null;
}

/** Allowed events of a warranty status (labels). */
function nvWarrantyActionLabels(statusLabel) {
  const st = nvWarrantyStatusByLabel(statusLabel);
  if (!st) return [];
  return NV_WARRANTY_TRANSITIONS.filter((t) => t.from === st.code).map(
    (t) => NV_WARRANTY_EVENTS.find((e) => e.code === t.event).label,
  );
}

/** Opens a warranty case G-ГГГГ-NNNN with the terms of the domain (or of the platform: deadlines override). */
function nvCreateWarranty(fields, opts) {
  const o = opts || {};
  const opened = nvToDate(fields.opened) || o.now || nvNow();
  return nvWithLock(() => {
    const d = nvWarrantyDeadlines(opened, nvHolidays());
    const dl = fields.deadlines || {};
    const pick = (k, fallback) => nvToDate(dl[k]) || fallback;
    const fixType = fields.fixType || "";
    const write = (num) => {
      const row = nvAppendRow("warranty", {
        num: num,
        order: fields.order || "",
        purchase: fields.purchase || "",
        opened: opened,
        channel: fields.channel || "",
        desc: fields.desc || "",
        status: "Открыт",
        action: "",
        fixType: fixType,
        replyBy: pick("reply", d.reply),
        diagBy: pick("diagnosis", d.diagnosis),
        loanerBy: pick("loaner", d.loaner),
        fixBy: fixType === "Детали" ? pick("fix_parts", d.fixParts) : pick("fix_work", d.fixWork),
        src: o.src || "Вручную",
        demo: !!o.demo,
      });
      nvSetActionValidation("warranty", row, nvWarrantyActionLabels("Открыт"));
      nvHistoryAppend({
        time: opened,
        object: "Гарантия",
        num: num,
        from: "",
        to: "Открыт",
        event: "WARRANTY_OPENED",
        eventLabel: "Гарантийный случай открыт",
        actor: o.actorLabel || "Владелец",
        how: o.how || "Вручную",
        eventId: o.eventId || "",
        reason: fields.order || "",
      });
      return num;
    };
    if (o.number) {
      nvBumpCounter(o.number);
      return write(o.number);
    }
    return nvIssueNumber("G", { date: opened, demo: o.demo }, write);
  });
}

/** Applies an event to a warranty case. Returns {ok, error?, text?}. */
function nvApplyWarrantyEvent(num, eventCode, opts) {
  const o = opts || {};
  return nvWithLock(() => {
    const now = o.now || nvNow();
    const row = nvReadTable("warranty").find((w) => w.num === num);
    if (!row) return { ok: false, error: "case_not_found" };
    const st = nvWarrantyStatusByLabel(row.status);
    const t = NV_WARRANTY_TRANSITIONS.find((x) => x.from === st.code && x.event === eventCode);
    if (!t)
      return {
        ok: false,
        error: "invalid_transition",
        text: "Из «" + row.status + "» доступно: " + (nvWarrantyActionLabels(row.status).join(", ") || "ничего"),
      };
    if (
      eventCode === "REJECT" &&
      (!NV_WARRANTY_FAULTS.some((f) => f.label === row.fault) || nvStr(row.evidence) === "")
    ) {
      return {
        ok: false,
        error: "fault_evidence_missing",
        text: "Отказ только с виной клиента и доказательствами: заполните «Вина клиента» и «Доказательства»",
      };
    }
    if (eventCode === "ISSUE_LOANER" && nvStr(row.loanerItem) === "")
      return { ok: false, error: "loaner_missing", text: "Выберите подменный товар" };
    const to = NV_WARRANTY_STATUSES.find((s) => s.code === t.to);
    const set = { status: to.label };
    if (eventCode === "CLOSE") set.closed = nvToday();
    nvWriteCells("warranty", row._row, set);
    if (eventCode === "CLOSE" && Number(row.cost) > 0) {
      nvLedgerAppend({
        date: now,
        fund: "Гарантийный",
        ref: num,
        amount: -Number(row.cost),
        basis: "Расход на гарантийный случай",
        who: "Скрипт",
        demo: row.demo === true,
      });
    }
    nvSetActionValidation("warranty", row._row, nvWarrantyActionLabels(to.label));
    const label = NV_WARRANTY_EVENTS.find((e) => e.code === eventCode).label;
    nvHistoryAppend({
      time: now,
      object: "Гарантия",
      num: num,
      from: row.status,
      to: to.label,
      event: eventCode,
      eventLabel: label,
      actor: NV_ACTOR_LABEL[o.actor || "owner"] || "Владелец",
      how: o.how || "Вручную",
      reason: nvStr(o.reason),
    });
    return { ok: true, status: to.label };
  });
}

/** Rules of a warranty row after an edit: the terms for a manually typed opening time. */
function nvWarrantyAfterEdit(rowNo, editedKey) {
  const w = nvReadTable("warranty").find((x) => x._row === rowNo);
  if (!w) return [];
  const set = {};
  const opened = nvToDate(w.opened);
  if (opened && (editedKey === "opened" || editedKey === "fixType")) {
    const d = nvWarrantyDeadlines(opened, nvHolidays());
    set.replyBy = d.reply;
    set.diagBy = d.diagnosis;
    set.loanerBy = d.loaner;
    set.fixBy = w.fixType === "Детали" ? d.fixParts : d.fixWork;
  }
  if (nvStr(w.status) === "") {
    set.status = "Открыт";
    nvSetActionValidation("warranty", rowNo, nvWarrantyActionLabels("Открыт"));
  }
  nvWriteCells("warranty", rowNo, set);
  return [];
}
