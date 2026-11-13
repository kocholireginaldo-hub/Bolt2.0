/** Emissor de eventos mínimo (sem dependências, funciona no navegador e no Node). */
export class Emitter {
  #handlers = new Map();

  on(event, fn) {
    let set = this.#handlers.get(event);
    if (!set) this.#handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.#handlers.get(event)?.delete(fn);
  }

  once(event, fn) {
    const off = this.on(event, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  emit(event, ...args) {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[BOLT] erro em ouvinte de "${event}":`, err);
      }
    }
  }

  removeAllListeners() {
    this.#handlers.clear();
  }
}
