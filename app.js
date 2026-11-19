/** ALMA DO CARRO — ponto de entrada: monta serviços, rotas, cabeçalho, navegação, a alma do carro e a janela do assistente. */
import { APP } from './config.js';
import { detectPlatform } from './platform.js';
import { createDatabase } from './database.js';
import { Settings } from './settings.js';
import { VehicleDataEngine } from './vehicle-engine.js';
import { ObdManager } from './obd-manager.js';
import { VehicleSimulator } from './vehicle-simulator.js';
import { DataSourceController } from './data-source.js';
import { Connectivity } from './connectivity.js';
import { AlertEngine } from './alerts.js';
import { Garage, currentOdometer } from './garage.js';
import { TripRecorder } from './trips.js';
import { GeoTracker } from './geo.js';
import { MaintenanceService } from './maintenance.js';
import { DiagnosticsService } from './diagnostics.js';
import { AiService } from './ai-service.js';
import { VoiceService } from './voice.js';
import { Assistant } from './assistant.js';
import { NAV_ITEMS } from './icons.js';
import { h, ic, iconButton, badge, modal, toast, clear } from './ui.js';
import { createMascot } from './mascot.js';
import { mountDashboard } from './view-dashboard.js';
import { mountGarage } from './view-garage.js';
import { mountTrips } from './view-trips.js';
import { mountDiagnostics } from './view-diagnostics.js';
import { mountMaintenance } from './view-maintenance.js';
import { mountLab } from './view-lab.js';
import { mountSettings } from './view-settings.js';
import { createAssistantWidget } from './view-assistant.js';
import { openObdDialog } from './obd-dialog.js';
import { SoulEvents } from './alma-soul.js';
import { StandbyMode } from './standby.js';

const ROUTES = {
  panel: mountDashboard,
  garage: mountGarage,
  trips: mountTrips,
  diagnostics: mountDiagnostics,
  maintenance: mountMaintenance,
  lab: mountLab,
  settings: mountSettings,
};
const TITLES = { panel: 'Painel', garage: 'Garagem', trips: 'Viagens', diagnostics: 'Diagnóstico', maintenance: 'Manutenção', lab: 'Laboratório', settings: 'Configurações' };

const safe = (fn) => { try { return fn(); } catch { return undefined; } };

async function boot() {
  const platform = detectPlatform(window);
  const { db, volatile } = await bootDb();
  const settings = new Settings(db);
  await settings.load();

  const engine = new VehicleDataEngine();
  const obd = new ObdManager({ settings });
  const sim = new VehicleSimulator();
  const ds = new DataSourceController({ engine, obd, sim });
  const connectivity = new Connectivity(window);
  const garage = new Garage({ db });
  await garage.load();
  await seedGarage(db, garage);
  const geo = GeoTracker.isSupported(window) ? new GeoTracker(window) : null;
  const getSetting = (p, d) => settings.get(p, d);
  const getVehicle = () => garage.active();
  const trips = new TripRecorder({ engine, db, getSetting, getVehicle, geo });
  await trips.recover();
  const diag = new DiagnosticsService({ db, getSource: () => ds.diagnosticSource(), getVehicle, engine });
  const alerts = new AlertEngine({ engine, getVehicle, getSetting });
  const ai = new AiService({ getSetting });
  const voice = new VoiceService({ getSetting });

  const tickers = new Set();
  let odoCache = null;
  const ctx = {
    platform, volatile, db, settings, engine, obd, sim, ds, connectivity, garage, trips, diag, alerts, ai, voice, geo,
    onTick(fn) { tickers.add(fn); return () => tickers.delete(fn); },
    odometer: () => odoCache ?? garage.active()?.odometerKm ?? null,
    currentDtcs() {
      const last = diag.last;
      const src = ds.diagnosticSource();
      if (!last || !src || last.origin !== src.origin || last.vehicleId !== (getVehicle()?.id ?? null)) return [];
      return last.entries.filter((e) => ['current', 'pending', 'permanent'].includes(e.status));
    },
    motionLocked() {
      if (!settings.get('safety.motionLock', true)) return false;
      const v = engine.value('speed');
      return v != null && v > settings.get('safety.lockSpeedKmh', 8);
    },
    navigate(route) { location.hash = `#/${route}`; },
    setNavActive: null,
    openObdDialog: () => openObdDialog(ctx),
    openAlertsPanel: () => openAlertsPanel(ctx),
    async reloadAll() {
      await settings.load();
      await garage.load();
      await assistant.load();
      applyAppearance();
      route();
    },
    async wipeAll() {
      for (const s of ['vehicles', 'trips', 'dtcHistory', 'services', 'schedule', 'alerts', 'assistant', 'settings', 'kv']) await db.clear(s);
      location.hash = '#/panel';
      location.reload();
    },
  };
  ctx.maint = new MaintenanceService({ db, getVehicle, getOdometer: () => ctx.odometer(), getSetting });

  const assistant = new Assistant({
    settings, ai, voice, connectivity, db,
    getContext: () => ({ engine, vehicle: getVehicle(), alerts: alerts.list(), dtcs: ctx.currentDtcs(), maintenance: maintItems.map((m) => ({ name: m.name, status: m.status, detail: m.detail })), trip: trips.summary(), obdLabel: ds.linkStatus().label, simulated: engine.source === 'simulation' }),
  });
  ctx.assistant = assistant;
  await assistant.load();

  /* ---------- aparência e orientação ---------- */
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  function applyAppearance() {
    const theme = settings.get('appearance.theme', 'dark');
    const resolved = theme === 'auto' ? (mq.matches ? 'light' : 'dark') : theme;
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', resolved === 'light' ? '#EEF3F8' : '#070B11');
    document.documentElement.dataset.accent = settings.get('appearance.accent', 'cyan');
    const acc = APP_ACCENTS[settings.get('appearance.accent', 'cyan')] || APP_ACCENTS.cyan;
    document.documentElement.style.setProperty('--acc-a', acc.a);
    document.documentElement.style.setProperty('--acc-b', acc.b);
    applyOrientation();
    shell.classList.toggle('nav-collapsed', !!settings.get('layout.navCollapsed', false));
  }
  function applyOrientation() {
    const o = settings.get('layout.orientation', 'auto');
    const land = o === 'auto' ? window.innerWidth >= window.innerHeight : o === 'landscape';
    document.documentElement.dataset.layout = land ? 'landscape' : 'portrait';
    document.documentElement.dataset.layoutMode = o;
    if (o !== 'auto' && platform.screenOrientationLock) safe(() => screen.orientation.lock(o).catch(() => {}));
    else if (o === 'auto' && platform.screenOrientationLock) safe(() => screen.orientation.unlock());
  }

  /* ---------- casca ---------- */
  const mascot = createMascot({ size: 30, state: assistant.state });
  const vehicleLabel = h('span', { class: 'hd-vehicle' });
  const srcPill = h('span', { class: 'hd-src' });
  const netPill = h('span', { class: 'hd-net' });
  const bellCount = h('span', { class: 'bell-count', hidden: true });
  const bell = h('button', { type: 'button', class: 'icon-btn icon-btn-ghost bell', 'aria-label': 'Alertas', on: { click: () => openAlertsPanel(ctx) } }, ic('bell', 20), bellCount);
  const obdBtn = h('button', { type: 'button', class: 'icon-btn icon-btn-ghost obd-btn', 'aria-label': 'Conexão OBD2', on: { click: () => openObdDialog(ctx) } }, ic('obd', 20));
  const gear = h('button', { type: 'button', class: 'icon-btn icon-btn-ghost gear', 'aria-label': 'Configurações', on: { click: () => ctx.navigate('settings') } }, ic('settings', 20));
  const header = h('header', { class: 'app-header' },
    h('a', { class: 'brand', href: '#/panel', 'aria-label': 'Alma do Carro — Painel' }, h('img', { src: 'bolt-icon.svg', alt: '', width: 28, height: 28 }), h('strong', {}, 'ALMA DO CARRO')),
    vehicleLabel, h('span', { class: 'hd-spacer' }), srcPill, netPill, obdBtn, bell, gear);
  const simStrip = h('div', { class: 'sim-strip', hidden: true, role: 'status' }, ic('lab', 14), h('span', {}, 'SIMULAÇÃO — dados fictícios do Laboratório'));
  const view = h('main', { class: 'app-view', id: 'view', tabindex: '-1' });

  const navBtns = new Map();
  const nav = h('nav', { class: 'app-nav', 'aria-label': 'Navegação principal' },
    ...NAV_ITEMS.map((n) => {
      const b = h('a', { class: 'nav-item', href: n.id === 'assistant' ? '#' : `#/${n.id}`, dataset: { id: n.id }, on: n.id === 'assistant' ? { click: (e) => { e.preventDefault(); widget.toggle(); } } : {} }, ic(n.icon, 22), h('span', {}, n.label));
      if (n.id === 'assistant') b.classList.add('nav-asst');
      navBtns.set(n.id, b);
      return b;
    }),
    h('a', { class: 'nav-lab', href: '#/lab', 'aria-label': 'Laboratório (simulador)', title: 'Laboratório', dataset: { id: 'lab' } }, ic('lab', 18), h('span', { class: 'nav-lab-txt' }, 'Laboratório')),
    h('button', { type: 'button', class: 'nav-fold', 'aria-label': 'Recolher barra de navegação', title: 'Recolher/expandir', on: { click: () => settings.set('layout.navCollapsed', !settings.get('layout.navCollapsed', false)) } }, ic('chevron-down', 18)));
  navBtns.set('lab', nav.querySelector('.nav-lab'));
  const navHandle = h('button', { type: 'button', class: 'nav-handle', 'aria-label': 'Mostrar barra de navegação', on: { click: () => settings.set('layout.navCollapsed', false) } }, ic('chevron-up', 18));

  const shell = h('div', { class: 'app-shell' }, simStrip, header, view, nav, navHandle);
  const root = document.getElementById('app');
  clear(root).append(shell);
  ctx.shell = shell;

  const widget = createAssistantWidget(ctx);
  ctx.widget = widget;
  ctx.setNavActive = (id) => { navBtns.get('assistant')?.classList.toggle('active', id === 'assistant'); };

  /* ---------- rotas ---------- */
  let current = null;
  let currentId = null;
  function route() {
    const id = (location.hash.replace(/^#\/?/, '').split('/')[0] || 'panel');
    const rid = ROUTES[id] ? id : 'panel';
    current?.destroy?.();
    current = null;
    clear(view);
    currentId = rid;
    document.title = `${TITLES[rid]} · Alma do Carro`;
    for (const [k, b] of navBtns) if (k !== 'assistant') b.classList.toggle('active', k === rid);
    view.dataset.route = rid;
    shell.dataset.route = rid;
    try {
      current = ROUTES[rid](view, ctx);
    } catch (err) {
      console.error(err);
      view.append(h('div', { class: 'banner banner-warn' }, ic('alert', 18), h('span', {}, `Não foi possível abrir esta tela: ${err.message}`)));
    }
    view.scrollTop = 0;
  }
  window.addEventListener('hashchange', route);

  /* ---------- cabeçalho vivo ---------- */
  function paintHeader() {
    const v = garage.active();
    vehicleLabel.textContent = v ? v.nickname : 'Sem veículo';
    const ls = ds.linkStatus();
    const sim = engine.source === 'simulation';
    simStrip.hidden = !sim;
    shell.classList.toggle('is-sim', sim);
    clear(srcPill).append(sim ? badge('SIMULAÇÃO', 'sim', 'lab') : engine.source === 'obd' ? badge(ls.label, ls.state === 'ready' ? 'ok' : ls.state === 'error' ? 'crit' : 'warn', 'obd') : badge('Sem dados', 'neutral', 'obd'));
    clear(netPill).append(ic(connectivity.online ? 'globe' : 'globe-off', 16));
    netPill.title = connectivity.label;
    netPill.classList.toggle('off', !connectivity.online);
    obdBtn.classList.toggle('is-on', ls.state === 'ready' && !sim);
  }
  function paintBell() {
    const list = alerts.list();
    const n = list.filter((a) => !a.acknowledged).length;
    bellCount.hidden = !n;
    bellCount.textContent = n;
    const top = alerts.highestLevel();
    bell.dataset.level = top || '';
    assistant.setMoodFromAlerts(list);
  }

  /* ---------- manutenção e odômetro ---------- */
  let maintItems = [];
  async function refreshMaint() {
    const v = garage.active();
    if (v) {
      const t = await db.where('trips', (r) => r.vehicleId === v.id && r.origin === 'obd');
      odoCache = currentOdometer(v, t);
    } else odoCache = null;
    maintItems = await ctx.maint.evaluate().catch(() => []);
    alerts.setContext({ maintenance: maintItems });
  }

  /* ---------- eventos ---------- */
  let beepCtx = null;
  function beep(level) {
    if (!settings.get('alerts.sound', true)) return;
    safe(() => {
      beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = beepCtx.createOscillator();
      const g = beepCtx.createGain();
      o.type = 'sine';
      o.frequency.value = level === 'critical' ? 880 : 620;
      g.gain.setValueAtTime(0.0001, beepCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, beepCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, beepCtx.currentTime + (level === 'critical' ? 0.5 : 0.25));
      o.connect(g).connect(beepCtx.destination);
      o.start();
      o.stop(beepCtx.currentTime + 0.55);
    });
  }
  alerts.on('raised', (a) => {
    if (a.level === 'info') return;
    toast(`${a.simulated ? 'SIMULAÇÃO · ' : ''}${a.title}`, a.level === 'critical' ? 'error' : 'warn', 6000);
    beep(a.level);
    assistant.announceAlert(a);
  });
  alerts.on('changed', paintBell);
  assistant.on('state', (s) => mascot.setState(s));

  /* ---------- a alma: reage sozinha ao que acontece com o carro ---------- */
  const soul = new SoulEvents({ engine, getVehicle, getSetting, say: (t) => assistant.say(t), onAwake: (on) => assistant.setAwake(on) });
  ctx.soul = soul;
  soul.start();

  /* ---------- modo espera: protetor de tela com a cara do Bolt ---------- */
  const standby = new StandbyMode({ assistant, voice, alerts, settings, openAlerts: () => openAlertsPanel(ctx) });
  ctx.standby = standby;
  standby.start();
  assistant.on('command', ({ name }) => {
    if (name === 'standby') standby.enter();
    else if (name === 'wake') standby.exit();
  });

  /* ---------- escuta pelo nome: começa no primeiro toque (o navegador exige um gesto) ---------- */
  function maybeListen() {
    if (!assistant.enabled || !voice.sttSupported) return;
    if (!settings.get('assistant.micEnabled', false) || settings.get('assistant.listenMode', 'tap') !== 'continuous') return;
    voice.startListening({ mode: 'continuous' });
  }
  document.addEventListener('pointerdown', function first() {
    document.removeEventListener('pointerdown', first);
    maybeListen();
  });
  settings.on('change', (p) => {
    if (p === 'assistant.listenMode' || p === 'assistant.micEnabled' || p === 'assistant.enabled') {
      voice.stopListening();
      if (navigator.userActivation?.hasBeenActive) setTimeout(maybeListen, 400);
    }
  });
  for (const e of ['mode', 'link']) ds.on(e, paintHeader);
  connectivity.on('change', () => { paintHeader(); alerts.setContext({ internet: connectivity.online }); });
  garage.on('change', () => { paintHeader(); refreshMaint(); });
  ctx.maint.on('change', refreshMaint);
  diag.on('scan', () => alerts.setContext({ dtc: ctx.currentDtcs() }));
  diag.on('cleared', () => alerts.setContext({ dtc: [] }));
  for (const e of ['mode']) ds.on(e, () => alerts.setContext({ dtc: [] }));
  engine.on('vehicle', () => {});
  garage.on('active', (v) => engine.setVehicle(v));
  garage.on('change', () => { engine.setVehicle(garage.active()); if (currentId === 'panel') route(); });
  engine.setVehicle(garage.active());
  settings.on('change', (path) => {
    if (path.startsWith('appearance.') || path.startsWith('layout.')) applyAppearance();
  });
  window.addEventListener('resize', applyOrientation);
  mq.addEventListener?.('change', applyAppearance);
  geo?.on('error', (e) => toast(e.message, 'warn'));

  /* ---------- laço principal ---------- */
  let n = 0;
  setInterval(() => {
    alerts.setContext({ obd: obd.status, simLinkUp: sim.linkUp });
    alerts.evaluate();
    trips.tick().catch(() => {});
    n++;
    if (n % 5 === 0) refreshMaint();
    for (const fn of tickers) safe(fn);
  }, 1000);

  applyAppearance();
  paintHeader();
  paintBell();
  await refreshMaint();
  route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !new URLSearchParams(location.search).has('nosw')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  window.__alma = window.__bolt = ctx;
  // a abertura fica na tela o tempo de os olhos acenderem
  const wait = Math.max(0, 1700 - (performance.now() - (window.__t0 || 0)));
  setTimeout(() => {
    document.getElementById('splash')?.classList.add('done');
    setTimeout(() => document.getElementById('splash')?.remove(), 600);
  }, wait);
}

import { ACCENTS as APP_ACCENTS } from './config.js';

/** Primeira abertura: o Jeep Renegade 2016 já vem cadastrado (uma vez só; se for excluído, não volta). */
async function seedGarage(db, garage) {
  try {
    if (await db.get('kv', 'seed.renegade')) return;
    if (!garage.list({ includeArchived: true }).length) {
      await garage.save({ nickname: 'Renegade', tech: { make: 'Jeep', model: 'Renegade', year: 2016, fuelType: 'flex', aspiration: 'natural' }, appearance: { silhouette: 'suv', color: '#2EE6D6' } });
    }
    await db.put('kv', { key: 'seed.renegade', value: true });
  } catch (err) {
    console.warn('Não foi possível cadastrar o veículo inicial', err);
  }
}

async function bootDb() {
  try {
    return await createDatabase();
  } catch (err) {
    console.warn('Armazenamento persistente indisponível', err);
    return createDatabase({ forceMemory: true });
  }
}

function openAlertsPanel(ctx) {
  const body = h('div', { class: 'alerts-panel' });
  const paint = () => {
    const list = ctx.alerts.list();
    clear(body);
    if (!list.length) body.append(h('div', { class: 'empty' }, ic('check', 28), h('p', {}, 'Nenhum alerta ativo.')));
    for (const a of list) {
      body.append(h('article', { class: `alert-item lvl-${a.level}` }, h('span', { class: 'ai-ico' }, ic(a.level === 'info' ? 'info' : 'alert', 20)), h('div', {}, h('strong', {}, a.title, a.simulated ? badge('SIMULAÇÃO', 'sim') : null), h('p', {}, a.message)), a.acknowledged ? h('small', { class: 'muted' }, 'Ciente') : h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => ctx.alerts.acknowledge(a.key) } }, 'Ciente')));
    }
  };
  const off = ctx.alerts.on('changed', paint);
  paint();
  return modal({ title: 'Alertas', icon: 'bell', size: 'md', body, onClose: () => off && off() });
}

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById('app');
  clear(root).append(h('div', { class: 'fatal' }, h('h1', {}, 'A Alma do Carro não pôde iniciar'), h('p', {}, err.message), h('p', { class: 'muted' }, 'Abra o arquivo no Chrome (ou pelo endereço do servidor). Veja o README.')));
  document.getElementById('splash')?.remove();
});
