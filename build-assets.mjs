/**
 * Gera os arquivos SVG de marca/ícones na raiz a partir das fontes únicas
 * (icons.js, mascot.js). Uso opcional:  node build-assets.mjs
 * Os PNGs do PWA (icon-192.png etc.) são derivados de bolt-icon.svg
 * (ex.: rsvg-convert -w 512 bolt-icon.svg -o icon-512.png).
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ICONS, iconSvgString } from './icons.js';
import { mascotSvgString } from './mascot.js';

const root = dirname(fileURLToPath(import.meta.url));
const out = (name, text) => writeFile(join(root, name), text.endsWith('\n') ? text : `${text}\n`);

const ACCENT_A = '#2EE6D6';
const ACCENT_B = '#2B7BFF';
const BOLT_PATH = 'M13.6 2.2 5.2 13.4h6l-1.1 8.4 8.700-11.600h-6.200z';

const defs = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ACCENT_A}"/><stop offset="1" stop-color="${ACCENT_B}"/></linearGradient></defs>`;

/** Emblema: selo arredondado com gradiente e raio. */
const badge = (pad = 0, size = 96) => {
  const s = size - pad * 2;
  const k = s / 24;
  return (
    `<rect x="${pad}" y="${pad}" width="${s}" height="${s}" rx="${s * 0.26}" fill="url(#bg)"/>` +
    `<g transform="translate(${pad + s * 0.16} ${pad + s * 0.16}) scale(${k * 0.68})"><path d="${BOLT_PATH}" fill="#06121A"/></g>`
  );
};

const iconSvg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">${defs}${badge(pad, 96)}</svg>`;

/** Logotipo monolinear: B O L T. */
const wordmark = (color) =>
  `<g fill="none" stroke="${color}" stroke-width="5.500" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M3 3v34M3 3h11a8.500 8.500 0 0 1 0 17H3M14 20a8.500 8.500 0 0 1 0 17H3"/>` +
  `<rect x="41" y="3" width="23" height="34" rx="11.500"/>` +
  `<path d="M80 3v34h21"/>` +
  `<path d="M111 3h25M123.500 3v34"/></g>`;

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 56" width="440" height="112">${defs}
<g transform="translate(0 4)">${badge(0, 48)}</g>
<g transform="translate(64 8)">${wordmark('#E8F1F8')}</g>
</svg>`;

const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}
<defs><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${ACCENT_A}" stop-opacity=".35"/><stop offset="1" stop-color="${ACCENT_A}" stop-opacity="0"/></radialGradient></defs>
<rect width="512" height="512" fill="#070C12"/>
<circle cx="256" cy="256" r="230" fill="url(#glow)"/>
<g transform="translate(136 136) scale(2.5)">${badge(0, 96)}</g>
</svg>`;

const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">${defs}<rect width="96" height="96" fill="url(#bg)"/><g transform="translate(26 26) scale(1.8)"><path d="${BOLT_PATH}" fill="#06121A"/></g></svg>`;

const files = {
  'bolt-icon.svg': iconSvg(0),
  'bolt-icon-maskable.svg': maskable,
  'favicon.svg': iconSvg(0),
  'bolt-logo.svg': logo,
  'bolt-splash.svg': splash,
  'bolt-mascot.svg': mascotSvgString(),
};

const sectionIcons = ['panel', 'garage', 'trips', 'diagnostics', 'maintenance', 'assistant', 'settings', 'lab', 'obd', 'bluetooth', 'wifi', 'alert'];
for (const n of sectionIcons) {
  if (!ICONS[n]) throw new Error(`ícone ausente: ${n}`);
  files[`icon-${n}.svg`] = iconSvgString(n, { size: 48, stroke: 1.75, color: ACCENT_A });
}

await Promise.all(Object.entries(files).map(([n, t]) => out(n, t)));
console.log(`Gerados ${Object.keys(files).length} arquivos SVG.`);
