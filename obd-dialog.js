/** Diálogo de conexão OBD2: escolha do adaptador, progresso, erros e desconexão. */
import { h, ic, badge, button, field, input, select, modal, toast, clear, segmented } from './ui.js';
import { friendlyObdError, ObdState } from './obd-manager.js';

export function openObdDialog(ctx) {
  const { obd, ds, settings } = ctx;
  const avail = obd.availability(window);
  let kind = settings.get('obd.preferred', 'ble');
  if (!avail.find((a) => a.kind === kind)?.supported && kind !== 'wifi') kind = avail.find((a) => a.supported)?.kind || 'wifi';
  let error = '';
  let connecting = false;

  const body = h('div', { class: 'obd-dialog' });
  const logBox = h('pre', { class: 'obd-log', 'aria-live': 'polite' });
  const paintLog = () => {
    logBox.textContent = obd.logLines.slice(-8).map((l) => `${new Date(l.ts).toLocaleTimeString('pt-BR')}  ${l.text}`).join('\n') || 'Sem eventos ainda.';
    logBox.scrollTop = logBox.scrollHeight;
  };

  function paint() {
    clear(body);
    const st = obd.status;
    const ready = st.state === ObdState.READY || st.state === ObdState.RECONNECTING;
    if (ds.mode === 'simulation') {
      body.append(h('div', { class: 'banner banner-sim' }, ic('lab', 18), h('span', {}, 'A simulação está ativa. Conectar um adaptador real encerra a simulação e descarta os dados simulados.')));
    }
    if (ready) {
      body.append(
        h('div', { class: 'conn-status ok' }, ic('check', 22), h('div', {}, h('strong', {}, st.state === ObdState.READY ? 'Conectado' : `Reconectando (tentativa ${st.reconnectAttempt})…`), h('small', {}, [st.adapterName, st.protocol, st.readsPerSec ? `${st.readsPerSec} leituras/s` : null].filter(Boolean).join(' · ')))),
        h('p', { class: 'muted' }, `${st.supportedPids.length} PIDs suportados pelo veículo. A Alma do Carro opera em modo somente leitura.`),
      );
    } else {
      body.append(h('div', { class: 'adapter-list', role: 'radiogroup' }, avail.map((a) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(kind === a.kind), disabled: !a.supported || connecting, class: `adapter ${kind === a.kind ? 'on' : ''}`, on: { click: () => { kind = a.kind; paint(); } } }, ic(a.icon, 22), h('div', {}, h('strong', {}, a.label), h('small', {}, a.supported ? a.description : a.reason)), a.supported ? null : badge('Indisponível', 'neutral')))));
      if (kind === 'wifi') {
        const mode = settings.get('obd.wifiMode', 'bridge');
        const wrap = h('div', { class: 'wifi-box' });
        const paintWifi = (m) => {
          clear(wrap).append(
            segmented([['bridge', 'Ponte local (server.js)'], ['websocket', 'WebSocket']], m, (v) => { settings.set('obd.wifiMode', v); paintWifi(v); }),
            m === 'bridge'
              ? h('div', { class: 'form-grid' }, field('IP do adaptador', input({ value: settings.get('obd.wifiHost'), placeholder: '192.168.0.10', on: { change: (e) => settings.set('obd.wifiHost', e.target.value.trim()) } })), field('Porta', input({ type: 'number', value: settings.get('obd.wifiPort'), on: { change: (e) => settings.set('obd.wifiPort', Number(e.target.value)) } })), field('URL da ponte (vazio = este servidor)', input({ value: settings.get('obd.bridgeUrl'), placeholder: 'http://192.168.1.20:8787', on: { change: (e) => settings.set('obd.bridgeUrl', e.target.value.trim()) } })), field('Token da ponte (se configurado)', input({ type: 'password', value: settings.get('obd.bridgeToken'), autocomplete: 'off', on: { change: (e) => settings.set('obd.bridgeToken', e.target.value) } })))
              : h('div', { class: 'form-grid' }, field('URL WebSocket', input({ value: settings.get('obd.wsUrl'), placeholder: 'ws://192.168.0.10:81', on: { change: (e) => settings.set('obd.wsUrl', e.target.value.trim()) } }))),
            h('small', { class: 'muted' }, 'Navegadores não abrem sockets TCP. A ponte (node server.js) deve rodar em um dispositivo que alcance o adaptador na mesma rede Wi-Fi.'),
          );
        };
        paintWifi(mode);
        body.append(wrap);
      }
      if (kind === 'ble') body.append(h('small', { class: 'muted' }, 'Só funciona com adaptadores ELM327 Bluetooth LE. Adaptadores Bluetooth clássicos (SPP) exigem o app nativo.'));
    }
    if (error) body.append(h('div', { class: 'banner banner-warn' }, ic('alert', 18), h('span', {}, error)));
    if (connecting || obd.logLines.length) body.append(logBox);
    paintLog();
  }

  async function connect() {
    error = '';
    connecting = true;
    settings.set('obd.preferred', kind);
    paint();
    footer();
    try {
      await ds.connectObd(kind);
      toast('OBD2 conectado.', 'ok');
      m.close();
    } catch (e) {
      error = friendlyObdError(e);
    }
    connecting = false;
    paint();
    footer();
  }

  const foot = h('div', { class: 'modal-foot-inner' });
  function footer() {
    const st = obd.status;
    const ready = st.state === ObdState.READY || st.state === ObdState.RECONNECTING;
    clear(foot).append(
      button({ label: 'Fechar', onClick: () => m.close() }),
      ready ? button({ label: 'Desconectar', icon: 'unlink', kind: 'danger', onClick: async () => { await ds.disconnectObd(); paint(); footer(); } }) : button({ label: connecting ? 'Conectando…' : 'Conectar', icon: 'link', kind: 'primary', disabled: connecting || !avail.find((a) => a.kind === kind)?.supported, onClick: connect }),
    );
  }

  const m = modal({ title: 'Conexão OBD2', icon: 'obd', size: 'md', body, actions: [foot], onClose: () => offs.forEach((o) => o()) });
  const offs = [obd.on('log', paintLog), obd.on('state', () => { paint(); footer(); })];
  paint();
  footer();
  return m;
}
