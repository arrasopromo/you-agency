
document.addEventListener('DOMContentLoaded', function() {
  const _path = String(window.location.pathname || '');
  const isCurtidasContext = _path.startsWith('/servicos-curtidas') || _path.startsWith('/likes-services');
  const isViewsContext = _path.startsWith('/servicos-visualizacoes') || _path.startsWith('/views-services');

  function getBrowserSessionId() {
      let bid = '';
      try { bid = localStorage.getItem('oppus_browser_id'); } catch(_) {}
      if (!bid) {
          bid = 'bid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          try { localStorage.setItem('oppus_browser_id', bid); } catch(_) {}
      }
      return bid;
  }
  try { getBrowserSessionId(); } catch(_) {}

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
      try { sessionStorage.setItem('oppus_coupon_code', pre); } catch(_) {}
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
              msg.textContent = 'Coupon applied! (' + percent + '% OFF)';
              msg.style.color = '#22c55e';
              msg.style.display = 'block';
            }
            if (input) input.disabled = true;
            if (typeof updatePromosSummary === 'function') updatePromosSummary();
          } else {
            window.couponCode = '';
            window.couponDiscount = 0;
            if (msg) {
              msg.textContent = (data && data.error) ? data.error : 'Invalid coupon.';
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

  const applyCouponBtn = document.getElementById('applyCouponBtn');
  if (applyCouponBtn) {
      applyCouponBtn.addEventListener('click', function() {
          const input = document.getElementById('couponInput');
          const msg = document.getElementById('couponMessage');
          if (!input || !msg) return;
          
          const code = input.value.trim().toUpperCase();
          if (!code) {
              msg.textContent = 'Enter a coupon.';
              msg.style.color = '#ef4444';
              msg.style.display = 'block';
              return;
          }
          
          // Validation Logic via API
          this.disabled = true;
          this.textContent = 'Checking...';
          
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
                  msg.textContent = `Coupon applied! (${percent}% OFF)`;
                  msg.style.color = '#22c55e';
                  msg.style.display = 'block';
                  
                  input.disabled = true;
                  this.disabled = true;
                  this.textContent = 'Applied';
              } else {
                  msg.textContent = data.error || 'Invalid coupon.';
                  msg.style.color = '#ef4444';
                  msg.style.display = 'block';
                  window.couponCode = '';
                  window.couponDiscount = 0;
                  
                  this.disabled = false;
                  this.textContent = 'Apply';
              }
              if (typeof updatePromosSummary === 'function') updatePromosSummary();
          })
          .catch(err => {
              console.error('Error validating coupon:', err);
              msg.textContent = 'Error validating coupon.';
              msg.style.color = '#ef4444';
              msg.style.display = 'block';
              
              this.disabled = false;
              this.textContent = 'Apply';
          });
      });
  }

  const tabelaSeguidores = {
    mistos: [
      { q: 150, p: '$ 2.99' },
      { q: 300, p: '$ 4.99' },
      { q: 500, p: '$ 5.99' },
      { q: 700, p: '$ 7.99' },
      { q: 1000, p: '$ 8.99' },
      { q: 2000, p: '$ 14.99' },
      { q: 3000, p: '$ 19.99' },
      { q: 4000, p: '$ 24.99' },
      { q: 5000, p: '$ 29.99' },
      { q: 7500, p: '$ 39.99' },
      { q: 10000, p: '$ 49.99' },
      { q: 15000, p: '$ 69.99' },
    ],
    brasileiros: [
      { q: 150, p: '$ 2.99' },
      { q: 300, p: '$ 4.99' },
      { q: 500, p: '$ 5.99' },
      { q: 700, p: '$ 7.99' },
      { q: 1000, p: '$ 8.99' },
      { q: 2000, p: '$ 14.99' },
      { q: 3000, p: '$ 19.99' },
      { q: 4000, p: '$ 24.99' },
      { q: 5000, p: '$ 29.99' },
      { q: 7500, p: '$ 39.99' },
      { q: 10000, p: '$ 49.99' },
      { q: 15000, p: '$ 69.99' },
    ],
    organicos: [
      { q: 150, p: '$ 8.90' },
      { q: 300, p: '$ 10.90' },
      { q: 500, p: '$ 15.90' },
      { q: 1000, p: '$ 27.90' },
      { q: 2000, p: '$ 42.90' },
      { q: 3000, p: '$ 53.90' },
      { q: 4000, p: '$ 70.90' },
      { q: 5000, p: '$ 106.90' },
      { q: 7500, p: '$ 128.90' },
      { q: 10000, p: '$ 192.90' },
      { q: 15000, p: '$ 277.90' },
    ],
  };

  // Upsell: desconto de 25% em seguidores (mundiais, brasileiros, brasileiros reais) a partir de 500
  let isUpsellFollowers = false;
  try {
    const paramsUpsell = new URLSearchParams(window.location.search || '');
    const u = String(paramsUpsell.get('upsell_followers') || paramsUpsell.get('upsell') || '').toLowerCase();
    if (u === '1' || u === 'seguidores_25' || u === 'followers_25') {
      isUpsellFollowers = true;
    }
  } catch(_) {}
  try { window.isUpsellFollowers = isUpsellFollowers; } catch(_) {}


  if (isUpsellFollowers && !isCurtidasContext && !isViewsContext) {
    ['mistos', 'brasileiros', 'organicos'].forEach(function(tipoKey){
      const arr = tabelaSeguidores[tipoKey] || [];
      arr.forEach(function(item){
        if (Number(item.q) >= 500) {
          const cents = (typeof parsePrecoToCents === 'function') ? parsePrecoToCents(item.p) : 0;
          if (cents > 0) {
            const newCents = Math.round(cents * 0.75);
            if (typeof formatCentsToBRL === 'function') {
              item.p = formatCentsToBRL(newCents);
            }
          }
        }
      });
    });
  }

  const tabelaCurtidas = {
    mistos: [
      { q: 150, p: '$ 1.99' },
      { q: 300, p: '$ 2.99' },
      { q: 500, p: '$ 3.99' },
      { q: 700, p: '$ 4.99' },
      { q: 1000, p: '$ 5.99' },
      { q: 2000, p: '$ 7.99' },
      { q: 3000, p: '$ 9.99' },
      { q: 4000, p: '$ 11.99' },
      { q: 5000, p: '$ 13.99' },
      { q: 7500, p: '$ 16.99' },
      { q: 10000, p: '$ 19.99' },
      { q: 15000, p: '$ 24.99' },
    ],
    curtidas_brasileiras: [
      { q: 150, p: '$ 1.99' },
      { q: 300, p: '$ 2.99' },
      { q: 500, p: '$ 3.99' },
      { q: 700, p: '$ 4.99' },
      { q: 1000, p: '$ 5.99' },
      { q: 2000, p: '$ 7.99' },
      { q: 3000, p: '$ 9.99' },
      { q: 4000, p: '$ 11.99' },
      { q: 5000, p: '$ 13.99' },
      { q: 7500, p: '$ 16.99' },
      { q: 10000, p: '$ 19.99' },
      { q: 15000, p: '$ 24.99' },
    ],
    organicos: [
      { q: 150, p: '$ 4.99' },
      { q: 300, p: '$ 7.99' },
      { q: 500, p: '$ 12.99' },
      { q: 1000, p: '$ 16.99' },
      { q: 2000, p: '$ 24.99' },
      { q: 3000, p: '$ 34.99' },
      { q: 4000, p: '$ 44.99' },
      { q: 5000, p: '$ 54.99' },
      { q: 7500, p: '$ 69.99' },
      { q: 10000, p: '$ 89.99' },
      { q: 15000, p: '$ 119.99' },
    ],
  };

  const tabelaVisualizacoes = {
    visualizacoes_reels: [
      { q: 1000, p: '$ 1.99' },
      { q: 2500, p: '$ 2.99' },
      { q: 5000, p: '$ 3.99' },
      { q: 10000, p: '$ 5.99' },
      { q: 25000, p: '$ 7.99' },
      { q: 50000, p: '$ 9.99' },
      { q: 100000, p: '$ 14.99' },
      { q: 150000, p: '$ 16.99' },
      { q: 200000, p: '$ 19.99' },
      { q: 250000, p: '$ 24.99' },
      { q: 500000, p: '$ 29.99' },
      { q: 1000000, p: '$ 39.99' }
    ]
  };

  const tabela = isViewsContext ? tabelaVisualizacoes : (isCurtidasContext ? tabelaCurtidas : tabelaSeguidores);

  const promoPricing = {
    likes: { old: '$ 49.90', price: '$ 9.90', discount: 80 },
    views: { old: '$ 89.90', price: '$ 19.90', discount: 78 },
    comments: { old: '$ 29.90', price: '$ 9.90', discount: 67 },
    warranty: { old: '$ 39.90', price: '$ 14.90', discount: 63 },
    warranty60: { old: '$ 39.90', price: '$ 9.90', discount: 75 },
  };
  try { window.promoPricing = promoPricing; } catch(_) {}

  let selectedPlatform = 'instagram';
  let basePriceCents = 0;
  let isInstagramVerified = false;
  let isInstagramPrivate = false;
  let warrantyMode = '30';
  try {
    const initialWarrantyLabel = (document.getElementById('warrantyModeLabel')?.textContent || '').toLowerCase();
    const initialWarrantyHighlight = (document.getElementById('warrantyHighlight')?.textContent || '').toLowerCase();
    if (initialWarrantyLabel.includes('vital') || initialWarrantyHighlight.includes('vital')) {
      warrantyMode = 'life';
    }
    window.warrantyMode = warrantyMode;
  } catch(_) {}

  let paymentPollInterval = null;
  let paymentEventSource = null;
  const disablePix = !!(window && window.__DISABLE_PIX__);
  let currentPaymentMethod = disablePix ? 'credit_card' : 'pix';
  window.currentPaymentMethod = currentPaymentMethod;

  // --- UTM Tracking Persistence ---
  try {
    const p = new URLSearchParams(window.location.search);
    const utms = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(k => {
       const v = p.get(k);
       if(v) utms[k] = v;
    });
    if (Object.keys(utms).length > 0) {
        sessionStorage.setItem('oppus_utms', JSON.stringify(utms));
    }
  } catch(_) {}

  // Elementos UI Principais
  const tipoSelect = document.getElementById('tipoSelect');
  const qtdSelect = document.getElementById('quantidadeSelect');
  const tipoCards = document.getElementById('tipoCards');
  const planCards = document.getElementById('planCards');
  const perfilCard = document.getElementById('perfilCard');
  const grupoPedido = document.getElementById('grupoPedido'); // Pode não existir
  const orderInline = document.getElementById('orderBumpInline');
  const paymentCard = document.getElementById('paymentCard'); // Pode não existir
  const resumo = document.getElementById('resumo');
  const resTipo = document.getElementById('resTipo');
  const resQtd = document.getElementById('resQtd');
  const resPreco = document.getElementById('resPreco');
  const resTotalFinal = document.getElementById('resTotalFinal');
  const btnPedido = document.getElementById('realizarPedidoBtn');

  // Perfil UI
  const usernameCheckoutInput = document.getElementById('usernameCheckoutInput');
  const checkCheckoutButton = document.getElementById('checkCheckoutButton');
  const statusCheckoutMessage = document.getElementById('statusCheckoutMessage');
  const loadingCheckoutSpinner = document.getElementById('loadingCheckoutSpinner');
  const profilePreview = document.getElementById('profilePreview');
  const checkoutProfileImage = document.getElementById('checkoutProfileImage');
  const checkoutProfileUsername = document.getElementById('checkoutProfileUsername');
  const checkoutFollowersCount = document.getElementById('checkoutFollowersCount');
  const checkoutFollowingCount = document.getElementById('checkoutFollowingCount');
  const checkoutPostsCount = document.getElementById('checkoutPostsCount');

  // Inputs de contato
  const contactPhoneInput = document.getElementById('contactPhoneInput');
  const contactEmailInput = document.getElementById('contactEmailInput');

  function getPhoneDigitsLen(v) {
    try {
      const d = onlyDigits(String(v || ''));
      return d ? d.length : 0;
    } catch (_) {
      return 0;
    }
  }

  (function applyDefaultDialCodeOnce() {
    try {
      if (!contactPhoneInput) return;
      if (window.__oppus_phone_dial_loaded === true) return;
      window.__oppus_phone_dial_loaded = true;

      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (_) {} }, 1200);
      fetch('/api/geo/phone-default', { signal: ctrl ? ctrl.signal : undefined })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          const rawDial = data ? String(data.dial || data.dialPrefix || '').trim() : '';
          const rawCalling = data ? String(data.callingCode || '').trim() : '';
          const rawCountryCode = data ? String(data.countryCode || '').trim().toUpperCase() : '';
          const fallback = rawCalling ? `+${rawCalling}` : (rawDial || '');
          let prefix = fallback.startsWith('+') ? fallback : (fallback ? `+${fallback}` : '');
          let countryCode = rawCountryCode;
          if (!prefix) {
            const tz = (function () {
              try { return String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim(); } catch (_) { return ''; }
            })();
            const lang = (function () {
              try { return String(navigator.language || '').trim(); } catch (_) { return ''; }
            })();
            const looksBr = tz === 'America/Sao_Paulo' || /^pt(-BR)?$/i.test(lang) || /^pt-BR/i.test(lang);
            if (looksBr) {
              prefix = '+55';
              countryCode = 'BR';
            }
          }
          if (!prefix) return;

          if (!contactPhoneInput.value || !String(contactPhoneInput.value).trim()) {
            contactPhoneInput.value = `${prefix} `;
          }
          const ph = String(contactPhoneInput.placeholder || '').trim();
          const shouldUpdatePlaceholder =
            !ph ||
            ph === '(00) 00000-0000' ||
            ph === '+1 555 123 456' ||
            /\b555\s+123\s+456\b/.test(ph);
          if (shouldUpdatePlaceholder) {
            contactPhoneInput.placeholder = (countryCode === 'BR')
              ? `${prefix} 11 98765 4321`
              : `${prefix} 555 123 456`;
          }
          try { contactPhoneInput.maxLength = 24; } catch (_) {}
        })
        .catch(() => {})
        .finally(() => { clearTimeout(timeoutId); });
    } catch (_) {}
  })();

  // --- Helpers ---
  function parsePrecoToCents(precoStr) {
    if (!precoStr) return 0;
    const raw = String(precoStr);
    const cleaned = raw.replace(/[^\d.,-]/g, '');
    if (!cleaned) return 0;
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let normalized = cleaned;
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(/,/g, '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
    const value = Math.round(parseFloat(normalized) * 100);
    return isNaN(value) ? 0 : value;
  }

  function formatCentsToBRL(cents) {
    const valor = Math.max(0, Number(cents) || 0);
    const v = valor / 100;
    return `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function onlyDigits(v) { return String(v || '').replace(/\D+/g, ''); }

  function maskBrPhone(v) {
    const s = onlyDigits(v).slice(0, 11);
    if (!s) return '';
    const ddd = s.slice(0, 2);
    const first = s.slice(2, 3);
    const mid = s.slice(3, 7);
    const end = s.slice(7, 11);
    let out = '';
    if (ddd.length < 2) {
      out = `(${ddd}`;
    } else {
      out = `(${ddd})`;
    }
    if (first) out += ` ${first}`;
    if (mid) out += mid;
    if (end) out += `-${end}`;
    return out;
  }

  function attachPhoneMask(input) {
    if (!input) return;
    input.addEventListener('input', () => { input.value = maskBrPhone(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        const selStart = input.selectionStart, selEnd = input.selectionEnd;
        const hasSelection = selStart !== selEnd;
        if (!hasSelection) {
          const digits = onlyDigits(input.value);
          if (digits.length > 0) {
            e.preventDefault();
            input.value = maskBrPhone(digits.slice(0, -1));
          }
        }
      }
    });
    input.addEventListener('paste', (e) => {
      const txt = (e.clipboardData || window.clipboardData)?.getData('text');
      if (txt) { e.preventDefault(); input.value = maskBrPhone(txt); }
    });
  }

  function cardSurchargeRate(inst) {
    const table = {
      1: 4.97, 2: 6.33, 3: 7.24, 4: 8.14, 5: 9.05, 6: 9.95,
      7: 11.10, 8: 12.00, 9: 12.91, 10: 13.81, 11: 14.71, 12: 15.62
    };
    const keys = Object.keys(table).map(k => parseInt(k, 10)).filter(Number.isFinite).sort((a, b) => a - b);
    const maxKey = keys[keys.length - 1] || 12;
    const k = Math.max(1, Math.min(maxKey, Number(inst) || 1));
    return Number(table[k] || 0);
  }

  function capInstallmentsBySubtotal(subtotalCents) {
    const n = Number(subtotalCents) || 0;
    if (n < 1500) return 1;
    if (n < 3000) return 2;
    if (n < 6000) return 6;
    if (n < 10000) return 8;
    if (n < 15000) return 10;
    return 12;
  }

  function getSelectedInstallments() {
    try {
      const el = document.getElementById('cardInstallments');
      const v = String(el && el.value ? el.value : '').trim();
      const n = parseInt(v || '1', 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    } catch (_) {
      return 1;
    }
  }

  function calculateSubtotalCents() {
    let base = Number(basePriceCents || 0);
    const promos = getSelectedPromos();
    const promosTotal = calcPromosTotalCents(promos);

    let subtotal = Math.max(0, base + promosTotal);
    if (window.couponDiscount && window.couponDiscount > 0) {
      const discountVal = Math.round(subtotal * window.couponDiscount);
      subtotal -= discountVal;
    }
    return Math.max(0, Number(subtotal) || 0);
  }

  function calculateTotalCents() {
    let total = calculateSubtotalCents();
    try {
      const method = String(window.currentPaymentMethod || '').trim();
      if (method === 'credit_card') {
        const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
        if (provider === 'stripe') return Math.max(0, Number(total) || 0);
        const cap = capInstallmentsBySubtotal(total);
        const inst = Math.max(1, Math.min(cap, getSelectedInstallments()));
        const rate = cardSurchargeRate(inst);
        total = Math.round(total * (1 + Math.max(0, rate) / 100));
      }
    } catch(_) {}
    return Math.max(0, Number(total) || 0);
  }
  window.calculateTotalCents = calculateTotalCents;

  function populateInstallments(subtotalCents) {
    const select = document.getElementById('cardInstallments');
    if (!select) return;

    select.innerHTML = '';

    const minInstallment = 500;
    const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
    const isStripe = provider === 'stripe';
    const maxInstallments = isStripe ? 1 : Math.min(12, capInstallmentsBySubtotal(subtotalCents));

    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    defaultOption.textContent = "Select installments...";
    select.appendChild(defaultOption);

    if (!subtotalCents || subtotalCents <= 0) return;

    for (let i = 1; i <= maxInstallments; i++) {
      const rate = isStripe ? 0 : cardSurchargeRate(i);
      const totalForI = Math.round(Number(subtotalCents) * (1 + Math.max(0, rate) / 100));
      const installmentValue = Math.floor(totalForI / i);
      if (installmentValue < minInstallment && i > 1) break;

      const option = document.createElement('option');
      option.value = i;
      option.textContent = `${i}x of ${formatCentsToBRL(installmentValue)}`;
      select.appendChild(option);
    }
  }
  window.populateInstallments = populateInstallments;

  let stripeInstance = null;
  let stripeElements = null;
  let stripeCardNumberEl = null;
  let stripeCardExpiryEl = null;
  let stripeCardCvcEl = null;
  let stripeMounted = false;
  let stripeEmbeddedMounted = false;
  let stripeEmbeddedCheckout = null;
  let stripeEmbeddedMountedKey = '';
  let stripeEmbeddedRefreshTimer = null;
  let stripeEmbeddedCreateCtrl = null;
  let stripeEmbeddedCreateSeq = 0;

  function fnv1a36(input) {
    try {
      let h = 0x811c9dc5;
      const s = String(input || '');
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h.toString(36);
    } catch (_) {
      return String(Math.random()).slice(2);
    }
  }

  function getStripeEmbeddedCheckoutKey() {
    try {
      const usernamePreview = (checkoutProfileUsername && checkoutProfileUsername.textContent && checkoutProfileUsername.textContent.trim()) || '';
      const usernameInputRaw = (usernameCheckoutInput && usernameCheckoutInput.value && usernameCheckoutInput.value.trim()) || '';
      const usernameInputNorm = normalizeInstagramUsername(usernameInputRaw);
      const instagramUsernameFinal = usernamePreview || usernameInputNorm || '';
      const tipo = tipoSelect ? String(tipoSelect.value || '') : '';
      const qtdSelectVal = qtdSelect ? String(qtdSelect.value || '0') : '0';
      const qtd = parseInt(qtdSelectVal, 10);
      const totalCents = calculateTotalCents();
      const coupon = String(window.couponCode || '').trim().toUpperCase();
      let promosKey = '';
      try {
        const promos = (typeof getSelectedPromos === 'function') ? getSelectedPromos() : [];
        promosKey = (Array.isArray(promos) ? promos : [])
          .map(p => `${String(p?.key || '')}:${String(p?.qty ?? 1)}`)
          .filter(Boolean)
          .sort()
          .join(',');
      } catch (_) { promosKey = ''; }
      return [
        String(instagramUsernameFinal || ''),
        String(tipo || ''),
        String(qtd || 0),
        String(totalCents || 0),
        String(coupon || ''),
        String(promosKey || '')
      ].join('|');
    } catch (_) {
      return '';
    }
  }

  function scheduleStripeEmbeddedCheckoutRefresh() {
    try { if (stripeEmbeddedRefreshTimer) clearTimeout(stripeEmbeddedRefreshTimer); } catch (_) {}
    stripeEmbeddedRefreshTimer = setTimeout(() => {
      try {
        const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
        const isStripe = provider === 'stripe';
        const useCheckout = window.STRIPE_USE_CHECKOUT === true || String(window.STRIPE_USE_CHECKOUT || '').toLowerCase() === 'true';
        const isStripeCheckout = isStripe && useCheckout;
        if (!isStripeCheckout) return;
        if (String(window.currentPaymentMethod || '').trim() !== 'credit_card') return;
        const key = getStripeEmbeddedCheckoutKey();
        if (!key) return;
        if (stripeEmbeddedMounted && stripeEmbeddedCheckout && stripeEmbeddedMountedKey && stripeEmbeddedMountedKey === key) return;
        try { window.__oppus_stripe_checkout_key = key; } catch (_) {}
        try { window.__oppus_stripe_auto_done = false; } catch (_) {}
        Promise.resolve()
          .then(() => handleCardPayment(null, { auto: true }))
          .catch(() => {});
      } catch (_) {}
    }, 650);
  }

  try {
    const onContactChange = () => { try { scheduleStripeEmbeddedCheckoutRefresh(); } catch (_) {} };
    if (contactPhoneInput) {
      contactPhoneInput.addEventListener('blur', onContactChange);
      contactPhoneInput.addEventListener('change', onContactChange);
    }
    if (contactEmailInput) {
      contactEmailInput.addEventListener('blur', onContactChange);
      contactEmailInput.addEventListener('change', onContactChange);
    }
  } catch (_) {}

  async function ensureStripeMounted() {
    const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
    if (provider !== 'stripe') return false;
    if (stripeMounted && stripeInstance && stripeElements && stripeCardNumberEl) return true;

    const publishableKey = String(window.STRIPE_PUBLISHABLE_KEY || '').trim();
    if (!publishableKey) throw new Error('Invalid payment configuration (missing STRIPE_PUBLISHABLE_KEY).');

    const loadStripe = async () => {
      try { if (window.Stripe) return true; } catch (_) {}
      const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
      if (!existing) {
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://js.stripe.com/v3/';
          s.onload = resolve;
          s.onerror = resolve;
          document.head.appendChild(s);
        });
      } else {
        await new Promise((resolve) => {
          if (window.Stripe) return resolve();
          const done = () => resolve();
          existing.addEventListener('load', done, { once: true });
          existing.addEventListener('error', done, { once: true });
          setTimeout(done, 8000);
        });
      }
      return !!window.Stripe;
    };

    const ok = await loadStripe();
    if (!ok) throw new Error('Unable to load Stripe. Reload the page and try again.');

    stripeInstance = window.Stripe(publishableKey);
    stripeElements = stripeInstance.elements({ locale: 'en' });
    const style = {
      base: {
        color: '#111827',
        fontSize: '16px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
      },
      invalid: { color: '#ef4444' }
    };

    const numberMount = document.getElementById('stripeCardNumber');
    const expMount = document.getElementById('stripeCardExpiry');
    const cvcMount = document.getElementById('stripeCardCvc');
    if (!numberMount || !expMount || !cvcMount) throw new Error('Stripe card form not found on the page.');

    stripeCardNumberEl = stripeElements.create('cardNumber', { style });
    stripeCardExpiryEl = stripeElements.create('cardExpiry', { style });
    stripeCardCvcEl = stripeElements.create('cardCvc', { style });
    stripeCardNumberEl.mount(numberMount);
    stripeCardExpiryEl.mount(expMount);
    stripeCardCvcEl.mount(cvcMount);

    stripeMounted = true;
    return true;
  }

  async function ensureStripeJsReady() {
    const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
    if (provider !== 'stripe') return false;
    const publishableKey = String(window.STRIPE_PUBLISHABLE_KEY || '').trim();
    if (!publishableKey) throw new Error('Invalid payment configuration (missing STRIPE_PUBLISHABLE_KEY).');
    try { if (window.Stripe) return true; } catch (_) {}
    const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
    if (!existing) {
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.onload = resolve;
        s.onerror = resolve;
        document.head.appendChild(s);
      });
    } else {
      await new Promise((resolve) => {
        if (window.Stripe) return resolve();
        const done = () => resolve();
        existing.addEventListener('load', done, { once: true });
        existing.addEventListener('error', done, { once: true });
        setTimeout(done, 8000);
      });
    }
    return !!window.Stripe;
  }

  try {
    const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
    const useCheckout = window.STRIPE_USE_CHECKOUT === true || String(window.STRIPE_USE_CHECKOUT || '').toLowerCase() === 'true';
    const publishableKey = String(window.STRIPE_PUBLISHABLE_KEY || '').trim();
    if (provider === 'stripe' && useCheckout && publishableKey) {
      setTimeout(() => { try { ensureStripeJsReady(); } catch (_) {} }, 0);
    }
  } catch (_) {}

  async function mountStripeEmbeddedCheckout(clientSecret) {
    const wrapper = document.getElementById('stripeEmbeddedWrapper');
    const mount = document.getElementById('stripeEmbeddedCheckout');
    if (!wrapper || !mount) throw new Error('Embedded checkout area not found.');
    wrapper.style.display = 'block';
    if (!stripeEmbeddedMounted || !stripeEmbeddedCheckout) {
      mount.innerHTML = '<div style="padding:14px; text-align:center; color:#6b7280; font-size:0.95rem;">Loading Stripe checkout...</div>';
    }
    const ok = await ensureStripeJsReady();
    if (!ok) throw new Error('Unable to load Stripe. Reload the page and try again.');
    const publishableKey = String(window.STRIPE_PUBLISHABLE_KEY || '').trim();
    const stripe = window.Stripe(publishableKey);
    if (!stripe || typeof stripe.initEmbeddedCheckout !== 'function') {
      throw new Error('Your Stripe integration does not support embedded checkout.');
    }
    const fields = document.getElementById('cardPaymentForm');
    if (fields) fields.style.display = 'none';
    const secret = String(clientSecret || '').trim();
    if (!secret) throw new Error('Embedded checkout did not return the required data.');

    if (stripeEmbeddedMounted && stripeEmbeddedCheckout) {
      try {
        const existingNext = document.getElementById('stripeEmbeddedCheckoutNext');
        if (existingNext && existingNext.parentNode) existingNext.parentNode.removeChild(existingNext);
      } catch (_) {}
      const next = document.createElement('div');
      next.id = 'stripeEmbeddedCheckoutNext';
      mount.insertAdjacentElement('afterend', next);
      const nextCheckout = await stripe.initEmbeddedCheckout({ clientSecret: secret });
      nextCheckout.mount('#stripeEmbeddedCheckoutNext');
      try { stripeEmbeddedCheckout.destroy(); } catch (_) {}
      stripeEmbeddedCheckout = nextCheckout;
      stripeEmbeddedMounted = true;
      try {
        if (mount && mount.parentNode) mount.parentNode.removeChild(mount);
        next.id = 'stripeEmbeddedCheckout';
      } catch (_) {
        try { next.id = 'stripeEmbeddedCheckout'; } catch (_) {}
      }
    } else {
      mount.innerHTML = '';
      stripeEmbeddedCheckout = await stripe.initEmbeddedCheckout({ clientSecret: secret });
      stripeEmbeddedCheckout.mount('#stripeEmbeddedCheckout');
      stripeEmbeddedMounted = true;
    }
    try { stripeEmbeddedMountedKey = getStripeEmbeddedCheckoutKey() || ''; } catch(_) { stripeEmbeddedMountedKey = ''; }
  }

  function selectPaymentMethod(method, opts) {
    const o = opts || {};
    if (disablePix && method === 'pix') method = 'credit_card';
    if (method === currentPaymentMethod && !o.force) return;
    currentPaymentMethod = method;
    window.currentPaymentMethod = method;

    const radioPix = document.querySelector('input[name="paymentMethod"][value="pix"]');
    const radioCard = document.querySelector('input[name="paymentMethod"][value="credit_card"]');
    if (radioPix) radioPix.checked = (method === 'pix');
    if (radioCard) radioCard.checked = (method === 'credit_card');

    const optionPix = document.getElementById('optionPix');
    const optionCard = document.getElementById('optionCard');

    const resetStyle = (el) => {
      if (!el) return;
      el.style.borderColor = '#e5e7eb';
      el.style.backgroundColor = '#fff';
      const title = el.querySelector('.pm-title');
      if (title) title.style.color = '#111827';
      const subtitle = el.querySelector('.pm-subtitle');
      if (subtitle) subtitle.style.color = '#6b7280';
    };

    resetStyle(optionPix);
    resetStyle(optionCard);

    if (method === 'pix' && optionPix) {
      optionPix.style.borderColor = '#10b981';
      optionPix.style.backgroundColor = '#ecfdf5';
      const title = optionPix.querySelector('.pm-title');
      if (title) title.style.color = '#065f46';
      const subtitle = optionPix.querySelector('.pm-subtitle');
      if (subtitle) subtitle.style.color = '#065f46';
    } else if (method === 'credit_card' && optionCard) {
      optionCard.style.borderColor = '#3b82f6';
      optionCard.style.backgroundColor = '#eff6ff';
      const title = optionCard.querySelector('.pm-title');
      if (title) title.style.color = '#1e40af';
      const subtitle = optionCard.querySelector('.pm-subtitle');
      if (subtitle) subtitle.style.color = '#1d4ed8';

      try { populateInstallments(calculateSubtotalCents()); } catch(_) {}
    }

    const cardForm = document.getElementById('cardPaymentContent');
    const pixBtnContainer = document.getElementById('pixPaymentBtnContainer');
    const contentPix = document.getElementById('pixContainer');
    const pagarmeBadgeCard = document.getElementById('pagarmeBadgeCard');
    const stripeBadgeCard = document.getElementById('stripeBadgeCard');
    const pagarmeCardFields = document.getElementById('pagarmeCardFields');
    const stripeCardFields = document.getElementById('stripeCardFields');
    const pixResultado = document.getElementById('pixResultado');

    if (method === 'credit_card') {
      try {
        let pixVisible = false;
        if (contentPix && window.getComputedStyle) {
          const cs = window.getComputedStyle(contentPix);
          pixVisible = cs && cs.display !== 'none' && contentPix.getClientRects && contentPix.getClientRects().length > 0;
        } else if (pixResultado && window.getComputedStyle) {
          const cs = window.getComputedStyle(pixResultado);
          const hasContent = String(pixResultado.innerHTML || '').trim().length > 0 || String(pixResultado.textContent || '').trim().length > 0;
          pixVisible = hasContent && cs && cs.display !== 'none' && pixResultado.getClientRects && pixResultado.getClientRects().length > 0;
        }
        window.__oppus_pix_was_visible = pixVisible;
      } catch(_) {}
      if (cardForm) cardForm.style.display = 'block';
      if (pixBtnContainer) pixBtnContainer.style.display = 'none';
      if (contentPix) contentPix.style.display = 'none';
      if (pixResultado) pixResultado.style.display = 'none';
      const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
      const isStripe = provider === 'stripe';
      const useCheckout = window.STRIPE_USE_CHECKOUT === true || String(window.STRIPE_USE_CHECKOUT || '').toLowerCase() === 'true';
      const isStripeCheckout = isStripe && useCheckout;
      if (pagarmeBadgeCard) pagarmeBadgeCard.style.display = isStripe ? 'none' : 'flex';
      if (stripeBadgeCard) stripeBadgeCard.style.display = isStripe ? 'flex' : 'none';
      if (pagarmeCardFields) pagarmeCardFields.style.display = isStripe ? 'none' : 'block';
      if (stripeCardFields) stripeCardFields.style.display = (isStripe && !isStripeCheckout) ? 'block' : 'none';
      const stripeEmbeddedWrapper = document.getElementById('stripeEmbeddedWrapper');
      const stripeEmbeddedMount = document.getElementById('stripeEmbeddedCheckout');
      if (stripeEmbeddedWrapper) stripeEmbeddedWrapper.style.display = isStripeCheckout ? 'block' : 'none';
      if (isStripeCheckout && stripeEmbeddedMount && !stripeEmbeddedMounted) {
        stripeEmbeddedMount.innerHTML = '<div style="padding:14px; text-align:center; color:#6b7280; font-size:0.95rem;">Carregando checkout da Stripe...</div>';
        try {
          const key = getStripeEmbeddedCheckoutKey();
          if (window.__oppus_stripe_checkout_key !== key) {
            window.__oppus_stripe_checkout_key = key;
            try { window.__oppus_stripe_auto_done = false; } catch (_) {}
            if (stripeEmbeddedMounted && stripeEmbeddedCheckout) {
              try { stripeEmbeddedCheckout.destroy(); } catch (_) {}
              stripeEmbeddedCheckout = null;
              stripeEmbeddedMounted = false;
              stripeEmbeddedMountedKey = '';
            }
          }
          if (!window.__oppus_stripe_auto_inflight && !window.__oppus_stripe_auto_done && !stripeEmbeddedMounted) {
            window.__oppus_stripe_auto_inflight = true;
            Promise.resolve()
              .then(() => handleCardPayment(null, { auto: true }))
              .catch(() => {})
              .finally(() => { window.__oppus_stripe_auto_inflight = false; });
          }
        } catch (_) {}
      }
      try {
        const ids = ['cardNumber', 'cardExpiry', 'cardCvv'];
        ids.forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.required = !isStripe;
        });
      } catch (_) {}
      try {
        const holderNameEl = document.getElementById('cardHolderName');
        const holderCpfEl = document.getElementById('cardHolderCpf');
        if (holderNameEl) holderNameEl.required = !isStripeCheckout;
        if (holderCpfEl) holderCpfEl.required = !isStripeCheckout;
        const instEl = document.getElementById('cardInstallments');
        if (instEl) {
          if (isStripeCheckout) {
            try { instEl.value = '1'; } catch (_) {}
            const g = instEl.closest('.form-group');
            if (g) g.style.display = 'none';
          } else {
            const g = instEl.closest('.form-group');
            if (g) g.style.display = '';
          }
        }
        if (holderNameEl) {
          const g = holderNameEl.closest('.form-group');
          if (g) g.style.display = isStripeCheckout ? 'none' : '';
        }
        if (holderCpfEl) {
          const g = holderCpfEl.closest('.form-group');
          if (g) g.style.display = isStripeCheckout ? 'none' : '';
        }
      } catch (_) {}
      if (isStripe && !isStripeCheckout) {
        try { ensureStripeMounted(); } catch (_) {}
      }
    } else {
      if (stripeEmbeddedMounted && stripeEmbeddedCheckout) {
        try { stripeEmbeddedCheckout.destroy(); } catch (_) {}
        stripeEmbeddedCheckout = null;
        stripeEmbeddedMounted = false;
      }
      if (cardForm) cardForm.style.display = 'none';
      if (pixBtnContainer) pixBtnContainer.style.display = 'flex';
      try {
        const shouldRestorePix = (window.__oppus_pix_started === true) && (window.__oppus_pix_was_visible === true);
        if (shouldRestorePix) {
          if (contentPix) contentPix.style.display = 'block';
          if (pixResultado) pixResultado.style.display = 'block';
        } else {
          if (contentPix) contentPix.style.display = 'none';
          if (pixResultado) pixResultado.style.display = 'none';
        }
      } catch(_) {}
      if (pagarmeBadgeCard) pagarmeBadgeCard.style.display = 'none';
      if (stripeBadgeCard) stripeBadgeCard.style.display = 'none';
    }

    if (!o.skipSummary) {
      try { updatePromosSummary(); } catch(_) {}
    }
  }
  window.selectPaymentMethod = selectPaymentMethod;

  function updatePaymentMethodVisibility() {
    let total = 0;
    try {
      const base = Number(basePriceCents || 0);
      const promos = getSelectedPromos();
      const promosTotal = calcPromosTotalCents(promos);
      total = Math.max(0, base + promosTotal);
      if (window.couponDiscount && window.couponDiscount > 0) {
        const discountVal = Math.round(total * window.couponDiscount);
        total -= discountVal;
      }
      total = Math.max(0, Number(total) || 0);
    } catch(_) { total = 0; }
    const selector = document.getElementById('paymentMethodSelector');

    const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
    const publicKey = provider === 'stripe'
      ? String(window.STRIPE_PUBLISHABLE_KEY || '').trim()
      : String(window.PAGARME_PUBLIC_KEY || '').trim();
    const isPublicKeyValid = publicKey && publicKey !== 'pk_change_me' && publicKey.length > 8 && /^pk_/i.test(publicKey);

    if (disablePix) {
      if (selector) selector.style.display = 'none';
      selectPaymentMethod('credit_card', { skipSummary: true, force: true });
      return;
    }

    if (selector) {
      if (total >= 100 && isPublicKeyValid) {
        if (selector.style.display !== 'flex') selector.style.display = 'flex';
      } else {
        selector.style.display = 'none';
        if (String(window.currentPaymentMethod || '').trim() !== 'pix') {
          selectPaymentMethod('pix', { skipSummary: true, force: true });
        }
      }
    }
  }
  window.updatePaymentMethodVisibility = updatePaymentMethodVisibility;

  function maskCardNumber(v) {
    v = String(v || '').replace(/\D/g, "");
    v = v.substring(0, 16);
    return v.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, "$1 $2 $3 $4").trim();
  }
  function maskExpiry(v) {
    v = String(v || '').replace(/\D/g, "");
    if (v.length > 4) v = v.substring(0, 4);
    if (v.length > 2) return v.substring(0, 2) + '/' + v.substring(2);
    return v;
  }
  function maskCpf(v) {
    v = String(v || '').replace(/\D/g, "");
    if (v.length > 11) v = v.substring(0, 11);
    if (v.length <= 3) return v;
    if (v.length <= 6) return v.replace(/(\d{3})(\d+)/, "$1.$2");
    if (v.length <= 9) return v.replace(/(\d{3})(\d{3})(\d+)/, "$1.$2.$3");
    return v.replace(/(\d{3})(\d{3})(\d{3})(\d+)/, "$1.$2.$3-$4");
  }

  async function handleCardPayment(e, opts) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const o = opts || {};
    const isAuto = o.auto === true;

    const payWithCardBtn = document.getElementById('payWithCardBtn');
    if (!isAuto && payWithCardBtn) {
      payWithCardBtn.disabled = true;
      payWithCardBtn.classList.add('loading');
      const span = payWithCardBtn.querySelector('.button-text');
      if (span) {
        if (!span.dataset.original) span.dataset.original = span.textContent;
        span.textContent = 'Processando...';
      }
    }

    try {
      const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
      const isStripe = provider === 'stripe';
      const useCheckout = window.STRIPE_USE_CHECKOUT === true || String(window.STRIPE_USE_CHECKOUT || '').toLowerCase() === 'true';
      const isStripeCheckout = isStripe && useCheckout;
      if (isStripeCheckout && stripeEmbeddedMounted) {
        const currentKey = getStripeEmbeddedCheckoutKey();
        if (currentKey && stripeEmbeddedMountedKey && stripeEmbeddedMountedKey === currentKey) {
          return;
        }
        try { if (stripeEmbeddedCheckout) stripeEmbeddedCheckout.destroy(); } catch (_) {}
        stripeEmbeddedCheckout = null;
        stripeEmbeddedMounted = false;
        stripeEmbeddedMountedKey = '';
        try { window.__oppus_stripe_auto_done = false; } catch (_) {}
      }

      const fields = isStripeCheckout
        ? []
        : isStripe
        ? [
          { id: 'cardHolderName', type: 'text' },
          { id: 'cardHolderCpf', type: 'text' }
        ]
        : [
          { id: 'cardNumber', type: 'text' },
          { id: 'cardExpiry', type: 'text' },
          { id: 'cardCvv', type: 'text' },
          { id: 'cardHolderName', type: 'text' },
          { id: 'cardHolderCpf', type: 'text' }
        ];

      let firstError = null;
      let values = {};

      fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (el) {
          el.classList.remove('input-error');
          el.classList.remove('tutorial-highlight');
          const val = el.value.trim();
          let isValid = true;
          if (!val) isValid = false;
          if (!isValid) {
            el.classList.add('input-error');
            el.classList.add('tutorial-highlight');
            if (!firstError) firstError = el;
          }
          values[f.id] = val;
        }
      });

      if (firstError) {
        firstError.focus();
        try { firstError.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
        throw new Error('Please fill in all highlighted required fields.');
      }

      const cardHolder = values.cardHolderName;
      const cardHolderCpf = values.cardHolderCpf;

      let cardNum = '';
      let cardExpiry = '';
      let cardCvv = '';
      let expMonth = '';
      let expYear = '';
      let pagarmePublicKey = '';
      if (!isStripe) {
        cardNum = String(values.cardNumber || '').replace(/\D/g, '');
        cardExpiry = String(values.cardExpiry || '').trim();
        cardCvv = String(values.cardCvv || '').trim();
        pagarmePublicKey = String(window.PAGARME_PUBLIC_KEY || '').trim();
        if (!pagarmePublicKey) {
          throw new Error('Invalid payment configuration (missing PAGARME_PUBLIC_KEY).');
        }

        if (cardExpiry.includes('/')) {
          [expMonth, expYear] = cardExpiry.split('/');
        } else {
          expMonth = cardExpiry.substring(0, 2);
          expYear = cardExpiry.substring(2);
        }

        if (expYear && expYear.length === 2) expYear = '20' + expYear;
        if (!expMonth || !expYear || Number(expMonth) > 12 || Number(expMonth) < 1) throw new Error('Invalid expiration date.');
      } else {
        if (!isStripeCheckout) await ensureStripeMounted();
      }

      const normalizeDigits = (v) => String(v || '').replace(/\D/g, '');
      const cpfDigits = normalizeDigits(cardHolderCpf);
    if (!isStripeCheckout && cpfDigits.length !== 11) throw new Error('Invalid CPF.');

      const installmentsEl = document.getElementById('cardInstallments');
      let installments = String(installmentsEl?.value || '').trim();
      if (!installments && installmentsEl) {
        const opts = Array.prototype.slice.call(installmentsEl.querySelectorAll('option'));
        const firstNumeric = opts.map(o => String(o.value || '').trim()).find(v => /^\d+$/.test(v));
        installments = firstNumeric || '1';
        try { installmentsEl.value = installments; } catch (_) {}
      }

      let correlationID = 'InstagramService_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      let wooviComment = 'Checkout OPPUS Instagram';
      try {
        const hn = (window.location && window.location.hostname) ? String(window.location.hostname).toLowerCase() : '';
        const isLocal = hn === 'localhost' || hn === '127.0.0.1';
        if (isLocal && Number(totalCents) > 0 && Number(totalCents) <= 100) {
          correlationID = 'test-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          wooviComment = 'teste pix';
        }
      } catch(_) {}

      const phoneInput = contactPhoneInput || document.getElementById('checkoutPhoneInput');
      const phoneValue = onlyDigits(phoneInput ? phoneInput.value : '');
      let emailValue = contactEmailInput ? contactEmailInput.value.trim() : '';
      if (emailValue && !emailValue.includes('@')) emailValue = '';

      const usernamePreview = (checkoutProfileUsername && checkoutProfileUsername.textContent && checkoutProfileUsername.textContent.trim()) || '';
      const usernameInputRaw = (usernameCheckoutInput && usernameCheckoutInput.value && usernameCheckoutInput.value.trim()) || '';
      const usernameInputNorm = normalizeInstagramUsername(usernameInputRaw);
      const instagramUsernameFinal = usernamePreview || usernameInputNorm || '';
      if (!instagramUsernameFinal) {
        throw new Error('Instagram username not identified.');
      }

      const serviceCategory = isViewsContext ? 'visualizacoes' : (isCurtidasContext ? 'curtidas' : 'seguidores');

      const tipo = tipoSelect ? tipoSelect.value : '';
      const qtdSelectVal = qtdSelect ? qtdSelect.value : '0';
      const qtd = parseInt(qtdSelectVal, 10);
      if (!tipo || !qtd || qtd <= 0) throw new Error('Select a package before paying.');

      selectPaymentMethod('credit_card');
      const totalCents = calculateTotalCents();
      if (!totalCents || totalCents < 100) throw new Error('The minimum card payment is $ 1.00.');
      const totalLabel = formatCentsToBRL(totalCents);

      let cardToken = '';
      if (!isStripe) {
        cardToken = await (async () => {
          const tokenUrl = `https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(pagarmePublicKey)}`;
          const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const timeoutId = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 45000) : null;
          let tokenResp = null;
          try {
            tokenResp = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'card',
                card: {
                  number: cardNum,
                  holder_name: cardHolder,
                  holder_document: cpfDigits,
                  exp_month: Number(expMonth),
                  exp_year: Number(expYear),
                  cvv: cardCvv
                }
              }),
              signal: ctrl ? ctrl.signal : undefined
            });
          } catch (_) {
            throw new Error('Failed to connect to Pagar.me. Check your internet connection and try again.');
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
          let tokenData = null;
          try { tokenData = await tokenResp.json(); } catch(_) {}
          if (!tokenResp.ok) {
            const msg = (tokenData && (tokenData.message || tokenData.error)) ? String(tokenData.message || tokenData.error) : 'Failed to tokenize card.';
            throw new Error(msg);
          }
          const t = tokenData && tokenData.id ? String(tokenData.id).trim() : '';
          if (!t) throw new Error('Card token was not returned by Pagar.me.');
          return t;
        })();
      }

      const customerPayload = {};
      if (cardHolder) customerPayload.name = cardHolder;
      if (cpfDigits && cpfDigits.length === 11) customerPayload.cpf = cpfDigits;
      if (phoneValue) customerPayload.phone_number = phoneValue;
      if (emailValue) customerPayload.email = emailValue;

      const buildUtmsFromLocation = function () {
        try {
          const sp = new URLSearchParams(window.location.search || '');
          return {
            source: sp.get('utm_source') || '',
            medium: sp.get('utm_medium') || '',
            campaign: sp.get('utm_campaign') || '',
            term: sp.get('utm_term') || '',
            content: sp.get('utm_content') || '',
            gclid: sp.get('gclid') || '',
            fbclid: sp.get('fbclid') || '',
            ref: window.location.href || ''
          };
        } catch (_) {
          return { ref: (window.location && window.location.href) ? String(window.location.href) : '' };
        }
      };

      const promos = getSelectedPromos();
      const promosTotalCents = (function () {
        try {
          const cents = (typeof calcPromosTotalCents === 'function') ? calcPromosTotalCents(promos) : 0;
          return Number.isFinite(Number(cents)) ? Number(cents) : 0;
        } catch (_) {
          return 0;
        }
      })();

      try {
        if (isStripe && isStripeCheckout) {
          const key = getStripeEmbeddedCheckoutKey();
          const bid = (typeof getBrowserSessionId === 'function') ? getBrowserSessionId() : '';
          if (key && bid) {
            correlationID = `EC_${fnv1a36(`${bid}|${key}`)}`;
          }
        }
      } catch (_) {}

      const payload = {
        correlationID,
        installments: Number(installments) || 1,
        total_cents: totalCents,
        items: [
          { title: `${qtd} ${getUnitForTipo(tipo)}`, quantity: 1, price_cents: totalCents }
        ],
        customer: customerPayload,
        additionalInfo: [
          { key: 'tipo_servico', value: tipo },
          { key: 'categoria_servico', value: serviceCategory },
          { key: 'quantidade', value: String(qtd) },
          { key: 'pacote', value: `${qtd} ${getUnitForTipo(tipo)} - ${totalLabel}` },
          { key: 'phone', value: phoneValue },
          { key: 'instagram_username', value: instagramUsernameFinal },
          { key: 'order_bumps_total', value: formatCentsToBRL(promosTotalCents) },
          { key: 'order_bumps', value: promos.map(p => `${p.key}:${p.qty ?? 1}`).join(';') },
          { key: 'cupom', value: window.couponCode || '' },
          { key: 'payment_method', value: 'credit_card' },
          ...(isStripe ? [{ key: 'card_provider', value: 'stripe' }] : [])
        ],
        profile_is_private: !!isInstagramPrivate,
        comment: 'Checkout OPPUS Card',
        utms: buildUtmsFromLocation()
      };
      if (!isStripe) payload.card_token = cardToken;

      try {
        const cc = String(window.couponCode || '').trim();
        if (cc) {
          for (let i = payload.additionalInfo.length - 1; i >= 0; i--) {
            if (payload.additionalInfo[i] && payload.additionalInfo[i].key === 'cupom') payload.additionalInfo.splice(i, 1);
          }
          payload.additionalInfo.push({ key: 'cupom', value: cc.toUpperCase() });
        }
      } catch (_) {}

      try {
        const m = document.cookie.match(/(?:^|;\s*)tc_code=([^;]+)/);
        const tc = m && m[1] ? m[1] : '';
        if (tc) payload.additionalInfo.push({ key: 'tc_code', value: tc });
      } catch(_) {}

      try {
        let sckValue = '';
        try {
          const params = new URLSearchParams(window.location.search || '');
          sckValue = params.get('sck') || '';
        } catch (_) {}
        if (!sckValue) {
          try {
            const m2 = document.cookie.match(/(?:^|;\s*)index=([^;]+)/);
            sckValue = m2 && m2[1] ? decodeURIComponent(m2[1]) : '';
          } catch (_) {}
        }
        if (sckValue) payload.additionalInfo.push({ key: 'sck', value: sckValue });
      } catch(_) {}

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      if (isStripe) {
        const stripePayload = Object.assign({}, payload);
        try { delete stripePayload.card_token; } catch (_) {}
        const useCheckout = window.STRIPE_USE_CHECKOUT === true || String(window.STRIPE_USE_CHECKOUT || '').toLowerCase() === 'true';

        if (useCheckout) {
          if (isAuto) {
            const emailOk = !!(emailValue && emailValue.includes('@'));
            const phoneOk = !!(phoneValue && phoneValue.length >= 8);
            if (!emailOk || !phoneOk) {
              try {
                const wrapper = document.getElementById('stripeEmbeddedWrapper');
                const mount = document.getElementById('stripeEmbeddedCheckout');
                if (wrapper) wrapper.style.display = 'block';
                if (mount) {
                  mount.innerHTML = '';
                  const div = document.createElement('div');
                  div.style.padding = '14px';
                  div.style.textAlign = 'center';
                  div.style.color = '#b45309';
                  div.style.fontSize = '0.95rem';
                  div.textContent = 'Fill in your phone and email to load the card checkout.';
                  mount.appendChild(div);
                }
              } catch (_) {}
              return;
            }
          }

          stripePayload.checkoutUiMode = 'embedded';
          const reqSeq = ++stripeEmbeddedCreateSeq;
          if (stripeEmbeddedCreateCtrl) {
            try { stripeEmbeddedCreateCtrl.abort(); } catch (_) {}
          }
          stripeEmbeddedCreateCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const ctrl = stripeEmbeddedCreateCtrl;
          const timeoutId = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 45000) : null;
          let checkoutResp = null;
          try {
            checkoutResp = await fetch('/api/stripe/create-checkout-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(stripePayload),
              signal: ctrl ? ctrl.signal : undefined
            });
          } catch (e) {
            if (ctrl && ctrl.signal && ctrl.signal.aborted) return;
            throw new Error('Failed to connect to the server. Reload the page and try again.');
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
          if (reqSeq !== stripeEmbeddedCreateSeq) return;

          let checkoutData = null;
          try { checkoutData = await checkoutResp.json(); } catch (_) { checkoutData = {}; }
          if (reqSeq !== stripeEmbeddedCreateSeq) return;
          if (!checkoutResp.ok) {
            const errCode = String(checkoutData?.error || '').trim().toLowerCase();
            if (errCode === 'invalid_cpf') {
              try {
                const cpfEl = document.getElementById('cardHolderCpf');
                if (cpfEl) {
                  cpfEl.classList.add('input-error');
                  cpfEl.classList.add('tutorial-highlight');
                  try { cpfEl.focus(); } catch (_) {}
                  try { cpfEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
                }
              } catch (_) {}
            }
            if (errCode === 'missing_phone' || errCode === 'invalid_phone') {
              try {
                if (contactPhoneInput) {
                  contactPhoneInput.classList.add('input-error');
                  contactPhoneInput.classList.add('tutorial-highlight');
                  try { contactPhoneInput.focus(); } catch (_) {}
                  try { contactPhoneInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
                }
              } catch (_) {}
            }
            const baseMsg = checkoutData?.message || checkoutData?.error || 'Failed to start checkout.';
            throw new Error(String(baseMsg).trim() || 'Failed to start checkout.');
          }

          const clientSecret = String(checkoutData?.clientSecret || checkoutData?.client_secret || '').trim();
          if (!clientSecret) throw new Error('Embedded checkout did not return the required data.');
          if (reqSeq !== stripeEmbeddedCreateSeq) return;
          await mountStripeEmbeddedCheckout(clientSecret);
          try { window.__oppus_stripe_auto_done = true; } catch (_) {}
          return;
        }

        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 45000) : null;
        let createResp = null;
        try {
          createResp = await fetch('/api/stripe/create-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stripePayload),
            signal: ctrl ? ctrl.signal : undefined
          });
        } catch (_) {
          throw new Error('Failed to connect to the server. Reload the page and try again.');
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }

        let createData = null;
        try { createData = await createResp.json(); } catch (_) { createData = {}; }
        if (!createResp.ok) {
          const errCode = String(createData?.error || '').trim().toLowerCase();
          if (errCode === 'invalid_cpf') {
            try {
              const cpfEl = document.getElementById('cardHolderCpf');
              if (cpfEl) {
                cpfEl.classList.add('input-error');
                cpfEl.classList.add('tutorial-highlight');
                try { cpfEl.focus(); } catch (_) {}
                try { cpfEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
              }
            } catch (_) {}
          }
          if (errCode === 'missing_phone' || errCode === 'invalid_phone') {
            try {
              if (contactPhoneInput) {
                contactPhoneInput.classList.add('input-error');
                contactPhoneInput.classList.add('tutorial-highlight');
                try { contactPhoneInput.focus(); } catch (_) {}
                try { contactPhoneInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
              }
            } catch (_) {}
          }
          const baseMsg = createData?.message || createData?.error || 'Failed to start payment.';
          throw new Error(String(baseMsg).trim() || 'Failed to start payment.');
        }

        const clientSecret = String(createData?.clientSecret || '').trim();
        const identifierServer = String(createData?.identifier || createData?.paymentIntentId || '').trim();
        const correlationIDServer = String(createData?.correlationID || correlationID || '').trim();
        if (!clientSecret) throw new Error('Payment did not start correctly (missing clientSecret).');

        await ensureStripeMounted();
        const confirmResult = await stripeInstance.confirmCardPayment(clientSecret, {
          payment_method: {
            card: stripeCardNumberEl,
            billing_details: { name: String(cardHolder || '').trim(), phone: String(phoneValue || '').trim() }
          }
        });

        if (confirmResult && confirmResult.error) {
          const m = String(confirmResult.error.message || '').trim();
          throw new Error(m || 'Payment not approved.');
        }
        const pi = confirmResult && confirmResult.paymentIntent ? confirmResult.paymentIntent : null;
        const piId = String(pi?.id || identifierServer || '').trim();
        const piStatus = String(pi?.status || '').trim().toLowerCase();
        if (!piId) throw new Error('Payment did not return an identifier.');

        let finalizeResp = null;
        try {
          finalizeResp = await fetch('/api/stripe/confirm-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_intent_id: piId, identifier: identifierServer, correlationID: correlationIDServer })
          });
        } catch (_) {
          finalizeResp = null;
        }
        let finalizeData = null;
        try { if (finalizeResp) finalizeData = await finalizeResp.json(); } catch (_) { finalizeData = {}; }

        const paid = finalizeData?.paid === true || piStatus === 'succeeded';
        if (!paid && piStatus && piStatus !== 'succeeded') {
          alert('Payment is processing. We’ll take you to your order.');
        } else {
          alert('Payment successful!');
        }

        if (typeof navigateToPedidoOrFallback === 'function') {
          await navigateToPedidoOrFallback(String(finalizeData?.identifier || piId || identifierServer || ''), String(finalizeData?.correlationID || correlationIDServer || correlationID || ''));
        } else {
          window.location.href = '/pedido';
        }
        return;
      }

      let resp = null;
      let lastNetErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 45000) : null;
        try {
          resp = await fetch('/api/pagarme/card-charge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ctrl ? ctrl.signal : undefined
          });
          lastNetErr = null;
          break;
        } catch (e) {
          lastNetErr = e;
          if (attempt >= 2) break;
          await sleep(800 * (attempt + 1));
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      }
      if (!resp) throw (lastNetErr || new Error('Failed to connect to the server. Reload the page and try again.'));

      const data = await resp.json();
      if (!resp.ok) {
        const errCode = String(data?.error || '').trim().toLowerCase();
        if (errCode === 'invalid_cpf') {
          try {
            const cpfEl = document.getElementById('cardHolderCpf');
            if (cpfEl) {
              cpfEl.classList.add('input-error');
              cpfEl.classList.add('tutorial-highlight');
              try { cpfEl.focus(); } catch (_) {}
              try { cpfEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
            }
          } catch (_) {}
        }
        if (errCode === 'missing_phone' || errCode === 'invalid_phone') {
          try {
            if (contactPhoneInput) {
              contactPhoneInput.classList.add('input-error');
              contactPhoneInput.classList.add('tutorial-highlight');
              try { contactPhoneInput.focus(); } catch (_) {}
              try { contactPhoneInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
            }
          } catch (_) {}
        }
        const baseMsg = data?.message || data?.error || 'Failed to process payment.';
        const pf = data && data.pagarme_failure ? data.pagarme_failure : null;
        const extra = (pf && (pf.acquirer_message || pf.gateway_message || pf.acquirer_return_code || pf.refusal_reason))
          ? ` Reason: ${String(pf.acquirer_message || pf.gateway_message || pf.refusal_reason || '').trim()}${(pf.acquirer_return_code || pf.gateway_response_code) ? ` (code: ${String(pf.acquirer_return_code || pf.gateway_response_code).trim()})` : ''}`
          : '';
        const identifierErr = String(data?.identifier || data?.pagarme?.order_id || data?.order?.id || '').trim();
        const idPart = identifierErr ? ` Order: ${identifierErr}.` : '';
        throw new Error(`${String(baseMsg)}${extra}${idPart}`);
      }

      const paid = data?.paid === true || data?.success === true;
      const identifierServer = String(data?.identifier || data?.pagarme?.order_id || data?.order?.id || '').trim();
      const correlationIDServer = String(data?.correlationID || correlationID || '').trim();

      if (!paid) {
        const txStatus = String(data?.pagarme?.transaction_status || data?.pagarme?.charge_status || data?.pagarme?.order_status || '').trim();
        const idLabel = identifierServer ? ` Order: ${identifierServer}.` : '';
        throw new Error((data?.message && String(data.message).trim()) || (`Payment not confirmed in Pagar.me${txStatus ? ` (${txStatus})` : ''}.${idLabel}`));
      }

      alert('Payment successful!');
      if (typeof navigateToPedidoOrFallback === 'function') {
        await navigateToPedidoOrFallback(identifierServer || '', correlationIDServer);
      } else {
        window.location.href = '/pedido';
      }
    } catch (err) {
      if (isAuto) {
        try {
          const wrapper = document.getElementById('stripeEmbeddedWrapper');
          const mount = document.getElementById('stripeEmbeddedCheckout');
          if (wrapper) wrapper.style.display = 'block';
          if (mount) {
            mount.innerHTML = '';
            const div = document.createElement('div');
            div.style.padding = '14px';
            div.style.textAlign = 'center';
            div.style.color = '#b91c1c';
            div.style.fontSize = '0.95rem';
            div.textContent = String(err?.message || 'Unable to start checkout. Please review your details and try again.');
            mount.appendChild(div);
          }
        } catch (_) {}
        return;
      }
      alert('Error processing payment: ' + (err?.message || err));
    } finally {
      if (!isAuto && payWithCardBtn) {
        payWithCardBtn.disabled = false;
        payWithCardBtn.classList.remove('loading');
        const span = payWithCardBtn.querySelector('.button-text');
        if (span && span.dataset.original) span.textContent = span.dataset.original;
      }
    }
  }

  function normalizeInstagramUsername(input) {
    let username = input.trim();
    if (username.includes('instagram.com/')) {
      const parts = username.split('instagram.com/');
      if (parts[1]) {
        username = parts[1].split(/[/?#]/)[0];
      }
    }
    username = username.replace(/^@/, '');
    username = username.replace(/[^a-zA-Z0-9_.]/g, '');
    return username;
  }

  function isValidInstagramUsername(username) {
    const regex = /^[a-zA-Z0-9._]{1,30}$/;
    return regex.test(username) && !username.startsWith('.') && !username.endsWith('.');
  }

  function getLabelForTipo(tipo) {
    if (isViewsContext) {
      const mapViews = {
        visualizacoes_reels: 'Reels Views'
      };
      return mapViews[tipo] || tipo;
    }
    if (isCurtidasContext) {
        const map = {
          'mistos': 'Mixed Likes',
          'curtidas_brasileiras': 'Local Likes',
          'organicos': 'Real Local Likes'
        };
        return map[tipo] || tipo;
    }
    const map = {
      'mistos': 'Mixed Followers',
      'brasileiros': 'Local Followers',
      'organicos': 'Real Followers'
    };
    return map[tipo] || tipo;
  }

  function getUnitForTipo(tipo) {
    if (isViewsContext || tipo === 'visualizacoes_reels') return 'views';
    return isCurtidasContext ? 'likes' : 'followers';
  }

  function isFollowersTipo(tipo) {
    return ['mistos', 'brasileiros', 'organicos'].includes(tipo);
  }

  function findPrice(tipo, qtd) {
    const arr = tabela[tipo] || [];
    const item = arr.find(i => Number(i.q) === Number(qtd));
    return item ? item.p : null;
  }

  // --- Stepper Logic (Checkout Reference) ---

  window.goToStep = function(step) {
    if (step === 2) {
      const activePlan = planCards ? planCards.querySelector('.service-card[data-role="plano"].active') : null;
      if (!activePlan) {
        alert('Please select a package before continuing.');
        return;
      }
    }
    
    if (step === 3) {
      if (!isInstagramVerified) {
        alert('Please verify the profile in step 2 before continuing.');
        if (window.goToStep) window.goToStep(2);
        return;
      }

      const email = contactEmailInput ? contactEmailInput.value.trim() : '';
      const phone = contactPhoneInput ? contactPhoneInput.value.trim() : '';
      const emailErrorMsg = document.getElementById('emailErrorMsg');

      if (!email || !email.includes('@')) {
        if (emailErrorMsg) emailErrorMsg.style.display = 'block';
        else showStatusMessageCheckout('Please enter a valid email.', 'error');
        if (window.goToStep) window.goToStep(2);

        setTimeout(() => {
             if (contactEmailInput) {
                 contactEmailInput.focus();
                 contactEmailInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
             }
        }, 300);
        return;
      } else {
        if (emailErrorMsg) emailErrorMsg.style.display = 'none';
      }

      const phoneDigitsLen = getPhoneDigitsLen(phone);
      if (!phoneDigitsLen || phoneDigitsLen < 8) {
        showStatusMessageCheckout('Please enter a valid phone number.', 'error');
        if (window.goToStep) window.goToStep(2);

        setTimeout(() => {
             if (contactPhoneInput) {
                 contactPhoneInput.focus();
                 contactPhoneInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
             }
        }, 300);
        return;
      }

      if (!isInstagramPrivate && (isCurtidasContext || isViewsContext)) {
        const kind = isCurtidasContext ? 'likes' : 'views';
        const list = (window.__oppusSelectedPostsByKind && Array.isArray(window.__oppusSelectedPostsByKind[kind]))
          ? window.__oppusSelectedPostsByKind[kind]
          : [];
        if (!list.length) {
          openPostModal(kind, { append: false });
          return;
        }
      }
    }

    // UI Elements
    const step1Container = document.getElementById('step1Container');
    const step2Container = document.getElementById('perfilCard');
    const step3Container = document.getElementById('step3Container');

    // Stepper Indicators
    document.querySelectorAll('.step').forEach((el, idx) => {
        if (idx + 1 === step) el.classList.add('active');
        else if (idx + 1 < step) el.classList.add('completed');
        else el.classList.remove('active', 'completed');
    });

    // Visibility
    if (step === 1) {
        if (step1Container) step1Container.style.display = 'grid'; // or block/flex depending on css
        if (step2Container) step2Container.style.display = 'none';
        if (step3Container) step3Container.style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        // Remove hash when leaving checkout step
         if (window.location.hash === '#checkout') {
              const cleanUrl = window.location.pathname + window.location.search;
              history.replaceState(null, null, cleanUrl);
              // Dispatch events for GTM
              try { window.dispatchEvent(new Event('hashchange')); } catch(e){}
              try { window.dispatchEvent(new Event('popstate')); } catch(e){}
         }

    } else if (step === 2) {
        if (step1Container) step1Container.style.display = 'none';
        if (step2Container) step2Container.style.display = 'block';
        if (step3Container) step3Container.style.display = 'none';
        
        // Focus on username input
        if (usernameCheckoutInput && !usernameCheckoutInput.value) {
            setTimeout(() => usernameCheckoutInput.focus(), 100);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Remove hash when leaving checkout step
        if (window.location.hash === '#checkout') {
             const cleanUrl = window.location.pathname + window.location.search;
             history.replaceState(null, null, cleanUrl);
             // Dispatch events for GTM
             try { window.dispatchEvent(new Event('hashchange')); } catch(e){}
             try { window.dispatchEvent(new Event('popstate')); } catch(e){}
        }

    } else if (step === 3) {
        if (step1Container) step1Container.style.display = 'none';
        if (step2Container) step2Container.style.display = 'none';
        if (step3Container) step3Container.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        try { updatePromosSummary(); } catch(_) {}
        try { updatePaymentMethodVisibility(); } catch(_) {}
        try { selectPaymentMethod(String(window.currentPaymentMethod || 'pix')); } catch(_) {}

        if (isCurtidasContext || isViewsContext) {
          const srcContainer = document.getElementById('selectedPostPreview');
          const srcContent = document.getElementById('selectedPostPreviewContent');
          const dst = document.getElementById('step3PostPreview');
          const dstContent = document.getElementById('step3PostPreviewContent');
          const hasPreview = srcContainer && srcContent && srcContainer.style.display !== 'none' && srcContent.innerHTML.trim();
          if (dst && dstContent) {
            if (hasPreview && !isInstagramPrivate) {
              dst.style.display = 'block';
              dstContent.innerHTML = srcContent.innerHTML;
            } else {
              dst.style.display = 'none';
              dstContent.innerHTML = '';
            }
          }
        }

        // URL hash removed per request
        /*
        if (window.location.hash !== '#checkout') {
             history.pushState(null, null, '#checkout');
             // Dispatch explicit event for GTM as backup
             try { window.dispatchEvent(new Event('hashchange')); } catch(e){}
             try { window.dispatchEvent(new Event('popstate')); } catch(e){}
        }
        */
    }
  };

  // --- Renderização dos Cards ---

  function renderTipoCards() {
    if (!tipoCards) return;
    tipoCards.innerHTML = '';
    // Garantir visibilidade (pois vem oculto do HTML)
    tipoCards.style.display = 'grid';
    
    const tipos = Object.keys(tabela).filter(t => {
      if (t === 'seguidores_tiktok') return false;
      if (isCurtidasContext && t === 'curtidas_brasileiras') return false;
      if (!isCurtidasContext && !isViewsContext && t === 'brasileiros') return false;
      return true;
    });

    // Fallback de segurança: garantir que organicos esteja presente se disponível na tabela
    if (!isCurtidasContext && !isViewsContext && !tipos.includes('organicos') && tabela.organicos) {
       tipos.push('organicos');
    }
    
    tipos.forEach(tipo => {
      const card = document.createElement('div');
      card.className = 'service-card option-card';
      card.setAttribute('data-role', 'tipo'); // Alinhado com checkout
      card.setAttribute('data-tipo', tipo);
      
      const label = getLabelForTipo(tipo);
      // Layout idêntico ao checkout.js (centralizado)
      card.innerHTML = `<div class="card-content"><div class="card-title" style="text-align:center;">${label}</div></div>`;
      
      card.addEventListener('click', () => {
        // Atualizar select oculto
        if (tipoSelect) {
          window.__oppusTipoChangeUserInitiated = true;
          tipoSelect.value = tipo;
          tipoSelect.dispatchEvent(new Event('change'));
        }
        // Atualizar UI visual
        const all = tipoCards.querySelectorAll('.option-card');
        all.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      });
      
      tipoCards.appendChild(card);
    });
  }

  function getAllowedQuantities(tipo) {
    const base = [50, 150, 300, 500, 700, 1000, 2000, 3000, 4000, 5000, 7500, 10000, 15000];
    if (tipo === 'mistos' || tipo === 'brasileiros' || tipo === 'curtidas_brasileiras' || tipo === 'organicos' || tipo === 'seguidores_tiktok') {
      if (isCurtidasContext) {
        if (tipo === 'curtidas_brasileiras') return [50, 150, 500, 1000, 3000, 5000, 10000];
        if (tipo === 'organicos') return [20].concat(base.filter(function(q){ return q >= 150 && q !== 700; }));
        return [50].concat(base.filter(function(q){ return q >= 150; }));
      }
      return base;
    }
    return base;
  }

  const quantityBadges = {
    50: 'TEST PACKAGE',
    20: 'TEST PACKAGE',
    150: 'STARTER',
    500: 'BASIC',
    1000: 'MOST POPULAR',
    3000: 'EXCLUSIVE',
    5000: 'VIP',
    10000: 'ELITE'
  };

  function renderPlanCards(tipo) {
    if (!planCards) return;
    planCards.innerHTML = '';
    // Garantir visibilidade
    planCards.style.display = '';

    let arr = tabela[tipo] || [];
    const unit = getUnitForTipo(tipo);
    
    if (isFollowersTipo(tipo)) {
      const allowed = getAllowedQuantities(tipo);
      if (isCurtidasContext) {
        arr = arr
          .filter(x => allowed.includes(Number(x.q)))
          .filter(x => quantityBadges.hasOwnProperty(Number(x.q)));
      } else {
        arr = arr
          .filter(x => allowed.includes(Number(x.q)))
          .filter(x => quantityBadges.hasOwnProperty(Number(x.q)));
      }
    }

    if (isViewsContext && tipo === 'visualizacoes_reels') {
      const allowedViews = [1000, 5000, 25000, 100000, 200000, 500000];
      arr = arr.filter(x => allowedViews.includes(Number(x.q)));
    }

    if (isCurtidasContext && (tipo === 'mistos' || tipo === 'curtidas_brasileiras' || tipo === 'organicos')) {
      if (tipo === 'curtidas_brasileiras') {
        const allowed = [50, 150, 500, 1000, 3000, 5000, 10000];
        arr = arr.filter(x => allowed.includes(Number(x.q)));
      } else {
        arr = arr.slice(0, 6);
      }
    }
    
    arr.forEach(item => {
      const card = document.createElement('div');
      card.className = 'service-card plan-card';
      card.setAttribute('data-role', 'plano');
      card.setAttribute('data-qtd', item.q);
      card.setAttribute('data-preco', item.p);
      
      const baseCents = parsePrecoToCents(item.p);
      const baseText = formatCentsToBRL(baseCents);
      const incCents = Math.round(baseCents * 1.15);
      const ceilInt = Math.ceil((incCents / 100));
      const increasedRounded = (ceilInt - 0.10);
      const increasedText = formatCentsToBRL(Math.round(increasedRounded * 100));

      const qNum = Number(item.q);
      let badgeHtml = '';
      let badgeText = '';

      if (!isCurtidasContext) {
        if (tipo === 'mistos') {
          if (qNum === 1000) badgeText = 'BEST VALUE';
          if (qNum === 3000) { badgeText = 'MOST POPULAR'; card.classList.add('gold-card'); }
        } else if (tipo === 'organicos') {
          if (qNum === 1000) { badgeText = 'MOST POPULAR'; card.classList.add('gold-card'); }
        } else if (tipo === 'visualizacoes_reels') {
          if (qNum === 1000) badgeText = 'STARTER';
          if (qNum === 5000) badgeText = 'BASIC';
          if (qNum === 25000) badgeText = 'BEST VALUE';
          if (qNum === 100000) { badgeText = 'MOST POPULAR'; card.classList.add('gold-card'); }
          if (qNum === 200000) badgeText = 'VIP';
          if (qNum === 500000) badgeText = 'ELITE';
        }
      } else if (tipo === 'mistos' || tipo === 'curtidas_brasileiras' || tipo === 'organicos') {
        if (quantityBadges[qNum]) badgeText = quantityBadges[qNum];
        if (badgeText === 'MOST POPULAR') card.classList.add('gold-card');
      }

      if (!isCurtidasContext && !badgeText && isFollowersTipo(tipo) && quantityBadges[qNum]) {
        badgeText = quantityBadges[qNum];
      }

      if (badgeText) {
        badgeHtml = `<div class="plan-badge">${badgeText}</div>`;
      }

      const qtyFormatted = qNum.toLocaleString('en-US');
      card.innerHTML = `${badgeHtml}<div class="card-content"><div class="card-title">${qtyFormatted} ${unit}</div><div class="card-desc"><span class="price-old">${increasedText}</span> <span class="price-new">${baseText}</span></div></div>`;
      
      card.addEventListener('click', () => {
        // Atualizar estado
        const baseText = formatCentsToBRL(baseCents);
        
        // Atualizar select oculto
        const opt = Array.from(qtdSelect.options).find(o => o.value === String(item.q));
        if (opt) opt.selected = true;
        
        // Atualizar resumo
        if (resTipo) resTipo.textContent = getLabelForTipo(tipo);
        if (resQtd) resQtd.textContent = `${item.q} ${unit}`;
        if (resPreco) resPreco.textContent = baseText;
        basePriceCents = baseCents;
        
        // Update Order Bump e Promos
        updateOrderBump(tipo, Number(item.q));
        updatePromosSummary();
        try { updatePaymentMethodVisibility(); } catch(_) {}
        try {
          if (!isInstagramPrivate && (isCurtidasContext || isViewsContext)) {
            const kind = isCurtidasContext ? 'likes' : 'views';
            renderSelectedPostsPreview(kind);
          }
        } catch(_) {}
        try { updatePedidoButtonState(); } catch(_) {}
        
        // Marcar ativo
        const cards = planCards.querySelectorAll('.service-card[data-role="plano"]');
        cards.forEach(c => c.classList.toggle('active', c === card));
        
        // Ir para Step 2
        if (window.goToStep) window.goToStep(2);
      });
      planCards.appendChild(card);
    });
  }

  function getTipoDescription(tipo) {
    let html = '';
    switch (tipo) {
      case 'visualizacoes_reels':
        html = `
          <p>Real view packages to boost the reach of your videos and Reels. Ideal for increasing delivery, engagement, and social proof on strategic content.</p>
          <ul>
            <li>🚀 <strong>More reach:</strong> increases your Reels views quickly.</li>
            <li>🎯 <strong>Results-focused:</strong> designed to help content perform better.</li>
            <li>✅ <strong>Safe delivery:</strong> stable service with tracking and support.</li>
          </ul>
        `;
        break;
      case 'mistos':
        html = isCurtidasContext ? `
          <p>Likes with fast, stable delivery to boost your posts.</p>
          <ul>
            <li>✅ 100% safe and confidential, no password required.</li>
            <li>🌍 Likes from international profiles to improve social proof.</li>
            <li>📈 Great for giving strategic content an initial boost.</li>
          </ul>
        ` : `
          <p>Mixed profiles with fast, stable delivery from multiple countries.</p>
          <ul>
            <li>✅ 100% safe and confidential, no password required.</li>
            <li>🌍 Followers from multiple countries to grow your base.</li>
            <li>🛠 Refill tool: don’t lose followers.</li>
          </ul>
        `;
        break;
      case 'brasileiros':
      case 'curtidas_brasileiras':
        html = isCurtidasContext ? `
          <p>Local-profile likes to boost your posts.</p>
          <ul>
            <li>✅ 100% safe and confidential, no password required.</li>
            <li>📍 Local profiles to strengthen social proof.</li>
            <li>📈 Great for posts you want to highlight.</li>
          </ul>
        ` : `
          <p>Local follower base with profile names aligned to your audience.</p>
          <ul>
            <li>✅ 100% safe and confidential, no password required.</li>
            <li>📍 Audience-aligned for stronger credibility.</li>
            <li>🛠 Refill tool: don’t lose followers.</li>
          </ul>
        `;
        break;
      case 'organicos':
        html = isCurtidasContext ? `
          <p>Real local-profile likes for maximum quality and credibility on your posts.</p>
          <ul>
            <li>✅ 100% safe and confidential, no password required.</li>
            <li>✨ Higher-quality profiles to strengthen authority.</li>
            <li>📈 Great for posts you want to highlight with more authority.</li>
          </ul>
        ` : `
          <p>Real, higher-quality profiles selected for stronger credibility.</p>
          <ul>
            <li>✅ 100% safe and confidential, no password required.</li>
            <li>✨ Higher-quality profiles to strengthen profile authority.</li>
            <li>📉 Low drop rate.</li>
          </ul>
        `;
        break;
      default:
        return '';
    }

    return html;
  }

  function renderTipoDescription(tipo) {
    const descCard = document.getElementById('tipoDescCard');
    const titleEl = document.getElementById('tipoDescTitle');
    const contentEl = document.getElementById('tipoDescContent');
    if (!descCard || !titleEl || !contentEl) return;

    titleEl.textContent = 'Service description';
    contentEl.innerHTML = getTipoDescription(tipo);
    descCard.style.display = 'block';
  }

  // --- Lógica de Promoções (Checkout Reference) ---

  function renderPromoPrices() {
    const blocks = document.querySelectorAll('.promo-prices');
    blocks.forEach(b => {
      const key = b.getAttribute('data-promo');
      if (key === 'likes' || key === 'views' || key === 'comments' || key === 'warranty60') return;
      const conf = promoPricing[key];
      if (!conf) return;
      const oldEl = b.querySelector('.old-price');
      const newEl = b.querySelector('.new-price');
      const discEl = b.querySelector('.discount-badge');
      if (oldEl) oldEl.textContent = conf.old;
      if (newEl) newEl.textContent = conf.price;
      if (discEl) discEl.textContent = `${conf.discount}% OFF`;
    });
  }

  function applyWarrantyMode() {
    const isLife = true;
    const wLabel = document.getElementById('warrantyModeLabel');
    const wHighlight = document.getElementById('warrantyHighlight');
    const wOld = document.getElementById('warrantyOldPrice');
    const wNew = document.getElementById('warrantyNewPrice');
    const wDisc = document.getElementById('warrantyDiscount');

    if (wLabel) wLabel.textContent = '6 months';
    if (wHighlight) wHighlight.textContent = '6-MONTH REPLACEMENT';
    if (wOld) wOld.textContent = '$ 39.90';
    if (wNew) wNew.textContent = '$ 9.90';
    if (wDisc) wDisc.textContent = '75% OFF';
    updatePromosSummary();
  }

  function stepWarranty(delta) {
    const next = (warrantyMode === '30' && delta > 0) ? 'life' : (warrantyMode === 'life' && delta < 0) ? '30' : warrantyMode;
    if (next !== warrantyMode) { applyWarrantyMode(); }
  }

  const wDec = document.getElementById('warrantyModeDec');
  const wInc = document.getElementById('warrantyModeInc');
  if (wDec) wDec.addEventListener('click', () => stepWarranty(-1));
  if (wInc) wInc.addEventListener('click', () => stepWarranty(1));

  function updateWarrantyVisibility(tipo) {
    const warrantyItem = document.querySelector('.promo-item.warranty60');
    if (!warrantyItem) return;
    
    // Mostrar apenas para seguidores mistos (mundiais) e brasileiros
    if (tipo === 'mistos' || tipo === 'brasileiros' || tipo === 'curtidas_brasileiras') {
        warrantyItem.style.display = '';
    } else {
        warrantyItem.style.display = 'none';
        const cb = document.getElementById('promoWarranty60');
        if (cb && cb.checked) {
             cb.checked = false;
             updatePromosSummary();
        }
    }
  }

  function updateOrderBump(tipo, baseQtd) {
    updateWarrantyVisibility(tipo);
    if (!orderInline) return;
    const unit = getUnitForTipo(tipo);
    const labelSpan = document.getElementById('orderBumpText');
    const checkbox = document.getElementById('orderBumpCheckboxInline');
    const upgradePrices = document.querySelector('.promo-prices[data-promo="upgrade"]');
    const upOld = upgradePrices ? upgradePrices.querySelector('.old-price') : null;
    const upNew = upgradePrices ? upgradePrices.querySelector('.new-price') : null;
    const upDisc = upgradePrices ? upgradePrices.querySelector('.discount-badge') : null;
    const upHighlight = document.getElementById('orderBumpHighlight');
    const curtidasSeal = isCurtidasContext ? (quantityBadges[Number(baseQtd)] || '') : '';

    // Upgrades específicos para visualizações de Reels
    if (tipo === 'visualizacoes_reels' && baseQtd) {
      orderInline.style.display = 'block';
      if (checkbox) checkbox.checked = false;

      const upsellViewsTargets = {
        1000: 2500,
        5000: 10000,
        25000: 50000,
        100000: 150000,
        200000: 250000,
        500000: 1000000
      };

      const targetQtdViews = upsellViewsTargets[Number(baseQtd)];
      if (!targetQtdViews) {
        if (labelSpan) labelSpan.textContent = 'No upgrade available for this package.';
        if (upOld) upOld.textContent = '—';
        if (upNew) upNew.textContent = '—';
        if (upDisc) upDisc.textContent = 'OFFER';
        return;
      }

      const basePriceViews = findPrice(tipo, baseQtd);
      const targetPriceViews = findPrice(tipo, targetQtdViews);

      if (!basePriceViews || !targetPriceViews) {
        if (labelSpan) labelSpan.textContent = 'No upgrade available for this package.';
        if (upOld) upOld.textContent = '—';
        if (upNew) upNew.textContent = '—';
        if (upDisc) upDisc.textContent = 'OFFER';
        return;
      }

      const diffCentsViews = parsePrecoToCents(targetPriceViews) - parsePrecoToCents(basePriceViews);
      const addQtdViews = targetQtdViews - baseQtd;
      const diffStrViews = formatCentsToBRL(diffCentsViews);

      if (labelSpan) labelSpan.textContent = `For ${diffStrViews} more, add ${addQtdViews} ${unit} and upgrade to ${targetQtdViews}.`;
      if (upHighlight) upHighlight.textContent = `+ ${addQtdViews} ${unit}`;
      if (upOld) upOld.textContent = targetPriceViews || '—';
      if (upNew) upNew.textContent = diffStrViews;
      if (upDisc) {
        const targetCentsViews = parsePrecoToCents(targetPriceViews);
        const pctViews = targetCentsViews ? Math.round(((targetCentsViews - diffCentsViews) / targetCentsViews) * 100) : 0;
        upDisc.textContent = `${pctViews}% OFF`;
      }
      return;
    }

    const isUpgradeEligible = isFollowersTipo(tipo) || (isCurtidasContext && tipo === 'curtidas_brasileiras');
    if (!isUpgradeEligible || !baseQtd) { orderInline.style.display = 'none'; return; }
    orderInline.style.display = 'block';
    if (checkbox) checkbox.checked = false;

    // Promos específicas: 1000 -> 2000 com extras para brasileiros/organicos
    if ((tipo === 'brasileiros' || tipo === 'curtidas_brasileiras' || tipo === 'organicos') && Number(baseQtd) === 1000) {
      const targetQtd = 2000;
      const basePrice = findPrice(tipo, 1000);
      const targetPrice = findPrice(tipo, 2000);
      const diffCents = parsePrecoToCents(targetPrice) - parsePrecoToCents(basePrice);
      const diffStr = formatCentsToBRL(diffCents);
    if (labelSpan) labelSpan.textContent = `For ${diffStr} more, upgrade to ${targetQtd} ${unit}.`;
      if (upHighlight) upHighlight.textContent = `+ ${targetQtd - 1000} ${unit}${curtidasSeal ? ` • ${curtidasSeal}` : ''}`;
      if (upOld) upOld.textContent = targetPrice || '—';
      if (upNew) upNew.textContent = diffStr;
      if (upDisc) {
        const targetCents = parsePrecoToCents(targetPrice);
        const pct = targetCents ? Math.round(((targetCents - diffCents) / targetCents) * 100) : 0;
        upDisc.textContent = `${pct}% OFF`;
      }
      return;
    }

    // Upgrade genérico para demais pacotes
    const upsellTargets = { 
      150: 300, 300: 500, 500: 700, 700: 1000, 
      1000: 2000, 1200: 2000, 2000: 3000, 3000: 4000, 4000: 5000, 
      5000: 7500, 7500: 10000, 10000: 15000 
    };
    const targetQtd = upsellTargets[Number(baseQtd)];
    if (!targetQtd) {
      if (labelSpan) labelSpan.textContent = 'No upgrade available for this package.';
      if (upOld) upOld.textContent = '—';
      if (upNew) upNew.textContent = '—';
      if (upDisc) upDisc.textContent = 'OFFER';
      return;
    }
    const basePrice = findPrice(tipo, baseQtd);
    const targetPrice = findPrice(tipo, targetQtd);
    const diffCents = parsePrecoToCents(targetPrice) - parsePrecoToCents(basePrice);
    const addQtd = targetQtd - baseQtd;
    const diffStr = formatCentsToBRL(diffCents);
    if (labelSpan) labelSpan.textContent = `For ${diffStr} more, add ${addQtd} ${unit} and upgrade to ${targetQtd}.`;
    if (upHighlight) upHighlight.textContent = `+ ${addQtd} ${unit}${curtidasSeal ? ` • ${curtidasSeal}` : ''}`;
    if (upOld) upOld.textContent = targetPrice || '—';
    if (upNew) upNew.textContent = diffStr;
    if (upDisc) {
      const targetCents = parsePrecoToCents(targetPrice);
      const pct = targetCents ? Math.round(((targetCents - diffCents) / targetCents) * 100) : 0;
      upDisc.textContent = `${pct}% OFF`;
    }
  }

  let likesTable = [];
  const likesQtyEl = document.getElementById('likesQty');
  const likesDec = document.getElementById('likesDec');
  const likesInc = document.getElementById('likesInc');
  const likesPrices = document.querySelector('.promo-prices[data-promo="likes"]');
  function formatCurrencyBR(n) { return `R$ ${n.toFixed(2).replace('.', ',')}`; }
  function parseCurrencyBR(s) { const cleaned = String(s).replace(/[R$\s]/g, '').replace('.', '').replace(',', '.'); const val = parseFloat(cleaned); return isNaN(val) ? 0 : val; }
  function getLikesVariantKey() {
    const tipo = String((tipoSelect && tipoSelect.value) || '').toLowerCase();
    if (tipo === 'organicos') return 'organicos';
    if (tipo === 'curtidas_brasileiras') return 'curtidas_brasileiras';
    return 'mistos';
  }
  function refreshLikesTable() {
    try {
      const key = getLikesVariantKey();
      const src = (tabelaCurtidas && tabelaCurtidas[key]) ? tabelaCurtidas[key] : null;
      likesTable = Array.isArray(src) ? src.map(x => ({ q: Number(x.q), price: String(x.p || '') })).filter(x => !!x.q && !!x.price) : [];
    } catch (_) {
      likesTable = [];
    }
    if (!Array.isArray(likesTable) || likesTable.length === 0) {
      likesTable = [
        { q: 150, price: '$ 1.99' },
        { q: 300, price: '$ 2.99' },
        { q: 500, price: '$ 3.99' },
        { q: 700, price: '$ 4.99' },
        { q: 1000, price: '$ 5.99' },
        { q: 2000, price: '$ 7.99' },
        { q: 3000, price: '$ 9.99' },
        { q: 4000, price: '$ 11.99' },
        { q: 5000, price: '$ 13.99' },
        { q: 7500, price: '$ 16.99' },
        { q: 10000, price: '$ 19.99' },
        { q: 15000, price: '$ 24.99' }
      ];
    }
    try {
      const current = Number(likesQtyEl?.textContent || 150);
      const exists = likesTable.some(e => Number(e.q) === current);
      if (!exists && likesQtyEl && likesTable[0]) likesQtyEl.textContent = String(likesTable[0].q);
    } catch (_) {}
  }
  function applyLikesPromoVariant() {
    const titleEl = document.querySelector('.promo-item.likes .promo-title');
    const descEl = document.querySelector('.promo-item.likes .promo-desc');
    if (!titleEl && !descEl) return;
    const tipo = String((tipoSelect && tipoSelect.value) || '').toLowerCase();
    const variant = (function(t){
      if (t === 'organicos') return { title: 'Organic likes add-on', desc: 'Add real local organic likes to the post.' };
      if (t === 'brasileiros' || t === 'curtidas_brasileiras') return { title: 'Local likes add-on', desc: 'Add local-profile likes to the post.' };
      if (t === 'mistos') return { title: 'Mixed likes add-on', desc: 'Add mixed-profile likes to the post.' };
      return { title: 'Likes add-on', desc: 'Add likes to the post.' };
    })(tipo);
    if (titleEl) titleEl.textContent = variant.title;
    if (descEl) descEl.textContent = variant.desc;
  }
  function updateLikesPrice(q) {
    const entry = likesTable.find(e => e.q === q);
    const newEl = likesPrices ? likesPrices.querySelector('.new-price') : null;
    const oldEl = likesPrices ? likesPrices.querySelector('.old-price') : null;
    if (newEl && entry) {
      const newCents = parsePrecoToCents(entry.price);
      newEl.textContent = formatCentsToBRL(newCents);
    }
    if (oldEl && entry) {
      const newCents = parsePrecoToCents(entry.price);
      const oldCents = Math.round(newCents * 1.70);
      oldEl.textContent = formatCentsToBRL(oldCents);
    }
    const hl = document.querySelector('.promo-item.likes .promo-highlight');
    if (hl) {
      const tipo = String((tipoSelect && tipoSelect.value) || '').toLowerCase();
      if (tipo === 'organicos') hl.textContent = `+ ${q} ORGANIC LIKES`;
      else if (tipo === 'brasileiros' || tipo === 'curtidas_brasileiras') hl.textContent = `+ ${q} LOCAL LIKES`;
      else if (tipo === 'mistos') hl.textContent = `+ ${q} MIXED LIKES`;
      else hl.textContent = `+ ${q} LIKES`;
    }
    try { applyLikesPromoVariant(); } catch(_) {}
  }
  function stepLikes(dir) {
    const current = Number(likesQtyEl?.textContent || 150);
    const idx = likesTable.findIndex(e => e.q === current);
    let nextIdx = idx >= 0 ? idx + dir : 0;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= likesTable.length) nextIdx = likesTable.length - 1;
    const next = likesTable[nextIdx].q;
    if (likesQtyEl) likesQtyEl.textContent = String(next);
    updateLikesPrice(next);
    try { updatePromosSummary(); } catch(_) {}
  }
  if (likesDec) likesDec.addEventListener('click', (e) => { if (e && typeof e.stopPropagation==='function') e.stopPropagation(); stepLikes(-1); });
  if (likesInc) likesInc.addEventListener('click', (e) => { if (e && typeof e.stopPropagation==='function') e.stopPropagation(); stepLikes(1); });
  try { refreshLikesTable(); } catch(_) {}
  if (likesQtyEl) updateLikesPrice(Number(likesQtyEl.textContent || 150));

  const viewsTable = [
    { q: 1000, price: '$ 1.99' },
    { q: 2500, price: '$ 2.99' },
    { q: 5000, price: '$ 3.99' },
    { q: 10000, price: '$ 5.99' },
    { q: 25000, price: '$ 7.99' },
    { q: 50000, price: '$ 9.99' },
    { q: 100000, price: '$ 14.99' },
    { q: 150000, price: '$ 16.99' },
    { q: 200000, price: '$ 19.99' },
    { q: 250000, price: '$ 24.99' },
    { q: 500000, price: '$ 29.99' },
    { q: 1000000, price: '$ 39.99' }
  ];
  const viewsQtyEl = document.getElementById('viewsQty');
  const viewsDec = document.getElementById('viewsDec');
  const viewsInc = document.getElementById('viewsInc');
  const viewsPrices = document.querySelector('.promo-prices[data-promo="views"]');
  function updateViewsPrice(q) {
    const entry = viewsTable.find(e => e.q === q);
    const newEl = viewsPrices ? viewsPrices.querySelector('.new-price') : null;
    const oldEl = viewsPrices ? viewsPrices.querySelector('.old-price') : null;
    if (newEl && entry) newEl.textContent = entry.price;
    if (oldEl && entry) {
      const newCents = parsePrecoToCents(entry.price);
      const oldCents = Math.round(newCents / 0.7);
      oldEl.textContent = formatCentsToBRL(oldCents);
    }
    const hl = document.querySelector('.promo-item.views .promo-highlight');
    if (hl) hl.textContent = `+ ${q} VIEWS`;
  }
  function stepViews(dir) {
    const current = Number(viewsQtyEl?.textContent || 1000);
    const idx = viewsTable.findIndex(e => e.q === current);
    let nextIdx = idx >= 0 ? idx + dir : 0;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= viewsTable.length) nextIdx = viewsTable.length - 1;
    const next = viewsTable[nextIdx].q;
    if (viewsQtyEl) viewsQtyEl.textContent = String(next);
    updateViewsPrice(next);
    try { updatePromosSummary(); } catch(_) {}
  }
  if (viewsDec) viewsDec.addEventListener('click', (e) => { if (e && typeof e.stopPropagation==='function') e.stopPropagation(); stepViews(-1); });
  if (viewsInc) viewsInc.addEventListener('click', (e) => { if (e && typeof e.stopPropagation==='function') e.stopPropagation(); stepViews(1); });
  if (viewsQtyEl) updateViewsPrice(Number(viewsQtyEl.textContent || 1000));

  const commentsQtyEl = document.getElementById('commentsQty');
  const commentsDec = document.getElementById('commentsDec');
  const commentsInc = document.getElementById('commentsInc');
  const commentsPrices = document.querySelector('.promo-prices[data-promo="comments"]');

  function updateCommentsPrice(q) {
    const newEl = commentsPrices ? commentsPrices.querySelector('.new-price') : null;
    const oldEl = commentsPrices ? commentsPrices.querySelector('.old-price') : null;
    
    if (newEl) newEl.textContent = formatCentsToBRL(q * 150);
    if (oldEl) { const oldCents = (q * 150) * 1.7; oldEl.textContent = formatCentsToBRL(oldCents); }
    const hl = document.querySelector('.promo-item.comments .promo-highlight');
    if (hl) hl.textContent = `+ ${q} COMMENTS`;
  }

  function stepComments(dir) {
    const current = Number(commentsQtyEl?.textContent || 1);
    let next = current + dir;
    if (next < 1) next = 1;
    if (next > 100) next = 100;
    if (commentsQtyEl) commentsQtyEl.textContent = String(next);
    updateCommentsPrice(next);
    try { updatePromosSummary(); } catch(_) {}
  }

  if (commentsDec) commentsDec.addEventListener('click', (e) => { if (e && typeof e.stopPropagation==='function') e.stopPropagation(); stepComments(-1); });
  if (commentsInc) commentsInc.addEventListener('click', (e) => { if (e && typeof e.stopPropagation==='function') e.stopPropagation(); stepComments(1); });
  if (commentsQtyEl) updateCommentsPrice(Number(commentsQtyEl.textContent || 1));

  function getSelectedPromos() {
    const promos = [];
    try {
      const likesChecked = !!document.getElementById('promoLikes')?.checked;
      const viewsChecked = !!document.getElementById('promoViews')?.checked;
      const commentsChecked = !!document.getElementById('promoComments')?.checked;
      const warrantyChecked = !!document.getElementById('promoWarranty60')?.checked;
      const upgradeChecked = !!document.getElementById('orderBumpCheckboxInline')?.checked;
      
      if (likesChecked) {
        const qty = Number(document.getElementById('likesQty')?.textContent || 150);
        let priceStr = document.querySelector('.promo-prices[data-promo="likes"] .new-price')?.textContent || '';
        if (!priceStr) priceStr = promoPricing.likes?.price || '';
        const tipo = String((tipoSelect && tipoSelect.value) || '').toLowerCase();
        const label = (function(t){
          if (t === 'organicos') return `Organic likes (${qty})`;
          if (t === 'brasileiros' || t === 'curtidas_brasileiras') return `Local likes (${qty})`;
          if (t === 'mistos') return `Mixed likes (${qty})`;
          return `Likes (${qty})`;
        })(tipo);
        promos.push({ key: 'likes', qty, label, priceCents: parsePrecoToCents(priceStr) });
      }
      if (viewsChecked) {
        const qty = Number(document.getElementById('viewsQty')?.textContent || 1000);
        let priceStr = document.querySelector('.promo-prices[data-promo="views"] .new-price')?.textContent || '';
        if (!priceStr) priceStr = promoPricing.views?.price || '';
        promos.push({ key: 'views', qty, label: `Reels views (${qty})`, priceCents: parsePrecoToCents(priceStr) });
      }
      if (commentsChecked) {
        const qty = Number(document.getElementById('commentsQty')?.textContent || 1);
        const priceCents = qty * 150; // R$ 1,50 (150 cents)
        promos.push({ key: 'comments', qty, label: `Comments (${qty})`, priceCents });
      }
      if (warrantyChecked) {
        const mode = (typeof window.warrantyMode === 'string') ? window.warrantyMode : '30';
        let priceStr = (document.getElementById('warrantyNewPrice')?.textContent || '').trim();
        if (!priceStr) priceStr = promoPricing.warranty60?.price || '$ 9.90';
        const label = '6-month replacement';
        promos.push({ key: 'warranty_6m', qty: 1, label, priceCents: parsePrecoToCents(priceStr) });
      }
      if (upgradeChecked) {
        let priceStr = document.querySelector('.promo-prices[data-promo="upgrade"] .new-price')?.textContent || '';
        const highlight = document.getElementById('orderBumpHighlight')?.textContent || '';
        promos.push({ key: 'upgrade', qty: 1, label: `Package upgrade ${highlight ? `(${highlight})` : ''}`.trim(), priceCents: parsePrecoToCents(priceStr) });
      }
    } catch (_) {}
    return promos;
  }

  function calcPromosTotalCents(promos) {
    try { return (Array.isArray(promos) ? promos : []).reduce((acc, p) => acc + (Number(p.priceCents) || 0), 0); } catch (_) { return 0; }
  }

  function updatePromosSummary() {
    showResumoIfAllowed();
    
    // Atualiza header de quantidade (Bug fix)
    const headerQty = document.getElementById('headerSelectedQty');
    if (headerQty && resQtd && resQtd.textContent) {
      headerQty.textContent = resQtd.textContent;
    }
    
    try { updateReviewMath(); } catch(_) {}

    let baseCents = basePriceCents || 0;
    
    // Calcula preço base original (com margem para dar desconto)
    // No renderPlanCards usamos base * 1.15. Vamos recalcular.
    const baseVal = baseCents / 100;
    const inc = baseVal * 1.15;
    const ceilInt = Math.ceil(inc);
    const increasedRounded = (ceilInt - 0.10);
    let baseOriginalCents = Math.round(increasedRounded * 100);

    const promos = getSelectedPromos();
    
    // Renderiza lista de order bumps
    const resPromosContainer = document.getElementById('resPromosContainer');
    const resPromos = document.getElementById('resPromos');
    if (resPromos && resPromosContainer) {
        if (promos.length > 0) {
            resPromosContainer.style.display = 'block';
            
            // Header "Selected add-ons:"
            let html = '<div style="font-weight:600; margin-bottom:-4px; padding-bottom:0; color:var(--text-primary); line-height:1.2; margin-top:0.5rem;">Selected add-ons:</div>';
            
            html += promos.map((p, index) => {
                // Tenta achar preço original do promo
                let oldPriceCents = 0;
                if (p.key === 'upgrade') {
                    // Tenta pegar do DOM
                    const upOld = document.querySelector('.promo-prices[data-promo="upgrade"] .old-price');
                    if (upOld) oldPriceCents = parsePrecoToCents(upOld.textContent);
                    else oldPriceCents = p.priceCents * 1.5; 
                } else if (p.key === 'comments') {
                   // Comments old = current * 1.7
                   oldPriceCents = p.priceCents * 1.7;
                } else {
                   // Likes, Views, Warranty
                   const conf = promoPricing[p.key === 'warranty30' ? 'warranty' : (p.key === 'warranty_lifetime' ? 'warranty' : (p.key === 'warranty_6m' ? 'warranty' : p.key))];
                   if (conf) oldPriceCents = parsePrecoToCents(conf.old);
                   else if (p.key === 'warranty_lifetime') oldPriceCents = 12990; // R$ 129,90
                   else if (p.key === 'warranty_6m') oldPriceCents = 12990; // R$ 129,90
                   else if (p.key === 'warranty30') oldPriceCents = 3990; // R$ 39,90
                }
                // Adiciona ao total original
                baseOriginalCents += (oldPriceCents || p.priceCents);
                
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

    const promosTotal = calcPromosTotalCents(promos);
    let totalCents = Math.max(0, Number(baseCents) + promosTotal);

    // Apply Coupon (Display)
    if (window.couponDiscount && window.couponDiscount > 0) {
        // Recalculate based on total
        const discountVal = Math.round(totalCents * window.couponDiscount);
        totalCents -= discountVal;
    }

    try {
      const method = String(window.currentPaymentMethod || '').trim();
      if (method === 'credit_card') {
        const provider = String(window.CARD_PROVIDER || 'pagarme').trim().toLowerCase();
        if (provider !== 'stripe') {
          try { populateInstallments(totalCents); } catch(_) {}
          const cap = capInstallmentsBySubtotal(totalCents);
          const inst = Math.max(1, Math.min(cap, getSelectedInstallments()));
          const rate = cardSurchargeRate(inst);
          totalCents = Math.round(totalCents * (1 + Math.max(0, rate) / 100));
        }
      }
    } catch(_) {}
    
    // Atualiza Total Final com Desconto
    if (resTotalFinal) {
        const totalOriginal = baseOriginalCents; // Soma de todos os originais
        const totalCurrent = totalCents;
        
        let discountPct = 0;
        if (totalOriginal > totalCurrent) {
            discountPct = Math.round(((totalOriginal - totalCurrent) / totalOriginal) * 100);
        }
        
        // HTML Rico
        const isMobile = window.innerWidth <= 640;
        const totalOriginalBrl = formatCentsToBRL(totalOriginal);
        const totalCurrentBrl = formatCentsToBRL(totalCurrent);
        
        if (isMobile) {
            // Mobile: Alinhado à esquerda, em duas linhas
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
            // Desktop: Layout original (uma linha, flex-end)
            resTotalFinal.innerHTML = `
                <div class="promo-prices" style="justify-content: flex-end; display: flex; align-items: center; gap: 0.5rem;">
                    <span class="old-price">${totalOriginalBrl}</span>
                    <span class="discount-badge">${discountPct}% OFF</span>
                    <span class="new-price">${totalCurrentBrl}</span>
                </div>
            `;
        }
    }

    try {
      if (String(window.currentPaymentMethod || '').trim() === 'credit_card') {
        populateInstallments(calculateSubtotalCents());
      }
    } catch(_) {}
    try { scheduleStripeEmbeddedCheckoutRefresh(); } catch(_) {}
  }

  // --- Funções de Post Select Modal ---

  function getPostModalRefs() {
    return {
      postModal: document.getElementById('postSelectModal'),
      postModalGrid: document.getElementById('postModalGrid'),
      postModalTitle: document.getElementById('postModalTitle'),
      postModalClose: document.getElementById('postModalClose'),
    };
  }

  function ensureSpinnerCSS() {
    if (document.getElementById('oppusSpinnerStyles')) return;
    const style = document.createElement('style');
    style.id = 'oppusSpinnerStyles';
    style.textContent = "@keyframes oppusSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} .oppus-spinner{width:32px;height:32px;border:4px solid rgba(255,255,255,0.25);border-top-color:#7c3aed;border-radius:50%;animation:oppusSpin 1s linear infinite} .oppus-spinner-wrap{grid-column:1/-1;display:flex;justify-content:center;align-items:center;gap:8px;padding:24px;color:var(--text-secondary)}";
    document.head.appendChild(style);
  }

  function spinnerHTML() { ensureSpinnerCSS(); return '<div class="oppus-spinner-wrap"><div class="oppus-spinner"></div><span>Carregando...</span></div>'; }

  let cachedPosts = null;
  let cachedPostsUser = '';
  let postModalOpenLock = false;
  let suppressOpenPostModalOnce = false;
  let postModalAppendMode = false;

  function getSplitMaxForQtd(qtd) {
    const n0 = Number(qtd) || 0;
    if (isViewsContext) {
      let n = n0;
      try {
        const tipoNow = (tipoSelect && tipoSelect.value) ? String(tipoSelect.value) : '';
        if (tipoNow === 'visualizacoes_reels') {
          n = getEffectiveQtdForSplit(tipoNow, n0);
        }
      } catch(_) {}
      if (n >= 250000) return 5;
      if (n >= 200000) return 4;
      if (n >= 150000) return 3;
      if (n >= 50000) return 2;
      return 1;
    }
    if (n0 >= 5000) return 10;
    if (n0 === 1000) return 4;
    if (n0 === 500) return 2;
    return 1;
  }
  
  function isMultiPostSplitEnabled(kind) {
    if (isInstagramPrivate) return false;
    if (isCurtidasContext && kind === 'likes') return true;
    if (isViewsContext && kind === 'views') return true;
    return false;
  }
  
  function getUpgradeAddForSplit(tipo, baseQtd) {
    const cb = document.getElementById('orderBumpCheckboxInline');
    if (!cb || !cb.checked) return 0;
    const q = Number(baseQtd) || 0;
    if (!q) return 0;
    
    if (isViewsContext && String(tipo || '') === 'visualizacoes_reels') {
      const targets = { 1000: 2500, 5000: 10000, 25000: 50000, 100000: 150000, 200000: 250000, 500000: 1000000 };
      const targetQtd = targets[q] || 0;
      return targetQtd > q ? (targetQtd - q) : 0;
    }
    
    if (isCurtidasContext && (/brasileir/i.test(String(tipo || '')) || String(tipo || '') === 'curtidas_brasileiras')) {
      const map = { 150: 150, 500: 200, 1000: 1000 };
      return map[q] || 0;
    }
    
    return 0;
  }
  
  function getEffectiveQtdForSplit(tipo, baseQtd) {
    return Math.max(0, Number(baseQtd) + Number(getUpgradeAddForSplit(tipo, baseQtd)));
  }

  function getAllowedSplitCounts(qtd, maxCount) {
    const n = Number(qtd) || 0;
    const maxN = Math.max(1, Number(maxCount) || 1);
    const out = [];
    const upper = n > 0 ? Math.min(maxN, n) : maxN;
    for (let i = 1; i <= upper; i++) out.push(i);
    return out.length ? out : [1];
  }

  function openPostModal(kind, opts) {
    if (postModalOpenLock) return;
    if (isInstagramPrivate && ((isCurtidasContext && kind === 'likes') || (isViewsContext && kind === 'views'))) return;
    postModalOpenLock = true;
    setTimeout(function(){ postModalOpenLock = false; }, 600);
    const refs = getPostModalRefs();
    if (!refs.postModal || !refs.postModalGrid) return;
    postModalAppendMode = !!(opts && opts.append) && isMultiPostSplitEnabled(kind);
    
    const user = (checkoutProfileUsername && checkoutProfileUsername.textContent && checkoutProfileUsername.textContent.trim()) || '';
    if (!user) {
        showStatusMessageCheckout('Verify your profile first.', 'error');
        return;
    }
    
    if (postModalAppendMode) {
      const qtd = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
      const maxCount = getSplitMaxForQtd(qtd);
      const curList = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[kind])
        ? window.__oppusSelectedPostsByKind[kind]
        : [];
      if (curList.length >= maxCount) {
        showStatusMessageCheckout('Post limit reached for this package.', 'error');
        return;
      }
    }

    if (refs.postModalTitle) refs.postModalTitle.textContent = kind === 'views' ? 'Select Reels' : 'Select post';
    try {
      if (refs.postModal.parentNode !== document.body) {
        document.body.appendChild(refs.postModal);
      }
    } catch(_) {}
    try { document.body.style.overflow = 'hidden'; } catch(_) {}
    refs.postModal.style.display = 'flex';
    try {
      const dlg = refs.postModal.querySelector('.modal-dialog');
      if (dlg && typeof dlg.scrollIntoView === 'function') { dlg.scrollIntoView({ block: 'center', inline: 'center' }); }
    } catch(_) {}

    refs.postModalGrid.innerHTML = spinnerHTML();

    const renderFrom = function(arr) {
      const selectedNow = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[kind])
        ? window.__oppusSelectedPostsByKind[kind]
        : [];
      const items = (Array.isArray(arr) ? arr : []).filter(p => {
        // Relax filter for views to allow any video-like content
        if (kind === 'views') {
             const isVid = !!p.isVideo || (String(p.typename||'').toLowerCase().includes('video') || String(p.typename||'').toLowerCase().includes('clip'));
             // Fallback: se não tiver isVideo mas tiver media_type == 2 (GraphVideo)
             const isMediaTypeVideo = (p.media_type === 2);
             return isVid || isMediaTypeVideo;
        }
        return true;
      }).slice(0, 12);

      let headerHtml = '';
      if (isCurtidasContext && kind === 'likes') {
        headerHtml = '<div style="grid-column:1/-1; text-align:center; padding:0.5rem 0 1rem; font-weight:600; color:var(--text-primary);">Select the post you want to receive likes</div>';
      } else if (isViewsContext && kind === 'views') {
        headerHtml = '<div style="grid-column:1/-1; text-align:center; padding:0.5rem 0 1rem; font-weight:600; color:var(--text-primary);">Select the Reels you want to receive views</div>';
      }

      const html = items.map(function(p){
        const alreadySelected = selectedNow.includes(p.shortcode);
        const dsrc = p.displayUrl ? ('/image-proxy?url=' + encodeURIComponent(p.displayUrl)) : null;
        const vsrc = p.videoUrl ? ('/image-proxy?url=' + encodeURIComponent(p.videoUrl)) : null;
        const isVid = p.isVideo || (p.media_type === 2);
        
        const media = (dsrc)
          ? ('<div class="media-frame"><img src="'+dsrc+'" loading="lazy" decoding="async"/></div>')
          : (isVid && vsrc
            ? ('<div class="media-frame"><video data-src="'+vsrc+'" muted playsinline preload="none"></video></div>')
            : ('<div class="media-frame"><iframe src="https://www.instagram.com/p/'+p.shortcode+'/embed" loading="lazy" allowtransparency="true" allow="encrypted-media; picture-in-picture" scrolling="no"></iframe></div>'));
        const pickedClass = alreadySelected ? ' selected-mark' : '';
        const btnText = alreadySelected ? 'Selected' : 'Select';
        const btnStyle = alreadySelected ? 'width:100%; text-align:center; opacity:0.65; cursor:not-allowed;' : 'width:100%; text-align:center;';
        const btnDisabled = alreadySelected ? ' disabled' : '';
        return '<div class="service-card"><div class="card-content pick-post-card'+pickedClass+'" data-kind="'+kind+'" data-shortcode="'+p.shortcode+'">'+media+'<div class="inline-msg" style="margin-top:6px">'+(p.takenAt? new Date(Number(p.takenAt)*1000).toLocaleString('en-US') : '-')+'</div><div style="margin-top:8px;display:flex;justify-content:center;align-items:center;"><button type="button" class="continue-button select-post-btn" style="'+btnStyle+'" data-shortcode="'+p.shortcode+'" data-kind="'+kind+'"'+btnDisabled+'>'+btnText+'</button></div></div></div>';
      }).join('');
      
      if (!html) {
          const manualHtml = `
            <div style="grid-column:1/-1; text-align:center; padding: 1rem;">
                <p style="margin-bottom:0.5rem; color:var(--text-secondary);">We couldn't automatically find compatible recent posts.</p>
                <div style="display:flex; gap:0.5rem; max-width:400px; margin:0 auto;">
                    <input type="text" id="manualPostLinkInput" placeholder="${kind === 'views' ? 'Paste the Reels/Video link here...' : 'Paste the post link here...'}" style="flex:1; padding:0.6rem; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-primary); color:var(--text-primary);" />
                    <button type="button" id="manualPostLinkBtn" class="continue-button" style="padding:0.6rem 1rem;">Use Link</button>
                </div>
                <div id="manualLinkMsg" style="margin-top:0.5rem; font-size:0.9rem;"></div>
            </div>
          `;
          refs.postModalGrid.innerHTML = headerHtml + manualHtml;
          setTimeout(() => {
              const btn = document.getElementById('manualPostLinkBtn');
              const inp = document.getElementById('manualPostLinkInput');
              const msg = document.getElementById('manualLinkMsg');
              if(btn && inp) {
                  btn.addEventListener('click', () => {
                      const val = inp.value.trim();
                      if(!val || !val.includes('instagram.com/')) {
                          if(msg) { msg.textContent = 'Invalid link.'; msg.style.color = '#ff4444'; }
                          return;
                      }
                      let sc = '';
                      const m = val.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
                      if(m) sc = m[1];
                      if(!sc) {
                           if(msg) { msg.textContent = 'Invalid link (unable to extract ID).'; msg.style.color = '#ff4444'; }
                           return;
                      }
                      try {
                        if (postModalAppendMode) {
                          const qtd = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
                          const maxCount = getSplitMaxForQtd(qtd);
                          const curList = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[kind]) ? window.__oppusSelectedPostsByKind[kind] : [];
                          if (!curList.includes(sc) && curList.length >= maxCount) {
                            if (msg) { msg.textContent = 'Post limit reached for this package.'; msg.style.color = '#ff4444'; }
                            showStatusMessageCheckout('Post limit reached for this package.', 'error');
                            return;
                          }
                        }
                      } catch(_) {}
                      const user2 = (checkoutProfileUsername && checkoutProfileUsername.textContent && checkoutProfileUsername.textContent.trim()) || '';
                      fetch('/api/instagram/select-post-for', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user2, shortcode: sc, kind: kind, mode: (postModalAppendMode ? 'append' : 'replace') }) })
                        .then(r=>r.json())
                        .then(function(){ 
                            if (typeof updateSelectedPostPreview === 'function') {
                                try { updateSelectedPostPreview(kind, sc, { append: postModalAppendMode }); } catch(_) {}
                            }
                            if(msg) { msg.textContent = 'Link selected!'; msg.style.color = '#44ff44'; }
                            setTimeout(() => {
                                const refs = getPostModalRefs(); 
                                if(refs.postModal) refs.postModal.style.display='none';
                                try { document.body.style.overflow=''; } catch(_) {}
                            }, 500);
                        });
                  });
              }
          }, 100);
      } else {
          refs.postModalGrid.innerHTML = headerHtml + html;
      }

      const highlightSelectedMany = function(kind, list) {
        try {
          const cards = Array.from(refs.postModalGrid.querySelectorAll('.card-content'));
          cards.forEach(function(c){ c.classList.remove('selected-mark'); });
          (Array.isArray(list) ? list : []).forEach(function(sc){
            const target = refs.postModalGrid.querySelector('.card-content[data-shortcode="'+sc+'"]');
            if (target) target.classList.add('selected-mark');
          });
        } catch(_) {}
      };
      
      Array.from(refs.postModalGrid.querySelectorAll('.select-post-btn')).forEach(function(btn){
        btn.addEventListener('click', function(e){
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          const sc = this.getAttribute('data-shortcode');
          const k = this.getAttribute('data-kind');
          try {
            if (postModalAppendMode) {
              const curList0 = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[k]) ? window.__oppusSelectedPostsByKind[k] : [];
              if (curList0.includes(sc)) {
                showStatusMessageCheckout('This post is already selected. Choose another one.', 'error');
                return;
              }
            }
            if (postModalAppendMode) {
              const qtd = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
              const maxCount = getSplitMaxForQtd(qtd);
              const curList = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[k]) ? window.__oppusSelectedPostsByKind[k] : [];
              if (!curList.includes(sc) && curList.length >= maxCount) {
                showStatusMessageCheckout('Post limit reached for this package.', 'error');
                return;
              }
            }
          } catch(_) {}
          const user2 = (checkoutProfileUsername && checkoutProfileUsername.textContent && checkoutProfileUsername.textContent.trim()) || '';
          fetch('/api/instagram/select-post-for', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user2, shortcode: sc, kind: k, mode: (postModalAppendMode ? 'append' : 'replace') }) })
            .then(r=>r.json())
            .then(function(){ 
              try {
                if (typeof window.__oppusSelectedPostsByKind === 'object' && window.__oppusSelectedPostsByKind) {
                  const prev = Array.isArray(window.__oppusSelectedPostsByKind[k]) ? window.__oppusSelectedPostsByKind[k] : [];
                  window.__oppusSelectedPostsByKind[k] = postModalAppendMode ? (prev.includes(sc) ? prev : prev.concat([sc])) : [sc];
                }
              } catch(_) {}
              highlightSelectedMany(k, (window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[k]) || [sc]);
              if (typeof updateSelectedPostPreview === 'function') {
                  try { updateSelectedPostPreview(k, sc, { append: postModalAppendMode }); } catch(_) {}
                  try { 
                      const refs2 = getPostModalRefs();
                      if (refs2.postModal) refs2.postModal.style.display = 'none';
                      document.body.style.overflow = '';
                  } catch(_) {}
              }
            });
        });
      });
      
      Array.from(refs.postModalGrid.querySelectorAll('.pick-post-card')).forEach(function(card){
        card.addEventListener('click', function(){
          const sc = this.getAttribute('data-shortcode');
          const k = this.getAttribute('data-kind');
          try {
            if (postModalAppendMode) {
              const curList0 = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[k]) ? window.__oppusSelectedPostsByKind[k] : [];
              if (curList0.includes(sc)) {
                showStatusMessageCheckout('This post is already selected. Choose another one.', 'error');
                return;
              }
            }
            if (postModalAppendMode) {
              const qtd = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
              const maxCount = getSplitMaxForQtd(qtd);
              const curList = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[k]) ? window.__oppusSelectedPostsByKind[k] : [];
              if (!curList.includes(sc) && curList.length >= maxCount) {
                showStatusMessageCheckout('Post limit reached for this package.', 'error');
                return;
              }
            }
          } catch(_) {}
          const user2 = (checkoutProfileUsername && checkoutProfileUsername.textContent && checkoutProfileUsername.textContent.trim()) || '';
          fetch('/api/instagram/select-post-for', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user2, shortcode: sc, kind: k, mode: (postModalAppendMode ? 'append' : 'replace') }) })
            .then(r=>r.json())
            .then(function(){ 
              try {
                if (typeof window.__oppusSelectedPostsByKind === 'object' && window.__oppusSelectedPostsByKind) {
                  const prev = Array.isArray(window.__oppusSelectedPostsByKind[k]) ? window.__oppusSelectedPostsByKind[k] : [];
                  window.__oppusSelectedPostsByKind[k] = postModalAppendMode ? (prev.includes(sc) ? prev : prev.concat([sc])) : [sc];
                }
              } catch(_) {}
              highlightSelectedMany(k, (window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[k]) || [sc]);
              if (typeof updateSelectedPostPreview === 'function') {
                  try { updateSelectedPostPreview(k, sc, { append: postModalAppendMode }); } catch(_) {}
                  try { 
                      const refs2 = getPostModalRefs();
                      if (refs2.postModal) refs2.postModal.style.display = 'none';
                      document.body.style.overflow = '';
                  } catch(_) {}
              }
            });
        });
      });
      
      try {
        fetch('/api/instagram/selected-for')
          .then(r=>r.json())
          .then(function(d){
            const obj = d && d.selectedFor ? d.selectedFor : {};
            const cur = obj[kind] || {};
            const list = Array.isArray(cur.shortcodes) ? cur.shortcodes : (cur.shortcode ? [cur.shortcode] : []);
            try {
              window.__oppusSelectedPostsByKind = window.__oppusSelectedPostsByKind || { likes: [], views: [], comments: [] };
              window.__oppusSelectedPostsByKind[kind] = list;
            } catch(_) {}
            highlightSelectedMany(kind, list);
          });
      } catch(_) {}
    };

    const useCache = !!cachedPosts && cachedPostsUser === user;
    if (useCache) {
      renderFrom(cachedPosts);
    } else {
      const url = '/api/instagram/posts?username=' + encodeURIComponent(user);
      refs.postModalGrid.innerHTML = spinnerHTML();
      fetch(url).then(r=>r.json()).then(d=>{
        const arr = Array.isArray(d.posts) ? d.posts : [];
        cachedPosts = arr; cachedPostsUser = user;
        renderFrom(arr);
      }).catch(function(){
        renderFrom([]);
      });
    }
  }

  // --- Inicialização de Listeners de Promos e Modal ---

  function initPromoListeners() {
    const promoLikes = document.getElementById('promoLikes');
    const promoViews = document.getElementById('promoViews');
    const promoComments = document.getElementById('promoComments');
    
    if (promoLikes) promoLikes.addEventListener('change', function() { if (this.checked) openPostModal('likes'); updatePromosSummary(); });
    if (promoViews) promoViews.addEventListener('change', function() { if (this.checked) openPostModal('views'); updatePromosSummary(); });
    if (promoComments) promoComments.addEventListener('change', function() { if (this.checked) openPostModal('comments'); updatePromosSummary(); });

    // Step Controls - REMOVIDO PARA EVITAR CONFLITO COM LISTENERS DE TABELA
    // Os listeners de stepLikes, stepViews e stepComments já foram definidos anteriormente
    
    // Modal Close
    const refs = getPostModalRefs();
    if (refs.postModalClose) refs.postModalClose.addEventListener('click', () => { if(refs.postModal) refs.postModal.style.display = 'none'; });
    if (document.getElementById('postModalClose2')) document.getElementById('postModalClose2').addEventListener('click', () => { if(refs.postModal) refs.postModal.style.display = 'none'; });
    
    // Checkbox Order Bump
    const obCheck = document.getElementById('orderBumpCheckboxInline');
    if (obCheck) obCheck.addEventListener('change', updatePromosSummary);
    
    // Checkbox Warranty
    const wCheck = document.getElementById('promoWarranty60');
    if (wCheck) wCheck.addEventListener('change', updatePromosSummary);
  }

  // --- Lógica de Verificação de Perfil ---

  // --- Post Modal & Preview Logic ---

  window.__oppusSelectedPostsByKind = window.__oppusSelectedPostsByKind || { likes: [], views: [], comments: [] };

  function renderSelectedPostsPreview(kind) {
      const container = document.getElementById('selectedPostPreview');
      const slot = document.getElementById('selectedPostPreviewContent');
      if (!container || !slot) return;

      const qtd = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
      const splitEnabled = isMultiPostSplitEnabled(kind);
      const maxCount = splitEnabled ? getSplitMaxForQtd(qtd) : 1;
      const tipoNow = (tipoSelect && tipoSelect.value) ? String(tipoSelect.value) : '';
      const qtdEffective = splitEnabled ? getEffectiveQtdForSplit(tipoNow, qtd) : qtd;
      const list = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[kind])
        ? window.__oppusSelectedPostsByKind[kind]
        : [];

      if (!list.length) {
        container.style.display = 'none';
        slot.innerHTML = '';
        return;
      }

      const arr = Array.isArray(cachedPosts) ? cachedPosts : [];
      const fixedH = 320;
      const cardsHtml = list.map(function(code){
        const p = arr.find(x => x && x.shortcode === code);
        const removeBtn = splitEnabled
          ? ('<button type="button" class="removeSelectedPostBtn" data-kind="'+kind+'" data-shortcode="'+code+'" style="position:absolute;top:8px;right:8px;width:34px;height:34px;border-radius:999px;border:1px solid rgba(0,0,0,0.08);background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px);font-size:18px;line-height:0;color:#111;">×</button>')
          : '';
        if (!p) {
          const iframe = '<iframe src="https://www.instagram.com/p/'+code+'/embed" allowtransparency="true" allow="encrypted-media; picture-in-picture" scrolling="no" style="width:100%;height:100%;border-radius:12px;"></iframe>';
          const frame = '<div style="width:100%;height:'+fixedH+'px;overflow:hidden;border-radius:12px;background:var(--bg-primary);">'+iframe+'</div>';
          return '<div style="scroll-snap-align:start;flex:0 0 240px;max-width:240px;background:var(--bg-secondary);border-radius:12px;padding:0.6rem;"><div style="position:relative;">'+frame+removeBtn+'</div></div>';
        }
        const dsrc = p.displayUrl ? ('/image-proxy?url=' + encodeURIComponent(p.displayUrl)) : null;
        const media = dsrc
          ? '<img src="'+dsrc+'" style="width:100%;height:100%;border-radius:12px;object-fit:cover;" loading="lazy" decoding="async"/>'
          : '<iframe src="https://www.instagram.com/p/'+p.shortcode+'/embed" allowtransparency="true" allow="encrypted-media; picture-in-picture" scrolling="no" style="width:100%;height:100%;border-radius:12px;"></iframe>';
        const frame = '<div style="width:100%;height:'+fixedH+'px;overflow:hidden;border-radius:12px;background:var(--bg-primary);">'+media+'</div>';
        const dateText = p.takenAt ? new Date(Number(p.takenAt) * 1000).toLocaleString('en-US') : '';
        const extra = dateText ? '<div style="font-size:0.8rem;color:var(--text-secondary);text-align:center;margin-top:6px;">'+dateText+'</div>' : '';
        return '<div style="scroll-snap-align:start;flex:0 0 240px;max-width:240px;background:var(--bg-secondary);border-radius:12px;padding:0.6rem;"><div style="position:relative;">'+frame+removeBtn+'</div>'+extra+'</div>';
      }).join('');

      const canAddMore = splitEnabled && (list.length < maxCount);
      const addBtn = canAddMore
        ? '<button type="button" id="addMorePostsBtn" style="scroll-snap-align:start;flex:0 0 240px;max-width:240px;background:rgba(124,58,237,0.10);border:2px dashed rgba(124,58,237,0.5);border-radius:12px;padding:0.6rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--text-primary);cursor:pointer;">'
          + '<div style="width:42px;height:42px;border-radius:999px;background:rgba(124,58,237,0.15);display:flex;align-items:center;justify-content:center;font-size:26px;line-height:0;">+</div>'
          + '<div style="font-weight:600;">Add another post</div>'
          + '</button>'
        : '';

      let infoHtml = '';
      if (splitEnabled) {
        const countsAllowed = getAllowedSplitCounts(qtdEffective, maxCount);
        const ok = qtdEffective > 0 && list.length > 0 && list.length <= maxCount && list.length <= qtdEffective;
        const each = ok ? Math.ceil(qtdEffective / list.length) : 0;
        const totalSent = ok ? (each * list.length) : 0;
        const extra = ok ? (totalSent - qtdEffective) : 0;
        const infoText = ok
          ? ('Split: ' + each.toLocaleString('en-US') + ' per post (' + list.length + ' post(s))' + (extra > 0 ? (' — we’ll send +' + extra.toLocaleString('en-US') + ' to match the split') : ''))
          : ('Invalid split. For ' + qtdEffective.toLocaleString('en-US') + ', choose: ' + countsAllowed.join(', ') + ' post(s).');
        const infoColor = ok ? 'var(--text-secondary)' : '#ef4444';
        infoHtml = '<div id="splitInfoLine" style="margin-top:8px;font-size:0.9rem;color:'+infoColor+';text-align:center;">'+infoText+'</div>';
      }

      slot.innerHTML =
        '<div style="display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px;">'
        + cardsHtml
        + addBtn
        + '</div>'
        + infoHtml;
      container.style.display = 'block';
      try { updatePedidoButtonState(); } catch(_) {}

      setTimeout(function(){
        const btn = document.getElementById('addMorePostsBtn');
        if (!btn) return;
        btn.addEventListener('click', function(){
          const q = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
          const maxN = getSplitMaxForQtd(q);
          const curList = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[kind]) ? window.__oppusSelectedPostsByKind[kind] : [];
          if (curList.length >= maxN) {
            showStatusMessageCheckout('Post limit reached for this package.', 'error');
            return;
          }
          openPostModal(kind, { append: true });
        });
      }, 0);
      
      setTimeout(function(){
        Array.from(document.querySelectorAll('.removeSelectedPostBtn')).forEach(function(btn){
          btn.addEventListener('click', function(e){
            try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch(_) {}
            try { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); } catch(_) {}
            const sc = String(this.getAttribute('data-shortcode') || '').trim();
            const k = String(this.getAttribute('data-kind') || '').trim();
            if (!sc || !k) return;
            try {
              const prev = Array.isArray(window.__oppusSelectedPostsByKind && window.__oppusSelectedPostsByKind[k]) ? window.__oppusSelectedPostsByKind[k] : [];
              window.__oppusSelectedPostsByKind[k] = prev.filter(x => x !== sc);
            } catch(_) {}
            try {
              const user2 = (checkoutProfileUsername && checkoutProfileUsername.textContent && checkoutProfileUsername.textContent.trim()) || '';
              fetch('/api/instagram/select-post-for', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user2, shortcode: sc, kind: k, mode: 'remove' }) }).catch(function(){});
            } catch(_) {}
            renderSelectedPostsPreview(k);
            try { updatePedidoButtonState(); } catch(_) {}
          });
        });
      }, 0);
  }

  function updateSelectedPostPreview(kind, sc, opts) {
      const container = document.getElementById('selectedPostPreview');
      const slot = document.getElementById('selectedPostPreviewContent');
      if (!container || !slot) return;
      const splitEnabled = isMultiPostSplitEnabled(kind);
      const append = splitEnabled && !!(opts && opts.append);
      try {
        window.__oppusSelectedPostsByKind = window.__oppusSelectedPostsByKind || { likes: [], views: [], comments: [] };
        const prev = Array.isArray(window.__oppusSelectedPostsByKind[kind]) ? window.__oppusSelectedPostsByKind[kind] : [];
        if (!sc) {
          window.__oppusSelectedPostsByKind[kind] = [];
        } else {
          if (append) {
            const qtd = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
            const maxCount = getSplitMaxForQtd(qtd);
            if (!prev.includes(sc) && prev.length >= maxCount) {
              showStatusMessageCheckout('Post limit reached for this package.', 'error');
              return;
            }
            window.__oppusSelectedPostsByKind[kind] = prev.includes(sc) ? prev : prev.concat([sc]);
          } else {
            window.__oppusSelectedPostsByKind[kind] = [sc];
          }
        }
      } catch(_) {}
      renderSelectedPostsPreview(kind);
  }

  async function checkInstagramProfileCheckout() {
    if (!usernameCheckoutInput) return;
    const rawInput = usernameCheckoutInput.value.trim();
    if (!rawInput) {
      showStatusMessageCheckout('Enter the Instagram username or URL.', 'error');
      return;
    }
    
    const username = normalizeInstagramUsername(rawInput);
    if (!isValidInstagramUsername(username)) {
      showStatusMessageCheckout('Invalid username.', 'error');
      return;
    }
    if (username !== rawInput) usernameCheckoutInput.value = username;
    
    hideStatusMessageCheckout();
    const helpLink = document.getElementById('howToGetLinkContainer');
    if (helpLink) helpLink.style.display = 'none';

    clearProfilePreview();
    showLoadingCheckout();
    
    try {
      const params = new URLSearchParams(window.location.search);
      let utms = {
          source: params.get('utm_source') || '',
          medium: params.get('utm_medium') || '',
          campaign: params.get('utm_campaign') || '',
          term: params.get('utm_term') || '',
          content: params.get('utm_content') || ''
      };
      
      // Merge with sessionStorage if empty (Persistence fix)
      try {
        const stored = sessionStorage.getItem('oppus_utms');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (!utms.source && parsed.utm_source) utms.source = parsed.utm_source;
            if (!utms.medium && parsed.utm_medium) utms.medium = parsed.utm_medium;
            if (!utms.campaign && parsed.utm_campaign) utms.campaign = parsed.utm_campaign;
            if (!utms.term && parsed.utm_term) utms.term = parsed.utm_term;
            if (!utms.content && parsed.utm_content) utms.content = parsed.utm_content;
        }
      } catch(_) {}

      // Merge with sessionStorage if empty
      try {
        const stored = sessionStorage.getItem('oppus_utms');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (!utms.source && parsed.utm_source) utms.source = parsed.utm_source;
            if (!utms.medium && parsed.utm_medium) utms.medium = parsed.utm_medium;
            if (!utms.campaign && parsed.utm_campaign) utms.campaign = parsed.utm_campaign;
            if (!utms.term && parsed.utm_term) utms.term = parsed.utm_term;
            if (!utms.content && parsed.utm_content) utms.content = parsed.utm_content;
        }
      } catch(_) {}
      
      const resp = await fetch('/api/check-instagram-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, utms, includePosts: (isCurtidasContext || isViewsContext) })
      });
      const data = await resp.json();
      hideLoadingCheckout();
      
      if (data.success) {
        const profile = data.profile || {};

        const profilePicRaw = String(profile.profilePicUrl || profile.driveImageUrl || profile.originalProfilePicUrl || '').trim();
        const fallbackPic = '/images/default-avatar.svg';
        const toProxyIfNeeded = (url) => {
          const s = String(url || '').trim();
          if (!s) return '';
          if (s.indexOf('/image-proxy?') === 0) return s;
          if (/^https?:\/\//i.test(s)) {
            try {
              const u = new URL(s);
              const h = String(u.hostname || '').toLowerCase();
              if (h.includes('instagram') || h.includes('cdninstagram') || h.includes('fbcdn') || h.includes('scontent')) {
                return '/image-proxy?url=' + encodeURIComponent(s);
              }
            } catch(_) {}
          }
          return s;
        };
        const applyPic = (img) => {
          if (!img) return;
          const candidate = toProxyIfNeeded(profilePicRaw);
          img.onerror = null;
          img.src = fallbackPic;
          if (!candidate) return;
          const pre = new Image();
          pre.onload = () => {
            img.onerror = null;
            img.src = candidate;
            img.onerror = () => {
              img.onerror = null;
              img.src = fallbackPic;
            };
          };
          pre.onerror = () => {
            img.onerror = null;
            img.src = fallbackPic;
          };
          pre.src = candidate;
        };
        applyPic(checkoutProfileImage);
        if (checkoutProfileUsername) checkoutProfileUsername.textContent = profile.username || username;
        if (checkoutFollowersCount) checkoutFollowersCount.textContent = String(profile.followersCount || '-');
        if (checkoutFollowingCount) checkoutFollowingCount.textContent = String(profile.followingCount || '-');
        if (checkoutPostsCount) checkoutPostsCount.textContent = String(profile.postsCount || '-');
        
        if (profilePreview) profilePreview.style.display = 'block';
        
        // Show contact fields
        const contactArea = document.getElementById('contactFieldsArea');
        if (contactArea) {
            contactArea.style.display = 'block';
            // Scroll automático para a parte de digitar o email
            setTimeout(() => {
                const emailInput = document.getElementById('contactEmailInput');
                if (emailInput) {
                    emailInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Opcional: focar no campo
                    // emailInput.focus(); 
                } else {
                    contactArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 300);
        }
        
        const revImg = document.getElementById('reviewProfileImage');
        const revUser = document.getElementById('reviewProfileUsername');
        const revFoll = document.getElementById('reviewProfileFollowers');
        applyPic(revImg);
        if (revUser) revUser.textContent = profile.username || username;
        if (revFoll) revFoll.textContent = String(profile.followersCount || '-');
        
        isInstagramVerified = true;
        try { isInstagramPrivate = !!(profile.isPrivate || profile.is_private); } catch(_) { isInstagramPrivate = false; }
        
        // Pré-carregar posts se vierem na verificação ou buscar em background
        if (profile.latestPosts && Array.isArray(profile.latestPosts) && profile.latestPosts.length > 0) {
            cachedPosts = profile.latestPosts;
            cachedPostsUser = profile.username || username;
        } else {
             // Tentar buscar em background para agilizar o modal
             try {
                // Verificar se já não estamos buscando para este usuário
                if (cachedPostsUser !== (profile.username || username)) {
                    const url = '/api/instagram/posts?username=' + encodeURIComponent(profile.username || username);
                    fetch(url).then(r=>r.json()).then(d=>{ 
                        if(d.posts && Array.isArray(d.posts)) {
                            cachedPosts = d.posts; 
                            cachedPostsUser = (profile.username || username); 
                        }
                    }).catch(function(){});
                }
             } catch(_) {}
        }

        // Após validar perfil, abrir o modal de seleção de post:
        // - Curtidas  -> seleção de post (likes)
        // - Visualizações -> seleção de Reels (views)
        if (isCurtidasContext || isViewsContext) {
          openPostModal(isCurtidasContext ? 'likes' : 'views');
        }
        
        updatePedidoButtonState();
        showResumoIfAllowed();
        updatePromosSummary();
        applyCheckoutFlow();
        showStatusMessageCheckout('Profile verified successfully.', 'success');
        
        try {
          const bid = getBrowserSessionId();
          fetch('/api/instagram/validet-track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: profile.username || username, browserId: bid })
          }).catch(() => {});
        } catch (_) {}
        
      } else {
        const msg = (data && data.error) ? String(data.error) : '';
        if (/não\s+localizad|não\s+encontrad|inexist|username_invalid|user_not_found|not\s+found/i.test(msg)) {
          showStatusMessageCheckout('User not found. Check the username and try again.', 'error');
        } else if (/invalid\s+session\s+token/i.test(msg)) {
          showStatusMessageCheckout('Instagram session error. Please try again in a moment.', 'error');
        } else if (/erro\s+na\s+verifica[cç][aã]o\s+do\s+perfil|profile\s+verification\s+error|unknown\s+error\s+while\s+verifying\s+profile/i.test(msg)) {
          showStatusMessageCheckout('Profile verification error. Check the username and try again.', 'error');
        } else {
          showStatusMessageCheckout(msg || 'Failed to verify profile.', 'error');
        }
        const helpLink = document.getElementById('howToGetLinkContainer');
        if (helpLink) helpLink.style.display = 'block';
      }
    } catch (e) {
      hideLoadingCheckout();
      showStatusMessageCheckout('Error connecting to the server.', 'error');
      const helpLink = document.getElementById('howToGetLinkContainer');
      if (helpLink) helpLink.style.display = 'block';
    }
  }

  // --- Funções Auxiliares UI ---

  function showStatusMessageCheckout(msg, type) {
    if (!statusCheckoutMessage) return;
    statusCheckoutMessage.textContent = msg;
    statusCheckoutMessage.className = 'status-message ' + (type === 'error' ? 'error' : 'success');
    statusCheckoutMessage.style.display = 'block';
  }

  function hideStatusMessageCheckout() {
    if (!statusCheckoutMessage) return;
    statusCheckoutMessage.style.display = 'none';
  }

  function showLoadingCheckout() {
    if (loadingCheckoutSpinner) loadingCheckoutSpinner.style.display = 'block';
  }

  function hideLoadingCheckout() {
    if (loadingCheckoutSpinner) loadingCheckoutSpinner.style.display = 'none';
  }

  function clearProfilePreview() {
    if (profilePreview) profilePreview.style.display = 'none';
    isInstagramVerified = false;
  }

  function updatePedidoButtonState() {
    if (!btnPedido) return;
    let disabled = !!(btnPedido.classList && btnPedido.classList.contains('loading'));
    try {
      if ((isCurtidasContext || isViewsContext) && !isInstagramPrivate) {
        const kind = isCurtidasContext ? 'likes' : 'views';
        const qtd = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
        const tipoNow = (tipoSelect && tipoSelect.value) ? String(tipoSelect.value) : '';
        const qtdEffective = getEffectiveQtdForSplit(tipoNow, qtd);
        const maxCount = getSplitMaxForQtd(qtd);
        const list = (window.__oppusSelectedPostsByKind && Array.isArray(window.__oppusSelectedPostsByKind[kind]))
          ? window.__oppusSelectedPostsByKind[kind]
          : [];
        if (!list.length) disabled = true;
        else if (list.length > maxCount) disabled = true;
        else if (qtdEffective <= 0) disabled = true;
      }
    } catch(_) {}
    btnPedido.disabled = disabled;
  }

  function showResumoIfAllowed() {
    const isFollowers = isFollowersTipo(tipoSelect.value);
    const allow = (!isFollowers) || !!isInstagramVerified;
    if (resumo) {
        resumo.hidden = !allow;
        resumo.style.display = allow ? 'block' : 'none';
    }
  }

  function updatePerfilVisibility() {
    // Controlled by goToStep
  }
  
  function updateWarrantyVisibility() {
    const tipo = tipoSelect.value;
    const inp = document.getElementById('promoWarranty60');
    if (!inp) return;
    const item = inp.closest('.promo-item');
    const show = (tipo === 'mistos' || tipo === 'brasileiros' || tipo === 'curtidas_brasileiras');
    if (item) item.style.display = show ? '' : 'none';
    if (!show && inp.checked) inp.checked = false;
    try { updatePromosSummary(); } catch(_) {}
  }

  function applyCheckoutFlow() {
    const tipo = tipoSelect.value;
    const isFollowers = isFollowersTipo(tipo);
    const verified = !!isInstagramVerified;
    
    // Controlled by goToStep. We only manage internal visibility of Step 3 elements here if needed.
    if (verified || !isFollowers) {
        if (orderInline) orderInline.style.display = 'block';
        if (grupoPedido) grupoPedido.style.display = 'block';
        if (paymentCard) paymentCard.style.display = 'block';
        
        const headerQty = document.getElementById('headerSelectedQty');
        if (headerQty && qtdSelect.value) {
            const unit = getUnitForTipo(tipo);
            headerQty.textContent = `+ ${qtdSelect.value} ${unit}`;
        }
        
        if (!isCurtidasContext && !isViewsContext) {
            updateReviewMath();
        }
    } else {
        if (orderInline) orderInline.style.display = 'none';
        if (grupoPedido) grupoPedido.style.display = 'none';
        if (paymentCard) paymentCard.style.display = 'none';
    }
  }

  function updateReviewMath() {
      const reviewSelectedQty = document.getElementById('reviewSelectedQty');
      const reviewTotalFollowers = document.getElementById('reviewTotalFollowers');
      const reviewProfileFollowers = document.getElementById('reviewProfileFollowers');
      const qtdSelect = document.getElementById('quantidadeSelect');
      
      try {
          // Get current followers
          const currentText = reviewProfileFollowers ? reviewProfileFollowers.textContent : '0';
          const current = (currentText === '-' || !currentText) ? 0 : parseInt(currentText.replace(/\D/g, '') || '0', 10);
          
          // Get selected quantity
          let selected = 0;
          if (qtdSelect && qtdSelect.value) {
             selected = parseInt(qtdSelect.value.replace(/\D/g, '') || '0', 10);
          }
          
          const total = current + selected;
          
          // Format numbers
          const fmt = (n) => n.toLocaleString('en-US');

          if (reviewSelectedQty) reviewSelectedQty.textContent = `+${fmt(selected)}`;
          if (reviewTotalFollowers) reviewTotalFollowers.textContent = fmt(total);
          
          // Ensure current is formatted too if it's a number
          if (reviewProfileFollowers && current > 0 && reviewProfileFollowers.textContent !== fmt(current)) {
              reviewProfileFollowers.textContent = fmt(current);
          }
      } catch (e) {
          console.error('Error updating review math:', e);
      }
  }

  // --- Funções de Pagamento (PIX) ---

  function markPaymentConfirmed() {
    const pixResultado = document.getElementById('pixResultado');
    try {
      if (pixResultado) {
        pixResultado.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;color:#22C55E;font-weight:700;font-size:1rem;"><span class="price-new">Payment confirmed</span></div>';
      }
    } catch(_) {}
    try { showStatusMessageCheckout('Payment confirmed. Showing the summary below.', 'success'); } catch(_) {}
    try { showResumoIfAllowed(); } catch(_) {}
  }

  async function navigateToPedidoOrFallback(identifier, correlationID, chargeId) {
    try {
      try { await fetch('/session/mark-paid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, correlationID }) }); } catch(_) {}
      const apiUrl = `/api/order?identifier=${encodeURIComponent(identifier)}&correlationID=${encodeURIComponent(correlationID)}&id=${encodeURIComponent(chargeId||'')}`;
      const extractProviderOid = function(orderObj){
        if (!orderObj || typeof orderObj !== 'object') return '';
        var o = orderObj;
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
      if (!data || !data.order || !providerOid) {
        showStatusMessageCheckout('Payment received! Processing your order...', 'success');
        let attempts = 0;
        const maxAttempts = 10;
        while (attempts < maxAttempts && !providerOid) {
          attempts++;
          try {
            const respLoop = await fetch(apiUrl);
            const dataLoop = await respLoop.json();
            if (dataLoop && dataLoop.order) {
              providerOid = extractProviderOid(dataLoop.order);
              if (providerOid) {
                try { localStorage.setItem('oppus_selected_oid', String(providerOid)); } catch(_) {}
                break;
              }
            }
          } catch(_) {}
          await new Promise(function(resolve){ setTimeout(resolve, 1500); });
        }
      }
      const finalOid = providerOid || (chargeId ? String(chargeId) : '');
      window.location.href = `/pedido?t=${encodeURIComponent(identifier)}&ref=${encodeURIComponent(correlationID||'')}&oid=${encodeURIComponent(finalOid||'')}`;
    } catch(_) {
        showStatusMessageCheckout('Payment confirmed! Check your email.', 'success');
    }
  }

  async function criarPixWoovi() {
    try { window.__oppus_pix_started = true; } catch(_) {}
    if (btnPedido) {
        btnPedido.disabled = true;
        btnPedido.classList.add('loading');
    }
    
    // Ocultar elementos estáticos do PIX se existirem, para usar o render dinâmico
    const staticPixElements = ['pixQrcode', 'pixLoader', 'pixCopiaCola', 'copyPixBtn'];
    staticPixElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.parentElement.style.display = 'none'; // Oculta o container pai desses elementos
    });
    // Garantir que pixResultado esteja visível e limpo
    const pixResultado = document.getElementById('pixResultado');
    if (pixResultado) {
        pixResultado.innerHTML = '';
        pixResultado.style.display = 'block';
        // Se o pai estava oculto (caso dos elementos estáticos estarem no mesmo container), reexibir o container principal
        const pixContainer = document.getElementById('pixContainer');
        if (pixContainer) {
            pixContainer.style.display = 'block'; // Ensure container is visible
            // Reexibir apenas o necessário
            Array.from(pixContainer.children).forEach(c => {
                if (c.id === 'pixResultado' || c.tagName === 'H4' || c.tagName === 'P') c.style.display = 'block';
                else if (staticPixElements.includes(c.id) || c.querySelector('#pixQrcode')) c.style.display = 'none';
            });
        }
    }

    try {
      const tipo = tipoSelect ? tipoSelect.value : 'mistos';
      const qtdSelectVal = qtdSelect ? qtdSelect.value : '0';
      const qtd = parseInt(qtdSelectVal, 10);
      const precoText = resPreco ? resPreco.textContent : '';
      const precoStr = precoText; 
      
      let baseCents = basePriceCents || 0;
      const promos = getSelectedPromos();
      const promosTotalCents = calcPromosTotalCents(promos);
      let totalCents = Math.max(0, Number(baseCents) + promosTotalCents);

      if (window.couponDiscount && window.couponDiscount > 0) {
        const discountVal = Math.round(totalCents * window.couponDiscount);
        totalCents -= discountVal;
      }

      const valueBRL = totalCents / 100;
      let sckValue = '';
      try {
        const params = new URLSearchParams(window.location.search || '');
        sckValue = params.get('sck') || '';
      } catch (_) {}
      if (!sckValue) {
        try {
          const m2 = document.cookie.match(/(?:^|;\s*)index=([^;]+)/);
          sckValue = m2 && m2[1] ? decodeURIComponent(m2[1]) : '';
        } catch (_) {}
      }
      
      // Quantidade efetiva (considerando upgrade)
      const upgradeItem = promos.find(p => p.key === 'upgrade');
      // Se tiver upgrade, a quantidade base já foi dobrada visualmente? 
      // Não, no servicos-instagram.js o updateOrderBump apenas mostra o texto.
      // A lógica de quantidade real deve ser ajustada aqui.
      // Se houver upgrade, a quantidade entregue é maior, mas para o checkout (registro)
      // usamos a quantidade base + info de upgrade.
      const qtdEffective = qtd; 

      let correlationID = 'InstagramService_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      let wooviComment = 'Checkout OPPUS Instagram';
      try {
        const hn = (window.location && window.location.hostname) ? String(window.location.hostname).toLowerCase() : '';
        const isLocal = hn === 'localhost' || hn === '127.0.0.1';
        if (isLocal && Number(totalCents) > 0 && Number(totalCents) <= 100) {
          correlationID = 'test-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          wooviComment = 'teste pix';
        }
      } catch(_) {}
      
      // Phone
      const phoneInput = contactPhoneInput || document.getElementById('checkoutPhoneInput');
      const phoneValue = onlyDigits(phoneInput ? phoneInput.value : '');

      const emailValue = contactEmailInput ? contactEmailInput.value.trim() : '';
      
      // Username
      const usernamePreview = (checkoutProfileUsername && checkoutProfileUsername.textContent && checkoutProfileUsername.textContent.trim()) || '';
      const usernameInputRaw = (usernameCheckoutInput && usernameCheckoutInput.value && usernameCheckoutInput.value.trim()) || '';
      const usernameInputNorm = normalizeInstagramUsername(usernameInputRaw);
      const instagramUsernameFinal = usernamePreview || usernameInputNorm || '';

      if (!instagramUsernameFinal) {
        throw new Error('Instagram username not identified.');
      }

      const serviceCategory = isViewsContext ? 'visualizacoes' : (isCurtidasContext ? 'curtidas' : 'seguidores');

      const payload = {
        correlationID,
        value: totalCents,
        comment: wooviComment,
        customer: {
          name: 'Instagram Customer',
          phone: phoneValue,
          email: emailValue
        },
        additionalInfo: [
          { key: 'tipo_servico', value: tipo },
          { key: 'categoria_servico', value: serviceCategory },
          { key: 'quantidade', value: String(qtdEffective) },
          { key: 'pacote', value: `${qtdEffective} ${getUnitForTipo(tipo)} - ${precoStr}` },
          { key: 'phone', value: phoneValue },
          { key: 'instagram_username', value: instagramUsernameFinal },
          { key: 'order_bumps_total', value: formatCentsToBRL(promosTotalCents) },
          { key: 'order_bumps', value: promos.map(p => `${p.key}:${p.qty ?? 1}`).join(';') },
          { key: 'cupom', value: window.couponCode || '' }
        ],
        profile_is_private: isInstagramPrivate
      };
      try {
        if (sckValue) payload.additionalInfo.push({ key: 'sck', value: sckValue });
      } catch (_) {}

      // Tentar pegar posts selecionados (simulado ou via cache/session se tivesse implementado full)
      // Aqui vamos apenas verificar se tem promos que precisam de posts
      // No código anterior do modal, não salvamos no backend. 
      // Se for necessário, deveríamos ter salvo. 
      // Assumindo que o modal apenas seleciona visualmente por enquanto ou falta implementar a persistência.
      // Vou manter simplificado como no checkout.js que busca de /api/instagram/selected-for
      
      let splitErrMsg = '';
      try {
        let sfor = {};
        const normalizeIgShortcode = function (sc) {
          const v = String(sc || '').trim();
          if (!v) return '';
          const m = v.match(/^[A-Za-z0-9_-]+/);
          const code = m ? String(m[0] || '') : '';
          if (!code) return '';
          return code.length > 15 ? code.slice(0, 11) : code;
        };
        const buildIgMediaLink = function (k, sc) {
          const code = normalizeIgShortcode(sc);
          if (!code) return '';
          const kindPath = (k === 'views') ? 'reel' : 'p';
          return `https://www.instagram.com/${kindPath}/${encodeURIComponent(code)}/`;
        };
        try {
          const selResp = await fetch('/api/instagram/selected-for');
          if (selResp && selResp.ok) {
            const selData = await selResp.json();
            sfor = selData && selData.selectedFor ? selData.selectedFor : {};
          }
        } catch (_) {}
        const mapKindList = function (k) {
          const obj = (sfor && sfor[k]) ? sfor[k] : {};
          const list = Array.isArray(obj.shortcodes) ? obj.shortcodes : (obj.shortcode ? [obj.shortcode] : []);
          return list.map(sc => buildIgMediaLink(k, sc)).filter(Boolean);
        };
        const getLinksForKind = function (k) {
          const localList = (window.__oppusSelectedPostsByKind && Array.isArray(window.__oppusSelectedPostsByKind[k]))
            ? window.__oppusSelectedPostsByKind[k]
            : [];
          const linksFromLocal = localList.map(sc => buildIgMediaLink(k, sc)).filter(Boolean);
          const linksFromServer = mapKindList(k);
          return linksFromLocal.length ? linksFromLocal : linksFromServer;
        };
        const getFirstLinkForKind = function (k) {
          const list = getLinksForKind(k);
          return list.length ? list[0] : '';
        };

        const likesLink = getFirstLinkForKind('likes');
        const viewsLink = getFirstLinkForKind('views');
        const commentsLink = getFirstLinkForKind('comments');
          const anyLink = viewsLink || likesLink || commentsLink;

          const hasLikes = promos.some(p => p.key === 'likes');
          const hasViews = promos.some(p => p.key === 'views');
          const hasComments = promos.some(p => p.key === 'comments');
          const kinds = [];
          if (hasLikes) kinds.push('likes');
          if (hasViews) kinds.push('views');
          if (hasComments) kinds.push('comments');

          if (kinds.length === 1) {
            const onlyKind = kinds[0];
            let link = getFirstLinkForKind(onlyKind);
            if (!link && instagramUsernameFinal) {
              try {
                const url = '/api/instagram/posts?username=' + encodeURIComponent(instagramUsernameFinal);
                let pr = null;
                if (window.AbortController) {
                  const controller = new AbortController();
                  const to = setTimeout(() => {
                    try { controller.abort(); } catch (_) {}
                  }, 650);
                  try {
                    pr = await fetch(url, { signal: controller.signal });
                  } finally {
                    clearTimeout(to);
                  }
                } else {
                  pr = await fetch(url);
                }
                if (!pr || !pr.ok) throw new Error('posts_fetch_failed');
                const pd = await pr.json();
                const posts = Array.isArray(pd && pd.posts) ? pd.posts : [];
                const isVideo = (p) => !!(p && (p.isVideo || /video|clip/.test(String(p.typename || '').toLowerCase())));
                const candidates = onlyKind === 'views' ? posts.filter(isVideo) : posts;
                const pick = (candidates && candidates[0]) || (posts && posts[0]) || null;
                if (pick && pick.shortcode) link = buildIgMediaLink(onlyKind, pick.shortcode);
              } catch (_) {}
            }
            if (link) payload.additionalInfo.push({ key: `orderbump_post_${onlyKind}`, value: link });
          } else {
            if (hasLikes && anyLink) payload.additionalInfo.push({ key: 'orderbump_post_likes', value: likesLink || anyLink });
            if (hasViews && anyLink) payload.additionalInfo.push({ key: 'orderbump_post_views', value: viewsLink || anyLink });
            if (hasComments && anyLink) payload.additionalInfo.push({ key: 'orderbump_post_comments', value: commentsLink || anyLink });
          }

          if (serviceCategory === 'curtidas' || serviceCategory === 'visualizacoes') {
            const baseKind = serviceCategory === 'curtidas' ? 'likes' : 'views';
            const links = getLinksForKind(baseKind);
            if (links.length) {
              payload.additionalInfo.push({ key: 'post_link', value: links[0] });
              payload.additionalInfo.push({ key: 'post_links', value: links.join(',') });
              payload.additionalInfo.push({ key: 'post_split_count', value: String(links.length) });
              const maxCount = getSplitMaxForQtd(qtd);
              if (links.length > maxCount) {
                splitErrMsg = 'The number of posts is above the package limit.';
              }
              const qtdForSplit = getEffectiveQtdForSplit(tipo, qtd);
              const perPost = links.length ? Math.ceil(qtdForSplit / links.length) : qtdForSplit;
              const totalSent = links.length ? (perPost * links.length) : qtdForSplit;
              const extra = Math.max(0, totalSent - qtdForSplit);
              payload.additionalInfo.push({ key: 'post_split_each', value: String(perPost) });
              if (extra > 0) payload.additionalInfo.push({ key: 'post_split_extra', value: String(extra) });
            } else {
              splitErrMsg = 'Select at least 1 post.';
            }
          }
      } catch(_) {}
      if (splitErrMsg) throw new Error(splitErrMsg);

      const resp = await fetch('/api/woovi/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await resp.json();
      if (!resp.ok) {
        const errMsg = (data && (data.message || (data.details && data.details.message) || data.error)) || 'Failed to create charge.';
        throw new Error(errMsg);
      }

      // Renderização do PIX
      const charge = data?.charge || data || {};
      const pix = charge?.paymentMethods?.pix || charge?.pix || {};
      const brCode = pix?.brCode || charge?.brCode || data?.brCode || '';
      const qrImage = pix?.qrCodeImage || charge?.qrCodeImage || data?.qrCodeImage || '';

      const copyButtonId = 'copyPixBtnDynamic';
      const inputId = 'pixBrCodeInputDynamic';

      const imgHtml = qrImage
        ? `<img src="${qrImage}" alt="Pix QR code" style="width: 180px; height: 180px; border-radius: 8px; display: block; margin: 0 auto 0.75rem; background: #fff;" />`
        : '';

      const codeFieldHtml = brCode
        ? `<div style="margin-bottom: 0.5rem; text-align: center;">
             <input id="${inputId}" type="text" readonly value="${brCode}" style="width: 100%; padding: 0.5rem; font-size: 0.9rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.85); color: #111827; text-align: center;" />
           </div>`
        : '<div style="color:#fff;">Unable to display the Pix code.</div>';

      const copyBtnHtml = brCode
        ? `<div class="button-container" style="margin-bottom: 0.5rem;">
             <button id="${copyButtonId}" class="continue-button">
               <span class="button-text">Copy Pix code</span>
             </button>
           </div>`
        : '';

      const textColor = (document.body.classList.contains('theme-light') || true) ? '#000' : '#fff'; // Forçando escuro se necessário ou detectando tema
      
      const waitingHtml = `
        <div style="display:flex; align-items:center; justify-content:center; gap:0.5rem; color:${textColor};">
          <svg width="18" height="18" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
            <circle cx="25" cy="25" r="20" stroke="${textColor}" stroke-width="4" fill="none" stroke-dasharray="31.4 31.4">
              <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
          <span>Waiting for payment...</span>
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
                if (span) span.textContent = 'Pix copied';
                try { showStatusMessageCheckout('Pix code copied', 'success'); } catch(_) {}
                copyBtn.disabled = true;
                setTimeout(() => {
                  copyBtn.disabled = false;
                  if (span) span.textContent = prev || 'Copy Pix code';
                }, 1200);
              } catch (e) {
                alert('Unable to copy the Pix code.');
              }
            });
          }
      }, 100);

      // Polling de Status (Lógica idêntica ao checkout.js)
      const chargeId = charge?.id || charge?.chargeId || data?.chargeId || '';
      const identifier = charge?.identifier || (data?.charge && data.charge.identifier) || '';
      const serverCorrelationID = charge?.correlationID || (data?.charge && data.charge.correlationID) || '';
      
      if (paymentPollInterval) {
        clearInterval(paymentPollInterval);
        paymentPollInterval = null;
      }
      
      const doCheckDb = async () => {
         try {
           const dbUrl = `/api/checkout/payment-state?id=${encodeURIComponent(chargeId)}&identifier=${encodeURIComponent(identifier)}&correlationID=${encodeURIComponent(serverCorrelationID || correlationID)}`;
           const dbResp = await fetch(dbUrl);
           const dbData = await dbResp.json();
           if (dbData?.paid === true) {
             clearInterval(paymentPollInterval);
             paymentPollInterval = null;
             try { markPaymentConfirmed(); } catch(_) {}
             await navigateToPedidoOrFallback(identifier, serverCorrelationID || correlationID, chargeId);
             return true;
           }
         } catch(e) { console.error('DB Check error:', e); }
         return false;
      };

      if (chargeId || identifier || serverCorrelationID) {
        const checkPaid = async () => {
          if (!chargeId) { await doCheckDb(); return; }
          try {
            const stResp = await fetch(`/api/woovi/charge-status?id=${encodeURIComponent(chargeId)}`);
            const stData = await stResp.json();
            const status = stData?.charge?.status || stData?.status || '';
            const paidFlag = stData?.charge?.paid || stData?.paid || false;
            const isPaid = paidFlag === true || /paid/i.test(String(status)) || /completed/i.test(String(status));
            
            if (isPaid) {
              clearInterval(paymentPollInterval);
              paymentPollInterval = null;
              try { markPaymentConfirmed(); } catch(_) {}
              await navigateToPedidoOrFallback(identifier, serverCorrelationID || correlationID, chargeId);
            } else {
               // Fallback imediato ao DB
               await doCheckDb();
            }
          } catch (e) {
            // Se falhar Woovi, tenta DB
            await doCheckDb();
          }
        };

        // Fallback Polling (DB Check)
         const checkPaidDb = async () => {
           await doCheckDb();
         };
 
         // Inicia polling primário
         if (chargeId) checkPaid();
         else checkPaidDb();

         paymentPollInterval = setInterval(checkPaidDb, 2000); 
         
         // SSE Listener (Real-time)
         try {
             if (window.paymentEventSource) { window.paymentEventSource.close(); window.paymentEventSource = null; }
             const sseUrl = `/api/payment/subscribe?identifier=${encodeURIComponent(identifier)}&correlationID=${encodeURIComponent(serverCorrelationID || correlationID)}`;
             window.paymentEventSource = new EventSource(sseUrl);
             window.paymentEventSource.addEventListener('paid', async (ev) => {
               try {
                 if (paymentPollInterval) { clearInterval(paymentPollInterval); paymentPollInterval = null; }
                 if (window.paymentEventSource) { window.paymentEventSource.close(); window.paymentEventSource = null; }
                 try { markPaymentConfirmed(); } catch(_) {}
                 await navigateToPedidoOrFallback(identifier, serverCorrelationID || correlationID, chargeId);
               } catch(_) {}
             });
         } catch(_) {}
         
         // Polling Woovi a cada 15s como backup (apenas se tiver chargeId)
         if (chargeId) {
             const checkPaidWoovi = async () => {
                await checkPaid();
             };
             setInterval(checkPaidWoovi, 15000);
         }
       }

    } catch (err) {
      alert('Error creating Pix: ' + (err?.message || err));
    } finally {
      if (btnPedido) {
        btnPedido.classList.remove('loading');
      }
      try { updatePedidoButtonState(); } catch(_) {}
    }
  }

  // --- Inicialização ---

  function smoothScrollToY(targetY, durationMs) {
    const dur = Math.max(200, Number(durationMs) || 1100);
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.scrollTo(0, targetY);
        return;
      }
    } catch (_) {}
    const startY = window.scrollY || window.pageYOffset || 0;
    const delta = targetY - startY;
    if (!delta) return;
    const startT = (window.performance && performance.now) ? performance.now() : Date.now();
    const ease = function(t) { return t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2); };
    const step = function(now) {
      const tNow = (window.performance && performance.now) ? now : Date.now();
      const p = Math.min(1, Math.max(0, (tNow - startT) / dur));
      window.scrollTo(0, startY + (delta * ease(p)));
      if (p < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }

  function scrollToCardsMobile() {
    try {
      const delayMs = arguments.length > 0 ? Number(arguments[0]) : 3000;
      const isMobile = window.innerWidth <= 640;
      if (isMobile) {
        setTimeout(() => {
          const pCards = document.getElementById('planCards');
          if (pCards && pCards.style.display !== 'none') {
            const rect = pCards.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            // Deixa uma beirada da descrição (aprox 120px acima do topo dos cards)
            const targetTop = (rect.top + scrollTop) - 120;
            smoothScrollToY(targetTop, 1100);
          }
        }, Number.isFinite(delayMs) ? delayMs : 3000);
      }
    } catch (_) {}
  }

  function updateExclusiveToolVisibility(tipo) {
    try {
      const el = document.getElementById('ferramentaExclusivaSection');
      if (!el) return;
      if (isCurtidasContext || isViewsContext) {
        el.style.display = 'none';
        return;
      }
      const t = String(tipo || (tipoSelect ? tipoSelect.value : '') || '').trim();
      el.style.display = (t === 'mistos') ? '' : 'none';
    } catch (_) {}
  }

  if (tipoSelect) {
    tipoSelect.addEventListener('change', () => {
      const tipo = tipoSelect.value;
      popularQuantidades(tipo);
      renderPlanCards(tipo);
      renderTipoDescription(tipo);
      updatePerfilVisibility();
      updateWarrantyVisibility();
      updateExclusiveToolVisibility(tipo);
      try {
        refreshLikesTable();
        applyLikesPromoVariant();
        if (likesQtyEl) updateLikesPrice(Number(likesQtyEl.textContent || 150));
      } catch(_) {}
      
      // Update visual active state of type cards
      if (tipoCards) {
        const all = tipoCards.querySelectorAll('.option-card');
        all.forEach(c => {
          if (c.getAttribute('data-tipo') === tipo) {
            c.classList.add('active');
          } else {
            c.classList.remove('active');
          }
        });
      }

      // Scroll Mobile para os cards (deixando beirada da descrição)
      const delayMs = (!isCurtidasContext && !isViewsContext && window.__oppusTipoChangeUserInitiated) ? 2000 : 3000;
      window.__oppusTipoChangeUserInitiated = false;
      scrollToCardsMobile(delayMs);
    });
  }

  try { updateExclusiveToolVisibility(tipoSelect ? tipoSelect.value : ''); } catch (_) {}

  function popularQuantidades(tipo) {
    if (!qtdSelect) return;
    qtdSelect.innerHTML = '';
    const arr = tabela[tipo] || [];
    arr.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.q;
      opt.textContent = `${item.q} - ${formatCentsToBRL(parsePrecoToCents(item.p))}`;
      qtdSelect.appendChild(opt);
    });
    qtdSelect.disabled = false;
  }

  if (checkCheckoutButton) {
    checkCheckoutButton.addEventListener('click', checkInstagramProfileCheckout);
  }

  if (btnPedido && !disablePix) {
    btnPedido.addEventListener('click', criarPixWoovi);
  }

  const optionPixToggle = document.getElementById('optionPix');
  const optionCardToggle = document.getElementById('optionCard');
  if (optionPixToggle && !disablePix) optionPixToggle.addEventListener('click', () => selectPaymentMethod('pix'));
  if (optionCardToggle) optionCardToggle.addEventListener('click', () => selectPaymentMethod('credit_card'));

  const radioInputs = document.querySelectorAll('input[name="paymentMethod"]');
  radioInputs.forEach(radio => {
    radio.addEventListener('change', (e) => {
      selectPaymentMethod(e.target.value);
    });
  });

  try {
    const cardNumberEl = document.getElementById('cardNumber');
    if (cardNumberEl) cardNumberEl.addEventListener('input', () => { cardNumberEl.value = maskCardNumber(cardNumberEl.value); });
    const cardExpiryEl = document.getElementById('cardExpiry');
    if (cardExpiryEl) cardExpiryEl.addEventListener('input', () => { cardExpiryEl.value = maskExpiry(cardExpiryEl.value); });
    const cardCpfEl = document.getElementById('cardHolderCpf');
    if (cardCpfEl) cardCpfEl.addEventListener('input', () => { cardCpfEl.value = maskCpf(cardCpfEl.value); });
  } catch(_) {}

  const payWithCardBtn = document.getElementById('payWithCardBtn');
  if (payWithCardBtn) payWithCardBtn.addEventListener('click', handleCardPayment);
  const cardPaymentForm = document.getElementById('cardPaymentForm');
  if (cardPaymentForm) cardPaymentForm.addEventListener('submit', handleCardPayment);
  
  if (usernameCheckoutInput) {
    usernameCheckoutInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            checkInstagramProfileCheckout();
        }
    });

    // Hide tutorial balloon — apenas quando o usuário realmente interagir (digitar ou clicar no balão)
    const hideBalloon = () => {
      const balloon = document.getElementById('tutorial3Usuario');
      if (balloon) {
        balloon.style.display = 'none';
        balloon.classList.add('hide');
      }
    };
    
    // Esconder somente quando começar a digitar ou colar
    usernameCheckoutInput.addEventListener('input', hideBalloon);
    usernameCheckoutInput.addEventListener('paste', hideBalloon);

    // Listener no próprio balão: permitir fechar com um toque/clique
    const balloonElement = document.getElementById('tutorial3Usuario');
    if (balloonElement) {
        balloonElement.addEventListener('click', hideBalloon);
    }
    
    // Removido: esconder em cliques/focus globais para evitar sumir imediatamente ao carregar
  }

  // --- Step Navigation Listeners ---
  const backToStep1Btn = document.getElementById('backToStep1Btn');
  if (backToStep1Btn) {
      backToStep1Btn.addEventListener('click', () => {
          if (window.goToStep) window.goToStep(1);
      });
  }

  const confirmContactDataBtn = document.getElementById('btnActionProceed');
  if (confirmContactDataBtn) {
      confirmContactDataBtn.addEventListener('click', (e) => {
          if (e) e.preventDefault(); // Prevent link navigation
          const email = contactEmailInput ? contactEmailInput.value.trim() : '';
          const phone = contactPhoneInput ? contactPhoneInput.value.trim() : '';
          
          const emailErrorMsg = document.getElementById('emailErrorMsg');
          
          if (!email || !email.includes('@')) {
              if (emailErrorMsg) emailErrorMsg.style.display = 'block';
              else showStatusMessageCheckout('Please enter a valid email.', 'error');
              
              if (contactEmailInput) contactEmailInput.focus();
              return;
          } else {
              if (emailErrorMsg) emailErrorMsg.style.display = 'none';
          }
          
          const digitsLen = getPhoneDigitsLen(phone);
          if (!digitsLen || digitsLen < 8) {
              showStatusMessageCheckout('Please enter a valid phone number.', 'error');
              if (contactPhoneInput) contactPhoneInput.focus();
              return;
          }
          
          if (window.goToStep) window.goToStep(3);
      });
  }

  // Init
  renderPromoPrices();
  applyWarrantyMode();
  renderTipoCards();
  initPromoListeners();
  if (qtdSelect) {
    qtdSelect.addEventListener('change', function(){
      try {
        const tipo = tipoSelect ? tipoSelect.value : '';
        const unit = getUnitForTipo(tipo);
        const q = parseInt(String(qtdSelect && qtdSelect.value ? qtdSelect.value : '0'), 10) || 0;
        if (planCards) {
          const card = planCards.querySelector(`.service-card[data-role="plano"][data-qtd="${q}"]`);
          const priceText = card ? card.getAttribute('data-preco') : findPrice(tipo, q);
          if (resTipo) resTipo.textContent = getLabelForTipo(tipo);
          if (resQtd) resQtd.textContent = `${q} ${unit}`;
          if (resPreco && priceText) resPreco.textContent = priceText;
          try { basePriceCents = parsePrecoToCents(priceText || ''); } catch(_) { basePriceCents = 0; }
          if (planCards) {
            const cards = planCards.querySelectorAll('.service-card[data-role="plano"]');
            cards.forEach(c => c.classList.toggle('active', c === card));
          }
          updateOrderBump(tipo, q);
          updatePromosSummary();
          try { updatePaymentMethodVisibility(); } catch(_) {}
        }
      } catch(_) {}
      try {
        if (!isInstagramPrivate && (isCurtidasContext || isViewsContext)) {
          const kind = isCurtidasContext ? 'likes' : 'views';
          renderSelectedPostsPreview(kind);
        }
      } catch(_) {}
      try { updatePedidoButtonState(); } catch(_) {}
    });
  }
  try { updatePaymentMethodVisibility(); } catch(_) {}
  try { selectPaymentMethod(String(window.currentPaymentMethod || 'pix')); } catch(_) {}
  
  // Default selection (Mistos)
  if (tipoSelect) {
    if (!tipoSelect.value) {
      tipoSelect.value = 'mistos';
    }
    // Always dispatch change to ensure cards are rendered and scroll logic runs
    setTimeout(() => {
        tipoSelect.dispatchEvent(new Event('change'));
    }, 100);
  }

  // Initial Step
  if (window.goToStep) window.goToStep(1);
  
  // Expor função para o EJS se necessário (mas tentamos evitar scripts inline)
  window.checkInstagramProfileCheckout = checkInstagramProfileCheckout;

  // --- Modals Logic (Warranty, Comments, Tools) ---
  const warrantyModal = document.getElementById('warranty60Modal');
  const warrantyInfoBtn = document.getElementById('warranty60InfoBtn');
  const warrantyInfoBtn30 = document.getElementById('warranty30InfoBtn');
  const warrantyInfoBtnLifetime = document.getElementById('warrantyLifetimeInfoBtn');
  const warrantyCloseBtn = document.getElementById('warranty60CloseBtn');
  if (warrantyInfoBtn && warrantyModal) {
    warrantyInfoBtn.addEventListener('click', function(){
      try {
        if (warrantyModal.parentNode !== document.body) {
          document.body.appendChild(warrantyModal);
        }
      } catch(_) {}
      warrantyModal.style.display = 'flex';
    });
  }
  if (warrantyInfoBtn30 && warrantyModal) {
    warrantyInfoBtn30.addEventListener('click', function(){
      try {
        if (warrantyModal.parentNode !== document.body) {
          document.body.appendChild(warrantyModal);
        }
      } catch(_) {}
      warrantyModal.style.display = 'flex';
    });
  }
  if (warrantyInfoBtnLifetime && warrantyModal) {
    warrantyInfoBtnLifetime.addEventListener('click', function(){
      try {
        if (warrantyModal.parentNode !== document.body) {
          document.body.appendChild(warrantyModal);
        }
      } catch(_) {}
      warrantyModal.style.display = 'flex';
    });
  }
  if (warrantyCloseBtn && warrantyModal) {
    warrantyCloseBtn.addEventListener('click', function(){ warrantyModal.style.display = 'none'; });
  }
  const warrantyCloseBtn2 = document.getElementById('warranty60CloseBtn2');
  if (warrantyCloseBtn2 && warrantyModal) {
    warrantyCloseBtn2.addEventListener('click', function(){ warrantyModal.style.display = 'none'; });
  }
  if (warrantyModal) {
    warrantyModal.addEventListener('click', function(e){ if (e.target === warrantyModal) { warrantyModal.style.display = 'none'; } });
  }

  const commentsModal = document.getElementById('commentsExampleModal');
  const commentsBtn = document.getElementById('commentsExampleBtn');
  const commentsCloseBtn = document.getElementById('commentsExampleCloseBtn');
  const commentsCloseBtn2 = document.getElementById('commentsExampleCloseBtn2');
  const commentsVideo = document.getElementById('commentsVideoPlayer');

  if (commentsBtn && commentsModal) {
    commentsBtn.addEventListener('click', function(e){
      try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch(_) {}
      try { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); } catch(_) {}
      try { if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); } catch(_) {}
      suppressOpenPostModalOnce = true;
      setTimeout(function(){ suppressOpenPostModalOnce = false; }, 500);
      try {
        if (commentsModal.parentNode !== document.body) {
          document.body.appendChild(commentsModal);
        }
      } catch(_) {}
      commentsModal.style.display = 'flex';
      if (commentsVideo) {
        try { commentsVideo.pause(); } catch(_) {}
        try { commentsVideo.currentTime = 0; } catch(_) {}
        try { commentsVideo.load(); } catch(_) {}
        try { commentsVideo.play(); } catch(e) { console.log('Video play failed', e); }
      }
    });
  }
  function closeCommentsModal() {
    if (commentsModal) commentsModal.style.display = 'none';
    if (commentsVideo) commentsVideo.pause();
  }
  if (commentsCloseBtn && commentsModal) {
    commentsCloseBtn.addEventListener('click', closeCommentsModal);
  }
  if (commentsCloseBtn2 && commentsModal) {
    commentsCloseBtn2.addEventListener('click', closeCommentsModal);
  }
  if (commentsModal) {
    commentsModal.addEventListener('click', function(e){ if (e.target === commentsModal) { closeCommentsModal(); } });
  }

  (function initSaleToasts(){
    const isCheckout = !!document.querySelector('.checkout-page');
    if (!isCheckout) return;
    const parent = document.querySelector('.checkout-page');
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
    }
    if (container.parentNode !== parent) {
      parent.appendChild(container);
    }

    const minutesCycle = [20, 12, 10, 6, 3, 1];
    let minutesIdx = 0;
    function nextMinutes(){ const m = minutesCycle[minutesIdx]; minutesIdx = (minutesIdx + 1) % minutesCycle.length; return m; }
    function getPlatformIcon(pl){
      if (pl === 'tiktok') {
        return '<svg class="toast-platform" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M14 3c.3 1.9 1.5 3.6 3.2 4.5 1 .6 2.1.9 3.2.9v3a8.6 8.6 0 01-3.2-.6 7.8 7.8 0 01-2.2-1.3v6.6a5.9 5.9 0 11-5.8-5.9c.4 0 .9.1 1.3.2v3a2.9 2.9 0 00-1.3-.3 2.9 2.9 0 102.9 2.9V3h2z"/></svg>';
      }
      return '<svg class="toast-platform" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7 2h10a5 5 0 015 5v10a5 5 0 01-5 5H7a5 5 0 01-5-5V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v10a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H7zm5 3a5 5 0 110 10 5 5 0 010-10zm0 2a3 3 0 100 6 3 3 0 000-6zm5.5-3a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>';
    }
    function showToast(message){
      if (!container) return;
      const t = document.createElement('div');
      t.className = 'toast';
      const icon = getPlatformIcon(message.platform || 'instagram');
      const timeText = message.time || `${nextMinutes()} minutes ago`;
      t.innerHTML = `<button class="toast-close" aria-label="Close">×</button>${icon}<div class="toast-body"><div class="toast-title"></div><div class="toast-desc"></div><div class="toast-meta"><span class="toast-dot"></span><span class="toast-time">${timeText}</span></div></div>`;
      const titleEl = t.querySelector('.toast-title');
      const descEl = t.querySelector('.toast-desc');
      if (titleEl) titleEl.textContent = message.title || '';
      if (descEl) descEl.textContent = message.desc || '';
      container.appendChild(t);
      const btn = t.querySelector('.toast-close');
      if (btn) {
        btn.addEventListener('click', function(){
          t.style.opacity='0';
          t.style.transform='translateX(100%)';
          setTimeout(()=>{ if(t.parentNode){ t.parentNode.removeChild(t);} },700);
        });
      }
      setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(100%)'; setTimeout(()=>{ if(t.parentNode){ t.parentNode.removeChild(t);} },700); },4000);
    }

    const combos = [];
    const tipos = Object.keys(tabela || {});
    tipos.forEach(tp => {
      const arr = Array.isArray(tabela[tp]) ? tabela[tp] : [];
      arr.forEach(it => { if (it && typeof it.q !== 'undefined') combos.push({ q: it.q, tipo: tp }); });
    });
    function pickAny(){ const c = combos[Math.floor(Math.random()*combos.length)] || { q: 150, tipo: (isCurtidasContext ? 'mistos' : (isViewsContext ? 'visualizacoes_reels' : 'mistos')) }; return c; }

    const firstNames = ['Michael','David','James','Daniel','Lucas','Ethan','Noah','Oliver','Henry','William','Emma','Sophia','Olivia','Ava','Mia','Isabella','Amelia','Charlotte','Emily','Grace'];
    const lastInitials = ['S','J','B','C','M','D','W','P','R','K','T','G','L','H','N','F','A','O'];
    let lastToastName = '';
    function makeNameUnique(){
      let attempt = 0; let name;
      do {
        const fn = firstNames[Math.floor(Math.random()*firstNames.length)] || 'Customer';
        const ln = lastInitials[Math.floor(Math.random()*lastInitials.length)] || 'S';
        name = `${fn} ${ln}.`;
        attempt++;
      } while (name === lastToastName && attempt < 10);
      lastToastName = name;
      return name;
    }

    function makeToast(){
      const name = makeNameUnique();
      const c = pickAny();
      const unit = (typeof getUnitForTipo === 'function') ? getUnitForTipo(c.tipo) : (isCurtidasContext ? 'likes' : (isViewsContext ? 'views' : 'followers'));
      const label = (typeof getLabelForTipo === 'function') ? getLabelForTipo(c.tipo) : String(c.tipo || '');
      const qLabel = Number(c.q || 0).toLocaleString('en-US');
      showToast({ title: `${name} confirmed a purchase`, desc: `Bought ${qLabel} ${unit} — ${label}`, platform: 'instagram' });
    }

    function cycle(){
      makeToast();
      setTimeout(cycle, 15000);
    }
    setTimeout(cycle, 7000);
  })();
});
