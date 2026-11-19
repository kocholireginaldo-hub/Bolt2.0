/**
 * Respostas LOCAIS do assistente (sem internet e sem IA): interpretam a pergunta por palavras-chave
 * e respondem apenas com dados reais disponíveis. Nunca inventam valores; indicam o que falta.
 */
import { PARAMS } from './config.js';
import { describeDtc } from './dtc-database.js';
import { fmtNum } from './utils.js';

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const TONE = {
  friendly: { ok: '', unavailable: 'Ainda não tenho esse dado.', end: '' },
  professional: { ok: '', unavailable: 'Dado indisponível no momento.', end: '' },
  fun: { ok: '', unavailable: 'Esse eu ainda não consegui ler.', end: '' },
};

function param(engine, id) {
  const r = engine.get(id);
  const def = PARAMS[id];
  if (r.validity === 'valid') return { ok: true, text: `${fmtNum(r.value, def.decimals)} ${def.unit}`, r };
  const why = { stale: 'está desatualizado', invalid: 'veio fora da faixa válida', unsupported: 'não é fornecido por este veículo/adaptador', unavailable: 'ainda não foi lido' }[r.validity];
  return { ok: false, text: `${def.label.toLowerCase()} ${why}`, r };
}

const INTENTS = [
  { id: 'temp', re: /(temperatura|esquent|aquec|arrefec|quente)/, param: 'coolantTemp', label: 'A temperatura do motor' },
  { id: 'rpm', re: /(rpm|rotacao|giro)/, param: 'rpm', label: 'A rotação' },
  { id: 'speed', re: /(velocidade|rapido|km\/h)/, param: 'speed', label: 'A velocidade' },
  { id: 'battery', re: /(bateria|tensao|voltagem|alternador)/, param: 'batteryVoltage', label: 'A tensão da bateria' },
  { id: 'fuel', re: /(combustivel|tanque|gasolina|etanol|diesel|autonomia)/, param: 'fuelLevel', label: 'O combustível' },
  { id: 'load', re: /(carga)/, param: 'engineLoad', label: 'A carga do motor' },
  { id: 'intake', re: /(admissao|ar de entrada)/, param: 'intakeTemp', label: 'A temperatura do ar de admissão' },
];

/**
 * @param {string} text pergunta do usuário
 * @param {{engine:any, alerts:any[], dtcs:any[], maintenance:any[], trip:any, obdLabel:string, personality?:string, internet:boolean, simulated:boolean}} ctx
 */
export function answerLocally(text, ctx) {
  const q = norm(text);
  const tone = TONE[ctx.personality] || TONE.friendly;
  const sim = ctx.simulated ? ' (dados de SIMULAÇÃO)' : '';
  const lines = [];

  if (ctx.engine.source === 'none' && !/(ajuda|o que voce|alerta|manutencao|codigo|dtc|falha)/.test(q)) {
    return { text: 'Não há fonte de dados ativa. Conecte o adaptador OBD2 ou ative a simulação no Laboratório para eu poder responder sobre o veículo.', local: true };
  }

  const dtcMatch = q.match(/\b([pcbu][0-3][0-9a-f]{3})\b/);
  if (dtcMatch) {
    const d = describeDtc(dtcMatch[1]);
    const desc = d.description ? `${d.description}.` : 'Não tenho a descrição deste código na base local.';
    return { text: `${d.code} (${d.system}): ${desc} ${d.note}`, local: true };
  }

  if (/(consumo|km\/l|economia)/.test(q)) {
    const f = ctx.engine.fuel();
    if (f.flowLph == null) return { text: `Não consigo estimar o consumo: faltam dados (carga, rotação e cilindrada do veículo) ou o combustível não tem estimativa suportada.`, local: true };
    const inst = f.instantKmL ? `${fmtNum(f.instantKmL, 1)} km/L` : 'parado (sem km/L instantâneo)';
    const avg = ctx.trip?.avgKmL ? ` Média da viagem: ${fmtNum(ctx.trip.avgKmL, 1)} km/L.` : '';
    return { text: `Consumo instantâneo estimado: ${inst} (${fmtNum(f.flowLph, 1)} L/h, método: ${f.method === 'load' ? 'carga do motor' : f.method === 'maf' ? 'MAF' : 'taxa medida'}).${avg} É uma estimativa.${sim}`, local: true };
  }

  if (/(alerta|problema|tudo bem|esta ok|status|resumo|como esta)/.test(q)) {
    if (!ctx.alerts.length) lines.push(`Nenhum alerta ativo no momento${sim}.`);
    else lines.push(`${ctx.alerts.length} alerta(s) ativo(s): ` + ctx.alerts.slice(0, 4).map((a) => `${a.title} — ${a.message}`).join(' | '));
    if (/(resumo|status|como esta|tudo bem)/.test(q)) {
      for (const id of ['speed', 'rpm', 'coolantTemp', 'batteryVoltage', 'fuelLevel']) {
        const p = param(ctx.engine, id);
        lines.push(`${PARAMS[id].label}: ${p.ok ? p.text : p.text}.`);
      }
    }
    return { text: lines.join('\n'), local: true };
  }

  if (/(codigo|dtc|falha|diagnostico|luz do motor|injecao)/.test(q)) {
    if (!ctx.dtcs.length) return { text: `Nenhum código de falha registrado na última leitura${sim}. Se ainda não fez a leitura, abra Diagnóstico e toque em "Ler códigos".`, local: true };
    return { text: ctx.dtcs.map((d) => `${d.code}: ${d.description || 'sem descrição na base local'} (${d.status})`).join('\n'), local: true };
  }

  if (/(manutencao|oleo|revisao|filtro|vela|correia|freio)/.test(q)) {
    const items = ctx.maintenance.filter((m) => m.status === 'overdue' || m.status === 'soon');
    if (!ctx.maintenance.length) return { text: 'Nenhum item na agenda preventiva ainda. Cadastre os serviços e intervalos do manual em Manutenção.', local: true };
    if (!items.length) return { text: 'Nenhum serviço vencido ou próximo do vencimento na sua agenda.', local: true };
    return { text: items.map((m) => `${m.name}: ${m.detail}`).join('\n'), local: true };
  }

  if (/(viagem|distancia|percorri|quilometr)/.test(q)) {
    const t = ctx.trip;
    if (!t?.active) return { text: 'Não há viagem em andamento.', local: true };
    return { text: `Viagem atual: ${fmtNum(t.distanceKm, 1)} km, velocidade média ${fmtNum(t.avgSpeedKmh, 0)} km/h em movimento.${sim}`, local: true };
  }

  if (/(obd|conexao|adaptador|conectad)/.test(q)) {
    return { text: `OBD2: ${ctx.obdLabel}. Internet: ${ctx.internet ? 'online' : 'offline'}.`, local: true };
  }

  for (const it of INTENTS) {
    if (it.re.test(q)) {
      const p = param(ctx.engine, it.param);
      return { text: p.ok ? `${it.label} está em ${p.text}${sim}.` : `${tone.unavailable} ${p.text.charAt(0).toUpperCase() + p.text.slice(1)}.`, local: true };
    }
  }

  if (/(ola|oi|bom dia|boa tarde|boa noite|e ai)/.test(q)) return { text: 'Olá! Pergunte sobre temperatura, rotação, bateria, combustível, alertas, falhas ou manutenção.', local: true };
  if (/(ajuda|o que voce|o que sabe|comandos)/.test(q)) return { text: 'Posso informar velocidade, rotação, temperatura, bateria, combustível, consumo, alertas, códigos de falha, manutenção e a viagem atual. Com a IA online, também respondo perguntas livres.', local: true };

  return {
    text: ctx.internet
      ? 'Não consegui responder isso com os dados locais e a IA não está disponível agora.'
      : 'Estou sem internet, então só respondo perguntas sobre os dados do veículo (temperatura, rotação, bateria, combustível, alertas, falhas, manutenção).',
    local: true,
    unhandled: true,
  };
}
