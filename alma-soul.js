/**
 * ALMA DO CARRO — a alma do veículo.
 * Personalidades (imponente / debochada), falas automáticas que reagem ao que acontece com o carro,
 * respostas locais com o jeito da alma e a conversa com a IA do Claude.
 * Tudo aqui usa os MESMOS dados reais do motor de dados (OBD2 ou Laboratório): nada é inventado.
 */
import { resolveLimits } from './alerts.js';

export const SOUL_TONES = ['imponente', 'debochado'];
export const isSoulTone = (p) => SOUL_TONES.includes(p);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const num = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d).replace('.', ','));

/* ---------- falas automáticas ---------- */
export const LINES = {
  start: {
    imponente: ['Sistemas online. Sou o {n}, e estou com você, {d}. Para onde vamos?', 'Motor ligado, {d}. Todos os sistemas respondem. Pode seguir.', 'Despertei. Cada válvula, cada pistão, ao seu comando, {d}.'],
    debochado: ['Opa, acordou o gigante. Pode ir, {d}, mas sem pisar fundo com o motor frio, combinado?', 'Ligou sem nem dar bom dia? Tudo bem, {d}, eu releva. Vamos nessa.', 'Tô de pé, {d}. Café eu não tomo, mas gasolina eu aceito.'],
  },
  stop: {
    imponente: ['Desligando sistemas. Descanse, {d}. Eu vigio o estacionamento.', 'Missão encerrada por hoje. Até a próxima jornada, {d}.'],
    debochado: ['Fim de expediente. Boa, {d}, nem sujei o óleo hoje.', 'Desligou? Tá bom, vou ali tirar um cochilo de arrefecimento.'],
  },
  cold: {
    imponente: ['Motor ainda frio, {d}. Dê tempo ao óleo para chegar a cada canto.', 'Estou em {t} graus. Sem pressa, aquecer é respeitar a máquina.'],
    debochado: ['Calma aí, {d}! Tô com {t} graus, ainda na preguiça. Sem acelerar forte.', 'Motor frio e você de pé embaixo? Respira, {d}, deixa eu esquentar.'],
  },
  warm: {
    imponente: ['Temperatura ideal alcançada. Estou pronto para o que vier, {d}.', '{t} graus. Agora sim, plena potência disponível.'],
    debochado: ['Esquentei, {d}! Agora pode me pedir mais um pouquinho.', '{t} graus, no ponto. Pode andar, com educação.'],
  },
  hot: {
    imponente: ['Alerta: temperatura do motor em {t} graus. Reduza o ritmo e procure um lugar seguro, {d}.', 'Estou superaquecendo, {d}. Encoste com segurança e desligue se a temperatura subir mais.'],
    debochado: ['Ei, {d}, tô fervendo aqui, {t} graus! Alivia o pé e encosta quando der.', 'Tô derretendo, {d}! {t} graus. Bora parar num lugar seguro.'],
  },
  lowbatt: {
    imponente: ['Tensão em {b} volts. Meu sistema elétrico pede atenção, {d}. Vale revisar a bateria e o alternador.', 'Energia baixa, {b} volts. Não me deixe na mão, {d}, confira a bateria em breve.'],
    debochado: ['Bateria em {b} volts, {d}. Tô sem fôlego elétrico, dá uma olhada nisso logo.', '{b} volts... tá fraquinha, hein. Melhor conferir bateria e alternador antes de eu apagar no meio do caminho.'],
  },
  highrpm: {
    imponente: ['Rotação em {r}. Estou no limite, {d}. Troque de marcha.', '{r} giros. Poder de sobra, mas respeite a zona vermelha.'],
    debochado: ['{r} giros, {d}! Quer me ver gritar? Troca a marcha, vai.', 'Tô cantando alto aqui, {r} rpm. Sobe uma marcha, campeão.'],
  },
  speeding: {
    imponente: ['Velocidade em {v} quilômetros por hora, acima do limite das rodovias, {d}. Mantenha a vigilância.', '{v} por hora. A estrada exige respeito, {d}. Reduza.'],
    debochado: ['{v} por hora, {d}! A fiscalização não perdoa e eu não pago multa.', 'Tá voando, {d}: {v} por hora. Alivia aí, que eu quero chegar inteiro.'],
  },
  lowfuel: {
    imponente: ['Combustível em {f} por cento. Reserva à vista, {d}. Abasteça logo.', 'Meu tanque se esvazia, {f} por cento. Busque um posto.'],
    debochado: ['{f}% no tanque, {d}. Bora abastecer antes que eu vire enfeite de acostamento.', 'Tô quase seco, {f}%. Posto na próxima, combinado?'],
  },
  brake: {
    imponente: ['Frenagem forte detectada. Estou bem, {d}. Distância segura é a melhor armadura.', 'Freada brusca registrada. Sigo firme ao seu lado, {d}.'],
    debochado: ['Eita, freada forte! Tô inteiro, {d}. Mantém mais distância da próxima, tá?', 'Meu freio gritou! Tá tudo bem, {d}? Respira e segue.'],
  },
  idle: {
    imponente: ['Estamos parados há alguns minutos, {d}. Se for esperar mais, considere desligar o motor.'],
    debochado: ['Parado de motor ligado, {d}? Tô gastando combustível só pra ouvir o rádio. Desliga se vai demorar.'],
  },
  long: {
    imponente: ['Já rodamos por muito tempo, {d}. Uma pausa renova o piloto tanto quanto a máquina.'],
    debochado: ['{d}, faz mais de duas horas que a gente roda. Para um pouco, bebe uma água, estica a perna.'],
  },
};
// tempo mínimo (s) entre repetições da mesma fala
const CD = { start: 0, stop: 0, cold: 120, warm: 600, hot: 60, lowbatt: 120, highrpm: 45, speeding: 90, lowfuel: 300, brake: 45, idle: 300, long: 3600 };

const lastPick = {};
export function pick(key, arr) {
  let i = Math.floor(Math.random() * arr.length);
  if (arr.length > 1 && i === lastPick[key]) i = (i + 1) % arr.length;
  lastPick[key] = i;
  return arr[i];
}

/** Valores reais atuais (null quando a leitura não é válida). */
export function liveValues(engine) {
  const v = (id) => {
    const r = engine.get(id);
    return r && r.validity === 'valid' ? r.value : null;
  };
  const rpm = v('rpm');
  return {
    source: engine.source,
    rpm,
    speed: v('speed'),
    cool: v('coolantTemp'),
    volt: v('batteryVoltage'),
    fuel: v('fuelLevel'),
    load: v('engineLoad'),
    intake: v('intakeTemp'),
    on: rpm != null && rpm > 300,
  };
}

export function fmtLine(s, { name, driver, T }) {
  return s
    .replace(/\{n\}/g, name)
    .replace(/\{d\}/g, driver)
    .replace(/\{t\}/g, num(T.cool, 0))
    .replace(/\{b\}/g, num(T.volt, 1))
    .replace(/\{v\}/g, num(T.speed, 0))
    .replace(/\{r\}/g, num(T.rpm, 0))
    .replace(/\{f\}/g, num(T.fuel, 0));
}

export function greetingLine(tone, driver, awake) {
  if (!isSoulTone(tone)) return `Olá, ${driver}! Como posso ajudar?`;
  if (!awake) return tone === 'debochado' ? `Tô dormindo aqui. Dá a partida que eu acordo, ${driver}.` : `Sistemas em espera. Dê a partida e eu desperto, ${driver}.`;
  return tone === 'debochado' ? `Opa, ${driver}! Fala comigo.` : `Presente, ${driver}. O que você precisa?`;
}

/* ---------- reações automáticas ---------- */
export class SoulEvents {
  /**
   * @param {{engine:any, getVehicle:()=>any, getSetting:(p:string,d?:any)=>any, say:(text:string)=>void, onAwake:(on:boolean)=>void}} deps
   */
  constructor({ engine, getVehicle, getSetting, say, onAwake }) {
    this.engine = engine;
    this.getVehicle = getVehicle;
    this.getSetting = getSetting;
    this.say = say;
    this.onAwake = onAwake;
    this.last = {};
    this.gap = 0;
    this.prev = false;
    this.prevCool = null;
    this.flags = {};
    this.hist = [];
    this.idle = 0;
    this.run = 0;
    this.longN = 0;
    this.timer = null;
    this.lastTick = 0;
  }

  start() {
    this.lastTick = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(2, (now - this.lastTick) / 1000);
      this.lastTick = now;
      try { this.step(dt); } catch { /* nunca derruba o app */ }
    }, 500);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  fire(key, force = false) {
    if (!this.getSetting('assistant.enabled', true) || !this.getSetting('assistant.autoComment', true)) return;
    const tone = this.getSetting('assistant.personality', 'imponente');
    if (!isSoulTone(tone)) return;
    const now = performance.now() / 1000;
    if (!force) {
      if (this.last[key] && now - this.last[key] < CD[key]) return;
      if (now - this.gap < 6) return;
    }
    this.last[key] = now;
    this.gap = now;
    const T = liveValues(this.engine);
    const text = fmtLine(pick(key, LINES[key][tone]), { name: this.getSetting('assistant.name', 'Bolt'), driver: this.getSetting('driver.name', '') || 'amigo', T });
    this.say(text);
  }

  step(dt) {
    const T = liveValues(this.engine);
    const on = T.on && T.source !== 'none';
    this.onAwake(on);
    if (on && !this.prev) {
      this.run = 0; this.flags = {}; this.idle = 0; this.longN = 0; this.hist = [];
      this.fire('start', true);
    }
    if (!on && this.prev) this.fire('stop', true);
    this.prev = on;
    if (!on) { this.prevCool = T.cool; return; }
    this.run += dt;
    const lim = resolveLimits(this.getVehicle());
    const warmed = this.run > 8;
    const lowFuelPct = Number(this.getSetting('alerts.lowFuelPct', 15));
    if (T.cool != null && T.cool < 60 && T.rpm > 3500 && !this.flags.cold) { this.flags.cold = true; this.fire('cold'); }
    if (T.cool != null && this.prevCool != null && this.prevCool < 80 && T.cool >= 80 && T.cool < 100) this.fire('warm');
    if (T.cool != null && T.cool >= lim.coolantWarn) this.fire('hot');
    if (warmed && T.volt != null && T.volt < 13.0 * (lim.voltageScale || 1)) this.fire('lowbatt');
    if (T.rpm != null && T.rpm >= lim.redlineRpm - 200) this.fire('highrpm');
    if (T.speed != null && T.speed > 110) this.fire('speeding');
    if (T.fuel != null && T.fuel < lowFuelPct) this.fire('lowfuel');
    if (T.speed != null) {
      this.hist.push({ t: this.run, v: T.speed });
      while (this.hist.length && this.run - this.hist[0].t > 2.5) this.hist.shift();
      if (this.hist.length && this.hist[0].v - T.speed >= 22) this.fire('brake');
      if (T.speed < 2) this.idle += dt; else this.idle = 0;
      if (this.idle > 180) { this.idle = 0; this.fire('idle'); }
    }
    const n = Math.floor(this.run / 7200);
    if (n > this.longN) { this.longN = n; this.fire('long', true); }
    this.prevCool = T.cool;
  }
}

/* ---------- respostas locais com o jeito da alma ---------- */
const DEFER = /falha|defeito|diagn|scanner|check engine|luz de inje|c[oó]digo|manuten|alerta|consumo|viagem|obd|adaptador|conex/;

/**
 * Responde com a personalidade da alma. Devolve null quando a pergunta é de dados que o assistente
 * técnico já sabe responder melhor (alertas, falhas, manutenção, consumo, viagem, conexão).
 */
export function soulReply(text, { tone, name, driver, vehicleName, T }) {
  const s = norm(text);
  if (DEFER.test(s)) return null;
  const I = tone === 'imponente';
  const d = driver || 'amigo';
  const ch = (a, b) => (I ? a : b);
  const nodata = T.source === 'none';
  const noData = ch('Ainda não recebo dados do carro, ' + d + '. Conecte o OBD2 ou ligue o Laboratório.', 'Tô sem dados aqui, ' + d + '. Conecta o OBD2 ou liga o Laboratório.');
  const asleep = ch('O motor está desligado, ' + d + '. Dê a partida e eu acordo por completo.', 'Tô dormindo ainda, ' + d + '. Dá a partida que eu acordo.');
  if (/quem (e|eh) voc|seu nome|se apresent/.test(s))
    return ch('Eu sou ' + name + ', a alma deste ' + vehicleName + '. Sinto cada giro do motor e cada quilômetro ao seu lado, ' + d + '.', 'Sou o ' + name + ', a alma desse ' + vehicleName + '. Metade motor, metade conversa fiada, ' + d + '.');
  if (/bateria|voltagem|tensao/.test(s)) {
    if (nodata) return noData;
    if (T.volt == null) return 'Não recebi leitura de tensão do adaptador.';
    return ch('Minha tensão está em ' + num(T.volt, 1) + ' volts. ' + (T.on ? (T.volt >= 13.2 ? 'O alternador cumpre seu dever.' : 'Vale revisar a bateria e o alternador.') : 'Em repouso, acima de 12,2 é saudável.'), 'Tô com ' + num(T.volt, 1) + ' volts, ' + d + '. ' + (T.on ? (T.volt >= 13.2 ? 'Alternador firme.' : 'Tá meio fraco, hein.') : 'Parado, de 12,2 pra cima tá de boa.'));
  }
  if (/combust|gasolina|etanol|tanque|autonomia/.test(s)) {
    if (nodata) return noData;
    if (T.fuel == null) return 'Meu adaptador não informa o nível do tanque.';
    return ch('Restam ' + num(T.fuel, 0) + ' por cento no tanque, ' + d + '.', 'Tem ' + num(T.fuel, 0) + '% no tanque, ' + d + '. ' + (T.fuel < 25 ? 'Bora abastecer.' : 'Dá pra ir longe.'));
  }
  if (/temperatura|motor|esquent|quente|aquec/.test(s)) {
    if (nodata) return noData;
    if (!T.on) return asleep;
    return ch('Temperatura em ' + num(T.cool, 0) + ' graus, rotação em ' + num(T.rpm, 0) + '. ' + (T.cool == null ? '' : T.cool < 80 ? 'Ainda aquecendo.' : T.cool <= 102 ? 'Tudo dentro do esperado.' : 'Atenção ao calor.'), 'Tô a ' + num(T.cool, 0) + ' graus e ' + num(T.rpm, 0) + ' rpm. ' + (T.cool == null ? '' : T.cool < 80 ? 'Ainda me espreguiçando.' : T.cool <= 102 ? 'Tudo nos conformes.' : 'Tá esquentando, hein.'));
  }
  if (/dirig|dirijo|velocidade|rapido|devagar|quanto estou/.test(s)) {
    if (nodata) return noData;
    if (!T.on) return asleep;
    if (T.speed == null) return 'Meu adaptador não informa a velocidade.';
    const v = Math.round(T.speed);
    return ch('Estamos a ' + v + ' quilômetros por hora. ' + (v > 110 ? 'Acima do limite, reduza.' : v < 5 ? 'Parados por ora.' : 'Ritmo seguro, ' + d + '.'), 'Tamo a ' + v + ' por hora. ' + (v > 110 ? 'Alivia o pé!' : v < 5 ? 'Parados, né.' : 'Dirigindo bonito, ' + d + '.'));
  }
  if (/sono|cans|dormi|sonol|bocej/.test(s))
    return ch('Cuide de si, ' + d + '. Procure um lugar seguro, pare e descanse. Eu espero o tempo que for preciso.', 'Ei, ' + d + ', sono e volante não combinam. Encosta num lugar seguro e tira um cochilo, eu espero.');
  if (/historia|conta/.test(s))
    return pick('story', ch(['Fui forjado para o terreno difícil. Cada estrada de terra é um capítulo, e cada viagem com você escreve o próximo.', 'Dizem que máquinas não sonham. Mas quando você desliga a chave, eu repasso cada curva que fizemos juntos.'], ['Era uma vez um carro que adorava aventura e odiava buraco. A moral, ' + d + ': desvia do buraco.', 'Nasci numa linha de montagem, mas minha história de verdade começou quando você girou a chave pela primeira vez.']));
  if (/piada|engra/.test(s))
    return ch('Por que o carro nunca se perde? Porque sempre segue o seu caminho.', 'Por que o carro foi ao terapeuta? Muita bagagem emocional, e o porta-malas cheio.');
  if (/obrigad|valeu/.test(s)) return ch('Sempre, ' + d + '. Esse é o meu propósito.', 'Tamo junto, ' + d + '.');
  if (/tchau|ate mais|boa noite/.test(s)) return ch('Até a próxima jornada, ' + d + '. Estarei aqui.', 'Falou, ' + d + '. Eu fico de olho no estacionamento.');
  if (/(^|\s)(oi|ola|opa)([\s,!.?]|$)/.test(s)) return ch('Presente, ' + d + '. O que você precisa?', 'Opa, ' + d + '! Fala comigo.');
  return null;
}

export function soulFallback({ tone, driver }) {
  const d = driver || 'amigo';
  return tone === 'imponente'
    ? 'Estou ouvindo, ' + d + '. Posso falar do motor, da bateria, do combustível, dos alertas ou apenas fazer companhia na estrada.'
    : 'Tô ouvindo, ' + d + '. Pergunta do motor, da bateria, do tanque, dos alertas, ou só puxa assunto mesmo.';
}

/* ---------- conversa com a IA do Claude ---------- */
export function buildSoulPrompt({ tone, name, driver, vehicleName, teleText, history, question }) {
  const toneText = tone === 'imponente' ? 'grave, solene e imponente, com lealdade quase cerimonial' : 'bem-humorado, irônico e debochado, mas leal e carinhoso';
  const h = history.slice(-8).map((m) => (m.role === 'user' ? 'Motorista' : name) + ': ' + m.text).join('\n');
  return [
    'Você é ' + name + ', a alma e a consciência de um ' + vehicleName + '. Você fala com ' + (driver || 'o motorista') + ', seu motorista, como um robô gigante de filme de ação fala com seu parceiro: voz grave, presença forte, lealdade total.',
    'Tom: ' + toneText + '.',
    'Regras: responda em português do Brasil, em no máximo 2 frases curtas (até 35 palavras). Sem emojis, sem markdown, sem listas, porque a resposta será falada em voz alta. Use os dados do carro apenas quando forem relevantes e nunca invente leituras que não estejam nos dados. Se o motorista parecer cansado ou distraído, cuide dele e sugira uma pausa segura. Nunca incentive velocidade, ultrapassagens ou qualquer coisa que reduza a segurança. Você não controla o carro, apenas conversa e observa.',
    'Dados do carro agora: ' + teleText + '.',
    'Conversa recente:\n' + (h || '(início da conversa)'),
    'Motorista: ' + question + '\n' + name + ':',
  ].join('\n\n');
}

export function cleanReply(t, name) {
  return String(t || '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').replace(new RegExp('^' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*', 'i'), '').trim().slice(0, 320);
}

/** Texto com os dados reais do carro para a IA (só o que existe; o resto vai como "sem leitura"). */
export function telemetryText(T, { dtcs = [], alerts = [], simulated = false } = {}) {
  const v = (x, u, d = 0) => (x == null ? 'sem leitura' : num(x, d) + u);
  return 'origem dos dados ' + (simulated ? 'SIMULAÇÃO' : T.source === 'obd' ? 'OBD2 real' : 'sem fonte') + '; motor ' + (T.on ? 'ligado' : 'desligado') + '; rotação ' + v(T.rpm, ' rpm') + '; velocidade ' + v(T.speed, ' km/h') + '; temperatura do motor ' + v(T.cool, ' °C') + '; bateria ' + v(T.volt, ' V', 1) + '; combustível ' + v(T.fuel, ' %') + '; carga do motor ' + v(T.load, ' %') + '; ar de admissão ' + v(T.intake, ' °C') + '; falhas registradas: ' + (dtcs.length ? dtcs.map((d) => d.code).join(', ') : 'nenhuma lida') + (alerts.length ? '; alertas ativos: ' + alerts.map((a) => a.title).join(', ') : '');
}

let brainPromise = null;
/** IA do Claude disponível quando o app roda dentro do Claude (window.claude). Sem ela, nada quebra. */
export function getBrain() {
  if (brainPromise) return brainPromise;
  brainPromise = (async () => {
    try {
      const c = globalThis.window?.claude;
      if (!c || !c.use) return null;
      const s = await c.use('sample');
      return typeof s === 'function' ? s : null;
    } catch {
      return null;
    }
  })();
  return brainPromise;
}
export function resetBrain() {
  brainPromise = Promise.resolve(null);
}
