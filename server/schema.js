// Definição central das entidades do Holding Money.
// O banco (SQLite) e os formulários do front são gerados a partir daqui.
// Tipos: text, textarea, number, money, percent, date, select, ref, score

// Marcas vêm do contexto da empresa (Identidade) e dos Negócios cadastrados: ver dynamicOptions() em crud.js
const MARCAS = [];
const CANAIS = ['Instagram', 'WhatsApp', 'LinkedIn', 'E-mail', 'Indicação', 'Site', 'Anúncio', 'Evento', 'Parceria', 'Prospecção direta', 'Outro'];
const IMPACTO = ['Alto', 'Médio', 'Baixo'];
// Escala de impacto de 5 níveis (PMBOK)
const NIVEIS_5M = ['Muito baixo', 'Baixo', 'Médio', 'Alto', 'Muito alto'];
const NIVEIS_ESCADA = ['Conteúdo gratuito', 'Isca digital', 'Produto de entrada', 'Produto principal', 'Produto premium', 'Recorrência', 'Licenciamento'];
const ESTAGIOS_LEAD = ['Novo', 'Contato feito', 'Diagnóstico', 'Proposta enviada', 'Negociação', 'Cliente', 'Perdido'];
const OBJETIVOS_CONTEUDO = ['Atenção', 'Autoridade', 'Relacionamento', 'Lead', 'Venda'];

const entities = {
  negocios: {
    label: 'Negócios', singular: 'negócio', group: 'Comercial',
    help: 'Quais negócios entram no foco e quais ficam para depois.',
    display: 'nome',
    fields: [
      { name: 'nome', label: 'Nome', type: 'text', required: true, list: true },
      { name: 'marca', label: 'Marca', type: 'select', options: [], dynamic: 'marcas', list: true },
      { name: 'publico', label: 'Público', type: 'text' },
      { name: 'produto', label: 'Produto principal', type: 'text', list: true },
      { name: 'estagio', label: 'Estágio', type: 'select', options: ['Ideia', 'Estruturação', 'Validação', 'Operando', 'Escala', 'Pausado'], list: true },
      { name: 'prioridade', label: 'Prioridade (1 = máxima)', type: 'select', options: ['1', '2', '3', '4', '5'], list: true },
      { name: 'potencial', label: 'Potencial', type: 'select', options: IMPACTO, list: true },
      { name: 'canal', label: 'Canal principal', type: 'select', options: CANAIS },
      { name: 'status', label: 'Status', type: 'select', options: ['Em foco', 'Em espera', 'Cortado'], list: true, filter: true },
      { name: 'observacoes', label: 'Observações', type: 'textarea' },
    ],
  },

  produtos: {
    label: 'Produtos', singular: 'produto', group: 'Comercial',
    help: 'Qual produto tem chance de venda imediata.',
    display: 'nome',
    fields: [
      { name: 'nome', label: 'Nome do produto', type: 'text', required: true, list: true },
      { name: 'marca', label: 'Marca', type: 'select', options: [], dynamic: 'marcas', list: true },
      { name: 'tipo', label: 'Tipo', type: 'select', options: ['Diagnóstico', 'E-book', 'Treinamento', 'Consultoria', 'Mentoria', 'Isca/diagnóstico', 'Desafio', 'Livro', 'Imersão', 'Assinatura', 'Comunidade', 'Licença', 'Outro'], list: true },
      { name: 'nivel_escada', label: 'Nível na escada de valor', type: 'select', options: NIVEIS_ESCADA },
      { name: 'preco', label: 'Preço (R$)', type: 'money', list: true, sensitive: true },
      { name: 'margem', label: 'Margem (%)', type: 'percent' },
      { name: 'publico', label: 'Público-alvo', type: 'text' },
      { name: 'dor', label: 'Dor principal', type: 'textarea' },
      { name: 'promessa', label: 'Promessa', type: 'textarea', list: true },
      { name: 'mecanismo', label: 'Mecanismo', type: 'textarea' },
      { name: 'entregaveis', label: 'Entregáveis', type: 'textarea' },
      { name: 'canal_venda', label: 'Canal de venda', type: 'text' },
      { name: 'proximo_produto', label: 'Próximo produto da escada', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['Pronto', 'Pronto/melhorando', 'Construção', 'Estruturação', 'Travado', 'Pausado'], list: true, filter: true },
    ],
  },

  ofertas: {
    label: 'Ofertas', singular: 'oferta', feminino: true, group: 'Comercial',
    help: 'Qual oferta está pronta, fraca ou precisa ser ajustada.',
    display: 'nome',
    fields: [
      { name: 'nome', label: 'Nome da oferta', type: 'text', required: true, list: true },
      { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos', list: true },
      { name: 'headline', label: 'Headline', type: 'text', list: true },
      { name: 'subheadline', label: 'Subheadline', type: 'textarea' },
      { name: 'problema', label: 'Problema que resolve', type: 'textarea' },
      { name: 'promessa', label: 'Promessa', type: 'textarea' },
      { name: 'mecanismo', label: 'Mecanismo', type: 'textarea' },
      { name: 'beneficio', label: 'Benefício principal', type: 'textarea' },
      { name: 'prova', label: 'Prova', type: 'textarea' },
      { name: 'bonus', label: 'Bônus', type: 'textarea' },
      { name: 'garantia', label: 'Garantia', type: 'text' },
      { name: 'preco', label: 'Preço (R$)', type: 'money', sensitive: true },
      { name: 'cta', label: 'CTA', type: 'text' },
      { name: 'canal', label: 'Canal', type: 'select', options: CANAIS },
      { name: 'conversao', label: 'Conversão (%)', type: 'percent', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Pronta', 'Em teste', 'Fraca', 'Rascunho', 'Pausada'], list: true, filter: true },
    ],
  },

  leads: {
    exportavel: true,
    label: 'Leads', singular: 'lead', group: 'Comercial',
    help: 'Quem deve ser abordado e qual mensagem usar.',
    display: 'nome',
    fields: [
      { name: 'nome', label: 'Nome', type: 'text', required: true, list: true },
      { name: 'empresa', label: 'Empresa', type: 'text' },
      { name: 'contato', label: 'Contato (WhatsApp / e-mail)', type: 'text', list: true },
      { name: 'canal', label: 'Canal', type: 'select', options: CANAIS, list: true },
      { name: 'origem', label: 'Origem', type: 'text' },
      { name: 'marca', label: 'Marca / interesse', type: 'select', options: [], dynamic: 'marcas', list: true },
      { name: 'dor', label: 'Dor', type: 'textarea' },
      { name: 'produto_id', label: 'Produto indicado', type: 'ref', ref: 'produtos', list: true },
      { name: 'classificacao', label: 'Classificação', type: 'text' },
      { name: 'temperatura', label: 'Temperatura', type: 'select', options: ['Quente', 'Morno', 'Frio'], list: true, filter: true },
      { name: 'estagio', label: 'Estágio', type: 'select', options: ESTAGIOS_LEAD, list: true, filter: true },
      { name: 'valor_potencial', label: 'Valor potencial (R$)', type: 'money', list: true },
      { name: 'ultimo_contato', label: 'Último contato', type: 'date' },
      { name: 'proximo_contato', label: 'Próximo contato', type: 'date', list: true },
      { name: 'mensagem_followup', label: 'Mensagem de follow-up', type: 'textarea' },
      { name: 'observacoes', label: 'Observações', type: 'textarea' },
    ],
  },

  propostas: {
    label: 'Propostas', singular: 'proposta', feminino: true, group: 'Comercial',
    help: 'Proposta final só pode ser enviada depois de aprovada pelo fundador.',
    display: 'titulo',
    fields: [
      { name: 'titulo', label: 'Título', type: 'text', required: true, list: true },
      { name: 'lead_id', label: 'Lead / cliente', type: 'ref', ref: 'leads', list: true },
      { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos' },
      { name: 'escopo', label: 'Escopo', type: 'textarea' },
      { name: 'prazo', label: 'Prazo de entrega', type: 'text' },
      { name: 'valor', label: 'Valor (R$)', type: 'money', list: true },
      { name: 'resultado_esperado', label: 'Resultado esperado', type: 'textarea' },
      { name: 'data_envio', label: 'Data de envio', type: 'date', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Rascunho', 'Aguardando aprovação', 'Aprovada', 'Enviada', 'Aceita', 'Recusada'], list: true, filter: true, readonlyValues: ['Aprovada'] },
    ],
  },

  conteudos: {
    label: 'Conteúdos', singular: 'conteúdo', group: 'Marketing',
    help: 'Todo conteúdo precisa de objetivo, CTA e produto vinculado.',
    display: 'tema',
    fields: [
      { name: 'tema', label: 'Tema', type: 'text', required: true, list: true },
      { name: 'marca', label: 'Marca', type: 'select', options: [], dynamic: 'marcas', list: true },
      { name: 'canal', label: 'Canal', type: 'select', options: ['Instagram', 'Reels', 'Carrossel', 'Stories', 'YouTube', 'LinkedIn', 'Blog', 'Newsletter', 'WhatsApp', 'Outro'], list: true },
      { name: 'formato', label: 'Formato', type: 'text' },
      { name: 'objetivo', label: 'Objetivo', type: 'select', options: OBJETIVOS_CONTEUDO, list: true },
      { name: 'cta', label: 'CTA', type: 'text' },
      { name: 'produto_id', label: 'Produto vinculado', type: 'ref', ref: 'produtos' },
      { name: 'roteiro', label: 'Roteiro / texto', type: 'textarea' },
      { name: 'data', label: 'Data de publicação', type: 'date', list: true },
      { name: 'leads_gerados', label: 'Leads gerados', type: 'number', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Ideia', 'Roteiro', 'Produção', 'Agendado', 'Publicado'], list: true, filter: true },
    ],
  },

  campanhas: {
    exportavel: true,
    label: 'Campanhas', singular: 'campanha', feminino: true, group: 'Marketing',
    help: 'Quais campanhas merecem escala ou corte.',
    display: 'nome',
    fields: [
      { name: 'nome', label: 'Nome', type: 'text', required: true, list: true },
      { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos', list: true },
      { name: 'publico', label: 'Público', type: 'text' },
      { name: 'canal', label: 'Canal', type: 'select', options: CANAIS, list: true },
      { name: 'inicio', label: 'Início', type: 'date' },
      { name: 'fim', label: 'Fim', type: 'date' },
      { name: 'investimento', label: 'Investimento (R$)', type: 'money', list: true, sensitive: true },
      { name: 'leads', label: 'Leads', type: 'number', list: true },
      { name: 'vendas', label: 'Vendas', type: 'number', list: true },
      { name: 'faturamento', label: 'Faturamento (R$)', type: 'money', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Planejada', 'Ativa', 'Pausada', 'Encerrada'], list: true, filter: true },
    ],
  },

  scripts: {
    label: 'Scripts comerciais', singular: 'script', group: 'Marketing',
    help: 'Mensagens padrão para abordagem, follow-up e conversão.',
    display: 'nome',
    fields: [
      { name: 'nome', label: 'Script', type: 'text', required: true, list: true },
      { name: 'canal', label: 'Canal', type: 'text', list: true },
      { name: 'objetivo', label: 'Objetivo', type: 'text', list: true },
      { name: 'mensagem', label: 'Mensagem', type: 'textarea', required: true },
      { name: 'proximo_passo', label: 'Próximo passo', type: 'text', list: true },
    ],
  },

  financeiro: {
    exportavel: true,
    label: 'Financeiro', singular: 'lançamento', group: 'Financeiro',
    help: 'Onde o caixa cresce ou vaza.',
    display: 'descricao',
    fields: [
      { name: 'data', label: 'Data', type: 'date', required: true, list: true },
      { name: 'tipo', label: 'Tipo', type: 'select', options: ['Receita', 'Despesa'], required: true, list: true, filter: true },
      { name: 'descricao', label: 'Descrição', type: 'text', required: true, list: true },
      { name: 'valor', label: 'Valor (R$)', type: 'money', required: true, list: true },
      { name: 'categoria', label: 'Categoria', type: 'select', options: ['Venda', 'Serviço', 'Recorrência', 'Tráfego', 'Ferramentas', 'Equipe', 'Impostos', 'Operação', 'Outro'], list: true },
      { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos', list: true },
      { name: 'marca', label: 'Marca', type: 'select', options: [], dynamic: 'marcas' },
      { name: 'origem', label: 'Origem', type: 'text' },
    ],
  },

  tarefas: {
    label: 'Tarefas', singular: 'tarefa', feminino: true, group: 'Execução',
    help: 'O que fazer primeiro e o que cortar. Ordenadas por impacto financeiro, urgência e esforço.',
    display: 'tarefa',
    fields: [
      { name: 'tarefa', label: 'Tarefa', type: 'text', required: true, list: true },
      { name: 'projeto', label: 'Projeto / marca', type: 'select', options: [], dynamic: 'marcas', list: true },
      { name: 'impacto', label: 'Impacto financeiro', type: 'select', options: IMPACTO, list: true },
      { name: 'esforco', label: 'Esforço', type: 'select', options: ['Baixo', 'Médio', 'Alto'] },
      { name: 'prazo', label: 'Prazo', type: 'date', list: true },
      { name: 'responsavel', label: 'Responsável', type: 'text', list: true },
      { name: 'valor_estimado', label: 'Receita que destrava (R$)', type: 'money' },
      { name: 'status', label: 'Status', type: 'select', options: ['A fazer', 'Em andamento', 'Travada', 'Concluída', 'Cortada'], list: true, filter: true },
      { name: 'concluida_em', label: 'Concluída em', type: 'date', hidden: true },
    ],
  },

  aprovacoes: {
    label: 'Aprovações', singular: 'aprovação', feminino: true, group: 'Execução',
    help: 'Ações sensíveis passam por aprovação humana: proposta final, contrato, preço, campanha, decisão financeira e posicionamento público.',
    display: 'titulo',
    noCreateFor: [],
    fields: [
      { name: 'titulo', label: 'O que precisa ser aprovado', type: 'text', required: true, list: true },
      { name: 'tipo', label: 'Tipo', type: 'select', options: ['Proposta final', 'Contrato', 'Preço', 'Campanha', 'Decisão financeira', 'Posicionamento público'], required: true, list: true, filter: true },
      { name: 'detalhes', label: 'Detalhes', type: 'textarea' },
      { name: 'solicitante', label: 'Solicitado por', type: 'text', list: true },
      { name: 'ref_entidade', label: 'Entidade', type: 'text', hidden: true },
      { name: 'ref_id', label: 'Registro', type: 'number', hidden: true },
      { name: 'payload', label: 'Dados', type: 'textarea', hidden: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Pendente', 'Aprovada', 'Recusada'], list: true, filter: true, adminOnly: true },
      { name: 'decidido_por', label: 'Decidido por', type: 'text', hidden: true },
      { name: 'decidido_em', label: 'Decidido em', type: 'date', hidden: true },
      { name: 'comentario', label: 'Comentário da decisão', type: 'textarea', hidden: true },
    ],
  },

  agentes: {
    label: 'Agentes especialistas', singular: 'agente', group: 'Sistema',
    help: 'O Core comanda. Os agentes executam por especialidade.',
    display: 'nome',
    fields: [
      { name: 'nome', label: 'Agente', type: 'text', required: true, list: true },
      { name: 'funcao', label: 'Função', type: 'textarea', list: true },
      { name: 'pergunta', label: 'Pergunta central', type: 'text', list: true },
      { name: 'instrucoes', label: 'Instruções adicionais', type: 'textarea' },
      { name: 'ativo', label: 'Ativo', type: 'select', options: ['Sim', 'Não'], list: true },
    ],
  },

  riscos: {
    label: 'Riscos e mitigação', singular: 'risco', group: 'Sistema',
    help: 'Sinais de alerta que tiram o sistema do trilho.',
    display: 'risco',
    fields: [
      { name: 'risco', label: 'Risco', type: 'text', required: true, list: true },
      { name: 'sinal', label: 'Sinal de alerta', type: 'textarea', list: true },
      { name: 'impacto', label: 'Impacto', type: 'select', options: NIVEIS_5M, list: true },
      { name: 'mitigacao', label: 'Mitigação', type: 'textarea', list: true },
      { name: 'status', label: 'Situação', type: 'select', options: ['Sob controle', 'Atenção', 'Acontecendo'], list: true, filter: true },
    ],
  },

  diagnosticos: {
    label: 'Diagnósticos recebidos', singular: 'diagnóstico', group: 'Comercial',
    help: 'Respostas dos formulários públicos: Diagnóstico ACC, Diagnóstico Comercial VPA e Teste do Código Interno.',
    display: 'nome',
    readonly: true,
    fields: [
      { name: 'tipo', label: 'Tipo', type: 'select', options: ['ACC', 'VPA', 'CIU'], list: true, filter: true },
      { name: 'nome', label: 'Nome', type: 'text', list: true },
      { name: 'contato', label: 'Contato', type: 'text', list: true },
      { name: 'classificacao', label: 'Classificação', type: 'text', list: true },
      { name: 'temperatura', label: 'Temperatura', type: 'text', list: true },
      { name: 'lead_id', label: 'Lead', type: 'ref', ref: 'leads' },
      { name: 'resultado', label: 'Resultado', type: 'textarea', hidden: true },
      { name: 'respostas', label: 'Respostas', type: 'textarea', hidden: true },
    ],
  },
};

// Tabelas "de sistema" com estrutura própria (não CRUD genérico)
const systemTables = `
CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL UNIQUE,
  respostas TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS relatorios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semana_inicio TEXT NOT NULL,
  semana_fim TEXT NOT NULL,
  secoes TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS core_mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  agente TEXT,
  papel TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT,
  acao TEXT,
  entidade TEXT,
  registro_id INTEGER,
  detalhes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

module.exports = { entities, systemTables, MARCAS, ESTAGIOS_LEAD, NIVEIS_ESCADA, NIVEIS_5M };
