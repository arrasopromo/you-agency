// whatsappSales.js — You Agency (México): catálogo, preços em MXN, validação de perfil,
// criação do pedido + cobrança Xpag (SPEI / OXXO) e flag de suporte para a IA de vendas do
// WhatsApp. Porte do bot da Oppus: mesma lógica, textos em espanhol, sem Pix/CPF.
// Reusa os MESMOS preços (pricing.js) e o MESMO endpoint de cobrança do site (/api/xpag/create-charge).
'use strict';

const { getCollection } = require('./mongodbClient');
const { tabelaSeguidores, tabelaCurtidas, tabelaVisualizacoes, parsePrecoToCents } = require('./pricing.js');
let axios = require('axios'); if (axios && axios.default) axios = axios.default;

const INTERNAL_BASE = String(process.env.INTERNAL_BASE || ('http://localhost:' + (process.env.PORT || '3000'))).replace(/\/+$/, '');
const PUBLIC_BASE = String(process.env.PUBLIC_BASE_URL || 'https://youagency.site').replace(/\/+$/, '');

// $ 1,006.90 MXN
const mxn = (cents) => '$ ' + (Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MXN';
const brl = mxn; // compatibilidade com quem importava brl()

// ── Catálogo: só o que o site do México vende standalone ──
const CATALOG = {
  seguidores:    { key: 'seguidores',    categoria: 'seguidores',    unit: 'seguidores',     needsPost: false, tipos: true,  table: (t) => tabelaSeguidores[t] },
  curtidas:      { key: 'curtidas',      categoria: 'curtidas',      unit: 'me gusta',       needsPost: true,  tipos: true,  table: (t) => tabelaCurtidas[t] },
  visualizacoes: { key: 'visualizacoes', categoria: 'visualizacoes', unit: 'vistas', needsPost: true, tipos: false, tipoFixo: 'visualizacoes_reels', table: () => tabelaVisualizacoes.visualizacoes_reels },
  // Mesmos PACOTES e preços do site (/servicios-comentarios e pricing.js): 5, 10, 25, 50, 100 e 250, numa publicação só.
  comentarios:   { key: 'comentarios',   categoria: 'comentarios',   unit: 'comentarios',    needsPost: true,  tipos: false, tipoFixo: 'comentarios', porUnidadeCents: 2000, pacotes: [5, 10, 25, 50, 100, 250], umPost: true, table: () => [5, 10, 25, 50, 100, 250].map((q) => ({ q, p: '$ ' + (require('./pricing.js').comentariosIgCents(q) / 100) })) },
};
// ── TikTok e Facebook (mesmos pacotes/preços das páginas /servicios-tiktok e /servicios-facebook,
// tabela pricing.tabelaRedes). Só tipo mixtos. O bot oferece SÓ se o cliente pedir essas redes.
const { tabelaRedes } = require('./pricing.js');
const REDES = {
  tiktok: {
    nome: 'TikTok',
    servicos: {
      seguidores: { tipo: 'tiktok_seguidores', unit: 'seguidores', alvo: 'perfil' },
      curtidas: { tipo: 'tiktok_curtidas', unit: 'me gusta', alvo: 'post' },
      curtidas_reais: { tipo: 'tiktok_curtidas_reais', unit: 'me gusta', alvo: 'post', tipoNombre: 'reales' },
      visualizacoes: { tipo: 'tiktok_visualizacoes', unit: 'vistas', alvo: 'post' },
      comentarios: { tipo: 'tiktok_comentarios', unit: 'comentarios', alvo: 'post' },
    },
  },
  facebook: {
    nome: 'Facebook',
    servicos: {
      seguidores: { tipo: 'facebook_seguidores', unit: 'seguidores', alvo: 'perfil' },  // perfil ou página
      curtidas: { tipo: 'facebook_curtidas', unit: 'me gusta', alvo: 'post' },
      visualizacoes: { tipo: 'facebook_visualizacoes', unit: 'vistas', alvo: 'post' },
      comentarios: { tipo: 'facebook_comentarios', unit: 'comentarios', alvo: 'post' },
    },
  },
};
function normalizeRede(r) {
  const t = String(r || '').trim().toLowerCase();
  if (/tik\s*tok|^tt$/.test(t)) return 'tiktok';
  if (/face|^fb$/.test(t)) return 'facebook';
  return 'instagram';
}
function _servicoRede(rede, servico, tipo) {
  const t = String(servico || '').trim().toLowerCase();
  const R = REDES[rede]; if (!R) return null;
  if (/coment|comment/.test(t)) return R.servicos.comentarios || null;
  if (/p[aá]gina|fanpage|page/.test(t) && R.servicos.seguidores_pagina) return R.servicos.seguidores_pagina;
  const k = normalizeServico(t);
  // "me gusta reales" (tipo organicos ou servico curtidas_reais) → serviço próprio, se a rede tiver.
  if (k === 'curtidas' && R.servicos.curtidas_reais && (/real|organic|orgánic/.test(t) || (String(tipo || '').trim() && normalizeTipo(tipo) === 'organicos'))) return R.servicos.curtidas_reais;
  return (k && R.servicos[k]) || null;
}
const _linkRedeOk = (rede, u) => {
  const s = String(u || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  return rede === 'tiktok' ? /^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(s) : /^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fb\.com|fb\.watch)\//i.test(s);
};
const _linkPostRedeOk = (rede, u) => {
  if (!_linkRedeOk(rede, u)) return false;
  const s = String(u);
  if (rede === 'tiktok') return /\/(video|photo)\/\d+/i.test(s) || /\/\/(vm|vt)\.tiktok\.com\//i.test(s);
  return /\/(posts|videos|reel|watch|photo|story\.php|permalink|share)\b|fbid=|\/p\/|fb\.watch\//i.test(s);
};
function _quoteRede(rede, servico, quantidade, hidden, tipo) {
  const sv = _servicoRede(rede, servico, tipo);
  if (sv && hidden && Array.isArray(hidden[rede]) && hidden[rede].includes(String(sv.tipo).toLowerCase())) return { ok: false, error: 'servico_indisponivel', message: 'Ese servicio no está disponible por ahora.' };
  if (!sv) return { ok: false, error: 'servico_invalido', message: `En ${REDES[rede].nome} vendemos: ${Object.values(REDES[rede].servicos).map((x) => x.unit).filter((v, i, a) => a.indexOf(v) === i).join(', ')}.` };
  const tab = (tabelaRedes[sv.tipo] || []);
  const q = parseInt(quantidade, 10);
  if (!(q > 0)) return { ok: false, error: 'quantidade_invalida', available: tab.map((x) => x.q) };
  const it = tab.find((x) => x.q === q);
  if (!it) return { ok: false, error: 'quantidade_indisponivel', available: tab.map((x) => x.q), message: 'Esa cantidad no está en la tabla.' };
  const priceCents = parsePrecoToCents(it.p);
  return { ok: true, rede, redeNombre: REDES[rede].nome, servico: sv.tipo, tipo: sv.tipo, tipoNombre: sv.tipoNombre || 'mixtos', quantidade: q, priceCents, priceLabel: mxn(priceCents), unit: sv.unit, needsPost: sv.alvo === 'post', alvo: sv.alvo };
}
function _tableRede(rede, servico, hidden, tipo) {
  const sv = _servicoRede(rede, servico, tipo);
  if (sv && hidden && Array.isArray(hidden[rede]) && hidden[rede].includes(String(sv.tipo).toLowerCase())) return { ok: false, error: 'servico_indisponivel', message: 'Ese servicio no está disponible por ahora.' };
  if (!sv) return { ok: false, error: 'servico_invalido' };
  return { ok: true, rede, redeNombre: REDES[rede].nome, servico: sv.tipo, tipoNombre: sv.tipoNombre || 'mixtos', unit: sv.unit, needsPost: sv.alvo === 'post', moneda: 'MXN', itens: (tabelaRedes[sv.tipo] || []).map((x) => ({ quantidade: x.q, preco: _label(x.p), precoCents: parsePrecoToCents(x.p) })) };
}
// Valida o perfil de TikTok (@) ou Facebook (link do perfil/página) pela MESMA busca do site.
async function validateRedeProfile(rede, usuario) {
  const q = String(usuario || '').trim();
  if (!q) return { ok: false, error: 'usuario_invalido', message: rede === 'tiktok' ? 'Pide el @ de TikTok del cliente.' : 'Pide el link del perfil o de la página de Facebook.' };
  try {
    const resp = await axios.get(INTERNAL_BASE + '/api/redes/perfil', { params: { rede, q }, timeout: 30000, validateStatus: () => true });
    const d = resp && resp.data;
    if (!d || !d.ok) return { ok: false, error: (d && d.error) || 'nao_encontrado', message: d && d.error === 'nao_encontrado' ? 'No encontramos ese perfil. Pide que revise el @ o el link.' : 'No se pudo consultar el perfil ahora; intenta de nuevo en un momento.' };
    return { ok: true, rede, username: d.username, nombre: d.nome || '', followers: d.seguidores, isPrivate: !!d.privado, link: d.link, aviso: d.privado ? 'El perfil está PRIVADO: pide que lo deje público antes de pagar.' : undefined };
  } catch (e) { return { ok: false, error: 'erro_validacao', message: (e && e.message) || 'erro' }; }
}
// Pedido de TikTok/Facebook pelo MESMO endpoint e formato da página do site (/servicios-tiktok|facebook).
async function createRedeOrder({ rede, servico, tipo, quantidade, usuario, perfil_link, nome, email, phone, post_link, comprar_mais, metodo }) {
  const cot = _quoteRede(rede, servico, quantidade, await loadHiddenTypes(), tipo);
  if (!cot.ok) return cot;
  const nomeOk = String(nome || '').trim();
  if (nomeOk.length < 2) return { ok: false, error: 'falta_nombre', message: 'Falta el nombre del cliente. Pídeselo antes de generar el pago.' };
  if (cot.priceCents < 2000) return { ok: false, error: 'monto_minimo', message: 'El pago mínimo es de $ 20 MXN. Ofrece un paquete mayor.' };
  const met = _metodo(metodo);
  if (met === 'OXXO' && cot.priceCents > 1000000) return { ok: false, error: 'oxxo_monto', message: 'OXXO acepta pagos de $ 10 a $ 10,000 MXN. Ofrece pagar por SPEI.' };
  const perfilLink = String(perfil_link || '').trim();
  if (!_linkRedeOk(rede, perfilLink)) return { ok: false, error: 'perfil_nao_validado', message: 'Primero valida el perfil de ' + cot.redeNombre + ' con validar_perfil (rede=' + rede + ').' };
  let link = perfilLink;
  if (cot.needsPost) {
    const pl = String(post_link || '').trim();
    if (!_linkPostRedeOk(rede, pl)) return { ok: false, error: 'faltou_post', message: rede === 'tiktok' ? 'Este servicio necesita el LINK del video de TikTok (ej.: https://www.tiktok.com/@usuario/video/123...). Pídelo; NO uses el link del perfil ni un ejemplo.' : 'Este servicio necesita el LINK de la publicación o video de Facebook. Pídelo; NO uses el link del perfil ni un ejemplo.' };
    link = pl;
  }
  const userTag = String(usuario || '').replace(/^@+/, '');
  // Mesmo pedido (telefone + tipo + quantidade + perfil) nos últimos 7 dias: pago → não cobra de novo; aberto → reusa.
  try {
    const fim8 = String(phone || '').replace(/\D/g, '').slice(-8);
    if (fim8.length === 8) {
      const col = await getCollection('checkout_orders');
      const desde = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
      const iguais = await col.find({
        correlationID: { $regex: '^WppAgent_' }, createdAt: { $gte: desde }, 'customer.phone': { $regex: fim8 + '$' },
        additionalInfo: { $all: [{ $elemMatch: { key: 'tipo_servico', value: cot.tipo } }, { $elemMatch: { key: 'quantidade', value: String(cot.quantidade) } }, { $elemMatch: { key: 'link_alvo', value: link } }] },
      }, { projection: { status: 1, identifier: 1, correlationID: 1, xpag: 1, paidAt: 1 } }).sort({ createdAt: -1 }).limit(5).toArray();
      const pago = iguais.find((o) => String(o.status || '').toLowerCase() === 'pago' || o.paidAt);
      if (pago && comprar_mais !== true) return { ok: false, error: 'pedido_ja_pago', message: 'Este pedido de ' + cot.redeNombre + ' YA FUE PAGADO. NO generes otro pago; habla de la entrega. Solo si el cliente quiere COMPRAR OTRO igual, usa comprar_mais=true.' };
      const aberto = iguais.find((o) => !(String(o.status || '').toLowerCase() === 'pago' || o.paidAt) && o.xpag && String(o.xpag.method || 'SPEI').toUpperCase() === met && (o.xpag.clabe || o.xpag.reference) && ((o.xpag.open_value === true && !o.xpag.expiresAt) || (o.xpag.expiresAt && new Date(o.xpag.expiresAt).getTime() > Date.now() + 30 * 60e3)));
      if (aberto) {
        const dp = _dadosPagamento(aberto);
        return { ok: true, reaproveitado: true, correlationID: aberto.correlationID, valorCents: cot.priceCents, valorLabel: cot.priceLabel, pago: dp, codigoPago: _codigoPago(dp), identifier: String(aberto.identifier || ''), resumo: `${cot.quantidade} ${cot.unit}${cot.tipoNombre === 'reales' ? ' reales' : ''} de ${cot.redeNombre} para ${userTag ? '@' + userTag : 'el perfil'} — ${cot.priceLabel} (${dp.metodo})` };
      }
    }
  } catch (_) {}
  const correlationID = 'WppAgent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  const additionalInfo = [
    { key: 'tipo_servico', value: cot.tipo }, { key: 'categoria_servico', value: rede }, { key: 'plataforma', value: rede },
    { key: 'quantidade', value: String(cot.quantidade) }, { key: 'pacote', value: `${cot.quantidade} ${cot.unit}${cot.tipoNombre === 'reales' ? ' reales' : ''} ${cot.redeNombre} - ${cot.priceLabel}` },
    { key: 'link_alvo', value: link }, { key: 'perfil_rede', value: userTag }, { key: 'perfil_rede_link', value: perfilLink }, { key: 'perfil', value: userTag },
    { key: 'phone', value: String(phone || '') }, { key: 'customer_name', value: nomeOk }, { key: 'payment_method', value: met.toLowerCase() }, { key: 'source', value: 'wpp_agent' },
  ];
  try {
    const clique = await require('./wppCapi.js').cliqueRecente(phone);
    if (clique && clique.ctwaClid) { additionalInfo.push({ key: 'ctwa_clid', value: String(clique.ctwaClid) }); if (clique.sourceId) additionalInfo.push({ key: 'ctwa_anuncio', value: String(clique.sourceId) }); }
  } catch (_) {}
  // Veio do botão do WhatsApp do site: grava o código, o pedido herda o clique do anúncio (metaCapi.js).
  try { const ref = await require('./metaCapi.js').refRecente(phone); if (ref && ref.code) additionalInfo.push({ key: 'wa_ref', value: String(ref.code) }); } catch (_) {}
  const body = { correlationID, total_cents: cot.priceCents, xpag_method: met, customer: { name: nomeOk, email: String(email || '').trim(), phone: String(phone || '').trim() }, additionalInfo, profile_is_private: false, source: 'wpp_agent' };
  try {
    // UMA chamada só (nunca repetir sozinho: evita cobrança duplicada).
    const resp = await axios.post(INTERNAL_BASE + '/api/xpag/create-charge', body, { timeout: 60000, validateStatus: () => true });
    const d = resp && resp.data;
    if (!d || resp.status < 200 || resp.status >= 300 || !d.ok) return { ok: false, error: 'charge_failed', message: String((d && (d.message || d.error)) || ('HTTP ' + (resp && resp.status))).slice(0, 200) };
    const col = await getCollection('checkout_orders');
    const rec = await col.findOne({ correlationID: d.correlationID || correlationID }, { projection: { xpag: 1, correlationID: 1, identifier: 1 } });
    const dp = _dadosPagamento(rec || { correlationID });
    return { ok: true, correlationID, valorCents: cot.priceCents, valorLabel: cot.priceLabel, pago: dp, codigoPago: _codigoPago(dp), identifier: String(d.identifier || (rec && rec.identifier) || ''), resumo: `${cot.quantidade} ${cot.unit}${cot.tipoNombre === 'reales' ? ' reales' : ''} de ${cot.redeNombre} para ${userTag ? '@' + userTag : 'el perfil'} — ${cot.priceLabel} (${dp.metodo})` };
  } catch (e) { return { ok: false, error: 'charge_error', message: (e && e.message) || 'erro' }; }
}

// No México só existem MIXTOS e REALES (orgânicos). "brasileiros" nunca é ofertado.
const TIPOS_MX = ['mistos', 'organicos'];
const NOME_TIPO = { mistos: 'mixtos', organicos: 'reales' };

function normalizeServico(s) {
  const t = String(s || '').trim().toLowerCase();
  if (/seguidor|follow/.test(t)) return 'seguidores';
  if (/curtida|like|me\s*gusta|megusta/.test(t)) return 'curtidas';
  if (/visual|view|vista|reel|reproduc/.test(t)) return 'visualizacoes';
  if (/coment|comment/.test(t)) return 'comentarios';
  return '';
}

// "reales"/"de verdad"/"orgánicos" → organicos; "mixtos"/"mundiales" → mistos.
function normalizeTipo(tipo) {
  const t = String(tipo || '').trim().toLowerCase();
  if (!t) return 'mistos';
  if (/organic|orgánic|orgânic|reales|real|de verdad|verdader/.test(t)) return 'organicos';
  if (/brasileir|latin|mexican/.test(t)) return 'brasileiros';
  if (/mixt|misto|mundial|internac|varios/.test(t)) return 'mistos';
  return 'mistos';
}

// ── Tipos OCULTOS (Gerenciamento de Tipo → settings.service_visibility) + regra fixa do México.
let __hiddenTypesCache = { at: 0, data: null };
async function loadHiddenTypes() {
  const now = Date.now();
  if (__hiddenTypesCache.data && (now - __hiddenTypesCache.at) < 60000) return __hiddenTypesCache.data;
  const out = { seguidores: [], curtidas: [], visualizacoes: [], comentarios: [], tiktok: [], facebook: [] };
  try {
    const col = await getCollection('settings');
    const doc = col ? await col.findOne({ _id: 'service_visibility' }, { projection: { _id: 0, values: 1 } }) : null;
    const values = (doc && doc.values && typeof doc.values === 'object') ? doc.values : {};
    const hidden = (values && values.hidden && typeof values.hidden === 'object') ? values.hidden : ((values && typeof values === 'object') ? values : {});
    for (const k of ['seguidores', 'curtidas', 'visualizacoes', 'comentarios', 'tiktok', 'facebook']) {
      out[k] = Array.isArray(hidden[k]) ? hidden[k].map((x) => String(x || '').trim().toLowerCase()).filter(Boolean) : [];
    }
  } catch (_) {}
  __hiddenTypesCache = { at: now, data: out };
  return out;
}
function _configTipoKey(servicoKey, tipoKey) {
  if (servicoKey === 'curtidas' && tipoKey === 'brasileiros') return 'curtidas_brasileiras';
  return tipoKey;
}
function _tipoOculto(hidden, servicoKey, tipoKey) {
  if (!TIPOS_MX.includes(tipoKey)) return true;
  const arr = (hidden && hidden[servicoKey]) || [];
  return arr.includes(_configTipoKey(servicoKey, tipoKey));
}
// Vistas de Reels (Instagram) ocultas no Gerenciamento de Tipo?
function _vistasOcultas(hidden) {
  return ((hidden && hidden.visualizacoes) || []).map(String).includes('visualizacoes_reels');
}
// Serviços de TikTok/Facebook que NÃO estão ocultos (chaves: seguidores/curtidas/visualizacoes/comentarios).
function _servicosRedeVisiveis(hidden, rede) {
  const R = REDES[rede]; if (!R) return [];
  const oc = ((hidden && hidden[rede]) || []).map((x) => String(x).toLowerCase());
  return Object.keys(R.servicos).filter((k) => !oc.includes(String(R.servicos[k].tipo).toLowerCase()));
}
// O que o bot pode oferecer agora (segue a coluna Oculto do Gerenciamento de Tipo).
async function tiposDisponiveis() {
  const hidden = await loadHiddenTypes();
  return {
    seguidores: TIPOS_MX.filter((t) => !_tipoOculto(hidden, 'seguidores', t)),
    curtidas: TIPOS_MX.filter((t) => !_tipoOculto(hidden, 'curtidas', t)),
    vistas: !_vistasOcultas(hidden),
    comentarios: !_comentariosOcultos(hidden),
    tiktok: _servicosRedeVisiveis(hidden, 'tiktok'),
    facebook: _servicosRedeVisiveis(hidden, 'facebook'),
  };
}
const _VISTAS_INDISP = { ok: false, error: 'servico_indisponivel', message: 'Las vistas no están disponibles por ahora.' };
function _comentariosOcultos(hidden) { return ((hidden && hidden.comentarios) || []).map(String).includes('comentarios'); }
const _COMENT_INDISP = { ok: false, error: 'servico_indisponivel', message: 'Los comentarios no están disponibles por ahora.' };

function tableFor(svc, tipo) {
  const t = svc.tipos ? (svc.table(normalizeTipo(tipo)) || svc.table('mistos')) : svc.table();
  // Nunca oferta pacote abaixo do mínimo da tabela oficial (a partir de 150).
  return (Array.isArray(t) ? t : []).filter((x) => Number(x.q) >= 150);
}
const _label = (p) => mxn(parsePrecoToCents(p));

function _indisponivel(key, tipoKey, hidden) {
  const disp = TIPOS_MX.filter((t) => !_tipoOculto(hidden, key, t)).map((t) => NOME_TIPO[t]);
  return { ok: false, error: 'tipo_indisponivel', tipo: tipoKey, tiposDisponiveis: disp, message: `Ese tipo no está disponible. Disponibles: ${disp.length ? disp.join(', ') : 'ninguno'}.` };
}

async function quote({ servico, tipo, quantidade, rede }) {
  const _r = normalizeRede(rede); if (_r !== 'instagram') return _quoteRede(_r, servico, quantidade, await loadHiddenTypes(), tipo);
  const key = normalizeServico(servico);
  const svc = CATALOG[key];
  if (!svc) return { ok: false, error: 'servico_invalido', message: 'Servicio inválido. Vendemos seguidores, me gusta y vistas.' };
  if (svc.tipos) {
    const tipoKey = normalizeTipo(tipo);
    const hidden = await loadHiddenTypes();
    if (_tipoOculto(hidden, key, tipoKey)) return _indisponivel(key, tipoKey, hidden);
  } else if (key === 'visualizacoes' && _vistasOcultas(await loadHiddenTypes())) return _VISTAS_INDISP;
  else if (key === 'comentarios' && _comentariosOcultos(await loadHiddenTypes())) return _COMENT_INDISP;
  const q = parseInt(quantidade, 10);
  if (svc.porUnidadeCents) {
    if (!svc.pacotes.includes(q)) return { ok: false, error: 'quantidade_indisponivel', available: svc.pacotes, message: `En comentarios solo hay paquetes de ${svc.pacotes.join(', ')}. Ofrece esos paquetes.` };
    const pc = require('./pricing.js').comentariosIgCents(q);
    return { ok: true, servico: svc.key, categoria: svc.categoria, tipo: svc.tipoFixo, tipoNombre: '', quantidade: q, priceCents: pc, priceLabel: mxn(pc), unit: svc.unit, needsPost: true, umPost: true };
  }
  const table = tableFor(svc, tipo);
  if (!(q > 0)) return { ok: false, error: 'quantidade_invalida', available: table.map((x) => x.q) };
  const item = table.find((x) => x.q === q);
  if (!item) return { ok: false, error: 'quantidade_indisponivel', available: table.map((x) => x.q), message: 'Esa cantidad no está en la tabla.' };
  const priceCents = parsePrecoToCents(item.p);
  const tipoK = svc.tipos ? normalizeTipo(tipo) : svc.tipoFixo;
  return {
    ok: true, servico: svc.key, categoria: svc.categoria,
    tipo: tipoK, tipoNombre: NOME_TIPO[tipoK] || '',
    quantidade: q, priceCents, priceLabel: mxn(priceCents),
    unit: svc.unit, needsPost: svc.needsPost,
  };
}

async function priceTable({ servico, tipo, rede }) {
  const _r = normalizeRede(rede); if (_r !== 'instagram') return _tableRede(_r, servico, await loadHiddenTypes(), tipo);
  const key = normalizeServico(servico);
  const svc = CATALOG[key];
  if (!svc) return { ok: false, error: 'servico_invalido' };
  if (svc.tipos) {
    const tipoKey = normalizeTipo(tipo);
    const hidden = await loadHiddenTypes();
    if (_tipoOculto(hidden, key, tipoKey)) return _indisponivel(key, tipoKey, hidden);
  } else if (key === 'visualizacoes' && _vistasOcultas(await loadHiddenTypes())) return _VISTAS_INDISP;
  else if (key === 'comentarios' && _comentariosOcultos(await loadHiddenTypes())) return _COMENT_INDISP;
  if (svc.porUnidadeCents) {
    return { ok: true, servico: svc.key, tipo: svc.tipoFixo, tipoNombre: '', unit: svc.unit, needsPost: true, moneda: 'MXN', itens: svc.table().map((x) => ({ quantidade: x.q, preco: _label(x.p), precoCents: parsePrecoToCents(x.p) })) };
  }
  const table = tableFor(svc, tipo);
  const tipoK = svc.tipos ? normalizeTipo(tipo) : svc.tipoFixo;
  return {
    ok: true, servico: svc.key, tipo: tipoK, tipoNombre: NOME_TIPO[tipoK] || '',
    unit: svc.unit, needsPost: svc.needsPost, moneda: 'MXN',
    itens: table.map((x) => ({ quantidade: x.q, preco: _label(x.p), precoCents: parsePrecoToCents(x.p) })),
  };
}

// Respostas/fillers que o cliente manda respondendo uma pergunta — NUNCA são o @.
const IG_USERNAME_STOPWORDS = new Set([
  'si', 'sí', 'sii', 'siii', 'simon', 'simón', 's', 'ss', 'claro', 'claroque', 'va', 'vale', 'sale', 'orale', 'órale', 'andale', 'ándale', 'dale',
  'no', 'nel', 'nop', 'nope', 'n', 'nn',
  'ok', 'okay', 'oka', 'okey', 'oki', 'listo', 'perfecto', 'bien', 'bueno', 'buena', 'chido', 'padre', 'genial', 'excelente', 'super', 'súper',
  'eso', 'esoes', 'exacto', 'exactamente', 'correcto', 'cierto', 'ajá', 'aja', 'aha', 'mhm', 'entendido', 'entiendo',
  'quiero', 'lo', 'loquiero', 'acepto', 'deacuerdo', 'deacuerdo', 'deacuerdo',
  'hola', 'ola', 'buenas', 'buenosdias', 'buenastardes', 'buenasnoches', 'gracias', 'graciass', 'mil', 'milgracias',
  'ese', 'esa', 'este', 'esta', 'aqui', 'aquí', 'ahora', 'ya', 'yasta', 'vamos', 'adelante',
  'sim', 'nao', 'não', 'obrigado',
]);
function parseIgUsername(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (m) return m[1].toLowerCase();
  const hadAt = /^@/.test(s);
  s = s.replace(/^@+/, '').replace(/\s+/g, '').replace(/\/+$/g, '');
  const low = s.toLowerCase();
  if (!hadAt && IG_USERNAME_STOPWORDS.has(low)) return '';
  return low;
}

// Valida o @ pelo MESMO endpoint interno do site (RocketAPI → scraper próprio).
async function validateProfile(usuario) {
  const username = parseIgUsername(usuario);
  if (!username) return { ok: false, error: 'usuario_invalido', message: 'Eso parece una respuesta ("sí", "ok", etc.), no el @ de Instagram del cliente. NO valides ni crees el pedido: pide de nuevo, con claridad, el @ (nombre de usuario) del perfil que va a recibir el servicio.' };
  try {
    const headers = {};
    const sec = String(process.env.INTERNAL_API_SECRET || '').trim();
    if (sec) headers['x-internal-secret'] = sec;
    const resp = await axios.post(INTERNAL_BASE + '/api/internal/ia-check-profile', { username }, { timeout: 25000, validateStatus: () => true, headers });
    const d = resp && resp.data;
    const p = (d && d.profile) ? d.profile : null;
    if (!d || d.success === false || !p) {
      try {
        const ig = await require('./instagramScraper.js').getInstagramProfile(username, { fresh: true });
        if (ig && ig.ok && ig.profile) {
          return { ok: true, username: ig.profile.username || username, fullName: ig.profile.fullName || '', followers: Number(ig.profile.followers) || 0, isPrivate: !!ig.profile.isPrivate, postsCount: Number(ig.profile.posts) || 0, fonte: 'scraper' };
        }
      } catch (_) {}
      return { ok: false, error: 'nao_encontrado', username };
    }
    return {
      ok: true, username: p.username || username,
      fullName: p.fullName || '', followers: Number(p.followersCount != null ? p.followersCount : p.followers) || 0,
      isPrivate: !!p.isPrivate, postsCount: Number(p.postsCount) || 0,
    };
  } catch (e) { return { ok: false, error: 'erro_validacao', message: (e && e.message) || 'erro' }; }
}

// Mantido só por compatibilidade (app.js ainda importa). No México não há CPF.
function generateValidCPF() {
  const rnd = (n) => Math.floor(Math.random() * n);
  const n = Array.from({ length: 9 }, () => rnd(10));
  const calc = (arr) => { let f = arr.length + 1, sum = 0; for (const d of arr) sum += d * f--; const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = calc(n); const d2 = calc([...n, d1]);
  return [...n, d1, d2].join('');
}

function _postCode(u) {
  const m = String(u || '').match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : '';
}
function _linksDoPedido(o) {
  const pega = (arr) => { const it = Array.isArray(arr) ? arr.find((x) => x && x.key === 'post_links') : null; return it ? String(it.value || '') : ''; };
  const s = pega(o && o.additionalInfoPaid) || pega(o && o.additionalInfo) || String((o && o.additionalInfoMap && o.additionalInfoMap.post_links) || '');
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}
function _juntaLinks(...listas) {
  const out = []; const vistos = new Set();
  for (const l of listas) for (const u of (l || [])) { const c = _postCode(u) || String(u); if (!vistos.has(c)) { vistos.add(c); out.push(u); } }
  return out;
}
// Link REAL de post (reel/p/tv): barra placeholder inventado e link de perfil.
function _isRealPostUrl(u) {
  const c = _postCode(u);
  if (!c) return false;
  if (/^(tu[_-]?post|post[_-]?aqui|seu[_-]?post|tu[_-]?link|link[_-]?aqui|codigo[_-]?aqui|ejemplo|exemplo|placeholder|aqui|xxx+|abcd(e|ef)?|123+|test|teste|prueba)$/i.test(c)) return false;
  if (/tu[_-]?post|post[_-]?aqui|tu[_-]?link|link[_-]?aqui|codigo[_-]?aqui|placeholder|pega[_-]?aqui|cole[_-]?aqui/i.test(String(u))) return false;
  return true;
}

function _metodo(m) { return (String(process.env.XPAG_OXXO_ENABLED || '1') !== '0' && /oxxo/i.test(String(m || ''))) ? 'OXXO' : 'SPEI'; } // OXXO religado em 17/11/2026 (XPAG_OXXO_ENABLED=0 desliga)
// Dados de pagamento que vão para o cliente (sem nada interno).
function _dadosPagamento(o) {
  const x = (o && o.xpag) || {};
  return {
    metodo: String(x.method || 'SPEI').toUpperCase(),
    clabe: String(x.clabe || ''), banco: String(x.bank_name || ''), beneficiario: String(x.beneficiary || ''),
    referencia: String(x.reference || ''), codigoBarras: String(x.barcode || ''),
    vence: x.expiresAt || null,
    payUrl: PUBLIC_BASE + '/pago?correlationID=' + encodeURIComponent(String((o && o.correlationID) || '')),
  };
}
const _codigoPago = (d) => (d.metodo === 'OXXO' ? d.referencia : d.clabe);

// Cria o pedido + cobrança Xpag chamando o MESMO endpoint do site. O webhook da Xpag
// confirma o pagamento e o despacho segue igual a um pedido do site.
async function createPixOrder({ servico, quantidade, tipo, usuario, nome, email, phone, post_links, comprar_mais, metodo }) {
  const _svcDef = CATALOG[normalizeServico(servico)];
  if (_svcDef && _svcDef.tipos && !String(tipo || '').trim()) {
    return { ok: false, error: 'tipo_obrigatorio', message: 'Antes de generar el pago, confirma el tipo: mixtos o reales.' };
  }
  const cot = await quote({ servico, tipo, quantidade });
  if (!cot.ok) return { ok: false, error: cot.error || 'cotacao_falhou', available: cot.available, message: cot.message };
  const username = parseIgUsername(usuario);
  if (!username) return { ok: false, error: 'usuario_invalido', message: 'El @ parece una respuesta ("sí", "ok", etc.), no un usuario de Instagram. NO generes el pago: pide el @ correcto del perfil.' };
  const nomeOk = String(nome || '').trim();
  if (nomeOk.length < 2) return { ok: false, error: 'falta_nombre', message: 'Falta el nombre del cliente. Pídeselo antes de generar el pago.' };
  const met = _metodo(metodo);
  const valor = cot.priceCents / 100;
  if (valor < 20) return { ok: false, error: 'monto_minimo', message: 'El pago mínimo es de $ 20 MXN. Ofrece un paquete mayor.' };
  if (met === 'OXXO' && (valor < 10 || valor > 10000)) return { ok: false, error: 'oxxo_monto', message: 'OXXO acepta pagos de $ 10 a $ 10,000 MXN. Ofrece pagar por SPEI.' };
  if (cot.needsPost) {
    const brutos = _juntaLinks(Array.isArray(post_links) ? post_links.filter(Boolean) : String(post_links || '').split(',').map((s) => s.trim()).filter(Boolean));
    const links = brutos.filter(_isRealPostUrl);
    if (!links.length) return { ok: false, error: 'faltou_post', message: 'Este servicio necesita el LINK REAL de la publicación/reel (ej.: https://www.instagram.com/p/XXXXXXXXXXX/ o /reel/...). NO inventes un link, NO uses un ejemplo y NO uses el link del perfil — pide al cliente que pegue el link de la publicación.' };
    if (cot.umPost && links.length > 1) return { ok: false, error: 'um_post_por_pedido', message: 'Los comentarios van a UNA publicación por pedido. Pregunta al cliente en cuál publicación quiere los comentarios (o haz un pedido por publicación, cada uno con su cantidad).' };
    post_links = links;
  }
  // Mesmo pedido (teléfono + servicio + tipo + cantidad + @):
  //  - YA PAGADO (7 días) → no genera otro cobro (salvo comprar_mais).
  //  - ABIERTO y vigente, mismo método → devuelve el MISMO cobro y agrega los links nuevos.
  try {
    const fim8 = String(phone || '').replace(/\D/g, '').slice(-8);
    if (fim8.length === 8) {
      const col = await getCollection('checkout_orders');
      const desde = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
      const iguais = await col.find({
        correlationID: { $regex: '^WppAgent_' }, createdAt: { $gte: desde },
        'customer.phone': { $regex: fim8 + '$' },
        additionalInfo: { $all: [
          { $elemMatch: { key: 'categoria_servico', value: cot.categoria } },
          { $elemMatch: { key: 'tipo_servico', value: cot.tipo } },
          { $elemMatch: { key: 'quantidade', value: String(cot.quantidade) } },
          { $elemMatch: { key: 'instagram_username', value: username } },
        ] },
      }, { projection: { status: 1, identifier: 1, correlationID: 1, valueCents: 1, createdAt: 1, additionalInfo: 1, additionalInfoPaid: 1, additionalInfoMap: 1, xpag: 1, paidAt: 1 } }).sort({ createdAt: -1 }).limit(10).toArray();
      const pago = iguais.find((o) => String(o.status || '').toLowerCase() === 'pago' || o.paidAt);
      if (pago && comprar_mais !== true) {
        const jaNoPedido = new Set(_linksDoPedido(pago).map(_postCode).filter(Boolean));
        const novos = (post_links || []).filter((u) => { const c = _postCode(u); return c && !jaNoPedido.has(c); });
        if (novos.length) {
          return { ok: false, error: 'links_apos_pagamento', linksNovos: novos, message: 'Este pedido (' + cot.quantidade + ' ' + cot.unit + ' para @' + username + ') YA FUE PAGADO y se envió con los links que tenía. NO generes otro pago. Dile al cliente que vas a pasar las publicaciones al equipo para repartirlas y llama a llamar_soporte con el motivo "repartir el pedido pagado en más publicaciones" y los links nuevos.' };
        }
        return { ok: false, error: 'pedido_ja_pago', message: 'Este pedido (' + cot.quantidade + ' ' + cot.unit + ' para @' + username + ') YA FUE PAGADO y está en proceso. NO generes otro pago: confirma el pago al cliente y habla de la entrega. Un reclamo o pregunta sobre la entrega NUNCA es motivo para un pago nuevo. Solo si el cliente dice claramente que quiere COMPRAR OTRO paquete, llama a generar_pago con comprar_mais=true.' };
      }
      const aberto = iguais.find((o) => {
        if (String(o.status || '').toLowerCase() === 'pago' || o.paidAt) return false;
        const x = o.xpag || {};
        if (String(x.method || 'SPEI').toUpperCase() !== met) return false;
        if (!(x.clabe || x.reference)) return false;
        if (x.open_value === true && !x.expiresAt) return true; // CLABE aberta não vence
        const vence = x.expiresAt ? new Date(x.expiresAt).getTime() : 0;
        return vence > Date.now() + 30 * 60e3; // ainda vale por mais de 30 min
      });
      if (aberto) {
        let linksFinal = _linksDoPedido(aberto);
        if (cot.needsPost && post_links && post_links.length) {
          const juntos = _juntaLinks(linksFinal, post_links);
          if (juntos.length !== linksFinal.length) {
            const troca = (arr) => {
              const a = (Array.isArray(arr) ? arr : []).filter((x) => x && x.key !== 'post_link' && x.key !== 'post_links');
              a.push({ key: 'post_link', value: juntos[0] });
              a.push({ key: 'post_links', value: juntos.join(',') });
              return a;
            };
            const set = { additionalInfo: troca(aberto.additionalInfo) };
            if (aberto.additionalInfoMap && typeof aberto.additionalInfoMap === 'object') { set['additionalInfoMap.post_link'] = juntos[0]; set['additionalInfoMap.post_links'] = juntos.join(','); }
            try { await col.updateOne({ _id: aberto._id, status: { $ne: 'pago' }, paidAt: { $exists: false } }, { $set: set }); linksFinal = juntos; } catch (_) {}
          }
        }
        const nLinks = linksFinal.length;
        const dp = _dadosPagamento(aberto);
        return {
          ok: true, reaproveitado: true, correlationID: aberto.correlationID, valorCents: cot.priceCents, valorLabel: cot.priceLabel,
          pago: dp, codigoPago: _codigoPago(dp), identifier: String(aberto.identifier || ''), linksNoPedido: nLinks,
          resumo: `${cot.quantidade} ${cot.unit}${cot.tipoNombre ? ' ' + cot.tipoNombre : ''} para @${username} — ${cot.priceLabel} (${dp.metodo})` + (cot.needsPost ? ` — ${nLinks} publicación(es) en el pedido${nLinks > 1 ? ', la cantidad se reparte igual entre ellas' : ''}` : ''),
        };
      }
    }
  } catch (_) {}
  const correlationID = 'WppAgent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  const additionalInfo = [
    { key: 'tipo_servico', value: cot.tipo },
    { key: 'categoria_servico', value: cot.categoria },
    { key: 'quantidade', value: String(cot.quantidade) },
    { key: 'pacote', value: `${cot.quantidade} ${cot.unit} - ${cot.priceLabel}` },
    { key: 'instagram_username', value: username },
    { key: 'phone', value: String(phone || '') },
    { key: 'customer_name', value: nomeOk },
    { key: 'payment_method', value: met.toLowerCase() },
    { key: 'source', value: 'wpp_agent' },
  ];
  if (cot.needsPost && post_links && post_links.length) {
    additionalInfo.push({ key: 'post_link', value: post_links[0] });
    additionalInfo.push({ key: 'post_links', value: post_links.join(',') });
  }
  // Conversa que veio de anúncio que abre o WhatsApp: grava o ctwa_clid no pedido agora, para o
  // pixel de mensagens (wppCapi.js) mandar a compra com o clique certo quando o pagamento cair.
  try {
    const clique = await require('./wppCapi.js').cliqueRecente(phone);
    if (clique && clique.ctwaClid) {
      additionalInfo.push({ key: 'ctwa_clid', value: String(clique.ctwaClid) });
      if (clique.sourceId) additionalInfo.push({ key: 'ctwa_anuncio', value: String(clique.sourceId) });
    }
  } catch (_) {}
  // Veio do botão do WhatsApp do site: grava o código, o pedido herda o clique do anúncio (metaCapi.js).
  try { const ref = await require('./metaCapi.js').refRecente(phone); if (ref && ref.code) additionalInfo.push({ key: 'wa_ref', value: String(ref.code) }); } catch (_) {}
  const body = {
    correlationID,
    total_cents: cot.priceCents,
    xpag_method: met,
    customer: { name: nomeOk, email: String(email || '').trim(), phone: String(phone || '').trim() },
    additionalInfo,
    profile_is_private: false,
    source: 'wpp_agent',
  };
  try {
    // UMA chamada só. Se falhar, a IA avisa o cliente; nunca repetimos sozinhos (evita cobrança duplicada).
    const resp = await axios.post(INTERNAL_BASE + '/api/xpag/create-charge', body, { timeout: 60000, validateStatus: () => true });
    const d = resp && resp.data;
    if (!d || resp.status < 200 || resp.status >= 300 || !d.ok) {
      return { ok: false, error: 'charge_failed', message: String((d && (d.message || d.error)) || ('HTTP ' + (resp && resp.status))).slice(0, 200) };
    }
    const col = await getCollection('checkout_orders');
    const rec = await col.findOne({ correlationID: d.correlationID || correlationID }, { projection: { xpag: 1, correlationID: 1, identifier: 1 } });
    const dp = _dadosPagamento(rec || { correlationID });
    return {
      ok: true, correlationID, valorCents: cot.priceCents, valorLabel: cot.priceLabel,
      pago: dp, codigoPago: _codigoPago(dp), identifier: String(d.identifier || (rec && rec.identifier) || ''),
      resumo: `${cot.quantidade} ${cot.unit}${cot.tipoNombre ? ' ' + cot.tipoNombre : ''} para @${username} — ${cot.priceLabel} (${dp.metodo})`,
    };
  } catch (e) { return { ok: false, error: 'charge_error', message: (e && e.message) || 'erro' }; }
}
const createPaymentOrder = createPixOrder;

// Última cobrança do bot EM ABERTO (não paga e ainda válida) deste telefone — para reenviar
// os dados quando o cliente pede de novo, sem gerar outra.
async function ultimoPagoAberto(phone) {
  try {
    const fim8 = String(phone || '').replace(/\D/g, '').slice(-8);
    if (fim8.length !== 8) return null;
    const col = await getCollection('checkout_orders');
    const desde = new Date(Date.now() - 3 * 24 * 3600e3).toISOString();
    const docs = await col.find({ correlationID: { $regex: '^WppAgent_' }, createdAt: { $gte: desde }, 'customer.phone': { $regex: fim8 + '$' } }, { projection: { status: 1, paidAt: 1, xpag: 1, correlationID: 1, valueCents: 1, expectedValueCents: 1, additionalInfo: 1 } }).sort({ createdAt: -1 }).limit(5).toArray();
    const o = docs.find((d) => !(String(d.status || '').toLowerCase() === 'pago' || d.paidAt) && d.xpag && (d.xpag.clabe || d.xpag.reference) && (!d.xpag.expiresAt || new Date(d.xpag.expiresAt).getTime() > Date.now()));
    if (!o) return null;
    const dp = _dadosPagamento(o);
    // CLABE aberta com pagamento parcial: reenvia o RESTANTE (a mesma CLABE recebe a diferença).
    const total = Number(o.expectedValueCents || o.valueCents || 0);
    const recebido = Number((o.xpag && o.xpag.recebidoCents) || 0);
    const valorCents = recebido > 0 && recebido < total ? total - recebido : total;
    return { pago: dp, codigoPago: _codigoPago(dp), valorLabel: mxn(valorCents), parcial: valorCents !== total, pacote: orderGetAny(o, 'pacote') || '' };
  } catch (_) { return null; }
}

function orderGetAny(o, key) {
  for (const m of [o.additionalInfoMapPaid, o.additionalInfoMap]) { if (m && m[key] != null && m[key] !== '') return m[key]; }
  for (const a of [o.additionalInfoPaid, o.additionalInfo]) { if (Array.isArray(a)) { const it = a.find((x) => x && x.key === key); if (it && it.value != null && it.value !== '') return it.value; } }
  return '';
}
function _digits(v) { return String(v || '').replace(/\D/g, ''); }
function _orderPaidMs(o) { for (const c of [o.paidAt, o.xpag && o.xpag.updatedAt, o.createdAt]) { const t = c ? new Date(c).getTime() : NaN; if (Number.isFinite(t)) return t; } return 0; }

// Status AO VIVO de UMA ordem no fornecedor (action=status).
const PROVIDERS = {
  fama24h: ['https://fama24h.net/api/v2', 'FAMA24H_API_KEY'],
  fornecedor_social: ['https://fornecedorsocial.com/api/v2', 'FORNECEDOR_SOCIAL_API_KEY'],
  topfama: ['https://topfama.com/api/v2', 'TOPFAMA_API_KEY'],
  justanotherpanel: ['https://justanotherpanel.com/api/v2', 'JUSTANOTHERPANEL_API_KEY'],
  revendaexclusiva: ['https://revendaexclusiva.com/api/v2', 'REVENDAEXCLUSIVA_API_KEY'],
  worldofsmm: ['https://worldofsmm.com/api/v2', 'WORLDOFSMM_API_KEY'],
  nuvra: ['https://nuvrasmm.com/api/v2', 'NUVRASMM_API_KEY'],
  smmhustle: ['https://smmhustle.com/api/v2', 'SMMHUSTLE_API_KEY'],
};
function _normProv(p, slot) {
  const s = String(p || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (s === 'jap') return 'justanotherpanel';
  if (s === 'revenda') return 'revendaexclusiva';
  if (s === 'nuvrasmm') return 'nuvra';
  if (s === 'fornecedorsocial') return 'fornecedor_social';
  if (s) return s;
  return slot;
}
async function fetchProviderOrderStatus(provider, orderId) {
  const cfg = PROVIDERS[provider];
  const key = cfg && process.env[cfg[1]];
  if (!cfg || !key || !orderId) return null;
  try {
    const payload = new URLSearchParams({ key: String(key), action: 'status', order: String(orderId) });
    const resp = await axios.post(cfg[0], payload.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true });
    const d = (resp && resp.data && typeof resp.data === 'object') ? resp.data : {};
    const num = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };
    const status = String(d.status || d.Status || '').trim();
    if (!status && (d.error || d.Error)) return { error: String(d.error || d.Error) };
    return { status, remains: num(d.remains ?? d.Remains), startCount: num(d.start_count ?? d.startCount) };
  } catch (_) { return null; }
}

function temEnvioNoFornecedor(o) {
  const temId = (v) => v != null && /^[0-9]+$/.test(String(v));
  for (const [k, v] of Object.entries(o || {})) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    if (/^(paghiper|woovi|pagarme|xpag|nowpayments|customer|costs|utms|geolocation|emails|notaFiscal|profilePrivacy|fulfillmentCalc|additionalInfoMap(Paid)?|upsell)$/.test(k)) continue;
    if (temId(v.orderId) || temId(v.id)) return true;
    if (Array.isArray(v.orders) && v.orders.some((x) => x && (temId(x.orderId) || temId(x.id)))) return true;
  }
  return false;
}

async function alertaPedidosSemEnvio(col, orders, telefone) {
  const agora = Date.now();
  for (const x of (orders || []).slice(0, 10)) {
    const pagoMs = _orderPaidMs(x);
    if (!pagoMs || agora - pagoMs < 15 * 60e3 || agora - pagoMs > 15 * 24 * 3600e3) continue;
    if (String(x.status || '').toLowerCase() === 'estornado') continue;
    if (x.upsell && x.upsell.isUpsell === true && /waiting/.test(String(x.upsell.dispatchStatus || ''))) continue;
    if (temEnvioNoFornecedor(x)) continue;
    const ultimo = x.alertaSemEnvio && x.alertaSemEnvio.at ? new Date(x.alertaSemEnvio.at).getTime() : 0;
    if (ultimo && agora - ultimo < 6 * 3600e3) continue;
    const erro = (() => { for (const v of Object.values(x)) { if (v && typeof v === 'object' && v.error) return typeof v.error === 'string' ? v.error : JSON.stringify(v.error); } return 'sem pedido no fornecedor'; })();
    const qtd = orderGetAny(x, 'quantidade') || x.quantidade || x.qtd || '';
    const cat = orderGetAny(x, 'categoria_servico') || '';
    const user = x.instagramUsername || x.instauser || orderGetAny(x, 'instagram_username') || '';
    try {
      await col.updateOne({ _id: x._id }, { $set: { alertaSemEnvio: { at: new Date().toISOString(), erro: String(erro).slice(0, 200), origem: 'consultar_pedido' } } });
      await sendNtfy({
        title: 'Pago sem envio: ' + (x.identifier || x._id),
        message: `@${user} ${qtd} ${cat} ${mxn(Number(x.valueCents) || 0)} — ${String(erro).slice(0, 80)}. Cliente perguntou no WhatsApp (+${_digits(telefone)}).`,
        priority: 'high', tags: 'warning', click: PUBLIC_BASE + '/painel',
      });
    } catch (_) {}
  }
}

// Ordem-BASE no fornecedor (single ou multi), respeitando o provider gravado no slot.
function baseProviderOrder(o) {
  const singles = [['fornecedor_social', o.fornecedor_social], ['fama24h', o.fama24h], ['topfama', o.topfama], ['nuvra', o.nuvra]];
  for (const [slot, sub] of singles) { if (sub && sub.orderId && /^[0-9]+$/.test(String(sub.orderId))) return { provider: _normProv(sub.provider, slot), orderId: String(sub.orderId) }; }
  const multis = [['fornecedor_social', o.fornecedor_social_multi], ['fama24h', o.fama24h_multi]];
  for (const [slot, m] of multis) { if (m && Array.isArray(m.orders)) { const it = m.orders.find((x) => x && (x.orderId || x.id) && /^[0-9]+$/.test(String(x.orderId || x.id))); if (it) return { provider: _normProv(it.provider || m.provider, slot), orderId: String(it.orderId || it.id) }; } }
  return null;
}

// Consulta o pedido do cliente por TELEFONE (o número que escreveu) ou por @.
async function consultarPedido({ telefone, usuario } = {}) {
  const col = await getCollection('checkout_orders');
  const paidOr = [{ status: 'pago' }, { paidAt: { $exists: true, $nin: [null, ''] } }];
  const uname = parseIgUsername(usuario);
  const last8 = _digits(telefone).slice(-8);
  let match = null;
  if (uname) {
    const esc = uname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('^@?' + esc + '$', 'i');
    match = { $or: [{ instagramUsername: rx }, { instauser: rx }, { 'additionalInfoMap.instagram_username': rx }, { 'additionalInfoMapPaid.instagram_username': rx }] };
  } else if (last8.length >= 8) {
    const rx = new RegExp(last8 + '$');
    match = { $or: [{ 'customer.phone': { $regex: rx } }, { 'customer.phone_number': { $regex: rx } }, { telefone: { $regex: rx } }, { 'additionalInfoMap.phone': { $regex: rx } }, { additionalInfo: { $elemMatch: { key: 'phone', value: { $regex: rx } } } }, { additionalInfoPaid: { $elemMatch: { key: 'phone', value: { $regex: rx } } } }] };
  } else {
    return { ok: true, encontrado: false, motivo: 'sem_identificador' };
  }
  let orders = [];
  try { orders = await col.find({ $and: [{ $or: paidOr }, match] }).limit(20).toArray(); } catch (_) { orders = []; }
  if (!orders.length) return { ok: true, encontrado: false, buscaPor: uname ? 'usuario' : 'telefone' };
  orders.sort((a, b) => _orderPaidMs(b) - _orderPaidMs(a));
  const o = orders[0];
  try { await alertaPedidosSemEnvio(col, orders, telefone); } catch (_) {}

  const categoria = String(orderGetAny(o, 'categoria_servico') || '').toLowerCase().trim();
  const tipo = String(orderGetAny(o, 'tipo_servico') || o.tipoServico || o.tipo || '').toLowerCase().trim();
  const quantidadeBase = Number(orderGetAny(o, 'quantidade') || o.quantidade || o.qtd || 0) || 0;
  const qtdDespachada = (function () {
    for (const p of [o.fornecedor_social, o.fama24h, o.nuvra, o.topfama]) { const q = Number(p && p.requestPayload && p.requestPayload.quantity); if (q > 0) return q; }
    return 0;
  })();
  const quantidade = Number((o.fulfillmentCalc && o.fulfillmentCalc.finalQty) || qtdDespachada || quantidadeBase) || quantidadeBase;
  const usernameOrder = String(o.instagramUsername || o.instauser || orderGetAny(o, 'instagram_username') || uname || '').replace(/^@+/, '');
  const paidMs = _orderPaidMs(o);
  const horasDesdePagamento = paidMs ? Math.round((Date.now() - paidMs) / 3600000) : null;
  const ehReales = /organic|orgânic|real|reais/.test(tipo);

  let provStatusRaw = '';
  let remains = null, entregues = null;
  const bp = baseProviderOrder(o);
  if (bp) {
    const live = await fetchProviderOrderStatus(bp.provider, bp.orderId);
    if (live && !live.error && live.status) {
      provStatusRaw = live.status;
      if (live.remains != null) { remains = Math.max(0, Math.round(live.remains)); if (quantidade > 0) entregues = Math.max(0, quantidade - remains); }
    }
  }
  if (!provStatusRaw) {
    const cands = [o.fornecedor_social, o.fama24h, o.topfama, o.nuvra, o.fornecedor_social_multi, o.fama24h_multi];
    for (const p of cands) { if (p && (p.status || p.orderId || (Array.isArray(p.orders) && p.orders.length))) { provStatusRaw = String(p.status || 'processando'); break; } }
    if (!provStatusRaw) provStatusRaw = 'desconhecido';
  }
  const statusMap = { completed: 'concluido', concluido: 'concluido', complete: 'concluido', created: 'processando', pending: 'processando', processing: 'processando', in_progress: 'processando', 'in progress': 'processando', partial: 'parcial', canceled: 'cancelado', cancelled: 'cancelado', refunded: 'reembolsado', error: 'erro' };
  const statusFornecedor = statusMap[String(provStatusRaw).toLowerCase().trim()] || String(provStatusRaw);

  let perfilPrivado = null;
  try { const vp = await validateProfile(usernameOrder); if (vp.ok) perfilPrivado = !!vp.isPrivate; } catch (_) {}
  if (perfilPrivado === true) {
    try { const ig = await require('./instagramScraper.js').getInstagramProfile(usernameOrder, { fresh: true }); if (ig && ig.ok && ig.profile && ig.profile.isPrivate === false) perfilPrivado = false; } catch (_) {}
  }

  // Para o cliente só existem "en proceso" e "completado".
  const entregouTudo = remains != null && remains === 0 && statusFornecedor !== 'cancelado' && statusFornecedor !== 'reembolsado';
  const statusCliente = (statusFornecedor === 'concluido' || entregouTudo) ? 'completado' : 'en proceso';

  // Link de REPOSIÇÃO — não vai para os reales (fluxo é verificar + informar estabilidade).
  const refilId = String(o.refilLinkId || (orders.find((x) => x && x.refilLinkId) || {}).refilLinkId || '').trim();
  const refilLink = (!ehReales && refilId) ? (PUBLIC_BASE + '/reposicion?token=' + encodeURIComponent(refilId)) : null;

  const temDespacho = !!bp || [o.fornecedor_social, o.fama24h, o.nuvra, o.topfama, o.fornecedor_social_multi, o.fama24h_multi]
    .some((p) => p && (p.orderId || (Array.isArray(p.orders) && p.orders.some((x) => x && x.orderId))));
  const statusRuim = ['cancelado', 'reembolsado', 'erro'].includes(statusFornecedor);
  const pagoSemEnvio = !temDespacho && (horasDesdePagamento == null || horasDesdePagamento >= 1);
  const travado = !entregouTudo && horasDesdePagamento != null && horasDesdePagamento > 48 && (entregues === 0 || entregues == null) && !statusRuim;
  const precisaSuporte = statusRuim || pagoSemEnvio || travado;

  return {
    ok: true, encontrado: true, usuario: usernameOrder,
    servico: categoria || 'seguidores', tipo: NOME_TIPO[tipo] || tipo || '(no informado)', quantidade,
    horasDesdePagamento, dentroPrazo48h: horasDesdePagamento != null ? (horasDesdePagamento <= 48) : null,
    ehReales, ehBrasileirosReais: ehReales, perfilPrivado, status: statusCliente, precisaSuporte, refilLink,
  };
}

// Notificação push via ntfy (mesmo tópico da equipe; título marcado com "YA").
async function sendNtfy({ title, message, priority, tags, click } = {}) {
  try {
    const explicit = String(process.env.NTFY_URL || '').trim();
    const server = String(process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
    const topic = String(process.env.NTFY_TOPIC || '').trim();
    const url = explicit || (topic ? (server + '/' + topic) : '');
    if (!url) return { ok: false, error: 'ntfy_nao_configurado' };
    const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
    if (title) headers['Title'] = 'YA ' + String(title).normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (priority) headers['Priority'] = String(priority);
    if (tags) headers['Tags'] = Array.isArray(tags) ? tags.join(',') : String(tags);
    if (click) headers['Click'] = String(click);
    const token = String(process.env.NTFY_TOKEN || '').trim();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await axios.post(url, String(message || ''), { headers, timeout: 12000, validateStatus: () => true });
    return { ok: resp.status >= 200 && resp.status < 300, status: resp.status };
  } catch (e) { return { ok: false, error: (e && e.message) || 'erro' }; }
}

// Aciona o suporte humano: pausa a IA nessa conversa + flag no CRM + push no ntfy.
async function flagSupport(phone, motivo) {
  try {
    const col = await getCollection('whatsapp_contacts');
    await col.updateOne(
      { _id: String(phone) },
      { $set: { flag: 'suporte', botPaused: true, supportReason: String(motivo || '').slice(0, 300), supportAt: new Date().toISOString() } },
      { upsert: true }
    );
    try {
      const resumo = String(motivo || '').replace(/\s+/g, ' ').trim().slice(0, 140) || 'pediu atendimento humano';
      await sendNtfy({ title: '+' + _digits(phone) + ' - suporte humanizado', message: resumo, priority: 'high', tags: 'rotating_light', click: PUBLIC_BASE + '/painel/ia-crm' });
    } catch (_) {}
    return { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'erro' }; }
}

module.exports = {
  CATALOG, normalizeServico, normalizeTipo, parseIgUsername, NOME_TIPO,
  quote, priceTable, validateProfile, createPixOrder, createPaymentOrder, ultimoPagoAberto, generateValidCPF, flagSupport, consultarPedido, brl, mxn, sendNtfy,
  loadHiddenTypes, tiposDisponiveis,
  REDES, normalizeRede, validateRedeProfile, createRedeOrder,
};
