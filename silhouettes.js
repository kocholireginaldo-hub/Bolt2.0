/**
 * Silhuetas de veículos (aparência visual — independente da identificação técnica).
 * viewBox 0 0 200 90. A carroceria usa a cor escolhida pelo usuário.
 */

export const SILHOUETTES = {
  hatch: {
    label: 'Hatch',
    body: 'M14 66V52q0-5 5-7l30-8 28-15q3-2 7-2h60q4 0 7 3l15 20q4 4 4 10v13q0 3-3 3H17q-3 0-3-3z',
    windows: 'M60 38l16-11q2-1 4-1h24v13zM110 26h30q2 0 3 2l8 11h-41z',
    wheels: [47, 156],
  },
  sedan: {
    label: 'Sedã',
    body: 'M8 66V55q0-6 6-8l24-6 18-14q3-3 8-3h50q7 0 11 4l20 14 26 6q7 2 7 9v10q0 3-3 3H11q-3 0-3-3z',
    windows: 'M62 40l12-12q2-2 5-2h24v14zM109 26h12q3 0 6 2l14 12h-32z',
    wheels: [42, 160],
  },
  suv: {
    label: 'SUV',
    body: 'M10 68V50q0-6 6-8l20-5 12-14q3-4 8-4h92q6 0 10 4l16 14 12 4q6 2 6 8v19q0 3-3 3H13q-3 0-3-3z',
    windows: 'M54 37l8-10q2-2 5-2h26v12zM100 25h30q4 0 7 3l9 9h-46z',
    wheels: [44, 158],
  },
  jeep: {
    label: 'Jipe',
    body: 'M12 68V48q0-4 4-5l14-3V24q0-4 4-4h96q4 0 4 4v16h24q6 0 6 6v22q0 3-3 3H15q-3 0-3-3z',
    windows: 'M42 26h38v13H42zM86 26h50v13H86z',
    wheels: [44, 158],
  },
  pickup: {
    label: 'Picape',
    body: 'M8 68V54q0-5 5-6l22-5 12-14q3-3 7-3h38q5 0 8 4l8 13h18v-10q0-2 2-2h58q4 0 4 4v26q0 3-3 3H11q-3 0-3-3z',
    windows: 'M54 40l8-10q2-2 4-2h22v12zM96 28h12q3 0 4 2l7 10H96z',
    wheels: [40, 160],
  },
  sport: {
    label: 'Esportivo',
    body: 'M6 68V58q0-4 4-6l30-8 22-13q4-2 9-2h38q8 0 14 5l16 10 40 8q6 1 6 7v9q0 3-3 3H9q-3 0-3-3z',
    windows: 'M70 41l16-9q2-1 5-1h24q4 0 7 3l10 8z',
    wheels: [44, 160],
  },
  van: {
    label: 'Utilitário',
    body: 'M8 68V28q0-8 8-8h112q6 0 9 4l14 18 18 6q7 2 7 8v12q0 3-3 3H11q-3 0-3-3z',
    windows: 'M142 28l11 15h-24V28z',
    wheels: [42, 156],
  },
};

export const SILHOUETTE_IDS = Object.keys(SILHOUETTES);

/** Marcação interna da silhueta com a cor da carroceria. */
export function silhouetteInner(id, color = '#2EE6D6') {
  const s = SILHOUETTES[id] || SILHOUETTES.hatch;
  const wheels = s.wheels
    .map((x) => `<circle cx="${x}" cy="68" r="12" fill="#0B1219"/><circle cx="${x}" cy="68" r="5.500" fill="#6B7A8A"/>`)
    .join('');
  const extra = s.extra ? `<g fill="#0B1219">${s.extra}</g>` : '';
  return (
    `<ellipse cx="100" cy="82" rx="86" ry="3.500" fill="#000" opacity=".22"/>` +
    extra +
    `<path d="${s.body}" fill="${color}"/>` +
    `<path d="${s.windows}" fill="#0B1219" opacity=".72"/>` +
    wheels
  );
}

export function silhouetteSvgString(id, color = '#2EE6D6') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 90">${silhouetteInner(id, color)}</svg>`;
}

/** Elemento SVG (DOM) da silhueta. */
export function silhouette(id, color = '#2EE6D6', { width = 160 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const doc = new DOMParser().parseFromString(silhouetteSvgString(id, color), 'image/svg+xml');
  const el = document.importNode(doc.documentElement, true);
  el.setAttribute('class', 'silhouette');
  el.setAttribute('width', String(width));
  el.setAttribute('height', String(Math.round((width * 90) / 200)));
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', (SILHOUETTES[id] || SILHOUETTES.hatch).label);
  void NS;
  return el;
}
