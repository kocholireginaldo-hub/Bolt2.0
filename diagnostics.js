/**
 * Serviço de diagnóstico: leitura de DTC, classificação, histórico de falhas e limpeza segura.
 * Opera sobre qualquer "fonte de diagnóstico" (OBD real ou simulador) com a mesma interface:
 *   readDtcs() -> {stored,pending,permanent}; readMonitorStatus(); readFreezeFrame();
 *   readVin(); clearDtcs({confirmed}); capabilities().
 * Códigos reais e simulados ficam separados por "origin" e nunca são misturados.
 */
import { Emitter } from './events.js';
import { describeDtc } from './dtc-database.js';
import { uid, sleep } from './utils.js';

export const DTC_STATUS = Object.freeze({
  CURRENT: 'current',
  PENDING: 'pending',
  PERMANENT: 'permanent',
  PREVIOUS: 'previous',
});

export const STATUS_LABELS = {
  current: 'Atual',
  pending: 'Pendente',
  permanent: 'Permanente',
  previous: 'Anterior',
};

export class DiagnosticsService extends Emitter {
  /**
   * @param {{db:any, getSource:()=>({source:any, origin:'obd'|'simulation'}|null), getVehicle:()=>any, engine:any, now?:()=>number}} deps
   */
  constructor({ db, getSource, getVehicle, engine, now = () => Date.now() }) {
    super();
    this.db = db;
    this.getSource = getSource;
    this.getVehicle = getVehicle;
    this.engine = engine;
    this.now = now;
    this.last = null; // último resultado de scan
  }

  #ctx() {
    const s = this.getSource();
    const v = this.getVehicle();
    if (!s || !s.source) throw new Error('Sem fonte de diagnóstico: conecte o OBD2 ou ative a simulação.');
    return { src: s.source, origin: s.origin, vehicleId: v?.id ?? null };
  }

  /** Lê tudo o que a fonte oferece e atualiza o histórico de falhas. */
  async scan() {
    const { src, origin, vehicleId } = this.#ctx();
    const at = this.now();
    const dtcs = await src.readDtcs();
    let monitors = null;
    let freezeFrame = null;
    try {
      monitors = await src.readMonitorStatus();
    } catch {
      monitors = null;
    }
    try {
      freezeFrame = await src.readFreezeFrame();
    } catch {
      freezeFrame = null;
    }
    const history = await this.#updateHistory({ origin, vehicleId, dtcs, freezeFrame, at });
    const entries = this.#buildEntries(dtcs, history);
    this.last = {
      at,
      origin,
      vehicleId,
      milOn: monitors ? monitors.milOn : null,
      monitors: monitors?.monitors || [],
      freezeFrame: freezeFrame ? { ...freezeFrame, info: describeDtc(freezeFrame.dtc) } : null,
      entries,
      counts: {
        current: entries.filter((e) => e.status === 'current').length,
        pending: entries.filter((e) => e.status === 'pending').length,
        permanent: entries.filter((e) => e.status === 'permanent').length,
      },
    };
    this.emit('scan', this.last);
    return this.last;
  }

  #buildEntries(dtcs, history) {
    const byCode = new Map(history.map((h) => [h.code, h]));
    const present = new Map();
    for (const c of dtcs.stored || []) present.set(c, 'current');
    for (const c of dtcs.pending || []) if (!present.has(c)) present.set(c, 'pending');
    for (const c of dtcs.permanent || []) present.set(c, present.get(c) ? present.get(c) : 'permanent');
    const out = [];
    for (const [code, status] of present) {
      const h = byCode.get(code);
      out.push({ ...describeDtc(code), status, permanent: (dtcs.permanent || []).includes(code), occurrences: h?.episodes.length || 1, recurrent: (h?.episodes.length || 1) >= 2, firstSeen: h?.firstSeen, lastSeen: h?.lastSeen });
    }
    return out;
  }

  async #updateHistory({ origin, vehicleId, dtcs, freezeFrame, at }) {
    const rows = await this.db.where('dtcHistory', (r) => r.kind === 'code' && r.origin === origin && r.vehicleId === vehicleId);
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const present = new Map();
    for (const c of dtcs.stored || []) present.set(c, 'current');
    for (const c of dtcs.pending || []) if (!present.has(c)) present.set(c, 'pending');
    for (const c of dtcs.permanent || []) if (!present.has(c)) present.set(c, 'permanent');

    for (const [code, status] of present) {
      let row = byCode.get(code);
      if (!row) {
        row = { id: uid('dtc'), kind: 'code', vehicleId, origin, code, firstSeen: at, lastSeen: at, status, episodes: [], createdAt: at };
        byCode.set(code, row);
      }
      let ep = row.episodes[row.episodes.length - 1];
      if (!ep || ep.end != null) {
        ep = { start: at, end: null, status };
        row.episodes.push(ep);
      }
      ep.status = status;
      row.lastSeen = at;
      row.status = status;
      if (freezeFrame && freezeFrame.dtc === code) row.freezeFrame = { ...freezeFrame, at };
      row.updatedAt = at;
      await this.db.put('dtcHistory', row);
    }
    for (const row of byCode.values()) {
      if (present.has(row.code)) continue;
      const ep = row.episodes[row.episodes.length - 1];
      if (ep && ep.end == null) {
        ep.end = at;
        row.status = 'previous';
        row.updatedAt = at;
        await this.db.put('dtcHistory', row);
      }
    }
    return [...byCode.values()];
  }

  /** Histórico (códigos já vistos) do veículo ativo, separado por origem. */
  async history({ origin } = {}) {
    const v = this.getVehicle();
    const rows = await this.db.where('dtcHistory', (r) => r.vehicleId === (v?.id ?? null) && (!origin || r.origin === origin));
    return rows
      .filter((r) => r.kind === 'code')
      .map((r) => ({ ...r, info: describeDtc(r.code), recurrent: r.episodes.length >= 2 }))
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  async clearLog({ origin } = {}) {
    const v = this.getVehicle();
    const rows = await this.db.where('dtcHistory', (r) => r.kind === 'clear' && r.vehicleId === (v?.id ?? null) && (!origin || r.origin === origin));
    return rows.sort((a, b) => b.at - a.at);
  }

  /** Consulta de operações disponíveis na fonte atual (sem executar nada destrutivo). */
  async operations() {
    const { src, origin } = this.#ctx();
    const caps = await src.capabilities();
    return { origin, ...caps };
  }

  /**
   * Limpeza segura de códigos:
   * 1) leitura completa  2) preserva snapshot local  3) envia comando  4) nova leitura.
   * Apagar um código NÃO corrige o defeito: códigos que reaparecem são reportados.
   */
  async clearCodes({ confirmed = false } = {}) {
    if (confirmed !== true) throw new Error('A limpeza de códigos exige confirmação explícita.');
    const { src, origin, vehicleId } = this.#ctx();
    const before = await this.scan();
    const at = this.now();
    const snapshot = {
      id: uid('clr'),
      kind: 'clear',
      vehicleId,
      origin,
      at,
      createdAt: at,
      updatedAt: at,
      codesBefore: before.entries.map((e) => ({ code: e.code, status: e.status, description: e.description })),
      freezeFrame: before.freezeFrame ? { dtc: before.freezeFrame.dtc, params: before.freezeFrame.params } : null,
      monitors: before.monitors,
      milBefore: before.milOn,
      liveData: this.#liveData(),
      result: null,
    };
    await this.db.put('dtcHistory', snapshot); // preservado ANTES de qualquer comando
    await src.clearDtcs({ confirmed: true });
    await sleep(origin === 'simulation' ? 50 : 1500);
    const after = await this.scan();
    const remaining = new Set(after.entries.map((e) => e.code));
    snapshot.result = {
      checkedAt: this.now(),
      cleared: snapshot.codesBefore.filter((c) => !remaining.has(c.code)).map((c) => c.code),
      returned: snapshot.codesBefore.filter((c) => remaining.has(c.code)).map((c) => c.code),
      newCodes: after.entries.filter((e) => !snapshot.codesBefore.some((c) => c.code === e.code)).map((e) => e.code),
      milAfter: after.milOn,
    };
    snapshot.updatedAt = this.now();
    await this.db.put('dtcHistory', snapshot);
    this.emit('cleared', snapshot);
    return snapshot;
  }

  #liveData() {
    const snap = this.engine.snapshot();
    const out = {};
    for (const [id, r] of Object.entries(snap.params)) if (r.validity === 'valid') out[id] = { value: r.value, unit: r.unit };
    return out;
  }
}
