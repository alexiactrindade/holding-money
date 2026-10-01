const express = require('express');
const crypto = require('crypto');
const { db, insert } = require('./db');
const { rateLimit, isoDate, addDays } = require('./util');

// Escala usada nas perguntas: 1 (discordo totalmente) a 5 (concordo totalmente)
const DIAGNOSTICOS = {
  acc: {
    tipo: 'ACC',
    titulo: 'Diagnóstico ACC',
    headline: 'Sua imagem está te posicionando ou te sabotando?',
    subtitulo: 'Descubra como sua aparência, comportamento e conhecimento estão comunicando seu valor antes mesmo de você falar.',
    escala: ['Não me descreve', 'Pouco', 'Em parte', 'Quase sempre', 'Me descreve totalmente'],
    blocos: [
      { id: 'aparencia', titulo: 'Aparência', perguntas: [
        'Tenho um estilo definido e sei explicá-lo.',
        'Minha imagem comunica o nível que desejo alcançar.',
        'Meu guarda-roupa está alinhado com meus objetivos.',
        'Sei me vestir para diferentes ambientes (reunião, jantar, evento).',
        'Sinto que minha aparência me favorece, e não me limita.',
      ] },
      { id: 'comportamento', titulo: 'Comportamento', perguntas: [
        'Me sinto à vontade em ambientes sociais.',
        'Consigo me posicionar sem soar arrogante.',
        'Mantenho controle emocional sob pressão.',
        'Minha postura transmite segurança.',
        'Sei conduzir conversas em ambientes de maior valor.',
      ] },
      { id: 'conhecimento', titulo: 'Conhecimento', perguntas: [
        'Tenho repertório cultural para diferentes conversas.',
        'Consigo conversar sobre negócios, política, economia e comportamento.',
        'Faço boa leitura de ambiente e de pessoas.',
        'Sustento conversa com pessoas de maior nível sem me sentir deslocado.',
        'Minha imagem é sustentada por conteúdo, e não só por estética.',
      ] },
    ],
    qualificacao: [
      { id: 'objetivo', label: 'Qual é o seu principal objetivo hoje?', tipo: 'select', opcoes: ['Crescer na carreira', 'Atrair clientes e negócios', 'Melhorar a vida social e afetiva', 'Reposicionar minha imagem por completo', 'Outro'] },
      { id: 'urgencia', label: 'Quão urgente é resolver isso para você?', tipo: 'select', opcoes: ['Posso esperar', 'Nos próximos meses', 'Preciso resolver agora'] },
      { id: 'investimento', label: 'Você investiria em acompanhamento individual para acelerar isso?', tipo: 'select', opcoes: ['Não no momento', 'Talvez, dependendo do valor', 'Sim, se fizer sentido'] },
    ],
  },
  vpa: {
    tipo: 'VPA',
    titulo: 'Diagnóstico de Performance em Vendas',
    headline: 'Onde sua equipe está perdendo vendas?',
    subtitulo: 'Identifique onde sua equipe perde vendas, margem e recorrência no atendimento.',
    escala: ['Não existe', 'Existe pouco', 'Existe em parte', 'Existe e funciona', 'É referência'],
    empresa: true,
    blocos: [
      { id: 'atendimento', titulo: 'Atendimento', perguntas: ['O cliente é recebido com uma abordagem padrão e rápida.'] },
      { id: 'sondagem', titulo: 'Sondagem', perguntas: ['A equipe identifica dor, desejo, orçamento e intenção real do cliente.'] },
      { id: 'oferta', titulo: 'Oferta', perguntas: ['Os vendedores apresentam benefício, valor e diferenciais, e não só preço.'] },
      { id: 'objecoes', titulo: 'Objeções', perguntas: ['Existe roteiro para preço, comparação, indecisão e falta de urgência.'] },
      { id: 'followup', titulo: 'Follow-up', perguntas: ['Leads e orçamentos são acompanhados até a decisão.'] },
      { id: 'indicadores', titulo: 'Indicadores', perguntas: ['A empresa mede conversão, ticket médio, margem e recompra.'] },
      { id: 'gestao', titulo: 'Gestão', perguntas: ['O gerente treina, acompanha e corrige a equipe com rotina.'] },
    ],
    qualificacao: [
      { id: 'cargo', label: 'Seu cargo', tipo: 'select', opcoes: ['Dono / sócio', 'Gerente', 'Subgerente', 'Vendedor', 'Outro'] },
      { id: 'vendedores', label: 'Quantos vendedores a empresa tem?', tipo: 'select', opcoes: ['1 a 2', '3 a 5', '6 a 15', 'Mais de 15'] },
      { id: 'faturamento', label: 'Faturamento mensal aproximado', tipo: 'select', opcoes: ['Até R$ 50 mil', 'R$ 50 a 200 mil', 'R$ 200 mil a 1 milhão', 'Acima de R$ 1 milhão'] },
      { id: 'prioridade', label: 'Melhorar vendas é prioridade para os próximos 90 dias?', tipo: 'select', opcoes: ['Não', 'Talvez', 'Sim'] },
    ],
  },
  'codigo-interno': {
    tipo: 'CIU',
    titulo: 'Teste do Código Interno',
    headline: 'Qual padrão interno mais trava sua evolução hoje?',
    subtitulo: 'Responda com sinceridade. O resultado aponta o padrão dominante e o próximo passo recomendado.',
    escala: ['Nunca', 'Raramente', 'Às vezes', 'Frequentemente', 'Quase sempre'],
    aviso: 'Este teste é uma ferramenta de autoconhecimento e não é uma avaliação psicológica ou clínica. Se você está passando por sofrimento intenso, procure um profissional de saúde mental.',
    blocos: [
      { id: 'ansiedade', titulo: 'Ritmo', perguntas: [
        'Sinto urgência constante, como se tudo precisasse ser resolvido agora.',
        'Tenho dificuldade de pausar sem sentir culpa.',
        'Preciso controlar os detalhes para me sentir seguro.',
      ] },
      { id: 'autossabotagem', titulo: 'Continuidade', perguntas: [
        'Começo projetos com empolgação e abandono no meio.',
        'Quebro compromissos que faço comigo mesmo.',
        'Quando algo começa a dar certo, faço algo que atrapalha.',
      ] },
      { id: 'dependencia', titulo: 'Vínculos', perguntas: [
        'Preciso da aprovação dos outros para me sentir bem com minhas escolhas.',
        'Tenho medo de ser deixado de lado.',
        'Tenho dificuldade de dizer não e impor limites.',
      ] },
      { id: 'direcao', titulo: 'Direção', perguntas: [
        'Tenho muitos desejos, mas pouca clareza do que fazer primeiro.',
        'Adio decisões importantes.',
        'Sinto que estou ocupado, mas não avanço.',
      ] },
      { id: 'abertura', titulo: 'Abertura', perguntas: [
        'Reconheço que existe um padrão que se repete na minha vida.',
        'Estou disposto a seguir um método e praticar para mudar.',
      ] },
    ],
    qualificacao: [],
  },
};

function media(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

function lerRespostas(def, body) {
  const notas = {};
  for (const b of def.blocos) {
    notas[b.id] = b.perguntas.map((_, i) => {
      const v = Number(body?.respostas?.[`${b.id}_${i}`]);
      return v >= 1 && v <= 5 ? v : null;
    });
    if (notas[b.id].some((v) => v === null)) return { erro: `Responda todas as perguntas de ${b.titulo}.` };
  }
  const qual = {};
  for (const q of def.qualificacao) {
    const v = body?.qualificacao?.[q.id];
    if (!q.opcoes.includes(v)) return { erro: `Responda: ${q.label}` };
    qual[q.id] = v;
  }
  return { notas, qual };
}

// ---------- Classificações ----------
function classificarACC(notas, qual) {
  const m = { aparencia: media(notas.aparencia), comportamento: media(notas.comportamento), conhecimento: media(notas.conhecimento) };
  const pct = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(((v - 1) / 4) * 100)]));
  const menor = Object.entries(m).sort((a, b) => a[1] - b[1])[0][0];
  const geral = media(Object.values(m));
  const urgente = qual.urgencia === 'Preciso resolver agora';
  const investe = qual.investimento === 'Sim, se fizer sentido';

  let perfil; let produto; let proximo;
  if (urgente && investe && (geral < 3.8 || qual.objetivo === 'Reposicionar minha imagem por completo')) {
    perfil = 'Pronto para mentoria'; produto = 'Mentoria Black Label';
    proximo = 'Seu perfil indica dor clara, desejo forte e urgência. O próximo passo é uma conversa sobre acompanhamento individual.';
  } else if (geral >= 3.8) {
    perfil = 'Potencial premium'; produto = 'Reposicionamento ACC';
    proximo = 'Você tem boa base. O ganho está no refinamento para ambientes de maior valor.';
  } else if (menor === 'aparencia') {
    perfil = 'Desalinhado visual'; produto = 'Checklist, e-book ou diagnóstico visual';
    proximo = 'Sua imagem ainda não comunica seu objetivo. Começar pela direção estética gera o ganho mais rápido.';
  } else if (menor === 'comportamento') {
    perfil = 'Inseguro comportamental'; produto = 'Conteúdo de comportamento, consultoria ou mentoria';
    proximo = 'Postura, fala e presença são o ponto que mais limita sua imagem hoje.';
  } else {
    perfil = 'Fraco de repertório'; produto = 'Trilha de conhecimento e repertório';
    proximo = 'Sua aparência ajuda, mas repertório e leitura de ambiente ainda não sustentam a imagem.';
  }

  const fortes = Object.entries(m).filter(([, v]) => v >= 3.8).map(([k]) => k);
  const fracos = Object.entries(m).filter(([, v]) => v < 3).map(([k]) => k);
  const nomes = { aparencia: 'Aparência', comportamento: 'Comportamento', conhecimento: 'Conhecimento' };
  const temperatura = perfil === 'Pronto para mentoria' || (urgente && qual.investimento !== 'Não no momento') ? 'Quente'
    : qual.urgencia === 'Nos próximos meses' || investe ? 'Morno' : 'Frio';

  return {
    perfil, temperatura, produto,
    pontuacao: pct,
    resultado: {
      titulo: perfil,
      resumo: proximo,
      barras: Object.entries(pct).map(([k, v]) => ({ label: nomes[k], valor: v })),
      pontosFortes: fortes.length ? fortes.map((k) => nomes[k]) : ['Nenhum bloco acima de 75% ainda'],
      pontosFracos: fracos.length ? fracos.map((k) => nomes[k]) : ['Nenhum bloco crítico'],
      recomendacao: produto,
    },
    valor: perfil === 'Pronto para mentoria' ? 3000 : perfil === 'Potencial premium' ? 997 : 197,
    dor: `Ponto mais fraco: ${nomes[menor]}. Objetivo: ${qual.objetivo}.`,
  };
}

function classificarVPA(notas, qual) {
  const nomes = { atendimento: 'Atendimento', sondagem: 'Sondagem', oferta: 'Oferta', objecoes: 'Objeções', followup: 'Follow-up', indicadores: 'Indicadores', gestao: 'Gestão' };
  const m = Object.fromEntries(Object.entries(notas).map(([k, v]) => [k, media(v)]));
  const geral = media(Object.values(m));
  const gargalos = Object.entries(m).sort((a, b) => a[1] - b[1]).slice(0, 3).filter(([, v]) => v < 4).map(([k]) => nomes[k]);
  const decisor = ['Dono / sócio', 'Gerente'].includes(qual.cargo);
  const equipeGrande = ['6 a 15', 'Mais de 15'].includes(qual.vendedores);

  let perfil; let produto;
  if (geral < 2.5) { perfil = 'Processo comercial inexistente'; produto = 'Treinamento completo + consultoria'; }
  else if (geral < 3.5) { perfil = 'Processo comercial frágil'; produto = 'Treinamento módulo 1'; }
  else if (geral < 4.3) { perfil = 'Processo em ajuste'; produto = 'Consultoria pontual nos gargalos'; }
  else { perfil = 'Processo maduro'; produto = 'Acompanhamento mensal'; }

  let temperatura = 'Frio';
  if (decisor && qual.prioridade === 'Sim' && geral < 4.3) temperatura = 'Quente';
  else if (decisor || qual.prioridade !== 'Não') temperatura = 'Morno';

  const valorBase = { '1 a 2': 1500, '3 a 5': 3000, '6 a 15': 6000, 'Mais de 15': 12000 }[qual.vendedores] || 2000;
  return {
    perfil, temperatura, produto,
    pontuacao: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(((v - 1) / 4) * 100)])),
    resultado: {
      titulo: perfil,
      resumo: gargalos.length
        ? `Os pontos onde sua equipe mais perde venda hoje: ${gargalos.join(', ')}. ${equipeGrande ? 'Com uma equipe desse tamanho, cada ponto de conversão recuperado tem impacto direto no faturamento.' : ''}`
        : 'Seu processo tem boa base. O foco é consistência e acompanhamento.',
      barras: Object.entries(m).map(([k, v]) => ({ label: nomes[k], valor: Math.round(((v - 1) / 4) * 100) })),
      pontosFortes: Object.entries(m).filter(([, v]) => v >= 4).map(([k]) => nomes[k]),
      pontosFracos: gargalos,
      recomendacao: produto,
    },
    valor: valorBase,
    dor: `Gargalos: ${gargalos.join(', ') || 'nenhum crítico'}. ${qual.vendedores} vendedores, faturamento ${qual.faturamento}.`,
  };
}

function classificarCIU(notas) {
  const nomes = { ansiedade: 'Ansiedade operacional', autossabotagem: 'Autossabotagem', dependencia: 'Dependência emocional', direcao: 'Falta de direção' };
  const ofertas = {
    ansiedade: 'Conteúdos de regulação e desafio diário',
    autossabotagem: 'E-book ou mentoria de reprogramação',
    dependencia: 'Trilha de autonomia emocional',
    direcao: 'Desafio de 21 dias ou mentoria',
  };
  const textos = {
    ansiedade: 'Excesso de urgência, controle e dificuldade de pausa aparecem como o padrão que mais consome sua energia.',
    autossabotagem: 'O padrão dominante é iniciar sem continuidade e quebrar compromissos consigo mesmo.',
    dependencia: 'Busca de validação e dificuldade de impor limites aparecem como o padrão mais forte.',
    direcao: 'Muito desejo e pouca estrutura de decisão: a energia existe, mas se dispersa.',
  };
  const somas = Object.fromEntries(Object.keys(nomes).map((k) => [k, notas[k].reduce((s, x) => s + x, 0)]));
  const ord = Object.entries(somas).sort((a, b) => b[1] - a[1]);
  const [dominante, valorDom] = ord[0];
  const abertura = media(notas.abertura);

  let perfil = nomes[dominante]; let produto = ofertas[dominante]; let resumo = textos[dominante];
  if (abertura >= 4 && valorDom >= 10) {
    perfil = 'Potencial de reconstrução';
    produto = 'Imersão ou mentoria Código Interno';
    resumo = `Você tem consciência do padrão e abertura para método. Padrão dominante: ${nomes[dominante].toLowerCase()}. ${textos[dominante]}`;
  }
  const temperatura = abertura >= 4 ? 'Quente' : abertura >= 3 ? 'Morno' : 'Frio';
  return {
    perfil, temperatura, produto,
    pontuacao: Object.fromEntries(Object.entries(somas).map(([k, v]) => [k, Math.round(((v - 3) / 12) * 100)])),
    resultado: {
      titulo: perfil,
      resumo,
      barras: ord.map(([k, v]) => ({ label: nomes[k], valor: Math.round(((v - 3) / 12) * 100) })),
      pontosFortes: [],
      pontosFracos: [nomes[dominante]],
      recomendacao: produto,
    },
    valor: perfil === 'Potencial de reconstrução' ? 1500 : 97,
    dor: `Padrão dominante: ${nomes[dominante]}. Abertura ao método: ${abertura.toFixed(1)}/5.`,
  };
}

const CLASSIFICADORES = { acc: classificarACC, vpa: classificarVPA, 'codigo-interno': classificarCIU };
const MARCA = { acc: 'Style-Code', vpa: 'VPA Projetos & Negócios', 'codigo-interno': 'Código Interno Universal' };
const PRODUTO_ENTRADA = { acc: 'Diagnóstico ACC', vpa: 'Diagnóstico Comercial', 'codigo-interno': 'Teste Código Interno' };

function registrarLead({ slug, nome, contato, empresa, canal, origem, c }) {
  const produto = db.prepare('SELECT id FROM produtos WHERE nome = ?').get(PRODUTO_ENTRADA[slug]);
  const existente = contato ? db.prepare('SELECT * FROM leads WHERE contato = ?').get(contato) : null;
  const dados = {
    classificacao: c.perfil, temperatura: c.temperatura, dor: c.dor,
    valor_potencial: c.valor, produto_id: produto?.id || null,
    proximo_contato: c.temperatura === 'Quente' ? isoDate() : addDays(isoDate(), 1),
    mensagem_followup: `Recomendação: ${c.produto}.`,
  };
  if (existente) {
    const keys = Object.keys(dados);
    db.prepare(`UPDATE leads SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=datetime('now','localtime') WHERE id=?`).run(...keys.map((k) => dados[k]), existente.id);
    return existente.id;
  }
  return insert('leads', { nome, contato, empresa: empresa || null, canal, origem, marca: MARCA[slug], estagio: 'Diagnóstico', ...dados });
}

// Os formulários são modelos do blueprint: ficam desligados até o dono ativar em Integrações
function ativos() {
  try { return JSON.parse(db.prepare("SELECT valor FROM configuracoes WHERE chave='diagnosticos.ativos'").get()?.valor || '[]'); } catch { return []; }
}
function setAtivos(lista) {
  db.prepare('INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)').run('diagnosticos.ativos', JSON.stringify(lista));
}

const router = express.Router();

router.get('/diagnosticos/:slug', (req, res) => {
  const def = DIAGNOSTICOS[req.params.slug];
  if (!def || !ativos().includes(req.params.slug)) return res.status(404).json({ erro: 'Diagnóstico não encontrado.' });
  const nome = db.prepare("SELECT valor FROM configuracoes WHERE chave='identidade.nome'").get()?.valor;
  res.json({ ...def, marca: MARCA[req.params.slug], sistema: nome });
});

router.post('/diagnosticos/:slug', rateLimit(8, 60_000), (req, res) => {
  const slug = req.params.slug;
  const def = DIAGNOSTICOS[slug];
  if (!def || !ativos().includes(slug)) return res.status(404).json({ erro: 'Diagnóstico não encontrado.' });
  const body = req.body || {};
  if (body.website) return res.json({ ok: true }); // honeypot anti-spam
  const nome = String(body.nome || '').trim().slice(0, 120);
  const contato = String(body.contato || '').trim().slice(0, 160);
  const empresa = String(body.empresa || '').trim().slice(0, 160);
  if (!nome || !contato) return res.status(400).json({ erro: 'Informe seu nome e um contato (WhatsApp ou e-mail).' });
  if (def.empresa && !empresa) return res.status(400).json({ erro: 'Informe o nome da empresa.' });
  if (!body.consentimento) return res.status(400).json({ erro: 'Confirme que podemos entrar em contato com o resultado.' });

  const lidas = lerRespostas(def, body);
  if (lidas.erro) return res.status(400).json({ erro: lidas.erro });
  const c = CLASSIFICADORES[slug](lidas.notas, lidas.qual);
  const canal = ['Instagram', 'WhatsApp', 'LinkedIn', 'E-mail', 'Indicação', 'Site', 'Anúncio'].includes(body.canal) ? body.canal : 'Site';

  const tx = db.transaction(() => {
    const leadId = registrarLead({ slug, nome, contato, empresa, canal, origem: `Formulário ${def.titulo}`, c });
    insert('diagnosticos', {
      tipo: def.tipo, nome: empresa ? `${nome} (${empresa})` : nome, contato,
      classificacao: c.perfil, temperatura: c.temperatura, lead_id: leadId,
      resultado: JSON.stringify(c.resultado),
      respostas: JSON.stringify({ notas: lidas.notas, qualificacao: lidas.qual, pontuacao: c.pontuacao }),
    });
  });
  tx();
  res.json({ resultado: c.resultado });
});

// Webhook para Make / n8n / Tally / Typeform: POST /api/webhooks/lead com header x-webhook-token
function webhookToken() {
  let row = db.prepare("SELECT valor FROM configuracoes WHERE chave='webhook_token'").get();
  if (!row) {
    const t = crypto.randomBytes(24).toString('hex');
    db.prepare("INSERT INTO configuracoes (chave, valor) VALUES ('webhook_token', ?)").run(t);
    row = { valor: t };
  }
  return row.valor;
}

const webhookRouter = express.Router();
webhookRouter.post('/lead', rateLimit(60, 60_000), (req, res) => {
  const token = req.get('x-webhook-token') || req.query.token;
  const esperado = webhookToken();
  if (!token || token.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(esperado))) {
    return res.status(401).json({ erro: 'Token do webhook inválido.' });
  }
  const b = req.body || {};
  const nome = String(b.nome || b.name || '').trim().slice(0, 120);
  if (!nome) return res.status(400).json({ erro: 'Campo "nome" é obrigatório.' });
  const id = insert('leads', {
    nome,
    contato: String(b.contato || b.email || b.telefone || b.phone || '').slice(0, 160) || null,
    empresa: b.empresa ? String(b.empresa).slice(0, 160) : null,
    canal: 'Outro',
    origem: String(b.origem || 'Ferramenta externa').slice(0, 120),
    dor: b.dor ? String(b.dor).slice(0, 2000) : null,
    observacoes: b.observacoes ? String(b.observacoes).slice(0, 4000) : null,
    temperatura: ['Quente', 'Morno', 'Frio'].includes(b.temperatura) ? b.temperatura : 'Morno',
    estagio: 'Novo',
    proximo_contato: addDays(isoDate(), 1),
  });
  res.json({ id });
});

// Contexto de cada linha de negócio, exibido em Formulários e conexões acima do diagnóstico
const CONTEXTO_MARCA = {
  acc: {
    marca: 'Style-Code',
    sobre: 'Marca de imagem e posicionamento masculino, baseada no método ACC: Aparência, Comportamento e Conhecimento.',
    publico: 'Homens que querem se reposicionar pessoal e profissionalmente.',
    escada: 'Conteúdo gratuito, diagnóstico, e-book, consultoria e Mentoria Black Label.',
    avalia: '15 afirmações nas três áreas do método, mais objetivo, urgência e disposição de investir.',
    recomenda: 'Conforme o perfil: conteúdo e materiais de entrada, Reposicionamento ACC ou Mentoria Black Label.',
  },
  vpa: {
    marca: 'VPA Projetos & Negócios',
    sobre: 'Consultoria e treinamento de vendas B2B para o varejo.',
    publico: 'Donos e gestores de lojas cuja equipe perde vendas, margem e recorrência no atendimento.',
    escada: 'Conteúdo, diagnóstico comercial, treinamento módulo 1, treinamento completo, consultoria e acompanhamento.',
    avalia: '7 áreas do processo comercial: atendimento, sondagem, oferta, objeções, follow-up, indicadores e gestão, além de porte e prioridade da empresa.',
    recomenda: 'Conforme a maturidade: treinamento completo com consultoria, treinamento módulo 1, consultoria pontual ou acompanhamento mensal.',
  },
  'codigo-interno': {
    marca: 'Código Interno Universal',
    sobre: 'Linha de desenvolvimento humano, focada nos padrões internos que travam a evolução de uma pessoa.',
    publico: 'Pessoas em busca de autoconhecimento, direção e reconstrução.',
    escada: 'Conteúdo gratuito, teste, e-book, desafio de 21 dias, livro, imersão e mentoria.',
    avalia: '5 dimensões: ritmo, continuidade, vínculos, direção e abertura. Não é avaliação clínica.',
    recomenda: 'O conteúdo ou produto ligado ao padrão dominante; imersão ou mentoria para quem precisa de apoio mais profundo.',
  },
};

module.exports = { router, webhookRouter, webhookToken, DIAGNOSTICOS, MARCA, CONTEXTO_MARCA, ativos, setAtivos };
