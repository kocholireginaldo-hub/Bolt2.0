/**
 * Transporte OBD2 via Wi-Fi (adaptadores ELM327 Wi-Fi, TCP — normalmente 192.168.0.10:35000).
 *
 * Navegadores NÃO abrem sockets TCP. Por isso há dois modos:
 *  - "bridge": usa a ponte local de server.js (POST /api/obd/wifi/*, eventos SSE). O servidor
 *    precisa estar numa máquina que alcance o adaptador (mesma rede Wi-Fi do adaptador).
 *  - "websocket": conecta a um endpoint WebSocket (ws://...) que repasse bytes ao adaptador.
 */
import { ObdError } from './obd-protocol.js';

export class WifiTransport {
  kind = 'wifi';
  label = 'Wi-Fi';
  #dataCb = () => {};
  #closeCb = () => {};

  /**
   * @param {{mode?:'bridge'|'websocket', host?:string, port?:number, bridgeUrl?:string, bridgeToken?:string, wsUrl?:string}} opts
   */
  constructor(opts = {}) {
    this.opts = { mode: 'bridge', host: '192.168.0.10', port: 35000, bridgeUrl: '', bridgeToken: '', wsUrl: '', ...opts };
    this.name = `${this.opts.host}:${this.opts.port}`;
    this.sid = null;
    this.ws = null;
    this.abort = null;
    this.closing = false;
  }

  static isSupported() {
    return typeof fetch === 'function';
  }

  onData(cb) {
    this.#dataCb = cb;
  }
  onClose(cb) {
    this.#closeCb = cb;
  }

  #base() {
    const b = (this.opts.bridgeUrl || '').trim().replace(/\/+$/, '');
    return b || (typeof location !== 'undefined' ? location.origin : '');
  }

  #headers(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.opts.bridgeToken) h.Authorization = `Bearer ${this.opts.bridgeToken}`;
    return h;
  }

  async open() {
    this.closing = false;
    if (this.opts.mode === 'websocket') return this.#openWs();
    return this.#openBridge();
  }

  async reopen() {
    return this.open();
  }

  /* ---------------- WebSocket ---------------- */
  #openWs() {
    const url = (this.opts.wsUrl || '').trim();
    if (!/^wss?:\/\//i.test(url)) throw new ObdError('TRANSPORT', 'Informe uma URL WebSocket válida (ws:// ou wss://).');
    this.name = url;
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            /* ignora */
          }
          reject(new ObdError('TIMEOUT', 'Tempo esgotado ao conectar ao WebSocket.'));
        }
      }, 8000);
      ws.onopen = () => {
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new ObdError('TRANSPORT', 'Falha ao conectar ao WebSocket.'));
        }
      };
      ws.onmessage = async (ev) => {
        const d = ev.data;
        this.#dataCb(typeof d === 'string' ? d : typeof d?.text === 'function' ? await d.text() : String(d));
      };
      ws.onclose = () => {
        if (settled && !this.closing) this.#closeCb('WebSocket encerrado');
      };
    });
  }

  /* ---------------- Ponte HTTP + SSE ---------------- */
  async #openBridge() {
    const base = this.#base();
    let res;
    try {
      res = await fetch(`${base}/api/obd/wifi/connect`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({ host: this.opts.host, port: Number(this.opts.port) }),
      });
    } catch (err) {
      throw new ObdError('TRANSPORT', 'Ponte local inacessível. Execute "node server.js" em um dispositivo que alcance o adaptador.', err?.message);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ObdError('TRANSPORT', body.message || `Ponte recusou a conexão (HTTP ${res.status}).`, body.error);
    }
    const { sid } = await res.json();
    this.sid = sid;
    this.abort = new AbortController();
    this.#readStream(base, sid);
  }

  async #readStream(base, sid) {
    try {
      const res = await fetch(`${base}/api/obd/wifi/stream?sid=${encodeURIComponent(sid)}`, {
        headers: this.#headers(false),
        signal: this.abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          this.#handleSse(block);
        }
      }
      if (!this.closing) this.#closeCb('Fluxo da ponte encerrado');
    } catch (err) {
      if (!this.closing && err?.name !== 'AbortError') this.#closeCb(err?.message || 'Fluxo da ponte interrompido');
    }
  }

  #handleSse(block) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    try {
      const payload = JSON.parse(data);
      if (event === 'close') {
        if (!this.closing) this.#closeCb(payload.reason || 'Adaptador desconectado');
      } else if (typeof payload.d === 'string') {
        this.#dataCb(payload.d);
      }
    } catch {
      /* ignora quadro inválido */
    }
  }

  async write(text) {
    if (this.opts.mode === 'websocket') {
      if (!this.ws || this.ws.readyState !== 1) throw new ObdError('TRANSPORT', 'WebSocket não está aberto.');
      this.ws.send(text);
      return;
    }
    if (!this.sid) throw new ObdError('TRANSPORT', 'Ponte não conectada.');
    const res = await fetch(`${this.#base()}/api/obd/wifi/write`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ sid: this.sid, data: text }),
    });
    if (!res.ok) throw new ObdError('TRANSPORT', `Falha ao enviar pela ponte (HTTP ${res.status}).`);
  }

  async close() {
    this.closing = true;
    try {
      this.ws?.close();
    } catch {
      /* ignora */
    }
    this.ws = null;
    try {
      this.abort?.abort();
    } catch {
      /* ignora */
    }
    if (this.sid) {
      const sid = this.sid;
      this.sid = null;
      try {
        await fetch(`${this.#base()}/api/obd/wifi/disconnect`, { method: 'POST', headers: this.#headers(), body: JSON.stringify({ sid }) });
      } catch {
        /* ignora */
      }
    }
  }
}
