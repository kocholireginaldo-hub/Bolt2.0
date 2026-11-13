/** Laboratório: simulador completo (sempre identificado como SIMULAÇÃO). */
import { SCENARIOS } from './vehicle-simulator.js';
import { PARAMS } from './config.js';
import { DTC_DB } from './dtc-database.js';
import { h, ic, card, badge, button, toggle, segmented, select, field, toast, clear } from './ui.js';
import { fmtNum } from './utils.js';

export function mountLab(root, ctx) {
  const { sim, ds, connectivity } = ctx;
  const cleanups = [];
  const host = h('div', { class: 'view-lab' });
  root.append(host);
  let timer = 0;
  const live = {};

  function pedal(label, iconName, setter, key) {
    const b = h('button', { type: 'button', class: `pedal pedal-${key}`, 'aria-label': `${label} (segure)`, disabled: !sim.running });
    b.append(ic(iconName, 28), h('span', {}, label), h('small', {}, 'segure'));
    const down = (e) => { e.preventDefault(); setter(1); b.classList.add('on'); b.setPointerCapture?.(e.pointerId); };
    const up = () => { setter(0); b.classList.remove('on'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    return b;
  }

  const onKey = (e) => {
    if (!sim.running || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const on = e.type === 'keydown';
    if (e.key === 'ArrowUp') { sim.setThrottle(on ? 1 : 0); e.preventDefault(); }
    if (e.key === 'ArrowDown') { sim.setBrake(on ? 1 : 0); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  cleanups.push(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); });

  function render() {
    clear(host);
    const running = sim.running;
    const igni = running ? sim.getState().ignition : 'off';

    host.append(
      h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Laboratório'), h('p', {}, 'Simulador com o mesmo contrato de dados do OBD2 real. Nada aqui é enviado ao veículo.')), badge('SIMULAÇÃO', 'sim', 'lab')),
      h('div', { class: 'banner banner-sim' }, ic('lab', 18), h('span', {}, 'Os valores deste laboratório são fictícios e ficam separados dos dados reais (viagens, falhas e alertas são marcados como SIMULAÇÃO).')),
    );

    const master = card('Simulação', { iconName: 'power' },
      h('div', { class: 'lab-master' },
        button({ label: running ? 'Parar simulação' : 'Iniciar simulação', icon: running ? 'stop' : 'play', kind: running ? 'default' : 'primary', onClick: async () => { if (running) ds.stopSimulation(); else await ds.startSimulation(ctx.garage.active()); render(); } }),
        button({ label: igni === 'off' ? 'Partida' : 'Desligar motor', icon: 'power', kind: igni === 'off' ? 'primary' : 'danger', disabled: !running, onClick: () => { sim.setIgnition(igni === 'off'); render(); } }),
        h('small', { class: 'muted' }, running ? (igni === 'off' ? 'Motor desligado' : igni === 'cranking' ? 'Dando partida…' : 'Motor ligado') : 'Inicie a simulação para controlar o veículo.')),
      ctx.garage.active() ? h('small', { class: 'muted' }, `Perfil usado: ${ctx.garage.active().nickname} (cilindrada, rotação máxima, combustível, tanque).`) : h('small', { class: 'muted' }, 'Sem veículo cadastrado: usando perfil genérico 1.0 aspirado.'));

    const readout = h('div', { class: 'lab-readout' });
    for (const [id, label, unit] of [['speed', 'Velocidade', 'km/h'], ['rpm', 'Rotação', 'rpm'], ['gear', 'Marcha', ''], ['coolant', 'Motor', '°C'], ['load', 'Carga', '%'], ['battery', 'Bateria', 'V'], ['fuelPct', 'Combustível', '%'], ['fuelLph', 'Fluxo', 'L/h']]) {
      const v = h('strong', {}, '—');
      live[id] = { v, unit };
      readout.append(h('div', { class: 'stat' }, h('small', {}, label), v, unit ? h('span', {}, unit) : null));
    }
    const instruments = card('Instrumentos', { iconName: 'speed' }, readout);

    const throttleVal = h('output', {}, '0%');
    const slider = h('input', { type: 'range', min: 0, max: 100, value: 0, disabled: !running, class: 'range', 'aria-label': 'Acelerador', on: { input: (e) => { sim.setThrottle(e.target.value / 100); throttleVal.textContent = `${e.target.value}%`; } } });
    live.throttleSlider = slider;
    const controls = card('Pedais', { iconName: 'road' }, h('div', { class: 'pedals' }, pedal('Acelerador', 'chevron-up', (v) => { sim.setThrottle(v); slider.value = v * 100; throttleVal.textContent = `${v * 100}%`; }, 'gas'), pedal('Freio', 'brake', (v) => sim.setBrake(v), 'brake')), h('div', { class: 'slider-row' }, h('label', {}, 'Acelerador fino'), slider, throttleVal), h('small', { class: 'muted' }, 'Teclado: seta ↑ acelera, seta ↓ freia.'));

    const scenarios = card('Cenários automáticos', { iconName: 'play', actions: running && sim.scenarioName ? button({ label: 'Parar cenário', kind: 'ghost', size: 'sm', onClick: () => { sim.clearScenario(); render(); } }) : null },
      h('div', { class: 'scenario-grid' }, Object.entries(SCENARIOS).map(([id, s]) => h('button', { type: 'button', class: `scenario ${sim.scenarioName === id ? 'on' : ''}`, disabled: !running, on: { click: () => { sim.setScenario(id); render(); } } }, h('strong', {}, s.label), h('small', {}, s.description)))));

    const dtcSel = select(Object.entries(DTC_DB).map(([c, e]) => [c, `${c} — ${e.desc}`]), 'P0301');
    const dtcStatus = select([['confirmed', 'Confirmado'], ['pending', 'Pendente']], 'confirmed');
    const dtcList = h('div', { class: 'chips' }, sim.getState().dtcs.map((d) => badge(`${d.code} · ${d.status === 'pending' ? 'pendente' : 'confirmado'}`, d.status === 'pending' ? 'warn' : 'crit')));
    const faults = card('Falhas e conexão', { iconName: 'alert' },
      h('div', { class: 'pref-row' }, h('div', {}, h('strong', {}, 'Enlace OBD2 conectado'), h('small', {}, 'Desligar simula perda de comunicação (dados ficam desatualizados).')), toggle(sim.linkUp, (v) => { sim.setLink(v); }, '')),
      h('div', { class: 'pref-row' }, h('div', {}, h('strong', {}, 'Internet disponível'), h('small', {}, 'Desligar simula perda de internet (assistente passa a usar respostas locais).')), toggle(!connectivity.simulatedOffline, (v) => connectivity.setSimulatedOffline(!v))),
      h('div', { class: 'form-grid' }, field('Injetar código (DTC)', dtcSel), field('Situação', dtcStatus)),
      h('div', { class: 'row-actions' }, button({ label: 'Injetar', icon: 'plus', size: 'sm', disabled: !running, onClick: () => { sim.injectDtc(dtcSel.value, dtcStatus.value); render(); } }), button({ label: 'Limpar do simulador', size: 'sm', kind: 'ghost', disabled: !running, onClick: async () => { await sim.clearDtcs({ confirmed: true }); render(); } })),
      dtcList);

    const pidList = h('div', { class: 'pid-grid' });
    for (const [id, d] of Object.entries(PARAMS)) {
      if (!['speed', 'rpm', 'engineLoad', 'coolantTemp', 'intakeTemp', 'batteryVoltage', 'fuelLevel'].includes(id)) continue;
      pidList.append(h('label', { class: 'pid-opt' }, toggle(sim.supported.has(d.pid), (v) => sim.setPidSupported(d.pid, v)), h('span', {}, `${d.label} `, h('small', {}, `PID ${d.pid}`))));
    }
    const env = card('Ambiente e suporte de PIDs', { iconName: 'sliders' },
      h('div', { class: 'slider-row' }, h('label', {}, 'Combustível'), h('input', { type: 'range', min: 0, max: 100, value: Math.round(sim.fuelPct ?? sim.fuelPctDesired ?? 70), class: 'range', 'aria-label': 'Nível de combustível', on: { input: (e) => sim.setFuelPct(Number(e.target.value)) } })),
      h('div', { class: 'slider-row' }, h('label', {}, 'Temperatura ambiente'), h('input', { type: 'range', min: -10, max: 45, value: sim.s.ambient, class: 'range', 'aria-label': 'Temperatura ambiente', on: { input: (e) => sim.setAmbient(Number(e.target.value)) } })),
      h('p', { class: 'muted' }, 'Desmarque um PID para simular um veículo que não o fornece — o painel passa a indicá-lo como indisponível.'), pidList);

    host.append(h('div', { class: 'lab-grid' }, master, instruments, controls, scenarios, faults, env));
  }

  function refreshLive() {
    const s = sim.getState();
    const set = (id, v, d = 0) => { if (live[id]) live[id].v.textContent = v == null || !sim.running ? '—' : fmtNum(v, d); };
    set('speed', s.speed); set('rpm', s.rpm); set('gear', s.ignition === 'on' ? s.gear : null); set('coolant', s.coolant); set('load', s.load); set('battery', s.battery, 1); set('fuelPct', s.fuelPct, 1); set('fuelLph', s.fuelLph, 1);
  }

  render();
  timer = setInterval(refreshLive, 200);
  cleanups.push(() => clearInterval(timer), sim.on('dtc', render), sim.on('ignition', render), sim.on('scenario', render), sim.on('link', render), ds.on('mode', render));
  return { destroy: () => cleanups.forEach((c) => c && c()) };
}
