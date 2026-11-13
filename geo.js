/** Rastreador GPS opcional. A permissão só é solicitada ao iniciar (nunca no carregamento). */
import { Emitter } from './events.js';

export class GeoTracker extends Emitter {
  constructor(env = globalThis) {
    super();
    this.env = env;
    this.watchId = null;
    this.last = null;
  }

  static isSupported(env = globalThis) {
    return !!env.navigator?.geolocation;
  }

  get active() {
    return this.watchId !== null;
  }

  start() {
    if (this.active) return true;
    if (!GeoTracker.isSupported(this.env)) {
      this.emit('error', { code: 'UNSUPPORTED', message: 'Geolocalização indisponível neste navegador.' });
      return false;
    }
    this.watchId = this.env.navigator.geolocation.watchPosition(
      (p) => {
        const pt = { t: Date.now(), lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        this.last = pt;
        this.emit('point', pt);
      },
      (err) => {
        const denied = err.code === 1;
        this.emit('error', { code: denied ? 'DENIED' : 'FAILED', message: denied ? 'Permissão de localização negada.' : 'Não foi possível obter a localização.' });
        if (denied) this.stop();
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    return true;
  }

  stop() {
    if (this.watchId !== null) this.env.navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }
}
