// Onboarding (contexto da empresa) e criação assistida por IA.
// Regra: a IA só PROPÕE. Nada entra no banco sem o dono revisar e confirmar.
const express = require('express');
const { db, insert } = require('./db');
const { entities } = require('./schema');
const { sanitize, dynamicOptions } = require('./crud');
const { getConfig, snapshot } = require('./insights');
const { chamarIA, provider, ErroIA } = require('./core');
const { GRUPOS, CONTEXTO, OUTRO, lista, visivel, contextoTexto } = require('./contexto');
const { isoDate, addDays, logAction } = require('./util');

const router = express.Router();

// Entidades que a IA pode sugerir (nunca leads, vendas, propostas ou lançamentos: esses são fatos, não sugestões)
const IA_ENTIDADES = ['negocios', 'produtos', 'ofertas', 'conteudos', 'campanhas', 'scripts', 'tarefas', 'riscos'];
const ESTRUTURA = ['negocios', 'produtos', 'ofertas', 'scripts', 'tarefas', 'riscos'];
// Campos de resultado: só o dado real preenche
const EXCLUIR = { ofertas: ['conversao'], conteudos: ['leads_gerados'], campanhas: ['investimento', 'leads', 'vendas', 'faturamento'], tarefas: ['concluida_em'] };

const setCfg = (k, v) => db.prepare('INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)').run(k, String(v));
const cfgVal = (k) => db.prepare('SELECT valor FROM configuracoes WHERE chave=?').get(k)?.valor;

function camposIA(entity) {
  return entities[entity].fields.filter((f) => !f.hidden && !(EXCLUIR[entity] || []).includes(f.name) && !(f.type === 'ref' && f.ref !== 'produtos'));
}

function descreverEntidade(entity, marcas) {
  const def = entities[entity];
  const linhas = camposIA(entity).map((f) => {
    if (f.type === 'ref') return `  "produto_nome": texto, nome EXATO de um produto existente ou sugerido nesta mesma resposta (${f.label})`;
    let t = { text: 'texto curto', textarea: 'texto', number: 'número', money: 'número em reais, sem símbolo', percent: 'número de 0 a 100', date: 'data AAAA-MM-DD' }[f.type] || 'texto';
    if (f.type === 'select') t = f.dynamic ? `texto, de preferência uma destas: ${marcas.join(' | ')}` : `exatamente uma destas opções: ${f.options.join(' | ')}`;
    return `  "${f.name}": ${t} (${f.label}${f.required ? ', obrigatório' : ''})`;
  });
  return `"${entity}" (${def.label}):\n${linhas.join('\n')}`;
}

function extrairJSON(texto) {
  const t = String(texto || '').replace(/```json|```/g, '');
  const i = t.indexOf('{'); const j = t.lastIndexOf('}');
  const falha = () => new ErroIA('A IA respondeu de um jeito inesperado. Tente de novo.');
  if (i < 0 || j <= i) throw falha();
  try { return JSON.parse(t.slice(i, j + 1)); } catch { throw falha(); }
}

// Valida cada item pelo schema e descarta o que não cabe
function validar(entity, itens) {
  const def = entities[entity];
  const permitidos = new Set(camposIA(entity).map((f) => f.name));
  const out = [];
  for (const raw of Array.isArray(itens) ? itens.slice(0, 12) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const body = {};
    for (const [k, v] of Object.entries(raw)) if (permitidos.has(k) && v !== '' && v !== null) body[k] = v;
    // opção inválida em select vira vazio em vez de derrubar o item
    for (const f of def.fields) if (f.type === 'select' && !f.dynamic && body[f.name] !== undefined && !f.options.includes(String(body[f.name]))) delete body[f.name];
    const { data, errors } = sanitize(def, body, { partial: false });
    if (errors.length) continue;
    for (const k of Object.keys(data)) if (data[k] === null) delete data[k];
    if (raw.produto_nome && entities[entity].fields.some((f) => f.name === 'produto_id')) data.produto_nome = String(raw.produto_nome).slice(0, 200);
    out.push(data);
  }
  return out;
}

function regrasIA() {
  return `REGRAS OBRIGATÓRIAS:
- Use SOMENTE o contexto informado pelo dono e os dados já cadastrados. Não invente clientes, depoimentos, números de resultado, parcerias ou provas.
- Preço: só preencha se o dono informou preços ou faixa de preço; caso contrário deixe o campo fora.
- Campo "prova" de ofertas: deixe fora se não houver prova real informada.
- Datas de prazo a partir de hoje (${isoDate()}), realistas para a equipe e o tempo informados.
- Status iniciais honestos: produtos e ofertas nascem em construção/rascunho, a menos que o dono diga que já vendem.
- Escreva em português do Brasil, direto e comercial.
- Responda APENAS com um objeto JSON, sem texto antes ou depois, sem markdown.`;
}

// ---------- Onboarding ----------
router.get('/onboarding', (req, res) => {
  const c = getConfig();
  const contexto = {};
  for (const f of CONTEXTO) {
    contexto[f.key] = ['multi', 'tags'].includes(f.type) ? lista(c[f.key]) : (c[f.key] || '');
    if (f.type === 'multi') contexto[`${f.key}_outro`] = c[`${f.key}_outro`] || '';
  }
  res.json({ status: cfgVal('onboarding') || 'feito', grupos: GRUPOS, contexto, ia: !!provider() });
});

// Valida e normaliza as respostas segundo o questionário (perguntas ocultas são descartadas)
function lerContexto(b) {
  const out = {}; const faltando = [];
  const valores = { ...b };
  for (const f of CONTEXTO) {
    if (!visivel(f, valores)) { out[f.key] = ''; if (f.type === 'multi') out[`${f.key}_outro`] = ''; valores[f.key] = ''; continue; }
    let v = b[f.key];
    if (f.type === 'multi') {
      v = lista(v).filter((x) => f.options.includes(x));
      out[`${f.key}_outro`] = v.includes(OUTRO) ? String(b[`${f.key}_outro`] || '').trim().slice(0, 200) : '';
    } else if (f.type === 'tags') {
      v = [...new Set(lista(v).map((x) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
    } else if (f.type === 'single') {
      const opcoes = f.opcoesDe ? lista(valores[f.opcoesDe]) : f.options.map((o) => (typeof o === 'string' ? o : o.valor));
      v = opcoes.includes(v) ? v : '';
    } else if (f.type === 'money') {
      const n = Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
      v = Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
    } else {
      v = String(v ?? '').trim().slice(0, 5000);
    }
    const vazio = Array.isArray(v) ? !v.length : !v;
    if (f.required && vazio) faltando.push(f.label);
    valores[f.key] = v;
    out[f.key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return { out, faltando };
}

router.post('/onboarding', (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ erro: 'Somente o fundador define o contexto da empresa.' });
  const { out, faltando } = lerContexto(req.body || {});
  if (faltando.length) return res.status(400).json({ erro: `Preencha: ${faltando.join(', ')}.` });
  for (const [k, v] of Object.entries(out)) setCfg(`identidade.${k}`, v);
  if ((cfgVal('onboarding') || 'pendente') === 'pendente') setCfg('onboarding', 'contexto');
  logAction(db, req.user.nome, 'definiu', 'contexto', null, out.empresa);
  res.json({ ok: true });
});

router.post('/onboarding/concluir', (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ erro: 'Somente o fundador conclui esta etapa.' });
  setCfg('onboarding', 'feito');
  res.json({ ok: true });
});

// Tarefas sugeridas conforme o momento da empresa: [tarefa, impacto, esforço, prazo em dias]
const TAREFAS_POR_MOMENTO = {
  Ideia: [
    ['Conversar com 10 pessoas do público para confirmar o problema', 'Alto', 'Médio', 5],
    ['Definir uma oferta mínima com preço de teste', 'Alto', 'Médio', 7],
    ['Listar 30 potenciais clientes e cadastrá-los como leads', 'Alto', 'Médio', 7],
    ['Publicar 3 conteúdos sobre o problema que você resolve', 'Médio', 'Médio', 10],
    ['Fazer 5 ofertas diretas para validar se alguém compra', 'Alto', 'Alto', 14],
  ],
  'Validação': [
    ['Finalizar a oferta principal: headline, promessa, entrega, preço e CTA', 'Alto', 'Médio', 3],
    ['Abordar 30 potenciais clientes com o script de abordagem', 'Alto', 'Alto', 7],
    ['Registrar as objeções ouvidas e ajustar a oferta', 'Alto', 'Baixo', 7],
    ['Conseguir 3 provas: depoimentos, resultados ou casos', 'Alto', 'Médio', 14],
    ['Definir a rotina de follow-up dos leads', 'Médio', 'Baixo', 3],
  ],
  'Primeiras vendas': [
    ['Cadastrar clientes atuais e contatos em negociação como leads', 'Alto', 'Médio', 2],
    ['Fazer follow-up de todos os leads parados', 'Alto', 'Médio', 3],
    ['Pedir indicação a cada cliente satisfeito', 'Alto', 'Baixo', 7],
    ['Criar o roteiro de vendas com abordagem, objeções e fechamento', 'Médio', 'Médio', 7],
    ['Lançar as vendas e despesas do mês em Financeiro', 'Médio', 'Baixo', 2],
  ],
  'Tração': [
    ['Identificar o canal que mais gera clientes e reforçar o investimento nele', 'Alto', 'Médio', 7],
    ['Criar uma oferta de maior valor para quem já é cliente', 'Alto', 'Médio', 14],
    ['Padronizar os scripts de venda e follow-up', 'Médio', 'Baixo', 7],
    ['Revisar margem e preço de cada produto', 'Alto', 'Médio', 10],
    ['Gerar o relatório semanal e definir a ação de dinheiro da semana', 'Médio', 'Baixo', 7],
  ],
  'Estruturação': [
    ['Documentar o processo comercial do primeiro contato ao fechamento', 'Alto', 'Médio', 10],
    ['Definir metas de venda por pessoa ou canal', 'Alto', 'Baixo', 7],
    ['Organizar o financeiro do mês: receitas, despesas e margem', 'Médio', 'Médio', 5],
    ['Delegar uma tarefa operacional que hoje trava o crescimento', 'Médio', 'Médio', 14],
    ['Revisar a escada de valor: entrada, principal e premium', 'Alto', 'Médio', 14],
  ],
  Escala: [
    ['Testar um novo canal de aquisição com orçamento controlado', 'Alto', 'Alto', 14],
    ['Medir custo por cliente e retorno de cada campanha', 'Alto', 'Médio', 7],
    ['Criar uma oferta recorrente ou de retenção para a base', 'Alto', 'Alto', 21],
    ['Treinar a equipe comercial com os scripts padrão', 'Médio', 'Médio', 14],
    ['Revisar os riscos de maior exposição e seus planos de resposta', 'Médio', 'Baixo', 7],
  ],
};

// Sem IA: estrutura mínima montada só com o que o dono escreveu (nada inventado)
function estruturaSemIA(c) {
  const hoje = isoDate();
  const marca = c.empresa;
  return {
    negocios: [{ nome: c.empresa, marca, publico: c.publico, produto: (c.o_que_vende || '').split(/[,\n;]/)[0]?.trim().slice(0, 120), estagio: { Ideia: 'Ideia', 'Validação': 'Validação', 'Primeiras vendas': 'Validação', 'Tração': 'Operando', 'Estruturação': 'Estruturação', Escala: 'Escala' }[c.estagio_empresa] || 'Estruturação', prioridade: '1', status: 'Em foco' }],
    produtos: (c.o_que_vende || '').split(/[,\n;]/).map((x) => x.trim()).filter(Boolean).slice(0, 5)
      .map((nome) => ({ nome: (nome[0].toUpperCase() + nome.slice(1)).slice(0, 120), marca, publico: c.publico, dor: c.dor, status: 'Estruturação' })),
    tarefas: (TAREFAS_POR_MOMENTO[c.estagio_empresa] || TAREFAS_POR_MOMENTO['Validação'])
      .map(([tarefa, impacto, esforco, d]) => ({ tarefa, projeto: marca, impacto, esforco, prazo: addDays(hoje, d), responsavel: c.fundador, status: 'A fazer' })),
  };
}

router.post('/ia/estrutura', async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ erro: 'Somente o fundador monta a estrutura inicial.' });
  const c = getConfig();
  if (!c.empresa || !c.o_que_vende) return res.status(400).json({ erro: 'Preencha o contexto da empresa primeiro.' });
  const marcas = dynamicOptions().marcas;

  if (!provider()) {
    const bruto = estruturaSemIA(c);
    const itens = {};
    for (const [e, lista] of Object.entries(bruto)) itens[e] = validar(e, lista);
    return res.json({ fonte: 'basica', resumo: '', itens });
  }

  const system = `Você é o Holding Money, sistema de inteligência comercial. Sua tarefa agora é montar a ESTRUTURA COMERCIAL INICIAL de uma empresa a partir do contexto que o dono informou, seguindo o método: visão > estrutura > produto > oferta > venda > caixa > expansão.
Priorize UM negócio ou produto principal (o de venda mais rápida). Pense em escada de valor (entrada > principal > premium).

${regrasIA()}

CONTEXTO DA EMPRESA:
${contextoTexto(c)}

DADOS JÁ CADASTRADOS:
${snapshot()}

FORMATO DE RESPOSTA:
{
  "resumo": "3 a 5 frases: diagnóstico do negócio, onde está o dinheiro mais próximo e por que o foco principal vem primeiro",
  ${ESTRUTURA.map((e) => `"${e}": [ ... ]`).join(',\n  ')}
}
Quantidades: negocios 1 a 3, produtos 2 a 6, ofertas 1 a 3 (ligadas a produtos pelo "produto_nome"), scripts 3 a 5 (abordagem, follow-up, fechamento), tarefas 5 a 8 (plano dos próximos 7 a 14 dias ADEQUADO AO MOMENTO DA EMPRESA: em "Ideia" e "Validação", validar problema e oferta e buscar os primeiros clientes; em "Primeiras vendas", regularidade, follow-up e indicações; em "Tração", reforçar o canal que funciona e aumentar ticket; em "Estruturação", processos, metas e delegação; em "Escala", novos canais, métricas de aquisição e retenção), riscos 3 a 5.

CAMPOS DE CADA LISTA:
${ESTRUTURA.map((e) => descreverEntidade(e, marcas)).join('\n\n')}`;

  try {
    const texto = await chamarIA(system, [{ role: 'user', content: 'Monte a estrutura comercial inicial da minha empresa.' }], { maxTokens: 8000 });
    const j = extrairJSON(texto);
    const itens = {};
    for (const e of ESTRUTURA) itens[e] = validar(e, j[e]);
    res.json({ fonte: 'ia', resumo: String(j.resumo || '').slice(0, 3000), itens });
  } catch (e) {
    res.status(502).json({ erro: e instanceof ErroIA ? e.message : 'A IA não conseguiu montar a estrutura agora. Tente de novo em instantes.' });
  }
});

// Sugestões para uma área específica, a qualquer momento
router.post('/ia/sugerir', async (req, res) => {
  const entity = String(req.body?.entidade || '');
  if (!IA_ENTIDADES.includes(entity)) return res.status(400).json({ erro: 'A IA não sugere registros nesta área.' });
  if (!provider()) return res.status(400).json({ erro: 'A IA está desligada.', semIA: true });
  const c = getConfig();
  const qtd = Math.max(1, Math.min(8, Number(req.body?.quantidade) || 3));
  const instrucao = String(req.body?.instrucao || '').slice(0, 2000);
  const def = entities[entity];
  const existentes = db.prepare(`SELECT ${def.display} AS d FROM ${entity} ORDER BY id DESC LIMIT 40`).all().map((r) => r.d).filter(Boolean);

  const system = `Você é o Holding Money, sistema de inteligência comercial. Sugira ${qtd} novo(s) registro(s) de ${def.label} para esta empresa, focados em gerar receita real.

${regrasIA()}
- Não repita nem reescreva registros que já existem: ${existentes.join(' | ') || 'nenhum'}.

CONTEXTO DA EMPRESA:
${contextoTexto(c) || 'Não informado. Seja conservador.'}

DADOS ATUAIS DO NEGÓCIO:
${snapshot()}

FORMATO DE RESPOSTA: { "itens": [ ... ] } onde cada item tem os campos:
${descreverEntidade(entity, dynamicOptions().marcas)}`;

  try {
    const texto = await chamarIA(system, [{ role: 'user', content: instrucao || `Sugira ${def.label.toLowerCase()} para o momento atual do negócio.` }], { maxTokens: 4000 });
    res.json({ itens: validar(entity, extrairJSON(texto).itens) });
  } catch (e) {
    res.status(502).json({ erro: e instanceof ErroIA ? e.message : 'A IA não conseguiu sugerir agora. Tente de novo em instantes.' });
  }
});

// Grava os itens que o dono revisou e marcou
router.post('/ia/aplicar', (req, res) => {
  const lote = req.body?.itens || {};
  const isAdmin = req.user.papel === 'admin';
  const ordem = ['negocios', 'produtos', ...IA_ENTIDADES.filter((e) => !['negocios', 'produtos'].includes(e))];
  const criados = {};
  const avisos = [];
  const tx = db.transaction(() => {
    for (const entity of ordem) {
      const lista = lote[entity];
      if (!Array.isArray(lista) || !lista.length) continue;
      const def = entities[entity];
      for (const raw of lista.slice(0, 20)) {
        const produtoNome = raw?.produto_nome;
        const [data] = validar(entity, [raw]);
        if (!data) continue;
        delete data.produto_nome;
        if (produtoNome) {
          const p = db.prepare('SELECT id FROM produtos WHERE lower(nome) = lower(?) ORDER BY id DESC').get(String(produtoNome).trim());
          if (p) data.produto_id = p.id;
        }
        // Operador não define valores sensíveis direto (governança)
        for (const f of def.fields.filter((x) => x.sensitive)) {
          if (!isAdmin && data[f.name] != null) { delete data[f.name]; avisos.push(`${f.label} de "${data[def.display]}" ficou em branco: preços e investimentos são definidos pelo fundador.`); }
        }
        const id = insert(entity, data);
        logAction(db, req.user.nome, 'criou (com IA)', entity, id, data[def.display]);
        criados[entity] = (criados[entity] || 0) + 1;
      }
    }
    const total = Object.values(criados).reduce((s, n) => s + n, 0);
    if (total && req.body?.origem === 'estrutura') setCfg('onboarding', 'feito');
  });
  tx();
  res.json({ criados, avisos });
});

module.exports = { router, IA_ENTIDADES };
