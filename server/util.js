// Utilitários compartilhados

// Limitador simples em memória (por IP + rota)
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

function isoDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}

function brl(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function logAction(db, usuario, acao, entidade, id, detalhes) {
  const { contaAtual } = require('./db-pg');

  await db
    .prepare(`
      INSERT INTO historico
        (conta_id, usuario, acao, entidade, registro_id, detalhes)
      VALUES
        (?, ?, ?, ?, ?, ?)
    `)
    .run(
      contaAtual(),
      usuario,
      acao,
      entidade,
      id,
      detalhes
        ? String(detalhes).slice(0, 2000)
        : null
    );
}

module.exports = { rateLimit, isoDate, addDays, daysBetween, brl, logAction };
