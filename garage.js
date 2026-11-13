/**
 * Garagem: cadastro de vários veículos. Identificação técnica (tech) e aparência (appearance)
 * são estruturas separadas. Arquivar preserva todo o histórico; excluir é definitivo.
 */
import { FUEL_TYPES, ASPIRATIONS, TRANSMISSIONS, suggestedLimits } from './config.js';
import { SILHOUETTE_IDS } from './silhouettes.js';
import { Emitter } from './events.js';
import { uid, isNum } from './utils.js';

export function blankVehicle() {
  return {
    nickname: '',
    tech: {
      make: '',
      model: '',
      year: new Date().getFullYear(),
      version: '',
      displacementL: null,
      cylinders: null,
      fuelType: 'flex',
      aspiration: 'natural',
      transmission: 'manual',
      tankL: null,
      redlineRpm: null,
      systemVoltage: 12,
      vin: '',
      plate: '',
      odometerKm: null,
      odometerAt: null,
      afrOverride: null,
      limits: { coolantWarn: null, coolantCrit: null, intakeWarn: null },
    },
    appearance: { silhouette: 'hatch', color: '#2EE6D6' },
    notes: '',
  };
}

const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** Valida e normaliza um cadastro. Retorna { vehicle, errors } (errors vazio = ok). */
export function normalizeVehicle(input, now = Date.now()) {
  const errors = {};
  const b = blankVehicle();
  const t = { ...b.tech, ...(input.tech || {}) };
  const a = { ...b.appearance, ...(input.appearance || {}) };
  const make = String(t.make || '').trim();
  const model = String(t.model || '').trim();
  if (!make) errors.make = 'Informe a marca.';
  if (!model) errors.model = 'Informe o modelo.';
  const year = numOrNull(t.year);
  if (year == null || year < 1950 || year > new Date(now).getFullYear() + 1) errors.year = 'Ano inválido.';
  const disp = numOrNull(t.displacementL);
  if (disp != null && (disp < 0.2 || disp > 12)) errors.displacementL = 'Cilindrada deve estar entre 0,2 e 12 L.';
  const cyl = numOrNull(t.cylinders);
  if (cyl != null && (cyl < 1 || cyl > 16 || !Number.isInteger(cyl))) errors.cylinders = 'Número de cilindros inválido.';
  const tank = numOrNull(t.tankL);
  if (tank != null && (tank < 5 || tank > 400)) errors.tankL = 'Tanque deve estar entre 5 e 400 L.';
  const redline = numOrNull(t.redlineRpm);
  if (redline != null && (redline < 2000 || redline > 14000)) errors.redlineRpm = 'Faixa vermelha entre 2000 e 14000 rpm.';
  const odo = numOrNull(t.odometerKm);
  if (odo != null && odo < 0) errors.odometerKm = 'Quilometragem não pode ser negativa.';
  if (!FUEL_TYPES[t.fuelType]) errors.fuelType = 'Combustível inválido.';
  if (!ASPIRATIONS[t.aspiration]) t.aspiration = 'natural';
  if (!TRANSMISSIONS[t.transmission]) t.transmission = 'manual';
  const sv = Number(t.systemVoltage) === 24 ? 24 : 12;
  const vin = String(t.vin || '').trim().toUpperCase();
  if (vin && !/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) errors.vin = 'VIN inválido (11 a 17 caracteres, sem I, O, Q).';
  if (!SILHOUETTE_IDS.includes(a.silhouette)) a.silhouette = 'hatch';
  if (!/^#[0-9a-fA-F]{6}$/.test(a.color || '')) a.color = b.appearance.color;
  const lim = t.limits || {};
  const limits = { coolantWarn: numOrNull(lim.coolantWarn), coolantCrit: numOrNull(lim.coolantCrit), intakeWarn: numOrNull(lim.intakeWarn) };
  if (limits.coolantWarn != null && limits.coolantCrit != null && limits.coolantCrit <= limits.coolantWarn) {
    errors.coolantCrit = 'O limite crítico deve ser maior que o de atenção.';
  }
  const vehicle = {
    ...input,
    id: input.id || uid('veh'),
    nickname: String(input.nickname || '').trim() || `${make} ${model}`.trim(),
    tech: {
      make,
      model,
      year,
      version: String(t.version || '').trim(),
      displacementL: disp,
      cylinders: cyl,
      fuelType: t.fuelType,
      aspiration: t.aspiration,
      transmission: t.transmission,
      tankL: tank,
      redlineRpm: redline,
      systemVoltage: sv,
      vin,
      plate: String(t.plate || '').trim().toUpperCase(),
      odometerKm: odo,
      odometerAt: odo != null ? t.odometerAt || now : null,
      afrOverride: numOrNull(t.afrOverride),
      limits,
    },
    appearance: { silhouette: a.silhouette, color: a.color },
    notes: String(input.notes || '').trim(),
    archived: !!input.archived,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
  return { vehicle, errors };
}

/** Odômetro estimado = odômetro informado + distância de viagens REAIS posteriores. */
export function currentOdometer(vehicle, trips = []) {
  const base = vehicle?.tech?.odometerKm;
  if (!isNum(base)) return null;
  const since = vehicle.tech.odometerAt || 0;
  const extra = trips
    .filter((t) => t.vehicleId === vehicle.id && t.origin === 'obd' && !t.inProgress && (t.endedAt || 0) > since)
    .reduce((s, t) => s + (t.distanceKm || 0), 0);
  return base + extra;
}

export function describeVehicle(v) {
  if (!v) return '';
  const t = v.tech;
  return [t.make, t.model, t.year].filter(Boolean).join(' ');
}

export function engineSummary(v) {
  const t = v?.tech || {};
  const parts = [];
  if (t.displacementL) parts.push(`${String(t.displacementL).replace('.', ',')} L`);
  if (t.cylinders) parts.push(`${t.cylinders} cil.`);
  if (t.aspiration === 'turbo') parts.push('Turbo');
  if (t.fuelType) parts.push(FUEL_TYPES[t.fuelType]?.label || t.fuelType);
  return parts.join(' · ') || 'Motorização não informada';
}

export class Garage extends Emitter {
  constructor({ db }) {
    super();
    this.db = db;
    this.vehicles = [];
    this.activeId = null;
  }

  async load() {
    this.vehicles = (await this.db.all('vehicles')).sort((a, b) => a.createdAt - b.createdAt);
    const row = await this.db.get('settings', 'activeVehicle');
    this.activeId = row?.value ?? null;
    if (!this.active() || this.active().archived) {
      this.activeId = this.list()[0]?.id ?? null;
      await this.#persistActive();
    }
    this.emit('change');
    return this.vehicles;
  }

  list({ includeArchived = false } = {}) {
    return this.vehicles.filter((v) => includeArchived || !v.archived);
  }

  get(id) {
    return this.vehicles.find((v) => v.id === id) || null;
  }

  active() {
    return this.get(this.activeId);
  }

  async #persistActive() {
    await this.db.put('settings', { key: 'activeVehicle', value: this.activeId, updatedAt: Date.now() });
  }

  /** Cria ou atualiza. Lança Error com .errors quando inválido. */
  async save(input) {
    const { vehicle, errors } = normalizeVehicle(input);
    if (Object.keys(errors).length) {
      const err = new Error('Cadastro inválido');
      err.errors = errors;
      throw err;
    }
    await this.db.put('vehicles', vehicle);
    const i = this.vehicles.findIndex((v) => v.id === vehicle.id);
    if (i >= 0) this.vehicles[i] = vehicle;
    else this.vehicles.push(vehicle);
    if (!this.activeId || !this.active() || this.active().archived) {
      this.activeId = vehicle.id;
      await this.#persistActive();
    }
    this.emit('change');
    return vehicle;
  }

  async setActive(id) {
    if (!this.get(id)) throw new Error('Veículo não encontrado');
    this.activeId = id;
    await this.#persistActive();
    this.emit('active', this.active());
    this.emit('change');
  }

  async setArchived(id, archived) {
    const v = this.get(id);
    if (!v) return;
    v.archived = !!archived;
    v.updatedAt = Date.now();
    await this.db.put('vehicles', v);
    if (archived && this.activeId === id) {
      this.activeId = this.list()[0]?.id ?? null;
      await this.#persistActive();
      this.emit('active', this.active());
    }
    this.emit('change');
  }

  async updateOdometer(id, km) {
    const v = this.get(id);
    if (!v) return;
    const n = Number(km);
    if (!Number.isFinite(n) || n < 0) throw new Error('Quilometragem inválida');
    v.tech.odometerKm = n;
    v.tech.odometerAt = Date.now();
    v.updatedAt = Date.now();
    await this.db.put('vehicles', v);
    this.emit('change');
  }

  /** Exclusão definitiva do veículo e de todo o seu histórico local. */
  async remove(id) {
    for (const store of ['trips', 'services', 'schedule', 'dtcHistory', 'alerts']) {
      const rows = await this.db.where(store, (r) => r.vehicleId === id);
      for (const r of rows) await this.db.delete(store, r.id);
    }
    await this.db.delete('vehicles', id);
    this.vehicles = this.vehicles.filter((v) => v.id !== id);
    if (this.activeId === id) {
      this.activeId = this.list()[0]?.id ?? null;
      await this.#persistActive();
      this.emit('active', this.active());
    }
    this.emit('change');
  }

  suggestedLimitsFor(tech) {
    return suggestedLimits(tech);
  }
}
