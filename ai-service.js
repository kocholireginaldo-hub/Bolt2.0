/**
 * Cliente da API de IA. A chave NUNCA fica no navegador: este módulo só fala com o backend do
 * BOLT (server.js), que guarda a chave em variáveis de ambiente. Envia apenas dados mínimos,
 * conforme as opções de privacidade escolhidas pelo usuário.
 */
import { Emitter } from './events.js';

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

export class AiService extends Emitter {
  /** @param {{getSetting:(p:string,d?:any)=>any, fetchFn?:typeof fetch}} deps */
  constructor({ getSetting, fetchFn = (...a) => fetch(...a) }) {
    super();
    this.getSetting = getSetting;
    this.fetch = fetchFn;
    this.health = { checkedAt: 0, ok: false, ai: false, reason: 'Não verificado' };
  }

  get baseUrl() {
    const u = String(this.getSetting('ai.backendUrl', '') || '').trim().replace(/\/+$/, '');
    if (u) return u;
    return typeof location !== 'undefined' && /^https?:/.test(location.protocol) ? location.origin : '';
  }

  /** Verifica o backend e se a IA está configurada nele. */
  async check() {
    const base = this.baseUrl;
    if (!base) {
      this.health = { checkedAt: Date.now(), ok: false, ai: false, reason: 'Backend não configurado' };
      this.emit('health', this.health);
      return this.health;
    }
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const res = await this.fetch(`${base}/api/health`, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      this.health = { checkedAt: Date.now(), ok: true, ai: !!j.ai, provider: j.provider || null, wifiBridge: !!j.wifiBridge, reason: j.ai ? 'IA disponível' : 'Backend ativo, mas a chave da IA não está configurada' };
    } catch (err) {
      this.health = { checkedAt: Date.now(), ok: false, ai: false, reason: `Backend inacessível (${err?.message || 'erro'})` };
    }
    this.emit('health', this.health);
    return this.health;
  }

  /**
   * @param {{messages:{role:'user'|'assistant',content:string}[], context:object, persona:object}} payload
   * @returns {Promise<{reply:string, provider?:string, model?:string}>}
   */
  async ask(payload) {
    const base = this.baseUrl;
    if (!base) throw new AiError('NO_BACKEND', 'Backend de IA não configurado.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Number(this.getSetting('ai.timeoutMs', 25000)));
    this._ctl = ctl;
    try {
      const res = await this.fetch(`${base}/api/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map = {
          ai_not_configured: ['NOT_CONFIGURED', 'A IA não está configurada no backend (defina AI_API_KEY).'],
          rate_limited: ['RATE_LIMITED', 'Muitas perguntas seguidas. Aguarde um instante.'],
          upstream_error: ['UPSTREAM', 'O provedor de IA retornou erro.'],
        };
        const [code, msg] = map[body.error] || ['HTTP', body.message || `Falha do backend (HTTP ${res.status}).`];
        throw new AiError(code, msg);
      }
      if (typeof body.reply !== 'string' || !body.reply.trim()) throw new AiError('EMPTY', 'A IA não retornou resposta.');
      return body;
    } catch (err) {
      if (err instanceof AiError) throw err;
      if (err?.name === 'AbortError') throw new AiError('TIMEOUT', 'A IA demorou demais para responder.');
      throw new AiError('NETWORK', 'Não foi possível alcançar o backend de IA.');
    } finally {
      clearTimeout(timer);
      this._ctl = null;
    }
  }

  cancel() {
    this._ctl?.abort();
  }
}

/**
 * Monta o contexto mínimo enviado à IA, respeitando as opções de privacidade.
 * Nunca inclui placa, VIN, nome do motorista, localização ou histórico de viagens.
 */
export function buildAiContext({ settings, engine, vehicle, alerts = [], dtcs = [], maintenance = [] }) {
  const share = (k) => settings.get(`ai.${k}`, false);
  const ctx = { origem_dos_dados: engine.source === 'simulation' ? 'SIMULAÇÃO (dados fictícios)' : engine.source === 'obd' ? 'OBD2 real' : 'sem fonte de dados' };
  if (share('shareVehicleProfile') && vehicle) {
    const t = vehicle.tech;
    ctx.veiculo = { marca: t.make, modelo: t.model, ano: t.year, cilindrada_l: t.displacementL, combustivel: t.fuelType, aspiracao: t.aspiration, rotacao_maxima_rpm: t.redlineRpm };
  }
  if (share('shareLiveData')) {
    const dados = {};
    const indisponiveis = [];
    for (const [id, r] of Object.entries(engine.snapshot().params)) {
      if (r.validity === 'valid') dados[id] = { valor: Math.round(r.value * 100) / 100, unidade: r.unit };
      else indisponiveis.push(`${id}: ${r.validity}`);
    }
    ctx.dados_ao_vivo = dados;
    ctx.parametros_indisponiveis = indisponiveis;
    const f = engine.fuel();
    if (f.flowLph != null) ctx.consumo_estimado = { litros_por_hora: Math.round(f.flowLph * 10) / 10, metodo: f.method, observacao: 'estimativa' };
  }
  ctx.alertas_ativos = alerts.map((a) => ({ nivel: a.level, titulo: a.title, detalhe: a.message }));
  if (share('shareDiagnostics')) ctx.codigos_dtc = dtcs.map((d) => ({ codigo: d.code, situacao: d.status, descricao: d.description || null }));
  if (share('shareMaintenance')) ctx.manutencao = maintenance.map((m) => ({ servico: m.name, situacao: m.status, detalhe: m.detail }));
  return ctx;
}
