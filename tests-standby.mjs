/* Testes da escuta por nome (resposta imediata) e dos comandos de voz do modo espera. Rodar: node tests-standby.mjs */
import assert from 'node:assert/strict';
import { VoiceService, extractAfterWake, isBareWake } from './voice.js';
import { matchCommand } from './assistant.js';

const tests = [];
const test = (n, f) => tests.push({ n, f });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reconhecimento de voz falso: o teste empurra resultados parciais e finais. */
function makeEnv() {
  const env = { instances: [] };
  env.SpeechRecognition = class {
    constructor() { env.instances.push(this); }
    start() { setTimeout(() => this.onstart?.(), 0); }
    stop() { setTimeout(() => this.onend?.(), 0); }
    abort() { this.stop(); }
  };
  env.push = (text, isFinal) => {
    const rec = env.instances.at(-1);
    const res = [{ transcript: text }];
    res.isFinal = isFinal;
    rec.onresult({ resultIndex: 0, results: [res] });
  };
  return env;
}
const mk = (settings = {}) => {
  const env = makeEnv();
  const v = new VoiceService({ getSetting: (p, d) => (p in settings ? settings[p] : d), env });
  const log = [];
  v.on('wake', (e) => log.push(['wake', e.command]));
  v.on('result', (e) => log.push(['result', e.text]));
  v.startListening({ mode: 'continuous' });
  return { env, v, log };
};

test('isBareWake: só o nome ou checagem de presença; comandos de verdade não', () => {
  for (const c of ['', 'ta na escuta', 'tá na escuta', 'esta ouvindo', 'ta ai', 'voce esta me ouvindo', 'oi', 'ei ta ai', 'esta na escuta ai']) assert.ok(isBareWake(c), c);
  for (const c of ['qual a temperatura', 'ta quente o motor', 'como esta a bateria', 'quanto de combustivel', 'modo espera']) assert.ok(!isBareWake(c), c);
});

test('extractAfterWake continua reconhecendo variações do nome', () => {
  assert.equal(extractAfterWake('Bolt, qual a temperatura', 'Bolt'), 'qual a temperatura');
  assert.equal(extractAfterWake('ei volt tá na escuta', 'Bolt'), 'ta na escuta');
  assert.equal(extractAfterWake('qual a temperatura', 'Bolt'), null);
});

test('responde ANTES do fim da frase quando só se ouviu o nome (parcial "Bolt")', async () => {
  const { env, log, v } = mk();
  await sleep(10);
  env.push('Bolt', false);
  await sleep(150);
  assert.equal(log.length, 0, 'ainda não passou o tempo de confirmação');
  await sleep(350);
  assert.deepEqual(log, [['wake', '']]);
  env.push('Bolt', true); // resultado final chega depois: não pode responder de novo
  await sleep(30);
  assert.deepEqual(log, [['wake', '']]);
  v.stopListening();
});

test('"Bolt, tá na escuta?" responde "oi, pode falar" (wake vazio) e não vira pergunta', async () => {
  const { env, log, v } = mk();
  await sleep(10);
  env.push('Bolt tá na escuta', true);
  await sleep(30);
  assert.deepEqual(log, [['wake', '']]);
  v.stopListening();
});

test('"Bolt, qual a temperatura" NÃO dispara resposta antecipada e vira comando', async () => {
  const { env, log, v } = mk();
  await sleep(10);
  env.push('Bolt', false);
  env.push('Bolt qual', false);
  env.push('Bolt qual a temperatura', false);
  await sleep(500);
  assert.equal(log.length, 0);
  env.push('Bolt qual a temperatura', true);
  await sleep(30);
  assert.deepEqual(log, [['wake', 'qual a temperatura'], ['result', 'qual a temperatura']]);
  v.stopListening();
});

test('ignora conversa sem o nome do assistente', async () => {
  const { env, log, v } = mk();
  await sleep(10);
  env.push('vamos parar no posto', false);
  env.push('vamos parar no posto', true);
  await sleep(500);
  assert.equal(log.length, 0);
  v.stopListening();
});

test('depois do "pode falar" (armado) a frase seguinte vale sem repetir o nome', async () => {
  const { env, log, v } = mk();
  await sleep(10);
  v.arm(5000);
  env.push('qual a bateria', true);
  await sleep(30);
  assert.deepEqual(log, [['result', 'qual a bateria']]);
  v.stopListening();
});

test('dois chamados seguidos em menos de 1,5 s respondem uma vez só', async () => {
  const { env, log, v } = mk();
  await sleep(10);
  env.push('Bolt', true);
  env.push('Bolt', true);
  await sleep(30);
  assert.equal(log.filter((l) => l[0] === 'wake').length, 1);
  v.stopListening();
});

test('comandos de voz do modo espera', () => {
  for (const t of ['Bolt modo espera', 'entra em modo de espera', 'protetor de tela', 'só a cara']) assert.equal(matchCommand(t), 'standby', t);
  for (const t of ['sair do modo espera', 'volta pro painel', 'mostrar painel', 'desliga o modo espera', 'tela normal']) assert.equal(matchCommand(t), 'wake', t);
  for (const t of ['qual a temperatura', 'como está a espera da manutenção', 'quero um painel novo']) assert.equal(matchCommand(t), null, t);
});

let failed = 0;
for (const { n, f } of tests) {
  try { await f(); console.log('  ok  ', n); } catch (e) { failed++; console.log('  FALHOU', n, '\n     ', e.message); }
}
console.log(failed ? `\n${failed} falharam.` : `\n${tests.length}/${tests.length} testes passaram.`);
process.exit(failed ? 1 : 0);
