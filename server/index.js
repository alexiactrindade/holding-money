require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { sistema, comConta, db, migrate } = require('./db-pg');
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

let dbReady;
app.use('/api', async (req, res, next) => {
  try {
    dbReady ||= migrate();
    await dbReady;
    next();
  } catch (e) {
    next(e);
  }
});

// API pública
app.use('/api/auth', auth.router);
// Rotas públicas de uma conta (formulários e webhook): identificadas pelo código público da conta
async function contaPublica(req, res, next) {
  try {
    const c = await sistema.prepare('SELECT id FROM contas WHERE slug = ?').get(String(req.params.conta || ''));
    if (!c) return res.status(404).json({ erro: 'Formulário não encontrado.' });
    comConta(c.id, () => next());
  } catch (e) {
    next(e);
  }
}
app.use('/api/public/:conta', contaPublica, diagnostics.router);
app.use('/api/webhooks/:conta', contaPublica, diagnostics.webhookRouter);

// API protegida
app.use('/api', auth.requireAuth, auth.usarConta);
app.use('/api', crud.router);
app.use('/api', insights.router);
app.use('/api/core', core.router);
app.use('/api', ia.router);
app.get('/api/integracoes', auth.requireAuth, async (req, res, next) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const conta = await sistema.prepare('SELECT slug FROM contas WHERE id = ?').get(req.user.conta_id);
    const slugConta = conta ? conta.slug : '';
    const token = await diagnostics.webhookToken();
    const ativos = await diagnostics.ativos();
    const formularios = [];
    for (const slug of Object.keys(diagnostics.DIAGNOSTICOS)) {
      const n = await db.prepare('SELECT COUNT(*)::int n FROM diagnosticos WHERE tipo = ?').get(diagnostics.DIAGNOSTICOS[slug].tipo);
      formularios.push({
        slug,
        titulo: diagnostics.DIAGNOSTICOS[slug].titulo,
        marca: diagnostics.MARCA[slug],
        contexto: diagnostics.CONTEXTO_MARCA[slug],
        respostas: n ? n.n : 0,
        url: `${base}/d/${slugConta}/${slug}`,
        ativo: ativos.includes(slug),
      });
    }
    res.json({
      webhookUrl: `${base}/api/webhooks/${slugConta}/lead`,
      webhookToken: token,
      formularios,
    });
  } catch (e) {
    next(e);
  }
});
app.put('/api/integracoes/formularios/:slug', auth.requireAdmin, async (req, res, next) => {
  try {
    const slug = req.params.slug;
    if (!diagnostics.DIAGNOSTICOS[slug]) return res.status(404).json({ erro: 'Formulário não encontrado.' });
    const set = new Set(await diagnostics.ativos());
    if (req.body?.ativo) set.add(slug); else set.delete(slug);
    await diagnostics.setAtivos([...set]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.use('/api', (req, res) => res.status(404).json({ erro: 'Não encontramos o que você procurou.' }));

// Front-end
const pub = path.join(__dirname, '..', 'public');
const nm = path.join(__dirname, '..', 'node_modules');
const vendor = { maxAge: '7d' };
// Bibliotecas servidas localmente (sem depender de CDN)
app.use('/vendor/bootstrap', express.static(path.join(nm, 'bootstrap', 'dist'), vendor));
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


app.get('/api/teste-vercel', (req, res) => {
  res.json({
    ok: true,
    rota: req.originalUrl,
    caminho: req.path,
    metodo: req.method
  });
});

if (require.main === module) {

  const PORT = Number(process.env.PORT) || 3000;

  app.listen(PORT, () => {
    console.log(`Holding Money rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;