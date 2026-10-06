/**
 * The menu "Nivel CRM" and the sidebars with forms. A form is a list of fields rendered as plain HTML; the submit calls
 * nvFormSubmit(kind, values) on the server. Nothing from the form is trusted: the server functions check everything again.
 */

function onOpen() {
  nvBuildMenu();
}

function nvBuildMenu() {
  const ui = SpreadsheetApp.getUi();
  const theme = ui
    .createMenu("Оформление")
    .addItem("Паспорт (светлая), все листы", "nvMenuThemePassport")
    .addItem("Ночная панель — только лист «Панель»", "nvMenuThemeNightPanel")
    .addItem("Ночная панель — все листы", "nvMenuThemeNightAll");
  const demo = ui
    .createMenu("Демо-данные")
    .addItem("Заполнить", "nvMenuDemoFill")
    .addItem("Очистить", "nvMenuDemoClear");
  const settings = ui
    .createMenu("Настройка")
    .addItem("Секреты: Telegram", "nvMenuSecretTelegram")
    .addItem("Секреты: почта владельца", "nvMenuSecretEmail")
    .addItem("Секреты: ключ вебхука", "nvMenuSecretWebhook")
    .addItem("Установить триггеры", "nvMenuInstallTriggers")
    .addItem("Журнал вебхука", "nvMenuWebhookLog");
  ui.createMenu("Nivel CRM")
    .addItem("Новая заявка", "nvMenuNewLead")
    .addItem("Заявку в заказ", "nvMenuConvertLead")
    .addItem("Действие по заказу", "nvMenuOrderAction")
    .addItem("Записать платёж", "nvMenuNewPayment")
    .addItem("Записать чек закупки", "nvMenuNewPurchase")
    .addItem("Открыть гарантийный случай", "nvMenuNewWarranty")
    .addItem("Создать заказ из калькулятора", "nvMenuOrderFromCalc")
    .addSeparator()
    .addItem("Рассчитать отмену", "nvMenuCalcCancel")
    .addItem("Обновить «Сегодня»", "nvMenuRefreshToday")
    .addItem("Автопереходы сейчас", "nvMenuAutoNow")
    .addItem("Отправить сводку сейчас", "nvMenuDigestNow")
    .addItem("Самопроверка", "nvMenuSelfCheck")
    .addSeparator()
    .addItem("Применить оформление", "nvMenuSetup")
    .addSubMenu(theme)
    .addSubMenu(demo)
    .addSubMenu(settings)
    .addSeparator()
    .addItem("О версии", "nvMenuAbout")
    .addToUi();
}

/* ---------------------------------------------------------------- menu handlers (global names are required by the menu) */

function nvMenuSetup() {
  nvSetup();
}
function nvMenuThemePassport() {
  nvSetTheme("passport", "all");
}
function nvMenuThemeNightPanel() {
  nvSetTheme("night", "panel");
}
function nvMenuThemeNightAll() {
  nvSetTheme("night", "all");
}
function nvMenuDemoFill() {
  const n = nvAsk(
    "Демо-данные",
    "Добавить демо-данные: 12 заявок, 8 заказов, платежи, чеки, 2 гарантийных случая? Строки получат пометку «Демо».",
  );
  if (n === "YES") nvDemoFill();
}
function nvMenuDemoClear() {
  const count = nvDemoCount();
  if (count === 0) return nvToast("Демо-строк нет");
  const a = nvAsk(
    "Очистить демо-данные",
    "Будет удалено строк с пометкой «Демо»: " + count + ". Реальные строки и счётчики не затрагиваются. Продолжить?",
  );
  if (a === "YES") nvDemoClear();
  return null;
}
function nvMenuInstallTriggers() {
  const r = nvInstallTriggers();
  nvToast("Триггеры установлены: " + r.installed.join(", "));
}
function nvMenuSecretTelegram() {
  nvSecretTelegramUi();
}
function nvMenuSecretEmail() {
  nvSecretEmailUi();
}
function nvMenuSecretWebhook() {
  nvSecretWebhookUi();
}
function nvMenuWebhookLog() {
  nvSheet("webhook").activate();
}
function nvMenuRefreshToday() {
  SpreadsheetApp.flush?.();
  nvSheet("today").activate();
  nvToast("«Сегодня» собирается формулами из всех листов и обновляется само");
}
function nvMenuAutoNow() {
  const r = nvHourlyJob({ force: true });
  nvToast(
    "Автопереходы: смет истекло " + r.expired + ", отчётов принято по сроку " + r.deemed + ", закрыто " + r.closed,
  );
}
function nvMenuDigestNow() {
  const r = nvDailyDigest({ force: true });
  nvToast(r.sent ? "Сводка отправлена" : "Сводка не отправлена: " + r.reason);
}
function nvMenuSelfCheck() {
  const r = nvSelfCheck();
  nvToast("Самопроверка: ошибок " + r.errors + ", предупреждений " + r.warnings, "Nivel CRM", 10);
}
function nvMenuAbout() {
  nvAsk(
    "Nivel CRM",
    "Версия " +
      NV_VERSION +
      ", схема " +
      NV_SCHEMA_VERSION +
      "\nЧасовой пояс " +
      NV_TZ +
      ", локаль " +
      NV_LOCALE +
      "\nПравила платы: " +
      NV_DEFAULTS.feeVersion,
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}
function nvMenuCalcCancel() {
  const num = nvActiveOrderNumber();
  if (!num) return nvToast("Встаньте на строку заказа в листе «Заказы»");
  const r = nvRecalculateCancel(num);
  if (!r.ok) return nvToast(r.text || r.error, num, 10);
  const s = r.settlement;
  return nvToast(
    "Заработано " +
      s.feeEarned +
      ", вернуть платы " +
      s.feeToRefund +
      ", доплатить " +
      s.feeToInvoice +
      ", вернуть денег " +
      s.fundsToRefund +
      (r.preview ? " (предварительно)" : ""),
    num,
    15,
  );
}
function nvMenuOrderFromCalc() {
  const num = nvOrderFromCalculator();
  nvToast("Создан заказ " + num);
}
function nvMenuNewLead() {
  nvShowForm("lead");
}
function nvMenuConvertLead() {
  nvShowForm("convert");
}
function nvMenuOrderAction() {
  nvShowForm("action");
}
function nvMenuNewPayment() {
  nvShowForm("payment");
}
function nvMenuNewPurchase() {
  nvShowForm("purchase");
}
function nvMenuNewWarranty() {
  nvShowForm("warranty");
}

/** The number of the order on the active row of "Заказы", or "". */
function nvActiveOrderNumber() {
  const sh = nvSpreadsheet().getActiveSheet();
  if (!sh || sh.getName() !== NV_SN.orders) return "";
  const range = sh.getActiveCell ? sh.getActiveCell() : null;
  if (!range) return "";
  const row = range.getRow();
  if (row < NV_LAYOUT.firstRow) return "";
  return nvStr(sh.getRange(row, nvColIndex("orders", "num")).getValue());
}

/* ---------------------------------------------------------------- forms */

const NV_FORMS = {
  lead: {
    title: "Новая заявка",
    fields: () => [
      { name: "channel", label: "Канал", type: "select", options: nvDictValues("NVD_CHANNEL"), required: true },
      { name: "source", label: "Код источника (start-код бота или utm_campaign)", type: "text" },
      { name: "name", label: "Как обращаться", type: "text" },
      { name: "tg", label: "Telegram (@ник)", type: "text" },
      { name: "lang", label: "Язык", type: "select", options: NV_LANGS },
      { name: "district", label: "Район", type: "select", options: nvDictValues("NVD_DISTRICT") },
      { name: "scope", label: "Объём", type: "select", options: nvDictValues("NVD_SCOPE"), required: true },
      { name: "band", label: "Бюджет", type: "select", options: nvDictValues("NVD_BUDGET") },
      { name: "budget", label: "Бюджет, сум (ориентир)", type: "number" },
      { name: "wanted", label: "Нужно к", type: "date" },
      { name: "config", label: "Код сборки (8 знаков)", type: "text" },
      { name: "note", label: "Комментарий", type: "textarea" },
    ],
  },
  convert: {
    title: "Заявку в заказ",
    fields: () => [{ name: "lead", label: "Заявка", type: "select", options: nvOpenLeadNumbers(), required: true }],
  },
  action: {
    title: "Действие по заказу",
    fields: () => [{ name: "order", label: "Заказ", type: "select", options: nvOpenOrderNumbers(), required: true }],
    custom: true,
  },
  payment: {
    title: "Записать платёж",
    fields: () => [
      { name: "order", label: "Заказ", type: "select", options: nvOpenOrderNumbers(), required: true },
      { name: "kind", label: "Вид", type: "select", options: NV_PAYMENT_KINDS.map((k) => k.label), required: true },
      {
        name: "method",
        label: "Способ (для платы: QR или карта)",
        type: "select",
        options: NV_PAYMENT_METHODS.map((m) => m.label),
      },
      { name: "amount", label: "Сумма, сум", type: "number", required: true },
      { name: "status", label: "Статус", type: "select", options: NV_PAYMENT_STATUSES },
      { name: "date", label: "Дата операции", type: "date" },
      { name: "receipt", label: "№ фискального чека (обязателен для подтверждённой платы)", type: "text" },
      { name: "bankDoc", label: "№ банковского документа", type: "text" },
      { name: "payerIsClient", label: "Плательщик — клиент", type: "checkbox", value: true },
      { name: "thirdParty", label: "Заявление третьего лица (ссылка)", type: "text" },
    ],
  },
  purchase: {
    title: "Записать чек закупки",
    fields: () => [
      {
        name: "order",
        label: "Заказ (в статусе «Закупка»)",
        type: "select",
        options: nvOpenOrderNumbers(),
        required: true,
      },
      { name: "item", label: "Позиция (без персональных данных)", type: "text", required: true },
      { name: "category", label: "Категория", type: "select", options: nvDictValues("NVD_CATEGORY") },
      { name: "shop", label: "Магазин", type: "select", options: nvDictValues("NVD_SHOP") },
      { name: "qty", label: "Количество", type: "number", value: 1 },
      { name: "amount", label: "Сумма по чеку, сум", type: "number", required: true },
      { name: "paidWith", label: "Оплачено", type: "select", options: NV_PAID_WITH },
      { name: "docKind", label: "Документ", type: "select", options: NV_RECEIPT_DOCS },
      { name: "receipt", label: "№ чека", type: "text" },
      { name: "esf", label: "№ ЭСФ", type: "text" },
      { name: "discount", label: "Скидка, сум (вся — клиенту)", type: "number" },
      { name: "warrantyMonths", label: "Гарантия магазина, мес.", type: "number" },
      { name: "bought", label: "Куплено", type: "date" },
    ],
  },
  warranty: {
    title: "Гарантийный случай",
    fields: () => [
      { name: "order", label: "Заказ", type: "select", options: nvAllOrderNumbers(), required: true },
      { name: "channel", label: "Канал обращения", type: "select", options: NV_WARRANTY_CHANNELS },
      { name: "desc", label: "Описание (без персональных данных)", type: "textarea", required: true },
      { name: "fixType", label: "Тип устранения", type: "select", options: NV_FIX_TYPES },
    ],
  },
};

function nvOpenLeadNumbers() {
  return nvReadTable("leads")
    .filter((l) => l.status === "Новая" || l.status === "В работе")
    .map((l) => l.num);
}
function nvOpenOrderNumbers() {
  return nvReadTable("orders")
    .filter((o) => ["closed", "cancelled", "podbor_delivered"].indexOf(o.code) < 0)
    .map((o) => o.num);
}
function nvAllOrderNumbers() {
  return nvReadTable("orders").map((o) => o.num);
}

function nvEsc(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML of a field. */
function nvFieldHtml(f) {
  const id = "f_" + f.name;
  const label = '<label for="' + id + '">' + nvEsc(f.label) + (f.required ? " *" : "") + "</label>";
  if (f.type === "select") {
    const opts = ['<option value=""></option>'].concat(
      (f.options || []).map((o) => '<option value="' + nvEsc(o) + '">' + nvEsc(o) + "</option>"),
    );
    return label + '<select id="' + id + '" name="' + f.name + '">' + opts.join("") + "</select>";
  }
  if (f.type === "textarea") return label + '<textarea id="' + id + '" name="' + f.name + '" rows="3"></textarea>';
  if (f.type === "checkbox")
    return (
      '<label class="chk"><input type="checkbox" id="' +
      id +
      '" name="' +
      f.name +
      '"' +
      (f.value ? " checked" : "") +
      "> " +
      nvEsc(f.label) +
      "</label>"
    );
  const type = f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
  return (
    label +
    '<input type="' +
    type +
    '" id="' +
    id +
    '" name="' +
    f.name +
    '"' +
    (f.value !== undefined ? ' value="' + nvEsc(f.value) + '"' : "") +
    (type === "number" ? ' step="1" min="0"' : "") +
    ">"
  );
}

const NV_FORM_CSS =
  "body{font-family:'Fira Sans',Arial,sans-serif;font-size:13px;color:#1D1D1B;background:#F1EFEA;margin:0;padding:14px}" +
  "h1{font-size:16px;margin:0 0 12px}label{display:block;margin:10px 0 3px;color:#5E574D;font-size:11px}" +
  "input,select,textarea{width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #DDD5C8;border-bottom:2px solid #D9501A;background:#fff;font:inherit;border-radius:0}" +
  "label.chk{display:flex;gap:8px;align-items:center;color:#1D1D1B;font-size:13px}label.chk input{width:auto}" +
  "button{margin-top:16px;padding:9px 14px;border:0;background:#1D1D1B;color:#F1EFEA;font:inherit;font-weight:600;cursor:pointer;border-radius:0}" +
  "button.alt{background:transparent;color:#1D1D1B;border:1px solid #1D1D1B;margin-left:6px}" +
  "#msg{margin-top:14px;white-space:pre-wrap;font-size:12px}.err{color:#A53F17}.ok{color:#1D1D1B}" +
  "ul{padding-left:18px;margin:8px 0}li{margin:3px 0}";

/** The sidebar of a form. The custom panel of the order action has its own script. */
function nvFormHtml(kind) {
  const form = NV_FORMS[kind];
  if (!form) throw new Error("Unknown form " + kind);
  const fields = form.fields();
  const body = fields.map((f) => '<div class="row">' + nvFieldHtml(f) + "</div>").join("");
  let script;
  if (form.custom) {
    script =
      "var order='';function load(){var n=document.getElementById('f_order').value;order=n;if(!n){return;}" +
      "google.script.run.withSuccessHandler(show).nvOrderPanelInfo(n);}" +
      "function show(info){var h='<p><b>'+info.status+'</b></p>';if(!info.events.length){h+='<p>Действий нет.</p>';}" +
      "info.events.forEach(function(e){h+='<p><b>'+e.label+'</b>';if(e.violations.length){h+='<ul class=err>';e.violations.forEach(function(v){h+='<li>'+v+'</li>';});h+='</ul>';}" +
      "if(e.input){h+='<input id=\"in_'+e.code+'\" placeholder=\"'+e.input+'\">';}" +
      "h+='<button onclick=\"run(\\''+e.code+'\\')\">Выполнить</button></p>';});document.getElementById('panel').innerHTML=h;}" +
      "function run(code){var i=document.getElementById('in_'+code);var v=i?i.value:'';var r='';" +
      "google.script.run.withSuccessHandler(function(res){if(res.needConfirm){if(confirm('Не выполнено: '+res.text+'\\nПринудительно с причиной?')){r=prompt('Причина');if(r){google.script.run.withSuccessHandler(done).nvOrderPanelRun(order,code,v,true,r);}}}else{done(res);}}).nvOrderPanelRun(order,code,v,false,'');}" +
      "function done(res){document.getElementById('msg').className=res.ok?'ok':'err';document.getElementById('msg').textContent=res.ok?'Готово: '+res.label:res.text;if(res.ok)load();}";
  } else {
    script =
      "function send(){var f=document.getElementById('form');var v={};for(var i=0;i<f.elements.length;i++){var e=f.elements[i];if(!e.name)continue;v[e.name]=e.type==='checkbox'?e.checked:e.value;}" +
      "document.getElementById('msg').textContent='Сохраняю…';" +
      "google.script.run.withSuccessHandler(function(r){var m=document.getElementById('msg');m.className=r.ok?'ok':'err';m.textContent=r.text;if(r.ok){f.reset();}}).withFailureHandler(function(e){var m=document.getElementById('msg');m.className='err';m.textContent=e.message;}).nvFormSubmit('" +
      kind +
      "',v);}";
  }
  const actions = form.custom ? '<div id="panel"></div>' : '<button type="button" onclick="send()">Сохранить</button>';
  const onChange = form.custom
    ? "<script>document.addEventListener('change',function(e){if(e.target.id==='f_order'){load();}});</script>"
    : "";
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    NV_FORM_CSS +
    "</style></head><body><h1>" +
    nvEsc(form.title) +
    '</h1><form id="form" onsubmit="return false">' +
    body +
    "</form>" +
    actions +
    '<div id="msg"></div><script>' +
    script +
    "</script>" +
    onChange +
    "</body></html>"
  );
}

function nvShowForm(kind) {
  const html = HtmlService.createHtmlOutput(nvFormHtml(kind)).setTitle(NV_FORMS[kind].title).setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

/** What the "Действие по заказу" panel shows: the status, and for each allowed event the checks that would fail now. */
function nvOrderPanelInfo(num) {
  const ctx = nvLoadOrderContext(num);
  if (!ctx) return { status: "Заказ не найден", events: [] };
  const now = nvNow();
  const labels = nvActionLabels(ctx.order, ctx.state);
  const events = labels.map((label) => {
    const ev = nvEventByLabel(label);
    const needsInput = NV_EVENT_INPUT[ev.code];
    const probe = nvOrderChecks(ctx, ev.code, needsInput ? "x" : "", now);
    return { code: ev.code, label: ev.label, input: needsInput || "", violations: probe.map((v) => v.text) };
  });
  return { status: ctx.order.status, events: events };
}

function nvOrderPanelRun(num, code, input, force, reason) {
  const res = nvApplyOrderEvent(num, code, {
    actor: nvActor(),
    input: input,
    force: force === true,
    reason: reason,
    how: "Вручную",
  });
  return JSON.parse(JSON.stringify(res));
}

/** Submit of a form: returns {ok, text}. */
function nvFormSubmit(kind, v) {
  const num = (x) => {
    const n = nvNum(x);
    return Number.isFinite(n) ? n : 0;
  };
  try {
    if (kind === "lead") {
      if (!nvStr(v.channel) || !nvStr(v.scope)) return { ok: false, text: "Заполните канал и объём" };
      const n = nvCreateLead(
        Object.assign({}, v, {
          budget: num(v.budget) || "",
          wanted: v.wanted ? new Date(v.wanted + "T00:00:00+05:00") : "",
        }),
      );
      return { ok: true, text: "Создана заявка " + n };
    }
    if (kind === "convert") {
      const r = nvConvertLead(v.lead);
      return r.ok
        ? { ok: true, text: "Заказ " + r.order + (r.existing ? " (уже был создан)" : " создан") }
        : { ok: false, text: "Заявка не найдена" };
    }
    if (kind === "payment") {
      const amount = num(v.amount);
      if (!amount || amount <= 0) return { ok: false, text: "Сумма должна быть больше нуля" };
      const check = nvCheckPayment(
        v.kind,
        v.method || (nvPaymentKindByLabel(v.kind) || { methods: [""] }).methods[0],
        v.status || "Ожидается",
        v.receipt,
      );
      if (check !== "ОК" && (v.status || "Ожидается") === "Подтверждён") return { ok: false, text: check };
      const id = nvCreatePayment(
        Object.assign({}, v, { amount: amount, date: v.date ? new Date(v.date + "T00:00:00+05:00") : "" }),
      );
      return { ok: true, text: "Записан платёж " + id };
    }
    if (kind === "purchase") {
      const amount = num(v.amount);
      if (!amount || amount <= 0) return { ok: false, text: "Сумма должна быть больше нуля" };
      if (v.docKind !== "Без чека с согласием" && !nvStr(v.receipt) && !nvStr(v.esf))
        return { ok: false, text: "Нужен № чека или № ЭСФ" };
      const id = nvCreatePurchase(
        Object.assign({}, v, {
          amount: amount,
          qty: num(v.qty) || 1,
          discount: num(v.discount),
          warrantyMonths: num(v.warrantyMonths) || "",
          bought: v.bought ? new Date(v.bought + "T00:00:00+05:00") : "",
        }),
      );
      const ctx = nvLoadOrderContext(v.order);
      const warn = ctx ? nvPurchaseWarnings(ctx) : [];
      return { ok: true, text: "Записан чек " + id + (warn.length ? "\nВнимание: " + warn.join("; ") : "") };
    }
    if (kind === "warranty") {
      const n = nvCreateWarranty(v);
      return { ok: true, text: "Открыт случай " + n };
    }
  } catch (e) {
    return { ok: false, text: String(e?.message ? e.message : e) };
  }
  return { ok: false, text: "Неизвестная форма" };
}
