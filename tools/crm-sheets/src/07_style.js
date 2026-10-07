/**
 * Look of the table sheets: themes, header, body, banding, conditional formatting.
 * Premium and restrained: asphalt, paper and warm grey; orange only where an action is needed.
 */

/** The theme name chosen for a sheet: "Панель" has its own choice, all other sheets share one. */
function nvThemeNameFor(sheetKey) {
  const props = nvDocProps();
  // The sheet for a phone follows the panel: it shows the same figures
  const name = props.getProperty(sheetKey === "panel" || sheetKey === "phone" ? NV_PROP.themePanel : NV_PROP.themeData);
  return name && NV_THEMES[name] ? name : "passport";
}

function nvThemeFor(sheetKey) {
  return NV_THEMES[nvThemeNameFor(sheetKey)];
}

/** Hex colour with a transparent white as "none" for conditional rules. */
function nvBorder(range, side, color, style) {
  const s = SpreadsheetApp.BorderStyle[style || "SOLID"];
  const args = [null, null, null, null, null, null, color, s];
  const pos = { top: 0, left: 1, bottom: 2, right: 3 };
  args[pos[side]] = true;
  range.setBorder.apply(range, args);
}

/** A thin line under every row of a range (the bottom edge and the lines between the rows). */
function nvRowLines(range, color) {
  range.setBorder(null, null, true, null, null, true, color, SpreadsheetApp.BorderStyle.SOLID);
}

/** A rich title "▼ Title": the mark in the accent colour, the word in the text colour. */
function nvTitleRich(title, T, size) {
  const text = "▼ " + title;
  const mark = SpreadsheetApp.newTextStyle()
    .setForegroundColor(T.accent)
    .setFontSize(size)
    .setBold(true)
    .setFontFamily(NV_FONT_TEXT)
    .build();
  const word = SpreadsheetApp.newTextStyle()
    .setForegroundColor(T.text)
    .setFontSize(size)
    .setBold(true)
    .setFontFamily(NV_FONT_TEXT)
    .build();
  return SpreadsheetApp.newRichTextValue()
    .setText(text)
    .setTextStyle(0, 1, mark)
    .setTextStyle(1, text.length, word)
    .build();
}

/** Adjacent columns with the same style signature are painted with one call. */
function nvRuns(cols, signature) {
  const runs = [];
  cols.forEach((c, i) => {
    const sig = signature(c);
    const last = runs[runs.length - 1];
    if (last && last.sig === sig) last.to = i;
    else runs.push({ sig: sig, from: i, to: i, col: c });
  });
  return runs;
}

/**
 * Style of the body rows from..to of a table sheet (also used for rows added later).
 * Number formats, fonts, alignment and the row line; fills come from the banding.
 */
function nvStyleBody(sheetKey, fromRow, toRow) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const T = nvThemeFor(sheetKey);
  const n = toRow - fromRow + 1;
  if (n <= 0) return;
  const first = NV_LAYOUT.firstCol;
  const all = sh.getRange(fromRow, first, n, def.cols.length);
  all
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(10)
    .setFontColor(T.text)
    .setVerticalAlignment("middle")
    .setFontWeight("normal");
  all.setWrap(false);
  nvRuns(
    def.cols,
    (c) =>
      (NV_TYPES[c.type].mono ? "m" : "t") +
      (c.fmt || NV_TYPES[c.type].fmt) +
      NV_TYPES[c.type].align +
      (NV_TYPES[c.type].wrap ? "w" : ""),
  ).forEach((run) => {
    const t = NV_TYPES[run.col.type];
    const r = sh.getRange(fromRow, first + run.from, n, run.to - run.from + 1);
    const fmt = run.col.fmt || t.fmt;
    if (fmt) r.setNumberFormat(fmt);
    r.setHorizontalAlignment(t.align);
    if (t.mono) r.setFontFamily(NV_FONT_MONO);
    if (t.wrap) r.setWrap(true);
  });
  nvRowLines(all, T.rowLine);
  sh.setRowHeights(fromRow, n, NV_LAYOUT.rowHeights.data);
}

/** Header, title, caption and totals: the colours depend on the theme. */
function nvStyleFrame(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const T = nvThemeFor(sheetKey);
  const L = NV_LAYOUT;
  const lastCol = nvLastColIndex(sheetKey);
  const maxCols = sh.getMaxColumns();
  const maxRows = sh.getMaxRows();

  // Sheet background: gutters, title block and everything right of the table.
  sh.getRange(1, 1, L.headerRow, maxCols).setBackground(T.bg);
  sh.getRange(1, 1, maxRows, 1).setBackground(T.bg);
  if (lastCol < maxCols) sh.getRange(1, lastCol + 1, maxRows, maxCols - lastCol).setBackground(T.bg);

  // Title and caption
  const title = sh.getRange(2, L.firstCol);
  title.setRichTextValue(nvTitleRich(def.title, T, 18));
  title.setVerticalAlignment("middle").setHorizontalAlignment("left").setWrap(false);
  const cap = sh.getRange(3, L.firstCol);
  cap
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(9)
    .setFontColor(T.text2)
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("left")
    .setWrap(false);

  // Header
  const head = sh.getRange(L.headerRow, L.firstCol, 1, def.cols.length);
  head.setFontFamily(NV_FONT_TEXT).setFontSize(9).setFontWeight("bold").setFontColor(T.headText).setWrap(true);
  head.setVerticalAlignment("middle").setHorizontalAlignment("left");
  const fills = [def.cols.map((c) => (c.calc || c.prot === "formula" ? T.headCalc : T.head))];
  head.setBackgrounds(fills);
  nvBorder(head, "bottom", T.headRule, "SOLID_MEDIUM");
  def.cols.forEach((c, i) => {
    const t = NV_TYPES[c.type];
    if (t.align === "right") sh.getRange(L.headerRow, L.firstCol + i).setHorizontalAlignment("right");
    if (t.align === "center") sh.getRange(L.headerRow, L.firstCol + i).setHorizontalAlignment("center");
  });

  // Totals row
  if (def.totals) {
    const tot = sh.getRange(4, L.firstCol, 1, def.cols.length);
    tot
      .setBackground(T.totalBg)
      .setFontFamily(NV_FONT_MONO)
      .setFontSize(10)
      .setFontWeight("bold")
      .setFontColor(T.text)
      .setVerticalAlignment("middle");
    nvBorder(tot, "top", T.totalRule, "SOLID_MEDIUM");
    const label = sh.getRange(4, L.firstCol);
    label.setFontFamily(NV_FONT_TEXT).setFontSize(9);
  }
}

/** Banding of the body: two quiet tones; a re-run replaces the old banding instead of stacking another. */
function nvStyleBanding(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const T = nvThemeFor(sheetKey);
  sh.getBandings().forEach((b) => {
    b.remove();
  });
  const rows = sh.getMaxRows() - NV_LAYOUT.firstRow + 1;
  const body = sh.getRange(NV_LAYOUT.firstRow, NV_LAYOUT.firstCol, rows, def.cols.length);
  const banding = body.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  banding.setFirstRowColor(T.surface).setSecondRowColor(T.band);
}

/** Widths, hidden columns, groups, freeze, gridlines, tab colour. */
function nvStyleLayout(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const L = NV_LAYOUT;
  sh.setColumnWidth(1, L.gutterWidth);
  nvRuns(def.cols, (c) => String(c.width)).forEach((run) => {
    sh.setColumnWidths(L.firstCol + run.from, run.to - run.from + 1, run.col.width);
  });
  const lastCol = nvLastColIndex(sheetKey);
  if (lastCol < sh.getMaxColumns()) sh.setColumnWidths(lastCol + 1, sh.getMaxColumns() - lastCol, L.gutterWidth);
  sh.setRowHeight(1, L.rowHeights.top);
  sh.setRowHeight(2, L.rowHeights.title);
  sh.setRowHeight(3, L.rowHeights.caption);
  sh.setRowHeight(4, def.totals ? 26 : L.rowHeights.gap);
  sh.setRowHeight(L.headerRow, L.rowHeights.header);
  sh.setFrozenRows(L.headerRow);
  sh.setFrozenColumns(def.freezeCols || 2);
  sh.setHiddenGridlines(true);
  def.cols.forEach((c, i) => {
    if (c.hidden) sh.hideColumns(L.firstCol + i);
  });
}

/** Column groups: the groups of the orders sheet are collapsed by default. */
function nvStyleGroups(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  if (!def.groups) return;
  const sh = nvSheet(sheetKey);
  Object.keys(def.groups).forEach((g) => {
    const idx = [];
    def.cols.forEach((c, i) => {
      if (c.grp === g) idx.push(NV_LAYOUT.firstCol + i);
    });
    if (!idx.length) return;
    const first = idx[0];
    const last = idx[idx.length - 1];
    // Already grouped on an earlier run: do not deepen the group again (the depth is limited to 8 columns deep).
    if (sh.getColumnGroupDepth(first) > 0) return;
    sh.getRange(1, first, 1, last - first + 1).shiftColumnGroupDepth(1);
  });
  if (typeof sh.setColumnGroupControlPosition === "function") {
    sh.setColumnGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
  }
  sh.collapseAllColumnGroups();
}

/* ---------------------------------------------------------------- conditional formatting */

/** A formula-based rule over a range. */
function nvRule(range, formula, o) {
  let b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(nvApiFormula(formula)).setRanges([range]);
  if (o.bg) b = b.setBackground(o.bg);
  if (o.color) b = b.setFontColor(o.color);
  if (o.bold !== undefined) b = b.setBold(o.bold);
  if (o.strike !== undefined) b = b.setStrikethrough(o.strike);
  return b.build();
}

/** The body range of one column. */
function nvBodyRange(sheetKey, colKey) {
  const sh = nvSheet(sheetKey);
  const c = nvColIndex(sheetKey, colKey);
  return sh.getRange(NV_LAYOUT.firstRow, c, sh.getMaxRows() - NV_LAYOUT.firstRow + 1, 1);
}

/** Reference to the first body cell of a column with the column fixed: $K6. */
function nvRef(sheetKey, colKey) {
  return "$" + nvColLetter(sheetKey, colKey) + NV_LAYOUT.firstRow;
}

function nvStatusRules(sheetKey, T) {
  const rules = [];
  const code = nvRef(sheetKey, "code");
  const range = nvBodyRange(sheetKey, "status");
  const byTone = {};
  NV_STATUSES.forEach((s) => {
    if (!byTone[s.tone]) byTone[s.tone] = [];
    byTone[s.tone].push(s.code);
  });
  // Order matters: the first matching rule wins, so the specific tones go first.
  ["s7", "s6", "s5", "s4", "s3", "s2", "s1", "cancelling", "archive", "cancelled"].forEach((tone) => {
    const style = T.status[tone];
    const f = "=OR(" + byTone[tone].map((c) => code + '="' + c + '"').join("; ") + ")";
    const o = { color: style.text, bold: !!style.bold };
    if (style.fill) o.bg = style.fill;
    if (tone === "cancelled") o.strike = false;
    rules.push(nvRule(range, f, o));
  });
  return rules;
}

/** All rules of a table sheet in the order of their priority. */
function nvConditionalRules(sheetKey, T) {
  const sh = nvSheet(sheetKey);
  const R = (k) => nvBodyRange(sheetKey, k);
  const ref = (k) => nvRef(sheetKey, k);
  const rows = sh.getMaxRows() - NV_LAYOUT.firstRow + 1;
  const full = (from, to) =>
    sh.getRange(
      NV_LAYOUT.firstRow,
      nvColIndex(sheetKey, from),
      rows,
      nvColIndex(sheetKey, to) - nvColIndex(sheetKey, from) + 1,
    );
  const solid = { bg: T.overdueFill, color: T.overdueText, bold: true };
  const warn = { bg: T.missingBg, color: T.missingText };
  const hot = { color: T.accentText, bold: true };
  const rules = [];
  const today = "TODAY()";
  switch (sheetKey) {
    case "orders": {
      const group = ref("group");
      const date = ref("nextDate");
      rules.push(
        nvRule(
          R("nextDate"),
          "=AND(" + date + '<>""; ' + date + "<" + today + "; " + group + '<>"Сдан"; ' + group + '<>"Отмена")',
          solid,
        ),
      );
      rules.push(nvRule(R("nextDate"), "=AND(" + date + '<>""; ' + date + "=" + today + ")", hot));
      rules.push(
        nvRule(
          R("num"),
          "=AND(" +
            ref("nextDate") +
            '<>""; ' +
            ref("nextDate") +
            "<" +
            today +
            "; " +
            group +
            '<>"Сдан"; ' +
            group +
            '<>"Отмена")',
          hot,
        ),
      );
      rules.push(
        nvRule(
          R("recon"),
          "=AND(" +
            ref("recon") +
            '<>"Сходится"; ' +
            ref("recon") +
            '<>"—"; ' +
            ref("recon") +
            '<>""; OR(' +
            ["settled", "assembling", "testing", "ready", "delivering", "handed_over", "closed"]
              .map((c) => ref("code") + '="' + c + '"')
              .join("; ") +
            "))",
          solid,
        ),
      );
      rules.push(
        nvRule(
          R("limitUsed"),
          "=OR(AND(ISNUMBER(" +
            ref("limitUsed") +
            "); " +
            ref("limitUsed") +
            ">1); " +
            ref("receipts") +
            ">" +
            ref("fundsGot") +
            ")",
          solid,
        ),
      );
      rules.push(nvRule(R("receipts"), "=" + ref("receipts") + ">" + ref("fundsGot"), solid));
      rules.push(
        nvRule(
          R("eligibility"),
          "=AND(" +
            ref("kind") +
            '<>"Подбор"; OR(LEFT(' +
            ref("eligibility") +
            ';6)="Только"; ISNUMBER(SEARCH("ниже минимума"; ' +
            ref("eligibility") +
            "))))",
          hot,
        ),
      );
      rules.push(
        nvRule(
          R("meetingNeeded"),
          "=AND(" + ref("meetingNeeded") + '="Да"; ' + ref("meetingDone") + "<>TRUE; " + ref("code") + '="accepted")',
          hot,
        ),
      );
      rules.push(nvRule(R("fundsOk"), "=AND(" + ref("code") + '="accepted"; ' + ref("fundsOk") + '="Нет")', hot));
      rules.push(nvRule(R("feePaid"), "=AND(" + ref("code") + '="accepted"; ' + ref("feePaid") + '="Нет")', hot));
      nvStatusRules(sheetKey, T).forEach((r) => {
        rules.push(r);
      });
      rules.push(
        nvRule(full("num", "district"), "=" + ref("code") + '="cancelled"', { color: T.muted, strike: false }),
      );
      rules.push(nvRule(full("num", "district"), "=" + ref("code") + '="closed"', { color: T.text2 }));
      break;
    }
    case "leads": {
      const st = ref("status");
      rules.push(
        nvRule(
          R("status"),
          "=AND(" +
            st +
            '="Новая"; ' +
            ref("created") +
            '<>""; NOW()-' +
            ref("created") +
            ">" +
            nvIndirectName("NV_FIRST_RESPONSE_HOURS") +
            "/24)",
          { bg: T.overdueFill, color: T.overdueText, bold: true },
        ),
      );
      rules.push(
        nvRule(R("reason"), "=AND(" + st + '="Отказ"; ' + ref("reason") + '="")', {
          bg: T.overdueFill,
          color: T.overdueText,
        }),
      );
      rules.push(
        nvRule(
          R("nextDate"),
          "=AND(" +
            ref("nextDate") +
            '<>""; ' +
            ref("nextDate") +
            "<=" +
            today +
            "; OR(" +
            st +
            '="Новая"; ' +
            st +
            '="В работе"))',
          hot,
        ),
      );
      rules.push(nvRule(full("num", "demo"), "=" + st + '="В заказе"', { color: T.muted }));
      rules.push(nvRule(full("num", "demo"), "=OR(" + st + '="Спам"; ' + st + '="Отказ")', { color: T.text2 }));
      break;
    }
    case "payments": {
      rules.push(nvRule(R("check"), "=AND(" + ref("check") + '<>"ОК"; ' + ref("check") + '<>"")', solid));
      rules.push(
        nvRule(
          R("status"),
          "=AND(" + ref("status") + '="Ожидается"; ' + ref("date") + '<>""; ' + ref("date") + "<" + today + ")",
          hot,
        ),
      );
      rules.push(
        nvRule(
          R("payerIsClient"),
          "=AND(" + ref("id") + '<>""; ' + ref("payerIsClient") + "<>TRUE; " + ref("thirdParty") + '="")',
          warn,
        ),
      );
      rules.push(nvRule(full("id", "demo"), "=" + ref("status") + '="Аннулирован"', { color: T.muted, strike: true }));
      rules.push(nvRule(full("id", "demo"), "=" + ref("status") + '="Ожидается"', { color: T.text2 }));
      break;
    }
    case "purchases": {
      rules.push(
        nvRule(R("limitCheck"), "=AND(" + ref("limitCheck") + '<>"ОК"; ' + ref("limitCheck") + '<>"")', solid),
      );
      rules.push(
        nvRule(
          R("esfDue"),
          "=AND(" +
            ref("esfDue") +
            '<>""; ' +
            ref("esfDue") +
            "<=" +
            today +
            "+2; " +
            ref("esfStatus") +
            '<>"Подписана")',
          hot,
        ),
      );
      rules.push(
        nvRule(
          R("docKind"),
          "=AND(" +
            ref("id") +
            '<>""; ' +
            ref("docKind") +
            '<>"Без чека с согласием"; ' +
            ref("receipt") +
            '=""; ' +
            ref("esf") +
            '="")',
          warn,
        ),
      );
      break;
    }
    case "warranty": {
      rules.push(nvRule(R("overdue"), "=" + ref("overdue") + '="Просрочено"', solid));
      rules.push(nvRule(R("inWarranty"), "=LEFT(" + ref("inWarranty") + ';3)="Нет"', hot));
      rules.push(nvRule(full("num", "demo"), "=" + ref("status") + '="Закрыт"', { color: T.muted }));
      break;
    }
    case "clients": {
      rules.push(
        nvRule(
          R("tg"),
          "=AND(" + ref("tg") + '<>""; COUNTIF(' + nvColRange("clients", "tg", false) + "; " + ref("tg") + ")>1)",
          warn,
        ),
      );
      rules.push(
        nvRule(
          R("phone"),
          "=AND(" +
            ref("phone") +
            '<>""; COUNTIF(' +
            nvColRange("clients", "phone", false) +
            "; " +
            ref("phone") +
            ")>1)",
          warn,
        ),
      );
      break;
    }
    case "promo": {
      rules.push(
        nvRule(
          R("clientCost"),
          "=AND(ISNUMBER(" + ref("clientCost") + "); " + ref("clientCost") + ">" + nvIndirectName("NV_CAC_LIMIT") + ")",
          hot,
        ),
      );
      break;
    }
    case "history": {
      rules.push(nvRule(R("how"), "=" + ref("how") + '="Принудительно"', hot));
      rules.push(nvRule(R("actor"), "=" + ref("actor") + '="Платформа"', { color: T.text2 }));
      break;
    }
    case "webhook": {
      rules.push(nvRule(R("result"), "=" + ref("result") + '="Отклонено"', solid));
      rules.push(nvRule(R("result"), "=" + ref("result") + '="Повтор"', { color: T.text2 }));
      rules.push(nvRule(R("result"), "=" + ref("result") + '="Устарело"', hot));
      break;
    }
    case "selfcheck": {
      rules.push(nvRule(R("result"), "=" + ref("result") + '="Ошибка"', solid));
      rules.push(nvRule(R("result"), "=" + ref("result") + '="Предупреждение"', warn));
      break;
    }
    default:
      break;
  }
  return rules;
}

function nvStyleRules(sheetKey) {
  const sh = nvSheet(sheetKey);
  sh.setConditionalFormatRules(nvConditionalRules(sheetKey, nvThemeFor(sheetKey)));
}

/** Everything that depends on the theme, for one table sheet. Safe to run again: data is not touched. */
function nvStyleTable(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  nvStyleLayout(sheetKey);
  nvStyleFrame(sheetKey);
  nvStyleBody(sheetKey, NV_LAYOUT.firstRow, sh.getMaxRows());
  nvStyleBanding(sheetKey);
  nvStyleRules(sheetKey);
  nvStyleGroups(sheetKey);
  sh.setTabColor(sheetKey === "selfcheck" || sheetKey === "history" || sheetKey === "webhook" ? "#A9A59C" : null);
  return def;
}
