/** Estado da internet (real + override do Laboratório para simular perda de conexão). */
import { Emitter } from './events.js';

export class Connectivity extends Emitter {
  constructor(env = globalThis) {
    super();
    this.env = env;
    this.simulatedOffline = false;
    this._real = env.navigator ? env.navigator.onLine !== false : true;
    if (env.addEventListener) {
      env.addEventListener('online', () => this.#set(true));
      env.addEventListener('offline', () => this.#set(false));
    }
  }

  #set(real) {
    const before = this.online;
    this._real = real;
    if (before !== this.online) this.emit('change', this.online);
  }

  get online() {
    return this._real && !this.simulatedOffline;
  }

  setSimulatedOffline(v) {
    const before = this.online;
    this.simulatedOffline = !!v;
    if (before !== this.online) this.emit('change', this.online);
  }

  get label() {
    if (this.simulatedOffline) return 'Offline (simulado)';
    return this.online ? 'Online' : 'Offline';
  }
}
