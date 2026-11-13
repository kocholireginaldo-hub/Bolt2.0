/**
 * Motor de alertas LOCAL — independente da IA, da internet e do assistente.
 * Limites vêm do perfil do veículo (nada universal é imposto); dados inválidos ou
 * desatualizados nunca disparam regras de valor, apenas o alerta de "dados desatualizados".
 */
import { suggestedLimits, PARAMS, ALERT_LEVELS } from './config.js';
import { Emitter } from './events.js';

export function resolveLimits(vehicle) {
  const tech = vehicle?.tech || {};
  const base = suggestedLimits(tech);
  return {
    ...base,
    ...Object.fromEntries(Object.entries(tech.limits || {}).filter(([, v]) => v != null && Number.isFinite(Number(v)))),
    redlineRpm: tech.redlineRpm || tech.limits?.redlineRpm || base.redlineRpm,
    voltageScale: Number(tech.systemVoltage) === 24 ? 2 : 1,
  };
}

const rank = (l) => ALERT_LEVELS[l]?.rank ?? 0;

export class AlertEngine extends Emitter {
  /**
   * @param {{engine:any, getVehicle:()=>any, getSetting?:(p:string,d?:any)=>any, now?:()=>number}} deps
   */
  constructor({ engine, getVehicle, getSetting = (p, d) => d, now = () => Date.now() }) {
    super();
    this.engine = engine;
    this.getVehicle = getVehicle;
    this.getSetting = getSetting;
    this.now = now;
    this.active = new Map(); // key -> alert
    this.track = new Map(); // key -> {since, lastSeen, cand}
    this.ctx = { obd: null, simLinkUp: true, dtc: [], mil: null, maintenance: [], internet: true };
  }

  /** Contexto externo (OBD, DTCs, manutenção, internet). */
  setContext(patch) {
    Object.assign(this.ctx, patch);
  }

  list() {
    return [...this.active.values()].sort((a, b) => rank(b.level) - rank(a.level) || b.ts - a.ts);
  }

  highestLevel() {
    return this.list().reduce((m, a) => (rank(a.level) > rank(m) ? a.level : m), null);
  }

  acknowledge(key) {
    const a = this.active.get(key);
    if (a) {
      a.acknowledged = true;
      this.emit('changed', this.list());
    }
  }

  /** Avalia todas as regras e aplica histerese (tempo de confirmação/limpeza). */
  evaluate() {
    const t = this.now();
    const cands = this.#candidates();
    const seen = new Set();
    for (const c of cands) {
      seen.add(c.key);
      let tr = this.track.get(c.key);
      if (!tr) this.track.set(c.key, (tr = { since: t, lastSeen: t, cand: c }));
      tr.lastSeen = t;
      tr.cand = c;
      const held = t - tr.since >= (c.holdMs ?? 1500);
      const cur = this.active.get(c.key);
      if (!cur && held) this.#raise(c, t);
      else if (cur && (cur.level !== c.level || cur.message !== c.message)) {
        const escalated = rank(c.level) > rank(cur.level);
        cur.message = c.message;
        cur.value = c.value;
        if (escalated || held) {
          const prev = cur.level;
          cur.level = c.level;
          cur.title = c.title;
          if (escalated && prev !== c.level) cur.acknowledged = false;
          this.emit('changed', this.list());
          if (escalated) this.emit('raised', cur);
        }
      }
    }
    for (const [key, tr] of [...this.track]) {
      if (seen.has(key)) continue;
      const clearMs = tr.cand.clearMs ?? 3000;
      if (!this.active.has(key)) {
        this.track.delete(key);
        continue;
      }
      if (t - tr.lastSeen >= clearMs) {
        const a = this.active.get(key);
        this.active.delete(key);
        this.track.delete(key);
        a.clearedAt = t;
        this.emit('cleared', a);
        this.emit('changed', this.list());
      }
    }
    return this.list();
  }

  #raise(c, t) {
    const alert = {
      id: `${c.key}@${t}`,
      key: c.key,
      level: c.level,
      title: c.title,
      message: c.message,
      paramId: c.paramId ?? null,
      value: c.value ?? null,
      ts: t,
      acknowledged: false,
      simulated: this.engine.source === 'simulation',
      vehicleId: this.getVehicle()?.id ?? null,
    };
    this.active.set(c.key, alert);
    this.emit('raised', alert);
    this.emit('changed', this.list());
  }

  #candidates() {
    const out = [];
    const e = this.engine;
    const veh = this.getVehicle();
    const lim = resolveLimits(veh);
    const k = lim.voltageScale;
    const add = (c) => out.push(c);
    const fmt = (id, v) => `${Number(v.toFixed(PARAMS[id].decimals))} ${PARAMS[id].unit}`;

    if (e.source !== 'none') {
      const coolant = e.value('coolantTemp');
      if (coolant != null && coolant >= lim.coolantWarn) {
        const crit = coolant >= lim.coolantCrit;
        add({ key: 'coolant', level: crit ? 'critical' : 'attention', title: crit ? 'Superaquecimento do motor' : 'Temperatura do motor elevada', message: `Líquido de arrefecimento em ${fmt('coolantTemp', coolant)} (limite deste veículo: atenção ${lim.coolantWarn} °C, crítico ${lim.coolantCrit} °C).`, paramId: 'coolantTemp', value: coolant, holdMs: 1500 });
      }
      const rpm = e.value('rpm');
      if (rpm != null && rpm >= lim.redlineRpm) {
        const crit = rpm >= lim.redlineRpm * 1.05;
        add({ key: 'rpm', level: crit ? 'critical' : 'attention', title: 'Rotação acima da faixa vermelha', message: `Rotação em ${fmt('rpm', rpm)} (faixa vermelha configurada: ${lim.redlineRpm} rpm).`, paramId: 'rpm', value: rpm, holdMs: 800, clearMs: 1500 });
      }
      const volt = e.value('batteryVoltage');
      if (volt != null) {
        const running = e.engineRunning();
        let level = null;
        let title = '';
        if (running === true) {
          if (volt < 12.0 * k) [level, title] = ['critical', 'Carga elétrica muito baixa'];
          else if (volt < 13.0 * k) [level, title] = ['attention', 'Alternador com carga baixa'];
          else if (volt > 15.8 * k) [level, title] = ['critical', 'Tensão de carga excessiva'];
          else if (volt > 15.0 * k) [level, title] = ['attention', 'Tensão de carga alta'];
        } else if (running === false) {
          if (volt < 11.5 * k) [level, title] = ['critical', 'Bateria muito descarregada'];
          else if (volt < 12.0 * k) [level, title] = ['attention', 'Bateria com tensão baixa'];
        } else if (volt < 10.5 * k) [level, title] = ['critical', 'Tensão do sistema muito baixa'];
        if (level) add({ key: 'battery', level, title, message: `Tensão em ${fmt('batteryVoltage', volt)} (sistema de ${12 * k} V).`, paramId: 'batteryVoltage', value: volt, holdMs: 3000 });
      }
      const iat = e.value('intakeTemp');
      if (iat != null && iat >= lim.intakeWarn) {
        add({ key: 'intake', level: 'attention', title: 'Ar de admissão quente', message: `Temperatura do ar de admissão em ${fmt('intakeTemp', iat)} (limite configurado: ${lim.intakeWarn} °C).`, paramId: 'intakeTemp', value: iat, holdMs: 5000 });
      }
      const fuel = e.value('fuelLevel');
      const low = Number(this.getSetting('alerts.lowFuelPct', 15));
      if (fuel != null && fuel <= low) {
        add({ key: 'fuel', level: fuel <= low / 2 ? 'critical' : 'attention', title: 'Combustível baixo', message: `Nível de combustível em ${fmt('fuelLevel', fuel)} (aviso configurado em ${low}%).`, paramId: 'fuelLevel', value: fuel, holdMs: 5000 });
      }
      const load = e.value('engineLoad');
      if (load != null && load >= 95) {
        add({ key: 'load', level: 'info', title: 'Carga do motor muito alta', message: `Carga do motor em ${fmt('engineLoad', load)} por tempo prolongado.`, paramId: 'engineLoad', value: load, holdMs: 20000, clearMs: 4000 });
      }
      const stale = [];
      const invalid = [];
      for (const [id, d] of Object.entries(PARAMS)) {
        if (!d.core) continue;
        const r = e.get(id);
        if (r.validity === 'stale') stale.push(d.label);
        if (r.validity === 'invalid') invalid.push(d.label);
      }
      if (stale.length) add({ key: 'stale', level: 'attention', title: 'Dados desatualizados', message: `Sem atualização recente: ${stale.join(', ')}. Valores exibidos podem não refletir o veículo.`, holdMs: 1500, clearMs: 2000 });
      if (invalid.length) add({ key: 'invalid', level: 'attention', title: 'Leitura inválida', message: `Valor fora da faixa válida: ${invalid.join(', ')}.`, holdMs: 1500 });
    }

    const o = this.ctx.obd;
    if (e.source === 'obd' && o) {
      if (o.state === 'reconnecting') add({ key: 'obd-link', level: 'attention', title: 'Reconectando ao OBD2', message: `Conexão com o adaptador perdida; tentativa ${o.reconnectAttempt}.`, holdMs: 0, clearMs: 500 });
      else if (o.state === 'error') add({ key: 'obd-link', level: 'attention', title: 'OBD2 desconectado', message: o.lastError || 'Conexão com o adaptador encerrada.', holdMs: 0, clearMs: 500 });
    }
    if (e.source === 'simulation' && this.ctx.simLinkUp === false) {
      add({ key: 'obd-link', level: 'attention', title: 'Enlace OBD2 interrompido (simulação)', message: 'O enlace OBD2 simulado caiu; os dados ficarão desatualizados até o retorno.', holdMs: 0, clearMs: 500 });
    }

    for (const d of this.ctx.dtc || []) {
      const level = d.status === 'pending' ? 'info' : d.severity === 'critical' ? 'critical' : 'attention';
      add({ key: `dtc:${d.code}`, level, title: `${d.status === 'pending' ? 'Código pendente' : 'Falha registrada'} ${d.code}`, message: d.description || 'Código sem descrição na base local; consulte o manual do veículo.', holdMs: 0, clearMs: 500 });
    }
    for (const m of this.ctx.maintenance || []) {
      if (m.status === 'overdue') add({ key: `maint:${m.id}`, level: m.critical ? 'critical' : 'attention', title: `Manutenção vencida: ${m.name}`, message: m.detail || 'Serviço preventivo vencido.', holdMs: 0, clearMs: 500 });
      else if (m.status === 'soon') add({ key: `maint:${m.id}`, level: 'info', title: `Manutenção próxima: ${m.name}`, message: m.detail || 'Serviço preventivo se aproximando.', holdMs: 0, clearMs: 500 });
    }
    if (this.ctx.internet === false) {
      add({ key: 'internet', level: 'info', title: 'Sem internet', message: 'O monitoramento e os alertas locais continuam ativos; o assistente usa respostas locais.', holdMs: 0, clearMs: 500 });
    }
    return out;
  }
}
