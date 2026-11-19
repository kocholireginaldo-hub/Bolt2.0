/** Garagem: múltiplos veículos, identificação técnica separada da aparência. */
import { FUEL_TYPES, ASPIRATIONS, TRANSMISSIONS, suggestedLimits } from './config.js';
import { SILHOUETTES, SILHOUETTE_IDS, silhouette } from './silhouettes.js';
import { blankVehicle, normalizeVehicle, currentOdometer, describeVehicle, engineSummary } from './garage.js';
import { h, ic, card, badge, button, iconButton, field, input, select, textarea, modal, tabs, toast, confirmDialog, emptyState, clear, guardMotion } from './ui.js';
import { fmtNum, fmtDate } from './utils.js';
import { choosePhoto } from './photo.js';

const COLORS = ['#2EE6D6', '#5AA9FF', '#B79CFF', '#FF8FB1', '#FF5C5C', '#FFA62B', '#F5D547', '#9BE564', '#E8F1F8', '#8896A5', '#2A3441'];

export function mountGarage(root, ctx) {
  const { garage } = ctx;
  const cleanups = [];
  const host = h('div', { class: 'view-garage' });
  root.append(host);
  let showArchived = false;

  async function render() {
    const trips = await ctx.db.all('trips');
    const active = garage.active();
    clear(host);
    const list = garage.list();
    host.append(
      h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Garagem'), h('p', {}, 'Seus veículos, perfis técnicos e histórico.')), button({ label: 'Adicionar veículo', icon: 'plus', kind: 'primary', onClick: () => openForm() })),
    );
    if (!list.length) {
      host.append(emptyState('garage', 'Nenhum veículo ainda', 'Cadastre seu primeiro veículo. A marca, o motor e os limites alimentam os alertas e a estimativa de consumo.', button({ label: 'Cadastrar veículo', icon: 'plus', kind: 'primary', onClick: () => openForm() })));
    } else {
      host.append(h('div', { class: 'vehicle-grid' }, list.map((v) => vehicleCard(v, v.id === active?.id, trips))));
    }
    const archived = garage.list({ includeArchived: true }).filter((v) => v.archived);
    if (archived.length) {
      host.append(
        h('div', { class: 'archived' }, button({ label: `${showArchived ? 'Ocultar' : 'Mostrar'} arquivados (${archived.length})`, kind: 'ghost', size: 'sm', onClick: () => { showArchived = !showArchived; render(); } })),
        showArchived ? h('div', { class: 'vehicle-grid' }, archived.map((v) => vehicleCard(v, false, trips))) : null,
      );
    }
    if (active) host.append(await historyCard(active));
  }

  function vehicleCard(v, isActive, trips) {
    const odo = currentOdometer(v, trips);
    const real = trips.filter((t) => t.vehicleId === v.id && t.origin === 'obd').length;
    return h(
      'article',
      { class: `vehicle-card ${isActive ? 'is-active' : ''} ${v.archived ? 'is-archived' : ''}`.trim() },
      h('div', { class: 'vehicle-art' }, v.photo ? h('img', { class: 'vehicle-photo', src: v.photo, alt: `Foto de ${v.nickname}` }) : silhouette(v.appearance.silhouette, v.appearance.color, { width: 200 }), isActive ? badge('Ativo', 'ok', 'check') : null, v.archived ? badge('Arquivado', 'neutral') : null),
      h('div', { class: 'vehicle-info' }, h('h3', {}, v.nickname), h('p', {}, describeVehicle(v)), h('small', {}, engineSummary(v)), h('div', { class: 'vehicle-meta' }, h('span', {}, ic('road', 14), odo != null ? `${fmtNum(odo, 0)} km` : 'km não informada'), h('span', {}, ic('trips', 14), `${real} viagem${real === 1 ? '' : 's'} real${real === 1 ? '' : 'is'}`))),
      h(
        'div',
        { class: 'vehicle-actions' },
        !isActive && !v.archived ? button({ label: 'Usar', kind: 'primary', size: 'sm', onClick: async () => { await garage.setActive(v.id); toast(`${v.nickname} é o veículo ativo.`, 'ok'); } }) : null,
        iconButton('edit', 'Editar', () => openForm(v)),
        iconButton('tag', 'Atualizar quilometragem', () => openOdometer(v)),
        v.archived ? button({ label: 'Restaurar', kind: 'ghost', size: 'sm', onClick: () => garage.setArchived(v.id, false) }) : iconButton('database', 'Arquivar (mantém o histórico)', () => archive(v)),
        iconButton('trash', 'Excluir definitivamente', () => remove(v)),
      ),
    );
  }

  async function historyCard(v) {
    const [trips, services, dtcs] = await Promise.all([ctx.db.where('trips', (t) => t.vehicleId === v.id), ctx.db.where('services', (s) => s.vehicleId === v.id), ctx.db.where('dtcHistory', (d) => d.vehicleId === v.id && d.kind === 'code')]);
    const real = trips.filter((t) => t.origin === 'obd');
    const sim = trips.filter((t) => t.origin === 'simulation');
    const km = real.reduce((s, t) => s + t.distanceKm, 0);
    const stat = (l, val, sub) => h('div', { class: 'stat' }, h('small', {}, l), h('strong', {}, val), sub ? h('span', {}, sub) : null);
    return card(`Histórico — ${v.nickname}`, { iconName: 'history', cls: 'history-card' }, h('div', { class: 'stats-row' }, stat('Viagens reais', String(real.length), `${fmtNum(km, 1)} km registrados`), stat('Viagens simuladas', String(sim.length), 'separadas das reais'), stat('Serviços', String(services.length)), stat('Códigos de falha', String(dtcs.filter((d) => d.origin === 'obd').length), 'registros reais')), h('small', { class: 'muted' }, `Cadastro em ${fmtDate(v.createdAt)}. Dados reais e simulados nunca se misturam.`));
  }

  function openOdometer(v) {
    if (!guardMotion(ctx)) return;
    const inp = input({ type: 'number', min: 0, step: 1, value: v.tech.odometerKm ?? '', placeholder: 'km atual' });
    const m = modal({
      title: 'Atualizar quilometragem',
      icon: 'road',
      size: 'sm',
      body: [h('p', {}, 'Informe a quilometragem do painel. A estimativa passa a somar apenas viagens reais gravadas a partir de agora.'), field('Quilometragem (km)', inp)],
      actions: [button({ label: 'Cancelar', onClick: () => m.close() }), button({ label: 'Salvar', kind: 'primary', onClick: async () => { try { await garage.updateOdometer(v.id, inp.value); m.close(); toast('Quilometragem atualizada.', 'ok'); } catch (e) { toast(e.message, 'error'); } } })],
    });
  }

  async function archive(v) {
    const ok = await confirmDialog({ title: 'Arquivar veículo?', message: `${v.nickname} deixa de aparecer na lista, mas todo o histórico (viagens, serviços, falhas) é mantido e pode ser restaurado.`, confirmLabel: 'Arquivar', icon: 'database' });
    if (ok) await garage.setArchived(v.id, true);
  }

  async function remove(v) {
    if (!guardMotion(ctx)) return;
    const ok = await confirmDialog({ title: 'Excluir definitivamente?', message: `Isto apaga ${v.nickname} e TODO o histórico local dele (viagens, serviços, agenda e falhas). Não há como desfazer. Considere exportar um backup antes (Configurações → Dados).`, confirmLabel: 'Excluir', danger: true, requireText: 'EXCLUIR' });
    if (ok) {
      await garage.remove(v.id);
      toast('Veículo excluído.', 'ok');
    }
  }

  function openForm(existing = null) {
    if (!guardMotion(ctx)) return;
    const draft = existing ? structuredClone(existing) : blankVehicle();
    draft.tech.limits = { coolantWarn: null, coolantCrit: null, intakeWarn: null, ...(draft.tech.limits || {}) };
    let errors = {};
    let tab = 'tech';
    const body = h('div', { class: 'vehicle-form' });
    const tabBar = tabs([['tech', 'Identificação técnica', 'engine'], ['look', 'Aparência', 'palette'], ['limits', 'Limites de alerta', 'alert']], tab, (t) => { tab = t; paint(); });

    const bind = (obj, key, type = 'text', props = {}) => {
      const i = input({ type, value: obj[key] ?? '', ...props, on: { input: (e) => { obj[key] = type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value; if (key === 'fuelType') paint(); } } });
      return i;
    };
    const bindSel = (obj, key, options) => select(options, obj[key], { on: { change: (e) => { obj[key] = e.target.value; if (key === 'fuelType' || key === 'aspiration') paint(); } } });

    function paint() {
      clear(body);
      const t = draft.tech;
      const sug = suggestedLimits(t);
      if (tab === 'tech') {
        body.append(
          h('p', { class: 'form-intro' }, 'Dados técnicos usados em alertas, consumo e diagnóstico. Preencha conforme o manual do veículo.'),
          h('div', { class: 'form-grid' },
            field('Marca *', bind(t, 'make', 'text', { autofocus: true, placeholder: 'Ex.: Fiat' }), { error: errors.make }),
            field('Modelo *', bind(t, 'model', 'text', { placeholder: 'Ex.: Argo' }), { error: errors.model }),
            field('Ano *', bind(t, 'year', 'number', { min: 1950, max: 2100 }), { error: errors.year }),
            field('Versão / motor', bind(t, 'version', 'text', { placeholder: 'Ex.: 1.0 Firefly' })),
            field('Cilindrada (L)', bind(t, 'displacementL', 'number', { step: 0.1, min: 0.2, placeholder: '1.0' }), { error: errors.displacementL, hint: 'Necessária para estimar o consumo.' }),
            field('Cilindros', bind(t, 'cylinders', 'number', { min: 1, max: 16 }), { error: errors.cylinders }),
            field('Combustível', bindSel(t, 'fuelType', Object.entries(FUEL_TYPES).map(([k, v]) => [k, v.label])), { error: errors.fuelType }),
            field('Aspiração', bindSel(t, 'aspiration', Object.entries(ASPIRATIONS))),
            field('Câmbio', bindSel(t, 'transmission', Object.entries(TRANSMISSIONS))),
            field('Tanque (L)', bind(t, 'tankL', 'number', { min: 5, step: 1 }), { error: errors.tankL }),
            field('Rotação máxima / faixa vermelha (rpm)', bind(t, 'redlineRpm', 'number', { min: 2000, step: 100, placeholder: String(sug.redlineRpm) }), { error: errors.redlineRpm, hint: `Vazio = sugestão inicial (${sug.redlineRpm} rpm). Confirme no manual.` }),
            field('Tensão do sistema elétrico', select([['12', '12 V'], ['24', '24 V']], String(t.systemVoltage), { on: { change: (e) => (t.systemVoltage = Number(e.target.value)) } })),
            field('Quilometragem atual (km)', bind(t, 'odometerKm', 'number', { min: 0 }), { error: errors.odometerKm }),
            field('Placa', bind(t, 'plate', 'text', { placeholder: 'ABC1D23', maxlength: 8 }), { hint: 'Fica só neste dispositivo; nunca vai para a IA.' }),
            field('VIN / chassi', bind(t, 'vin', 'text', { maxlength: 17 }), { error: errors.vin, hint: 'Opcional. Nunca é enviado à IA.' }),
            FUEL_TYPES[t.fuelType]?.afr ? field('Razão ar/combustível de referência (avançado)', bind(t, 'afrOverride', 'number', { step: 0.1, placeholder: String(FUEL_TYPES[t.fuelType].afr) }), { hint: 'Só altera a ESTIMATIVA de consumo.' }) : null,
          ),
        );
      } else if (tab === 'look') {
        const preview = h('div', { class: 'look-preview' });
        const drawPreview = () => clear(preview).append(draft.photo ? h('img', { class: 'vehicle-photo', src: draft.photo, alt: 'Foto do veículo' }) : silhouette(draft.appearance.silhouette, draft.appearance.color, { width: 280 }));
        drawPreview();
        const photoRow = h('div', { class: 'photo-row' },
          button({ label: draft.photo ? 'Trocar foto' : 'Enviar foto do veículo', icon: 'upload', kind: 'primary', size: 'sm', onClick: async () => {
            try {
              const r = await choosePhoto();
              if (!r) return;
              draft.photo = r.dataUrl;
              draft.photoAlpha = r.alpha;
              paint();
            } catch (err) { toast(err.message || 'Não foi possível usar esta foto.', 'warn'); }
          } }),
          draft.photo ? button({ label: 'Remover foto', kind: 'ghost', size: 'sm', onClick: () => { delete draft.photo; delete draft.photoAlpha; paint(); } }) : null,
          h('small', { class: 'muted' }, 'A foto aparece no painel, no palco do veículo. Fica só neste dispositivo.'));
        const pick = h('div', { class: 'sil-grid' });
        const drawPick = () => {
          clear(pick);
          for (const id of SILHOUETTE_IDS) {
            pick.append(h('button', { type: 'button', class: `sil-opt ${draft.appearance.silhouette === id ? 'on' : ''}`, 'aria-label': SILHOUETTES[id].label, 'aria-pressed': String(draft.appearance.silhouette === id), on: { click: () => { draft.appearance.silhouette = id; drawPick(); drawPreview(); } } }, silhouette(id, draft.appearance.color, { width: 96 }), h('span', {}, SILHOUETTES[id].label)));
          }
        };
        drawPick();
        const swatches = h('div', { class: 'swatches' });
        const drawSw = () => {
          clear(swatches);
          for (const c of COLORS) swatches.append(h('button', { type: 'button', class: `swatch ${draft.appearance.color.toLowerCase() === c.toLowerCase() ? 'on' : ''}`, style: { background: c }, 'aria-label': `Cor ${c}`, on: { click: () => { draft.appearance.color = c; drawSw(); drawPick(); drawPreview(); } } }));
          swatches.append(h('input', { type: 'color', class: 'swatch-input', value: draft.appearance.color, 'aria-label': 'Cor personalizada', on: { input: (e) => { draft.appearance.color = e.target.value; drawPick(); drawPreview(); } } }));
        };
        drawSw();
        body.append(h('p', { class: 'form-intro' }, 'A aparência é apenas visual e não afeta a identificação técnica.'), preview, photoRow, field('Silhueta', pick), field('Cor', swatches), field('Apelido', input({ value: draft.nickname, placeholder: 'Como você chama este veículo', on: { input: (e) => (draft.nickname = e.target.value) } })), field('Observações', textarea({ value: draft.notes || '', on: { input: (e) => (draft.notes = e.target.value) } })));
      } else {
        const L = draft.tech.limits;
        body.append(
          h('p', { class: 'form-intro' }, `Os alertas usam os limites deste veículo. Campos vazios usam a sugestão inicial para ${FUEL_TYPES[t.fuelType]?.label.toLowerCase()} ${t.aspiration === 'turbo' ? 'turbo' : 'aspirado'} — são apenas pontos de partida: ajuste conforme o manual.`),
          h('div', { class: 'form-grid' },
            field('Temperatura do motor — atenção (°C)', bind(L, 'coolantWarn', 'number', { placeholder: String(sug.coolantWarn) })),
            field('Temperatura do motor — crítico (°C)', bind(L, 'coolantCrit', 'number', { placeholder: String(sug.coolantCrit) }), { error: errors.coolantCrit }),
            field('Ar de admissão — atenção (°C)', bind(L, 'intakeWarn', 'number', { placeholder: String(sug.intakeWarn) })),
          ),
        );
      }
    }
    paint();

    const m = modal({
      title: existing ? 'Editar veículo' : 'Novo veículo',
      icon: 'car',
      size: 'lg',
      body: [tabBar, body],
      actions: [
        button({ label: 'Cancelar', onClick: () => m.close() }),
        button({
          label: existing ? 'Salvar alterações' : 'Cadastrar',
          kind: 'primary',
          onClick: async () => {
            const { errors: e } = normalizeVehicle(draft);
            if (Object.keys(e).length) {
              errors = e;
              if (e.make || e.model || e.year || e.displacementL || e.cylinders || e.tankL || e.redlineRpm || e.odometerKm || e.vin || e.fuelType) tab = 'tech';
              else tab = 'limits';
              tabBar.replaceWith((tabBarRef.el = tabs([['tech', 'Identificação técnica', 'engine'], ['look', 'Aparência', 'palette'], ['limits', 'Limites de alerta', 'alert']], tab, (t) => { tab = t; paint(); })));
              paint();
              toast('Corrija os campos destacados.', 'warn');
              return;
            }
            try {
              const saved = await garage.save(draft);
              m.close();
              toast(`${saved.nickname} salvo.`, 'ok');
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        }),
      ],
    });
    const tabBarRef = { el: tabBar };
  }

  render();
  cleanups.push(garage.on('change', render));
  return { destroy: () => cleanups.forEach((c) => c && c()) };
}
