/**
 * Viagens: registro de distância, duração, velocidade média e consumo ESTIMADO, com percurso GPS
 * opcional (somente com permissão e somente em viagens reais). Histórico separado por veículo e
 * por origem (real x simulação).
 */
import { Emitter } from './events.js';
import { clamp, uid, haversineKm, fmtDate } from './utils.js';

const AUTOSAVE_MS = 15000;
const MAX_POINTS = 6000;

export function finalizeTrip(t) {
  const hours = t.movingSec / 3600;
  return {
    ...t,
    avgSpeedKmh: hours > 0 ? t.distanceKm / hours : 0,
    avgKmL: t.fuelL > 0.0005 && t.fuelDistanceKm > 0 ? t.fuelDistanceKm / t.fuelL : null,
  };
}

export class TripRecorder extends Emitter {
  /**
   * @param {{engine:any, db:any, getSetting:(p:string,d?:any)=>any, getVehicle:()=>any, geo?:any, now?:()=>number}} deps
   */
  constructor({ engine, db, getSetting, getVehicle, geo = null, now = () => Date.now() }) {
    super();
    this.engine = engine;
    this.db = db;
    this.getSetting = getSetting;
    this.getVehicle = getVehicle;
    this.geo = geo;
    this.now = now;
    this.cur = null;
    this.lastTick = null;
    this.lastSave = 0;
    this.stoppedSec = 0;
    this.engineOffSec = 0;
    this.gapSec = 0;
    this.offPoint = null;
    if (geo) geo.on('point', (p) => this.#onGeoPoint(p));
  }

  /** Recupera viagens interrompidas (aplicativo fechado durante a gravação). */
  async recover() {
    const rows = await this.db.where('trips', (t) => t.inProgress);
    for (const r of rows) {
      const done = finalizeTrip({ ...r, inProgress: false, stopReason: 'Interrompida (aplicativo encerrado)', endedAt: r.updatedAt || r.startedAt });
      await this.db.put('trips', done);
    }
    return rows.length;
  }

  get active() {
    return !!this.cur;
  }

  /** Resumo ao vivo (para o painel). */
  summary() {
    if (!this.cur) return { active: false };
    return { active: true, ...finalizeTrip(this.cur), points: undefined, manual: this.cur.manual };
  }

  start({ manual = false } = {}) {
    if (this.cur) return this.cur;
    const src = this.engine.source;
    if (src === 'none') throw new Error('Sem fonte de dados: conecte o OBD2 ou ative a simulação.');
    const t = this.now();
    const veh = this.getVehicle();
    this.cur = {
      id: uid('trip'),
      vehicleId: veh?.id ?? null,
      origin: src,
      manual,
      startedAt: t,
      endedAt: null,
      distanceKm: 0,
      totalSec: 0,
      movingSec: 0,
      maxSpeed: 0,
      fuelL: 0,
      fuelDistanceKm: 0,
      fuelMethod: null,
      points: [],
      inProgress: true,
      stopReason: null,
      createdAt: t,
      updatedAt: t,
    };
    this.lastTick = t;
    this.lastSave = t;
    this.stoppedSec = 0;
    this.engineOffSec = 0;
    this.gapSec = 0;
    if (src === 'obd' && this.getSetting('trips.gps', false) && this.geo) this.geo.start();
    this.emit('started', this.cur);
    return this.cur;
  }

  async stop(reason = 'Encerrada pelo usuário') {
    const trip = this.cur;
    if (!trip) return null;
    this.cur = null;
    this.geo?.stop();
    const t = this.now();
    const done = finalizeTrip({ ...trip, endedAt: t, updatedAt: t, inProgress: false, stopReason: reason });
    const tooShort = !trip.manual && done.distanceKm < 0.05 && done.totalSec < 30;
    if (tooShort) {
      await this.db.delete('trips', done.id);
      this.emit('discarded', done);
      return null;
    }
    await this.db.put('trips', done);
    this.emit('stopped', done);
    return done;
  }

  /** Chamar ~1x/s. */
  async tick() {
    const t = this.now();
    const e = this.engine;
    if (e.source === 'none') {
      if (this.cur) await this.stop('Fonte de dados encerrada');
      this.lastTick = t;
      return;
    }
    const speed = e.value('speed');
    if (!this.cur) {
      if (this.getSetting('trips.autoRecord', true) && speed != null && speed >= this.getSetting('trips.minSpeedStart', 3)) this.start({ manual: false });
      else {
        this.lastTick = t;
        return;
      }
    }
    if (this.cur.origin !== e.source) {
      await this.stop('Origem de dados alterada');
      return;
    }
    const dt = clamp((t - this.lastTick) / 1000, 0, 5);
    this.lastTick = t;
    const c = this.cur;
    c.totalSec += dt;
    if (speed != null) {
      this.gapSec = 0;
      c.distanceKm += (speed * dt) / 3600;
      if (speed >= 1) c.movingSec += dt;
      c.maxSpeed = Math.max(c.maxSpeed, speed);
      const f = e.fuel();
      if (f.flowLph != null) {
        c.fuelL += (f.flowLph * dt) / 3600;
        c.fuelDistanceKm += (speed * dt) / 3600;
        c.fuelMethod = f.method;
      }
    } else {
      this.gapSec += dt;
    }
    // Regras de encerramento automático (viagens manuais só param por perda de dados)
    if (this.gapSec >= 60) {
      await this.stop('Dados de velocidade indisponíveis');
      return;
    }
    if (!c.manual) {
      this.stoppedSec = speed != null && speed < 1 ? this.stoppedSec + dt : 0;
      const rpm = e.value('rpm');
      this.engineOffSec = rpm != null && rpm < 300 ? this.engineOffSec + dt : 0;
      if (this.engineOffSec >= 20) {
        await this.stop('Motor desligado');
        return;
      }
      if (this.stoppedSec >= this.getSetting('trips.stopAfterSeconds', 120)) {
        await this.stop('Veículo parado');
        return;
      }
    }
    if (t - this.lastSave >= AUTOSAVE_MS) {
      this.lastSave = t;
      c.updatedAt = t;
      await this.db.put('trips', { ...c });
    }
    this.emit('tick', this.summary());
  }

  #onGeoPoint(p) {
    const c = this.cur;
    if (!c || c.origin !== 'obd' || p.acc > 60) return;
    const last = c.points[c.points.length - 1];
    if (last && haversineKm(last, p) < 0.015) return;
    if (c.points.length >= MAX_POINTS) return;
    c.points.push({ t: p.t, lat: p.lat, lon: p.lon });
  }

  async list({ vehicleId, origin } = {}) {
    const rows = await this.db.where('trips', (t) => !t.inProgress && (vehicleId === undefined || t.vehicleId === vehicleId) && (!origin || t.origin === origin));
    return rows.sort((a, b) => b.startedAt - a.startedAt);
  }

  async remove(id) {
    await this.db.delete('trips', id);
    this.emit('removed', id);
  }
}

export function tripToGpx(trip) {
  const pts = (trip.points || [])
    .map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Alma do Carro" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Viagem ${fmtDate(trip.startedAt, true)}</name><trkseg>${pts}</trkseg></trk></gpx>\n`;
}

export function tripsToCsv(trips) {
  const head = 'inicio;fim;origem;distancia_km;duracao_s;em_movimento_s;vel_media_kmh;vel_max_kmh;combustivel_estimado_l;consumo_medio_estimado_kml';
  const rows = trips.map((t) =>
    [
      new Date(t.startedAt).toISOString(),
      t.endedAt ? new Date(t.endedAt).toISOString() : '',
      t.origin === 'simulation' ? 'simulacao' : 'real',
      t.distanceKm.toFixed(3),
      Math.round(t.totalSec),
      Math.round(t.movingSec),
      (t.avgSpeedKmh || 0).toFixed(1),
      Math.round(t.maxSpeed),
      t.fuelL ? t.fuelL.toFixed(3) : '',
      t.avgKmL ? t.avgKmL.toFixed(2) : '',
    ].join(';'),
  );
  return [head, ...rows].join('\n');
}
