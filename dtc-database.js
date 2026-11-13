/**
 * Base de referência de DTCs genéricos (SAE J2012 / J2012-DA), em português.
 * Cobre apenas códigos genéricos comuns. Códigos específicos do fabricante NÃO são
 * descritos aqui (nunca se inventa significado): a interface orienta consultar o manual.
 * severity: info (baixa) | attention (moderada) | critical (alta) — estimativa genérica,
 * não um diagnóstico. "causes" são possíveis causas de referência geral.
 */

const E = (desc, severity, causes = []) => ({ desc, severity, causes });

const DB = {};
const add = (code, entry) => {
  DB[code] = entry;
};

/* Ar / combustível / sensores */
add('P0011', E('Posição do comando de admissão — avanço excessivo (banco 1)', 'attention', ['Válvula/atuador de variação de comando', 'Óleo do motor inadequado ou nível baixo', 'Corrente/tensionador de comando']));
add('P0012', E('Posição do comando de admissão — atraso excessivo (banco 1)', 'attention', ['Válvula/atuador de variação de comando', 'Óleo do motor inadequado ou nível baixo', 'Corrente/tensionador de comando']));
add('P0016', E('Correlação entre posição do virabrequim e do comando (banco 1, sensor A)', 'attention', ['Sensor de posição do comando ou do virabrequim', 'Correia/corrente de distribuição desalinhada', 'Atuador de variação de comando']));
const air = [
  ['P0100', 'Circuito do medidor de massa de ar (MAF)'],
  ['P0101', 'Medidor de massa de ar (MAF) — faixa/desempenho'],
  ['P0102', 'Medidor de massa de ar (MAF) — sinal baixo'],
  ['P0103', 'Medidor de massa de ar (MAF) — sinal alto'],
];
for (const [c, d] of air) add(c, E(d, 'attention', ['Sensor MAF sujo ou defeituoso', 'Vazamento de ar na admissão', 'Chicote/conector do sensor']));
const map = [
  ['P0105', 'Circuito de pressão absoluta do coletor (MAP)'],
  ['P0106', 'Pressão do coletor (MAP) — faixa/desempenho'],
  ['P0107', 'Pressão do coletor (MAP) — sinal baixo'],
  ['P0108', 'Pressão do coletor (MAP) — sinal alto'],
];
for (const [c, d] of map) add(c, E(d, 'attention', ['Sensor MAP', 'Mangueira de vácuo/vazamento no coletor', 'Chicote/conector do sensor']));
const iat = [
  ['P0110', 'Circuito do sensor de temperatura do ar de admissão (IAT)'],
  ['P0111', 'Temperatura do ar de admissão (IAT) — faixa/desempenho'],
  ['P0112', 'Temperatura do ar de admissão (IAT) — sinal baixo'],
  ['P0113', 'Temperatura do ar de admissão (IAT) — sinal alto'],
];
for (const [c, d] of iat) add(c, E(d, 'info', ['Sensor IAT', 'Chicote/conector do sensor']));
const ect = [
  ['P0115', 'Circuito do sensor de temperatura do líquido de arrefecimento (ECT)'],
  ['P0116', 'Temperatura do líquido de arrefecimento (ECT) — faixa/desempenho'],
  ['P0117', 'Temperatura do líquido de arrefecimento (ECT) — sinal baixo'],
  ['P0118', 'Temperatura do líquido de arrefecimento (ECT) — sinal alto'],
];
for (const [c, d] of ect) add(c, E(d, 'attention', ['Sensor de temperatura do líquido', 'Chicote/conector do sensor', 'Termostato (para faixa/desempenho)']));
const tps = [
  ['P0120', 'Circuito do sensor de posição do acelerador/pedal (A)'],
  ['P0121', 'Posição do acelerador (A) — faixa/desempenho'],
  ['P0122', 'Posição do acelerador (A) — sinal baixo'],
  ['P0123', 'Posição do acelerador (A) — sinal alto'],
];
for (const [c, d] of tps) add(c, E(d, 'attention', ['Sensor de posição do acelerador/corpo de borboleta', 'Chicote/conector do sensor']));
add('P0125', E('Temperatura do líquido insuficiente para controle em malha fechada', 'info', ['Termostato preso aberto', 'Sensor de temperatura do líquido']));
add('P0128', E('Temperatura do líquido abaixo da temperatura de regulagem do termostato', 'info', ['Termostato preso aberto', 'Sensor de temperatura do líquido', 'Nível baixo de líquido de arrefecimento']));

/* Sonda lambda */
const o2b1s1 = [
  ['P0130', 'Circuito do sensor de oxigênio (banco 1, sensor 1)'],
  ['P0131', 'Sensor de oxigênio (banco 1, sensor 1) — tensão baixa'],
  ['P0132', 'Sensor de oxigênio (banco 1, sensor 1) — tensão alta'],
  ['P0133', 'Sensor de oxigênio (banco 1, sensor 1) — resposta lenta'],
  ['P0134', 'Sensor de oxigênio (banco 1, sensor 1) — sem atividade detectada'],
  ['P0135', 'Aquecedor do sensor de oxigênio (banco 1, sensor 1)'],
  ['P0136', 'Circuito do sensor de oxigênio (banco 1, sensor 2)'],
  ['P0137', 'Sensor de oxigênio (banco 1, sensor 2) — tensão baixa'],
  ['P0138', 'Sensor de oxigênio (banco 1, sensor 2) — tensão alta'],
  ['P0139', 'Sensor de oxigênio (banco 1, sensor 2) — resposta lenta'],
  ['P0140', 'Sensor de oxigênio (banco 1, sensor 2) — sem atividade detectada'],
  ['P0141', 'Aquecedor do sensor de oxigênio (banco 1, sensor 2)'],
];
for (const [c, d] of o2b1s1) add(c, E(d, 'attention', ['Sonda lambda envelhecida ou defeituosa', 'Vazamento no escapamento', 'Chicote/conector ou fusível do aquecedor']));

/* Mistura */
add('P0171', E('Sistema muito pobre (banco 1)', 'attention', ['Vazamento de ar na admissão', 'Sensor MAF sujo', 'Pressão de combustível baixa / bicos obstruídos']));
add('P0172', E('Sistema muito rico (banco 1)', 'attention', ['Bicos injetores com vazamento', 'Pressão de combustível alta', 'Sensor MAF ou sonda lambda']));
add('P0174', E('Sistema muito pobre (banco 2)', 'attention', ['Vazamento de ar na admissão', 'Sensor MAF sujo', 'Pressão de combustível baixa']));
add('P0175', E('Sistema muito rico (banco 2)', 'attention', ['Bicos injetores com vazamento', 'Pressão de combustível alta', 'Sensor MAF ou sonda lambda']));

/* Injetores */
add('P0200', E('Circuito do injetor', 'attention', ['Injetor/chicote', 'Módulo de controle (driver)']));
for (let n = 1; n <= 6; n++) add(`P020${n}`, E(`Circuito do injetor — cilindro ${n}`, 'attention', ['Injetor do cilindro/chicote', 'Conector do injetor', 'Módulo de controle (driver)']));
add('P0217', E('Condição de superaquecimento do motor', 'critical', ['Nível baixo ou vazamento de líquido de arrefecimento', 'Ventoinha, termostato ou bomba d’água', 'Radiador obstruído']));
add('P0219', E('Condição de excesso de rotação do motor', 'critical', ['Condução acima do limite do motor', 'Câmbio/embreagem', 'Sensor de rotação']));
add('P0230', E('Circuito primário da bomba de combustível', 'attention', ['Relé/fusível da bomba', 'Bomba de combustível', 'Chicote/conector']));
add('P0234', E('Condição de sobrepressão do turbo/compressor', 'attention', ['Válvula wastegate/atuador', 'Sensor de pressão de turbo', 'Mangueiras de pressão']));
add('P0299', E('Condição de subpressão do turbo/compressor', 'attention', ['Vazamento no sistema de pressão', 'Válvula wastegate/atuador', 'Turbocompressor']));

/* Ignição / falha de combustão */
add('P0300', E('Falha de ignição aleatória/múltiplos cilindros detectada', 'attention', ['Velas ou cabos desgastados', 'Bobinas de ignição', 'Mistura (vazamento de ar / combustível)', 'Compressão do motor']));
for (let n = 1; n <= 6; n++) add(`P030${n}`, E(`Falha de ignição detectada no cilindro ${n}`, 'attention', ['Vela, cabo ou bobina do cilindro', 'Bico injetor do cilindro', 'Compressão do cilindro']));
add('P0325', E('Circuito do sensor de detonação (knock) 1 (banco 1)', 'attention', ['Sensor de detonação', 'Chicote/conector']));
add('P0327', E('Sensor de detonação 1 (banco 1) — sinal baixo', 'attention', ['Sensor de detonação', 'Chicote/conector']));
add('P0328', E('Sensor de detonação 1 (banco 1) — sinal alto', 'attention', ['Sensor de detonação', 'Ruído mecânico no motor']));
add('P0335', E('Circuito do sensor de posição do virabrequim (A)', 'attention', ['Sensor de rotação/virabrequim', 'Roda fônica', 'Chicote/conector']));
add('P0336', E('Sensor de posição do virabrequim (A) — faixa/desempenho', 'attention', ['Sensor de rotação', 'Roda fônica', 'Chicote/conector']));
add('P0337', E('Sensor de posição do virabrequim (A) — sinal baixo', 'attention', ['Sensor de rotação', 'Chicote/conector']));
add('P0338', E('Sensor de posição do virabrequim (A) — sinal alto', 'attention', ['Sensor de rotação', 'Roda fônica']));
add('P0340', E('Circuito do sensor de posição do comando (A, banco 1)', 'attention', ['Sensor de fase/comando', 'Chicote/conector']));
add('P0341', E('Sensor de posição do comando (A, banco 1) — faixa/desempenho', 'attention', ['Sensor de fase', 'Distribuição desalinhada']));
for (const [c, l] of [['P0351', 'A'], ['P0352', 'B'], ['P0353', 'C'], ['P0354', 'D'], ['P0355', 'E'], ['P0356', 'F']]) {
  add(c, E(`Circuito primário/secundário da bobina de ignição ${l}`, 'attention', ['Bobina de ignição', 'Chicote/conector', 'Módulo de ignição']));
}

/* Emissões */
add('P0400', E('Fluxo de recirculação de gases de escape (EGR)', 'attention', ['Válvula EGR obstruída ou presa', 'Passagens do EGR com carbonização']));
add('P0401', E('Fluxo insuficiente de recirculação de gases (EGR)', 'attention', ['Válvula EGR obstruída', 'Passagens do EGR com carbonização']));
add('P0402', E('Fluxo excessivo de recirculação de gases (EGR)', 'attention', ['Válvula EGR presa aberta']));
add('P0403', E('Circuito de controle da recirculação de gases (EGR)', 'attention', ['Solenoide/atuador do EGR', 'Chicote/conector']));
add('P0420', E('Eficiência do catalisador abaixo do limite (banco 1)', 'attention', ['Catalisador degradado', 'Sondas lambda', 'Vazamento no escapamento', 'Falhas de ignição prolongadas']));
add('P0430', E('Eficiência do catalisador abaixo do limite (banco 2)', 'attention', ['Catalisador degradado', 'Sondas lambda', 'Vazamento no escapamento']));
add('P0440', E('Sistema de controle de emissões evaporativas (EVAP)', 'info', ['Tampa do tanque', 'Válvulas e mangueiras do EVAP']));
add('P0441', E('Sistema EVAP — fluxo de purga incorreto', 'info', ['Válvula de purga', 'Mangueiras do EVAP']));
add('P0442', E('Sistema EVAP — vazamento pequeno detectado', 'info', ['Tampa do tanque mal fechada', 'Mangueiras/válvulas do EVAP']));
add('P0443', E('Circuito da válvula de purga do EVAP', 'info', ['Válvula de purga', 'Chicote/conector']));
add('P0446', E('Circuito de controle da ventilação do EVAP', 'info', ['Válvula de ventilação', 'Mangueira obstruída']));
add('P0455', E('Sistema EVAP — vazamento grande detectado', 'info', ['Tampa do tanque ausente ou solta', 'Mangueira desconectada']));
add('P0456', E('Sistema EVAP — vazamento muito pequeno detectado', 'info', ['Tampa do tanque', 'Pequenos vazamentos em mangueiras']));
add('P0480', E('Circuito de controle do ventilador de arrefecimento 1', 'attention', ['Relé/fusível do ventilador', 'Motor do ventilador', 'Chicote/conector']));
add('P0481', E('Circuito de controle do ventilador de arrefecimento 2', 'attention', ['Relé/fusível do ventilador', 'Motor do ventilador', 'Chicote/conector']));

/* Velocidade, marcha lenta, tensão */
add('P0500', E('Sensor de velocidade do veículo (VSS)', 'attention', ['Sensor de velocidade', 'Chicote/conector', 'Roda fônica']));
add('P0501', E('Sensor de velocidade do veículo (VSS) — faixa/desempenho', 'attention', ['Sensor de velocidade', 'Roda fônica']));
add('P0503', E('Sensor de velocidade do veículo (VSS) — sinal intermitente', 'attention', ['Sensor de velocidade', 'Chicote/conector']));
add('P0505', E('Sistema de controle da marcha lenta', 'attention', ['Corpo de borboleta sujo', 'Vazamento de vácuo', 'Atuador de marcha lenta']));
add('P0506', E('Rotação de marcha lenta abaixo do esperado', 'attention', ['Corpo de borboleta sujo', 'Vazamento de vácuo', 'Atuador de marcha lenta']));
add('P0507', E('Rotação de marcha lenta acima do esperado', 'attention', ['Vazamento de ar não medido', 'Atuador de marcha lenta', 'Corpo de borboleta']));
add('P0560', E('Tensão do sistema', 'attention', ['Bateria', 'Alternador', 'Conexões de aterramento']));
add('P0562', E('Tensão do sistema baixa', 'attention', ['Bateria fraca', 'Alternador/regulador', 'Correia do alternador', 'Terminais oxidados']));
add('P0563', E('Tensão do sistema alta', 'attention', ['Regulador de tensão do alternador', 'Conexões da bateria']));
add('P0571', E('Circuito do interruptor do freio (controle de velocidade/freio A)', 'info', ['Interruptor da luz de freio', 'Ajuste/chicote do interruptor']));

/* Módulo de controle */
add('P0600', E('Falha de comunicação serial do módulo de controle', 'attention', ['Chicote da rede', 'Módulo de controle']));
add('P0601', E('Erro de checksum da memória do módulo de controle', 'attention', ['Módulo de controle (ECU)']));
add('P0602', E('Erro de programação do módulo de controle', 'attention', ['Programação/atualização da ECU']));
add('P0603', E('Erro de memória KAM do módulo de controle', 'attention', ['Alimentação da ECU', 'Módulo de controle']));
add('P0604', E('Erro de memória RAM do módulo de controle', 'attention', ['Módulo de controle (ECU)']));
add('P0605', E('Erro de memória ROM do módulo de controle', 'attention', ['Módulo de controle (ECU)']));
add('P0606', E('Falha do processador do módulo de controle', 'attention', ['Módulo de controle (ECU)']));
add('P0620', E('Circuito de controle do gerador (alternador)', 'attention', ['Alternador/regulador', 'Chicote/conector']));
add('P0621', E('Circuito da lâmpada L do gerador (alternador)', 'attention', ['Alternador', 'Lâmpada/painel', 'Chicote']));
add('P0622', E('Circuito de campo F do gerador (alternador)', 'attention', ['Alternador/regulador', 'Chicote/conector']));
add('P0650', E('Circuito de controle da luz indicadora de falha (MIL)', 'info', ['Lâmpada do painel', 'Chicote', 'Módulo de controle']));

/* Transmissão */
add('P0700', E('Sistema de controle da transmissão (consultar módulo da transmissão)', 'attention', ['Módulo da transmissão (TCM) registrou falha própria']));
add('P0705', E('Circuito do sensor de faixa da transmissão (PRNDL)', 'attention', ['Sensor/interruptor de faixa', 'Ajuste do seletor']));
add('P0715', E('Circuito do sensor de velocidade de entrada/turbina', 'attention', ['Sensor de velocidade de entrada', 'Chicote/conector']));
add('P0720', E('Circuito do sensor de velocidade de saída', 'attention', ['Sensor de velocidade de saída', 'Chicote/conector']));
add('P0730', E('Relação de marcha incorreta', 'attention', ['Nível/condição do fluido do câmbio', 'Solenoides', 'Desgaste interno']));
add('P0740', E('Circuito do solenoide do conversor de torque (TCC)', 'attention', ['Solenoide do TCC', 'Chicote/conector']));
add('P0741', E('Desempenho do conversor de torque (TCC) — preso desligado', 'attention', ['Solenoide do TCC', 'Fluido do câmbio']));
add('P0750', E('Circuito do solenoide de mudança A', 'attention', ['Solenoide de mudança', 'Chicote/conector']));

/* Diesel / filtro */
add('P2002', E('Eficiência do filtro de partículas (DPF) abaixo do limite (banco 1)', 'attention', ['Filtro de partículas saturado/danificado', 'Regeneração incompleta']));

/* Rede e chassi (genéricos) */
add('U0001', E('Barramento de comunicação CAN de alta velocidade', 'attention', ['Chicote CAN', 'Módulo com falha na rede']));
add('U0073', E('Barramento de comunicação A desligado (Bus Off)', 'attention', ['Chicote CAN', 'Módulo com falha na rede']));
add('U0100', E('Comunicação perdida com o módulo do motor (ECM/PCM A)', 'attention', ['Alimentação/aterramento da ECU', 'Chicote CAN', 'ECU']));
add('U0101', E('Comunicação perdida com o módulo da transmissão (TCM)', 'attention', ['Alimentação/aterramento do TCM', 'Chicote CAN']));
add('U0121', E('Comunicação perdida com o módulo do ABS', 'attention', ['Alimentação/aterramento do módulo ABS', 'Chicote CAN']));
add('U0140', E('Comunicação perdida com o módulo da carroceria (BCM)', 'attention', ['Alimentação/aterramento do BCM', 'Chicote CAN']));
add('U0155', E('Comunicação perdida com o painel de instrumentos', 'attention', ['Alimentação do painel', 'Chicote CAN']));
add('C0035', E('Circuito do sensor de velocidade da roda dianteira esquerda', 'attention', ['Sensor de roda', 'Roda fônica', 'Chicote/conector']));
add('C0040', E('Circuito do sensor de velocidade da roda dianteira direita', 'attention', ['Sensor de roda', 'Roda fônica', 'Chicote/conector']));
add('C0045', E('Circuito do sensor de velocidade da roda traseira esquerda', 'attention', ['Sensor de roda', 'Roda fônica', 'Chicote/conector']));
add('C0050', E('Circuito do sensor de velocidade da roda traseira direita', 'attention', ['Sensor de roda', 'Roda fônica', 'Chicote/conector']));

export const DTC_DB = Object.freeze(DB);

const SYSTEMS = { P: 'Trem de força (motor/transmissão)', C: 'Chassi', B: 'Carroceria', U: 'Rede de comunicação' };

export const SEVERITY_LABELS = {
  info: 'Baixa',
  attention: 'Moderada',
  critical: 'Alta',
  unknown: 'Não classificada',
};

/** Normaliza e descreve um DTC sem inventar significado. */
export function describeDtc(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  const valid = /^[PCBU][0-3][0-9A-F]{3}$/.test(code);
  const type = valid ? code[0] : null;
  const digit = valid ? code[1] : null;
  const generic = valid && (digit === '0' || (type === 'P' && digit === '2'));
  const entry = DB[code];
  const manufacturer = valid && !generic;
  return {
    code,
    valid,
    system: type ? SYSTEMS[type] : 'Desconhecido',
    generic,
    manufacturerSpecific: manufacturer,
    description: entry?.desc ?? null,
    severity: entry?.severity ?? 'unknown',
    causes: entry?.causes ?? [],
    note: entry
      ? 'Descrição genérica (SAE). Causas listadas são possibilidades gerais, não um diagnóstico.'
      : manufacturer
        ? 'Código específico do fabricante: consulte o manual de serviço do veículo ou uma oficina.'
        : 'Código sem descrição na base local: consulte o manual de serviço do veículo.',
  };
}
