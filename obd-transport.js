/**
 * Contrato dos transportes OBD2 e catálogo de adaptadores.
 *
 * Todo transporte implementa:
 *   kind: string                      identificador ('ble' | 'wifi' | 'spp' | 'native')
 *   label: string
 *   open(): Promise<void>             primeira conexão (pode abrir seletor/pedir permissão)
 *   reopen?(): Promise<void>          reconexão silenciosa ao mesmo alvo
 *   close(): Promise<void>
 *   write(text): Promise<void>        envia texto (comando + "\r")
 *   onData(cb) / onClose(cb)          callbacks de dados recebidos e perda de conexão
 *   name?: string                     nome amigável do adaptador/dispositivo
 */

export const PLATFORM_HINT = {
  ble: 'Use Chrome ou Edge (Android/desktop) via HTTPS ou localhost com um adaptador ELM327 BLE.',
  wifi: 'Wi-Fi requer a ponte local (server.js) ou um endpoint WebSocket, pois navegadores não abrem sockets TCP.',
  spp: 'Bluetooth clássico (SPP) exige o aplicativo nativo com a ponte BoltNative.',
  native: 'A ponte nativa exige o aplicativo nativo com BoltNative.',
};

export const ADAPTER_KINDS = [
  { kind: 'ble', label: 'Bluetooth LE', icon: 'bluetooth', description: 'Adaptadores ELM327 BLE (Web Bluetooth).' },
  { kind: 'wifi', label: 'Wi-Fi', icon: 'wifi', description: 'ELM327 Wi-Fi via ponte local ou WebSocket.' },
  { kind: 'spp', label: 'Bluetooth clássico (SPP)', icon: 'bluetooth', description: 'Requer ponte nativa (app Android).' },
  { kind: 'native', label: 'Ponte nativa', icon: 'plug', description: 'Qualquer transporte exposto pelo app nativo (BoltNative).' },
];
