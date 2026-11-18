// wppCapi.js — Pixel de mensagens (API de Conversões para mensagens comerciais) do WhatsApp.
//
// 1) O webhook do bot chama registrarClique() quando a mensagem chega de um anúncio que abre o
//    WhatsApp (m.referral.ctwa_clid). O clique fica em wpp_ctwa_clicks, por telefone.
// 2) Ao gerar o pagamento, o bot (whatsappSales.js) grava no pedido o ctwa_clid do clique mais
//    recente do número (até 7 dias). Quando a Xpag confirma o pagamento (youagency.js →
//    applyXpagStatus), enviarCompra() manda um Purchase para o dataset com esse ctwa_clid.
//    SÓ pedidos do bot que vieram de anúncio de conversa. O resto (site, site → WhatsApp, orgânico) vai
//    pelo metaCapi.js; se a Meta recusar o evento de mensagem, ele também cai no metaCapi como "chat".
//
// A Meta NÃO deduplica eventos de mensagens: a trava é nossa (wppCapi.purchaseSentAt no pedido,
// gravada de forma atômica antes do envio) e o event_id é fixo por pedido.
// Config no .env: WPP_CAPI_DATASET_ID, WPP_CAPI_TOKEN (token do Gerenciador de Eventos),
// WHATSAPP_IA_WABA_ID (WABA do número do bot). WPP_CAPI_ENABLED=0 desliga.
const crypto = require('crypto');
const axios = require('axios');
const { getCollection } = require('./mongodbClient');

const JANELA_DIAS = 7;
const GRAPH = 'https://graph.facebook.com/v21.0';

function cfg() {
  return {
    ligado: String(process.env.WPP_CAPI_ENABLED || '1') !== '0',
    dataset: String(process.env.WPP_CAPI_DATASET_ID || '').trim(),
    token: String(process.env.WPP_CAPI_TOKEN || '').trim(),
    waba: String(process.env.WHATSAPP_IA_WABA_ID || '').trim(),
  };
}
function configurado() { const c = cfg(); return c.ligado && !!(c.dataset && c.token && c.waba); }

const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const digitos = (v) => String(v || '').replace(/\D/g, '');
const cauda10 = (v) => digitos(v).slice(-10);
// México: o WhatsApp manda 521XXXXXXXXXX (formato antigo de celular); o padrão atual é 52 + 10 dígitos.
function telefonesMx(v) {
  const d = digitos(v); const t = d.slice(-10);
  if (t.length !== 10) return [];
  return [...new Set(['52' + t, d.length >= 12 ? d : null].filter(Boolean))];
}
function primeiroNome(n) {
  const s = String(n || '').trim().toLowerCase().normalize('NFC').replace(/[^\p{L}\s'-]/gu, '').trim();
  return s ? s.split(/\s+/)[0] : '';
}

let indicesOk = false;
async function colCliques() {
  const col = await getCollection('wpp_ctwa_clicks');
  if (!indicesOk) { indicesOk = true; try { await col.createIndex({ tail: 1, at: -1 }); await col.createIndex({ ctwaClid: 1 }, { unique: true }); } catch (_) {} }
  return col;
}

// Chamado pelo webhook do WhatsApp para cada mensagem que veio de anúncio.
async function registrarClique(waId, referral) {
  try {
    const clid = String((referral && referral.ctwa_clid) || '').trim();
    const tail = cauda10(waId);
    if (!clid || tail.length !== 10) return;
    const col = await colCliques();
    const agora = new Date();
    await col.updateOne({ ctwaClid: clid }, {
      $setOnInsert: { ctwaClid: clid, waId: digitos(waId), tail, at: agora },
      $set: {
        ultimaMsgAt: agora,
        sourceId: String(referral.source_id || ''), sourceType: String(referral.source_type || ''),
        sourceUrl: String(referral.source_url || ''), headline: String(referral.headline || '').slice(0, 200),
      },
    }, { upsert: true });
  } catch (e) { try { console.error('[wpp-capi] registrar clique', e && e.message); } catch (_) {} }
}

function telefoneDoPedido(o) {
  const ai = Array.isArray(o.additionalInfoPaid) ? o.additionalInfoPaid : (Array.isArray(o.additionalInfo) ? o.additionalInfo : []);
  const m = o.additionalInfoMapPaid || o.additionalInfoMap || {};
  const doArr = (k) => { const x = ai.find((i) => i && i.key === k); return x ? x.value : ''; };
  return digitos((o.customer && (o.customer.phone_number || o.customer.phone)) || o.telefone || m.phone || doArr('phone') || '');
}

function nomeServico(o) {
  const ai = Array.isArray(o.additionalInfo) ? o.additionalInfo : [];
  const m = o.additionalInfoMap || {};
  const get = (k) => m[k] || ((ai.find((i) => i && i.key === k) || {}).value) || '';
  const cat = String(get('categoria_servico') || '').toLowerCase();
  const tipo = String(o.tipo || o.tipoServico || get('tipo_servico') || '').toLowerCase();
  const q = Number(o.quantidade || o.qtd || get('quantidade') || 0) || 0;
  const un = /curtid/.test(cat + tipo) ? 'me gusta' : (/visualiz|views|reels/.test(cat + tipo) ? 'vistas' : 'seguidores');
  const t = /organic|reais|real/.test(tipo) ? 'reales' : (/brasileir/.test(tipo) ? 'brasileños' : (un === 'vistas' ? '' : 'mixtos'));
  return `${q ? q.toLocaleString('en-US') + ' ' : ''}${un}${t ? ' ' + t : ''}`.trim();
}

// Clique mais recente deste número nos últimos 7 dias (usado pelo bot ao gerar o pagamento).
async function cliqueRecente(waId, ateMs) {
  try {
    const tail = cauda10(waId); if (tail.length !== 10) return null;
    const ate = Number(ateMs) || Date.now();
    const col = await colCliques();
    return await col.find({ tail, at: { $gte: new Date(ate - JANELA_DIAS * 864e5), $lte: new Date(ate) } }).sort({ at: -1 }).limit(1).next();
  } catch (_) { return null; }
}

const infoDoPedido = (o, k) => {
  const m = o.additionalInfoMapPaid || o.additionalInfoMap || {};
  if (m[k]) return String(m[k]);
  const ai = Array.isArray(o.additionalInfoPaid) ? o.additionalInfoPaid : (Array.isArray(o.additionalInfo) ? o.additionalInfo : []);
  const x = ai.find((i) => i && i.key === k); return x ? String(x.value || '') : '';
};
// Só vendas fechadas pelo bot do WhatsApp. Compra no site (inclusive upsell) vai pelo metaCapi.js —
// mandar aqui também contaria a mesma venda duas vezes.
const ehPedidoDoBot = (o) => /^WppAgent_/.test(String(o.correlationID || '')) || infoDoPedido(o, 'source') === 'wpp_agent';

// Envia o Purchase de um pedido pago do bot que veio de um clique em anúncio de WhatsApp.
// Idempotente: só um envio por pedido. Nunca lança exceção.
async function enviarCompra(order) {
  try {
    if (!order || !order._id || !configurado()) return { ok: false, motivo: 'nao_configurado' };
    if (!ehPedidoDoBot(order)) return { ok: false, motivo: 'nao_e_do_bot' };
    if (String(order.status || '').toLowerCase() !== 'pago') return { ok: false, motivo: 'nao_pago' };
    if (order.wppCapi && order.wppCapi.purchaseSentAt) return { ok: false, motivo: 'ja_enviado' };
    const fone = telefoneDoPedido(order);
    const tail = fone.slice(-10);
    if (tail.length !== 10) return { ok: false, motivo: 'sem_telefone' };
    const criadoMs = Date.parse(order.createdAt || order.criado || '') || Date.now();
    const pagoMs = Math.min(Date.now(), Date.parse(order.paidAt || '') || Date.now());
    if (Date.now() - pagoMs > JANELA_DIAS * 864e5) return { ok: false, motivo: 'pagamento_antigo' };
    // 1º: o ctwa_clid gravado no pedido quando o bot gerou o pagamento. 2º (reserva, ex.: cobrança
    // antiga reaproveitada): o clique mais recente do mesmo número até 7 dias antes do pedido.
    let clique = null;
    const clidPedido = infoDoPedido(order, 'ctwa_clid');
    if (clidPedido) {
      const achado = await (await colCliques()).findOne({ ctwaClid: clidPedido });
      clique = achado || { ctwaClid: clidPedido, waId: fone, at: new Date(criadoMs), sourceId: infoDoPedido(order, 'ctwa_anuncio') };
    } else {
      clique = await cliqueRecente(fone, Math.min(pagoMs, criadoMs + 60e3));
    }
    if (!clique) return { ok: false, motivo: 'sem_clique' };

    const pedidos = await getCollection('checkout_orders');
    const agora = new Date().toISOString();
    // Trava atômica: só quem gravar primeiro envia.
    const trava = await pedidos.updateOne({ _id: order._id, 'wppCapi.purchaseSentAt': { $exists: false } },
      { $set: { 'wppCapi.purchaseSentAt': agora, 'wppCapi.ctwaClid': clique.ctwaClid, 'wppCapi.cliqueEm': clique.at, 'wppCapi.anuncio': clique.sourceId || '' } });
    if (!trava.modifiedCount) return { ok: false, motivo: 'ja_enviado' };

    const c = cfg();
    const valor = Math.round(Number(order.expectedValueCents || order.valueCents || 0)) / 100;
    const nome = primeiroNome((order.customer && order.customer.name) || order.nomeUsuario || '');
    const fones = telefonesMx(clique.waId || fone);
    const ident = String(order.identifier || order.correlationID || order._id);
    const user_data = {
      whatsapp_business_account_id: c.waba,
      ctwa_clid: clique.ctwaClid,
      ph: fones.map(sha),
      country: [sha('mx')],
      external_id: [sha('52' + tail)],
    };
    if (nome) user_data.fn = [sha(nome)];
    const evento = {
      event_name: 'Purchase',
      event_time: Math.floor(pagoMs / 1000),
      event_id: 'ya_purchase_' + ident,
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data,
      custom_data: { currency: 'MXN', value: valor, order_id: ident, content_name: nomeServico(order), content_type: 'product', num_items: 1 },
    };
    const body = { data: [evento] };
    if (process.env.WPP_CAPI_TEST_CODE) body.test_event_code = String(process.env.WPP_CAPI_TEST_CODE);
    const r = await axios.post(`${GRAPH}/${c.dataset}/events`, body, { params: { access_token: c.token }, timeout: 20000, validateStatus: () => true });
    const ok = r.status === 200 && r.data && Number(r.data.events_received) >= 1;
    const set = { 'wppCapi.ok': ok, 'wppCapi.http': r.status, 'wppCapi.valor': valor };
    if (ok) set['wppCapi.fbtrace'] = String(r.data.fbtrace_id || '');
    else set['wppCapi.erro'] = JSON.stringify((r.data && r.data.error) || r.data || {}).slice(0, 400);
    // Falha transitória (rede/5xx/limite): libera a trava para o reenvio automático tentar de novo.
    const transitoria = !ok && (r.status >= 500 || r.status === 429 || (r.data && r.data.error && r.data.error.is_transient));
    const upd = { $set: set, $inc: { 'wppCapi.tentativas': 1 } };
    if (transitoria) upd.$unset = { 'wppCapi.purchaseSentAt': '' };
    await pedidos.updateOne({ _id: order._id }, upd);
    // Recusa definitiva do evento de mensagem (região, página diferente da do anúncio etc.): manda a
    // mesma venda como "chat" pelo metaCapi (telefone + nome, sem ctwa_clid) para não perder a compra.
    if (!ok && !transitoria) {
      try { const fresh = await pedidos.findOne({ _id: order._id }); await require('./metaCapi.js').enviarCompra(fresh, { motivo: 'ctwa_recusado' }); } catch (_) {}
    }
    try { console.log(`📨 [wpp-capi] Purchase ${ident} $${valor} MXN ${ok ? 'ok' : 'ERRO ' + r.status}`); } catch (_) {}
    return { ok, http: r.status, transitoria };
  } catch (e) {
    try { console.error('[wpp-capi] enviarCompra', e && e.message); } catch (_) {}
    return { ok: false, motivo: 'excecao' };
  }
}

// Reenvio: pedidos pagos nas últimas 48h cuja tentativa falhou de forma transitória (até 5 vezes).
let loopIniciado = false;
function iniciarReenvio() {
  if (loopIniciado || !configurado()) return; loopIniciado = true;
  setInterval(async () => {
    try {
      const col = await getCollection('checkout_orders');
      const desde = new Date(Date.now() - 48 * 3600e3).toISOString();
      const docs = await col.find({ status: 'pago', paidAt: { $gte: desde }, 'wppCapi.tentativas': { $gte: 1, $lt: 5 }, 'wppCapi.purchaseSentAt': { $exists: false } }).limit(20).toArray();
      for (const d of docs) await enviarCompra(d);
    } catch (_) {}
  }, 10 * 60 * 1000);
}

module.exports = { registrarClique, cliqueRecente, enviarCompra, iniciarReenvio, configurado };
