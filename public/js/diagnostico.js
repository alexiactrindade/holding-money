/* Formulário público de diagnóstico: /d/acc, /d/vpa, /d/codigo-interno */
(async function () {
  const root = document.getElementById('root');
  const [, conta, slug] = location.pathname.split('/').filter(Boolean);
  const canal = new URLSearchParams(location.search).get('canal') || '';
  let def;
  try {
    const r = await fetch(`/api/public/${encodeURIComponent(conta)}/diagnosticos/${encodeURIComponent(slug)}`);
    if (!r.ok) throw new Error();
    def = await r.json();
  } catch {
    root.innerHTML = '<div class="diag-wrap py-5"><h1>Formulário indisponível</h1><p>Este formulário não está aberto no momento. Se alguém te enviou este link, fale com essa pessoa.</p></div>';
    return;
  }
  document.title = `${def.titulo} · ${def.marca}`;

  const head = `<header class="diag-head"><div class="inner">
      <div class="brand-mini">${H.esc(def.marca)}</div>
      <h1>${H.esc(def.headline)}</h1><p>${H.esc(def.subtitulo)}</p></div>
      ${H.stripes({ width: 1200, height: 42, className: 'diag-stripes' })}</header>`;

  const scale = (name) => `<div class="scale" role="radiogroup">${def.escala.map((lbl, i) => `
      <input type="radio" id="${name}_${i + 1}" name="${name}" value="${i + 1}" required>
      <label for="${name}_${i + 1}"><b>${i + 1}</b><span>${H.esc(lbl)}</span></label>`).join('')}</div>`;

  root.innerHTML = `${head}
    <div class="diag-wrap">
      <form id="f" novalidate>
        <div class="q-block"><h2>Seus dados</h2>
          <div class="row g-3 mt-1">
            <div class="col-md-6"><label class="form-label" for="nome">Nome</label><input class="form-control" id="nome" name="nome" autocomplete="name" required></div>
            <div class="col-md-6"><label class="form-label" for="contato">WhatsApp ou e-mail</label><input class="form-control" id="contato" name="contato" autocomplete="tel" required></div>
            ${def.empresa ? '<div class="col-12"><label class="form-label" for="empresa">Empresa</label><input class="form-control" id="empresa" name="empresa" autocomplete="organization" required></div>' : ''}
          </div>
          <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        </div>
        ${def.blocos.map((b) => `<div class="q-block"><h2>${H.esc(b.titulo)}</h2>
          ${b.perguntas.map((p, i) => `<fieldset class="q"><legend class="q-text fs-6">${H.esc(p)}</legend>${scale(`${b.id}_${i}`)}</fieldset>`).join('')}</div>`).join('')}
        ${def.qualificacao.length ? `<div class="q-block"><h2>Para fechar</h2>${def.qualificacao.map((q) => `<div class="q">
          <label class="q-text d-block" for="q_${q.id}">${H.esc(q.label)}</label>
          <select class="form-select" id="q_${q.id}" name="q_${q.id}" required><option value="">Selecione</option>${q.opcoes.map((o) => `<option>${H.esc(o)}</option>`).join('')}</select></div>`).join('')}</div>` : ''}
        <div class="form-check mt-4"><input class="form-check-input" type="checkbox" id="consent" name="consentimento" required>
          <label class="form-check-label" for="consent">Autorizo o contato para receber o resultado e a recomendação.</label></div>
        ${def.aviso ? `<p class="text-muted small mt-3">${H.esc(def.aviso)}</p>` : ''}
        <button class="btn btn-primary btn-lg w-100 mt-4" type="submit">Ver meu resultado</button>
        <p class="text-danger mt-3" id="err" role="alert"></p>
      </form>
    </div>`;

  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const respostas = {};
    const faltando = [];
    def.blocos.forEach((b) => b.perguntas.forEach((_, i) => {
      const v = fd.get(`${b.id}_${i}`);
      if (!v) faltando.push(`${b.id}_${i}`); else respostas[`${b.id}_${i}`] = Number(v);
    }));
    const err = document.getElementById('err');
    if (faltando.length) {
      err.textContent = `Faltam ${faltando.length} resposta(s). A primeira está destacada.`;
      document.getElementById(`${faltando[0]}_1`).closest('fieldset').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const qualificacao = Object.fromEntries(def.qualificacao.map((q) => [q.id, fd.get(`q_${q.id}`)]));
    const body = { nome: fd.get('nome'), contato: fd.get('contato'), empresa: fd.get('empresa') || '', website: fd.get('website'), consentimento: fd.get('consentimento') === 'on', canal, respostas, qualificacao };
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true; err.textContent = '';
    try {
      const r = await fetch(`/api/public/${encodeURIComponent(conta)}/diagnosticos/${encodeURIComponent(slug)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.erro || 'Não foi possível enviar.');
      const res = data.resultado;
      window.scrollTo(0, 0);
      root.innerHTML = `${head}<div class="diag-wrap"><div class="q-block">
        <p class="text-muted mb-1">Seu resultado</p><h2 class="h1 border-0">${H.esc(res.titulo)}</h2>
        <p class="fs-5">${H.esc(res.resumo)}</p>
        <div class="mt-4">${res.barras.map((b) => `<div class="result-bar"><span>${H.esc(b.label)}</span><div class="funnel-bar"><span style="width:${Math.max(2, b.valor)}%"></span></div><strong>${b.valor}%</strong></div>`).join('')}</div>
        <div class="panel panel-mist mt-4"><p class="mb-1 fw-semibold">Próximo passo recomendado</p><p class="mb-0">${H.esc(res.recomendacao)}</p></div>
        <p class="mt-4">Recebemos suas respostas. Em breve entraremos em contato pelo canal informado com a leitura completa.</p>
        ${def.aviso ? `<p class="text-muted small">${H.esc(def.aviso)}</p>` : ''}
      </div></div>`;
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
})();
