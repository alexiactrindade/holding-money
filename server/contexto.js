// Contexto da empresa: questionário do onboarding, agrupado por assunto e com lógica condicional.
// A mesma definição monta o formulário no navegador, valida no servidor e vira texto para a IA.
//
// Tipos: text, textarea, money (número em R$), single (uma opção), multi (várias opções), tags (lista livre)
// `mostrarSe`: todas as condições precisam ser verdadeiras para a pergunta aparecer.
//   { campo, em: [...] }     valor do campo está na lista
//   { campo, fora: [...] }   valor do campo não está na lista (vazio conta como "fora")
//   { campo, min: n }        campo de múltipla escolha tem pelo menos n itens

const OUTRO = 'Outro';
const SEM_VENDA = ['Ideia'];
const INICIO = ['Ideia', 'Validação'];

const GRUPOS = [
  {
    id: 'empresa', titulo: 'Empresa',
    campos: [
      { key: 'empresa', label: 'Nome da empresa ou marca principal', type: 'text', required: true, placeholder: 'Ex.: Ateliê Sol' },
      { key: 'fundador', label: 'Nome do responsável pelas decisões', type: 'text', required: true },
      { key: 'segmento', label: 'Segmento / mercado', type: 'text', required: true, placeholder: 'Ex.: moda feminina, consultoria para varejo, odontologia' },
      {
        key: 'estagio_empresa', label: 'Momento atual da empresa', type: 'single', required: true, cards: true,
        options: [
          { valor: 'Ideia', desc: 'Ainda não vendi.' },
          { valor: 'Validação', desc: 'Estou testando minha oferta e buscando os primeiros clientes.' },
          { valor: 'Primeiras vendas', desc: 'Já comecei a vender, mas ainda sem regularidade.' },
          { valor: 'Tração', desc: 'Já vendo com frequência e tenho demanda recorrente.' },
          { valor: 'Estruturação', desc: 'Estou organizando a operação para crescer.' },
          { valor: 'Escala', desc: 'Tenho uma operação funcionando e quero aumentar significativamente a receita.' },
        ],
      },
    ],
  },
  {
    id: 'oferta', titulo: 'Oferta',
    campos: [
      { key: 'o_que_vende', label: 'O que você vende ou quer vender', type: 'textarea', required: true, placeholder: 'Descreva seus produtos ou serviços, mesmo que ainda estejam no papel.' },
      {
        key: 'ja_vende', label: 'Você já vende essa oferta?', type: 'single',
        options: ['Sim, com regularidade', 'Sim, mas ainda pouco', 'Ainda não'],
        mostrarSe: [{ campo: 'estagio_empresa', fora: SEM_VENDA }],
      },
      {
        key: 'ticket', label: 'Faixa de preço da principal oferta', type: 'single',
        options: ['Até R$ 100', 'R$ 100 a R$ 500', 'R$ 500 a R$ 2.000', 'R$ 2.000 a R$ 10.000', 'Acima de R$ 10.000', 'Ainda não defini'],
      },
    ],
  },
  {
    id: 'cliente', titulo: 'Cliente',
    campos: [
      { key: 'publico', label: 'Quem é seu cliente ideal', type: 'textarea', required: true, placeholder: 'Ex.: donas de lojas de roupa com 2 a 10 vendedores, no interior de SP' },
      {
        key: 'atende_hoje', label: 'Quem você atende hoje?', type: 'textarea', placeholder: 'Se for diferente do cliente ideal, conte quem compra de você hoje.',
        mostrarSe: [{ campo: 'estagio_empresa', fora: SEM_VENDA }, { campo: 'ja_vende', fora: ['Ainda não'] }],
      },
      { key: 'dor', label: 'Qual principal problema você resolve para esse cliente?', type: 'textarea', required: true, placeholder: 'Ex.: a equipe perde vendas por não saber contornar objeções' },
    ],
  },
  {
    id: 'posicionamento', titulo: 'Posicionamento',
    campos: [
      {
        key: 'diferenciais', label: 'O que diferencia sua empresa?', type: 'multi',
        options: ['Preço', 'Qualidade', 'Especialização', 'Experiência', 'Velocidade', 'Atendimento', 'Tecnologia', 'Método próprio', 'Marca / reputação', 'Personalização', 'Conveniência', OUTRO],
      },
      {
        key: 'diferencial', label: 'Como você explicaria esse diferencial?', type: 'textarea', placeholder: 'Em uma ou duas frases, como você diria isso a um cliente.',
        mostrarSe: [{ campo: 'diferenciais', min: 1 }],
      },
    ],
  },
  {
    id: 'crescimento', titulo: 'Crescimento',
    campos: [
      {
        key: 'canais', label: 'Como você consegue clientes hoje?', labelInicio: 'Por onde pretende conseguir clientes?', type: 'multi',
        options: ['Indicação', 'Instagram', 'LinkedIn', 'Google', 'Tráfego pago', 'Conteúdo', 'Prospecção ativa', 'Eventos', 'Parceiros', 'Marketplace', 'Afiliados', 'Equipe comercial', OUTRO],
      },
      {
        key: 'canal_principal', label: 'Qual desses canais mais gera clientes hoje?', type: 'single', opcoesDe: 'canais',
        mostrarSe: [{ campo: 'estagio_empresa', fora: INICIO }, { campo: 'ja_vende', fora: ['Ainda não'] }, { campo: 'canais', min: 2 }],
      },
      {
        key: 'faturamento', label: 'Faturamento mensal atual', type: 'single',
        options: ['Ainda não faturo', 'Até R$ 5 mil', 'R$ 5 mil a R$ 20 mil', 'R$ 20 mil a R$ 50 mil', 'R$ 50 mil a R$ 100 mil', 'R$ 100 mil a R$ 500 mil', 'Acima de R$ 500 mil'],
        mostrarSe: [{ campo: 'estagio_empresa', fora: SEM_VENDA }],
      },
      { key: 'meta_mensal', label: 'Meta de receita mensal', type: 'money', required: true, placeholder: 'Ex.: 20000' },
    ],
  },
  {
    id: 'operacao', titulo: 'Operação',
    campos: [
      {
        key: 'gargalos', label: 'O que mais limita o crescimento da empresa hoje?', type: 'multi',
        options: ['Atrair mais clientes', 'Converter mais vendas', 'Melhorar a oferta', 'Aumentar o ticket', 'Gerar demanda previsível', 'Melhorar o marketing', 'Organizar processos', 'Estruturar a equipe', 'Aumentar margem', 'Falta de capital', 'Falta de tempo', 'Tecnologia / automação', 'Ainda não sei', OUTRO],
      },
      {
        key: 'desafios', label: 'Conte um pouco mais sobre esse gargalo.', type: 'textarea', placeholder: 'O que acontece na prática? Ex.: os contatos somem depois do orçamento.',
        mostrarSe: [{ campo: 'gargalos', min: 1 }],
      },
      { key: 'equipe', label: 'Quantas pessoas trabalham no negócio?', type: 'single', options: ['Só eu', '2 a 5', '6 a 20', '21 a 50', 'Mais de 50'] },
      { key: 'tempo', label: 'Quanto tempo você consegue dedicar ao crescimento?', type: 'single', options: ['Até 5 horas por semana', '5 a 10 horas por semana', '10 a 20 horas por semana', '20 a 40 horas por semana', 'Dedicação total'] },
      { key: 'investimento', label: 'Quanto pretende investir no crescimento nos próximos meses?', type: 'single', options: ['Nada por enquanto', 'Até R$ 1 mil por mês', 'R$ 1 mil a R$ 5 mil por mês', 'R$ 5 mil a R$ 20 mil por mês', 'Acima de R$ 20 mil por mês', 'Ainda não sei'] },
    ],
  },
  {
    id: 'linhas', titulo: 'Outras linhas de negócio',
    campos: [
      { key: 'tem_outras', label: 'Você possui outras marcas, produtos ou linhas de negócio?', type: 'single', options: ['Sim', 'Não'] },
      {
        key: 'marcas', label: 'Quais são?', type: 'tags', placeholder: 'Digite o nome e tecle Enter',
        mostrarSe: [{ campo: 'tem_outras', em: ['Sim'] }],
      },
    ],
  },
];

const CONTEXTO = GRUPOS.flatMap((g) => g.campos);

// Valores de múltipla escolha e tags são guardados como JSON (lista)
function lista(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : [String(v)]; } catch { return String(v).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean); }
}

function visivel(campo, valores) {
  return (campo.mostrarSe || []).every((c) => {
    const v = valores[c.campo];
    if (c.em) return c.em.includes(v);
    if (c.fora) return !c.fora.includes(v);
    if (c.min) return lista(v).length >= c.min;
    return true;
  });
}

function textoCampo(f, c) {
  const v = c[f.key];
  if (f.type === 'multi' || f.type === 'tags') {
    const itens = lista(v).map((x) => (x === OUTRO && c[`${f.key}_outro`] ? `Outro (${c[`${f.key}_outro`]})` : x));
    return itens.join(', ');
  }
  if (f.type === 'money' && v) return `R$ ${Number(v).toLocaleString('pt-BR')}`;
  return v || '';
}

// Texto usado pelo Core e pela IA
function contextoTexto(c) {
  const linhas = [];
  for (const g of GRUPOS) {
    const itens = g.campos.filter((f) => visivel(f, c) && textoCampo(f, c)).map((f) => `- ${f.label}: ${textoCampo(f, c)}`);
    if (itens.length) linhas.push(`${g.titulo}:\n${itens.join('\n')}`);
  }
  return linhas.join('\n');
}

module.exports = { GRUPOS, CONTEXTO, OUTRO, lista, visivel, contextoTexto };
