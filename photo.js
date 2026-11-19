/**
 * ALMA DO CARRO — foto do veículo.
 * A foto fica só neste dispositivo (junto do cadastro do veículo), reduzida para caber bem no painel.
 * Fotos com fundo transparente (PNG/WebP) mantêm a transparência e flutuam no palco; fotos comuns
 * (JPEG da câmera) preenchem o palco.
 */
const MAX_W = 1600;
const MAX_H = 1000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir esta imagem.')); };
    img.src = url;
  });
}

/** Reduz a imagem e devolve { dataUrl, alpha }. */
export async function processPhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Escolha um arquivo de imagem.');
  const img = await loadImage(file);
  const k = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const hgt = Math.max(1, Math.round(img.naturalHeight * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = hgt;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, hgt);
  // transparência: amostra cantos e bordas
  let alpha = false;
  if (/png|webp|gif/.test(file.type)) {
    const pts = [[0, 0], [w - 1, 0], [0, hgt - 1], [w - 1, hgt - 1], [Math.floor(w / 2), 0], [Math.floor(w / 2), hgt - 1]];
    alpha = pts.some(([x, y]) => g.getImageData(x, y, 1, 1).data[3] < 250);
  }
  const dataUrl = alpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.86);
  return { dataUrl, alpha };
}

/** Abre o seletor de arquivos (câmera/galeria) e devolve a foto processada, ou null se cancelar. */
export function choosePhoto() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.append(inp);
    let done = false;
    const finish = (fn) => { if (done) return; done = true; inp.remove(); fn(); };
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return finish(() => resolve(null));
      try {
        const r = await processPhoto(f);
        finish(() => resolve(r));
      } catch (err) {
        finish(() => reject(err));
      }
    });
    inp.addEventListener('cancel', () => finish(() => resolve(null)));
    inp.click();
  });
}
