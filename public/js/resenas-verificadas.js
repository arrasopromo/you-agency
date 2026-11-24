// Selo "Reseñas verificadas" + print REAL da seção de reseña da página do pedido.
// Uso: yaResenasVerificadas(listaDeCards) depois do carrossel montar (home e páginas de serviço).
// O print vem de /pedido/ejemplo (pedido fictício, status Completado) e o link abre essa página.
// Regra real: a reseña só libera quando o pedido fica Completado (trava no /api/resenas desde 24/11).
(function () {
  if (window.yaResenasVerificadas) return;
  var css = '' +
    '.rv-selo{display:inline-flex;align-items:center;gap:8px;margin:-.4rem auto 1.1rem;padding:6px 12px 6px 8px;border-radius:999px;font-size:.84rem;line-height:1.3;color:var(--text-secondary,#cbd5e1);background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.28);text-align:left;max-width:100%;box-sizing:border-box}' +
    '.rv-selo b{color:var(--text-primary,#fff);font-weight:700}' +
    '.rv-ok{flex:none;width:20px;height:20px;border-radius:50%;background:#16a34a;display:inline-flex;align-items:center;justify-content:center}' +
    '.rv-ok svg{width:12px;height:12px}' +
    '.rv-demo{width:100%;max-width:880px;margin:1.6rem auto 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,330px);gap:40px;align-items:center;text-align:left;box-sizing:border-box}' +
    '.rv-txt h3{margin:0 0 .5rem;font-size:1.3rem;line-height:1.25;font-weight:700;color:var(--text-primary,#fff);text-wrap:balance}' +
    '.rv-txt p{margin:0 0 1rem;color:var(--text-secondary,#cbd5e1);font-size:.95rem;line-height:1.55}' +
    '.rv-passos{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}' +
    '.rv-passos li{display:flex;gap:10px;align-items:flex-start;font-size:.92rem;line-height:1.45;color:var(--text-primary,#fff)}' +
    '.rv-passos li span{flex:none;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.78rem;font-weight:700;color:#8b5cf6;background:rgba(139,92,246,.14)}' +
    '.rv-passos li small{display:block;color:var(--text-secondary,#cbd5e1);font-size:.82rem}' +
    '.rv-print{position:relative;margin:0 auto;min-width:0;width:100%;max-width:330px}' +
    '.rv-print img{display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(139,92,246,.25);box-shadow:0 24px 48px -30px rgba(0,0,0,.6)}' +
    '.rv-ex{position:absolute;top:-10px;right:14px;padding:2px 9px;border-radius:999px;font-size:.7rem;font-weight:600;color:var(--text-secondary,#cbd5e1);background:var(--bg-secondary,#1A1A2E);border:1px solid rgba(139,92,246,.3)}' +
    '.rv-print figcaption{margin-top:10px;font-size:.82rem;line-height:1.4;color:var(--text-secondary,#cbd5e1);text-align:center}' +
    '.rv-print a{color:#8b5cf6;font-weight:600;text-decoration:underline;text-underline-offset:2px}' +
    '.rv-cardtop{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
    '.rv-vf{display:inline-flex;align-items:center;gap:5px;font-size:.72rem;font-weight:600;color:#22c55e;white-space:nowrap}' +
    '.rv-vf i{width:14px;height:14px;border-radius:50%;background:#16a34a;display:inline-flex;align-items:center;justify-content:center}' +
    '.rv-vf svg{width:9px;height:9px}' +
    'body.theme-light .rv-vf{color:#15803d}' +
    'body.theme-light .rv-selo{background:#f0fdf4;border-color:#bbf7d0;color:#475569}' +
    'body.theme-light .rv-selo b{color:#0f172a}' +
    'body.theme-light .rv-txt h3,body.theme-light .rv-passos li{color:#0f172a}' +
    'body.theme-light .rv-ex{background:#fff;border-color:#e6e8ee;color:#475569}' +
    'body.theme-light .rv-print img{border-color:#e6e8ee;box-shadow:0 24px 48px -32px rgba(15,23,42,.35)}' +
    'body.theme-light .rv-print a{color:#7c3aed}' +
    '@media (max-width:760px){.rv-demo{grid-template-columns:1fr;gap:20px;max-width:420px;padding:0 6px}.rv-selo{max-width:calc(100% - 12px)}.rv-txt{text-align:center}.rv-passos li{text-align:left}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var CHECK = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function montarDemo() {
    var d = document.createElement('div'); d.className = 'rv-demo';
    d.innerHTML =
      '<div class="rv-txt">' +
        '<h3>Cada reseña viene de un pedido completado</h3>' +
        '<p>Nadie puede dejar una reseña sin comprar. El espacio para reseñar solo se abre en la página de tu pedido, cuando la entrega termina.</p>' +
        '<ol class="rv-passos">' +
          '<li><span>1</span><div>Haces tu pedido y pagas<small>Con SPEI u OXXO.</small></div></li>' +
          '<li><span>2</span><div>Entregamos y el estado cambia a Completado<small>Lo sigues en vivo en la página de tu pedido.</small></div></li>' +
          '<li><span>3</span><div>Se libera tu reseña<small>Queda vinculada a tu pedido y la revisamos antes de publicarla.</small></div></li>' +
        '</ol>' +
      '</div>' +
      '<figure class="rv-print">' +
        '<span class="rv-ex">Ejemplo</span>' +
        '<picture><source srcset="/images/resena-pedido-real.webp?v=2" type="image/webp"><img src="/images/resena-pedido-real.png?v=2" width="600" height="842" loading="lazy" alt="Página del pedido: detalles, estado del servicio en Completado y el formulario para dejar la reseña"></picture>' +
        '<figcaption>Así se ve en la página de tu pedido. <a href="/pedido/ejemplo" target="_blank" rel="noopener">Ver un pedido de ejemplo</a></figcaption>' +
      '</figure>';
    return d;
  }

  window.yaResenaVfChip = '<span class="rv-vf"><i>' + CHECK + '</i>Compra verificada</span>';

  window.yaResenasVerificadas = function (lista) {
    if (!lista || lista.__rv) return; lista.__rv = true;
    var ancora = (lista.parentNode && lista.parentNode.classList.contains('rc-wrap')) ? lista.parentNode : lista;
    var selo = document.createElement('div'); selo.className = 'rv-selo';
    selo.innerHTML = '<span class="rv-ok">' + CHECK + '</span><span><b>Reseñas verificadas.</b> Solo reseña quien compró y recibió su pedido.</span>';
    ancora.parentNode.insertBefore(selo, ancora);
    ancora.parentNode.insertBefore(montarDemo(), ancora.nextSibling);
  };
})();
