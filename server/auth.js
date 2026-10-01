const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sistema, DATA_DIR, comConta } = require('./db');
const { rateLimit } = require('./util');

// Segredo do JWT: usa .env ou gera um e guarda em data/
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();
const COOKIE = 'hm_session';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 1000 * 60 * 60 * 24 * 7,
};

function sign(user) {
  return jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ erro: 'Faça login para continuar.' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = sistema.prepare('SELECT id, conta_id, nome, email, papel FROM usuarios WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ erro: 'Usuário não encontrado. Faça login novamente.' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.papel !== 'admin') return res.status(403).json({ erro: 'Apenas o fundador pode fazer isso.' });
  next();
}

// Liga a requisição ao banco da conta do usuário logado
function usarConta(req, res, next) {
  comConta(req.user.conta_id, () => next());
}

const router = express.Router();
const semHash = (u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel });
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Criar conta: cada cadastro é uma nova empresa, com banco próprio. Quem cria é o fundador.
router.post('/cadastro', rateLimit(5, 60_000), (req, res) => {
  const nome = String(req.body?.nome || '').trim().slice(0, 120);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  const senha = String(req.body?.senha || '');
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Preencha nome, e-mail e senha.' });
  if (!emailValido(email)) return res.status(400).json({ erro: 'Digite um e-mail válido.' });
  if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (sistema.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) return res.status(400).json({ erro: 'Já existe uma conta com esse e-mail. Tente entrar.' });
  let user;
  sistema.transaction(() => {
    const contaId = sistema.prepare('INSERT INTO contas (nome, slug) VALUES (?, ?)').run(nome, crypto.randomBytes(5).toString('hex')).lastInsertRowid;
    const id = sistema.prepare('INSERT INTO usuarios (conta_id, nome, email, senha_hash, papel) VALUES (?, ?, ?, ?, ?)').run(contaId, nome, email, bcrypt.hashSync(senha, 10), 'admin').lastInsertRowid;
    user = { id, conta_id: contaId, nome, email, papel: 'admin' };
  })();
  comConta(user.conta_id, () => {}); // cria o banco da nova conta
  res.cookie(COOKIE, sign(user), cookieOpts).json({ usuario: semHash(user) });
});

router.post('/login', rateLimit(10, 60_000), (req, res) => {
  const { email, senha } = req.body || {};
  const row = sistema.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!row || !bcrypt.compareSync(String(senha || ''), row.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }
  res.cookie(COOKIE, sign(row), cookieOpts).json({ usuario: semHash(row) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE).json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ usuario: semHash(req.user) }));

router.post('/senha', requireAuth, (req, res) => {
  const { atual, nova } = req.body || {};
  const row = sistema.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(atual || ''), row.senha_hash)) return res.status(400).json({ erro: 'A senha atual não confere.' });
  if (String(nova || '').length < 8) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  sistema.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(bcrypt.hashSync(nova, 10), req.user.id);
  res.json({ ok: true });
});

// Equipe da conta (somente o fundador)
router.get('/usuarios', requireAuth, requireAdmin, (req, res) => {
  res.json(sistema.prepare('SELECT id, nome, email, papel, created_at FROM usuarios WHERE conta_id = ? ORDER BY id').all(req.user.conta_id));
});

router.post('/usuarios', requireAuth, requireAdmin, (req, res) => {
  const { nome, email, senha, papel } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Preencha nome, e-mail e senha.' });
  if (!emailValido(String(email).trim())) return res.status(400).json({ erro: 'Digite um e-mail válido.' });
  if (String(senha).length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
  try {
    const id = sistema.prepare('INSERT INTO usuarios (conta_id, nome, email, senha_hash, papel) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.conta_id, String(nome).trim(), String(email).trim().toLowerCase(), bcrypt.hashSync(senha, 10), papel === 'admin' ? 'admin' : 'operador').lastInsertRowid;
    res.json({ id });
  } catch {
    res.status(400).json({ erro: 'Já existe um usuário com esse e-mail.' });
  }
});

router.delete('/usuarios/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ erro: 'Você não pode excluir o próprio usuário.' });
  sistema.prepare('DELETE FROM usuarios WHERE id = ? AND conta_id = ?').run(req.params.id, req.user.conta_id);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireAdmin, usarConta };
