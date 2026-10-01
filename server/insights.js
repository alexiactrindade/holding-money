const express = require('express');
const { db, insert } = require('./db');
const { ESTAGIOS_LEAD } = require('./schema');
const { isoDate, addDays, daysBetween, brl } = require('./util');

const router = express.Router();
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);

function getConfig() {
  const out = {};
  for (const r of all("SELECT chave, valor FROM configuracoes WHERE chave LIKE 'identidade.%'")) out[r.chave.slice(11)] = r.valor;
  return out;
}

// ---------- Prioridades: impacto x urgência x esforço ----------
function priorizarTarefas() {
  const hoje = isoDate();
  const peso = { Alto: 3, Médio: 2, Baixo: 1 };
  const rows = all("SELECT * FROM tarefas WHERE status IN ('A fazer','Em andamento','Travada')");
  return rows.map((t) => {
    const impacto = peso[t.impacto] || 1;
    const esforco = peso[t.esforco] || 2;
    let urgencia = 1;
    if (t.prazo) {
      const d = daysBetween(hoje, t.prazo);
      urgencia = d < 0 ? 4 : d <= 1 ? 3.5 : d <= 3 ? 3 : d <= 7 ? 2 : 1;
    }
    const bonusValor = t.valor_estimado > 0 ? Math.min(2, Math.log10(t.valor_estimado) / 2) : 0;
    const score = impacto * 3 + urgencia * 2 + bonusValor - esforco + (t.status === 'Travada' ? 1 : 0);
    return { ...t, score: Math.round(score * 10) / 10, atrasada: t.prazo && t.prazo < hoje };
  }).sort((a, b) => b.score - a.score);
}

// ---------- Dinheiro parado: regras de detecção ----------
function detectarDinheiroParado() {
  const hoje = isoDate();
  const alertas = [];
  const push = (nivel, area, titulo, detalhe, acao, link, valor = 0) => alertas.push({ nivel, area, titulo, detalhe, acao, link, valor });

  for (const l of all("SELECT * FROM leads WHERE estagio NOT IN ('Cliente','Perdido') AND proximo_contato IS NOT NULL AND proximo_contato < ?", hoje)) {
    push('alto', 'Leads', `Follow-up atrasado: ${l.nome}`, `Deveria ter sido contatado em ${l.proximo_contato.split('-').reverse().join('/')}.`, 'Retomar contato hoje com o script de follow-up.', `#/e/leads/${l.id}`, l.valor_potencial);
  }
  for (const l of all("SELECT * FROM leads WHERE temperatura='Quente' AND estagio NOT IN ('Cliente','Perdido') AND (ultimo_contato IS NULL OR ultimo_contato <= ?)", addDays(hoje, -2))) {
    push('alto', 'Leads', `Lead quente sem contato: ${l.nome}`, l.ultimo_contato ? `Último contato há ${daysBetween(l.ultimo_contato, hoje)} dias.` : 'Nenhum contato registrado.', 'Abordar hoje e levar para oferta ou diagnóstico.', `#/e/leads/${l.id}`, l.valor_potencial);
  }
  for (const l of all("SELECT * FROM leads WHERE estagio NOT IN ('Cliente','Perdido') AND proximo_contato IS NULL")) {
    push('medio', 'Leads', `Lead sem próximo passo: ${l.nome}`, 'Não há data de próximo contato.', 'Definir data e mensagem de follow-up.', `#/e/leads/${l.id}`, l.valor_potencial);
  }
  for (const p of all("SELECT * FROM propostas WHERE status='Enviada' AND data_envio IS NOT NULL AND data_envio <= ?", addDays(hoje, -5))) {
    push('alto', 'Propostas', `Proposta sem retorno: ${p.titulo}`, `Enviada há ${daysBetween(p.data_envio, hoje)} dias.`, 'Follow-up B2B enfatizando a perda financeira identificada.', `#/e/propostas/${p.id}`, p.valor);
  }
  for (const p of all("SELECT * FROM propostas WHERE status='Aprovada'")) {
    push('alto', 'Propostas', `Proposta aprovada e não enviada: ${p.titulo}`, 'Já foi aprovada pelo fundador.', 'Enviar hoje.', `#/e/propostas/${p.id}`, p.valor);
  }
  for (const p of all("SELECT p.* FROM produtos p WHERE p.status NOT IN ('Pausado') AND NOT EXISTS (SELECT 1 FROM ofertas o WHERE o.produto_id = p.id)")) {
    push('medio', 'Produtos', `Produto sem oferta: ${p.nome}`, 'Existe produto, mas não existe oferta estruturada.', 'Criar oferta com headline, promessa, prova e CTA.', `#/e/ofertas/novo?produto_id=${p.id}`);
  }
  for (const o of all("SELECT * FROM ofertas WHERE status NOT IN ('Pausada') AND (cta IS NULL OR cta='' OR prova IS NULL OR prova='' OR headline IS NULL OR headline='')")) {
    const falta = [!o.headline && 'headline', !o.prova && 'prova', !o.cta && 'CTA'].filter(Boolean).join(', ');
    push('medio', 'Ofertas', `Oferta incompleta: ${o.nome}`, `Falta: ${falta}.`, 'Completar a oferta antes de investir em tráfego.', `#/e/ofertas/${o.id}`);
  }
  for (const c of all("SELECT * FROM conteudos WHERE status != 'Publicado' AND (cta IS NULL OR cta='' OR produto_id IS NULL)")) {
    push('baixo', 'Conteúdo', `Conteúdo sem função comercial: ${c.tema}`, 'Sem CTA ou sem produto vinculado.', 'Amarrar a um objetivo e a uma próxima ação.', `#/e/conteudos/${c.id}`);
  }
  for (const c of all("SELECT * FROM campanhas WHERE status='Ativa' AND investimento > 0 AND (faturamento - investimento) / investimento < 0")) {
    push('alto', 'Campanhas', `Campanha com ROI negativo: ${c.nome}`, `Investiu ${brl(c.investimento)} e faturou ${brl(c.faturamento)}.`, 'Cortar ou ajustar oferta e segmentação.', `#/e/campanhas/${c.id}`);
  }
  for (const t of all("SELECT * FROM tarefas WHERE status='Travada' AND impacto='Alto'")) {
    push('alto', 'Execução', `Tarefa travando dinheiro: ${t.tarefa}`, 'Impacto financeiro alto e status travada.', 'Remover o bloqueio ou tomar a decisão pendente.', `#/e/tarefas/${t.id}`, t.valor_estimado);
  }
  const pend = get("SELECT COUNT(*) n FROM aprovacoes WHERE status='Pendente'").n;
  if (pend) push('medio', 'Governança', `${pend} aprovação(ões) pendente(s)`, 'Decisões sensíveis aguardando o fundador.', 'Decidir hoje para destravar a operação.', '#/aprovacoes');

  const peso = { alto: 3, medio: 2, baixo: 1 };
  const vistos = new Set();
  return alertas.filter((a) => { if (a.area !== 'Leads') return true; if (vistos.has(a.link)) return false; vistos.add(a.link); return true; }).sort((a, b) => peso[b.nivel] - peso[a.nivel] || (b.valor || 0) - (a.valor || 0));
}

// ---------- Financeiro ----------
function resumoFinanceiro(inicio, fim) {
  const r = get("SELECT COALESCE(SUM(CASE WHEN tipo='Receita' THEN valor END),0) receita, COALESCE(SUM(CASE WHEN tipo='Despesa' THEN valor END),0) despesa, COUNT(CASE WHEN tipo='Receita' THEN 1 END) vendas FROM financeiro WHERE data BETWEEN ? AND ?", inicio, fim);
  const lucro = r.receita - r.despesa;
  return { ...r, lucro, margem: r.receita > 0 ? lucro / r.receita : null, ticket: r.vendas > 0 ? r.receita / r.vendas : null };
}

function serieMensal(meses = 6) {
  const out = [];
  const d = new Date(); d.setDate(1);
  for (let i = meses - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const ini = isoDate(m);
    const fim = isoDate(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    const r = resumoFinanceiro(ini, fim);
    out.push({ mes: m.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), receita: r.receita, despesa: r.despesa });
  }
  return out;
}

// ---------- Painel ----------
router.get('/dashboard', (req, res) => {
  const hoje = isoDate();
  const ini30 = addDays(hoje, -29);
  const iniMes = hoje.slice(0, 8) + '01';

  const funil = ESTAGIOS_LEAD.map((e) => ({ estagio: e, total: get('SELECT COUNT(*) n FROM leads WHERE estagio = ?', e).n }));
  const totalLeads = funil.reduce((s, x) => s + x.total, 0);
  const clientes = funil.find((f) => f.estagio === 'Cliente').total;
  const leads30 = get('SELECT COUNT(*) n FROM leads WHERE date(created_at) >= ?', ini30).n;
  const qualificados30 = get("SELECT COUNT(*) n FROM leads WHERE date(created_at) >= ? AND temperatura IN ('Quente','Morno')", ini30).n;

  const followHoje = all("SELECT id, nome, canal, contato, temperatura, estagio, proximo_contato, mensagem_followup, valor_potencial FROM leads WHERE estagio NOT IN ('Cliente','Perdido') AND proximo_contato <= ? ORDER BY proximo_contato, valor_potencial DESC LIMIT 12", hoje);
  const quentes = all("SELECT id, nome, estagio, valor_potencial FROM leads WHERE temperatura='Quente' AND estagio NOT IN ('Cliente','Perdido') ORDER BY valor_potencial DESC LIMIT 8");
  const propostasPend = all("SELECT id, titulo, status, valor FROM propostas WHERE status IN ('Aguardando aprovação','Aprovada','Enviada') ORDER BY valor DESC LIMIT 8");
  const pipelineValor = get("SELECT COALESCE(SUM(valor_potencial),0) v FROM leads WHERE estagio NOT IN ('Cliente','Perdido')").v;

  // Produto com mais chance: pronto/em teste + mais leads quentes/mornos vinculados
  const produtoFoco = get(`SELECT p.id, p.nome, p.preco, p.status,
      (SELECT COUNT(*) FROM leads l WHERE l.produto_id=p.id AND l.temperatura IN ('Quente','Morno') AND l.estagio NOT IN ('Cliente','Perdido')) AS leads_ativos,
      (SELECT COUNT(*) FROM ofertas o WHERE o.produto_id=p.id AND o.status IN ('Pronta','Em teste')) AS ofertas
    FROM produtos p WHERE p.status NOT IN ('Pausado','Travado')
    ORDER BY (ofertas > 0) DESC, leads_ativos DESC, p.preco DESC LIMIT 1`);

  const produtosStatus = all('SELECT status, COUNT(*) total FROM produtos GROUP BY status');
  const fin30 = resumoFinanceiro(ini30, hoje);
  const finMes = resumoFinanceiro(iniMes, hoje);
  const meta = Number(getConfig().meta_mensal || 0);

  const campanhas = get("SELECT COALESCE(SUM(investimento),0) inv, COALESCE(SUM(leads),0) leads, COALESCE(SUM(vendas),0) vendas, COALESCE(SUM(faturamento),0) fat FROM campanhas WHERE status IN ('Ativa','Encerrada')");
  const conteudoTop = all("SELECT id, tema, canal, leads_gerados FROM conteudos WHERE leads_gerados > 0 ORDER BY leads_gerados DESC LIMIT 5");

  const concluidas30 = get("SELECT COUNT(*) n FROM tarefas WHERE status='Concluída' AND concluida_em >= ?", ini30).n;
  const concluidasImpacto = get("SELECT COUNT(*) n FROM tarefas WHERE status='Concluída' AND impacto='Alto' AND concluida_em >= ?", ini30).n;
  const prioridades = priorizarTarefas().slice(0, 6);
  const propostasEnv = get("SELECT COUNT(*) n FROM propostas WHERE status IN ('Enviada','Aceita','Recusada')").n;
  const propostasFech = get("SELECT COUNT(*) n FROM propostas WHERE status='Aceita'").n;

  const checklist = get('SELECT respostas FROM checklists WHERE data = ?', hoje);
  const acaoDoDia = checklist ? JSON.parse(checklist.respostas).acao_dinheiro : null;
  const alertasAll = detectarDinheiroParado();

  const vazio = ["negocios", "produtos", "ofertas", "leads", "tarefas"].every((t) => get(`SELECT COUNT(*) n FROM ${t}`).n === 0);
  res.json({
    vazio,
    hoje,
    acaoDoDia,
    dinheiroAgora: { produtoFoco, followHoje, quentes, propostasPend, pipelineValor },
    funil: { etapas: funil, totalLeads, conversao: totalLeads > 0 ? clientes / totalLeads : null, leads30, qualificados30 },
    produtos: produtosStatus,
    financeiro: { ultimos30: fin30, mes: finMes, meta, serie: serieMensal(6) },
    comercial: { propostasEnviadas: propostasEnv, propostasFechadas: propostasFech },
    campanhas: {
      ...campanhas,
      cpl: campanhas.leads > 0 ? campanhas.inv / campanhas.leads : null,
      cac: campanhas.vendas > 0 ? campanhas.inv / campanhas.vendas : null,
      roi: campanhas.inv > 0 ? (campanhas.fat - campanhas.inv) / campanhas.inv : null,
    },
    conteudoTop,
    execucao: {
      concluidas30, concluidasImpacto, prioridades,
      // Indicador soberano: receita gerada por ação executada
      receitaPorAcao: concluidas30 > 0 ? fin30.receita / concluidas30 : null,
    },
    alertas: alertasAll.slice(0, 8),
    alertasTotal: alertasAll.length,
  });
});

router.get('/alertas', (req, res) => res.json(detectarDinheiroParado()));
router.get('/prioridades', (req, res) => res.json(priorizarTarefas()));

// ---------- Kanban de leads ----------
router.post('/leads/:id/mover', (req, res) => {
  const { estagio } = req.body || {};
  if (!ESTAGIOS_LEAD.includes(estagio)) return res.status(400).json({ erro: 'Estágio inválido.' });
  db.prepare("UPDATE leads SET estagio=?, ultimo_contato=?, updated_at=datetime('now','localtime') WHERE id=?").run(estagio, isoDate(), req.params.id);
  res.json({ ok: true });
});

router.post('/leads/:id/contatado', (req, res) => {
  const dias = Math.max(1, Math.min(60, Number(req.body?.dias) || 2));
  db.prepare("UPDATE leads SET ultimo_contato=?, proximo_contato=?, estagio=CASE WHEN estagio='Novo' THEN 'Contato feito' ELSE estagio END, updated_at=datetime('now','localtime') WHERE id=?")
    .run(isoDate(), addDays(isoDate(), dias), req.params.id);
  res.json({ ok: true });
});

// ---------- Checklist diário ----------
const CHECKLIST = [
  { id: 'prioridade', pergunta: 'Qual é a prioridade comercial de hoje?', dica: 'Uma ação principal, não uma lista genérica.' },
  { id: 'produto', pergunta: 'Qual produto tem mais chance de vender agora?', dica: 'Produto com oferta clara e lead possível.' },
  { id: 'lead', pergunta: 'Qual lead precisa de follow-up?', dica: 'Nome, canal, mensagem e próximo passo.' },
  { id: 'conteudo', pergunta: 'Qual conteúdo precisa ser publicado?', dica: 'Conteúdo com CTA ligado a produto.' },
  { id: 'oferta', pergunta: 'Qual oferta precisa ser melhorada?', dica: 'Headline, promessa, prova, preço ou CTA.' },
  { id: 'trava', pergunta: 'Qual tarefa está travando dinheiro?', dica: 'Gargalo operacional ou decisão pendente.' },
  { id: 'corte', pergunta: 'O que deve ser cortado?', dica: 'Distração, excesso de projeto ou vaidade estratégica.' },
  { id: 'acao_dinheiro', pergunta: 'Qual é a ação de dinheiro do dia?', dica: 'Atividade concreta que aproxima venda, lead ou proposta.' },
];

function sugestoesChecklist() {
  const hoje = isoDate();
  const pri = priorizarTarefas()[0];
  const lead = get("SELECT nome, canal FROM leads WHERE estagio NOT IN ('Cliente','Perdido') AND proximo_contato <= ? ORDER BY temperatura='Quente' DESC, valor_potencial DESC LIMIT 1", hoje);
  const conteudo = get("SELECT tema FROM conteudos WHERE status IN ('Agendado','Produção','Roteiro') ORDER BY data LIMIT 1");
  const oferta = get("SELECT nome FROM ofertas WHERE status IN ('Fraca','Em teste','Rascunho') LIMIT 1");
  const trava = get("SELECT tarefa FROM tarefas WHERE status='Travada' ORDER BY impacto='Alto' DESC LIMIT 1");
  const corte = get("SELECT tarefa FROM tarefas WHERE status IN ('A fazer','Em andamento') AND impacto='Baixo' AND esforco='Alto' LIMIT 1");
  const produto = get("SELECT p.nome FROM produtos p LEFT JOIN ofertas o ON o.produto_id=p.id WHERE p.status NOT IN ('Pausado','Travado') GROUP BY p.id ORDER BY COUNT(o.id) DESC, p.preco DESC LIMIT 1");
  return {
    prioridade: pri?.tarefa || '',
    produto: produto?.nome || '',
    lead: lead ? `${lead.nome} (${lead.canal || 'canal não informado'})` : '',
    conteudo: conteudo?.tema || '',
    oferta: oferta?.nome || '',
    trava: trava?.tarefa || '',
    corte: corte?.tarefa || '',
    acao_dinheiro: lead ? `Fazer follow-up com ${lead.nome}` : pri?.tarefa || '',
  };
}

router.get('/checklist', (req, res) => {
  const data = /^\d{4}-\d{2}-\d{2}$/.test(req.query.data || '') ? req.query.data : isoDate();
  const row = get('SELECT * FROM checklists WHERE data = ?', data);
  const historico = all('SELECT data FROM checklists ORDER BY data DESC LIMIT 30').map((r) => r.data);
  res.json({ data, perguntas: CHECKLIST, respostas: row ? JSON.parse(row.respostas) : {}, sugestoes: sugestoesChecklist(), historico });
});

router.put('/checklist', (req, res) => {
  const { data, respostas } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) return res.status(400).json({ erro: 'Data inválida.' });
  const clean = {};
  for (const q of CHECKLIST) clean[q.id] = String(respostas?.[q.id] || '').slice(0, 2000);
  db.prepare(`INSERT INTO checklists (data, respostas) VALUES (?, ?)
    ON CONFLICT(data) DO UPDATE SET respostas=excluded.respostas, updated_at=datetime('now','localtime')`).run(data, JSON.stringify(clean));
  res.json({ ok: true });
});

// ---------- Relatório semanal ----------
const SECOES = [
  ['gerou_dinheiro', 'O que gerou dinheiro'],
  ['gerou_oportunidade', 'O que gerou oportunidade'],
  ['travou_receita', 'O que travou receita'],
  ['produtos_potencial', 'Produtos com maior potencial'],
  ['leads_importantes', 'Leads importantes'],
  ['campanhas', 'Campanhas em andamento'],
  ['decisoes_pendentes', 'Decisões pendentes'],
  ['proximas_acoes', 'Próximas ações'],
  ['corte', 'Corte recomendado'],
  ['foco', 'Foco da próxima semana'],
];

function gerarRelatorio(ini, fim) {
  const lista = (arr, fn, vazio) => (arr.length ? arr.map((x) => '- ' + fn(x)).join('\n') : vazio);
  const rec = all("SELECT descricao, valor FROM financeiro WHERE tipo='Receita' AND data BETWEEN ? AND ? ORDER BY valor DESC", ini, fim);
  const totalRec = rec.reduce((s, r) => s + r.valor, 0);
  const aceitas = all("SELECT titulo, valor FROM propostas WHERE status='Aceita' AND date(updated_at) BETWEEN ? AND ?", ini, fim);
  const novos = all('SELECT nome, canal, temperatura FROM leads WHERE date(created_at) BETWEEN ? AND ?', ini, fim);
  const diag = get('SELECT COUNT(*) n FROM diagnosticos WHERE date(created_at) BETWEEN ? AND ?', ini, fim).n;
  const alertas = detectarDinheiroParado().filter((a) => a.nivel !== 'baixo').slice(0, 6);
  const produtos = all(`SELECT p.nome, COUNT(l.id) n FROM produtos p LEFT JOIN leads l ON l.produto_id=p.id AND l.estagio NOT IN ('Cliente','Perdido')
    GROUP BY p.id ORDER BY n DESC, p.preco DESC LIMIT 3`);
  const leads = all("SELECT nome, temperatura, estagio FROM leads WHERE estagio NOT IN ('Cliente','Perdido') ORDER BY temperatura='Quente' DESC, valor_potencial DESC LIMIT 6");
  const camp = all("SELECT nome, investimento, faturamento, leads FROM campanhas WHERE status='Ativa'");
  const aprov = all("SELECT titulo FROM aprovacoes WHERE status='Pendente'");
  const pri = priorizarTarefas().slice(0, 5);
  const cortes = [
    ...camp.filter((c) => c.investimento > 0 && c.faturamento < c.investimento).map((c) => `Campanha "${c.nome}" (ROI negativo)`),
    ...all("SELECT tarefa FROM tarefas WHERE status IN ('A fazer','Em andamento') AND impacto='Baixo'").map((t) => `Tarefa "${t.tarefa}" (impacto baixo)`),
  ];
  const foco = get("SELECT nome, produto FROM negocios WHERE status = 'Em foco' ORDER BY prioridade LIMIT 1");

  return {
    gerou_dinheiro: rec.length || aceitas.length
      ? `Receita da semana: ${brl(totalRec)}\n` + lista(rec, (r) => `${r.descricao}: ${brl(r.valor)}`, '') + (aceitas.length ? '\nPropostas aceitas:\n' + lista(aceitas, (p) => `${p.titulo} (${brl(p.valor)})`, '') : '')
      : 'Nenhuma receita registrada nesta semana.',
    gerou_oportunidade: `${novos.length} lead(s) novo(s) e ${diag} diagnóstico(s) recebido(s).\n` + lista(novos.slice(0, 8), (l) => `${l.nome} (${l.canal || 'sem canal'}, ${l.temperatura || 'sem temperatura'})`, ''),
    travou_receita: lista(alertas, (a) => `${a.titulo}. ${a.detalhe}`, 'Nenhum gargalo relevante detectado.'),
    produtos_potencial: lista(produtos, (p) => `${p.nome}: ${p.n} lead(s) ativo(s)`, 'Cadastre produtos para acompanhar.'),
    leads_importantes: lista(leads, (l) => `${l.nome}: ${l.temperatura || 'sem temperatura'}, ${l.estagio}`, 'Nenhum lead ativo.'),
    campanhas: lista(camp, (c) => `${c.nome}: ${brl(c.investimento)} investidos, ${c.leads || 0} leads, ${brl(c.faturamento)} faturados`, 'Nenhuma campanha ativa.'),
    decisoes_pendentes: lista(aprov, (a) => a.titulo, 'Nenhuma aprovação pendente.'),
    proximas_acoes: lista(pri, (t) => `${t.tarefa}${t.prazo ? ` (até ${t.prazo.split('-').reverse().join('/')})` : ''}`, 'Cadastre tarefas com impacto financeiro.'),
    corte: lista(cortes.slice(0, 5), (c) => c, 'Nada evidente para cortar. Revise distrações fora do sistema.'),
    foco: foco ? `${foco.nome}${foco.produto ? `: ${foco.produto}` : ''}` : 'Defina o negócio em foco para o ciclo.',
  };
}

router.get('/relatorios', (req, res) => {
  res.json({ secoes: SECOES, lista: all('SELECT id, semana_inicio, semana_fim, updated_at FROM relatorios ORDER BY semana_inicio DESC') });
});
router.get('/relatorios/:id', (req, res) => {
  const r = get('SELECT * FROM relatorios WHERE id = ?', req.params.id);
  if (!r) return res.status(404).json({ erro: 'Relatório não encontrado.' });
  res.json({ ...r, secoes: JSON.parse(r.secoes) });
});
router.post('/relatorios/gerar', (req, res) => {
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.fim || '') ? req.body.fim : isoDate();
  const ini = addDays(fim, -6);
  const id = db.prepare('INSERT INTO relatorios (semana_inicio, semana_fim, secoes) VALUES (?, ?, ?)').run(ini, fim, JSON.stringify(gerarRelatorio(ini, fim))).lastInsertRowid;
  res.json({ id });
});
router.put('/relatorios/:id', (req, res) => {
  const secoes = {};
  for (const [k] of SECOES) secoes[k] = String(req.body?.secoes?.[k] || '').slice(0, 10000);
  db.prepare("UPDATE relatorios SET secoes=?, updated_at=datetime('now','localtime') WHERE id=?").run(JSON.stringify(secoes), req.params.id);
  res.json({ ok: true });
});
router.delete('/relatorios/:id', (req, res) => {
  db.prepare('DELETE FROM relatorios WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});


// ---------- Identidade / configurações ----------
router.get('/config', (req, res) => res.json(getConfig()));
router.put('/config', (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ erro: 'Somente o fundador altera a identidade do sistema.' });
  const permitidas = ['nome', 'subtitulo', 'missao', 'funcao', 'produtos_prioritarios', 'principios', 'frase', 'manifesto', 'prompt_extra'];
  const stmt = db.prepare('INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)');
  for (const k of permitidas) if (k in (req.body || {})) stmt.run(`identidade.${k}`, String(req.body[k]).slice(0, 10000));
  res.json({ ok: true });
});

// Resumo textual do estado do negócio (usado pelo Core de IA)
function snapshot() {
  const hoje = isoDate();
  const fin = resumoFinanceiro(addDays(hoje, -29), hoje);
  const funil = ESTAGIOS_LEAD.map((e) => `${e}: ${get('SELECT COUNT(*) n FROM leads WHERE estagio=?', e).n}`).join(', ');
  const produtos = all('SELECT nome, marca, preco, status, promessa FROM produtos').map((p) => `- ${p.nome} (${p.marca}, ${brl(p.preco)}, ${p.status}): ${p.promessa || 'sem promessa'}`).join('\n');
  const ofertas = all('SELECT nome, headline, cta, status FROM ofertas').map((o) => `- ${o.nome} [${o.status}]: ${o.headline || 'sem headline'} | CTA: ${o.cta || 'sem CTA'}`).join('\n');
  const leads = all("SELECT nome, temperatura, estagio, dor, proximo_contato, valor_potencial FROM leads WHERE estagio NOT IN ('Cliente','Perdido') ORDER BY temperatura='Quente' DESC, valor_potencial DESC LIMIT 15")
    .map((l) => `- ${l.nome}: ${l.temperatura || '?'}, ${l.estagio}, dor: ${l.dor || '?'}, próximo contato: ${l.proximo_contato || 'sem data'}, potencial ${brl(l.valor_potencial)}`).join('\n');
  const tarefas = priorizarTarefas().slice(0, 8).map((t) => `- ${t.tarefa} (${t.impacto || '?'} impacto, prazo ${t.prazo || 'sem prazo'}, ${t.status})`).join('\n');
  const alertas = detectarDinheiroParado().slice(0, 10).map((a) => `- [${a.nivel}] ${a.titulo}: ${a.detalhe}`).join('\n');
  return `DATA DE HOJE: ${hoje}
FINANCEIRO (últimos 30 dias): receita ${brl(fin.receita)}, despesa ${brl(fin.despesa)}, lucro ${brl(fin.lucro)}, ${fin.vendas} vendas.
PRODUTOS:\n${produtos || '- nenhum'}
OFERTAS:\n${ofertas || '- nenhuma'}
FUNIL DE LEADS: ${funil}
LEADS ATIVOS PRINCIPAIS:\n${leads || '- nenhum'}
TAREFAS PRIORIZADAS:\n${tarefas || '- nenhuma'}
DINHEIRO PARADO DETECTADO:\n${alertas || '- nada detectado'}`;
}

module.exports = { router, snapshot, getConfig, detectarDinheiroParado, priorizarTarefas };
