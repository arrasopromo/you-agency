// Selo "Reseñas verificadas" + demonstração animada de como a reseña é feita na página do pedido.
// Uso: yaResenasVerificadas(listaDeCards) depois do carrossel montar (home e páginas de serviço).
// A demo é ilustrativa (perfil fictício, marcado como "Ejemplo") e mostra a regra real:
// a reseña só libera quando o pedido fica Completado (trava no /api/resenas desde 24/11).
(function () {
  if (window.yaResenasVerificadas) return;
  var css = '' +
    '.rv-selo{display:inline-flex;align-items:center;gap:8px;margin:-.4rem auto 1.1rem;padding:6px 12px 6px 8px;border-radius:999px;font-size:.84rem;line-height:1.3;color:var(--text-secondary,#cbd5e1);background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.28);text-align:left;max-width:100%;box-sizing:border-box}' +
    '.rv-selo b{color:var(--text-primary,#fff);font-weight:700}' +
    '.rv-ok{flex:none;width:20px;height:20px;border-radius:50%;background:#16a34a;display:inline-flex;align-items:center;justify-content:center}' +
    '.rv-ok svg{width:12px;height:12px}' +
    '.rv-demo{width:100%;max-width:880px;margin:1.6rem auto 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,360px);gap:28px;align-items:center;text-align:left;box-sizing:border-box}' +
    '.rv-txt h3{margin:0 0 .5rem;font-size:1.3rem;line-height:1.25;font-weight:700;color:var(--text-primary,#fff);text-wrap:balance}' +
    '.rv-txt p{margin:0 0 1rem;color:var(--text-secondary,#cbd5e1);font-size:.95rem;line-height:1.55}' +
    '.rv-passos{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}' +
    '.rv-passos li{display:flex;gap:10px;align-items:flex-start;font-size:.92rem;line-height:1.45;color:var(--text-primary,#fff)}' +
    '.rv-passos li span{flex:none;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.78rem;font-weight:700;color:#8b5cf6;background:rgba(139,92,246,.14)}' +
    '.rv-passos li small{display:block;color:var(--text-secondary,#cbd5e1);font-size:.82rem}' +
    '.rv-tela{position:relative;border-radius:18px;padding:16px;background:var(--bg-secondary,#1A1A2E);border:1px solid rgba(139,92,246,.25);box-shadow:0 24px 48px -30px rgba(0,0,0,.6);font-size:.86rem;color:var(--text-primary,#fff);min-width:0}' +
    '.rv-ex{position:absolute;top:-10px;right:14px;padding:2px 9px;border-radius:999px;font-size:.7rem;font-weight:600;color:var(--text-secondary,#cbd5e1);background:var(--bg-secondary,#1A1A2E);border:1px solid rgba(139,92,246,.3)}' +
    '.rv-cab{display:flex;justify-content:space-between;align-items:center;gap:8px;padding-bottom:10px;border-bottom:1px solid rgba(148,163,184,.18)}' +
    '.rv-cab b{font-size:.92rem}' +
    '.rv-cab small{color:var(--text-secondary,#cbd5e1);font-size:.75rem}' +
    '.rv-perfil{display:flex;align-items:center;gap:10px;padding:10px 0}' +
    '.rv-av{flex:none;width:34px;height:34px;border-radius:50%;background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);color:#fff;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-size:.85rem}' +
    '.rv-perfil div{min-width:0}' +
    '.rv-perfil b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.rv-perfil small{color:var(--text-secondary,#cbd5e1);font-size:.78rem}' +
    '.rv-st{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;font-size:.8rem;color:var(--text-secondary,#cbd5e1)}' +
    '.rv-badge{padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:700;transition:background .3s,color .3s}' +
    '.rv-badge.proc{background:rgba(234,179,8,.16);color:#eab308}' +
    '.rv-badge.ok{background:rgba(34,197,94,.16);color:#22c55e}' +
    '.rv-barra{height:6px;border-radius:3px;background:rgba(148,163,184,.18);overflow:hidden}' +
    '.rv-barra i{display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,#8b5cf6,#ec4899);transition:width .12s linear}' +
    '.rv-num{margin-top:6px;font-size:.78rem;color:var(--text-secondary,#cbd5e1);font-variant-numeric:tabular-nums}' +
    '.rv-res{margin-top:12px;padding:12px;border-radius:12px;border:1px dashed rgba(148,163,184,.35);min-height:116px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;justify-content:center}' +
    '.rv-res.lib{border-style:solid;border-color:rgba(139,92,246,.35)}' +
    '.rv-trava{display:flex;align-items:center;gap:8px;color:var(--text-secondary,#cbd5e1);font-size:.8rem;line-height:1.4}' +
    '.rv-trava svg{flex:none;width:18px;height:18px}' +
    '.rv-est{font-size:1.35rem;letter-spacing:3px;color:rgba(148,163,184,.4);line-height:1}' +
    '.rv-est .on{color:#f5b301}' +
    '.rv-campo{min-height:2.6em;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,.3);font-size:.82rem;line-height:1.35;color:var(--text-primary,#fff)}' +
    '.rv-campo:after{content:"";display:inline-block;width:1px;height:1em;margin-left:1px;vertical-align:-2px;background:currentColor;animation:rvPisca 1s steps(1) infinite}' +
    '.rv-btn{align-self:flex-start;padding:6px 14px;border-radius:999px;font-size:.78rem;font-weight:700;color:#fff;background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);transition:transform .15s}' +
    '.rv-btn.click{transform:scale(.94)}' +
    '.rv-fim{display:flex;align-items:center;gap:8px;font-size:.82rem;line-height:1.4;color:var(--text-primary,#fff)}' +
    '.rv-cardtop{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
    '.rv-vf{display:inline-flex;align-items:center;gap:5px;font-size:.72rem;font-weight:600;color:#22c55e;white-space:nowrap}' +
    '.rv-vf i{width:14px;height:14px;border-radius:50%;background:#16a34a;display:inline-flex;align-items:center;justify-content:center}' +
    '.rv-vf svg{width:9px;height:9px}' +
    'body.theme-light .rv-vf{color:#15803d}' +
    '@keyframes rvPisca{50%{opacity:0}}' +
    '.rv-fade{animation:rvIn .35s ease-out}' +
    '@keyframes rvIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}' +
    'body.theme-light .rv-selo{background:#f0fdf4;border-color:#bbf7d0;color:#475569}' +
    'body.theme-light .rv-selo b{color:#0f172a}' +
    'body.theme-light .rv-tela,body.theme-light .rv-ex{background:#fff;border-color:#e6e8ee;color:#0f172a}' +
    'body.theme-light .rv-tela{box-shadow:0 24px 48px -32px rgba(15,23,42,.35)}' +
    'body.theme-light .rv-txt h3,body.theme-light .rv-passos li,body.theme-light .rv-campo,body.theme-light .rv-fim{color:#0f172a}' +
    'body.theme-light .rv-badge.proc{color:#a16207;background:#fef9c3}' +
    'body.theme-light .rv-badge.ok{color:#15803d;background:#dcfce7}' +
    '@media (max-width:760px){.rv-demo{grid-template-columns:1fr;gap:20px;max-width:420px;padding:0 6px}.rv-selo{max-width:calc(100% - 12px)}.rv-txt{text-align:center}.rv-passos li{text-align:left}}' +
    '@media (prefers-reduced-motion:reduce){.rv-campo:after{animation:none}.rv-fade{animation:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var CHECK = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 10.5V7.8a3.5 3.5 0 017 0v2.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  // perfis fictícios para a demonstração (não são clientes)
  var EX = [
    { u: 'sofi.reposteria', q: 1000, p: 'seguidores', t: '¡Llegaron rapidísimo y sin pedir contraseña!' },
    { u: 'barberia.elcompa', q: 500, p: 'seguidores', t: 'Todo bien, en menos de una hora ya estaban.' },
    { u: 'tacos.donchuy', q: 2000, p: 'me gusta', t: 'Muy buen servicio, se nota el cambio en mi post.' },
    { u: 'ana.fit.mx', q: 1000, p: 'seguidores', t: 'Excelente, volveré a comprar.' }
  ];

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
      '<div class="rv-tela" aria-hidden="true">' +
        '<span class="rv-ex">Ejemplo</span>' +
        '<div class="rv-cab"><b>Tu pedido</b><small class="rv-id"></small></div>' +
        '<div class="rv-perfil"><span class="rv-av"></span><div><b class="rv-u"></b><small class="rv-prod"></small></div></div>' +
        '<div class="rv-st"><span>Estado del servicio</span><span class="rv-badge proc">En proceso</span></div>' +
        '<div class="rv-barra"><i></i></div>' +
        '<div class="rv-num"></div>' +
        '<div class="rv-res"></div>' +
      '</div>';
    return d;
  }

  function animar(d) {
    var $ = function (s) { return d.querySelector(s); };
    var reduz = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timers = [], idx = Math.floor(Math.random() * EX.length), visivel = false, rodando = false;
    var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
    var estrelas = function (n) { var s = ''; for (var i = 1; i <= 5; i++) s += '<span' + (i <= n ? ' class="on"' : '') + '>★</span>'; return s; };

    function preparar(ex) {
      $('.rv-id').textContent = '#YA-' + (40000 + Math.floor(Math.random() * 59999));
      $('.rv-av').textContent = ex.u.charAt(0).toUpperCase();
      $('.rv-u').textContent = '@' + ex.u;
      $('.rv-prod').textContent = fmt(ex.q) + ' ' + ex.p;
      var b = $('.rv-badge'); b.className = 'rv-badge proc'; b.textContent = 'En proceso';
      $('.rv-barra i').style.width = '0%';
      $('.rv-num').textContent = '+0 de ' + fmt(ex.q) + ' ' + ex.p;
      var r = $('.rv-res'); r.className = 'rv-res';
      r.innerHTML = '<div class="rv-trava">' + LOCK + '<span>La reseña se habilita cuando el estado sea <b>Completado</b>.</span></div>';
    }
    function liberar(ex) {
      var b = $('.rv-badge'); b.className = 'rv-badge ok'; b.textContent = 'Completado';
      var r = $('.rv-res'); r.className = 'rv-res lib rv-fade';
      r.innerHTML = '<div class="rv-est">' + estrelas(0) + '</div><div class="rv-campo"></div><span class="rv-btn">Enviar reseña</span>';
    }
    function final(ex) {
      var r = $('.rv-res'); r.className = 'rv-res lib rv-fade';
      r.innerHTML = '<div class="rv-est">' + estrelas(5) + '</div><div class="rv-fim"><span class="rv-ok">' + CHECK + '</span><span>¡Gracias! Tu reseña quedó vinculada al pedido ' + $('.rv-id').textContent + '.</span></div>';
    }

    function ciclo() {
      timers.forEach(clearTimeout); timers = [];
      var ex = EX[idx++ % EX.length];
      preparar(ex);
      if (reduz) { $('.rv-barra i').style.width = '100%'; $('.rv-num').textContent = '+' + fmt(ex.q) + ' de ' + fmt(ex.q) + ' ' + ex.p; liberar(ex); final(ex); return; }
      rodando = true;
      var passos = 24, dur = 2600;
      for (var i = 1; i <= passos; i++) (function (k) {
        later(function () { var f = k / passos; $('.rv-barra i').style.width = (f * 100) + '%'; $('.rv-num').textContent = '+' + fmt(ex.q * f) + ' de ' + fmt(ex.q) + ' ' + ex.p; }, 600 + dur * k / passos);
      })(i);
      var t = 600 + dur + 500;
      later(function () { liberar(ex); }, t);
      for (var e = 1; e <= 5; e++) (function (k) { later(function () { var el = $('.rv-est'); if (el) el.innerHTML = estrelas(k); }, t + 500 + k * 170); })(e);
      var t2 = t + 500 + 6 * 170 + 200;
      for (var c = 1; c <= ex.t.length; c++) (function (k) { later(function () { var el = $('.rv-campo'); if (el) el.textContent = ex.t.slice(0, k); }, t2 + k * 38); })(c);
      var t3 = t2 + ex.t.length * 38 + 500;
      later(function () { var bt = $('.rv-btn'); if (bt) bt.classList.add('click'); }, t3);
      later(function () { final(ex); }, t3 + 250);
      later(function () { rodando = false; if (visivel && !document.hidden) ciclo(); }, t3 + 3800);
    }

    if (reduz || !('IntersectionObserver' in window)) { ciclo(); return; }
    preparar(EX[idx % EX.length]);
    new IntersectionObserver(function (es) {
      visivel = es[0].isIntersecting;
      if (visivel && !rodando) ciclo();
    }, { threshold: 0.35 }).observe(d);
  }

  window.yaResenaVfChip = '<span class="rv-vf"><i>' + CHECK + '</i>Compra verificada</span>';

  window.yaResenasVerificadas = function (lista) {
    if (!lista || lista.__rv) return; lista.__rv = true;
    var ancora = (lista.parentNode && lista.parentNode.classList.contains('rc-wrap')) ? lista.parentNode : lista;
    var selo = document.createElement('div'); selo.className = 'rv-selo';
    selo.innerHTML = '<span class="rv-ok">' + CHECK + '</span><span><b>Reseñas verificadas.</b> Solo reseña quien compró y recibió su pedido.</span>';
    ancora.parentNode.insertBefore(selo, ancora);
    var demo = montarDemo();
    ancora.parentNode.insertBefore(demo, ancora.nextSibling);
    animar(demo);
  };
})();
