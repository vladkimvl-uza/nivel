/**
 * The installable "onEdit" trigger: numbers and stamps for new rows, the rules of every sheet, the owner's dialogs.
 * Simple triggers are not used: they cannot write protected ranges or read the properties. Changes made by the script
 * and by the webhook do not fire this trigger, so the manual path and the webhook call the same functions.
 */

/** Sheet key by the name of a sheet. */
function nvSheetKeyByName(name) {
  const keys = Object.keys(NV_SN);
  for (let i = 0; i < keys.length; i++) if (NV_SN[keys[i]] === name) return keys[i];
  return null;
}

/** Key of the column at the sheet column index; null outside the table. */
function nvColKeyAt(sheetKey, colIndex) {
  const def = NV_SCHEMA[sheetKey];
  if (!def) return null;
  const i = colIndex - NV_LAYOUT.firstCol;
  return i >= 0 && i < def.cols.length ? def.cols[i].key : null;
}

/** Who is working: the owner, or the assistant (an account other than OWNER_EMAIL). */
function nvActor() {
  const owner = nvScriptProps().getProperty(NV_PROP.ownerEmail);
  if (!owner) return "owner";
  let me = "";
  try {
    me = Session.getActiveUser().getEmail();
  } catch (e) {
    me = "";
  }
  return me && me.toLowerCase() !== owner.toLowerCase() ? "assistant" : "owner";
}

const NV_NUMBERED = {
  leads: { prefix: "L", year: true },
  orders: { prefix: "NV", year: true },
  payments: { prefix: "P", year: true },
  purchases: { prefix: "Z", year: true },
  warranty: { prefix: "G", year: true },
  clients: { prefix: "K", year: false },
};

/** Does the row hold anything the user typed (not the defaults of flags)? */
function nvRowHasData(sheetKey, arr) {
  const def = NV_SCHEMA[sheetKey];
  return def.cols.some((c, i) => {
    if (c.calc || c.key === def.keyCol || c.demo) return false;
    const v = arr[i];
    return v !== "" && v !== null && v !== undefined && v !== false;
  });
}

/** Numbers and the first stamps of the rows in rowFrom..rowTo that have data but no number yet. Returns the numbers. */
function nvAssignNumbers(sheetKey, rowFrom, rowTo) {
  const meta = NV_NUMBERED[sheetKey];
  if (!meta) return [];
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const keyIdx = def.cols.findIndex((c) => c.key === def.keyCol);
  const n = rowTo - rowFrom + 1;
  const vals = sh.getRange(rowFrom, NV_LAYOUT.firstCol, n, def.cols.length).getValues();
  const issued = [];
  vals.forEach((arr, i) => {
    if (nvStr(arr[keyIdx]) !== "" || !nvRowHasData(sheetKey, arr)) return;
    const row = rowFrom + i;
    const obj = nvArrayToRow(sheetKey, arr);
    const now = nvNow();
    const dateKey = def.numbering?.createdKey;
    const created = nvToDate(obj[dateKey]) || now;
    nvIssueNumber(meta.prefix, { date: created, demo: obj.demo === true }, (num) => {
      const set = {};
      set[def.keyCol] = num;
      if (sheetKey === "leads")
        Object.assign(set, {
          created: now,
          status: nvStr(obj.status) || "Новая",
          src: "Вручную",
          updated: now,
          demo: false,
        });
      if (sheetKey === "orders")
        Object.assign(set, {
          created: now,
          status: nvStatusByCode("estimate_draft").label,
          code: "estimate_draft",
          src: "Вручную",
          updated: now,
          demo: false,
          meetingDone: false,
        });
      if (sheetKey === "payments")
        Object.assign(set, {
          status: nvStr(obj.status) || "Ожидается",
          date: nvToDate(obj.date) || now,
          src: "Вручную",
          demo: false,
        });
      if (sheetKey === "purchases")
        Object.assign(set, { bought: nvToDate(obj.bought) || nvToday(), src: "Вручную", demo: false });
      if (sheetKey === "warranty")
        Object.assign(set, {
          opened: nvToDate(obj.opened) || now,
          status: nvStr(obj.status) || "Открыт",
          src: "Вручную",
          demo: false,
        });
      if (sheetKey === "clients")
        Object.assign(set, { firstContact: nvToDate(obj.firstContact) || nvToday(), demo: false });
      nvWriteCells(sheetKey, row, set);
      nvFlagValidations(sheetKey, row, 1);
      return num;
    });
    const num = nvStr(sh.getRange(row, nvColIndex(sheetKey, def.keyCol)).getValue());
    issued.push({ row: row, num: num });
    if (sheetKey === "orders") {
      nvRefreshOrderActions(num);
      nvHistoryAppend({
        object: "Заказ",
        num: num,
        from: "",
        to: nvStatusByCode("estimate_draft").label,
        event: "ORDER_CREATED",
        eventLabel: "Заказ создан",
        actor: "Владелец",
        how: "Вручную",
        reason: "",
      });
    }
    if (sheetKey === "leads")
      nvHistoryAppend({
        object: "Заявка",
        num: num,
        from: "",
        to: "Новая",
        event: "LEAD_CREATED",
        eventLabel: "Заявка создана",
        actor: "Владелец",
        how: "Вручную",
      });
    if (sheetKey === "warranty") {
      nvWarrantyAfterEdit(row, "opened");
      nvSetActionValidation("warranty", row, nvWarrantyActionLabels("Открыт"));
      nvHistoryAppend({
        object: "Гарантия",
        num: num,
        from: "",
        to: "Открыт",
        event: "WARRANTY_OPENED",
        eventLabel: "Гарантийный случай открыт",
        actor: "Владелец",
        how: "Вручную",
        reason: obj.order || "",
      });
    }
  });
  return issued;
}

/** Shows an alert (the owner's dialog); in a context without a UI returns the default answer. */
function nvAsk(title, text, buttons) {
  try {
    const ui = SpreadsheetApp.getUi();
    // The answer is an enum of the UI; its name ("YES", "NO", "OK") is what the code compares
    return String(ui.alert(title, text, buttons || ui.ButtonSet.YES_NO));
  } catch (e) {
    return "NO";
  }
}

/** Asks for a line of text; null when cancelled or no UI. */
function nvPrompt(title, text) {
  try {
    const ui = SpreadsheetApp.getUi();
    const r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return null;
    return r.getResponseText();
  } catch (e) {
    return null;
  }
}

/**
 * The owner picked an event of an order (in the "Действие" column or in the panel): asks for the text the event needs,
 * applies it, and when a check fails offers "Принудительно с причиной". Returns the result of the last call.
 */
function nvRunOrderAction(num, eventLabel) {
  const ev = nvEventByLabel(eventLabel);
  if (!ev) {
    nvToast("Неизвестное действие: " + eventLabel);
    return { ok: false, error: "unknown_event" };
  }
  const actor = nvActor();
  let input = "";
  if (NV_EVENT_INPUT[ev.code]) {
    input = nvPrompt(ev.label + " · " + num, NV_EVENT_INPUT[ev.code]);
    if (input === null) return { ok: false, error: "cancelled" };
  }
  let res = nvApplyOrderEvent(num, ev.code, { actor: actor, input: input, how: "Вручную" });
  if (res.needConfirm) {
    const answer = nvAsk(
      "Не выполнено",
      "Не выполнено: " + res.text + "\n\nДа — принудительно с причиной (запишется в «Историю»).\nНет — отмена.",
    );
    if (answer !== "YES") return { ok: false, error: "cancelled" };
    const reason = nvPrompt("Принудительно · " + num, "Причина, по которой правило нарушено (запишется в «Историю»)");
    if (!nvStr(reason)) return { ok: false, error: "force_reason_missing" };
    res = nvApplyOrderEvent(num, ev.code, { actor: actor, input: input, how: "Вручную", force: true, reason: reason });
  }
  if (res.ok) nvToast(ev.label + ": " + res.label, num);
  else nvToast(res.text || res.error, num, 10);
  return res;
}

/** The same for a warranty case. */
function nvRunWarrantyAction(num, eventLabel) {
  const ev = NV_WARRANTY_EVENTS.find((e) => e.label === eventLabel || e.code === eventLabel);
  if (!ev) return { ok: false, error: "unknown_event" };
  const res = nvApplyWarrantyEvent(num, ev.code, { actor: nvActor() });
  nvToast(res.ok ? ev.label + ": " + res.status : res.text || res.error, num, res.ok ? 6 : 10);
  return res;
}

/** The platform-field rows: a manual change asks for a confirmation (the platform is the senior source). */
function nvGuardPlatformField(sheetKey, colKey, rowNo, e) {
  const def = NV_SCHEMA[sheetKey];
  const col = def.cols.find((c) => c.key === colKey);
  if (!col?.plat) return true;
  const sh = nvSheet(sheetKey);
  const src = sh.getRange(rowNo, nvColIndex(sheetKey, "src")).getValue();
  if (def.cols.every((c) => c.key !== "src") || src !== "Платформа") return true;
  const answer = nvAsk(
    "Поле платформы",
    "Строка пришла от платформы, поле «" + col.title + "» ведёт она. Изменить вручную?",
  );
  if (answer === "YES") return true;
  e.range.setValue(e.oldValue === undefined ? "" : e.oldValue);
  return false;
}

/** Entry point of the installable edit trigger. */
function nvOnEdit(e) {
  if (!e?.range) return;
  const range = e.range;
  const sheetName = range.getSheet().getName();
  const sheetKey = nvSheetKeyByName(sheetName);
  if (!sheetKey) return;
  const r0 = range.getRow();
  const r1 = range.getLastRow();
  const c0 = range.getColumn();
  const c1 = range.getLastColumn();
  nvResetSettingsCache();
  try {
    nvWithLock(() => {
      if (sheetKey === "settings") return nvOnSettingsEdit(range, e);
      if (sheetKey === "today") return nvOnTodayEdit(range);
      if (!NV_SCHEMA[sheetKey]) return null;
      if (r1 < NV_LAYOUT.firstRow) return null;
      const def = NV_SCHEMA[sheetKey];
      const first = Math.max(r0, NV_LAYOUT.firstRow);
      const single = r0 === r1 && c0 === c1;
      const keyCol = nvColIndex(sheetKey, def.keyCol);
      // A number is issued by the script: a hand-typed number is taken back.
      if (NV_NUMBERED[sheetKey] && c0 <= keyCol && keyCol <= c1) {
        if (single) {
          range.setValue(e.oldValue === undefined ? "" : e.oldValue);
          nvToast("Номер выдаёт скрипт: ручная правка отклонена", "Номера");
          return null;
        }
      }
      const issued = NV_NUMBERED[sheetKey] ? nvAssignNumbers(sheetKey, first, r1) : [];
      if (!single) {
        // A paste of many cells: numbers and stamps only, the rules run when a row is edited by hand.
        return null;
      }
      const colKey = nvColKeyAt(sheetKey, c0);
      if (!colKey) return null;
      if (!nvGuardPlatformField(sheetKey, colKey, r0, e)) return null;
      const oldValue = e.oldValue;
      switch (sheetKey) {
        case "leads":
          return nvOnLeadsEdit(r0, colKey, oldValue, issued.length > 0);
        case "orders":
          return nvOnOrdersEdit(r0, colKey, e.value, issued.length > 0);
        case "payments":
          return nvToastAll(nvPaymentAfterEdit(r0, colKey, oldValue));
        case "purchases":
          return nvToastAll(nvPurchaseAfterEdit(r0));
        case "warranty":
          return nvOnWarrantyEdit(r0, colKey, e.value);
        case "clients":
          return nvOnClientsEdit(r0, colKey);
        case "reserves":
        case "history":
        case "webhook":
        case "selfcheck":
          nvToast("Лист заполняет скрипт: правка вручную допустима только в крайнем случае", NV_SCHEMA[sheetKey].title);
          return null;
        default:
          return null;
      }
    });
  } catch (err) {
    Logger.log("nvOnEdit: " + (err?.stack ? err.stack : err));
    nvToast("Ошибка: " + (err?.message ? err.message : err), "Nivel CRM", 10);
  }
}

function nvToastAll(msgs) {
  (msgs || []).forEach((m) => {
    nvToast(m, "Проверка", 10);
  });
  return null;
}

function nvOnLeadsEdit(rowNo, colKey, oldValue, justCreated) {
  if (justCreated) return null;
  if (colKey === "status") {
    const msgs = nvLeadAfterEdit(rowNo, oldValue);
    const lead = nvReadTable("leads").find((l) => l._row === rowNo);
    if (lead && lead.status === "В заказе" && !nvStr(lead.order)) {
      const res = nvConvertLead(lead.num);
      if (res.ok) nvToast("Создан заказ " + res.order, lead.num);
    }
    return nvToastAll(msgs);
  }
  nvWriteCells("leads", rowNo, { updated: nvNow() });
  if (colKey === "reason") {
    const lead = nvReadTable("leads").find((l) => l._row === rowNo);
    if (lead && lead.status === "Отказ" && nvStr(lead.reason) !== "")
      nvHistoryAppend({
        object: "Заявка",
        num: lead.num,
        from: "Отказ",
        to: "Отказ",
        event: "LEAD_REASON",
        eventLabel: "Причина отказа",
        actor: "Владелец",
        how: "Вручную",
        reason: lead.reason,
      });
  }
  return null;
}

function nvOnOrdersEdit(rowNo, colKey, value, justCreated) {
  if (justCreated) return null;
  const order = nvReadTable("orders").find((o) => o._row === rowNo);
  if (!order) return null;
  if (colKey === "action") {
    if (nvStr(value) === "") return null;
    nvWriteCells("orders", rowNo, { action: "" });
    nvRunOrderAction(order.num, value);
    return null;
  }
  nvWriteCells("orders", rowNo, { updated: nvNow() });
  if (colKey === "meetingDone") nvSyncAcceptedFlags(order.num);
  if (
    ["basePc", "baseMount", "outside", "purchased", "memory", "complex", "slot", "furn", "kind"].indexOf(colKey) >= 0 &&
    order.code !== "estimate_draft" &&
    order.code !== "estimate_expired"
  ) {
    nvToast(
      "Смета изменена после отправки: пересмотрите смету («Пересмотреть смету»), иначе клиент видел другую",
      order.num,
      10,
    );
  }
  return null;
}

function nvOnWarrantyEdit(rowNo, colKey, value) {
  const w = nvReadTable("warranty").find((x) => x._row === rowNo);
  if (!w) return null;
  if (colKey === "action") {
    if (nvStr(value) === "") return null;
    nvWriteCells("warranty", rowNo, { action: "" });
    nvRunWarrantyAction(w.num, value);
    return null;
  }
  return nvToastAll(nvWarrantyAfterEdit(rowNo, colKey));
}

function nvOnClientsEdit(rowNo, colKey) {
  const set = {};
  const c = nvReadTable("clients").find((x) => x._row === rowNo);
  if (!c) return null;
  if (colKey === "tg" && nvStr(c.tg)) set.tg = nvNormalizeTg(c.tg);
  if (colKey === "phone" && nvStr(c.phone)) set.phone = nvNormalizePhone(c.phone);
  nvWriteCells("clients", rowNo, set);
  return null;
}

/** A setting changed: the history keeps who changed what (the object «Настройки»). */
function nvOnSettingsEdit(range, e) {
  const layout = nvSettingsLayout();
  const row = range.getRow();
  const item = layout.find((x) => x.row === row && !x.isGroup);
  if (!item || range.getColumn() !== NV_SET_COLS.value) return null;
  const sh = range.getSheet();
  sh.getRange(row, NV_SET_COLS.changed).setValue(nvToday());
  nvHistoryAppend({
    object: "Настройки",
    num: item.def.name,
    from: e.oldValue === undefined ? "" : String(e.oldValue),
    to: e.value === undefined ? String(range.getValue()) : String(e.value),
    event: "SETTING_CHANGED",
    eventLabel: item.def.label,
    actor: NV_ACTOR_LABEL[nvActor()] || "Владелец",
    how: "Вручную",
  });
  nvResetSettingsCache();
  const s = nvSettings(true);
  if (item.def.stage && !nvStageSharesOk(s))
    nvToast("Сумма долей этапов не равна 10 000: отмена будет считаться неверно", "Настройки", 10);
  return null;
}
