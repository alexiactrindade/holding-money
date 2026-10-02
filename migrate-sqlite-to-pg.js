/*
 * Migração única: SQLite (data/) -> PostgreSQL (DATABASE_URL).
 *
 * Restaura as contas, usuários (login) e dados de cada empresa
 * que ficaram no banco SQLite antigo antes da troca para PostgreSQL.
 *
 * É seguro rodar mais de uma vez: o que já existir é ignorado.
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const pg = require('./server/db-pg');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SYS_DB = path.join(DATA_DIR, 'sistema.db');
const CONTAS_DIR = path.join(DATA_DIR, 'contas');

const PULAR = new Set(['agentes']); // já recriados pelo seed
const UPSERT = new Set(['configuracoes']); // chave única por conta

async function colunasPg(tabela) {
  const rows = await pg.db
    .prepare(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=?`)
    .all(tabela);
  return rows.map((r) => r.column_name);
}

async function copiarTabela(sqlite, tabela, contaId) {
  const linhas = sqlite.prepare(`SELECT * FROM "${tabela}"`).all();
  if (!linhas.length) return 0;
  if (PULAR.has(tabela)) return 0;

  const cols = await colunasPg(tabela);

  if (!UPSERT.has(tabela)) {
    // Se a tabela já tem dados desta conta, não duplica (ex.: seed).
    const atual = await pg.db.prepare(`SELECT COUNT(*)::int n FROM "${tabela}" WHERE conta_id=?`).get(contaId);
    if (atual.n > 0) return 0;
  }

  let inseridas = 0;
  for (const linha of linhas) {
    const dados = {};
    for (const [k, v] of Object.entries(linha)) {
      if (k === 'created_at' || k === 'updated_at') continue;
      if (cols.includes(k)) dados[k] = v;
    }
    if (cols.includes('conta_id')) dados.conta_id = contaId;

    const keys = Object.keys(dados);
    if (!keys.length) continue;

    const colunas = keys.map((k) => `"${k}"`).join(', ');
    const valores = keys.map((_, i) => `$${i + 1}`).join(', ');

    let sql = `INSERT INTO "${tabela}" (${colunas}) VALUES (${valores})`;
    if (UPSERT.has(tabela)) {
      sql += ` ON CONFLICT (conta_id, chave) DO UPDATE SET valor = EXCLUDED.valor`;
    }
    await pg.db.prepare(sql).run(...keys.map((k) => dados[k]));
    inseridas++;
  }

  // Reposiciona a sequência quando copiamos ids explícitos.
  if (cols.includes('id') && inseridas) {
    await pg.db.exec(`SELECT setval(pg_get_serial_sequence('${tabela}', 'id'), (SELECT MAX(id) FROM "${tabela}"))`);
  }
  return inseridas;
}

async function main() {
  if (!fs.existsSync(SYS_DB)) {
    console.log('Nada a migrar: data/sistema.db não encontrado.');
    return;
  }

  await pg.migrate();

  const sistema = new DatabaseSync(SYS_DB);
  const contas = sistema.prepare('SELECT id, nome, slug FROM contas').all();
  const usuarios = sistema.prepare('SELECT id, conta_id, nome, email, senha_hash, papel FROM usuarios').all();

  for (const c of contas) {
    const existe = await pg.sistema.prepare('SELECT id FROM contas WHERE id = ?').get(c.id);
    if (existe) {
      console.log(`- conta #${c.id} (${c.nome}) já existe no PostgreSQL.`);
      continue;
    }
    await pg.sistema.prepare('INSERT INTO contas (id, nome, slug) VALUES (?, ?, ?)').run(c.id, c.nome, c.slug);
    console.log(`+ conta #${c.id} (${c.nome}) importada.`);
  }

  for (const u of usuarios) {
    const existe = await pg.sistema.prepare('SELECT id FROM usuarios WHERE email = ?').get(u.email);
    if (existe) {
      console.log(`- usuário ${u.email} já existe no PostgreSQL.`);
      continue;
    }
    await pg.sistema.prepare(
      'INSERT INTO usuarios (id, conta_id, nome, email, senha_hash, papel) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(u.id, u.conta_id, u.nome, u.email, u.senha_hash, u.papel);
    console.log(`+ usuário ${u.email} importado.`);
  }

  // Ajusta as sequências depois de inserir ids explícitos.
  for (const tabela of ['contas', 'usuarios']) {
    await pg.sistema.exec(
      `SELECT setval(pg_get_serial_sequence('${tabela}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${tabela}), 0), 1))`
    );
  }

  for (const c of contas) {
    const arquivo = path.join(CONTAS_DIR, `${c.id}.db`);
    if (!fs.existsSync(arquivo)) {
      console.log(`- conta #${c.id}: sem banco de dados de empresa.`);
      continue;
    }

    await pg.prepararConta(c.id);

    const tdb = new DatabaseSync(arquivo);
    const tabelas = tdb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);

    await pg.comConta(c.id, async () => {
      for (const t of tabelas) {
        const n = await copiarTabela(tdb, t, c.id);
        if (n) console.log(`  conta #${c.id} -> ${t}: ${n} linha(s).`);
      }
    });
  }

  await pg.fechar();
  console.log('\nMIGRAÇÃO CONCLUÍDA.');
}

main().catch(async (e) => {
  console.error('ERRO NA MIGRAÇÃO:', e);
  try { await pg.fechar(); } catch {}
  process.exit(1);
});