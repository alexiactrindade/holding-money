const express = require('express');
const { db, insert } = require('./db');
const { entities } = require('./schema');
const { isoDate, brl, logAction } = require('./util');

const router = express.Router();

// Campos calculados exibidos junto com a listagem
const computed = {
  campanhas: {
    fields: [
      { name: 'cpl', label: 'CPL', type: 'money' },
      { name: 'cac', label: 'CAC', type: 'money' },
      { name: 'roi', label: 'ROI', type: 'ratio' },
    ],
    fn: (r) => ({
      cpl: r.leads > 0 ? r.investimento / r.leads : null,
      cac: r.vendas > 0 ? r.investimento / r.vendas : null,
      roi: r.investimento > 0 ? (r.faturamento - r.investimento) / r.investimento : null,
    }),
  },
};

function getDef(req, res) {
  const def = entities[req.params.entity];
  if (!def) {
    res.status(404).json({ erro: 'Área não encontrada.' });
    return null;
  }
  return def;
}

// Limpa e converte os dados recebidos segundo o schema
function sanitize(def, body, { partial }) {
  const out = {};
  const errors = [];
  for (const f of def.fields) {
    if (!(f.name in body)) {
      if (!partial && f.required) errors.push(`${f.label} é obrigatório.`);
      continue;
    }
    let v = body[f.name];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (['number', 'money', 'percent', 'ref'].includes(f.type)) {
        v = Number(String(v).replace(',', '.'));
        if (Number.isNaN(v)) { errors.push(`${f.label} precisa ser um número.`); continue; }
      } else if (f.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) { errors.push(`${f.label} precisa ser uma data válida.`); continue; }
      } else if (f.type === 'select' && !f.dynamic && f.options && !f.options.includes(String(v))) {
        errors.push(`${f.label}: escolha uma das opções da lista.`); continue;
      } else {
        v = String(v).slice(0, 20000);
      }
    }
    if (f.required && v === null) { errors.push(`${f.label} é obrigatório.`); continue; }
    out[f.name] = v;
  }
  return { data: out, errors };
}

function withRefs(def, rows) {
  const refFields = def.fields.filter((f) => f.type === 'ref');
  if (!refFields.length) return rows;
  const caches = {};
  for (const f of refFields) {
    const target = entities[f.ref];
    const map = {};
    for (const r of db.prepare(`SELECT id, ${target.display} AS label FROM ${f.ref}`).all()) map[r.id] = r.label;
    caches[f.name] = map;
  }
  return rows.map((r) => {
    const o = { ...r };
    for (const f of refFields) o[`${f.name}__label`] = r[f.name] != null ? caches[f.name][r[f.name]] || null : null;
    return o;
  });
}

function decorate(entity, def, rows) {
  let out = withRefs(def, rows);
  if (computed[entity]) out = out.map((r) => ({ ...r, ...computed[entity].fn(r) }));
  return out;
}

// Opções que dependem dos dados do dono (marcas: contexto da empresa + negócios cadastrados)
function dynamicOptions() {
  const cfg = {};
  for (const r of db.prepare("SELECT chave, valor FROM configuracoes WHERE chave IN ('identidade.empresa','identidade.marcas')").all()) cfg[r.chave] = r.valor || '';
  const set = new Set();
  if (cfg['identidade.empresa']) set.add(cfg['identidade.empresa'].trim());
  require('./contexto').lista(cfg['identidade.marcas']).map((x) => String(x).trim()).filter(Boolean).forEach((x) => set.add(x));
  for (const r of db.prepare('SELECT DISTINCT marca FROM negocios WHERE marca IS NOT NULL').all()) set.add(r.marca);
  for (const r of db.prepare('SELECT nome FROM negocios').all()) set.add(r.nome);
  set.add('Outra');
  return { marcas: [...set].filter(Boolean) };
}

function metaCompleta() {
  const dyn = dynamicOptions();
  const meta = {};
  for (const [k, def] of Object.entries(entities)) {
    meta[k] = { ...def, fields: def.fields.map((f) => (f.dynamic ? { ...f, options: dyn[f.dynamic] || [] } : f)), computed: computed[k]?.fields || [] };
  }
  return meta;
}

// Metadados para o front montar tabelas e formulários
router.get('/meta', (req, res) => res.json(metaCompleta()));

router.get('/e/:entity', (req, res) => {
  const def = getDef(req, res); if (!def) return;
  const entity = req.params.entity;
  let sql = `SELECT * FROM ${entity}`;
  const where = []; const params = [];
  for (const f of def.fields) {
    if (req.query[f.name] !== undefined && req.query[f.name] !== '') {
      where.push(`${f.name} = ?`); params.push(req.query[f.name]);
    }
  }
  if (req.query.q) {
    const textFields = def.fields.filter((f) => ['text', 'textarea', 'select'].includes(f.type));
    if (textFields.length) {
      where.push('(' + textFields.map((f) => `${f.name} LIKE ?`).join(' OR ') + ')');
      textFields.forEach(() => params.push(`%${req.query.q}%`));
    }
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 2000';
  res.json(decorate(entity, def, db.prepare(sql).all(...params)));
});

router.get('/e/:entity/:id', (req, res) => {
  const def = getDef(req, res); if (!def) return;
  const row = db.prepare(`SELECT * FROM ${req.params.entity} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ erro: 'Registro não encontrado.' });
  res.json(decorate(req.params.entity, def, [row])[0]);
});

function createApproval({ titulo, tipo, detalhes, solicitante, ref_entidade, ref_id, payload }) {
  return insert('aprovacoes', {
    titulo, tipo, detalhes, solicitante, ref_entidade, ref_id,
    payload: payload ? JSON.stringify(payload) : null, status: 'Pendente',
  });
}

router.post('/e/:entity', (req, res) => {
  const def = getDef(req, res); if (!def) return;
  const entity = req.params.entity;
  if (def.readonly) return res.status(400).json({ erro: 'Esses registros são criados automaticamente pelos formulários públicos.' });
  const { data, errors } = sanitize(def, req.body || {}, { partial: false });
  if (errors.length) return res.status(400).json({ erro: errors.join(' ') });

  // Governança
  if (entity === 'aprovacoes') { data.status = 'Pendente'; data.solicitante = data.solicitante || req.user.nome; }
  if (entity === 'propostas' && ['Aprovada', 'Enviada', 'Aceita'].includes(data.status)) data.status = 'Rascunho';
  if (entity === 'tarefas' && data.status === 'Concluída') data.concluida_em = isoDate();

  const id = insert(entity, data);
  logAction(db, req.user.nome, 'criou', entity, id, data[def.display]);

  if (entity === 'propostas' && data.status === 'Aguardando aprovação') {
    createApproval({ titulo: `Proposta: ${data.titulo}`, tipo: 'Proposta final', detalhes: `Valor ${brl(data.valor)}. ${data.escopo || ''}`, solicitante: req.user.nome, ref_entidade: 'propostas', ref_id: id });
  }
  res.json({ id });
});

router.put('/e/:entity/:id', (req, res) => {
  const def = getDef(req, res); if (!def) return;
  const entity = req.params.entity;
  const id = Number(req.params.id);
  if (def.readonly) return res.status(400).json({ erro: 'Esses registros não podem ser editados.' });
  const current = db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(id);
  if (!current) return res.status(404).json({ erro: 'Registro não encontrado.' });

  const { data, errors } = sanitize(def, req.body || {}, { partial: true });
  if (errors.length) return res.status(400).json({ erro: errors.join(' ') });
  const avisos = [];
  const isAdmin = req.user.papel === 'admin';

  // Aprovações só mudam de status pelo endpoint de decisão
  if (entity === 'aprovacoes') { delete data.status; delete data.decidido_por; delete data.decidido_em; }

  // Campos sensíveis (preço, investimento): operador gera pedido de aprovação; admin aplica e registra decisão
  for (const f of def.fields.filter((x) => x.sensitive)) {
    if (!(f.name in data) || data[f.name] === current[f.name]) continue;
    if (!isAdmin) {
      createApproval({
        titulo: `Alterar ${f.label.toLowerCase()} de "${current[def.display]}"`,
        tipo: f.name === 'preco' ? 'Preço' : 'Decisão financeira',
        detalhes: `De ${brl(current[f.name])} para ${brl(data[f.name])}.`,
        solicitante: req.user.nome, ref_entidade: entity, ref_id: id, payload: { [f.name]: data[f.name] },
      });
      avisos.push(`A alteração de ${f.label.toLowerCase()} foi enviada para aprovação do fundador.`);
      delete data[f.name];
    }
  }

  // Propostas: fluxo de aprovação obrigatório
  if (entity === 'propostas' && 'status' in data && data.status !== current.status) {
    const s = data.status;
    if (s === 'Aprovada') {
      if (!isAdmin) { delete data.status; avisos.push('Somente o fundador aprova propostas. Use "Aguardando aprovação".'); }
    } else if (s === 'Enviada' && current.status !== 'Aprovada') {
      delete data.status;
      avisos.push('A proposta precisa ser aprovada antes do envio. Status mudou para "Aguardando aprovação".');
      data.status = 'Aguardando aprovação';
    }
    if (data.status === 'Aguardando aprovação' && current.status !== 'Aguardando aprovação') {
      const merged = { ...current, ...data };
      createApproval({ titulo: `Proposta: ${merged.titulo}`, tipo: 'Proposta final', detalhes: `Valor ${brl(merged.valor)}. ${merged.escopo || ''}`, solicitante: req.user.nome, ref_entidade: 'propostas', ref_id: id });
    }
    if (data.status === 'Enviada' && !data.data_envio && !current.data_envio) data.data_envio = isoDate();
    if (data.status === 'Enviada' && current.lead_id) {
      db.prepare("UPDATE leads SET estagio='Proposta enviada', ultimo_contato=?, updated_at=datetime('now','localtime') WHERE id=?").run(isoDate(), current.lead_id);
    }
    if (data.status === 'Aceita' && current.lead_id) {
      db.prepare("UPDATE leads SET estagio='Cliente', updated_at=datetime('now','localtime') WHERE id=?").run(current.lead_id);
      avisos.push('Lead marcado como Cliente. Lance o recebimento em Financeiro quando o pagamento entrar.');
    }
  }

  if (entity === 'tarefas' && 'status' in data && data.status !== current.status) {
    data.concluida_em = data.status === 'Concluída' ? isoDate() : null;
  }
  if (entity === 'leads' && 'estagio' in data && data.estagio !== current.estagio && !('ultimo_contato' in req.body)) {
    data.ultimo_contato = isoDate();
  }

  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE ${entity} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(...keys.map((k) => data[k]), id);
    logAction(db, req.user.nome, 'editou', entity, id, keys.join(', '));
  }
  res.json({ ok: true, avisos });
});

router.delete('/e/:entity/:id', (req, res) => {
  const def = getDef(req, res); if (!def) return;
  const entity = req.params.entity;
  const row = db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ erro: 'Registro não encontrado.' });
  // Remove referências para não quebrar integridade
  for (const [other, odef] of Object.entries(entities)) {
    for (const f of odef.fields.filter((x) => x.type === 'ref' && x.ref === entity)) {
      db.prepare(`UPDATE ${other} SET ${f.name} = NULL WHERE ${f.name} = ?`).run(row.id);
    }
  }
  db.prepare(`DELETE FROM ${entity} WHERE id = ?`).run(row.id);
  logAction(db, req.user.nome, 'excluiu', entity, row.id, row[def.display]);
  res.json({ ok: true });
});

// Decisão sobre aprovação (somente admin)
router.post('/aprovacoes/:id/decidir', (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ erro: 'Somente o fundador decide aprovações.' });
  const { decisao, comentario } = req.body || {};
  if (!['Aprovada', 'Recusada'].includes(decisao)) return res.status(400).json({ erro: 'Escolha Aprovada ou Recusada.' });
  const ap = db.prepare('SELECT * FROM aprovacoes WHERE id = ?').get(req.params.id);
  if (!ap) return res.status(404).json({ erro: 'Aprovação não encontrada.' });
  if (ap.status !== 'Pendente') return res.status(400).json({ erro: 'Essa aprovação já foi decidida.' });

  const tx = db.transaction(() => {
    db.prepare("UPDATE aprovacoes SET status=?, decidido_por=?, decidido_em=?, comentario=?, updated_at=datetime('now','localtime') WHERE id=?")
      .run(decisao, req.user.nome, isoDate(), String(comentario || '').slice(0, 2000) || null, ap.id);
    const def = entities[ap.ref_entidade];
    if (def && ap.ref_id) {
      if (ap.ref_entidade === 'propostas') {
        db.prepare("UPDATE propostas SET status=?, updated_at=datetime('now','localtime') WHERE id=?")
          .run(decisao === 'Aprovada' ? 'Aprovada' : 'Rascunho', ap.ref_id);
      } else if (decisao === 'Aprovada' && ap.payload) {
        const payload = JSON.parse(ap.payload);
        const allowed = Object.keys(payload).filter((k) => def.fields.some((f) => f.name === k));
        if (allowed.length) {
          db.prepare(`UPDATE ${ap.ref_entidade} SET ${allowed.map((k) => `${k}=?`).join(', ')}, updated_at=datetime('now','localtime') WHERE id=?`)
            .run(...allowed.map((k) => payload[k]), ap.ref_id);
        }
      }
    }
    logAction(db, req.user.nome, decisao === 'Aprovada' ? 'aprovou' : 'recusou', 'aprovacoes', ap.id, ap.titulo);
  });
  tx();
  res.json({ ok: true });
});

router.get('/historico', (req, res) => {
  res.json(db.prepare('SELECT * FROM historico ORDER BY id DESC LIMIT 200').all());
});

module.exports = { router, createApproval, sanitize, dynamicOptions, metaCompleta };
