/* Holding Money — inicialização, autenticação, navegação e rotas */
const NAV = [
  { title: 'Comando', items: [
    ['#/', 'speedometer2', 'Painel'],
    ['#/agentes', 'cpu', 'Agentes'],
  ] },
  { title: 'Comercial', items: [
    ['#/leads', 'people', 'Leads', 'follow'],
    ['#/e/propostas', 'file-earmark-text', 'Propostas'],
    ['#/e/ofertas', 'megaphone', 'Ofertas'],
    ['#/e/produtos', 'box-seam', 'Produtos'],
    ['#/e/negocios', 'briefcase', 'Negócios'],
  ] },
  { title: 'Marketing', items: [
    ['#/e/conteudos', 'camera-reels', 'Conteúdos'],
    ['#/e/campanhas', 'bullseye', 'Campanhas'],
    ['#/e/scripts', 'chat-left-quote', 'Scripts comerciais'],
  ] },
  { title: 'Financeiro', items: [
    ['#/e/financeiro', 'cash-coin', 'Lançamentos'],
  ] },
  { title: 'Execução', items: [
    ['#/e/tarefas', 'check2-square', 'Tarefas'],
    ['#/checklist', 'list-check', 'Checklist diário'],
    ['#/relatorios', 'journal-text', 'Relatório semanal'],
    ['#/aprovacoes', 'shield-check', 'Aprovações', 'aprovacoes'],
  ] },
  { title: 'Sistema', items: [
    ['#/e/riscos', 'cone-striped', 'Riscos'],
    ['#/onboarding', 'building', 'Contexto da empresa'],
    ['#/identidade', 'fingerprint', 'Identidade e doutrina'],
    ['#/ia', 'stars', 'Inteligência artificial'],
  ] },
];

// Configurações ficam fora do menu principal (botão no rodapé da barra lateral)
const AJUSTES = [
  ['formularios', 'plug', 'Formulários e conexões', 'admin'],
  ['usuarios', 'person-lock', 'Usuários e conta', ''],
];

const App = {
  user: null,
  meta: null,
  config: {},

  async start() {
    // Botão "Ativar IA" dos avisos: liga e recarrega a tela atual
    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ligar-ia]'); if (!b) return;
      b.disabled = true;
      try { if (await IA.ligar()) App.route(); } catch (err) { H.toast(err.message, 'error'); b.disabled = false; }
    });
    window.addEventListener('hm:logout', () => { App.user = null; App.renderAuth('entrar'); });
    try {
      const { usuario } = await API.get('/auth/me');
      App.user = usuario;
      await App.boot();
    } catch {
      App.renderAuth('entrar');
    }
  },

  async boot() {
    App.meta = await API.get('/meta');
    await App.loadConfig();
    const [onb, ia] = await Promise.all([API.get('/onboarding'), API.get('/core/status')]);
    App.onboarding = onb.status;
    App.ia = ia.ativa;
    App.iaDisp = ia.disponivel;
    // Primeiro acesso do fundador: começa pelo contexto da empresa (o sistema nasce vazio)
    if (App.user.papel === 'admin' && App.onboarding !== 'feito' && !location.hash.startsWith('#/onboarding')) {
      location.hash = App.onboarding === 'contexto' ? '#/onboarding?passo=estrutura' : '#/onboarding';
    }
    App.renderShell();
    window.addEventListener('hashchange', App.route);
    App.route();
    App.refreshBadges();
  },

  async reloadMeta() {
    App.meta = await API.get('/meta');
  },

  async loadConfig() {
    App.config = await API.get('/config');
    const el = document.querySelector('.brand-name');
    if (el) el.innerHTML = `${H.esc(App.config.nome || 'Holding Money')}<small>${H.esc(App.config.subtitulo || '')}</small>`;
  },

  // Tela de acesso: "entrar" ou "cadastro" (cada cadastro cria uma nova conta/empresa)
 renderAuth(modo = 'entrar') {
  const cad = modo === 'cadastro';

  document.getElementById('root').innerHTML = `
    <div class="auth">
      <div class="auth-form">
        <form id="fa" novalidate>
          <h1 class="auth-title">${cad ? 'Crie sua conta' : 'Entre no sistema'}</h1>

          ${cad ? `
            <label class="form-label" for="ae_empresa">Empresa</label>
            <input
              class="form-control mb-3"
              id="ae_empresa"
              name="empresa"
              autocomplete="organization"
              required
            >

            <label class="form-label" for="an">Seu nome</label>
            <input
              class="form-control mb-3"
              id="an"
              name="nome"
              autocomplete="name"
              required
            >
          ` : ''}

          <label class="form-label" for="ae">E-mail</label>
          <input
            class="form-control mb-3"
            id="ae"
            name="email"
            type="email"
            autocomplete="email"
            required
          >

          <label class="form-label" for="as">Senha</label>
          <input
            class="form-control"
            id="as"
            name="senha"
            type="password"
            autocomplete="${cad ? 'new-password' : 'current-password'}"
            ${cad ? 'minlength="8" aria-describedby="sh"' : ''}
            required
          >

          ${cad ? '<div class="form-text" id="sh">Mínimo de 8 caracteres.</div>' : ''}

          <button
            class="btn btn-primary w-100 py-2 mt-4"
            type="submit"
          >
            ${cad ? 'Criar conta' : 'Entrar'}
          </button>

          <p class="text-danger small mt-3 mb-0" id="err" role="alert"></p>

          ${
            cad
              ? '<p class="text-center mt-3 mb-0">Já tem uma conta? <a href="#" id="troca">Entrar</a></p>'
              : '<div class="auth-ou"><span>ou</span></div><button class="btn btn-outline-dark w-100 py-2" type="button" id="troca">Criar conta</button>'
          }
        </form>
      </div>

      <div class="auth-art" aria-hidden="true">
        <div class="art-top">
          <div class="art-copy">
            <h2>Holding App</h2>
            <p>
              Estruture, opere, venda, monetize e escale múltiplas linhas
              de negócio com um único sistema.
            </p>
          </div>
        </div>
        ${H.stripes({ width: 600, height: 240, className: '' })}
      </div>
    </div>
  `;

  document.getElementById('troca').addEventListener('click', (e) => {
    e.preventDefault();
    App.renderAuth(cad ? 'entrar' : 'cadastro');
  });

  document.getElementById(cad ? 'ae_empresa' : 'ae').focus();

  document.getElementById('fa').addEventListener('submit', async (e) => {
    e.preventDefault();

    const body = Object.fromEntries(new FormData(e.target));
    const err = document.getElementById('err');

    if (cad && !String(body.empresa || '').trim()) {
      err.textContent = 'Digite o nome da empresa.';
      return;
    }

    if (cad && !String(body.nome || '').trim()) {
      err.textContent = 'Digite seu nome.';
      return;
    }

    if (!body.email || !body.senha) {
      err.textContent = 'Preencha e-mail e senha.';
      return;
    }

    if (cad && body.senha.length < 8) {
      err.textContent = 'A senha precisa ter pelo menos 8 caracteres.';
      return;
    }

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;

    try {
      const { usuario } = await API.post(
        cad ? '/auth/cadastro' : '/auth/login',
        body
      );

      App.user = usuario;
      location.hash = '#/';
      await App.boot();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
},

  renderShell() {
    document.getElementById('root').innerHTML = `
      <div class="app">
        <aside class="sidebar" id="sb" aria-label="Navegação">
          <div class="brand"><a href="#/" class="brand-name">Holding Money</a></div>
          ${H.stripes({ width: 256, height: 40 })}
          <nav>${NAV.map((g) => `<div class="nav-group"><div class="nav-group-title">${H.esc(g.title)}</div>
            ${g.items.filter((i) => i[0] !== '#/ia' || App.iaDisp).map(([href, icon, label, badge]) => `<a class="side-link" href="${href}"><i class="bi bi-${icon}"></i><span>${H.esc(label)}</span>${badge ? `<span class="badge rounded-pill d-none" data-badge="${badge}"></span>` : ''}</a>`).join('')}
          </div>`).join('')}</nav>
          <div class="side-footer d-flex justify-content-between align-items-center">
            <div><strong>${H.esc(App.user.nome)}</strong><div class="text-muted" style="font-size:.75rem">${App.user.papel === 'admin' ? 'Fundador' : 'Operador'}</div></div>
            <div class="d-flex gap-1"><a class="btn btn-sm btn-light side-cfg" href="#/ajustes" title="Configurações" aria-label="Configurações"><i class="bi bi-gear"></i></a><button class="btn btn-sm btn-light" id="logout">Sair</button></div>
          </div>
        </aside>
        <div class="main">
          <div class="topbar"><button class="btn btn-light" id="menu" aria-label="Abrir menu"><i class="bi bi-list"></i></button><span class="brand-name">Holding Money</span><span style="width:40px"></span></div>
          <main class="content" id="content"></main>
        </div>
      </div>`;
    document.getElementById('logout').addEventListener('click', async () => { await API.post('/auth/logout'); location.hash = ''; location.reload(); });
    document.getElementById('menu').addEventListener('click', () => document.getElementById('sb').classList.toggle('open'));
    document.getElementById('sb').addEventListener('click', (e) => { if (e.target.closest('.side-link')) document.getElementById('sb').classList.remove('open'); });
    App.loadConfig();
  },

  async refreshBadges() {
    try {
      const [aprov, leads] = await Promise.all([
        API.get('/e/aprovacoes?status=Pendente'),
        API.get('/e/leads'),
      ]);
      const hoje = H.today();
      const follow = leads.filter((l) => !['Cliente', 'Perdido'].includes(l.estagio) && l.proximo_contato && l.proximo_contato <= hoje).length;
      const set = (k, n) => { const b = document.querySelector(`[data-badge="${k}"]`); if (b) { b.textContent = n; b.classList.toggle('d-none', !n); } };
      set('aprovacoes', aprov.length);
      set('follow', follow);
    } catch { /* silencioso */ }
  },

  async route() {
    const hash = location.hash || '#/';
    const [pathPart, qs] = hash.slice(1).split('?');
    const parts = pathPart.split('/').filter(Boolean);
    const content = document.getElementById('content');
    if (!content) return;
    const view = document.createElement('div');
    content.replaceChildren(view);
    document.querySelectorAll('.side-link').forEach((a) => {
      const href = a.getAttribute('href');
      const active = href === '#/' ? parts.length === 0 : hash.startsWith(href) && (hash.length === href.length || '/?'.includes(hash[href.length]));
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    try {
      const [p, a, b] = parts;
      if (!p) await Views.painel(view);
      else if (p === 'diagnosticos') { location.hash = '#/'; return; }
      else if (p === 'e' && a) {
        if (a === 'diagnosticos') { location.hash = '#/'; return; }
        const defaults = Object.fromEntries(new URLSearchParams(qs || ''));
        await UI.renderEntity(view, a, b === 'novo' ? { defaults } : { openId: b });
      } else if (p === 'leads') await Views.leads(view);
      else if (p === 'agentes' || p === 'core') await Views.core(view);
      else if (p === 'aprovacoes') await Views.aprovacoes(view);
      else if (p === 'ajustes') await Views.ajustes(view, a);
      else if (p === 'alertas') { location.hash = '#/'; return; }
      else if (p === 'checklist') await Views.checklist(view, a);
      else if (p === 'relatorios') await Views.relatorios(view, a);
      else if (p === 'identidade') await Views.identidade(view);
      else if (p === 'onboarding') await IA.onboarding(view);
      else if (p === 'ia') await Views.ia(view);
      else if (p === 'integracoes') { location.hash = '#/ajustes/formularios'; return; }
      else if (p === 'usuarios') { location.hash = '#/ajustes/usuarios'; return; }
      else view.innerHTML = '<h1>Página não encontrada</h1><p><a href="#/">Voltar ao painel</a></p>';
      document.title = `${view.querySelector('h1')?.textContent || 'Painel'} · Holding Money`;
    } catch (err) {
      view.innerHTML = `<div class="panel"><h1 class="h2">Não foi possível carregar</h1><p>${H.esc(err.message)}</p><button class="btn btn-primary" id="retry">Tentar de novo</button></div>`;
      view.querySelector('#retry').addEventListener('click', App.route);
    }
  },
};

App.start();
