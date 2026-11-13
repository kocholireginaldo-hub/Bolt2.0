/**
 * Camada de protocolo ELM327/OBD2 (independente do meio de transporte).
 * Somente leitura: lista de comandos permitida, sem escrita na ECU, sem comandos não documentados.
 * O único comando de "escrita" permitido é o modo 04 (limpar DTC), exigindo confirmação explícita.
 */
import { PARAMS, PID_TO_PARAM } from './config.js';
import { Emitter } from './events.js';
import { sleep } from './utils.js';

export class ObdError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = 'ObdError';
    this.code = code;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ */
/* Segurança: lista de comandos permitidos                              */
/* ------------------------------------------------------------------ */

const AT_ALLOWED = [
  /^ATZ$/, /^ATWS$/, /^ATD$/, /^ATI$/, /^AT@1$/,
  /^ATE[01]$/, /^ATL[01]$/, /^ATS[01]$/, /^ATH[01]$/, /^ATAT[0-2]$/,
  /^ATSP[0-9A-C]$/, /^ATDPN?$/, /^ATRV$/, /^ATST[0-9A-F]{1,2}$/, /^ATCAF[01]$/,
];
const OBD_READ_ALLOWED = [
  /^01[0-9A-F]{2}$/, // modo 01: dados atuais
  /^02[0-9A-F]{2}[0-9A-F]{2}$/, // modo 02: freeze frame (PID + quadro)
  /^03$/, /^07$/, /^0A$/, // DTC armazenados/pendentes/permanentes
  /^09(00|02|04|0A)$/, // modo 09: VIN, Cal ID, nome ECU
];

/**
 * @param {string} cmd comando sem espaços
 * @param {{allowClear?:boolean}} opts
 */
export function isCommandAllowed(cmd, { allowClear = false } = {}) {
  const c = String(cmd).replace(/\s+/g, '').toUpperCase();
  if (c === '04') return allowClear;
  return AT_ALLOWED.some((r) => r.test(c)) || OBD_READ_ALLOWED.some((r) => r.test(c));
}

/* ------------------------------------------------------------------ */
/* Decodificação                                                        */
/* ------------------------------------------------------------------ */

const ERR_MAP = {
  NODATA: ['NO_DATA', 'Sem dados (parâmetro sem resposta no momento)'],
  UNABLETOCONNECT: ['UNABLE_TO_CONNECT', 'Não foi possível conectar à ECU (ignição desligada?)'],
  CANERROR: ['BUS_ERROR', 'Erro no barramento CAN'],
  BUSERROR: ['BUS_ERROR', 'Erro de barramento'],
  BUSBUSY: ['BUS_ERROR', 'Barramento ocupado'],
  FBERROR: ['BUS_ERROR', 'Erro de barramento (FB)'],
  DATAERROR: ['BUS_ERROR', 'Erro de dados'],
  BUFFERFULL: ['BUS_ERROR', 'Buffer do adaptador cheio'],
  LVRESET: ['BUS_ERROR', 'Adaptador reiniciou por baixa tensão'],
  STOPPED: ['ABORTED', 'Operação interrompida'],
  ACTALERT: ['BUS_ERROR', 'Alerta de atividade no barramento'],
  '?': ['UNKNOWN_COMMAND', 'Comando não reconhecido pelo adaptador'],
};

export const hexToBytes = (s) => {
  const clean = s.replace(/[^0-9A-Fa-f]/g, '');
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
};
export const bytesToHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/** Limpa a resposta bruta do ELM327 em linhas úteis; lança ObdError para erros conhecidos. */
export function parseReply(raw, cmd = '') {
  const lines = String(raw)
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  const echo = cmd.replace(/\s+/g, '').toUpperCase();
  for (const line of lines) {
    const key = line.replace(/\s+/g, '').toUpperCase();
    if (key === echo) continue;
    if (key.startsWith('SEARCHING') || key.startsWith('BUSINIT')) continue;
    if (key === 'OK') {
      out.push(line);
      continue;
    }
    if (ERR_MAP[key]) throw new ObdError(ERR_MAP[key][0], ERR_MAP[key][1], line);
    if (key.includes('UNABLETOCONNECT')) throw new ObdError('UNABLE_TO_CONNECT', ERR_MAP.UNABLETOCONNECT[1], line);
    out.push(line);
  }
  return out;
}

/**
 * Converte linhas em quadros de bytes. Suporta resposta multi-quadro CAN
 * ("014" + "0:...", "1:...") e respostas legadas (uma linha por quadro).
 */
export function assembleFrames(lines) {
  const hasIso = lines.some((l) => /^[0-9A-F]:/i.test(l.replace(/\s+/g, '')));
  if (hasIso) {
    const bytes = [];
    for (const l of lines) {
      const k = l.replace(/\s+/g, '');
      if (/^[0-9A-F]:/i.test(k)) bytes.push(...hexToBytes(k.slice(2)));
    }
    return [bytes];
  }
  return lines
    .map((l) => l.replace(/\s+/g, ''))
    .filter((k) => /^[0-9A-F]+$/i.test(k) && k.length >= 2 && k.length % 2 === 0)
    .map(hexToBytes);
}

const PID_DECODERS = {
  '04': (b) => ({ id: 'engineLoad', value: (b[0] * 100) / 255 }),
  '05': (b) => ({ id: 'coolantTemp', value: b[0] - 40 }),
  '0C': (b) => ({ id: 'rpm', value: (b[0] * 256 + b[1]) / 4 }),
  '0D': (b) => ({ id: 'speed', value: b[0] }),
  '0F': (b) => ({ id: 'intakeTemp', value: b[0] - 40 }),
  10: (b) => ({ id: 'maf', value: (b[0] * 256 + b[1]) / 100 }),
  11: (b) => ({ id: 'throttle', value: (b[0] * 100) / 255 }),
  '2F': (b) => ({ id: 'fuelLevel', value: (b[0] * 100) / 255 }),
  42: (b) => ({ id: 'batteryVoltage', value: (b[0] * 256 + b[1]) / 1000 }),
  '5E': (b) => ({ id: 'fuelRate', value: (b[0] * 256 + b[1]) / 20 }),
};
const PID_LENGTH = { '04': 1, '05': 1, '0C': 2, '0D': 1, '0F': 1, 10: 2, 11: 1, '2F': 1, 42: 2, '5E': 2 };

/** Decodifica o payload (bytes de dados, sem 41/PID) de um PID conhecido. */
export function decodePid(pid, data) {
  const key = pid.toUpperCase();
  const dec = PID_DECODERS[key];
  if (!dec) return null;
  if (data.length < PID_LENGTH[key]) return null;
  const r = dec(data);
  return { ...r, unit: PARAMS[r.id].unit, pid: key };
}

/** Bitmap de PIDs suportados (modos 0100/0120/0140...). Devolve lista de PIDs em hex. */
export function parseSupportedPids(basePid, data) {
  const out = [];
  for (let i = 0; i < 32; i++) {
    const byte = data[Math.floor(i / 8)];
    if (byte == null) break;
    if (byte & (0x80 >> (i % 8))) out.push((basePid + i + 1).toString(16).toUpperCase().padStart(2, '0'));
  }
  return out;
}

export function decodeDtc(b1, b2) {
  const type = ['P', 'C', 'B', 'U'][(b1 >> 6) & 3];
  const d2 = (b1 >> 4) & 3;
  const d3 = (b1 & 0xf).toString(16).toUpperCase();
  const rest = b2.toString(16).toUpperCase().padStart(2, '0');
  return `${type}${d2}${d3}${rest}`;
}

/** Extrai DTCs de quadros de resposta aos modos 03/07/0A. */
export function parseDtcFrames(frames, responseMode) {
  const codes = [];
  for (const f of frames) {
    if (f[0] !== responseMode) continue;
    let payload = f.slice(1);
    if (payload.length % 2 === 1) payload = payload.slice(1); // byte de contagem (CAN)
    for (let i = 0; i + 1 < payload.length; i += 2) {
      if (payload[i] === 0 && payload[i + 1] === 0) continue;
      const code = decodeDtc(payload[i], payload[i + 1]);
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return codes;
}

const SPARK_MONITORS = [
  ['Falha de ignição (misfire)', 0],
  ['Sistema de combustível', 1],
  ['Componentes abrangentes', 2],
];
const SPARK_C = ['Catalisador', 'Catalisador aquecido', 'Sistema EVAP', 'Ar secundário', 'Refrigerante do A/C', 'Sensor de oxigênio', 'Aquecedor do sensor de O2', 'EGR / VVT'];
const COMPRESSION_C = ['Catalisador NMHC', 'Pós-tratamento NOx/SCR', null, 'Pressão de turbo', null, 'Sensor de gases de escape', 'Filtro de particulados', 'EGR / VVT'];

/** Interpreta o PID 0101 (status do monitor). */
export function parseMonitorStatus(data) {
  if (data.length < 4) return null;
  const [a, b, c, d] = data;
  const compression = !!(b & 0x08);
  const monitors = [];
  for (const [name, bit] of SPARK_MONITORS) {
    if (b & (1 << bit)) monitors.push({ name, complete: !(b & (1 << (bit + 4))) });
  }
  const names = compression ? COMPRESSION_C : SPARK_C;
  names.forEach((name, bit) => {
    if (!name) return;
    if (c & (1 << bit)) monitors.push({ name, complete: !(d & (1 << bit)) });
  });
  return { milOn: !!(a & 0x80), dtcCount: a & 0x7f, ignition: compression ? 'compression' : 'spark', monitors };
}

export function parseVin(bytes) {
  const text = bytes
    .filter((b) => b >= 0x30 && b <= 0x5a)
    .map((b) => String.fromCharCode(b))
    .join('');
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(text.slice(-17)) ? text.slice(-17) : text.length >= 11 ? text : null;
}

export const PROTOCOL_NAMES = {
  1: 'SAE J1850 PWM', 2: 'SAE J1850 VPW', 3: 'ISO 9141-2', 4: 'ISO 14230-4 KWP (5 baud)', 5: 'ISO 14230-4 KWP (rápido)',
  6: 'ISO 15765-4 CAN (11 bits, 500 kbps)', 7: 'ISO 15765-4 CAN (29 bits, 500 kbps)', 8: 'ISO 15765-4 CAN (11 bits, 250 kbps)',
  9: 'ISO 15765-4 CAN (29 bits, 250 kbps)', A: 'SAE J1939 CAN',
};

/* ------------------------------------------------------------------ */
/* Sessão ELM327                                                        */
/* ------------------------------------------------------------------ */

/**
 * Transporte esperado: { open(), close(), write(text), onData(fn), onClose(fn) }.
 * As requisições são serializadas em fila (uma por vez), com timeout individual.
 */
export class Elm327Session extends Emitter {
  constructor(transport, { timeoutMs = 3000 } = {}) {
    super();
    this.t = transport;
    this.timeoutMs = timeoutMs;
    this.buf = '';
    this.waiter = null;
    this.queue = Promise.resolve();
    this.closed = false;
    this.supportedPids = new Set();
    this.protocol = null;
    this.adapter = null;
    this.t.onData((chunk) => this.#onData(chunk));
    this.t.onClose?.((reason) => this.#onClose(reason));
  }

  #onData(chunk) {
    this.buf += String(chunk).replace(/\0/g, '');
    const idx = this.buf.indexOf('>');
    if (idx >= 0 && this.waiter) {
      const raw = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.resolve(raw);
    } else if (idx >= 0) {
      this.buf = this.buf.slice(idx + 1);
    }
  }

  #onClose(reason) {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(new ObdError('TRANSPORT', 'Conexão com o adaptador perdida', reason));
    }
    this.emit('close', reason);
  }

  /** Envia um comando e devolve as linhas úteis da resposta. */
  request(cmd, { timeout = this.timeoutMs, allowClear = false } = {}) {
    const clean = String(cmd).replace(/\s+/g, '').toUpperCase();
    if (!isCommandAllowed(clean, { allowClear })) {
      return Promise.reject(new ObdError('NOT_ALLOWED', `Comando bloqueado por segurança: ${clean}`));
    }
    const p = this.queue.then(() => this.#exec(clean, timeout));
    this.queue = p.catch(() => {});
    return p;
  }

  async #exec(cmd, timeout) {
    if (this.closed) throw new ObdError('TRANSPORT', 'Sessão encerrada');
    this.buf = '';
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new ObdError('TIMEOUT', `Tempo esgotado aguardando resposta a ${cmd}`));
      }, timeout);
      this.waiter = { resolve, reject, timer };
    });
    try {
      await this.t.write(`${cmd}\r`);
    } catch (err) {
      if (this.waiter) {
        clearTimeout(this.waiter.timer);
        this.waiter = null;
      }
      throw new ObdError('TRANSPORT', 'Falha ao escrever no adaptador', err?.message);
    }
    let raw;
    try {
      raw = await reply;
    } catch (err) {
      if (err.code === 'TIMEOUT' && !this.closed) {
        try {
          await this.t.write('\r'); // interrompe qualquer operação pendente no adaptador
          await sleep(150);
        } catch {
          /* ignora */
        }
      }
      throw err;
    }
    return parseReply(raw, cmd);
  }

  /** Sequência de inicialização padrão (somente comandos AT de configuração). */
  async init({ onStep } = {}) {
    onStep?.('Reiniciando adaptador');
    let zLines = [];
    try {
      zLines = await this.request('ATZ', { timeout: 6000 });
    } catch (e) {
      if (e.code !== 'UNKNOWN_COMMAND') throw e;
    }
    void zLines;
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0']) {
      onStep?.(`Configurando (${c})`);
      await this.request(c, { timeout: 4000 });
    }
    try {
      const id = await this.request('ATI', { timeout: 3000 });
      this.adapter = id.join(' ') || null;
    } catch {
      this.adapter = null;
    }
    onStep?.('Detectando protocolo do veículo');
    await this.#discoverSupported();
    try {
      const dp = await this.request('ATDPN', { timeout: 3000 });
      const code = (dp[0] || '').replace(/^A/i, '').trim().toUpperCase();
      this.protocol = PROTOCOL_NAMES[code] || PROTOCOL_NAMES[code.charAt(0)] || dp[0] || null;
    } catch {
      this.protocol = null;
    }
    return { adapter: this.adapter, protocol: this.protocol, supportedPids: [...this.supportedPids] };
  }

  async #discoverSupported() {
    this.supportedPids.clear();
    let base = 0x00;
    for (let i = 0; i < 3; i++) {
      const pidHex = base.toString(16).toUpperCase().padStart(2, '0');
      const lines = await this.request(`01${pidHex}`, { timeout: i === 0 ? 15000 : 4000 });
      const data = this.#extract(lines, 0x41, pidHex);
      if (!data) break;
      const list = parseSupportedPids(base, data);
      list.forEach((p) => this.supportedPids.add(p));
      if (!list.includes((base + 0x20).toString(16).toUpperCase().padStart(2, '0'))) break;
      base += 0x20;
    }
  }

  /** Procura quadro 41 PID e devolve os bytes de dados. */
  #extract(lines, respMode, pidHex) {
    const pid = parseInt(pidHex, 16);
    for (const f of assembleFrames(lines)) {
      if (f[0] === respMode && f[1] === pid) return f.slice(2);
    }
    return null;
  }

  isSupported(pidHex) {
    return this.supportedPids.has(pidHex.toUpperCase());
  }

  async readPid(pidHex) {
    const pid = pidHex.toUpperCase();
    const lines = await this.request(`01${pid}`, { timeout: 2500 });
    const data = this.#extract(lines, 0x41, pid);
    if (!data) throw new ObdError('NO_DATA', `Resposta inválida para o PID ${pid}`);
    const dec = decodePid(pid, data);
    if (!dec) throw new ObdError('UNSUPPORTED', `PID ${pid} não decodificável`);
    return dec;
  }

  async #readDtcMode(mode, respMode) {
    try {
      const lines = await this.request(mode, { timeout: 6000 });
      return parseDtcFrames(assembleFrames(lines), respMode);
    } catch (e) {
      if (e.code === 'NO_DATA') return [];
      throw e;
    }
  }

  async readStoredDtcs() {
    return this.#readDtcMode('03', 0x43);
  }
  async readPendingDtcs() {
    return this.#readDtcMode('07', 0x47);
  }
  async readPermanentDtcs() {
    return this.#readDtcMode('0A', 0x4a);
  }

  async readMonitorStatus() {
    const lines = await this.request('0101', { timeout: 4000 });
    const data = this.#extract(lines, 0x41, '01');
    return data ? parseMonitorStatus(data) : null;
  }

  /** Freeze Frame (modo 02, quadro 0). Retorna null quando não há dados. */
  async readFreezeFrame() {
    let dtc = null;
    try {
      const lines = await this.request('020200', { timeout: 4000 });
      const f = assembleFrames(lines).find((x) => x[0] === 0x42 && x[1] === 0x02);
      if (f && f.length >= 5) dtc = f[3] === 0 && f[4] === 0 ? null : decodeDtc(f[3], f[4]);
    } catch (e) {
      if (e.code !== 'NO_DATA') throw e;
    }
    if (!dtc) return null;
    const params = {};
    for (const pid of ['04', '05', '0C', '0D', '0F', '11']) {
      try {
        const lines = await this.request(`02${pid}00`, { timeout: 3000 });
        const f = assembleFrames(lines).find((x) => x[0] === 0x42 && x[1] === parseInt(pid, 16));
        const dec = f ? decodePid(pid, f.slice(3)) : null;
        if (dec) params[dec.id] = { value: dec.value, unit: dec.unit };
      } catch (e) {
        if (e.code !== 'NO_DATA') throw e;
      }
    }
    return { dtc, params };
  }

  async readVin() {
    try {
      const lines = await this.request('0902', { timeout: 6000 });
      const frames = assembleFrames(lines);
      const bytes = [];
      for (const f of frames) {
        const i = f[0] === 0x49 && f[1] === 0x02 ? 3 : 0;
        bytes.push(...f.slice(i));
      }
      return parseVin(bytes);
    } catch (e) {
      if (e.code === 'NO_DATA') return null;
      throw e;
    }
  }

  /** Modo 04 — limpar DTC e dados de freeze frame. Exige confirmed=true. */
  async clearDtcs({ confirmed = false } = {}) {
    if (confirmed !== true) throw new ObdError('NOT_ALLOWED', 'Limpeza de códigos exige confirmação explícita');
    const lines = await this.request('04', { timeout: 6000, allowClear: true });
    const ok = assembleFrames(lines).some((f) => f[0] === 0x44);
    if (!ok) throw new ObdError('PROTOCOL', 'A ECU não confirmou a limpeza dos códigos');
    return true;
  }

  async close() {
    this.closed = true;
    try {
      await this.t.close();
    } catch {
      /* ignora */
    }
  }
}

export { PID_TO_PARAM };
