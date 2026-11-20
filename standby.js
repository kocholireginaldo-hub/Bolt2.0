/**
 * MODO ESPERA do Bolt (protetor de tela): só o rosto do Bolt na tela, para não distrair quem dirige.
 * - Entra pelo botão do painel, por voz ("Bolt, modo espera") ou sozinho após alguns minutos sem toque.
 * - Sai com dois toques ou deslizando para cima.
 * - O rosto segue o estado do assistente (dormindo, ouvindo, pensando, falando, atenção, alerta).
 * - Alertas continuam sendo falados pelos mesmos mecanismos de sempre; aqui só ganham legenda.
 * Não cria dados novos: usa assistant, voice, alerts e settings já existentes.
 */
import { Emitter } from './events.js';
import { h, ic } from './ui.js';
import { createMascot, MASCOT_LABELS } from './mascot.js';

const DOUBLE_TAP_MS = 380;
const DOUBLE_TAP_PX = 60;
const SWIPE_PX = 110;
const CAPTION_MS = 9000;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class StandbyMode extends Emitter {
  /** @param {{assistant:any, voice:any, alerts:any, settings:any, openAlerts?:()=>void}} deps */
  constructor({ assistant, voice, alerts, settings, openAlerts = () => {} }) {
    super();
    Object.assign(this, { assistant, voice, alerts, settings, openAlerts });
    this.active = false;
    this.root = null;
    this.lastActivity = Date.now();
    this.offs = [];
    this.timers = new Set();
    this.lastMsgId = null;
    this.tap = { t: 0, x: 0, y: 0 };
    this.drag = null;
    this.monitor = null;
  }

  /* ---------- monitor de inatividade ---------- */
  start() {
    const touch = () => { if (!this.active) this.lastActivity = Date.now(); };
    for (const e of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(e, touch, { capture: true, passive: true });
    this.monitor = setInterval(() => this.#checkIdle(), 5000);
  }

  #autoMs() {
    const m = Number(this.settings.get('standby.autoMinutes', 0));
    return m > 0 ? m * 60000 : 0;
  }

  #checkIdle() {
    const ms = this.#autoMs();
    if (!ms || this.active || document.hidden || !this.assistant.enabled) return;
    if (Date.now() - this.lastActivity < ms) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return; // não interrompe quem está digitando
    if (document.querySelector('.overlay, dialog[open]')) return; // nem janelas abertas
    this.enter({ auto: true });
  }

  /* ---------- construção ---------- */
  #build() {
    this.face = createMascot({ size: 300, state: this.assistant.state });
    this.face.classList.add('sb-mascot');
    this.face.prepend(h('i', { class: 'sb-halo' }));
    const NS = 'http://www.w3.org/2000/svg';
    const defs = new DOMParser().parseFromString(`<svg xmlns="${NS}" width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
      ${[['cyan', '#D8FBFF', '#3EE2FF', '#168BFF'], ['amber', '#FFF0CC', '#FFB020', '#E06A00'], ['red', '#FFD9DD', '#FF4756', '#C4122A']].map(([n, a, b, c]) => `<linearGradient id="sbg-${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".38" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`).join('')}
    </defs></svg>`, 'image/svg+xml').documentElement;
    this.faceBox = h('div', { class: 'sb-face' }, document.importNode(defs, true), this.face);

    this.captionUser = h('p', { class: 'sb-user' });
    this.captionText = h('p', { class: 'sb-text' });
    this.caption = h('div', { class: 'sb-caption', 'aria-live': 'polite' }, this.captionUser, this.captionText);

    this.alertIcon = h('span', { class: 'sb-alert-ico' }, ic('alert', 22));
    this.alertText = h('strong', {});
    this.alertChip = h('button', { type: 'button', class: 'sb-alert', hidden: true, on: { click: () => { this.exit(); this.openAlerts(); } } }, this.alertIcon, this.alertText);

    this.micBtn = h('button', { type: 'button', class: 'sb-mic', on: { click: () => this.#toggleMic() } });
    this.hint = h('p', { class: 'sb-hint' }, ic('chevron-up', 18), h('span', {}, 'Toque duas vezes ou deslize para cima para sair'));
    this.state = h('p', { class: 'sb-state' });

    this.root = h('div', { class: 'standby', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Modo espera do Bolt', hidden: true },
      h('div', { class: 'sb-bg', 'aria-hidden': 'true' }),
      this.state, this.micBtn, this.faceBox, this.caption, this.alertChip,
      h('div', { class: 'sb-bar' }, this.hint));
    document.body.append(this.root);

    const r = this.root;
    r.addEventListener('pointerdown', (e) => this.#down(e));
    r.addEventListener('pointermove', (e) => this.#move(e));
    r.addEventListener('pointerup', (e) => this.#up(e));
    r.addEventListener('pointercancel', () => this.#cancelDrag());
    r.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.exit(); });
  }

  /* ---------- entrar / sair ---------- */
  enter({ auto = false } = {}) {
    if (this.active) return;
    if (!this.root) this.#build();
    this.active = true;
    this.root.hidden = false;
    this.root.classList.remove('is-leaving');
    this.root.style.setProperty('--dy', '0px');
    requestAnimationFrame(() => this.root.classList.add('is-on'));
    this.root.tabIndex = -1;
    this.root.focus({ preventScroll: true });
    const list = this.assistant.messages;
    this.lastMsgId = list.length ? list[list.length - 1].id : null;
    this.#paintState();
    this.#paintAlert();
    this.#paintMic();
    this.offs = [
      this.assistant.on('state', () => this.#paintState()),
      this.assistant.on('messages', (m) => this.#onMessages(m)),
      this.alerts.on('changed', () => this.#paintAlert()),
      this.alerts.on('raised', (a) => this.#onRaised(a)),
      this.voice.on('listening', () => this.#paintMic()),
      this.settings.on('change', (p) => { if (p.startsWith('assistant.')) this.#paintMic(); }),
    ];
    this.#scheduleIdleAnimations();
    this.#flashHint(auto ? 4000 : 7000);
    document.documentElement.classList.add('standby-on');
    this.emit('change', true);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.lastActivity = Date.now();
    for (const off of this.offs) off && off();
    this.offs = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.root.classList.add('is-leaving');
    this.root.classList.remove('is-on');
    document.documentElement.classList.remove('standby-on');
    const done = () => { if (!this.active) this.root.hidden = true; };
    setTimeout(done, reduced() ? 0 : 320);
    this.emit('change', false);
  }

  toggle() { this.active ? this.exit() : this.enter(); }

  #later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  /* ---------- rosto ---------- */
  #paintState() {
    const st = this.assistant.state;
    this.face.setState(st);
    this.faceBox.dataset.state = st;
    this.state.textContent = st === 'normal' || st === 'sleeping' ? '' : MASCOT_LABELS[st] || '';
  }

  /** Piscadas e olhares ocasionais, só enquanto o modo espera está na tela. */
  #scheduleIdleAnimations() {
    if (reduced()) return;
    const blink = () => {
      if (!this.active) return;
      const wink = Math.random() < 0.18;
      const cls = wink ? (Math.random() < 0.5 ? 'wink-l' : 'wink-r') : 'blink';
      const el = this.face;
      el.classList.add(cls);
      this.#later(() => el.classList.remove(cls), 420);
      if (!wink && Math.random() < 0.25) this.#later(() => { el.classList.add('blink'); this.#later(() => el.classList.remove('blink'), 360); }, 520);
      this.#later(blink, 2600 + Math.random() * 3800);
    };
    const look = () => {
      if (!this.active) return;
      const x = (Math.random() * 2 - 1) * 14;
      const y = (Math.random() * 2 - 1) * 6;
      this.faceBox.style.setProperty('--lx', `${x.toFixed(1)}px`);
      this.faceBox.style.setProperty('--ly', `${y.toFixed(1)}px`);
      this.#later(() => { this.faceBox.style.setProperty('--lx', '0px'); this.faceBox.style.setProperty('--ly', '0px'); }, 1600 + Math.random() * 1200);
      this.#later(look, 5000 + Math.random() * 5000);
    };
    this.#later(blink, 1400);
    this.#later(look, 3000);
  }

  /* ---------- legendas e alerta ---------- */
  #caption(text, { user = '' } = {}) {
    this.captionUser.textContent = user ? `“${user}”` : '';
    this.captionText.textContent = text || '';
    this.caption.classList.toggle('has-text', !!(text || user));
    clearTimeout(this.captionT);
    if (text || user) this.captionT = this.#later(() => { this.caption.classList.remove('has-text'); }, Math.max(CAPTION_MS, (text || '').length * 90));
  }

  #onMessages(list) {
    const last = list[list.length - 1];
    if (!last || last.id === this.lastMsgId) return;
    this.lastMsgId = last.id;
    if (last.role === 'user') this.#caption('', { user: last.text });
    else this.#caption(String(last.text).replace(/\(IA indisponível[^)]*\)/, '').trim());
  }

  #onRaised(a) {
    if (!a || a.level === 'info') return;
    this.#caption(`${a.simulated ? 'Simulação. ' : ''}${a.title}`);
  }

  #paintAlert() {
    const top = this.alerts.list().filter((a) => a.level === 'critical' || a.level === 'attention').sort((x, y) => (y.level === 'critical') - (x.level === 'critical'))[0];
    this.alertChip.hidden = !top;
    if (!top) return;
    this.alertChip.dataset.level = top.level;
    this.alertText.textContent = top.title;
  }

  /* ---------- microfone ---------- */
  #micOn() {
    return this.voice.sttSupported && !!this.settings.get('assistant.micEnabled', false) && this.settings.get('assistant.listenMode', 'tap') === 'continuous';
  }

  #paintMic() {
    if (!this.root) return;
    const sup = this.voice.sttSupported;
    const on = this.#micOn();
    const live = on && this.voice.listening;
    this.micBtn.dataset.on = on ? '1' : '0';
    this.micBtn.dataset.live = live ? '1' : '0';
    this.micBtn.disabled = !sup;
    this.micBtn.setAttribute('aria-pressed', String(on));
    const label = !sup ? 'Voz indisponível neste navegador' : on ? `Escutando: diga “${this.assistant.name}”. Toque para desligar o microfone` : 'Microfone desligado. Toque para ligar';
    this.micBtn.setAttribute('aria-label', label);
    this.micBtn.title = label;
    this.micBtn.replaceChildren(ic(on ? 'mic' : 'mic-off', 18));
  }

  #toggleMic() {
    if (!this.voice.sttSupported) return;
    if (this.#micOn()) {
      this.settings.set('assistant.micEnabled', false);
      this.voice.stopListening();
    } else {
      if (this.settings.get('assistant.listenMode', 'tap') !== 'continuous') this.settings.set('assistant.listenMode', 'continuous');
      this.settings.set('assistant.micEnabled', true);
    }
    this.#paintMic();
  }

  /* ---------- gestos ---------- */
  #flashHint(ms = 6000) {
    this.hint.classList.add('show');
    clearTimeout(this.hintT);
    this.hintT = this.#later(() => this.hint.classList.remove('show'), ms);
  }

  #onButton(e) { return !!e.target.closest('button'); }

  #down(e) {
    this.#flashHint();
    if (this.#onButton(e)) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dy: 0, moved: false };
    try { this.root.setPointerCapture(e.pointerId); } catch { /* ignora */ }
  }

  #move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 8 || Math.abs(e.clientX - d.x) > 8) d.moved = true;
    d.dy = dy;
    if (dy < 0) {
      this.root.classList.add('is-dragging');
      this.root.style.setProperty('--dy', `${dy}px`);
      this.root.style.setProperty('--dp', String(Math.min(1, -dy / (window.innerHeight * 0.45))));
    }
  }

  #up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.root.classList.remove('is-dragging');
    const dx = e.clientX - d.x;
    if (d.dy <= -SWIPE_PX && Math.abs(dx) < 120) {
      this.exit();
      return;
    }
    this.root.style.setProperty('--dy', '0px');
    this.root.style.setProperty('--dp', '0');
    if (d.moved) return;
    const now = performance.now();
    if (now - this.tap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) < DOUBLE_TAP_PX) {
      this.tap.t = 0;
      this.exit();
      return;
    }
    this.tap = { t: now, x: e.clientX, y: e.clientY };
  }

  #cancelDrag() {
    this.drag = null;
    this.root?.classList.remove('is-dragging');
    this.root?.style.setProperty('--dy', '0px');
  }
}
