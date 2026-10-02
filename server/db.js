const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { entities, systemTables } = require('./schema');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  // Ambiente somente leitura (ex.: Vercel). O app roda em PostgreSQL (db-pg.js);
  // este módulo SQLite é apenas legado e não deve derrubar o servidor.
  console.warn('SQLite (legado) indisponível:', e.message);
}

// SQLite embutido no Node (node:sqlite) — sem compilação nativa, funciona em Windows/Mac/Linux.
//
// Multiempresa: cada conta (empresa) tem o PRÓPRIO arquivo de banco em data/contas/<id>.db.
// O isolamento é físico: uma conta nunca enxerga dados de outra.
// O banco "sistema.db" guarda só contas e usuários (login).
// O módulo exporta `db`, que aponta automaticamente para o banco da conta da requisição atual.
const { AsyncLocalStorage } = require('node:async_hooks');

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const plain = (row) => (row ? { ...row } : row);

function abrir(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  let depth = 0;
  // Camada compatível com a API usada pelo app (prepare/run/get/all, exec, transaction)
  return {
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      const st = raw.prepare(sql);
      return {
        run: (...a) => {
          const r = st.run(...a.map(norm));
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
        },
        get: (...a) => plain(st.get(...a.map(norm))),
        all: (...a) => st.all(...a.map(norm)).map(plain),
      };
    },
    transaction(fn) {
      return (...args) => {
        if (depth > 0) return fn(...args);
        raw.exec('BEGIN');
        depth++;
        try {
          const out = fn(...args);
          raw.exec('COMMIT');
          return out;
        } catch (e) {
          try { raw.exec('ROLLBACK'); } catch {}
          throw e;
        } finally {
          depth--;
        }
      };
    },
  };
}

// ---------- Banco do sistema: contas e usuários ----------
const sistema = abrir(path.join(DATA_DIR, 'sistema.db'));
sistema.exec(`
CREATE TABLE IF NOT EXISTS contas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'operador',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);`);

// ---------- Banco de cada conta ----------
const CONTAS_DIR = path.join(DATA_DIR, 'contas');
fs.mkdirSync(CONTAS_DIR, { recursive: true });
const als = new AsyncLocalStorage();
const cache = new Map();

function bancoDaConta(contaId) {
  const id = Number(contaId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Conta inválida');
  if (!cache.has(id)) {
    const d = abrir(path.join(CONTAS_DIR, `${id}.db`));
    cache.set(id, d);
    als.run({ contaId: id, db: d }, () => { migrate(); seed(); });
  }
  return cache.get(id);
}

// Executa fn "dentro" da conta: todo acesso a `db` vai para o banco dela
function comConta(contaId, fn) {
  return als.run({ contaId: Number(contaId), db: bancoDaConta(contaId) }, fn);
}
const contaAtual = () => als.getStore()?.contaId || null;

function atual() {
  const st = als.getStore();
  if (!st) throw new Error('Acesso ao banco fora do contexto de uma conta.');
  return st.db;
}
const db = {
  exec: (sql) => atual().exec(sql),
  prepare: (sql) => atual().prepare(sql),
  transaction: (fn) => (...args) => atual().transaction(fn)(...args),
};

function sqlType(f) {
  if (['number', 'money', 'percent', 'ref'].includes(f.type)) return f.type === 'ref' ? 'INTEGER' : 'REAL';
  return 'TEXT';
}

function migrate() {
  db.exec(systemTables);
  for (const [table, def] of Object.entries(entities)) {
    const cols = def.fields.map((f) => `${f.name} ${sqlType(f)}`).join(',\n  ');
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ${cols},
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
    // Adiciona colunas novas se o schema evoluir
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    for (const f of def.fields) {
      if (!existing.includes(f.name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${f.name} ${sqlType(f)}`);
    }
  }
}

function insert(table, obj) {
  const keys = Object.keys(obj);
  const stmt = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`);
  return stmt.run(...keys.map((k) => obj[k])).lastInsertRowid;
}

const { isoDate } = require('./util');
function today(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return isoDate(d);
}

// Dados iniciais: só a doutrina do sistema e os 12 agentes (papéis, não dados de empresa).
// Negócios, produtos, ofertas, scripts, tarefas etc. nascem vazios e são criados pelo dono
// a partir do contexto da empresa, com auxílio da IA (ver server/ia.js).
function seed() {
  const already = db.prepare("SELECT valor FROM configuracoes WHERE chave='seeded'").get();
  if (already) return;

  const tx = db.transaction(() => {
    const doutrina = {
      nome: 'Holding Money',
      subtitulo: 'Sistema Central de Inteligência Comercial, Monetização e Alta Performance',
      missao: 'Organizar negócios, produtos, dados, estratégias e execução para gerar receita real.',
      funcao: 'Detectar oportunidades de dinheiro, estruturar ativos comerciais e orientar execução diária.',
      principios: 'Não automatize antes de entender. Não escale antes de vender. Não crie tecnologia própria antes de validar caixa.',
      frase: 'Transformar visão em estrutura, estrutura em produto, produto em oferta, oferta em venda, venda em caixa e caixa em expansão.',
    };
    const setCfg = db.prepare('INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)');
    for (const [k, v] of Object.entries(doutrina)) setCfg.run(`identidade.${k}`, v);
    setCfg.run('onboarding', 'pendente');

    // Agentes especialistas (Parte 7 do blueprint): papéis genéricos usados pelo Core
    [
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
    ].forEach(([nome, funcao, pergunta]) => insert('agentes', { nome, funcao, pergunta, ativo: 'Sim' }));

    setCfg.run('seeded', '1');
  });
  tx();
}

module.exports = { db, insert, today, DATA_DIR, sistema, comConta, contaAtual, bancoDaConta };
