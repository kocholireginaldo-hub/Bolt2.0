/**
 * BOLT PERFORMANCE — miniatura do veículo (Garagem): a mesma imagem do catálogo usada no cockpit.
 * Sem imagem ou sem catálogo: mostra só o nome, nunca um desenho genérico.
 */
const MISSING = new Map();
const TTL = 20000;

export function createVehicleThumb(visual, fallbackName = '') {
  const root = document.createElement('div');
  root.className = 'vthumb';
  const name = visual.name || fallbackName || '';
  const ph = document.createElement('div');
  ph.className = 'vthumb-ph';
  const strong = document.createElement('strong');
  strong.textContent = name || 'BOLT';
  const note = document.createElement('span');
  ph.append(strong, note);
  const img = document.createElement('img');
  img.alt = name;
  img.decoding = 'async';
  img.draggable = false;
  img.hidden = true;
  root.append(img, ph);

  const empty = (text) => { note.textContent = text; root.classList.add('is-empty'); };
  if (!visual.file) empty('Sem imagem no catálogo');
  else if (MISSING.has(visual.file) && Date.now() - MISSING.get(visual.file) < TTL) empty(visual.file);
  else {
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => {
      MISSING.delete(visual.file);
      img.src = visual.file;
      img.hidden = false;
      requestAnimationFrame(() => root.classList.add('has-image'));
    };
    probe.onerror = () => { MISSING.set(visual.file, Date.now()); empty(visual.file); };
    probe.src = visual.file;
  }
  return root;
}
