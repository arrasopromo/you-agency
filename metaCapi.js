// metaCapi.js — Compra (Purchase) do You Agency para a API de Conversões da Meta, pelo servidor.
//
// Cada venda vai UMA vez só. Quem manda depende de onde veio a pessoa:
//  • Compra no SITE → TrackCombo (container youagency-mx): webhook da Xpag repassado + evento
//    add_payment_info na tela /pago (youagency.js). NÃO passa por aqui.
//  • Anúncio de conversa (abre direto o WhatsApp, tem ctwa_clid) → wppCapi.js (business_messaging).
//    Se a Meta recusar esse evento de mensagem, cai aqui como "chat" (telefone + nome, sem ctwa_clid).
//  • Anúncio → site → botão do WhatsApp → compra no bot → aqui: o link do WhatsApp leva um código
//    "(#XXXXX)" que o site guardou com o clique (wa_refs, cookies _fbc/_fbp da tag TrackCombo); o bot
//    lê o código e o pedido herda o clique.
//  • Venda do bot sem clique (orgânico) → aqui também: a Meta recebe a venda, só não credita a um anúncio.
//
// Trava atômica por pedido (metaCapi.purchaseSentAt) e event_id fixo por pedido. Falha passageira da
// Meta (5xx/429/is_transient) libera a trava para o reenvio automático (até 5 tentativas em 48h).
// Config: YA_CAPI_DATASET_ID / YA_CAPI_TOKEN (sem eles usa WPP_CAPI_DATASET_ID / WPP_CAPI_TOKEN, o mesmo
// conjunto de dados do WhatsApp). YA_CAPI_ENABLED=0 desliga. YA_CAPI_TEST_CODE manda para "Testar eventos".
'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { getCollection } = require('./mongodbClient');

const GRAPH = 'https://graph.facebook.com/v21.0';
const JANELA_PAGO_DIAS = 7;        // a Meta só aceita eventos de até 7 dias
const JANELA_ORIGEM_DIAS = 30;     // procurar o clique em outro pedido do mesmo telefone
const COOKIE_DIAS = 90;

function cfg() {
  return {
    ligado: String(process.env.YA_CAPI_ENABLED || '1') !== '0',
    dataset: String(process.env.YA_CAPI_DATASET_ID || process.env.WPP_CAPI_DATASET_ID || '').trim(),
    token: String(process.env.YA_CAPI_TOKEN || process.env.WPP_CAPI_TOKEN || '').trim(),
    teste: String(process.env.YA_CAPI_TEST_CODE || '').trim(),
  };
}
function configurado() { const c = cfg(); return c.ligado && !!(c.dataset && c.token); }

const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const digitos = (v) => String(v || '').replace(/\D/g, '');
const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s'-]/g, '').trim();
function telefonesMx(v) {
  const d = digitos(v); const t = d.slice(-10);
  if (t.length !== 10) return [];
  return [...new Set(['52' + t, d.length >= 12 ? d : null].filter(Boolean))];
}
function cookie(req, nome) {
  const m = String((req && req.headers && req.headers.cookie) || '').match(new RegExp('(?:^|;\\s*)' + nome + '=([^;]+)'));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}
function ipDe(req) {
  let ip = String((req && (req.realIP || req.ip)) || '').split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

// ── 1) Clique do anúncio no site: _fbc (do fbclid da URL) e _fbp (navegador) ──────────────────
// O site não tem o pixel da Meta no navegador, então grava os dois cookies do mesmo jeito que o pixel.
function middlewareCookies(req, res, next) {
  try {
    if (req.method !== 'GET' || /^\/(api|css|js|images|fonts|uploads|favicon)/i.test(req.path) || /\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
    const opts = { maxAge: COOKIE_DIAS * 864e5, sameSite: 'lax', path: '/', secure: !!(req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')) };
    const fbclid = String((req.query && req.query.fbclid) || '').trim();
    if (fbclid && fbclid.length < 500) {
      const atual = cookie(req, '_fbc');
      if (!atual || !atual.endsWith('.' + fbclid)) res.cookie('_fbc', 'fb.1.' + Date.now() + '.' + fbclid, opts);
    }
    if (!cookie(req, '_fbp')) res.cookie('_fbp', 'fb.1.' + Date.now() + '.' + (Math.floor(Math.random() * 9e9) + 1e9), opts);
  } catch (_) {}
  next();
}

// Dados de navegador para gravar no pedido (só pedido feito no navegador; o do bot não tem cookies).
function rastreioDoNavegador(req) {
  try {
    const fbc = cookie(req, '_fbc'), fbp = cookie(req, '_fbp');
    const ua = String((req.headers && req.headers['user-agent']) || '').slice(0, 400);
    if (!fbc && !fbp) return null;
    let url = String((req.headers && (req.headers.referer || req.headers.referrer)) || '').slice(0, 500);
    return { fbc, fbp, ip: ipDe(req), ua, url, em: new Date().toISOString() };
  } catch (_) { return null; }
}

// ── 2) Código do botão do WhatsApp "(#XXXXX)" ─────────────────────────────────────────────────
const RE_CODIGO = /\(#([A-HJ-NP-Z2-9]{5})\)/;   // sem 0/O/1/I para não confundir
let idxRefs = false;
async function colRefs() {
  const col = await getCollection('wa_refs');
  if (!idxRefs) { idxRefs = true; try { await col.createIndex({ criadoEm: 1 }, { expireAfterSeconds: 45 * 864e5 / 1000 }); } catch (_) {} }
  return col;
}
let idxRefsFone = false;
async function colRefsFone() {
  const col = await getCollection('wa_refs_telefone');
  if (!idxRefsFone) { idxRefsFone = true; try { await col.createIndex({ tail: 1, em: -1 }); } catch (_) {} }
  return col;
}
// POST /api/wa-ref { code, pagina } — chamado pelo site no clique do botão do WhatsApp.
async function salvarRefSite(req) {
  const code = String((req.body && req.body.code) || '').trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) return { ok: false };
  const col = await colRefs();
  let utm = null;
  try { const u = cookie(req, 'op_ut'); if (u) { const j = JSON.parse(u); utm = { source: j.source || '', medium: j.medium || '', campaign: j.campaign || '', content: j.content || '', term: j.term || '' }; } } catch (_) {}
  const doc = {
    fbc: cookie(req, '_fbc'), fbp: cookie(req, '_fbp'), ip: ipDe(req), ua: String(req.headers['user-agent'] || '').slice(0, 400),
    url: String((req.headers && req.headers.referer) || '').slice(0, 500), pagina: String((req.body && req.body.pagina) || '').slice(0, 120),
    visitorId: cookie(req, 'ya_cid'), utm, criadoEm: new Date(),
  };
  await col.updateOne({ _id: code }, { $setOnInsert: doc }, { upsert: true });
  return { ok: true };
}
// Bot: a mensagem trouxe "(#XXXXX)" → liga o código ao telefone. Devolve o texto sem o código.
async function lerCodigoDaMensagem(waId, texto) {
  const m = String(texto || '').match(RE_CODIGO);
  if (!m) return texto;
  try {
    const tail = digitos(waId).slice(-10);
    const ref = await (await colRefs()).findOne({ _id: m[1] });
    if (ref && tail.length === 10) await (await colRefsFone()).updateOne({ tail, code: m[1] }, { $setOnInsert: { tail, code: m[1], em: new Date() } }, { upsert: true });
  } catch (_) {}
  return String(texto).replace(RE_CODIGO, ' ').replace(/\s{2,}/g, ' ').trim();
}
// Código do site mais recente deste telefone (até 30 dias), para o bot gravar no pedido.
async function refRecente(waId) {
  try {
    const tail = digitos(waId).slice(-10); if (tail.length !== 10) return null;
    const desde = new Date(Date.now() - JANELA_ORIGEM_DIAS * 864e5);
    return await (await colRefsFone()).find({ tail, em: { $gte: desde } }).sort({ em: -1 }).limit(1).next();
  } catch (_) { return null; }
}

// ── 3) Nome de quem pagou o SPEI (a Xpag manda pelo e2e da transferência) ──────────────────────
async function pagadorPorE2e(e2e) {
  try {
    const base = String(process.env.XPAG_API_BASE || 'https://api.xpag.global').trim().replace(/\/+$/, '');
    const id = String(process.env.XPAG_CLIENT_ID || '').trim(), sec = String(process.env.XPAG_CLIENT_SECRET || '').trim();
    if (!e2e || !id) return '';
    const r = await axios.get(base + '/consult-transaction', { params: { e2e }, headers: { 'X-Client-Id': id, 'X-Client-Secret': sec }, timeout: 4000, validateStatus: () => true });
    const d = (r && r.data && typeof r.data === 'object') ? r.data : {};
    const cands = [d.payer_name, d.payerName, d.payer && d.payer.name, d.sender_name, d.data && d.data.payer_name];
    for (const p of (Array.isArray(d.payments) ? d.payments : [])) cands.push(p && (p.payer_name || p.payerName || (p.payer && p.payer.name)));
    const nome = cands.map((x) => String(x || '').trim()).find((x) => x.length >= 3);
    return nome || '';
  } catch (_) { return ''; }
}

// ── 4) Envio do Purchase ──────────────────────────────────────────────────────────────────────
const info = (o, k) => {
  const m = Object.assign({}, o.additionalInfoMap || {}, o.additionalInfoMapPaid || {});
  if (m[k] != null && m[k] !== '') return String(m[k]);
  const ai = Array.isArray(o.additionalInfoPaid) ? o.additionalInfoPaid : (Array.isArray(o.additionalInfo) ? o.additionalInfo : []);
  const x = ai.find((i) => i && i.key === k); return x ? String(x.value || '') : '';
};
const telefoneDoPedido = (o) => digitos((o.customer && (o.customer.phone_number || o.customer.phone)) || o.telefone || info(o, 'phone'));
function nomeServico(o) {
  const tipo = String(o.tipo || o.tipoServico || info(o, 'tipo_servico') || '').toLowerCase();
  const cat = String(info(o, 'categoria_servico') || '').toLowerCase();
  const q = Number(o.quantidade || o.qtd || info(o, 'quantidade') || 0) || 0;
  const un = /coment/.test(cat + tipo) ? 'comentarios' : (/curtid|likes/.test(cat + tipo) ? 'me gusta' : (/visualiz|views|reels/.test(cat + tipo) ? 'vistas' : 'seguidores'));
  const rede = /tiktok/.test(tipo + cat) ? ' TikTok' : (/facebook/.test(tipo + cat) ? ' Facebook' : '');
  return `${q ? q.toLocaleString('en-US') + ' ' : ''}${un}${rede}`.trim();
}

// Origem do clique: 1) gravada no pedido (site), 2) código do botão do WhatsApp (bot), 3) outro pedido
// do mesmo telefone nos últimos 30 dias que tinha clique de anúncio.
async function origemDoPedido(o, col) {
  if (o.tracking && (o.tracking.fbc || o.tracking.fbp)) return Object.assign({ via: 'pedido' }, o.tracking);
  const code = info(o, 'wa_ref');
  if (code) { try { const r = await (await colRefs()).findOne({ _id: code }); if (r) return Object.assign({ via: 'botao_whatsapp' }, r); } catch (_) {} }
  const tail = telefoneDoPedido(o).slice(-10);
  if (tail.length === 10) {
    try {
      const desde = new Date(Date.now() - JANELA_ORIGEM_DIAS * 864e5).toISOString();
      const outro = await col.find({ _id: { $ne: o._id }, 'tracking.fbc': { $nin: [null, ''] }, createdAt: { $gte: desde }, $or: [{ 'customer.phone_number': new RegExp(tail + '$') }, { 'customer.phone': new RegExp(tail + '$') }] }).sort({ createdAt: -1 }).limit(1).next();
      if (outro && outro.tracking) return Object.assign({ via: 'outro_pedido' }, outro.tracking);
    } catch (_) {}
  }
  return null;
}

// Manda o Purchase de um pedido pago. opts.motivo: por que caiu aqui (ex.: 'ctwa_recusado').
// Idempotente e nunca lança exceção.
async function enviarCompra(order, opts = {}) {
  try {
    if (!order || !order._id || !configurado()) return { ok: false, motivo: 'nao_configurado' };
    if (String(order.status || '').toLowerCase() !== 'pago') return { ok: false, motivo: 'nao_pago' };
    // Só venda fechada pelo bot do WhatsApp. Compra no site vai pela TrackCombo (mandar aqui duplicaria).
    const doBot = /^WppAgent_/.test(String(order.correlationID || '')) || info(order, 'source') === 'wpp_agent';
    if (!doBot) return { ok: false, motivo: 'site_trackcombo' };
    if (order.upsell && order.upsell.isUpsell && !opts.incluirUpsell) { /* upsell também é venda: segue */ }
    if (order.wppCapi && order.wppCapi.ok) return { ok: false, motivo: 'ja_enviado_whatsapp' };
    if (order.metaCapi && order.metaCapi.purchaseSentAt) return { ok: false, motivo: 'ja_enviado' };
    const pagoMs = Math.min(Date.now(), Date.parse(order.paidAt || '') || Date.now());
    if (Date.now() - pagoMs > JANELA_PAGO_DIAS * 864e5) return { ok: false, motivo: 'pagamento_antigo' };

    const pedidos = await getCollection('checkout_orders');
    const trava = await pedidos.updateOne({ _id: order._id, 'metaCapi.purchaseSentAt': { $exists: false } }, { $set: { 'metaCapi.purchaseSentAt': new Date().toISOString() } });
    if (!trava.modifiedCount) return { ok: false, motivo: 'ja_enviado' };

    const c = cfg();
    const origem = await origemDoPedido(order, pedidos);
    // Nome: quem pagou o SPEI (Xpag) > nome do cliente no pedido.
    let pagador = String((order.pagador && order.pagador.nome) || '');
    if (!pagador && order.xpag && Array.isArray(order.xpag.pagamentos) && order.xpag.pagamentos[0] && order.xpag.pagamentos[0].e2e) {
      pagador = await pagadorPorE2e(order.xpag.pagamentos[0].e2e);
      if (pagador) { try { await pedidos.updateOne({ _id: order._id }, { $set: { pagador: { nome: pagador, fonte: 'xpag_e2e', em: new Date().toISOString() } } }); } catch (_) {} }
    }
    const nomeCompleto = norm(pagador || (order.customer && order.customer.name) || order.nomeUsuario || '');
    const partes = nomeCompleto.split(/\s+/).filter(Boolean);
    const fone = telefoneDoPedido(order);
    const email = String((order.customer && order.customer.email) || info(order, 'email') || '').trim().toLowerCase();
    const ig = String(order.instagramUsername || order.instauser || info(order, 'perfil') || '').trim().toLowerCase().replace(/^@/, '');
    const ident = String(order.identifier || order.correlationID || order._id);

    const user_data = { country: [sha('mx')] };
    if (email && /@/.test(email)) user_data.em = [sha(email)];
    const fones = telefonesMx(fone); if (fones.length) user_data.ph = fones.map(sha);
    if (partes[0]) user_data.fn = [sha(partes[0])];
    if (partes.length > 1) user_data.ln = [sha(partes[partes.length - 1])];
    const ext = ig || (fone ? '52' + fone.slice(-10) : '');
    if (ext) user_data.external_id = [sha(ext)];
    let action_source = 'chat', event_source_url;
    if (origem) {
      if (origem.fbc) user_data.fbc = origem.fbc;
      if (origem.fbp) user_data.fbp = origem.fbp;
      if (origem.ip && origem.ua) {
        user_data.client_ip_address = origem.ip; user_data.client_user_agent = origem.ua;
        action_source = 'website'; event_source_url = origem.url || ('https://' + String(process.env.YA_PUBLIC_HOST || 'youagency.site'));
      }
    }
    const valor = Math.round(Number(order.expectedValueCents || order.valueCents || 0)) / 100;
    const tipo = String(order.tipo || order.tipoServico || info(order, 'tipo_servico') || 'servicio');
    const qtd = Number(order.quantidade || order.qtd || info(order, 'quantidade') || 1) || 1;
    const evento = {
      event_name: 'Purchase', event_time: Math.floor(pagoMs / 1000), event_id: 'ya_purchase_' + ident, action_source, user_data,
      custom_data: { currency: 'MXN', value: valor, order_id: ident, content_name: nomeServico(order), content_type: 'product', contents: [{ id: tipo, quantity: qtd }], num_items: 1 },
    };
    if (event_source_url) evento.event_source_url = event_source_url;
    const body = { data: [evento] };
    if (c.teste) body.test_event_code = c.teste;
    const r = await axios.post(`${GRAPH}/${c.dataset}/events`, body, { params: { access_token: c.token }, timeout: 20000, validateStatus: () => true });
    const ok = r.status === 200 && r.data && Number(r.data.events_received) >= 1;
    const set = { 'metaCapi.ok': ok, 'metaCapi.http': r.status, 'metaCapi.valor': valor, 'metaCapi.modo': action_source, 'metaCapi.origem': origem ? origem.via : 'sem_clique', 'metaCapi.temFbc': !!(origem && origem.fbc), 'metaCapi.temNome': !!partes[0] };
    if (opts.motivo) set['metaCapi.motivo'] = opts.motivo;
    if (ok) set['metaCapi.fbtrace'] = String(r.data.fbtrace_id || '');
    else set['metaCapi.erro'] = JSON.stringify((r.data && r.data.error) || r.data || {}).slice(0, 400);
    const transitoria = !ok && (r.status >= 500 || r.status === 429 || (r.data && r.data.error && r.data.error.is_transient));
    const upd = { $set: set, $inc: { 'metaCapi.tentativas': 1 } };
    if (transitoria) upd.$unset = { 'metaCapi.purchaseSentAt': '' };
    await pedidos.updateOne({ _id: order._id }, upd);
    try { console.log(`📨 [meta-capi] Purchase ${ident} $${valor} MXN ${action_source} origem=${origem ? origem.via : 'sem_clique'} ${ok ? 'ok' : 'ERRO ' + r.status}`); } catch (_) {}
    return { ok, http: r.status, transitoria };
  } catch (e) {
    try { console.error('[meta-capi] enviarCompra', e && e.message); } catch (_) {}
    return { ok: false, motivo: 'excecao' };
  }
}

// Reenvio: pedidos pagos nas últimas 48h cuja tentativa falhou de forma passageira (até 5 vezes).
let loop = false;
function iniciarReenvio() {
  if (loop || !configurado()) return; loop = true;
  setInterval(async () => {
    try {
      const col = await getCollection('checkout_orders');
      const desde = new Date(Date.now() - 48 * 3600e3).toISOString();
      const docs = await col.find({ status: 'pago', paidAt: { $gte: desde }, 'metaCapi.tentativas': { $gte: 1, $lt: 5 }, 'metaCapi.purchaseSentAt': { $exists: false } }).limit(20).toArray();
      for (const d of docs) await enviarCompra(d, { motivo: 'reenvio' });
    } catch (_) {}
  }, 10 * 60 * 1000);
}

module.exports = { middlewareCookies, rastreioDoNavegador, salvarRefSite, lerCodigoDaMensagem, refRecente, pagadorPorE2e, enviarCompra, iniciarReenvio, configurado, _origemDoPedido: origemDoPedido };
