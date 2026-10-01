require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { sistema, comConta, db } = require('./db');
const auth = require('./auth');
const crud = require('./crud');
const insights = require('./insights');
const diagnostics = require('./diagnostics');
const core = require('./core');
const ia = require('./ia');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// API pública
app.use('/api/auth', auth.router);
// Rotas públicas de uma conta (formulários e webhook): identificadas pelo código público da conta
function contaPublica(req, res, next) {
  const c = sistema.prepare('SELECT id FROM contas WHERE slug = ?').get(String(req.params.conta || ''));
  if (!c) return res.status(404).json({ erro: 'Formulário não encontrado.' });
  comConta(c.id, () => next());
}
app.use('/api/public/:conta', contaPublica, diagnostics.router);
app.use('/api/webhooks/:conta', contaPublica, diagnostics.webhookRouter);

// API protegida
app.use('/api', auth.requireAuth, auth.usarConta);
app.use('/api', crud.router);
app.use('/api', insights.router);
app.use('/api/core', core.router);
app.use('/api', ia.router);
app.get('/api/integracoes', auth.requireAuth, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const slugConta = sistema.prepare('SELECT slug FROM contas WHERE id = ?').get(req.user.conta_id).slug;
  res.json({
    webhookUrl: `${base}/api/webhooks/${slugConta}/lead`,
    webhookToken: diagnostics.webhookToken(),
    formularios: Object.keys(diagnostics.DIAGNOSTICOS).map((slug) => ({ slug, titulo: diagnostics.DIAGNOSTICOS[slug].titulo, marca: diagnostics.MARCA[slug], contexto: diagnostics.CONTEXTO_MARCA[slug], respostas: db.prepare('SELECT COUNT(*) n FROM diagnosticos WHERE tipo = ?').get(diagnostics.DIAGNOSTICOS[slug].tipo).n, url: `${base}/d/${slugConta}/${slug}`, ativo: diagnostics.ativos().includes(slug) })),
  });
});
app.put('/api/integracoes/formularios/:slug', auth.requireAdmin, (req, res) => {
  const slug = req.params.slug;
  if (!diagnostics.DIAGNOSTICOS[slug]) return res.status(404).json({ erro: 'Formulário não encontrado.' });
  const set = new Set(diagnostics.ativos());
  if (req.body?.ativo) set.add(slug); else set.delete(slug);
  diagnostics.setAtivos([...set]);
  res.json({ ok: true });
});
app.use('/api', (req, res) => res.status(404).json({ erro: 'Não encontramos o que você procurou.' }));

// Front-end
const pub = path.join(__dirname, '..', 'public');
const nm = path.join(__dirname, '..', 'node_modules');
const vendor = { maxAge: '7d' };
// Bibliotecas servidas localmente (sem depender de CDN)
app.use('/vendor/bootstrap', express.static(path.join(nm, 'bootstrap', 'dist'), vendor));
app.use('/vendor/bootstrap-icons', express.static(path.join(nm, 'bootstrap-icons', 'font'), vendor));
app.use('/vendor/chart.js', express.static(path.join(nm, 'chart.js', 'dist'), vendor));
app.use('/vendor/fonts/montserrat', express.static(path.join(nm, '@fontsource', 'montserrat'), vendor));
app.use('/vendor/fonts/inter', express.static(path.join(nm, '@fontsource', 'inter'), vendor));
app.use(express.static(pub, { extensions: ['html'] }));
app.get('/d/:conta/:slug', (req, res) => res.sendFile(path.join(pub, 'diagnostico.html')));
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));

// Erros
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ erro: err.type === 'entity.parse.failed' ? 'Não foi possível ler as informações enviadas. Recarregue a página e tente de novo.' : 'Algo deu errado ao processar seu pedido. Tente de novo em instantes.' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Holding Money rodando em http://localhost:${PORT}`);
});
