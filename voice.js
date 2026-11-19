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
// o reconhecimento de voz erra o nome de formas previsíveis; estas variações também ativam a alma
const WAKE_ALIASES = { bolt: ['bolte', 'volt', 'bolti', 'boult', 'boldi', 'bout'] };

export function extractAfterWake(transcript, wakeName) {
  const t = ` ${norm(transcript)} `;
  const w = norm(wakeName);
  if (!w) return null;
  let at = -1;
  let len = 0;
  for (const a of [w, ...(WAKE_ALIASES[w] || [])]) {
    const i = t.indexOf(` ${a} `);
    if (i >= 0 && (at < 0 || i < at)) { at = i; len = a.length; }
  }
  if (at < 0) return null;
  return t.slice(at + 1 + len).replace(/^(,| )+/, '').trim();
}

/** "Bolt, tá na escuta?", "Bolt, tá aí?": só chamam a atenção, não são uma pergunta. */
const PRESENCE = /^(oi|ei|alo|ola|opa|e ai)$|^(oi |ei |alo |opa )?(voce |vc )?(esta |ta |tah )?(me )?(na escuta|escutando|ouvindo|ouve|escuta|ai|aqui|acordado|ligado|presente|pronto|la|funcionando)( ai| ainda| mesmo)?$/;

/** Verdadeiro quando, depois do nome, não veio um comando de verdade (vazio ou só checagem de presença). */
export function isBareWake(cmd) {
  const c = norm(cmd);
  return c === '' || PRESENCE.test(c);
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
    this.paused = false;
    this.armedUntil = 0;
    this.earlyWake = false;
    this.wakeTimer = null;
    this.lastWakeAt = 0;
    this.lastError = null;
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

  /** O navegador só libera a fala depois de um toque do usuário na página. */
  #canSpeak() {
    const ua = this.env.navigator?.userActivation;
    return !ua || ua.hasBeenActive;
  }

  /** Depois de ouvir só o nome ("Bolt"), a próxima frase vira pergunta mesmo sem repetir o nome. */
  arm(ms = 10000) {
    this.armedUntil = Date.now() + ms;
  }

  /** Para de ouvir enquanto fala (para não escutar a própria voz) e volta logo depois. */
  #pause() {
    if (!(this.continuous && this.wantListening) || this.paused) return;
    this.paused = true;
    try { this.rec?.abort(); } catch { /* ignora */ }
  }
  #resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.continuous && this.wantListening && !this.listening) setTimeout(() => { if (this.wantListening && !this.listening && !this.paused) this.#begin(); }, 300);
  }

  /** Escolhe a melhor voz em português: a do nome salvo, senão pt-BR local (funciona sem internet), senão qualquer pt. */
  #pickVoice() {
    const name = this.getSetting('assistant.voiceName', '');
    const byName = this.voices.find((v) => v.name === name);
    if (byName) return byName;
    const pt = this.ptVoices();
    const rank = (v) => (/br/i.test(v.lang) ? 0 : 2) + (v.localService ? 0 : 1);
    return [...pt].sort((x, y) => rank(x) - rank(y))[0] || null;
  }

  /**
   * Fala o texto. Em multimídias Android (WebView) a síntese falha em silêncio por vários motivos
   * (cancel() logo antes de speak(), objeto coletado antes de terminar, voz online sem internet, tom/velocidade
   * fora do aceito pelo motor). Aqui: só cancela se houver fala em andamento, guarda a referência,
   * confere se a fala começou e, se não começou ou deu erro, tenta de novo de forma simples.
   */
  speak(text, { interrupt = true, plain = false } = {}) {
    if (!this.ttsSupported || !this.getSetting('assistant.voiceEnabled', true) || !this.#canSpeak()) return false;
    const synth = this.env.speechSynthesis;
    const busy = synth.speaking || synth.pending;
    if (interrupt && busy) synth.cancel();
    const u = new this.env.SpeechSynthesisUtterance(String(text).slice(0, 600));
    u.lang = 'pt-BR';
    const voice = this.#pickVoice();
    if (voice && !plain) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    if (!plain) {
      u.rate = Math.min(2, Math.max(0.1, Number(this.getSetting('assistant.rate', 1)) || 1));
      u.pitch = Math.min(2, Math.max(0.1, Number(this.getSetting('assistant.pitch', 1)) || 1));
      u.volume = Math.min(1, Math.max(0, Number(this.getSetting('assistant.volume', 1))));
    }
    let started = false;
    let finished = false;
    u.onstart = () => {
      started = true;
      this.lastError = null;
      this.speaking = true;
      this.emit('speaking', true);
    };
    const end = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      this._u = null;
      this.speaking = false;
      this.emit('speaking', false);
      this.#resume();
    };
    u.onend = end;
    u.onerror = (e) => {
      const err = e && e.error;
      if (err === 'interrupted' || err === 'canceled') return end();
      this.lastError = err || 'erro';
      this.emit('ttserror', this.lastError);
      end();
      // 1ª falha: tenta de novo sem voz, tom e velocidade personalizados
      if (!plain) setTimeout(() => this.speak(text, { interrupt: true, plain: true }), 150);
    };
    // se nada começar em 3s, o motor de voz travou: reinicia e tenta de forma simples
    const watchdog = setTimeout(() => {
      if (started || finished) return;
      try { synth.cancel(); } catch { /* ignora */ }
      end();
      if (!plain) this.speak(text, { interrupt: false, plain: true });
      else { this.lastError = 'sem-som'; this.emit('ttserror', this.lastError); }
    }, 3000);
    this._u = u; // mantém a referência até o fim (o navegador pode descartar a fala antes)
    this.#pause();
    clearTimeout(this._resumeT);
    this._resumeT = setTimeout(() => this.#resume(), Math.max(4000, String(text).length * 110 / Math.max(0.3, u.rate || 1)) + 3000);
    // pequena pausa depois do cancel evita que o Android descarte a nova fala
    if (interrupt && busy) setTimeout(() => synth.speak(u), 90);
    else synth.speak(u);
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

  #emitWake(transcript) {
    const now = Date.now();
    if (now - this.lastWakeAt < 1500) return;
    this.lastWakeAt = now;
    this.emit('wake', { command: '', transcript });
  }

  #fireEarly(transcript) {
    this.earlyWake = true;
    this.#emitWake(transcript);
  }

  #begin() {
    const Rec = this.env.SpeechRecognition || this.env.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
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
          const wake = this.getSetting('assistant.name', 'Bolt');
          if (!res.isFinal) {
            // Resposta imediata: se o que se ouviu até agora é só o nome (ou "Bolt, tá na escuta?")
            // e a hipótese parou de mudar, o assistente responde sem esperar o fim da frase.
            const partial = extractAfterWake(text, wake);
            clearTimeout(this.wakeTimer);
            if (partial !== null && isBareWake(partial) && Date.now() >= this.armedUntil) {
              this.wakeTimer = setTimeout(() => this.#fireEarly(text), 380);
            }
            continue;
          }
          clearTimeout(this.wakeTimer);
          if (Date.now() < this.armedUntil && String(text).trim()) {
            this.armedUntil = 0;
            this.earlyWake = false;
            this.emit('result', { text: String(text).trim(), final: true, viaWake: true });
            continue;
          }
          const cmd = extractAfterWake(text, wake);
          if (cmd === null) { this.earlyWake = false; continue; }
          if (isBareWake(cmd)) {
            if (!this.earlyWake) this.#emitWake(text);
            this.earlyWake = false;
            continue;
          }
          this.earlyWake = false;
          this.emit('wake', { command: cmd, transcript: text });
          this.emit('result', { text: cmd, final: true, viaWake: true });
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
      if (this.paused) return;
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
    clearTimeout(this.wakeTimer);
    this.earlyWake = false;
    try {
      this.rec?.stop();
    } catch {
      /* ignora */
    }
  }
}
