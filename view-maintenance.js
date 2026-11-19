/** Manutenção: resumo, agenda preventiva, histórico de serviços e operações eletrônicas. */
import { MAINTENANCE_TYPES } from './config.js';
import { maintenanceLevel } from './maintenance.js';
import { h, ic, card, badge, button, iconButton, field, input, select, textarea, modal, tabs, toast, confirmDialog, emptyState, clear, guardMotion, toggle } from './ui.js';
import { historyList, dtcItem } from './view-diagnostics.js';
import { friendlyObdError } from './obd-manager.js';
import { fmtNum, fmtDate, fmtMoney } from './utils.js';

const toDateInput = (ts) => (ts ? new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
const fromDateInput = (s) => (s ? new Date(`${s}T12:00:00`).getTime() : null);
const ST = { ok: ['Em dia', 'ok'], soon: ['Próximo', 'warn'], overdue: ['Vencido', 'crit'], unknown: ['Informe a última execução', 'neutral'], unconfigured: ['Sem intervalo', 'neutral'] };
const OP_ST = { available: ['Disponível', 'ok'], unsupported: ['Não suportado', 'neutral'], error: ['Erro', 'crit'], empty: ['Sem dados', 'neutral'], untested: ['Não testado (protegido)', 'warn'] };

export function mountMaintenance(root, ctx) {
  const { maint } = ctx;
  const cleanups = [];
  const host = h('div', { class: 'view-maint' });
  root.append(host);
  let tab = 'summary';
  let ops = null;
  let opsError = '';

  async function render() {
    const veh = ctx.garage.active();
    clear(host);
    host.append(h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Manutenção'), h('p', {}, veh ? `${veh.nickname} · ${ctx.odometer() != null ? `${fmtNum(ctx.odometer(), 0)} km (estimado)` : 'quilometragem não informada'}` : 'Cadastre um veículo para usar a agenda.'))), tabs([['summary', 'Resumo', 'maintenance'], ['schedule', 'Agenda', 'calendar'], ['services', 'Serviços', 'revision'], ['ops', 'Operações', 'diagnostics']], tab, (t) => { tab = t; render(); }));
    if (!veh) {
      host.append(emptyState('garage', 'Nenhum veículo ativo', 'A agenda e o histórico pertencem a um veículo.', button({ label: 'Ir à Garagem', kind: 'primary', onClick: () => ctx.navigate('garage') })));
      return;
    }
    const evals = await maint.evaluate();
    if (tab === 'summary') host.append(summary(evals));
    else if (tab === 'schedule') host.append(schedule(evals));
    else if (tab === 'services') host.append(await services());
    else host.append(await operations());
  }

  function summary(evals) {
    const level = maintenanceLevel({ items: evals, dtcs: ctx.currentDtcs() });
    const msg = { ok: ['Tudo em dia', 'Nenhum serviço próximo do vencimento nem falha ativa.'], attention: ['Atenção', 'Há serviços próximos/vencidos ou códigos de falha para verificar.'], critical: ['Situação crítica', 'Há um serviço crítico vencido ou uma falha de gravidade alta.'] }[level];
    const due = evals.filter((e) => e.status === 'overdue' || e.status === 'soon');
    const missing = evals.filter((e) => e.status === 'unknown' || e.status === 'unconfigured');
    return h('div', { class: 'summary-grid' },
      h('div', { class: `level-card level-${level}` }, h('span', { class: 'level-ico' }, ic('maintenance', 34)), h('div', {}, h('h2', {}, msg[0]), h('p', {}, msg[1]))),
      card('Próximos serviços', { iconName: 'calendar' }, due.length ? h('ul', { class: 'due-list' }, due.map((e) => h('li', {}, h('strong', {}, e.name), badge(ST[e.status][0], ST[e.status][1]), h('small', {}, e.detail)))) : h('p', { class: 'muted' }, evals.length ? 'Nada vencendo no momento.' : 'A agenda está vazia. Cadastre os serviços e intervalos do manual do veículo.'), missing.length ? h('p', { class: 'muted' }, `${missing.length} item(ns) sem intervalo ou sem última execução informada.`) : null),
      card('Falhas eletrônicas', { iconName: 'engine', actions: button({ label: 'Diagnóstico', kind: 'ghost', size: 'sm', onClick: () => ctx.navigate('diagnostics') }) }, ctx.currentDtcs().length ? h('div', { class: 'dtc-list' }, ctx.currentDtcs().map((d) => dtcItem({ ...d, severity: d.severity || 'unknown', causes: d.causes || [], note: d.note || '' }))) : h('p', { class: 'muted' }, 'Nenhum código ativo na última leitura.')),
    );
  }

  function schedule(evals) {
    const head = h('div', { class: 'section-head' }, h('p', { class: 'muted' }, 'Os intervalos vêm do manual do seu veículo — a Alma do Carro não presume valores.'), button({ label: 'Novo item', icon: 'plus', kind: 'primary', onClick: () => itemForm() }));
    if (!evals.length) return h('div', {}, head, emptyState('calendar', 'Agenda vazia', 'Adicione troca de óleo, filtros, velas, correias, freios, fluidos, revisões ou serviços personalizados.'));
    return h('div', {}, head, h('div', { class: 'sched-list' }, evals.map((e) => {
      const [label, kind] = ST[e.status];
      const pct = e.progress == null ? 0 : Math.min(100, Math.round(e.progress * 100));
      return h('article', { class: `sched-item st-${e.status}` },
        h('div', { class: 'sched-main' }, h('span', { class: 'sched-ico' }, ic(MAINTENANCE_TYPES[e.type]?.icon || 'maintenance', 20)), h('div', {}, h('h3', {}, e.name, e.critical ? badge('Crítico', 'crit') : null), h('small', {}, e.detail))),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { style: { width: `${pct}%` } })),
        h('div', { class: 'sched-actions' }, badge(label, kind), button({ label: 'Marcar como feito', icon: 'check', size: 'sm', onClick: () => serviceForm({ scheduleId: e.id, type: e.type, name: e.name, responsible: e.item.responsible }) }), iconButton('edit', 'Editar', () => itemForm(e.item)), iconButton('trash', 'Remover', async () => { if (await confirmDialog({ title: 'Remover item da agenda?', message: `${e.name} sai da agenda. O histórico de serviços já realizados é mantido.`, confirmLabel: 'Remover', danger: true })) { await maint.removeItem(e.id); } })));
    })));
  }

  async function services() {
    const list = await maint.services();
    const total = list.reduce((s, r) => s + (r.cost || 0), 0);
    const head = h('div', { class: 'section-head' }, h('p', { class: 'muted' }, list.length ? `${list.length} serviço(s) · total ${fmtMoney(total)}` : 'Nenhum serviço registrado.'), button({ label: 'Registrar serviço', icon: 'plus', kind: 'primary', onClick: () => serviceForm() }));
    if (!list.length) return h('div', {}, head, emptyState('revision', 'Sem histórico de serviços', 'Registre trocas e revisões com data, quilometragem, valor e responsável.'));
    return h('div', {}, head, h('ul', { class: 'service-list' }, list.map((r) => h('li', { class: 'service-row' }, h('span', { class: 'sched-ico' }, ic(MAINTENANCE_TYPES[r.type]?.icon || 'maintenance', 18)), h('div', {}, h('strong', {}, r.name), h('small', {}, `${fmtDate(r.date)}${r.km != null ? ` · ${fmtNum(r.km, 0)} km` : ''}${r.responsible ? ` · ${r.responsible}` : ''}`), r.notes ? h('small', {}, r.notes) : null), h('span', { class: 'service-cost' }, r.cost != null ? fmtMoney(r.cost) : ''), iconButton('trash', 'Excluir registro', async () => { if (await confirmDialog({ title: 'Excluir registro?', message: 'O registro do serviço será removido.', confirmLabel: 'Excluir', danger: true })) await maint.removeService(r.id); })))));
  }

  /* ---------------- Operações eletrônicas ---------------- */
  async function operations() {
    const src = ctx.ds.diagnosticSource();
    const wrap = h('div', { class: 'ops' });
    wrap.append(card('Operações disponíveis na central', { iconName: 'diagnostics', subtitle: src?.origin === 'simulation' ? 'SIMULAÇÃO' : '', actions: button({ label: 'Consultar', icon: 'refresh', kind: 'default', size: 'sm', disabled: !src, onClick: async () => { opsError = ''; try { ops = await ctx.diag.operations(); } catch (e) { opsError = friendlyObdError(e); } render(); } }) },
      !src ? h('p', { class: 'muted' }, 'Conecte o OBD2 (ou ative a simulação) para consultar o que a central do veículo oferece.') : null,
      opsError ? h('div', { class: 'banner banner-warn' }, ic('alert', 18), h('span', {}, opsError)) : null,
      ops ? h('div', {}, h('p', { class: 'muted' }, [ops.adapter, ops.protocol, ops.vin ? `VIN ${ops.vin}` : null].filter(Boolean).join(' · ')), h('ul', { class: 'op-list' }, ops.operations.map((o) => h('li', {}, h('span', {}, o.label), badge(OP_ST[o.status]?.[0] || o.status, OP_ST[o.status]?.[1] || 'neutral'), o.note ? h('small', {}, o.note) : null)))) : null));

    wrap.append(card('Limpar códigos de falha', { iconName: 'engine', cls: 'clear-card' },
      h('p', {}, 'Apagar um código não corrige o defeito: se a causa continuar, o código volta. A limpeza também zera os monitores de prontidão e o Freeze Frame na central.'),
      h('ul', { class: 'check-list' }, ['Antes de apagar, a Alma do Carro lê e guarda localmente os códigos, o Freeze Frame e os dados ao vivo.', 'Depois de apagar, a Alma do Carro consulta a central de novo e mostra o que voltou.', 'Nunca há programação de ECU nem comandos não documentados.'].map((t) => h('li', {}, ic('check', 14), t))),
      button({ label: 'Limpar códigos…', icon: 'trash', kind: 'danger', disabled: !src, onClick: clearFlow }),
      !src ? h('small', { class: 'muted' }, 'Requer conexão com a central.') : null));

    const log = await ctx.diag.clearLog();
    if (log.length) {
      wrap.append(card('Limpezas anteriores', { iconName: 'history' }, h('ul', { class: 'clear-log' }, log.map((c) => h('li', {}, h('strong', {}, fmtDate(c.at, true)), c.origin === 'simulation' ? badge('SIM', 'sim') : null, h('small', {}, `${c.codesBefore.length} código(s) antes · ${c.result ? `${c.result.returned.length} voltaram, ${c.result.cleared.length} sem retorno` : 'resultado não verificado'}`), h('small', { class: 'muted' }, c.codesBefore.map((x) => x.code).join(', ') || '—'))))));
    }
    wrap.append(card('Histórico de falhas', { iconName: 'history' }, await historyList(ctx, src?.origin || 'obd')));
    return wrap;
  }

  async function clearFlow() {
    if (!guardMotion(ctx)) return;
    const src = ctx.ds.diagnosticSource();
    if (!src) return toast('Sem conexão com a central.', 'warn');
    const ok = await confirmDialog({
      title: 'Limpar códigos de falha?',
      icon: 'engine',
      danger: true,
      confirmLabel: 'Limpar códigos',
      requireText: 'LIMPAR',
      message: src.origin === 'simulation' ? 'Operação SIMULADA: nenhum veículo real será alterado.' : 'Isto envia o comando padrão de limpeza (modo 04) à central do veículo real. Faça com o veículo parado e, de preferência, com o motor desligado e ignição ligada.',
      details: h('ul', { class: 'check-list' }, ['Os códigos e o Freeze Frame atuais serão guardados antes.', 'A causa do defeito NÃO é corrigida.', 'Os monitores de prontidão voltam a "incompletos" e podem levar dias de uso para completar.'].map((t) => h('li', {}, ic('alert', 14), t))),
    });
    if (!ok) return;
    const loading = toast('Lendo, preservando e limpando…', 'info', 20000);
    try {
      const snap = await ctx.diag.clearCodes({ confirmed: true });
      loading();
      resultDialog(snap);
    } catch (e) {
      loading();
      toast(friendlyObdError(e), 'error');
    }
    render();
  }

  function resultDialog(s) {
    const r = s.result;
    const list = (arr) => (arr.length ? arr.join(', ') : 'nenhum');
    const m = modal({
      title: 'Resultado da limpeza',
      icon: r.returned.length ? 'alert' : 'check',
      size: 'sm',
      body: [
        h('p', {}, `A central foi consultada novamente em ${fmtDate(r.checkedAt, true)}.`),
        h('ul', { class: 'result-list' }, h('li', {}, h('strong', {}, 'Sem retorno: '), list(r.cleared)), h('li', {}, h('strong', {}, 'Voltaram imediatamente: '), list(r.returned)), h('li', {}, h('strong', {}, 'Novos códigos: '), list(r.newCodes))),
        r.returned.length ? h('div', { class: 'banner banner-warn' }, ic('alert', 18), h('span', {}, 'Códigos que voltam indicam defeito ainda presente. Apagar não resolve a causa.')) : h('p', { class: 'muted' }, 'Mesmo sem retorno agora, um código pode reaparecer depois de alguns ciclos de condução se a causa persistir. Os dados anteriores continuam salvos no histórico.'),
      ],
      actions: [button({ label: 'Entendi', kind: 'primary', onClick: () => m.close() })],
    });
  }

  /* ---------------- Formulários ---------------- */
  function itemForm(existing = null) {
    if (!guardMotion(ctx)) return;
    const d = existing ? { ...existing } : { type: 'oil', name: '', intervalKm: null, intervalMonths: null, lastDoneKm: null, lastDoneDate: null, critical: false, responsible: '', estCost: null, notes: '' };
    let errors = {};
    const body = h('div');
    const num = (k, props = {}) => input({ type: 'number', min: 0, value: d[k] ?? '', ...props, on: { input: (e) => (d[k] = e.target.value === '' ? null : Number(e.target.value)) } });
    const paint = () => {
      clear(body).append(
        h('div', { class: 'form-grid' },
          field('Tipo', select(Object.entries(MAINTENANCE_TYPES).map(([k, v]) => [k, v.label]), d.type, { on: { change: (e) => { d.type = e.target.value; if (!d.name) nameInp.placeholder = MAINTENANCE_TYPES[d.type].label; } } })),
          field('Nome *', (nameInp = input({ value: d.name, placeholder: MAINTENANCE_TYPES[d.type].label, on: { input: (e) => (d.name = e.target.value) } })), { error: errors.name }),
          field('Intervalo (km)', num('intervalKm', { placeholder: 'Conforme o manual' }), { error: errors.intervalKm }),
          field('Intervalo (meses)', num('intervalMonths', { placeholder: 'Conforme o manual' }), { error: errors.intervalMonths }),
          field('Última execução (km)', num('lastDoneKm'), { error: errors.lastDoneKm }),
          field('Última execução (data)', input({ type: 'date', value: toDateInput(d.lastDoneDate), on: { input: (e) => (d.lastDoneDate = fromDateInput(e.target.value)) } })),
          field('Responsável / oficina', input({ value: d.responsible || '', on: { input: (e) => (d.responsible = e.target.value) } })),
          field('Custo estimado (R$)', num('estCost', { step: 0.01 })),
        ),
        h('div', { class: 'pref-row' }, h('div', {}, h('strong', {}, 'Item crítico de segurança'), h('small', {}, 'Se vencer, o ícone de manutenção fica vermelho (ex.: freios).')), toggle(!!d.critical, (v) => (d.critical = v))),
        field('Observações', textarea({ value: d.notes || '', on: { input: (e) => (d.notes = e.target.value) } })),
        h('p', { class: 'muted' }, 'Informe ao menos um intervalo (km ou meses) e a última execução para a Alma do Carro calcular o vencimento.'),
      );
    };
    let nameInp;
    paint();
    const m = modal({ title: existing ? 'Editar item da agenda' : 'Novo item da agenda', icon: 'calendar', size: 'lg', body, actions: [button({ label: 'Cancelar', onClick: () => m.close() }), button({ label: 'Salvar', kind: 'primary', onClick: async () => { try { await maint.saveItem(d); m.close(); toast('Item salvo.', 'ok'); } catch (e) { if (e.errors) { errors = e.errors; paint(); } else toast(e.message, 'error'); } } })] });
  }

  function serviceForm(prefill = {}) {
    if (!guardMotion(ctx)) return;
    const d = { type: 'oil', name: '', date: Date.now(), km: ctx.odometer() != null ? Math.round(ctx.odometer()) : null, cost: null, responsible: '', notes: '', scheduleId: null, ...prefill };
    let errors = {};
    const body = h('div');
    let nameInp;
    const paint = () => {
      clear(body).append(
        h('div', { class: 'form-grid' },
          field('Tipo', select(Object.entries(MAINTENANCE_TYPES).map(([k, v]) => [k, v.label]), d.type, { on: { change: (e) => (d.type = e.target.value) } })),
          field('Serviço *', (nameInp = input({ value: d.name, placeholder: MAINTENANCE_TYPES[d.type].label, on: { input: (e) => (d.name = e.target.value) } })), { error: errors.name }),
          field('Data', input({ type: 'date', value: toDateInput(d.date), on: { input: (e) => (d.date = fromDateInput(e.target.value)) } }), { error: errors.date }),
          field('Quilometragem (km)', input({ type: 'number', min: 0, value: d.km ?? '', on: { input: (e) => (d.km = e.target.value === '' ? null : Number(e.target.value)) } }), { error: errors.km }),
          field('Valor (R$)', input({ type: 'number', min: 0, step: 0.01, value: d.cost ?? '', on: { input: (e) => (d.cost = e.target.value === '' ? null : Number(e.target.value)) } })),
          field('Responsável / oficina', input({ value: d.responsible || '', on: { input: (e) => (d.responsible = e.target.value) } })),
        ),
        field('Observações', textarea({ value: d.notes || '', on: { input: (e) => (d.notes = e.target.value) } })),
        d.scheduleId ? h('p', { class: 'muted' }, 'Este registro atualiza a última execução do item da agenda.') : null,
      );
    };
    paint();
    const m = modal({ title: 'Registrar serviço', icon: 'revision', size: 'lg', body, actions: [button({ label: 'Cancelar', onClick: () => m.close() }), button({ label: 'Salvar', kind: 'primary', onClick: async () => { try { await maint.addService(d); m.close(); toast('Serviço registrado.', 'ok'); } catch (e) { if (e.errors) { errors = e.errors; paint(); } else toast(e.message, 'error'); } } })] });
  }

  render();
  cleanups.push(maint.on('change', render), ctx.garage.on('change', render), ctx.diag.on('scan', () => tab !== 'ops' && render()));
  return { destroy: () => cleanups.forEach((c) => c && c()) };
}
