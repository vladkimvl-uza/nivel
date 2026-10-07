/**
 * Money, calendar and threshold rules as pure functions (no SpreadsheetApp).
 * Mirror of packages/domain (fee, cancel, threshold, reserve, calendar, money). A test compares the results with the
 * domain on a table of cases; if the domain changes, this file and the "Настройки" sheet change with it.
 *
 * Sums are whole sums (safe integers); rates are basis points. Products base x rate go through BigInt, so the
 * result is exact for any base up to the safe-integer limit.
 */

/** Default money rules (copy of DEFAULT_FEE_SETTINGS version 2026-10-05, rules 4.8 and the owner's decisions). */
const NV_DEFAULTS = {
  feeVersion: "2026-10-05",
  pcLowBp: 1500,
  pcHighBp: 1000,
  pcThreshold: 20000000,
  pcHighMinFee: 3000000,
  mountBp: 1500,
  complexBp: 1500,
  minPc: 6700000,
  minWindow: 4500000,
  minSetup: 13300000,
  minUpgrade: 4000000,
  stageSelectionBp: 2000,
  stagePurchaseBp: 3000,
  stageAssemblyBp: 3500,
  stageHandoverBp: 1500,
  commissionBp: 5000,
  advanceBp: 3000,
  podborBp: 2000,
  podborCreditDays: 30,
  afterTestsBp: 8500,
  reserveBp: 300,
  reserveHighBp: 500,
  reserveHighShareBp: 2500,
  reserveStep: 10000,
  shelfHours: 24,
  shelfHoursFurniture: 72,
  meetingFrom: 15000000,
  reportTargetHours: 24,
  reportDeadlineHours: 48,
  objectionDays: 3,
  refundDays: 5,
  esfDays: 10,
  warrantyMonths: 12,
  aftercareShort: 7,
  aftercareLong: 30,
  firstResponseHours: 2,
  responseFrom: "10:00",
  responseTo: "19:00",
  annualLimit: 1000000000,
  regDate: "",
  proportion: "Без дня регистрации",
  alerts: [6000, 7000, 8000, 9000, 10000],
  planCap2026: 200000000,
  turnoverTaxBp: 100,
  socialTax: 440000,
  warrantyRateBp: 200,
  warrantyMin: 150000,
  warrantyMatureBp: 100,
  warrantyMatureBalance: 10000000,
  warrantyMatureOrders: 30,
  warrantyMatureLossBp: 50,
  warrantyStart: 3000000,
  taxRiskBp: 100,
  taxRiskActive: true,
  cacLimit: 500000,
  worsePct: 20,
  cycleTargetDays: 10,
  maxBudget: 1000000000000,
  hmacSkewSec: 300,
  xolisWithholds: true,
  xolisWithdrawBp: 100,
  alertAckPct: 0,
};

/** Cancellation points: code, statuses, the share of the fee earned. */
const NV_CANCEL_POINTS = [
  {
    code: "before_accept",
    label: "До принятия сметы",
    statuses: ["estimate_draft", "estimate_sent", "estimate_expired"],
  },
  { code: "after_accept_before_purchase", label: "После принятия, до закупки", statuses: ["accepted"] },
  {
    code: "after_purchase_before_assembly",
    label: "После закупки, до сборки",
    statuses: ["purchasing", "report_due", "report_sent", "settled"],
  },
  { code: "during_assembly", label: "Во время сборки", statuses: ["assembling", "testing"] },
  { code: "after_tests_before_handover", label: "После тестов, до сдачи", statuses: ["ready", "delivering"] },
];

function nvInt(value, name) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError((name || "value") + " must be a safe integer, got " + String(value));
  }
  return value + 0;
}

function nvNonNegative(value, name) {
  const v = nvInt(value, name);
  if (v < 0) throw new RangeError((name || "value") + " must not be negative, got " + v);
  return v;
}

/** a / d for BigInt (d > 0) rounded towards minus infinity. */
function nvFloorDiv(a, d) {
  const q = a / d;
  return a % d !== 0n && a < 0n ? q - 1n : q;
}

/** a / d rounded to an integer: "floor", "ceil" or "half_up" (ties towards plus infinity). */
function nvDivRound(a, d, mode) {
  if (mode === "floor") return nvFloorDiv(a, d);
  if (mode === "ceil") return -nvFloorDiv(-a, d);
  if (mode === "half_up") return nvFloorDiv(2n * a + d, 2n * d);
  throw new RangeError("Unknown rounding mode: " + String(mode));
}

/** base x rate / 10 000 rounded to a whole sum. Exact for any safe base. */
function nvApplyBp(base, rate, mode) {
  return Number(nvDivRound(BigInt(nvInt(base, "base")) * BigInt(rate), 10000n, mode));
}

/** Rounds to a multiple of step ("ceil" up, "floor" down). */
function nvRoundTo(value, step, mode) {
  const s = BigInt(step);
  return Number(nvDivRound(BigInt(nvInt(value, "value")), s, mode) * s);
}

/** Largest-remainder split of total by shares in bp (sum of shares = 10 000); ties go to the lower index. */
function nvSplitByShares(total, shares) {
  const t = BigInt(nvNonNegative(total, "total"));
  const w = shares.map((x) => BigInt(x));
  if (w.reduce((a, b) => a + b, 0n) !== 10000n) throw new RangeError("shares must add up to 10 000 bp");
  const parts = w.map((x) => (t * x) / 10000n);
  const rem = w.map((x, i) => t * x - parts[i] * 10000n);
  let left = Number(t - parts.reduce((a, b) => a + b, 0n));
  const order = rem.map((r, i) => ({ r: r, i: i })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; k < order.length && left > 0; k++, left--) parts[order[k].i] += 1n;
  return parts.map((p) => Number(p));
}

/** Fee of the PC part (rule + amount). */
function nvPcFeePart(base, s, complexBuild) {
  if (base <= 0) return { amount: 0, rule: "none", rateBp: 0 };
  if (complexBuild) return { amount: nvApplyBp(base, s.complexBp, "floor"), rule: "complex", rateBp: s.complexBp };
  if (base < s.pcThreshold) return { amount: nvApplyBp(base, s.pcLowBp, "floor"), rule: "pc_low", rateBp: s.pcLowBp };
  const scaled = nvApplyBp(base, s.pcHighBp, "floor");
  return scaled >= s.pcHighMinFee
    ? { amount: scaled, rule: "pc_high", rateBp: s.pcHighBp }
    : { amount: s.pcHighMinFee, rule: "pc_high_min", rateBp: s.pcHighBp };
}

/** computeFee: fee by the scale, rounded down; two document lines (commission and works), the odd sum goes to the first. */
function nvComputeFee(input, s) {
  const basePc = nvNonNegative(input.basePc || 0, "basePc");
  const baseMount = nvNonNegative(input.baseMount || 0, "baseMount");
  const pc = nvPcFeePart(basePc, s, !!input.complex);
  const mount = baseMount > 0 ? nvApplyBp(baseMount, s.mountBp, "floor") : 0;
  const total = pc.amount + mount;
  const base = basePc + baseMount;
  const rateBp = base > 0 ? Math.min(10000, Number((BigInt(total) * 10000n) / BigInt(base))) : 0;
  const parts = nvSplitByShares(total, [s.commissionBp, 10000 - s.commissionBp]);
  return {
    pcFee: pc.amount,
    pcRule: pc.rule,
    mountFee: mount,
    total: total,
    rateBp: rateBp,
    commission: parts[0],
    works: parts[1],
  };
}

/** Reserve against price growth: 3 % (5 % when memory and SSD are 25 % or more of what the IP buys), up, then up to 10 000. */
function nvReserve(purchased, memory, s) {
  if (purchased <= 0) return { bp: s.reserveBp, sum: 0 };
  const high = BigInt(memory) * 10000n >= BigInt(s.reserveHighShareBp) * BigInt(purchased);
  const rate = high ? s.reserveHighBp : s.reserveBp;
  return { bp: rate, sum: nvRoundTo(nvApplyBp(purchased, rate, "ceil"), s.reserveStep, "ceil") };
}

/** Eligibility label as in the "Допуск" column. */
function nvEligibility(kind, basePc, baseMount, freeWindow, s) {
  if (kind === "Подбор") return "«Подбор»";
  const base = basePc + baseMount;
  if (kind === "Сетап") return base >= s.minSetup ? "Полный цикл" : "Сетап ниже минимума";
  // An upgrade is a new order by the full scheme and the same scale, from an estimate of 4 million (DECISIONS R-26)
  if (kind === "Апгрейд") return base >= s.minUpgrade ? "Полный цикл" : "Только «Подбор»";
  if (base >= s.minPc) return "Полный цикл";
  if (base >= s.minWindow) return freeWindow ? "Только в свободное окно" : "Только «Подбор»: окна нет";
  return "Только «Подбор»";
}

/** The whole estimate (computeQuote): fee, reserve, limit, advance/final, grand total, eligibility, podbor. */
function nvComputeQuote(input, s) {
  const kind = input.kind || "ПК";
  const basePc = nvNonNegative(input.basePc || 0, "basePc");
  const baseMount = nvNonNegative(input.baseMount || 0, "baseMount");
  const outside = nvNonNegative(input.outside || 0, "outside");
  const purchased = nvNonNegative(input.purchased || 0, "purchased");
  const memory = nvNonNegative(input.memory || 0, "memory");
  const fee = nvComputeFee({ basePc: basePc, baseMount: baseMount, complex: input.complex }, s);
  const reserve = nvReserve(purchased, memory, s);
  const limit = purchased + reserve.sum;
  const split = nvSplitByShares(fee.total, [s.advanceBp, 10000 - s.advanceBp]);
  const podbor = nvApplyBp(fee.total, s.podborBp, "floor");
  return {
    kind: kind,
    pcFee: fee.pcFee,
    mountFee: fee.mountFee,
    feeTotal: fee.total,
    rateBp: fee.rateBp,
    commission: fee.commission,
    works: fee.works,
    advance: split[0],
    final: split[1],
    reserveBp: reserve.bp,
    reserveSum: reserve.sum,
    purchaseLimit: limit,
    podborFee: podbor,
    grandTotal: kind === "Подбор" ? podbor : limit + fee.total,
    eligibility: nvEligibility(kind, basePc, baseMount, !!input.freeWindow, s),
    outside: outside,
  };
}

/** podborFee: a share of the scale fee, rounded down. */
function nvPodborFee(feeTotal, s) {
  return nvApplyBp(feeTotal, s.podborBp, "floor");
}

/**
 * partsBudgetFromTotal: the largest base whose total (base + PC-scale fee + reserve) fits the client's budget.
 * Exact binary search; the cost is monotone, so both branches of the scale are covered.
 */
function nvPartsFromBudget(total, s, reserveBp) {
  const budget = nvNonNegative(total, "budget");
  if (budget > s.maxBudget) throw new RangeError("Budget must not exceed " + s.maxBudget + " sums");
  const cost = (parts) =>
    parts + nvPcFeePart(parts, s, false).amount + nvRoundTo(nvApplyBp(parts, reserveBp, "ceil"), s.reserveStep, "ceil");
  let lo = 0;
  let hi = budget;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (cost(mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* ---------------------------------------------------------------- calendar (Asia/Tashkent, UTC+5) */

function nvPad(n, w) {
  let s = String(n);
  while (s.length < w) s = "0" + s;
  return s;
}

/** The ISO date on the wall in Tashkent at the instant d. */
function nvIsoDate(d) {
  const l = new Date(d.getTime() + NV_TZ_OFFSET_MS);
  return nvPad(l.getUTCFullYear(), 4) + "-" + nvPad(l.getUTCMonth() + 1, 2) + "-" + nvPad(l.getUTCDate(), 2);
}

/** Instant of 00:00 Tashkent time on the local date of d. */
function nvMidnight(d) {
  return Math.floor((d.getTime() + NV_TZ_OFFSET_MS) / NV_DAY_MS) * NV_DAY_MS - NV_TZ_OFFSET_MS;
}

/** Instant for a local Tashkent date and time. */
function nvLocalDate(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0) - NV_TZ_OFFSET_MS);
}

/** Parses "YYYY-MM-DD" (strict) into a Tashkent midnight; throws RangeError for anything else. */
function nvParseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) throw new RangeError("Invalid ISO date: " + JSON.stringify(iso));
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new RangeError("Invalid ISO date: " + JSON.stringify(iso));
  }
  return { year: y, month: mo, day: d };
}

function nvWeekday(iso) {
  const p = nvParseIso(iso);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Monday to Saturday minus holidays (list of ISO dates). */
function nvIsWorkingDay(iso, holidays) {
  return nvWeekday(iso) !== 0 && (holidays || []).indexOf(iso) < 0;
}

/** Working days after the local date of start, keeping the time of day (addWorkingDays of the domain). */
function nvAddWorkingDays(start, n, holidays) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("addWorkingDays: n must be a non-negative integer");
  let cursor = start.getTime();
  let counted = 0;
  while (counted < n) {
    cursor += NV_DAY_MS;
    if (nvIsWorkingDay(nvIsoDate(new Date(cursor)), holidays)) counted += 1;
  }
  return new Date(cursor);
}

/** First working day strictly after the local date of start, at the opening time (default 10:00). */
function nvNextWorkingDayStart(start, holidays, openingMinutes) {
  let day = nvMidnight(start) + NV_DAY_MS;
  while (!nvIsWorkingDay(nvIsoDate(new Date(day)), holidays)) day += NV_DAY_MS;
  return new Date(day + (openingMinutes === undefined ? 600 : openingMinutes) * 60000);
}

/** Adds calendar months in Tashkent time; a shorter target month gives its last day (addMonthsTashkent). */
function nvAddMonths(from, months) {
  const l = new Date(from.getTime() + NV_TZ_OFFSET_MS);
  const index = l.getUTCFullYear() * 12 + l.getUTCMonth() + months;
  const year = Math.floor(index / 12);
  const month = index % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(l.getUTCDate(), lastDay);
  const shifted = Date.UTC(
    year,
    month,
    day,
    l.getUTCHours(),
    l.getUTCMinutes(),
    l.getUTCSeconds(),
    l.getUTCMilliseconds(),
  );
  return new Date(shifted - NV_TZ_OFFSET_MS);
}

function nvParseHm(hm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm));
  if (!m) throw new RangeError("Time must be HH:MM, got " + JSON.stringify(hm));
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Hours of the response window (default 10:00-19:00, Monday to Saturday, no holidays) between two instants. */
function nvWorkingHoursBetween(from, to, holidays, fromHm, toHm) {
  const open = nvParseHm(fromHm || "10:00");
  const close = nvParseHm(toHm || "19:00");
  if (to.getTime() <= from.getTime()) return 0;
  let total = 0;
  let day = nvMidnight(from);
  const end = to.getTime();
  while (day < end) {
    if (nvIsWorkingDay(nvIsoDate(new Date(day)), holidays)) {
      const a = Math.max(from.getTime(), day + open * 60000);
      const b = Math.min(end, day + close * 60000);
      if (b > a) total += b - a;
    }
    day += NV_DAY_MS;
  }
  return total / 3600000;
}

/**
 * The moment when `hours` working hours have passed since `from`: the count starts at the opening of the nearest window
 * (a lead of 23:00 is counted from 10:00 of the next working day), the end of a day carries the rest to the next working
 * day. The inverse of nvWorkingHoursBetween.
 */
function nvAddWorkingHours(from, hours, holidays, fromHm, toHm) {
  const open = nvParseHm(fromHm || "10:00");
  const close = nvParseHm(toHm || "19:00");
  let left = hours * 3600000;
  let day = nvMidnight(from);
  let cursor = from.getTime();
  for (let guard = 0; guard < 400; guard++) {
    if (nvIsWorkingDay(nvIsoDate(new Date(day)), holidays)) {
      const a = Math.max(cursor, day + open * 60000);
      const b = day + close * 60000;
      if (b > a) {
        if (left <= b - a) return new Date(a + left);
        left -= b - a;
      }
    }
    day += NV_DAY_MS;
    cursor = day;
  }
  throw new RangeError("addWorkingHours: no working day within a year");
}

/** True inside the response hours of a working day. */
function nvIsResponseHours(at, holidays, fromHm, toHm) {
  const l = new Date(at.getTime() + NV_TZ_OFFSET_MS);
  const minutes = l.getUTCHours() * 60 + l.getUTCMinutes();
  return (
    nvIsWorkingDay(nvIsoDate(at), holidays) &&
    minutes >= nvParseHm(fromHm || "10:00") &&
    minutes < nvParseHm(toHm || "19:00")
  );
}

/* ---------------------------------------------------------------- warranty case deadlines */

/** Deadlines of a warranty case: reply 1 working day, diagnosis 2, loaner 3 days, fix 10 working days or 20 days. */
function nvWarrantyDeadlines(openedAt, holidays) {
  return {
    reply: nvAddWorkingDays(openedAt, 1, holidays),
    diagnosis: nvAddWorkingDays(openedAt, 2, holidays),
    loaner: new Date(openedAt.getTime() + 3 * NV_DAY_MS),
    fixWork: nvAddWorkingDays(openedAt, 10, holidays),
    fixParts: new Date(openedAt.getTime() + 20 * NV_DAY_MS),
  };
}

/* ---------------------------------------------------------------- cancellation (BigInt, never a sheet formula) */

function nvFloorShare(fee, scaledBp) {
  return Number((BigInt(fee) * scaledBp) / 100000000n);
}

/** Fee earned by the stage price list. scaledBp is a rate in 1/10 000 of a basis point. */
function nvEarnedFee(point, fee, doneBp, s) {
  const sc = (bp) => BigInt(bp) * 10000n;
  switch (point) {
    case "before_accept":
      return 0;
    case "after_accept_before_purchase":
      return nvFloorShare(fee, sc(s.stageSelectionBp));
    case "after_purchase_before_assembly":
      return nvFloorShare(fee, sc(s.stageSelectionBp + s.stagePurchaseBp));
    case "during_assembly":
      if (doneBp === undefined || doneBp === null || doneBp === "")
        throw new RangeError("assemblyDoneBp is required during assembly");
      if (!Number.isInteger(doneBp) || doneBp < 0 || doneBp > 10000)
        throw new RangeError("assemblyDoneBp must be 0..10000");
      return nvFloorShare(fee, sc(s.stageSelectionBp + s.stagePurchaseBp) + BigInt(s.stageAssemblyBp) * BigInt(doneBp));
    case "after_tests_before_handover":
      return nvFloorShare(fee, sc(s.afterTestsBp));
    default:
      throw new RangeError("Unknown cancellation point: " + String(point));
  }
}

const NV_PARTS_GO_TO = {
  before_accept: "none",
  after_accept_before_purchase: "none",
  after_purchase_before_assembly: "shop_or_client",
  during_assembly: "client",
  after_tests_before_handover: "client",
};

/** settleCancellation: earned fee, refund of the fee, extra QR, funds to return, due date (+5 working days). */
function nvSettleCancellation(input, s, now, holidays) {
  const fee = nvNonNegative(input.fee, "fee");
  const feePaid = nvNonNegative(input.feePaid, "feePaid");
  const fundsReceived = nvNonNegative(input.fundsReceived, "fundsReceived");
  const receiptsTotal = nvNonNegative(input.receiptsTotal, "receiptsTotal");
  const shopRefunds = nvNonNegative(input.shopRefunds || 0, "shopRefunds");
  const losses = nvNonNegative(input.documentedLosses || 0, "documentedLosses");
  if (shopRefunds > receiptsTotal) throw new RangeError("Shop refunds exceed the receipts they refund");
  const afterReceipts = fundsReceived - receiptsTotal + shopRefunds;
  if (afterReceipts < 0)
    throw new RangeError("Receipts exceed the money received: the client's money would be exceeded");
  const fundsToRefund = afterReceipts - losses;
  if (fundsToRefund < 0) throw new RangeError("Documented losses exceed the remaining funds");
  const earned = nvEarnedFee(input.point, fee, input.assemblyDoneBp, s);
  if (earned > fee) throw new RangeError("Earned fee exceeds the fee: check the stage shares in the settings");
  return {
    feeEarned: earned,
    feeToRefund: Math.max(feePaid - earned, 0),
    feeToInvoice: Math.max(earned - feePaid, 0),
    fundsToRefund: fundsToRefund,
    partsGoTo: NV_PARTS_GO_TO[input.point],
    dueBy: nvAddWorkingDays(now, s.refundDays, holidays),
  };
}

/* ---------------------------------------------------------------- annual threshold */

function nvIsLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Limit of the year: the whole limit, or in the registration year floor(limit x remaining days / days in year). */
function nvThresholdForYear(year, s) {
  if (!Number.isInteger(year)) throw new RangeError("Year must be an integer, got " + String(year));
  const limit = nvNonNegative(s.annualLimit, "annualLimit");
  if (!s.regDate) return limit;
  const reg = nvParseIso(s.regDate);
  if (reg.year !== year) return limit;
  const daysInYear = nvIsLeap(year) ? 366 : 365;
  const dayOfYear = (Date.UTC(year, reg.month - 1, reg.day) - Date.UTC(year, 0, 1)) / NV_DAY_MS + 1;
  const days = daysInYear - dayOfYear + (s.proportion === "С днём регистрации" ? 1 : 0);
  return Number((BigInt(limit) * BigInt(days)) / BigInt(daysInYear));
}

function nvShareOf(part, whole) {
  if (part <= 0) return 0;
  if (whole <= 0) return 10000;
  return Math.min(10000, Number((BigInt(part) * 10000n) / BigInt(whole)));
}

/** thresholdStatus: entries {kind: receipt|fee_in|fee_refund|other_income, amount, date: ISO}. */
function nvThresholdStatus(entries, committed, year, s) {
  const limit = nvThresholdForYear(year, s);
  let volume = 0;
  for (const e of entries) {
    const y = nvParseIso(e.date).year;
    if (y !== year) continue;
    if (e.kind === "fee_refund") volume -= nvInt(e.amount, "amount");
    else if (e.kind === "receipt" || e.kind === "fee_in" || e.kind === "other_income")
      volume += nvInt(e.amount, "amount");
    else throw new RangeError("Unknown deal entry kind: " + String(e.kind));
  }
  const projected = volume + committed;
  const alerts = Array.from(new Set(s.alerts)).sort((a, b) => a - b);
  const shareBp = nvShareOf(volume, limit);
  return {
    year: year,
    limit: limit,
    volume: volume,
    committed: committed,
    shareBp: shareBp,
    projectedShareBp: nvShareOf(projected, limit),
    crossedAlerts: alerts.filter((a) => shareBp >= a),
    overPlanCap: year === 2026 && s.planCap2026 > 0 && projected > s.planCap2026,
    remaining: Math.max(0, limit - projected),
  };
}

/* ---------------------------------------------------------------- reserves and taxes */

/** Warranty reserve contribution of one order: 2 % up (min 150 000) until the fund matures, then 1 %. */
function nvWarrantyContribution(base, state, s) {
  if (!state || typeof state !== "object") throw new RangeError("Warranty reserve state is required");
  nvInt(state.balance, "balance");
  if (!Number.isInteger(state.closedOrders) || state.closedOrders < 0)
    throw new RangeError("Closed orders must be a count");
  if (!Number.isInteger(state.lossesBp) || state.lossesBp < 0) throw new RangeError("Losses must be basis points");
  const b = nvNonNegative(base, "base");
  if (b === 0) return 0;
  const matured =
    state.balance >= s.warrantyMatureBalance &&
    state.closedOrders >= s.warrantyMatureOrders &&
    state.lossesBp < s.warrantyMatureLossBp;
  if (matured) return nvApplyBp(b, s.warrantyMatureBp, "ceil");
  return Math.max(nvApplyBp(b, s.warrantyRateBp, "ceil"), s.warrantyMin);
}

function nvTaxRiskReserve(receiptsTotal, active, s) {
  const total = nvNonNegative(receiptsTotal, "receiptsTotal");
  if (typeof active !== "boolean") throw new RangeError("taxRiskActive must be a boolean");
  return active ? nvApplyBp(total, s.taxRiskBp, "ceil") : 0;
}

/** Turnover tax estimate: 1 % of the fee (net of refunds), rounded up to a whole sum. */
function nvTurnoverTax(netFee, s) {
  return nvApplyBp(Math.max(0, netFee), s.turnoverTaxBp, "ceil");
}

/** Loss rate of the last 12 months in bp: expenses from the reserve / receipts of the orders delivered. */
function nvLossesBp(expenses, receipts12m) {
  return Number((BigInt(Math.max(0, expenses)) * 10000n) / BigInt(Math.max(1, receipts12m)));
}

/* ---------------------------------------------------------------- payments */

const NV_PAYMENT_KINDS = [
  {
    code: "fee_advance",
    label: "Аванс платы 30 %",
    group: "Плата",
    direction: "Входящий",
    methods: ["QR Xolis", "Карта (мерчант)"],
  },
  {
    code: "fee_final",
    label: "Финал платы 70 %",
    group: "Плата",
    direction: "Входящий",
    methods: ["QR Xolis", "Карта (мерчант)"],
  },
  {
    code: "fee_extra",
    label: "Доплата платы",
    group: "Плата",
    direction: "Входящий",
    methods: ["QR Xolis", "Карта (мерчант)"],
  },
  {
    code: "podbor_fee",
    label: "Плата «Подбор»",
    group: "Плата",
    direction: "Входящий",
    methods: ["QR Xolis", "Карта (мерчант)"],
  },
  {
    code: "purchase_funds",
    label: "Деньги на закупку",
    group: "Закупка",
    direction: "Входящий",
    methods: ["Перевод на счёт ИП"],
  },
  {
    code: "purchase_topup",
    label: "Доплата на закупку",
    group: "Закупка",
    direction: "Входящий",
    methods: ["Перевод на счёт ИП"],
  },
  {
    code: "remainder_refund",
    label: "Возврат остатка",
    group: "Возврат денег",
    direction: "Исходящий",
    methods: ["Исходящий перевод"],
  },
  {
    code: "fee_refund",
    label: "Возврат платы",
    group: "Возврат платы",
    direction: "Исходящий",
    methods: ["Исходящий перевод"],
  },
  {
    code: "funds_refund",
    label: "Возврат денег на закупку",
    group: "Возврат денег",
    direction: "Исходящий",
    methods: ["Исходящий перевод"],
  },
];

const NV_PAYMENT_METHODS = [
  { code: "xolis_qr", label: "QR Xolis" },
  { code: "merchant_card", label: "Карта (мерчант)" },
  { code: "bank_transfer_ip", label: "Перевод на счёт ИП" },
  { code: "bank_transfer_out", label: "Исходящий перевод" },
];

function nvPaymentKindByLabel(label) {
  return NV_PAYMENT_KINDS.find((k) => k.label === label || k.code === label) || null;
}

/** The "Проверка" column as validatePayment: kind x method x direction, receipt for a confirmed fee. */
function nvCheckPayment(kindLabel, method, status, receiptNo) {
  const k = nvPaymentKindByLabel(kindLabel);
  if (!kindLabel) return "";
  if (!k) return "Неизвестный вид платежа";
  if (k.methods.indexOf(method) < 0) {
    if (k.group === "Плата") return "Неверная пара: плата только QR или карта";
    if (k.group === "Закупка") return "Неверная пара: закупка только на счёт ИП";
    return "Неверная пара: возврат только переводом";
  }
  if (k.group === "Плата" && status === "Подтверждён" && String(receiptNo || "").trim() === "")
    return "Нужен фискальный чек";
  return "ОК";
}

/**
 * Does a payment count as money (received or returned)? Only a confirmed one whose pair of kind and method is allowed
 * (and, for a fee, with the fiscal receipt): the same rule as the column "Проверка" and the sums of the sheets.
 */
function nvPaymentCounts(p) {
  return p.status === "Подтверждён" && nvCheckPayment(p.kind, p.method, p.status, p.receipt) === "ОК";
}
