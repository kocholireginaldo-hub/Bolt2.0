/**
 * OBD Communication Manager.
 * Independe do adaptador: recebe transportes (BLE, Wi-Fi, SPP/nativo) por fábricas.
 * Responsável por: conexão, inicialização, verificação de suporte, escalonamento de leituras,
 * timeouts, reconexão automática e tratamento de erros. Modo somente leitura.
 */
import { PARAMS, PID_TO_PARAM } from './config.js';
import { Emitter } from './events.js';
import { sleep } from './utils.js';
import { Elm327Session, ObdError } from './obd-protocol.js';
import { BleTransport } from './obd-ble.js';
import { WifiTransport } from './obd-wifi.js';
import { NativeBridgeTransport } from './obd-native.js';
import { ADAPTER_KINDS, PLATFORM_HINT } from './obd-transport.js';

export const ObdState = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  INITIALIZING: 'initializing',
  READY: 'ready',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
});

const FRIENDLY = {
  UNABLE_TO_CONNECT: 'O adaptador respondeu, mas a ECU não. Ligue a ignição (ou o motor) e tente novamente.',
  TIMEOUT: 'O adaptador não respondeu a tempo.',
  TRANSPORT: 'Falha de comunicação com o adaptador.',
  UNSUPPORTED: 'Recurso não suportado neste ambiente.',
  ABORTED: 'Operação cancelada.',
  BUS_ERROR: 'Erro no barramento do veículo.',
  NOT_ALLOWED: 'Operação bloqueada por segurança.',
};
export const friendlyObdError = (e) => (e instanceof ObdError ? FRIENDLY[e.code] || e.message : e?.message || 'Erro desconhecido');

export class ObdManager extends Emitter {
  #session = null;
  #transport = null;
  #loopId = 0;
  #userDisconnect = true;
  #next = new Map();
  #nodata = new Map();
  #diagBusy = 0;
  #reads = [];
  #reconnectToken = 0;

  /**
   * @param {{settings?:any, factories?:Record<string,Function>, backoffMs?:number[], maxAttempts?:number, sleepFn?:Function, now?:()=>number, sessionOptions?:any}} deps
   */
  constructor({ settings = null, factories = {}, backoffMs = [1000, 2000, 4000, 8000, 15000], maxAttempts = 8, sleepFn = sleep, now = () => Date.now(), sessionOptions = {} } = {}) {
    super();
    this.settings = settings;
    this.backoffMs = backoffMs;
    this.maxAttempts = maxAttempts;
    this.sleep = sleepFn;
    this.now = now;
    this.sessionOptions = sessionOptions;
    this.factories = {
      ble: () => new BleTransport(),
      wifi: (o) => new WifiTransport(this.#wifiOptions(o)),
      spp: (o) => new NativeBridgeTransport({ mode: 'spp', ...o }),
      native: (o) => new NativeBridgeTransport({ mode: o?.mode || 'ble', ...o }),
      ...factories,
    };
    this.logLines = [];
    this.state = ObdState.IDLE;
    this.info = { kind: null, adapterName: null, adapter: null, protocol: null, supportedPids: [], lastError: null, reconnectAttempt: 0, lastDataTs: null, readsPerSec: 0 };
  }

  #wifiOptions(o = {}) {
    const s = this.settings;
    return {
      mode: s?.get('obd.wifiMode', 'bridge'),
      host: s?.get('obd.wifiHost', '192.168.0.10'),
      port: s?.get('obd.wifiPort', 35000),
      bridgeUrl: s?.get('obd.bridgeUrl', ''),
      bridgeToken: s?.get('obd.bridgeToken', ''),
      wsUrl: s?.get('obd.wsUrl', ''),
      ...o,
    };
  }

  get status() {
    return { state: this.state, ...this.info };
  }

  get isReady() {
    return this.state === ObdState.READY;
  }

  /** Disponibilidade honesta de cada tipo de adaptador neste ambiente. */
  availability(env = globalThis) {
    return ADAPTER_KINDS.map((k) => {
      let supported = true;
      let reason = '';
      if (k.kind === 'ble') {
        supported = BleTransport.isSupported(env);
        reason = supported ? '' : BleTransport.unsupportedReason(env) || PLATFORM_HINT.ble;
      } else if (k.kind === 'spp') {
        supported = NativeBridgeTransport.isSupported('spp', env);
        reason = supported ? '' : PLATFORM_HINT.spp;
      } else if (k.kind === 'native') {
        supported = NativeBridgeTransport.isSupported('native', env);
        reason = supported ? '' : PLATFORM_HINT.native;
      } else if (k.kind === 'wifi') {
        reason = PLATFORM_HINT.wifi;
      }
      return { ...k, supported, reason };
    });
  }

  #log(text, level = 'info') {
    const line = { ts: this.now(), level, text };
    this.logLines.push(line);
    if (this.logLines.length > 200) this.logLines.shift();
    this.emit('log', line);
  }

  #setState(state, patch = {}) {
    this.state = state;
    Object.assign(this.info, patch);
    this.emit('state', this.status);
  }

  async connect(kind, opts = {}) {
    if (this.state !== ObdState.IDLE && this.state !== ObdState.ERROR) await this.disconnect();
    const factory = this.factories[kind];
    if (!factory) throw new ObdError('UNSUPPORTED', `Adaptador desconhecido: ${kind}`);
    this.#userDisconnect = false;
    this.#reconnectToken++;
    this.#setState(ObdState.CONNECTING, { kind, lastError: null, reconnectAttempt: 0, supportedPids: [], protocol: null, adapter: null });
    this.#log(`Conectando via ${kind}…`);
    try {
      this.#transport = factory(opts);
      await this.#transport.open();
      this.info.adapterName = this.#transport.name || null;
      await this.#startSession();
      return this.status;
    } catch (err) {
      this.#log(`Falha: ${friendlyObdError(err)}`, 'error');
      await this.#teardown();
      this.#userDisconnect = true;
      this.#setState(ObdState.ERROR, { lastError: friendlyObdError(err) });
      throw err;
    }
  }

  async #startSession() {
    this.#setState(ObdState.INITIALIZING);
    const session = new Elm327Session(this.#transport, this.sessionOptions);
    this.#session = session;
    session.on('close', (reason) => {
      if (this.#session === session) this.#handleLoss(String(reason || 'Conexão encerrada'));
    });
    const res = await session.init({ onStep: (s) => this.#log(s) });
    this.#log(`Protocolo: ${res.protocol || 'desconhecido'} — ${res.supportedPids.length} PIDs suportados`);
    const supported = new Set(res.supportedPids);
    const known = supported.size > 0;
    const unsupported = Object.entries(PARAMS)
      .filter(([, d]) => known && !supported.has(d.pid))
      .map(([id]) => id);
    this.info.supportedPids = res.supportedPids;
    this.info.protocol = res.protocol;
    this.info.adapter = res.adapter;
    this.#next.clear();
    this.#nodata.clear();
    this.#setState(ObdState.READY, { lastError: null, reconnectAttempt: 0 });
    if (unsupported.length) this.emit('unsupported', unsupported);
    this.emit('supported', Object.entries(PARAMS).filter(([, d]) => !known || supported.has(d.pid)).map(([id]) => id));
    this.#startPolling(session, known ? supported : null);
  }

  #pollIds(supported) {
    return Object.entries(PARAMS)
      .filter(([, d]) => (supported ? supported.has(d.pid) : d.core))
      .map(([id]) => id);
  }

  #startPolling(session, supported) {
    const loop = ++this.#loopId;
    const ids = this.#pollIds(supported);
    let consecutiveErrors = 0;
    (async () => {
      while (this.#loopId === loop && this.state === ObdState.READY) {
        if (this.#diagBusy > 0) {
          await sleep(40);
          continue;
        }
        const now = this.now();
        let best = null;
        let bestLate = -Infinity;
        for (const id of ids) {
          const late = now - (this.#next.get(id) || 0);
          if (late >= 0 && late > bestLate) {
            best = id;
            bestLate = late;
          }
        }
        if (!best) {
          await sleep(25);
          continue;
        }
        const def = PARAMS[best];
        try {
          const r = await session.readPid(def.pid);
          if (this.#loopId !== loop) return;
          consecutiveErrors = 0;
          this.#nodata.set(best, 0);
          this.#next.set(best, this.now() + def.intervalMs);
          this.#trackRate();
          this.info.lastDataTs = this.now();
          this.emit('reading', { id: r.id, value: r.value, unit: r.unit, pid: r.pid, ts: this.info.lastDataTs });
        } catch (err) {
          if (this.#loopId !== loop) return;
          if (err.code === 'NO_DATA' || err.code === 'UNKNOWN_COMMAND') {
            const n = (this.#nodata.get(best) || 0) + 1;
            this.#nodata.set(best, n);
            this.#next.set(best, this.now() + def.intervalMs * 4);
            if (!supported && n >= 5) {
              ids.splice(ids.indexOf(best), 1);
              this.emit('unsupported', [best]);
              this.#log(`PID ${def.pid} (${def.label}) sem resposta: marcado como indisponível`, 'warn');
            }
          } else if (err.code === 'NOT_ALLOWED') {
            ids.splice(ids.indexOf(best), 1);
          } else {
            consecutiveErrors++;
            this.#next.set(best, this.now() + 300);
            this.#log(`Erro ao ler ${def.pid}: ${friendlyObdError(err)}`, 'warn');
            if (err.code === 'TRANSPORT' || consecutiveErrors >= 3) {
              this.#handleLoss(consecutiveErrors >= 3 ? 'Sem resposta do adaptador' : friendlyObdError(err));
              return;
            }
          }
        }
      }
    })();
  }

  #trackRate() {
    const t = this.now();
    this.#reads.push(t);
    while (this.#reads.length && t - this.#reads[0] > 5000) this.#reads.shift();
    this.info.readsPerSec = Math.round((this.#reads.length / 5) * 10) / 10;
  }

  #handleLoss(reason) {
    if (this.#userDisconnect || this.state === ObdState.IDLE || this.state === ObdState.RECONNECTING) return;
    this.#loopId++;
    this.#log(`Conexão perdida: ${reason}`, 'warn');
    const canReopen = typeof this.#transport?.reopen === 'function';
    if (this.settings?.get('obd.autoReconnect', true) !== false && canReopen) {
      this.#reconnect();
    } else {
      this.#teardown().finally(() => this.#setState(ObdState.ERROR, { lastError: `Conexão perdida: ${reason}` }));
    }
  }

  async #reconnect() {
    const token = ++this.#reconnectToken;
    this.#setState(ObdState.RECONNECTING, { reconnectAttempt: 0 });
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const wait = this.backoffMs[Math.min(attempt - 1, this.backoffMs.length - 1)];
      this.info.reconnectAttempt = attempt;
      this.emit('state', this.status);
      await this.sleep(wait);
      if (token !== this.#reconnectToken || this.#userDisconnect) return;
      try {
        this.#log(`Reconectando (tentativa ${attempt}/${this.maxAttempts})…`);
        await this.#session?.close().catch(() => {});
        await this.#transport.reopen();
        await this.#startSession();
        this.#log('Reconectado.');
        this.emit('reconnected', this.status);
        return;
      } catch (err) {
        this.info.lastError = friendlyObdError(err);
        this.#log(`Tentativa ${attempt} falhou: ${this.info.lastError}`, 'warn');
      }
    }
    if (token !== this.#reconnectToken) return;
    await this.#teardown();
    this.#setState(ObdState.ERROR, { lastError: 'Não foi possível reconectar. Verifique o adaptador e conecte novamente.' });
  }

  async #teardown() {
    this.#loopId++;
    const s = this.#session;
    const t = this.#transport;
    this.#session = null;
    try {
      await s?.close();
    } catch {
      /* ignora */
    }
    if (!s && t) {
      try {
        await t.close();
      } catch {
        /* ignora */
      }
    }
  }

  async disconnect() {
    this.#userDisconnect = true;
    this.#reconnectToken++;
    await this.#teardown();
    this.#transport = null;
    this.#log('Desconectado.');
    this.#setState(ObdState.IDLE, { lastError: null, reconnectAttempt: 0, readsPerSec: 0, adapterName: null });
  }

  /* ------------------------------------------------------------------ */
  /* Interface de diagnóstico (mesmo contrato do simulador)               */
  /* ------------------------------------------------------------------ */

  async #diag(fn) {
    if (!this.#session || this.state !== ObdState.READY) throw new ObdError('TRANSPORT', 'OBD2 não está conectado.');
    this.#diagBusy++;
    try {
      return await fn(this.#session);
    } finally {
      this.#diagBusy--;
    }
  }

  readDtcs() {
    return this.#diag(async (s) => {
      const soft = async (p) => {
        try {
          return await p();
        } catch (e) {
          if (['NO_DATA', 'UNKNOWN_COMMAND', 'BUS_ERROR'].includes(e.code)) return [];
          throw e;
        }
      };
      return {
        stored: await s.readStoredDtcs(),
        pending: await soft(() => s.readPendingDtcs()),
        permanent: await soft(() => s.readPermanentDtcs()),
      };
    });
  }

  readMonitorStatus() {
    return this.#diag((s) => s.readMonitorStatus());
  }
  readFreezeFrame() {
    return this.#diag((s) => s.readFreezeFrame());
  }
  readVin() {
    return this.#diag((s) => s.readVin());
  }
  clearDtcs({ confirmed = false } = {}) {
    return this.#diag((s) => s.clearDtcs({ confirmed }));
  }

  /** Sonda operações de leitura (não destrutivas). A limpeza (modo 04) não é testada. */
  capabilities() {
    return this.#diag(async (s) => {
      const probe = async (fn) => {
        try {
          const r = await fn();
          return { status: 'available', value: r };
        } catch (e) {
          if (['NO_DATA', 'UNKNOWN_COMMAND'].includes(e.code)) return { status: 'unsupported' };
          return { status: 'error', note: friendlyObdError(e) };
        }
      };
      const monitors = await probe(() => s.readMonitorStatus());
      const stored = await probe(() => s.readStoredDtcs());
      const pending = await probe(() => s.readPendingDtcs());
      const permanent = await probe(() => s.readPermanentDtcs());
      const freeze = await probe(() => s.readFreezeFrame());
      const vin = await probe(() => s.readVin());
      return {
        simulated: false,
        adapter: this.info.adapter,
        protocol: this.info.protocol,
        pids: this.info.supportedPids,
        vin: vin.value || null,
        operations: [
          { id: 'monitors', label: 'Status dos monitores (prontidão)', status: monitors.status, note: monitors.note },
          { id: 'stored', label: 'Ler códigos armazenados (modo 03)', status: stored.status, note: stored.note },
          { id: 'pending', label: 'Ler códigos pendentes (modo 07)', status: pending.status, note: pending.note },
          { id: 'permanent', label: 'Ler códigos permanentes (modo 0A)', status: permanent.status, note: permanent.note },
          { id: 'freeze', label: 'Freeze Frame (modo 02)', status: freeze.status === 'available' && !freeze.value ? 'empty' : freeze.status, note: freeze.note },
          { id: 'vin', label: 'Número do chassi / VIN (modo 09)', status: vin.value ? 'available' : vin.status === 'available' ? 'empty' : vin.status, note: vin.note },
          {
            id: 'clear',
            label: 'Limpar códigos (modo 04)',
            status: stored.status === 'available' ? 'untested' : 'unsupported',
            note: 'Não testado para não alterar dados da ECU. Exige confirmação ao executar.',
          },
        ],
      };
    });
  }

  paramForPid(pid) {
    return PID_TO_PARAM[pid.toUpperCase()] || null;
  }
}
