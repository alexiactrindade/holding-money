/* Cliente da API e utilitários compartilhados */
const API = {
  async req(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let r;
    try { r = await fetch('/api' + url, opts); } catch {
      throw new Error('Sem conexão com o sistema. Verifique sua internet e tente de novo.');
    }
    let data = null;
    try { data = await r.json(); } catch { /* sem corpo */ }
    if (r.status === 401 && !url.startsWith('/auth')) { window.dispatchEvent(new Event('hm:logout')); }
    if (!r.ok) {
      const e = new Error(data?.erro || (r.status >= 500 ? 'Algo deu errado ao processar seu pedido. Tente de novo em instantes.' : 'Não foi possível concluir esta ação.'));
      e.semIA = !!data?.semIA;
      throw e;
    }
    return data;
  },
  get: (u) => API.req('GET', u),
  post: (u, b = {}) => API.req('POST', u, b),
  put: (u, b = {}) => API.req('PUT', u, b),
  del: (u) => API.req('DELETE', u),
};

const H = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  brl(v) {
    if (v === null || v === undefined || v === '') return '—';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },
  brlShort(v) {
    const n = Number(v || 0);
    if (Math.abs(n) >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (Math.abs(n) >= 1e4) return 'R$ ' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return H.brl(n);
  },
  pct(v, digits = 0) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits }) + '%';
  },
  date(d) {
    if (!d) return '—';
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return `${day}/${m}/${y}`;
  },
  today() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  },
  slug(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  },
  tag(v) {
    if (!v) return '<span class="text-muted">—</span>';
    return `<span class="tag tag-${H.slug(v)}">${H.esc(v)}</span>`;
  },
  // Markdown mínimo e seguro (escapa antes de formatar)
  md(text) {
    const lines = H.esc(text).split('\n');
    let html = ''; let list = null;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      let m;
      if ((m = l.match(/^\s*[-•*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
      close();
      if (!l.trim()) continue;
      if ((m = l.match(/^#{1,4}\s+(.*)/))) { html += `<p><strong>${inline(m[1])}</strong></p>`; continue; }
      if (/^pr[óo]xima a[çc][ãa]o:/i.test(l.replace(/\*/g, ''))) { html += `<p class="next">${inline(l)}</p>`; continue; }
      html += `<p>${inline(l)}</p>`;
    }
    close();
    return html;
  },
  // Concordância de gênero: "Nova oferta", "Novo produto"
  g(def, masc, fem) { return def.feminino ? fem : masc; },
  toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `hm-toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
  },
  // As três faixas diagonais da capa do e-book (navy, teal, dourado)
  stripes({ width = 256, height = 56, className = 'stripes' } = {}) {
    return `<svg class="${className}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="0,${height * 0.42} ${width},${height * 0.05} ${width},${height * 0.35} 0,${height * 0.72}" fill="#0a3355"/>
      <polygon points="0,${height * 0.62} ${width},${height * 0.25} ${width},${height * 0.55} 0,${height * 0.92}" fill="#0097a7"/>
      <polygon points="0,${height * 0.88} ${width},${height * 0.51} ${width},${height * 0.71} 0,${height * 1.08}" fill="#c99a2e"/>
    </svg>`;
  },
  isPhone(s) { return /^[\d\s()+-]{8,}$/.test(String(s || '').trim()); },
  waLink(phone, text) {
    let n = String(phone).replace(/\D/g, '');
    if (n.length <= 11) n = '55' + n;
    return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
  },
  csv(rows, cols) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const out = [cols.map((c) => q(c.label)).join(';'), ...rows.map((r) => cols.map((c) => q(c.get(r))).join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + out], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'holding-money.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  },
};
