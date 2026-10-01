const express = require('express');
const { db } = require('./db-pg');
const { ESTAGIOS_LEAD } = require('./schema');
const { isoDate, addDays, daysBetween, brl } = require('./util');

const router = express.Router();

async function all(sql, ...p) {
  return db.prepare(sql).all(...p);
}

async function get(sql, ...p) {
  return db.prepare(sql).get(...p);
}

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  return Number(value);
}

async function getConfig() {
  const out = {};

  const rows = await all(`
    SELECT chave, valor
    FROM configuracoes
    WHERE chave LIKE 'identidade.%'
  `);

  for (const r of rows) {
    out[r.chave.slice(11)] = r.valor;
  }

  return out;
}

// ---------- Prioridades: impacto x urgência x esforço ----------
async function priorizarTarefas() {
  const hoje = isoDate();

  const peso = {
    Alto: 3,
    Médio: 2,
    Baixo: 1,
  };

  const rows = await all(`
    SELECT *
    FROM tarefas
    WHERE status IN ('A fazer', 'Em andamento', 'Travada')
  `);

  return rows
    .map((t) => {
      const impacto = peso[t.impacto] || 1;
      const esforco = peso[t.esforco] || 2;

      let urgencia = 1;

      if (t.prazo) {
        const d = daysBetween(hoje, t.prazo);

        urgencia =
          d < 0
            ? 4
            : d <= 1
              ? 3.5
              : d <= 3
                ? 3
                : d <= 7
                  ? 2
                  : 1;
      }

      const valorEstimado = num(t.valor_estimado);

      const bonusValor =
        valorEstimado > 0
          ? Math.min(2, Math.log10(valorEstimado) / 2)
          : 0;

      const score =
        impacto * 3 +
        urgencia * 2 +
        bonusValor -
        esforco +
        (t.status === 'Travada' ? 1 : 0);

      return {
        ...t,
        score: Math.round(score * 10) / 10,
        atrasada: !!(t.prazo && t.prazo < hoje),
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------- Dinheiro parado: regras de detecção ----------
async function detectarDinheiroParado() {
  const hoje = isoDate();
  const alertas = [];

  const push = (
    nivel,
    area,
    titulo,
    detalhe,
    acao,
    link,
    valor = 0
  ) => {
    alertas.push({
      nivel,
      area,
      titulo,
      detalhe,
      acao,
      link,
      valor: num(valor),
    });
  };

  const leadsFollowup = await all(`
    SELECT *
    FROM leads
    WHERE estagio NOT IN ('Cliente', 'Perdido')
      AND proximo_contato IS NOT NULL
      AND proximo_contato < ?
  `, hoje);

  for (const l of leadsFollowup) {
    push(
      'alto',
      'Leads',
      `Follow-up atrasado: ${l.nome}`,
      `Deveria ter sido contatado em ${String(l.proximo_contato).split('-').reverse().join('/')}.`,
      'Retomar contato hoje com o script de follow-up.',
      `#/e/leads/${l.id}`,
      l.valor_potencial
    );
  }

  const leadsQuentes = await all(`
    SELECT *
    FROM leads
    WHERE temperatura = 'Quente'
      AND estagio NOT IN ('Cliente', 'Perdido')
      AND (
        ultimo_contato IS NULL
        OR ultimo_contato <= ?
      )
  `, addDays(hoje, -2));

  for (const l of leadsQuentes) {
    push(
      'alto',
      'Leads',
      `Lead quente sem contato: ${l.nome}`,
      l.ultimo_contato
        ? `Último contato há ${daysBetween(l.ultimo_contato, hoje)} dias.`
        : 'Nenhum contato registrado.',
      'Abordar hoje e levar para oferta ou diagnóstico.',
      `#/e/leads/${l.id}`,
      l.valor_potencial
    );
  }

  const leadsSemProximo = await all(`
    SELECT *
    FROM leads
    WHERE estagio NOT IN ('Cliente', 'Perdido')
      AND proximo_contato IS NULL
  `);

  for (const l of leadsSemProximo) {
    push(
      'medio',
      'Leads',
      `Lead sem próximo passo: ${l.nome}`,
      'Não há data de próximo contato.',
      'Definir data e mensagem de follow-up.',
      `#/e/leads/${l.id}`,
      l.valor_potencial
    );
  }

  const propostasSemRetorno = await all(`
    SELECT *
    FROM propostas
    WHERE status = 'Enviada'
      AND data_envio IS NOT NULL
      AND data_envio <= ?
  `, addDays(hoje, -5));

  for (const p of propostasSemRetorno) {
    push(
      'alto',
      'Propostas',
      `Proposta sem retorno: ${p.titulo}`,
      `Enviada há ${daysBetween(p.data_envio, hoje)} dias.`,
      'Follow-up B2B enfatizando a perda financeira identificada.',
      `#/e/propostas/${p.id}`,
      p.valor
    );
  }

  const propostasAprovadas = await all(`
    SELECT *
    FROM propostas
    WHERE status = 'Aprovada'
  `);

  for (const p of propostasAprovadas) {
    push(
      'alto',
      'Propostas',
      `Proposta aprovada e não enviada: ${p.titulo}`,
      'Já foi aprovada pelo fundador.',
      'Enviar hoje.',
      `#/e/propostas/${p.id}`,
      p.valor
    );
  }

  const produtosSemOferta = await all(`
    SELECT *
    FROM produtos
    WHERE status NOT IN ('Pausado')
      AND NOT EXISTS (
        SELECT 1
        FROM ofertas o
        WHERE o.produto_id = produtos.id
      )
  `);

  for (const p of produtosSemOferta) {
    push(
      'medio',
      'Produtos',
      `Produto sem oferta: ${p.nome}`,
      'Existe produto, mas não existe oferta estruturada.',
      'Criar oferta com headline, promessa, prova e CTA.',
      `#/e/ofertas/novo?produto_id=${p.id}`
    );
  }

  const ofertasIncompletas = await all(`
    SELECT *
    FROM ofertas
    WHERE status NOT IN ('Pausada')
      AND (
        cta IS NULL OR cta = ''
        OR prova IS NULL OR prova = ''
        OR headline IS NULL OR headline = ''
      )
  `);

  for (const o of ofertasIncompletas) {
    const falta = [
      !o.headline && 'headline',
      !o.prova && 'prova',
      !o.cta && 'CTA',
    ]
      .filter(Boolean)
      .join(', ');

    push(
      'medio',
      'Ofertas',
      `Oferta incompleta: ${o.nome}`,
      `Falta: ${falta}.`,
      'Completar a oferta antes de investir em tráfego.',
      `#/e/ofertas/${o.id}`
    );
  }

  const conteudosSemFuncao = await all(`
    SELECT *
    FROM conteudos
    WHERE status != 'Publicado'
      AND (
        cta IS NULL
        OR cta = ''
        OR produto_id IS NULL
      )
  `);

  for (const c of conteudosSemFuncao) {
    push(
      'baixo',
      'Conteúdo',
      `Conteúdo sem função comercial: ${c.tema}`,
      'Sem CTA ou sem produto vinculado.',
      'Amarrar a um objetivo e a uma próxima ação.',
      `#/e/conteudos/${c.id}`
    );
  }

  const campanhasNegativas = await all(`
    SELECT *
    FROM campanhas
    WHERE status = 'Ativa'
      AND investimento > 0
      AND (
        (faturamento - investimento) / investimento
      ) < 0
  `);

  for (const c of campanhasNegativas) {
    push(
      'alto',
      'Campanhas',
      `Campanha com ROI negativo: ${c.nome}`,
      `Investiu ${brl(c.investimento)} e faturou ${brl(c.faturamento)}.`,
      'Cortar ou ajustar oferta e segmentação.',
      `#/e/campanhas/${c.id}`
    );
  }

  const tarefasTravadas = await all(`
    SELECT *
    FROM tarefas
    WHERE status = 'Travada'
      AND impacto = 'Alto'
  `);

  for (const t of tarefasTravadas) {
    push(
      'alto',
      'Execução',
      `Tarefa travando dinheiro: ${t.tarefa}`,
      'Impacto financeiro alto e status travada.',
      'Remover o bloqueio ou tomar a decisão pendente.',
      `#/e/tarefas/${t.id}`,
      t.valor_estimado
    );
  }

  const pend = await get(`
    SELECT COUNT(*) AS n
    FROM aprovacoes
    WHERE status = 'Pendente'
  `);

  const pendentes = num(pend?.n);

  if (pendentes) {
    push(
      'medio',
      'Governança',
      `${pendentes} aprovação(ões) pendente(s)`,
      'Decisões sensíveis aguardando o fundador.',
      'Decidir hoje para destravar a operação.',
      '#/aprovacoes'
    );
  }

  const peso = {
    alto: 3,
    medio: 2,
    baixo: 1,
  };

  const vistos = new Set();

  return alertas
    .filter((a) => {
      if (a.area !== 'Leads') return true;

      if (vistos.has(a.link)) {
        return false;
      }

      vistos.add(a.link);
      return true;
    })
    .sort(
      (a, b) =>
        peso[b.nivel] - peso[a.nivel] ||
        (b.valor || 0) - (a.valor || 0)
    );
}

// ---------- Financeiro ----------
async function resumoFinanceiro(inicio, fim) {
  const r = await get(`
    SELECT
      COALESCE(
        SUM(
          CASE
            WHEN tipo = 'Receita' THEN valor
            ELSE 0
          END
        ),
        0
      ) AS receita,

      COALESCE(
        SUM(
          CASE
            WHEN tipo = 'Despesa' THEN valor
            ELSE 0
          END
        ),
        0
      ) AS despesa,

      COUNT(
        CASE
          WHEN tipo = 'Receita' THEN 1
        END
      ) AS vendas

    FROM financeiro
    WHERE data BETWEEN ? AND ?
  `, inicio, fim);

  const receita = num(r?.receita);
  const despesa = num(r?.despesa);
  const vendas = num(r?.vendas);

  const lucro = receita - despesa;

  return {
    receita,
    despesa,
    vendas,
    lucro,
    margem: receita > 0 ? lucro / receita : null,
    ticket: vendas > 0 ? receita / vendas : null,
  };
}

async function serieMensal(meses = 6) {
  const out = [];

  const d = new Date();
  d.setDate(1);

  for (let i = meses - 1; i >= 0; i--) {
    const m = new Date(
      d.getFullYear(),
      d.getMonth() - i,
      1
    );

    const ini = isoDate(m);

    const fim = isoDate(
      new Date(
        m.getFullYear(),
        m.getMonth() + 1,
        0
      )
    );

    const r = await resumoFinanceiro(
      ini,
      fim
    );

    out.push({
      mes: m.toLocaleDateString('pt-BR', {
        month: 'short',
        year: '2-digit',
      }),
      receita: r.receita,
      despesa: r.despesa,
    });
  }

  return out;
}

// ---------- Painel ----------
router.get('/dashboard', async (req, res, next) => {
  try {
    const hoje = isoDate();
    const ini30 = addDays(hoje, -29);
    const iniMes = `${hoje.slice(0, 8)}01`;

    const funil = [];

    for (const e of ESTAGIOS_LEAD) {
      const row = await get(
        'SELECT COUNT(*) AS n FROM leads WHERE estagio = ?',
        e
      );

      funil.push({
        estagio: e,
        total: num(row?.n),
      });
    }

    const totalLeads = funil.reduce(
      (s, x) => s + x.total,
      0
    );

    const clientes =
      funil.find(
        (f) => f.estagio === 'Cliente'
      )?.total || 0;

    const leads30 = await get(`
      SELECT COUNT(*) AS n
      FROM leads
      WHERE created_at::date >= ?
    `, ini30);

    const qualificados30 = await get(`
      SELECT COUNT(*) AS n
      FROM leads
      WHERE created_at::date >= ?
        AND temperatura IN ('Quente', 'Morno')
    `, ini30);

    const followHoje = await all(`
      SELECT
        id,
        nome,
        canal,
        contato,
        temperatura,
        estagio,
        proximo_contato,
        mensagem_followup,
        valor_potencial
      FROM leads
      WHERE estagio NOT IN ('Cliente', 'Perdido')
        AND proximo_contato <= ?
      ORDER BY
        proximo_contato,
        valor_potencial DESC
      LIMIT 12
    `, hoje);

    const quentes = await all(`
      SELECT
        id,
        nome,
        estagio,
        valor_potencial
      FROM leads
      WHERE temperatura = 'Quente'
        AND estagio NOT IN ('Cliente', 'Perdido')
      ORDER BY valor_potencial DESC
      LIMIT 8
    `);

    const propostasPend = await all(`
      SELECT
        id,
        titulo,
        status,
        valor
      FROM propostas
      WHERE status IN (
        'Aguardando aprovação',
        'Aprovada',
        'Enviada'
      )
      ORDER BY valor DESC
      LIMIT 8
    `);

    const pipelineValorRow = await get(`
      SELECT COALESCE(
        SUM(valor_potencial),
        0
      ) AS v
      FROM leads
      WHERE estagio NOT IN ('Cliente', 'Perdido')
    `);

    const pipelineValor = num(
      pipelineValorRow?.v
    );

    // Produto com mais chance:
    // pronto/em teste + mais leads quentes/mornos vinculados
    const produtoFoco = await get(`
      SELECT
        p.id,
        p.nome,
        p.preco,
        p.status,

        (
          SELECT COUNT(*)
          FROM leads l
          WHERE l.produto_id = p.id
            AND l.temperatura IN ('Quente', 'Morno')
            AND l.estagio NOT IN ('Cliente', 'Perdido')
        ) AS leads_ativos,

        (
          SELECT COUNT(*)
          FROM ofertas o
          WHERE o.produto_id = p.id
            AND o.status IN ('Pronta', 'Em teste')
        ) AS ofertas

      FROM produtos p
      WHERE p.status NOT IN ('Pausado', 'Travado')

      ORDER BY
        CASE
          WHEN (
            SELECT COUNT(*)
            FROM ofertas o2
            WHERE o2.produto_id = p.id
              AND o2.status IN ('Pronta', 'Em teste')
          ) > 0 THEN 1
          ELSE 0
        END DESC,

        (
          SELECT COUNT(*)
          FROM leads l2
          WHERE l2.produto_id = p.id
            AND l2.temperatura IN ('Quente', 'Morno')
            AND l2.estagio NOT IN ('Cliente', 'Perdido')
        ) DESC,

        p.preco DESC

      LIMIT 1
    `);

    const produtosStatus = await all(`
      SELECT
        status,
        COUNT(*) AS total
      FROM produtos
      GROUP BY status
    `);

    const fin30 = await resumoFinanceiro(
      ini30,
      hoje
    );

    const finMes = await resumoFinanceiro(
      iniMes,
      hoje
    );

    const config = await getConfig();
    const meta = Number(
      config.meta_mensal || 0
    );

    const campanhas = await get(`
      SELECT
        COALESCE(SUM(investimento), 0) AS inv,
        COALESCE(SUM(leads), 0) AS leads,
        COALESCE(SUM(vendas), 0) AS vendas,
        COALESCE(SUM(faturamento), 0) AS fat
      FROM campanhas
      WHERE status IN ('Ativa', 'Encerrada')
    `);

    const campanhasResumo = {
      inv: num(campanhas?.inv),
      leads: num(campanhas?.leads),
      vendas: num(campanhas?.vendas),
      fat: num(campanhas?.fat),
    };

    const conteudoTop = await all(`
      SELECT
        id,
        tema,
        canal,
        leads_gerados
      FROM conteudos
      WHERE leads_gerados > 0
      ORDER BY leads_gerados DESC
      LIMIT 5
    `);

    const concluidas30 = await get(`
      SELECT COUNT(*) AS n
      FROM tarefas
      WHERE status = 'Concluída'
        AND concluida_em >= ?
    `, ini30);

    const concluidasImpacto = await get(`
      SELECT COUNT(*) AS n
      FROM tarefas
      WHERE status = 'Concluída'
        AND impacto = 'Alto'
        AND concluida_em >= ?
    `, ini30);

    const prioridades =
      (await priorizarTarefas()).slice(0, 6);

    const propostasEnv = await get(`
      SELECT COUNT(*) AS n
      FROM propostas
      WHERE status IN (
        'Enviada',
        'Aceita',
        'Recusada'
      )
    `);

    const propostasFech = await get(`
      SELECT COUNT(*) AS n
      FROM propostas
      WHERE status = 'Aceita'
    `);

    const checklist = await get(`
      SELECT respostas
      FROM checklists
      WHERE data = ?
    `, hoje);

    let acaoDoDia = null;

    if (checklist?.respostas) {
      try {
        acaoDoDia =
          JSON.parse(checklist.respostas)
            .acao_dinheiro || null;
      } catch {
        acaoDoDia = null;
      }
    }

    const alertasAll =
      await detectarDinheiroParado();

    const entidadesVazias = [];

    for (const t of [
      'negocios',
      'produtos',
      'ofertas',
      'leads',
      'tarefas',
    ]) {
      const row = await get(
        `SELECT COUNT(*) AS n FROM ${t}`
      );

      if (num(row?.n) > 0) {
        entidadesVazias.push(false);
      } else {
        entidadesVazias.push(true);
      }
    }

    const vazio = entidadesVazias.every(
      Boolean
    );

    res.json({
      vazio,
      hoje,
      acaoDoDia,

      dinheiroAgora: {
        produtoFoco,
        followHoje,
        quentes,
        propostasPend,
        pipelineValor,
      },

      funil: {
        etapas: funil,
        totalLeads,
        conversao:
          totalLeads > 0
            ? clientes / totalLeads
            : null,
        leads30: num(leads30?.n),
        qualificados30: num(
          qualificados30?.n
        ),
      },

      produtos: produtosStatus,

      financeiro: {
        ultimos30: fin30,
        mes: finMes,
        meta,
        serie: await serieMensal(6),
      },

      comercial: {
        propostasEnviadas: num(
          propostasEnv?.n
        ),
        propostasFechadas: num(
          propostasFech?.n
        ),
      },

      campanhas: {
        ...campanhasResumo,

        cpl:
          campanhasResumo.leads > 0
            ? campanhasResumo.inv /
              campanhasResumo.leads
            : null,

        cac:
          campanhasResumo.vendas > 0
            ? campanhasResumo.inv /
              campanhasResumo.vendas
            : null,

        roi:
          campanhasResumo.inv > 0
            ? (
                campanhasResumo.fat -
                campanhasResumo.inv
              ) /
              campanhasResumo.inv
            : null,
      },

      conteudoTop,

      execucao: {
        concluidas30: num(
          concluidas30?.n
        ),

        concluidasImpacto: num(
          concluidasImpacto?.n
        ),

        prioridades,

        receitaPorAcao:
          num(concluidas30?.n) > 0
            ? fin30.receita /
              num(concluidas30?.n)
            : null,
      },

      alertas: alertasAll.slice(0, 8),
      alertasTotal: alertasAll.length,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/alertas', async (req, res, next) => {
  try {
    res.json(
      await detectarDinheiroParado()
    );
  } catch (e) {
    next(e);
  }
});

router.get('/prioridades', async (req, res, next) => {
  try {
    res.json(
      await priorizarTarefas()
    );
  } catch (e) {
    next(e);
  }
});

// ---------- Kanban de leads ----------
router.post(
  '/leads/:id/mover',
  async (req, res, next) => {
    try {
      const { estagio } = req.body || {};

      if (!ESTAGIOS_LEAD.includes(estagio)) {
        return res.status(400).json({
          erro: 'Estágio inválido.',
        });
      }

      await db
        .prepare(`
          UPDATE leads
          SET
            estagio = ?,
            ultimo_contato = ?,
            updated_at = NOW()
          WHERE id = ?
        `)
        .run(
          estagio,
          isoDate(),
          req.params.id
        );

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/leads/:id/contatado',
  async (req, res, next) => {
    try {
      const dias = Math.max(
        1,
        Math.min(
          60,
          Number(req.body?.dias) || 2
        )
      );

      const hoje = isoDate();

      await db
        .prepare(`
          UPDATE leads
          SET
            ultimo_contato = ?,
            proximo_contato = ?,
            estagio = CASE
              WHEN estagio = 'Novo'
                THEN 'Contato feito'
              ELSE estagio
            END,
            updated_at = NOW()
          WHERE id = ?
        `)
        .run(
          hoje,
          addDays(hoje, dias),
          req.params.id
        );

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

// ---------- Checklist diário ----------
const CHECKLIST = [
  {
    id: 'prioridade',
    pergunta: 'Qual é a prioridade comercial de hoje?',
    dica: 'Uma ação principal, não uma lista genérica.',
  },
  {
    id: 'produto',
    pergunta: 'Qual produto tem mais chance de vender agora?',
    dica: 'Produto com oferta clara e lead possível.',
  },
  {
    id: 'lead',
    pergunta: 'Qual lead precisa de follow-up?',
    dica: 'Nome, canal, mensagem e próximo passo.',
  },
  {
    id: 'conteudo',
    pergunta: 'Qual conteúdo precisa ser publicado?',
    dica: 'Conteúdo com CTA ligado a produto.',
  },
  {
    id: 'oferta',
    pergunta: 'Qual oferta precisa ser melhorada?',
    dica: 'Headline, promessa, prova, preço ou CTA.',
  },
  {
    id: 'trava',
    pergunta: 'Qual tarefa está travando dinheiro?',
    dica: 'Gargalo operacional ou decisão pendente.',
  },
  {
    id: 'corte',
    pergunta: 'O que deve ser cortado?',
    dica: 'Distração, excesso de projeto ou vaidade estratégica.',
  },
  {
    id: 'acao_dinheiro',
    pergunta: 'Qual é a ação de dinheiro do dia?',
    dica: 'Atividade concreta que aproxima venda, lead ou proposta.',
  },
];

async function sugestoesChecklist() {
  const hoje = isoDate();

  const prioridades =
    await priorizarTarefas();

  const pri = prioridades[0];

  const lead = await get(`
    SELECT
      nome,
      canal
    FROM leads
    WHERE estagio NOT IN ('Cliente', 'Perdido')
      AND proximo_contato <= ?
    ORDER BY
      CASE
        WHEN temperatura = 'Quente' THEN 1
        ELSE 0
      END DESC,
      valor_potencial DESC
    LIMIT 1
  `, hoje);

  const conteudo = await get(`
    SELECT tema
    FROM conteudos
    WHERE status IN (
      'Agendado',
      'Produção',
      'Roteiro'
    )
    ORDER BY data
    LIMIT 1
  `);

  const oferta = await get(`
    SELECT nome
    FROM ofertas
    WHERE status IN (
      'Fraca',
      'Em teste',
      'Rascunho'
    )
    LIMIT 1
  `);

  const trava = await get(`
    SELECT tarefa
    FROM tarefas
    WHERE status = 'Travada'
    ORDER BY
      CASE
        WHEN impacto = 'Alto' THEN 1
        ELSE 0
      END DESC
    LIMIT 1
  `);

  const corte = await get(`
    SELECT tarefa
    FROM tarefas
    WHERE status IN (
      'A fazer',
      'Em andamento'
    )
      AND impacto = 'Baixo'
      AND esforco = 'Alto'
    LIMIT 1
  `);

  const produto = await get(`
    SELECT
      p.nome
    FROM produtos p
    LEFT JOIN ofertas o
      ON o.produto_id = p.id
    WHERE p.status NOT IN (
      'Pausado',
      'Travado'
    )
    GROUP BY
      p.id,
      p.nome,
      p.preco
    ORDER BY
      COUNT(o.id) DESC,
      p.preco DESC
    LIMIT 1
  `);

  return {
    prioridade: pri?.tarefa || '',
    produto: produto?.nome || '',
    lead: lead
      ? `${lead.nome} (${lead.canal || 'canal não informado'})`
      : '',
    conteudo: conteudo?.tema || '',
    oferta: oferta?.nome || '',
    trava: trava?.tarefa || '',
    corte: corte?.tarefa || '',
    acao_dinheiro: lead
      ? `Fazer follow-up com ${lead.nome}`
      : pri?.tarefa || '',
  };
}

router.get(
  '/checklist',
  async (req, res, next) => {
    try {
      const data =
        /^\d{4}-\d{2}-\d{2}$/.test(
          req.query.data || ''
        )
          ? req.query.data
          : isoDate();

      const row = await get(
        'SELECT * FROM checklists WHERE data = ?',
        data
      );

      const historico = await all(`
        SELECT data
        FROM checklists
        ORDER BY data DESC
        LIMIT 30
      `);

      let respostas = {};

      if (row?.respostas) {
        try {
          respostas = JSON.parse(
            row.respostas
          );
        } catch {
          respostas = {};
        }
      }

      res.json({
        data,
        perguntas: CHECKLIST,
        respostas,
        sugestoes:
          await sugestoesChecklist(),
        historico: historico.map(
          (r) => r.data
        ),
      });
    } catch (e) {
      next(e);
    }
  }
);

router.put(
  '/checklist',
  async (req, res, next) => {
    try {
      const {
        data,
        respostas,
      } = req.body || {};

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
          data || ''
        )
      ) {
        return res.status(400).json({
          erro: 'Data inválida.',
        });
      }

      const clean = {};

      for (const q of CHECKLIST) {
        clean[q.id] = String(
          respostas?.[q.id] || ''
        ).slice(0, 2000);
      }

      await db
        .prepare(`
          INSERT INTO checklists
            (conta_id, data, respostas)
          VALUES
            (
              (SELECT current_setting(
                'app.conta_id'
              )::BIGINT),
              ?,
              ?
            )
          ON CONFLICT (conta_id, data)
          DO UPDATE SET
            respostas = EXCLUDED.respostas,
            updated_at = NOW()
        `)
        .run(
          data,
          JSON.stringify(clean)
        );

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

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

async function gerarRelatorio(ini, fim) {
  const lista = (
    arr,
    fn,
    vazio
  ) =>
    arr.length
      ? arr
          .map((x) => '- ' + fn(x))
          .join('\n')
      : vazio;

  const rec = await all(`
    SELECT
      descricao,
      valor
    FROM financeiro
    WHERE tipo = 'Receita'
      AND data BETWEEN ? AND ?
    ORDER BY valor DESC
  `, ini, fim);

  const totalRec = rec.reduce(
    (s, r) => s + num(r.valor),
    0
  );

  const aceitas = await all(`
    SELECT
      titulo,
      valor
    FROM propostas
    WHERE status = 'Aceita'
      AND updated_at::date BETWEEN ? AND ?
  `, ini, fim);

  const novos = await all(`
    SELECT
      nome,
      canal,
      temperatura
    FROM leads
    WHERE created_at::date BETWEEN ? AND ?
  `, ini, fim);

  const diag = await get(`
    SELECT COUNT(*) AS n
    FROM diagnosticos
    WHERE created_at::date BETWEEN ? AND ?
  `, ini, fim);

  const alertas = (
    await detectarDinheiroParado()
  )
    .filter((a) => a.nivel !== 'baixo')
    .slice(0, 6);

  const produtos = await all(`
    SELECT
      p.nome,
      COUNT(l.id) AS n
    FROM produtos p
    LEFT JOIN leads l
      ON l.produto_id = p.id
      AND l.estagio NOT IN (
        'Cliente',
        'Perdido'
      )
    GROUP BY
      p.id,
      p.nome,
      p.preco
    ORDER BY
      n DESC,
      p.preco DESC
    LIMIT 3
  `);

  const leads = await all(`
    SELECT
      nome,
      temperatura,
      estagio
    FROM leads
    WHERE estagio NOT IN (
      'Cliente',
      'Perdido'
    )
    ORDER BY
      CASE
        WHEN temperatura = 'Quente' THEN 1
        ELSE 0
      END DESC,
      valor_potencial DESC
    LIMIT 6
  `);

  const camp = await all(`
    SELECT
      nome,
      investimento,
      faturamento,
      leads
    FROM campanhas
    WHERE status = 'Ativa'
  `);

  const aprov = await all(`
    SELECT titulo
    FROM aprovacoes
    WHERE status = 'Pendente'
  `);

  const pri = (
    await priorizarTarefas()
  ).slice(0, 5);

  const tarefasBaixoImpacto = await all(`
    SELECT tarefa
    FROM tarefas
    WHERE status IN (
      'A fazer',
      'Em andamento'
    )
      AND impacto = 'Baixo'
  `);

  const cortes = [
    ...camp
      .filter(
        (c) =>
          num(c.investimento) > 0 &&
          num(c.faturamento) <
            num(c.investimento)
      )
      .map(
        (c) =>
          `Campanha "${c.nome}" (ROI negativo)`
      ),

    ...tarefasBaixoImpacto.map(
      (t) =>
        `Tarefa "${t.tarefa}" (impacto baixo)`
    ),
  ];

  const foco = await get(`
    SELECT
      nome,
      produto
    FROM negocios
    WHERE status = 'Em foco'
    ORDER BY prioridade
    LIMIT 1
  `);

  return {
    gerou_dinheiro:
      rec.length || aceitas.length
        ? `Receita da semana: ${brl(totalRec)}\n` +
          lista(
            rec,
            (r) =>
              `${r.descricao}: ${brl(r.valor)}`,
            ''
          ) +
          (aceitas.length
            ? '\nPropostas aceitas:\n' +
              lista(
                aceitas,
                (p) =>
                  `${p.titulo} (${brl(p.valor)})`,
                ''
              )
            : '')
        : 'Nenhuma receita registrada nesta semana.',

    gerou_oportunidade:
      `${novos.length} lead(s) novo(s) e ${num(diag?.n)} diagnóstico(s) recebido(s).\n` +
      lista(
        novos.slice(0, 8),
        (l) =>
          `${l.nome} (${l.canal || 'sem canal'}, ${l.temperatura || 'sem temperatura'})`,
        ''
      ),

    travou_receita: lista(
      alertas,
      (a) =>
        `${a.titulo}. ${a.detalhe}`,
      'Nenhum gargalo relevante detectado.'
    ),

    produtos_potencial: lista(
      produtos,
      (p) =>
        `${p.nome}: ${num(p.n)} lead(s) ativo(s)`,
      'Cadastre produtos para acompanhar.'
    ),

    leads_importantes: lista(
      leads,
      (l) =>
        `${l.nome}: ${l.temperatura || 'sem temperatura'}, ${l.estagio}`,
      'Nenhum lead ativo.'
    ),

    campanhas: lista(
      camp,
      (c) =>
        `${c.nome}: ${brl(c.investimento)} investidos, ${num(c.leads)} leads, ${brl(c.faturamento)} faturados`,
      'Nenhuma campanha ativa.'
    ),

    decisoes_pendentes: lista(
      aprov,
      (a) => a.titulo,
      'Nenhuma aprovação pendente.'
    ),

    proximas_acoes: lista(
      pri,
      (t) =>
        `${t.tarefa}${t.prazo ? ` (até ${String(t.prazo).split('-').reverse().join('/')})` : ''}`,
      'Cadastre tarefas com impacto financeiro.'
    ),

    corte: lista(
      cortes.slice(0, 5),
      (c) => c,
      'Nada evidente para cortar. Revise distrações fora do sistema.'
    ),

    foco: foco
      ? `${foco.nome}${foco.produto ? `: ${foco.produto}` : ''}`
      : 'Defina o negócio em foco para o ciclo.',
  };
}

router.get(
  '/relatorios',
  async (req, res, next) => {
    try {
      res.json({
        secoes: SECOES,
        lista: await all(`
          SELECT
            id,
            semana_inicio,
            semana_fim,
            updated_at
          FROM relatorios
          ORDER BY semana_inicio DESC
        `),
      });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  '/relatorios/:id',
  async (req, res, next) => {
    try {
      const r = await get(
        'SELECT * FROM relatorios WHERE id = ?',
        req.params.id
      );

      if (!r) {
        return res.status(404).json({
          erro: 'Relatório não encontrado.',
        });
      }

      let secoes = {};

      try {
        secoes = JSON.parse(r.secoes);
      } catch {
        secoes = {};
      }

      res.json({
        ...r,
        secoes,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/relatorios/gerar',
  async (req, res, next) => {
    try {
      const fim =
        /^\d{4}-\d{2}-\d{2}$/.test(
          req.body?.fim || ''
        )
          ? req.body.fim
          : isoDate();

      const ini = addDays(fim, -6);

      const secoes =
        await gerarRelatorio(
          ini,
          fim
        );

      const result = await db
        .prepare(`
          INSERT INTO relatorios
            (
              conta_id,
              semana_inicio,
              semana_fim,
              secoes
            )
          VALUES
            (
              (SELECT current_setting(
                'app.conta_id'
              )::BIGINT),
              ?,
              ?,
              ?
            )
          RETURNING id
        `)
        .run(
          ini,
          fim,
          JSON.stringify(secoes)
        );

      res.json({
        id: result.lastInsertRowid,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.put(
  '/relatorios/:id',
  async (req, res, next) => {
    try {
      const secoes = {};

      for (const [k] of SECOES) {
        secoes[k] = String(
          req.body?.secoes?.[k] || ''
        ).slice(0, 10000);
      }

      await db
        .prepare(`
          UPDATE relatorios
          SET
            secoes = ?,
            updated_at = NOW()
          WHERE id = ?
        `)
        .run(
          JSON.stringify(secoes),
          req.params.id
        );

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

router.delete(
  '/relatorios/:id',
  async (req, res, next) => {
    try {
      await db
        .prepare(`
          DELETE FROM relatorios
          WHERE id = ?
        `)
        .run(req.params.id);

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

// ---------- Identidade / configurações ----------
router.get(
  '/config',
  async (req, res, next) => {
    try {
      res.json(
        await getConfig()
      );
    } catch (e) {
      next(e);
    }
  }
);

router.put(
  '/config',
  async (req, res, next) => {
    try {
      if (req.user.papel !== 'admin') {
        return res.status(403).json({
          erro: 'Somente o fundador altera a identidade do sistema.',
        });
      }

      const permitidas = [
        'nome',
        'subtitulo',
        'missao',
        'funcao',
        'produtos_prioritarios',
        'principios',
        'frase',
        'manifesto',
        'prompt_extra',
      ];

      const stmt = db.prepare(`
        INSERT INTO configuracoes
          (
            conta_id,
            chave,
            valor
          )
        VALUES
          (
            (SELECT current_setting(
              'app.conta_id'
            )::BIGINT),
            ?,
            ?
          )
        ON CONFLICT (conta_id, chave)
        DO UPDATE SET
          valor = EXCLUDED.valor
      `);

      for (const k of permitidas) {
        if (k in (req.body || {})) {
          await stmt.run(
            `identidade.${k}`,
            String(
              req.body[k]
            ).slice(0, 10000)
          );
        }
      }

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

// ---------- Resumo textual do estado do negócio ----------
async function snapshot() {
  const hoje = isoDate();

  const fin = await resumoFinanceiro(
    addDays(hoje, -29),
    hoje
  );

  const funilPartes = [];

  for (const e of ESTAGIOS_LEAD) {
    const row = await get(
      'SELECT COUNT(*) AS n FROM leads WHERE estagio = ?',
      e
    );

    funilPartes.push(
      `${e}: ${num(row?.n)}`
    );
  }

  const funil = funilPartes.join(', ');

  const produtos = (
    await all(`
      SELECT
        nome,
        marca,
        preco,
        status,
        promessa
      FROM produtos
    `)
  )
    .map(
      (p) =>
        `- ${p.nome} (${p.marca}, ${brl(p.preco)}, ${p.status}): ${p.promessa || 'sem promessa'}`
    )
    .join('\n');

  const ofertas = (
    await all(`
      SELECT
        nome,
        headline,
        cta,
        status
      FROM ofertas
    `)
  )
    .map(
      (o) =>
        `- ${o.nome} [${o.status}]: ${o.headline || 'sem headline'} | CTA: ${o.cta || 'sem CTA'}`
    )
    .join('\n');

  const leads = (
    await all(`
      SELECT
        nome,
        temperatura,
        estagio,
        dor,
        proximo_contato,
        valor_potencial
      FROM leads
      WHERE estagio NOT IN (
        'Cliente',
        'Perdido'
      )
      ORDER BY
        CASE
          WHEN temperatura = 'Quente' THEN 1
          ELSE 0
        END DESC,
        valor_potencial DESC
      LIMIT 15
    `)
  )
    .map(
      (l) =>
        `- ${l.nome}: ${l.temperatura || '?'}, ${l.estagio}, dor: ${l.dor || '?'}, próximo contato: ${l.proximo_contato || 'sem data'}, potencial ${brl(l.valor_potencial)}`
    )
    .join('\n');

  const tarefas = (
    await priorizarTarefas()
  )
    .slice(0, 8)
    .map(
      (t) =>
        `- ${t.tarefa} (${t.impacto || '?'} impacto, prazo ${t.prazo || 'sem prazo'}, ${t.status})`
    )
    .join('\n');

  const alertas = (
    await detectarDinheiroParado()
  )
    .slice(0, 10)
    .map(
      (a) =>
        `- [${a.nivel}] ${a.titulo}: ${a.detalhe}`
    )
    .join('\n');

  return `DATA DE HOJE: ${hoje}
FINANCEIRO (últimos 30 dias): receita ${brl(fin.receita)}, despesa ${brl(fin.despesa)}, lucro ${brl(fin.lucro)}, ${fin.vendas} vendas.
PRODUTOS:
${produtos || '- nenhum'}
OFERTAS:
${ofertas || '- nenhuma'}
FUNIL DE LEADS: ${funil}
LEADS ATIVOS PRINCIPAIS:
${leads || '- nenhum'}
TAREFAS PRIORIZADAS:
${tarefas || '- nenhuma'}
DINHEIRO PARADO DETECTADO:
${alertas || '- nada detectado'}`;
}

module.exports = {
  router,
  snapshot,
  getConfig,
  detectarDinheiroParado,
  priorizarTarefas,
};