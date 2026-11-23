// ══════════════════════════════════════════════════════════════════════════
// YOU AGENCY — camada própria sobre a base original
//
// O app.js segue a base original (despacho, painel admin, refil, gestões). Este módulo é
// registrado logo depois dos middlewares e ANTES das rotas do app.js, então o que está
// aqui tem prioridade:
//   • bloqueia o que o You Agency não usa (WhatsApp/IA, nota fiscal e controladoria,
//     Meta Ads, Pix e recuperação de Pix, Stripe e demais gateways);
//   • páginas do cliente em inglês (/engagement, /instagram-services, /order, /refill...);
//   • pagamento em cripto pela NOWPayments (fatura hospedada + IPN).
// As funções do app.js chegam por `deps` (getters, resolvidos na hora da requisição).
// ══════════════════════════════════════════════════════════════════════════
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const axios = require('axios');

// Moeda dos preços do site (tabelas do pricing.js). Padrão: peso mexicano.
const MOEDA_VENDA = String(process.env.YA_CURRENCY || 'mxn').trim().toLowerCase();
const NOWPAYMENTS_API_BASE = 'https://api.nowpayments.io/v1';
const nowpaymentsKeepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 10000 });

// TikTok e Facebook (preços em pricing.js → tabelaRedes; despacho em app.js → REDES_SERVICOS).
const REDES_CATALOGO_TIPOS = {
  tiktok_seguidores:          { rede: 'tiktok',   titulo: 'Seguidores',             unidade: 'seguidores',      alvo: 'perfil', desc: 'Seguidores para tu perfil de TikTok. Solo necesitas el enlace de tu perfil.' },
  tiktok_curtidas:            { rede: 'tiktok',   titulo: 'Me gusta',               unidade: 'me gusta',        alvo: 'post',   desc: 'Me gusta para un video de TikTok. Pega el enlace del video.' },
  tiktok_curtidas_reais:      { rede: 'tiktok',   titulo: 'Me gusta reales',        unidade: 'me gusta',        alvo: 'post',   desc: 'Me gusta de perfiles reales para un video de TikTok. Pega el enlace del video.' },
  tiktok_visualizacoes:       { rede: 'tiktok',   titulo: 'Vistas',        unidade: 'vistas', alvo: 'post',   desc: 'Vistas para un video de TikTok. Pega el enlace del video.' },
  tiktok_comentarios:         { rede: 'tiktok',   titulo: 'Comentarios',            unidade: 'comentarios',     alvo: 'post',   desc: 'Comentarios para un video de TikTok. Pega el enlace del video.' },
  // Um tipo só: os serviços entregam tanto em perfil quanto em página (fanpage).
  facebook_seguidores:        { rede: 'facebook', titulo: 'Seguidores',             unidade: 'seguidores',      alvo: 'perfil', desc: 'Seguidores para tu perfil o página de Facebook. Pega el enlace del perfil o de la página.' },
  facebook_curtidas:          { rede: 'facebook', titulo: 'Me gusta',               unidade: 'me gusta',        alvo: 'post',   desc: 'Me gusta para una publicación de Facebook. Pega el enlace de la publicación.' },
  facebook_visualizacoes:     { rede: 'facebook', titulo: 'Vistas',        unidade: 'vistas', alvo: 'post',   desc: 'Vistas para un video o reel de Facebook. Pega el enlace del video.' },
  facebook_comentarios:       { rede: 'facebook', titulo: 'Comentarios',            unidade: 'comentarios',     alvo: 'post',   desc: 'Comentarios para una publicación o video de Facebook. Pega el enlace.' },
};
function linkRedeOk(rede, url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u) || u.length > 500) return false;
  if (rede === 'tiktok') return /^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(u);
  if (rede === 'facebook') return /^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fb\.com|fb\.watch)\//i.test(u);
  return false;
}

function getNowPaymentsConfig() {
  return {
    apiKey: String(process.env.NOWPAYMENTS_API_KEY || '').trim(),
    ipnSecret: String(process.env.NOWPAYMENTS_IPN_SECRET || '').trim()
  };
}

// Xpag (México: SPEI e OXXO). Credenciais no .env; sem token, vão em headers a cada chamada.
function getXpagConfig() {
  return {
    apiBase: String(process.env.XPAG_API_BASE || 'https://api.xpag.global').trim().replace(/\/+$/, ''),
    clientId: String(process.env.XPAG_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.XPAG_CLIENT_SECRET || '').trim()
  };
}
function xpagHeaders(cfg) {
  return { 'X-Client-Id': cfg.clientId, 'X-Client-Secret': cfg.clientSecret, 'Content-Type': 'application/json' };
}
// SPEI usa CLABE ABERTA (orientação do suporte da Xpag): sem amount + external_id do pedido = 1 CLABE
// por pedido, que não vence e aceita vários pagamentos (um webhook por pagamento). Nós somamos:
// completou ou passou do valor → libera; pagou menos → mostra o restante na mesma CLABE.
function xpagCorpoClabeAberta({ externalId, webhookUrl, description, nome }) {
  return Object.assign({ currency: 'MXN', external_id: externalId, webhook_url: webhookUrl, description }, nome ? { name: nome } : {});
}
// OXXO: desligado em 15/11/2026 e religado a pedido do responsável em 17/11/2026 (site com SPEI + OXXO).
// XPAG_OXXO_ENABLED=0 desliga de novo (toda cobrança nova sai em SPEI; pedidos OXXO já criados seguem normais).
function xpagOxxoLigado() { return String(process.env.XPAG_OXXO_ENABLED || '1') !== '0'; }
function xpagEhClabeAberta(x) {
  return !!(x && x.open_value === true && String(x.method || 'SPEI').toUpperCase() === 'SPEI');
}

// URL pública do site (IPN e redirecionamentos). Fora de localhost, sempre https.
function getPublicBaseUrl(req) {
  const env = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  try {
    const host = String(req.get('host') || '').trim();
    if (!host) return '';
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    return `${isLocal ? (req.protocol || 'http') : 'https'}://${host}`;
  } catch (_) { return ''; }
}

// Rotas da base original que NÃO existem no You Agency (prefixo do caminho).
const BLOQUEADAS = [
  // WhatsApp / bot IA / LTV por WhatsApp
  '/api/whatsapp', '/api/whatsapp-ia', '/api/internal/ia-check-profile', '/api/admin/evolution', '/api/painel/evolution',
  '/api/painel/ia-crm', '/api/painel/ia-followup', '/api/painel/ltv', '/api/painel/whatsapp', '/api/painel/remarketing',
  '/api/painel/openai-credito', '/painel/whatsapp', '/painel_whatsapp', '/painel/vendas-whatsapp', '/painel/ia-crm',
  '/painel/ia-followup', '/painel/ltv', '/painel/recuperacao-whatsapp',
  // Nota fiscal, controladoria e enriquecimento fiscal (CPF)
  '/painel/controladoria', '/painel/notas-fiscais', '/api/admin/controladoria', '/api/admin/fiscal', '/api/admin/spedy',
  '/api/spedy', '/api/painel/notas-fiscais',
  // Pix, recuperação de Pix e gateways que o You Agency não usa (só NOWPayments)
  // (/api/recovery/context liberado: o link do e-mail de recuperação recarrega o pedido pelo token assinado)
  '/painel/recuperacao', '/api/painel/order-recovery', '/api/admin/recovery-links',
  '/api/paghiper', '/api/painel/paghiper', '/api/woovi', '/api/openpix', '/api/efi', '/api/expay', '/api/stripe',
  '/api/pagarme', '/api/payment/confirm', '/webhook/validar-confirmado', '/pix',
  // Páginas sem versão You Agency
  '/presell'
];

// Liberadas mesmo casando com um prefixo bloqueado: bot IA do WhatsApp (webhook + checagem de perfil)
// e o CRM dele no painel (conversas e follow-up). send-text: botão "Enviar msg" do painel de privados (instância famaapp).
const LIBERADAS = ['/api/whatsapp-ia', '/api/admin/evolution/send-text', '/api/internal/ia-check-profile', '/api/painel/ia-crm', '/painel/ia-crm', '/api/painel/ia-followup', '/painel/ia-followup'];
function bloqueada(p) {
  const s = String(p || '').toLowerCase();
  const casa = (b) => s === b || s.startsWith(b + '/') || s.startsWith(b + '-') || s.startsWith(b + '?');
  if (LIBERADAS.some(casa)) return false;
  return BLOQUEADAS.some(casa);
}

module.exports.register = function register(app, deps) {
  // Token anti-abuso das rotas de Instagram (ver x-ya-api-tk no app.js): o front do You
  // Agency lê este cookie e manda no header X-Ya-Api-Tk (public/js/main.js).
  app.use((req, res, next) => {
    try {
      const tk = req.session && req.session.yaApiTk ? String(req.session.yaApiTk) : '';
      if (tk && req.method === 'GET' && !String(req.path).startsWith('/api/') && (req.get('accept') || '').includes('text/html')) {
        res.cookie('ya_tk', tk, { httpOnly: false, sameSite: 'lax', path: '/' });
      }
    } catch (_) {}
    next();
  });

  // Métodos de pagamento disponíveis para as páginas (SPEI/OXXO só com Xpag configurada e preço em MXN).
  app.use((req, res, next) => {
    try { res.locals.XPAG_ENABLED = !!(getXpagConfig().clientId && MOEDA_VENDA === 'mxn'); } catch (_) { res.locals.XPAG_ENABLED = false; }
    res.locals.XPAG_OXXO = xpagOxxoLigado();
    next();
  });

  app.use((req, res, next) => {
    if (!bloqueada(req.path)) return next();
    if (String(req.path).startsWith('/api/') || req.method !== 'GET') return res.status(404).json({ ok: false, error: 'not_available' });
    return res.status(404).send('No encontrado');
  });

  // Endereços em espanhol. ESPANHOL -> rota interna que monta a página (inglês do You Agency
  // ou português da base Oppus). ANTIGOS -> 301 para o endereço em espanhol, para links,
  // anúncios e e-mails já enviados continuarem funcionando.
  const ENDERECOS_ES = {
    '/interaccion': '/engagement',
    '/servicios': '/services',
    '/servicios-instagram': '/instagram-services',
    '/servicios-me-gusta': '/likes-services',
    '/servicios-visualizaciones': '/views-services',
    '/servicios-comentarios': '/servicos-comentarios',
    '/reposicion': '/refil',
    '/terminos': '/terms',
    '/agencia': '/agency',
    '/acceso-restringido': '/restrito',
    '/cliente/olvide-mi-contrasena': '/cliente/esqueci-senha'
  };
  const ENDERECOS_ANTIGOS = {
    '/engagement': '/interaccion', '/engajamento': '/interaccion', '/engagement-new': '/interaccion', '/engajamento-novo': '/interaccion',
    '/services': '/servicios', '/servicos': '/servicios',
    '/instagram-services': '/servicios-instagram',
    '/likes-services': '/servicios-me-gusta', '/servicos-curtidas': '/servicios-me-gusta',
    '/views-services': '/servicios-visualizaciones', '/servicos-visualizacoes': '/servicios-visualizaciones',
    '/servicos-comentarios': '/servicios-comentarios',
    '/customer': '/cliente', '/order': '/pedido',
    '/refill': '/reposicion', '/refil': '/reposicion', '/refil2': '/reposicion',
    '/terms': '/terminos', '/terms-of-use': '/terminos', '/termos': '/terminos',
    '/agency': '/agencia', '/restrito': '/acceso-restringido',
    '/cliente/esqueci-senha': '/cliente/olvide-mi-contrasena'
  };
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = (String(req.path || '/').replace(/\/+$/, '') || '/').toLowerCase();
    const i = req.url.indexOf('?');
    const qs = i >= 0 ? req.url.slice(i) : '';
    if (ENDERECOS_ANTIGOS[p]) return res.redirect(301, ENDERECOS_ANTIGOS[p] + qs);
    if (ENDERECOS_ES[p]) req.url = ENDERECOS_ES[p] + qs;
    next();
  });

  // Web Tag da TrackCombo (container youagency-mx) em todas as páginas do cliente (fora painel/API).
  // Ela grava o clique do anúncio (_fbc/_fbp, gclid, UTMs) e manda PageView etc. A compra do SITE vai
  // pela TrackCombo (webhook da Xpag repassado + evento add_payment_info na tela /pago).
  const TC_TAG = String(process.env.YA_TRACKCOMBO_TAG_URL || 'https://track.youagency.site/tag/TC-OISDR3RC.js').trim();
  if (TC_TAG) {
    const snippet = '<script>(function(){var s=document.createElement("script");s.async=true;s.src=' + JSON.stringify(TC_TAG) + ';var f=document.getElementsByTagName("script")[0];if(f&&f.parentNode)f.parentNode.insertBefore(s,f);else document.head.appendChild(s);})();</script>';
    app.use((req, res, next) => {
      if (req.method !== 'GET' || /^\/(api|painel|admin|css|js|images|fonts|uploads)(\/|$)/i.test(req.path) || /\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
      const send = res.send;
      res.send = function (body) {
        try {
          if (typeof body === 'string' && body.indexOf('</head>') >= 0 && body.indexOf(TC_TAG) < 0 && /text\/html/i.test(String(res.get('Content-Type') || 'text/html'))) {
            body = body.replace('</head>', snippet + '</head>');
          }
        } catch (_) {}
        return send.call(this, body);
      };
      next();
    });
  }
  // Botão do WhatsApp do site: guarda o código "(#XXXXX)" com a origem da visita.
  const __waRefHits = new Map();
  app.post('/api/wa-ref', async (req, res) => {
    try {
      const ip = String(req.realIP || req.ip || ''); const agora = Date.now();
      const h = (__waRefHits.get(ip) || []).filter((t) => agora - t < 600000);
      if (h.length >= 30) return res.status(429).end();
      h.push(agora); __waRefHits.set(ip, h); if (__waRefHits.size > 5000) __waRefHits.clear();
      await require('./metaCapi.js').salvarRefSite(req);
    } catch (_) {}
    return res.status(204).end();
  });

  app.get('/__health', (req, res) => res.json({ ok: true, app: 'you-agency', pid: process.pid, now: new Date().toISOString() }));

  app.get('/images/logo.png', (req, res) => res.sendFile(path.join(deps.rootDir, 'public', 'images', 'y preto.png')));

  const phoneDialCache = new Map();
  app.get('/api/geo/phone-default', async (req, res) => {
    const vazio = { dial: '', callingCode: '', country: '', countryCode: '' };
    try {
      let ip = String(req.realIP || req.ip || '').split(',')[0].trim().replace('::ffff:', '');
      if (!ip || ip === '::1' || ip === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip)) return res.json(vazio);
      const c = phoneDialCache.get(ip);
      let data = (c && Date.now() - c.ts < 6 * 3600 * 1000) ? c.data : undefined;
      if (data === undefined) {
        data = null;
        try {
          const r = await axios.get(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,calling_code`, { timeout: 1500, validateStatus: () => true });
          const x = r && r.data;
          if (x && x.success === true && x.calling_code) {
            const dial = String(x.calling_code).trim();
            data = { dial: dial.startsWith('+') ? dial : `+${dial}`, country: String(x.country || ''), countryCode: String(x.country_code || '').toUpperCase() };
          }
        } catch (_) {}
        phoneDialCache.set(ip, { ts: Date.now(), data });
      }
      if (!data) return res.json(vazio);
      return res.json({ dial: data.dial, callingCode: data.dial.replace(/[^\d]/g, ''), country: data.country, countryCode: data.countryCode });
    } catch (_) { return res.json(vazio); }
  });

  // ── Páginas do cliente (versão You Agency, em inglês) ──
  app.get('/', (req, res) => {
      console.log('🏠 Acessando rota / (home -> engajamento)');
      try {
          if (req.session) {
              req.session.selectedOrderID = undefined;
              req.session.lastPaidIdentifier = '';
              req.session.lastPaidCorrelationID = '';
          }
      } catch (_) {}
      const q = (function () {
          try {
              const u = String(req.originalUrl || req.url || '').trim();
              const i = u.indexOf('?');
              return i >= 0 ? u.slice(i + 1) : '';
          } catch (_) {
              return '';
          }
      })();
      return res.redirect(q ? (`/interaccion?${q}`) : '/interaccion');
  });
  
  app.get('/terms', (req, res) => {
    const hasLang = !!String(req.query?.lang || req.query?.language || '').trim();
    const language = hasLang ? (String(req.query?.lang || req.query?.language || '').trim().toLowerCase() === 'en' ? 'en' : '') : 'en';
    res.render('termos', { language }, (err, html) => {
      if (err) {
        console.error('Erro ao renderizar termos:', err.message);
        return res.status(500).send('Error al abrir los Términos de uso');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  app.get('/termos', (req, res) => {
    const qs = (function () {
      try {
        const q = new URLSearchParams(req.query || {});
        return q.toString();
      } catch (_) { return ''; }
    })();
    return res.redirect(qs ? (`/terms?${qs}`) : '/terms');
  });
  
  // Página de Termos de Uso (render)
  app.get('/terms-of-use', (req, res) => {
    const hasLang = !!String(req.query?.lang || req.query?.language || '').trim();
    const language = hasLang ? (String(req.query?.lang || req.query?.language || '').trim().toLowerCase() === 'en' ? 'en' : '') : 'en';
    res.render('termos', { language }, (err, html) => {
      if (err) {
        console.error('Erro ao renderizar termos:', err.message);
        return res.status(500).send('Error al abrir los Términos de uso');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  app.get('/agency', (req, res) => {
    res.render('agency', {}, (err, html) => {
      if (err) {
        console.error('Erro ao renderizar agency:', err.message);
        return res.status(500).send('Error al abrir la página');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  // Área de clientes: /customer usa a lógica completa do app.js (/cliente): login por correo,
  // código OTP, crear contraseña, recuperar contraseña y lista de pedidos.

  app.get('/checkout', (req, res) => {
      console.log('🛒 Acessando rota /checkout');
      try {
          if (req.session) {
              req.session.selectedFor = {};
              req.session.selectedPosts = [];
          }
      } catch (_) {}
      return res.render('checkout', {
          EXPAY_DEFAULT_CPF_ENABLED: (process.env.NODE_ENV !== 'production') && !!String(process.env.EXPAY_DEFAULT_CPF || '').trim()
      });
  });
  
  // Prova social da página inicial: só pedidos PAGOS de verdade (últimas 72 h), @ mascarado. Cache 5 min.
  let __provaCache = { at: 0, itens: [] };
  app.get('/api/prova-social', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=120');
      if (Date.now() - __provaCache.at < 5 * 60e3) return res.json({ ok: true, itens: __provaCache.itens });
      const { getCollection } = require('./mongodbClient');
      const col = await getCollection('checkout_orders');
      const desde = new Date(Date.now() - 72 * 3600e3).toISOString();
      const docs = await col.find({ status: 'pago', paidAt: { $gte: desde } }, { projection: { instagramUsername: 1, additionalInfo: 1, additionalInfoMapPaid: 1, paidAt: 1 } }).sort({ paidAt: -1 }).limit(30).toArray();
      const info = (o, k) => { const m = o.additionalInfoMapPaid || {}; if (m[k] != null) return String(m[k]); const it = (o.additionalInfo || []).find((x) => x && x.key === k); return it ? String(it.value) : ''; };
      const nomeSv = (cat, tipo) => {
        const c = String(cat || '').toLowerCase(), t = String(tipo || '').toLowerCase();
        if (/tiktok/.test(c + t)) return /curtid|like/.test(t) ? 'me gusta en TikTok' : (/visual|view/.test(t) ? 'vistas en TikTok' : 'seguidores en TikTok');
        if (/facebook/.test(c + t)) return /curtid|like/.test(t) ? 'me gusta en Facebook' : (/visual|view/.test(t) ? 'vistas en Facebook' : 'seguidores en Facebook');
        if (/coment/.test(c + t)) return 'comentarios';
        if (/curtid/.test(c)) return 'me gusta';
        if (/visual/.test(c)) return 'vistas';
        return 'seguidores';
      };
      const itens = [];
      for (const o of docs) {
        const u = String(o.instagramUsername || info(o, 'instagram_username') || '').replace(/^@+/, '').trim();
        const q = parseInt(info(o, 'quantidade'), 10) || 0;
        if (!u || !q) continue;
        itens.push({ u: u.slice(0, 3) + '***', q, sv: nomeSv(info(o, 'categoria_servico'), info(o, 'tipo_servico')), t: new Date(o.paidAt).getTime() });
        if (itens.length >= 12) break;
      }
      __provaCache = { at: Date.now(), itens };
      return res.json({ ok: true, itens });
    } catch (_) { return res.json({ ok: true, itens: [] }); }
  });
  app.get('/engagement', (req, res) => {
    console.log('📈 Acessando rota /engagement');
    try { deps.trackPageView(req, '/interaccion'); } catch (_) {} // entrada do anúncio: 1º passo do funil por visitante
    // "Paquetes desde": menor preço de cada tabela do pricing.js (não fica desatualizado quando o preço muda).
    let precosInicio = null;
    try {
      const P = require('./pricing');
      const desde = (...tabs) => { const v = tabs.flat().filter(Boolean).map((x) => P.parsePrecoToCents(x.p)).filter((c) => c > 0); return v.length ? '$ ' + Math.round(Math.min(...v) / 100) : null; };
      precosInicio = {
        seg: desde(P.tabelaSeguidores.mistos),
        segTt: desde(P.tabelaRedes && P.tabelaRedes.tiktok_seguidores),
        segFb: desde(P.tabelaRedes && P.tabelaRedes.facebook_seguidores),
        curt: desde(P.tabelaCurtidas.mistos, P.tabelaCurtidas.organicos),
        views: desde(P.tabelaVisualizacoes.visualizacoes_reels),
        comIg: '$ 20', // comentário do Instagram: $20 cada (pricing.js)
        comRedes: desde(P.tabelaRedes && P.tabelaRedes.tiktok_comentarios),
      };
    } catch (_) {}
    res.render('engajamento', {
      queryParams: req.query,
      precosInicio
    }, (err, html) => {
      if (err) {
        console.error('❌ Erro ao renderizar engajamento:', err.message);
        return res.status(500).send('Error al cargar la página');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  app.get('/engajamento', (req, res) => {
    const qs = (function () {
      try {
        const q = new URLSearchParams(req.query || {});
        return q.toString();
      } catch (_) { return ''; }
    })();
    return res.redirect(qs ? (`/engagement?${qs}`) : '/engagement');
  });
  
  // Engagement (new) page
  // A página nova de engajamento cobra por PIX (herdada da Oppus): o You Agency usa só SPEI/OXXO,
  // então ela leva para /engagement, que tem o seletor da Xpag.
  app.get('/engagement-new', (req, res) => {
    const q = new URLSearchParams(req.query || {}).toString();
    return res.redirect(302, q ? `/engagement?${q}` : '/engagement');
    // eslint-disable-next-line no-unreachable
    res.render('engajamento-novo', { 
      queryParams: req.query
    }, (err, html) => {
      if (err) {
        console.error('❌ Erro ao renderizar engajamento-novo:', err.message);
        return res.status(500).send('Error al cargar la página');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  app.get('/engajamento-novo', (req, res) => {
    const qs = (function () {
      try {
        const q = new URLSearchParams(req.query || {});
        return q.toString();
      } catch (_) { return ''; }
    })();
    return res.redirect(qs ? (`/engagement-new?${qs}`) : '/engagement-new');
  });
  
  app.get('/services', (req, res) => {
    console.log('🧩 Acessando rota /services');
    res.render('servicos', { queryParams: req.query }, (err, html) => {
      if (err) {
        console.error('❌ Erro ao renderizar servicos:', err.message);
        return res.status(500).send('Error al cargar la página');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  app.get('/servicos', (req, res) => {
    const qs = (function () {
      try {
        const q = new URLSearchParams(req.query || {});
        return q.toString();
      } catch (_) { return ''; }
    })();
    return res.redirect(qs ? (`/services?${qs}`) : '/services');
  });
  
  // TikTok e Facebook: uma página só (servicos-redes.ejs) que muda pela rede.
  const renderRede = (rede) => (req, res) => {
    try { deps.trackPageView(req, `/servicios-${rede}`); } catch (_) {}
    res.render('servicos-redes', { rede, queryParams: req.query }, (err, html) => {
      if (err) {
        console.error('❌ Erro ao renderizar servicos-redes:', err.message);
        return res.status(500).send('Error al cargar la página');
      }
      res.type('text/html');
      res.send(html);
    });
  };
  // Busca do perfil na etapa 2 (igual ao "Buscar" do Instagram). TikTok: página mobile pública
  // (__UNIVERSAL_DATA_FOR_REHYDRATION__) com seguidores/privado. Facebook: og:tags servidas ao
  // crawler (nome, foto e "N seguidores" da descrição). Cache 10 min e limite por IP.
  const __redesPerfilCache = new Map();
  const __redesPerfilHits = new Map();
  const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const UA_FB_CRAWLER = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
  const normalizaEntradaRede = (rede, q) => {
    let v = String(q || '').trim();
    if (rede === 'tiktok') {
      const m = v.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
      v = (m ? m[1] : v).replace(/^@+/, '').replace(/[/?#].*$/, '');
      return /^[A-Za-z0-9._]{2,24}$/.test(v) ? { user: v.toLowerCase(), url: 'https://www.tiktok.com/@' + v.toLowerCase() } : null;
    }
    if (/^([a-z0-9-]+\.)*(facebook\.com|fb\.com)\//i.test(v)) v = 'https://' + v; // colou sem https://
    if (/^https?:\/\//i.test(v)) {
      if (!/^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fb\.com)\//i.test(v)) return null;
      const u = v.replace(/^http:/i, 'https:').replace(/[?#].*$/, '').replace(/\/+$/, '');
      const pid = v.match(/profile\.php\?id=(\d+)/i);
      return { user: pid ? pid[1] : u.split('/').pop(), url: pid ? 'https://www.facebook.com/profile.php?id=' + pid[1] : u.replace(/^https:\/\/(m\.|web\.)?facebook\.com/i, 'https://www.facebook.com') };
    }
    v = v.replace(/^@+/, '');
    if (/^\d{5,20}$/.test(v)) return { user: v, url: 'https://www.facebook.com/profile.php?id=' + v };
    return /^[A-Za-z0-9.]{3,60}$/.test(v) ? { user: v, url: 'https://www.facebook.com/' + v } : null;
  };
  const numeroSeguidores = (txt) => {
    const m = String(txt || '').match(/([\d.,]+)\s*(mil|k|m|mi)?\s*(seguidores|followers)/i);
    if (!m) return null;
    let n = Number(String(m[1]).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    const suf = String(m[2] || '').toLowerCase();
    if (suf === 'mil' || suf === 'k') n *= 1e3; else if (suf === 'm' || suf === 'mi') n *= 1e6;
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  // Embed do criador do TikTok (tiktok.com/embed/@usuario): não bloqueia o IP do servidor como a página
  // do perfil e traz userInfo (seguidores, privado…) + os 10 vídeos mais recentes. Cache 10 min.
  const __ttEmbedCache = new Map();
  async function tiktokEmbedData(user) {
    const k = String(user || '').toLowerCase();
    const c = __ttEmbedCache.get(k);
    if (c && Date.now() - c.at < 10 * 60000) return c.data;
    const r = await axios.get('https://www.tiktok.com/embed/@' + encodeURIComponent(k), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept-Language': 'es-MX,es;q=0.9' }, timeout: 15000, validateStatus: () => true });
    if (r.status === 400 || r.status === 404) return { naoExiste: true };
    const m = String(r.data || '').match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const dataMap = ((JSON.parse(m[1]).source || {}).data) || {};
    const src = Object.values(dataMap).find((x) => x && x.userInfo) || null;
    if (!src || !src.userInfo || !src.userInfo.uniqueId) return null;
    const uname = src.userInfo.uniqueId;
    const videos = (Array.isArray(src.videoList) ? src.videoList : [])
      .filter((v) => v && v.id && !v.privateItem)
      .map((v) => {
        // O ID do vídeo do TikTok guarda o horário da postagem nos 32 bits de cima (segundos unix).
        let ts = null; try { const s = Number(BigInt(String(v.id)) >> 32n); if (s > 1.4e9 && s < Date.now() / 1000 + 86400) ts = s; } catch (_) {}
        return { id: String(v.id), link: 'https://www.tiktok.com/@' + uname + '/video/' + v.id, capa: v.coverUrl || v.originCoverUrl || '', views: Number.isFinite(Number(v.playCount)) ? Number(v.playCount) : null, desc: String(v.desc || '').slice(0, 120), ts };
      });
    const data = { userInfo: src.userInfo, videos };
    __ttEmbedCache.set(k, { at: Date.now(), data });
    if (__ttEmbedCache.size > 2000) __ttEmbedCache.clear();
    return data;
  }

  async function buscarPerfilRede(rede, alvo) {
    if (rede === 'tiktok') {
      // 1) página pública (mobile e depois desktop) com seguidores/privado; 2) oEmbed oficial
      // (só nome/existência) quando o TikTok não entrega os dados para o IP do servidor.
      const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
      let naoExiste = false;
      for (const ua of [UA_MOBILE, UA_DESKTOP]) {
        try {
          const r = await axios.get(alvo.url + '?lang=es', { headers: { 'User-Agent': ua, 'Accept-Language': 'es-MX,es;q=0.9' }, timeout: 15000, validateStatus: () => true });
          const m = String(r.data || '').match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
          if (!m) continue;
          const d = (JSON.parse(m[1]).__DEFAULT_SCOPE__ || {})['webapp.user-detail'] || {};
          const ui = d.userInfo || {};
          if (!ui.user || !ui.user.uniqueId) { naoExiste = Number(d.statusCode) === 10221 || Number(d.statusCode) === 10202; if (naoExiste) break; continue; }
          const st = ui.stats || {};
          const st2 = ui.statsV2 || {};
          // heartCount estoura int32 em perfis grandes (vem negativo): usa o statsV2 (string) ou o "heart".
          const num = (...vs) => { for (const v of vs) { const n = Number(v); if (Number.isFinite(n) && n >= 0) return n; } return null; };
          return { ok: true, rede, username: ui.user.uniqueId, nome: ui.user.nickname || '', avatar: ui.user.avatarMedium || ui.user.avatarThumb || '', privado: !!ui.user.privateAccount, verificado: !!ui.user.verified, seguidores: num(st2.followerCount, st.followerCount), seguindo: num(st2.followingCount, st.followingCount), posts: num(st2.videoCount, st.videoCount), curtidas: num(st2.heartCount, st.heart, st.heartCount), link: 'https://www.tiktok.com/@' + ui.user.uniqueId };
        } catch (_) {}
      }
      if (naoExiste) return { ok: false, error: 'nao_encontrado' };
      // Página do perfil bloqueada para o servidor: embed do criador (mesmos números, sem contagem de vídeos).
      try {
        const e = await tiktokEmbedData(alvo.user);
        if (e && e.naoExiste) return { ok: false, error: 'nao_encontrado' };
        if (e && e.userInfo) {
          const ui = e.userInfo; const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
          return { ok: true, rede, username: ui.uniqueId, nome: ui.nickname || '', avatar: ui.avatarThumbUrl || '', privado: !!ui.privateAccount, verificado: !!ui.verified, seguidores: num(ui.followerCount), seguindo: num(ui.followingCount), posts: null, curtidas: num(ui.heartCount), link: 'https://www.tiktok.com/@' + ui.uniqueId };
        }
      } catch (_) {}
      try {
        const o = await axios.get('https://www.tiktok.com/oembed', { params: { url: alvo.url }, timeout: 15000, validateStatus: () => true });
        const od = (o && o.data && typeof o.data === 'object') ? o.data : null;
        if (od && (od.author_name || od.embed_product_id)) {
          const user = String(od.embed_product_id || alvo.user);
          return { ok: true, rede, username: user, nome: od.author_name || '', avatar: '', privado: false, verificado: false, seguidores: null, seguindo: null, posts: null, link: 'https://www.tiktok.com/@' + user, parcial: true };
        }
        if (o && o.status >= 400) return { ok: false, error: 'nao_encontrado' };
      } catch (_) {}
      console.warn('⚠️ [redes/perfil] TikTok sem dados para', alvo.user);
      return { ok: false, error: 'indisponivel' };
    }
    const r = await axios.get(alvo.url, { headers: { 'User-Agent': UA_FB_CRAWLER }, timeout: 20000, maxRedirects: 5, validateStatus: () => true });
    const h = String(r.data || '');
    const og = (p) => { const m = h.match(new RegExp('<meta property="og:' + p + '" content="([^"]*)"')); return m ? m[1].replace(/&amp;/g, '&').replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&quot;/g, '"') : ''; };
    const titulo = og('title');
    if (r.status >= 400 || !titulo || /^(facebook|log in|iniciar sesi|entrar)/i.test(titulo)) return { ok: false, error: 'nao_encontrado' };
    return { ok: true, rede, username: alvo.user, nome: titulo, avatar: og('image'), privado: false, verificado: false, seguidores: numeroSeguidores(og('description')), seguindo: null, posts: null, link: alvo.url };
  }
  app.get('/api/redes/perfil', async (req, res) => {
    try {
      const rede = String(req.query.rede || '').toLowerCase() === 'facebook' ? 'facebook' : 'tiktok';
      const alvo = normalizaEntradaRede(rede, req.query.q);
      if (!alvo) return res.status(400).json({ ok: false, error: 'entrada_invalida' });
      const ip = String(req.realIP || req.ip || '');
      const agora = Date.now();
      const hits = (__redesPerfilHits.get(ip) || []).filter((t) => agora - t < 60000);
      if (hits.length >= 20) return res.status(429).json({ ok: false, error: 'muitas_buscas' });
      hits.push(agora); __redesPerfilHits.set(ip, hits);
      const ck = rede + ':' + alvo.url.toLowerCase();
      const c = __redesPerfilCache.get(ck);
      if (c && agora - c.at < 10 * 60000) return res.json(c.data);
      const data = await buscarPerfilRede(rede, alvo);
      if (data.ok) { __redesPerfilCache.set(ck, { at: agora, data }); if (__redesPerfilCache.size > 2000) __redesPerfilCache.clear(); }
      return res.status(data.ok ? 200 : 404).json(data);
    } catch (e) {
      return res.status(502).json({ ok: false, error: 'indisponivel' });
    }
  });
  // Vídeos recentes do perfil do TikTok (até 10, do embed do criador) para a grade da etapa 2.
  app.get('/api/redes/videos', async (req, res) => {
    try {
      if (String(req.query.rede || '').toLowerCase() !== 'tiktok') return res.status(400).json({ ok: false, error: 'rede_sem_lista' });
      const alvo = normalizaEntradaRede('tiktok', req.query.q);
      if (!alvo) return res.status(400).json({ ok: false, error: 'entrada_invalida' });
      const ip = String(req.realIP || req.ip || '');
      const agora = Date.now();
      const hits = (__redesPerfilHits.get(ip) || []).filter((t) => agora - t < 60000);
      if (hits.length >= 20) return res.status(429).json({ ok: false, error: 'muitas_buscas' });
      hits.push(agora); __redesPerfilHits.set(ip, hits);
      const e = await tiktokEmbedData(alvo.user);
      if (e && e.naoExiste) return res.status(404).json({ ok: false, error: 'nao_encontrado' });
      if (!e || !e.userInfo) return res.status(502).json({ ok: false, error: 'indisponivel', videos: [] });
      if (e.userInfo.privateAccount) return res.json({ ok: true, privado: true, videos: [] });
      return res.json({ ok: true, username: e.userInfo.uniqueId, videos: e.videos });
    } catch (_) { return res.status(502).json({ ok: false, error: 'indisponivel', videos: [] }); }
  });
  // Foto do perfil via servidor (os CDNs do TikTok/Facebook recusam hotlink sem o UA certo).
  app.get('/api/redes/avatar', async (req, res) => {
    try {
      const u = String(req.query.u || '');
      if (!/^https:\/\/([a-z0-9-]+\.)*(tiktokcdn\.com|tiktokcdn-us\.com|fbsbx\.com|fbcdn\.net)\//i.test(u)) return res.status(400).end();
      const r = await axios.get(u, { responseType: 'arraybuffer', headers: { 'User-Agent': /fbsbx|fbcdn/i.test(u) ? UA_FB_CRAWLER : UA_MOBILE }, timeout: 15000, maxContentLength: 3 * 1024 * 1024, validateStatus: () => true });
      const ct = String(r.headers['content-type'] || '');
      if (r.status >= 400 || !/^image\//i.test(ct)) return res.status(404).end();
      res.set('Content-Type', ct); res.set('Cache-Control', 'public, max-age=3600');
      return res.send(Buffer.from(r.data));
    } catch (_) { return res.status(404).end(); }
  });
  app.get('/servicios-tiktok', renderRede('tiktok'));
  app.get('/servicios-facebook', renderRede('facebook'));
  // ── Ventas recientes (prueba social con compras REALES) ──
  // Últimas ventas PAGADAS (sitio y bot) de las últimas 72 h: @ enmascarado, paquete y hace cuánto.
  // Nada inventado: sin ventas recientes, la lista va vacía y el sitio no muestra nada. /api/social-proof
  // (heredado de la Oppus, que inventaba nombres) devuelve lo mismo.
  let __vrCache = { at: 0, data: null };
  async function ventasRecientes(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
      if (__vrCache.data && Date.now() - __vrCache.at < 60e3) return res.json(__vrCache.data);
      const col = await deps.getCollection('checkout_orders');
      const desde = new Date(Date.now() - 72 * 3600e3);
      const docs = await col.find({ status: 'pago', $or: [{ paidAt: { $gte: desde.toISOString() } }, { paidAt: { $gte: desde } }] })
        .project({ paidAt: 1, additionalInfo: 1, additionalInfoPaid: 1, instagramUsername: 1, 'customer.email': 1, 'customer.name': 1, correlationID: 1, upsell: 1 })
        .sort({ paidAt: -1 }).limit(40).toArray();
      const g = (o, k) => { for (const arr of [o.additionalInfoPaid, o.additionalInfo]) { if (Array.isArray(arr)) { const it = arr.find((x) => x && x.key === k); if (it && it.value != null && it.value !== '') return String(it.value); } } return ''; };
      const mascara = (u) => { const h = String(u || '').replace(/^@+/, '').trim(); if (!h) return ''; return '@' + (h.length <= 3 ? h.slice(0, 1) : h.slice(0, 3)) + '***'; };
      // Texto com a rede social ("150 seguidores de Instagram", "300 me gusta en TikTok") + a rede para o ícone.
      const nomeServico = (tipo, cat, qtd) => {
        const t = String(tipo || '').toLowerCase(), c = String(cat || '').toLowerCase();
        const q = Number(qtd) || 0; const n = q ? q.toLocaleString('en-US') + ' ' : '';
        if (/refil/.test(t)) return null;
        const rede = /^tiktok_/.test(t) ? 'tiktok' : (/^facebook_/.test(t) ? 'facebook' : 'instagram');
        const nomeRede = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' }[rede];
        const k = c + ' ' + t;
        if (/seguidor/.test(t) || (!/coment|visualiza|views|curtida|likes/.test(k))) return { rede, texto: n + 'seguidores' + (/organic/.test(t) ? ' reales' : '') + ' de ' + nomeRede };
        const sv = /coment/.test(k) ? 'comentarios' : (/visualiza|views/.test(k) ? 'vistas' : 'me gusta' + (/organic|reais/.test(t) ? ' reales' : ''));
        return { rede, texto: n + sv + ' en ' + nomeRede };
      };
      const haceCuanto = (d) => {
        const min = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 60000));
        if (min < 60) return 'hace ' + min + ' min';
        const h = Math.round(min / 60);
        return h < 24 ? 'hace ' + h + ' h' : (h < 48 ? 'ayer' : 'hace ' + Math.round(h / 24) + ' días');
      };
      const items = [];
      for (const o of docs) {
        const email = String((o.customer && o.customer.email) || '').toLowerCase();
        if (/prueba\.interna@|@youagency\.site$/.test(email) || /^test-/.test(String(o.correlationID || ''))) continue; // pedidos de teste da casa
        const serv = nomeServico(g(o, 'tipo_servico'), g(o, 'categoria_servico'), g(o, 'quantidade'));
        if (!serv) continue;
        // Facebook: o "nome" vem do link do perfil/página (facebook.com/<nome>), mascarado e sem @; link só com ID numérico vira "Un cliente".
        const fbNome = (function () {
          const lk = String(g(o, 'link_alvo') || g(o, 'perfil_rede') || g(o, 'perfil_link') || '').trim();
          let slug = '';
          try { const m = lk.match(/(?:facebook|fb)\.com\/(?!profile\.php|people\/|share\/|groups\/|watch|reel|videos)([A-Za-z0-9._-]{3,60})/i); if (m) slug = m[1]; } catch (_) {}
          if (!slug || /^\d+$/.test(slug)) return '';
          const h = slug.replace(/[._-]+/g, '');
          return h.length >= 3 ? h.slice(0, 3) + '***' : '';
        })();
        const user = /^facebook_/.test(g(o, 'tipo_servico').toLowerCase()) ? fbNome : mascara(o.instagramUsername || g(o, 'instagram_username') || g(o, 'perfil_rede'));
        items.push({ titulo: (user || 'Un cliente') + ' compró ' + serv.texto, tiempo: haceCuanto(o.paidAt), rede: serv.rede, quem: user || 'Un cliente', oque: serv.texto, t: new Date(o.paidAt).getTime() });
        if (items.length >= 10) break;
      }
      __vrCache = { at: Date.now(), data: { ok: true, items } };
      return res.json(__vrCache.data);
    } catch (_) { return res.json({ ok: false, items: [] }); }
  }
  app.get('/api/ventas-recientes', ventasRecientes);
  app.get('/api/social-proof', ventasRecientes);
  app.get('/api/redes/catalogo', async (req, res) => {
    const rede = String(req.query.rede || '').toLowerCase();
    const { tabelaRedes, tabelaCurtidas, tabelaVisualizacoes, parsePrecoToCents } = require('./pricing');
    // Ocultos no Gerenciamento de Tipo (coluna Oculto) não aparecem no site.
    let ocultos = {}; try { ocultos = (await deps.loadServiceVisibility()) || {}; } catch (_) {}
    const oculto = (d, tipo) => (Array.isArray(ocultos[d.rede]) ? ocultos[d.rede] : []).includes(tipo);
    const servicos = Object.entries(REDES_CATALOGO_TIPOS)
      .filter(([tipo, d]) => (!rede || d.rede === rede) && !oculto(d, tipo))
      .map(([tipo, d]) => ({
        tipo, rede: d.rede, titulo: d.titulo, unidade: d.unidade, alvo: d.alvo, desc: d.desc,
        pacotes: (tabelaRedes[tipo] || []).map((x) => ({ q: x.q, cents: parsePrecoToCents(x.p), label: x.p }))
      }));
    res.set('Cache-Control', 'no-cache');
    // Ofertas da etapa 3 (mesmos preços que o calculateOrderBumps do pricing.js soma no servidor).
    const pac = (arr) => (arr || []).map((x) => ({ q: x.q, cents: parsePrecoToCents(x.p) }));
    const ofertas = { likes: pac(tabelaCurtidas.mistos), views: pac(tabelaVisualizacoes.visualizacoes_reels), comments: { unitCents: 2000, max: 250 } };
    // Instagram: comentários ocultos no Gerenciamento de Tipo → a página inicial esconde o card.
    const instagramOcultos = { comentarios: (Array.isArray(ocultos.comentarios) ? ocultos.comentarios : []).includes('comentarios') };
    // Ofertas (etapa 3) de TikTok/Facebook somem quando o tipo da rede está oculto.
    const ofertasOcultas = {};
    for (const r of ['tiktok', 'facebook']) {
      const oc = Array.isArray(ocultos[r]) ? ocultos[r] : [];
      ofertasOcultas[r] = { likes: oc.includes(r + '_curtidas'), views: oc.includes(r + '_visualizacoes'), comments: oc.includes(r + '_comentarios') };
    }
    res.json({ ok: true, servicos, ofertas, instagramOcultos, ofertasOcultas });
  });

  app.get('/instagram-services', async (req, res) => {
    console.log('📸 Acessando rota /instagram-services');
    const rawServico = String((req && req.query && (req.query.servico || req.query.service || req.query.tipo)) || '').trim().toLowerCase();
    const pvPath = '/servicos-instagram';
    if (rawServico === 'curtidas' || rawServico === 'visualizacoes') {
      deps.trackPageView(req, `${pvPath}:${rawServico}`);
    } else {
      deps.trackPageView(req, pvPath);
    }
    let serviceVisibility = null; try { serviceVisibility = await deps.loadServiceVisibility(); } catch (_) {}
    res.render('servicos-instagram', { queryParams: req.query, serviceVisibility }, (err, html) => {
      if (err) {
        console.error('❌ Erro ao renderizar servicos-instagram:', err.message);
        return res.status(500).send('Error al cargar la página');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  app.get('/views-services', async (req, res) => {
    console.log('▶️ Acessando rota /views-services');
    deps.trackPageView(req, '/views-services');
    let serviceVisibility = null; try { serviceVisibility = await deps.loadServiceVisibility(); } catch (_) {}
    res.render('servicos-visualizacoes', { queryParams: req.query, serviceVisibility }, (err, html) => {
      if (err) {
        console.error('❌ Erro ao renderizar servicos-visualizacoes:', err.message);
        return res.status(500).send('Error al cargar la página');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  app.get('/likes-services', async (req, res) => {
    console.log('❤️ Acessando rota /likes-services');
    deps.trackPageView(req, '/likes-services');
    let serviceVisibility = null; try { serviceVisibility = await deps.loadServiceVisibility(); } catch (_) {}
    res.render('servicos-curtidas', { queryParams: req.query, serviceVisibility }, (err, html) => {
      if (err) {
        console.error('❌ Erro ao renderizar servicos-curtidas:', err.message);
        return res.status(500).send('Error al cargar la página');
      }
      res.type('text/html');
      res.send(html);
    });
  });
  
  app.get('/servicos-instagram', (req, res) => {
    const qs = (function () {
      try {
        const q = new URLSearchParams(req.query || {});
        return q.toString();
      } catch (_) { return ''; }
    })();
    return res.redirect(qs ? (`/instagram-services?${qs}`) : '/instagram-services');
  });
  
  app.get('/servicos-visualizacoes', (req, res) => {
    const qs = (function () {
      try {
        const q = new URLSearchParams(req.query || {});
        return q.toString();
      } catch (_) { return ''; }
    })();
    return res.redirect(qs ? (`/views-services?${qs}`) : '/views-services');
  });
  
  app.get('/servicos-curtidas', (req, res) => {
    const qs = (function () {
      try {
        const q = new URLSearchParams(req.query || {});
        return q.toString();
      } catch (_) { return ''; }
    })();
    return res.redirect(qs ? (`/likes-services?${qs}`) : '/likes-services');
  });
  // ── Criação do pedido + cobrança: NOWPayments (cripto) ou Xpag (SPEI / OXXO) ──
  // Cripto (NOWPayments) desligado por decisão do responsável (11/11/2026): só SPEI/OXXO.
  // Para religar: CRYPTO_ENABLED=1 no .env e devolver a opção em views/partials/metodos_pago.ejs.
  app.post('/api/nowpayments/create-invoice', (req, res) => {
    if (String(process.env.CRYPTO_ENABLED || '0') !== '1') {
      return res.status(410).json({ error: 'crypto_disabled', message: 'El pago con cripto ya no está disponible. Paga con SPEI u OXXO.' });
    }
    return criarPedidoPagamento(req, res, 'nowpayments');
  });
  app.post('/api/xpag/create-charge', (req, res) => criarPedidoPagamento(req, res, 'xpag'));

  async function criarPedidoPagamento(req, res, gateway) {
    let correlationIDSafe = '';
    let validatedValueCents = null;
    try {
      const { installments, customer, total_cents, additionalInfo, profile_is_private, utms: reqUtms } = req.body;
      correlationIDSafe = (function () {
        try {
          const c = String(req.body?.correlationID || '').trim();
          if (c) return c;
        } catch (_) {}
        try {
          const crypto = require('crypto');
          if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        } catch (_) {}
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      })();
  
      const npConfig = getNowPaymentsConfig();
      const xpConfig = getXpagConfig();
      const xpagMethod = (xpagOxxoLigado() && String(req.body?.xpag_method || 'SPEI').trim().toUpperCase() === 'OXXO') ? 'OXXO' : 'SPEI';
      if (gateway === 'nowpayments' && !npConfig.apiKey) {
        return res.status(500).json({ error: 'missing_nowpayments_key', message: 'Falta la configuración de pago (NOWPAYMENTS_API_KEY).' });
      }
      if (gateway === 'xpag' && (!xpConfig.clientId || !xpConfig.clientSecret)) {
        return res.status(500).json({ error: 'missing_xpag_key', message: 'Falta la configuración de pago (XPAG_CLIENT_ID / XPAG_CLIENT_SECRET).' });
      }
      if (gateway === 'xpag' && MOEDA_VENDA !== 'mxn') {
        return res.status(400).json({ error: 'xpag_currency', message: 'SPEI y OXXO solo están disponibles en pesos mexicanos.' });
      }
  
      if (!total_cents || Number(total_cents) < 100) {
        return res.status(400).json({ error: 'invalid_amount', message: 'El pago mínimo es de $ 1.00 MXN.' });
      }
  
      const addInfoArr = Array.isArray(additionalInfo) ? additionalInfo : [];
      const addInfoMap = addInfoArr.reduce((acc, item) => {
        const k = String(item?.key || '').trim();
        const v = String(item?.value || '').trim();
        acc[k] = v;
        return acc;
      }, {});
      // Usuário bloqueado (Usuários Bloqueados no painel) não gera cobrança, venha do site ou do bot.
      try {
        const igBl = String(addInfoMap['instagram_username'] || '').trim();
        if (igBl && typeof deps.blacklistBarra === 'function' && await deps.blacklistBarra(igBl, 'pago', req)) {
          return res.status(403).json({ error: 'blocked_user', message: 'Este perfil no puede ser atendido.' });
        }
      } catch (_) {}
  
      const tipoVal = addInfoMap['tipo_servico'] || '';
      const qtdVal = Number(addInfoMap['quantidade'] || 0) || 0;

      // TikTok/Facebook: o link do perfil/post é obrigatório e precisa ser da rede certa.
      const redeDef = REDES_CATALOGO_TIPOS[String(tipoVal).toLowerCase()];
      if (redeDef) {
        const linkAlvo = String(addInfoMap['link_alvo'] || '').trim();
        if (!linkRedeOk(redeDef.rede, linkAlvo)) {
          return res.status(400).json({ error: 'invalid_link', message: redeDef.rede === 'tiktok' ? 'Pega el enlace de TikTok (tiktok.com).' : 'Pega el enlace de Facebook (facebook.com).' });
        }
        // Ofertas (me gusta/visualizaciones/comentarios) precisam do link do vídeo/publicação.
        const temBump = /(^|;)\s*(likes|views|comments):\d+/.test(String(addInfoMap['order_bumps'] || ''));
        if (temBump && !linkRedeOk(redeDef.rede, String(addInfoMap['bump_link'] || '').trim())) {
          return res.status(400).json({ error: 'invalid_bump_link', message: 'Pega el enlace del video o publicación para las ofertas.' });
        }
      }
  
      // Garantia de 3 meses / extensão: preço dinâmico recalculado pelo custo atual (igual à Oppus).
      let precoOpts = {};
      try { if (typeof deps.pricingOptsForCharge === 'function') precoOpts = (await deps.pricingOptsForCharge(tipoVal, qtdVal, addInfoArr)) || {}; } catch (_) {}
      let verification = await deps.verifyPrice(tipoVal, qtdVal, addInfoArr, Number(total_cents), precoOpts);
      if (!verification.isValid) {
        try {
          const couponCodeRaw = addInfoMap['cupom'] || addInfoMap['coupon'] || '';
          const couponCode = deps.normalizeCouponCode(couponCodeRaw);
          if (couponCode) {
            const profileKey = deps.normalizeProfileKey(addInfoMap['instagram_username'] || addInfoMap['perfil'] || '');
            const eligibility = await deps.getCouponEligibility(couponCode, profileKey);
            if (eligibility && eligibility.ok && eligibility.coupon) {
              const pct = Number(eligibility.coupon.discountPercentage || 0) || 0;
              const rate = pct > 0 ? (pct / 100) : 0;
              if (rate > 0 && Number.isFinite(Number(verification.expectedPrice)) && Number(verification.expectedPrice) > 0) {
                const expected = Number(verification.expectedPrice);
                const discountVal = Math.round(expected * rate);
                // Mínimo da Xpag: o cupom nunca deixa o total abaixo de MXN 20.00 (igual ao pricing.js).
                const discountedExpected = Math.max(expected - discountVal, Math.min(expected, 2000));
                if (Number(total_cents) === discountedExpected) {
                  verification = { isValid: true, matchedPrice: Number(total_cents), expectedPrice: Number(total_cents), mismatchDetails: null };
                }
              }
            }
          }
        } catch (_) {}
      }
      // Oferta "dobrar o pedido" do bot (40% off por 5 h): o preço vale só com o token gravado em wa_ofertas_dobro,
      // para o mesmo tipo e quantidade, uma cobrança por token.
      if (!verification.isValid && addInfoMap['oferta_dobro']) {
        try {
          const ofCol = await deps.getCollection('wa_ofertas_dobro');
          const of = await ofCol.findOne({ _id: String(addInfoMap['oferta_dobro']) });
          const okOferta = of && Number(of.precoCents) === Number(total_cents) && String(of.tipo || '') === String(tipoVal || '') && Number(of.quantidade) === qtdVal
            && new Date(of.expiraAt).getTime() > Date.now() - 10 * 60e3 && !of.correlationID;
          if (okOferta) verification = { isValid: true, matchedPrice: Number(total_cents), expectedPrice: Number(total_cents), mismatchDetails: null };
        } catch (_) {}
      }
      if (!verification.isValid) {
        return res.status(400).json({ error: 'invalid_amount', message: 'El monto no coincide con el esperado.', details: verification.mismatchDetails });
      }
      const validatedPriceCents = Number(verification.matchedPrice || verification.expectedPrice || 0);
      if (!Number.isFinite(validatedPriceCents) || validatedPriceCents < 100) {
        return res.status(400).json({ error: 'invalid_amount', message: 'Monto inválido.' });
      }
      validatedValueCents = validatedPriceCents;
  
      const normalizeDigits = (v) => String(v || '').replace(/\D/g, '');
      const isValidCPF = (cpfRaw) => {
        const cpf = normalizeDigits(cpfRaw);
        if (cpf.length !== 11) return false;
        if (/^(\d)\1+$/.test(cpf)) return false;
        const calc = (base, factor) => {
          let sum = 0;
          for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
          const mod = (sum * 10) % 11;
          return mod === 10 ? 0 : mod;
        };
        const d1 = calc(cpf.slice(0, 9), 10);
        const d2 = calc(cpf.slice(0, 10), 11);
        return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
      };
      const normalizePhoneInternational = (raw) => {
        const txt = String(raw || '').trim();
        if (!txt) return '';
        const hasPlus = txt.startsWith('+');
        let d = normalizeDigits(txt);
        if (!d) return '';
        d = d.replace(/^0+/, '');
        if (d.length < 8) return '';
        if (d.length > 15) d = d.slice(0, 15);
        return hasPlus ? `+${d}` : d;
      };
  
      const cpfDigits = normalizeDigits(customer?.cpf);
      if (cpfDigits && !isValidCPF(cpfDigits)) return res.status(400).json({ error: 'invalid_cpf', message: 'Documento inválido.' });
  
      const phoneRaw = customer?.phone_number || customer?.phone || customer?.telefone || '';
      const phoneDigits = normalizePhoneInternational(phoneRaw);
      // Teléfono opcional desde 22/11/2026 (el sitio solo pide el correo); si viene, tiene que ser válido.
      if (String(phoneRaw || '').trim() && !phoneDigits) return res.status(400).json({ error: 'invalid_phone', message: 'Teléfono inválido.' });
  
      const emailSafe = (function () {
        const raw = String(customer?.email || '').trim();
        if (!raw) return '';
        if (raw.length > 180) return '';
        const at = raw.indexOf('@');
        if (at <= 0 || at >= raw.length - 3) return '';
        if (raw.indexOf('.', at) === -1) return '';
        return raw;
      })();
  
      let utms = {};
      try {
        if (reqUtms && Object.keys(reqUtms).length > 0) {
          utms = reqUtms;
          if (!utms.ref) utms.ref = req.get('Referer') || req.headers['referer'] || '';
        } else {
          const refUrl = req.get('Referer') || req.headers['referer'] || '';
          utms = { ref: refUrl };
        }
      } catch (_) {
        const refUrl = req.get('Referer') || req.headers['referer'] || '';
        utms = { ref: refUrl };
      }
  
      const tipo = addInfoMap['tipo_servico'] || '';
      const qtd = Number(addInfoMap['quantidade'] || 0) || 0;
      const instauserFromClient = addInfoMap['instagram_username'] || '';
      const userAgent = req.get('User-Agent') || '';
      const ip = req.realIP || req.ip || req.connection?.remoteAddress || 'unknown';
      const slug = req.session?.linkSlug || '';
      const isPrivate = profile_is_private === true || profile_is_private === 'true' || addInfoMap['profile_is_private'] === 'true';
      const createdIso = new Date().toISOString();
  
      let geolocation = null;
      try {
        const geoPromise = deps.geoLookupIp(ip);
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1200));
        geolocation = await Promise.race([geoPromise, timeout]);
      } catch (_) { geolocation = null; }
  
      const installmentsSafe = (function () {
        const n = parseInt(String(installments || '1'), 10);
        return (Number.isFinite(n) && n > 0) ? n : 1;
      })();
      try {
        for (let i = addInfoArr.length - 1; i >= 0; i--) {
          if (String(addInfoArr[i]?.key || '').trim() === 'installments') addInfoArr.splice(i, 1);
        }
        addInfoArr.push({ key: 'installments', value: String(installmentsSafe) });
      } catch (_) {}
  
      const description = String(addInfoMap['pacote'] || `${qtd || 1} ${tipo || 'service'}`).trim().slice(0, 250);
      const baseUrl = getPublicBaseUrl(req);
      if (!baseUrl) {
        return res.status(500).json({ error: 'missing_base_url', message: 'No se pudo determinar la URL del sitio para el pago.' });
      }
      const successUrl = `${baseUrl}/pedido?correlationID=${encodeURIComponent(correlationIDSafe)}`;
      const cancelUrl = (function () {
        const ref = String(req.get('Referer') || req.headers['referer'] || '').trim();
        if (ref && ref.startsWith(baseUrl)) return ref;
        return `${baseUrl}/customer`;
      })();
  
      if (gateway === 'xpag') {
        const valor = Math.round(Number(validatedValueCents)) / 100;
        if (valor < 20) {
          return res.status(400).json({ error: 'invalid_amount', message: 'El pago mínimo es de $ 20.00 MXN.' });
        }
        if (xpagMethod === 'OXXO' && (valor < 10 || valor > 10000)) {
          return res.status(400).json({ error: 'invalid_amount', message: 'OXXO acepta pagos de $ 10 a $ 10,000 MXN.' });
        }
        const externalId = `YA-${correlationIDSafe}`.slice(0, 80);
        // Nome opcional (o site só pede o correo): sem nome, vai o @ do perfil (ou o início do correo).
        let nome = String(customer?.name || customer?.nome || '').trim().slice(0, 120);
        if (!nome || nome.length < 2 || nome === 'Instagram Customer') {
          const alvo = String(addInfoMap['instagram_username'] || addInfoMap['perfil_rede'] || addInfoMap['perfil'] || '').replace(/^@+/, '').trim();
          const doCorreo = String(emailSafe || '').split('@')[0].replace(/[^A-Za-z0-9._-]/g, '').trim();
          nome = (alvo ? ('@' + alvo) : (doCorreo || 'Cliente')).slice(0, 120);
        }
        // SPEI = CLABE aberta (sem amount): a mesma external_id devolve sempre a mesma CLABE, então
        // dois pedidos nunca podem dividir a mesma chave. Se já existe pedido com ela, reaproveita.
        if (xpagMethod === 'SPEI') {
          const colChk = await deps.getCollection('checkout_orders');
          const jaExiste = await colChk.findOne({ paymentMethod: 'xpag', 'xpag.external_id': externalId }, { projection: { identifier: 1, correlationID: 1, status: 1 } });
          if (jaExiste) {
            if (String(jaExiste.status || '').toLowerCase() === 'pago') return res.status(409).json({ error: 'already_paid', message: 'Este pedido ya fue pagado.', correlationID: correlationIDSafe });
            return res.json({ ok: true, correlationID: jaExiste.correlationID, identifier: jaExiste.identifier, pay_url: `/pago?correlationID=${encodeURIComponent(jaExiste.correlationID)}` });
          }
        }
        const xpBody = xpagMethod === 'OXXO'
          ? { currency: 'MXN', method: 'OXXO', amount: valor, generateCheckout: false, external_id: externalId, webhook_url: `${baseUrl}/api/xpag/webhook`, description, payerData: Object.assign({}, nome ? { name: nome } : {}, emailSafe ? { email: emailSafe } : {}) }
          : xpagCorpoClabeAberta({ externalId, webhookUrl: `${baseUrl}/api/xpag/webhook`, description, nome });
        // Uma chamada só: se falhar/expirar, o cliente tenta de novo (novo external_id), nunca repetimos sozinhos.
        const xr = await axios.post(`${xpConfig.apiBase}/cashin`, xpBody, { headers: xpagHeaders(xpConfig), httpsAgent: nowpaymentsKeepAliveAgent, timeout: 45000, validateStatus: () => true });
        const xd = xr && xr.data && typeof xr.data === 'object' ? xr.data : {};
        if (xr.status >= 400 || xd.ok === false || !xd.transaction_id || (xpagMethod === 'SPEI' && !xd.clabe)) {
          try { console.error('❌ Xpag cashin', xr.status, xd.error_code || '', xd.error || ''); } catch (_) {}
          return res.status(502).json({ error: 'xpag_error', message: 'No se pudo generar el pago. Inténtalo de nuevo en unos minutos.', detail: xd.error_code || xd.error || null, correlationID: correlationIDSafe });
        }
        const pd = (xd.payee_data && typeof xd.payee_data === 'object') ? xd.payee_data : {};
        const aberta = xpagMethod === 'SPEI';
        const expireMin = Number(xd.expire_minutes) > 0 ? Number(xd.expire_minutes) : (xpagMethod === 'OXXO' ? 12 * 24 * 60 : 24 * 60);
        const xpag = {
          method: xpagMethod,
          transaction_id: String(xd.transaction_id),
          request_number: String(xd.request_number || ''),
          external_id: externalId,
          // CLABE aberta: o valor esperado é o do pedido; o recebido é a soma dos pagamentos confirmados.
          open_value: aberta,
          amount: aberta ? valor : Number(xd.amount || valor),
          fee: xd.fee != null ? Number(xd.fee) : null,
          clabe: String(xd.clabe || ''),
          bank_name: String(xd.bank_name || ''),
          beneficiary: String(xd.beneficiary || ''),
          reference: String(pd.reference || xd.reference || ''),
          barcode: String(pd.barcode || ''),
          checkout_url: String(xd.checkout_url || xd.checkoutUrl || xd.payment_url || ''),
          sandbox: xd.sandbox === true,
          status: String(xd.status || 'pending'),
          // A CLABE aberta não vence (aceita completar o valor depois).
          expiresAt: aberta ? null : new Date(Date.now() + expireMin * 60000).toISOString(),
          recebidoCents: 0,
          createdAt: createdIso
        };
        const recordIdentifier = `XP_${xpag.transaction_id}`;
        const record = {
          nomeUsuario: null, telefone: phoneDigits || '', instauser: instauserFromClient,
          profilePrivacy: { isPrivate: isPrivate, checkedAt: createdIso }, isPrivate: isPrivate,
          criado: createdIso, identifier: recordIdentifier, correlationID: correlationIDSafe, status: 'pendente',
          qtd, tipo, utms, geolocation, valueCents: Number(total_cents), expectedValueCents: Number(validatedValueCents),
          customer: Object.assign({}, customer || {}, (emailSafe ? { email: emailSafe } : {}), { phone_number: phoneDigits }),
          additionalInfo: addInfoArr, tipoServico: tipo, quantidade: qtd, instagramUsername: instauserFromClient,
          slug, userAgent, ip, createdAt: createdIso, paymentMethod: 'xpag', xpag
        };
        const col = await deps.getCollection('checkout_orders');
        // UTM do cookie op_ut quando a URL/sessão veio sem, e visitorId (cookie ya_cid) para o funil.
        try { if (typeof deps.comUtm === 'function') deps.comUtm(record, req); } catch (_) {}
        const insertResult = await col.insertOne(record);
        try { record._id = insertResult?.insertedId; } catch (_) {}
        Promise.resolve().then(() => deps.sendOrderCreatedEmail({ record, insertedId: insertResult && insertResult.insertedId })).catch(() => {});
        return res.json({ ok: true, correlationID: correlationIDSafe, identifier: recordIdentifier, pay_url: `/pago?correlationID=${encodeURIComponent(correlationIDSafe)}` });
      }

      // Fatura hospedada da NOWPayments: o cliente escolhe a moeda na página deles.
      const invoiceBody = {
        price_amount: Math.round(Number(validatedValueCents)) / 100,
        price_currency: MOEDA_VENDA,
        order_id: correlationIDSafe,
        order_description: description,
        ipn_callback_url: `${baseUrl}/api/nowpayments/ipn`,
        success_url: successUrl,
        cancel_url: cancelUrl,
        partially_paid_url: successUrl,
        is_fixed_rate: false,
        is_fee_paid_by_user: false
      };
      const invResp = await axios.post(`${NOWPAYMENTS_API_BASE}/invoice`, invoiceBody, {
        headers: { 'x-api-key': npConfig.apiKey, 'Content-Type': 'application/json' },
        httpsAgent: nowpaymentsKeepAliveAgent,
        timeout: 45000
      });
      const inv = invResp && invResp.data ? invResp.data : null;
      const invoiceId = String(inv?.id || '').trim();
      const invoiceUrl = String(inv?.invoice_url || '').trim();
      if (!invoiceId || !invoiceUrl) {
        return res.status(502).json({ error: 'nowpayments_empty_response', message: 'Respuesta vacía de NOWPayments.' });
      }
  
      const recordIdentifier = `NP_${invoiceId}`;
      const record = {
        nomeUsuario: null,
        telefone: phoneDigits || '',
        instauser: instauserFromClient,
        profilePrivacy: { isPrivate: isPrivate, checkedAt: createdIso },
        isPrivate: isPrivate,
        criado: createdIso,
        identifier: recordIdentifier,
        correlationID: correlationIDSafe,
        status: 'pendente',
        qtd,
        tipo,
        utms,
        geolocation,
        valueCents: Number(total_cents),
        expectedValueCents: Number(validatedValueCents),
        customer: Object.assign({}, customer || {}, (cpfDigits ? { cpf: cpfDigits } : {}), (emailSafe ? { email: emailSafe } : {}), { phone_number: phoneDigits }),
        additionalInfo: addInfoArr,
        tipoServico: tipo,
        quantidade: qtd,
        instagramUsername: instauserFromClient,
        slug,
        userAgent,
        ip,
        createdAt: createdIso,
        paymentMethod: 'nowpayments',
        nowpayments: {
          invoice_id: invoiceId,
          invoice_url: invoiceUrl,
          price_amount: invoiceBody.price_amount,
          price_currency: MOEDA_VENDA,
          status: 'waiting',
          createdAt: createdIso
        }
      };
  
      const col = await deps.getCollection('checkout_orders');
      const insertResult = await col.insertOne(record);
      try { record._id = insertResult?.insertedId; } catch (_) {}
      Promise.resolve()
        .then(() => deps.sendOrderCreatedEmail({ record, insertedId: insertResult && insertResult.insertedId }))
        .catch(() => {});
  
      return res.json({
        ok: true,
        correlationID: correlationIDSafe,
        identifier: recordIdentifier,
        invoiceId,
        invoice_url: invoiceUrl
      });
    } catch (error) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      const msg = String(data?.message || data?.error || error?.message || '').trim();
      try { console.error('❌ NOWPayments create-invoice', status || '', msg); } catch (_) {}
      if (status && status >= 400 && status < 500) {
        return res.status(status).json({ error: 'nowpayments_request_error', message: msg || 'NOWPayments rechazó la solicitud de pago.', correlationID: correlationIDSafe });
      }
      return res.status(500).json({ error: gateway === 'xpag' ? 'xpag_error' : 'nowpayments_error', message: msg || 'No se pudo crear el pago.', correlationID: correlationIDSafe });
    }
  }

  // ── Xpag: status, webhook, página de instruções e conciliação ──
  // A Xpag não assina o webhook: o aviso só serve de gatilho. O status vale o que a própria
  // API devolve em GET /consult-transaction com as nossas credenciais.
  // CLABE aberta (SPEI): 1 CLABE por pedido, cada transferência gera um webhook próprio.
  // A consulta é por external_id (por transaction_id a Xpag devolve 404) e volta a LISTA de pagamentos.
  async function consultarXpag(recordOrTid) {
    const cfg = getXpagConfig();
    const x = (recordOrTid && typeof recordOrTid === 'object') ? (recordOrTid.xpag || {}) : { transaction_id: recordOrTid };
    if (!cfg.clientId) return null;
    let params;
    if (xpagEhClabeAberta(x)) {
      if (!x.external_id && !x.clabe) return null;
      params = x.external_id ? { external_id: x.external_id, limit: 100 } : { clabe: x.clabe, limit: 100 };
    } else {
      if (!x.transaction_id) return null;
      params = { transaction_id: x.transaction_id };
    }
    const r = await axios.get(`${cfg.apiBase}/consult-transaction`, { params, headers: xpagHeaders(cfg), httpsAgent: nowpaymentsKeepAliveAgent, timeout: 20000, validateStatus: () => true });
    const d = r && r.data && typeof r.data === 'object' ? r.data : null;
    if (!d || d.ok === false) return null;
    return d;
  }

  // Soma os pagamentos confirmados da CLABE (sem repetir o mesmo e2e). A lista traz uma linha
  // "pending" de valor 0 enquanto nada entrou — ela é ignorada.
  function somarPagamentosClabe(d) {
    const pagos = ['confirmed', 'completed'];
    const lista = Array.isArray(d && d.payments) ? d.payments : [];
    const vistos = new Set();
    const pagamentos = [];
    for (const p of lista) {
      if (!p || typeof p !== 'object') continue;
      const s = String(p.status || '').trim().toLowerCase();
      const v = Number(p.amount) || 0;
      if (!pagos.includes(s) || !(v > 0)) continue;
      const chave = String(p.e2e || p.request_number || p.id || p.transaction_id || (v + '|' + (p.paid_at || p.created_at || '')));
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      pagamentos.push({ e2e: String(p.e2e || ''), request_number: String(p.request_number || p.id || ''), amountCents: Math.round(v * 100), fee: p.fee != null ? Number(p.fee) : null, at: String(p.paid_at || p.updated_at || p.created_at || '') });
    }
    return { pagamentos, recebidoCents: pagamentos.reduce((s, p) => s + p.amountCents, 0) };
  }

  async function applyXpagStatus(col, record, d) {
    if (!record || !d) return record;
    const pagos = ['confirmed', 'completed'];
    const falhos = ['failed', 'expired', 'canceled', 'cancelled'];
    const esperadoCents = Math.round(Number(record.expectedValueCents || record.valueCents || 0));
    const agoraIso = new Date().toISOString();
    let st, valorOk, xp;
    if (xpagEhClabeAberta(record.xpag)) {
      // Soma tudo que caiu na CLABE: completou (ou passou) → libera; faltou → mostra o restante na mesma CLABE.
      const { pagamentos, recebidoCents } = somarPagamentosClabe(d);
      valorOk = recebidoCents > 0 && recebidoCents >= esperadoCents;
      st = valorOk ? 'confirmed' : (recebidoCents > 0 ? 'parcial' : 'pending');
      xp = Object.assign({}, record.xpag || {}, {
        status: st, pagamentos, recebidoCents,
        restanteCents: Math.max(0, esperadoCents - recebidoCents),
        excedenteCents: Math.max(0, recebidoCents - esperadoCents),
        e2e: (pagamentos[pagamentos.length - 1] || {}).e2e || (record.xpag && record.xpag.e2e) || '',
        fee: pagamentos.reduce((s, p) => s + (Number(p.fee) || 0), 0),
        updatedAt: agoraIso
      });
      delete xp.amountMismatch;
    } else {
      // Cobrança com valor fixo (OXXO e SPEI antigos): valor igual ou acima libera; abaixo fica registrado.
      st = String(d.status || '').trim().toLowerCase();
      const recebidoCents = Math.round((Number(d.amount) || 0) * 100);
      valorOk = !esperadoCents || (recebidoCents > 0 && recebidoCents >= esperadoCents);
      xp = Object.assign({}, record.xpag || {}, { status: st || (record.xpag && record.xpag.status) || '', e2e: d.e2e || (record.xpag && record.xpag.e2e) || '', fee: d.fee != null ? Number(d.fee) : (record.xpag && record.xpag.fee), updatedAt: agoraIso });
      if (pagos.includes(st)) {
        xp.recebidoCents = recebidoCents;
        if (!valorOk) xp.amountMismatch = { esperado: esperadoCents / 100, recebido: recebidoCents / 100 };
        else delete xp.amountMismatch;
      }
    }
    const set = { xpag: xp };
    let virouPago = false;
    if (String(record.status || '').toLowerCase() !== 'pago') {
      if (pagos.includes(st) && valorOk) { set.status = 'pago'; set.paidAt = record.paidAt || agoraIso; virouPago = true; }
      else if (falhos.includes(st) && !xpagEhClabeAberta(record.xpag)) set.status = 'falha';
    }
    const filtro = virouPago ? { _id: record._id, status: { $ne: 'pago' } } : { _id: record._id };
    const upd = await col.updateOne(filtro, { $set: set });
    const fresh = Object.assign({}, record, set);
    if (virouPago && upd && upd.modifiedCount === 1) {
      try { await deps.processOrderFulfillment(fresh, col, null); } catch (e) { try { console.error('❌ Xpag fulfillment', e?.message || String(e)); } catch (_) {} }
      // Pedido feito pelo bot do WhatsApp: avisa o cliente na conversa (idempotente, só source=wpp_agent).
      try { if (typeof deps.notifyWppAgentPaidWhatsapp === 'function') await deps.notifyWppAgentPaidWhatsapp(fresh); } catch (_) {}
      // Compra para a Meta, UMA vez: anúncio de conversa (ctwa_clid) vai pelo pixel de mensagens (wppCapi);
      // o resto (site, site → WhatsApp com código, orgânico) vai pelo metaCapi. Se o evento de mensagem
      // for recusado, o próprio wppCapi cai no metaCapi como "chat".
      try {
        const w = await require('./wppCapi.js').enviarCompra(fresh);
        const semCtwa = !w || ['nao_e_do_bot', 'sem_clique', 'nao_configurado', 'sem_telefone', 'pagamento_antigo', 'excecao'].includes(w.motivo);
        if (semCtwa) await require('./metaCapi.js').enviarCompra(fresh);
      } catch (_) {}
    } else if (!virouPago && xp.status === 'parcial' && xp.recebidoCents > 0) {
      // Pagou só uma parte: pedido do bot recebe no WhatsApp o restante e a MESMA CLABE.
      try { await avisarPagoParcialWpp(col, fresh); } catch (_) {}
    }
    return fresh;
  }

  // Aviso de pagamento parcial no WhatsApp (só pedidos do bot). Uma vez por valor recebido:
  // a trava fica fora do objeto xpag para o $set do status não apagá-la.
  async function avisarPagoParcialWpp(col, doc) {
    const x = doc.xpag || {};
    const getAdd = (key) => {
      for (const a of [doc.additionalInfoPaid, doc.additionalInfo]) { if (Array.isArray(a)) { const it = a.find((i) => i && i.key === key); if (it && it.value != null && it.value !== '') return String(it.value); } }
      for (const m of [doc.additionalInfoMapPaid, doc.additionalInfoMap]) { if (m && m[key] != null && m[key] !== '') return String(m[key]); }
      return '';
    };
    if (String(doc.source || getAdd('source') || '').toLowerCase() !== 'wpp_agent') return;
    const cands = [(doc.customer && doc.customer.phone), getAdd('phone'), getAdd('telefone')].map((p) => String(p || '').replace(/\D/g, '')).filter(Boolean);
    let phone = cands.find((p) => p.startsWith('52') && p.length >= 12) || cands[0] || '';
    if (phone && phone.length === 10) phone = '52' + phone;
    if (!phone || phone.length < 12 || !x.clabe) return;
    const claim = await col.updateOne({ _id: doc._id, xpagParcialAvisoCents: { $ne: x.recebidoCents } }, { $set: { xpagParcialAvisoCents: x.recebidoCents } });
    if (!(claim && claim.modifiedCount > 0)) return;
    const fmt = (c) => { const x = Math.round(Number(c || 0)); const d = x % 100 === 0 ? 0 : 2; return '$ ' + (x / 100).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' MXN'; };
    const base = String(process.env.PUBLIC_BASE_URL || 'https://youagency.site').replace(/\/+$/, '');
    const msg = 'Recibimos tu transferencia de *' + fmt(x.recebidoCents) + '*, pero el total de tu pedido es *' + fmt(doc.expectedValueCents || doc.valueCents) + '*. '
      + 'Faltan *' + fmt(x.restanteCents) + '* para liberarlo. Transfiere el restante a la *misma CLABE* (va en el siguiente mensaje) y tu pedido se inicia automáticamente.';
    const wa = require('./whatsappCloud.js');
    const r = await wa.sendWhatsAppText(phone, msg);
    if (!r || !r.ok) { try { await col.updateOne({ _id: doc._id }, { $unset: { xpagParcialAvisoCents: '' } }); } catch (_) {} return; }
    try { await new Promise((ok) => setTimeout(ok, 1500)); await wa.sendWhatsAppText(phone, x.clabe); } catch (_) {}
    try { await wa.sendWhatsAppText(phone, 'También puedes ver el saldo pendiente aquí: ' + base + '/pago?correlationID=' + encodeURIComponent(String(doc.correlationID || ''))); } catch (_) {}
    try {
      const chats = await deps.getCollection('whatsapp_agent_chats');
      await chats.updateOne({ _id: String(phone) }, { $push: { messages: { $each: [{ role: 'assistant', content: msg }], $slice: -20 } }, $set: { updatedAt: new Date().toISOString() } });
    } catch (_) {}
  }

  async function sincronizarXpag(col, record) {
    if (!record || record.paymentMethod !== 'xpag' || !record.xpag || !record.xpag.transaction_id) return record;
    if (String(record.status || '').toLowerCase() === 'pago') return record;
    const d = await consultarXpag(record);
    return d ? applyXpagStatus(col, record, d) : record;
  }

  // Reenvio automático do pixel de mensagens quando a Meta falha de forma temporária.
  try { require('./wppCapi.js').iniciarReenvio(); } catch (_) {}
  try { require('./metaCapi.js').iniciarReenvio(); } catch (_) {}

  // Usado pelo lembrete de pagamento do bot (app.js) para conferir o status antes de cobrar o cliente.
  try { app.locals.yaSincronizarXpag = sincronizarXpag; global.__yaSincronizarXpag = sincronizarXpag; } catch (_) {}

  // Cobrança Xpag avulsa (usada pelo upsell "duplica tu pedido" no app.js). Mesmas regras do checkout:
  // mínimo MXN 20, OXXO de 10 a 10.000, nome obrigatório, UMA chamada (nunca repete sozinha).
  async function criarCobrancaXpag({ valorCents, metodo, externalId, nome, email, description, baseUrl }) {
    const cfg = getXpagConfig();
    if (!cfg.clientId || !cfg.clientSecret) return { ok: false, error: 'missing_xpag_key' };
    const m = (xpagOxxoLigado() && String(metodo || 'SPEI').toUpperCase() === 'OXXO') ? 'OXXO' : 'SPEI';
    const valor = Math.round(Number(valorCents) || 0) / 100;
    if (valor < 20) return { ok: false, error: 'monto_minimo' };
    if (m === 'OXXO' && valor > 10000) return { ok: false, error: 'oxxo_monto' };
    const n = String(nome || '').trim().slice(0, 120);
    if (n.length < 2) return { ok: false, error: 'missing_name' };
    const em = String(email || '').trim();
    const desc = String(description || '').slice(0, 250);
    const body = m === 'OXXO'
      ? { currency: 'MXN', method: 'OXXO', amount: valor, generateCheckout: false, external_id: externalId, webhook_url: baseUrl + '/api/xpag/webhook', description: desc, payerData: Object.assign({ name: n }, em ? { email: em } : {}) }
      : xpagCorpoClabeAberta({ externalId, webhookUrl: baseUrl + '/api/xpag/webhook', description: desc, nome: n });
    const xr = await axios.post(cfg.apiBase + '/cashin', body, { headers: xpagHeaders(cfg), httpsAgent: nowpaymentsKeepAliveAgent, timeout: 45000, validateStatus: () => true });
    const xd = xr && xr.data && typeof xr.data === 'object' ? xr.data : {};
    if (xr.status >= 400 || xd.ok === false || !xd.transaction_id || (m === 'SPEI' && !xd.clabe)) return { ok: false, error: 'xpag_error', detail: xd.error_code || xd.error || ('http_' + xr.status) };
    const pd = (xd.payee_data && typeof xd.payee_data === 'object') ? xd.payee_data : {};
    const expireMin = Number(xd.expire_minutes) > 0 ? Number(xd.expire_minutes) : (m === 'OXXO' ? 12 * 24 * 60 : 24 * 60);
    return { ok: true, xpag: {
      method: m, transaction_id: String(xd.transaction_id), request_number: String(xd.request_number || ''), external_id: externalId,
      open_value: m === 'SPEI', amount: m === 'SPEI' ? valor : Number(xd.amount || valor), fee: xd.fee != null ? Number(xd.fee) : null, recebidoCents: 0,
      clabe: String(xd.clabe || ''), bank_name: String(xd.bank_name || ''), beneficiary: String(xd.beneficiary || ''),
      reference: String(pd.reference || xd.reference || ''), barcode: String(pd.barcode || ''),
      checkout_url: String(xd.checkout_url || xd.checkoutUrl || xd.payment_url || ''), sandbox: xd.sandbox === true,
      status: String(xd.status || 'pending'), expiresAt: m === 'SPEI' ? null : new Date(Date.now() + expireMin * 60000).toISOString(), createdAt: new Date().toISOString()
    } };
  }
  try { app.locals.yaCriarCobrancaXpag = criarCobrancaXpag; app.locals.yaBaseUrl = getPublicBaseUrl; } catch (_) {}

  app.post('/api/xpag/webhook', async (req, res) => {
    res.status(200).json({ received: true });
    setImmediate(async () => {
      try {
        const p = (req.body && typeof req.body === 'object') ? req.body : {};
        const conds = [];
        // Webhook da CLABE aberta (origin "static") traz transaction_id = external_id do pedido.
        if (p.transaction_id) { conds.push({ 'xpag.transaction_id': String(p.transaction_id) }); conds.push({ 'xpag.external_id': String(p.transaction_id) }); }
        if (p.external_id) conds.push({ 'xpag.external_id': String(p.external_id) });
        for (const c of [p.clabe, p.receiverClabe]) { if (c && /^\d{18}$/.test(String(c))) conds.push({ 'xpag.clabe': String(c) }); }
        if (!conds.length) return;
        const col = await deps.getCollection('checkout_orders');
        const record = await col.findOne({ $or: conds, paymentMethod: 'xpag' }, { sort: { createdAt: -1 } });
        if (!record) { try { console.warn('⚠️ Xpag webhook sem pedido', p.transaction_id, p.external_id); } catch (_) {} return; }
        // TrackCombo (integração XPag): recebe o MESMO corpo do webhook, intacto. Só pedido do site —
        // venda do bot já vai à Meta pelo wppCapi/metaCapi (mandar aqui também duplicaria a compra).
        try {
          const tcUrl = String(process.env.YA_TRACKCOMBO_XPAG_URL || '').trim();
          const doBot = /^WppAgent_/.test(String(record.correlationID || '')) || String((record.additionalInfoMap && record.additionalInfoMap.source) || ((Array.isArray(record.additionalInfo) ? record.additionalInfo : []).find((i) => i && i.key === 'source') || {}).value || '') === 'wpp_agent';
          if (tcUrl && !doBot) {
            // Igual ao repasse do PagHiper na Oppus: o corpo da Xpag intacto + dados do cliente
            // (melhoram o casamento com o anúncio) + custo ZERADO (o Meta recebe o valor cheio da venda).
            const cli = record.customer || {};
            const limpa = (s) => String(s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
            let tel = String(cli.phone || (record.additionalInfoMap && record.additionalInfoMap.phone) || '').replace(/\D/g, '');
            if (tel && !tel.startsWith('52') && tel.length === 10) tel = '52' + tel;
            const extra = { cost: 0, custo: 0, product_cost: 0, cost_cents: 0, sale_value: Math.round(Number(record.expectedValueCents || record.valueCents || 0)) / 100, cost_source: 'zerado' };
            if (limpa(cli.name)) extra.payer_name = limpa(cli.name);
            if (tel) { extra.payer_phone = tel; extra.phone = tel; }
            if (String(cli.email || '').includes('@')) extra.payer_email = String(cli.email).trim();
            // Referência da venda = número do pedido (external_id), o MESMO transaction_id do evento
            // add_payment_info que a página /pago dispara no navegador. Garante que vá mesmo se a Xpag não mandar.
            const ref = String((record.xpag && record.xpag.external_id) || '');
            if (ref) { if (!req.body || !req.body.external_id) extra.external_id = ref; if (!req.body || !req.body.transaction_id) extra.transaction_id = ref; extra.order_id = ref; }
            const payloadTc = Object.assign({}, req.body, extra);
            const registra = (http, erro) => {
              col.updateOne({ _id: record._id }, { $set: { 'trackcombo.repassadoEm': new Date().toISOString(), 'trackcombo.http': http, ...(erro ? { 'trackcombo.erro': erro } : {}) } }).catch(() => {});
              deps.getCollection('trackcombo_forwards').then((c) => c.insertOne({ at: new Date(), gateway: 'xpag', correlationID: record.correlationID, statusXpag: String(req.body && req.body.status || ''), http, erro: erro || null, payload: payloadTc })).catch(() => {});
            };
            axios.post(tcUrl, payloadTc, { headers: { 'Content-Type': 'application/json' }, timeout: 15000, validateStatus: () => true })
              .then((r) => registra(r.status, r.status >= 400 ? String(JSON.stringify(r.data || '')).slice(0, 200) : ''))
              .catch((e) => { registra(0, String((e && e.message) || e).slice(0, 200)); try { console.error('❌ TrackCombo repasse', e && e.message); } catch (_) {} });
          }
        } catch (_) {}
        await sincronizarXpag(col, record);
      } catch (e) { try { console.error('❌ Xpag webhook', e?.message || String(e)); } catch (_) {} }
    });
  });

  // Usado pela página /pago (polling a cada poucos segundos).
  app.get('/api/xpag/status', async (req, res) => {
    try {
      const cid = String(req.query.correlationID || '').trim();
      if (!cid) return res.status(400).json({ ok: false });
      const col = await deps.getCollection('checkout_orders');
      let record = await col.findOne({ correlationID: cid, paymentMethod: 'xpag' });
      if (!record) return res.status(404).json({ ok: false });
      const ultima = record.xpag && record.xpag.updatedAt ? Date.parse(record.xpag.updatedAt) : 0;
      if (String(record.status) !== 'pago' && (!ultima || Date.now() - ultima > 8000)) record = await sincronizarXpag(col, record);
      const x = record.xpag || {};
      return res.json({ ok: true, status: record.status, xpagStatus: x.status, totalCents: Number(record.expectedValueCents || record.valueCents || 0), recebidoCents: Number(x.recebidoCents || 0), restanteCents: x.restanteCents != null ? Number(x.restanteCents) : null });
    } catch (_) { return res.status(500).json({ ok: false }); }
  });

  app.get('/pago', async (req, res) => {
    try {
      const cid = String(req.query.correlationID || '').trim();
      const col = await deps.getCollection('checkout_orders');
      const record = cid ? await col.findOne({ correlationID: cid, paymentMethod: 'xpag' }) : null;
      if (!record) return res.redirect('/customer');
      if (String(record.status) === 'pago') return res.redirect(`/pedido?correlationID=${encodeURIComponent(cid)}`);
      // Extras (order bumps) do pedido, para o cliente ver o que compõe o total.
      const extras = [];
      try {
        const m = record.additionalInfoMap || {};
        let bumps = String(m.order_bumps || '');
        if (!bumps && Array.isArray(record.additionalInfo)) { const it = record.additionalInfo.find((x) => x && x.key === 'order_bumps'); bumps = String((it && it.value) || ''); }
        const n = (v) => Number(v || 0).toLocaleString('en-US');
        for (const parte of bumps.split(/[;,]/)) {
          const [k0, v0] = parte.split(':'); const k = String(k0 || '').trim().toLowerCase(); const q = parseInt(v0, 10) || 0;
          if (k === 'likes' && q) extras.push(n(q) + ' me gusta');
          else if (k === 'views' && q) extras.push(n(q) + ' vistas');
          else if (k === 'comments' && q) extras.push(n(q) + (q === 1 ? ' comentario' : ' comentarios'));
          else if (k === 'upgrade') extras.push('Mejora de paquete');
          else if (/^warranty/.test(k)) extras.push(/3m|3/.test(k) ? 'Reposición por 3 meses' : 'Reposición extendida');
        }
      } catch (_) {}
      // TrackCombo: liga a venda à visita pelo número do pedido (= external_id da cobrança Xpag). Só pedido do site.
      let tcEvento = '';
      try {
        const doBot = /^WppAgent_/.test(String(record.correlationID || '')) || String(((Array.isArray(record.additionalInfo) ? record.additionalInfo : []).find((i) => i && i.key === 'source') || {}).value || '') === 'wpp_agent';
        const ext = String((record.xpag && record.xpag.external_id) || '');
        if (!doBot && ext) {
          const ev = { event: 'add_payment_info', transaction_id: ext, value: Math.round(Number(record.expectedValueCents || record.valueCents || 0)) / 100, currency: 'MXN',
            user_data: { email: String((record.customer && record.customer.email) || ''), phone: String((record.customer && (record.customer.phone_number || record.customer.phone)) || '') } };
          tcEvento = '<script>(function(){var ev=' + JSON.stringify(ev).replace(/</g, '\\u003c') + ';var n=0;(function t(){try{if(window.tcData&&typeof window.tcData.executeEvent==="function"){window.tcData.executeEvent(ev);return;}}catch(_){}if(++n<40)setTimeout(t,250);})();})();</script>';
        }
      } catch (_) {}
      return res.render('pago', { correlationID: cid, xpag: record.xpag || {}, valueCents: record.expectedValueCents || record.valueCents || 0, recebidoCents: Number((record.xpag && record.xpag.recebidoCents) || 0), clabeAberta: xpagEhClabeAberta(record.xpag), qtd: record.qtd, tipo: record.tipo, instagram: record.instagramUsername || record.instauser || '', extras }, (err, html) => {
        if (err) { try { console.error('❌ /pago render', err.message); } catch (_) {} return res.status(500).send('Error al cargar la página de pago'); }
        return res.send(tcEvento ? String(html).replace('</body>', tcEvento + '</body>') : html);
      });
    } catch (e) {
      try { console.error('❌ /pago', e?.message || String(e)); } catch (_) {}
      return res.status(500).send('Error al cargar la página de pago');
    }
  });

  // Conciliação: confere pedidos Xpag pendentes das últimas 48h (rede de segurança do webhook).
  if (String(process.env.XPAG_RECONCILE_ENABLED || '1') !== '0') {
    let rodando = false;
    setInterval(async () => {
      if (rodando || !getXpagConfig().clientId) return;
      rodando = true;
      try {
        const col = await deps.getCollection('checkout_orders');
        const desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
        // CLABE com pagamento parcial segue sendo conferida por 15 dias (o cliente pode completar depois).
        const desdeParcial = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString();
        const pend = await col.find({ paymentMethod: 'xpag', status: 'pendente', $or: [{ createdAt: { $gte: desde } }, { createdAt: { $gte: desdeParcial }, 'xpag.recebidoCents': { $gt: 0 } }] }).sort({ createdAt: -1 }).limit(150).toArray();
        for (const r of pend) { try { await sincronizarXpag(col, r); } catch (_) {} }
      } catch (_) {} finally { rodando = false; }
    }, 3 * 60 * 1000);
  }
  
  // Ordena as chaves recursivamente (exigido pela assinatura do IPN da NOWPayments).
  function nowpaymentsSortObject(obj) {
    if (Array.isArray(obj)) return obj.map(nowpaymentsSortObject);
    if (!obj || typeof obj !== 'object') return obj;
    return Object.keys(obj).sort().reduce((acc, k) => {
      acc[k] = nowpaymentsSortObject(obj[k]);
      return acc;
    }, {});
  }
  
  function nowpaymentsSignatureOk(payload, signature, secret) {
    try {
      if (!payload || !signature || !secret) return false;
      const digest = crypto.createHmac('sha512', String(secret).trim()).update(JSON.stringify(nowpaymentsSortObject(payload))).digest('hex');
      const a = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
      const b = Buffer.from(digest, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) { return false; }
  }
  
  // Aplica um status de pagamento da NOWPayments ao pedido (usado pelo IPN e pela página /pedido).
  // confirmed/sending/finished = pago; partially_paid fica pendente (cliente pagou menos).
  async function applyNowPaymentsStatus(col, record, p) {
    if (!record || !p) return record;
    const npStatus = String(p.payment_status || '').trim().toLowerCase();
    const paidStatuses = ['confirmed', 'sending', 'finished'];
    const failedStatuses = ['failed', 'expired', 'refunded'];
    const expected = Math.round(Number(record.expectedValueCents || record.valueCents || 0)) / 100;
    const priceAmount = Number(p.price_amount || 0);
    const amountOk = !expected || !priceAmount || Math.abs(priceAmount - expected) < 0.01;
    const wasPaid = String(record.status || '').toLowerCase() === 'pago';
  
    const np = Object.assign({}, record.nowpayments || {}, {
      payment_id: p.payment_id != null ? String(p.payment_id) : (record.nowpayments && record.nowpayments.payment_id) || '',
      invoice_id: p.invoice_id != null ? String(p.invoice_id) : (record.nowpayments && record.nowpayments.invoice_id) || '',
      status: npStatus || (record.nowpayments && record.nowpayments.status) || '',
      pay_currency: p.pay_currency || (record.nowpayments && record.nowpayments.pay_currency) || '',
      pay_amount: p.pay_amount != null ? p.pay_amount : (record.nowpayments && record.nowpayments.pay_amount),
      actually_paid: p.actually_paid != null ? p.actually_paid : (record.nowpayments && record.nowpayments.actually_paid),
      outcome_amount: p.outcome_amount != null ? p.outcome_amount : (record.nowpayments && record.nowpayments.outcome_amount),
      outcome_currency: p.outcome_currency || (record.nowpayments && record.nowpayments.outcome_currency) || '',
      updatedAt: new Date().toISOString()
    });
    if (!amountOk) np.amountMismatch = { expected, received: priceAmount };
  
    const set = { nowpayments: np };
    let becamePaid = false;
    if (!wasPaid) {
      if (paidStatuses.includes(npStatus) && amountOk) {
        set.status = 'pago';
        set.paidAt = record.paidAt || new Date().toISOString();
        becamePaid = true;
      } else if (failedStatuses.includes(npStatus)) {
        set.status = 'falha';
      }
    }
  
    // Trava: só um processo marca como pago e despacha.
    const filter = becamePaid ? { _id: record._id, status: { $ne: 'pago' } } : { _id: record._id };
    const upd = await col.updateOne(filter, { $set: set });
    const fresh = Object.assign({}, record, set);
    if (becamePaid && upd && upd.modifiedCount === 1) {
      try { await deps.processOrderFulfillment(fresh, col, null); } catch (e) {
        try { console.error('❌ NOWPayments fulfillment', e?.message || String(e)); } catch (_) {}
      }
    }
    return fresh;
  }
  
  async function findOrderForNowPayments(col, p) {
    const conds = [];
    const orderId = String(p && p.order_id ? p.order_id : '').trim();
    const invoiceId = p && p.invoice_id != null ? String(p.invoice_id).trim() : '';
    const paymentId = p && p.payment_id != null ? String(p.payment_id).trim() : '';
    if (orderId) conds.push({ correlationID: orderId });
    if (invoiceId) { conds.push({ 'nowpayments.invoice_id': invoiceId }); conds.push({ identifier: `NP_${invoiceId}` }); }
    if (paymentId) conds.push({ 'nowpayments.payment_id': paymentId });
    if (!conds.length) return null;
    return col.findOne({ $or: conds, paymentMethod: 'nowpayments' });
  }
  
  async function fetchNowPaymentsPayment(paymentId) {
    const cfg = getNowPaymentsConfig();
    if (!cfg.apiKey || !paymentId) return null;
    const r = await axios.get(`${NOWPAYMENTS_API_BASE}/payment/${encodeURIComponent(String(paymentId))}`, {
      headers: { 'x-api-key': cfg.apiKey },
      httpsAgent: nowpaymentsKeepAliveAgent,
      timeout: 15000
    });
    return r && r.data ? r.data : null;
  }
  
  // IPN (webhook) da NOWPayments: assinatura HMAC-SHA512 do corpo com chaves ordenadas.
  app.post('/api/nowpayments/ipn', async (req, res) => {
    try {
      const cfg = getNowPaymentsConfig();
      if (!cfg.ipnSecret) {
        try { console.warn('⚠️ NOWPayments IPN: NOWPAYMENTS_IPN_SECRET ausente'); } catch (_) {}
        return res.status(500).send('ipn_not_configured');
      }
      let payload = null;
      try { payload = req.rawBody ? JSON.parse(Buffer.from(req.rawBody).toString('utf8')) : null; } catch (_) { payload = null; }
      if (!payload) payload = (req.body && typeof req.body === 'object') ? req.body : null;
      const sig = String(req.headers['x-nowpayments-sig'] || '').trim();
      if (!payload || !sig) return res.status(400).send('missing_signature');
      if (!nowpaymentsSignatureOk(payload, sig, cfg.ipnSecret)) {
        try { console.warn('⚠️ NOWPayments IPN: assinatura inválida', payload && payload.payment_id); } catch (_) {}
        return res.status(400).send('signature_mismatch');
      }
      res.status(200).json({ received: true });
  
      setImmediate(async () => {
        try {
          const col = await deps.getCollection('checkout_orders');
          const record = await findOrderForNowPayments(col, payload);
          if (!record) {
            try { console.warn('⚠️ NOWPayments IPN sem pedido', payload.order_id, payload.invoice_id, payload.payment_id); } catch (_) {}
            return;
          }
          await applyNowPaymentsStatus(col, record, payload);
        } catch (e) {
          try { console.error('❌ NOWPayments IPN', e?.message || String(e)); } catch (_) {}
        }
      });
    } catch (_) {
      if (!res.headersSent) return res.status(500).send('ipn_error');
    }
  });
  // usados pela página do pedido (/pedido) no app.js
  module.exports.applyNowPaymentsStatus = applyNowPaymentsStatus;
  module.exports.fetchNowPaymentsPayment = fetchNowPaymentsPayment;
};

module.exports.getNowPaymentsConfig = getNowPaymentsConfig;
