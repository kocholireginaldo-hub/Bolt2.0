/** Configurações: motorista, aparência, orientação, assistente, IA/privacidade, OBD2, alertas, dados. */
import { ACCENTS } from './config.js';
import { PERSONALITIES, LEVELS } from './assistant.js';
import { buildAiContext } from './ai-service.js';
import { Database } from './database.js';
import { APP } from './config.js';
import { h, ic, card, badge, button, field, input, select, toggle, segmented, modal, toast, confirmDialog, clear, guardMotion } from './ui.js';
import { fmtNum, downloadText } from './utils.js';

const row = (title, desc, control) => h('div', { class: 'pref-row' }, h('div', {}, h('strong', {}, title), desc ? h('small', {}, desc) : null), control);

export function mountSettings(root, ctx) {
  const { settings, voice } = ctx;
  const cleanups = [];
  const host = h('div', { class: 'view-settings' });
  const content = h('div', { class: 'settings-content' });
  root.append(host);
  host.append(h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Configurações'), h('p', {}, 'Tudo é salvo automaticamente neste dispositivo.'))), content);

  const lockBanner = h('div', { class: 'banner banner-warn', hidden: true }, ic('lock', 18), h('span', {}, 'Configurações bloqueadas com o veículo em movimento. Pare para alterar.'));
  host.insertBefore(lockBanner, content);
  const applyLock = () => {
    const locked = ctx.motionLocked();
    lockBanner.hidden = !locked;
    content.toggleAttribute('inert', locked);
    content.classList.toggle('is-locked', locked);
  };

  const set = (p) => (v) => settings.set(p, v);
  const num = (p, props = {}) => input({ type: 'number', value: settings.get(p), ...props, on: { change: (e) => settings.set(p, Number(e.target.value)) } });
  const rng = (p, min, max, step) => h('input', { type: 'range', class: 'range', min, max, step, value: settings.get(p), 'aria-label': p, on: { input: (e) => settings.set(p, Number(e.target.value)) } });

  function render() {
    clear(content);
    const s = settings;

    content.append(
      card('Motorista', { iconName: 'user' }, field('Nome', input({ value: s.get('driver.name', ''), placeholder: 'Como o carro chama você (fica só neste dispositivo)', on: { change: (e) => s.set('driver.name', e.target.value.trim()) } }))),

      card('Aparência', { iconName: 'palette' },
        row('Tema', 'Automático segue o sistema.', segmented([['dark', 'Escuro'], ['light', 'Claro'], ['auto', 'Automático']], s.get('appearance.theme'), set('appearance.theme'))),
        row('Cor de destaque', null, h('div', { class: 'swatches' }, Object.entries(ACCENTS).map(([id, a]) => h('button', { type: 'button', class: `swatch ${s.get('appearance.accent') === id ? 'on' : ''}`, style: { background: `linear-gradient(135deg, ${a.a}, ${a.b})` }, 'aria-label': a.label, title: a.label, on: { click: () => { s.set('appearance.accent', id); render(); } } }))))),

      card('Tela e navegação', { iconName: 'sliders' },
        row('Orientação', 'Automática segue o aparelho. Forçar escolhe o arranjo de tela (e tenta travar a rotação onde o navegador permite).', segmented([['auto', 'Automática'], ['landscape', 'Horizontal'], ['portrait', 'Vertical']], s.get('layout.orientation'), set('layout.orientation'))),
        row('Barra de navegação recolhida', 'Deixa só uma seta discreta para reabrir.', toggle(s.get('layout.navCollapsed'), set('layout.navCollapsed'))),
        row('Unidade de consumo', null, segmented([['kml', 'km/L'], ['l100', 'L/100 km']], s.get('display.consumptionUnit'), set('display.consumptionUnit'))),
        row('Escala do velocímetro', null, select([[180, '0–180 km/h'], [220, '0–220 km/h'], [240, '0–240 km/h'], [300, '0–300 km/h']], String(s.get('display.speedMax')), { on: { change: (e) => s.set('display.speedMax', Number(e.target.value)) } }))),

      assistantCard(),
      aiCard(),
      obdCard(),

      card('Alertas', { iconName: 'alert' },
        h('p', { class: 'muted' }, 'Os alertas locais funcionam sem internet e sem o assistente. Limites de temperatura e rotação são definidos por veículo na Garagem.'),
        row('Alertas sonoros', null, toggle(s.get('alerts.sound'), set('alerts.sound'))),
        row('Anunciar alertas por voz', 'Depende do nível de comunicação do assistente.', toggle(s.get('assistant.announceAlerts'), set('assistant.announceAlerts'))),
        row('Aviso de combustível baixo (%)', null, num('alerts.lowFuelPct', { min: 5, max: 50, step: 1 }))),

      card('Manutenção', { iconName: 'maintenance' },
        row('Avisar quando faltar (km)', 'Margem para marcar um serviço como "próximo".', num('maintenance.warnKm', { min: 0, step: 100 })),
        row('Avisar quando faltar (dias)', null, num('maintenance.warnDays', { min: 0, step: 1 }))),

      card('Segurança ao dirigir', { iconName: 'lock' },
        row('Bloquear telas complexas em movimento', 'Formulários, limpeza de códigos e configurações ficam bloqueados acima da velocidade abaixo. A voz continua disponível.', toggle(s.get('safety.motionLock'), set('safety.motionLock'))),
        row('Velocidade de bloqueio (km/h)', null, num('safety.lockSpeedKmh', { min: 3, max: 30, step: 1 }))),

      dataCard(),
      aboutCard(),
    );
  }

  function assistantCard() {
    const s = settings;
    const voices = voice.ptVoices();
    return card('Assistente', { iconName: 'assistant' },
      row('Assistente ligado', 'Desligar não afeta o monitoramento nem os alertas locais.', toggle(s.get('assistant.enabled'), set('assistant.enabled'))),
      field('Nome do assistente', input({ value: s.get('assistant.name'), maxlength: 20, on: { change: (e) => s.set('assistant.name', e.target.value.trim() || 'Bolt') } }), { hint: 'Também é a palavra de ativação por voz.' }),
      row('Personalidade', PERSONALITIES[s.get('assistant.personality')]?.hint, segmented(Object.entries(PERSONALITIES).map(([k, v]) => [k, v.label]), s.get('assistant.personality'), (v) => { s.set('assistant.personality', v); render(); })),
      row('Nível de comunicação', LEVELS[s.get('assistant.level')]?.hint, segmented(Object.entries(LEVELS).map(([k, v]) => [k, v.label]), s.get('assistant.level'), (v) => { s.set('assistant.level', v); render(); })),
      row('Comentar sozinho o que acontece', 'Partida, motor frio, calor, bateria, rotação, velocidade, combustível, freada forte e pausas (personalidades Imponente e Debochado).', toggle(s.get('assistant.autoComment'), set('assistant.autoComment'))),
      row('Voz do assistente', voice.ttsSupported ? 'Respostas faladas.' : 'Síntese de voz indisponível neste navegador.', toggle(s.get('assistant.voiceEnabled'), set('assistant.voiceEnabled'))),
      voice.ttsSupported ? h('div', { class: 'form-grid' },
        field('Voz', select([['', 'Automática (pt-BR)'], ...voices.map((v) => [v.name, `${v.name} (${v.lang})`])], s.get('assistant.voiceName'), { on: { change: (e) => s.set('assistant.voiceName', e.target.value) } })),
        field('Velocidade da fala', rng('assistant.rate', 0.6, 1.6, 0.05)),
        field('Tom (esquerda = voz mais grave)', rng('assistant.pitch', 0.05, 1.6, 0.05)),
        field('Volume', rng('assistant.volume', 0, 1, 0.1))) : null,
      voice.ttsSupported ? button({ label: 'Testar voz', icon: 'volume', size: 'sm', onClick: () => {
        const nm = (s.get('driver.name', '') || '').trim();
        voice.lastError = null;
        voice.speak(`Sistemas online. Sou o ${s.get('assistant.name')}, e estou com você${nm ? `, ${nm}` : ''}.`);
        setTimeout(() => {
          if (voice.speaking) return;
          const why = voice.lastError;
          if (why || !voice.ptVoices().length) toast(!voice.ptVoices().length ? 'Nenhuma voz em português encontrada neste aparelho. Nas configurações do Android, instale o "Google Text-to-Speech" e baixe o idioma Português (Brasil).' : `A voz não saiu (${why}). Confira o volume de mídia e o mecanismo de voz do Android.`, 'warn');
        }, 4200);
      } }) : h('p', { class: 'muted' }, 'Este navegador não tem síntese de voz. O texto continua aparecendo no painel.'),
      row('Microfone', voice.sttSupported ? 'A permissão do microfone só é pedida no primeiro toque na tela, quando a escuta por nome está ligada.' : 'Reconhecimento de voz indisponível neste navegador.', toggle(s.get('assistant.micEnabled'), (v) => { if (v && !voice.sttSupported) { toast('Reconhecimento de voz indisponível neste navegador.', 'warn'); render(); return; } s.set('assistant.micEnabled', v); if (!v) voice.stopListening(); })),
      row('Modo de escuta', 'No modo contínuo o assistente só reage quando ouve o nome dele (experimental; no Chrome usa serviço online e consome bateria).', segmented([['tap', 'Toque para falar'], ['continuous', 'Contínuo por nome']], s.get('assistant.listenMode'), (v) => { s.set('assistant.listenMode', v); voice.stopListening(); })),
      row('Modo espera (protetor de tela)', 'Mostra só a cara do Bolt, para não distrair. Sai com dois toques ou deslizando para cima; também dá para dizer “Bolt, modo espera”.', select([['0', 'Desligado'], ['1', 'Após 1 min'], ['2', 'Após 2 min'], ['3', 'Após 3 min'], ['5', 'Após 5 min'], ['10', 'Após 10 min']], String(s.get('standby.autoMinutes', 3)), { on: { change: (e) => s.set('standby.autoMinutes', Number(e.target.value)) } })),
      button({ label: 'Entrar no modo espera agora', icon: 'moon', size: 'sm', onClick: () => ctx.standby?.enter() }),
      button({ label: 'Apagar conversa', icon: 'trash', size: 'sm', kind: 'ghost', onClick: async () => { await ctx.assistant.clearHistory(); toast('Conversa apagada.', 'ok'); } }));
  }

  function aiCard() {
    const s = settings;
    const result = h('div', { class: 'ai-result muted' }, 'Não verificado.');
    const check = async () => {
      result.textContent = 'Verificando…';
      const hlt = await ctx.ai.check();
      clear(result).append(badge(hlt.ok ? (hlt.ai ? 'IA disponível' : 'Backend ativo, sem chave de IA') : 'Backend inacessível', hlt.ai ? 'ok' : 'warn'), h('small', {}, ` ${hlt.reason}`));
    };
    const preview = () => {
      const ctxJson = buildAiContext({ settings: s, engine: ctx.engine, vehicle: ctx.garage.active(), alerts: ctx.alerts.list(), dtcs: ctx.currentDtcs(), maintenance: [] });
      modal({ title: 'O que é enviado à IA', icon: 'shield', size: 'md', body: [h('p', {}, 'Este é o contexto que acompanha cada pergunta (além do texto que você escreve). Placa, VIN, nome, localização e histórico de viagens nunca são enviados.'), h('pre', { class: 'json-preview' }, JSON.stringify(ctxJson, null, 2))] });
    };
    return card('IA e privacidade', { iconName: 'shield' },
      h('p', { class: 'muted' }, 'Dentro do Claude, a conversa usa a IA do Claude automaticamente. Fora dele, uma IA externa precisa de um backend: a chave fica somente lá (variável de ambiente) e o navegador nunca a vê.'),
      field('URL do backend', input({ value: s.get('ai.backendUrl'), placeholder: 'Vazio = mesmo servidor que entrega este app', on: { change: (e) => { s.set('ai.backendUrl', e.target.value.trim()); } } })),
      h('div', { class: 'row-actions' }, button({ label: 'Testar conexão', icon: 'refresh', size: 'sm', onClick: check }), result),
      h('h4', {}, 'O que pode ser enviado'),
      row('Meu nome (para o carro me chamar pelo nome)', 'Usado apenas na conversa com a IA do Claude, para a alma falar com você pelo nome.', toggle(s.get('ai.shareDriverName'), set('ai.shareDriverName'))),
      row('Perfil do veículo (marca, modelo, motor)', null, toggle(s.get('ai.shareVehicleProfile'), set('ai.shareVehicleProfile'))),
      row('Dados ao vivo (velocidade, temperatura…)', null, toggle(s.get('ai.shareLiveData'), set('ai.shareLiveData'))),
      row('Códigos de falha (DTC)', null, toggle(s.get('ai.shareDiagnostics'), set('ai.shareDiagnostics'))),
      row('Resumo da manutenção', null, toggle(s.get('ai.shareMaintenance'), set('ai.shareMaintenance'))),
      button({ label: 'Ver exatamente o que é enviado', icon: 'info', size: 'sm', kind: 'ghost', onClick: preview }));
  }

  function obdCard() {
    const s = settings;
    const avail = ctx.obd.availability(window);
    return card('OBD2', { iconName: 'obd' },
      h('ul', { class: 'avail-list' }, avail.map((a) => h('li', {}, ic(a.icon, 18), h('div', {}, h('strong', {}, a.label), h('small', {}, a.supported ? a.description : a.reason)), badge(a.supported ? 'Suportado aqui' : 'Indisponível', a.supported ? 'ok' : 'neutral')))),
      row('Adaptador preferido', null, select(avail.map((a) => [a.kind, a.label]), s.get('obd.preferred'), { on: { change: (e) => s.set('obd.preferred', e.target.value) } })),
      row('Reconectar automaticamente', 'Tenta de novo com intervalos crescentes se a conexão cair.', toggle(s.get('obd.autoReconnect'), set('obd.autoReconnect'))),
      button({ label: 'Abrir conexão OBD2', icon: 'link', size: 'sm', onClick: () => ctx.openObdDialog() }),
      h('p', { class: 'muted' }, 'A Alma do Carro opera em modo somente leitura: não programa a ECU nem envia comandos não documentados.'));
  }

  function dataCard() {
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, on: { change: onImport } });
    const usage = h('small', { class: 'muted' }, 'Calculando uso…');
    ctx.db.usage().then((u) => { usage.textContent = u.usage != null ? `Uso de armazenamento: ${fmtNum(u.usage / 1024, 0)} KB${u.quota ? ` de ${fmtNum(u.quota / 1048576, 0)} MB disponíveis` : ''}.` : 'Uso de armazenamento indisponível.'; });
    async function onImport(e) {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f || !guardMotion(ctx)) return;
      let payload;
      try { payload = JSON.parse(await f.text()); } catch { return toast('Arquivo inválido.', 'error'); }
      const v = Database.validateBackup(payload);
      if (!v.ok) return toast(v.error, 'error');
      const replace = await confirmDialog({ title: 'Como restaurar?', message: 'MESCLAR mantém seus dados atuais e adiciona/atualiza os do backup (recomendado). SUBSTITUIR apaga os dados atuais antes de restaurar.', confirmLabel: 'Substituir tudo', cancelLabel: 'Mesclar', danger: true, icon: 'database' });
      try {
        if (replace && !(await confirmDialog({ title: 'Substituir todos os dados?', message: 'Os dados locais atuais serão apagados e trocados pelo backup.', confirmLabel: 'Substituir', danger: true, requireText: 'SUBSTITUIR' }))) return;
        const r = await ctx.db.importAll(payload, { mode: replace ? 'replace' : 'merge' });
        await ctx.reloadAll();
        toast(`Backup restaurado (${r.imported} registros).`, 'ok');
      } catch (err) { toast(err.message, 'error'); }
    }
    return card('Dados e backup', { iconName: 'database' },
      ctx.volatile ? h('div', { class: 'banner banner-warn' }, ic('alert', 18), h('span', {}, 'Armazenamento persistente indisponível: os dados desta sessão serão perdidos ao fechar.')) : null,
      h('p', { class: 'muted' }, 'Tudo fica neste dispositivo. O backup não inclui o token da ponte Wi-Fi.'),
      h('div', { class: 'row-actions' },
        button({ label: 'Exportar backup', icon: 'download', onClick: async () => { const b = await ctx.db.exportAll(); b.stores.settings = (b.stores.settings || []).map((r) => (r.key === 'app' ? { ...r, value: { ...r.value, obd: { ...(r.value?.obd || {}), bridgeToken: '' } } } : r)); downloadText(`bolt-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b)); toast('Backup exportado.', 'ok'); } }),
        button({ label: 'Restaurar backup', icon: 'upload', onClick: () => file.click() }), file),
      usage,
      h('div', { class: 'row-actions' },
        button({ label: 'Restaurar configurações padrão', kind: 'ghost', size: 'sm', onClick: async () => { await settings.reset(); render(); toast('Configurações restauradas.', 'ok'); } }),
        button({ label: 'Apagar todos os dados locais', icon: 'trash', kind: 'danger', size: 'sm', onClick: async () => { if (!guardMotion(ctx)) return; if (await confirmDialog({ title: 'Apagar tudo?', message: 'Veículos, viagens, serviços, falhas, alertas e configurações deste dispositivo serão apagados definitivamente. Exporte um backup antes.', confirmLabel: 'Apagar tudo', danger: true, requireText: 'APAGAR' })) { await ctx.wipeAll(); } } })));
  }

  function aboutCard() {
    const p = ctx.platform;
    const yes = (v) => badge(v ? 'Sim' : 'Não', v ? 'ok' : 'neutral');
    return card('Sobre este dispositivo', { iconName: 'info' },
      h('p', {}, `${APP.name} ${APP.version}`),
      h('ul', { class: 'avail-list compact' }, [['Contexto seguro (HTTPS/localhost)', p.secureContext], ['Web Bluetooth (BLE)', p.webBluetooth], ['Reconhecimento de voz', p.speechRecognition], ['Síntese de voz', p.speechSynthesis], ['Geolocalização', p.geolocation], ['Armazenamento local (IndexedDB)', p.indexedDB], ['Funciona offline (Service Worker)', p.serviceWorker], ['Ponte nativa (BoltNative)', p.native.present]].map(([l, v]) => h('li', {}, h('span', {}, l), yes(v)))));
  }

  render();
  applyLock();
  cleanups.push(ctx.onTick(applyLock), voice.on('voices', () => {}));
  return { destroy: () => cleanups.forEach((c) => c && c()) };
}
