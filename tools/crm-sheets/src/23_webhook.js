/**
 * The webhook of the platform: Apps Script web app, doPost. The protection is the signature, not the address.
 *
 * Request: POST {URL}?v=1&ts=<unix seconds>&sig=<hex>, body is JSON (UTF-8, up to 50 KB).
 * sig = hex(HMAC-SHA256(secret, ts + "." + raw body)); the key is the secret string as it is stored (UTF-8).
 * Order of the checks: size, ts is fresh (300 s), signature (constant time), JSON and envelope, environment,
 * type, lock, idempotency by the id of the event, apply, journal. The answer is always HTTP 200; the result is in the JSON.
 */

function doPost(e) {
  return nvWebhookHandle(e);
}

/** Length of a string in UTF-8 bytes. */
function nvUtf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function nvToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += nvPad((bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16), 2);
  return s;
}

/** hex(HMAC-SHA256(key, message)). */
function nvHmacHex(key, message) {
  return nvToHex(Utilities.computeHmacSha256Signature(message, key));
}

/** Comparison over all characters, without an early exit. */
function nvConstantTimeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** Keys that are accepted now: the current one and, for seven days after a change, the previous one. */
function nvWebhookKeys(now) {
  const props = nvScriptProps();
  const keys = [];
  const cur = props.getProperty(NV_PROP.hmacSecret);
  if (cur) keys.push(cur);
  const prev = props.getProperty(NV_PROP.hmacSecretPrev);
  const until = Number(props.getProperty("NIVEL_HMAC_SECRET_PREV_UNTIL") || 0);
  if (prev && until > now.getTime()) keys.push(prev);
  return keys;
}

function nvSha256Hex16(text) {
  return nvToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)).slice(0, 16);
}

/** Was the event seen: the cache (6 h), then the journal. */
function nvWebhookSeen(id) {
  const cache = CacheService.getScriptCache();
  if (cache.get("nv_evt_" + id)) return true;
  try {
    const rows = nvReadTable("webhook");
    return rows.slice(-2000).some((r) => r.eventId === id && (r.result === "Применено" || r.result === "Устарело"));
  } catch (e) {
    return false;
  }
}

/** Appends a row of the journal; the body of the event is never stored. */
function nvWebhookJournal(entry) {
  try {
    nvAppendRows("webhook", [entry]);
  } catch (e) {
    Logger.log("journal: " + (e?.message ? e.message : e));
  }
}

function nvJsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** The whole path of a request. `now` is for the tests. Returns the text output. */
function nvWebhookHandle(e, nowOverride) {
  const started = (nowOverride || nvNow()).getTime();
  const now = nowOverride || nvNow();
  const journalBase = {
    received: now,
    eventId: "",
    type: "",
    num: "",
    seq: "",
    sentAt: "",
    result: "Отклонено",
    error: "",
    hash: "",
    summary: "",
    ms: 0,
  };
  const finish = (res, entry) => {
    const row = Object.assign({}, journalBase, entry || {});
    row.ms = Math.max(0, (nowOverride ? now : nvNow()).getTime() - started);
    if (row.error === "locked") {
      // A busy lock: nothing is written, the platform repeats the same event.
      return nvJsonOut(res);
    }
    // Rejections are written at most 30 times per minute so that a flood cannot fill the journal.
    if (row.result === "Отклонено") {
      const cache = CacheService.getScriptCache();
      const bucket = "nv_rej_" + nvFormat(now, "yyyyMMddHHmm");
      const n = Number(cache.get(bucket) || 0) + 1;
      cache.put(bucket, String(n), 120);
      if (n > 30) return nvJsonOut(res);
    }
    try {
      nvWithLock(() => nvWebhookJournal(row), 5000);
    } catch (err) {
      Logger.log("journal lock: " + (err?.message ? err.message : err));
    }
    return nvJsonOut(res);
  };
  const reject = (error, id, summary, extra) =>
    finish(
      { ok: false, id: id || null, result: null, error: error },
      Object.assign({ error: error, eventId: id || "", summary: summary || "" }, extra || {}),
    );

  const body = e?.postData && typeof e.postData.contents === "string" ? e.postData.contents : "";
  const hash = nvSha256Hex16(body);
  if (nvUtf8Length(body) > NV_WEBHOOK.maxBodyBytes || body === "")
    return reject("bad_payload", "", "тело пустое или больше 50 КБ", { hash: hash });
  const params = e?.parameter || {};
  const tsRaw = String(params.ts || "");
  const ts = Number(tsRaw);
  const skew = Math.max(60, Number(nvSettings().hmacSkewSec) || NV_WEBHOOK.freshnessSec);
  if (!/^\d{9,11}$/.test(tsRaw) || Math.abs(now.getTime() / 1000 - ts) > skew)
    return reject("stale", "", "метка времени " + tsRaw, { hash: hash });
  const keys = nvWebhookKeys(now);
  const sig = String(params.sig || "");
  const message = tsRaw + "." + body;
  let valid = false;
  keys.forEach((k) => {
    if (nvConstantTimeEqual(nvHmacHex(k, message), sig)) valid = true;
  });
  if (!valid)
    return reject("bad_signature", "", keys.length ? "подпись не совпала" : "ключ вебхука не задан", { hash: hash });

  let ev;
  try {
    ev = JSON.parse(body);
  } catch (err) {
    return reject("bad_payload", "", "не JSON", { hash: hash });
  }
  const id = ev && typeof ev.id === "string" ? ev.id : "";
  const bad = (field) =>
    reject("bad_payload", id, "поле " + field, { hash: hash, type: ev?.type ? String(ev.type) : "" });
  if (!ev || typeof ev !== "object" || ev.v !== NV_WEBHOOK.version) return bad("v");
  if (!id) return bad("id");
  if (typeof ev.type !== "string") return bad("type");
  const sent = Date.parse(String(ev.sent_at || ""));
  if (!Number.isFinite(sent) || Math.abs(sent / 1000 - ts) > 1.5) return bad("sent_at");
  if (typeof ev.env !== "string") return bad("env");
  if (ev.env !== nvSettings().webhookEnv)
    return reject("wrong_env", id, "среда " + ev.env, { hash: hash, type: ev.type });
  if (NV_WEBHOOK_TYPES.indexOf(ev.type) < 0)
    return reject("unknown_type", id, "тип " + ev.type, { hash: hash, type: ev.type });
  if (!ev.data || typeof ev.data !== "object") return bad("data");

  let outcome;
  try {
    outcome = nvWithLock(() => {
      if (nvWebhookSeen(id)) return { result: "duplicate" };
      const r = nvWebhookApply(ev, now);
      if (r.result === "applied" || r.result === "stale_seq")
        CacheService.getScriptCache().put("nv_evt_" + id, "1", NV_WEBHOOK.cacheSeconds);
      return r;
    }, NV_WEBHOOK.lockWaitMs);
  } catch (err) {
    const msg = String(err?.message ? err.message : err);
    if (/lock/i.test(msg))
      return finish({ ok: false, id: id, result: null, error: "locked" }, { error: "locked", eventId: id });
    if (err?.nvField) return bad(err.nvField);
    return finish(
      { ok: false, id: id, result: null, error: "bad_payload" },
      { error: "bad_payload", eventId: id, type: ev.type, hash: hash, summary: msg.slice(0, 200) },
    );
  }
  nvScriptProps().setProperty(NV_PROP.lastWebhookAt, String(now.getTime()));
  const label =
    { applied: "Применено", duplicate: "Повтор", ignored: "Повтор", stale_seq: "Устарело" }[outcome.result] ||
    "Применено";
  return finish(
    { ok: true, id: id, result: outcome.result, error: null },
    {
      result: label,
      error: "",
      eventId: id,
      type: ev.type,
      num: outcome.num || "",
      seq: outcome.seq === undefined ? "" : outcome.seq,
      sentAt: new Date(sent),
      hash: hash,
      summary: outcome.summary || "",
    },
  );
}

/** A field that cannot be mapped: the webhook answers bad_payload and names the field. */
function nvFieldError(field, detail) {
  const err = new Error("поле " + field + (detail ? ": " + detail : ""));
  err.nvField = field + (detail ? " (" + detail + ")" : "");
  return err;
}

function nvWebhookApply(ev, now) {
  switch (ev.type) {
    case "lead.created":
      return nvApplyLeadCreated(ev, now);
    case "order.status_changed":
      return nvApplyOrderStatusChanged(ev, now);
    case "payment.confirmed":
      return nvApplyPaymentConfirmed(ev, now);
    case "purchase.recorded":
      return nvApplyPurchaseRecorded(ev, now);
    case "warranty.case_opened":
      return nvApplyWarrantyOpened(ev, now);
    default:
      throw nvFieldError("type", ev.type);
  }
}

/* ---------------------------------------------------------------- mapping of codes */

function nvMapScope(code) {
  const s = NV_SCOPES.find((x) => x.code === code);
  if (!s) throw nvFieldError("scope", String(code));
  return s;
}

function nvMapChannel(code) {
  const label = NV_CHANNEL_BY_PLATFORM[String(code || "").toLowerCase()];
  if (!label) throw nvFieldError("channel", String(code));
  return label;
}

function nvMapBand(code) {
  if (code === null || code === undefined || code === "") return "";
  const b = NV_BUDGET_BANDS.find((x) => x.code === code);
  if (!b) throw nvFieldError("budget_band", String(code));
  return b.label;
}

function nvMapKind(code) {
  const k = NV_KINDS.find((x) => x.code === code);
  if (!k) throw nvFieldError("kind", String(code));
  return k.label;
}

function nvMapStatus(code, field) {
  const s = nvStatusByCode(code);
  if (!s) throw nvFieldError(field || "status", String(code));
  return s;
}

function nvRequireString(v, field) {
  if (typeof v !== "string" || v === "") throw nvFieldError(field);
  return v;
}

function nvIsoToDate(v, field) {
  if (v === null || v === undefined || v === "") return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw nvFieldError(field, "дата");
  return d;
}

/** The client of the platform by customer.ref (found, or created with only the reference and the display name). */
function nvClientFromRef(customer, extra, demo) {
  if (!customer || typeof customer !== "object") return "";
  return nvEnsureClient(
    {
      ref: customer.ref,
      name: customer.display_name || "",
      tg: customer.telegram_username || "",
      lang: extra?.lang,
      district: extra?.district,
      channel: extra?.channel,
    },
    { demo: demo },
  );
}

/* ---------------------------------------------------------------- the five events */

function nvApplyLeadCreated(ev, now) {
  const d = ev.data;
  const num = nvRequireString(d.number, "number");
  if (nvParseNumber(num)?.prefix !== "L") throw nvFieldError("number", num);
  const existing = nvReadTable("leads").find((l) => l.num === num);
  if (existing) return { result: "ignored", num: num, summary: "заявка уже есть" };
  const scope = nvMapScope(d.scope);
  const channel = nvMapChannel(d.channel);
  const utm = d.utm?.campaign ? "utm:" + d.utm.campaign : "";
  const lang = d.lang === "uz" || d.lang === "ru" ? d.lang : "";
  const customer = d.customer || {};
  const clientCode = nvClientFromRef(customer, { lang: lang, district: d.district, channel: channel }, false);
  nvCreateLead(
    {
      created: nvIsoToDate(d.created_at, "created_at") || now,
      channel: channel,
      source: d.source_code || utm,
      client: clientCode,
      name: customer.display_name || "",
      tg: customer.telegram_username || "",
      lang: lang,
      district: d.district || "",
      scope: scope.label,
      band: nvMapBand(d.budget_band),
      wanted: d.wanted_by ? nvIsoToDate(d.wanted_by, "wanted_by") : "",
      config: d.configuration_code || "",
      note: [d.admin_url ? "Админка: " + d.admin_url : "", d.tg_topic_url ? "Тема: " + d.tg_topic_url : ""]
        .filter(Boolean)
        .join("\n"),
    },
    { number: num, src: "Платформа", how: "Платформа", actorLabel: "Платформа", eventId: ev.id, now: now },
  );
  return { result: "applied", num: num, summary: "заявка " + scope.label + ", " + channel };
}

function nvApplyOrderStatusChanged(ev, now) {
  const d = ev.data;
  const num = nvRequireString(d.number, "number");
  const parsed = nvParseNumber(num);
  if (parsed?.prefix !== "NV") throw nvFieldError("number", num);
  const seq = Number(d.seq);
  if (!Number.isInteger(seq) || seq < 0) throw nvFieldError("seq");
  const to = nvMapStatus(d.to, "to");
  const from = d.from ? nvMapStatus(d.from, "from") : null;
  const kind = nvMapKind(d.kind);
  const evInfo = nvEventByCode(d.event);
  if (d.event && !evInfo) throw nvFieldError("event", String(d.event));
  const at = nvIsoToDate(d.at, "at") || now;
  let row = nvReadTable("orders").find((o) => o.num === num);
  if (row && nvStr(row.seq) !== "" && seq <= Number(row.seq))
    return { result: "stale_seq", num: num, seq: seq, summary: "seq " + seq + " не новее " + row.seq };
  const q = d.quote || null;
  const set = {};
  if (q) {
    const num0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    set.basePc = q.pc_base !== undefined ? num0(q.pc_base) : num0(q.components_sum) - num0(q.mount_base);
    set.baseMount = num0(q.mount_base);
    set.outside = num0(q.outside_scale_sum);
    set.purchased =
      q.purchased_by_ip !== undefined
        ? num0(q.purchased_by_ip)
        : Math.max(0, num0(q.purchase_limit) - num0(q.reserve_sum));
    set.memory = num0(q.memory_ssd);
    if (q.valid_until) set.validUntil = nvIsoToDate(q.valid_until, "quote.valid_until");
    if (q.eligibility === "free_window_only") set.slot = "Свободное окно";
  }
  const dates = d.dates || {};
  const dmap = {
    report_due_at: "reportTarget",
    objection_until: "objectionUntil",
    refund_due_at: "refundDue",
    podbor_credit_until: "podborUntil",
  };
  Object.keys(dmap).forEach((k) => {
    if (dates[k]) set[dmap[k]] = nvIsoToDate(dates[k], "dates." + k);
  });
  if (dates.report_due_at && !set.reportDeadline)
    set.reportDeadline = new Date(set.reportTarget.getTime() + 24 * 3600000);
  if (dates.warranty_until)
    set.warrantyUntil = nvMidnightDate(nvIsoToDate(dates.warranty_until, "dates.warranty_until"));
  if (d.report) {
    set.objection = d.report.objection_open === true ? "Возражение открыто (см. платформу)" : "";
    if (d.report.accepted === true) set.reportAccepted = d.actor === "system" ? "По сроку" : "Клиентом";
    else if (to.code === "report_sent") set.reportAccepted = "Нет";
  }
  if (d.cancel) {
    const p = NV_CANCEL_POINTS.find((x) => x.code === d.cancel.point);
    if (!p) throw nvFieldError("cancel.point", String(d.cancel.point));
    set.cancelPoint = p.label;
    set.cancelReason = d.cancel.reason || "";
    const st = d.cancel.settlement || {};
    set.feeEarned = Number(st.fee_earned) || 0;
    set.feeToRefund = Number(st.fee_to_refund) || 0;
    set.feeToInvoice = Number(st.fee_to_invoice) || 0;
    set.fundsToRefund = Number(st.funds_to_refund) || 0;
    const parts = NV_CANCEL_PARTS.find((x) => x.code === st.parts_go_to);
    if (parts) set.partsTo = parts.label;
    if (st.due_by) set.cancelDue = nvIsoToDate(st.due_by, "cancel.settlement.due_by");
  }
  if (d.flags && d.flags.first_order_meeting_done === true) set.meetingDone = true;
  const clientCode = d.customer_ref ? nvClientFromRef({ ref: d.customer_ref }, {}, false) : "";
  if (clientCode) set.client = clientCode;
  if (d.lead_number) set.lead = d.lead_number;
  const stampKey = to.dateKey;
  if (stampKey && (!row || row.code !== to.code)) set[stampKey] = at;
  set.status = to.label;
  set.code = to.code;
  set.kind = kind;
  set.seq = seq;
  set.src = "Платформа";
  set.updated = now;
  let created = false;
  if (!row) {
    nvCreateOrder(
      { lead: d.lead_number || "", client: clientCode, kind: kind },
      { number: num, src: "Платформа", seq: seq, now: at, how: "Платформа", actorLabel: "Платформа" },
    );
    created = true;
    row = nvReadTable("orders").find((o) => o.num === num);
  }
  nvWriteCells("orders", row._row, set);
  // Ledger: the entries of the event, once each
  const reserves = nvReadTable("reserves");
  (Array.isArray(d.ledger) ? d.ledger : []).forEach((l) => {
    const fund = l.fund === "warranty" ? "Гарантийный" : l.fund === "tax_risk" ? "Налоговый риск" : null;
    if (!fund) throw nvFieldError("ledger.fund", String(l.fund));
    const basis = l.fund === "warranty" ? "Взнос при сдаче" : "Взнос при сверке";
    const amount = Number(l.amount);
    if (!Number.isInteger(amount)) throw nvFieldError("ledger.amount");
    if (reserves.some((r) => r.ref === num && r.fund === fund && r.basis === basis && Number(r.amount) === amount))
      return;
    nvLedgerAppend({ date: at, fund: fund, ref: num, amount: amount, basis: basis, who: "Платформа" });
  });
  nvHistoryAppend({
    time: at,
    object: "Заказ",
    num: num,
    from: from ? from.label : created ? "" : row.status,
    to: to.label,
    event: d.event || "",
    eventLabel: evInfo ? evInfo.label : "",
    actor: { owner: "Владелец", customer: "Клиент", system: "Система", assistant: "Помощник" }[d.actor] || "Платформа",
    how: "Платформа",
    eventId: ev.id,
    seq: seq,
  });
  nvRefreshOrderActions(num);
  // A check of the platform's amounts against the formulas of the sheet
  let note = created ? "заказ создан" : "статус " + to.label;
  if (q && q.fee_total !== undefined) {
    const mine = nvComputeQuote(
      {
        kind: kind,
        basePc: set.basePc,
        baseMount: set.baseMount,
        outside: set.outside,
        purchased: set.purchased,
        memory: set.memory,
        complex: false,
        freeWindow: false,
      },
      nvSettings(),
    );
    if (mine.feeTotal !== Number(q.fee_total) || mine.purchaseLimit !== Number(q.purchase_limit)) {
      note +=
        "; расхождение со сметой платформы: плата " +
        q.fee_total +
        " / таблица " +
        mine.feeTotal +
        ", лимит " +
        q.purchase_limit +
        " / " +
        mine.purchaseLimit;
    }
  }
  return { result: "applied", num: num, seq: seq, summary: note };
}

function nvApplyPaymentConfirmed(ev, now) {
  const d = ev.data;
  const id = nvRequireString(d.payment_id, "payment_id");
  const orderNum = nvRequireString(d.order_number, "order_number");
  const kind = NV_PAYMENT_KINDS.find((k) => k.code === d.kind);
  if (!kind) throw nvFieldError("kind", String(d.kind));
  const method = NV_PAYMENT_METHODS.find((m) => m.code === d.method);
  if (!method) throw nvFieldError("method", String(d.method));
  const status = d.status === "confirmed" ? "Подтверждён" : d.status === "void" ? "Аннулирован" : null;
  if (!status) throw nvFieldError("status", String(d.status));
  const amount = Number(d.amount_sum);
  if (!Number.isInteger(amount) || amount <= 0) throw nvFieldError("amount_sum");
  const direction = d.direction === "in" ? "Входящий" : d.direction === "out" ? "Исходящий" : null;
  if (!direction) throw nvFieldError("direction", String(d.direction));
  const check = nvCheckPayment(kind.label, method.label, status, d.fiscal_receipt_no);
  const pairBad = direction !== kind.direction;
  const fields = {
    order: orderNum,
    kind: kind.label,
    method: method.label,
    amount: amount,
    status: status,
    date: nvIsoToDate(d.occurred_at, "occurred_at") || now,
    receipt: d.fiscal_receipt_no || "",
    bankDoc: d.bank_doc_no || "",
    payerIsClient: d.payer_is_customer !== false,
    confirmedBy: "Платформа",
    confirmedAt: status === "Подтверждён" ? nvIsoToDate(d.confirmed_at, "confirmed_at") || now : "",
    reversal: d.reversal_of || "",
    voidReason: status === "Аннулирован" ? "Аннулирован платформой" : "",
  };
  const existing = nvReadTable("payments").find((p) => p.id === id);
  if (existing) {
    const set = {};
    [
      "order",
      "kind",
      "method",
      "amount",
      "status",
      "receipt",
      "bankDoc",
      "payerIsClient",
      "confirmedBy",
      "confirmedAt",
      "reversal",
      "voidReason",
    ].forEach((k) => {
      set[k] = fields[k];
    });
    set.date = fields.date;
    set.src = "Платформа";
    nvWriteCells("payments", existing._row, set);
    nvSyncAcceptedFlags(orderNum, { how: "Платформа" });
  } else {
    nvCreatePayment(fields, { number: id, src: "Платформа", how: "Платформа", now: now });
  }
  let summary = kind.label + " " + amount + " сум, " + status;
  if (check !== "ОК" || pairBad) {
    const problem = pairBad ? "направление не совпало с видом" : check;
    summary += "; ПРОВЕРКА: " + problem;
    nvNotifyOwner("Платёж платформы " + id + " по заказу " + orderNum + ": " + problem);
  }
  return { result: "applied", num: orderNum, summary: summary };
}

function nvApplyPurchaseRecorded(ev, now) {
  const d = ev.data;
  const id = nvRequireString(d.purchase_id, "purchase_id");
  const orderNum = nvRequireString(d.order_number, "order_number");
  const amount = Number(d.amount_sum);
  if (!Number.isInteger(amount) || amount < 0) throw nvFieldError("amount_sum");
  const paid = { corp_card: "Корпоративная карта", bank_transfer: "Перевод" }[d.paid_via];
  if (!paid) throw nvFieldError("paid_via", String(d.paid_via));
  const doc = { fiscal: "Фискальный чек", esf: "ЭСФ", none_with_consent: "Без чека с согласием" }[d.receipt_kind];
  if (!doc) throw nvFieldError("receipt_kind", String(d.receipt_kind));
  const fields = {
    order: orderNum,
    item: d.title || "",
    category: nvDictValues("NVD_CATEGORY").indexOf(d.category_code) >= 0 ? d.category_code : "",
    shop: d.vendor_name || "",
    qty: Number(d.qty) || 1,
    amount: amount,
    paidWith: paid,
    docKind: doc,
    receipt: d.receipt_no || "",
    esf: d.esf_no || "",
    esfStatus: d.esf_no ? "Ожидается" : "",
    discount: Number(d.discount_sum) || 0,
    bonus: d.bonus_note || "",
    serials: Array.isArray(d.serials) ? d.serials.join(", ") : "",
    warrantyMonths: d.vendor_warranty_months || "",
    bought: nvIsoToDate(d.bought_at, "bought_at") || nvToday(),
    boughtBy: "Владелец",
  };
  const existing = nvReadTable("purchases").find((p) => p.id === id);
  if (existing) {
    nvWriteCells("purchases", existing._row, Object.assign({}, fields, { src: "Платформа" }));
  } else {
    nvCreatePurchase(fields, { number: id, src: "Платформа", how: "Платформа", now: now });
  }
  let summary = "чек " + amount + " сум";
  const t = d.totals;
  if (t && Number.isFinite(Number(t.receipts_total))) {
    const mine = nvReadTable("purchases")
      .filter((p) => p.order === orderNum)
      .reduce((a, p) => a + (Number(p.amount) || 0), 0);
    if (mine !== Number(t.receipts_total))
      summary += "; ПРЕДУПРЕЖДЕНИЕ: чеки по заказу в таблице " + mine + ", у платформы " + t.receipts_total;
  }
  return { result: "applied", num: orderNum, summary: summary };
}

function nvApplyWarrantyOpened(ev, now) {
  const d = ev.data;
  const num = nvRequireString(d.number, "number");
  const parsed = nvParseNumber(num);
  if (parsed?.prefix !== "G") throw nvFieldError("number", num);
  const orderNum = nvRequireString(d.order_number, "order_number");
  if (nvReadTable("warranty").some((w) => w.num === num))
    return { result: "ignored", num: num, summary: "случай уже есть" };
  const opened = nvIsoToDate(d.opened_at, "opened_at") || now;
  const channelMap = { bot: "Бот", telegram: "Telegram", call: "Звонок", in_person: "Лично" };
  nvCreateWarranty(
    {
      order: orderNum,
      purchase: d.purchase_id || "",
      opened: opened,
      channel: channelMap[d.channel] || "",
      desc: d.summary || "",
      deadlines: d.deadlines || {},
    },
    { number: num, src: "Платформа", how: "Платформа", actorLabel: "Платформа", eventId: ev.id },
  );
  const row = nvReadTable("warranty").find((w) => w.num === num);
  nvNotifyOwner(
    "Гарантийный случай " +
      num +
      " по заказу " +
      orderNum +
      ": ответить до " +
      (row ? nvFormat(nvToDate(row.replyBy), "dd.MM.yyyy HH:mm") : "—"),
  );
  return { result: "applied", num: num, summary: "случай по заказу " + orderNum };
}
