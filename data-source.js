/**
 * Controlador de origem de dados: garante que OBD2 real e simulação sejam mutuamente
 * exclusivos e nunca se misturem, ligando cada origem ao Vehicle Data Engine.
 */
import { Emitter } from './events.js';
import { PID_TO_PARAM } from './config.js';
import { ObdState, friendlyObdError } from './obd-manager.js';

export class DataSourceController extends Emitter {
  /** @param {{engine:any, obd:any, sim:any}} deps */
  constructor({ engine, obd, sim }) {
    super();
    this.engine = engine;
    this.obd = obd;
    this.sim = sim;

    obd.on('reading', (r) => engine.ingest('obd', { [r.id]: r.value }, r.ts));
    obd.on('unsupported', (ids) => engine.markUnsupported('obd', ids));
    obd.on('supported', (ids) => engine.markSupported('obd', ids));
    obd.on('state', () => this.emit('link', this.linkStatus()));
    sim.on('readings', (r) => engine.ingest('simulation', r));
    sim.on('support', ({ supported, unsupported }) => {
      engine.markUnsupported('simulation', unsupported);
      engine.markSupported('simulation', supported.map((pid) => PID_TO_PARAM[pid]).filter(Boolean));
    });
    sim.on('link', () => this.emit('link', this.linkStatus()));
    sim.on('started', () => this.emit('link', this.linkStatus()));
    sim.on('stopped', () => this.emit('link', this.linkStatus()));
  }

  get mode() {
    return this.engine.source;
  }

  async startSimulation(vehicle) {
    if (this.obd.state !== ObdState.IDLE) await this.obd.disconnect();
    this.engine.setSource('simulation');
    if (vehicle) this.engine.setVehicle(vehicle);
    this.sim.start(vehicle);
    this.emit('mode', 'simulation');
  }

  stopSimulation() {
    this.sim.stop();
    if (this.engine.source === 'simulation') this.engine.setSource('none');
    this.emit('mode', this.engine.source);
    this.emit('link', this.linkStatus());
  }

  async connectObd(kind, opts) {
    if (this.sim.running) this.stopSimulation();
    this.engine.setSource('obd');
    this.emit('mode', 'obd');
    try {
      return await this.obd.connect(kind, opts);
    } catch (err) {
      if (this.engine.source === 'obd') this.engine.setSource('none');
      this.emit('mode', this.engine.source);
      throw err;
    }
  }

  async disconnectObd() {
    await this.obd.disconnect();
    if (this.engine.source === 'obd') this.engine.setSource('none');
    this.emit('mode', this.engine.source);
  }

  /** Fonte de diagnóstico ativa (mesma interface nos dois casos) ou null. */
  diagnosticSource() {
    if (this.engine.source === 'simulation' && this.sim.running) return { source: this.sim, origin: 'simulation' };
    if (this.engine.source === 'obd' && this.obd.isReady) return { source: this.obd, origin: 'obd' };
    return null;
  }

  /** Estado unificado do enlace OBD2 para a interface (sempre indicando se é simulado). */
  linkStatus() {
    if (this.engine.source === 'simulation') {
      const up = this.sim.running && this.sim.link;
      return { mode: 'simulation', simulated: true, state: up ? 'ready' : 'error', label: up ? 'Simulado' : 'Enlace simulado interrompido', detail: 'Dados gerados pelo Laboratório' };
    }
    const st = this.obd.status;
    const labels = {
      [ObdState.IDLE]: 'Desconectado',
      [ObdState.CONNECTING]: 'Conectando…',
      [ObdState.INITIALIZING]: 'Inicializando…',
      [ObdState.READY]: 'Conectado',
      [ObdState.RECONNECTING]: `Reconectando (${st.reconnectAttempt})…`,
      [ObdState.ERROR]: 'Falha de conexão',
    };
    return {
      mode: this.engine.source,
      simulated: false,
      state: st.state,
      label: labels[st.state] || st.state,
      detail: st.state === ObdState.ERROR ? st.lastError : st.adapterName || '',
      adapter: st.adapterName,
      protocol: st.protocol,
      readsPerSec: st.readsPerSec,
      error: st.lastError ? friendlyObdError({ message: st.lastError }) : null,
    };
  }
}
