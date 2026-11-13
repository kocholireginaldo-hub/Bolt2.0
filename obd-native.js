/**
 * Ponte nativa (Android/iOS/desktop) — abstração para Bluetooth clássico (SPP) e outros meios
 * que navegadores não oferecem. O aplicativo nativo (WebView/Capacitor/Tauri) injeta
 * `window.BoltNative` com o contrato abaixo. Sem ele, o transporte se declara indisponível.
 *
 * Contrato (todas as funções retornam Promise, exceto setListener):
 *   BoltNative.capabilities: { bluetoothClassic?: bool, bluetoothLE?: bool, gps?: bool, microphone?: bool }
 *   BoltNative.listDevices(mode)           -> [{ name, address }]          mode: 'spp' | 'ble' | 'usb' | 'wifi'
 *   BoltNative.connect(mode, address)      -> void
 *   BoltNative.write(text)                 -> void
 *   BoltNative.disconnect()                -> void
 *   BoltNative.setListener({ onData(text), onClose(reason) })
 *
 * Este arquivo não simula nada: sem a ponte real, `open()` falha com UNSUPPORTED.
 */
import { ObdError } from './obd-protocol.js';

export class NativeBridgeTransport {
  #dataCb = () => {};
  #closeCb = () => {};

  /**
   * @param {{mode?:'spp'|'ble'|'usb'|'wifi', address?:string, chooseDevice?:(devices:any[])=>Promise<any>}} opts
   */
  constructor({ mode = 'spp', address = null, chooseDevice = null } = {}) {
    this.mode = mode;
    this.kind = mode === 'spp' ? 'spp' : 'native';
    this.label = mode === 'spp' ? 'Bluetooth clássico (SPP)' : 'Ponte nativa';
    this.address = address;
    this.chooseDevice = chooseDevice;
    this.name = address || null;
  }

  static bridge(env = globalThis) {
    return env.BoltNative || null;
  }

  static isSupported(mode = 'spp', env = globalThis) {
    const b = NativeBridgeTransport.bridge(env);
    if (!b) return false;
    if (mode === 'spp') return b.capabilities?.bluetoothClassic !== false;
    return true;
  }

  onData(cb) {
    this.#dataCb = cb;
  }
  onClose(cb) {
    this.#closeCb = cb;
  }

  async open() {
    const b = NativeBridgeTransport.bridge();
    if (!b) throw new ObdError('UNSUPPORTED', 'Ponte nativa não encontrada (window.BoltNative ausente).');
    b.setListener({
      onData: (t) => this.#dataCb(String(t)),
      onClose: (r) => this.#closeCb(r || 'Conexão nativa encerrada'),
    });
    if (!this.address) {
      const devices = await b.listDevices(this.mode);
      if (!devices?.length) throw new ObdError('TRANSPORT', 'Nenhum dispositivo pareado encontrado pela ponte nativa.');
      const picked = this.chooseDevice ? await this.chooseDevice(devices) : devices[0];
      if (!picked) throw new ObdError('ABORTED', 'Seleção cancelada.');
      this.address = picked.address;
      this.name = picked.name || picked.address;
    }
    try {
      await b.connect(this.mode, this.address);
    } catch (err) {
      throw new ObdError('TRANSPORT', 'Falha ao conectar pela ponte nativa', err?.message);
    }
  }

  async reopen() {
    return this.open();
  }

  async write(text) {
    const b = NativeBridgeTransport.bridge();
    if (!b) throw new ObdError('TRANSPORT', 'Ponte nativa indisponível');
    await b.write(text);
  }

  async close() {
    try {
      await NativeBridgeTransport.bridge()?.disconnect();
    } catch {
      /* ignora */
    }
  }
}
