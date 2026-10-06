// Draws the charts of the panel as SVG from the chart specification (colours, titles, legend) and the data series.
// One orange series, comparisons in warm graphite, a horizontal grid only, no second axis: as the visual system asks.

const W = 576;
const H = 300;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Nice axis: returns {max, step, ticks}. */
function niceScale(maxValue, wantTicks = 4, integer = false) {
  const max = maxValue <= 0 ? 1 : maxValue;
  const raw = max / wantTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  if (integer && step < 1) step = 1;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, step, ticks };
}

const fmtTick = (v) => (Number.isInteger(v) ? String(v) : String(v).replace(".", ","));

/**
 * chart: {title, kind: "column"|"bar"|"line"|"combo"|"percentbar", categories, series: [{name, color, values, type, dash, width}],
 * stacked, legend}, T: theme.
 */
export function drawChart(chart, T) {
  const parts = [];
  const font = "'Fira Sans', Arial, sans-serif";
  parts.push(`<rect width="${W}" height="${H}" fill="${T.surface}"/>`);
  parts.push(
    `<text x="16" y="24" font-family="${font}" font-size="11" font-weight="700" fill="${T.text}">${esc(chart.title)}</text>`,
  );
  let top = 40;
  if (chart.legend) {
    let x = 16;
    chart.series.forEach((s) => {
      const isLine = s.type === "line";
      if (isLine)
        parts.push(
          `<line x1="${x}" y1="${top + 4}" x2="${x + 14}" y2="${top + 4}" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="4 3"' : ""}/>`,
        );
      else parts.push(`<rect x="${x}" y="${top - 1}" width="9" height="9" fill="${s.color}"/>`);
      const label = esc(s.name);
      parts.push(
        `<text x="${x + (isLine ? 19 : 14)}" y="${top + 8}" font-family="${font}" font-size="9" fill="${T.text2}">${label}</text>`,
      );
      x += 24 + s.name.length * 5.2;
    });
    top += 22;
  }
  const horizontal = chart.kind === "bar" || chart.kind === "percentbar";
  const left = horizontal ? 150 : 38;
  const right = horizontal ? 36 : 16;
  const bottom = 26;
  const plot = { x: left, y: top + 6, w: W - left - right, h: H - top - 6 - bottom };
  const n = chart.categories.length;
  const grid = T.grid;
  const clip = (s, len) => (s.length > len ? `${s.slice(0, len - 1)}…` : s);

  if (chart.kind === "percentbar") {
    // One category, the series are the parts of a hundred per cent
    const total = chart.series.reduce((a, s) => a + (s.values[0] || 0), 0) || 1;
    let x = plot.x;
    const y = plot.y + plot.h / 2 - 24;
    chart.series.forEach((s) => {
      const w = ((s.values[0] || 0) / total) * plot.w;
      parts.push(`<rect x="${x}" y="${y}" width="${Math.max(w, 0)}" height="48" fill="${s.color}"/>`);
      if (w > 34)
        parts.push(
          `<text x="${x + w / 2}" y="${y + 29}" text-anchor="middle" font-family="${font}" font-size="11" font-weight="700" fill="${s.label || T.surface}">${Math.round(((s.values[0] || 0) / total) * 100)}%</text>`,
        );
      x += w;
    });
    parts.push(`<text x="16" y="${y + 29}" font-family="${font}" font-size="9" fill="${T.text}">Заказы</text>`);
    return svg(parts);
  }

  // Value scale
  const stackedTotals = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    chart.series.forEach((ser) => {
      const v = ser.values[i];
      if (v !== null && v !== undefined && Number.isFinite(v)) s += chart.stacked ? v : Math.max(v, 0);
    });
    stackedTotals.push(s);
  }
  const maxVal = chart.stacked
    ? Math.max(...stackedTotals, 0)
    : Math.max(
        ...chart.series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined && Number.isFinite(v))),
        0,
      );
  const scale = niceScale(maxVal, 4, chart.integer === true);
  const vx = (v) => (horizontal ? plot.x + (v / scale.max) * plot.w : plot.y + plot.h - (v / scale.max) * plot.h);

  // Grid and the value axis labels
  scale.ticks.forEach((t) => {
    if (horizontal) {
      const x = vx(t);
      parts.push(
        `<line x1="${x}" y1="${plot.y}" x2="${x}" y2="${plot.y + plot.h}" stroke="${t === 0 ? T.text2 : grid}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${x}" y="${plot.y + plot.h + 14}" text-anchor="middle" font-family="${font}" font-size="8" fill="${T.text2}">${fmtTick(t)}</text>`,
      );
    } else {
      const y = vx(t);
      parts.push(
        `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.w}" y2="${y}" stroke="${t === 0 ? T.text2 : grid}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${plot.x - 6}" y="${y + 3}" text-anchor="end" font-family="${font}" font-size="8" fill="${T.text2}">${fmtTick(t)}</text>`,
      );
    }
  });

  const band = (horizontal ? plot.h : plot.w) / Math.max(n, 1);
  const barSeries = chart.series.filter((s) => s.type !== "line");
  const groupW = band * 0.56;
  chart.categories.forEach((cat, i) => {
    const center = (horizontal ? plot.y : plot.x) + band * (i + 0.5);
    // Category labels
    if (horizontal)
      parts.push(
        `<text x="${plot.x - 8}" y="${center + 3}" text-anchor="end" font-family="${font}" font-size="9" fill="${T.text}">${esc(clip(cat, 26))}</text>`,
      );
    else if (n <= 12 || i % 2 === 0)
      parts.push(
        `<text x="${center}" y="${plot.y + plot.h + 14}" text-anchor="middle" font-family="${font}" font-size="8" fill="${T.text2}">${esc(clip(cat, 9))}</text>`,
      );
    // Bars
    if (chart.stacked) {
      let acc = 0;
      chart.series.forEach((s) => {
        if (s.type === "line") return;
        const v = s.values[i];
        if (!(v > 0)) return;
        const a = vx(acc);
        const b = vx(acc + v);
        if (horizontal)
          parts.push(
            `<rect x="${a}" y="${center - groupW / 2}" width="${b - a}" height="${groupW}" fill="${s.color}"/>`,
          );
        else
          parts.push(
            `<rect x="${center - groupW / 2}" y="${b}" width="${groupW}" height="${a - b}" fill="${s.color}"/>`,
          );
        acc += v;
      });
      if (acc > 0) {
        const end = vx(acc);
        if (horizontal)
          parts.push(
            `<text x="${end + 5}" y="${center + 3}" font-family="'IBM Plex Mono', monospace" font-size="9" fill="${T.text}">${fmtTick(Math.round(acc * 10) / 10)}</text>`,
          );
        else
          parts.push(
            `<text x="${center}" y="${end - 4}" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="8" fill="${T.text2}">${fmtTick(Math.round(acc * 10) / 10)}</text>`,
          );
      }
    } else {
      const k = Math.max(barSeries.length, 1);
      barSeries.forEach((s, j) => {
        const v = s.values[i];
        if (!(v > 0)) return;
        const w = groupW / k;
        const off = -groupW / 2 + j * w;
        const a = vx(0);
        const b = vx(v);
        if (horizontal)
          parts.push(`<rect x="${a}" y="${center + off}" width="${b - a}" height="${w - 1}" fill="${s.color}"/>`);
        else parts.push(`<rect x="${center + off}" y="${b}" width="${w - 1}" height="${a - b}" fill="${s.color}"/>`);
        if (horizontal)
          parts.push(
            `<text x="${b + 5}" y="${center + off + w / 2 + 2}" font-family="'IBM Plex Mono', monospace" font-size="8" fill="${T.text2}">${fmtTick(Math.round(v * 10) / 10)}</text>`,
          );
      });
    }
  });

  // Lines
  chart.series.forEach((s) => {
    if (s.type !== "line") return;
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      const x = plot.x + band * (i + 0.5);
      const y = vx(v);
      d += `${(pen ? " L" : " M") + x.toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    });
    if (d)
      parts.push(
        `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round"/>`,
      );
    if (chart.areaOf && chart.areaOf === s.name && d) {
      const pts = s.values
        .map((v, i) =>
          v === null || v === undefined || !Number.isFinite(v) ? null : [plot.x + band * (i + 0.5), vx(v)],
        )
        .filter(Boolean);
      if (pts.length > 1)
        parts.push(
          `<path d="M${pts[0][0]} ${vx(0)} ${pts.map((p) => `L${p[0]} ${p[1]}`).join(" ")} L${pts[pts.length - 1][0]} ${vx(0)} Z" fill="${s.color}" fill-opacity="0.12"/>`,
        );
    }
  });
  return svg(parts);
}

function svg(parts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

/** A sparkline inside a cell: kind column | line | bar. values: numbers; width and height in px. */
export function drawSparkline(kind, values, opts) {
  const { w, h, color, highColor, color2, max } = opts;
  const parts = [];
  if (kind === "bar") {
    const total = max || 1;
    const a = Math.min(1, (values[0] || 0) / total) * w;
    const b = Math.min(1 - a / w, (values[1] || 0) / total) * w;
    parts.push(`<rect x="0" y="${h / 2 - 3}" width="${w}" height="6" fill="${opts.track || "transparent"}"/>`);
    parts.push(`<rect x="0" y="${h / 2 - 3}" width="${a}" height="6" fill="${color}"/>`);
    parts.push(`<rect x="${a}" y="${h / 2 - 3}" width="${b}" height="6" fill="${color2}"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join("")}</svg>`;
  }
  const mx = Math.max(...values, 0) || 1;
  if (kind === "line") {
    const pts = values.map(
      (v, i) => `${(i / Math.max(values.length - 1, 1)) * (w - 2) + 1},${h - 3 - (v / mx) * (h - 6)}`,
    );
    parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join("")}</svg>`;
  }
  const bw = w / values.length;
  const hi = Math.max(...values);
  values.forEach((v, i) => {
    const bh = Math.max((v / mx) * (h - 4), v > 0 ? 1.5 : 0);
    parts.push(
      `<rect x="${i * bw + 1}" y="${h - 2 - bh}" width="${Math.max(bw - 2, 1)}" height="${bh}" fill="${v === hi && v > 0 ? highColor : color}"/>`,
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join("")}</svg>`;
}
