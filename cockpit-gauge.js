/**
 * BOLT PERFORMANCE — mostradores esportivos (SVG + animação por requestAnimationFrame).
 * Apenas apresentação: recebe o valor já validado pelo painel; nunca inventa dados.
 * O laço de animação só roda enquanto o valor exibido ainda está convergindo para o alvo.
 */
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) if (k) el.append(k);
  return el;
};

const CX = 150;
const CY = 150;
const START = 135; // graus (inferior esquerdo)
const SWEEP = 270;
const R_ARC = 118;
const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};
const arcPath = (r, from, to) => {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let uidN = 0;

/**
 * @param {{label:string, unit:string, min?:number, max:number, major:number, minorPerMajor?:number,
 *   labelEvery?:number, labelDiv?:number, redFrom?:number|null, warnFrom?:number|null,
 *   format?:(v:number)=>string, footnote?:string, numClass?:string}} o
 */
export function createSportGauge({ label, unit, min = 0, max, major, minorPerMajor = 2, labelEvery = 1, labelDiv = 1, redFrom = null, warnFrom = null, format = null, footnote = '', numClass = '' }) {
  const id = `cg${++uidN}`;
  const fmt = format || ((v) => Math.round(v).toLocaleString('pt-BR'));
  const root = document.createElement('div');
  root.className = `cg ${numClass}`.trim();
  root.dataset.validity = 'unavailable';

  const svg = s('svg', { viewBox: '0 0 300 300', class: 'cg-svg', role: 'img', 'aria-label': `${label}: indisponível` });
  const defs = s('defs', {},
    s('radialGradient', { id: `${id}-face`, cx: '50%', cy: '42%', r: '65%' }, s('stop', { offset: '0', 'stop-color': '#16212d' }), s('stop', { offset: '.7', 'stop-color': '#0a1017' }), s('stop', { offset: '1', 'stop-color': '#05080c' })),
    s('linearGradient', { id: `${id}-bezel`, x1: '0', y1: '0', x2: '1', y2: '1' }, s('stop', { offset: '0', 'stop-color': '#3b4c60' }), s('stop', { offset: '.35', 'stop-color': '#0d1520' }), s('stop', { offset: '.7', 'stop-color': '#1a2735' }), s('stop', { offset: '1', 'stop-color': '#4b6a8a' })),
    s('linearGradient', { id: `${id}-blue`, gradientUnits: 'userSpaceOnUse', x1: '40', y1: '260', x2: '260', y2: '40' }, s('stop', { offset: '0', 'stop-color': '#168BFF' }), s('stop', { offset: '1', 'stop-color': '#22D7F2' })),
    s('linearGradient', { id: `${id}-red`, gradientUnits: 'userSpaceOnUse', x1: '40', y1: '260', x2: '260', y2: '40' }, s('stop', { offset: '0', 'stop-color': '#F04452' }), s('stop', { offset: '1', 'stop-color': '#FF7A5C' })),
  );
  svg.append(defs);
  svg.append(
    s('circle', { cx: CX, cy: CY, r: 147, fill: `url(#${id}-bezel)`, class: 'cg-bezel' }),
    s('circle', { cx: CX, cy: CY, r: 141, fill: `url(#${id}-face)`, class: 'cg-face' }),
    s('circle', { cx: CX, cy: CY, r: 141, fill: 'none', class: 'cg-rim' }),
  );

  const full = arcPath(R_ARC, START, START + SWEEP);
  svg.append(s('path', { d: full, class: 'cg-track', pathLength: 100 }));

  const angleOf = (v) => START + SWEEP * ((v - min) / (max - min));
  if (warnFrom != null && warnFrom < max && (redFrom == null || warnFrom < redFrom)) {
    svg.append(s('path', { d: arcPath(R_ARC, angleOf(warnFrom), angleOf(redFrom ?? max)), class: 'cg-zone cg-zone-warn' }));
  }
  if (redFrom != null && redFrom < max) {
    svg.append(s('path', { d: arcPath(R_ARC, angleOf(redFrom), START + SWEEP), class: 'cg-zone cg-zone-red' }));
  }

  const glow = s('path', { d: full, class: 'cg-glow', pathLength: 100, stroke: `url(#${id}-blue)` });
  const val = s('path', { d: full, class: 'cg-val', pathLength: 100, stroke: `url(#${id}-blue)` });
  const core = s('path', { d: full, class: 'cg-core', pathLength: 100 });
  for (const p of [glow, val, core]) p.style.strokeDasharray = '0 100';
  const tip = s('g', { class: 'cg-tip' }, s('circle', { cx: CX + R_ARC, cy: CY, r: 9, class: 'cg-tip-halo' }), s('circle', { cx: CX + R_ARC, cy: CY, r: 3.6, class: 'cg-tip-dot' }));
  svg.append(glow, val, core, tip);

  const ticks = s('g', { class: 'cg-ticks' });
  const n = Math.round((max - min) / major);
  for (let i = 0; i <= n; i++) {
    const v = min + i * major;
    const red = redFrom != null && v >= redFrom;
    const [x1, y1] = polar(125, angleOf(v));
    const [x2, y2] = polar(136, angleOf(v));
    ticks.append(s('line', { x1, y1, x2, y2, class: `cg-tick major${red ? ' red' : ''}` }));
    if (i % labelEvery === 0) {
      const [tx, ty] = polar(98, angleOf(v));
      const t = s('text', { x: tx.toFixed(2), y: ty.toFixed(2), class: `cg-tl${red ? ' red' : ''}`, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = String(Math.round(v / labelDiv));
      ticks.append(t);
    }
    if (i < n) {
      for (let k = 1; k < minorPerMajor; k++) {
        const mv = v + (k * major) / minorPerMajor;
        const mred = redFrom != null && mv >= redFrom;
        const [a1, b1] = polar(129, angleOf(mv));
        const [a2, b2] = polar(135, angleOf(mv));
        ticks.append(s('line', { x1: a1, y1: b1, x2: a2, y2: b2, class: `cg-tick minor${mred ? ' red' : ''}` }));
      }
    }
  }
  svg.append(ticks);

  const num = s('text', { x: CX, y: 166, class: 'cg-num', 'text-anchor': 'middle' });
  num.textContent = '—';
  const lab = s('text', { x: CX, y: 194, class: 'cg-unit', 'text-anchor': 'middle' });
  lab.textContent = unit;
  svg.append(num, lab);
  if (footnote) {
    const fn = s('text', { x: CX, y: 262, class: 'cg-foot', 'text-anchor': 'middle' });
    fn.textContent = footnote;
    svg.append(fn);
  }
  const note = document.createElement('div');
  note.className = 'cg-note';
  root.append(svg, note);

  /* ---------- animação ---------- */
  let target = 0;
  let shown = 0;
  let valid = false;
  let raf = 0;
  let last = 0;
  let lastText = '';
  let mode = 'blue';

  const paint = () => {
    const pct = Math.max(0, Math.min(1, (shown - min) / (max - min))) * 100;
    const dash = `${pct.toFixed(2)} 100`;
    glow.style.strokeDasharray = dash;
    val.style.strokeDasharray = dash;
    core.style.strokeDasharray = dash;
    tip.setAttribute('transform', `rotate(${(START + (SWEEP * pct) / 100).toFixed(2)} ${CX} ${CY})`);
    const vis = pct > 0.3 ? '1' : '0';
    tip.style.opacity = vis;
    glow.style.opacity = vis === '1' ? '' : '0';
    val.style.opacity = vis;
    core.style.opacity = vis;
    const text = valid ? fmt(shown) : '—';
    if (text !== lastText) {
      lastText = text;
      num.textContent = text;
    }
    const red = valid && redFrom != null && shown >= redFrom;
    const next = red ? 'red' : 'blue';
    if (next !== mode) {
      mode = next;
      for (const p of [glow, val]) p.setAttribute('stroke', `url(#${id}-${mode})`);
      root.classList.toggle('in-red', red);
    }
  };

  const step = (ts) => {
    raf = 0;
    const dt = Math.min(80, ts - (last || ts - 16));
    last = ts;
    const diff = target - shown;
    const eps = (max - min) / 4000;
    if (Math.abs(diff) <= eps) shown = target;
    else shown += diff * (1 - Math.exp(-dt / 140));
    paint();
    if (shown !== target) raf = requestAnimationFrame(step);
    else last = 0;
  };

  return {
    el: root,
    /** @param {number|null} v @param {{validity?:string, note?:string}} meta */
    update(v, { validity = 'valid', note: message = '' } = {}) {
      const ok = v != null && Number.isFinite(v);
      valid = ok;
      target = ok ? Math.max(min, Math.min(max, v)) : min;
      root.dataset.validity = validity;
      if (note.textContent !== message) note.textContent = message;
      const lbl = ok ? `${label}: ${fmt(v)} ${unit}` : `${label}: indisponível`;
      if (svg.getAttribute('aria-label') !== lbl) svg.setAttribute('aria-label', lbl);
      if (reduced()) {
        shown = target;
        paint();
        return;
      }
      if (shown !== target && !raf) raf = requestAnimationFrame(step);
      else if (!ok && shown === target) paint();
    },
    /** Primeira pintura (sem animação) com o estado vazio. */
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
