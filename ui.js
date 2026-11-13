/**
 * Biblioteca de componentes de interface (DOM puro, sem innerHTML com dados do usuário).
 * Apenas apresentação: nenhuma regra de negócio mora aqui.
 */
import { icon } from './icons.js';

/** Hyperscript: h('div', {class:'x', on:{click:fn}}, filhos...) */
/* Element.append/prepend nativos escrevem "null"; ignora vazios para permitir `cond ? el : null`. */
if (typeof Element !== 'undefined') for (const m of ['append', 'prepend']) {
  const native = Element.prototype[m];
  Element.prototype[m] = function (...nodes) {
    return native.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
  };
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const ic = (name, size = 18, cls = '') => icon(name, { size, cls });

export function button({ label = '', icon: iconName = null, kind = 'default', onClick, disabled = false, title = '', size = 'md', type = 'button', cls = '' } = {}) {
  const b = h('button', { type, class: `btn btn-${kind} btn-${size} ${cls}`.trim(), title: title || null, disabled, on: onClick ? { click: onClick } : {} }, iconName ? ic(iconName, size === 'sm' ? 16 : 18) : null, label ? h('span', {}, label) : null);
  if (!label && title) b.setAttribute('aria-label', title);
  return b;
}

export function iconButton(name, title, onClick, { kind = 'ghost', cls = '' } = {}) {
  return h('button', { type: 'button', class: `icon-btn icon-btn-${kind} ${cls}`.trim(), title, 'aria-label': title, on: { click: onClick } }, ic(name, 20));
}

export function badge(text, kind = 'neutral', iconName = null) {
  return h('span', { class: `badge badge-${kind}` }, iconName ? ic(iconName, 12) : null, text);
}

export function card(title, { iconName = null, actions = null, cls = '', subtitle = null } = {}, ...body) {
  return h(
    'section',
    { class: `card ${cls}`.trim() },
    title || actions
      ? h('header', { class: 'card-head' }, h('div', { class: 'card-title' }, iconName ? ic(iconName, 16) : null, h('span', {}, title), subtitle ? h('small', {}, subtitle) : null), actions ? h('div', { class: 'card-actions' }, actions) : null)
      : null,
    ...body,
  );
}

export function emptyState(iconName, title, text, action = null) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, ic(iconName, 28)), h('h3', {}, title), text ? h('p', {}, text) : null, action);
}

export function field(label, input, { hint = '', error = '', cls = '' } = {}) {
  return h('label', { class: `field ${error ? 'has-error' : ''} ${cls}`.trim() }, h('span', { class: 'field-label' }, label), input, hint ? h('small', { class: 'field-hint' }, hint) : null, error ? h('small', { class: 'field-error' }, error) : null);
}

export function input(props = {}) {
  return h('input', { class: 'input', ...props });
}
export function select(options, value, props = {}) {
  const s = h('select', { class: 'input', ...props }, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value ?? '';
  return s;
}
export function textarea(props = {}) {
  return h('textarea', { class: 'input', rows: 3, ...props });
}

export function toggle(checked, onChange, label = '') {
  const cb = h('input', { type: 'checkbox', class: 'switch-input', checked: !!checked, on: { change: (e) => onChange(e.target.checked) } });
  return h('label', { class: 'switch' }, cb, h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })), label ? h('span', { class: 'switch-label' }, label) : null);
}

/** Controle segmentado (opções mutuamente exclusivas). */
export function segmented(options, value, onChange, { cls = '' } = {}) {
  const wrap = h('div', { class: `seg ${cls}`.trim(), role: 'radiogroup' });
  const render = (val) => {
    clear(wrap);
    for (const [v, l] of options) {
      wrap.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === val), class: v === val ? 'on' : '', on: { click: () => { onChange(v); render(v); } } }, l));
    }
  };
  render(value);
  return wrap;
}

/** Abas simples. items: [[id,label,icon?]] */
export function tabs(items, active, onChange) {
  const wrap = h('div', { class: 'tabs', role: 'tablist' });
  const render = (cur) => {
    clear(wrap);
    for (const [id, label, ico] of items) {
      wrap.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(id === cur), class: id === cur ? 'on' : '', on: { click: () => { onChange(id); render(id); } } }, ico ? ic(ico, 16) : null, label));
    }
  };
  render(active);
  return wrap;
}

/* ---------------- Toasts ---------------- */
let toastHost;
export function toast(message, kind = 'info', ms = 4500) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const icons = { info: 'info', ok: 'check', warn: 'alert', error: 'alert' };
  const t = h('div', { class: `toast toast-${kind}` }, ic(icons[kind] || 'info', 18), h('span', {}, message));
  toastHost.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const remove = () => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 250);
  };
  setTimeout(remove, ms);
  t.addEventListener('click', remove);
  return remove;
}

/* ---------------- Modais ---------------- */
const modalStack = [];

export function modal({ title, body, actions = [], size = 'md', onClose = null, icon: iconName = null, dismissible = true }) {
  const previous = document.activeElement;
  const overlay = h('div', { class: 'overlay' });
  const dlg = h('div', { class: `modal modal-${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = (result) => {
    const i = modalStack.indexOf(api);
    if (i >= 0) modalStack.splice(i, 1);
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener('keydown', onKey, true);
    previous?.focus?.();
    onClose?.(result);
  };
  const onKey = (e) => {
    if (modalStack[modalStack.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      close('esc');
    }
    if (e.key === 'Tab') {
      const f = [...dlg.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  dlg.append(
    h('header', { class: 'modal-head' }, h('h2', {}, iconName ? ic(iconName, 20) : null, title), dismissible ? iconButton('x', 'Fechar', () => close('x')) : null),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('footer', { class: 'modal-foot' }, actions) : null,
  );
  overlay.append(dlg);
  if (dismissible) overlay.addEventListener('mousedown', (e) => e.target === overlay && close('backdrop'));
  document.body.append(overlay);
  const api = { el: dlg, close };
  modalStack.push(api);
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => {
    overlay.classList.add('in');
    (dlg.querySelector('[autofocus],input,select,textarea') || dlg.querySelector('.btn-primary') || dlg).focus?.();
  });
  return api;
}

/** Confirmação. Com requireText exige digitar a palavra (ações destrutivas). */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, requireText = null, icon: iconName = 'alert', details = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const txt = requireText ? input({ placeholder: `Digite ${requireText}`, autocomplete: 'off', 'aria-label': `Digite ${requireText} para confirmar` }) : null;
    const ok = button({ label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => finish(true), disabled: !!requireText });
    if (txt) txt.addEventListener('input', () => (ok.disabled = txt.value.trim().toUpperCase() !== requireText.toUpperCase()));
    const m = modal({
      title,
      icon: iconName,
      size: 'sm',
      body: [h('p', { class: 'confirm-msg' }, message), details, txt ? field(`Para confirmar, digite ${requireText}`, txt) : null],
      actions: [button({ label: cancelLabel, onClick: () => finish(false) }), ok],
      onClose: () => finish(false),
    });
  });
}

/* ---------------- Formatação de parâmetros ---------------- */
export function validityText(rec) {
  switch (rec.validity) {
    case 'valid': return '';
    case 'stale': return rec.ageMs != null ? `Desatualizado há ${Math.round(rec.ageMs / 1000)} s` : 'Desatualizado';
    case 'invalid': return 'Leitura inválida';
    case 'unsupported': return 'Não fornecido pelo veículo';
    default: return 'Aguardando leitura';
  }
}

export function formatValue(rec) {
  if (rec.value == null || rec.validity === 'unsupported' || rec.validity === 'unavailable') return '—';
  return Number(rec.value).toLocaleString('pt-BR', { minimumFractionDigits: rec.decimals || 0, maximumFractionDigits: rec.decimals || 0 });
}

/** Controla elementos "complexos" quando o veículo está em movimento. */
export function guardMotion(ctx) {
  if (ctx.motionLocked()) {
    toast('Disponível apenas com o veículo parado. Use a voz para consultas rápidas.', 'warn');
    return false;
  }
  return true;
}
