/**
 * Manutenção: agenda preventiva e histórico de serviços.
 * Nenhum intervalo é inventado: todo intervalo vem do usuário (manual do veículo).
 */
import { MAINTENANCE_TYPES } from './config.js';
import { Emitter } from './events.js';
import { uid, addMonths, daysBetween, isNum, fmtNum, fmtDate } from './utils.js';

/**
 * Avalia um item da agenda.
 * status: 'unconfigured' (sem intervalo) | 'unknown' (sem última execução) | 'ok' | 'soon' | 'overdue'
 */
export function evaluateItem(item, { odometerKm = null, now = Date.now(), warnKm = 1000, warnDays = 30 } = {}) {
  const hasKm = isNum(item.intervalKm) && item.intervalKm > 0;
  const hasMonths = isNum(item.intervalMonths) && item.intervalMonths > 0;
  const base = { id: item.id, name: item.name, type: item.type, critical: !!item.critical, remainingKm: null, remainingDays: null, dueKm: null, dueDate: null, progress: null };
  if (!hasKm && !hasMonths) return { ...base, status: 'unconfigured', detail: 'Informe o intervalo conforme o manual do veículo.' };
  const doneKm = isNum(item.lastDoneKm) ? item.lastDoneKm : null;
  const doneDate = item.lastDoneDate || null;
  if (doneKm == null && !doneDate) return { ...base, status: 'unknown', detail: 'Informe quando o serviço foi feito pela última vez.' };

  const parts = [];
  let overdue = false;
  let soon = false;
  const progress = [];
  if (hasKm && doneKm != null) {
    base.dueKm = doneKm + item.intervalKm;
    if (odometerKm != null) {
      base.remainingKm = base.dueKm - odometerKm;
      progress.push(1 - base.remainingKm / item.intervalKm);
      if (base.remainingKm <= 0) {
        overdue = true;
        parts.push(`vencido há ${fmtNum(-base.remainingKm)} km`);
      } else {
        if (base.remainingKm <= warnKm) soon = true;
        parts.push(`faltam ${fmtNum(base.remainingKm)} km`);
      }
    } else parts.push('quilometragem atual desconhecida');
  }
  if (hasMonths && doneDate) {
    base.dueDate = addMonths(doneDate, item.intervalMonths);
    base.remainingDays = daysBetween(now, base.dueDate);
    const total = daysBetween(doneDate, base.dueDate) || 1;
    progress.push(1 - base.remainingDays / total);
    if (base.remainingDays <= 0) {
      overdue = true;
      parts.push(`vencido em ${fmtDate(base.dueDate)}`);
    } else {
      if (base.remainingDays <= warnDays) soon = true;
      parts.push(`vence em ${fmtDate(base.dueDate)} (${base.remainingDays} dias)`);
    }
  }
  base.progress = progress.length ? Math.min(1.2, Math.max(0, Math.max(...progress))) : null;
  const status = overdue ? 'overdue' : soon ? 'soon' : parts.length ? 'ok' : 'unknown';
  return { ...base, status, detail: parts.join(' · ') || 'Dados insuficientes para calcular.' };
}

/** Nível do ícone de manutenção: ok | attention (laranja) | critical (vermelho). */
export function maintenanceLevel({ items = [], dtcs = [] }) {
  if (dtcs.some((d) => d.status !== 'pending' && d.severity === 'critical')) return 'critical';
  if (items.some((i) => i.status === 'overdue' && i.critical)) return 'critical';
  if (dtcs.length) return 'attention';
  if (items.some((i) => i.status === 'overdue' || i.status === 'soon')) return 'attention';
  return 'ok';
}

export class MaintenanceService extends Emitter {
  /**
   * @param {{db:any, getVehicle:()=>any, getOdometer:()=>(number|null), getSetting:(p:string,d?:any)=>any, now?:()=>number}} deps
   */
  constructor({ db, getVehicle, getOdometer, getSetting, now = () => Date.now() }) {
    super();
    this.db = db;
    this.getVehicle = getVehicle;
    this.getOdometer = getOdometer;
    this.getSetting = getSetting;
    this.now = now;
  }

  #vid() {
    const v = this.getVehicle();
    if (!v) throw new Error('Cadastre um veículo na Garagem primeiro.');
    return v.id;
  }

  async schedule() {
    const vid = this.getVehicle()?.id;
    return (await this.db.where('schedule', (r) => r.vehicleId === vid)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async services() {
    const vid = this.getVehicle()?.id;
    return (await this.db.where('services', (r) => r.vehicleId === vid)).sort((a, b) => (b.date || 0) - (a.date || 0));
  }

  async evaluate() {
    const items = await this.schedule();
    const opts = { odometerKm: this.getOdometer(), now: this.now(), warnKm: this.getSetting('maintenance.warnKm', 1000), warnDays: this.getSetting('maintenance.warnDays', 30) };
    return items.map((i) => ({ ...evaluateItem(i, opts), item: i }));
  }

  static normalizeItem(input, vehicleId, now = Date.now()) {
    const errors = {};
    const name = String(input.name || '').trim() || MAINTENANCE_TYPES[input.type]?.label || '';
    if (!name) errors.name = 'Informe o nome do serviço.';
    const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
    const intervalKm = num(input.intervalKm);
    const intervalMonths = num(input.intervalMonths);
    if (intervalKm != null && intervalKm <= 0) errors.intervalKm = 'Intervalo deve ser maior que zero.';
    if (intervalMonths != null && intervalMonths <= 0) errors.intervalMonths = 'Intervalo deve ser maior que zero.';
    const lastDoneKm = num(input.lastDoneKm);
    if (lastDoneKm != null && lastDoneKm < 0) errors.lastDoneKm = 'Quilometragem inválida.';
    const estCost = num(input.estCost);
    return {
      errors,
      item: {
        id: input.id || uid('sch'),
        vehicleId,
        type: MAINTENANCE_TYPES[input.type] ? input.type : 'custom',
        name,
        intervalKm,
        intervalMonths,
        lastDoneKm,
        lastDoneDate: input.lastDoneDate || null,
        critical: !!input.critical,
        responsible: String(input.responsible || '').trim(),
        estCost,
        notes: String(input.notes || '').trim(),
        createdAt: input.createdAt || now,
        updatedAt: now,
      },
    };
  }

  async saveItem(input) {
    const { item, errors } = MaintenanceService.normalizeItem(input, this.#vid(), this.now());
    if (Object.keys(errors).length) throw Object.assign(new Error('Cadastro inválido'), { errors });
    await this.db.put('schedule', item);
    this.emit('change');
    return item;
  }

  async removeItem(id) {
    await this.db.delete('schedule', id);
    this.emit('change');
  }

  /** Registra serviço realizado; se ligado a um item da agenda, atualiza a última execução. */
  async addService(input) {
    const vid = this.#vid();
    const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
    const errors = {};
    const date = input.date ? Number(input.date) : this.now();
    if (!Number.isFinite(date)) errors.date = 'Data inválida.';
    const km = num(input.km);
    if (km != null && km < 0) errors.km = 'Quilometragem inválida.';
    const name = String(input.name || '').trim() || MAINTENANCE_TYPES[input.type]?.label || '';
    if (!name) errors.name = 'Informe o serviço.';
    if (Object.keys(errors).length) throw Object.assign(new Error('Cadastro inválido'), { errors });
    const rec = {
      id: input.id || uid('svc'),
      vehicleId: vid,
      scheduleId: input.scheduleId || null,
      type: MAINTENANCE_TYPES[input.type] ? input.type : 'custom',
      name,
      date,
      km,
      cost: num(input.cost),
      responsible: String(input.responsible || '').trim(),
      notes: String(input.notes || '').trim(),
      createdAt: input.createdAt || this.now(),
      updatedAt: this.now(),
    };
    await this.db.put('services', rec);
    if (rec.scheduleId) {
      const it = await this.db.get('schedule', rec.scheduleId);
      if (it) {
        it.lastDoneDate = rec.date;
        if (rec.km != null) it.lastDoneKm = rec.km;
        it.updatedAt = this.now();
        await this.db.put('schedule', it);
      }
    }
    this.emit('change');
    return rec;
  }

  async removeService(id) {
    await this.db.delete('services', id);
    this.emit('change');
  }
}
