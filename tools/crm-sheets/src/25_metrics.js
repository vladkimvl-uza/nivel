/**
 * The model of the dashboard in script code: the same figures as the formulas of "_Данные", computed from the rows of the
 * sheets. It serves the digest, the preview and the tests; the sheet itself is always drawn by its own formulas.
 * Also here: the list of the tasks by the 20 rules of "Сегодня" (the formulas collect them in the sheet).
 */

/** Calendar helpers on Tashkent dates (midnight instants). */
function nvYmd(d) {
  const l = new Date(d.getTime() + NV_TZ_OFFSET_MS);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate() };
}

function nvDay(y, m, d) {
  return nvLocalDate(y, m, d, 0, 0);
}

function nvEndOfMonth(y, m) {
  return nvDay(y, m + 1, 0);
}

/** Bounds of the period of the panel: {from, to, prevFrom, prevTo} (dates at midnight; prev may be null). */
function nvPeriodBounds(period, today) {
  const t = nvYmd(today);
  const edate = (d, n) => nvMidnightDate(nvAddMonths(d, n));
  let from;
  let to;
  let prevFrom = null;
  let prevTo = null;
  const first = nvDay(t.y, t.m, 1);
  const minDate = (a, b) => (a.getTime() < b.getTime() ? a : b);
  switch (period) {
    case "Прошлый месяц":
      from = nvDay(t.y, t.m - 1, 1);
      to = nvDay(t.y, t.m, 0);
      prevFrom = edate(from, -1);
      prevTo = nvDay(nvYmd(from).y, nvYmd(from).m, 0);
      break;
    case "Квартал": {
      const qm = 3 * Math.floor((t.m - 1) / 3) + 1;
      from = nvDay(t.y, qm, 1);
      to = nvEndOfMonth(t.y, qm + 2);
      prevFrom = edate(from, -3);
      prevTo = edate(minDate(to, today), -3);
      break;
    }
    case "С начала года":
      from = nvDay(t.y, 1, 1);
      to = today;
      prevFrom = edate(from, -12);
      prevTo = edate(today, -12);
      break;
    case "12 месяцев":
      from = new Date(edate(today, -12).getTime() + NV_DAY_MS);
      to = today;
      prevFrom = edate(from, -12);
      prevTo = edate(today, -12);
      break;
    case "Всё время":
      from = nvDay(2026, 1, 1);
      to = today;
      break;
    default:
      from = first;
      to = nvEndOfMonth(t.y, t.m);
      prevFrom = edate(from, -1);
      prevTo = edate(minDate(to, today), -1);
      break;
  }
  return {
    from: from,
    to: to,
    toX: new Date(to.getTime() + NV_DAY_MS),
    prevFrom: prevFrom,
    prevTo: prevTo,
    prevToX: prevTo ? new Date(prevTo.getTime() + NV_DAY_MS) : null,
  };
}

function nvFmtMln(n) {
  return (Math.round(n / 100000) / 10).toFixed(1).replace(".", ",");
}

function nvFmtPct0(x) {
  return Math.round(x * 100) + "%";
}

function nvCompareJs(b, c) {
  if (c === null || c === "" || c === undefined) return "";
  if (c === 0) return "прошлый: 0";
  const p = Math.round(((b - c) / c) * 100);
  return (p > 0 ? "+" + p : String(p)) + "% к прошлому";
}

/** The rows of all tables, filtered by the demo switch. */
function nvModelData(includeDemo) {
  const keep = (r) => includeDemo || r.demo !== true;
  return {
    leads: nvReadTable("leads").filter(keep),
    orders: nvReadTable("orders").filter(keep),
    payments: nvReadTable("payments").filter(keep),
    purchases: nvReadTable("purchases").filter(keep),
    warranty: nvReadTable("warranty").filter(keep),
    reserves: nvReadTable("reserves").filter(keep),
    clients: nvReadTable("clients"),
  };
}

/** Derived money of every order (the same as the formula columns). */
function nvModelOrders(data, s, holidays) {
  return data.orders.map((o) => {
    const st = nvOrderState(o, data.payments, data.purchases, data.orders, s, holidays);
    return { o: o, st: st, status: nvStatusByCode(o.code) };
  });
}

/** The figures of the panel for a period. opts: {period, year, includeDemo, today}. */
function nvDashboardModel(opts) {
  const o = opts || {};
  const today = o.today || nvToday();
  const s = nvSettings();
  const holidays = nvHolidays();
  const period = o.period || "Этот месяц";
  const b = nvPeriodBounds(period, today);
  const year = o.year || nvYmd(today).y;
  const data = nvModelData(o.includeDemo === true);
  const orders = nvModelOrders(data, s, holidays);
  const within = (v, from, toX) => {
    const d = nvToDate(v);
    return !!d && !!from && d.getTime() >= from.getTime() && d.getTime() < toX.getTime();
  };
  const groupOf = (p) => (nvPaymentKindByLabel(p.kind) || { group: "" }).group;
  const feeIn = (from, toX) => {
    if (!from) return null;
    let sum = 0;
    data.payments.forEach((p) => {
      if (!nvPaymentCounts(p) || !within(p.date, from, toX)) return;
      if (groupOf(p) === "Плата") sum += Number(p.amount) || 0;
      if (groupOf(p) === "Возврат платы") sum -= Number(p.amount) || 0;
    });
    return sum;
  };
  const countBy = (list, key, from, toX) => (from ? list.filter((r) => within(r[key], from, toX)).length : null);
  const leadsIn = (from, toX, pred) =>
    from ? data.leads.filter((l) => within(l.created, from, toX) && (!pred || pred(l))) : [];
  const convOf = (from, toX) => {
    if (!from) return null;
    const all = leadsIn(from, toX);
    const spam = leadsIn(from, toX, (l) => l.status === "Спам").length;
    const conv = leadsIn(from, toX, (l) => l.status === "В заказе").length;
    return all.length - spam > 0 ? conv / (all.length - spam) : 0;
  };
  const deliveredOrders = (from, toX) => (from ? orders.filter((x) => within(x.o.dHandover, from, toX)) : []);
  const avgFee = (from, toX) => {
    const list = deliveredOrders(from, toX);
    return list.length ? Math.trunc(list.reduce((a, x) => a + x.st.quote.feeTotal, 0) / list.length) : 0;
  };
  const replyHours = (l) => {
    const c = nvToDate(l.created);
    const r = nvToDate(l.firstReply);
    return c && r ? nvWorkingHoursBetween(c, r, holidays, s.responseFrom, s.responseTo) : null;
  };
  const median = (xs) => {
    if (!xs.length) return null;
    const a = xs.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const replyIn = (from, toX) =>
    from
      ? median(
          leadsIn(from, toX)
            .map(replyHours)
            .filter((x) => x !== null),
        )
      : null;
  const k = {};
  // "Worse" is a change that matters (NV_WORSE_PCT or more); a count of the previous period below minPrev alarms nobody
  const cmp = (key, v, prev, text, lowerIsBetter, minPrev) => {
    const share = 1 - (Number(s.worsePct) || 0) / 100;
    const empty = prev === null || prev === undefined || prev === "" || v === null;
    const moved = empty ? false : lowerIsBetter ? v > prev * (2 - share) : v < prev * share;
    const worse = empty ? false : minPrev ? prev >= minPrev && moved : moved;
    k[key] = { value: v, prev: prev === undefined ? null : prev, text: text, worse: worse };
  };
  // fee
  const fee = feeIn(b.from, b.toX);
  const feePrev = feeIn(b.prevFrom, b.prevToX);
  const nPay = data.payments.filter(
    (p) => nvPaymentCounts(p) && groupOf(p) === "Плата" && within(p.date, b.from, b.toX),
  ).length;
  const inHand = Math.floor((fee * (10000 - Number(s.xolisWithdrawBp || 0))) / 10000);
  void nPay;
  cmp(
    "fee",
    fee,
    feePrev,
    ["на руки ≈ " + nvFmtMln(inHand) + " млн", nvCompareJs(fee, feePrev)].filter(Boolean).join(" · "),
  );
  // wip
  const wip = orders.filter((x) => x.status && x.status.group === "В работе");
  const waiting = orders.filter((x) => x.status && x.status.group === "Ждёт клиента").length;
  k.wip = {
    value: wip.length,
    prev: null,
    text: nvFmtMln(wip.reduce((a, x) => a + x.st.quote.grandTotal, 0)) + " млн сум · ждут клиента: " + waiting,
    worse: false,
  };
  // delivered
  const dl = deliveredOrders(b.from, b.toX);
  const cycle = dl
    .map((x) => (nvToDate(x.o.dHandover).getTime() - nvToDate(x.o.dAccepted).getTime()) / NV_DAY_MS)
    .filter((x) => Number.isFinite(x));
  const dlPrev = countBy(
    orders.map((x) => x.o),
    "dHandover",
    b.prevFrom,
    b.prevToX,
  );
  cmp(
    "delivered",
    dl.length,
    dlPrev,
    [
      "цикл " +
        (cycle.length ? (cycle.reduce((a, x) => a + x, 0) / cycle.length).toFixed(1).replace(".", ",") + " дн." : "—"),
      nvCompareJs(dl.length, dlPrev),
    ]
      .filter(Boolean)
      .join(" · "),
    false,
    3,
  );
  // leads: without spam (the funnel and the conversion count the same)
  const notSpam = (l) => l.status !== "Спам";
  const lc = leadsIn(b.from, b.toX, notSpam).length;
  const lp = b.prevFrom ? leadsIn(b.prevFrom, b.prevToX, notSpam).length : null;
  cmp(
    "leads",
    lc,
    lp,
    [
      "спам " +
        leadsIn(b.from, b.toX, (l) => l.status === "Спам").length +
        " · отказ " +
        leadsIn(b.from, b.toX, (l) => l.status === "Отказ").length,
      nvCompareJs(lc, lp),
    ].join(" · "),
    false,
    3,
  );
  // threshold
  const committed = orders
    .filter((x) => x.o.code === "accepted")
    .reduce((a, x) => a + x.st.quote.purchaseLimit + x.st.quote.feeTotal, 0);
  const th = nvThresholdStatus(nvThresholdEntries(o.includeDemo === true), committed, year, s);
  const plan2026 = year === 2026;
  k.threshold = {
    value: th.shareBp / 10000,
    prev: null,
    // 2026 is limited by the plan (R-7), not by the legal limit
    text: plan2026
      ? "до плана 2026 осталось " +
        nvFmtMln(Math.max(0, s.planCap2026 - th.volume - th.committed)) +
        " млн · " +
        Math.round(th.projectedShareBp / 100) +
        "% порога"
      : "до порога осталось " +
        nvFmtMln(th.remaining) +
        " млн · с принятыми " +
        Math.round(th.projectedShareBp / 100) +
        "%",
    worse: plan2026 ? th.overPlanCap === true : th.shareBp >= (s.alerts[1] || 7000),
    status: th,
  };
  // funds
  const open = orders.filter((x) => x.o.code !== "closed" && x.o.code !== "cancelled");
  const funds = open.reduce((a, x) => a + x.st.remainder, 0);
  k.funds = {
    value: funds,
    prev: null,
    text: "заказов: " + open.filter((x) => x.st.remainder > 0).length + " · сверка с выпиской",
    worse: false,
  };
  // warranty reserve
  const resBal = (fund) =>
    data.reserves.filter((r) => r.fund === fund).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const fundState = nvWarrantyFundStateFrom(data, today, holidays);
  const matured =
    fundState.balance >= s.warrantyMatureBalance &&
    fundState.closedOrders >= s.warrantyMatureOrders &&
    fundState.lossesBp < s.warrantyMatureLossBp;
  const rate = matured
    ? s.warrantyMatureBp / 100 + " %"
    : s.warrantyRateBp / 100 + " %, минимум " + String(s.warrantyMin).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " сум";
  k.wres = {
    value: resBal("Гарантийный"),
    prev: null,
    text: "взнос " + rate + " · закрыто " + fundState.closedOrders + " из " + s.warrantyMatureOrders,
    worse: false,
  };
  // tax due: the tax of the previous month
  const pm = nvYmd(today);
  const prevMonthFrom = nvDay(pm.y, pm.m - 1, 1);
  const thisMonthFrom = nvDay(pm.y, pm.m, 1);
  const taxFee = feeIn(prevMonthFrom, thisMonthFrom);
  const day15 = nvDay(pm.y, pm.m, 15);
  k.taxdue = {
    value: nvTurnoverTax(taxFee, s),
    prev: null,
    text: s.xolisWithholds === true ? "оценка · удерживает Xolis" : "к уплате до " + nvFormat(day15, "dd.MM.yyyy"),
    worse: false,
  };
  // conversion
  const cv = convOf(b.from, b.toX);
  const cvp = convOf(b.prevFrom, b.prevToX);
  cmp(
    "conv",
    cv,
    cvp,
    [
      "из " + (leadsIn(b.from, b.toX).length - leadsIn(b.from, b.toX, (l) => l.status === "Спам").length) + " заявок",
      nvCompareJs(cv, cvp),
    ].join(" · "),
  );
  // average fee
  const af = avgFee(b.from, b.toX);
  const afp = b.prevFrom ? avgFee(b.prevFrom, b.prevToX) : null;
  const feeSum = dl.reduce((a, x) => a + x.st.quote.feeTotal, 0);
  const baseSum = dl.reduce((a, x) => a + nvOrderInputs(x.o).basePc + nvOrderInputs(x.o).baseMount, 0);
  cmp(
    "avgfee",
    af,
    afp,
    [
      "ставка в среднем " + (baseSum ? ((feeSum / baseSum) * 100).toFixed(1).replace(".", ",") : "0,0") + "%",
      nvCompareJs(af, afp),
    ].join(" · "),
  );
  // first reply
  const rp = replyIn(b.from, b.toX);
  const rpp = replyIn(b.prevFrom, b.prevToX);
  const rl = leadsIn(b.from, b.toX)
    .map(replyHours)
    .filter((x) => x !== null);
  cmp(
    "reply",
    rp,
    rpp,
    [
      "цель " +
        s.firstResponseHours +
        " ч: в срок " +
        nvFmtPct0(rl.length ? rl.filter((x) => x <= s.firstResponseHours).length / rl.length : 0),
      nvCompareJs(rp || 0, rpp),
    ].join(" · "),
    true,
  );
  // overdue
  const tasks = nvTaskList(today, o.includeDemo === true, data, orders, s, holidays);
  const overdue = tasks.filter((t) => t.state === "Просрочено").length;
  const wOpen = data.warranty.filter((w) => w.num && w.status !== "Закрыт").length;
  const wOver = data.warranty.filter((w) => nvWarrantyOverdue(w, nvNow())).length;
  k.overdue = {
    value: overdue,
    prev: null,
    text: "гарантия: открыто " + wOpen + ", просрочено " + wOver,
    worse: overdue > 0,
  };
  return {
    period: period,
    bounds: b,
    year: year,
    today: today,
    includeDemo: o.includeDemo === true,
    kpis: k,
    tasks: tasks,
    orders: orders,
    data: data,
    settings: s,
    threshold: th,
  };
}

function nvWarrantyOverdue(w, now) {
  const by = { Открыт: w.replyBy, Диагностика: w.diagBy, "Выдан подменный": w.fixBy, "У поставщика": w.fixBy }[
    w.status
  ];
  const d = nvToDate(by);
  return !!d && d.getTime() < now.getTime();
}

function nvWarrantyFundStateFrom(data, today, holidays) {
  const since = nvAddMonths(today, -12);
  const gw = data.reserves.filter((r) => r.fund === "Гарантийный");
  const balance = gw.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const expenses = gw
    .filter(
      (r) =>
        r.basis === "Расход на гарантийный случай" && nvToDate(r.date) && nvToDate(r.date).getTime() >= since.getTime(),
    )
    .reduce((a, r) => a - (Number(r.amount) || 0), 0);
  const closed = data.orders.filter((x) => x.code === "closed").length;
  const receipts12 = data.orders
    .filter((x) => nvToDate(x.dHandover) && nvToDate(x.dHandover).getTime() >= since.getTime())
    .reduce(
      (a, x) => a + data.purchases.filter((p) => p.order === x.num).reduce((b, p) => b + (Number(p.amount) || 0), 0),
      0,
    );
  return { balance: balance, closedOrders: closed, lossesBp: nvLossesBp(expenses, receipts12) };
}

/* ---------------------------------------------------------------- series of the charts */

/** The series of the eight charts, from the model (the sheet takes the same from "_Данные"). */
function nvChartSeries(model) {
  const { data, orders, bounds: b, today } = model;
  const s = model.settings;
  const within = (v, from, toX) => {
    const d = nvToDate(v);
    return !!d && d.getTime() >= from.getTime() && d.getTime() < toX.getTime();
  };
  const groupOf = (p) => (nvPaymentKindByLabel(p.kind) || { group: "" }).group;
  const feeIn = (from, toX) =>
    data.payments.reduce((a, p) => {
      if (!nvPaymentCounts(p) || !within(p.date, from, toX)) return a;
      if (groupOf(p) === "Плата") return a + (Number(p.amount) || 0);
      if (groupOf(p) === "Возврат платы") return a - (Number(p.amount) || 0);
      return a;
    }, 0);
  const t = nvYmd(today);
  const monthNames = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const monthLabel = (d, withYear) => monthNames[nvYmd(d).m - 1] + (withYear ? " " + String(nvYmd(d).y).slice(2) : "");
  const series = {};
  series.fee_by_month = [];
  for (let i = 0; i < 12; i++) {
    const from = nvDay(t.y, t.m - 11 + i, 1);
    const to = nvDay(t.y, t.m - 10 + i, 1);
    const ytdFrom = nvDay(nvYmd(from).y, 1, 1);
    series.fee_by_month.push({
      label: monthLabel(from, true),
      value: feeIn(from, to) / 1000000,
      cumulative: feeIn(ytdFrom, to) / 1000000,
    });
  }
  series.deals = [];
  const entries = nvThresholdEntries(model.includeDemo === true);
  const committedOrders = orders
    .filter((x) => x.o.code === "accepted")
    .reduce((a, x) => a + x.st.quote.purchaseLimit + x.st.quote.feeTotal, 0);
  const th = model.threshold;
  for (let i = 0; i < 12; i++) {
    const from = nvDay(model.year, i + 1, 1);
    const upTo = entries.filter((e) => nvParseIso(e.date).year === model.year && nvParseIso(e.date).month <= i + 1);
    const vol = nvThresholdStatus(upTo, 0, model.year, s).volume;
    const past = from.getTime() <= today.getTime();
    const current = model.year === t.y && i + 1 >= t.m;
    series.deals.push({
      label: monthLabel(from, false),
      fact: past ? vol / 1000000 : null,
      forecast: current ? (th.volume + committedOrders) / 1000000 : null,
      plan: model.year === 2026 ? s.planCap2026 / 1000000 : null,
      limit: th.limit / 1000000,
    });
  }
  const leadsIn = (pred) => data.leads.filter((l) => within(l.created, b.from, b.toX) && (!pred || pred(l)));
  const funnel = [
    ["Заявки", leadsIn((l) => l.status !== "Спам").length],
    ["В работе", leadsIn((l) => l.status === "В работе" || l.status === "В заказе").length],
    ["Смета отправлена", orders.filter((x) => within(x.o.dEstimate, b.from, b.toX)).length],
    ["Принят", orders.filter((x) => within(x.o.dAccepted, b.from, b.toX)).length],
    ["Сдан", orders.filter((x) => within(x.o.dHandover, b.from, b.toX)).length],
  ];
  series.funnel = funnel.map((f) => ({
    label: f[0] + " · " + f[1] + " · " + nvFmtPct0(funnel[0][1] ? f[1] / funnel[0][1] : 0),
    value: f[1],
  }));
  const channels = NV_CHANNELS.map((c) => ({
    label: c.label,
    leads: leadsIn((l) => l.channel === c.label && l.status !== "Спам").length,
    orders: leadsIn((l) => l.channel === c.label && l.status === "В заказе").length,
  }))
    .filter((c) => c.leads > 0)
    .sort((a, c) => c.leads - a.leads)
    .slice(0, 8);
  series.channels = channels;
  series.stages = NV_STAGES.map((st) => {
    const list = orders.filter((x) => x.status && x.status.stage === st && x.o.code !== "estimate_expired");
    const over = list.filter(
      (x) => nvToDate(x.o.nextDate) && nvToDate(x.o.nextDate).getTime() < today.getTime(),
    ).length;
    return { label: st, inTime: list.length - over, overdue: over };
  });
  series.reserves = [];
  for (let i = 0; i < 12; i++) {
    const to = nvDay(t.y, t.m - 10 + i, 1);
    const bal = (fund) =>
      data.reserves
        .filter((r) => r.fund === fund && nvToDate(r.date) && nvToDate(r.date).getTime() < to.getTime())
        .reduce((a, r) => a + (Number(r.amount) || 0), 0) / 1000000;
    series.reserves.push({
      label: monthLabel(nvDay(t.y, t.m - 11 + i, 1), true),
      warranty: bal("Гарантийный"),
      tax: bal("Налоговый риск"),
    });
  }
  const delivered = orders
    .filter((x) => nvToDate(x.o.dHandover) && nvToDate(x.o.dAccepted))
    .sort((a, c) => nvToDate(c.o.dHandover).getTime() - nvToDate(a.o.dHandover).getTime())
    .slice(0, 12)
    .reverse();
  series.cycle = delivered.map((x) => {
    const days =
      Math.round(((nvToDate(x.o.dHandover).getTime() - nvToDate(x.o.dAccepted).getTime()) / NV_DAY_MS) * 10) / 10;
    return {
      label: x.o.num,
      days: days,
      inTarget: days <= s.cycleTargetDays ? days : 0,
      over: days > s.cycleTargetDays ? days : 0,
    };
  });
  const kinds = NV_KINDS.map((k) => ({
    label: k.label,
    value: orders.filter((x) => x.o.kind === k.label && within(x.o.created, b.from, b.toX)).length,
  }));
  series.composition = kinds;
  return series;
}

/* ---------------------------------------------------------------- the tasks (script replica of the 20 rules) */

/**
 * The tasks of "Сегодня" by the 20 rules, computed in script code. The sheet collects them with formulas; this replica
 * feeds the preview and the tests and the digest when the sheet has no values. Returns [{due, state, what, object, num, client, sum, code}].
 */
function nvTaskList(today, includeDemo, data, orders, s, holidays) {
  const now = nvNow();
  const d = data || nvModelData(includeDemo);
  const ord = orders || nvModelOrders(d, s || nvSettings(), holidays || nvHolidays());
  const set = s || nvSettings();
  const out = [];
  const add = (code, due, what, object, num, client, sum) => {
    const date = nvToDate(due);
    if (date)
      out.push({ code: code, due: date, what: what, object: object, num: num, client: client || "", sum: sum || 0 });
  };
  const hours = (n) => n * 3600000;
  const hol = holidays || nvHolidays();
  d.leads.forEach((l) => {
    const created = nvToDate(l.created);
    if (l.status === "Новая" && created && nvStr(l.firstReply) === "")
      add(
        "lead_no_reply",
        // the term counts the working hours: a lead of 23:00 is due at 12:00 of the next working day
        nvAddWorkingHours(created, set.firstResponseHours, hol, set.responseFrom, set.responseTo),
        "Ответить на новую заявку",
        "Заявка",
        l.num,
        l.name,
        Number(l.budget) || 0,
      );
    if ((l.status === "Новая" || l.status === "В работе") && nvToDate(l.nextDate))
      add("next_step", l.nextDate, "Шаг: " + nvStr(l.next), "Заявка", l.num, l.name, Number(l.budget) || 0);
  });
  const clientName = (o) => d.clients.find((c) => c.code === o.client)?.name || "";
  ord.forEach((x) => {
    const o = x.o;
    const st = x.st;
    const g = x.status ? x.status.group : "";
    const name = clientName(o);
    if (nvToDate(o.nextDate) && g !== "Сдан" && g !== "Отмена")
      add("next_step", o.nextDate, "Шаг: " + nvStr(o.nextStep), "Заказ", o.num, name, st.quote.grandTotal);
    if (
      o.code === "estimate_sent" &&
      nvToDate(o.validUntil) &&
      nvToDate(o.validUntil).getTime() - now.getTime() <= NV_DAY_MS
    )
      add(
        "estimate_expiring",
        o.validUntil,
        "Смета истекает: напомнить клиенту или пересмотреть",
        "Заказ",
        o.num,
        name,
        st.quote.grandTotal,
      );
    if (o.code === "accepted" && nvToDate(o.dAccepted)) {
      const acc = nvToDate(o.dAccepted).getTime();
      if (!st.feePaid)
        add(
          "no_advance",
          new Date(acc + hours(24)),
          "Принят без аванса: напомнить об оплате платы",
          "Заказ",
          o.num,
          name,
          st.quote.advance,
        );
      if (!st.fundsOk)
        add(
          "no_funds",
          new Date(acc + hours(24)),
          "Нет денег на закупку: напомнить о переводе на счёт ИП",
          "Заказ",
          o.num,
          name,
          st.quote.purchaseLimit,
        );
      if (st.meetingNeeded && o.meetingDone !== true)
        add(
          "meeting",
          new Date(acc + hours(24)),
          "Провести встречу или видеозвонок (первый заказ от 15 млн)",
          "Заказ",
          o.num,
          name,
          st.quote.grandTotal,
        );
    }
    if (
      o.code === "accepted" &&
      st.feePaid &&
      st.fundsOk &&
      st.notBefore &&
      (!st.meetingNeeded || o.meetingDone === true)
    )
      add("can_purchase", st.notBefore, "Можно начинать закупку", "Заказ", o.num, name, st.quote.purchaseLimit);
    if (o.code === "report_due") {
      if (nvToDate(o.reportTarget))
        add("report_due", o.reportTarget, "Отправить отчёт о закупке (цель 24 ч)", "Заказ", o.num, name, st.receipts);
      if (nvToDate(o.reportDeadline))
        add(
          "report_deadline",
          o.reportDeadline,
          "Отчёт о закупке: крайний срок 48 ч",
          "Заказ",
          o.num,
          name,
          st.receipts,
        );
    }
    if (o.code === "report_sent") {
      const acc = nvStr(o.reportAccepted);
      if ((acc === "Нет" || acc === "") && nvStr(o.objection) === "" && nvToDate(o.objectionUntil))
        add(
          "objection_expired",
          o.objectionUntil,
          "Срок возражений истёк: отчёт принят по сроку",
          "Заказ",
          o.num,
          name,
          st.remainder,
        );
      if (nvToDate(o.refundDue) && st.remainder > 0)
        add("refund_due", o.refundDue, "Вернуть остаток клиенту", "Заказ", o.num, name, st.remainder);
    }
    [
      ["aftercare1", "aftercare_7", "Сопровождение: 7 дней после сдачи, спросить, как работает сетап"],
      ["aftercare2", "aftercare_30", "Сопровождение: 30 дней после сдачи, спросить об отзыве"],
    ].forEach((a) => {
      const due = nvToDate(o[a[0]]);
      if (due && due.getTime() >= today.getTime() - NV_WARN_GRACE_DAYS * NV_DAY_MS)
        add(a[1], due, a[2], "Заказ", o.num, name, st.quote.grandTotal);
    });
    const warnFrom = today.getTime() - NV_WARN_GRACE_DAYS * NV_DAY_MS;
    const wu = nvToDate(o.warrantyUntil);
    if (wu && wu.getTime() - 30 * NV_DAY_MS >= warnFrom)
      add(
        "order_warranty_end",
        new Date(wu.getTime() - 30 * NV_DAY_MS),
        "Гарантия заказа истекает через 30 дней",
        "Заказ",
        o.num,
        name,
        st.quote.grandTotal,
      );
    // The warranty of the shops: one line for an order, the nearest end of the receipts of the order
    const shopEnds = d.purchases
      .filter((p) => p.order === o.num && Number(p.warrantyMonths) > 0 && nvToDate(p.bought))
      .map((p) => nvMidnightDate(nvAddMonths(nvToDate(p.bought), Number(p.warrantyMonths))))
      .filter((u) => u.getTime() >= today.getTime())
      .sort((a, c) => a.getTime() - c.getTime());
    if (shopEnds.length && shopEnds[0].getTime() - 30 * NV_DAY_MS >= warnFrom)
      add(
        "shop_warranty_end",
        new Date(shopEnds[0].getTime() - 30 * NV_DAY_MS),
        "Гарантия магазинов по заказу истекает через 30 дней (ближайшая)",
        "Заказ",
        o.num,
        name,
        st.quote.grandTotal,
      );
    const pu = nvToDate(o.podborUntil);
    if (o.code === "podbor_delivered" && pu && pu.getTime() - 7 * NV_DAY_MS >= warnFrom)
      add(
        "podbor_credit",
        new Date(pu.getTime() - 7 * NV_DAY_MS),
        "Зачёт «Подбора» истекает через 7 дней: предложить заказ",
        "Заказ",
        o.num,
        name,
        st.quote.podborFee,
      );
    if (o.code === "cancelling" && nvToDate(o.cancelDue))
      add(
        "cancel_due",
        o.cancelDue,
        "Отмена: вернуть клиенту до этого срока",
        "Заказ",
        o.num,
        name,
        (Number(o.feeToRefund) || 0) + (Number(o.fundsToRefund) || 0),
      );
  });
  d.purchases.forEach((p) => {
    const order = d.orders.find((x) => x.num === p.order);
    const name = order ? clientName(order) : "";
    // The term of the signing starts with the document "ЭСФ" (or a number of it), not only when the number is typed
    const hasEsf = nvStr(p.esf) !== "" || p.docKind === "ЭСФ";
    const esf = nvToDate(p.bought) && hasEsf ? new Date(nvToDate(p.bought).getTime() + set.esfDays * NV_DAY_MS) : null;
    if (esf && nvStr(p.esfStatus) !== "Подписана")
      add("esf_due", esf, "Получить подпись ЭСФ", "Закупка", p.id, name, Number(p.amount) || 0);
  });
  d.warranty.forEach((w) => {
    const order = d.orders.find((x) => x.num === w.order);
    const name = order ? clientName(order) : "";
    const due = { Открыт: w.replyBy, Диагностика: w.diagBy, "Выдан подменный": w.fixBy, "У поставщика": w.fixBy }[
      w.status
    ];
    const text =
      { Открыт: "Гарантия: ответить клиенту", Диагностика: "Гарантия: закончить диагностику" }[w.status] ||
      "Гарантия: устранить неисправность";
    if (due) add("warranty_case", due, text, "Гарантия", w.num, name, Number(w.cost) || 0);
    if ((w.status === "Открыт" || w.status === "Диагностика") && nvToDate(w.loanerBy))
      add(
        "warranty_loaner",
        w.loanerBy,
        "Гарантия: выдать подменный (3 суток)",
        "Гарантия",
        w.num,
        name,
        Number(w.cost) || 0,
      );
  });
  // Taxes
  const t = nvYmd(today);
  const day15 = nvDay(t.y, t.m, 15);
  if (today.getTime() <= day15.getTime() + 3 * NV_DAY_MS) {
    add(
      "tax_turnover",
      day15,
      set.xolisWithholds === true
        ? "Сверить налог 1 %, удержанный Xolis за прошлый месяц, с расчётом бухгалтера"
        : "Уплатить налог с оборота 1 % за прошлый месяц",
      "Налоги",
      "",
      "",
      0,
    );
    add("tax_social", day15, "Уплатить социальный налог", "Налоги", "", "", set.socialTax);
  }
  add(
    "reconcile_account",
    nvLastWorkingDay(today, holidays || nvHolidays()),
    "Сверить счёт «средства комитентов» с выпиской",
    "Налоги",
    "",
    "",
    0,
  );
  const th = nvThresholdStatus(nvThresholdEntries(includeDemo === true), 0, t.y, set);
  if (th.crossedAlerts.length && th.crossedAlerts[th.crossedAlerts.length - 1] / 100 > (Number(set.alertAckPct) || 0))
    add(
      "threshold_alert",
      today,
      "Порог года: пройден рубеж " + th.crossedAlerts[th.crossedAlerts.length - 1] / 100 + " %",
      "Порог",
      "",
      "",
      th.volume,
    );
  // The state of the term and the window of seven days. A warning whose date has passed is a "Предупреждение", not overdue.
  const horizon = today.getTime() + 8 * NV_DAY_MS;
  const inWindow = out.filter((x) => x.due.getTime() < horizon);
  // The "Шаг" of the owner is dropped when the same number has a line of a rule in the window
  const withRule = {};
  inWindow.forEach((x) => {
    if (x.code !== "next_step" && x.num) withRule[x.num] = true;
  });
  const list = inWindow
    .filter((x) => x.code !== "next_step" || !x.num || !withRule[x.num])
    .map((x) => {
      const dateOnly = x.due.getTime() === nvMidnight(x.due);
      const overdue = dateOnly ? x.due.getTime() < today.getTime() : x.due.getTime() < now.getTime();
      const dayDiff = Math.round((nvMidnight(x.due) - today.getTime()) / NV_DAY_MS);
      const soft = NV_SOFT_RULES.indexOf(x.code) >= 0;
      x.state = overdue
        ? soft
          ? "Предупреждение"
          : "Просрочено"
        : dayDiff === 0
          ? "Сегодня"
          : dayDiff === 1
            ? "Завтра"
            : "На неделе";
      return x;
    })
    .sort((a, c) => a.due.getTime() - c.due.getTime());
  return list;
}

/** The twelve weeks under the tiles: fee, orders created, delivered, leads, conversion, average fee, reply time. */
function nvWeeklySeries(model) {
  const { data, orders, today } = model;
  const s = model.settings;
  const holidays = nvHolidays();
  const monday = (() => {
    const l = new Date(today.getTime() + NV_TZ_OFFSET_MS);
    const wd = (l.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(today.getTime() - wd * NV_DAY_MS);
  })();
  const out = [];
  const groupOf = (p) => (nvPaymentKindByLabel(p.kind) || { group: "" }).group;
  for (let i = 0; i < 12; i++) {
    const from = new Date(monday.getTime() - (11 - i) * 7 * NV_DAY_MS);
    const to = new Date(from.getTime() + 7 * NV_DAY_MS);
    const within = (v) => {
      const d = nvToDate(v);
      return !!d && d.getTime() >= from.getTime() && d.getTime() < to.getTime();
    };
    const fee = data.payments.reduce((a, p) => {
      if (!nvPaymentCounts(p) || !within(p.date)) return a;
      if (groupOf(p) === "Плата") return a + (Number(p.amount) || 0);
      if (groupOf(p) === "Возврат платы") return a - (Number(p.amount) || 0);
      return a;
    }, 0);
    const delivered = orders.filter((x) => within(x.o.dHandover));
    const leads = data.leads.filter((l) => within(l.created) && l.status !== "Спам");
    const conv = leads.length ? leads.filter((l) => l.status === "В заказе").length / leads.length : 0;
    const replies = leads
      .map((l) =>
        nvToDate(l.created) && nvToDate(l.firstReply)
          ? nvWorkingHoursBetween(nvToDate(l.created), nvToDate(l.firstReply), holidays, s.responseFrom, s.responseTo)
          : null,
      )
      .filter((x) => x !== null)
      .sort((a, b) => a - b);
    const med = replies.length
      ? replies.length % 2
        ? replies[(replies.length - 1) / 2]
        : (replies[replies.length / 2 - 1] + replies[replies.length / 2]) / 2
      : 0;
    out.push({
      from: from,
      fee: fee,
      created: orders.filter((x) => within(x.o.created)).length,
      delivered: delivered.length,
      leads: leads.length,
      conv: conv,
      avgFee: delivered.length
        ? Math.trunc(delivered.reduce((a, x) => a + x.st.quote.feeTotal, 0) / delivered.length)
        : 0,
      reply: med,
    });
  }
  return out;
}
