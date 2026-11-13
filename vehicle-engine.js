/**
 * Vehicle Data Engine — contrato único de dados.
 * Cada parâmetro tem: valor, unidade, horário, origem e estado de validade.
 * Dados reais (OBD2) e simulados NUNCA se misturam: só a origem ativa é aceita.
 */
import { PARAMS, PARAM_IDS, FUEL_TYPES } from './config.js';
import { Emitter } from './events.js';
import { isNum } from './utils.js';

export const SOURCES = Object.freeze(['none', 'obd', 'simulation']);
export const Validity = Object.freeze({
  VALID: 'valid',
  STALE: 'stale',
  INVALID: 'invalid',
  UNSUPPORTED: 'unsupported',
  UNAVAILABLE: 'unavailable',
});

/**
 * Estimativa de vazão de combustível (L/h). Sempre devolve o método usado.
 * - fuelRate (PID 5E): medido pela ECU.
 * - maf: estimado por MAF / razão ar-combustível de referência.
 * - load: estimado pela carga calculada (SAE J1979) e cilindrada:
 *   ar[g/s] = carga% × 1,184 g/L × cilindrada[L] × rpm / 120. Aproximação.
 * Diesel/GNV: sem estimativa por carga (mistura pobre / unidade diferente).
 */
export function estimateFuelFlow({ loadPct, rpm, maf, fuelRate, vehicle }) {
  const tech = vehicle?.tech || {};
  const fuel = FUEL_TYPES[tech.fuelType] || null;
  if (isNum(fuelRate)) return { flowLph: fuelRate, method: 'fuelRate', estimated: false };
  const afr = isNum(tech.afrOverride) ? tech.afrOverride : fuel?.afr;
  const density = fuel?.density;
  if (!isNum(afr) || !isNum(density)) return { flowLph: null, method: null, estimated: true };
  let airGs = null;
  let method = null;
  if (isNum(maf)) {
    airGs = maf;
    method = 'maf';
  } else if (isNum(loadPct) && isNum(rpm) && isNum(tech.displacementL) && tech.displacementL > 0) {
    airGs = (loadPct / 100) * 1.184 * tech.displacementL * (rpm / 120);
    method = 'load';
  }
  if (airGs == null) return { flowLph: null, method: null, estimated: true };
  const fuelGs = airGs / afr;
  const flowLph = ((fuelGs / (density * 1000)) * 3600) / 1; // g/s -> L/h
  return { flowLph: Math.max(0, flowLph), method, estimated: true };
}

export class VehicleDataEngine extends Emitter {
  constructor({ now = () => Date.now() } = {}) {
    super();
    this.now = now;
    this.source = 'none';
    this.vehicle = null;
    this.records = new Map();
    this.unsupported = new Set();
    this._prevValidity = new Map();
  }

  setVehicle(vehicle) {
    this.vehicle = vehicle || null;
    this.emit('vehicle', this.vehicle);
  }

  setSource(source) {
    if (!SOURCES.includes(source)) throw new Error(`Origem inválida: ${source}`);
    if (source === this.source) return;
    this.source = source;
    this.reset();
    this.emit('source', source);
  }

  reset() {
    this.records.clear();
    this.unsupported.clear();
    this._prevValidity.clear();
    this.emit('reset');
  }

  /** Recebe leituras de uma origem. Origens diferentes da ativa são descartadas. */
  ingest(source, readings, ts = this.now()) {
    if (source !== this.source) return false;
    const changed = [];
    for (const [id, raw] of Object.entries(readings || {})) {
      const def = PARAMS[id];
      if (!def) continue;
      let validity = Validity.VALID;
      let value = raw;
      if (!isNum(value)) {
        validity = Validity.INVALID;
        value = null;
      } else if (value < def.min || value > def.max) {
        validity = Validity.INVALID;
      }
      this.records.set(id, { id, value, unit: def.unit, ts, source, validity });
      this.unsupported.delete(id);
      changed.push(id);
    }
    if (changed.length) this.emit('update', changed);
    return true;
  }

  markUnsupported(source, ids) {
    if (source !== this.source) return;
    for (const id of ids) {
      if (!PARAMS[id]) continue;
      this.unsupported.add(id);
      this.records.delete(id);
    }
    this.emit('support', [...this.unsupported]);
  }

  markSupported(source, ids) {
    if (source !== this.source) return;
    for (const id of ids) this.unsupported.delete(id);
    this.emit('support', [...this.unsupported]);
  }

  /** Registro completo com validade calculada no momento da leitura. */
  get(id) {
    const def = PARAMS[id];
    if (!def) return null;
    const rec = this.records.get(id);
    const base = { id, label: def.label, unit: def.unit, decimals: def.decimals, source: this.source };
    if (!rec) {
      return { ...base, value: null, ts: null, ageMs: null, validity: this.unsupported.has(id) ? Validity.UNSUPPORTED : Validity.UNAVAILABLE };
    }
    const ageMs = this.now() - rec.ts;
    let validity = rec.validity;
    if (validity === Validity.VALID && ageMs > def.staleMs) validity = Validity.STALE;
    return { ...base, value: rec.value, ts: rec.ts, ageMs, validity, source: rec.source };
  }

  /** Valor numérico somente se válido e atual; caso contrário null. Use em regras de segurança. */
  value(id) {
    const r = this.get(id);
    return r && r.validity === Validity.VALID ? r.value : null;
  }

  snapshot() {
    const params = {};
    for (const id of PARAM_IDS) params[id] = this.get(id);
    return { source: this.source, ts: this.now(), params };
  }

  fuel() {
    const est = estimateFuelFlow({
      loadPct: this.value('engineLoad'),
      rpm: this.value('rpm'),
      maf: this.value('maf'),
      fuelRate: this.value('fuelRate'),
      vehicle: this.vehicle,
    });
    const speed = this.value('speed');
    const kmL = isNum(est.flowLph) && est.flowLph > 0 && isNum(speed) && speed >= 5 ? speed / est.flowLph : null;
    return { ...est, speed, instantKmL: kmL, instantL100: kmL ? 100 / kmL : null };
  }

  /** Reavalia validade (chame ~1x/s). Emite "validity" quando algo muda. */
  tick() {
    const changes = [];
    for (const id of PARAM_IDS) {
      const v = this.get(id).validity;
      if (this._prevValidity.get(id) !== v) {
        if (this._prevValidity.has(id)) changes.push({ id, validity: v });
        this._prevValidity.set(id, v);
      }
    }
    if (changes.length) this.emit('validity', changes);
    return changes;
  }

  /** O motor está ligado? true/false, ou null se a rotação não é confiável. */
  engineRunning() {
    const rpm = this.value('rpm');
    return rpm == null ? null : rpm > 300;
  }
}
