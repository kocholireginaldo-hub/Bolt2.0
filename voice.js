/**
 * Voz: síntese (SpeechSynthesis) e reconhecimento (SpeechRecognition) com controles independentes.
 * O microfone só é solicitado quando o usuário o aciona. O reconhecimento no Chrome costuma usar
 * serviço online; o modo contínuo é experimental e depende do navegador.
 */
import { Emitter } from './events.js';

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Extrai o comando após a palavra de ativação (ex.: "ei bolt, qual a temperatura"). */
export function extractAfterWake(transcript, wakeName) {
  const t = norm(transcript);
  const w = norm(wakeName);
  if (!w) return null;
  const i = t.indexOf(w);
  if (i < 0) return null;
  return t.slice(i + w.length).replace(/^(,| )+/, '').trim();
}

export class VoiceService extends Emitter {
  /** @param {{getSetting:(p:string,d?:any)=>any, env?:any}} deps */
  constructor({ getSetting, env = globalThis }) {
    super();
    this.getSetting = getSetting;
    this.env = env;
    this.rec = null;
    this.listening = false;
    this.continuous = false;
    this.wantListening = false;
    this.restartDelay = 400;
    this.speaking = false;
    this.voices = [];
    const synth = env.speechSynthesis;
    if (synth) {
      const load = () => {
        this.voices = synth.getVoices();
        this.emit('voices', this.voices);
      };
      load();
      synth.onvoiceschanged = load;
    }
  }

  get ttsSupported() {
    return !!this.env.speechSynthesis;
  }
  get sttSupported() {
    return !!(this.env.SpeechRecognition || this.env.webkitSpeechRecognition);
  }

  ptVoices() {
    return this.voices.filter((v) => /^pt/i.test(v.lang));
  }

  speak(text, { interrupt = true } = {}) {
    if (!this.ttsSupported || !this.getSetting('assistant.voiceEnabled', true)) return false;
    const synth = this.env.speechSynthesis;
    if (interrupt) synth.cancel();
    const u = new this.env.SpeechSynthesisUtterance(String(text).slice(0, 600));
    u.lang = 'pt-BR';
    const name = this.getSetting('assistant.voiceName', '');
    const voice = this.voices.find((v) => v.name === name) || this.ptVoices().find((v) => /br/i.test(v.lang)) || this.ptVoices()[0];
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = Number(this.getSetting('assistant.rate', 1));
    u.pitch = Number(this.getSetting('assistant.pitch', 1));
    u.volume = Number(this.getSetting('assistant.volume', 1));
    u.onstart = () => {
      this.speaking = true;
      this.emit('speaking', true);
    };
    const end = () => {
      this.speaking = false;
      this.emit('speaking', false);
    };
    u.onend = end;
    u.onerror = end;
    synth.speak(u);
    return true;
  }

  cancelSpeech() {
    this.env.speechSynthesis?.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.emit('speaking', false);
    }
  }

  /**
   * Inicia a escuta. mode "tap": uma frase. mode "continuous": fica ouvindo e só reage
   * quando ouve o nome do assistente (palavra de ativação).
   */
  startListening({ mode = 'tap' } = {}) {
    if (!this.sttSupported) {
      this.emit('error', { code: 'UNSUPPORTED', message: 'Reconhecimento de voz indisponível neste navegador.' });
      return false;
    }
    if (this.listening) return true;
    this.continuous = mode === 'continuous';
    this.wantListening = true;
    this.#begin();
    return true;
  }

  #begin() {
    const Rec = this.env.SpeechRecognition || this.env.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = 'pt-BR';
    rec.interimResults = !this.continuous;
    rec.continuous = this.continuous;
    rec.maxAlternatives = 1;
    this.rec = rec;
    rec.onstart = () => {
      this.listening = true;
      this.emit('listening', true);
    };
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = res[0].transcript;
        if (this.continuous) {
          if (!res.isFinal) continue;
          const wake = this.getSetting('assistant.name', 'BOLT');
          const cmd = extractAfterWake(text, wake);
          if (cmd === null) continue;
          this.emit('wake', { command: cmd, transcript: text });
          if (cmd) this.emit('result', { text: cmd, final: true, viaWake: true });
        } else {
          this.emit('result', { text, final: res.isFinal });
          if (res.isFinal) this.wantListening = false;
        }
      }
    };
    rec.onerror = (ev) => {
      const map = {
        'not-allowed': 'Permissão de microfone negada.',
        'service-not-allowed': 'Reconhecimento de voz não permitido neste navegador.',
        'no-speech': '',
        'audio-capture': 'Nenhum microfone disponível.',
        network: 'O reconhecimento de voz precisa de internet neste navegador.',
        aborted: '',
      };
      const message = map[ev.error] ?? `Erro de voz: ${ev.error}`;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(ev.error)) this.wantListening = false;
      if (message) this.emit('error', { code: ev.error, message });
    };
    rec.onend = () => {
      this.listening = false;
      this.emit('listening', false);
      if (this.continuous && this.wantListening) {
        setTimeout(() => {
          if (this.wantListening && !this.listening) this.#begin();
        }, this.restartDelay);
      } else this.wantListening = false;
    };
    try {
      rec.start();
    } catch (err) {
      this.wantListening = false;
      this.emit('error', { code: 'START', message: 'Não foi possível iniciar o microfone.' });
    }
  }

  stopListening() {
    this.wantListening = false;
    try {
      this.rec?.stop();
    } catch {
      /* ignora */
    }
  }
}
