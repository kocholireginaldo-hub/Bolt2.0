/**
 * Transporte OBD2 via Bluetooth Low Energy (Web Bluetooth).
 * Funciona apenas com adaptadores ELM327 **BLE** (não com Bluetooth clássico/SPP) e
 * somente em navegadores com Web Bluetooth (Chrome/Edge; HTTPS ou localhost).
 */
import { ObdError } from './obd-protocol.js';
import { PLATFORM_HINT } from './obd-transport.js';

const U16 = (n) => `0000${n.toString(16)}-0000-1000-8000-00805f9b34fb`;

/** Perfis GATT comuns de adaptadores ELM327 BLE. */
export const BLE_PROFILES = [
  { service: U16(0xfff0), notify: U16(0xfff1), write: U16(0xfff2) },
  { service: U16(0xffe0), notify: U16(0xffe1), write: U16(0xffe1) },
  { service: U16(0x18f0), notify: U16(0x2af0), write: U16(0x2af1) },
  { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', notify: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', write: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
];

export class BleTransport {
  kind = 'ble';
  label = 'Bluetooth Low Energy';
  #dataCb = () => {};
  #closeCb = () => {};

  constructor() {
    this.device = null;
    this.server = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.profile = null;
    this.name = null;
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.mtu = 20;
    this._onDisc = () => this.#closeCb('Dispositivo BLE desconectado');
    this._onNotify = (ev) => this.#dataCb(this.decoder.decode(ev.target.value));
  }

  static isSupported(env = globalThis) {
    return !!(env.navigator && env.navigator.bluetooth && env.isSecureContext !== false);
  }

  static unsupportedReason(env = globalThis) {
    if (!env.navigator?.bluetooth) return 'Web Bluetooth indisponível neste navegador.';
    if (env.isSecureContext === false) return 'Web Bluetooth exige HTTPS ou localhost.';
    return '';
  }

  onData(cb) {
    this.#dataCb = cb;
  }
  onClose(cb) {
    this.#closeCb = cb;
  }

  /** Abre o seletor de dispositivos (gesto do usuário obrigatório) e conecta. */
  async open() {
    if (!BleTransport.isSupported()) throw new ObdError('UNSUPPORTED', BleTransport.unsupportedReason() || PLATFORM_HINT.ble);
    if (!this.device) {
      try {
        this.device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: BLE_PROFILES.map((p) => p.service),
        });
      } catch (err) {
        if (err?.name === 'NotFoundError') throw new ObdError('ABORTED', 'Seleção de dispositivo cancelada.');
        throw new ObdError('TRANSPORT', 'Falha ao solicitar o dispositivo Bluetooth', err?.message);
      }
      this.name = this.device.name || 'Adaptador BLE';
      this.device.addEventListener('gattserverdisconnected', this._onDisc);
    }
    await this.#connectGatt();
  }

  /** Reconexão ao mesmo dispositivo (sem abrir o seletor). */
  async reopen() {
    if (!this.device) throw new ObdError('TRANSPORT', 'Nenhum dispositivo BLE memorizado para reconectar.');
    await this.#connectGatt();
  }

  async #connectGatt() {
    try {
      this.server = await this.device.gatt.connect();
      const { profile, write, notify } = await this.#discover();
      this.profile = profile;
      this.writeChar = write;
      this.notifyChar = notify;
      await notify.startNotifications();
      notify.addEventListener('characteristicvaluechanged', this._onNotify);
    } catch (err) {
      try {
        this.device.gatt.disconnect();
      } catch {
        /* ignora */
      }
      if (err instanceof ObdError) throw err;
      throw new ObdError('TRANSPORT', 'Não foi possível conectar ao adaptador BLE', err?.message);
    }
  }

  async #discover() {
    for (const p of BLE_PROFILES) {
      try {
        const svc = await this.server.getPrimaryService(p.service);
        const notify = await svc.getCharacteristic(p.notify);
        const write = p.write === p.notify ? notify : await svc.getCharacteristic(p.write);
        return { profile: p, write, notify };
      } catch {
        /* tenta o próximo perfil */
      }
    }
    // Descoberta genérica nos serviços autorizados
    let notify = null;
    let write = null;
    for (const p of BLE_PROFILES) {
      try {
        const svc = await this.server.getPrimaryService(p.service);
        for (const ch of await svc.getCharacteristics()) {
          if (!notify && (ch.properties.notify || ch.properties.indicate)) notify = ch;
          if (!write && (ch.properties.write || ch.properties.writeWithoutResponse)) write = ch;
        }
        if (notify && write) return { profile: { service: p.service }, write, notify };
      } catch {
        /* ignora */
      }
    }
    throw new ObdError('UNSUPPORTED', 'Este dispositivo BLE não expõe um perfil de adaptador ELM327 reconhecido.');
  }

  async write(text) {
    if (!this.writeChar) throw new ObdError('TRANSPORT', 'BLE não conectado');
    const bytes = this.encoder.encode(text);
    for (let i = 0; i < bytes.length; i += this.mtu) {
      const chunk = bytes.slice(i, i + this.mtu);
      if (this.writeChar.properties.writeWithoutResponse && this.writeChar.writeValueWithoutResponse) {
        await this.writeChar.writeValueWithoutResponse(chunk);
      } else {
        await this.writeChar.writeValue(chunk);
      }
    }
  }

  async close() {
    try {
      this.notifyChar?.removeEventListener('characteristicvaluechanged', this._onNotify);
      await this.notifyChar?.stopNotifications?.();
    } catch {
      /* ignora */
    }
    try {
      this.device?.removeEventListener('gattserverdisconnected', this._onDisc);
      this.device?.gatt?.disconnect();
    } catch {
      /* ignora */
    }
    this.writeChar = null;
    this.notifyChar = null;
    this.server = null;
  }

  /** Esquece o dispositivo (próxima conexão abrirá o seletor novamente). */
  forget() {
    this.device = null;
  }
}
