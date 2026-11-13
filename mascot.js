/**
 * Mascote do assistente BOLT: pequeno, discreto, olhos pequenos e boca em ondas sonoras.
 * Estados: normal, listening, thinking, speaking, attention, alert.
 * As animações vivem em styles.css (seletor .bolt-mascot[data-state]).
 */

export const MASCOT_STATES = ['normal', 'listening', 'thinking', 'speaking', 'attention', 'alert'];

export const MASCOT_LABELS = {
  normal: 'Pronto',
  listening: 'Ouvindo',
  thinking: 'Pensando',
  speaking: 'Falando',
  attention: 'Atenção',
  alert: 'Alerta',
};

const BARS = [22, 27, 32, 37, 42];

/** Marcação interna do mascote (viewBox 0 0 64 56). */
export function mascotInner() {
  const bars = BARS.map(
    (x, i) => `<rect class="m-bar" style="--i:${i}" x="${x - 1.5}" y="34" width="3" height="10" rx="1.5"/>`,
  ).join('');
  return (
    '<path class="m-antenna" d="M33.2 1.5 28.6 9H32l-1.4 5.2L36.200 7h-3.400z"/>' +
    '<rect class="m-body" x="5" y="14" width="54" height="39" rx="17"/>' +
    '<rect class="m-face" x="10" y="19" width="44" height="29" rx="12"/>' +
    '<g class="m-eyes"><circle class="m-eye" cx="24" cy="28.500" r="2.400"/><circle class="m-eye" cx="40" cy="28.500" r="2.400"/></g>' +
    '<g class="m-brows"><path d="M20.500 24.500l7-1.600"/><path d="M43.500 24.500l-7-1.600"/></g>' +
    `<g class="m-mouth">${bars}</g>`
  );
}

/** SVG estático (estado normal) para o arquivo bolt-mascot.svg. */
export function mascotSvgString() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 56" width="256" height="224">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2EE6D6"/><stop offset="1" stop-color="#2B7BFF"/></linearGradient></defs>
<path d="M33.2 1.5 28.6 9H32l-1.4 5.2L36.200 7h-3.400z" fill="#2EE6D6"/>
<rect x="5" y="14" width="54" height="39" rx="17" fill="url(#g)"/>
<rect x="10" y="19" width="44" height="29" rx="12" fill="#07131C"/>
<circle cx="24" cy="28.500" r="2.400" fill="#7DF3E8"/><circle cx="40" cy="28.500" r="2.400" fill="#7DF3E8"/>
<g fill="#7DF3E8"><rect x="20.500" y="38" width="3" height="4" rx="1.500"/><rect x="25.500" y="36" width="3" height="8" rx="1.500"/><rect x="30.500" y="34" width="3" height="12" rx="1.500"/><rect x="35.500" y="36" width="3" height="8" rx="1.500"/><rect x="40.500" y="38" width="3" height="4" rx="1.500"/></g>
</svg>`;
}

/**
 * Cria o elemento do mascote. Retorna o <span> com método setState().
 * @param {{size?:number,state?:string}} opts
 */
export function createMascot({ size = 44, state = 'normal' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const wrap = document.createElement('span');
  wrap.className = 'bolt-mascot';
  wrap.style.setProperty('--ms', `${size}px`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 56');
  svg.setAttribute('aria-hidden', 'true');
  const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}">${mascotInner()}</svg>`, 'image/svg+xml');
  for (const n of [...doc.documentElement.childNodes]) svg.appendChild(document.importNode(n, true));
  wrap.appendChild(svg);
  wrap.setState = (s) => {
    const next = MASCOT_STATES.includes(s) ? s : 'normal';
    wrap.dataset.state = next;
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', `Assistente: ${MASCOT_LABELS[next]}`);
  };
  wrap.setState(state);
  return wrap;
}
