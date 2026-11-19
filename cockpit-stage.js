/**
 * BOLT PERFORMANCE — palco central do veículo.
 * Reserva e ilumina a área; carrega a imagem real (PNG transparente/WebP) do catálogo, que fica na raiz.
 * Nunca desenha um carro: sem imagem, mostra apenas uma identificação discreta.
 */
import { BOLT_COLOR_SWATCHES } from './vehicle-catalog.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Memória de arquivos que não existem (evita repetir requisições; expira para permitir novas imagens). */
const MISSING = new Map();
const MISSING_TTL = 20000;
const isKnownMissing = (f) => MISSING.has(f) && Date.now() - MISSING.get(f) < MISSING_TTL;

export function createVehicleStage({ onPickColor = () => {}, onPhoto = null } = {}) {
  const root = el('section', 'stage');
  root.setAttribute('aria-label', 'Veículo selecionado');
  const room = el('div', 'stage-room');
  room.setAttribute('aria-hidden', 'true');
  room.append(el('i', 'sr-wall'), el('i', 'sr-floor'), el('i', 'sr-ceiling'), el('i', 'sr-strip sr-strip-l'), el('i', 'sr-strip sr-strip-r'), el('i', 'sr-glow'), el('i', 'sr-plate'));

  const car = el('div', 'stage-car');
  const layers = [el('img', 'stage-img'), el('img', 'stage-img')];
  for (const img of layers) {
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.hidden = true;
    car.append(img);
  }
  const ph = el('div', 'stage-ph');
  const phName = el('strong', 'stage-ph-name');
  const phNote = el('span', 'stage-ph-note');
  ph.append(phName, phNote);
  const dots = el('div', 'stage-colors');
  dots.setAttribute('role', 'group');
  dots.setAttribute('aria-label', 'Cor do veículo');
  // enviar/trocar a foto do veículo
  const photoBtn = el('button', 'stage-photo');
  photoBtn.type = 'button';
  photoBtn.hidden = true;
  const photoLabel = el('span', '', 'Foto');
  photoBtn.append(photoLabel);
  photoBtn.setAttribute('aria-label', 'Enviar ou trocar a foto do veículo');
  if (onPhoto) photoBtn.addEventListener('click', () => onPhoto());
  const addBtn = el('button', 'stage-add', 'Enviar foto do veículo');
  addBtn.type = 'button';
  if (onPhoto) addBtn.addEventListener('click', () => onPhoto());
  ph.append(addBtn);
  root.append(room, car, ph, dots, photoBtn);

  let front = 0;
  let currentFile = null;
  let token = 0;
  let destroyed = false;
  let dotsHidden = true;

  const showPlaceholder = (name, note) => {
    phName.textContent = name || 'ALMA DO CARRO';
    phNote.textContent = note || '';
    root.classList.add('is-empty');
    root.classList.remove('has-image');
    dots.hidden = true; // sem imagem, as bolinhas de cor não fazem sentido
    for (const img of layers) img.classList.remove('in');
  };

  const show = (file, label) => {
    const back = 1 - front;
    const img = layers[back];
    img.hidden = false;
    img.alt = label || '';
    img.src = file;
    // dois quadros: garante o estado inicial (transparente) antes de acionar a transição
    requestAnimationFrame(() => {
      if (destroyed) return;
      img.classList.add('in');
      layers[front].classList.remove('in');
      front = back;
    });
    root.classList.add('has-image');
    root.classList.remove('is-empty');
    dots.hidden = dotsHidden;
  };

  const paintDots = (visual) => {
    dots.replaceChildren();
    dotsHidden = !(visual.colors && visual.colors.length > 1);
    dots.hidden = dotsHidden;
    if (dotsHidden) return;
    for (const c of visual.colors) {
      const b = el('button', `stage-dot${c === visual.color ? ' on' : ''}`);
      b.type = 'button';
      b.style.setProperty('--sw', BOLT_COLOR_SWATCHES[c]?.swatch || '#888');
      b.setAttribute('aria-label', `Cor ${BOLT_COLOR_SWATCHES[c]?.label || c}`);
      b.setAttribute('aria-pressed', String(c === visual.color));
      b.addEventListener('click', () => onPickColor(c));
      dots.append(b);
    }
  };

  return {
    el: root,
    /** @param {{catalogId:string|null,color:string|null,file:string|null,colors:string[],name:string}} visual @param {string} fallbackName */
    set(visual, fallbackName = '') {
      paintDots(visual);
      const hasVehicle = !!(visual.name || fallbackName);
      photoBtn.hidden = !(onPhoto && hasVehicle);
      addBtn.hidden = !(onPhoto && hasVehicle);
      root.classList.toggle('is-photo', !!visual.photo && !visual.photoAlpha);
      const name = visual.name || fallbackName;
      const key = visual.file ? `${visual.file.length}:${visual.file.slice(-48)}` : `none:${name}`;
      if (key === currentFile) return;
      currentFile = key;
      const my = ++token;
      if (!visual.file) {
        showPlaceholder(name, name ? 'Adicione uma foto para este veículo' : 'Nenhum veículo selecionado');
        return;
      }
      if (isKnownMissing(visual.file)) {
        showPlaceholder(name, 'Adicione uma foto para este veículo');
        return;
      }
      const probe = new Image();
      probe.decoding = 'async';
      probe.onload = () => {
        if (destroyed || my !== token) return;
        MISSING.delete(visual.file);
        show(visual.file, name);
      };
      probe.onerror = () => {
        if (destroyed || my !== token) return;
        MISSING.set(visual.file, Date.now());
        showPlaceholder(name, 'Adicione uma foto para este veículo');
      };
      probe.src = visual.file;
    },
    destroy() {
      destroyed = true;
      token++;
    },
  };
}
