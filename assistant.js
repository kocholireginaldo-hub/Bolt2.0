/**
 * Assistente BOLT: orquestra conversa, personalidade, IA (backend), respostas locais, voz e
 * o estado do mascote. Desligar o assistente NÃO afeta monitoramento OBD2 nem alertas locais.
 */
import { Emitter } from './events.js';
import { uid } from './utils.js';
import { answerLocally } from './assistant-local.js';
import { buildAiContext } from './ai-service.js';

export const PERSONALITIES = {
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
    return this.settings.get('assistant.name', 'BOLT') || 'BOLT';
  }
  get state() {
    return this.transient || this.mood;
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
    if (!this.shouldAnnounce(alert)) return false;
    const sim = alert.simulated ? 'Simulação. ' : '';
    return this.voice.speak(`${sim}${alert.title}. ${this.settings.get('assistant.level') === 'detailed' ? alert.message : ''}`.trim());
  }

  /** Envia uma pergunta. Usa a IA quando possível e cai para resposta local de forma transparente. */
  async send(text, { via = 'text' } = {}) {
    const q = String(text || '').trim();
    if (!q || !this.enabled) return null;
    this.#push('user', q, { via });
    this.busy = true;
    this.#setTransient('thinking');
    const ctx = this.getContext();
    let reply;
    try {
      const useAi = this.connectivity.online && this.ai.baseUrl && this.ai.health.ai !== false;
      if (useAi) {
        try {
          const history = this.messages
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error)
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.text }));
          const res = await this.ai.ask({
            messages: history,
            context: buildAiContext({ settings: this.settings, engine: ctx.engine, vehicle: ctx.vehicle, alerts: ctx.alerts, dtcs: ctx.dtcs, maintenance: ctx.maintenance }),
            persona: { name: this.name, personality: this.settings.get('assistant.personality', 'friendly'), level: this.settings.get('assistant.level', 'balanced') },
          });
          reply = { text: res.reply, local: false, provider: res.provider };
        } catch (err) {
          const local = answerLocally(q, this.#localCtx(ctx));
          reply = { ...local, text: `${local.text}\n\n(IA indisponível: ${err.message} Resposta local.)`, fallbackReason: err.code };
        }
      } else {
        reply = answerLocally(q, this.#localCtx(ctx));
      }
    } finally {
      this.busy = false;
    }
    this.#push('assistant', reply.text, { local: !!reply.local, provider: reply.provider });
    this.#setTransient(null);
    await this.#persist();
    if (this.settings.get('assistant.voiceEnabled', true)) this.voice.speak(reply.text.replace(/\(IA indisponível[^)]*\)/, ''));
    return reply;
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
