/* Componentes genéricos: listagem e formulário de qualquer entidade do banco comercial */
const UI = {
  refCache: {},

  async refOptions(entity) {
    if (!UI.refCache[entity]) {
      const rows = await API.get(`/e/${entity}`);
      const disp = App.meta[entity].display;
      UI.refCache[entity] = rows.map((r) => ({ id: r.id, label: r[disp] || `#${r.id}` }));
    }
    return UI.refCache[entity];
  },

  fmt(f, row) {
    const v = row[f.name];
    switch (f.type) {
      case 'money': return v === null || v === undefined ? '<span class="text-muted">—</span>' : `<span class="money-num">${H.brl(v)}</span>`;
      case 'percent': return v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR')}%`;
      case 'ratio': return v === null || v === undefined ? '—' : `<span class="${v < 0 ? 'text-danger' : ''} fw-semibold">${H.pct(v)}</span>`;
      case 'date': {
        if (!v) return '<span class="text-muted">—</span>';
        const late = f.name === 'proximo_contato' || f.name === 'prazo' ? v < H.today() && !['Cliente', 'Perdido', 'Concluída', 'Cortada'].includes(row.estagio || row.status) : false;
        return `<span class="${late ? 'text-danger fw-semibold' : ''}">${H.date(v)}</span>`;
      }
      case 'ref': return H.esc(row[`${f.name}__label`] || '—');
      case 'select':
        if (['status', 'temperatura', 'estagio', 'impacto', 'potencial', 'ativo'].includes(f.name)) return H.tag(v);
        return H.esc(v ?? '—');
      default: return `<div class="cell-clip" title="${H.esc(v)}">${H.esc(v ?? '—')}</div>`;
    }
  },

  // Ações extras por linha, por entidade
  rowActions(entity, r) {
    const b = [];
    if (entity === 'leads') {
      if (r.contato && H.isPhone(r.contato)) b.push(`<a class="btn btn-sm btn-light" target="_blank" rel="noopener" href="${H.waLink(r.contato, r.mensagem_followup || '')}" title="Abrir WhatsApp" data-stop>WhatsApp</a>`);
      if (!['Cliente', 'Perdido'].includes(r.estagio)) b.push(`<button class="btn btn-sm btn-light" data-act="contatado" data-id="${r.id}" title="Marcar contato feito hoje e agendar próximo em 2 dias">Contatado</button>`);
    }
    if (entity === 'aprovacoes' && r.status === 'Pendente' && App.user.papel === 'admin') {
      b.push(`<button class="btn btn-sm btn-teal" data-act="aprovar" data-id="${r.id}">Aprovar</button>`);
      b.push(`<button class="btn btn-sm btn-light" data-act="recusar" data-id="${r.id}">Recusar</button>`);
    }
    if (entity === 'tarefas' && !['Concluída', 'Cortada'].includes(r.status)) {
      b.push(`<button class="btn btn-sm btn-teal" data-act="concluir" data-id="${r.id}" title="Marcar como concluída">Concluir</button>`);
      b.push(`<button class="btn btn-sm btn-light" data-act="cancelar" data-id="${r.id}" title="Cancelar tarefa">Cancelar</button>`);
    }
    if (entity === 'scripts') b.push(`<button class="btn btn-sm btn-light" data-act="copiar" data-id="${r.id}">Copiar</button>`);
    if (entity === 'diagnosticos') b.push(`<button class="btn btn-sm btn-light" data-act="ver" data-id="${r.id}">Ver resultado</button>`);
    if (entity === 'propostas' && r.status === 'Rascunho') b.push(`<button class="btn btn-sm btn-light" data-act="pedir-aprovacao" data-id="${r.id}">Pedir aprovação</button>`);
    return b.join(' ');
  },

  async renderEntity(root, entity, { openId, defaults } = {}) {
    const def = App.meta[entity];
    if (!def) { root.innerHTML = '<p>Área não encontrada.</p>'; return; }
    const filterField = def.fields.find((f) => f.filter);
    const cols = [...def.fields.filter((f) => f.list && !f.hidden), ...(def.computed || [])];
    const extra = entity === 'leads' ? `<a class="btn btn-light" href="#/leads">Funil</a>` : '';

    root.innerHTML = `
      <div class="page-head">
        <div><h1>${H.esc(def.label)}</h1><p>${H.esc(def.help || '')}</p></div>
        <div class="d-flex gap-2 no-print">${extra}
          ${App.iaDisp && IA.ENTIDADES.includes(entity) ? '<button class="btn btn-light" id="btnIA">Sugerir com IA</button>' : ''}
          ${def.readonly ? '' : `<button class="btn btn-primary" id="btnNovo">${H.g(def, 'Novo', 'Nova')} ${H.esc(def.singular)}</button>`}
        </div>
      </div>
      <div class="d-flex flex-wrap gap-2 mb-3 no-print">
        <input type="search" class="form-control" style="max-width:280px" id="q" placeholder="Buscar" aria-label="Buscar">
        ${filterField ? `<select class="form-select" style="max-width:220px" id="flt" aria-label="Filtrar por ${H.esc(filterField.label)}">
          <option value="">${H.esc(filterField.label)}: todos</option>${filterField.options.map((o) => `<option>${H.esc(o)}</option>`).join('')}</select>` : ''}
        ${def.exportavel ? '<button class="btn btn-light ms-auto" id="btnCsv">Exportar CSV</button>' : ''}
      </div>
      <div id="tbl"></div>`;

    let rows = [];
    let prio = null;
    const load = async () => {
      const params = new URLSearchParams();
      const q = root.querySelector('#q').value.trim();
      if (q) params.set('q', q);
      const fv = filterField ? root.querySelector('#flt').value : '';
      if (fv) params.set(filterField.name, fv);
      rows = await API.get(`/e/${entity}?${params}`);
      if (entity === 'tarefas') {
        prio = await API.get('/prioridades');
        const score = Object.fromEntries(prio.map((p) => [p.id, p.score]));
        rows.forEach((r) => { r.__score = score[r.id] ?? -99; });
        rows.sort((a, b) => b.__score - a.__score);
      }
      draw();
    };

    const draw = () => {
      const tbl = root.querySelector('#tbl');
      if (!rows.length) {
        tbl.innerHTML = `<div class="panel panel-mist text-center py-5"><p class="mb-3">${H.g(def, 'Nenhum', 'Nenhuma')} ${H.esc(def.singular)} por aqui ainda.</p>
          <div class="d-flex gap-2 justify-content-center flex-wrap">${def.readonly ? '' : `<button class="btn btn-primary" data-act="novo">${H.g(def, 'Criar o primeiro', 'Criar a primeira')}</button>`}
          ${App.iaDisp && IA.ENTIDADES.includes(entity) ? '<button class="btn btn-light" data-ia>Sugerir com IA</button>' : ''}</div></div>`;
        return;
      }
      const prioCol = entity === 'tarefas';
      tbl.innerHTML = `<div class="table-wrap"><table class="table table-hover align-middle">
        <thead><tr>${prioCol ? '<th title="Impacto financeiro x urgência x esforço">Prioridade</th>' : ''}${cols.map((c) => `<th>${H.esc(c.label)}</th>`).join('')}<th class="text-end no-print"></th></tr></thead>
        <tbody>${rows.map((r) => `<tr data-id="${r.id}">
          ${prioCol ? `<td class="fw-bold">${r.__score > -99 ? r.__score.toLocaleString('pt-BR') : '—'}</td>` : ''}
          ${cols.map((c) => `<td>${UI.fmt(c, r)}</td>`).join('')}
          <td class="text-end text-nowrap no-print">${UI.rowActions(entity, r)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="text-muted small mt-2">${rows.length} registro(s)</p>`;
    };

    const refresh = async () => { UI.refCache = {}; await load(); App.refreshBadges(); };

    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-stop]')) return;
      const act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        const id = Number(act.dataset.id);
        const row = rows.find((r) => r.id === id);
        try {
          if (act.dataset.act === 'novo') UI.openForm(entity, null, refresh);
          if (['concluir', 'cancelar'].includes(act.dataset.act)) {
            await API.put(`/e/tarefas/${id}`, { status: act.dataset.act === 'concluir' ? 'Concluída' : 'Cortada' });
            H.toast(act.dataset.act === 'concluir' ? 'Tarefa concluída.' : 'Tarefa cancelada.');
            await refresh();
          }
          if (act.dataset.act === 'contatado') { await API.post(`/leads/${id}/contatado`, { dias: 2 }); H.toast('Contato registrado. Próximo follow-up em 2 dias.'); await refresh(); }
          if (act.dataset.act === 'aprovar' || act.dataset.act === 'recusar') {
            const decisao = act.dataset.act === 'aprovar' ? 'Aprovada' : 'Recusada';
            const comentario = prompt(`${decisao === 'Aprovada' ? 'Aprovar' : 'Recusar'}: "${row.titulo}"\nComentário para o registro de decisões (opcional):`, '');
            if (comentario === null) return;
            await API.post(`/aprovacoes/${id}/decidir`, { decisao, comentario });
            H.toast(decisao === 'Aprovada' ? 'Aprovado e registrado em decisões.' : 'Recusado e registrado em decisões.');
            await refresh();
          }
          if (act.dataset.act === 'copiar') { await navigator.clipboard.writeText(row.mensagem || ''); H.toast('Mensagem copiada.'); }
          if (act.dataset.act === 'ver') UI.showDiagnostico(row);
          if (act.dataset.act === 'pedir-aprovacao') { await API.put(`/e/propostas/${id}`, { status: 'Aguardando aprovação' }); H.toast('Proposta enviada para aprovação do fundador.'); await refresh(); }
        } catch (err) { H.toast(err.message, 'error'); }
        return;
      }
      if (e.target.closest('#btnNovo')) { UI.openForm(entity, null, refresh); return; }
      if (e.target.closest('#btnIA, [data-ia]')) { IA.sugerir(entity, refresh); return; }
      if (e.target.closest('#btnCsv')) {
        H.csv(rows, cols.map((c) => ({ label: c.label, get: (r) => (c.type === 'ref' ? r[`${c.name}__label`] : r[c.name]) })));
        return;
      }
      const tr = e.target.closest('tr[data-id]');
      if (tr) {
        const row = rows.find((r) => r.id === Number(tr.dataset.id));
        if (entity === 'diagnosticos') UI.showDiagnostico(row);
        else UI.openForm(entity, row, refresh);
      }
    });
    let t;
    root.querySelector('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
    root.querySelector('#flt')?.addEventListener('change', load);

    await load();
    if (openId) {
      const row = rows.find((r) => r.id === Number(openId)) || await API.get(`/e/${entity}/${openId}`).catch(() => null);
      if (row) (entity === 'diagnosticos' ? UI.showDiagnostico(row) : UI.openForm(entity, row, refresh));
    } else if (defaults) {
      UI.openForm(entity, null, refresh, defaults);
    }
  },

  async fieldHtml(f, value) {
    const id = `f_${f.name}`;
    const req = f.required ? 'required' : '';
    const v = value ?? '';
    let input;
    if (f.type === 'textarea') input = `<textarea class="form-control" id="${id}" name="${f.name}" rows="3" ${req}>${H.esc(v)}</textarea>`;
    else if (f.type === 'select') {
      const opts = f.options.filter((o) => !(f.readonlyValues || []).includes(o) || o === v);
      if (v !== '' && !opts.includes(String(v))) opts.unshift(String(v));
      input = `<select class="form-select" id="${id}" name="${f.name}" ${req}><option value="">Selecione</option>${opts.map((o) => `<option ${String(v) === o ? 'selected' : ''}>${H.esc(o)}</option>`).join('')}</select>`;
    } else if (f.type === 'ref') {
      const opts = await UI.refOptions(f.ref);
      input = `<select class="form-select" id="${id}" name="${f.name}" ${req}><option value="">Nenhum</option>${opts.map((o) => `<option value="${o.id}" ${Number(v) === o.id ? 'selected' : ''}>${H.esc(o.label)}</option>`).join('')}</select>`;
    } else {
      const type = { number: 'number', money: 'number', percent: 'number', date: 'date' }[f.type] || 'text';
      const step = f.type === 'money' ? 'step="0.01" min="0"' : f.type === 'percent' ? 'step="0.1"' : '';
      input = `<input class="form-control" type="${type}" ${step} id="${id}" name="${f.name}" value="${H.esc(v)}" ${req}>`;
    }
    const hint = f.sensitive && App.user.papel !== 'admin' ? '<div class="form-text">Alterações aqui passam por aprovação do fundador.</div>' : '';
    return `<div class="${f.type === 'textarea' ? 'col-12' : 'col-md-6'}"><label class="form-label" for="${id}">${H.esc(f.label)}${f.required ? ' *' : ''}</label>${input}${hint}</div>`;
  },

  async openForm(entity, row, onSaved, defaults = {}, onHidden = null) {
    const def = App.meta[entity];
    const isNew = !row;
    const data = row || defaults;
    const fields = def.fields.filter((f) => !f.hidden && !(entity === 'aprovacoes' && f.name === 'status'));
    const htmls = [];
    for (const f of fields) htmls.push(await UI.fieldHtml(f, data[f.name] ?? (f.type === 'date' && f.required ? H.today() : undefined)));

    const el = document.createElement('div');
    el.className = 'modal fade';
    el.tabIndex = -1;
    el.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-scrollable"><form class="modal-content" novalidate>
      <div class="modal-header"><h2 class="modal-title">${isNew ? `${H.g(def, 'Novo', 'Nova')} ${H.esc(def.singular)}` : H.esc(row[def.display] || def.singular)}</h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>
      <div class="modal-body"><div class="row g-3">${htmls.join('')}</div>
        ${row?.updated_at ? `<p class="text-muted small mt-3 mb-0">Atualizado em ${H.esc(row.updated_at)}</p>` : ''}</div>
      <div class="modal-footer">
        ${!isNew ? '<button type="button" class="btn btn-link text-danger me-auto" data-del>Excluir</button>' : ''}
        <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Criar' : 'Salvar alterações'}</button>
      </div></form></div>`;
    document.body.appendChild(el);
    const modal = new bootstrap.Modal(el);
    el.addEventListener('hidden.bs.modal', () => { el.remove(); if (onHidden) onHidden(); else if (location.hash.match(/\/(\d+|novo)/)) history.replaceState(null, '', `#/e/${entity}`); });

    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      for (const f of fields) body[f.name] = fd.get(f.name);
      const missing = fields.filter((f) => f.required && !body[f.name]);
      if (missing.length) { H.toast(`Preencha: ${missing.map((f) => f.label).join(', ')}.`, 'error'); return; }
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const res = isNew ? await API.post(`/e/${entity}`, body) : await API.put(`/e/${entity}/${row.id}`, body);
        (res.avisos || []).forEach((a) => H.toast(a, 'warn'));
        H.toast(isNew ? `${def.singular[0].toUpperCase() + def.singular.slice(1)} ${H.g(def, 'criado', 'criada')}.` : 'Alterações salvas.');
        modal.hide();
        UI.refCache = {};
        if (entity === 'negocios') await App.reloadMeta();
        onSaved && onSaved();
      } catch (err) { H.toast(err.message, 'error'); btn.disabled = false; }
    });
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm(`Excluir "${row[def.display] || def.singular}"? Essa ação não pode ser desfeita.`)) return;
      try { await API.del(`/e/${entity}/${row.id}`); H.toast('Excluído.'); modal.hide(); onSaved && onSaved(); } catch (err) { H.toast(err.message, 'error'); }
    });
    modal.show();
  },

  showDiagnostico(row) {
    let res = {}; let resp = {};
    try { res = JSON.parse(row.resultado || '{}'); resp = JSON.parse(row.respostas || '{}'); } catch { /* ignore */ }
    const el = document.createElement('div');
    el.className = 'modal fade';
    el.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><h2 class="modal-title">${H.esc(row.nome)}: ${H.esc(res.titulo || row.classificacao)}</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>
      <div class="modal-body">
        <p class="mb-1">${H.tag(row.temperatura)} <span class="text-muted ms-2">${H.esc(row.contato)} · recebido em ${H.esc(row.created_at)}</span></p>
        <p class="mt-3">${H.esc(res.resumo || '')}</p>
        ${(res.barras || []).map((b) => `<div class="result-bar"><span>${H.esc(b.label)}</span><div class="funnel-bar"><span style="width:${Math.max(2, b.valor)}%"></span></div><strong>${b.valor}%</strong></div>`).join('')}
        <p class="mt-3 mb-1"><strong>Recomendação:</strong> ${H.esc(res.recomendacao || '')}</p>
        ${resp.qualificacao ? `<h3 class="mt-4">Qualificação</h3><ul>${Object.entries(resp.qualificacao).map(([k, v]) => `<li>${H.esc(k)}: ${H.esc(v)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="modal-footer">${row.lead_id ? `<a class="btn btn-primary" href="#/e/leads/${row.lead_id}">Abrir lead</a>` : ''}</div>
    </div></div>`;
    document.body.appendChild(el);
    const m = new bootstrap.Modal(el);
    el.addEventListener('hidden.bs.modal', () => el.remove());
    el.querySelector('a.btn')?.addEventListener('click', () => m.hide());
    m.show();
  },
};
