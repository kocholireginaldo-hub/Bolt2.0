/** Garagem: múltiplos veículos, identificação técnica separada da aparência. */
import { FUEL_TYPES, ASPIRATIONS, TRANSMISSIONS, suggestedLimits } from './config.js';
import { resolveVehicleVisual, BOLT_VEHICLE_IMAGES, BOLT_COLOR_SWATCHES, catalogIdFor } from './vehicle-catalog.js';
import { createVehicleThumb } from './vehicle-thumb.js';
import { blankVehicle, normalizeVehicle, currentOdometer, describeVehicle, engineSummary } from './garage.js';
import { h, ic, card, badge, button, iconButton, field, input, select, textarea, modal, tabs, toast, confirmDialog, emptyState, clear, guardMotion } from './ui.js';
import { fmtNum, fmtDate } from './utils.js';


export function mountGarage(root, ctx) {
  const { garage, settings } = ctx;
  const dot = (c, on, big, handler) => {
    const b = h('button', { type: 'button', class: `stage-dot${big ? ' stage-dot-lg' : ''}${on ? ' on' : ''}`, 'aria-label': `Cor ${BOLT_COLOR_SWATCHES[c]?.label || c}`, 'aria-pressed': String(on), title: BOLT_COLOR_SWATCHES[c]?.label || c, on: { click: handler } });
    b.style.setProperty('--sw', BOLT_COLOR_SWATCHES[c]?.swatch || '#888');
    return b;
  };
  const colorMap = () => settings.get('cockpit.colors', {}) || {};
  const setColor = (id, c) => settings.set('cockpit.colors', { ...colorMap(), [id]: c });
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
      host.append(h('div', { class: 'garage-empty' }, h('div', { class: 'garage-empty-stage', 'aria-hidden': 'true' }, h('i', { class: 'ge-plate' })), h('h2', {}, 'Garagem vazia'), h('p', {}, 'Cadastre seu primeiro veículo. A marca, o motor e os limites alimentam os alertas e a estimativa de consumo.'), button({ label: 'Cadastrar veículo', icon: 'plus', kind: 'primary', onClick: () => openForm() })));
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
    const visual = resolveVehicleVisual(v, colorMap()[v.id]);
    const canPick = !isActive && !v.archived;
    const stage = h('div', { class: 'gcard-stage' }, h('i', { class: 'gc-glow' }), h('i', { class: 'gc-plate' }), createVehicleThumb(visual, v.nickname), isActive ? badge('Ativo', 'ok', 'check') : null, v.archived ? badge('Arquivado', 'neutral') : null);
    if (canPick) {
      stage.classList.add('is-pickable');
      stage.setAttribute('role', 'button');
      stage.tabIndex = 0;
      stage.setAttribute('aria-label', `Usar ${v.nickname}`);
      const pick = async () => { await garage.setActive(v.id); toast(`${v.nickname} é o veículo ativo.`, 'ok'); };
      stage.addEventListener('click', pick);
      stage.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    const dots = visual.colors.length > 1 ? h('div', { class: 'gcard-colors', role: 'group', 'aria-label': 'Cor do veículo' }, visual.colors.map((c) => dot(c, c === visual.color, false, (e) => { e.stopPropagation(); setColor(v.id, c); }))) : null;
    return h(
      'article',
      { class: `vehicle-card gcard ${isActive ? 'is-active' : ''} ${v.archived ? 'is-archived' : ''}`.trim() },
      stage,
      h('div', { class: 'vehicle-info' }, h('h3', {}, v.nickname), h('p', {}, describeVehicle(v)), h('small', {}, engineSummary(v)), dots, h('div', { class: 'vehicle-meta' }, h('span', {}, ic('road', 14), odo != null ? `${fmtNum(odo, 0)} km` : 'km não informada'), h('span', {}, ic('trips', 14), `${real} viagem${real === 1 ? '' : 's'} real${real === 1 ? '' : 'is'}`))),
      h(
        'div',
        { class: 'vehicle-actions' },
        canPick ? button({ label: 'Usar', kind: 'primary', size: 'sm', onClick: async () => { await garage.setActive(v.id); toast(`${v.nickname} é o veículo ativo.`, 'ok'); } }) : null,
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
    let chosenColor = existing ? colorMap()[existing.id] || null : null;
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
        const preview = h('div', { class: 'look-preview gcard-stage' }, h('i', { class: 'gc-glow' }), h('i', { class: 'gc-plate' }));
        const colorsBox = h('div', { class: 'swatches' });
        const draw = () => {
          const visual = resolveVehicleVisual(draft, chosenColor);
          preview.querySelector('.vthumb')?.remove();
          preview.append(createVehicleThumb(visual, [draft.tech.make, draft.tech.model].filter(Boolean).join(' ')));
          clear(colorsBox);
          if (visual.colors.length > 1) {
            for (const c of visual.colors) colorsBox.append(dot(c, c === visual.color, true, () => { chosenColor = c; draft.appearance.color = BOLT_COLOR_SWATCHES[c].swatch; draw(); }));
          } else colorsBox.append(h('small', { class: 'muted' }, catalogIdFor(draft) ? 'Este modelo tem uma única cor no catálogo.' : 'Este modelo ainda não está no catálogo de imagens; ele aparece com o nome do veículo. Preencha marca, modelo e ano na aba técnica.'));
        };
        draw();
        body.append(h('p', { class: 'form-intro' }, 'A imagem vem do catálogo do BOLT (a mesma do cockpit). A aparência é apenas visual e não afeta a identificação técnica.'), preview, field('Cor', colorsBox), field('Apelido', input({ value: draft.nickname, placeholder: 'Como você chama este veículo', on: { input: (e) => (draft.nickname = e.target.value) } })), field('Observações', textarea({ value: draft.notes || '', on: { input: (e) => (draft.notes = e.target.value) } })));
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
              if (chosenColor && catalogIdFor(draft)) setColor(saved.id, chosenColor);
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
  cleanups.push(settings.on('change', (p) => { if (p.startsWith('cockpit.colors')) render(); }));
  return { destroy: () => cleanups.forEach((c) => c && c()) };
}
