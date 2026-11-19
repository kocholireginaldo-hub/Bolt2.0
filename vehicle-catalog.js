/**
 * BOLT PERFORMANCE — catálogo visual dos veículos (camada complementar ao cadastro técnico).
 *
 * - As imagens ficam DIRETAMENTE NA RAIZ do projeto (sem subpastas), ao lado do index.html.
 * - Este catálogo NÃO altera ano, motorização, quilometragem ou qualquer dado da Garagem.
 * - Para adicionar um veículo ou cor: edite apenas este arquivo (ver README, seção "Cockpit").
 */

/** Identificador → nome de exibição + cor → arquivo (caminho relativo à raiz). */
export const BOLT_VEHICLE_IMAGES = {
  saveiro: {
    name: 'Volkswagen Saveiro',
    colors: {
      prata: 'saveiro_prata.png',
      branco: 'saveiro_branco.png',
      preto: 'saveiro_preto.png',
      vermelho: 'saveiro_vermelho.png',
    },
  },
  renegade: {
    name: 'Jeep Renegade',
    colors: {
      prata: 'renegade_prata.png',
      branco: 'renegade_branco.png',
      preto: 'renegade_preto.png',
      vermelho: 'renegade_vermelho.png',
      azul: 'renegade_azul.png',
    },
  },
  civic2010: {
    name: 'Honda Civic 2010',
    colors: {
      prata: 'civic2010_prata.png',
      branco: 'civic2010_branco.png',
      preto: 'civic2010_preto.png',
      vermelho: 'civic2010_vermelho.png',
      azul: 'civic2010_azul.png',
    },
  },
  ecosport2006: {
    name: 'Ford EcoSport 2006',
    colors: {
      prata: 'ecosport2006_prata.png',
      branco: 'ecosport2006_branco.png',
      preto: 'ecosport2006_preto.png',
      vermelho: 'ecosport2006_vermelho.png',
      azul: 'ecosport2006_azul.png',
    },
  },
  jetta: {
    name: 'Volkswagen Jetta',
    colors: {
      prata: 'jetta_prata.png',
      branco: 'jetta_branco.png',
      preto: 'jetta_preto.png',
      vermelho: 'jetta_vermelho.png',
      azul: 'jetta_azul.png',
    },
  },
};

/** Rótulos e cor da bolinha de seleção (apenas a amostra da interface, não é cor do carro real). */
export const BOLT_COLOR_SWATCHES = {
  prata: { label: 'Prata', swatch: '#B9C2CC' },
  branco: { label: 'Branco', swatch: '#F4F7FA' },
  preto: { label: 'Preto', swatch: '#15191F' },
  vermelho: { label: 'Vermelho', swatch: '#D6202F' },
  azul: { label: 'Azul', swatch: '#1E6FE0' },
};

/**
 * Como reconhecer, no cadastro da Garagem, qual entrada do catálogo corresponde ao veículo.
 * `model` é testado contra "marca modelo" (sem acentos, minúsculo). `years` é opcional:
 * quando presente, o veículo só casa se o ANO do cadastro estiver na lista.
 * (Saveiro, Renegade e Jetta não têm restrição: o ano continua sendo o do cadastro do usuário.)
 */
export const BOLT_VEHICLE_MATCH = {
  saveiro: { model: /saveiro/ },
  renegade: { model: /renegade/ },
  civic2010: { model: /civic/, years: [2010] },
  ecosport2006: { model: /eco\s*sport/, years: [2006] },
  jetta: { model: /jetta/ },
};

export const DEFAULT_COLOR = 'prata';

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Identifica a entrada do catálogo para um veículo da Garagem (ou null). */
export function catalogIdFor(vehicle) {
  if (!vehicle?.tech) return null;
  const text = norm(`${vehicle.tech.make} ${vehicle.tech.model} ${vehicle.nickname || ''}`);
  const year = Number(vehicle.tech.year);
  for (const [id, rule] of Object.entries(BOLT_VEHICLE_MATCH)) {
    if (!rule.model.test(text)) continue;
    if (rule.years && !rule.years.includes(year)) continue;
    return id;
  }
  return null;
}

/** Cores disponíveis no catálogo para a entrada. */
export function colorsFor(catalogId) {
  return Object.keys(BOLT_VEHICLE_IMAGES[catalogId]?.colors || {});
}

/** Converte a cor hexadecimal da aparência em um nome do catálogo (ou null se não for reconhecível). */
export function colorNameFromHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.18) return l > 0.78 ? 'branco' : l < 0.22 ? 'preto' : 'prata';
  let hue;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) hue = ((b - r) / d + 2) * 60;
  else hue = ((r - g) / d + 4) * 60;
  if (hue < 18 || hue >= 340) return 'vermelho';
  if (hue >= 195 && hue < 255) return 'azul';
  return null;
}

/**
 * Cor escolhida: 1) preferência salva no cockpit para este veículo, 2) cor da aparência do cadastro
 * (se reconhecível e existente no catálogo), 3) prata (ou a primeira cor disponível).
 */
export function resolveColor(catalogId, { override = null, appearanceColor = null } = {}) {
  const avail = colorsFor(catalogId);
  if (!avail.length) return null;
  if (override && avail.includes(override)) return override;
  const fromHex = colorNameFromHex(appearanceColor);
  if (fromHex && avail.includes(fromHex)) return fromHex;
  return avail.includes(DEFAULT_COLOR) ? DEFAULT_COLOR : avail[0];
}

/** Nome do arquivo (relativo à raiz) ou null. */
export function imageFile(catalogId, color) {
  return BOLT_VEHICLE_IMAGES[catalogId]?.colors?.[color] || null;
}

/** Resolve tudo que o cockpit precisa para exibir o veículo. */
export function resolveVehicleVisual(vehicle, override = null) {
  // a foto enviada pelo dono do carro tem prioridade sobre o catálogo
  if (vehicle?.photo) return { catalogId: null, color: null, file: vehicle.photo, colors: [], name: vehicle.nickname || '', photo: true, photoAlpha: !!vehicle.photoAlpha };
  const catalogId = catalogIdFor(vehicle);
  if (!catalogId) return { catalogId: null, color: null, file: null, colors: [], name: vehicle?.nickname || '' };
  const color = resolveColor(catalogId, { override, appearanceColor: vehicle?.appearance?.color });
  return { catalogId, color, file: imageFile(catalogId, color), colors: colorsFor(catalogId), name: BOLT_VEHICLE_IMAGES[catalogId].name };
}

/** Todos os arquivos esperados na raiz (24 no total). */
export function allImageFiles() {
  return Object.values(BOLT_VEHICLE_IMAGES).flatMap((v) => Object.values(v.colors));
}
