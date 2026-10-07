import { calc, FormulaError, fromSerial, isDate, toSerial } from "./formula-eval.mjs";

const TZ_MS = 5 * 3600000;
const NBSP = " ";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const group3 = (n) => String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const dec = (x, digits) => x.toFixed(digits).replace(".", ",");

/** Date -> text by a pattern like dd.mm.yyyy hh:mm. */
function dateText(d, pattern) {
  const l = new Date(d.getTime() + TZ_MS);
  const p = (x, w = 2) => String(x).padStart(w, "0");
  const MONTHS = [
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
  ];
  let out = "";
  let prev = "";
  const re = /yyyy|mmmm|mm|dd|hh|ss|[^a-z]+/gi;
  let m = re.exec(pattern);
  while (m) {
    const t = m[0];
    let piece = t;
    if (t === "yyyy") piece = p(l.getUTCFullYear(), 4);
    else if (t === "mmmm") piece = MONTHS[l.getUTCMonth()];
    else if (t === "mm") piece = prev === "hh" || prev === ":" ? p(l.getUTCMinutes()) : p(l.getUTCMonth() + 1);
    else if (t === "dd") piece = p(l.getUTCDate());
    else if (t === "hh") piece = p(l.getUTCHours());
    else if (t === "ss") piece = p(l.getUTCSeconds());
    out += piece;
    prev = /^[^a-z]+$/i.test(t) ? t.trim().slice(-1) || prev : t;
    m = re.exec(pattern);
  }
  return out;
}

/** The text of a value in a number format (the formats the CRM uses). */
export function formatValue(v, nf) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  const fmt = nf || "";
  if (isDate(v)) return dateText(v, /yyyy|mmmm/.test(fmt) ? fmt : "dd.mm.yyyy");
  if (typeof v === "number") {
    if (/yyyy|mmmm/.test(fmt)) return dateText(fromSerial(v), fmt);
    if (fmt.startsWith('#,##0" сум"')) return v === 0 ? "—" : `${(v < 0 ? "-" : "") + group3(v) + NBSP}сум`;
    if (fmt === '#,##0;-#,##0;"—"') return v === 0 ? "—" : (v < 0 ? "-" : "") + group3(v);
    if (fmt === '#,##0.0,," млн"') return `${dec(v / 1e6, 1) + NBSP}млн`;
    if (fmt === "0.0%") return `${dec(v * 100, 1)}%`;
    if (fmt === "0.00%") return `${dec(v * 100, 2)}%`;
    if (fmt === "#,##0") return (v < 0 ? "-" : "") + group3(v);
    if (fmt === "0.0") return dec(v, 1);
    if (fmt === '0.0" ч"') return `${dec(v, 1) + NBSP}ч`;
    if (fmt === "0") return String(Math.round(v));
    return Number.isInteger(v) ? String(v) : dec(v, 2);
  }
  return String(v);
}

const BORDER_PX = { SOLID: 1, SOLID_MEDIUM: 2, SOLID_THICK: 3 };

function inRange(range, r, c) {
  return r >= range.row && r <= range.row + range.numRows - 1 && c >= range.col && c <= range.col + range.numCols - 1;
}

/** Effective style of a cell: explicit properties, banding, then the conditional rules (the first rule wins). */
function styleOf(sheet, r, c, evalRule) {
  const cell = sheet.cells.get(`${r},${c}`) || {};
  const st = { bg: cell.bg, fc: cell.fc, fw: cell.fw, fi: cell.fi, strike: false };
  if (!st.bg) {
    for (const b of sheet.bandings) {
      if (inRange(b.range, r, c)) {
        st.bg = (r - b.range.row) % 2 === 0 ? b.first : b.second;
        break;
      }
    }
  }
  const taken = {};
  for (const rule of sheet.cf) {
    for (const range of rule.ranges) {
      if (!inRange(range, r, c)) continue;
      if (!evalRule(rule, range, r, c)) continue;
      if (rule.background && !taken.bg) {
        st.bg = rule.background;
        taken.bg = true;
      }
      if (rule.fontColor && !taken.fc) {
        st.fc = rule.fontColor;
        taken.fc = true;
      }
      if (rule.bold !== undefined && !taken.bold) {
        st.fw = rule.bold ? "bold" : "normal";
        taken.bold = true;
      }
      if (rule.strike !== undefined && !taken.strike) {
        st.strike = rule.strike;
        taken.strike = true;
      }
    }
  }
  return st;
}

/**
 * Renders a sheet. opts: {computer, rows (last row to draw), maxWidth, charts: [svgHtml], sparkData(rangeA1) -> numbers,
 * namedValue(name) -> value}.
 */
export function renderSheet(sheet, opts) {
  const { computer } = opts;
  const lastRow = Math.min(opts.rows, sheet.maxRows);
  const cols = [];
  for (let c = 1; c <= sheet.maxCols; c++) {
    if (sheet.hiddenCols.has(c) || sheet.collapsedCols.has(c)) continue;
    cols.push(c);
  }
  const widthOf = (c) => sheet.colW.get(c) ?? 100;
  const heightOf = (r) => sheet.rowH.get(r) ?? 21;
  const rows = [];
  for (let r = 1; r <= lastRow; r++) if (!sheet.hiddenRows.has(r)) rows.push(r);
  const colLeft = new Map();
  let x = 0;
  cols.forEach((c) => {
    colLeft.set(c, x);
    x += widthOf(c);
  });
  const totalW = x;
  const rowTop = new Map();
  let y = 0;
  rows.forEach((r) => {
    rowTop.set(r, y);
    y += heightOf(r);
  });
  const totalH = y;
  const ruleCache = new Map();
  const evalRule = (rule, range, r, c) => {
    const f = rule.formula;
    try {
      const ctx = {
        sheetName: sheet.name,
        getCell: (s, rr, cc) => computer.cellValue(s, rr, cc),
        maxRows: (s) => computer.maxRowsOf(s),
        named: (n) => computer.named(n),
        now: opts.now,
        rowRef: () => null,
        offset: { dr: r - range.row, dc: c - range.col },
      };
      const v = calc(f, ctx);
      return v === true;
    } catch (e) {
      if (e instanceof FormulaError) return false;
      throw e;
    }
  };
  void ruleCache;
  // Merges: the covered cells are skipped
  const mergeAt = new Map();
  const covered = new Set();
  sheet.merges.forEach((m) => {
    mergeAt.set(`${m.row},${m.col}`, m);
    for (let r = m.row; r < m.row + m.numRows; r++)
      for (let c = m.col; c < m.col + m.numCols; c++) if (r !== m.row || c !== m.col) covered.add(`${r},${c}`);
  });
  const colIndex = new Map(cols.map((c, i) => [c, i]));
  const html = [];
  html.push(
    `<table class="sheet" style="width:${totalW}px;height:${totalH}px"><colgroup>${cols.map((c) => `<col style="width:${widthOf(c)}px">`).join("")}</colgroup>`,
  );
  const cellText = (r, c) => {
    const cell = sheet.cells.get(`${r},${c}`);
    if (!cell) return { text: "", raw: null, cell: null };
    let raw = cell.f ? computer.cellValue(sheet.name, r, c) : cell.v;
    if (cell.f?.startsWith("=SPARKLINE(")) raw = "";
    return { text: formatValue(raw, cell.nf), raw, cell };
  };
  rows.forEach((r) => {
    html.push(`<tr style="height:${heightOf(r)}px">`);
    let ci = 0;
    while (ci < cols.length) {
      const c = cols[ci];
      const key = `${r},${c}`;
      if (covered.has(key)) {
        ci++;
        continue;
      }
      const cell = sheet.cells.get(key) || {};
      const merge = mergeAt.get(key);
      let colspan = 1;
      let rowspan = 1;
      if (merge) {
        colspan = cols.filter((cc) => cc >= merge.col && cc < merge.col + merge.numCols).length || 1;
        rowspan = rows.filter((rr) => rr >= merge.row && rr < merge.row + merge.numRows).length || 1;
      }
      const st = styleOf(sheet, r, c, evalRule);
      const { text, raw } = cellText(r, c);
      const isCheckbox = cell.dv && cell.dv.type === "checkbox";
      const align = cell.ha || (typeof raw === "number" ? "right" : "left");
      // Text that overflows into empty neighbours (as in a sheet) takes their place.
      const wraps = cell.wrap === true;
      if (!merge && text && !wraps && align !== "right" && align !== "center" && !isCheckbox) {
        let k = ci + 1;
        while (k < cols.length) {
          const kk = `${r},${cols[k]}`;
          const nb = sheet.cells.get(kk);
          if (covered.has(kk) || mergeAt.has(kk)) break;
          if (nb && ((nb.v !== undefined && nb.v !== "") || nb.f)) break;
          // The neighbour must look the same (fill and borders), otherwise the text would hide its look
          if (
            (nb ? nb.bg : undefined) !== cell.bg ||
            JSON.stringify(nb ? nb.borders || null : null) !== JSON.stringify(cell.borders || null)
          )
            break;
          if (styleOf(sheet, r, cols[k], evalRule).bg !== st.bg) break;
          if (nb?.dv && nb.dv.type === "checkbox" && nb.v === true) break;
          k++;
        }
        colspan = k - ci;
      }
      const style = [];
      if (st.bg) style.push(`background:${st.bg}`);
      if (st.fc) style.push(`color:${st.fc}`);
      if (cell.ff) style.push(`font-family:'${cell.ff}',sans-serif`);
      if (cell.fs) style.push(`font-size:${cell.fs}px`);
      if (st.fw === "bold") style.push("font-weight:700");
      if (st.strike) style.push("text-decoration:line-through");
      style.push(`text-align:${align}`);
      style.push(`vertical-align:${cell.va === "bottom" ? "bottom" : cell.va === "top" ? "top" : "middle"}`);
      if (wraps) style.push("white-space:normal;line-height:1.15");
      if (cell.borders) {
        for (const side of ["top", "right", "bottom", "left"]) {
          const b = cell.borders[side];
          if (b) style.push(`border-${side}:${BORDER_PX[b.style] || 1}px solid ${b.color}`);
        }
      }
      let inner;
      if (cell.f?.startsWith("=SPARKLINE(")) {
        inner = opts.sparkline(cell.f, widthOf(c) * colspan - 12, heightOf(r) - 6);
      } else if (cell.rich) {
        inner = cell.rich.runs.length
          ? (() => {
              const t = cell.rich.getText();
              let out = "";
              let pos = 0;
              cell.rich.runs.forEach((run) => {
                if (run.start > pos) out += esc(t.slice(pos, run.start));
                const s = run.style;
                out += `<span style="color:${s.color};font-size:${s.size}px;font-weight:${s.bold ? 700 : 400};font-family:'${s.family}'">${esc(t.slice(run.start, run.end))}</span>`;
                pos = run.end;
              });
              if (pos < t.length) out += esc(t.slice(pos));
              return out;
            })()
          : esc(text);
      } else if (isCheckbox) {
        inner = `<span class="cb${raw === true ? " on" : ""}"></span>`;
      } else {
        inner = esc(text);
      }
      html.push(
        `<td${colspan > 1 ? ` colspan="${colspan}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""} class="${opts.styles.classOf(style.join(";"))}">${inner}</td>`,
      );
      ci += colspan;
      void colIndex;
    }
    html.push("</tr>");
  });
  html.push("</table>");
  // Over the grid: the logo and the charts
  const over = [];
  sheet.images.forEach((img) => {
    const left = (colLeft.get(img.col) ?? 0) + img.offX;
    const top = (rowTop.get(img.row) ?? 0) + img.offY;
    const bytes = Buffer.from((img.blob.data || []).map((b) => b & 255));
    over.push(
      `<img alt="Nivel" src="data:image/png;base64,${bytes.toString("base64")}" style="position:absolute;left:${left}px;top:${top}px;width:${img.width || 67}px;height:${img.height || 40}px">`,
    );
  });
  (opts.charts || []).forEach((ch, i) => {
    const anchor = sheet.charts[i]?.spec.position;
    if (!anchor) return;
    const left = (colLeft.get(anchor.col) ?? 0) + (anchor.offX || 0);
    const top = (rowTop.get(anchor.row) ?? 0) + (anchor.offY || 0);
    over.push(`<div class="chart" style="position:absolute;left:${left}px;top:${top}px">${ch}</div>`);
  });
  return {
    html: `<div class="frame" style="width:${totalW}px;height:${totalH}px;background:${opts.pageBg}">${html.join("")}${over.join("")}</div>`,
    width: totalW,
    height: totalH,
  };
}

export { fromSerial, toSerial };
