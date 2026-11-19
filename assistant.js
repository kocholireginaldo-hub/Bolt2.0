/**
 * Assistente BOLT: orquestra conversa, personalidade, IA (backend), respostas locais, voz e
 * o estado do mascote. Desligar o assistente NÃO afeta monitoramento OBD2 nem alertas locais.
 */
import { Emitter } from './events.js';
import { uid } from './utils.js';
import { answerLocally } from './assistant-local.js';
import { buildAiContext } from './ai-service.js';
import { isSoulTone, soulReply, soulFallback, buildSoulPrompt, cleanReply, telemetryText, liveValues, getBrain, resetBrain } from './alma-soul.js';

export const PERSONALITIES = {
  imponente: { label: 'Imponente', hint: 'Grave, solene e leal, como a alma de um robô gigante.' },
  debochado: { label: 'Debochado', hint: 'Bem-humorado e irônico, mas leal e carinhoso.' },
  friendly: { label: 'Amigável', hint: 'Caloroso, claro e encorajador.' },
  professional: { label: 'Profissional', hint: 'Objetivo, técnico e direto.' },
  fun: { label: 'Divertido', hint: 'Leve e bem-humorado, sem exageros.' },
};

export const LEVELS = {
  minimal: { label: 'Mínimo', hint: 'Fala só alertas críticos e responde de forma curtíssima.' },
  balanced: { label: 'Equilibrado', hint: 'Alertas de atenção e críticos; respostas curtas.' },
  detailed: { label: 'Detalhado', hint: 'Todos os alertas e respostas explicativas.' },
};

const LEVEL_RANK = { info: 1, attention: 2, critical: 3 };
const MIN_RANK = { minimal: 3, balanced: 2, detailed: 1 };
const MAX_KEEP = 60;

const normCmd = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Comandos de voz que controlam o próprio app (e não são perguntas para a IA). */
export function matchCommand(text) {
  const t = normCmd(text);
  if (/\b(sair|saia|desligar|desliga|fechar|fecha|tirar|tira|encerrar|encerra)\b.*\b(modo|tela) (de )?(espera|descanso)\b|\b(modo|tela) (de )?(espera|descanso)\b.*\b(sair|desligar|desliga|fechar|fecha)\b|\b(mostrar|mostra|abrir|abre|volta|voltar) (o |pro |para o )?painel\b|\btela normal\b|\bsair do protetor/.test(t)) return 'wake';
  if (/\b(modo|tela) (de )?(espera|descanso)\b|\bprotetor de tela\b|\bentrar em espera\b|\bso a cara\b/.test(t)) return 'standby';
  return null;
}

export class Assistant extends Emitter {
  /**
   * @param {{settings:any, ai:any, voice:any, connectivity:any, db:any, getContext:()=>any}} deps
   * getContext devolve { engine, vehicle, alerts, dtcs, maintenance, trip, obdLabel, simulated }
   */
  constructor({ settings, ai, voice, connectivity, db, getContext }) {
    super();
    this.settings = settings;
    this.ai = ai;
    this.voice = voice;
    this.connectivity = connectivity;
    this.db = db;
    this.getContext = getContext;
    this.messages = [];
    this.transient = null; // listening | thinking | speaking
    this.mood = 'normal'; // normal | attention | alert
    this.busy = false;
    this.awake = false; // motor ligado e com dados: a alma desperta
    this.brainOff = false;

    voice.on('wake', ({ command }) => {
      if (!command && this.enabled) {
        voice.arm(10000);
        this.say(this.#ackLine(), { auto: false });
      }
    });
    voice.on('listening', (on) => this.#setTransient(on ? 'listening' : this.busy ? 'thinking' : voice.speaking ? 'speaking' : null));
    voice.on('speaking', (on) => this.#setTransient(on ? 'speaking' : this.busy ? 'thinking' : null));
    voice.on('result', ({ text, final }) => {
      if (final && this.enabled) this.send(text, { via: 'voice' });
    });
  }

  get enabled() {
    return !!this.settings.get('assistant.enabled', true);
  }
  get name() {
    return this.settings.get('assistant.name', 'Bolt') || 'Bolt';
  }
  get driver() {
    return String(this.settings.get('driver.name', '') || '').trim();
  }
  get tone() {
    return this.settings.get('assistant.personality', 'imponente');
  }
  /** Resposta curta e imediata quando alguém chama o nome ("Bolt", "Bolt, tá na escuta?"). */
  #ackLine() {
    const d = this.driver;
    if (this.tone === 'imponente') return d ? `Presente, ${d}. Pode falar.` : 'Presente. Pode falar.';
    if (this.tone === 'debochado') return d ? `Opa, ${d}! Pode falar.` : 'Opa! Pode falar.';
    return d ? `Oi, ${d}. Pode falar.` : 'Oi, pode falar.';
  }

  get state() {
    return this.transient || (this.mood !== 'normal' ? this.mood : this.awake ? 'normal' : 'sleeping');
  }

  /** A alma desperta quando o motor liga (dados válidos de rotação) e dorme quando desliga. */
  setAwake(on) {
    if (this.awake === !!on) return;
    this.awake = !!on;
    this.emit('state', this.state);
  }

  /** Fala por iniciativa própria (reações automáticas, "pode falar"): aparece na conversa e é falada. */
  say(text, { auto = true } = {}) {
    if (!this.enabled || !text) return false;
    this.#push('assistant', text, { local: true, auto, soul: true });
    this.#persist().catch(() => {});
    this.#speak(text);
    return true;
  }

  #speak(text) {
    const spoke = this.settings.get('assistant.voiceEnabled', true) && this.voice.speak(text);
    if (!spoke) this.#pulse(Math.max(1500, text.length * 70));
  }

  /** Mantém o mascote "falando" por um tempo quando a síntese de voz não está disponível. */
  #pulse(ms) {
    clearTimeout(this._pulseT);
    this.#setTransient('speaking');
    this._pulseT = setTimeout(() => { if (!this.voice.speaking) this.#setTransient(this.busy ? 'thinking' : null); }, ms);
  }

  #setTransient(s) {
    if (this.transient === s) return;
    this.transient = s;
    this.emit('state', this.state);
  }

  /** Atualiza o humor do mascote conforme os alertas ativos (independe da IA). */
  setMoodFromAlerts(alerts) {
    const top = alerts.reduce((m, a) => Math.max(m, LEVEL_RANK[a.level] || 0), 0);
    const mood = top >= 3 ? 'alert' : top === 2 ? 'attention' : 'normal';
    if (mood !== this.mood) {
      this.mood = mood;
      this.emit('state', this.state);
    }
  }

  async load() {
    const row = await this.db.get('assistant', 'conversation');
    this.messages = row?.messages || [];
    this.emit('messages', this.messages);
  }

  async #persist() {
    const trimmed = this.messages.slice(-MAX_KEEP);
    this.messages = trimmed;
    await this.db.put('assistant', { id: 'conversation', messages: trimmed, updatedAt: Date.now() });
  }

  async clearHistory() {
    this.messages = [];
    await this.#persist();
    this.emit('messages', this.messages);
  }

  #push(role, text, extra = {}) {
    const m = { id: uid('msg'), role, text, ts: Date.now(), ...extra };
    this.messages.push(m);
    this.emit('messages', this.messages);
    return m;
  }

  /** Decide se um alerta deve ser anunciado por voz conforme o nível de comunicação. */
  shouldAnnounce(alert) {
    if (!this.enabled || !this.settings.get('assistant.announceAlerts', true)) return false;
    if (!this.settings.get('assistant.voiceEnabled', true)) return false;
    const level = this.settings.get('assistant.level', 'balanced');
    return (LEVEL_RANK[alert.level] || 0) >= (MIN_RANK[level] || 2);
  }

  announceAlert(alert) {
    // com a personalidade da alma ligada, ela mesma comenta temperatura, bateria, combustível e rotação
    if (isSoulTone(this.tone) && this.settings.get('assistant.autoComment', true) && ['coolantTemp', 'batteryVoltage', 'fuelLevel', 'rpm'].includes(alert.paramId)) return false;
    if (!this.shouldAnnounce(alert)) return false;
    const sim = alert.simulated ? 'Simulação. ' : '';
    return this.voice.speak(`${sim}${alert.title}. ${this.settings.get('assistant.level') === 'detailed' ? alert.message : ''}`.trim());
  }

  /** Envia uma pergunta. Usa a IA quando possível e cai para resposta local de forma transparente. */
  async send(text, { via = 'text' } = {}) {
    const q = String(text || '').trim();
    if (!q || !this.enabled) return null;
    this.#push('user', q, { via });
    const cmd = matchCommand(q);
    if (cmd) {
      const text = cmd === 'standby' ? 'Modo espera ligado. É só chamar meu nome.' : 'Certo, voltando ao painel.';
      this.#push('assistant', text, { local: true, soul: true });
      await this.#persist();
      this.emit('command', { name: cmd });
      if (cmd === 'standby') this.#speak(text);
      return { text, local: true };
    }
    this.busy = true;
    this.#setTransient('thinking');
    const ctx = this.getContext();
    let reply;
    try {
      reply = await this.#answer(q, ctx);
    } finally {
      this.busy = false;
    }
    this.#push('assistant', reply.text, { local: !!reply.local, provider: reply.provider });
    this.#setTransient(null);
    await this.#persist();
    this.#speak(reply.text.replace(/\(IA indisponível[^)]*\)/, ''));
    return reply;
  }

  #soulCtx(ctx) {
    return {
      tone: this.tone,
      name: this.name,
      driver: this.driver,
      vehicleName: ctx.vehicle ? `${ctx.vehicle.tech.make} ${ctx.vehicle.tech.model}`.trim() : 'carro',
      T: liveValues(ctx.engine),
    };
  }

  /** Ordem: IA do Claude (quando o app roda no Claude) → IA do backend → respostas locais. */
  async #answer(q, ctx) {
    const soul = isSoulTone(this.tone);
    const sc = this.#soulCtx(ctx);
    if (soul && !this.brainOff) {
      const brain = await getBrain();
      if (brain) {
        try {
          const history = this.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error).slice(-9, -1).map((m) => ({ role: m.role, text: m.text }));
          const share = this.settings.get('ai.shareDriverName', true);
          const prompt = buildSoulPrompt({
            tone: sc.tone, name: sc.name, driver: share ? sc.driver : '', vehicleName: sc.vehicleName, history, question: q,
            teleText: telemetryText(sc.T, { dtcs: ctx.dtcs, alerts: ctx.alerts, simulated: ctx.simulated }),
          });
          const r = await brain(prompt, { modelTier: 'quick', cache: false });
          const text = cleanReply(r && r.text, sc.name);
          if (text) return { text, local: false, provider: 'Claude' };
        } catch (err) {
          if (err && err.code === 'not_granted') { this.brainOff = true; resetBrain(); }
        }
      }
    }
    const useAi = this.connectivity.online && this.ai.baseUrl && this.ai.health.ai !== false;
    if (useAi) {
      try {
        const history = this.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error).slice(-10).map((m) => ({ role: m.role, content: m.text }));
        const res = await this.ai.ask({
          messages: history,
          context: buildAiContext({ settings: this.settings, engine: ctx.engine, vehicle: ctx.vehicle, alerts: ctx.alerts, dtcs: ctx.dtcs, maintenance: ctx.maintenance }),
          persona: { name: this.name, personality: this.tone, level: this.settings.get('assistant.level', 'balanced') },
        });
        return { text: res.reply, local: false, provider: res.provider };
      } catch (err) {
        const local = this.#local(q, ctx, soul, sc);
        return { ...local, text: `${local.text}\n\n(IA indisponível: ${err.message} Resposta local.)`, fallbackReason: err.code };
      }
    }
    return this.#local(q, ctx, soul, sc);
  }

  #local(q, ctx, soul, sc) {
    if (soul) {
      const t = soulReply(q, sc);
      if (t) return { text: t, local: true };
    }
    const r = answerLocally(q, this.#localCtx(ctx));
    if (soul && r.unhandled) return { text: soulFallback(sc), local: true };
    return r;
  }

  #localCtx(ctx) {
    return {
      engine: ctx.engine,
      alerts: ctx.alerts,
      dtcs: ctx.dtcs,
      maintenance: ctx.maintenance,
      trip: ctx.trip,
      obdLabel: ctx.obdLabel,
      personality: this.settings.get('assistant.personality', 'friendly'),
      internet: this.connectivity.online,
      simulated: ctx.simulated,
    };
  }
}
