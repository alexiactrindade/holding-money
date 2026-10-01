const express = require('express');
const { db } = require('./db-pg');
const {
  snapshot,
  getConfig,
  detectarDinheiroParado,
  priorizarTarefas,
} = require('./insights');
const { brl } = require('./util');
const { contextoTexto } = require('./contexto');

const router = express.Router();

const MODELOS = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-3.5-flash',
};

function credenciais() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();

  const env = (prov, chave) => ({
    prov,
    chave,
    modelo: process.env.AI_MODEL || MODELOS[prov],
  });

  if (
    p === 'gemini' &&
    process.env.GEMINI_API_KEY
  ) {
    return env('gemini', process.env.GEMINI_API_KEY);
  }

  if (
    p === 'openai' &&
    process.env.OPENAI_API_KEY
  ) {
    return env('openai', process.env.OPENAI_API_KEY);
  }

  if (
    p === 'anthropic' &&
    process.env.ANTHROPIC_API_KEY
  ) {
    return env('anthropic', process.env.ANTHROPIC_API_KEY);
  }

  if (process.env.GEMINI_API_KEY) {
    return env('gemini', process.env.GEMINI_API_KEY);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return env('anthropic', process.env.ANTHROPIC_API_KEY);
  }

  if (process.env.OPENAI_API_KEY) {
    return env('openai', process.env.OPENAI_API_KEY);
  }

  return null;
}

const disponivel = () => !!credenciais();

async function ligadaPeloUsuario() {
  const row = await db
    .prepare(`
      SELECT valor
      FROM configuracoes
      WHERE chave = ?
    `)
    .get('ia.ativa');

  return row?.valor !== '0';
}

async function iaAtiva() {
  return disponivel() && await ligadaPeloUsuario();
}

async function provider() {
  return (await iaAtiva())
    ? credenciais().prov
    : null;
}

// Erro técnico da IA
class ErroIA extends Error {}

function erroAmigavel(status, detalhe) {
  console.error('[IA]', status, detalhe);

  if (status === 429) {
    return new ErroIA(
      'A IA recebeu muitos pedidos agora. Aguarde um minuto e tente de novo.'
    );
  }

  if (status >= 500) {
    return new ErroIA(
      'O serviço de IA está instável neste momento. Tente de novo em alguns minutos.'
    );
  }

  if (
    [401, 402, 403].includes(status) ||
    /credit|billing|quota/i.test(detalhe || '')
  ) {
    return new ErroIA(
      'A IA está indisponível no momento. Tente de novo mais tarde.'
    );
  }

  return new ErroIA(
    'Não foi possível falar com a IA agora. Tente de novo em instantes.'
  );
}

async function promptMestre(agente) {
  const c = await getConfig();

  let p = `Você é o ${c.nome || 'Holding Money'}, o sistema central de inteligência comercial, monetização e execução de ${c.fundador || 'o fundador'}${c.empresa ? ` (${c.empresa})` : ''}.
Sua missão é transformar ideias, marcas, produtos, conteúdos, relacionamentos e dados em receita organizada.
Seu foco principal é dinheiro real, não vaidade estratégica. Pense sempre em geração de caixa, estrutura comercial, clareza de oferta, posicionamento, produto vendável, funil, lead, conversão, margem e execução.
Antes de sugerir qualquer ação, avalie se ela gera dinheiro direto, autoridade, relacionamento, ativo, redução de custo, melhora de conversão ou velocidade de execução.
Seja direto, estratégico, exigente, comercial e orientado a ação. Não bajule, não romantize ideia fraca, não crie complexidade desnecessária, não sugira tecnologia antes de validar o modelo comercial, não priorize estética quando a oferta está fraca e não confunda movimento com progresso.
Sempre que receber uma ideia, transforme em: diagnóstico, oportunidade, produto possível, oferta, público-alvo, canal, ação prática, próximo passo e indicador de sucesso.
Sua pergunta central é: onde existe dinheiro parado, mal estruturado ou ainda não capturado?
Limite operacional: você prepara, organiza, analisa e sugere. Proposta final, contrato, alteração de preço, envio de campanha, decisão financeira e posicionamento público delicado passam por aprovação humana do fundador. Você não substitui orientação jurídica, contábil, tributária ou financeira especializada.
Responda em português do Brasil. Use os dados reais do negócio abaixo; se faltar dado, diga qual dado falta. Sua resposta deve sempre terminar com uma decisão ou próxima ação, em uma linha que comece com "Próxima ação:".

Princípios: ${c.principios || ''}
Frase de comando: ${c.frase || ''}
${c.manifesto ? `Manifesto: ${c.manifesto}\n` : ''}
=== CONTEXTO DA EMPRESA (informado pelo dono) ===
${contextoTexto(c) || 'O dono ainda não preencheu o contexto da empresa. Peça essas informações antes de recomendar estratégias específicas.'}`;

  if (c.prompt_extra) {
    p += `\n\nInstruções adicionais do fundador:\n${c.prompt_extra}`;
  }

  if (agente) {
    p += `\n\nNesta conversa você atua como o AGENTE ${agente.nome.toUpperCase()}.
Função: ${agente.funcao}
Pergunta central que guia sua análise: ${agente.pergunta}`;

    if (agente.instrucoes) {
      p += `\nInstruções do agente: ${agente.instrucoes}`;
    }
  }

  p += `\n\n=== DADOS ATUAIS DO NEGÓCIO ===\n${await snapshot()}`;

  return p;
}

async function chamarIA(
  system,
  mensagens,
  { maxTokens = 2000 } = {}
) {
  if (!(await iaAtiva())) {
    return null;
  }

  const cred = credenciais();

  let r;
  let data;

  try {
    if (cred.prov === 'anthropic') {
      r = await fetch(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': cred.chave,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: cred.modelo,
            max_tokens: maxTokens,
            system,
            messages: mensagens,
          }),
        }
      );
    } else if (cred.prov === 'gemini') {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cred.modelo)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': cred.chave,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: system }],
            },
            contents: mensagens.map((m) => ({
              role:
                m.role === 'assistant'
                  ? 'model'
                  : 'user',
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              maxOutputTokens: maxTokens * 4,
              thinkingConfig: {
                thinkingLevel: 'low',
              },
            },
          }),
        }
      );
    } else {
      r = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${cred.chave}`,
          },
          body: JSON.stringify({
            model: cred.modelo,
            max_tokens: maxTokens,
            messages: [
              {
                role: 'system',
                content: system,
              },
              ...mensagens,
            ],
          }),
        }
      );
    }

    data = await r.json().catch(() => ({}));
  } catch (e) {
    console.error('[IA] falha de rede', e.message);

    throw new ErroIA(
      'Não foi possível conectar ao serviço de IA. Verifique a conexão com a internet e tente de novo.'
    );
  }

  if (!r.ok) {
    const det =
      data?.error?.message ||
      data?.error?.type ||
      data?.error?.status;

    const status =
      r.status === 400 &&
      /api key|API_KEY/i.test(
        JSON.stringify(data?.error || '')
      )
        ? 401
        : r.status;

    throw erroAmigavel(status, det);
  }

  if (cred.prov === 'anthropic') {
    return data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  if (cred.prov === 'gemini') {
    const partes =
      data?.candidates?.[0]?.content?.parts || [];

    const texto = partes
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('\n')
      .trim();

    if (!texto) {
      console.error(
        '[IA] Gemini sem texto',
        data?.promptFeedback ||
          data?.candidates?.[0]?.finishReason
      );

      throw new ErroIA(
        'A IA não conseguiu responder a esse pedido. Tente reformular.'
      );
    }

    return texto;
  }

  return data.choices[0].message.content;
}

// Sem chave de IA: responde com o motor de regras do próprio sistema
async function respostaLocal(msg) {
  const t = msg.toLowerCase();

  const alertas = await detectarDinheiroParado();
  const pri = await priorizarTarefas();

  const partes = [];

  if (
    t.includes('prioriz') ||
    t.includes('semana')
  ) {
    partes.push(
      'Ranking das ações por impacto financeiro, urgência e esforço:'
    );

    pri
      .slice(0, 7)
      .forEach((x, i) => {
        partes.push(
          `${i + 1}. ${x.tarefa} (impacto ${x.impacto || '?'}, prazo ${x.prazo ? x.prazo.split('-').reverse().join('/') : 'sem prazo'})`
        );
      });

    if (!pri.length) {
      partes.push(
        'Nenhuma tarefa aberta. Cadastre tarefas com impacto financeiro.'
      );
    }
  }

  if (
    t.includes('follow') ||
    t.includes('lead')
  ) {
    const leads = await db
      .prepare(`
        SELECT
          nome,
          canal,
          temperatura,
          proximo_contato,
          valor_potencial
        FROM leads
        WHERE estagio NOT IN ('Cliente', 'Perdido')
          AND proximo_contato <= CURRENT_DATE
        ORDER BY
          CASE
            WHEN temperatura = 'Quente' THEN 1
            ELSE 0
          END DESC,
          valor_potencial DESC
      `)
      .all();

    partes.push(
      leads.length
        ? 'Leads que precisam de follow-up hoje:'
        : 'Nenhum follow-up vencido hoje.'
    );

    leads.forEach((l) =>
      partes.push(
        `- ${l.nome} (${l.canal || 'sem canal'}, ${l.temperatura || 'sem temperatura'}, potencial ${brl(l.valor_potencial)})`
      )
    );
  }

  if (
    !partes.length ||
    t.includes('parado') ||
    t.includes('dinheiro')
  ) {
    partes.push(
      alertas.length
        ? 'Onde há dinheiro parado agora:'
        : 'Nenhum ponto de dinheiro parado detectado nos dados.'
    );

    alertas
      .slice(0, 8)
      .forEach((a) =>
        partes.push(
          `- ${a.titulo}. ${a.detalhe} Ação: ${a.acao}`
        )
      );
  }

  const prox =
    alertas[0]?.acao ||
    pri[0]?.tarefa ||
    'Cadastrar produtos, ofertas e leads para o sistema operar.';

  partes.push(`\nPróxima ação: ${prox}`);

  return partes.join('\n');
}

router.get('/status', async (req, res, next) => {
  try {
    res.json({
      disponivel: disponivel(),
      ativa: await iaAtiva(),
    });
  } catch (e) {
    next(e);
  }
});

// O fundador liga ou desliga o uso da IA
router.put('/ia', async (req, res, next) => {
  try {
    if (req.user.papel !== 'admin') {
      return res.status(403).json({
        erro: 'Somente o fundador liga ou desliga a IA.',
      });
    }

    if (!disponivel()) {
      return res.status(400).json({
        erro: 'A IA não está disponível no momento.',
      });
    }

    await db
      .prepare(`
        INSERT INTO configuracoes
          (chave, valor)
        VALUES
          (?, ?)
        ON CONFLICT (conta_id, chave)
        DO UPDATE SET
          valor = EXCLUDED.valor
      `)
      .run(
        'ia.ativa',
        req.body?.ativa ? '1' : '0'
      );

    res.json({
      disponivel: true,
      ativa: await iaAtiva(),
    });
  } catch (e) {
    next(e);
  }
});

router.get(
  '/historico',
  async (req, res, next) => {
    try {
      const agente =
        req.query.agente || 'Core';

      const rows = await db
        .prepare(`
          SELECT
            papel,
            conteudo,
            created_at
          FROM core_mensagens
          WHERE usuario_id = ?
            AND agente = ?
          ORDER BY id DESC
          LIMIT 40
        `)
        .all(
          req.user.id,
          agente
        );

      res.json(rows.reverse());
    } catch (e) {
      next(e);
    }
  }
);

router.delete(
  '/historico',
  async (req, res, next) => {
    try {
      await db
        .prepare(`
          DELETE FROM core_mensagens
          WHERE usuario_id = ?
            AND agente = ?
        `)
        .run(
          req.user.id,
          req.query.agente || 'Core'
        );

      res.json({
        ok: true,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post('/chat', async (req, res, next) => {
  try {
    const mensagem = String(
      req.body?.mensagem || ''
    )
      .trim()
      .slice(0, 8000);

    const agenteNome = String(
      req.body?.agente || 'Core'
    );

    if (!mensagem) {
      return res.status(400).json({
        erro: 'Escreva uma mensagem.',
      });
    }

    let agente = null;

    if (agenteNome !== 'Core') {
      agente = await db
        .prepare(`
          SELECT *
          FROM agentes
          WHERE nome = ?
            AND ativo = 'Sim'
        `)
        .get(agenteNome);

      if (!agente) {
        return res.status(400).json({
          erro: 'Agente não encontrado ou inativo.',
        });
      }
    }

    const hist = await db
      .prepare(`
        SELECT
          papel,
          conteudo
        FROM core_mensagens
        WHERE usuario_id = ?
          AND agente = ?
        ORDER BY id DESC
        LIMIT 12
      `)
      .all(
        req.user.id,
        agenteNome
      );

    let resposta;

    try {
      const system = await promptMestre(agente);

      resposta = await chamarIA(
        system,
        [
          ...hist
            .reverse()
            .map((h) => ({
              role: h.papel,
              content: h.conteudo,
            })),
          {
            role: 'user',
            content: mensagem,
          },
        ]
      );

      if (resposta === null) {
        resposta = await respostaLocal(
          mensagem
        );
      }
    } catch (e) {
      return res.status(502).json({
        erro:
          e instanceof ErroIA
            ? e.message
            : 'A IA não conseguiu responder agora. Tente de novo em instantes.',
      });
    }

    await db
      .prepare(`
        INSERT INTO core_mensagens
          (usuario_id, agente, papel, conteudo)
        VALUES
          (?, ?, ?, ?)
      `)
      .run(
        req.user.id,
        agenteNome,
        'user',
        mensagem
      );

    await db
      .prepare(`
        INSERT INTO core_mensagens
          (usuario_id, agente, papel, conteudo)
        VALUES
          (?, ?, ?, ?)
      `)
      .run(
        req.user.id,
        agenteNome,
        'assistant',
        resposta
      );

    res.json({
      resposta,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = {
  router,
  chamarIA,
  provider,
  promptMestre,
  ErroIA,
};