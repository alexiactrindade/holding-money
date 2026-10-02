/* Criação assistida por IA: onboarding (contexto da empresa) e sugestões por área.
   A IA só propõe; o dono revisa, desmarca o que não quer e confirma. */
const IA = {
  // Liga a IA com um clique (só o fundador). Provedor e chave são definidos na instalação.
  async ligar() {
    const r = await API.put('/core/ia', { ativa: true });
    App.ia = r.ativa;
    H.toast('IA ativada.');
    return r.ativa;
  },

  // Aviso quando a IA está desligada. Se a instalação não tem IA, não mostra nada.
  bannerSemIA(texto) {
    if (!App.iaDisp || App.ia) return '';
    const admin = App.user.papel === 'admin';
    return `<div class="ia-off mb-3"><div class="flex-grow-1">${H.esc(texto)}${admin ? '' : ' Peça ao fundador para ativar a IA.'}</div>
      ${admin ? '<button class="btn btn-sm btn-primary" data-ligar-ia>Ativar IA</button>' : ''}</div>`;
  },

  ENTIDADES: ['negocios', 'produtos', 'ofertas', 'conteudos', 'campanhas', 'scripts', 'tarefas', 'riscos'],

  // Lista de revisão: checkbox por item, detalhes expansíveis
  preview(container, itens, titulos = {}) {
    const grupos = Object.entries(itens).filter(([, l]) => l && l.length);
    if (!grupos.length) { container.innerHTML = '<p class="empty">Nenhuma sugestão válida. Tente de novo ou detalhe melhor o pedido.</p>'; return () => ({}); }
    container.innerHTML = grupos.map(([entity, lista]) => {
      const def = App.meta[entity];
      const campos = def.fields.filter((f) => !f.hidden && f.name !== def.display);
      return `<section class="ia-group" data-entity="${entity}">
        <div class="ia-group-head"><h3>${H.esc(titulos[entity]?.titulo || def.label)} <span class="text-muted">(${lista.length})</span></h3>
          <label class="small"><input type="checkbox" class="form-check-input me-1" data-all checked> Todos</label></div>
        ${titulos[entity]?.nota ? `<p class="small text-muted mb-1 mt-1">${H.esc(titulos[entity].nota)}</p>` : ''}
        ${lista.map((it, i) => {
          const det = campos.filter((f) => it[f.name] != null && it[f.name] !== '' && f.type !== 'ref')
            .map((f) => `<dt>${H.esc(f.label)}</dt><dd>${f.type === 'money' ? H.brl(it[f.name]) : f.type === 'date' ? H.esc(String(it[f.name]).split('-').reverse().join('/')) : H.esc(it[f.name])}</dd>`).join('');
          const prod = it.produto_nome ? `<dt>Produto</dt><dd>${H.esc(it.produto_nome)}</dd>` : '';
          return `<div class="ia-item"><input class="form-check-input" type="checkbox" id="ia_${entity}_${i}" data-i="${i}" checked>
            <div class="flex-grow-1"><label for="ia_${entity}_${i}" class="fw-semibold">${H.esc(it[def.display] || '(sem nome)')}</label>
              <details><summary class="small">Ver detalhes</summary><dl class="ia-dl">${prod}${det}</dl></details></div></div>`;
        }).join('')}
      </section>`;
    }).join('');
    container.querySelectorAll('[data-all]').forEach((cb) => cb.addEventListener('change', () => {
      cb.closest('.ia-group').querySelectorAll('[data-i]').forEach((x) => { x.checked = cb.checked; });
    }));
    return () => {
      const out = {};
      for (const [entity, lista] of grupos) {
        const sel = [...container.querySelectorAll(`[data-entity="${entity}"] [data-i]:checked`)].map((x) => lista[Number(x.dataset.i)]);
        if (sel.length) out[entity] = sel;
      }
      return out;
    };
  },

  resumoCriados(criados) {
    return Object.entries(criados).map(([e, n]) => `${n} ${n === 1 ? App.meta[e].singular : App.meta[e].label.toLowerCase()}`).join(', ');
  },

  // ---------- Botão "Sugerir com IA" em cada área ----------
  async sugerir(entity, onDone) {
    const def = App.meta[entity];
    if (!App.ia) {
      if (App.user.papel !== 'admin') { H.toast('A IA está desligada. Peça ao fundador para ativá-la.', 'warn'); return; }
      if (!confirm(`A IA está desligada. Ativar agora para receber sugestões de ${def.label.toLowerCase()}?`)) return;
      if (!(await IA.ligar())) return;
    }
    const el = document.createElement('div');
    el.className = 'modal fade';
    el.tabIndex = -1;
    el.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><h2 class="modal-title">Sugerir ${H.esc(def.label.toLowerCase())} com IA</h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>
      <div class="modal-body">
        <form id="iaf" class="row g-3">
          <div class="col-12"><label class="form-label" for="ia_ins">O que você precisa? (opcional)</label>
            <textarea class="form-control" id="ia_ins" rows="3" placeholder="Ex.: foco no produto de entrada, público de lojistas, algo para vender ainda este mês"></textarea>
            <div class="form-text">A IA usa o contexto da sua empresa e os dados já cadastrados. Nada é salvo sem sua confirmação.</div></div>
          <div class="col-sm-4"><label class="form-label" for="ia_qtd">Quantidade</label>
            <select class="form-select" id="ia_qtd">${[1, 2, 3, 4, 5].map((n) => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="col-sm-8 d-flex align-items-end"><button class="btn btn-primary" type="submit" id="ia_go">Gerar sugestões</button></div>
        </form>
        <div id="ia_out" class="mt-4"></div>
      </div>
      <div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Fechar</button>
        <button type="button" class="btn btn-primary d-none" id="ia_ok">Criar selecionados</button></div>
    </div></div>`;
    document.body.appendChild(el);
    const modal = new bootstrap.Modal(el);
    el.addEventListener('hidden.bs.modal', () => el.remove());
    let coletar = null;
    el.querySelector('#iaf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('#ia_go'); const out = el.querySelector('#ia_out');
      btn.disabled = true; out.innerHTML = '<p class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Pensando nas melhores opções para o seu negócio…</p>';
      try {
        const r = await API.post('/ia/sugerir', { entidade: entity, instrucao: el.querySelector('#ia_ins').value, quantidade: el.querySelector('#ia_qtd').value });
        coletar = IA.preview(out, { [entity]: r.itens });
        el.querySelector('#ia_ok').classList.toggle('d-none', !r.itens.length);
      } catch (err) { out.innerHTML = `<p class="text-danger">${H.esc(err.message)}</p>`; }
      btn.disabled = false; btn.textContent = 'Gerar outras';
    });
    el.querySelector('#ia_ok').addEventListener('click', async (e) => {
      const itens = coletar ? coletar() : {};
      if (!Object.keys(itens).length) { H.toast('Marque ao menos uma sugestão.', 'warn'); return; }
      e.target.disabled = true;
      try {
        const r = await API.post('/ia/aplicar', { itens });
        (r.avisos || []).forEach((a) => H.toast(a, 'warn'));
        H.toast(`Criado: ${IA.resumoCriados(r.criados)}.`);
        UI.refCache = {};
        if (entity === 'negocios') await App.reloadMeta();
        modal.hide(); onDone && onDone();
      } catch (err) { H.toast(err.message, 'error'); e.target.disabled = false; }
    });
    modal.show();
  },

  // ---------- Onboarding: contexto da empresa + estrutura inicial ----------
  // ---------- Questionário do contexto da empresa (por etapas, com perguntas condicionais) ----------
  ctx: {
    OUTRO: 'Outro',
    lista: (v) => (Array.isArray(v) ? v : v ? [v] : []),
    visivel(f, v) {
      return (f.mostrarSe || []).every((c) => {
        const x = v[c.campo];
        if (c.em) return c.em.includes(x);
        if (c.fora) return !c.fora.includes(x || '');
        if (c.min) return IA.ctx.lista(x).length >= c.min;
        return true;
      });
    },
    label(f, v) {
      const inicio = v.estagio_empresa === 'Ideia' || v.ja_vende === 'Ainda não';
      return f.labelInicio && inicio ? f.labelInicio : f.label;
    },
    opcoes(f, v) {
      if (f.opcoesDe) return IA.ctx.lista(v[f.opcoesDe]).map((o) => ({ valor: o, rotulo: o === 'Outro' && v[`${f.opcoesDe}_outro`] ? v[`${f.opcoesDe}_outro`] : o }));
      return f.options.map((o) => (typeof o === 'string' ? { valor: o, rotulo: o } : { valor: o.valor, rotulo: o.valor, desc: o.desc }));
    },
    vazio(f, v) { const x = v[f.key]; return Array.isArray(x) ? !x.length : !String(x ?? '').trim(); },
    texto(f, v) {
      const x = v[f.key];
      if (Array.isArray(x)) return x.map((i) => (i === 'Outro' && v[`${f.key}_outro`] ? `Outro (${v[`${f.key}_outro`]})` : i)).join(', ');
      if (f.type === 'money' && x) return H.brl(Number(x));
      return x || '';
    },

    campo(f, v) {
      const id = `ctx_${f.key}`;
      const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
      const lbl = H.esc(IA.ctx.label(f, v));
      const ph = f.placeholder ? `placeholder="${H.esc(f.placeholder)}"` : '';
      const val = v[f.key] ?? '';
      if (f.type === 'text') return `<div class="q"><label class="form-label" for="${id}">${lbl}${req}</label><input class="form-control" id="${id}" data-k="${f.key}" value="${H.esc(val)}" ${ph} ${f.required ? 'aria-required="true"' : ''}></div>`;
      if (f.type === 'textarea') return `<div class="q"><label class="form-label" for="${id}">${lbl}${req}</label><textarea class="form-control" id="${id}" data-k="${f.key}" rows="2" ${ph} ${f.required ? 'aria-required="true"' : ''}>${H.esc(val)}</textarea></div>`;
      if (f.type === 'money') return `<div class="q"><label class="form-label" for="${id}">${lbl}${req}</label><div class="input-group" style="max-width:280px"><span class="input-group-text">R$</span><input class="form-control" id="${id}" data-k="${f.key}" inputmode="numeric" value="${H.esc(val)}" ${ph}></div></div>`;
      if (f.type === 'single') {
        const ops = IA.ctx.opcoes(f, v);
        return `<fieldset class="q"><legend class="form-label">${lbl}${req}</legend><div class="${f.cards ? 'opt-cards' : 'opt-pills'}">${ops.map((o, i) => `
          <input type="radio" class="btn-check" name="${id}" id="${id}_${i}" value="${H.esc(o.valor)}" data-k="${f.key}" ${val === o.valor ? 'checked' : ''}>
          <label for="${id}_${i}">${f.cards ? `<strong>${H.esc(o.rotulo)}</strong><span>${H.esc(o.desc || '')}</span>` : H.esc(o.rotulo)}</label>`).join('')}</div></fieldset>`;
      }
      if (f.type === 'multi') {
        const sel = IA.ctx.lista(val);
        return `<fieldset class="q"><legend class="form-label">${lbl}${req} <span class="text-muted fw-normal small">(pode marcar mais de uma)</span></legend><div class="opt-pills">${f.options.map((o, i) => `
          <input type="checkbox" class="btn-check" id="${id}_${i}" value="${H.esc(o)}" data-k="${f.key}" data-multi ${sel.includes(o) ? 'checked' : ''}>
          <label for="${id}_${i}">${H.esc(o)}</label>`).join('')}</div>
          ${sel.includes('Outro') ? `<input class="form-control mt-2" style="max-width:360px" data-k="${f.key}_outro" value="${H.esc(v[`${f.key}_outro`] || '')}" placeholder="Qual?" aria-label="Outro: qual?">` : ''}</fieldset>`;
      }
      if (f.type === 'tags') {
        const tags = IA.ctx.lista(val);
        return `<div class="q"><label class="form-label" for="${id}">${lbl}${req}</label>
          <div class="tags" data-tags="${f.key}">${tags.map((t, i) => `<span class="tag">${H.esc(t)}<button type="button" data-rm="${i}" aria-label="Remover ${H.esc(t)}">×</button></span>`).join('')}
            <input id="${id}" class="tag-input" ${ph} autocomplete="off"></div>
          <div class="form-text">Tecle Enter para adicionar cada uma.</div></div>`;
      }
      return '';
    },
  },

  async onboarding(root) {
    const o = await API.get('/onboarding');
    const admin = App.user.papel === 'admin';
    const C = IA.ctx;
    const v = { ...o.contexto };
    if (!v.fundador) v.fundador = App.user.nome;

    if (!admin) {
      root.innerHTML = `<div class="page-head"><div><h1>Contexto da empresa</h1><p>Definido pelo fundador.</p></div></div>
        <div class="panel">${o.grupos.map((g) => {
          const itens = g.campos.filter((f) => C.visivel(f, v) && C.texto(f, v));
          return itens.length ? `<h2 class="h6 mt-2">${H.esc(g.titulo)}</h2><dl class="ia-dl mb-3">${itens.map((f) => `<dt>${H.esc(C.label(f, v))}</dt><dd>${H.esc(C.texto(f, v))}</dd>`).join('')}</dl>` : '';
        }).join('') || '<p class="empty">Ainda não preenchido.</p>'}</div>`;
      return;
    }
    if (new URLSearchParams(location.hash.split('?')[1] || '').get('passo') === 'estrutura') return IA.estrutura(root, o);

    const primeiro = o.status !== 'feito';
    const grupos = o.grupos;
    let etapa = 0;
    let alcancada = o.status === 'pendente' ? 0 : grupos.length - 1;

    root.innerHTML = `
      ${primeiro ? '<div class="onb-steps mb-3"><span class="on">1. Contexto da empresa</span><span>2. Estrutura inicial</span></div>' : ''}
      <div class="page-head"><div><h1>Conte sobre sua empresa</h1>
        <p>Responda algumas perguntas sobre sua empresa, suas ofertas, seus clientes e seus objetivos. Suas respostas alimentam a construção dos seus negócios, produtos, ofertas, mensagens de venda e próximos passos.</p></div></div>
      <div class="panel onb" style="max-width:860px">
        <nav class="onb-nav" aria-label="Etapas do questionário"></nav>
        <div class="onb-bar" role="progressbar" aria-valuemin="1" aria-valuemax="${grupos.length}"><span></span></div>
        <p class="small text-muted mt-3 mb-0">Apenas os campos marcados com <span class="req">*</span> são obrigatórios.</p>
        <form id="ctx" novalidate><div id="qs"></div>
          <p class="text-danger small mb-0" id="qerr" role="alert"></p>
          <div class="d-flex flex-wrap gap-2 mt-4 pt-3 border-top align-items-center">
            <button class="btn btn-light" type="button" id="voltar">Voltar</button>
            <button class="btn btn-primary" type="submit" id="seguir"></button>
            ${primeiro ? '<button class="btn btn-link ms-auto" type="button" id="skip">Prefiro cadastrar tudo sozinho</button>' : '<button class="btn btn-link ms-auto" type="button" id="salvarJa">Salvar alterações</button><a class="btn btn-light" href="#/onboarding?passo=estrutura">Propor estrutura</a>'}
          </div>
        </form>
      </div>`;
    const qs = root.querySelector('#qs');
    const err = root.querySelector('#qerr');

    // Destaca em vermelho as perguntas obrigatórias sem resposta
    const marcar = (lista) => lista.forEach((f) => {
      qs.querySelectorAll(`[data-k="${f.key}"]`).forEach((el) => (el.classList.contains('btn-check') ? el.closest('fieldset').classList.add('q-erro') : el.classList.add('is-invalid')));
    });
    const faltando = (g) => g.campos.filter((f) => f.required && C.visivel(f, v) && C.vazio(f, v));
    const desenhar = (focar = false) => {
      const g = grupos[etapa];
      root.querySelector('.onb-nav').innerHTML = grupos.map((x, i) => `<button type="button" data-g="${i}" class="${i === etapa ? 'on' : i <= alcancada ? 'ok' : ''}" ${i <= alcancada ? '' : 'disabled'} ${i === etapa ? 'aria-current="step"' : ''}>${H.esc(x.titulo)}</button>`).join('');
      root.querySelector('.onb-bar span').style.width = `${((etapa + 1) / grupos.length) * 100}%`;
      root.querySelector('.onb-bar').setAttribute('aria-valuenow', etapa + 1);
      qs.innerHTML = `<h2 class="onb-title">${H.esc(g.titulo)} <span class="text-muted">${etapa + 1} de ${grupos.length}</span></h2>${g.campos.filter((f) => C.visivel(f, v)).map((f) => C.campo(f, v)).join('')}`;
      root.querySelector('#voltar').classList.toggle('d-none', etapa === 0);
      const ultima = etapa === grupos.length - 1;
      root.querySelector('#seguir').textContent = ultima ? (primeiro ? 'Salvar e montar estrutura' : 'Salvar') : 'Continuar';
      err.textContent = '';
      if (focar) qs.querySelector('input:not(.btn-check), textarea, .btn-check')?.focus();
    };

    // Respostas: texto atualiza sem redesenhar; escolhas redesenham (podem abrir ou fechar perguntas)
    qs.addEventListener('input', (e) => {
      const k = e.target.dataset.k; if (!k || e.target.classList.contains('btn-check')) return;
      v[k] = e.target.value;
      e.target.classList.remove('is-invalid');
    });
    qs.addEventListener('change', (e) => {
      const t = e.target; const k = t.dataset.k; if (!k || !t.classList.contains('btn-check')) return;
      if (t.dataset.multi !== undefined) {
        const set = new Set(C.lista(v[k]));
        t.checked ? set.add(t.value) : set.delete(t.value);
        v[k] = [...set];
      } else v[k] = t.value;
      const y = window.scrollY; desenhar(); window.scrollTo(0, y);
      qs.querySelector(`[data-k="${k}"][value="${CSS.escape(t.value)}"]`)?.focus();
    });
    // Tags (outras marcas): Enter ou vírgula adiciona, × remove
    const addTag = (inp) => {
      const k = inp.closest('[data-tags]').dataset.tags; const t = inp.value.replace(/,/g, '').trim();
      if (!t) return; const l = C.lista(v[k]); if (!l.includes(t)) v[k] = [...l, t];
      desenhar(); qs.querySelector('.tag-input')?.focus();
    };
    qs.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('tag-input')) return;
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(e.target); }
      if (e.key === 'Backspace' && !e.target.value) { const k = e.target.closest('[data-tags]').dataset.tags; v[k] = C.lista(v[k]).slice(0, -1); desenhar(); qs.querySelector('.tag-input')?.focus(); }
    });
    qs.addEventListener('focusout', (e) => { if (e.target.classList.contains('tag-input') && e.target.value.trim()) addTag(e.target); });
    qs.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]'); if (!rm) return;
      const k = rm.closest('[data-tags]').dataset.tags; const l = C.lista(v[k]); l.splice(Number(rm.dataset.rm), 1); v[k] = l; desenhar();
    });
    qs.addEventListener('click', (e) => { if (e.target.matches('.tags')) e.target.querySelector('.tag-input')?.focus(); });

    root.querySelector('.onb-nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]'); if (!b || b.disabled) return;
      etapa = Number(b.dataset.g); desenhar(true);
    });
    root.querySelector('#voltar').addEventListener('click', () => { if (etapa > 0) { etapa--; desenhar(true); } });

    const salvar = async () => {
      const pend = grupos.findIndex((g) => faltando(g).length);
      if (pend >= 0) { etapa = pend; alcancada = Math.max(alcancada, pend); desenhar(true); marcar(faltando(grupos[pend])); err.textContent = `Preencha: ${faltando(grupos[pend]).map((f) => C.label(f, v)).join(', ')}.`; return false; }
      await API.post('/onboarding', v);
      await App.reloadMeta(); App.loadConfig();
      return true;
    };
    root.querySelector('#ctx').addEventListener('submit', async (e) => {
      e.preventDefault();
      const g = grupos[etapa]; const f = faltando(g);
      if (f.length) { marcar(f); err.textContent = `Preencha: ${f.map((x) => C.label(x, v)).join(', ')}.`; qs.querySelector(`[data-k="${f[0].key}"]`)?.focus(); return; }
      if (etapa < grupos.length - 1) { etapa++; alcancada = Math.max(alcancada, etapa); desenhar(true); window.scrollTo(0, 0); return; }
      const btn = root.querySelector('#seguir'); btn.disabled = true;
      try {
        if (await salvar()) { H.toast('Contexto salvo.'); if (primeiro) location.hash = '#/onboarding?passo=estrutura'; }
      } catch (ex) { err.textContent = ex.message; }
      btn.disabled = false;
    });
    root.querySelector('#salvarJa')?.addEventListener('click', async () => {
      try { if (await salvar()) H.toast('Contexto salvo.'); } catch (ex) { err.textContent = ex.message; }
    });
    root.querySelector('#skip')?.addEventListener('click', async () => {
      await API.post('/onboarding/concluir'); App.onboarding = 'feito'; location.hash = '#/';
    });
    desenhar();
  },

  async estrutura(root, o, { basica = false } = {}) {
    const primeiro = o.status !== 'feito';
    const passos = primeiro ? '<div class="onb-steps mb-3"><span class="done">1. Contexto da empresa</span><span class="on">2. Estrutura inicial</span></div>' : '';
    if (App.iaDisp && !App.ia && !basica) {
      root.innerHTML = `${passos}
        <div class="page-head"><div><h1>Como quer montar sua estrutura?</h1><p>Com o contexto que você contou, dá para começar de dois jeitos.</p></div></div>
        <div class="row g-3" style="max-width:960px">
          <div class="col-md-6"><div class="panel choice">
            <span class="ia-pill on mb-2">Recomendado</span>
            <h2 class="h5">Com IA</h2>
            <p class="text-muted">A IA analisa seu negócio e propõe negócios, produtos, ofertas, mensagens de venda, um plano de ação para as próximas semanas e os riscos a observar.</p>
            <button class="btn btn-primary" id="comia">Usar IA e continuar</button></div></div>
          <div class="col-md-6"><div class="panel choice">
            <span class="ia-pill mb-2">Mais rápido</span>
            <h2 class="h5">Estrutura básica</h2>
            <p class="text-muted">Criamos seu negócio, os produtos que você citou e um plano de primeiros passos. O resto você completa quando quiser, e pode ativar a IA depois.</p>
            <button class="btn btn-light" id="basica">Montar estrutura básica</button></div></div>
        </div>`;
      root.querySelector('#comia').addEventListener('click', async () => { if (await IA.ligar()) IA.estrutura(root, o); });
      root.querySelector('#basica').addEventListener('click', () => IA.estrutura(root, o, { basica: true }));
      return;
    }
    root.innerHTML = `${passos}
      <div class="page-head"><div><h1>Estrutura comercial inicial</h1>
        <p>Confira a proposta. Desmarque o que não fizer sentido; o resto você ajusta depois em cada área.</p></div></div>
      <div id="est" class="panel"><p class="text-muted mb-0"><span class="spinner-border spinner-border-sm me-2"></span>${App.ia ? 'Analisando o seu negócio e montando a proposta. Isso pode levar até um minuto…' : 'Montando a estrutura…'}</p></div>`;
    const box = root.querySelector('#est');
    let r;
    try { r = await API.post('/ia/estrutura'); } catch (err) {
      box.innerHTML = `<p class="text-danger">${H.esc(err.message)}</p><div class="d-flex gap-2"><button class="btn btn-primary" id="again">Tentar de novo</button><a class="btn btn-light" href="#/onboarding">Revisar contexto</a></div>`;
      box.querySelector('#again').addEventListener('click', () => IA.estrutura(root, o));
      return;
    }
    box.innerHTML = `
      ${r.fonte === 'basica' && App.iaDisp ? IA.bannerSemIA('Esta é a estrutura básica, feita só com o que você contou. Ative a IA quando quiser uma proposta completa, com ofertas, mensagens de venda e riscos.') : ''}
      ${r.resumo ? `<div class="ia-resumo mb-4"><div class="hero-label">Leitura do negócio</div><div>${H.md(r.resumo)}</div></div>` : ''}
      <div id="prev"></div>
      <div class="d-flex flex-wrap gap-2 mt-4 pt-3 border-top">
        <button class="btn btn-primary" id="ok">Criar selecionados</button>
        ${r.fonte === 'ia' ? '<button class="btn btn-light" id="regen">Gerar outra proposta</button>' : ''}
        <a class="btn btn-link" href="#/onboarding">Ajustar contexto</a>
        ${primeiro ? '<button class="btn btn-link ms-auto" id="skip">Não criar nada agora</button>' : ''}
      </div>`;
    const coletar = IA.preview(box.querySelector('#prev'), r.itens, {
      tarefas: { titulo: 'Tarefas sugeridas', nota: 'Você pode criar outras tarefas mais tarde.' },
    });
    box.querySelector('#regen')?.addEventListener('click', () => IA.estrutura(root, o));
    box.querySelector('#skip')?.addEventListener('click', async () => { await API.post('/onboarding/concluir'); App.onboarding = 'feito'; location.hash = '#/'; });
    box.querySelector('#ok').addEventListener('click', async (e) => {
      const itens = coletar();
      if (!Object.keys(itens).length) { H.toast('Marque ao menos um item.', 'warn'); return; }
      e.target.disabled = true;
      try {
        const res = await API.post('/ia/aplicar', { itens, origem: 'estrutura', resumo: r.resumo });
        await API.post('/onboarding/concluir');
        App.onboarding = 'feito'; UI.refCache = {};
        await App.reloadMeta();
        H.toast(`Estrutura criada: ${IA.resumoCriados(res.criados)}.`);
        location.hash = '#/';
        App.refreshBadges();
      } catch (err) { H.toast(err.message, 'error'); e.target.disabled = false; }
    });
  },
};
