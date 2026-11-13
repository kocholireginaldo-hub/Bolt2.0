/**
 * Armazenamento local do BOLT.
 * IndexedDB no navegador; backend em memória para testes ou quando IndexedDB não existe.
 * Inclui exportação/restauração (backup) em JSON.
 */
import { APP } from './config.js';

export const STORES = Object.freeze({
  settings: 'key',
  kv: 'key',
  vehicles: 'id',
  trips: 'id',
  dtcHistory: 'id',
  services: 'id',
  schedule: 'id',
  alerts: 'id',
  assistant: 'id',
});

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export class MemoryBackend {
  kind = 'memory';
  constructor() {
    this.data = new Map(Object.keys(STORES).map((s) => [s, new Map()]));
  }
  async open() {}
  #store(s) {
    const m = this.data.get(s);
    if (!m) throw new Error(`Store desconhecido: ${s}`);
    return m;
  }
  async get(s, key) {
    const v = this.#store(s).get(key);
    return v === undefined ? undefined : clone(v);
  }
  async put(s, value) {
    this.#store(s).set(value[STORES[s]], clone(value));
    return value;
  }
  async delete(s, key) {
    this.#store(s).delete(key);
  }
  async all(s) {
    return [...this.#store(s).values()].map(clone);
  }
  async clear(s) {
    this.#store(s).clear();
  }
}

export class IndexedDbBackend {
  kind = 'indexeddb';
  constructor(name = APP.dbName, version = 1) {
    this.name = name;
    this.version = version;
    this.db = null;
  }
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [store, keyPath] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => this.db.close();
        resolve();
      };
      req.onerror = () => reject(req.error || new Error('Falha ao abrir o banco local'));
      req.onblocked = () => reject(new Error('Banco local bloqueado por outra aba'));
    });
  }
  #tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const req = fn(os);
      if (req) req.onsuccess = () => (result = req.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
    });
  }
  get(s, key) {
    return this.#tx(s, 'readonly', (os) => os.get(key));
  }
  async put(s, value) {
    await this.#tx(s, 'readwrite', (os) => os.put(value));
    return value;
  }
  async delete(s, key) {
    await this.#tx(s, 'readwrite', (os) => os.delete(key));
  }
  async all(s) {
    return (await this.#tx(s, 'readonly', (os) => os.getAll())) || [];
  }
  async clear(s) {
    await this.#tx(s, 'readwrite', (os) => os.clear());
  }
}

export class Database {
  constructor(backend) {
    this.backend = backend;
    this.ready = false;
  }

  async open() {
    await this.backend.open();
    this.ready = true;
    return this;
  }

  get kind() {
    return this.backend.kind;
  }

  get(store, key) {
    return this.backend.get(store, key);
  }

  async put(store, value) {
    if (value[STORES[store]] == null) throw new Error(`Registro sem chave (${STORES[store]}) em ${store}`);
    await this.backend.put(store, value);
    return value;
  }

  delete(store, key) {
    return this.backend.delete(store, key);
  }

  all(store) {
    return this.backend.all(store);
  }

  async where(store, predicate) {
    return (await this.all(store)).filter(predicate);
  }

  clear(store) {
    return this.backend.clear(store);
  }

  /** Backup completo (somente dados locais; nenhuma credencial é armazenada aqui). */
  async exportAll() {
    const stores = {};
    for (const s of Object.keys(STORES)) stores[s] = await this.all(s);
    return { app: APP.name, schema: APP.schema, version: APP.version, exportedAt: new Date().toISOString(), stores };
  }

  /**
   * Restaura um backup.
   * mode "merge": mantém dados locais e só substitui registros de mesmo id mais antigos.
   * mode "replace": limpa os stores antes (exige confirmação na interface).
   */
  async importAll(payload, { mode = 'merge' } = {}) {
    const v = Database.validateBackup(payload);
    if (!v.ok) throw new Error(v.error);
    let imported = 0;
    for (const [store, keyPath] of Object.entries(STORES)) {
      const rows = payload.stores[store];
      if (!Array.isArray(rows)) continue;
      if (mode === 'replace') await this.clear(store);
      const existing = new Map((await this.all(store)).map((r) => [r[keyPath], r]));
      for (const row of rows) {
        if (row == null || row[keyPath] == null) continue;
        const cur = existing.get(row[keyPath]);
        if (cur && mode === 'merge') {
          const curTs = cur.updatedAt || cur.createdAt || 0;
          const newTs = row.updatedAt || row.createdAt || 0;
          if (curTs >= newTs) continue;
        }
        await this.put(store, row);
        imported++;
      }
    }
    return { imported };
  }

  static validateBackup(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Arquivo de backup inválido.' };
    if (payload.app !== APP.name) return { ok: false, error: 'Este arquivo não é um backup do BOLT.' };
    if (typeof payload.schema !== 'number' || payload.schema > APP.schema) {
      return { ok: false, error: 'Backup de versão mais nova do que este aplicativo suporta.' };
    }
    if (!payload.stores || typeof payload.stores !== 'object') return { ok: false, error: 'Backup sem dados.' };
    return { ok: true };
  }

  async usage() {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage ?? null, quota: e.quota ?? null };
      }
    } catch {
      /* ignora */
    }
    return { usage: null, quota: null };
  }
}

/** Cria o banco apropriado ao ambiente. Retorna também se está em modo volátil. */
export async function createDatabase({ forceMemory = false } = {}) {
  if (!forceMemory && typeof indexedDB !== 'undefined') {
    try {
      const db = await new Database(new IndexedDbBackend()).open();
      return { db, volatile: false };
    } catch (err) {
      console.warn('[BOLT] IndexedDB indisponível, usando memória:', err);
    }
  }
  const db = await new Database(new MemoryBackend()).open();
  return { db, volatile: true };
}
