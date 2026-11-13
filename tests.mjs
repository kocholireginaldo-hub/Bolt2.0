/**
 * Testes da lógica do BOLT (sem dependências): node tests.mjs
 * Cobrem protocolo OBD2, gerenciador de conexão, motor de dados, simulador, alertas,
 * diagnóstico, manutenção, viagens, garagem, banco local, IA/privacidade e servidor.
 */
import assert from 'node:assert/strict';
import { MemoryBackend, Database } from './database.js';
import { VehicleDataEngine, estimateFuelFlow } from './vehicle-engine.js';
import {
  decodePid, parseSupportedPids, decodeDtc, parseDtcFrames, parseMonitorStatus, isCommandAllowed,
  parseReply, assembleFrames, Elm327Session, ObdError, parseVin,
} from './obd-protocol.js';
import { ObdManager, ObdState } from './obd-manager.js';
import { VehicleSimulator } from './vehicle-simulator.js';
import { AlertEngine, resolveLimits } from './alerts.js';
import { DiagnosticsService } from './diagnostics.js';
import { describeDtc } from './dtc-database.js';
import { evaluateItem, maintenanceLevel, MaintenanceService } from './maintenance.js';
import { TripRecorder, tripToGpx } from './trips.js';
import { Garage, normalizeVehicle, currentOdometer, blankVehicle } from './garage.js';
import { AiService, buildAiContext, AiError } from './ai-service.js';
import { answerLocally } from './assistant-local.js';
import { extractAfterWake } from './voice.js';
import { DataSourceController } from './data-source.js';
import { Settings } from './settings.js';
import { Assistant } from './assistant.js';
import { Connectivity } from './connectivity.js';
import { DEFAULT_SETTINGS } from './config.js';

const results = [];
const test = (name, fn) => results.push({ name, fn });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Emulador ELM327 (transporte falso)                                   */
/* ------------------------------------------------------------------ */
const bitmap = (base, pids) => {
  const bytes = [0, 0, 0, 0];
  for (const p of pids) {
    const n = parseInt(p, 16) - base - 1;
    if (n >= 0 && n < 32) bytes[Math.floor(n / 8)] |= 0x80 >> (n % 8);
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
};
const hex2 = (n) => Math.round(n).toString(16).toUpperCase().padStart(2, '0');
const dtcBytes = (code) => {
  const t = { P: 0, C: 1, B: 2, U: 3 }[code[0]];
  const b1 = (t << 6) | (parseInt(code[1], 16) << 4) | parseInt(code[2], 16);
  return hex2(b1) + code.slice(3);
};

class ElmEmulator {
  kind = 'ble';
  name = 'ELM-EMU';
  constructor(opts = {}) {
    this.ignition = true;
    this.silent = false;
    this.values = { '0C': 3200, '0D': 62, '05': 90, '04': 40, '0F': 33, 42: 14.1, '2F': 55 };
    this.supported = opts.supported || ['01', '04', '05', '0C', '0D', '0F', '20', '2F', '40', '42'];
    this.stored = opts.stored || [];
    this.pending = opts.pending || [];
    this.permanent = [];
    this.mil = this.stored.length > 0;
    this.vin = 'WVWZZZ1JZXW000001';
    this.freeze = opts.freeze ?? null;
    this.log = [];
    this.opened = 0;
    this.dataCb = () => {};
    this.closeCb = () => {};
    this.failOpen = 0;
  }
  onData(cb) { this.dataCb = cb; }
  onClose(cb) { this.closeCb = cb; }
  async open() {
    if (this.failOpen > 0) { this.failOpen--; throw new ObdError('TRANSPORT', 'falha simulada'); }
    this.opened++;
  }
  async reopen() { return this.open(); }
  async close() {}
  drop() { this.closeCb('queda simulada'); }
  async write(text) {
    const cmd = text.replace(/[\r\n]/g, '').replace(/\s+/g, '').toUpperCase();
    this.log.push(cmd);
    if (this.silent) return;
    const out = this.respond(cmd);
    if (out === null) return;
    const full = `${out}\r\r>`;
    const mid = Math.floor(full.length / 2);
    setTimeout(() => this.dataCb(full.slice(0, mid)), 0);
    setTimeout(() => this.dataCb(full.slice(mid)), 1);
  }
  respond(cmd) {
    if (cmd === '') return '';
    if (cmd === 'ATZ') return 'ELM327 v1.5';
    if (cmd === 'ATI') return 'ELM327 v1.5';
    if (cmd === 'ATDPN') return 'A6';
    if (cmd.startsWith('AT')) return 'OK';
    if (cmd === '0100' || cmd === '0120' || cmd === '0140') {
      if (!this.ignition) return 'SEARCHING...\rUNABLE TO CONNECT';
      const base = parseInt(cmd.slice(2), 16);
      return `41${hex2(base)}${bitmap(base, this.supported)}`;
    }
    if (!this.ignition) return 'NO DATA';
    if (cmd === '0101') return `4101${hex2((this.mil ? 0x80 : 0) | this.stored.length)}0765${'00'}`.replace(/0765/, '0765');
    if (cmd === '03') return `43${hex2(this.stored.length)}${this.stored.map(dtcBytes).join('')}`;
    if (cmd === '07') return this.pending.length ? `47${hex2(this.pending.length)}${this.pending.map(dtcBytes).join('')}` : '4700';
    if (cmd === '0A') return this.permanent.length ? `4A${hex2(this.permanent.length)}${this.permanent.map(dtcBytes).join('')}` : '4A00';
    if (cmd === '04') {
      this.cleared = (this.cleared || 0) + 1;
      if (!this.persistent) { this.stored = []; this.mil = false; }
      return '44';
    }
    if (cmd === '0902') {
      const bytes = [...this.vin].map((c) => hex2(c.charCodeAt(0)));
      const f0 = ['49', '02', '01', ...bytes.slice(0, 3)].join('');
      return `014\r0:${f0}\r1:${bytes.slice(3, 10).join('')}\r2:${bytes.slice(10, 17).join('')}`;
    }
    if (cmd === '020200') return this.freeze ? `420200${dtcBytes(this.freeze.dtc)}` : '4202000000';
    if (/^02[0-9A-F]{2}00$/.test(cmd)) {
      const pid = cmd.slice(2, 4);
      if (!this.freeze || this.freeze.values[pid] == null) return 'NO DATA';
      const v = this.freeze.values[pid];
      return `42${pid}00${Array.isArray(v) ? v.map(hex2).join('') : hex2(v)}`;
    }
    const m = /^01([0-9A-F]{2})$/.exec(cmd);
    if (m) {
      const pid = m[1];
      if (!this.supported.includes(pid)) return 'NO DATA';
      const v = this.values[pid] ?? this.values[parseInt(pid, 16)];
      if (v == null) return 'NO DATA';
      switch (pid) {
        case '0C': { const raw = Math.round(v * 4); return `410C${hex2(raw >> 8)}${hex2(raw & 255)}`; }
        case '0D': return `410D${hex2(v)}`;
        case '05': return `4105${hex2(v + 40)}`;
        case '0F': return `410F${hex2(v + 40)}`;
        case '04': return `4104${hex2((v * 255) / 100)}`;
        case '2F': return `412F${hex2((v * 255) / 100)}`;
        case '42': { const raw = Math.round(v * 1000); return `4142${hex2(raw >> 8)}${hex2(raw & 255)}`; }
        default: return 'NO DATA';
      }
    }
    return '?';
  }
}

const vehicle = (over = {}) => ({
  id: 'v1',
  nickname: 'Teste',
  tech: { make: 'Marca', model: 'Modelo', year: 2015, displacementL: 1.0, fuelType: 'gasoline', aspiration: 'natural', tankL: 50, redlineRpm: 6500, systemVoltage: 12, limits: {}, ...over },
  appearance: { silhouette: 'hatch', color: '#2EE6D6' },
});

/* ================== PROTOCOLO ================== */
test('Limites nulos do cadastro não anulam os padrões (sem falso superaquecimento)', () => {
  const lim = resolveLimits({ tech: { fuelType: 'flex', aspiration: 'natural', limits: { coolantWarn: null, coolantCrit: null, intakeWarn: null } } });
  assert.equal(lim.coolantWarn, 105);
  assert.equal(lim.coolantCrit, 112);
  assert.equal(lim.intakeWarn, 65);
  assert.equal(resolveLimits({ tech: { limits: { coolantWarn: 98 } } }).coolantWarn, 98);
});

test('PIDs padrão são decodificados corretamente', () => {
  assert.equal(decodePid('0C', [0x1a, 0xf8]).value, 1726);
  assert.equal(decodePid('0D', [60]).value, 60);
  assert.equal(decodePid('05', [130]).value, 90);
  assert.equal(decodePid('0F', [73]).value, 33);
  assert.ok(Math.abs(decodePid('04', [128]).value - 50.196) < 0.01);
  assert.equal(decodePid('42', [0x37, 0xa6]).value, 14.246);
  assert.equal(decodePid('0C', [1]), null); // dados insuficientes
  assert.equal(decodePid('99', [1]), null);
});

test('Bitmap de PIDs suportados', () => {
  const list = parseSupportedPids(0x00, [0xbe, 0x3f, 0xa8, 0x13]);
  assert.deepEqual(list.slice(0, 7), ['01', '03', '04', '05', '06', '07', '0B']);
  assert.ok(list.includes('20'));
});

test('DTCs: decodificação e quadros CAN/legados', () => {
  assert.equal(decodeDtc(0x01, 0x33), 'P0133');
  assert.equal(decodeDtc(0x43, 0x00), 'C0300');
  assert.equal(decodeDtc(0xc1, 0x00), 'U0100');
  assert.deepEqual(parseDtcFrames([[0x43, 0x02, 0x03, 0x01, 0x01, 0x71]], 0x43), ['P0301', 'P0171']);
  assert.deepEqual(parseDtcFrames([[0x43, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00]], 0x43), ['P0301']);
  assert.deepEqual(parseDtcFrames([[0x43, 0x00]], 0x43), []);
});

test('Status do monitor (MIL, contagem, monitores)', () => {
  const m = parseMonitorStatus([0x82, 0x07, 0x65, 0x00]);
  assert.equal(m.milOn, true);
  assert.equal(m.dtcCount, 2);
  assert.equal(m.ignition, 'spark');
  assert.ok(m.monitors.some((x) => x.name === 'Catalisador' && x.complete));
});

test('Lista de comandos permitidos bloqueia escrita/UDS e exige confirmação para modo 04', () => {
  for (const ok of ['ATZ', '010C', '03', '07', '0A', '0902', '020200', 'ATSP0']) assert.ok(isCommandAllowed(ok), ok);
  for (const bad of ['04', '2E0101', '27 01', '3101', '08', 'ATPP FF SV 01', '1003', '0902FF', 'AT PP']) assert.ok(!isCommandAllowed(bad), bad);
  assert.ok(isCommandAllowed('04', { allowClear: true }));
});

test('Respostas de erro do ELM327 viram ObdError', () => {
  assert.throws(() => parseReply('NO DATA', '010C'), (e) => e.code === 'NO_DATA');
  assert.throws(() => parseReply('SEARCHING...\rUNABLE TO CONNECT', '0100'), (e) => e.code === 'UNABLE_TO_CONNECT');
  assert.throws(() => parseReply('CAN ERROR', '0100'), (e) => e.code === 'BUS_ERROR');
  assert.throws(() => parseReply('?', 'XX'), (e) => e.code === 'UNKNOWN_COMMAND');
  assert.deepEqual(parseReply('SEARCHING...\r410C1AF8', '010C'), ['410C1AF8']);
});

test('Resposta multi-quadro (VIN) é montada', () => {
  const frames = assembleFrames(['014', '0:490201575657', '1:5A5A5A314A5A58', '2:57303030303031']);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].length, 20);
  assert.equal(parseVin(frames[0].slice(3)), 'WVWZZZ1JZXW000001');
});

/* ================== SESSÃO ELM327 ================== */
test('Sessão ELM327: init, PIDs, DTC, freeze frame, VIN e limpeza protegida', async () => {
  const emu = new ElmEmulator({ stored: ['P0301', 'P0171'], pending: ['P0420'], freeze: { dtc: 'P0301', values: { '04': 70, '05': 120, '0C': [0x1a, 0xf8], '0D': 40 } } });
  const s = new Elm327Session(emu, { timeoutMs: 500 });
  const info = await s.init();
  assert.equal(info.protocol, 'ISO 15765-4 CAN (11 bits, 500 kbps)');
  assert.ok(s.isSupported('0C') && s.isSupported('2F') && s.isSupported('42'), 'cadeia 0100/0120/0140');
  assert.ok(!s.isSupported('10'));
  const rpm = await s.readPid('0C');
  assert.equal(rpm.id, 'rpm');
  assert.equal(rpm.value, 3200);
  assert.equal((await s.readPid('05')).value, 90);
  assert.deepEqual(await s.readStoredDtcs(), ['P0301', 'P0171']);
  assert.deepEqual(await s.readPendingDtcs(), ['P0420']);
  assert.deepEqual(await s.readPermanentDtcs(), []);
  const ff = await s.readFreezeFrame();
  assert.equal(ff.dtc, 'P0301');
  assert.equal(ff.params.coolantTemp.value, 80);
  assert.equal(ff.params.rpm.value, 1726);
  assert.equal(await s.readVin(), 'WVWZZZ1JZXW000001');
  assert.equal((await s.readMonitorStatus()).dtcCount, 2);
  await assert.rejects(() => s.clearDtcs(), (e) => e.code === 'NOT_ALLOWED');
  await assert.rejects(() => s.request('04'), (e) => e.code === 'NOT_ALLOWED');
  assert.ok(!emu.log.includes('04'), 'nenhum 04 enviado sem confirmação');
  await s.clearDtcs({ confirmed: true });
  assert.deepEqual(await s.readStoredDtcs(), []);
  await assert.rejects(() => s.request('2E0101'), (e) => e.code === 'NOT_ALLOWED');
  assert.ok(!emu.log.some((c) => c.startsWith('2E')));
});

test('Sessão: timeout, ignição desligada e fila serializada', async () => {
  const emu = new ElmEmulator();
  emu.ignition = false;
  const s = new Elm327Session(emu, { timeoutMs: 300 });
  await assert.rejects(() => s.init(), (e) => e.code === 'UNABLE_TO_CONNECT');
  const emu2 = new ElmEmulator();
  const s2 = new Elm327Session(emu2, { timeoutMs: 120 });
  await s2.init();
  const [a, b] = await Promise.all([s2.readPid('0C'), s2.readPid('0D')]);
  assert.equal(a.id, 'rpm');
  assert.equal(b.id, 'speed');
  emu2.silent = true;
  await assert.rejects(() => s2.readPid('0C'), (e) => e.code === 'TIMEOUT');
});

/* ================== GERENCIADOR OBD ================== */
test('ObdManager: conecta, lê, marca PIDs não suportados e desconecta', async () => {
  const emu = new ElmEmulator({ supported: ['01', '04', '05', '0C', '0D', '20', '40', '42'] });
  const m = new ObdManager({ factories: { ble: () => emu }, sleepFn: async () => {} });
  const readings = {};
  let unsupported = [];
  m.on('reading', (r) => (readings[r.id] = r.value));
  m.on('unsupported', (ids) => (unsupported = ids));
  await m.connect('ble');
  assert.equal(m.state, ObdState.READY);
  await tick(900);
  assert.equal(readings.rpm, 3200);
  assert.equal(readings.speed, 62);
  assert.equal(readings.coolantTemp, 90);
  assert.ok(unsupported.includes('fuelLevel') && unsupported.includes('intakeTemp'));
  assert.ok(m.status.readsPerSec > 0);
  const caps = await m.capabilities();
  assert.ok(caps.operations.find((o) => o.id === 'stored').status === 'available');
  assert.equal(caps.operations.find((o) => o.id === 'clear').status, 'untested');
  await m.disconnect();
  assert.equal(m.state, ObdState.IDLE);
});

test('ObdManager: falha de conexão e mensagem amigável', async () => {
  const emu = new ElmEmulator();
  emu.ignition = false;
  const m = new ObdManager({ factories: { ble: () => emu }, sleepFn: async () => {}, sessionOptions: { timeoutMs: 200 } });
  await assert.rejects(() => m.connect('ble'));
  assert.equal(m.state, ObdState.ERROR);
  assert.match(m.status.lastError, /ignição/i);
  await assert.rejects(() => m.connect('inexistente'), (e) => e.code === 'UNSUPPORTED');
});

test('ObdManager: perda de conexão → reconexão automática → leituras retomam', async () => {
  const emu = new ElmEmulator();
  const settings = { get: (p, d) => (p === 'obd.autoReconnect' ? true : d) };
  const m = new ObdManager({ settings, factories: { ble: () => emu }, sleepFn: async () => {}, backoffMs: [10] });
  let count = 0;
  m.on('reading', () => count++);
  const states = [];
  m.on('state', (s) => states.push(s.state));
  await m.connect('ble');
  await tick(300);
  const before = count;
  assert.ok(before > 0);
  emu.drop();
  await tick(80);
  await tick(500);
  assert.ok(states.includes(ObdState.RECONNECTING), 'passou por RECONNECTING');
  assert.equal(m.state, ObdState.READY);
  assert.ok(emu.opened >= 2, 'reabriu o transporte');
  const mid = count;
  await tick(400);
  assert.ok(count > mid, 'leituras retomaram');
  await m.disconnect();
});

test('ObdManager: reconexão desistindo após o limite de tentativas', async () => {
  const emu = new ElmEmulator();
  const settings = { get: (p, d) => (p === 'obd.autoReconnect' ? true : d) };
  const m = new ObdManager({ settings, factories: { ble: () => emu }, sleepFn: async () => {}, maxAttempts: 3, backoffMs: [1] });
  await m.connect('ble');
  emu.failOpen = 99;
  emu.drop();
  await tick(400);
  assert.equal(m.state, ObdState.ERROR);
  assert.match(m.status.lastError, /reconectar/i);
});

test('ObdManager: sem reconexão automática vai para erro; disponibilidade honesta', async () => {
  const emu = new ElmEmulator();
  const settings = { get: (p, d) => (p === 'obd.autoReconnect' ? false : d) };
  const m = new ObdManager({ settings, factories: { ble: () => emu }, sleepFn: async () => {} });
  await m.connect('ble');
  emu.drop();
  await tick(100);
  assert.equal(m.state, ObdState.ERROR);
  const av = m.availability({});
  assert.equal(av.find((a) => a.kind === 'ble').supported, false);
  assert.equal(av.find((a) => a.kind === 'spp').supported, false);
  assert.equal(av.find((a) => a.kind === 'wifi').supported, true);
});

/* ================== MOTOR DE DADOS ================== */
test('Engine: origem ativa isolada (sem mistura), validade e obsolescência', () => {
  let t = 1000;
  const e = new VehicleDataEngine({ now: () => t });
  e.setSource('obd');
  assert.equal(e.ingest('simulation', { rpm: 900 }), false, 'simulação rejeitada com origem OBD');
  assert.equal(e.get('rpm').validity, 'unavailable');
  e.ingest('obd', { rpm: 2000, speed: 300, coolantTemp: 90 });
  assert.equal(e.get('rpm').validity, 'valid');
  assert.equal(e.get('speed').validity, 'invalid', 'fora da faixa');
  assert.equal(e.value('speed'), null);
  t += 5000;
  assert.equal(e.get('rpm').validity, 'stale');
  assert.equal(e.value('rpm'), null);
  assert.equal(e.get('coolantTemp').validity, 'valid');
  e.markUnsupported('obd', ['fuelLevel']);
  assert.equal(e.get('fuelLevel').validity, 'unsupported');
  e.setSource('simulation');
  assert.equal(e.get('coolantTemp').validity, 'unavailable', 'troca de origem limpa tudo');
  assert.equal(e.ingest('obd', { rpm: 1 }), false);
});

test('Engine: estimativa de consumo declara método e não inventa', () => {
  const v = vehicle();
  const r = estimateFuelFlow({ loadPct: 50, rpm: 3000, vehicle: v });
  assert.equal(r.method, 'load');
  assert.equal(r.estimated, true);
  assert.ok(r.flowLph > 3 && r.flowLph < 8, `fluxo ${r.flowLph}`);
  assert.equal(estimateFuelFlow({ loadPct: 50, rpm: 3000, vehicle: vehicle({ fuelType: 'diesel' }) }).flowLph, null);
  assert.equal(estimateFuelFlow({ loadPct: 50, rpm: 3000, vehicle: vehicle({ displacementL: null }) }).flowLph, null);
  assert.equal(estimateFuelFlow({ fuelRate: 4.2, vehicle: vehicle({ fuelType: 'diesel' }) }).estimated, false);
  assert.equal(estimateFuelFlow({ maf: 10, loadPct: 1, rpm: 1, vehicle: v }).method, 'maf');
});

/* ================== SIMULADOR ================== */
const mkSim = () => {
  let t = 0;
  const sim = new VehicleSimulator({ seed: 7, now: () => t });
  const adv = (sec) => { for (let i = 0; i < sec * 10; i++) { t += 100; sim.step(0.1); } };
  return { sim, adv, time: () => t };
};

test('Simulador: partida, marcha lenta, aceleração coerente e desligamento', () => {
  const { sim, adv } = mkSim();
  sim.start(vehicle());
  assert.equal(sim.getState().rpm, 0);
  sim.setIgnition(true);
  adv(3);
  let s = sim.getState();
  assert.equal(s.ignition, 'on');
  assert.ok(s.rpm > 700 && s.rpm < 1000, `marcha lenta ${s.rpm}`);
  assert.ok(s.battery > 13.5 && s.battery < 14.8);
  sim.setThrottle(1);
  adv(8);
  s = sim.getState();
  assert.ok(s.speed > 40 && s.speed < 140, `velocidade ${s.speed}`);
  assert.ok(s.rpm > 2500, 'rpm sobe com a velocidade');
  assert.ok(s.rpm <= 6500 * 1.05);
  sim.setThrottle(0);
  sim.setBrake(1);
  adv(15);
  assert.ok(sim.getState().speed < 1, 'freio para o veículo');
  assert.ok(sim.getState().rpm < 1000, 'volta à marcha lenta');
  sim.setIgnition(false);
  adv(3);
  assert.equal(sim.getState().rpm, 0);
  assert.ok(sim.getState().battery < 13);
  sim.stop();
});

test('Simulador: aquecimento gradual e cenário de superaquecimento gera DTC', () => {
  const { sim, adv } = mkSim();
  sim.start(vehicle());
  sim.setIgnition(true);
  adv(2);
  const t0 = sim.getState().coolant;
  sim.setScenario('normal');
  adv(120);
  const t1 = sim.getState().coolant;
  assert.ok(t1 > t0 + 15, `aquece ${t0}→${t1}`);
  sim.setScenario('overheat');
  adv(240);
  assert.ok(sim.getState().coolant > 112);
  assert.ok(sim.getState().dtcs.some((d) => d.code === 'P0217'));
});

test('Simulador: bateria baixa, falha de injeção e perda de enlace', async () => {
  const a = mkSim();
  a.sim.start(vehicle());
  a.sim.setIgnition(true);
  a.adv(2);
  a.sim.setScenario('lowBattery');
  a.adv(90);
  assert.ok(a.sim.getState().battery < 11.9);
  assert.ok(a.sim.getState().dtcs.some((d) => d.code === 'P0562'));
  const b = mkSim();
  b.sim.start(vehicle());
  b.sim.setIgnition(true);
  b.adv(2);
  b.sim.setScenario('injectionFault');
  b.adv(10);
  assert.equal(b.sim.getState().dtcs.find((d) => d.code === 'P0301')?.status, 'pending');
  b.adv(10);
  assert.equal(b.sim.getState().dtcs.find((d) => d.code === 'P0301')?.status, 'confirmed');
  const c = mkSim();
  c.sim.start(vehicle());
  c.sim.setIgnition(true);
  c.adv(2);
  c.sim.setScenario('connectionLoss');
  c.adv(5);
  assert.equal(c.sim.link, false);
  await assert.rejects(() => c.sim.readDtcs(), (e) => e.code === 'TIMEOUT');
  c.adv(15);
  assert.equal(c.sim.link, true);
});

test('Simulador: usa o contrato real (ids de PARAMS) e respeita PIDs desativados', () => {
  const { sim, adv } = mkSim();
  sim.start(vehicle());
  sim.setIgnition(true);
  adv(3);
  const r = sim.readings();
  assert.deepEqual(Object.keys(r).sort(), ['batteryVoltage', 'coolantTemp', 'engineLoad', 'fuelLevel', 'intakeTemp', 'rpm', 'speed']);
  sim.setPidSupported('2F', false);
  assert.ok(!('fuelLevel' in sim.readings()));
});

test('Simulador: limpar DTC não corrige a causa (código reaparece) e exige confirmação', async () => {
  const { sim, adv } = mkSim();
  sim.start(vehicle());
  sim.setIgnition(true);
  adv(2);
  sim.setScenario('injectionFault');
  adv(25);
  assert.ok((await sim.readDtcs()).stored.includes('P0301'));
  await assert.rejects(() => sim.clearDtcs(), (e) => e.code === 'NOT_ALLOWED');
  await sim.clearDtcs({ confirmed: true });
  assert.deepEqual((await sim.readDtcs()).stored, []);
  adv(8);
  assert.ok((await sim.readDtcs()).pending.includes('P0301'), 'falha persistente voltou');
});

/* ================== ALERTAS ================== */
const mkAlertRig = (veh = vehicle(), settings = {}) => {
  let t = 0;
  const engine = new VehicleDataEngine({ now: () => t });
  engine.setSource('simulation');
  const alerts = new AlertEngine({ engine, getVehicle: () => veh, getSetting: (p, d) => settings[p] ?? d, now: () => t });
  const step = (ms, readings) => { t += ms; if (readings) engine.ingest('simulation', readings); return alerts.evaluate(); };
  return { engine, alerts, step };
};

test('Alertas: temperatura usa limites do veículo, com confirmação e limpeza (histerese)', () => {
  const { alerts, step } = mkAlertRig(vehicle({ limits: { coolantWarn: 100, coolantCrit: 108 } }));
  step(0, { coolantTemp: 102, rpm: 2000 });
  assert.equal(alerts.list().length, 0, 'ainda não confirmou');
  step(2000, { coolantTemp: 102, rpm: 2000 });
  assert.equal(alerts.list()[0].level, 'attention');
  step(1000, { coolantTemp: 110, rpm: 2000 });
  assert.equal(alerts.list()[0].level, 'critical');
  step(1000, { coolantTemp: 85, rpm: 2000 });
  assert.equal(alerts.list().length, 1, 'não limpa na hora');
  step(4000, { coolantTemp: 85, rpm: 2000 });
  assert.equal(alerts.list().length, 0);
  const lim = resolveLimits(vehicle({ aspiration: 'turbo', redlineRpm: null }));
  assert.equal(lim.redlineRpm, 6200);
});

test('Alertas: faixa vermelha própria do veículo e tensão para sistema de 24 V', () => {
  const r1 = mkAlertRig(vehicle({ redlineRpm: 5000 }));
  r1.step(0, { rpm: 5100, coolantTemp: 90 });
  r1.step(1500, { rpm: 5100, coolantTemp: 90 });
  assert.ok(r1.alerts.list().some((a) => a.key === 'rpm'));
  const r2 = mkAlertRig(vehicle({ redlineRpm: 7000 }));
  r2.step(0, { rpm: 5100 });
  r2.step(1500, { rpm: 5100 });
  assert.ok(!r2.alerts.list().some((a) => a.key === 'rpm'));
  const v12 = mkAlertRig(vehicle());
  v12.step(0, { rpm: 2000, batteryVoltage: 13.8 });
  v12.step(4000, { rpm: 2000, batteryVoltage: 13.8 });
  assert.ok(!v12.alerts.list().some((a) => a.key === 'battery'), '13,8 V ok em 12 V');
  const v24 = mkAlertRig(vehicle({ systemVoltage: 24 }));
  v24.step(0, { rpm: 2000, batteryVoltage: 13.8 });
  v24.step(4000, { rpm: 2000, batteryVoltage: 13.8 });
  assert.equal(v24.alerts.list().find((a) => a.key === 'battery')?.level, 'critical', '13,8 V crítico em 24 V');
});

test('Alertas: dados obsoletos/ inválidos não disparam regras de valor; geram aviso de dados', () => {
  const { engine, alerts, step } = mkAlertRig();
  step(0, { coolantTemp: 130, rpm: 2000 });
  step(10000, null); // coolant ficou obsoleto (staleMs 12000? ainda não) -> avança
  step(5000, null);
  const list = alerts.list();
  assert.ok(!list.some((a) => a.key === 'coolant'), 'valor obsoleto não alerta temperatura');
  assert.ok(list.some((a) => a.key === 'stale'), 'avisa dados desatualizados');
  engine.ingest('simulation', { rpm: 99999 });
  step(0);
  step(2000);
  assert.ok(alerts.list().some((a) => a.key === 'invalid'));
});

test('Alertas: DTC crítico, manutenção vencida crítica e internet (contexto local)', () => {
  const { alerts, step } = mkAlertRig();
  alerts.setContext({
    dtc: [{ code: 'P0217', status: 'current', severity: 'critical', description: 'x' }, { code: 'P0420', status: 'pending', severity: 'attention' }],
    maintenance: [{ id: 'm1', name: 'Freios', status: 'overdue', critical: true, detail: 'vencido' }],
    internet: false,
  });
  step(100, {});
  const keys = Object.fromEntries(alerts.list().map((a) => [a.key, a.level]));
  assert.equal(keys['dtc:P0217'], 'critical');
  assert.equal(keys['dtc:P0420'], 'info');
  assert.equal(keys['maint:m1'], 'critical');
  assert.equal(keys.internet, 'info');
  assert.equal(alerts.highestLevel(), 'critical');
});

/* ================== BANCO LOCAL ================== */
const mkDb = async () => new Database(new MemoryBackend()).open();

test('Banco: CRUD, exportação e restauração (merge preserva dados locais)', async () => {
  const db = await mkDb();
  await db.put('vehicles', { id: 'a', nickname: 'A', updatedAt: 10 });
  await db.put('vehicles', { id: 'b', nickname: 'B', updatedAt: 10 });
  const backup = await db.exportAll();
  assert.equal(backup.app, 'BOLT');
  await db.put('vehicles', { id: 'c', nickname: 'Local novo', updatedAt: 20 });
  await db.put('vehicles', { id: 'a', nickname: 'A editado', updatedAt: 30 });
  const r = await db.importAll(backup, { mode: 'merge' });
  const all = await db.all('vehicles');
  assert.equal(all.length, 3, 'merge não apaga o que só existe localmente');
  assert.equal(all.find((v) => v.id === 'a').nickname, 'A editado', 'mais novo prevalece');
  assert.equal(r.imported, 0);
  await db.importAll(backup, { mode: 'replace' });
  assert.equal((await db.all('vehicles')).length, 2);
  assert.ok(!Database.validateBackup({ app: 'OUTRO' }).ok);
  assert.ok(!Database.validateBackup({ app: 'BOLT', schema: 99, stores: {} }).ok);
  await assert.rejects(() => db.importAll({ foo: 1 }));
});

/* ================== DIAGNÓSTICO ================== */
const mkDiag = async (origin = 'obd') => {
  const db = await mkDb();
  const emu = new ElmEmulator({ stored: ['P0301'], pending: ['P0420'], freeze: { dtc: 'P0301', values: { '04': 70, '05': 100 } } });
  const m = new ObdManager({ factories: { ble: () => emu }, sleepFn: async () => {} });
  await m.connect('ble');
  const engine = new VehicleDataEngine();
  engine.setSource('obd');
  engine.ingest('obd', { rpm: 2000, coolantTemp: 90 });
  const veh = vehicle();
  const diag = new DiagnosticsService({ db, getSource: () => ({ source: m, origin }), getVehicle: () => veh, engine });
  return { db, emu, m, diag };
};

test('Diagnóstico: leitura, classificação, freeze frame e descrição sem inventar', async () => {
  const { diag, m } = await mkDiag();
  const r = await diag.scan();
  assert.equal(r.counts.current, 1);
  assert.equal(r.counts.pending, 1);
  assert.equal(r.milOn, true);
  assert.equal(r.freezeFrame.dtc, 'P0301');
  const e = r.entries.find((x) => x.code === 'P0301');
  assert.match(e.description, /cilindro 1/i);
  assert.equal(describeDtc('P1234').description, null);
  assert.equal(describeDtc('P1234').manufacturerSpecific, true);
  assert.match(describeDtc('P1234').note, /fabricante/i);
  assert.equal(describeDtc('P0217').severity, 'critical');
  assert.equal(describeDtc('XYZ').valid, false);
  await m.disconnect();
});

test('Diagnóstico: histórico, "anterior" e "reincidente"', async () => {
  const { diag, emu, m } = await mkDiag();
  await diag.scan();
  emu.stored = [];
  emu.pending = [];
  let r = await diag.scan();
  assert.equal(r.entries.length, 0);
  let hist = await diag.history();
  assert.equal(hist.find((h) => h.code === 'P0301').status, 'previous');
  emu.stored = ['P0301'];
  r = await diag.scan();
  assert.equal(r.entries.find((x) => x.code === 'P0301').recurrent, true);
  hist = await diag.history();
  assert.equal(hist.find((h) => h.code === 'P0301').episodes.length, 2);
  await m.disconnect();
});

test('Diagnóstico: limpeza preserva snapshot ANTES, relê DTCs e reporta códigos que voltaram', async () => {
  const { diag, emu, db, m } = await mkDiag();
  await assert.rejects(() => diag.clearCodes(), /confirma/i);
  assert.ok(!emu.log.includes('04'));
  emu.persistent = true; // defeito persiste: a ECU mantém o código
  const origWrite = emu.write.bind(emu);
  let snapshotBeforeClear = null;
  emu.write = async (t) => {
    if (t.trim() === '04') snapshotBeforeClear = (await db.where('dtcHistory', (r) => r.kind === 'clear')).length;
    return origWrite(t);
  };
  const snap = await diag.clearCodes({ confirmed: true });
  assert.equal(snapshotBeforeClear, 1, 'snapshot salvo antes de enviar o modo 04');
  assert.equal(snap.codesBefore.length, 2);
  assert.equal(snap.freezeFrame.dtc, 'P0301');
  assert.ok(snap.result.returned.includes('P0301'), 'reportou código que voltou');
  assert.equal(emu.cleared, 1);
  await m.disconnect();
});

/* ================== MANUTENÇÃO ================== */
test('Manutenção: intervalos vêm do usuário; status ok/soon/overdue/unconfigured/unknown', () => {
  const now = new Date('2026-06-01').getTime();
  const base = { id: 'x', name: 'Óleo', type: 'oil', intervalKm: 10000, lastDoneKm: 50000, lastDoneDate: new Date('2026-01-01').getTime(), intervalMonths: 12 };
  assert.equal(evaluateItem({ id: 'y', name: 'N' }, { now }).status, 'unconfigured');
  assert.equal(evaluateItem({ ...base, lastDoneKm: null, lastDoneDate: null }, { now }).status, 'unknown');
  assert.equal(evaluateItem(base, { odometerKm: 52000, now }).status, 'ok');
  assert.equal(evaluateItem(base, { odometerKm: 59500, now }).status, 'soon');
  const over = evaluateItem(base, { odometerKm: 61000, now });
  assert.equal(over.status, 'overdue');
  assert.equal(over.remainingKm, -1000);
  const byDate = evaluateItem({ ...base, intervalKm: null, lastDoneKm: null, lastDoneDate: new Date('2025-01-01').getTime() }, { now });
  assert.equal(byDate.status, 'overdue');
  assert.equal(evaluateItem(base, { odometerKm: null, now }).status, 'ok', 'sem odômetro avalia só pela data');
});

test('Manutenção: nível do ícone (laranja/vermelho) e serviço atualiza a agenda', async () => {
  assert.equal(maintenanceLevel({ items: [], dtcs: [] }), 'ok');
  assert.equal(maintenanceLevel({ items: [{ status: 'soon' }], dtcs: [] }), 'attention');
  assert.equal(maintenanceLevel({ items: [{ status: 'overdue', critical: false }], dtcs: [] }), 'attention');
  assert.equal(maintenanceLevel({ items: [{ status: 'overdue', critical: true }], dtcs: [] }), 'critical');
  assert.equal(maintenanceLevel({ items: [], dtcs: [{ status: 'current', severity: 'critical' }] }), 'critical');
  assert.equal(maintenanceLevel({ items: [], dtcs: [{ status: 'pending', severity: 'critical' }] }), 'attention');
  const db = await mkDb();
  const veh = vehicle();
  const svc = new MaintenanceService({ db, getVehicle: () => veh, getOdometer: () => 51000, getSetting: (p, d) => d });
  const item = await svc.saveItem({ type: 'oil', name: 'Troca de óleo', intervalKm: 10000, lastDoneKm: 40000, lastDoneDate: Date.now() });
  await assert.rejects(() => svc.saveItem({ type: 'oil', name: '', intervalKm: -5 }));
  await svc.addService({ scheduleId: item.id, type: 'oil', name: 'Troca de óleo', km: 51000, date: Date.now(), cost: 250 });
  const ev = await svc.evaluate();
  assert.equal(ev[0].status, 'ok');
  assert.equal(ev[0].item.lastDoneKm, 51000);
  assert.equal((await svc.services()).length, 1);
});

/* ================== VIAGENS ================== */
test('Viagens: início automático, distância integrada, consumo estimado, parada e separação real/simulação', async () => {
  const db = await mkDb();
  let t = 0;
  const engine = new VehicleDataEngine({ now: () => t });
  const veh = vehicle();
  engine.setVehicle(veh);
  engine.setSource('simulation');
  const settings = { 'trips.autoRecord': true, 'trips.minSpeedStart': 3, 'trips.stopAfterSeconds': 30, 'trips.gps': false };
  const rec = new TripRecorder({ engine, db, getSetting: (p, d) => settings[p] ?? d, getVehicle: () => veh, now: () => t });
  const feed = async (sec, speed, rpm = 2500, load = 40) => {
    for (let i = 0; i < sec; i++) { t += 1000; engine.ingest('simulation', { speed, rpm, engineLoad: load }); await rec.tick(); }
  };
  await feed(5, 0, 800, 20);
  assert.equal(rec.active, false, 'parado não inicia');
  await feed(3600, 36);
  assert.ok(rec.active);
  const s = rec.summary();
  assert.ok(Math.abs(s.distanceKm - 36) < 0.2, `distância ${s.distanceKm}`);
  assert.ok(Math.abs(s.avgSpeedKmh - 36) < 0.5);
  assert.ok(s.fuelL > 0 && s.avgKmL > 5 && s.avgKmL < 40);
  await feed(35, 0, 800, 20);
  assert.equal(rec.active, false, 'parou após ficar parado');
  const trips = await rec.list({ vehicleId: 'v1' });
  assert.equal(trips.length, 1);
  assert.equal(trips[0].origin, 'simulation');
  assert.equal((await rec.list({ vehicleId: 'v1', origin: 'obd' })).length, 0);
  assert.match(tripToGpx({ ...trips[0], points: [{ t: 1, lat: -23.5, lon: -46.6 }] }), /trkpt lat="-23.500000"/);
  assert.equal(currentOdometer({ ...veh, tech: { ...veh.tech, odometerKm: 1000, odometerAt: 0 } }, trips), 1000, 'simulação não altera odômetro');
});

test('Viagens: sem dados de velocidade a distância não é inventada; recuperação de viagem interrompida', async () => {
  const db = await mkDb();
  let t = 0;
  const engine = new VehicleDataEngine({ now: () => t });
  engine.setSource('obd');
  const veh = vehicle();
  const rec = new TripRecorder({ engine, db, getSetting: (p, d) => d, getVehicle: () => veh, now: () => t });
  rec.start({ manual: true });
  for (let i = 0; i < 20; i++) { t += 1000; await rec.tick(); }
  assert.equal(rec.summary().distanceKm, 0);
  for (let i = 0; i < 50; i++) { t += 1000; await rec.tick(); }
  assert.equal(rec.active, false, 'perda de dados encerra');
  await db.put('trips', { id: 'x', vehicleId: 'v1', origin: 'obd', startedAt: 1, distanceKm: 3, totalSec: 100, movingSec: 90, maxSpeed: 50, fuelL: 0, fuelDistanceKm: 0, inProgress: true, points: [], updatedAt: 5000 });
  assert.equal(await rec.recover(), 1);
  assert.equal((await db.get('trips', 'x')).inProgress, false);
});

/* ================== GARAGEM ================== */
test('Garagem: validação, aparência separada da técnica, odômetro e exclusão em cascata', async () => {
  const db = await mkDb();
  const g = new Garage({ db });
  await g.load();
  const bad = blankVehicle();
  await assert.rejects(() => g.save(bad), (e) => Boolean(e.errors.make && e.errors.model));
  const v = blankVehicle();
  v.tech.make = 'Fiat'; v.tech.model = 'Uno'; v.tech.year = 2012; v.tech.displacementL = 1.0; v.tech.odometerKm = 80000;
  v.appearance = { silhouette: 'pickup', color: '#ff0000' };
  const saved = await g.save(v);
  assert.equal(g.active().id, saved.id);
  assert.equal(saved.appearance.silhouette, 'pickup');
  assert.equal(saved.tech.make, 'Fiat');
  assert.ok(!('silhouette' in saved.tech) && !('make' in saved.appearance));
  assert.equal(normalizeVehicle({ ...v, appearance: { silhouette: 'foguete', color: 'x' } }).vehicle.appearance.silhouette, 'hatch');
  assert.ok(normalizeVehicle({ ...v, tech: { ...v.tech, vin: 'OOO' } }).errors.vin);
  const v2 = blankVehicle();
  v2.tech.make = 'VW'; v2.tech.model = 'Gol'; v2.tech.year = 2018;
  const s2 = await g.save(v2);
  await g.setActive(s2.id);
  await g.updateOdometer(s2.id, 12345);
  assert.equal(g.get(s2.id).tech.odometerKm, 12345);
  await g.setArchived(s2.id, true);
  assert.equal(g.active().id, saved.id, 'arquivar troca o ativo mas preserva dados');
  await db.put('trips', { id: 't1', vehicleId: s2.id, startedAt: 1, origin: 'obd' });
  assert.equal((await db.all('trips')).length, 1, 'histórico preservado ao arquivar');
  await g.remove(s2.id);
  assert.equal((await db.all('trips')).length, 0);
  assert.equal(g.list({ includeArchived: true }).length, 1);
});

/* ================== IA / PRIVACIDADE / ASSISTENTE ================== */
const mkSettings = async () => { const db = await mkDb(); const s = new Settings(db); await s.load(); return { s, db }; };

test('IA: contexto respeita privacidade e nunca inclui placa, VIN ou nome', async () => {
  const { s } = await mkSettings();
  s.set('driver.name', 'Fulano');
  const engine = new VehicleDataEngine();
  engine.setSource('simulation');
  engine.ingest('simulation', { rpm: 2000, coolantTemp: 90 });
  const veh = vehicle({ vin: '9BWZZZ377VT004251', plate: 'ABC1D23' });
  const ctx = buildAiContext({ settings: s, engine, vehicle: veh, alerts: [], dtcs: [{ code: 'P0301', status: 'current', description: 'd' }], maintenance: [{ name: 'Óleo', status: 'soon', detail: 'x' }] });
  const txt = JSON.stringify(ctx);
  assert.ok(!txt.includes('ABC1D23') && !txt.includes('9BWZZZ377VT004251') && !txt.includes('Fulano'));
  assert.match(ctx.origem_dos_dados, /SIMULAÇÃO/);
  assert.ok(ctx.dados_ao_vivo.rpm && ctx.codigos_dtc.length === 1);
  assert.equal(ctx.manutencao, undefined, 'manutenção desligada por padrão');
  s.set('ai.shareLiveData', false);
  s.set('ai.shareDiagnostics', false);
  const ctx2 = buildAiContext({ settings: s, engine, vehicle: veh, alerts: [], dtcs: [{ code: 'P0301' }], maintenance: [] });
  assert.equal(ctx2.dados_ao_vivo, undefined);
  assert.equal(ctx2.codigos_dtc, undefined);
});

test('AiService: backend ausente, erros mapeados e resposta válida (fetch simulado)', async () => {
  const none = new AiService({ getSetting: () => '' });
  await assert.rejects(() => none.ask({ messages: [] }), (e) => e.code === 'NO_BACKEND');
  const mk = (res) => new AiService({ getSetting: (p, d) => (p === 'ai.backendUrl' ? 'http://x.test' : d), fetchFn: async () => res });
  const j = (status, body) => ({ ok: status < 400, status, json: async () => body });
  await assert.rejects(() => mk(j(503, { error: 'ai_not_configured' })).ask({}), (e) => e.code === 'NOT_CONFIGURED');
  await assert.rejects(() => mk(j(429, { error: 'rate_limited' })).ask({}), (e) => e.code === 'RATE_LIMITED');
  await assert.rejects(() => mk(j(200, { reply: '  ' })).ask({}), (e) => e.code === 'EMPTY');
  assert.equal((await mk(j(200, { reply: 'oi' })).ask({})).reply, 'oi');
  const down = new AiService({ getSetting: (p, d) => (p === 'ai.backendUrl' ? 'http://x.test' : d), fetchFn: async () => { throw new Error('offline'); } });
  await assert.rejects(() => down.ask({}), (e) => e instanceof AiError && e.code === 'NETWORK');
  assert.equal((await down.check()).ok, false);
});

test('Assistente local: responde só com dados válidos e identifica indisponíveis', () => {
  const engine = new VehicleDataEngine();
  const base = { alerts: [], dtcs: [], maintenance: [], trip: { active: false }, obdLabel: 'Conectado', internet: false, simulated: false };
  assert.match(answerLocally('qual a temperatura?', { ...base, engine }).text, /fonte de dados/i);
  engine.setSource('obd');
  assert.match(answerLocally('qual a temperatura do motor', { ...base, engine }).text, /ainda não foi lido|indisponível|não tenho/i);
  engine.ingest('obd', { coolantTemp: 92, rpm: 2100 });
  assert.match(answerLocally('qual a temperatura do motor?', { ...base, engine }).text, /92 °C/);
  assert.match(answerLocally('e a bateria?', { ...base, engine }).text, /bateria/i);
  assert.match(answerLocally('o que significa P0301', { ...base, engine }).text, /cilindro 1/i);
  assert.match(answerLocally('tem algum alerta?', { ...base, engine }).text, /Nenhum alerta/);
  assert.match(answerLocally('qual a capital da França', { ...base, engine }).text, /internet/i);
  const sim = new VehicleDataEngine();
  sim.setSource('simulation');
  sim.ingest('simulation', { rpm: 2000 });
  assert.match(answerLocally('rotação', { ...base, engine: sim, simulated: true }).text, /SIMULAÇÃO/);
});

test('Voz: palavra de ativação extrai o comando', () => {
  assert.equal(extractAfterWake('Ei BOLT, qual a temperatura', 'BOLT'), 'qual a temperatura');
  assert.equal(extractAfterWake('qual a temperatura', 'BOLT'), null);
  assert.equal(extractAfterWake('ei bolt', 'Bolt'), '');
});

test('Assistente: desligado não responde, mas alertas locais continuam; sem internet usa resposta local', async () => {
  const { s, db } = await mkSettings();
  const engine = new VehicleDataEngine();
  engine.setSource('obd');
  engine.ingest('obd', { rpm: 1500, coolantTemp: 95 });
  const spoken = [];
  const voice = { on() {}, speak: (t) => { spoken.push(t); return true; }, speaking: false };
  const conn = { online: false };
  const ai = { baseUrl: '', health: {} };
  const alertsEngine = new AlertEngine({ engine, getVehicle: () => vehicle(), now: () => Date.now() });
  const a = new Assistant({ settings: s, ai, voice, connectivity: conn, db, getContext: () => ({ engine, vehicle: vehicle(), alerts: [], dtcs: [], maintenance: [], trip: {}, obdLabel: 'Conectado', simulated: false }) });
  const r = await a.send('qual a temperatura do motor?');
  assert.match(r.text, /95 °C/);
  assert.equal(r.local, true);
  s.set('assistant.enabled', false);
  assert.equal(await a.send('oi'), null);
  engine.ingest('obd', { coolantTemp: 130 });
  await tick(1);
  const out = alertsEngine.evaluate();
  assert.ok(Array.isArray(out), 'motor de alertas independe do assistente');
  s.set('assistant.enabled', true);
  s.set('assistant.level', 'minimal');
  assert.equal(a.shouldAnnounce({ level: 'attention' }), false);
  assert.equal(a.shouldAnnounce({ level: 'critical' }), true);
  s.set('assistant.voiceEnabled', false);
  assert.equal(a.shouldAnnounce({ level: 'critical' }), false);
});

test('DataSourceController: exclusividade OBD x simulação e diagnóstico pela origem ativa', async () => {
  const engine = new VehicleDataEngine();
  const emu = new ElmEmulator();
  const obd = new ObdManager({ factories: { ble: () => emu }, sleepFn: async () => {} });
  const sim = new VehicleSimulator({ seed: 3 });
  const ds = new DataSourceController({ engine, obd, sim });
  assert.equal(ds.diagnosticSource(), null);
  await ds.connectObd('ble');
  assert.equal(ds.mode, 'obd');
  assert.equal(ds.diagnosticSource().origin, 'obd');
  assert.equal(ds.linkStatus().simulated, false);
  await ds.startSimulation(vehicle());
  assert.equal(obd.state, ObdState.IDLE, 'OBD desconectado ao entrar em simulação');
  assert.equal(ds.mode, 'simulation');
  assert.equal(ds.linkStatus().simulated, true);
  sim.setIgnition(true);
  for (let i = 0; i < 30; i++) sim.step(0.1);
  sim.emit('readings', sim.readings());
  assert.ok(engine.value('rpm') > 0);
  assert.equal(engine.records.get('rpm').source, 'simulation');
  await ds.connectObd('ble');
  assert.equal(sim.running, false, 'simulação encerrada ao conectar OBD');
  assert.equal(engine.value('rpm'), null, 'dados simulados descartados');
  await ds.disconnectObd();
  assert.equal(ds.mode, 'none');
  sim.stop();
});

test('Configurações: padrões, persistência e mesclagem de versões antigas', async () => {
  const db = await mkDb();
  const s = new Settings(db);
  await s.load();
  assert.equal(s.get('assistant.name'), 'BOLT');
  s.set('assistant.name', 'Fúria');
  s.set('layout.navCollapsed', true);
  await s.flush();
  const s2 = new Settings(db);
  await s2.load();
  assert.equal(s2.get('assistant.name'), 'Fúria');
  assert.equal(s2.get('layout.navCollapsed'), true);
  await db.put('settings', { key: 'app', value: { assistant: { name: 'X' } }, updatedAt: 1 });
  const s3 = new Settings(db);
  await s3.load();
  assert.equal(s3.get('assistant.voiceEnabled'), DEFAULT_SETTINGS.assistant.voiceEnabled);
  const c = new Connectivity({ navigator: { onLine: true } });
  c.setSimulatedOffline(true);
  assert.equal(c.online, false);
  assert.equal(c.label, 'Offline (simulado)');
});

/* ================== EXECUÇÃO ================== */
/* ---------------- Cockpit BOLT PERFORMANCE: catálogo visual de veículos ---------------- */
import * as CAT from './vehicle-catalog.js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

test('Cockpit: catálogo tem 5 modelos, 24 arquivos com os nomes exigidos e todos diretamente na raiz', () => {
  const ids = Object.keys(CAT.BOLT_VEHICLE_IMAGES);
  assert.deepEqual(ids, ['saveiro', 'renegade', 'civic2010', 'ecosport2006', 'jetta']);
  const files = CAT.allImageFiles();
  assert.equal(files.length, 24);
  assert.equal(new Set(files).size, 24);
  assert.deepEqual(CAT.colorsFor('saveiro'), ['prata', 'branco', 'preto', 'vermelho']);
  for (const id of ids.slice(1)) assert.deepEqual(CAT.colorsFor(id), ['prata', 'branco', 'preto', 'vermelho', 'azul']);
  for (const [id, v] of Object.entries(CAT.BOLT_VEHICLE_IMAGES)) for (const [c, f] of Object.entries(v.colors)) {
    assert.equal(f, `${id}_${c}.png`);
    assert.ok(!f.includes('/') && !f.includes('\\'), 'sem subpastas');
  }
});

test('Cockpit: reconhece o veículo do cadastro sem inventar ano (Civic 2010 e EcoSport 2006 exigem o ano)', () => {
  const v = (make, model, year) => ({ tech: { make, model, year } });
  assert.equal(CAT.catalogIdFor(v('Volkswagen', 'Saveiro', 2013)), 'saveiro');
  assert.equal(CAT.catalogIdFor(v('Jeep', 'Renegade', 2022)), 'renegade');
  assert.equal(CAT.catalogIdFor(v('Volkswagen', 'Jetta', 2019)), 'jetta');
  assert.equal(CAT.catalogIdFor(v('Honda', 'Civic', 2010)), 'civic2010');
  assert.equal(CAT.catalogIdFor(v('Honda', 'Civic', 2015)), null);
  assert.equal(CAT.catalogIdFor(v('Ford', 'EcoSport', 2006)), 'ecosport2006');
  assert.equal(CAT.catalogIdFor(v('Ford', 'Eco Sport', 2012)), null);
  assert.equal(CAT.catalogIdFor(v('Fiat', 'Uno', 2010)), null);
  assert.equal(CAT.catalogIdFor(null), null);
});

test('Cockpit: cor = preferência salva > cor da aparência > prata; nunca fora do catálogo', () => {
  assert.equal(CAT.colorNameFromHex('#ff0000'), 'vermelho');
  assert.equal(CAT.colorNameFromHex('#1e6fe0'), 'azul');
  assert.equal(CAT.colorNameFromHex('#2EE6D6'), null);
  assert.equal(CAT.resolveColor('saveiro', { appearanceColor: '#1e6fe0' }), 'prata'); // sem azul na Saveiro
  assert.equal(CAT.resolveColor('jetta', { appearanceColor: '#1e6fe0' }), 'azul');
  assert.equal(CAT.resolveColor('jetta', { override: 'preto', appearanceColor: '#1e6fe0' }), 'preto');
  assert.equal(CAT.resolveColor('saveiro', { override: 'azul' }), 'prata');
  const vis = CAT.resolveVehicleVisual({ tech: { make: 'Jeep', model: 'Renegade', year: 2020 }, appearance: { color: '#ffffff' } });
  assert.equal(vis.file, 'renegade_branco.png');
  assert.equal(CAT.resolveVehicleVisual({ tech: { make: 'Fiat', model: 'Uno', year: 2010 }, nickname: 'Uno' }).file, null);
});

test('Cockpit: o catálogo não altera o cadastro técnico e nenhuma subpasta de imagens existe', () => {
  const v = normalizeVehicle({ nickname: 'S', tech: { make: 'Volkswagen', model: 'Saveiro', year: 2021 } }).vehicle;
  const before = JSON.stringify(v);
  CAT.resolveVehicleVisual(v, 'prata');
  assert.equal(JSON.stringify(v), before);
  const here = dirname(fileURLToPath(import.meta.url));
  for (const f of ['vehicles', 'cars', 'images', 'assets', 'public']) assert.ok(!existsSync(join(here, f)), `não pode existir ${f}/`);
  const sw = readFileSync(join(here, 'service-worker.js'), 'utf8');
  for (const f of ['cockpit.css', 'cockpit-gauge.js', 'cockpit-stage.js', 'vehicle-catalog.js']) assert.ok(sw.includes(`./${f}`), `${f} no precache`);
  assert.ok(readdirSync(here).includes('cockpit.css'));
});

let failed = 0;
const serverMod = await import('./tests-server.mjs').catch((e) => { console.error('Falha ao carregar testes do servidor:', e); return null; });
serverMod?.serverTests({ test, assert, tick });

for (const { name, fn } of results) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err?.stack?.split('\n').slice(0, 4).join('\n       ')}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} testes passaram.`);
process.exit(failed ? 1 : 0);
