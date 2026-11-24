// Carrossel das avaliações reais (home #resenasReais e páginas de serviço #resenasServico).
// Uso: yaResenasCarrusel(elementoLista) depois de preencher os cards.
// Rola sozinho para o lado a cada 4 s (volta ao início no fim), para quando o cliente passa o mouse,
// toca ou usa as setas, e não anda sozinho com "reduzir movimento". Sem rolagem (cabe tudo): fica centralizado.
(function () {
  if (window.yaResenasCarrusel) return;
  var css = '' +
    '.rc-wrap{position:relative;width:100%;max-width:1100px;min-width:0;margin:0 auto;box-sizing:border-box;contain:inline-size}' +
    '.rc-lista{display:flex!important;flex-wrap:nowrap!important;justify-content:flex-start!important;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:4px 2px 14px!important;max-width:100%!important;box-sizing:border-box}' +
    '.rc-lista::-webkit-scrollbar{display:none}' +
    '.rc-lista.rc-cabe{justify-content:center!important}' +
    '.rc-lista>article{flex:0 0 min(340px,88%)!important;max-width:none!important;scroll-snap-align:start}' +
    '.rc-seta{position:absolute;top:calc(50% - 22px);width:40px;height:40px;border-radius:50%;border:1px solid rgba(139,92,246,.3);background:var(--bg-secondary,#1A1A2E);color:var(--text-primary,#fff);font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;box-shadow:0 6px 18px -10px rgba(0,0,0,.5)}' +
    '.rc-seta:focus-visible{outline:2px solid #8b5cf6;outline-offset:2px}' +
    '.rc-ant{left:-14px}.rc-prox{right:-14px}' +
    '.rc-wrap.rc-sem-rolagem .rc-seta{display:none}' +
    'body.theme-light .rc-seta{background:#fff;border-color:#e6e8ee;color:#0f172a}' +
    '.rc-pontos{display:flex;justify-content:center;gap:6px;margin-top:2px}' +
    '.rc-pontos button{width:7px;height:7px;padding:0;border:0;border-radius:50%;background:rgba(139,92,246,.3);cursor:pointer}' +
    '.rc-pontos button.on{width:20px;border-radius:4px;background:#8b5cf6}' +
    '.rc-wrap.rc-sem-rolagem .rc-pontos{display:none}' +
    '@media (max-width:900px){.rc-seta{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  window.yaResenasCarrusel = function (lista) {
    if (!lista || lista.__rc) return; lista.__rc = true;
    var wrap = document.createElement('div'); wrap.className = 'rc-wrap';
    lista.parentNode.insertBefore(wrap, lista); wrap.appendChild(lista);
    // a seção pai (item de grid/flex) não pode crescer com a largura da fila de cards
    try { lista.parentNode.parentNode.style.minWidth = '0'; lista.parentNode.parentNode.style.maxWidth = '100%'; } catch (_) {}
    lista.classList.add('rc-lista');
    var ant = document.createElement('button'); ant.type = 'button'; ant.className = 'rc-seta rc-ant'; ant.setAttribute('aria-label', 'Reseña anterior'); ant.textContent = '‹';
    var prox = document.createElement('button'); prox.type = 'button'; prox.className = 'rc-seta rc-prox'; prox.setAttribute('aria-label', 'Siguiente reseña'); prox.textContent = '›';
    var pontos = document.createElement('div'); pontos.className = 'rc-pontos';
    wrap.appendChild(ant); wrap.appendChild(prox); wrap.appendChild(pontos);

    var cards = function () { return Array.prototype.slice.call(lista.children); };
    var passo = function () { var c = cards(); return c.length > 1 ? c[1].offsetLeft - c[0].offsetLeft : lista.clientWidth; };
    var noFim = function () { return lista.scrollLeft + lista.clientWidth >= lista.scrollWidth - 4; };
    var atual = function () { return Math.round(lista.scrollLeft / Math.max(1, passo())); };
    var irPara = function (i) { lista.scrollTo({ left: i * passo(), behavior: 'smooth' }); setTimeout(marcar, 700); };
    var avancar = function () { if (noFim()) irPara(0); else irPara(atual() + 1); };
    var voltar = function () { if (lista.scrollLeft <= 4) lista.scrollTo({ left: lista.scrollWidth, behavior: 'smooth' }); else irPara(atual() - 1); };

    var nPos = 0;
    var montarPontos = function () {
      var cabe = lista.scrollWidth <= lista.clientWidth + 4;
      lista.classList.toggle('rc-cabe', cabe); wrap.classList.toggle('rc-sem-rolagem', cabe);
      nPos = cabe ? 0 : Math.ceil((lista.scrollWidth - lista.clientWidth) / Math.max(1, passo())) + 1;
      pontos.innerHTML = '';
      for (var i = 0; i < nPos; i++) (function (k) { var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Ir a la reseña ' + (k + 1)); b.onclick = function () { pausar(); irPara(k); }; pontos.appendChild(b); })(i);
      marcar();
    };
    var marcar = function () { var a = noFim() ? nPos - 1 : atual(); Array.prototype.forEach.call(pontos.children, function (b, i) { b.classList.toggle('on', i === a); }); };

    var reduz = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timer = null, pausadoAte = 0;
    var pausar = function () { pausadoAte = Date.now() + 8000; };
    var tick = function () { if (reduz || document.hidden || Date.now() < pausadoAte || wrap.classList.contains('rc-sem-rolagem') || wrap.matches(':hover')) return; avancar(); };
    ant.onclick = function () { pausar(); voltar(); };
    prox.onclick = function () { pausar(); avancar(); };
    ['pointerdown', 'touchstart', 'wheel', 'focusin'].forEach(function (ev) { lista.addEventListener(ev, pausar, { passive: true }); });
    var rt; lista.addEventListener('scroll', function () { clearTimeout(rt); rt = setTimeout(marcar, 80); }, { passive: true });
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(montarPontos, 150); });
    montarPontos();
    timer = setInterval(tick, 4000);
  };
})();
