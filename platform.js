/**
 * Detecção honesta de recursos da plataforma. Nenhuma compatibilidade é presumida:
 * a interface consulta este módulo para habilitar/explicar cada recurso.
 */

export function detectPlatform(env = globalThis) {
  const nav = env.navigator || {};
  const win = env.window || env;
  const native = win.BoltNative || null;
  return {
    secureContext: !!env.isSecureContext,
    webBluetooth: !!nav.bluetooth,
    webSerial: !!nav.serial,
    speechRecognition: !!(win.SpeechRecognition || win.webkitSpeechRecognition),
    speechSynthesis: !!win.speechSynthesis,
    geolocation: !!nav.geolocation,
    indexedDB: !!win.indexedDB,
    serviceWorker: !!nav.serviceWorker,
    screenOrientationLock: !!(env.screen && env.screen.orientation && env.screen.orientation.lock),
    wakeLock: !!nav.wakeLock,
    standalone: !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches),
    native: native ? { present: true, capabilities: native.capabilities || {} } : { present: false, capabilities: {} },
    userAgent: nav.userAgent || '',
  };
}

export function explainUnsupported(feature, p) {
  switch (feature) {
    case 'ble':
      if (!p.secureContext) return 'Web Bluetooth exige HTTPS ou localhost.';
      return 'Este navegador não oferece Web Bluetooth (use Chrome/Edge no Android ou desktop; iOS Safari não suporta).';
    case 'spp':
      return 'Bluetooth clássico (SPP) não é acessível por navegadores; requer o aplicativo nativo com a ponte BoltNative.';
    case 'native':
      return 'Ponte nativa não detectada (window.BoltNative ausente).';
    case 'wifi':
      return '';
    case 'stt':
      return 'Reconhecimento de voz indisponível neste navegador.';
    case 'tts':
      return 'Síntese de voz indisponível neste navegador.';
    case 'gps':
      return 'Geolocalização indisponível neste navegador.';
    default:
      return 'Recurso indisponível.';
  }
}
