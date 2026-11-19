/** Janela flutuante do assistente (expansível para tela cheia) com controles independentes. */
import { h, ic, iconButton, button, badge, toast, clear } from './ui.js';
import { createMascot, MASCOT_LABELS } from './mascot.js';
import { greetingLine } from './alma-soul.js';

const QUICK = ['Como está o motor?', 'Como estou dirigindo?', 'Algum alerta?', 'Estou com sono', 'Conta uma história', 'Quem é você?'];

export function createAssistantWidget(ctx) {
  const { assistant, settings, voice } = ctx;
  const cleanups = [];
  let open = false;
  let expanded = false;

  const mascot = createMascot({ size: 44, state: assistant.state });
  const stateText = h('small', {}, MASCOT_LABELS[assistant.state]);
  const title = h('strong', {}, assistant.name);
  const list = h('div', { class: 'asst-messages', role: 'log', 'aria-live': 'polite' });
  const quick = h('div', { class: 'asst-quick' });
  const text = h('input', { class: 'input', type: 'text', placeholder: 'Fale com o carro…', 'aria-label': 'Mensagem para o assistente', autocomplete: 'off' });
  const micBtn = h('button', { type: 'button', class: 'icon-btn icon-btn-ghost asst-talk', 'aria-label': 'Falar' }, ic('mic', 20));
  const sendBtn = h('button', { type: 'submit', class: 'icon-btn icon-btn-primary', 'aria-label': 'Enviar' }, ic('send', 20));
  const ctrl = h('div', { class: 'asst-ctrl' });
  const offNote = h('div', { class: 'asst-off' });
  const form = h('form', { class: 'asst-input', on: { submit: (e) => { e.preventDefault(); const t = text.value.trim(); if (!t) return; text.value = ''; assistant.send(t); } } }, text, micBtn, sendBtn);
  const el = h('aside', { class: 'assistant-win', 'aria-label': 'Assistente da Alma do Carro', hidden: true }, h('header', { class: 'asst-head' }, mascot, h('div', { class: 'asst-title' }, title, stateText), ctrl), h('div', { class: 'asst-body' }, offNote, list, quick), form);
  document.body.append(el);

  function renderCtrl() {
    const on = assistant.enabled;
    const mic = settings.get('assistant.micEnabled', false);
    const vo = settings.get('assistant.voiceEnabled', true);
    clear(ctrl).append(
      iconButton(mic ? 'mic' : 'mic-off', mic ? 'Microfone ligado (toque para desligar)' : 'Microfone desligado', () => toggleMic(!mic), { cls: mic ? 'is-on' : '' }),
      iconButton(vo ? 'volume' : 'volume-off', vo ? 'Voz ligada (toque para silenciar)' : 'Voz desligada', () => { settings.set('assistant.voiceEnabled', !vo); if (vo) voice.cancelSpeech(); }, { cls: vo ? 'is-on' : '' }),
      iconButton('power', on ? 'Desligar assistente' : 'Ligar assistente', () => settings.set('assistant.enabled', !on), { cls: on ? 'is-on' : '' }),
      iconButton(expanded ? 'collapse' : 'expand', expanded ? 'Reduzir' : 'Tela cheia', () => setExpanded(!expanded)),
      iconButton('x', 'Fechar janela', () => api.close()),
    );
    micBtn.hidden = !(on && mic);
    el.classList.toggle('is-off', !on);
    text.disabled = !on;
    sendBtn.disabled = !on;
    title.textContent = assistant.name;
    clear(offNote);
    if (!on) offNote.append(ic('power', 22), h('div', {}, h('strong', {}, 'Assistente desligado'), h('p', {}, 'O monitoramento OBD2 e os alertas locais continuam funcionando normalmente.')), button({ label: 'Ligar', kind: 'primary', size: 'sm', onClick: () => settings.set('assistant.enabled', true) }));
    mascot.classList.toggle('is-off', !on);
  }

  function toggleMic(v) {
    if (v && !voice.sttSupported) {
      toast('Reconhecimento de voz indisponível neste navegador.', 'warn');
      return;
    }
    settings.set('assistant.micEnabled', v);
    if (!v) voice.stopListening();
    else if (settings.get('assistant.listenMode', 'tap') === 'continuous') voice.startListening({ mode: 'continuous' });
  }

  micBtn.addEventListener('click', () => {
    if (voice.listening) voice.stopListening();
    else voice.startListening({ mode: 'tap' });
  });

  function renderMessages() {
    clear(list);
    const msgs = assistant.messages;
    if (!msgs.length) {
      list.append(h('div', { class: 'asst-welcome' }, h('p', {}, greetingLine(assistant.tone, assistant.driver || 'amigo', assistant.awake), ' Eu sou o ', h('strong', {}, assistant.name), ', a alma deste carro. Respondo com os dados do veículo e, com a IA do Claude ou um backend de IA, também converso sobre qualquer assunto.'), h('small', { class: 'muted' }, 'Sem IA, respondo com falas e dados locais. Dados indisponíveis são sempre informados como tal.')));
    }
    for (const m of msgs) {
      list.append(h('div', { class: `msg msg-${m.role}` }, h('div', { class: 'bubble' }, m.text.split('\n').map((l, i) => (i ? [h('br'), l] : l))), m.role === 'assistant' ? h('small', {}, m.auto ? 'Por conta própria' : m.local ? 'Resposta local' : `IA${m.provider ? ` · ${m.provider}` : ''}`) : m.via === 'voice' ? h('small', {}, 'por voz') : null));
    }
    if (assistant.busy || assistant.state === 'thinking') list.append(h('div', { class: 'msg msg-assistant' }, h('div', { class: 'bubble typing' }, h('i'), h('i'), h('i'))));
    list.scrollTop = list.scrollHeight;
    clear(quick).append(QUICK.map((q) => h('button', { type: 'button', class: 'chip', disabled: !assistant.enabled, on: { click: () => assistant.send(q) } }, q)));
  }

  function setExpanded(v) {
    expanded = v;
    el.classList.toggle('expanded', v);
    renderCtrl();
    if (v) text.focus();
  }

  const api = {
    el,
    get isOpen() { return open; },
    open() {
      open = true;
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add('in'));
      renderCtrl();
      renderMessages();
      document.body.classList.add('asst-open');
      ctx.setNavActive?.('assistant');
      if (assistant.enabled) setTimeout(() => text.focus(), 120);
    },
    close() {
      open = false;
      el.classList.remove('in', 'expanded');
      expanded = false;
      document.body.classList.remove('asst-open');
      setTimeout(() => { if (!open) el.hidden = true; }, 220);
      ctx.setNavActive?.(null);
    },
    toggle() { open ? api.close() : api.open(); },
    destroy() { cleanups.forEach((c) => c && c()); el.remove(); },
  };

  cleanups.push(
    assistant.on('state', (s) => { mascot.setState(s); stateText.textContent = MASCOT_LABELS[s]; if (open) renderMessages(); }),
    assistant.on('messages', () => open && renderMessages()),
    settings.on('change', (p) => { if (p.startsWith('assistant.')) { renderCtrl(); if (open) renderMessages(); } }),
    voice.on('error', (e) => toast(e.message, 'warn')),
    voice.on('listening', (on) => { micBtn.classList.toggle('is-on', on); }),
  );
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && expanded) setExpanded(false); });
  renderCtrl();
  return api;
}
