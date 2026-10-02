const { Pool } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');

const { entities, systemTables } = require('./schema');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/*
 * Tabelas que pertencem a uma conta (empresa).
 * As tabelas de dicionário NÃO entram aqui; as de sistema (contas,
 * usuarios) ficam de fora porque são acessadas via `sistema`.
 */
const TENANT_TABLES = new Set([
  ...Object.keys(entities),
  'configuracoes',
  'checklists',
  'relatorios',
  'core_mensagens',
  'historico',
]);

const TENANT_TABLES_SQL = [...TENANT_TABLES].join('|');

/*
 * SQLite -> PostgreSQL para as expressões de data usadas nas queries.
 */
function translateSql(sql) {
  return String(sql)
    .replace(/datetime\('now',\s*'localtime'\)/gi, 'NOW()')
    .replace(/date\('now',\s*'localtime'\)/gi, 'CURRENT_DATE');
}

/*
 * Isolamento por conta aplicado automaticamente nas queries.
 *
 * Como as tabelas de negócio são compartilhadas no PostgreSQL, toda
 * consulta feita pelo `db` dentro do contexto de uma conta recebe o
 * filtro conta_id (e os INSERTs recebem o conta_id automaticamente).
 * Assim cada empresa enxerga apenas os próprios dados.
 */
function scopeSql(sql) {
  if (!currentContaId()) return sql;

  let out = translateSql(sql);
  const tabelas = out.match(
    new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(${TENANT_TABLES_SQL})\\b`, 'gi')
  );

  if (!tabelas || !/\b(SELECT|UPDATE|DELETE)\b/i.test(out)) {
    return out;
  }

  if (/UPDATE|DELETE/i.test(out)) {
    if (/\bWHERE\b/i.test(out) && !/\bconta_id\s*=/i.test(out)) {
      out = out.replace(/\bWHERE\b/i, 'WHERE conta_id = ${__contaId} AND');
    }
    return out;
  }

  // SELECT: adiciona/estende o WHERE com o filtro de conta.
  if (/\bWHERE\b/i.test(out)) {
    if (!/\bconta_id\s*=/i.test(out)) {
      out = out.replace(/\bWHERE\b/i, 'WHERE conta_id = ${__contaId} AND');
    }
  } else {
    const ordem = out.search(
      /\b(ORDER\s+BY|LIMIT|GROUP\s+BY|HAVING|OFFSET)\b/i
    );
    if (ordem !== -1) {
      out = out.slice(0, ordem) + `WHERE conta_id = \${__contaId} ` + out.slice(ordem);
    } else {
      out = out.replace(/;?\s*$/, '') + ` WHERE conta_id = \${__contaId}`;
    }
  }

  return out;
}

function counter(from) {
  let n = from || 0;
  return () => ++n;
}

/*
 * Converte placeholders:
 *
 *   ?               -> $1, $2, ...
 *   ${__contaId}    -> $N (valor injetado na posição correta)
 */
function bindSql(sql, args, injetarContaId) {
  const values = [];
  const next = counter(0);

  const text = String(sql)
    .replace(/\?/g, () => {
      const i = next();
      values[i - 1] = normalizarValor(args[i - 1]);
      return `$${i}`;
    })
    .replace(/\$\{__contaId\}/g, () => {
      const i = next();
      values[i - 1] = currentContaId();
      return `$${i}`;
    });

  if (injetarContaId) {
    values.unshift(currentContaId());
  }

  return { text, values };
}

/*
 * Insere o conta_id nas colunas de um INSERT destinado a uma tabela
 * de negócio. Detecta automaticamente a lista de colunas.
 */
function injectContaId(text) {
  const alvo = text.match(
    new RegExp(`INSERT\\s+INTO\\s+(${TENANT_TABLES_SQL})\\b`, 'i')
  );
  if (!alvo) return null;

  const colunas = text.match(
    new RegExp(
      `INSERT\\s+INTO\\s+${alvo[1]}\\s*\\(([^)]*)\\)`,
      'i'
    )
  );

if (colunas) {
  if (/\bconta_id\b/i.test(colunas[1])) return null;

  const inicio = colunas.index + colunas[0].indexOf('(') + 1;
  const fim = colunas.index + colunas[0].lastIndexOf(')');

  const valoresIndex = text.toUpperCase().indexOf('VALUES', fim);

  if (valoresIndex === -1) return null;

  const abreValores = text.indexOf('(', valoresIndex);

  if (abreValores === -1) return null;

  return (
    text.slice(0, inicio) +
    'conta_id, ' +
    text.slice(inicio, fim) +
    text.slice(fim, abreValores + 1) +
    '$1, ' +
    text.slice(abreValores + 1)
  );
}

  // INSERT sem lista de colunas (ex.: INSERT INTO tabela VALUES ...)
  const idx = text.toUpperCase().indexOf('VALUES');
  if (idx === -1) return null;
  const abre = text.lastIndexOf(')', idx);
  if (abre === -1) return null;
  return text.slice(0, abre + 1) + ' conta_id,' + text.slice(abre + 1);
}

function normalizarValor(value) {
  if (value === undefined) return null;
  return value;
}

function plain(row) {
  return row || null;
}

function preparar(client, sql) {
  let text = translateSql(sql);
  let injetarContaId = false;

  if (currentContaId() && /^\s*INSERT\b/i.test(text)) {
    const comConta = injectContaId(text);
    if (comConta) {
      text = comConta;
      injetarContaId = true;
    }
  }

  const scoped = scopeSql(text);

  return {
    async run(...args) {
      const { text: t, values } = bindSql(scoped, args, injetarContaId);
      const result = await client.query(t, values);

      let lastInsertRowid = null;

      if (result.rows?.[0]?.id != null) {
        lastInsertRowid = Number(result.rows[0].id);
      }

      return {
        changes: result.rowCount || 0,
        lastInsertRowid,
      };
    },

    async get(...args) {
      const { text: t, values } = bindSql(scoped, args, injetarContaId);
      const result = await client.query(t, values);

      return plain(result.rows[0]);
    },

    async all(...args) {
      const { text: t, values } = bindSql(scoped, args, injetarContaId);
      const result = await client.query(t, values);

      return result.rows;
    },
  };
}

const als = new AsyncLocalStorage();

function currentStore() {
  return als.getStore() || null;
}

function currentContaId() {
  return currentStore()?.contaId || null;
}

function currentClient() {
  return currentStore()?.client || pool;
}

function assertConta() {
  const contaId = currentContaId();

  if (!contaId) {
    throw new Error('Acesso ao banco fora do contexto de uma conta.');
  }

  return contaId;
}

const db = {
  exec: async (sql) => {
    const client = currentClient();
    return client.query(sql);
  },

  prepare: (sql) => {
    const client = currentClient();
    return preparar(client, sql);
  },

  transaction: (fn) => {
    return async (...args) => {
      const existing = currentStore();

      /*
       * PostgreSQL não permite transação aninhada da mesma maneira
       * que o wrapper SQLite antigo.
       *
       * Se já estamos dentro de uma transação, simplesmente
       * executamos a função no mesmo client.
       */
      if (existing?.transaction) {
        return fn(...args);
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await als.run(
          {
            ...existing,
            client,
            contaId: existing?.contaId || null,
            transaction: true,
          },
          () => fn(...args)
        );

        await client.query('COMMIT');

        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignora erro secundário de rollback
        }

        throw error;
      } finally {
        client.release();
      }
    };
  },
};

/*
 * Banco de sistema.
 *
 * Diferentemente das tabelas de cada empresa, estas tabelas
 * não possuem conta_id.
 */
const sistema = {
  exec: async (sql) => {
    return currentClient().query(sql);
  },

  prepare: (sql) => {
    return preparar(currentClient(), sql);
  },

  transaction: (fn) => {
    return async (...args) => {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await als.run(
          {
            client,
            contaId: null,
            transaction: true,
            sistema: true,
          },
          () => fn(...args)
        );

        await client.query('COMMIT');

        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {}

        throw error;
      } finally {
        client.release();
      }
    };
  },
};
/*
 * Tabelas globais do sistema.
 */
async function migrateSistema() {
  await sistema.exec(`
    CREATE TABLE IF NOT EXISTS contas (
      id BIGSERIAL PRIMARY KEY,
      nome TEXT,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id BIGSERIAL PRIMARY KEY,
      conta_id BIGINT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      papel TEXT NOT NULL DEFAULT 'operador',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_usuarios_conta_id
      ON usuarios(conta_id);

    CREATE INDEX IF NOT EXISTS idx_usuarios_email
      ON usuarios(email);
  `);
}

function sqlType(field) {
  if (field.type === 'ref') return 'BIGINT';

  if (['number', 'money', 'percent', 'score'].includes(field.type)) {
    return 'DOUBLE PRECISION';
  }

  if (field.type === 'date') {
    return 'DATE';
  }

  return 'TEXT';
}

function quoteIdentifier(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Identificador SQL inválido: ${name}`);
  }

  return `"${name}"`;
}

/*
 * Cria uma tabela de negócio.
 *
 * Todas as tabelas pertencentes a uma empresa recebem conta_id.
 */
async function criarTabelaEntidade(table, def) {
  const tabela = quoteIdentifier(table);

  const colunas = def.fields
    .map((field) => {
      return `${quoteIdentifier(field.name)} ${sqlType(field)}`;
    })
    .join(',\n      ');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${tabela} (
      id BIGSERIAL PRIMARY KEY,
      conta_id BIGINT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      ${colunas ? `${colunas},` : ''}
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${table}_conta_id`)}
      ON ${tabela}(conta_id);
  `);

  /*
   * Compatibilidade com possíveis evoluções futuras do schema.
   */
  const existing = await db.prepare(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ?
  `).all(table);

  const nomesExistentes = new Set(
    existing.map((row) => row.column_name)
  );

  for (const field of def.fields) {
    if (nomesExistentes.has(field.name)) continue;

    await db.exec(`
      ALTER TABLE ${tabela}
      ADD COLUMN ${quoteIdentifier(field.name)} ${sqlType(field)}
    `);
  }
}

/*
 * Tabelas que antes vinham de schema.systemTables.
 *
 * Não usamos mais o SQL SQLite original.
 */
async function migrateTenant() {
  assertConta();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS configuracoes (
      conta_id BIGINT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      valor TEXT,
      PRIMARY KEY (conta_id, chave)
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id BIGSERIAL PRIMARY KEY,
      conta_id BIGINT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      respostas TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (conta_id, data)
    );

    CREATE TABLE IF NOT EXISTS relatorios (
      id BIGSERIAL PRIMARY KEY,
      conta_id BIGINT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      semana_inicio TEXT NOT NULL,
      semana_fim TEXT NOT NULL,
      secoes TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS core_mensagens (
      id BIGSERIAL PRIMARY KEY,
      conta_id BIGINT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      usuario_id BIGINT,
      agente TEXT,
      papel TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS historico (
      id BIGSERIAL PRIMARY KEY,
      conta_id BIGINT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      usuario TEXT,
      acao TEXT,
      entidade TEXT,
      registro_id BIGINT,
      detalhes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_configuracoes_conta
      ON configuracoes(conta_id);

    CREATE INDEX IF NOT EXISTS idx_checklists_conta
      ON checklists(conta_id);

    CREATE INDEX IF NOT EXISTS idx_relatorios_conta
      ON relatorios(conta_id);

    CREATE INDEX IF NOT EXISTS idx_core_mensagens_conta
      ON core_mensagens(conta_id);

    CREATE INDEX IF NOT EXISTS idx_historico_conta
      ON historico(conta_id);
  `);

  for (const [table, def] of Object.entries(entities)) {
    await criarTabelaEntidade(table, def);
  }
}

/*
 * Inicialização do banco.
 *
 * Deve ser chamada uma vez quando o servidor inicia.
 */
async function migrate() {
  await migrateSistema();
  console.log('PostgreSQL: estrutura do sistema verificada.');
}

/*
 * Contas cuja estrutura já foi preparada neste processo.
 * Evita rodar toda a DDL (migrateTenant + seed) a cada requisição.
 */
const contasPreparadas = new Set();

/*
 * Garante que a estrutura da conta exista.
 */
async function prepararConta(contaId) {
  const id = Number(contaId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Conta inválida');
  }

  if (contasPreparadas.has(id)) {
    return true;
  }

  return comConta(id, async () => {
    await migrateTenant();
    await seed();

    contasPreparadas.add(id);

    return true;
  });
}

/*
 * Executa código dentro do contexto de uma conta.
 *
 * A partir daqui todas as queries feitas por db.* recebem
 * automaticamente o conta_id correspondente.
 */
async function comConta(contaId, fn) {
  const id = Number(contaId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Conta inválida');
  }

  /*
   * Se já estamos dentro de uma transação, preservamos o client.
   */
  const existing = currentStore();

  if (existing?.transaction) {
    return als.run(
      {
        ...existing,
        contaId: id,
      },
      fn
    );
  }

  return als.run(
    {
      contaId: id,
      client: pool,
      transaction: false,
    },
    fn
  );
}

function contaAtual() {
  return currentContaId();
}

/*
 * Retorna o banco da conta.
 *
 * No PostgreSQL não existe mais um arquivo .db por empresa.
 * A função existe para preservar a ideia da API anterior.
 */
function bancoDaConta(contaId) {
  const id = Number(contaId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Conta inválida');
  }

  return {
    contaId: id,
    db,
  };
}

/*
 * INSERT genérico.
 *
 * Diferentemente do SQLite antigo, o conta_id é inserido
 * automaticamente nas tabelas de negócio.
 */
async function insert(table, obj = {}) {
  assertConta();

  const contaId = currentContaId();

  const dados = {
    ...obj,
    conta_id: contaId,
  };

  const keys = Object.keys(dados);

  if (!keys.length) {
    throw new Error('Nenhum dado para inserir.');
  }

  const columns = keys.map(quoteIdentifier).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

  const values = keys.map((key) => dados[key]);

  const sql = `
    INSERT INTO ${quoteIdentifier(table)}
      (${columns})
    VALUES
      (${placeholders})
    RETURNING id
  `;

  const result = await currentClient().query(sql, values);

  return Number(result.rows[0].id);
}

/*
 * Datas.
 */
function isoDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

function today(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return isoDate(d);
}

/*
 * Seed inicial da conta.
 */
async function seed() {
  assertConta();

  const contaId = currentContaId();

  const already = await db.prepare(`
    SELECT valor
    FROM configuracoes
    WHERE chave = 'seeded'
  `).get();

  if (already) return;

  const tx = db.transaction(async () => {
    const doutrina = {
      nome: 'Holding Money',
      subtitulo: 'Sistema Central de Inteligência Comercial, Monetização e Alta Performance',
      missao: 'Organizar negócios, produtos, dados, estratégias e execução para gerar receita real.',
      funcao: 'Detectar oportunidades de dinheiro, estruturar ativos comerciais e orientar execução diária.',
      principios: 'Não automatize antes de entender. Não escale antes de vender. Não crie tecnologia própria antes de validar caixa.',
      frase: 'Transformar visão em estrutura, estrutura em produto, produto em oferta, oferta em venda, venda em caixa e caixa em expansão.',
    };

    const setCfg = db.prepare(`
      INSERT INTO configuracoes (conta_id, chave, valor)
      VALUES (?, ?, ?)
      ON CONFLICT (conta_id, chave)
      DO UPDATE SET valor = EXCLUDED.valor
    `);

    for (const [k, v] of Object.entries(doutrina)) {
      await setCfg.run(
        contaId,
        `identidade.${k}`,
        v
      );
    }

    await setCfg.run(
      contaId,
      'onboarding',
      'pendente'
    );

    const agentes = [
      ['Comercial', 'Ofertas, vendas, follow-up, proposta, objeções, lead scoring e fechamento.', 'Qual movimento aumenta a chance de venda?'],
      ['Produto', 'Produtos, serviços, escada de valor, empacotamento e precificação.', 'Esse produto resolve dor clara e pode ser vendido com promessa forte?'],
      ['Copy e Oferta', 'Headlines, páginas, anúncios, CTAs, e-mails, WhatsApp e narrativa comercial.', 'Por que alguém compraria isso agora?'],
      ['Conteúdo', 'Calendário editorial, roteiros, posts, vídeos, blog, newsletter e adaptação por canal.', 'Esse conteúdo gera atenção, autoridade, relacionamento ou venda?'],
      ['Mercado', 'Concorrentes, tendências, nichos, consumidor, oportunidades, ameaças e benchmarks.', 'O mercado está indo para onde e como monetizar isso?'],
      ['Financeiro', 'Receita, custos, lucro, margem, fluxo de caixa, projeção, metas e ticket médio.', 'Isso dá dinheiro de verdade ou só parece bonito?'],
      ['Alta Performance', 'Rotina, foco, energia, corte de distração, disciplina e execução semanal.', 'Qual ação de hoje aproxima dinheiro, estrutura ou autoridade?'],
      ['Jurídico-Contratual', 'Minutas de contratos, termos, propostas, cláusulas, políticas e prestação de serviço. Não substitui advogado.', 'O acordo está claro, protegido e profissional?'],
      ['Atendimento', 'WhatsApp, direct, e-mail, triagem, dúvidas, qualificação e encaminhamento.', 'Essa pessoa é curiosa, lead frio, morno ou oportunidade comercial?'],
      ['Geopolítica e Macrotendências', 'Política, economia, comportamento social, consumo, risco e oportunidade.', 'Como o cenário externo afeta mercado, consumo, dinheiro e estratégia?'],
      ['Branding', 'Posicionamento, tom de voz, identidade, narrativa, arquitetura de marca e diferenciação.', 'Isso fortalece ou enfraquece a marca?'],
      ['Automação', 'Make, n8n, webhooks, planilhas, CRM, e-mail, WhatsApp, formulários e integrações.', 'Essa tarefa precisa de humano ou pode virar processo automático?'],
    ];

    for (const [nome, funcao, pergunta] of agentes) {
      await insert('agentes', {
        nome,
        funcao,
        pergunta,
        ativo: 'Sim',
      });
    }

    await setCfg.run(
      contaId,
      'seeded',
      '1'
    );
  });

  await tx();
}

async function fechar() {
  await pool.end();
}

module.exports = {
  db,
  insert,
  today,
  DATA_DIR: null,
  sistema,
  comConta,
  contaAtual,
  bancoDaConta,
  migrate,
  migrateTenant,
  prepararConta,
  seed,
  fechar,
  pool,
};