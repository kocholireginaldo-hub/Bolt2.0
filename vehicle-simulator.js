/**
 * Laboratório: simulador de veículo com física simplificada, porém coerente.
 * Usa EXATAMENTE o mesmo contrato de dados do OBD2 real (ids de PARAMS) e a mesma interface
 * de diagnóstico (readDtcs, readFreezeFrame, clearDtcs, capabilities...). Sempre rotulado SIMULAÇÃO.
 */
import { PARAMS, FUEL_TYPES, suggestedLimits } from './config.js';
import { Emitter } from './events.js';
import { clamp, lerp, mulberry32 } from './utils.js';
import { ObdError } from './obd-protocol.js';

export const SCENARIOS = Object.freeze({
  normal: { label: 'Funcionamento normal', description: 'Partida, marcha lenta e cruzeiro a 50 km/h.' },
  urban: { label: 'Trânsito urbano', description: 'Arranca e para repetidamente.' },
  highway: { label: 'Estrada', description: 'Acelera até 110 km/h e mantém.' },
  acceleration: { label: 'Aceleração', description: 'Acelerador a fundo até 100 km/h.' },
  braking: { label: 'Frenagem', description: 'Chega a 90 km/h e freia forte até parar.' },
  overheat: { label: 'Superaquecimento', description: 'Falha no arrefecimento: temperatura sobe sem parar.' },
  lowBattery: { label: 'Bateria baixa', description: 'Falha do alternador: tensão cai gradualmente.' },
  injectionFault: { label: 'Falha de injeção', description: 'Falha de combustão no cilindro 1 e códigos DTC.' },
  connectionLoss: { label: 'Perda de conexão', description: 'O enlace OBD2 cai por 15 s e retorna.' },
});

const GEARS = [3.6, 2.05, 1.4, 1.05, 0.84];
const FINAL = 3.9;
const WHEEL_R = 0.3;
const G = 9.81;

const SUPPORTED_DEFAULT = ['04', '05', '0C', '0D', '0F', '2F', '42'];

export class VehicleSimulator extends Emitter {
  /**
   * @param {{seed?:number, now?:()=>number, tickMs?:number}} opts
   */
  constructor({ seed = 1234, now = () => Date.now(), tickMs = 100 } = {}) {
    super();
    this.now = now;
    this.tickMs = tickMs;
    this.rand = mulberry32(seed);
    this.timer = null;
    this.running = false;
    this.vehicle = null;
    this.scenarioName = null;
    this.scenarioT = 0;
    this.supported = new Set(SUPPORTED_DEFAULT);
    this.linkUp = true;
    this.internetUp = true;
    this.#reset();
  }

  #reset() {
    this.s = {
      ignition: 'off', // off | cranking | on
      crankT: 0,
      throttle: 0,
      brake: 0,
      speed: 0, // km/h
      rpm: 0,
      gear: 1,
      coolant: this.ambient ?? 25,
      intake: this.ambient ?? 25,
      load: 0,
      battery: 12.55,
      fuelL: 0,
      distanceKm: 0,
      ambient: this.ambient ?? 25,
    };
    this.faults = { overheat: false, alternator: false, misfire: false };
    this.dtcs = new Map(); // code -> {status, since, forced?}
    this.freeze = null;
    this.permanent = new Set();
    this.misfireT = 0;
    this.pendingReturn = [];
    this.linkDownUntil = 0;
    this.lastFuelLph = 0;
  }

  get ambient() {
    return this.s?.ambient;
  }

  /* ----------------------------- ciclo de vida ----------------------------- */

  start(vehicle) {
    this.stop();
    this.vehicle = vehicle || { tech: { displacementL: 1.0, fuelType: 'gasoline', aspiration: 'natural', tankL: 50 } };
    const tech = this.vehicle.tech || {};
    const lim = { ...suggestedLimits(tech), ...(tech.limits || {}) };
    this.model = {
      disp: tech.displacementL || 1.0,
      tank: tech.tankL || 50,
      redline: tech.redlineRpm || lim.redlineRpm,
      idle: 800,
      mass: tech.massKg || 1250,
      tmax: (tech.aspiration === 'turbo' ? 150 : 100) * (tech.displacementL || 1.0),
      fuel: FUEL_TYPES[tech.fuelType] || FUEL_TYPES.gasoline,
    };
    const keepAmbient = this.s.ambient;
    const keepFuelPct = this.fuelPctDesired ?? 70;
    this.#reset();
    this.s.ambient = keepAmbient;
    this.s.coolant = keepAmbient;
    this.s.intake = keepAmbient;
    this.s.fuelL = (this.model.tank * keepFuelPct) / 100;
    this.running = true;
    this.lastTs = this.now();
    this.timer = setInterval(() => this.#loop(), this.tickMs);
    this.emit('started');
    this.emit('support', this.supportedList());
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const was = this.running;
    this.running = false;
    this.scenarioName = null;
    if (was) this.emit('stopped');
  }

  #loop() {
    const t = this.now();
    const dt = clamp((t - this.lastTs) / 1000, 0, 0.5);
    this.lastTs = t;
    this.step(dt);
    this.#emitReadings();
  }

  /* ----------------------------- controles ----------------------------- */

  get fuelPct() {
    return this.model ? (this.s.fuelL / this.model.tank) * 100 : null;
  }
  setFuelPct(p) {
    if (this.model) this.s.fuelL = (this.model.tank * clamp(p, 0, 100)) / 100;
    this.fuelPctDesired = p;
  }
  setAmbient(c) {
    this.s.ambient = clamp(c, -20, 50);
  }
  setIgnition(on) {
    if (!this.running) return;
    if (on && this.s.ignition === 'off') {
      this.s.ignition = 'cranking';
      this.s.crankT = 0;
    } else if (!on) {
      this.s.ignition = 'off';
      this.s.throttle = 0;
    }
    this.emit('ignition', this.s.ignition);
  }
  setThrottle(v) {
    this.s.throttle = clamp(v, 0, 1);
  }
  setBrake(v) {
    this.s.brake = clamp(v, 0, 1);
  }
  setLink(up) {
    this.linkUp = !!up;
    this.emit('link', this.linkUp);
  }
  setInternet(up) {
    this.internetUp = !!up;
    this.emit('internet', this.internetUp);
  }
  setPidSupported(pid, on) {
    const key = pid.toUpperCase();
    if (on) this.supported.add(key);
    else this.supported.delete(key);
    this.emit('support', this.supportedList());
  }
  supportedList() {
    return { supported: [...this.supported], unsupported: Object.entries(PARAMS).filter(([, d]) => !this.supported.has(d.pid)).map(([id]) => id) };
  }

  injectDtc(code, status = 'confirmed') {
    const t = this.now();
    this.dtcs.set(code, { status, since: t, forced: true });
    if (status === 'confirmed' && !this.freeze) this.#captureFreeze(code);
    this.emit('dtc', this.#dtcSnapshot());
  }

  #captureFreeze(code) {
    this.freeze = { dtc: code, params: this.#freezeParams() };
  }
  #freezeParams() {
    return {
      engineLoad: { value: Math.round(this.s.load), unit: '%' },
      coolantTemp: { value: Math.round(this.s.coolant), unit: '°C' },
      rpm: { value: Math.round(this.s.rpm), unit: 'rpm' },
      speed: { value: Math.round(this.s.speed), unit: 'km/h' },
      intakeTemp: { value: Math.round(this.s.intake), unit: '°C' },
    };
  }

  setScenario(name) {
    if (!SCENARIOS[name]) throw new Error(`Cenário desconhecido: ${name}`);
    this.scenarioName = name;
    this.scenarioT = 0;
    this._ci = 0;
    this._braked = false;
    this.faults = { overheat: false, alternator: false, misfire: false };
    this.s.brake = 0;
    if (name === 'overheat') this.faults.overheat = true;
    if (name === 'lowBattery') {
      this.faults.alternator = true;
      this.s.battery = Math.min(this.s.battery, 12.3);
    }
    if (name === 'injectionFault') {
      this.faults.misfire = true;
      this.misfireT = 0;
    }
    if (name === 'connectionLoss') this.linkDownUntil = this.now() + 15000;
    if (this.s.ignition === 'off') this.setIgnition(true);
    this.emit('scenario', name);
  }

  clearScenario() {
    this.scenarioName = null;
    this.faults = { overheat: false, alternator: false, misfire: false };
    this.setThrottle(0);
    this.setBrake(0);
    this.emit('scenario', null);
  }

  /* ----------------------------- física ----------------------------- */

  /** Avança a simulação por dt segundos (determinístico dado o seed). */
  step(dt) {
    const s = this.s;
    const m = this.model;
    if (!m) return;
    this.#runScenario(dt);

    // Ignição / partida
    if (s.ignition === 'cranking') {
      s.crankT += dt;
      s.rpm = lerp(s.rpm, 220, clamp(dt * 8, 0, 1));
      s.battery = 10.3 + this.rand() * 0.2;
      if (s.crankT >= 0.9) {
        s.ignition = 'on';
        s.rpm = 900;
        this.emit('ignition', 'on');
      }
    }
    const engineOn = s.ignition === 'on';

    // Combustível acabou => motor morre
    if (engineOn && s.fuelL <= 0.001) {
      s.ignition = 'off';
      this.emit('ignition', 'off');
    }

    // Marchas automáticas
    if (engineOn) {
      const hi = s.throttle > 0.6 ? 5200 : 2600;
      const wheelRpm = (s.speed / 3.6 / (2 * Math.PI * WHEEL_R)) * 60;
      const rpmIn = (g) => wheelRpm * GEARS[g - 1] * FINAL;
      while (s.gear < GEARS.length && rpmIn(s.gear) > hi) s.gear++;
      while (s.gear > 1 && rpmIn(s.gear) < (s.throttle > 0.5 ? 2200 : 1300)) s.gear--;
    }

    // RPM
    if (engineOn) {
      const wheelRpm = (s.speed / 3.6 / (2 * Math.PI * WHEEL_R)) * 60;
      const geared = wheelRpm * GEARS[s.gear - 1] * FINAL;
      const free = m.idle + s.throttle * (m.redline * 0.55 - m.idle);
      let target = s.speed > 12 ? Math.max(geared, m.idle) : Math.max(m.idle, free, geared * (s.speed / 12) + free * (1 - s.speed / 12));
      if (s.throttle > 0.05 && s.speed > 12) target = Math.max(target, geared);
      target = Math.min(target, m.redline * 1.02);
      s.rpm = lerp(s.rpm, target, clamp(dt * 6, 0, 1));
      if (this.faults.misfire && this.dtcs.has('P0301')) s.rpm += (this.rand() - 0.5) * 140;
      s.rpm = clamp(s.rpm, 0, m.redline * 1.05);
    } else if (s.ignition === 'off') {
      s.rpm = Math.max(0, s.rpm - 4000 * dt);
      if (s.rpm < 20) s.rpm = 0;
    }

    // Torque e força de tração
    const curve = (r) => clamp(0.55 + 0.9 * (r / m.redline) - 0.95 * (r / m.redline) ** 2, 0.35, 1);
    const tq = engineOn ? s.throttle * m.tmax * curve(s.rpm) * (this.faults.misfire ? 0.75 : 1) : 0;
    const ratio = GEARS[s.gear - 1] * FINAL;
    let drive = engineOn ? (tq * ratio * 0.9) / WHEEL_R : 0;
    drive = Math.min(drive, 0.9 * m.mass * G);
    if (s.speed < 2 && s.throttle < 0.02) drive = 0;
    const v = s.speed / 3.6;
    const rolling = 0.012 * m.mass * G * (v > 0.1 ? 1 : 0);
    const drag = 0.5 * 1.2 * 0.65 * v * v;
    const engineBrake = engineOn && s.throttle < 0.02 ? (s.rpm / m.redline) * 0.03 * m.mass * G : 0;
    const brakeF = s.brake * 0.9 * m.mass * G * (v > 0.05 ? 1 : 0);
    const net = drive - rolling - drag - engineBrake - brakeF;
    let a = net / m.mass;
    if (v < 0.05 && a < 0) a = 0;
    const nv = Math.max(0, v + a * dt);
    s.speed = nv * 3.6;
    s.distanceKm += (nv * dt) / 1000;
    s.accel = a;

    // Carga calculada
    if (engineOn) {
      const idleLoad = 20 + (this.faults.misfire ? 6 : 0);
      s.load = clamp(idleLoad + (100 - idleLoad) * s.throttle * (0.65 + 0.35 * (1 - s.rpm / (m.redline * 1.3))), 0, 100);
    } else s.load = 0;

    // Combustível (mesma fórmula do estimador do app, para coerência)
    if (engineOn) {
      const air = (s.load / 100) * 1.184 * m.disp * (s.rpm / 120);
      const afr = m.fuel.afr || 14.7;
      const flow = (air / afr / ((m.fuel.density || 0.745) * 1000)) * 3600;
      this.lastFuelLph = flow;
      s.fuelL = Math.max(0, s.fuelL - (flow * dt) / 3600);
    } else this.lastFuelLph = 0;

    // Temperatura do líquido
    let teq;
    let tau;
    if (!engineOn) {
      teq = s.ambient;
      tau = 1800;
    } else if (this.faults.overheat) {
      teq = 140;
      tau = 75;
    } else {
      teq = Math.min(98, 88 + 8 * (s.load / 100) - 0.02 * s.speed);
      tau = s.coolant < 85 ? 160 : 40;
      if (s.coolant < 85) teq = 90;
    }
    s.coolant += ((teq - s.coolant) * dt) / tau;

    // Admissão
    const iatTarget = s.ambient + 6 * (1 - Math.min(s.speed, 60) / 80) + 0.12 * (s.coolant - s.ambient);
    s.intake += ((iatTarget - s.intake) * dt) / 20;

    // Bateria
    if (s.ignition === 'on') {
      if (this.faults.alternator) {
        s.battery = Math.max(9.4, s.battery - 0.02 * dt * (1 + s.load / 100));
      } else {
        const charge = 14.35 - 0.45 * (s.load / 100);
        s.battery = lerp(s.battery, charge + (this.rand() - 0.5) * 0.06, clamp(dt * 2, 0, 1));
      }
    } else if (s.ignition === 'off') {
      s.battery = lerp(s.battery, 12.45, clamp(dt * 0.5, 0, 1));
    }

    this.#updateDtcs(dt);
  }

  #runScenario(dt) {
    const name = this.scenarioName;
    if (!name) return;
    const s = this.s;
    this.scenarioT += dt;
    const t = this.scenarioT;
    const cruise = (target, gain = 0.06) => {
      const err = target - s.speed;
      this._ci = clamp((this._ci || 0) + err * 0.012 * dt, 0, 0.8);
      this.setThrottle(clamp(0.05 + this._ci + err * gain, 0, 1));
      this.setBrake(err < -8 ? clamp((-err - 8) / 40, 0, 0.6) : 0);
    };
    switch (name) {
      case 'normal':
        if (t < 3) this.setThrottle(0);
        else cruise(t < 40 ? 50 : 50);
        break;
      case 'urban': {
        const cycle = t % 28;
        if (cycle < 12) cruise(45, 0.08);
        else if (cycle < 17) {
          this.setThrottle(0);
          this.setBrake(clamp(s.speed / 50, 0.15, 0.6));
        } else {
          this.setThrottle(0);
          this.setBrake(s.speed < 1 ? 0.3 : 0.5);
        }
        break;
      }
      case 'highway':
        cruise(110, 0.05);
        break;
      case 'acceleration':
        if (s.speed < 100) {
          this.setThrottle(1);
          this.setBrake(0);
        } else cruise(100, 0.08);
        break;
      case 'braking':
        if (t < 25 && s.speed < 90 && !this._braked) cruise(92, 0.1);
        if (s.speed >= 90) this._braked = true;
        if (this._braked) {
          this.setThrottle(0);
          this.setBrake(1);
          if (s.speed < 0.5) {
            this._braked = false;
            this.scenarioT = 0;
          }
        }
        break;
      case 'overheat':
      case 'lowBattery':
      case 'injectionFault':
        if (t < 3) this.setThrottle(0);
        else cruise(name === 'injectionFault' ? 40 : 70, 0.06);
        break;
      case 'connectionLoss':
        if (t < 3) this.setThrottle(0);
        else cruise(60);
        if (this.now() < this.linkDownUntil) {
          if (this.linkUp) this.setLink(false);
        } else if (!this.linkUp) this.setLink(true);
        break;
      default:
    }
  }

  #updateDtcs(dt) {
    const s = this.s;
    const t = this.now();
    const engineOn = s.ignition === 'on';
    if (this.faults.overheat && s.coolant > 112 && !this.dtcs.has('P0217')) {
      this.dtcs.set('P0217', { status: 'confirmed', since: t });
      this.#captureFreezeIfNone('P0217');
      this.emit('dtc', this.#dtcSnapshot());
    }
    if (this.faults.alternator && s.battery < 11.9 && engineOn && !this.dtcs.has('P0562')) {
      this.dtcs.set('P0562', { status: 'confirmed', since: t });
      this.#captureFreezeIfNone('P0562');
      this.emit('dtc', this.#dtcSnapshot());
    }
    if (this.faults.misfire && engineOn) {
      this.misfireT += dt;
      if (this.misfireT > 6 && !this.dtcs.has('P0301')) {
        this.dtcs.set('P0301', { status: 'pending', since: t });
        this.emit('dtc', this.#dtcSnapshot());
      }
      if (this.misfireT > 16 && this.dtcs.get('P0301')?.status === 'pending') {
        this.dtcs.set('P0301', { status: 'confirmed', since: t });
        this.dtcs.set('P0201', { status: 'confirmed', since: t });
        this.#captureFreezeIfNone('P0301');
        this.emit('dtc', this.#dtcSnapshot());
      }
    }
    // Falhas persistentes reaparecem depois de apagadas
    if (this.pendingReturn.length && engineOn) {
      for (const r of this.pendingReturn) r.wait -= dt;
      const due = this.pendingReturn.filter((r) => r.wait <= 0);
      if (due.length) {
        for (const r of due) this.dtcs.set(r.code, { status: 'pending', since: t });
        this.pendingReturn = this.pendingReturn.filter((r) => r.wait > 0);
        this.emit('dtc', this.#dtcSnapshot());
      }
    }
  }

  #captureFreezeIfNone(code) {
    if (!this.freeze) this.#captureFreeze(code);
  }

  /* ----------------------------- saída de dados ----------------------------- */

  /** Leituras no mesmo contrato do OBD2 real; somente PIDs suportados. */
  readings() {
    const s = this.s;
    const jitter = (v, a) => v + (this.rand() - 0.5) * a;
    const all = {
      speed: Math.round(s.speed),
      rpm: Math.round(jitter(s.rpm, s.rpm > 0 ? 6 : 0) / 4) * 4,
      engineLoad: Math.round(s.load),
      coolantTemp: Math.round(s.coolant),
      intakeTemp: Math.round(s.intake),
      batteryVoltage: Math.round(s.battery * 100) / 100,
      fuelLevel: Math.round(((s.fuelL / this.model.tank) * 100) * 10) / 10,
    };
    const out = {};
    for (const [id, v] of Object.entries(all)) if (this.supported.has(PARAMS[id].pid)) out[id] = v;
    return out;
  }

  #linkIsUp() {
    return this.linkUp && this.now() >= this.linkDownUntil;
  }

  #emitReadings() {
    if (!this.#linkIsUp()) return;
    this.emit('readings', this.readings());
  }

  get link() {
    return this.#linkIsUp();
  }

  /** Estado completo para a interface do Laboratório. */
  getState() {
    const s = this.s;
    return {
      running: this.running,
      ignition: s.ignition,
      throttle: s.throttle,
      brake: s.brake,
      speed: s.speed,
      rpm: s.rpm,
      gear: s.gear,
      coolant: s.coolant,
      load: s.load,
      battery: s.battery,
      fuelPct: this.fuelPct,
      distanceKm: s.distanceKm,
      ambient: s.ambient,
      scenario: this.scenarioName,
      link: this.#linkIsUp(),
      internet: this.internetUp,
      faults: { ...this.faults },
      dtcs: this.#dtcSnapshot(),
      fuelLph: this.lastFuelLph,
    };
  }

  #dtcSnapshot() {
    return [...this.dtcs.entries()].map(([code, v]) => ({ code, status: v.status, since: v.since }));
  }

  /* ----------------------------- interface de diagnóstico ----------------------------- */

  #needLink() {
    if (!this.running) throw new ObdError('TRANSPORT', 'Simulação desligada.');
    if (!this.#linkIsUp()) throw new ObdError('TIMEOUT', 'Enlace OBD2 simulado interrompido.');
  }

  async readDtcs() {
    this.#needLink();
    const list = [...this.dtcs.entries()];
    return {
      stored: list.filter(([, v]) => v.status === 'confirmed').map(([c]) => c),
      pending: list.filter(([, v]) => v.status === 'pending').map(([c]) => c),
      permanent: [...this.permanent],
    };
  }

  async readMonitorStatus() {
    this.#needLink();
    const confirmed = [...this.dtcs.values()].filter((v) => v.status === 'confirmed').length;
    return {
      milOn: confirmed > 0,
      dtcCount: confirmed,
      ignition: 'spark',
      monitors: [
        { name: 'Falha de ignição (misfire)', complete: true },
        { name: 'Sistema de combustível', complete: true },
        { name: 'Componentes abrangentes', complete: true },
        { name: 'Catalisador', complete: this.s.coolant > 80 },
        { name: 'Sistema EVAP', complete: false },
        { name: 'Sensor de oxigênio', complete: this.s.coolant > 80 },
      ],
    };
  }

  async readFreezeFrame() {
    this.#needLink();
    return this.freeze ? { dtc: this.freeze.dtc, params: structuredClone(this.freeze.params) } : null;
  }

  async readVin() {
    this.#needLink();
    return null; // o simulador não inventa VIN
  }

  async clearDtcs({ confirmed = false } = {}) {
    if (confirmed !== true) throw new ObdError('NOT_ALLOWED', 'Limpeza de códigos exige confirmação explícita');
    this.#needLink();
    this.dtcs.clear();
    this.freeze = null;
    // Defeitos ainda ativos fazem o código voltar (limpar não corrige a causa)
    this.pendingReturn = [];
    if (this.faults.overheat) this.pendingReturn.push({ code: 'P0217', wait: 3 });
    if (this.faults.alternator) this.pendingReturn.push({ code: 'P0562', wait: 4 });
    if (this.faults.misfire) {
      this.misfireT = 0;
      this.pendingReturn.push({ code: 'P0301', wait: 5 });
    }
    this.emit('dtc', this.#dtcSnapshot());
    return true;
  }

  async capabilities() {
    this.#needLink();
    return {
      simulated: true,
      adapter: 'Simulador BOLT',
      protocol: 'Simulado (contrato OBD2)',
      pids: [...this.supported],
      vin: null,
      operations: [
        { id: 'monitors', label: 'Status dos monitores (prontidão)', status: 'available' },
        { id: 'stored', label: 'Ler códigos armazenados (modo 03)', status: 'available' },
        { id: 'pending', label: 'Ler códigos pendentes (modo 07)', status: 'available' },
        { id: 'permanent', label: 'Ler códigos permanentes (modo 0A)', status: 'available' },
        { id: 'freeze', label: 'Freeze Frame (modo 02)', status: this.freeze ? 'available' : 'empty' },
        { id: 'vin', label: 'Número do chassi / VIN (modo 09)', status: 'unsupported', note: 'O simulador não gera VIN.' },
        { id: 'clear', label: 'Limpar códigos (modo 04)', status: 'available', note: 'Operação simulada.' },
      ],
    };
  }
}
