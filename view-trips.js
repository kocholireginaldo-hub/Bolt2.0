/** Viagens: histórico por veículo, separado entre reais e simulação; percurso GPS quando autorizado. */
import { h, ic, card, badge, button, iconButton, emptyState, clear, confirmDialog, segmented, toast, toggle } from './ui.js';
import { tripToGpx, tripsToCsv } from './trips.js';
import { fmtNum, fmtDate, fmtDuration, fmtDistance, downloadText } from './utils.js';

function routeSvg(points) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 160');
  svg.setAttribute('class', 'route-svg');
  if (!points || points.length < 2) return null;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = (maxLon - minLon) * kx || 1e-6;
  const hh = maxLat - minLat || 1e-6;
  const scale = Math.min(280 / w, 140 / hh);
  const ox = (300 - w * scale) / 2;
  const oy = (160 - hh * scale) / 2;
  const pts = points.map((p) => `${(ox + (p.lon - minLon) * kx * scale).toFixed(1)},${(oy + (maxLat - p.lat) * scale).toFixed(1)}`);
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('class', 'route-line');
  line.setAttribute('fill', 'none');
  svg.append(line);
  for (const [i, cls] of [[0, 'route-start'], [pts.length - 1, 'route-end']]) {
    const [x, y] = pts[i].split(',');
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', '4');
    c.setAttribute('class', cls);
    svg.append(c);
  }
  return svg;
}

export function mountTrips(root, ctx) {
  const { trips, settings } = ctx;
  const cleanups = [];
  const host = h('div', { class: 'view-trips' });
  root.append(host);
  let filter = 'all';
  let selectedId = null;

  async function render() {
    const veh = ctx.garage.active();
    clear(host);
    host.append(h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Viagens'), h('p', {}, veh ? `Histórico de ${veh.nickname}` : 'Cadastre um veículo para separar o histórico.')), h('div', { class: 'head-actions' }, segmented([['all', 'Todas'], ['obd', 'Reais'], ['simulation', 'Simulação']], filter, (v) => { filter = v; selectedId = null; render(); }))));

    const live = trips.summary();
    host.append(liveCard(live));
    host.append(settingsCard());

    const all = await trips.list({ vehicleId: veh?.id ?? null, origin: filter === 'all' ? undefined : filter });
    if (!all.length) {
      host.append(emptyState('trips', 'Nenhuma viagem registrada', 'As viagens são gravadas a partir da velocidade lida do OBD2 (ou da simulação). Dados reais e simulados ficam separados.'));
      return;
    }
    const sel = all.find((t) => t.id === selectedId) || all[0];
    selectedId = sel.id;
    const total = all.reduce((s, t) => s + t.distanceKm, 0);
    host.append(
      h('div', { class: 'trips-layout' },
        card(`${all.length} viagem${all.length > 1 ? 's' : ''} · ${fmtDistance(total)}`, { iconName: 'list', actions: button({ label: 'CSV', icon: 'download', kind: 'ghost', size: 'sm', onClick: () => downloadText('bolt-viagens.csv', tripsToCsv(all), 'text/csv') }) },
          h('ul', { class: 'trip-list' }, all.map((t) => h('li', {}, h('button', { type: 'button', class: `trip-row ${t.id === sel.id ? 'on' : ''}`, on: { click: () => { selectedId = t.id; render(); } } }, h('div', {}, h('strong', {}, fmtDate(t.startedAt, true)), h('small', {}, `${fmtDistance(t.distanceKm)} · ${fmtDuration(t.totalSec)}`)), t.origin === 'simulation' ? badge('SIM', 'sim') : badge('Real', 'ok')))))),
        detail(sel),
      ),
    );
  }

  function liveCard(t) {
    if (!t.active) {
      return card('Gravação', { iconName: 'play', cls: 'trip-live' }, h('div', { class: 'live-row' }, h('p', { class: 'muted' }, ctx.engine.source === 'none' ? 'Sem fonte de dados ativa.' : settings.get('trips.autoRecord', true) ? 'Aguardando movimento para iniciar automaticamente.' : 'Gravação automática desligada.'), ctx.engine.source !== 'none' ? button({ label: 'Iniciar viagem', icon: 'play', kind: 'primary', onClick: () => { try { trips.start({ manual: true }); render(); } catch (e) { toast(e.message, 'error'); } } }) : null));
    }
    return card('Viagem em andamento', { iconName: 'road', cls: 'trip-live is-live' }, h('div', { class: 'live-row' }, h('div', { class: 'stats-row' }, stat('Distância', fmtDistance(t.distanceKm)), stat('Tempo', fmtDuration(t.totalSec)), stat('Vel. média', `${fmtNum(t.avgSpeedKmh, 0)} km/h`)), h('div', { class: 'head-actions' }, t.origin === 'simulation' ? badge('SIMULAÇÃO', 'sim') : badge('Real', 'ok'), button({ label: 'Encerrar', icon: 'stop', onClick: async () => { await trips.stop(); render(); } }))));
  }

  const stat = (l, v, s = '') => h('div', { class: 'stat' }, h('small', {}, l), h('strong', {}, v), s ? h('span', {}, s) : null);

  function settingsCard() {
    return card('Preferências de gravação', { iconName: 'sliders', cls: 'trip-prefs' },
      h('div', { class: 'pref-row' }, h('div', {}, h('strong', {}, 'Gravar automaticamente'), h('small', {}, 'Inicia ao sair do lugar e encerra após ficar parado.')), toggle(settings.get('trips.autoRecord', true), (v) => settings.set('trips.autoRecord', v))),
      h('div', { class: 'pref-row' }, h('div', {}, h('strong', {}, 'Registrar percurso por GPS'), h('small', {}, 'Pede permissão de localização só quando uma viagem REAL começa. Dados ficam neste dispositivo.')), toggle(settings.get('trips.gps', false), (v) => { settings.set('trips.gps', v); if (v && !ctx.platform.geolocation) toast('Este navegador não oferece geolocalização.', 'warn'); })));
  }

  function detail(t) {
    const route = routeSvg(t.points);
    return card('Detalhes da viagem', { iconName: 'pin', actions: [t.points?.length ? button({ label: 'GPX', icon: 'download', kind: 'ghost', size: 'sm', onClick: () => downloadText(`bolt-viagem-${t.startedAt}.gpx`, tripToGpx(t), 'application/gpx+xml') }) : null, iconButton('trash', 'Excluir viagem', async () => { if (await confirmDialog({ title: 'Excluir viagem?', message: 'Esta viagem será removida do histórico local.', confirmLabel: 'Excluir', danger: true })) { await trips.remove(t.id); render(); } })] },
      h('div', { class: 'detail-head' }, h('strong', {}, fmtDate(t.startedAt, true)), t.origin === 'simulation' ? badge('SIMULAÇÃO — dados fictícios', 'sim') : badge('Real', 'ok'), t.stopReason ? h('small', { class: 'muted' }, t.stopReason) : null),
      h('div', { class: 'stats-grid' }, stat('Distância', fmtDistance(t.distanceKm)), stat('Duração', fmtDuration(t.totalSec)), stat('Em movimento', fmtDuration(t.movingSec)), stat('Vel. média', `${fmtNum(t.avgSpeedKmh, 0)} km/h`, 'em movimento'), stat('Vel. máxima', `${fmtNum(t.maxSpeed, 0)} km/h`), stat('Combustível', t.fuelL ? `${fmtNum(t.fuelL, 2)} L` : '—', 'estimado'), stat('Consumo médio', t.avgKmL ? `${fmtNum(t.avgKmL, 1)} km/L` : '—', 'estimado')),
      route ? h('div', { class: 'route-box' }, route) : h('p', { class: 'muted' }, t.origin === 'simulation' ? 'Viagens simuladas não têm percurso GPS.' : 'Sem percurso GPS nesta viagem (ative o GPS nas preferências antes de viajar).'),
    );
  }

  render();
  cleanups.push(ctx.garage.on('change', render), trips.on('stopped', render), trips.on('started', render), trips.on('discarded', render));
  cleanups.push(ctx.onTick(() => { if (trips.active) updateLive(); }));
  function updateLive() {
    const el = host.querySelector('.trip-live');
    if (!el) return;
    const fresh = liveCard(trips.summary());
    el.replaceWith(fresh);
  }
  return { destroy: () => cleanups.forEach((c) => c && c()) };
}
