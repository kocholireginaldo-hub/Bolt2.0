/** Serviço de configurações persistentes (mescla com padrões, valida e emite mudanças). */
import { DEFAULT_SETTINGS } from './config.js';
import { Emitter } from './events.js';
import { deepMerge, getPath, setPath, debounce } from './utils.js';

const KEY = 'app';

export class Settings extends Emitter {
  constructor(db) {
    super();
    this.db = db;
    this.data = structuredClone(DEFAULT_SETTINGS);
    this._save = debounce(() => this.#persist(), 250);
  }

  async load() {
    const row = await this.db.get('settings', KEY);
    this.data = deepMerge(structuredClone(DEFAULT_SETTINGS), row?.value || {});
    this.emit('loaded', this.data);
    return this.data;
  }

  get(path, fallback) {
    return getPath(this.data, path, fallback);
  }

  set(path, value) {
    const prev = this.get(path);
    if (JSON.stringify(prev) === JSON.stringify(value)) return;
    setPath(this.data, path, value);
    this.emit('change', path, value, prev);
    this._save();
  }

  update(patch) {
    for (const [path, value] of Object.entries(patch)) this.set(path, value);
  }

  async #persist() {
    await this.db.put('settings', { key: KEY, value: this.data, updatedAt: Date.now() });
  }

  flush() {
    this._save.cancel();
    return this.#persist();
  }

  async reset() {
    this.data = structuredClone(DEFAULT_SETTINGS);
    await this.#persist();
    this.emit('loaded', this.data);
  }
}
