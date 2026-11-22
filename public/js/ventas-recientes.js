// Ventas recientes (prueba social con compras REALES): el servidor manda las últimas ventas pagadas
// (@ enmascarado, paquete y hace cuánto). Si no hay ventas recientes, no aparece nada.
(function () {
  'use strict';
  if (window.__yaVentasRecientes) return;
  window.__yaVentasRecientes = true;
  var CERRADO = 'ya_vr_cerrado';
  try { if (sessionStorage.getItem(CERRADO) === '1') return; } catch (_) {}
  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

  var css = '' +
    '.ya-vr{position:fixed;right:16px;bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:9998;max-width:min(330px,calc(100vw - 32px));' +
    'display:flex;gap:10px;align-items:center;padding:10px 34px 10px 12px;border-radius:14px;background:#fff;color:#111827;' +
    'box-shadow:0 10px 30px rgba(17,24,39,.18);border:1px solid rgba(17,24,39,.08);font:500 13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'opacity:0;transform:translateX(110%);transition:opacity .35s ease,transform .45s ease;pointer-events:none}' +
    '.ya-vr.on{opacity:1;transform:none;pointer-events:auto}' +
    '.ya-vr-ic{flex:0 0 34px;height:34px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,#f58529,#dd2a7b 55%,#8134af);color:#fff}' +
    '.ya-vr-t{font-weight:650;color:#111827}.ya-vr-s{color:#6b7280;font-size:12px;margin-top:1px}.ya-vr-ok{color:#15803d;font-weight:600}' +
    '.ya-vr-x{position:absolute;top:6px;right:8px;border:0;background:transparent;color:#9ca3af;font-size:16px;line-height:1;cursor:pointer;padding:4px}' +
    '.ya-vr-x:focus-visible{outline:2px solid #6366f1;border-radius:6px}' +
    '@media (prefers-reduced-motion:reduce){.ya-vr{transition:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var el = document.createElement('div');
  el.className = 'ya-vr'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  var ICONES = {
    instagram: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    tiktok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3c.3 1.9 1.5 3.6 3.2 4.5 1 .6 2.1.9 3.2.9v3a8.6 8.6 0 01-3.2-.6v5.4A6.2 6.2 0 1110 10v3.1a3.1 3.1 0 102.3 3V3H14z"/></svg>',
    facebook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-7.5H16l.4-3H13.5V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1z"/></svg>'
  };
  var FUNDOS = { instagram: 'linear-gradient(135deg,#f58529,#dd2a7b 55%,#8134af)', tiktok: '#111111', facebook: '#1877f2' };
  el.innerHTML = '<span class="ya-vr-ic" aria-hidden="true"></span>' +
    '<div><div class="ya-vr-t"></div><div class="ya-vr-s"></div></div><button type="button" class="ya-vr-x" aria-label="Cerrar">×</button>';
  var tituloEl = el.querySelector('.ya-vr-t'), subEl = el.querySelector('.ya-vr-s'), icEl = el.querySelector('.ya-vr-ic');

  var itens = [], idx = 0, mostrados = 0, MAX = 6, timer = null, parado = false;
  el.querySelector('.ya-vr-x').addEventListener('click', function () {
    parado = true; el.classList.remove('on'); if (timer) clearTimeout(timer);
    try { sessionStorage.setItem(CERRADO, '1'); } catch (_) {}
  });

  function mostrar() {
    if (parado || !itens.length || mostrados >= MAX || document.hidden) { agenda(); return; }
    var it = itens[idx % itens.length]; idx++; mostrados++;
    var rede = ICONES[it.rede] ? it.rede : 'instagram';
    icEl.innerHTML = ICONES[rede]; icEl.style.background = FUNDOS[rede];
    tituloEl.textContent = it.titulo;
    subEl.textContent = '';
    subEl.appendChild(document.createTextNode(it.tiempo + ' · '));
    var ok = document.createElement('span'); ok.className = 'ya-vr-ok'; ok.textContent = 'compra verificada'; subEl.appendChild(ok);
    if (!el.parentNode) document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('on'); });
    setTimeout(function () { el.classList.remove('on'); agenda(); }, reduce ? 6000 : 5000);
  }
  function agenda() { if (parado || mostrados >= MAX) return; if (timer) clearTimeout(timer); timer = setTimeout(mostrar, 20000); }

  fetch('/api/ventas-recientes', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok || !Array.isArray(d.items) || !d.items.length) return;
      itens = d.items;
      timer = setTimeout(mostrar, 9000);
    })
    .catch(function () {});
})();
