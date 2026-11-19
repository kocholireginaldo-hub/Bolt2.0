/**
 * BOLT — conjunto de ícones próprio.
 * Grade 24x24, traço 1.75, pontas arredondadas, herda `currentColor`.
 * Fonte única: estes mesmos desenhos geram os arquivos icon-*.svg (ver build-assets.mjs).
 */

export const ICONS = {
  /* navegação */
  panel: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l3.6-4.6"/><circle cx="12" cy="17" r="1.3"/><path d="M6.2 11.6l1 .7M12 8.7v1.1M17.8 11.6l-1 .7"/>',
  garage: '<path d="M3 10.2 12 4l9 6.2V20H3z"/><path d="M7 20v-5.5h10V20"/><path d="M7 17.2h10"/>',
  trips: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  diagnostics: '<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M6.5 11h2.6l1.5-3.2 2.4 6 1.6-2.8h2.9"/><path d="M9 20.5h6"/>',
  maintenance: '<path d="M20.2 7.4a4.6 4.6 0 0 1-6.3 4.3l-6.5 6.5a1.9 1.9 0 0 1-2.7-2.7l6.5-6.5A4.6 4.6 0 0 1 16.6 3l-2.5 2.5.4 2.2 2.2.4z"/>',
  assistant: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.4V17h-.3A1.5 1.5 0 0 1 4 15.5z"/><path d="M8.3 10.2v1.6M11 8.8v4.4M13.7 9.8v2.4M16.4 10.4v1.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.6"/><path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5"/>',
  lab: '<path d="M9.5 3.5h5M10.4 3.5v5.3l-5.2 8.8A2.2 2.2 0 0 0 7.1 21h9.8a2.2 2.2 0 0 0 1.9-3.4l-5.2-8.8V3.5"/><path d="M7.8 14.5h8.4"/>',

  /* conexão */
  obd: '<path d="M3.5 7.5h17l-2 9h-13z"/><circle cx="8" cy="10.8" r=".75" fill="currentColor" stroke="none"/><circle cx="11" cy="10.8" r=".75" fill="currentColor" stroke="none"/><circle cx="14" cy="10.8" r=".75" fill="currentColor" stroke="none"/><circle cx="17" cy="10.8" r=".75" fill="currentColor" stroke="none"/><circle cx="9.5" cy="13.7" r=".75" fill="currentColor" stroke="none"/><circle cx="12.5" cy="13.7" r=".75" fill="currentColor" stroke="none"/><circle cx="15.5" cy="13.7" r=".75" fill="currentColor" stroke="none"/><path d="M12 7.5V4M9 4h6"/>',
  bluetooth: '<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>',
  wifi: '<path d="M3 9.4a14 14 0 0 1 18 0M6 12.9a9.6 9.6 0 0 1 12 0M9 16.3a5 5 0 0 1 6 0"/><circle cx="12" cy="19.6" r="1" fill="currentColor" stroke="none"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  'globe-off': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/><path d="M4.5 4.5l15 15"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  unlink: '<path d="M9.5 6.2l1.2-1.2a4 4 0 0 1 5.7 5.7l-1.2 1.2M14.5 17.8l-1.2 1.2a4 4 0 0 1-5.7-5.7l1.2-1.2"/><path d="M4 4l16 16"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0zM12 17v4"/>',

  /* alertas */
  alert: '<path d="M12 3.8 21.2 19.6H2.8z"/><path d="M12 9.8v4.4"/><circle cx="12" cy="16.9" r=".8" fill="currentColor" stroke="none"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 1.6H4.4z"/><path d="M10 20.6a2.2 2.2 0 0 0 4 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r=".8" fill="currentColor" stroke="none"/>',
  engine: '<path d="M4.5 10h2.5V8h3V6h4.5v2H17l2 2.2h1.5V16H19l-2 2.4H9.5L7 16H4.5z"/><path d="M2.6 12v3M12 10.2v3.6M9.4 12h5.2"/>',
  shield: '<path d="M12 3.2 19.5 6v5.6c0 4.4-3.1 7.6-7.5 9.2-4.4-1.6-7.5-4.8-7.5-9.2V6z"/><path d="M8.8 12l2.3 2.3 4.2-4.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/><circle cx="12" cy="15.5" r="1.1" fill="currentColor" stroke="none"/>',

  /* instrumentos */
  speed: '<path d="M3.6 16.5a8.7 8.7 0 1 1 16.8 0"/><path d="M12 16l4.2-5.3"/><path d="M6 12.2l.9.5M8.9 8.8l.6.9M15.1 8.8l-.6.9M18 12.2l-.9.5"/>',
  thermometer: '<path d="M10 4.5a2 2 0 0 1 4 0v9.2a4.2 4.2 0 1 1-4 0z"/><path d="M12 9v6.6"/><circle cx="12" cy="17.2" r="1.2" fill="currentColor" stroke="none"/>',
  battery: '<rect x="3" y="7.5" width="16" height="10" rx="2.2"/><path d="M21.5 10.8v3.4"/><path d="M12.2 9.6 9.6 12.6h3.2l-1 2.8 2.9-3.4h-3.1z" fill="currentColor" stroke="none"/>',
  fuel: '<path d="M5 20.5V5.5A1.8 1.8 0 0 1 6.8 3.7h6.4A1.8 1.8 0 0 1 15 5.5v15"/><path d="M3.5 20.5h13M5 9.5h10"/><path d="M15 8.6l2.6 1.8c.6.4 1 1 1 1.8v5a1.4 1.4 0 0 0 2.8 0V9l-2.4-2.6"/>',
  drop: '<path d="M12 3.4s6 6.1 6 10.4a6 6 0 0 1-12 0c0-4.300 6-10.400 6-10.400z"/>',
  load: '<path d="M4 18V9M9 18V5M14 18v-6M19 18V8"/><path d="M3 20.5h18"/>',
  air: '<path d="M3 9h10.5a2.5 2.5 0 1 0-2.4-3.2M3 13.5h14.5a2.7 2.7 0 1 1-2.5 3.6M3 18h6.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
  road: '<path d="M8 3 4 21M16 3l4 18M12 4v3M12 10v4M12 17v3"/>',
  pin: '<path d="M12 21s6.5-5.800 6.500-11a6.500 6.500 0 0 0-13 0C5.500 15.200 12 21 12 21z"/><circle cx="12" cy="10" r="2.300"/>',

  /* ações */
  check: '<path d="M4.5 12.8 9.700 18 19.500 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M4 20h4L19.200 8.800a2.100 2.100 0 0 0-3-3L5 17z"/><path d="M14.500 7.500l3 3"/>',
  trash: '<path d="M4.500 6.800h15M9.500 6.800V4.500h5v2.300M6.500 6.800l.8 13h9.400l.8-13"/><path d="M10 10.500v6M14 10.500v6"/>',
  'chevron-up': '<path d="M6 14.500l6-6 6 6"/>',
  'chevron-down': '<path d="M6 9.500l6 6 6-6"/>',
  'chevron-left': '<path d="M14.500 6l-6 6 6 6"/>',
  'chevron-right': '<path d="M9.500 6l6 6-6 6"/>',
  play: '<path d="M7 4.800v14.400L19 12z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  power: '<path d="M12 3.500v8.500"/><path d="M7 6.600a7.500 7.500 0 1 0 10 0"/>',
  refresh: '<path d="M19.500 12a7.500 7.500 0 1 1-2.200-5.300"/><path d="M19.500 4.500v4h-4"/>',
  download: '<path d="M12 4v11M7.500 11 12 15.500 16.500 11M5 19.500h14"/>',
  upload: '<path d="M12 15.500V4.500M7.500 9 12 4.500 16.500 9M5 19.500h14"/>',
  send: '<path d="M4 12 20 4l-4.500 16-3.700-6.300z"/><path d="M11.800 13.700 20 4"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  collapse: '<path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/>',
  list: '<path d="M8.500 6.500H20M8.500 12H20M8.500 17.500H20"/><circle cx="4.500" cy="6.500" r=".9" fill="currentColor" stroke="none"/><circle cx="4.500" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="4.500" cy="17.500" r=".9" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="3.500" y="5" width="17" height="15.500" rx="2.500"/><path d="M3.500 10h17M8 3v4M16 3v4"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  user: '<circle cx="12" cy="8.500" r="3.800"/><path d="M4.500 20c.800-3.800 3.800-5.800 7.500-5.800s6.700 2 7.500 5.800"/>',
  palette: '<path d="M12 3.500a8.500 8.500 0 1 0 0 17c1.500 0 2-1 1.500-2.100-.5-1.200.2-2.400 1.600-2.400H17a3.500 3.500 0 0 0 3.500-3.500C20.500 7 16.700 3.500 12 3.500z"/><circle cx="8" cy="11" r=".9" fill="currentColor" stroke="none"/><circle cx="11" cy="7.500" r=".9" fill="currentColor" stroke="none"/><circle cx="15.500" cy="8.500" r=".9" fill="currentColor" stroke="none"/>',
  database: '<ellipse cx="12" cy="6" rx="7.500" ry="2.800"/><path d="M4.500 6v6c0 1.500 3.400 2.800 7.500 2.800s7.500-1.300 7.500-2.800V6M4.500 12v6c0 1.500 3.400 2.800 7.500 2.800s7.500-1.300 7.500-2.800v-6"/>',
  car: '<path d="M3.500 15.500v-3l2-4.300A2 2 0 0 1 7.300 7h9.400a2 2 0 0 1 1.800 1.200l2 4.300v3"/><path d="M3.500 15.500h17v2.500h-3v-1.500h-11V18h-3z"/><circle cx="7.500" cy="12.800" r=".9" fill="currentColor" stroke="none"/><circle cx="16.500" cy="12.800" r=".9" fill="currentColor" stroke="none"/>',

  /* assistente */
  moon: '<path d="M20 14.2A8 8 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z"/>',
  mic: '<rect x="9" y="3.500" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3M9 21h6"/>',
  'mic-off': '<path d="M9 8.500V6.500a3 3 0 0 1 5.800-1M15 10.500v1a3 3 0 0 1-4.500 2.600"/><path d="M5.500 11.500a6.500 6.500 0 0 0 10 5.500M18.500 11.500c0 .900-.2 1.700-.5 2.500M12 18v3M9 21h6M4 4l16 16"/>',
  volume: '<path d="M4 9.500v5h3.500l4.500 3.800V5.700L7.500 9.500z"/><path d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11"/>',
  'volume-off': '<path d="M4 9.500v5h3.500l4.500 3.800V5.700L7.500 9.500z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>',
  wave: '<path d="M4 12h.01M7.500 9v6M11 6v12M14.500 8.500v7M18 10.500v3M21 12h.01"/>',
  bolt: '<path d="M13 2.500 5 13.500h6l-1 8 8-11h-6z"/>',

  /* manutenção */
  filter: '<path d="M4 5h16l-6 7.500V19l-4 1.500v-8z"/>',
  spark: '<path d="M9 3v5M15 3v5M7 8h10v3.500a5 5 0 0 1-10 0z"/><path d="M12 16.500V21"/>',
  belt: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>',
  brake: '<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="2.800"/><path d="M12 3.500v2.800M12 17.700v2.800M3.500 12h2.800M17.700 12h2.800"/>',
  revision: '<rect x="5" y="4.500" width="14" height="16.500" rx="2"/><path d="M9 4.500h6V7H9zM8.800 14l2.200 2.200 4.200-4.400"/>',
  tag: '<path d="M3.500 12.200V4.500a1 1 0 0 1 1-1h7.700l8.300 8.300a1.400 1.400 0 0 1 0 2L14 20.300a1.400 1.400 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.200" fill="currentColor" stroke="none"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.500-5.800L4 8.500"/><path d="M4 4v4.500h4.500M12 8v4.200l3 1.800"/>',
};

export const NAV_ITEMS = [
  { id: 'panel', label: 'Painel', icon: 'panel' },
  { id: 'garage', label: 'Garagem', icon: 'garage' },
  { id: 'trips', label: 'Viagens', icon: 'trips' },
  { id: 'diagnostics', label: 'Diagnóstico', icon: 'diagnostics' },
  { id: 'maintenance', label: 'Manutenção', icon: 'maintenance' },
  { id: 'assistant', label: 'Assistente', icon: 'assistant' },
];

/** Marcação SVG completa (string) — usada pelo gerador de arquivos .svg. */
export function iconSvgString(name, { size = 24, stroke = 1.75, color = 'currentColor' } = {}) {
  const inner = ICONS[name];
  if (!inner) throw new Error(`Ícone desconhecido: ${name}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const cache = new Map();

/** Cria um elemento SVG (DOM) para o ícone; nunca usa innerHTML da página. */
export function icon(name, { size = 20, cls = '', title = '' } = {}) {
  let proto = cache.get(name);
  if (!proto) {
    const inner = ICONS[name];
    if (!inner) {
      console.warn('[BOLT] ícone desconhecido:', name);
      return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    }
    const doc = new DOMParser().parseFromString(iconSvgString(name), 'image/svg+xml');
    proto = document.importNode(doc.documentElement, true);
    cache.set(name, proto);
  }
  const el = proto.cloneNode(true);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('class', `ico ${cls}`.trim());
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  if (title) {
    el.removeAttribute('aria-hidden');
    el.setAttribute('role', 'img');
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = title;
    el.prepend(t);
  }
  return el;
}
