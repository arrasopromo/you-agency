// Preço em MXN ("$ 1,234"): leitura e formatação únicas do site (aceita também "1.234,90").
function yaParsePreco(s) { var raw = String(s == null ? '' : s).replace(/[^\d.,]/g, ''); if (!raw) return 0; var norm = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''); var v = parseFloat(norm); return isNaN(v) ? 0 : v; }
function yaFmtPreco(n) { var v = Number(n || 0); var d = Math.abs(v - Math.round(v)) < 0.005 ? 0 : 2; return '$ ' + (d ? v : Math.round(v)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

document.addEventListener('DOMContentLoaded', function() {
  // --- Estado Global ---
  window.currentService = 'followers'; // followers, likes, views
  window.selectedType = ''; 
  window.selectedPlan = null;
  window.selectedPost = null;
  window.cachedPosts = [];
  window.visiblePostsCount = 9;
  window.currentStep = 1;
  
  // Coupon State
  window.couponCode = '';
  window.couponDiscount = 0;
  (function(){
    function getUrlCoupon(){
      try {
        const p = new URLSearchParams(window.location.search);
        let code = String(p.get('cupom') || p.get('coupon') || '').trim();
        if (!code) {
          const m = String(window.location.pathname || '').match(/\/cupom=([^\/]+)/i);
          if (m && m[1]) code = decodeURIComponent(m[1]);
        }
        return String(code || '').trim().toUpperCase();
      } catch(_) { return ''; }
    }
    const pre = getUrlCoupon();
    if (pre) {
      try { sessionStorage.setItem('ya_coupon_code', pre); } catch(_) {}
      const input = document.getElementById('couponInput');
      const msg = document.getElementById('couponMessage');
      if (input) input.value = pre;
      const applyNow = function(){
        const usernameEl = document.getElementById('usernameCheckoutInput');
        const instagram_username = usernameEl ? usernameEl.value.trim().replace(/^@+/, '') : '';
        fetch('/api/validate-coupon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pre, instagram_username })
        })
        .then(function(res){ return res.json(); })
        .then(function(data){
          if (data && data.valid) {
            window.couponCode = data.code;
            window.couponDiscount = data.discount || 0;
            if (msg) {
              const percent = Math.round((Number(data.discount||0)) * 100);
              msg.textContent = '¡Cupón aplicado! (' + percent + '% de descuento)';
              msg.style.color = '#22c55e';
              msg.style.display = 'block';
            }
            if (input) input.disabled = true;
            if (typeof updatePromosSummary === 'function') updatePromosSummary();
          } else {
            window.couponCode = '';
            window.couponDiscount = 0;
            if (msg) {
              msg.textContent = (data && data.error) ? data.error : 'Cupón inválido.';
              msg.style.color = '#ef4444';
              msg.style.display = 'block';
            }
            if (typeof updatePromosSummary === 'function') updatePromosSummary();
          }
        }).catch(function(){});
      };
      const ue = document.getElementById('usernameCheckoutInput');
      if (ue && ue.value && ue.value.trim()) {
        applyNow();
      } else if (ue) {
        let done = false;
        ue.addEventListener('change', function(){
          if (!done && ue.value && ue.value.trim()) { done = true; applyNow(); }
        });
        ue.addEventListener('blur', function(){
          if (!done && ue.value && ue.value.trim()) { done = true; applyNow(); }
        });
      } else {
        applyNow();
      }
    }
  })();

  // Initialize Step
  setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const stepParam = parseInt(params.get('step'));
      if (stepParam && stepParam >= 1 && stepParam <= 3) {
          window.goToStepEngajamento(stepParam, false);
      } else {
          window.goToStepEngajamento(1, false);
      }
  }, 100);
  
  const applyCouponBtn = document.getElementById('applyCouponBtn');
  if (applyCouponBtn) {
      applyCouponBtn.addEventListener('click', function() {
          const input = document.getElementById('couponInput');
          const msg = document.getElementById('couponMessage');
          if (!input || !msg) return;
          
          const code = input.value.trim().toUpperCase();
          if (!code) {
              msg.textContent = 'Escribe un cupón.';
              msg.style.color = '#ef4444';
              msg.style.display = 'block';
              return;
          }
          
          // Validation Logic via API
          this.disabled = true;
          this.textContent = 'Verificando...';
          
          const usernameEl = document.getElementById('usernameCheckoutInput');
          const instagram_username = usernameEl ? usernameEl.value.trim().replace(/^@+/, '') : '';

          fetch('/api/validate-coupon', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code, instagram_username })
          })
          .then(res => res.json())
          .then(data => {
              if (data.valid) {
                  window.couponCode = data.code;
                  window.couponDiscount = data.discount; // decimal, e.g. 0.10
                  
                  const percent = Math.round(data.discount * 100);
                  msg.textContent = `¡Cupón aplicado! (${percent}% de descuento)`;
                  msg.style.color = '#22c55e';
                  msg.style.display = 'block';
                  
                  input.disabled = true;
                  this.disabled = true;
                  this.textContent = 'Aplicado';
              } else {
                  msg.textContent = data.error || 'Cupón inválido.';
                  msg.style.color = '#ef4444';
                  msg.style.display = 'block';
                  window.couponCode = '';
                  window.couponDiscount = 0;
                  
                  this.disabled = false;
                  this.textContent = 'Aplicar';
              }
              if (typeof updatePromosSummary === 'function') updatePromosSummary();
          })
          .catch(err => {
              console.error('Erro ao validar cupom:', err);
              msg.textContent = 'Error al validar el cupón.';
              msg.style.color = '#ef4444';
              msg.style.display = 'block';
              
              this.disabled = false;
              this.textContent = 'Aplicar';
          });
      });
  }
  
  // Dados de Preços (Mesma base do servicos-instagram.js)
  const tabelaSeguidores = {
    mistos: [
      { q: 100, p: '$ 52' }, { q: 250, p: '$ 73' }, { q: 500, p: '$ 105' },
      { q: 1000, p: '$ 157' }, { q: 2000, p: '$ 253' }, { q: 3000, p: '$ 390' },
      { q: 5000, p: '$ 665' }, { q: 10000, p: '$ 1353' }, { q: 20000, p: '$ 2464' }
    ],
    brasileiros: [
      { q: 150, p: '$ 42' }, { q: 300, p: '$ 83' }, { q: 500, p: '$ 133' },
      { q: 700, p: '$ 167' }, { q: 1000, p: '$ 269' }, { q: 2000, p: '$ 437' },
      { q: 3000, p: '$ 605' }, { q: 4000, p: '$ 841' }, { q: 5000, p: '$ 942' },
      { q: 7500, p: '$ 1346' }, { q: 10000, p: '$ 1684' }, { q: 15000, p: '$ 2694' }
    ],
    organicos: [
      { q: 150, p: '$ 133' }, { q: 300, p: '$ 167' }, { q: 500, p: '$ 235' },
      { q: 1000, p: '$ 437' }, { q: 2000, p: '$ 673' }, { q: 3000, p: '$ 841' },
      { q: 4000, p: '$ 1110' }, { q: 5000, p: '$ 1684' }, { q: 7500, p: '$ 2020' },
      { q: 10000, p: '$ 3030' }, { q: 15000, p: '$ 4378' }
    ]
  };

  const tabelaCurtidas = {
    mistos: [
      { q: 150, p: '$ 20' },
      { q: 300, p: '$ 23' },
      { q: 500, p: '$ 29' },
      { q: 700, p: '$ 44' },
      { q: 1000, p: '$ 60' },
      { q: 2000, p: '$ 75' },
      { q: 3000, p: '$ 90' },
      { q: 4000, p: '$ 105' },
      { q: 5000, p: '$ 121' },
      { q: 7500, p: '$ 151' },
      { q: 10000, p: '$ 212' },
      { q: 15000, p: '$ 272' }
    ],
    curtidas_brasileiras: [
      { q: 150, p: '$ 20' },
      { q: 300, p: '$ 29' },
      { q: 500, p: '$ 44' },
      { q: 700, p: '$ 90' },
      { q: 1000, p: '$ 121' },
      { q: 2000, p: '$ 151' },
      { q: 3000, p: '$ 181' },
      { q: 4000, p: '$ 212' },
      { q: 5000, p: '$ 242' },
      { q: 7500, p: '$ 333' },
      { q: 10000, p: '$ 424' },
      { q: 15000, p: '$ 606' }
    ],
    organicos: [
      { q: 150, p: '$ 36' },
      { q: 300, p: '$ 60' },
      { q: 500, p: '$ 105' },
      { q: 700, p: '$ 123' },
      { q: 1000, p: '$ 148' },
      { q: 2000, p: '$ 224' },
      { q: 3000, p: '$ 296' },
      { q: 4000, p: '$ 373' },
      { q: 5000, p: '$ 478' },
      { q: 7500, p: '$ 594' },
    ]
  };

  const tabelaVisualizacoes = {
    visualizacoes_reels: [
      { q: 1000, p: '$ 20' }, { q: 2500, p: '$ 29' }, { q: 5000, p: '$ 44' },
      { q: 10000, p: '$ 60' }, { q: 25000, p: '$ 75' }, { q: 50000, p: '$ 105' },
      { q: 100000, p: '$ 151' }, { q: 150000, p: '$ 181' }, { q: 200000, p: '$ 212' },
      { q: 250000, p: '$ 272' }, { q: 500000, p: '$ 333' }, { q: 1000000, p: '$ 485' }
    ]
  };
  
  // Badges Configuration
  const quantityBadges = {
    150: 'PAQUETE INICIAL',
    500: 'PAQUETE BÁSICO',
    1000: 'MÁS PEDIDO',
    3000: 'EXCLUSIVO',
    5000: 'VIP',
    10000: 'ELITE'
  };

  // Promo Pricing (Igual servicos-instagram)
  const promoPricing = {
    likes: { old: '$ 37', price: '$ 20', discount: 41 },
    views: { old: '$ 31', price: '$ 20', discount: 29 },
    comments: { old: '$ 34', price: '$ 20', discount: 41 },
    warranty: { old: '$ 144', price: '$ 49', discount: 63 },
    warranty60: { old: '$ 144', price: '$ 32', discount: 75 },
  };
  try { window.promoPricing = promoPricing; } catch(_) {}

  // --- Logic for Quantity Controls (Step 3 Parity) ---
  let likesTable = [];
  function getLikesPromoVariantKey() {
    const tipo = String(window.selectedType || '').toLowerCase();
    if (tipo === 'organicos') return 'organicos';
    if (tipo === 'curtidas_brasileiras') return 'brasileiros';
    if (tipo === 'brasileiros') return 'brasileiros';
    return 'mistos';
  }
  function refreshLikesTable() {
    const byVariant = {
      mistos: [
        { q: 150, price: '$ 20' }, { q: 300, price: '$ 23' }, { q: 500, price: '$ 29' },
        { q: 700, price: '$ 44' }, { q: 1000, price: '$ 60' }, { q: 2000, price: '$ 75' },
        { q: 3000, price: '$ 90' }, { q: 4000, price: '$ 105' }, { q: 5000, price: '$ 121' },
        { q: 7500, price: '$ 151' }, { q: 10000, price: '$ 212' }, { q: 15000, price: '$ 272' }
      ],
      brasileiros: [
        { q: 150, price: '$ 20' }, { q: 300, price: '$ 29' }, { q: 500, price: '$ 44' },
        { q: 700, price: '$ 90' }, { q: 1000, price: '$ 121' }, { q: 2000, price: '$ 151' },
        { q: 3000, price: '$ 181' }, { q: 4000, price: '$ 212' }, { q: 5000, price: '$ 242' },
        { q: 7500, price: '$ 333' }, { q: 10000, price: '$ 424' }, { q: 15000, price: '$ 606' }
      ],
      organicos: [
        { q: 150, price: '$ 36' }, { q: 300, price: '$ 60' }, { q: 500, price: '$ 105' }, { q: 700, price: '$ 123' },
        { q: 1000, price: '$ 148' }, { q: 2000, price: '$ 224' }, { q: 3000, price: '$ 296' },
        { q: 4000, price: '$ 373' }, { q: 5000, price: '$ 478' }, { q: 7500, price: '$ 594' },
      ]
    };
    const key = getLikesPromoVariantKey();
    const arr = byVariant[key] || byVariant.mistos;
    likesTable = Array.isArray(arr) ? arr.slice() : [];
    try {
      const likesQtyEl = document.getElementById('likesQty');
      const current = Number(likesQtyEl?.textContent || 150);
      const exists = likesTable.some(e => Number(e.q) === current);
      if (!exists && likesQtyEl && likesTable[0]) likesQtyEl.textContent = String(likesTable[0].q);
    } catch (_) {}
  }
  
  const viewsTable = [
    { q: 1000, price: '$ 20' }, { q: 2500, price: '$ 29' }, { q: 5000, price: '$ 44' },
    { q: 10000, price: '$ 60' }, { q: 25000, price: '$ 75' }, { q: 50000, price: '$ 105' },
    { q: 100000, price: '$ 151' }, { q: 150000, price: '$ 181' }, { q: 200000, price: '$ 212' },
    { q: 250000, price: '$ 272' }, { q: 500000, price: '$ 333' }, { q: 1000000, price: '$ 485' }
  ];

  function formatCurrencyBR(n) { return yaFmtPreco(n); }
  function parseCurrencyBR(s) { return yaParsePreco(s); }

  // Likes Logic
  function applyLikesPromoVariant() {
    const titleEl = document.querySelector('.promo-item.likes .promo-title');
    const descEl = document.querySelector('.promo-item.likes .promo-desc');
    if (!titleEl && !descEl) return;
    const tipo = String(window.selectedType || '').toLowerCase();
    if (tipo === 'organicos') {
      if (titleEl) titleEl.textContent = 'Me gusta reales en promoción';
      if (descEl) descEl.textContent = 'Agrega me gusta de perfiles reales y activos.';
    } else if (tipo === 'brasileiros') {
      if (titleEl) titleEl.textContent = 'Me gusta en promoción';
      if (descEl) descEl.textContent = 'Agrega me gusta a la publicación.';
    } else {
      if (titleEl) titleEl.textContent = 'Me gusta en promoción';
      if (descEl) descEl.textContent = 'Agrega me gusta a la publicación.';
    }
  }
  function updateLikesPrice(q) {
    const entry = likesTable.find(e => e.q === q);
    const likesPrices = document.querySelector('.promo-prices[data-promo="likes"]');
    const newEl = likesPrices ? likesPrices.querySelector('.new-price') : null;
    const oldEl = likesPrices ? likesPrices.querySelector('.old-price') : null;
    if (newEl && entry) newEl.textContent = entry.price;
    if (oldEl && entry) { const newVal = parseCurrencyBR(entry.price); const oldVal = Math.round(newVal * 1.70); oldEl.textContent = formatCurrencyBR(oldVal); }
    const hl = document.querySelector('.promo-item.likes .promo-highlight');
    if (hl) {
      const tipo = String(window.selectedType || '').toLowerCase();
      if (tipo === 'organicos') hl.textContent = `+ ${q} ME GUSTA REALES`;
      else if (tipo === 'brasileiros') hl.textContent = `+ ${q} ME GUSTA`;
      else hl.textContent = `+ ${q} ME GUSTA`;
    }
    try { applyLikesPromoVariant(); } catch(_) {}
  }

  window.stepLikes = function(dir) {
    const likesQtyEl = document.getElementById('likesQty');
    const current = Number(likesQtyEl?.textContent || 150);
    const idx = likesTable.findIndex(e => e.q === current);
    let nextIdx = idx >= 0 ? idx + dir : 0;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= likesTable.length) nextIdx = likesTable.length - 1;
    const next = likesTable[nextIdx].q;
    if (likesQtyEl) likesQtyEl.textContent = String(next);
    updateLikesPrice(next);
    try { updatePromosSummary(); } catch(_) {}
  };

  // Views Logic
  function updateViewsPrice(q) {
    const entry = viewsTable.find(e => e.q === q);
    const viewsPrices = document.querySelector('.promo-prices[data-promo="views"]');
    const newEl = viewsPrices ? viewsPrices.querySelector('.new-price') : null;
    const oldEl = viewsPrices ? viewsPrices.querySelector('.old-price') : null;
    if (newEl && entry) newEl.textContent = entry.price;
    if (oldEl && entry) { const newVal = parseCurrencyBR(entry.price); const oldVal = Math.round(newVal / 0.7); oldEl.textContent = formatCurrencyBR(oldVal); }
    const hl = document.querySelector('.promo-item.views .promo-highlight');
    if (hl) hl.textContent = `+ ${q} VISTAS`;
  }

  window.stepViews = function(dir) {
    const viewsQtyEl = document.getElementById('viewsQty');
    const current = Number(viewsQtyEl?.textContent || 1000);
    const idx = viewsTable.findIndex(e => e.q === current);
    let nextIdx = idx >= 0 ? idx + dir : 0;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= viewsTable.length) nextIdx = viewsTable.length - 1;
    const next = viewsTable[nextIdx].q;
    if (viewsQtyEl) viewsQtyEl.textContent = String(next);
    updateViewsPrice(next);
    try { updatePromosSummary(); } catch(_) {}
  };

  // Comments Logic
  function updateCommentsPrice(q) {
    const commentsPrices = document.querySelector('.promo-prices[data-promo="comments"]');
    const newEl = commentsPrices ? commentsPrices.querySelector('.new-price') : null;
    const oldEl = commentsPrices ? commentsPrices.querySelector('.old-price') : null;
    const format = (cents) => { const val = cents / 100; return yaFmtPreco(val); };
    const _pc = q >= 1 ? 2000 + 550 * (q - 1) : 0; // 1 = MXN 20, + MXN 5,50 cada um a mais (igual ao pricing.js)
    if (newEl) newEl.textContent = format(_pc);
    if (oldEl) { const oldCents = Math.round(_pc / 100 * 1.7) * 100; oldEl.textContent = format(oldCents); }
    const hl = document.querySelector('.promo-item.comments .promo-highlight');
    if (hl) hl.textContent = `+ ${q} COMENTARIOS`;
  }

  window.stepComments = function(dir) {
    const commentsQtyEl = document.getElementById('commentsQty');
    const current = Number(commentsQtyEl?.textContent || 1);
    let next = current + dir;
    if (next < 1) next = 1;
    if (next > 100) next = 100;
    if (commentsQtyEl) commentsQtyEl.textContent = String(next);
    updateCommentsPrice(next);
    try { updatePromosSummary(); } catch(_) {}
  };

  // Warranty Logic
  let warrantyMode = 'life';
  function applyWarrantyMode() {
    const isLife = true;
    const wLabel = document.getElementById('warrantyModeLabel');
    const wHighlight = document.getElementById('warrantyHighlight');
    const wOld = document.getElementById('warrantyOldPrice');
    const wNew = document.getElementById('warrantyNewPrice');
    const wDisc = document.getElementById('warrantyDiscount');

    if (wLabel) wLabel.textContent = '6 meses';
    if (wHighlight) wHighlight.textContent = 'REPOSICIÓN POR 6 MESES';
    
    // Custom Price for Followers (Mistos/Brasileiros)
    const isFollowers = window.currentService === 'followers';

    if (isFollowers && isLife) {
        if (wOld) wOld.textContent = '$ 180';
        if (wNew) wNew.textContent = '$ 35';
        if (wDisc) wDisc.textContent = '82% OFF';
    } else {
        if (wOld) wOld.textContent = isLife ? '$ 470' : '$ 144';
        if (wNew) wNew.textContent = isLife ? '$ 35' : '$ 35';
        if (wDisc) wDisc.textContent = isLife ? '85% OFF' : '75% OFF';
    }
    updatePromosSummary();
  }

  window.stepWarranty = function(delta) {
    const next = (warrantyMode === '30' && delta > 0) ? 'life' : (warrantyMode === 'life' && delta < 0) ? '30' : warrantyMode;
    if (next !== warrantyMode) { 
        warrantyMode = next; 
        try { window.warrantyMode = warrantyMode; } catch(_) {}
        applyWarrantyMode(); 
    }
  };

  // Ensure initial state
  try { window.warrantyMode = warrantyMode; } catch(_) {}
  applyWarrantyMode();



  // Helpers
  function parsePrecoToCents(precoStr) {
    if (!precoStr) return 0;
    const raw = String(precoStr).replace(/[^\d.,]/g, '');
    const cleaned = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    const value = Math.round(parseFloat(cleaned) * 100);
    return isNaN(value) ? 0 : value;
  }

  function formatCentsToBRL(cents) {
    const valor = Math.max(0, Number(cents) || 0);
    return yaFmtPreco(valor / 100);
  }

  // Telefone México: aceita com ou sem +52 (ou +52 1); retorna os dígitos nacionais
  function mxNationalDigits(v) {
    let d = String(v || '').replace(/\D+/g, '');
    if (d.length === 13 && d.indexOf('521') === 0) d = d.slice(3);
    else if (d.length > 10 && d.indexOf('52') === 0) d = d.slice(2);
    return d;
  }

  function maskMxPhone(v) {
    const s = mxNationalDigits(v).slice(0, 10);
    if (!s) return '';
    let out = s.slice(0, 2);
    if (s.length > 2) out += ' ' + s.slice(2, 6);
    if (s.length > 6) out += ' ' + s.slice(6, 10);
    return out;
  }

  // Máscara "55 1234 5678" no #contactPhoneInput (o #checkoutPhoneInput já é mascarado pelo checkout.js)
  (function setupMxPhoneMask() {
    try {
      const input = document.getElementById('contactPhoneInput');
      if (!input || input.__yaMxMask) return;
      input.__yaMxMask = true;
      input.placeholder = '55 1234 5678';
      input.addEventListener('input', () => {
        const raw = String(input.value || '');
        if (/^\s*\+/.test(raw) && raw.replace(/\D+/g, '').length <= 12) return;
        input.value = maskMxPhone(raw);
      });
      input.addEventListener('blur', () => { input.value = maskMxPhone(input.value); });
    } catch (_) {}
  })();

  // --- Função para rolar até a seção do serviço ---
  function smoothScrollToY(targetY, durationMs) {
    try {
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        window.scrollTo(0, targetY);
        return;
      }
      const startY = window.scrollY || window.pageYOffset || 0;
      const delta = targetY - startY;
      if (Math.abs(delta) < 2) {
        window.scrollTo(0, targetY);
        return;
      }
      const start = performance.now();
      function ease(t){ return t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }
      function step(now){
        const p = Math.min(1, (now - start) / durationMs);
        window.scrollTo(0, startY + (delta * ease(p)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    } catch(_) {
      window.scrollTo(0, targetY);
    }
  }

  window.scrollToService = function(service) {
      window.currentService = service;
      
      // Atualiza estado visual dos botões do topo
      document.querySelectorAll('.service-selector-btn').forEach(btn => {
          if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(service)) {
              btn.classList.add('active');
          } else {
              btn.classList.remove('active');
          }
        });

      // Mapeia serviço para ID da seção
      let targetId = '';
      if (service === 'followers') targetId = 'section-followers';
      else if (service === 'likes') targetId = 'section-likes';
      else if (service === 'views') targetId = 'section-views';
      
      const el = document.getElementById(targetId);
      if (el) {
          // Ajuste de scroll com offset para header
          const y = el.getBoundingClientRect().top + window.scrollY - 100;
          if (window.innerWidth && window.innerWidth <= 767) {
            smoothScrollToY(y, 1300);
          } else {
            window.scrollTo({top: y, behavior: 'smooth'});
          }
      }
  };

  // --- Função para selecionar serviço específico e rolar até ele ---
  window.selectDirectService = function(service, type) {
      // Mapeia (service, type) para o ID da seção correta
      let targetId = '';
      
      if (service === 'followers') {
          if (type === 'mistos') targetId = 'section-followers';
          else if (type === 'brasileiros') targetId = 'section-followers'; // seção removida do site MX
          else if (type === 'organicos') targetId = 'section-followers-org';
      } else if (service === 'likes') {
          if (type === 'mistos') targetId = 'section-likes';
          else if (type === 'curtidas_brasileiras') targetId = 'section-likes'; // seção removida do site MX
          else if (type === 'organicos') targetId = 'section-likes-org';
      } else if (service === 'views') {
          targetId = 'section-views';
      }
      
      const el = document.getElementById(targetId);
      if (el) {
          const y = el.getBoundingClientRect().top + window.scrollY - 100;
          if (window.innerWidth && window.innerWidth <= 767) {
            smoothScrollToY(y, 1300);
          } else {
            window.scrollTo({top: y, behavior: 'smooth'});
          }
      } else {
          // Fallback se a seção não existir (tenta o serviço genérico)
          window.scrollToService(service);
      }
  };

  // --- Renderização de Todos os Serviços ---
  window.availableUpgrades = {};

  function renderAllServices() {
    const container = document.getElementById('allServicesContainer');
    if (!container) return;
    
    container.innerHTML = '';
    window.availableUpgrades = {}; // Reset upgrades
    
    // Configuração de exibição (Ordem e Conteúdo)
    const servicesConfig = [
      { 
        id: 'section-followers',
        service: 'followers', 
        type: 'mistos', 
        title: 'Seguidores',
        desc: 'Seguidores de perfiles de México con reposición automática y alta retención. Ideales para crecer rápido.',
        tabela: tabelaSeguidores.mistos,
        badgeType: 'mistos'
      },
      { 
        id: 'section-followers-br',
        service: 'followers', 
        type: 'brasileiros', 
        title: 'Seguidores',
        desc: 'Seguidores con entrega rápida y estable.',
        tabela: tabelaSeguidores.brasileiros,
        badgeType: 'brasileiros'
      },
      { 
        id: 'section-followers-org',
        service: 'followers', 
        type: 'organicos', 
        title: 'Seguidores de alta calidad',
        desc: 'Seguidores latinos: perfiles de Latinoamérica, reales y activos, para máxima interacción y credibilidad.',
        tabela: tabelaSeguidores.organicos,
        badgeType: 'organicos'
      },
      { 
        id: 'section-likes',
        service: 'likes', 
        type: 'mistos', 
        title: 'Me gusta',
        desc: 'Me gusta rápidos para impulsar tus publicaciones.',
        tabela: tabelaCurtidas.mistos,
        badgeType: 'mistos'
      },
      { 
        id: 'section-likes-br',
        service: 'likes', 
        type: 'curtidas_brasileiras', 
        title: 'Me gusta',
        desc: 'Me gusta con entrega rápida para impulsar tus publicaciones.',
        tabela: tabelaCurtidas.curtidas_brasileiras,
        badgeType: 'brasileiros'
      },
      { 
        id: 'section-likes-org',
        service: 'likes', 
        type: 'organicos', 
        title: 'Me gusta reales',
        desc: 'Me gusta de perfiles reales y activos para máxima credibilidad en tus publicaciones.',
        tabela: tabelaCurtidas.organicos,
        badgeType: 'organicos'
      },
      { 
        id: 'section-views',
        service: 'views', 
        type: 'visualizacoes_reels', 
        title: 'Vistas de Reels',
        desc: 'Aumenta el alcance de tus videos y hazte viral en Reels.',
        tabela: tabelaVisualizacoes.visualizacoes_reels,
        badgeType: 'visualizacoes_reels'
      }
    ];

    // Site MX: tipos "brasileiros"/"curtidas_brasileiras" não são oferecidos ao cliente (chaves mantidas p/ pedidos antigos)
    const hiddenTypesMx = ['brasileiros', 'curtidas_brasileiras'];

    servicesConfig.filter(config => !hiddenTypesMx.includes(config.type)).forEach(config => {
      // Section Container
      const section = document.createElement('div');
      section.className = 'section-block section-with-bg';
      section.id = config.id; // ID para scroll
      
      // Header da Seção
      const header = document.createElement('div');
      header.className = 'section-header';
      header.style.textAlign = 'center';
      header.style.marginBottom = '1.5rem';
      header.innerHTML = `
        <h3 class="section-label" style="margin-bottom:0.5rem">${config.title}</h3>
        <p class="subtitle" style="font-size:0.95rem">${config.desc}</p>
      `;
      section.appendChild(header);
      
      // Grid de Cards
      const grid = document.createElement('div');
      grid.className = 'services-grid';
      
      config.tabela.forEach(plano => {
        try {
            const qNum = Number(plano.q);
            let badgeText = '';
            let isGold = false;

            // Unidade correta (minuciosa)
            let unit = 'seguidores';
            if (config.service === 'views' || config.type === 'visualizacoes_reels') unit = 'vistas';
            else if (config.service === 'likes') unit = 'me gusta';

            // --- Badge Logic (Fixed & Robust) ---
            const localQuantityBadges = {
                20: 'PAQUETE DE PRUEBA',
                50: 'PAQUETE DE PRUEBA',
                150: 'PAQUETE INICIAL',
                500: 'PAQUETE BÁSICO',
                1000: 'MÁS PEDIDO',
                3000: 'EXCLUSIVO',
                5000: 'VIP',
                10000: 'ELITE',
                25000: 'MEJOR PRECIO',
                100000: 'MÁS PEDIDO',
                500000: 'ELITE'
            };

            if (config.badgeType === 'mistos') {
                if (config.service === 'likes') {
                    if (qNum === 150) badgeText = 'PAQUETE INICIAL';
                    if (qNum === 500) badgeText = 'PAQUETE BÁSICO';
                    if (qNum === 1000) badgeText = 'MEJOR PRECIO';
                    if (qNum === 3000) { badgeText = 'MÁS PEDIDO'; isGold = true; }
                    if (qNum === 5000) badgeText = 'VIP';
                    if (qNum === 10000) badgeText = 'ELITE';
                } else {
                    if (qNum === 50) badgeText = 'PAQUETE DE PRUEBA';
                    if (qNum === 1000) badgeText = 'MEJOR PRECIO';
                    if (qNum === 3000) { badgeText = 'MÁS PEDIDO'; isGold = true; }
                }
            } else if (config.badgeType === 'brasileiros' || config.badgeType === 'organicos') {
                if (config.service === 'likes') {
                    if (qNum === 150) badgeText = 'PAQUETE INICIAL';
                    if (qNum === 500) badgeText = 'PAQUETE BÁSICO';
                    if (qNum === 1000) { badgeText = 'MÁS PEDIDO'; isGold = true; }
                    if (qNum === 3000) badgeText = 'EXCLUSIVO';
                    if (qNum === 5000) badgeText = 'VIP';
                    if (qNum === 10000) badgeText = 'ELITE';
                } else {
                    if (qNum === 1000) { badgeText = 'MÁS PEDIDO'; isGold = true; }
                }
            } else if (config.badgeType === 'visualizacoes_reels') {
                if (qNum === 1000) badgeText = 'PAQUETE INICIAL';
                if (qNum === 5000) badgeText = 'PAQUETE BÁSICO';
                if (qNum === 25000) badgeText = 'MEJOR PRECIO';
                if (qNum === 100000) { badgeText = 'MÁS PEDIDO'; isGold = true; }
                if (qNum === 200000) badgeText = 'VIP';
                if (qNum === 500000) badgeText = 'ELITE';
            }

            // Universal Badge Fallback (Safety net)
            if (!badgeText && localQuantityBadges[qNum]) {
                badgeText = localQuantityBadges[qNum];
            }

            // Initialize availableUpgrades if undefined
            if (!window.availableUpgrades) window.availableUpgrades = {};
            if (!window.availableUpgrades[config.service]) window.availableUpgrades[config.service] = {};
            if (!window.availableUpgrades[config.service][config.type]) window.availableUpgrades[config.service][config.type] = [];
            
            // ALWAYS Add to availableUpgrades (so we can upgrade to any plan, hidden or not)
            // We flag 'isBadged' to prefer these in upgrade logic
            window.availableUpgrades[config.service][config.type].push({ ...plano, unit, isBadged: !!badgeText });

            // Filter: Show only badged cards in main grid
            // If it has no badge, it is hidden from grid, but available for upgrade via availableUpgrades
            if (!badgeText) {
                return; // Skip rendering this card
            }

        const card = document.createElement('div');
        card.className = 'service-card plan-card'; 
        if (isGold) card.classList.add('gold-card');

        const badgeHtml = badgeText ? `<div class="plan-badge">${badgeText}</div>` : '';

        // --- Price Calculation Logic (Igual servicos-instagram) ---
        const baseText = String(plano.p);
        const baseStr = baseText.replace(/[^0-9,\.]/g, '');
        let base = 0;
        try { base = yaParsePreco(baseStr); } catch(_) {}
        const inc = base * 1.15;
        const ceilInt = Math.ceil(inc);
        const increasedRounded = (ceilInt) /* pesos inteiros */;
        const increasedText = yaFmtPreco(increasedRounded);

        const qtyFormatted = qNum.toLocaleString('es-MX');

        // HTML Structure matching servicos-instagram
        card.innerHTML = `${badgeHtml}<div class="card-content"><div class="card-title">${qtyFormatted} ${unit}</div><div class="card-desc"><span class="price-old">${increasedText}</span> <span class="price-new">${baseText}</span></div></div>`;
        
        card.onclick = () => {
          // Set Global State
          window.currentService = config.service;
          window.selectedType = config.type;
          window.selectedPlan = plano;
          try { localStorage.setItem('ya_selected_plan', JSON.stringify(plano)); } catch(e) {}
          try {
            refreshLikesTable();
            applyLikesPromoVariant();
            updateLikesPrice(Number(document.getElementById('likesQty')?.textContent || 150));
          } catch(_) {}
          
          console.log('DEBUG: Card Clicked', {
              service: config.service,
              type: config.type,
              plan: plano
          });

          // Parse Price to Cents for Checkout
          let priceStr = String(yaParsePreco(plano.p));
          // Remove invisible characters if any
          priceStr = priceStr.replace(/[^0-9.]/g, '');
          
          window.basePriceCents = Math.round(parseFloat(priceStr) * 100);
          
          // Fallback de segurança para pacote de teste
          if (config.service === 'followers' && plano.q == 50 && window.basePriceCents < 10) {
              console.warn('DEBUG: Ajustando preço do pacote de teste para 10 centavos');
              window.basePriceCents = 10;
          }

          console.log('DEBUG: Price Calculated', {
              original: plano.p,
              parsed: priceStr,
              cents: window.basePriceCents
          });

          // Visual Feedback (Active State)
          document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          
          // Update Upgrade Option
          updateUpgradeOption();

          // Update Summary and Advance
          updateSummary();
          
          // Update Payment Visibility immediately
          if (typeof window.updatePaymentMethodVisibility === 'function') {
              window.updatePaymentMethodVisibility();
          }
          
          window.goToStepEngajamento(2);
        };
        
        grid.appendChild(card);
      } catch (e) {
        console.error('Error rendering card:', e);
      }
      });
      
      section.appendChild(grid);
      container.appendChild(section);
    });
  }

  // --- Lógica de Posts (Curtidas/Views) ---
  
  function fetchPosts(username) {
      const grid = document.getElementById('postsGridModal');
      const container = document.getElementById('postsSelectionContainer');
      const loadMoreBtnContainer = document.getElementById('loadMorePostsContainerModal');
      
      if (!grid || !container) return;
      
      // Limpa estado anterior
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;"><div class="spinner"></div><p style="margin-top:0.5rem;color:var(--text-secondary)">Cargando publicaciones...</p></div>';
      container.style.display = 'block';
      
      const openBtn = document.getElementById('openPostsModalBtn');
    const previewInline = document.getElementById('selectedPostPreviewInline');
    const contactArea = document.getElementById('contactFieldsArea');

    if (openBtn) openBtn.style.display = 'flex';
    if (previewInline) previewInline.style.display = 'none';
    if (contactArea) contactArea.style.display = 'none';
    
    if (loadMoreBtnContainer) loadMoreBtnContainer.style.display = 'none';
      window.selectedPost = null;
      window.cachedPosts = [];
      window.visiblePostsCount = 9;

      const url = '/api/instagram/posts?username=' + encodeURIComponent(username);
      
      fetch(url)
          .then(r => r.json())
          .then(data => {
              if (data.posts && Array.isArray(data.posts) && data.posts.length > 0) {
                  window.cachedPosts = data.posts;
                  renderPosts();
                  
                  // Auto-open modal for better UX (similar to servicos-instagram)
                  const modal = document.getElementById('postsModal');
                  if (modal) modal.style.display = 'flex';
              } else {
                  grid.innerHTML = `
                    <div style="grid-column:1/-1;text-align:center;padding:1rem;">
                        <p style="color:var(--text-secondary);margin-bottom:1rem;">No encontramos publicaciones recientes o el perfil es privado.</p>
                        <div style="max-width:400px;margin:0 auto;">
                            <input type="text" id="manualLinkInput" placeholder="Pega aquí el enlace de la publicación (ej.: https://instagram.com/p/...)" class="form-input" style="margin-bottom:0.5rem;width:100%;">
                            <button id="manualLinkBtn" class="service-selector-btn" style="width:100%;">Usar enlace</button>
                            <p id="manualLinkMsg" style="font-size:0.85rem;margin-top:0.5rem;"></p>
                        </div>
                    </div>
                  `;
                  
                  // Setup manual link handler
                  setTimeout(() => {
                      const btn = document.getElementById('manualLinkBtn');
                      const inp = document.getElementById('manualLinkInput');
                      const msg = document.getElementById('manualLinkMsg');
                      
                      if (btn && inp) {
                          btn.onclick = function() {
                              const val = inp.value.trim();
                              if (!val.includes('instagram.com/')) {
                                  msg.textContent = 'Enlace inválido. Asegúrate de copiar el enlace completo de Instagram.';
                                  msg.style.color = '#ef4444';
                                  return;
                              }
                              
                              // Extract shortcode
                              let sc = '';
                              const m = val.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
                              if (m) sc = m[1];
                              
                              if (!sc) {
                                  msg.textContent = 'No pudimos identificar la publicación con ese enlace.';
                                  msg.style.color = '#ef4444';
                                  return;
                              }
                              
                              // Create manual post object
                              const manualPost = {
                                  shortcode: sc,
                                  displayUrl: '', // No preview for manual link yet
                                  isVideo: val.includes('/reel/')
                              };
                              
                              selectPost(manualPost);
                              msg.textContent = '¡Publicación elegida con éxito!';
                              msg.style.color = '#22c55e';
                          };
                      }
                  }, 100);
              }
          })
          .catch(err => {
              console.error(err);
              grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#ef4444;">Error al cargar las publicaciones. Inténtalo de nuevo o usa el enlace directo en el checkout.</div>';
          });
  }

  function renderPosts() {
      const grid = document.getElementById('postsGridModal');
      const loadMoreBtnContainer = document.getElementById('loadMorePostsContainerModal');
      if (!grid) return;
      
      grid.innerHTML = '';
      
      const postsToRender = window.cachedPosts.slice(0, window.visiblePostsCount);
      
      postsToRender.forEach(p => {
          const card = document.createElement('div');
          card.className = 'post-card';
          card.style.cursor = 'pointer';
          card.style.borderRadius = '8px';
          card.style.overflow = 'hidden';
          card.style.border = '2px solid transparent';
          card.style.position = 'relative';
          card.style.aspectRatio = '1/1';
          card.style.background = '#f0f0f0';
          
          if (window.selectedPost && window.selectedPost.shortcode === p.shortcode) {
              card.style.borderColor = '#22c55e';
              card.classList.add('selected');
          }
          
          let mediaHtml = '';
          if (p.displayUrl) {
               // Use image proxy if needed, or direct URL
               const imgUrl = '/image-proxy?url=' + encodeURIComponent(p.displayUrl);
               mediaHtml = `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy">`;
          } else {
               mediaHtml = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:0.8rem;">Sin vista previa</div>`;
          }
          
          // Video indicator
          if (p.isVideo || (p.media_type === 2)) {
              mediaHtml += `<div style="position:absolute;top:5px;right:5px;background:rgba(0,0,0,0.6);color:white;padding:2px 6px;border-radius:4px;font-size:10px;">VIDEO</div>`;
          }
          
          // Selection Overlay
          mediaHtml += `<div class="selection-overlay" style="position:absolute;inset:0;background:rgba(34,197,94,0.3);display:none;align-items:center;justify-content:center;"><span style="background:#22c55e;color:white;padding:4px 10px;border-radius:20px;font-weight:bold;font-size:0.8rem;">Elegida</span></div>`;

          card.innerHTML = mediaHtml;
          
          card.onclick = () => selectPost(p);
          
          grid.appendChild(card);
      });
      
      // Update Selection Styles
      updatePostSelectionStyles();

      // Handle Load More Button
      if (loadMoreBtnContainer) {
          if (window.cachedPosts.length > window.visiblePostsCount) {
              loadMoreBtnContainer.style.display = 'block';
              const btn = document.getElementById('loadMorePostsBtnModal');
              if (btn) {
                  btn.onclick = () => {
                      window.visiblePostsCount += 9;
                      renderPosts();
                  };
              }
          } else {
              loadMoreBtnContainer.style.display = 'none';
          }
      }
  }

  function selectPost(post) {
    window.selectedPost = post;
    updatePostSelectionStyles();
    
    // Update selected post preview
    const previewInline = document.getElementById('selectedPostPreviewInline');
    const contactArea = document.getElementById('contactFieldsArea');
    const modal = document.getElementById('postsModal');
    const openBtn = document.getElementById('openPostsModalBtn');
    
    const renderPreviewContent = (p) => {
         let mediaHtml = '';
         if (p.displayUrl) {
             const imgUrl = '/image-proxy?url=' + encodeURIComponent(p.displayUrl);
             mediaHtml = `<img src="${imgUrl}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;" loading="lazy">`;
         } else {
             mediaHtml = `<div style="width:60px;height:60px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:0.7rem;color:#888;">Sin vista previa</div>`;
         }
         
         return `
             <div style="display:flex; gap:1rem; align-items:center; background: var(--bg-card); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-color);">
                 ${mediaHtml}
                 <div>
                     <div style="font-size:0.85rem; color:var(--text-secondary);">Publicación elegida</div>
                     ${p.isVideo ? '<span style="font-size:0.75rem; background:rgba(0,0,0,0.1); padding:2px 6px; border-radius:4px;">Video/Reels</span>' : ''}
                 </div>
                 <button id="changePostBtn" type="button" style="margin-left:auto; font-size:0.8rem; color:var(--primary-purple); background:none; border:none; cursor:pointer; text-decoration:underline;">Cambiar</button>
             </div>
         `;
    };

    if (previewInline) {
        if (openBtn) openBtn.style.display = 'none';
        previewInline.style.display = 'block';
        previewInline.innerHTML = renderPreviewContent(post);
        
        const changeBtn = previewInline.querySelector('#changePostBtn');
        if(changeBtn) {
            changeBtn.onclick = (e) => {
                e.preventDefault();
                if(modal) modal.style.display = 'flex';
            };
        }
    }
    
    // Also update preview inside contact area if it exists
    const contactPreview = document.getElementById('selectedPostPreview');
    const contactPreviewContent = document.getElementById('selectedPostPreviewContent');
    if (contactPreview && contactPreviewContent) {
        contactPreview.style.display = 'block';
        contactPreviewContent.innerHTML = renderPreviewContent(post);
        // Hide the change button in this secondary preview to avoid confusion
        const changeBtn2 = contactPreviewContent.querySelector('#changePostBtn');
        if (changeBtn2) changeBtn2.style.display = 'none'; 
    }

    // Close Modal
    if (modal) modal.style.display = 'none';
    
    // Show contact fields
    if (contactArea) {
        contactArea.style.display = 'block';
        setTimeout(() => {
            contactArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

  function updatePostSelectionStyles() {
      const grid = document.getElementById('postsGridModal');
      if (!grid) return;
      
      Array.from(grid.children).forEach((card, index) => {
           const post = window.cachedPosts[index];
           const overlay = card.querySelector('.selection-overlay');
           if (post && window.selectedPost && post.shortcode === window.selectedPost.shortcode) {
               card.style.borderColor = '#22c55e';
               if(overlay) overlay.style.display = 'flex';
           } else {
               card.style.borderColor = 'transparent';
               if(overlay) overlay.style.display = 'none';
           }
      });
  }

  // Helper para atualização do resumo (step 2/3)
  function updateSummary() {
    const resTipo = document.getElementById('resTipo');
    const resQtd = document.getElementById('resQtd');
    const resPreco = document.getElementById('resPreco');
    
    if (resTipo) resTipo.textContent = getLabelForTipo(window.selectedType);
    if (resQtd && window.selectedPlan) resQtd.textContent = window.selectedPlan.q;
    if (resPreco && window.selectedPlan) resPreco.textContent = window.selectedPlan.p;
  }
  
  function getLabelForTipo(tipo) {
      if (window.currentService === 'likes') {
          const labels = {
              'mistos': 'Me gusta',
              'curtidas_brasileiras': 'Me gusta',
              'organicos': 'Me gusta reales'
          };
          return labels[tipo] || tipo;
      }

      const labels = {
      'mistos': 'Seguidores',
      'brasileiros': 'Seguidores',
      'organicos': 'Seguidores de alta calidad',
      'visualizacoes_reels': 'Vistas de Reels'
    };
    return labels[tipo] || tipo;
  }

  // Scroll Suave Botão Principal
  const btnComprar = document.getElementById('btnComprarSeguidoresAgora');
  if (btnComprar) {
      btnComprar.addEventListener('click', () => {
          window.scrollToService('followers');
      });
  }

  // --- Inicialização ---
  renderAllServices();
  
  // --- Lógica de Perfil ---
  
  const checkBtn = document.getElementById('checkCheckoutButton');
  if (checkBtn) {
      checkBtn.addEventListener('click', function() {
          const input = document.getElementById('usernameCheckoutInput');
          const username = input.value.trim().replace(/^@+/, '');
          
          if (!username) {
              alert('Por favor, escribe un usuario.');
              return;
          }
          
          // Show Loading
          document.getElementById('loadingCheckoutSpinner').style.display = 'block';
          document.getElementById('statusCheckoutMessage').style.display = 'none';
          document.getElementById('profilePreview').style.display = 'none';
          document.getElementById('postsSelectionContainer').style.display = 'none'; // Hide posts initially
          
          // Fetch Profile
          fetch('/api/instagram/info?username=' + encodeURIComponent(username))
              .then(r => {
                  if (!r.ok) {
                      throw new Error('Error en la solicitud: ' + r.status);
                  }
                  return r.json();
              })
              .then(data => {
                  document.getElementById('loadingCheckoutSpinner').style.display = 'none';
                  
                  if (!data.success) { // Verifica flag success do backend
                      throw new Error(data.error || 'Error desconocido');
                  }
                  
                  if (data.error || !data.username) {
              const msg = document.getElementById('statusCheckoutMessage');
              msg.textContent = 'Perfil no encontrado';
                      msg.className = 'status-message error';
                      msg.style.display = 'block';
                      
                      const helpLink = document.getElementById('howToGetLinkContainer');
                      if (helpLink) helpLink.style.display = 'block';
                      return;
                  }
                  
                  // Fill Profile Data
                  document.getElementById('checkoutProfileUsername').textContent = data.username.replace(/^@+/, '');
                  document.getElementById('checkoutProfileImage').src = data.profilePicUrl || '/img/default-avatar.png';
                  document.getElementById('checkoutFollowersCount').textContent = data.followers || '-';
                  document.getElementById('checkoutFollowingCount').textContent = data.following || '-';
                  document.getElementById('checkoutPostsCount').textContent = data.postsCount || '-';
                  
                  // Store posts globally for orderbumps
                  if (data.edge_owner_to_timeline_media && data.edge_owner_to_timeline_media.edges) {
                      window.latestPosts = data.edge_owner_to_timeline_media.edges;
                  } else {
                      window.latestPosts = [];
                      // Try to fetch posts silently if not available and needed for orderbumps
                      if (window.currentService === 'followers' && window.__PREFETCH_POSTS === true) { // 23/11: sem busca antecipada
                          // Silent fetch
                          fetch('/api/instagram/posts?username=' + encodeURIComponent(username))
                            .then(r => r.json())
                            .then(pData => {
                                if (pData.posts && Array.isArray(pData.posts)) {
                                    window.latestPosts = pData.posts;
                                }
                            }).catch(() => {});
                      }
                  }
                  
                  // Show Profile
                  document.getElementById('profilePreview').style.display = 'flex';
                  
                  // If Service is Likes or Views, Fetch Posts
                  if (window.currentService === 'likes' || window.currentService === 'views') {
                      if (data.isPrivate) {
                          alert('Este perfil es privado. Para me gusta o vistas, el perfil debe ser público.');
                      } else {
                          fetchPosts(data.username);
                      }
                  } else {
                      // For Followers, show contact fields immediately
                      document.getElementById('postsSelectionContainer').style.display = 'none';
                      const contactArea = document.getElementById('contactFieldsArea');
                      if (contactArea) {
                          contactArea.style.display = 'block';
                          setTimeout(() => {
                              contactArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }, 100);
                      }
                  }
              })
              .catch(err => {
                  document.getElementById('loadingCheckoutSpinner').style.display = 'none';
                  const msg = document.getElementById('statusCheckoutMessage');
                  let errorMsg = 'Perfil no encontrado';
                  if (err && err.message && err.message !== 'Failed to fetch' && err.message !== 'Perfil não localizado') {
                      // Se for erro técnico, mostra algo genérico ou o erro
                      if (err.message.indexOf('404') !== -1) errorMsg = 'Perfil no encontrado';
                      else errorMsg = err.message;
                  }
                  msg.textContent = errorMsg;
                  msg.className = 'status-message error';
                  msg.style.display = 'block';
                  
                  const helpLink = document.getElementById('howToGetLinkContainer');
                  if (helpLink) helpLink.style.display = 'block';
                  
                  console.error(err);
              });
      });
  }

  // Função Global para Step (Renomeada para evitar conflito com checkout.js)
  window.goToStepEngajamento = function(step, pushHistory = true) {
      console.log('goToStepEngajamento called with step:', step);

      // Attempt to recover state if missing (critical for Step 3 reload)
      if (step === 3 && !window.selectedPlan) {
          try {
              const savedPlan = localStorage.getItem('ya_selected_plan');
              if (savedPlan) {
                  window.selectedPlan = JSON.parse(savedPlan);
                  console.log('State recovered from localStorage');
              }
          } catch(e) { console.error('Error recovering state', e); }
      }
      
      const step1 = document.getElementById('step1Container');
      const step2 = document.getElementById('step2Container');
      const step3 = document.getElementById('step3Container');
      const header = document.querySelector('.header');
      const topBtns = document.getElementById('topServiceButtons');
      const ferramentaSection = document.getElementById('ferramentaExclusivaSection');
      const faqSection = document.getElementById('faqContainerSection');
      const stepperList = document.querySelectorAll('.stepper-container');

      // Esconde/Mostra containers
      if (step === 1) {
        if (step1) step1.style.setProperty('display', 'block', 'important');
        if (step2) step2.style.setProperty('display', 'none', 'important');
        if (step3) step3.style.setProperty('display', 'none', 'important');
        if (header) header.style.setProperty('display', 'block', 'important');
        if (topBtns) topBtns.style.setProperty('display', 'flex', 'important');
        if (ferramentaSection) {
          const tipo = String(window.selectedType || '').trim().toLowerCase();
          const service = String(window.currentService || '').trim().toLowerCase();
          const isFollowersService = service.includes('seguidor') || service.includes('followers') || service === 'instagram';
          const showTool = isFollowersService && tipo === 'mistos';
          ferramentaSection.style.setProperty('display', showTool ? 'block' : 'none', 'important');
        }
        if (faqSection) faqSection.style.setProperty('display', 'block', 'important');
        
        // Force hide stepper on Step 1 (Aggressive)
        stepperList.forEach(s => {
            s.style.setProperty('display', 'none', 'important');
            s.classList.add('hidden');
            s.style.display = 'none'; // Double check
        });
          
          // Restore scroll position to selected service
          setTimeout(() => {
              if (window.selectDirectService && window.currentService) {
                  window.selectDirectService(window.currentService, window.selectedType);
              } else if (window.scrollToService && window.currentService) {
                  window.scrollToService(window.currentService);
              } else {
                  window.scrollTo({top: 0, behavior: 'smooth'});
              }
          }, 100);
      } else if (step === 2) {
          // Force hide everything from Step 1
          if (step1) step1.style.setProperty('display', 'none', 'important');
          if (header) header.style.setProperty('display', 'none', 'important');
          if (topBtns) topBtns.style.setProperty('display', 'none', 'important');
          if (ferramentaSection) ferramentaSection.style.setProperty('display', 'none', 'important');
          if (faqSection) faqSection.style.setProperty('display', 'none', 'important');
          
          // Show Step 2
          if (step2) step2.style.setProperty('display', 'block', 'important');
          if (step3) step3.style.setProperty('display', 'none', 'important');
          
          stepperList.forEach(s => {
              s.style.setProperty('display', 'flex', 'important');
              s.classList.remove('hidden');
          });
          
          // Force scroll to top
          window.scrollTo(0, 0);
      } else if (step === 3) {
                // Validação crítica de estado
                if (!window.selectedPlan) {
                    console.warn('Selected Plan lost. Redirecting to Step 1.');
                    alert('Tu sesión expiró. Por favor, elige el paquete de nuevo.');
                    window.goToStepEngajamento(1);
                    return;
                }

                // Validação antes de ir para Step 3
                const profileVisible = document.getElementById('profilePreview').style.display !== 'none';
          if (!profileVisible) {
              // No reload ou navegação direta, se o perfil não estiver validado, volta para o passo 2
              window.goToStepEngajamento(2);
              return;
          }
          
          if ((window.currentService === 'likes' || window.currentService === 'views' || window.currentService === 'salvar_posts') && !window.selectedPost) {
              alert('Por favor, elige una publicación para recibir ' + (window.currentService === 'views' ? 'las vistas' : (window.currentService === 'salvar_posts' ? 'los guardados' : 'los me gusta')) + '.');
              // Mantém no passo 2 (onde a seleção ocorre) se já estiver lá, mas aqui estamos tentando ir pro 3.
              // Como o usuário precisa selecionar, vamos garantir que ele veja a seleção.
              // O alert é útil aqui para explicar POR QUE ele não avançou, mas no reload pode ser chato.
              // Mas posts são selecionados APÓS validar perfil. Se profileVisible é true, ele está no step 2 vendo o perfil.
              // Então o alert aqui faz sentido se ele clicar em "Ir para Pagamento" sem selecionar.
              // Mas no reload, se profileVisible for true (improvável no reload sem persistência), cairia aqui.
              // Como profileVisible é false no reload, ele cai no if anterior.
              return;
          }

          if (step1) step1.style.setProperty('display', 'none', 'important');
          if (step2) step2.style.setProperty('display', 'none', 'important');
          if (step3) step3.style.setProperty('display', 'block', 'important');
          
          // Show Order Bumps Container
          const orderBumpInline = document.getElementById('orderBumpInline');
          if (orderBumpInline) orderBumpInline.style.display = 'block';

          if (header) header.style.setProperty('display', 'none', 'important');
          if (topBtns) topBtns.style.setProperty('display', 'none', 'important');
          if (ferramentaSection) ferramentaSection.style.setProperty('display', 'none', 'important');
          if (faqSection) faqSection.style.setProperty('display', 'none', 'important');
          
          stepperList.forEach(s => {
              s.style.setProperty('display', 'flex', 'important');
              s.classList.remove('hidden');
          });

          window.scrollTo(0, 0);
          
          // Renderiza Resumo Final no Step 3
          console.log('Rendering Final Summary for Step 3...');
          renderFinalSummary();
          
          // Force display of summary elements again to be sure
          const res = document.getElementById('resumo');
          if (res) res.style.display = 'block';
          const gp = document.getElementById('grupoPedido');
          if (gp) gp.style.display = 'block';
      }

      // Update Stepper UI
      if (stepperList.length > 0) {
          for (let i = 1; i <= 3; i++) {
            const s = document.getElementById('step' + i);
            if (s) {
                if (i <= step) s.classList.add('active');
                else s.classList.remove('active');
            }
            
            if (i < 3) {
                const line = document.getElementById('line' + i);
                if (line) {
                        if (step > i) line.classList.add('active');
                        else line.classList.remove('active');
                }
            }
          }
      }

      window.currentStep = step;
      
      // History Management
      if (pushHistory) {
          let url = new URL(window.location);
          if (step > 1) {
              url.searchParams.set('step', step);
              history.pushState({step: step}, '', url);
          } else {
              url.searchParams.delete('step');
              history.pushState({step: 1}, '', url);
          }
      }
  };
  
  // --- Upgrade Logic ---
  window.currentUpgradePlan = null;

  function updateOrderBumpsVisibility() {
      const warrantyCard = document.querySelector('.promo-item.warranty60');
      if (!warrantyCard) return;
  
      const isFollowers = window.currentService === 'followers';
      // 'mistos' = Mundiais, 'organicos' = Brasileiros Reais, 'brasileiros' = Brasileiros
    const isEligibleType = window.selectedType === 'mistos' || window.selectedType === 'organicos' || window.selectedType === 'brasileiros' || window.selectedType === 'curtidas_brasileiras';
  
      if (isFollowers && isEligibleType) {
          warrantyCard.style.display = 'flex';
      } else {
          warrantyCard.style.display = 'none';
          // Uncheck if hidden to avoid charging for it
          const checkbox = document.getElementById('promoWarranty60');
          if (checkbox && checkbox.checked) {
              checkbox.checked = false;
              if (typeof updatePromosSummary === 'function') updatePromosSummary();
          }
      }
  }

  function updateUpgradeOption() {
      const upgradeLabel = document.querySelector('.promo-item.upgrade');
      const checkbox = document.getElementById('orderBumpCheckboxInline');
      
      if (!window.selectedPlan || !window.availableUpgrades[window.currentService] || !window.availableUpgrades[window.currentService][window.selectedType]) {
          if (upgradeLabel) upgradeLabel.style.display = 'none';
          window.currentUpgradePlan = null;
          if (checkbox) checkbox.checked = false;
          return;
      }

      const currentQ = Number(window.selectedPlan.q);
      const candidates = window.availableUpgrades[window.currentService][window.selectedType];
      
      // Find the next largest plan
      // Sort candidates by q just in case
      candidates.sort((a, b) => Number(a.q) - Number(b.q));
      
      // Prefer upgrading to a badged plan (significant milestone)
      let upgrade = candidates.find(p => Number(p.q) > currentQ && p.isBadged);
      
      // Fallback: If no badged upgrade found (e.g. top of range), take any larger plan
      if (!upgrade) {
          upgrade = candidates.find(p => Number(p.q) > currentQ);
      }
      
      if (!upgrade) {
          if (upgradeLabel) upgradeLabel.style.display = 'none';
          window.currentUpgradePlan = null;
          if (checkbox) checkbox.checked = false;
          return;
      }

      window.currentUpgradePlan = upgrade;
      if (upgradeLabel) upgradeLabel.style.display = 'flex';
      
      // Calculate price difference
      const currentPriceCents = parsePrecoToCents(window.selectedPlan.p);
      const upgradePriceCents = parsePrecoToCents(upgrade.p);
      const diffCents = upgradePriceCents - currentPriceCents;
      
      // Update UI
      const highlight = document.getElementById('orderBumpHighlight');
      const title = upgradeLabel.querySelector('.promo-title');
      const desc = document.getElementById('orderBumpText');
      const newPriceEl = upgradeLabel.querySelector('.new-price');
      const oldPriceEl = upgradeLabel.querySelector('.old-price');
      
      const unit = upgrade.unit || 'seguidores';
      
      if (highlight) highlight.textContent = `LLÉVATE ${Number(upgrade.q).toLocaleString('es-MX')} ${unit.toUpperCase()}`;
      if (title) title.textContent = 'Mejora de paquete';
      if (desc) desc.textContent = `Cambia tu paquete de ${Number(currentQ).toLocaleString('es-MX')} por ${Number(upgrade.q).toLocaleString('es-MX')} ${unit}.`;
      
      if (newPriceEl) newPriceEl.textContent = formatCentsToBRL(diffCents);
      if (oldPriceEl) oldPriceEl.textContent = formatCentsToBRL(diffCents * 1.5); // Fake old price
      
      // Reset checkbox if we changed plans (optional, but good UX to prevent accidental upgrades)
      // Actually, if they had it checked, we should probably uncheck it because the price changed.
      // But let's check if the previously selected upgrade is still valid? No, easier to reset.
      // However, if the user is just browsing, maybe keep it unchecked.
      // Let's reset it for now.
      if (checkbox) checkbox.checked = false;
  }

  // Handle Browser Back Button
  window.addEventListener('popstate', function(event) {
      if (event.state && event.state.step) {
          window.goToStepEngajamento(event.state.step, false);
      } else {
          // Default to step 1 if no state
          window.goToStepEngajamento(1, false);
      }
  });
  
  // Alias para compatibilidade se necessário, mas preferimos usar o nome específico
  // window.goToStep = window.goToStepEngajamento; 
  
  function renderFinalSummary() {
    console.log('DEBUG: renderFinalSummary called');
    console.log('DEBUG: window.selectedPlan:', window.selectedPlan);
    
    // Safety check for selectedPlan
    if (!window.selectedPlan) {
        console.error('DEBUG: window.selectedPlan is missing in renderFinalSummary!');
        // Tentar recuperar do localStorage se possível ou alertar
        const savedPlan = localStorage.getItem('ya_selected_plan');
        if (savedPlan) {
            try {
                window.selectedPlan = JSON.parse(savedPlan);
                console.log('DEBUG: Recovered plan from localStorage');
            } catch(e) { console.error(e); }
        }
    }

    // Set warranty mode to life by default for this page
    window.warrantyMode = 'life';

    // Ensure visibility of summary card
    const resumoCard = document.getElementById('resumo');
    if (resumoCard) {
        console.log('DEBUG: Showing resumoCard');
        resumoCard.style.display = 'block';
        resumoCard.style.setProperty('display', 'block', 'important');
        resumoCard.classList.remove('hidden'); // Ensure no hidden class
        resumoCard.classList.remove('d-none');
    } else {
        console.warn('DEBUG: resumoCard NOT FOUND');
    }

    const grupoPedido = document.getElementById('grupoPedido');
    if (grupoPedido) {
        console.log('DEBUG: Showing grupoPedido');
        grupoPedido.style.display = 'block';
        grupoPedido.style.setProperty('display', 'block', 'important');
        grupoPedido.classList.remove('hidden');
        grupoPedido.classList.remove('d-none');
    } else {
        console.warn('DEBUG: grupoPedido NOT FOUND');
    }

    // Update Order Bumps Visibility based on service type
    updateOrderBumpsVisibility();

    // Ensure basic summary fields are populated
    updateSummary();

    // Preenche os dados do resumo no step 3
      const reviewProfileUsername = document.getElementById('reviewProfileUsername');
      const reviewProfileImage = document.getElementById('reviewProfileImage');
      const step3PostPreview = document.getElementById('step3PostPreview');
      const step3PostPreviewContent = document.getElementById('step3PostPreviewContent');
      
      // Update Profile Info
      if (reviewProfileUsername) {
          const usernameInput = document.getElementById('usernameCheckoutInput');
          reviewProfileUsername.textContent = usernameInput ? usernameInput.value.replace(/^@+/, '') : '';
      }
      
      if (reviewProfileImage) {
           const img = document.getElementById('checkoutProfileImage');
           if (img) reviewProfileImage.src = img.src;
      }
      
      // Update Post Preview
      if (step3PostPreview && step3PostPreviewContent) {
          if (window.selectedPost && (window.currentService === 'likes' || window.currentService === 'views' || window.currentService === 'salvar_posts')) {
               step3PostPreview.style.display = 'block';
               
               let mediaHtml = '';
               if (window.selectedPost.displayUrl) {
                   // Use image proxy if needed
                   const imgUrl = '/image-proxy?url=' + encodeURIComponent(window.selectedPost.displayUrl);
                   mediaHtml = `<img src="${imgUrl}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;" loading="lazy">`;
               } else {
                   mediaHtml = `<div style="width:80px;height:80px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:0.7rem;color:#888;">Sin vista previa</div>`;
               }
               
               step3PostPreviewContent.innerHTML = `
                   <div style="display:flex; gap:1rem; align-items:center;">
                       ${mediaHtml}
                       <div>
                           <div style="font-size:0.9rem; color:var(--text-secondary);">Publicación elegida</div>
                           ${window.selectedPost.isVideo ? '<span style="font-size:0.75rem; background:rgba(0,0,0,0.1); padding:2px 6px; border-radius:4px;">Video/Reels</span>' : ''}
                       </div>
                   </div>
               `;
          } else {
               step3PostPreview.style.display = 'none';
               step3PostPreviewContent.innerHTML = '';
          }
      }
      
      // Trigger update of order summary
      if (typeof updatePromosSummary === 'function') {
          updatePromosSummary();
      }
  }

  // Backup Theme Listener
  document.addEventListener('click', function(e) {
      const btn = e.target.closest('#themeToggleBtn');
      if (btn) {
          // console.log('Theme button clicked (delegate)');
          const isLight = document.body.classList.contains('theme-light');
          const next = isLight ? 'dark' : 'light';
          
          document.body.classList.remove('theme-light', 'theme-dark');
          document.body.classList.add('theme-' + next);
          
          localStorage.setItem('ya_theme', next);
          btn.setAttribute('aria-pressed', String(next === 'light'));
          
          // Update Icon/Label if exists
          const icon = btn.querySelector('i');
          if (icon) {
              icon.className = next === 'light' ? 'fas fa-sun' : 'fas fa-moon';
          }
          const label = btn.querySelector('.theme-label');
          if (label) label.textContent = next === 'light' ? 'Tema: Claro' : 'Tema: Oscuro';
      }
  });
  try {
    refreshLikesTable();
    updateLikesPrice(Number(document.getElementById('likesQty')?.textContent || 150));
  } catch (_) {}
  const promoCheckboxes = ['promoLikes', 'promoViews', 'promoComments', 'promoWarranty60', 'orderBumpCheckboxInline'];
  promoCheckboxes.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
          el.addEventListener('change', () => {
              if (typeof updatePromosSummary === 'function') updatePromosSummary();
          });
      }
  });

  // --- Promo & Summary Logic ---

  function getSelectedPromos() {
    const promos = [];
    
    // Checkboxes
    const promoLikes = document.getElementById('promoLikes');
    const promoViews = document.getElementById('promoViews');
    const promoComments = document.getElementById('promoComments');
    const promoWarranty = document.getElementById('promoWarranty60');
    const promoUpgrade = document.getElementById('orderBumpCheckboxInline');
    
    // Upgrade Promo
    if (promoUpgrade && promoUpgrade.checked && window.currentUpgradePlan) {
       const currentPriceCents = window.basePriceCents || 0;
       const upgradePriceCents = parsePrecoToCents(window.currentUpgradePlan.p);
       const diffCents = upgradePriceCents - currentPriceCents;
       
       promos.push({ 
           key: 'upgrade', 
           qty: Number(window.currentUpgradePlan.q), 
           label: `Mejora a ${Number(window.currentUpgradePlan.q).toLocaleString('es-MX')}`,
           priceCents: diffCents,
           fullPlan: window.currentUpgradePlan
       });
    }

    if (promoLikes && promoLikes.checked) {
       const qty = Number(document.getElementById('likesQty')?.textContent || 150);
       let priceStr = document.querySelector('.promo-prices[data-promo="likes"] .new-price')?.textContent || '';
       if (!priceStr && window.promoPricing && window.promoPricing.likes) priceStr = window.promoPricing.likes.price;
       const tipo = String((document.getElementById('tipoSelect') && document.getElementById('tipoSelect').value) || '').toLowerCase();
       const label = (function(t){
         if (t === 'organicos') return `Me gusta reales (${qty})`;
         if (t === 'brasileiros' || t === 'curtidas_brasileiras') return `Me gusta (${qty})`;
         if (t === 'mistos') return `Me gusta (${qty})`;
         return `Me gusta (${qty})`;
       })(tipo);
       promos.push({ key: 'likes', qty: qty, label, priceCents: parsePrecoToCents(priceStr) });
    }
    if (promoViews && promoViews.checked) {
       const qty = Number(document.getElementById('viewsQty')?.textContent || 1000);
       let priceStr = document.querySelector('.promo-prices[data-promo="views"] .new-price')?.textContent || '';
       if (!priceStr && window.promoPricing && window.promoPricing.views) priceStr = window.promoPricing.views.price;
       promos.push({ key: 'views', qty: qty, label: `Vistas de Reels (${qty})`, priceCents: parsePrecoToCents(priceStr) });
    }
    if (promoComments && promoComments.checked) {
       const qty = Number(document.getElementById('commentsQty')?.textContent || 1);
       // Price is dynamic: 150 cents per comment
       const priceCents = qty >= 1 ? 2000 + 550 * (qty - 1) : 0; // 1 = MXN 20, + MXN 5,50 cada um a mais (igual ao pricing.js)
       promos.push({ key: 'comments', qty: qty, label: `Comentarios (${qty})`, priceCents: priceCents });
    }
    if (promoWarranty && promoWarranty.checked) {
       promos.push({ 
           key: 'warranty_6m', 
           qty: 1, 
           label: 'Reposición por 6 meses',
           priceCents: 3500 // MXN 35 (igual ao pricing.js)
       });
    }
    
    return promos;
  }

  function calcPromosTotalCents(promos) {
    return promos.reduce((acc, p) => acc + (p.priceCents || 0), 0);
  }

  function updatePromosSummary() {
    const resPromosContainer = document.getElementById('resPromosContainer');
    const resPromos = document.getElementById('resPromos');
    const resTotalFinal = document.getElementById('resTotalFinal');
    
    // Base Price
    let baseCents = window.basePriceCents || 0;
    
    // Calculate Original Base Price (for discount display)
    const baseVal = baseCents / 100;
    const inc = baseVal * 1.15;
    const ceilInt = Math.ceil(inc);
    const increasedRounded = (ceilInt) /* pesos inteiros */;
    let baseOriginalCents = Math.round(increasedRounded * 100);

    // Promos
    const promos = getSelectedPromos();
    
    // Render Promos List
    if (resPromos && resPromosContainer) {
        if (promos.length > 0) {
            resPromosContainer.style.display = 'block';
            let html = '<div style="font-weight:600; margin-bottom:-4px; padding-bottom:0; color:var(--text-primary); line-height:1.2; margin-top:0.5rem;">Extras:</div>';
            
            html += promos.map((p, index) => {
                // Calculate original price for this promo to add to baseOriginalCents
                let oldPriceCents = 0;
                if (p.key === 'comments') {
                    oldPriceCents = Math.round(p.priceCents * 1.7 / 100) * 100;
                } else if (p.key === 'likes' || p.key === 'views') {
                    // Try to find the old price from the table or DOM
                    const type = p.key; // 'likes' or 'views'
                    const priceBlock = document.querySelector(`.promo-prices[data-promo="${type}"]`);
                    const oldEl = priceBlock ? priceBlock.querySelector('.old-price') : null;
                    if (oldEl) {
                        oldPriceCents = parsePrecoToCents(oldEl.textContent);
                    } else {
                        // Fallback estimate if not found
                        oldPriceCents = Math.round(p.priceCents * 1.7 / 100) * 100; 
                    }
                } else if (p.key === 'warranty30') {
                    oldPriceCents = 14400; // MXN
                } else if (p.key === 'warranty_lifetime') {
                    oldPriceCents = 47000; // MXN
                } else if (p.key === 'warranty60') {
                    oldPriceCents = 14400; // MXN
                } else if (p.key === 'warranty_6m') {
                    oldPriceCents = 47000; // MXN
                } else if (p.key === 'upgrade') {
                    oldPriceCents = Math.round(p.priceCents * 1.5 / 100) * 100;
                }
                
                baseOriginalCents += oldPriceCents;

                const marginTop = index === 0 ? '0' : '0.1rem';
                return `
                <div class="resumo-row" style="margin-top:${marginTop}; margin-bottom:0.1rem; line-height:1.4; display: flex; justify-content: space-between; align-items: center;">
                    <span>• ${p.label}</span>
                    <span>${formatCentsToBRL(p.priceCents)}</span>
                </div>`;
            }).join('');
            
            resPromos.innerHTML = html;
        } else {
            resPromosContainer.style.display = 'none';
            resPromos.innerHTML = '';
        }
    }
    
    // Calculate Total
    const promosTotal = calcPromosTotalCents(promos);
    let totalCents = baseCents + promosTotal;
    
    // Apply Coupon (Display)
    if (window.couponDiscount && window.couponDiscount > 0) {
        const discountVal = Math.round(totalCents * window.couponDiscount);
        totalCents -= discountVal;
    }
    
    // Update Total Display
    if (resTotalFinal) {
        const totalOriginal = baseOriginalCents;
        let discountPct = 0;
        if (totalOriginal > totalCents) {
            discountPct = Math.round(((totalOriginal - totalCents) / totalOriginal) * 100);
        }

        const totalOriginalBrl = formatCentsToBRL(totalOriginal);
        const totalCurrentBrl = formatCentsToBRL(totalCents);
        const isMobile = window.innerWidth <= 640;

        if (isMobile) {
            resTotalFinal.innerHTML = `
                <div class="promo-prices" style="flex-direction: column; align-items: flex-start; gap: 0;">
                    <div style="display:flex; gap: 0.5rem; align-items: center;">
                        <span class="old-price" style="text-decoration: line-through; color: #9ca3af;">${totalOriginalBrl}</span>
                        <span class="discount-badge">${discountPct}% OFF</span>
                    </div>
                    <span class="new-price">${totalCurrentBrl}</span>
                </div>
            `;
        } else {
            resTotalFinal.innerHTML = `
                <div class="promo-prices" style="justify-content: flex-end; display: flex; align-items: center; gap: 0.5rem;">
                    <span class="old-price">${totalOriginalBrl}</span>
                    <span class="discount-badge">${discountPct}% OFF</span>
                    <span class="new-price">${totalCurrentBrl}</span>
                </div>
            `;
        }
    }
    
    // Show Payment Button Area
    const resumo = document.getElementById('resumo');
    if (resumo) {
        resumo.style.display = 'block';
        resumo.style.setProperty('display', 'block', 'important');
    }

    const grupoPedido = document.getElementById('grupoPedido');
    if (grupoPedido) {
        grupoPedido.style.display = 'block';
        grupoPedido.style.setProperty('display', 'block', 'important');
    }
  }

  // --- Payment Logic (PIX) ---

  function markPaymentConfirmed() {
    const pixResultado = document.getElementById('pixResultado');
    try {
      if (pixResultado) {
        pixResultado.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;color:#22C55E;font-weight:700;font-size:1rem;"><span class="price-new">Pago confirmado</span></div>';
      }
    } catch(_) {}
    try { showStatusMessageCheckout('Pago confirmado. Te mostramos el resumen abajo.', 'success'); } catch(_) {}
    try { if (typeof showResumoIfAllowed === 'function') showResumoIfAllowed(); } catch(_) {}
  }

  async function navigateToPedidoOrFallback(identifier, correlationID, chargeId) {
    try {
      try { await fetch('/session/mark-paid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, correlationID }) }); } catch(_) {}
      const apiUrl = `/api/order?identifier=${encodeURIComponent(identifier)}&correlationID=${encodeURIComponent(correlationID)}&id=${encodeURIComponent(chargeId||'')}`;
      const extractProviderOid = function(orderObj){
        if (!orderObj || typeof orderObj !== 'object') return '';
        var o = orderObj;
        try {
          if (o && o.fama24h_multi && Array.isArray(o.fama24h_multi.orders) && o.fama24h_multi.orders.length) {
            for (var i=0;i<o.fama24h_multi.orders.length;i++){
              var it = o.fama24h_multi.orders[i];
              if (!it) continue;
              var v = (it.orderId !== undefined && it.orderId !== null) ? it.orderId : ((it.id !== undefined && it.id !== null) ? it.id : null);
              var s = (v === null || v === undefined) ? '' : String(v).trim();
              if (s) return s;
            }
          }
        } catch(_) {}
        var oidF = (o && o.fama24h && o.fama24h.orderId) ? String(o.fama24h.orderId) : '';
        var oidFS = (o && o.fornecedor_social && o.fornecedor_social.orderId) ? String(o.fornecedor_social.orderId) : '';
        return oidF || oidFS || '';
      };
      let data = null;
      try {
        const resp = await fetch(apiUrl);
        data = await resp.json();
      } catch(_) {}
      let providerOid = data && data.order ? extractProviderOid(data.order) : '';
      if (!providerOid) {
        showStatusMessageCheckout('¡Pago recibido! Procesando tu pedido...', 'success');
        try {
          await new Promise(function(resolve){ setTimeout(resolve, 350); });
          const respLoop = await fetch(apiUrl);
          const dataLoop = await respLoop.json();
          if (dataLoop && dataLoop.order) providerOid = extractProviderOid(dataLoop.order);
        } catch(_) {}
      }
      if (providerOid) {
        try { localStorage.setItem('ya_selected_oid', String(providerOid)); } catch(_) {}
      }
      const finalOid = providerOid || (chargeId ? String(chargeId) : '');
      window.location.href = `/pedido?t=${encodeURIComponent(identifier)}&ref=${encodeURIComponent(correlationID||'')}&oid=${encodeURIComponent(finalOid||'')}`;
    } catch(_) {
        showStatusMessageCheckout('¡Pago confirmado! Revisa tu correo electrónico.', 'success');
    }
  }

  async function criarPixWoovi() {
    console.log('DEBUG: criarPixWoovi called');
    console.log('DEBUG: window.selectedPlan:', window.selectedPlan);
    console.log('DEBUG: window.basePriceCents:', window.basePriceCents);
    console.log('DEBUG: window.currentService:', window.currentService);
    console.log('DEBUG: window.selectedType:', window.selectedType);

    const btnPedido = document.getElementById('realizarPedidoBtn');
    if (btnPedido) {
        btnPedido.disabled = true;
        btnPedido.classList.add('loading');
    }
    
    // Ocultar elementos estáticos do PIX se existirem, para usar o render dinâmico
    const staticPixElements = ['pixQrcode', 'pixLoader', 'pixCopiaCola', 'copyPixBtn'];
    staticPixElements.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentElement) el.parentElement.style.display = 'none'; 
    });
    
    // Garantir que pixResultado esteja visível e limpo
    const pixResultado = document.getElementById('pixResultado');
    if (pixResultado) {
        pixResultado.innerHTML = '';
        pixResultado.style.display = 'block';
        const pixContainer = document.getElementById('pixContainer');
        if (pixContainer) {
            pixContainer.style.display = 'block';
            Array.from(pixContainer.children).forEach(c => {
                if (c.id === 'pixResultado' || c.tagName === 'H4' || c.tagName === 'P') c.style.display = 'block';
                else if (staticPixElements.includes(c.id) || c.querySelector('#pixQrcode')) c.style.display = 'none';
            });
        }
    }

    try {
      const tipo = window.selectedType || 'mistos';
      const service = window.currentService || 'followers';
      let qtd = window.selectedPlan ? Number(window.selectedPlan.q) : 0;
      let precoStr = window.selectedPlan ? window.selectedPlan.p : '';
      
      const promos = getSelectedPromos();
      
      // Check for upgrade and apply override
      const upgradePromo = promos.find(p => p.key === 'upgrade');
      if (upgradePromo && upgradePromo.fullPlan) {
          qtd = Number(upgradePromo.fullPlan.q);
          precoStr = upgradePromo.fullPlan.p;
      }

      const promosTotalCents = calcPromosTotalCents(promos);
      let totalCents = (window.basePriceCents || 0) + promosTotalCents;
      
      if (window.couponDiscount && window.couponDiscount > 0) {
           const discountVal = Math.round(totalCents * window.couponDiscount);
           totalCents -= discountVal;
      }
      
      // Quantidade efetiva
      const qtdEffective = qtd; 

      const correlationID = 'Engajamento_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      // Phone (México): 10 dígitos nacionais; enviado ao backend como "52" + 10 dígitos
      const phoneInput = document.getElementById('contactPhoneInput') || document.getElementById('checkoutPhoneInput');
      const phoneNational = mxNationalDigits(phoneInput ? phoneInput.value : '');
      if (phoneInput && phoneNational.length !== 10) {
        try { phoneInput.classList.add('input-error'); phoneInput.focus(); } catch (_) {}
        throw new Error('Ingresa un número de teléfono válido de 10 dígitos (ej. 55 1234 5678).');
      }
      const phoneValue = phoneNational.length === 10 ? ('52' + phoneNational) : '';

      const emailInput = document.getElementById('contactEmailInput');
      const emailValue = emailInput ? emailInput.value.trim() : '';
      
      // Username
      const usernameInput = document.getElementById('usernameCheckoutInput');
      const instagramUsernameFinal = usernameInput ? usernameInput.value.replace('@', '').trim() : '';

      if (!instagramUsernameFinal) {
        throw new Error('No identificamos el usuario de Instagram.');
      }

      const serviceCategory = (service === 'views') ? 'visualizacoes' : ((service === 'likes') ? 'curtidas' : ((service === 'salvar_posts') ? 'salvar_posts' : 'seguidores'));
      const unit = (service === 'views') ? 'Visualizações' : ((service === 'likes') ? 'Curtidas' : ((service === 'salvar_posts') ? 'Salvamentos' : 'Seguidores'));

      const payload = {
        correlationID,
        value: totalCents,
        comment: 'Checkout Engajamento Novo',
        customer: {
          name: 'Cliente ' + instagramUsernameFinal,
          phone: phoneValue,
          email: emailValue
        },
        additionalInfo: [
          { key: 'tipo_servico', value: tipo },
          { key: 'categoria_servico', value: serviceCategory },
          { key: 'quantidade', value: String(qtdEffective) },
          { key: 'pacote', value: `${qtdEffective} ${unit} - ${precoStr}` },
          { key: 'phone', value: phoneValue },
          { key: 'instagram_username', value: instagramUsernameFinal },
          { key: 'order_bumps_total', value: formatCentsToBRL(promosTotalCents) },
          { key: 'order_bumps', value: promos.map(p => `${p.key}:${p.qty ?? 1}`).join(';') },
          { key: 'cupom', value: window.couponCode || '' }
        ],
        profile_is_private: false // Default to false if check not implemented
      };

      // Add selected post info if applicable
      const latestPostNode = (window.selectedPost) ? window.selectedPost : (window.latestPosts && window.latestPosts.length > 0 ? window.latestPosts[0].node : null);
      const latestLink = latestPostNode ? `https://instagram.com/p/${latestPostNode.shortcode}/` : '';
      
      if ((service === 'likes' || service === 'views' || service === 'salvar_posts') && window.selectedPost) {
          payload.additionalInfo.push({ key: 'post_shortcode', value: window.selectedPost.shortcode });
          payload.additionalInfo.push({ key: 'post_link', value: latestLink });
      }

      // Orderbumps: Use selected post OR latest post
      if (latestLink) {
          if (promos.some(p => p.key === 'likes')) payload.additionalInfo.push({ key: 'orderbump_post_likes', value: latestLink });
          if (promos.some(p => p.key === 'views')) payload.additionalInfo.push({ key: 'orderbump_post_views', value: latestLink });
          if (promos.some(p => p.key === 'comments')) payload.additionalInfo.push({ key: 'orderbump_post_comments', value: latestLink });
      }

      console.log('DEBUG: Sending Payload to Woovi:', JSON.stringify(payload, null, 2));

      // Validação de Preço Mínimo Antes do Envio
      if (payload.value < 10) {
          console.warn('DEBUG: Valor calculado menor que 10 centavos. Ajustando para 10.');
          payload.value = 10;
          // Ajustar no additionalInfo também se necessário
      }

      const resp = await fetch('/api/woovi/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.details?.message || 'No se pudo crear el cobro');
      }

      // Renderização do PIX
      const charge = data?.charge || data || {};
      const pix = charge?.paymentMethods?.pix || charge?.pix || {};
      const brCode = pix?.brCode || charge?.brCode || data?.brCode || '';
      const qrImage = pix?.qrCodeImage || charge?.qrCodeImage || data?.qrCodeImage || '';

      const copyButtonId = 'copyPixBtnDynamic';
      const inputId = 'pixBrCodeInputDynamic';

      const imgHtml = qrImage
        ? `<img src="${qrImage}" alt="Código QR de pago" style="width: 180px; height: 180px; border-radius: 8px; display: block; margin: 0 auto 0.75rem; background: #fff;" />`
        : '';

      const codeFieldHtml = brCode
        ? `<div style="margin-bottom: 0.5rem; text-align: center;">
             <input id="${inputId}" type="text" readonly value="${brCode}" style="width: 100%; padding: 0.5rem; font-size: 0.9rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.85); color: #111827; text-align: center;" />
           </div>`
        : '<div style="color:#fff;">No se pudo mostrar el código de pago.</div>';

      const copyBtnHtml = brCode
        ? `<div class="button-container" style="margin-bottom: 0.5rem;">
             <button id="${copyButtonId}" class="continue-button">
               <span class="button-text">Copiar código de pago</span>
             </button>
           </div>`
        : '';

      const textColor = (document.body.classList.contains('theme-light') || true) ? '#000' : '#fff'; 
      
      const waitingHtml = `
        <div style="display:flex; align-items:center; justify-content:center; gap:0.5rem; color:${textColor};">
          <svg width="18" height="18" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
            <circle cx="25" cy="25" r="20" stroke="${textColor}" stroke-width="4" fill="none" stroke-dasharray="31.4 31.4">
              <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
          <span>Esperando el pago...</span>
        </div>`;

      if (pixResultado) {
          pixResultado.innerHTML = `${imgHtml}${codeFieldHtml}${copyBtnHtml}${waitingHtml}`;
          pixResultado.style.display = 'block';
      }

      // Scroll para o PIX
      try {
        const isMobile = window.innerWidth <= 640;
        if (isMobile && pixResultado) {
            const rect = pixResultado.getBoundingClientRect();
            const top = (window.scrollY || window.pageYOffset || 0) + rect.top - 80;
            window.scrollTo({ top, behavior: 'smooth' });
        }
      } catch(_) {}

      // Listener do botão copiar e verificar
      setTimeout(() => {
          const copyBtn = document.getElementById(copyButtonId);
          if (copyBtn && brCode) {
            copyBtn.addEventListener('click', async () => {
              try {
                if (navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(brCode);
                } else {
                  const input = document.getElementById(inputId);
                  input?.select();
                  document.execCommand('copy');
                }
                const span = copyBtn.querySelector('.button-text');
                const prev = span ? span.textContent : '';
                if (span) span.textContent = '¡Código copiado!';
                try { showStatusMessageCheckout('Código de pago copiado', 'success'); } catch(_) {}
                copyBtn.disabled = true;
                setTimeout(() => {
                  copyBtn.disabled = false;
                  if (span) span.textContent = prev || 'Copiar código de pago';
                }, 1200);
              } catch (e) {
                alert('No se pudo copiar el código de pago.');
              }
            });
          }
      }, 100);

      // Polling de Status
      const chargeId = charge?.id || charge?.chargeId || data?.chargeId || '';
      const identifier = charge?.identifier || (data?.charge && data.charge.identifier) || '';
      const serverCorrelationID = charge?.correlationID || (data?.charge && data.charge.correlationID) || '';
      
      if (window.paymentPollInterval) {
        clearInterval(window.paymentPollInterval);
        window.paymentPollInterval = null;
      }
      
      const doCheckDb = async () => {
         try {
           const dbUrl = `/api/checkout/payment-state?id=${encodeURIComponent(chargeId)}&identifier=${encodeURIComponent(identifier)}&correlationID=${encodeURIComponent(serverCorrelationID || correlationID)}`;
           const dbResp = await fetch(dbUrl);
           const dbData = await dbResp.json();
           if (dbData?.paid === true) {
             clearInterval(window.paymentPollInterval);
             window.paymentPollInterval = null;
             try { markPaymentConfirmed(); } catch(_) {}
             await navigateToPedidoOrFallback(identifier, serverCorrelationID || correlationID, chargeId);
             return true;
           }
           return false;
         } catch(e) { console.error('Poll Error', e); return false; }
      };

      // Verificar imediatamente
      await doCheckDb();
      
      // Iniciar intervalo
      window.paymentPollInterval = setInterval(doCheckDb, 3000);

    } catch (err) {
      alert('Error al procesar: ' + err.message);
      if (btnPedido) {
        btnPedido.disabled = false;
        btnPedido.classList.remove('loading');
      }
    }
  }

  const btnPedido = document.getElementById('realizarPedidoBtn');
  if (btnPedido) {
      btnPedido.addEventListener('click', criarPixWoovi);
  }

  // --- Modal Events ---
  const openPostsModalBtn = document.getElementById('openPostsModalBtn');
  const closePostsModalBtn = document.getElementById('closePostsModal');
  const postsModal = document.getElementById('postsModal');
  
  if (openPostsModalBtn && postsModal) {
      openPostsModalBtn.addEventListener('click', () => {
          postsModal.style.display = 'flex';
      });
  }
  
  if (closePostsModalBtn && postsModal) {
      closePostsModalBtn.addEventListener('click', () => {
          postsModal.style.display = 'none';
      });
  }
  
  if (postsModal) {
      postsModal.addEventListener('click', (e) => {
          if (e.target === postsModal) {
              postsModal.style.display = 'none';
          }
      });
  }

  // --- Warranty Modal Logic ---
  const warrantyModal = document.getElementById('warranty60Modal');
  const warrantyClose1 = document.getElementById('warranty60CloseBtn');
  const warrantyClose2 = document.getElementById('warranty60CloseBtn2');

  if (warrantyModal) {
      if (warrantyClose1) {
          warrantyClose1.addEventListener('click', () => {
              warrantyModal.style.display = 'none';
          });
      }
      if (warrantyClose2) {
          warrantyClose2.addEventListener('click', () => {
              warrantyModal.style.display = 'none';
          });
      }
      warrantyModal.addEventListener('click', (e) => {
          if (e.target === warrantyModal) {
              warrantyModal.style.display = 'none';
          }
      });
  }

  // --- Quantity Control Listeners ---
  function attachStepListener(id, fn, dir) {
    const el = document.getElementById(id);
    if (el) {
        el.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            fn(dir);
        };
    }
  }

  attachStepListener('likesDec', window.stepLikes, -1);
  attachStepListener('likesInc', window.stepLikes, 1);
  attachStepListener('viewsDec', window.stepViews, -1);
  attachStepListener('viewsInc', window.stepViews, 1);
  attachStepListener('commentsDec', window.stepComments, -1);
  attachStepListener('commentsInc', window.stepComments, 1);
  attachStepListener('warrantyModeDec', window.stepWarranty, -1);
  attachStepListener('warrantyModeInc', window.stepWarranty, 1);

  // Toggle Visibility of Controls based on Checkbox
  function togglePromoControl(checkboxId) {
      const cb = document.getElementById(checkboxId);
      if (!cb) return;
      const label = cb.closest('.promo-item');
      if (!label) return;
      const control = label.querySelector('.likes-control');
      if (control) {
          control.style.display = cb.checked ? 'flex' : 'none';
      }
  }

  ['promoLikes', 'promoViews', 'promoComments', 'promoWarranty60'].forEach(id => {
      const cb = document.getElementById(id);
      if (cb) {
          cb.addEventListener('change', () => {
              togglePromoControl(id);
              if (typeof updatePromosSummary === 'function') updatePromosSummary();
          });
          // Initialize
          togglePromoControl(id);
      }
  });

  // Ensure initial state
  if (typeof updatePromosSummary === 'function') updatePromosSummary();

  // Initial Render
  if (typeof renderAllServices === 'function') renderAllServices();

  // --- Tool Explanation Modal Logic ---
  const toolModal = document.getElementById('toolExplanationModal');
  if (toolModal) {
      toolModal.addEventListener('click', (e) => {
          if (e.target === toolModal) {
              toolModal.style.display = 'none';
          }
      });
  }

});
