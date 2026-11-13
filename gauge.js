/** Mostradores circulares em SVG (270°). Apenas apresentação. */

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) if (k) el.append(k);
  return el;
};

const START = 135; // graus (inferior esquerdo)
const SWEEP = 270;
const polar = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const arcPath = (cx, cy, r, from, to) => {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

let uidN = 0;

/**
 * @param {{label:string, unit:string, min?:number, max:number, major?:number, labelEvery?:number, redFrom?:number|null, decimals?:number, format?:(v:number)=>string}} o
 */
export function createGauge({ label, unit, min = 0, max, major = 20, labelEvery = 2, redFrom = null, decimals = 0, format = null }) {
  const id = `g${++uidN}`;
  const root = document.createElement('div');
  root.className = 'gauge';
  const svg = s('svg', { viewBox: '0 0 200 200', class: 'gauge-svg', 'aria-hidden': 'true' });
  const defs = s('defs', {}, s('linearGradient', { id: `${id}-grad`, x1: '0', y1: '1', x2: '1', y2: '0' }, s('stop', { offset: '0', 'stop-color': 'var(--accent)' }), s('stop', { offset: '1', 'stop-color': 'var(--accent-2)' })));
  const cx = 100;
  const cy = 100;
  const r = 82;
  const track = s('path', { d: arcPath(cx, cy, r, START, START + SWEEP), class: 'g-track', pathLength: 100 });
  const value = s('path', { d: arcPath(cx, cy, r, START, START + SWEEP), class: 'g-value', pathLength: 100, stroke: `url(#${id}-grad)` });
  value.style.strokeDasharray = '0 100';
  svg.append(defs, track);
  if (redFrom != null && redFrom < max) {
    const a = START + SWEEP * ((redFrom - min) / (max - min));
    svg.append(s('path', { d: arcPath(cx, cy, r, a, START + SWEEP), class: 'g-red' }));
  }
  svg.append(value);
  const ticks = s('g', { class: 'g-ticks' });
  const n = Math.round((max - min) / major);
  for (let i = 0; i <= n; i++) {
    const v = min + i * major;
    const a = START + SWEEP * ((v - min) / (max - min));
    const isRed = redFrom != null && v >= redFrom;
    const [x1, y1] = polar(cx, cy, 91, a);
    const [x2, y2] = polar(cx, cy, 97, a);
    ticks.append(s('line', { x1, y1, x2, y2, class: isRed ? 'g-tick red' : 'g-tick' }));
    if (i % labelEvery === 0) {
      const [tx, ty] = polar(cx, cy, 71, a);
      const t = s('text', { x: tx, y: ty, class: 'g-tick-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = String(Math.round(v / (max > 1000 ? 1000 : 1)));
      ticks.append(t);
    }
  }
  svg.append(ticks);
  const num = s('text', { x: 100, y: 104, class: 'g-num', 'text-anchor': 'middle' });
  num.textContent = '—';
  const lab = s('text', { x: 100, y: 128, class: 'g-label', 'text-anchor': 'middle' });
  lab.textContent = label;
  const un = s('text', { x: 100, y: 146, class: 'g-unit', 'text-anchor': 'middle' });
  un.textContent = unit;
  svg.append(num, lab, un);
  const note = document.createElement('div');
  note.className = 'gauge-note';
  root.append(svg, note);

  return {
    el: root,
    /** @param {number|null} v @param {{validity?:string, note?:string}} meta */
    update(v, { validity = 'valid', note: message = '' } = {}) {
      const ok = v != null && Number.isFinite(v);
      const pct = ok ? Math.max(0, Math.min(1, (v - min) / (max - min))) * 100 : 0;
      value.style.strokeDasharray = `${pct} 100`;
      num.textContent = ok ? (format ? format(v) : v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })) : '—';
      root.dataset.validity = validity;
      root.classList.toggle('in-red', ok && redFrom != null && v >= redFrom);
      note.textContent = message;
    },
  };
}
