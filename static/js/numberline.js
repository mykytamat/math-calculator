// Solution sets of one-variable inequalities on a number line.
//
// Intervals are thick bars; a filled dot is an included endpoint, a hollow dot
// an excluded one; arrows mark rays to ±∞. Periodic sets (sin x > 1/2) are
// repeated across the visible range; the copy at k = 0 carries exact labels
// such as π/6, the others decimals.

import { t } from './i18n.js';

const COLOR = '#2f5bea';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function shifts(spec, x0, x1) {
  if (!spec.period) return [0];
  const P = spec.period;
  const k0 = Math.floor(x0 / P) - 1, k1 = Math.ceil(x1 / P) + 1;
  if (k1 - k0 > 200) return [0];
  const out = [];
  for (let k = k0; k <= k1; k++) out.push(k);
  return out;
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
}

export class NumberLineView {
  constructor(container, spec) {
    this.container = container;
    this.spec = spec;
    this.range = [...spec.x_range];
  }

  figure() {
    const [x0, x1] = this.range;
    const w = x1 - x0;
    const bg = cssVar('--panel', '#ffffff');
    const text = cssVar('--text', '#1d2330');
    const muted = cssVar('--border', '#dde1e8');
    const data = [{
      type: 'scatter', mode: 'lines', x: [x0 - w, x1 + w], y: [0, 0], hoverinfo: 'skip',
      line: { color: muted, width: 2 }, showlegend: false,
    }];
    const closed = { x: [], y: [], t: [] };
    const open = { x: [], y: [], t: [] };
    const arrows = { left: [], right: [] };
    const annotations = [];
    const P = this.spec.period ?? 0;
    for (const k of shifts(this.spec, x0, x1)) {
      const d = k * P;
      const label = (exact, v) => (k === 0 ? exact : fmt(v));
      for (const iv of this.spec.intervals) {
        const lo = iv.lo === null ? x0 - w : iv.lo + d;
        const hi = iv.hi === null ? x1 + w : iv.hi + d;
        if (hi < x0 - w || lo > x1 + w) continue;
        data.push({
          type: 'scatter', mode: 'lines', x: [lo, hi], y: [0, 0], hoverinfo: 'skip', showlegend: false,
          line: { color: COLOR, width: 7 },
        });
        if (iv.lo === null) arrows.left.push(x0 + w * 0.01);
        else {
          (iv.lo_closed ? closed : open).x.push(lo);
          (iv.lo_closed ? closed : open).t.push(label(iv.lo_label, lo));
          annotations.push({ x: lo, y: 0.55, text: label(iv.lo_label, lo), showarrow: false, font: { color: text, size: 12 } });
        }
        if (iv.hi === null) arrows.right.push(x1 - w * 0.01);
        else {
          (iv.hi_closed ? closed : open).x.push(hi);
          (iv.hi_closed ? closed : open).t.push(label(iv.hi_label, hi));
          annotations.push({ x: hi, y: 0.55, text: label(iv.hi_label, hi), showarrow: false, font: { color: text, size: 12 } });
        }
      }
      for (const p of this.spec.points ?? []) {
        const x = p.x + d;
        closed.x.push(x);
        closed.t.push(label(p.label, x));
        annotations.push({ x, y: 0.55, text: label(p.label, x), showarrow: false, font: { color: text, size: 12 } });
      }
    }
    for (const [pts, fill, what] of [[closed, COLOR, t('included')], [open, bg, t('not included')]]) {
      if (!pts.x.length) continue;
      data.push({
        type: 'scatter', mode: 'markers', x: pts.x, y: pts.x.map(() => 0), text: pts.t, showlegend: false,
        marker: { color: fill, size: 13, line: { color: COLOR, width: 2.5 } },
        hovertemplate: `%{text} (${what})<extra></extra>`,
      });
    }
    for (const [xs, symbol] of [[arrows.left, 'triangle-left'], [arrows.right, 'triangle-right']]) {
      if (!xs.length) continue;
      data.push({
        type: 'scatter', mode: 'markers', x: xs, y: xs.map(() => 0), hoverinfo: 'skip', showlegend: false,
        marker: { color: COLOR, size: 14, symbol },
      });
    }
    const layout = {
      height: 120, margin: { l: 16, r: 16, t: 8, b: 30 }, dragmode: 'pan', showlegend: false,
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: text },
      xaxis: { range: this.range, zeroline: false, showgrid: false, color: text, title: { text: this.spec.var, standoff: 2 } },
      yaxis: { range: [-1, 1], visible: false, fixedrange: true },
      annotations: annotations.filter((a) => a.x >= x0 - w * 0.02 && a.x <= x1 + w * 0.02).slice(0, 60),
      hovermode: 'closest',
    };
    return { data, layout };
  }

  async render() {
    const Plotly = window.Plotly;
    if (!Plotly) return;
    const { data, layout } = this.figure();
    await Plotly.newPlot(this.container, data, layout, {
      responsive: true, scrollZoom: true, displaylogo: false, displayModeBar: false,
    });
    this.container.on('plotly_relayout', (ev) => {
      let r = null;
      if (ev['xaxis.range[0]'] !== undefined) r = [ev['xaxis.range[0]'], ev['xaxis.range[1]']];
      else if (Array.isArray(ev['xaxis.range'])) r = ev['xaxis.range'];
      else if (ev['xaxis.autorange']) r = [...this.spec.x_range];
      if (!r || !(r[1] > r[0])) return;
      this.range = r.map(Number);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const f = this.figure();
        window.Plotly.react(this.container, f.data, f.layout);
      }, 60);
    });
  }
}

const views = new Set();

export function renderNumberLine(container, spec) {
  const view = new NumberLineView(container, spec);
  view.render();
  views.add(view);
  return view;
}

// After a theme change: redraw the number lines still on the page.
export function redrawAllNumberLines() {
  for (const v of [...views]) {
    if (!v.container.isConnected) { views.delete(v); continue; }
    if (!v.container.data) continue;
    const f = v.figure();
    window.Plotly.react(v.container, f.data, f.layout);
  }
}
