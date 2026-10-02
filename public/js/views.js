/* Telas específicas do Holding Money */
const Views = {
  // ---------------- Painel ----------------
  async painel(root) {
    const d = await API.get('/dashboard');
    const f = d.financeiro;
    const metaPct = f.meta > 0 ? Math.min(1, f.mes.receita / f.meta) : null;
    const acao = d.acaoDoDia || d.execucao.prioridades[0]?.tarefa || (d.dinheiroAgora.followHoje[0] ? `Follow-up com ${d.dinheiroAgora.followHoje[0].nome}` : null);
    const maxFunil = Math.max(1, ...d.funil.etapas.map((e) => e.total));

    root.innerHTML = `
      <div class="page-head"><div><h1>Painel de dinheiro</h1><p>${new Date(d.hoje + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>

      ${d.vazio ? `<section class="panel start-panel mb-4" aria-label="Comece por aqui">
        <div><div class="panel-title mb-1">Comece por aqui</div>
        <p class="mb-0 text-muted">O sistema está vazio de propósito: tudo nasce do contexto da sua empresa. ${App.user.papel === 'admin' ? 'Conte sobre o negócio e receba uma proposta de estrutura, ou cadastre cada área manualmente.' : 'Peça ao fundador para preencher o contexto da empresa.'}</p></div>
        ${App.user.papel === 'admin' ? '<div class="d-flex gap-2 flex-wrap"><a class="btn btn-primary" href="#/onboarding"><i class="bi bi-building"></i> Contexto da empresa</a><a class="btn btn-light" href="#/onboarding?passo=estrutura"><i class="bi bi-stars text-gold"></i> Montar estrutura</a></div>' : ''}
      </section>` : ''}

      <section class="money-hero mb-4" aria-label="Ação de dinheiro do dia">
        ${H.stripes({ width: 400, height: 150, className: 'hero-stripes' })}
        <div class="hero-inner">
          <div class="hero-label">Ação de dinheiro do dia</div>
          <div class="hero-action">${acao ? H.esc(acao) : 'Defina a ação que aproxima venda, lead ou proposta hoje.'}</div>
          <div class="d-flex gap-2 flex-wrap">
            <a class="btn btn-gold" href="#/checklist">${d.acaoDoDia ? 'Revisar checklist do dia' : 'Fazer checklist do dia'}</a>
            <a class="btn btn-outline-light" href="#/agentes">Perguntar ao Core</a>
          </div>
        </div>
      </section>

      <div class="row g-3 mb-4">
        <div class="col-6 col-xl-3"><div class="kpi">
          <div class="kpi-label">Receita no mês</div>
          <div class="kpi-value money">${H.brlShort(f.mes.receita)}</div>
          ${metaPct !== null ? `<div class="meta-bar" role="progressbar" aria-valuenow="${Math.round(metaPct * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${metaPct * 100}%"></span></div><div class="kpi-sub">${H.pct(metaPct)} da meta de ${H.brlShort(f.meta)}</div>` : '<div class="kpi-sub"><a href="#/onboarding">Defina a meta mensal</a></div>'}
        </div></div>
        <div class="col-6 col-xl-3"><div class="kpi">
          <div class="kpi-label">Lucro (30 dias)</div>
          <div class="kpi-value ${f.ultimos30.lucro < 0 ? 'text-danger' : ''}">${H.brlShort(f.ultimos30.lucro)}</div>
          <div class="kpi-sub">Margem ${H.pct(f.ultimos30.margem)} · ticket ${H.brl(f.ultimos30.ticket)}</div>
        </div></div>
        <div class="col-6 col-xl-3"><div class="kpi">
          <div class="kpi-label">Pipeline em aberto</div>
          <div class="kpi-value">${H.brlShort(d.dinheiroAgora.pipelineValor)}</div>
          <div class="kpi-sub">Conversão geral ${H.pct(d.funil.conversao, 1)} · ${d.funil.leads30} leads em 30 dias</div>
        </div></div>
        <div class="col-6 col-xl-3"><div class="kpi kpi-sovereign" title="Indicador soberano: impede o sistema de virar uma máquina de tarefas bonitas e improdutivas">
          <div class="kpi-label">Receita por ação executada</div>
          <div class="kpi-value">${d.execucao.receitaPorAcao === null ? '—' : H.brlShort(d.execucao.receitaPorAcao)}</div>
          <div class="kpi-sub">${d.execucao.concluidas30} tarefas concluídas em 30 dias</div>
        </div></div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-lg-7"><div class="panel">
          <div class="panel-title">Dinheiro parado</div>
          ${d.alertas.length ? d.alertas.map((a) => `
            <div class="alert-row"><span class="lvl lvl-${a.nivel}" aria-label="Nível ${a.nivel}"></span>
              <div><strong>${H.esc(a.titulo)}</strong><div class="text-muted small">${H.esc(a.detalhe)}</div><div class="acao">${H.esc(a.acao)}</div></div>
              <div class="text-end">${a.valor ? `<div class="money-num small">${H.brlShort(a.valor)}</div>` : ''}<a class="btn btn-sm btn-light mt-1" href="${H.esc(a.link)}">Resolver</a></div>
            </div>`).join('') : '<p class="empty">Nenhum dinheiro parado detectado. Bom sinal, ou falta dado no banco comercial.</p>'}
        </div></div>
        <div class="col-lg-5 d-flex flex-column gap-3">
          <div class="panel">
            <div class="panel-title">Follow-up de hoje <a href="#/leads">Funil</a></div>
            ${d.dinheiroAgora.followHoje.length ? `<ul class="mini-list">${d.dinheiroAgora.followHoje.map((l) => `
              <li><div><a href="#/e/leads/${l.id}" class="fw-semibold text-body">${H.esc(l.nome)}</a><div class="meta">${H.esc(l.canal || 'sem canal')} · ${H.esc(l.estagio)}${l.proximo_contato < d.hoje ? ' · <span class="text-danger">atrasado</span>' : ''}</div></div>
              <div class="d-flex gap-1 align-items-center">${H.tag(l.temperatura)}${l.contato && H.isPhone(l.contato) ? `<a class="btn btn-sm btn-light" target="_blank" rel="noopener" href="${H.waLink(l.contato, l.mensagem_followup || '')}" aria-label="WhatsApp"><i class="bi bi-whatsapp"></i></a>` : ''}</div></li>`).join('')}</ul>` : '<p class="empty">Nenhum follow-up para hoje.</p>'}
          </div>
          <div class="panel">
            <div class="panel-title">Seus produtos</div>
            ${d.dinheiroAgora.produtoFoco ? `<div class="d-flex justify-content-between align-items-start"><div><a href="#/e/produtos/${d.dinheiroAgora.produtoFoco.id}" class="fw-bold text-body h3">${H.esc(d.dinheiroAgora.produtoFoco.nome)}</a>
              <div class="text-muted small mt-1">${d.dinheiroAgora.produtoFoco.leads_ativos} lead(s) ativo(s) · ${d.dinheiroAgora.produtoFoco.ofertas} oferta(s) pronta(s) ou em teste</div></div>
              <span class="money-num">${H.brl(d.dinheiroAgora.produtoFoco.preco)}</span></div>` : '<p class="empty">Cadastre produtos.</p>'}
          </div>
          <div class="panel">
            <div class="panel-title">Propostas em jogo <a href="#/e/propostas">Todas</a></div>
            ${d.dinheiroAgora.propostasPend.length ? `<ul class="mini-list">${d.dinheiroAgora.propostasPend.map((p) => `<li><div><a href="#/e/propostas/${p.id}" class="text-body">${H.esc(p.titulo)}</a><div>${H.tag(p.status)}</div></div><span class="money-num">${H.brl(p.valor)}</span></li>`).join('')}</ul>` : '<p class="empty">Nenhuma proposta pendente.</p>'}
          </div>
        </div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-lg-4"><div class="panel">
          <div class="panel-title">Funil de leads</div>
          ${d.funil.etapas.map((e) => `<div class="funnel-row ${e.estagio === 'Cliente' ? 'win' : e.estagio === 'Perdido' ? 'lost' : ''}"><span>${H.esc(e.estagio)}</span><div class="funnel-bar"><span style="width:${(e.total / maxFunil) * 100}%"></span></div><strong class="text-end">${e.total}</strong></div>`).join('')}
          <p class="text-muted small mt-3 mb-0">${d.funil.qualificados30} lead(s) qualificado(s) (quente ou morno) em 30 dias. Propostas: ${d.comercial.propostasFechadas} fechada(s) de ${d.comercial.propostasEnviadas} enviada(s).</p>
        </div></div>
        <div class="col-lg-8"><div class="panel">
          <div class="panel-title">Receita e despesa, últimos 6 meses <a href="#/e/financeiro">Lançamentos</a></div>
          <div style="height:240px"><canvas id="chFin" aria-label="Gráfico de receita e despesa"></canvas></div>
        </div></div>
      </div>

      <div class="row g-3">
        <div class="col-lg-6"><div class="panel">
          <div class="panel-title">Prioridades da semana <a href="#/e/tarefas">Tarefas</a></div>
          ${d.execucao.prioridades.length ? `<ul class="mini-list">${d.execucao.prioridades.map((t) => `<li><div><a class="text-body" href="#/e/tarefas/${t.id}">${H.esc(t.tarefa)}</a><div class="meta">${H.esc(t.projeto || '')}${t.prazo ? ` · até ${H.date(t.prazo)}` : ''}${t.atrasada ? ' · <span class="text-danger">atrasada</span>' : ''}</div></div>${H.tag(t.impacto)}</li>`).join('')}</ul>` : '<p class="empty">Nenhuma tarefa aberta.</p>'}
        </div></div>
        <div class="col-lg-3"><div class="panel">
          <div class="panel-title">Campanhas</div>
          <ul class="mini-list">
            <li><span>Investido</span><span class="money-num">${H.brlShort(d.campanhas.inv)}</span></li>
            <li><span>CPL</span><strong>${H.brl(d.campanhas.cpl)}</strong></li>
            <li><span>CAC</span><strong>${H.brl(d.campanhas.cac)}</strong></li>
            <li><span>ROI</span><strong class="${d.campanhas.roi < 0 ? 'text-danger' : ''}">${H.pct(d.campanhas.roi)}</strong></li>
          </ul>
        </div></div>
        ${d.conteudoTop.length ? `<div class="col-lg-3"><div class="panel"><div class="panel-title">Conteúdo que mais gerou lead</div><ul class="mini-list">${d.conteudoTop.map((c) => `<li><span class="cell-clip">${H.esc(c.tema)}</span><strong>${c.leads_gerados}</strong></li>`).join('')}</ul>` : ''}
        </div></div>
      </div>`;

    new Chart(root.querySelector('#chFin'), {
      type: 'bar',
      data: {
        labels: f.serie.map((s) => s.mes),
        datasets: [
          { label: 'Receita', data: f.serie.map((s) => s.receita), backgroundColor: '#c99a2e', borderRadius: 4 },
          { label: 'Despesa', data: f.serie.map((s) => s.despesa), backgroundColor: '#0a3355', borderRadius: 4 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { family: 'Inter' }, color: '#000' } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${H.brl(c.raw)}` } } },
        scales: { y: { ticks: { callback: (v) => H.brlShort(v), color: '#546370' }, grid: { color: '#eef2f6' } }, x: { ticks: { color: '#000' }, grid: { display: false } } },
      },
    });
  },

  // ---------------- Funil (kanban) de leads ----------------
  async leads(root) {
    const estagios = App.meta.leads.fields.find((f) => f.name === 'estagio').options;
    const load = async () => {
      const rows = await API.get('/e/leads');
      const hoje = H.today();
      root.querySelector('#kb').innerHTML = estagios.map((e) => {
        const items = rows.filter((r) => (r.estagio || 'Novo') === e);
        const total = items.reduce((s, r) => s + (r.valor_potencial || 0), 0);
        return `<div class="kcol" data-estagio="${H.esc(e)}">
          <div class="kcol-head"><span>${H.esc(e)} (${items.length})</span><span>${total ? H.brlShort(total) : ''}</span></div>
          ${items.map((r) => `<div class="kcard ${r.proximo_contato && r.proximo_contato < hoje && !['Cliente', 'Perdido'].includes(e) ? 'overdue' : ''}" draggable="true" data-id="${r.id}" tabindex="0" role="button" aria-label="${H.esc(r.nome)}">
            <div class="d-flex justify-content-between gap-2"><span class="kname">${H.esc(r.nome)}</span>${r.temperatura ? H.tag(r.temperatura) : ''}</div>
            <div class="kmeta"><span>${H.esc(r.produto_id__label || r.marca || '')}</span>${r.valor_potencial ? `<span class="money-num">${H.brlShort(r.valor_potencial)}</span>` : ''}</div>
            ${r.proximo_contato ? `<div class="kmeta"><span>Próximo: ${H.date(r.proximo_contato)}</span></div>` : ''}
          </div>`).join('')}
        </div>`;
      }).join('');
      root._rows = rows;
    };
    root.innerHTML = `
      <div class="page-head"><div><h1>Funil de leads</h1><p>Arraste o lead para mudar de etapa. Borda vermelha indica follow-up atrasado.</p></div>
        <div class="d-flex gap-2"><a class="btn btn-light" href="#/e/leads"><i class="bi bi-table"></i> Tabela</a><button class="btn btn-primary" id="novo"><i class="bi bi-plus-lg"></i> Novo lead</button></div></div>
      <div class="kanban" id="kb"></div>`;
    await load();
    const kb = root.querySelector('#kb');
    let dragId = null;
    kb.addEventListener('dragstart', (e) => { dragId = e.target.closest('.kcard')?.dataset.id; e.dataTransfer.effectAllowed = 'move'; });
    kb.addEventListener('dragover', (e) => { const c = e.target.closest('.kcol'); if (c) { e.preventDefault(); c.classList.add('drag-over'); } });
    kb.addEventListener('dragleave', (e) => e.target.closest('.kcol')?.classList.remove('drag-over'));
    kb.addEventListener('drop', async (e) => {
      const c = e.target.closest('.kcol'); if (!c || !dragId) return;
      e.preventDefault(); c.classList.remove('drag-over');
      try { await API.post(`/leads/${dragId}/mover`, { estagio: c.dataset.estagio }); await load(); App.refreshBadges(); } catch (err) { H.toast(err.message, 'error'); }
    });
    const open = (card) => { const r = root._rows.find((x) => x.id === Number(card.dataset.id)); UI.openForm('leads', r, load); };
    kb.addEventListener('click', (e) => { const card = e.target.closest('.kcard'); if (card) open(card); });
    kb.addEventListener('keydown', (e) => { const card = e.target.closest('.kcard'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(card); } });
    root.querySelector('#novo').addEventListener('click', () => UI.openForm('leads', null, load, { estagio: 'Novo' }));
  },

  // ---------------- Aprovações (kanban por tipo) ----------------
  async aprovacoes(root) {
    const tipos = App.meta.aprovacoes.fields.find((f) => f.name === 'tipo').options;
    const admin = App.user.papel === 'admin';
    root.innerHTML = `
      <div class="page-head"><div><h1>Aprovações</h1><p>Ações sensíveis passam pelo fundador antes de acontecer. ${admin ? 'Aprove ou recuse cada pedido, ou arraste o cartão para a coluna Aprovada.' : 'Acompanhe aqui os seus pedidos.'}</p></div>
        <button class="btn btn-primary" id="novo"><i class="bi bi-plus-lg"></i> Novo pedido</button></div>
      <div class="kanban kanban-ap" id="kb"></div>
      <details class="mt-3" id="rec"><summary class="small fw-semibold"></summary><ul class="mini-list mt-2" id="recl"></ul></details>`;
    const card = (r, aprovada) => `<div class="kcard ${aprovada ? 'ok' : ''}" ${admin && !aprovada ? 'draggable="true"' : ''} data-id="${r.id}">
        <div class="kname">${H.esc(r.titulo)}</div>
        ${r.detalhes ? `<div class="kmeta"><span>${H.esc(r.detalhes)}</span></div>` : ''}
        <div class="kmeta"><span>${aprovada ? `${H.esc(r.tipo || '')} · por ${H.esc(r.decidido_por || '')} em ${H.date(r.decidido_em)}` : `Pedido por ${H.esc(r.solicitante || '')}`}</span></div>
        ${aprovada && r.comentario ? `<div class="kmeta fst-italic"><span>“${H.esc(r.comentario)}”</span></div>` : ''}
        ${admin && !aprovada ? `<div class="d-flex flex-wrap gap-1 mt-2"><button class="btn btn-sm btn-teal" data-dec="Aprovada" data-id="${r.id}">Aprovar</button><button class="btn btn-sm btn-light" data-dec="Recusada" data-id="${r.id}">Recusar</button></div>` : ''}
      </div>`;
    const load = async () => {
      const rows = await API.get('/e/aprovacoes');
      const pend = rows.filter((r) => r.status === 'Pendente');
      const aprov = rows.filter((r) => r.status === 'Aprovada');
      const recus = rows.filter((r) => r.status === 'Recusada');
      root.querySelector('#kb').innerHTML = tipos.map((t) => {
        const items = pend.filter((r) => r.tipo === t);
        return `<div class="kcol"><div class="kcol-head"><span>${H.esc(t)}</span><span>${items.length || ''}</span></div>${items.map((r) => card(r, false)).join('') || '<p class="kempty">Nada pendente</p>'}</div>`;
      }).join('') + `<div class="kcol kcol-ok" data-drop="aprovada"><div class="kcol-head"><span><i class="bi bi-check2-circle"></i> Aprovada</span><span>${aprov.length || ''}</span></div>${aprov.slice(0, 30).map((r) => card(r, true)).join('') || '<p class="kempty">Nenhuma ainda</p>'}</div>`;
      const rec = root.querySelector('#rec');
      rec.classList.toggle('d-none', !recus.length);
      rec.querySelector('summary').textContent = `Recusadas (${recus.length})`;
      root.querySelector('#recl').innerHTML = recus.map((r) => `<li><div><strong>${H.esc(r.titulo)}</strong><div class="meta">${H.esc(r.tipo || '')} · recusada por ${H.esc(r.decidido_por || '')} em ${H.date(r.decidido_em)}${r.comentario ? ` · “${H.esc(r.comentario)}”` : ''}</div></div></li>`).join('');
      App.refreshBadges();
    };
    const decidir = async (id, decisao) => {
      const r = (await API.get('/e/aprovacoes')).find((x) => x.id === Number(id));
      const comentario = prompt(`${decisao === 'Aprovada' ? 'Aprovar' : 'Recusar'}: "${r?.titulo || ''}"\nComentário (opcional):`, '');
      if (comentario === null) return;
      try { await API.post(`/aprovacoes/${id}/decidir`, { decisao, comentario }); H.toast(decisao === 'Aprovada' ? 'Aprovado.' : 'Recusado.'); await load(); } catch (err) { H.toast(err.message, 'error'); }
    };
    await load();
    const kb = root.querySelector('#kb');
    kb.addEventListener('click', (e) => { const b = e.target.closest('[data-dec]'); if (b) decidir(b.dataset.id, b.dataset.dec); });
    let dragId = null;
    kb.addEventListener('dragstart', (e) => { dragId = e.target.closest('.kcard')?.dataset.id; });
    kb.addEventListener('dragover', (e) => { const c = e.target.closest('[data-drop]'); if (c && dragId) { e.preventDefault(); c.classList.add('drag-over'); } });
    kb.addEventListener('dragleave', (e) => e.target.closest('[data-drop]')?.classList.remove('drag-over'));
    kb.addEventListener('drop', (e) => { const c = e.target.closest('[data-drop]'); if (!c || !dragId) return; e.preventDefault(); c.classList.remove('drag-over'); decidir(dragId, 'Aprovada'); dragId = null; });
    root.querySelector('#novo').addEventListener('click', () => UI.openForm('aprovacoes', null, load));
  },

  // ---------------- Agentes ----------------
  async core(root) {
    const [status, agentes] = await Promise.all([API.get('/core/status'), API.get('/e/agentes?ativo=Sim')]);
    agentes.sort((a, b) => a.id - b.id);
    let agente = sessionStorage.getItem('hm_agente') || 'Core';
    const comandos = [
      'Me diga onde tem dinheiro parado agora.',
      'Priorize minhas ações da semana.',
      'Quais leads precisam de follow-up hoje?',
    ];
    root.innerHTML = `
      <div class="page-head"><div><h1>Agentes</h1><p>Converse com o Core ou com os especialistas. Eles analisam seus produtos, ofertas, leads e indicadores e respondem com uma decisão e a próxima ação prática.</p></div>
        <div class="d-flex gap-2 align-items-center">${App.user.papel === 'admin' ? '<button class="btn btn-light" id="cfgAg"><i class="bi bi-sliders"></i> Configurar agentes</button>' : ''}
        ${status.disponivel ? `<span class="ia-pill ${status.ativa ? 'on' : ''}">${status.ativa ? '<i class="bi bi-stars"></i> IA ligada' : 'Modo básico'}</span>` : ''}</div></div>
      ${IA.bannerSemIA('No modo básico, o Core responde com alertas e prioridades calculados a partir dos seus dados. Com a IA ativada, ele analisa ideias, escreve ofertas, campanhas e mensagens.')}
      <div class="row g-3">
        <div class="col-lg-3 col-xl-2"><div class="panel agent-list">
          <div class="panel-title">Quem responde</div>
          <a href="#" class="side-link" data-ag="Core"><i class="bi bi-cpu"></i> Core (coordenação)</a>
          ${agentes.map((a) => `<a href="#" class="side-link" data-ag="${H.esc(a.nome)}" title="${H.esc(a.pergunta)}"><i class="bi bi-person-gear"></i> ${H.esc(a.nome)}</a>`).join('')}
        </div></div>
        <div class="col-lg-9 col-xl-10">
          <div class="chat">
            <div class="chat-header d-flex justify-content-between align-items-center">
              <div>
                <div class="d-flex align-items-center gap-2">
                  <h2 class="h5 mb-0 fw-bold" id="chatAgNome">${H.esc(agente === 'Core' ? 'Core' : 'Agente ' + agente)}</h2>
                  <span class="badge rounded-pill bg-light text-navy border" id="chatAgTipo">${H.esc(agente === 'Core' ? 'Coordenação e Decisão' : 'Especialista')}</span>
                </div>
                <div class="text-muted small mt-1" id="chatAgPergunta"></div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <button class="btn btn-sm btn-outline-secondary" type="button" id="clr" title="Limpar histórico deste agente"><i class="bi bi-trash3"></i> Limpar conversa</button>
              </div>
            </div>
            <div class="chat-log" id="log" aria-live="polite"></div>
            <div class="chat-input">
              <div class="d-flex flex-wrap gap-2 mb-2" id="chips">${comandos.map((c) => `<button type="button" class="chip">${H.esc(c.replace(/: $/, ''))}</button>`).join('')}</div>
              <form id="f" class="d-flex gap-2 align-items-end">
                <textarea class="form-control" id="m" rows="2" placeholder="Escreva uma pergunta ou cole um texto para análise…" aria-label="Mensagem"></textarea>
                <div class="d-flex flex-column gap-1"><button class="btn btn-primary" type="submit">Enviar</button></div>
              </form>
            </div>
          </div>
        </div>
      </div>`;
    const log = root.querySelector('#log');
    const m = root.querySelector('#m');
    const render = (items) => {
      const curAg = agentes.find((a) => a.nome === agente);
      const perg = agente === 'Core' ? 'Onde existe dinheiro parado, mal estruturado ou ainda não capturado?' : (curAg?.pergunta || '');
      root.querySelector('#chatAgNome').textContent = agente === 'Core' ? 'Holding Money Core' : 'Agente ' + agente;
      root.querySelector('#chatAgTipo').textContent = agente === 'Core' ? 'Coordenação Central' : 'Especialista em ' + agente;
      root.querySelector('#chatAgPergunta').textContent = perg ? `Pergunta central: ${perg}` : '';

      log.innerHTML = items.length ? items.map((x) => x.papel === 'user'
        ? `<div class="msg msg-user">${H.esc(x.conteudo)}</div>`
        : `<div class="msg msg-ai">${H.md(x.conteudo)}</div>`).join('')
        : `<div class="p-4 bg-light rounded-3 border text-center my-auto" style="max-width:680px; margin: 2.5rem auto;">
            <p class="small text-secondary mb-0">escolha seu agente e comece a conversar</p>
          </div>`;
      log.scrollTop = log.scrollHeight;
    };
    const loadHist = async () => {
      root.querySelectorAll('[data-ag]').forEach((a) => a.classList.toggle('active', a.dataset.ag === agente));
      render(await API.get(`/core/historico?agente=${encodeURIComponent(agente)}`));
    };
    root.querySelector('.agent-list').addEventListener('click', (e) => {
      const a = e.target.closest('[data-ag]'); if (!a) return;
      e.preventDefault(); agente = a.dataset.ag; sessionStorage.setItem('hm_agente', agente); loadHist();
    });
    root.querySelector('#chips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      const full = comandos.find((x) => x.startsWith(c.textContent));
      m.value = full; m.focus();
      if (!full.endsWith(': ')) root.querySelector('#f').requestSubmit();
    });
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); root.querySelector('#f').requestSubmit(); } });
    root.querySelector('#clr').addEventListener('click', async () => { await API.del(`/core/historico?agente=${encodeURIComponent(agente)}`); loadHist(); });
    root.querySelector('#cfgAg')?.addEventListener('click', () => Views.configurarAgentes(() => Views.core(root)));
    root.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const txt = m.value.trim(); if (!txt) return;
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true; m.value = '';
      log.insertAdjacentHTML('beforeend', `<div class="msg msg-user">${H.esc(txt)}</div><div class="msg msg-ai text-muted" id="typing">Analisando os dados do negócio…</div>`);
      log.scrollTop = log.scrollHeight;
      try {
        const r = await API.post('/core/chat', { mensagem: txt, agente });
        root.querySelector('#typing').outerHTML = `<div class="msg msg-ai">${H.md(r.resposta)}</div>`;
      } catch (err) {
        root.querySelector('#typing').outerHTML = `<div class="msg msg-ai text-danger">${H.esc(err.message)}</div>`;
        m.value = txt;
      }
      log.scrollTop = log.scrollHeight;
      btn.disabled = false;
    });
    await loadHist();
  },

  // ---------------- Checklist diário ----------------
  async checklist(root, data) {
    const c = await API.get(`/checklist${data ? `?data=${data}` : ''}`);
    root.innerHTML = `
      <div class="page-head"><div><h1>Checklist diário</h1><p>Revisão diária para ação. A última pergunta vira a ação de dinheiro do dia no painel.</p></div>
        <div class="d-flex gap-2 align-items-center"><label class="form-label mb-0" for="dt">Dia</label><input type="date" class="form-control" id="dt" value="${c.data}"></div></div>
      <form id="f" class="panel" style="max-width:860px">
        ${c.perguntas.map((q, i) => `<div class="mb-4">
          <label class="form-label h3 d-block" for="q_${q.id}">${i + 1}. ${H.esc(q.pergunta)}</label>
          <div class="text-muted small mb-2">${H.esc(q.dica)}</div>
          <textarea class="form-control" rows="2" id="q_${q.id}" name="${q.id}">${H.esc(c.respostas[q.id] || '')}</textarea>
          ${c.sugestoes[q.id] ? `<button type="button" class="btn btn-link btn-sm px-0" data-sug="${q.id}">Usar sugestão do sistema: ${H.esc(c.sugestoes[q.id])}</button>` : ''}
        </div>`).join('')}
        <div class="d-flex gap-2"><button class="btn btn-primary" type="submit">Salvar checklist</button><button class="btn btn-light" type="button" id="all">Preencher vazios com sugestões</button></div>
      </form>
      ${c.historico.length ? `<p class="text-muted small mt-3">Dias preenchidos: ${c.historico.map((d) => `<a href="#/checklist/${d}">${H.date(d)}</a>`).join(', ')}</p>` : ''}`;
    root.querySelector('#dt').addEventListener('change', (e) => { location.hash = `#/checklist/${e.target.value}`; });
    root.querySelectorAll('[data-sug]').forEach((b) => b.addEventListener('click', () => { root.querySelector(`#q_${b.dataset.sug}`).value = c.sugestoes[b.dataset.sug]; }));
    root.querySelector('#all').addEventListener('click', () => c.perguntas.forEach((q) => { const t = root.querySelector(`#q_${q.id}`); if (!t.value.trim() && c.sugestoes[q.id]) t.value = c.sugestoes[q.id]; }));
    root.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const respostas = Object.fromEntries(new FormData(e.target));
      try { await API.put('/checklist', { data: c.data, respostas }); H.toast('Checklist salvo.'); } catch (err) { H.toast(err.message, 'error'); }
    });
  },

  // ---------------- Relatório semanal ----------------
  async relatorios(root, id) {
    const { secoes, lista } = await API.get('/relatorios');
    const atual = id ? await API.get(`/relatorios/${id}`).catch(() => null) : null;
    root.innerHTML = `
      <div class="page-head"><div><h1>Relatório semanal</h1><p>Relatório para decisão. O sistema preenche com os dados dos últimos 7 dias; você revisa e completa.</p></div>
        <div class="d-flex gap-2 no-print"><button class="btn btn-primary" id="gerar"><i class="bi bi-magic"></i> Gerar relatório da semana</button></div></div>
      <div class="row g-3">
        <div class="col-lg-3 no-print"><div class="panel">
          <div class="panel-title">Relatórios</div>
          ${lista.length ? lista.map((r) => `<a class="side-link ${atual?.id === r.id ? 'active' : ''}" href="#/relatorios/${r.id}"><i class="bi bi-file-text"></i> ${H.date(r.semana_inicio)} a ${H.date(r.semana_fim)}</a>`).join('') : '<p class="empty">Nenhum relatório ainda.</p>'}
        </div></div>
        <div class="col-lg-9">${atual ? `
          <form id="f" class="panel">
            <div class="d-flex justify-content-between align-items-center mb-3"><h2 class="mb-0">Semana de ${H.date(atual.semana_inicio)} a ${H.date(atual.semana_fim)}</h2>
              <div class="d-flex gap-2 no-print"><button type="button" class="btn btn-light" id="print"><i class="bi bi-printer"></i> Imprimir</button><button type="button" class="btn btn-link text-danger" id="del">Excluir</button></div></div>
            ${secoes.map(([k, label], i) => `<div class="mb-3"><label class="form-label h3 d-block" for="s_${k}">${i + 1}. ${H.esc(label)}</label>
              <textarea class="form-control" id="s_${k}" name="${k}" rows="${Math.min(10, Math.max(2, (atual.secoes[k] || '').split('\n').length + 1))}">${H.esc(atual.secoes[k] || '')}</textarea></div>`).join('')}
            <button class="btn btn-primary no-print" type="submit">Salvar relatório</button>
          </form>` : '<div class="panel panel-mist text-center py-5">Selecione um relatório ou gere o desta semana.</div>'}
        </div>
      </div>`;
    root.querySelector('#gerar').addEventListener('click', async () => {
      try { const r = await API.post('/relatorios/gerar'); H.toast('Relatório gerado. Revise e complete.'); location.hash = `#/relatorios/${r.id}`; } catch (err) { H.toast(err.message, 'error'); }
    });
    if (atual) {
      root.querySelector('#print').addEventListener('click', () => window.print());
      root.querySelector('#del').addEventListener('click', async () => { if (confirm('Excluir este relatório?')) { await API.del(`/relatorios/${atual.id}`); location.hash = '#/relatorios'; } });
      root.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await API.put(`/relatorios/${atual.id}`, { secoes: Object.fromEntries(new FormData(e.target)) }); H.toast('Relatório salvo.'); } catch (err) { H.toast(err.message, 'error'); }
      });
    }
  },

  // ---------------- Score Holding Money ----------------
  // Configuração dos agentes (modal aberto a partir da tela Agentes)
  async configurarAgentes(onClose) {
    const el = document.createElement('div');
    el.className = 'modal fade'; el.tabIndex = -1;
    el.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><h2 class="modal-title">Configurar agentes</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>
      <div class="modal-body"><p class="text-muted small">Ative os especialistas que fazem sentido para o seu negócio e ajuste a função e as instruções de cada um.</p><ul class="mini-list" id="agl"></ul></div>
      <div class="modal-footer"><button class="btn btn-light me-auto" id="novoAg"><i class="bi bi-plus-lg"></i> Novo agente</button><button type="button" class="btn btn-primary" data-bs-dismiss="modal">Pronto</button></div>
    </div></div>`;
    document.body.appendChild(el);
    const modal = new bootstrap.Modal(el);
    let mudou = false;
    const carregar = async () => {
      const ags = (await API.get('/e/agentes')).sort((a, b) => a.id - b.id);
      el.querySelector('#agl').innerHTML = ags.map((a) => `<li><div class="form-check form-switch mb-0 me-2"><input class="form-check-input" type="checkbox" role="switch" data-on="${a.id}" id="ag${a.id}" ${a.ativo === 'Sim' ? 'checked' : ''}><label class="visually-hidden" for="ag${a.id}">Ativar ${H.esc(a.nome)}</label></div>
        <div class="flex-grow-1"><strong>${H.esc(a.nome)}</strong><div class="meta">${H.esc(a.funcao || '')}</div></div>
        <button class="btn btn-sm btn-light" data-ed="${a.id}">Editar</button></li>`).join('');
      el.querySelectorAll('[data-on]').forEach((sw) => sw.addEventListener('change', async () => {
        try { await API.put(`/e/agentes/${sw.dataset.on}`, { ativo: sw.checked ? 'Sim' : 'Não' }); mudou = true; } catch (err) { sw.checked = !sw.checked; H.toast(err.message, 'error'); }
      }));
      el.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', () => {
        const row = ags.find((a) => a.id === Number(b.dataset.ed));
        modal.hide(); UI.openForm('agentes', row, () => { mudou = true; }, {}, () => Views.configurarAgentes(onClose));
      }));
    };
    el.querySelector('#novoAg').addEventListener('click', () => { modal.hide(); UI.openForm('agentes', null, () => { mudou = true; }, { ativo: 'Sim' }, () => Views.configurarAgentes(onClose)); });
    el.addEventListener('hidden.bs.modal', () => { el.remove(); if (mudou && onClose) onClose(); });
    await carregar();
    modal.show();
  },

  async identidade(root) {
    const c = await API.get('/config');
    const admin = App.user.papel === 'admin';
    const campos = [
      ['nome', 'Nome do sistema', 'text'], ['subtitulo', 'Subtítulo', 'text'],
      ['missao', 'Missão', 'textarea'], ['funcao', 'Função principal', 'textarea'],
      ['produtos_prioritarios', 'Produtos prioritários', 'textarea'], ['principios', 'Princípios inegociáveis', 'textarea'],
      ['frase', 'Frase de comando', 'textarea'], ['manifesto', 'Manifesto operacional', 'textarea'],
      ['prompt_extra', 'Orientações extras para o Core (ex.: tom de voz, o que evitar, prioridades do momento)', 'textarea'],
    ];
    root.innerHTML = `
      <div class="page-head"><div><h1>Identidade e doutrina</h1><p>Define como o Holding Money pensa, decide e orienta você. Os dados da empresa (o que vende, público, meta) ficam em <a href="#/onboarding">Contexto da empresa</a>.</p></div></div>
      <form id="f" class="panel" style="max-width:900px"><fieldset ${admin ? '' : 'disabled'}><div class="row g-3">
        ${campos.map(([k, l, t]) => `<div class="${t === 'textarea' ? 'col-12' : 'col-md-6'}"><label class="form-label" for="c_${k}">${H.esc(l)}</label>
          ${t === 'textarea' ? `<textarea class="form-control" id="c_${k}" name="${k}" rows="${k === 'manifesto' || k === 'prompt_extra' ? 5 : 2}">${H.esc(c[k] || '')}</textarea>` : `<input class="form-control" type="${t}" id="c_${k}" name="${k}" value="${H.esc(c[k] || '')}">`}</div>`).join('')}
      </div>
      ${admin ? '<button class="btn btn-primary mt-3" type="submit">Salvar identidade</button>' : '<p class="text-muted mt-3 mb-0">Somente o fundador altera a identidade.</p>'}</fieldset></form>`;
    root.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await API.put('/config', Object.fromEntries(new FormData(e.target))); H.toast('Identidade salva.'); App.loadConfig(); } catch (err) { H.toast(err.message, 'error'); }
    });
  },

  // ---------------- Formulários e integrações ----------------
  // ---------------- Configurações (fora do menu principal) ----------------
  async ajustes(root, aba) {
    const admin = App.user.papel === 'admin';
    const abas = AJUSTES.filter(([, , , req]) => req !== 'admin' || admin);
    const atual = abas.find(([k]) => k === aba)?.[0] || abas[0][0];
    root.innerHTML = `<nav class="ajustes-tabs mb-4" aria-label="Configurações">${abas.map(([k, icon, label]) => `<a href="#/ajustes/${k}" class="${k === atual ? 'on' : ''}" ${k === atual ? 'aria-current="page"' : ''}><i class="bi bi-${icon}"></i> ${H.esc(label)}</a>`).join('')}</nav><div id="aj"></div>`;
    const box = root.querySelector('#aj');
    if (atual === 'formularios') await Views.integracoes(box);
    else await Views.usuarios(box);
  },

  async integracoes(root) {
    if (App.user.papel !== 'admin') { root.innerHTML = '<h1>Conexões e integrações</h1><p>Somente o fundador acessa esta área.</p>'; return; }
    const i = await API.get('/integracoes');
    root.innerHTML = `
      <div class="page-head"><div><h1>Conexões e integrações</h1><p>Receba contatos automaticamente de ferramentas externas diretamente no funil de leads.</p></div></div>
      <div class="panel">
        <div class="panel-title mb-1">Receber contatos via Webhook <span class="text-muted small fw-normal">(Make, n8n, Zapier, Typeform, Tally)</span></div>
        <p class="text-muted small mt-2">Cole o endereço e a chave abaixo na sua ferramenta de automação. Cada contato enviado entra direto no funil de leads.</p>
        <div class="row g-3 mt-1">
          <div class="col-lg-7"><label class="form-label" for="wurl">Endereço de envio (Webhook URL)</label>
            <div class="input-group"><input class="form-control" id="wurl" readonly value="${H.esc(i.webhookUrl)}"><button class="btn btn-light" data-copyval="#wurl"><i class="bi bi-clipboard"></i> Copiar</button></div></div>
          <div class="col-lg-5"><label class="form-label" for="wtok">Chave de acesso (Token)</label>
            <div class="input-group"><input class="form-control" id="wtok" type="password" readonly value="${H.esc(i.webhookToken)}"><button class="btn btn-light" id="show" aria-label="Mostrar chave"><i class="bi bi-eye"></i></button><button class="btn btn-light" data-copyval="#wtok"><i class="bi bi-clipboard"></i> Copiar</button></div>
            <div class="form-text">Na ferramenta, envie a chave no cabeçalho <span class="kw">x-webhook-token</span>.</div></div>
        </div>
        <p class="small mt-4 mb-2"><strong>Campos que o sistema entende</strong> (use estes nomes na ferramenta):</p>
        <div class="d-flex flex-wrap gap-1 small">${[['nome', 'obrigatório'], ['contato', 'WhatsApp ou e-mail'], ['empresa', ''], ['origem', 'de onde veio'], ['dor', 'o problema do contato'], ['temperatura', 'Quente, Morno ou Frio'], ['observacoes', '']].map(([k, d]) => `<span class="kw-chip"><span class="kw">${k}</span>${d ? ` ${d}` : ''}</span>`).join('')}</div>
      </div>`;
    root.querySelectorAll('[data-copyval]').forEach((b) => b.addEventListener('click', async () => { await navigator.clipboard.writeText(root.querySelector(b.dataset.copyval).value); H.toast('Copiado.'); }));
    root.querySelector('#show').addEventListener('click', () => { const t = root.querySelector('#wtok'); t.type = t.type === 'password' ? 'text' : 'password'; });
  },

  // ---------------- Inteligência artificial ----------------
  async ia(root) {
    const st = await API.get('/core/status');
    App.ia = st.ativa; App.iaDisp = st.disponivel;
    const admin = App.user.papel === 'admin';
    root.innerHTML = `
      <div class="page-head"><div><h1>Inteligência artificial</h1><p>Com a IA ligada, o Holding Money monta a estrutura do seu negócio, sugere produtos, ofertas, conteúdos e mensagens de venda, e o Core analisa ideias com profundidade.</p></div></div>
      <div class="panel" style="max-width:760px">
        ${st.disponivel ? `
          <div class="d-flex align-items-start gap-3">
            <div class="form-check form-switch fs-5 mb-0"><input class="form-check-input" type="checkbox" role="switch" id="swia" ${st.ativa ? 'checked' : ''} ${admin ? '' : 'disabled'}></div>
            <div><label for="swia" class="fw-semibold">Usar inteligência artificial</label>
              <p class="text-muted small mb-0" id="iadesc">${st.ativa ? 'Ligada. Sugestões e análises completas estão disponíveis em todo o sistema.' : 'Desligada. O sistema funciona no modo básico: alertas e prioridades calculados a partir dos seus dados.'}</p>
              ${admin ? '' : '<p class="text-muted small mb-0 mt-1">Somente o fundador liga ou desliga a IA.</p>'}</div>
          </div>
          <hr><p class="small text-muted mb-0">A IA só propõe: nada é salvo sem a sua confirmação, e ela não inventa clientes, provas ou resultados.</p>`
        : '<p class="mb-0">A inteligência artificial não está disponível no momento. O sistema segue funcionando no modo básico.</p>'}
      </div>`;
    root.querySelector('#swia')?.addEventListener('change', async (e) => {
      try {
        const r = await API.put('/core/ia', { ativa: e.target.checked });
        App.ia = r.ativa;
        root.querySelector('#iadesc').textContent = r.ativa ? 'Ligada. Sugestões e análises completas estão disponíveis em todo o sistema.' : 'Desligada. O sistema funciona no modo básico: alertas e prioridades calculados a partir dos seus dados.';
        H.toast(r.ativa ? 'IA ligada.' : 'IA desligada.');
      } catch (err) { e.target.checked = !e.target.checked; H.toast(err.message, 'error'); }
    });
  },

  // ---------------- Usuários e conta ----------------
  async usuarios(root) {
    const admin = App.user.papel === 'admin';
    const users = admin ? await API.get('/auth/usuarios') : [];
    root.innerHTML = `
      <div class="page-head"><div><h1>Usuários e conta</h1><p>O fundador aprova preços, propostas e decisões financeiras. Operadores preparam, organizam e pedem aprovação.</p></div></div>
      <div class="row g-3">
        ${admin ? `<div class="col-lg-7"><div class="panel"><div class="panel-title">Equipe</div>
          <ul class="mini-list">${users.map((u) => `<li><div><strong>${H.esc(u.nome)}</strong><div class="meta">${H.esc(u.email)}</div></div>
            <div class="d-flex gap-2 align-items-center">${H.tag(u.papel === 'admin' ? 'Fundador' : 'Operador')}${u.id !== App.user.id ? `<button class="btn btn-sm btn-link text-danger" data-del="${u.id}">Remover</button>` : ''}</div></li>`).join('')}</ul>
          <form id="fu" class="row g-2 mt-3">
            <div class="col-md-6"><input class="form-control" name="nome" placeholder="Nome" required aria-label="Nome"></div>
            <div class="col-md-6"><input class="form-control" name="email" type="email" placeholder="E-mail" required aria-label="E-mail"></div>
            <div class="col-md-6"><input class="form-control" name="senha" type="password" placeholder="Senha (mín. 8)" minlength="8" required aria-label="Senha"></div>
            <div class="col-md-3"><select class="form-select" name="papel" aria-label="Papel"><option value="operador">Operador</option><option value="admin">Fundador</option></select></div>
            <div class="col-md-3"><button class="btn btn-primary w-100">Adicionar</button></div>
          </form></div></div>` : ''}
        <div class="col-lg-5"><form class="panel" id="fs"><div class="panel-title">Trocar minha senha</div>
          <label class="form-label" for="sa">Senha atual</label><input class="form-control mb-2" type="password" id="sa" name="atual" required>
          <label class="form-label" for="sn">Nova senha</label><input class="form-control mb-3" type="password" id="sn" name="nova" minlength="8" required>
          <button class="btn btn-primary">Salvar nova senha</button></form></div>
      </div>`;
    root.querySelector('#fu')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await API.post('/auth/usuarios', Object.fromEntries(new FormData(e.target))); H.toast('Usuário adicionado.'); Views.usuarios(root); } catch (err) { H.toast(err.message, 'error'); }
    });
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remover este usuário?')) return;
      try { await API.del(`/auth/usuarios/${b.dataset.del}`); Views.usuarios(root); } catch (err) { H.toast(err.message, 'error'); }
    }));
    root.querySelector('#fs').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await API.post('/auth/senha', Object.fromEntries(new FormData(e.target))); H.toast('Senha alterada.'); e.target.reset(); } catch (err) { H.toast(err.message, 'error'); }
    });
  },
};
