/** Configuração central da Alma do Carro: constantes, registro de parâmetros e padrões. */

export const APP = Object.freeze({
  name: 'ALMA DO CARRO',
  version: '2.0.0',
  schema: 1,
  dbName: 'alma-do-carro-db',
});

/**
 * Registro de parâmetros do veículo (contrato único para OBD2 real e simulador).
 * pid: PID padrão SAE J1979 (modo 01). interval/stale em ms.
 */
export const PARAMS = Object.freeze({
  speed: { label: 'Velocidade', unit: 'km/h', pid: '0D', min: 0, max: 255, decimals: 0, intervalMs: 400, staleMs: 4000, core: true },
  rpm: { label: 'Rotação', unit: 'rpm', pid: '0C', min: 0, max: 16383.75, decimals: 0, intervalMs: 300, staleMs: 3000, core: true },
  engineLoad: { label: 'Carga do motor', unit: '%', pid: '04', min: 0, max: 100, decimals: 0, intervalMs: 700, staleMs: 6000, core: true },
  coolantTemp: { label: 'Temperatura do motor', unit: '°C', pid: '05', min: -40, max: 215, decimals: 0, intervalMs: 2500, staleMs: 12000, core: true },
  intakeTemp: { label: 'Temperatura do ar de admissão', unit: '°C', pid: '0F', min: -40, max: 215, decimals: 0, intervalMs: 3000, staleMs: 15000, core: true },
  batteryVoltage: { label: 'Tensão da bateria', unit: 'V', pid: '42', min: 0, max: 65.535, decimals: 1, intervalMs: 2500, staleMs: 12000, core: true },
  fuelLevel: { label: 'Combustível', unit: '%', pid: '2F', min: 0, max: 100, decimals: 0, intervalMs: 8000, staleMs: 40000, core: true },
  throttle: { label: 'Posição do acelerador', unit: '%', pid: '11', min: 0, max: 100, decimals: 0, intervalMs: 700, staleMs: 6000, core: false },
  maf: { label: 'Fluxo de ar (MAF)', unit: 'g/s', pid: '10', min: 0, max: 655.35, decimals: 1, intervalMs: 700, staleMs: 6000, core: false },
  fuelRate: { label: 'Taxa de combustível', unit: 'L/h', pid: '5E', min: 0, max: 3276.75, decimals: 1, intervalMs: 1500, staleMs: 8000, core: false },
});

export const PARAM_IDS = Object.freeze(Object.keys(PARAMS));
export const PID_TO_PARAM = Object.freeze(Object.fromEntries(Object.entries(PARAMS).map(([id, d]) => [d.pid, id])));

/**
 * Parâmetros de estimativa de consumo por combustível.
 * afr = razão ar/combustível de referência (ESTIMATIVA, ajustável por veículo).
 * density em kg/L. null => sem estimativa por carga (apenas taxa/MAF medidos quando existirem).
 */
export const FUEL_TYPES = Object.freeze({
  gasoline: { label: 'Gasolina', afr: 14.0, density: 0.745 },
  ethanol: { label: 'Etanol', afr: 9.0, density: 0.789 },
  flex: { label: 'Flex (gasolina/etanol)', afr: 12.0, density: 0.76 },
  diesel: { label: 'Diesel', afr: null, density: 0.84 },
  cng: { label: 'GNV', afr: null, density: null },
  hybrid: { label: 'Híbrido (gasolina)', afr: 14.0, density: 0.745 },
});

export const ASPIRATIONS = Object.freeze({ natural: 'Aspirado', turbo: 'Turbo' });
export const TRANSMISSIONS = Object.freeze({ manual: 'Manual', automatic: 'Automático', cvt: 'CVT', amt: 'Automatizado', dct: 'Dupla embreagem' });

/**
 * Limites iniciais SUGERIDOS ao cadastrar um veículo (por combustível/aspiração).
 * São apenas pontos de partida: o usuário deve ajustá-los conforme o manual do veículo.
 */
export function suggestedLimits({ fuelType = 'gasoline', aspiration = 'natural' } = {}) {
  const diesel = fuelType === 'diesel';
  return {
    redlineRpm: diesel ? 4500 : aspiration === 'turbo' ? 6200 : 6500,
    coolantWarn: 105,
    coolantCrit: 112,
    intakeWarn: aspiration === 'turbo' ? 70 : 65,
  };
}

export const SPEED_DISPLAY_MAX = 240;

export const DEFAULT_SETTINGS = Object.freeze({
  driver: { name: 'Jorge' },
  appearance: { theme: 'dark', accent: 'cyan' },
  layout: { orientation: 'auto', navCollapsed: false },
  assistant: {
    enabled: true,
    name: 'Bolt',
    personality: 'imponente',
    level: 'balanced',
    voiceEnabled: true,
    voiceName: '',
    rate: 0.85,
    pitch: 0.15,
    volume: 1,
    micEnabled: true,
    listenMode: 'continuous',
    autoComment: true,
    announceAlerts: true,
  },
  standby: { autoMinutes: 3 },
  ai: {
    backendUrl: '',
    shareVehicleProfile: true,
    shareLiveData: true,
    shareDiagnostics: true,
    shareMaintenance: false,
    shareDriverName: true,
    timeoutMs: 25000,
  },
  obd: {
    preferred: 'ble',
    wifiMode: 'bridge',
    wifiHost: '192.168.0.10',
    wifiPort: 35000,
    bridgeUrl: '',
    bridgeToken: '',
    wsUrl: '',
    autoReconnect: true,
  },
  alerts: { enabled: true, sound: true, voice: true, lowFuelPct: 15, voiceMinLevel: 'attention' },
  maintenance: { warnKm: 1000, warnDays: 30 },
  trips: { autoRecord: true, gps: false, minSpeedStart: 3, stopAfterSeconds: 120 },
  safety: { motionLock: true, lockSpeedKmh: 8 },
  display: { consumptionUnit: 'kml', speedMax: SPEED_DISPLAY_MAX },
});

export const ACCENTS = Object.freeze({
  cyan: { label: 'Ciano', a: '#2EE6D6', b: '#2B7BFF' },
  lime: { label: 'Lima', a: '#9BE564', b: '#2FBF71' },
  blue: { label: 'Azul', a: '#5AA9FF', b: '#3B5BFF' },
  violet: { label: 'Violeta', a: '#B79CFF', b: '#6C5CFF' },
  rose: { label: 'Rosa', a: '#FF8FB1', b: '#E5487F' },
});

export const ALERT_LEVELS = Object.freeze({
  info: { rank: 1, label: 'Informativo' },
  attention: { rank: 2, label: 'Atenção' },
  critical: { rank: 3, label: 'Crítico' },
});

export const MAINTENANCE_TYPES = Object.freeze({
  oil: { label: 'Troca de óleo', icon: 'drop' },
  filters: { label: 'Filtros', icon: 'filter' },
  plugs: { label: 'Velas', icon: 'spark' },
  belts: { label: 'Correias', icon: 'belt' },
  brakes: { label: 'Freios', icon: 'brake' },
  fluids: { label: 'Fluidos', icon: 'drop' },
  revision: { label: 'Revisão', icon: 'revision' },
  custom: { label: 'Serviço personalizado', icon: 'maintenance' },
});
