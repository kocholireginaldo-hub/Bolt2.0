/** Diagnóstico: leitura de DTC, estados, freeze frame, prontidão e histórico de falhas. */
import { SEVERITY_LABELS } from './dtc-database.js';
import { STATUS_LABELS } from './diagnostics.js';
import { h, ic, card, badge, button, tabs, emptyState, clear, toast } from './ui.js';
import { friendlyObdError } from './obd-manager.js';
import { fmtDate, fmtNum } from './utils.js';
import { PARAMS } from './config.js';

const SEV_KIND = { info: 'info', attention: 'warn', critical: 'crit', unknown: 'neutral' };
const ST_KIND = { current: 'crit', pending: 'warn', permanent: 'crit', previous: 'neutral' };

export function dtcItem(e, { showFreeze = null } = {}) {
  const status = e.status || 'previous';
  const causes = e.causes?.length ? h('ul', { class: 'causes' }, e.causes.map((c) => h('li', {}, c))) : null;
  return h('details', { class: `dtc dtc-${e.severity}` },
    h('summary', {},
      h('span', { class: 'dtc-code' }, e.code),
      h('span', { class: 'dtc-desc' }, e.description || 'Descrição indisponível na base local'),
      h('span', { class: 'dtc-badges' }, badge(STATUS_LABELS[status] || status, ST_KIND[status] || 'neutral'), e.recurrent ? badge('Reincidente', 'warn', 'refresh') : null, badge(`Gravidade ${SEVERITY_LABELS[e.severity].toLowerCase()} (estimada)`, SEV_KIND[e.severity] || 'neutral'))),
    h('div', { class: 'dtc-body' },
      h('p', {}, h('strong', {}, 'Sistema: '), e.system, e.generic ? ' · código genérico (SAE)' : ' · código específico do fabricante'),
      causes ? h('div', {}, h('strong', {}, 'Possíveis causas (referência geral):'), causes) : null,
      h('p', { class: 'muted' }, e.note),
      e.occurrences ? h('p', { class: 'muted' }, `Ocorrências registradas: ${e.occurrences}${e.firstSeen ? ` · primeira em ${fmtDate(e.firstSeen, true)}` : ''}${e.lastSeen ? ` · última em ${fmtDate(e.lastSeen, true)}` : ''}`) : null,
      showFreeze),
  );
}

export function freezeBlock(ff) {
  if (!ff) return null;
  return h('div', { class: 'freeze' }, h('strong', {}, `Freeze Frame — ${ff.dtc}`), h('div', { class: 'freeze-grid' }, Object.entries(ff.params || {}).map(([id, p]) => h('div', { class: 'stat' }, h('small', {}, PARAMS[id]?.label || id), h('strong', {}, `${fmtNum(p.value, PARAMS[id]?.decimals || 0)} ${p.unit || ''}`)))));
}

/** Histórico de falhas (reutilizado na Manutenção). */
export async function historyList(ctx, origin) {
  const rows = await ctx.diag.history({ origin });
  if (!rows.length) return emptyState('history', 'Sem histórico de falhas', 'Os códigos lidos ficam registrados aqui, separados entre reais e simulados.');
  return h('div', { class: 'dtc-list' }, rows.map((r) => dtcItem({ ...r.info, status: r.status, occurrences: r.episodes.length, recurrent: r.recurrent, firstSeen: r.firstSeen, lastSeen: r.lastSeen }, { showFreeze: r.freezeFrame ? freezeBlock(r.freezeFrame) : null })));
}

export function mountDiagnostics(root, ctx) {
  const { diag } = ctx;
  const cleanups = [];
  const host = h('div', { class: 'view-diag' });
  root.append(host);
  let tab = 'now';
  let busy = false;
  let error = '';
  let histOrigin = 'obd';

  async function scan() {
    if (busy) return;
    busy = true;
    error = '';
    render();
    try {
      await diag.scan();
    } catch (e) {
      error = friendlyObdError(e);
    }
    busy = false;
    render();
  }

  async function render() {
    const src = ctx.ds.diagnosticSource();
    const last = diag.last && diag.last.origin === (src?.origin || diag.last.origin) ? diag.last : null;
    clear(host);
    host.append(
      h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Diagnóstico'), h('p', {}, 'Leitura eletrônica da central (somente leitura).')), h('div', { class: 'head-actions' }, src?.origin === 'simulation' ? badge('SIMULAÇÃO', 'sim', 'lab') : null, button({ label: busy ? 'Lendo…' : 'Ler códigos', icon: 'refresh', kind: 'primary', disabled: !src || busy, onClick: scan }))),
      tabs([['now', 'Situação atual', 'diagnostics'], ['history', 'Histórico', 'history']], tab, (t) => { tab = t; render(); }),
    );
    if (!src) {
      host.append(emptyState('obd', 'Sem conexão com a central', 'Conecte o adaptador OBD2 pelo Painel (ou ative a simulação no Laboratório) para ler os códigos de falha.', button({ label: 'Conectar OBD2', icon: 'obd', kind: 'primary', onClick: () => ctx.openObdDialog() })));
      if (tab === 'now' && last) host.append(h('p', { class: 'muted' }, `Última leitura em ${fmtDate(last.at, true)} (${last.origin === 'simulation' ? 'simulação' : 'real'}).`));
    }
    if (error) host.append(h('div', { class: 'banner banner-warn' }, ic('alert', 18), h('span', {}, error)));

    if (tab === 'now') {
      if (!last) {
        if (src) host.append(emptyState('diagnostics', 'Nenhuma leitura ainda', 'Toque em "Ler códigos" para consultar códigos atuais, pendentes e permanentes.'));
        return;
      }
      const c = last.counts;
      host.append(
        h('div', { class: 'diag-summary' },
          h('div', { class: `mil ${last.milOn ? 'on' : ''}` }, ic('engine', 26), h('div', {}, h('strong', {}, last.milOn == null ? 'Luz MIL: desconhecida' : last.milOn ? 'Luz MIL acesa' : 'Luz MIL apagada'), h('small', {}, `Lido em ${fmtDate(last.at, true)}`))),
          h('div', { class: 'stats-row' }, [['Atuais', c.current], ['Pendentes', c.pending], ['Permanentes', c.permanent]].map(([l, v]) => h('div', { class: 'stat' }, h('small', {}, l), h('strong', {}, String(v)))))),
      );
      host.append(last.entries.length ? h('div', { class: 'dtc-list' }, last.entries.map((e) => dtcItem(e, { showFreeze: last.freezeFrame && last.freezeFrame.dtc === e.code ? freezeBlock(last.freezeFrame) : null }))) : h('div', { class: 'banner banner-ok' }, ic('check', 18), h('span', {}, 'Nenhum código de falha armazenado, pendente ou permanente nesta leitura.')));
      if (last.freezeFrame && !last.entries.some((e) => e.code === last.freezeFrame.dtc)) host.append(card('Freeze Frame', { iconName: 'diagnostics' }, freezeBlock(last.freezeFrame)));
      if (last.monitors.length) {
        host.append(card('Prontidão dos monitores', { iconName: 'shield', subtitle: 'Importante após limpar códigos' }, h('div', { class: 'monitors' }, last.monitors.map((m) => h('div', { class: 'monitor' }, ic(m.complete ? 'check' : 'clock', 16), h('span', {}, m.name), badge(m.complete ? 'Completo' : 'Incompleto', m.complete ? 'ok' : 'warn'))))));
      }
      host.append(h('p', { class: 'muted foot-note' }, 'Gravidade e causas são referências gerais, não um diagnóstico. A limpeza de códigos fica em Manutenção → Operações.'));
    } else {
      host.append(h('div', { class: 'head-actions sub' }, h('span', { class: 'muted' }, 'Origem:'), ...[['obd', 'Reais'], ['simulation', 'Simulação']].map(([v, l]) => button({ label: l, kind: histOrigin === v ? 'primary' : 'ghost', size: 'sm', onClick: () => { histOrigin = v; render(); } }))));
      host.append(await historyList(ctx, histOrigin));
    }
  }

  render();
  cleanups.push(diag.on('scan', render), ctx.ds.on('link', render), ctx.ds.on('mode', render));
  return { destroy: () => cleanups.forEach((c) => c && c()) };
}
