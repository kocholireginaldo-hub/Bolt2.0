/**
 * BOLT PERFORMANCE — cockpit principal.
 * Mesma assinatura da tela antiga (mountDashboard(root, ctx)) e MESMAS fontes de dados:
 * engine (OBD2 real ou Laboratório), alerts, trips, ds, connectivity, assistant, garage, settings.
 * Nenhum dado é criado aqui; tudo o que aparece vem desses serviços.
 */
import { PARAMS } from './config.js';
import { h, ic, button, formatValue, validityText, toggle, toast } from './ui.js';
import { createSportGauge } from './cockpit-gauge.js';
import { createVehicleStage } from './cockpit-stage.js';
import { createMascot, MASCOT_LABELS } from './mascot.js';
import { resolveLimits } from './alerts.js';
import { describeVehicle, engineSummary } from './garage.js';
import { resolveVehicleVisual } from './vehicle-catalog.js';
import { fmtNum, fmtDuration, fmtDistance } from './utils.js';
import { choosePhoto } from './photo.js';
import { greetingLine } from './alma-soul.js';

const NS = 'http://www.w3.org/2000/svg';
const HISTORY = 60;
const setText = (n, t) => { if (n.textContent !== t) n.textContent = t; };
const setData = (n, k, v) => { if (n.dataset[k] !== v) n.dataset[k] = v; };

/** Indicadores secundários. `range` só define a escala da barra (visual); `tone` é a cor do funcionamento normal. */
const METRICS = [
  { id: 'coolantTemp', icon: 'thermometer', label: 'Temp. motor', tone: 'blue', range: () => [40, 130] },
  { id: 'intakeTemp', icon: 'air', label: 'Temp. admissão', tone: 'cyan', range: () => [0, 80] },
  { id: 'engineLoad', icon: 'load', label: 'Carga do motor', tone: 'green', range: () => [0, 100] },
  { id: 'batteryVoltage', icon: 'battery', label: 'Tensão bateria', tone: 'blue', range: (k) => [10 * k, 15 * k] },
  { id: 'fuelLevel', icon: 'fuel', label: 'Combustível', tone: 'amber', range: () => [0, 100] },
];

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const pad = (n) => String(n).padStart(2, '0');

export function mountDashboard(root, ctx) {
  const { engine, settings, garage } = ctx;
  const cleanups = [];
  const history = new Map();
  const speedTrace = [];
  let raf = 0;
  let destroyed = false;

  const veh = garage.active();
  const lim = resolveLimits(veh);
  const explicitRedline = veh?.tech?.redlineRpm || veh?.tech?.limits?.redlineRpm || null;
  const k = lim.voltageScale || 1;

  /* ---------- mostradores ---------- */
  const speedMax = Number(settings.get('display.speedMax', 240));
  const speedG = createSportGauge({ label: 'Velocidade', unit: 'km/h', max: speedMax, major: 20, minorPerMajor: 2, labelEvery: 1, numClass: 'cg-speed' });
  // Faixa vermelha só com especificação do veículo (cadastro); sem ela a escala segue neutra.
  const rpmMax = Math.max(6, Math.ceil(((explicitRedline || lim.redlineRpm) + 500) / 1000)) * 1000;
  const rpmG = createSportGauge({
    label: 'Rotação', unit: 'RPM', max: rpmMax, major: 1000, minorPerMajor: 2, labelEvery: 1, labelDiv: 1000,
    redFrom: explicitRedline, warnFrom: explicitRedline ? Math.max(0, explicitRedline - 800) : null, footnote: 'x1000', numClass: 'cg-rpm',
    format: (v) => Math.round(v).toLocaleString('pt-BR'),
  });

  /* ---------- palco do veículo ---------- */
  const colorMap = () => settings.get('cockpit.colors', {}) || {};
  const stage = createVehicleStage({
    onPhoto: async () => {
      const v = garage.active();
      if (!v) { ctx.navigate('garage'); return; }
      try {
        const r = await choosePhoto();
        if (!r) return;
        await garage.save({ ...v, photo: r.dataUrl, photoAlpha: r.alpha });
        toast('Foto do veículo atualizada.', 'ok');
      } catch (err) {
        toast(err.message || 'Não foi possível usar esta foto.', 'warn');
      }
    },
    onPickColor: (c) => {
      const v = garage.active();
      if (v) settings.set('cockpit.colors', { ...colorMap(), [v.id]: c });
    },
  });
  const refreshStage = () => {
    const v = garage.active();
    stage.set(resolveVehicleVisual(v, v ? colorMap()[v.id] : null), v?.nickname || '');
  };

  /* ---------- cabeçalho ---------- */
  const menuBtn = h('button', { type: 'button', class: 'ck-ibtn ck-menu', 'aria-label': 'Recolher ou expandir a barra de navegação', on: { click: () => settings.set('layout.navCollapsed', !settings.get('layout.navCollapsed', false)) } }, h('i'), h('i'), h('i'));
  const logo = h('a', { class: 'ck-brand', href: '#/panel', 'aria-label': 'Alma do Carro' },
    (() => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 32');
      svg.setAttribute('class', 'ck-bolt');
      svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M15.5 1 3 18h8l-2.5 13L21 13h-8z');
      svg.append(p);
      return svg;
    })(),
    h('strong', {}, 'ALMA'), h('span', {}, 'DO CARRO'));

  const vMono = h('span', { class: 'ck-mono' });
  const vName = h('span', { class: 'ck-vname' });
  const vBtn = h('button', { type: 'button', class: 'ck-vsel', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, vMono, vName, ic('chevron-down', 18));
  const vMenu = h('div', { class: 'ck-vmenu', role: 'listbox', hidden: true });
  const closeMenu = () => { vMenu.hidden = true; vBtn.setAttribute('aria-expanded', 'false'); };
  const paintMenu = () => {
    vMenu.replaceChildren();
    const list = garage.list();
    if (!list.length) vMenu.append(h('p', { class: 'ck-vempty' }, 'Nenhum veículo cadastrado'));
    for (const v of list) {
      const on = v.id === garage.active()?.id;
      vMenu.append(h('button', { type: 'button', role: 'option', 'aria-selected': String(on), class: `ck-vopt${on ? ' on' : ''}`, on: { click: () => { closeMenu(); if (!on) garage.setActive(v.id).catch(() => {}); } } }, h('strong', {}, v.nickname), h('small', {}, describeVehicle(v))));
    }
    vMenu.append(h('button', { type: 'button', class: 'ck-vopt ck-vgarage', on: { click: () => { closeMenu(); ctx.navigate('garage'); } } }, ic('garage', 16), h('span', {}, 'Abrir Garagem')));
  };
  vBtn.addEventListener('click', () => {
    if (vMenu.hidden) { paintMenu(); vMenu.hidden = false; vBtn.setAttribute('aria-expanded', 'true'); } else closeMenu();
  });
  const onDocDown = (e) => { if (!vMenu.hidden && !vMenu.contains(e.target) && !vBtn.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('pointerdown', onDocDown);
  document.addEventListener('keydown', onKey);
  cleanups.push(() => { document.removeEventListener('pointerdown', onDocDown); document.removeEventListener('keydown', onKey); });
  const vWrap = h('div', { class: 'ck-vwrap' }, vBtn, vMenu);

  const connDot = h('i', { class: 'ck-dot' });
  const connMain = h('strong', {});
  const connSub = h('small', {});
  const connChip = h('button', { type: 'button', class: 'ck-chip ck-conn', 'aria-label': 'Conexão OBD2', on: { click: () => ctx.openObdDialog() } }, connDot, h('span', { class: 'ck-ctext' }, connMain, connSub));
  const netIco = h('span', { class: 'ck-netico' });
  const netTxt = h('small', {});
  const netChip = h('div', { class: 'ck-chip ck-net' }, netIco, netTxt);
  const bellCount = h('span', { class: 'ck-bellcount', hidden: true });
  const bell = h('button', { type: 'button', class: 'ck-ibtn ck-bell', 'aria-label': 'Alertas', on: { click: () => ctx.openAlertsPanel() } }, ic('bell', 22), bellCount);
  const gear = h('button', { type: 'button', class: 'ck-ibtn ck-gear', 'aria-label': 'Configurações', on: { click: () => ctx.navigate('settings') } }, ic('settings', 22));
  const standbyHead = h('button', { type: 'button', class: 'ck-ibtn ck-standby-h', 'aria-label': 'Modo espera do Bolt', title: 'Modo espera', on: { click: () => ctx.standby?.enter() } }, ic('moon', 22));
  const clockT = h('strong', {});
  const clockD = h('small', {});
  const clock = h('div', { class: 'ck-clock', 'aria-hidden': 'true' }, clockT, clockD);
  const simTag = h('span', { class: 'ck-simtag', hidden: true }, 'SIMULAÇÃO');
  const header = h('header', { class: 'ck-header' }, menuBtn, logo, vWrap, h('span', { class: 'ck-sp' }), simTag, connChip, netChip, bell, standbyHead, gear, clock);

  /* ---------- indicadores ---------- */
  const tiles = {};
  const makeTile = (m) => {
    const num = h('span', { class: 'ck-num' }, '—');
    const unit = h('span', { class: 'ck-unit' }, m.unit ?? PARAMS[m.id]?.unit ?? '');
    const sub = h('span', { class: 'ck-sub' });
    const fill = h('i');
    const el = h('article', { class: 'ck-tile', dataset: { tone: m.tone, param: m.id } },
      h('span', { class: 'ck-ico' }, ic(m.icon, 26)),
      h('div', { class: 'ck-tbody' }, h('span', { class: 'ck-label' }, m.label, h('b', { class: 'src-tag ck-src' }, 'SIM')), h('div', { class: 'ck-val' }, num, unit), sub),
      m.id === 'consumption' ? null : h('div', { class: 'ck-bar' }, fill));
    tiles[m.id] = { el, num, unit, sub, fill, m };
    return el;
  };
  const tileEls = [...METRICS, { id: 'consumption', icon: 'drop', label: 'Consumo inst.', tone: 'violet', unit: 'L/h' }].map(makeTile);

  /* ---------- cartões inferiores ---------- */
  const alTitle = h('strong', {});
  const alCount = h('span', { class: 'ck-alcount' });
  const alMsg = h('span', { class: 'ck-almsg' });
  const alIco = h('span', { class: 'ck-alico' }, ic('alert', 24));
  const alertCard = h('button', { type: 'button', class: 'ck-card ck-alerts', on: { click: () => ctx.openAlertsPanel() } }, h('div', { class: 'ck-cardhd' }, h('span', {}, 'Alertas'), alCount), h('div', { class: 'ck-albody' }, alIco, h('div', { class: 'ck-altext' }, alTitle, alMsg), ic('chevron-right', 18)));

  const vcName = h('strong', {});
  const vcSub = h('span', {});
  const vcMono = h('span', { class: 'ck-mono ck-mono-lg' });
  const vehicleCard = h('button', { type: 'button', class: 'ck-card ck-vehicle', on: { click: () => ctx.navigate('garage') } }, h('div', { class: 'ck-cardhd' }, h('span', {}, 'Veículo selecionado')), h('div', { class: 'ck-vcbody' }, vcMono, h('div', { class: 'ck-vctext' }, vcName, vcSub)));

  const tripDist = h('strong', {}, '—');
  const tripTime = h('strong', {}, '—');
  const tripAvg = h('small', {});
  const tripFuel = h('small', {});
  const traceSvg = document.createElementNS(NS, 'svg');
  traceSvg.setAttribute('viewBox', '0 0 100 40');
  traceSvg.setAttribute('preserveAspectRatio', 'none');
  traceSvg.setAttribute('class', 'ck-trace');
  traceSvg.setAttribute('aria-hidden', 'true');
  const traceLine = document.createElementNS(NS, 'polyline');
  traceLine.setAttribute('fill', 'none');
  traceSvg.append(traceLine);
  const tripIdle = h('p', { class: 'ck-tripidle' });
  const tripBtn = h('span', { class: 'ck-tripbtn' });
  const tripLive = h('div', { class: 'ck-triplive' }, h('div', { class: 'ck-tripnums' }, tripDist, tripTime, tripAvg, tripFuel), traceSvg);
  const tripCard = h('div', { class: 'ck-card ck-trip' }, h('div', { class: 'ck-cardhd' }, h('span', {}, 'Viagem atual'), tripBtn), tripLive, tripIdle);

  const simState = h('span', { class: 'ck-simstate' });
  const simNote = h('small', {});
  const simCard = h('button', { type: 'button', class: 'ck-card ck-sim', on: { click: () => ctx.navigate('lab') } }, h('div', { class: 'ck-cardhd' }, h('span', {}, 'Modo de simulação'), simState), simNote);

  /* ---------- assistente ---------- */
  const mascot = createMascot({ size: 112, state: ctx.assistant.enabled ? ctx.assistant.state : 'normal' });
  const mascotBtn = h('button', { type: 'button', class: 'ck-mascot', 'aria-label': 'Abrir o assistente', on: { click: () => ctx.widget?.toggle() } }, mascot);
  const bubbleTxt = h('span', {});
  const bubble = h('div', { class: 'ck-bubble' }, bubbleTxt);
  const asst = h('aside', { class: 'ck-asst' }, mascotBtn, bubble, h('div', { class: 'ck-asstsw' }, toggle(ctx.assistant.enabled, (v) => settings.set('assistant.enabled', v), 'Assistente')), button({ label: 'Modo espera', icon: 'moon', size: 'sm', kind: 'ghost', onClick: () => ctx.standby?.enter() }));
  const asstSwitch = asst.querySelector('.ck-asstsw');

  const banner = !veh
    ? h('div', { class: 'ck-banner' }, ic('garage', 18), h('span', {}, 'Nenhum veículo cadastrado. Limites de alerta e consumo dependem do perfil do veículo.'), button({ label: 'Cadastrar na Garagem', kind: 'primary', size: 'sm', onClick: () => ctx.navigate('garage') }))
    : null;

  const cockpit = h('div', { class: 'cockpit' },
    header, banner,
    h('div', { class: 'ck-main' }, h('div', { class: 'ck-speed' }, speedG.el), h('div', { class: 'ck-stagewrap' }, stage.el), h('div', { class: 'ck-rpm', title: explicitRedline ? '' : 'Linha vermelha não informada no cadastro do veículo' }, rpmG.el), asst),
    h('div', { class: 'ck-metrics' }, tileEls),
    h('div', { class: 'ck-info' }, alertCard, vehicleCard, tripCard, simCard));
  root.append(cockpit);

  /* ---------- atualização ---------- */
  const alertLevels = () => {
    const map = {};
    for (const a of ctx.alerts.list()) if (a.paramId) map[a.paramId] = a.level;
    return map;
  };

  const renderClock = () => {
    const d = new Date();
    setText(clockT, `${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setText(clockD, `${WEEK[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}`);
  };

  const renderStatus = () => {
    const ls = ctx.ds.linkStatus();
    const sim = !!ls.simulated || engine.source === 'simulation';
    const tone = sim ? 'sim' : { ready: 'ok', connecting: 'info', initializing: 'info', reconnecting: 'warn', error: 'crit', idle: 'off' }[ls.state] || 'off';
    setData(connChip, 'tone', tone);
    setText(connMain, sim ? 'Laboratório' : ls.state === 'ready' ? 'Conectado' : ls.label);
    setText(connSub, sim ? 'dados simulados' : ls.state === 'ready' ? 'OBD2' : ls.state === 'idle' ? 'OBD2' : ls.detail || 'OBD2');
    simTag.hidden = !sim;
    const online = ctx.connectivity.online;
    netIco.replaceChildren(ic(online ? 'globe' : 'globe-off', 22));
    setText(netTxt, online ? 'Online' : 'Offline');
    setData(netChip, 'on', online ? '1' : '0');

    const list = ctx.alerts.list();
    const counts = { critical: 0, attention: 0, info: 0 };
    for (const a of list) counts[a.level]++;
    const lvl = counts.critical ? 'critical' : counts.attention ? 'attention' : list.length ? 'info' : 'ok';
    if (alertCard.dataset.level !== lvl) alIco.replaceChildren(ic(lvl === 'ok' ? 'shield' : 'alert', 24));
    setData(alertCard, 'level', lvl);
    setData(bell, 'level', lvl === 'ok' ? '' : lvl);
    const unack = list.filter((a) => !a.acknowledged).length;
    bellCount.hidden = !unack;
    setText(bellCount, String(unack));
    const top = list[0];
    setText(alCount, list.length ? `${list.length} ${list.length > 1 ? 'ativos' : 'ativo'}` : 'Tudo normal');
    setText(alTitle, top ? top.title : 'Nenhum alerta no momento');
    setText(alMsg, top ? (top.message || '').split('(')[0].trim() : 'Monitoramento local ativo');

    const on = ctx.assistant.enabled;
    mascot.setState(on ? ctx.assistant.state : 'normal');
    mascot.classList.toggle('is-off', !on);
    const who = (settings.get('driver.name', '') || '').trim();
    let msg;
    if (!on) msg = 'Assistente desligado. O monitoramento segue ativo.';
    else if (ctx.assistant.state !== 'normal' && ctx.assistant.state !== 'sleeping') msg = `${MASCOT_LABELS[ctx.assistant.state]}…`;
    else if (counts.critical || counts.attention) msg = `Atenção${who ? `, ${who}` : ''}: ${top.title}.`;
    else if (lastSoulLine()) msg = lastSoulLine();
    else if (ctx.assistant.state === 'sleeping') msg = greetingLine(ctx.assistant.tone, who || 'amigo', false);
    else msg = greetingLine(ctx.assistant.tone, who || 'amigo', true);
    setText(bubbleTxt, msg);
    const sw = asstSwitch.querySelector('input');
    if (sw && sw.checked !== on) sw.checked = on;

    const sv = garage.active();
    setText(vName, sv ? sv.nickname : 'Sem veículo');
    setText(vMono, (sv?.tech?.make || 'B').trim().charAt(0).toUpperCase());
    setText(vcMono, (sv?.tech?.make || 'B').trim().charAt(0).toUpperCase());
    setText(vcName, sv ? sv.nickname : 'Sem veículo');
    setText(vcSub, sv ? `Ano: ${sv.tech.year} · ${engineSummary(sv)}` : 'Cadastre na Garagem');

    setText(simState, sim ? 'ON' : 'OFF');
    setData(simCard, 'on', sim ? '1' : '0');
    setText(simNote, sim ? 'SIMULAÇÃO — dados fictícios' : 'Sistema em modo real');
  };

  // a última fala da alma fica no balão por alguns segundos
  const lastSoulLine = () => {
    const m = ctx.assistant.messages[ctx.assistant.messages.length - 1];
    if (!m || m.role !== 'assistant' || Date.now() - m.ts > 25000) return '';
    const t = String(m.text).split('\n')[0].replace(/\(IA indisponível[^)]*\)/, '').trim();
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  };

  const render = () => {
    raf = 0;
    if (destroyed) return;
    const lv = alertLevels();
    const sp = engine.get('speed');
    const spOk = sp.validity === 'valid' || sp.validity === 'stale';
    speedG.update(spOk ? sp.value : null, { validity: sp.validity, note: validityText(sp) });
    const rp = engine.get('rpm');
    const rpOk = rp.validity === 'valid' || rp.validity === 'stale';
    rpmG.update(rpOk ? rp.value : null, { validity: rp.validity, note: validityText(rp) || (rpOk && !explicitRedline ? 'Linha vermelha não informada' : '') });

    for (const m of METRICS) {
      const t = tiles[m.id];
      const rec = engine.get(m.id);
      setText(t.num, formatValue(rec));
      setText(t.sub, validityText(rec));
      setData(t.el, 'validity', rec.validity);
      setData(t.el, 'level', lv[m.id] || '');
      let frac = 0;
      if (rec.value != null && rec.validity !== 'unsupported' && rec.validity !== 'unavailable') {
        const [lo, hi] = m.range(k);
        frac = Math.max(0, Math.min(1, (rec.value - lo) / (hi - lo)));
      }
      const w = `${(frac * 100).toFixed(0)}%`;
      if (t.fill.style.width !== w) t.fill.style.width = w;
    }

    const unit = settings.get('display.consumptionUnit', 'kml');
    const f = engine.fuel();
    const c = tiles.consumption;
    const methodText = f.method === 'load' ? 'pela carga do motor' : f.method === 'maf' ? 'pelo fluxo de ar (MAF)' : f.method === 'fuelRate' ? 'taxa informada pela ECU' : '';
    if (f.flowLph == null) {
      setText(c.num, '—');
      setText(c.unit, unit === 'kml' ? 'km/L' : 'L/100 km');
      setText(c.sub, engine.source === 'none' ? 'Aguardando fonte de dados' : 'Dados insuficientes');
    } else if (f.instantKmL == null) {
      setText(c.num, fmtNum(f.flowLph, 1));
      setText(c.unit, 'L/h');
      setText(c.sub, `estimado ${methodText}`);
    } else {
      setText(c.num, unit === 'kml' ? fmtNum(f.instantKmL, 1) : fmtNum(f.instantL100, 1));
      setText(c.unit, unit === 'kml' ? 'km/L' : 'L/100 km');
      setText(c.sub, `estimado ${methodText}`);
    }

    const t = ctx.trips.summary();
    tripCard.dataset.active = t.active ? '1' : '0';
    if (!t.active) {
      setText(tripIdle, engine.source === 'none' ? 'Conecte o OBD2 ou ative a simulação para registrar viagens.' : settings.get('trips.autoRecord', true) ? 'A viagem começa automaticamente ao sair do lugar.' : 'Gravação automática desligada.');
      if (!tripBtn.firstChild && engine.source !== 'none') tripBtn.append(button({ label: 'Iniciar', icon: 'play', kind: 'primary', size: 'sm', onClick: () => { try { ctx.trips.start({ manual: true }); } catch { /* sem fonte */ } schedule(); } }));
      if (engine.source === 'none' && tripBtn.firstChild) tripBtn.replaceChildren();
      tripBtn.dataset.mode = 'start';
    } else {
      setText(tripDist, fmtDistance(t.distanceKm));
      setText(tripTime, fmtDuration(t.totalSec));
      setText(tripAvg, `Vel. média ${fmtNum(t.avgSpeedKmh, 0)} km/h`);
      setText(tripFuel, t.fuelL ? `${fmtNum(t.fuelL, 2)} L (estimado)` : '');
      if (tripBtn.dataset.mode !== 'stop' || !tripBtn.firstChild) {
        tripBtn.replaceChildren(button({ label: 'Encerrar', icon: 'stop', kind: 'default', size: 'sm', onClick: () => ctx.trips.stop() }));
        tripBtn.dataset.mode = 'stop';
      }
      if (spOk && sp.validity === 'valid') {
        speedTrace.push(sp.value);
        while (speedTrace.length > HISTORY) speedTrace.shift();
      }
      if (speedTrace.length > 1) {
        const hi = Math.max(40, ...speedTrace);
        traceLine.setAttribute('points', speedTrace.map((v, i) => `${((i / (HISTORY - 1)) * 100).toFixed(1)},${(38 - (v / hi) * 34).toFixed(1)}`).join(' '));
      }
    }
  };

  const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(render); };

  renderClock();
  renderStatus();
  refreshStage();
  render();

  cleanups.push(engine.on('update', schedule), engine.on('validity', schedule), engine.on('reset', schedule), engine.on('support', schedule));
  cleanups.push(ctx.ds.on('link', renderStatus), ctx.alerts.on('changed', () => { renderStatus(); schedule(); }), ctx.connectivity.on('change', renderStatus), ctx.assistant.on('state', renderStatus));
  cleanups.push(settings.on('change', (p) => {
    if (p.startsWith('assistant.enabled') || p.startsWith('driver.')) renderStatus();
    else if (p.startsWith('cockpit.colors')) refreshStage();
    else schedule();
  }));
  cleanups.push(ctx.onTick(() => { renderClock(); renderStatus(); schedule(); }));
  cleanups.push(ctx.trips.on('started', schedule), ctx.trips.on('stopped', schedule));

  return {
    destroy() {
      destroyed = true;
      cleanups.forEach((c) => c && c());
      if (raf) cancelAnimationFrame(raf);
      speedG.destroy();
      rpmG.destroy();
      stage.destroy();
    },
  };
}
