// whatsappAgent.js — You Agency (México): cérebro da IA de vendas (OpenAI function-calling).
// Porte do bot da Oppus: mesmas travas (preço só da tabela, @ validado, sem pagamento
// duplicado, suporte humano), em espanhol, preços em MXN e cobrança Xpag (SPEI / OXXO).
'use strict';

const { getCollection } = require('./mongodbClient');
const sales = require('./whatsappSales.js');
const openaiCredito = require('./openaiCredito.js');
let axios = require('axios'); if (axios && axios.default) axios = axios.default;

const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const MAX_TURNS = 20;
const MAX_TOOL_ROUNDS = 5;
const REPLY_DELAY_MS = Math.max(0, Number(process.env.WHATSAPP_IA_REPLY_DELAY_MS || 1500) || 0);
const MSG_GAP_MS = Math.max(0, Number(process.env.WHATSAPP_IA_MSG_GAP_MS || 2000) || 0);
const PUBLIC_BASE = String(process.env.PUBLIC_BASE_URL || 'https://youagency.site').replace(/\/+$/, '');
const FALLBACK_FALHA = 'Perdón, no alcancé a leer tu último mensaje, ¿me lo repites, por favor?';

function isEnabled() { return !!String(process.env.OPENAI_API_KEY || '').trim(); }

function sanitizeForWhatsapp(t) {
  let s = String(t || '');
  s = s.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => {
    const lab = String(label || '').trim();
    return (!lab || lab === url || /^https?:\/\//i.test(lab)) ? url : (lab + ': ' + url);
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  // Tabela markdown não existe no WhatsApp (aparece cheia de "|"): separador e cabeçalho saem, linha vira "- 150: $ 145 MXN".
  s = s.split('\n').filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => {
    if (!/^\s*\|.*\|\s*$/.test(l)) return l;
    const cel = l.split('|').map((x) => x.trim()).filter(Boolean);
    if (cel.length >= 2 && !/\d/.test(cel.join(''))) return null;
    return cel.length >= 2 ? ('- ' + cel[0] + ': ' + cel.slice(1).join(' ')) : cel.join(' ');
  }).filter((l) => l !== null).join('\n');
  // Títulos markdown (###) não existem no WhatsApp: viram texto normal.
  s = s.replace(/^[ \t]*#{1,6}[ \t]*/gm, '');
  // "**Seguidores *mixtos**" e afins: asteriscos repetidos viram um só; linha com asterisco ímpar perde a formatação.
  s = s.replace(/\*{2,}/g, '*');
  s = s.split('\n').map((l) => ((l.match(/\*/g) || []).length % 2 ? l.replace(/\*/g, '') : l)).join('\n');
  return s;
}

// Tira do texto do modelo a CLABE/referência e o link de pago: eles vão SEMPRE em
// mensagens separadas (senão o cliente recebe tudo duplicado).
function stripPagoFromText(text, code) {
  let t = String(text || '');
  const c = String(code || '').trim();
  if (c) t = t.split(c).join(' ');
  t = t.replace(/https?:\/\/\S*\/pago\?correlationID=\S+/gi, '');
  t = t.split('\n').filter((ln) => {
    if (/\b\d{18}\b/.test(ln)) return false; // CLABE solta
    if (/^\s*[-*•]*\s*\*?\s*(clabe|referencia|n[uú]mero de referencia|banco|beneficiario|link de pago)\s*:?\s*\*?\s*$/i.test(ln)) return false;
    return true;
  }).join('\n');
  t = t.replace(/```/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

// ── Travas de conteúdo ────────────────────────────────────────────────────────
const { tabelaSeguidores, tabelaCurtidas, tabelaVisualizacoes, parsePrecoToCents } = require('./pricing.js');
const fmtMx = (cents) => '$ ' + (Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function _catDe(unidade) {
  const u = String(unidade || '').toLowerCase();
  if (/seguidor/.test(u)) return 'seguidores';
  if (/gusta|like/.test(u)) return 'curtidas';
  return 'visualizacoes';
}
function _tabelasDe(cat) {
  if (cat === 'seguidores') return { mistos: tabelaSeguidores.mistos, organicos: tabelaSeguidores.organicos, brasileiros: tabelaSeguidores.brasileiros };
  if (cat === 'curtidas') return { mistos: tabelaCurtidas.mistos, organicos: tabelaCurtidas.organicos };
  return { visualizacoes_reels: tabelaVisualizacoes.visualizacoes_reels };
}
// Tabelas de TikTok/Facebook da mesma categoria (o bot também cota essas redes).
function _tabelasRedesDe(cat) {
  let tr = {}; try { tr = require('./pricing.js').tabelaRedes || {}; } catch (_) {}
  const chave = cat === 'seguidores' ? /_seguidores/ : cat === 'curtidas' ? /_curtidas/ : /_visualizacoes/;
  return Object.keys(tr).filter((k) => chave.test(k)).map((k) => tr[k]);
}
const _qtdNum = (s) => Number(String(s).replace(/[.,\s]/g, ''));
const _centsDe = (s) => Math.round(parseFloat(String(s).replace(/,/g, '')) * 100);
// Toda menção "N <serviço> ... $ X" é conferida contra a tabela oficial do tipo citado.
function acharPrecosErrados(texto) {
  const erros = [];
  const txt = String(texto || '');
  const confere = (qtd, cents, cat, trechoTipo, trecho, preco) => {
    if (!(qtd > 0) || !(cents > 0)) return;
    const chave = /reales|real\b|org[áa]nic/i.test(trechoTipo) ? 'organicos' : (/mixt|mist|mundial|internac|varios pa/i.test(trechoTipo) ? 'mistos' : (/latin/i.test(trechoTipo) ? 'brasileiros' : null));
    const tabelas = _tabelasDe(cat);
    const usar = (chave && tabelas[chave]) ? [tabelas[chave]] : Object.values(tabelas);
    const validos = new Set();
    for (const tab of usar.concat(_tabelasRedesDe(cat))) for (const it of (tab || [])) if (Number(it.q) === qtd) validos.add(parsePrecoToCents(it.p));
    if (!validos.has(cents)) erros.push({ cat, qtd, preco, trecho: String(trecho).slice(0, 80) });
  };
  // "100 *seguidores mixtos*, el precio es de $ 87" (o negrito pode ficar entre o número e o serviço)
  const re = /(\d{1,3}(?:[.,\s]\d{3})+|\d+)[\s*_]*(seguidor(?:es)?|me\s+gusta|likes?|visualizaci[oó]n(?:es)?|vistas|views)\b((?:(?!\d{2,}[\s*_]*(?:seguidor|me\s+gusta|like|visualiza|vistas|views)|total|suma|en\s+total)[^\n]){0,45}?)\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)/gi;
  let m;
  while ((m = re.exec(txt))) confere(_qtdNum(m[1]), _centsDe(m[4]), _catDe(m[2]), String(m[3] || ''), m[0], m[4]);
  // Ordem invertida: "con $ 39.00 MXN obtienes 50 *seguidores mixtos*"
  const re2 = /\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)\s*(?:MXN)?[*_]*([^\n$.?!]{0,25}?)\b(\d{1,3}(?:,\d{3})+|\d+)[\s*_]*(seguidor(?:es)?|me\s+gusta|likes?|visualizaci[oó]n(?:es)?|vistas|views)\b([^\n$.]{0,20})/gi;
  while ((m = re2.exec(txt))) {
    if (!/(obtienes|recibes|son|te\s+(dan|llegan)|alcanza|incluye|equivale|por\s+eso)/i.test(String(m[2] || ''))) continue; // só "preço → quantidade" explícito
    confere(_qtdNum(m[3]), _centsDe(m[1]), _catDe(m[4]), String(m[5] || ''), m[0], m[1]);
  }
  // Linha sem o nome do serviço ("150 por $ 39", "- 300: $ 61"): o serviço e o tipo vêm do que foi citado antes.
  const re3 = /(?:^|[\s(*-])(\d{1,3}(?:,\d{3})+|\d{2,6})\s*(?:por|:|=|–|—|-)\s*\*?\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)/gi;
  while ((m = re3.exec(txt))) {
    const antes = txt.slice(Math.max(0, m.index - 400), m.index);
    const svs = [...antes.matchAll(/seguidor|me\s+gusta|likes?|vistas|visualizaci|views|coment/gi)];
    if (!svs.length) continue;
    const ult = svs[svs.length - 1][0].toLowerCase();
    if (/coment/.test(ult)) continue;
    const tipos = [...antes.matchAll(/mixt|reales|org[áa]nic|latin/gi)];
    confere(_qtdNum(m[1]), _centsDe(m[2]), _catDe(ult), tipos.length ? tipos[tipos.length - 1][0] : '', m[0], m[2]);
  }
  return erros;
}
function tabelaOficialTexto(cat) {
  const nomes = cat === 'curtidas'
    ? { mistos: '*Me gusta mixtos*', organicos: '*Me gusta reales*' }
    : cat === 'seguidores' ? { mistos: '*Seguidores mixtos*', brasileiros: '*Seguidores latinos*', organicos: '*Seguidores reales*' } : { visualizacoes_reels: '*Vistas de Reels*' };
  const partes = [];
  for (const [tipo, tab] of Object.entries(_tabelasDe(cat))) {
    if (!nomes[tipo]) continue;
    const itens = (tab || []).filter((x) => Number(x.q) >= 100).map((x) => '- ' + Number(x.q).toLocaleString('en-US') + ': ' + fmtMx(parsePrecoToCents(x.p)) + ' MXN');
    if (itens.length) partes.push(nomes[tipo] + '\n' + itens.join('\n'));
  }
  return partes.join('\n\n');
}
function _frases(linha) { return String(linha).split(/(?<=[.!?])\s+/); }
// "Caída de 5-6%" é SÓ dos reales.
function corrigirTaxaQueda(texto) {
  return String(texto || '').split('\n').map((linha) => _frases(linha).filter((f) => !(/5\s*(?:-|–|a|al)\s*6\s*%/.test(f) && !/reales|org[áa]nic/i.test(f))).join(' ')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Link de reposição só quando o assunto é caída/reposição.
function tirarLinkReposicao(texto) {
  return String(texto || '').split('\n').map((linha) => /reposicion\?token=/i.test(linha) ? _frases(linha).filter((f) => !/reposicion\?token=/i.test(f)).join(' ') : linha).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const mxnLabel = (cents) => fmtMx(cents) + ' MXN';
// Turno que terminou sem resposta DE PROPÓSITO (ex.: "ya pagué" repetido): o vigia de silêncio não refaz.
async function _marcaSilencio(phone) {
  try { const c = await getCollection('whatsapp_agent_chats'); await c.updateOne({ _id: String(phone) }, { $set: { silencioAt: new Date() } }, { upsert: true }); } catch (_) {}
}

// ── Histórico por telefone ──
const memHist = new Map();
async function loadHistory(phone) {
  try { const c = await getCollection('whatsapp_agent_chats'); const d = await c.findOne({ _id: String(phone) }); if (d && Array.isArray(d.messages)) return d.messages; } catch (_) {}
  return memHist.get(String(phone)) || [];
}
async function saveHistory(phone, messages) {
  const trimmed = messages.slice(-MAX_TURNS);
  memHist.set(String(phone), trimmed);
  try { const c = await getCollection('whatsapp_agent_chats'); await c.updateOne({ _id: String(phone) }, { $set: { messages: trimmed, updatedAt: new Date().toISOString() } }, { upsert: true }); } catch (_) {}
}
async function clearHistory(phone) {
  memHist.delete(String(phone));
  try { const c = await getCollection('whatsapp_agent_chats'); await c.deleteOne({ _id: String(phone) }); } catch (_) {}
}

function systemPrompt(dispTipos) {
  const _nomeT = { mistos: 'mixtos', organicos: 'reales', brasileiros: 'latinos' };
  const _d = dispTipos || { seguidores: ['mistos', 'organicos'], curtidas: ['mistos', 'organicos'] };
  const _seg = (_d.seguidores || []).map((t) => (t === 'organicos' ? 'alta calidad' : (_nomeT[t] || t))).join(' y ') || 'ningún tipo';
  const _cur = (_d.curtidas || []).map((t) => _nomeT[t] || t).join(' y ') || 'ningún tipo';
  // Serviços ocultos no Gerenciamento de Tipo (coluna Oculto) nem entram no prompt: o bot não oferece.
  const _vistas = _d.vistas !== false;
  const _NOME_SV = { seguidores: 'seguidores', curtidas: 'me gusta', curtidas_reais: 'me gusta reales', visualizacoes: 'vistas', comentarios: 'comentarios' };
  const _coment = _d.comentarios !== false;
  const _lista = (arr) => { const n = (arr || []).map((k) => _NOME_SV[k] || k); return n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : (n[0] || ''); };
  const _tt = Array.isArray(_d.tiktok) ? _d.tiktok : ['seguidores', 'curtidas', 'curtidas_reais', 'visualizacoes', 'comentarios'];
  const _ttReais = _tt.includes('curtidas_reais');
  const _fb = Array.isArray(_d.facebook) ? _d.facebook : ['seguidores', 'curtidas', 'visualizacoes', 'comentarios'];
  const _igSv = [_d.seguidores && _d.seguidores.length ? 'SEGUIDORES' : '', _d.curtidas && _d.curtidas.length ? 'ME GUSTA (likes)' : '', _vistas ? 'VISTAS de Reels' : '', _coment ? 'COMENTARIOS' : ''].filter(Boolean);
  const _ttPost = _tt.filter((k) => k !== 'seguidores');
  const _fbPost = _fb.filter((k) => k !== 'seguidores');
  const _linhaTT = _tt.length
    ? `- TIKTOK: ${_lista(_tt)}. Todo es tipo *mixtos*${_ttReais ? ', excepto *me gusta reales* (perfiles reales; pasa servico="curtidas" y tipo="organicos" en TODAS las herramientas)' : ''}.` + (_tt.includes('seguidores') ? ' Seguidores van al @ de TikTok.' : '') + (_ttPost.length ? ` ${_lista(_ttPost).replace(/^./, (c) => c.toUpperCase())} necesitan el LINK del video (tiktok.com/@usuario/video/...).` : '')
    : '- TIKTOK: por ahora NO tenemos ningún servicio de TikTok disponible. Si lo piden, dilo con amabilidad y ofrece Instagram.';
  const _linhaFB = _fb.length
    ? `- FACEBOOK: ${_lista(_fb)} (solo *mixtos*).` + (_fb.includes('seguidores') ? ' Seguidores: servico="seguidores", sirven para perfil o página/fanpage.' : '') + ' Pide el LINK del perfil o página de Facebook (no un @)' + (_fbPost.length ? `; ${_lista(_fbPost)} necesitan además el LINK de la publicación o video.` : '.')
    : '- FACEBOOK: por ahora NO tenemos ningún servicio de Facebook disponible. Si lo piden, dilo con amabilidad y ofrece Instagram.';
  const _semReales = !(_d.seguidores || []).includes('organicos');
  return [
    ...(_semReales ? ['SEGUIDORES REALES NO DISPONIBLES AHORA (REGLA MÁXIMA): en seguidores de Instagram solo vendemos *mixtos*. NO ofrezcas, NO menciones como opción y NO des precio de *seguidores reales* ni latinos, aunque otras reglas de este prompt hablen de ellos (esas reglas valen solo para atender a quien YA compró reales). Si el cliente pide reales, di con amabilidad que por ahora no los tenemos disponibles y ofrece los *mixtos*. (Los *me gusta reales* siguen según la DISPONIBILIDAD.)'] : []),
    'SEGUIDORES DE INSTAGRAM — QUÉ OFRECER (REGLA DE VENTA): ofrece y vende SIEMPRE los *seguidores mixtos* (perfiles de México); no menciones otro tipo por tu cuenta. Los seguidores tipo organicos se llaman ante el cliente *seguidores de alta calidad* (perfiles latinos reales y activos, los más estables, entrega gradual de hasta 48 h); NUNCA los llames "reales" ni "orgánicos". SOLO si el cliente pregunta por seguidores reales, de verdad, activos, que interactúen, latinos o de mejor calidad, ofrécele los *seguidores de alta calidad* con su tabla (tabla_precios tipo=organicos). En todas las reglas de abajo, cuando se habla de *reales* en SEGUIDORES, es este tipo: al cliente dile *alta calidad*. (Los *me gusta reales* siguen con ese nombre.)',
    'ANTES DE RESPONDER (SIEMPRE, en este orden): 1) lee las notas del sistema de este turno — sobre todo "ESTADO REAL DEL CLIENTE" (pedidos pagados y pago pendiente, consultados ahora en el sistema): son la verdad; nunca digas que no encuentras un pedido que aparece ahí ni pidas @ o teléfono para buscarlo; 2) contesta PRIMERO lo que el cliente preguntó, en 1-2 frases; 3) después pide SOLO el siguiente dato que falta; 4) no repitas un mensaje ni una tabla que ya mandaste; 5) nunca escribas textos de ejemplo o marcadores como "[código]", "1234567890" o "XXXX".',
    `DISPONIBILIDAD ACTUAL (REGLA POR ENCIMA DE TODO): en SEGUIDORES solo trabajamos con ${_seg}; en ME GUSTA solo con ${_cur}. NUNCA ofrezcas, muestres tabla ni cotices un tipo que NO esté en esa lista (por ejemplo "mexicanos" o "brasileños" como tipo aparte: no existen). Si el cliente pide un tipo que no hay, dile con amabilidad que por ahora solo tenemos esos tipos y ofrécelos. ${_vistas ? 'Las VISTAS de Reels siguen normales.' : 'Las VISTAS de Reels NO están disponibles por ahora: no las ofrezcas ni cotices.'} Cualquier servicio que NO aparezca en este prompt no existe para ti: NUNCA lo menciones ni lo ofrezcas; si el cliente lo pide, di que por ahora no está disponible y ofrece lo que sí hay.`,
    'Eres un asesor de ventas de Instagram (y, si el cliente lo pide, de TikTok y Facebook) por el WhatsApp de *You Agency*, una agencia que atiende a clientes de México. Escribe SIEMPRE en español de México, natural y cercano (tutea al cliente). Cierra la venta AQUÍ, por la conversación — nunca mandes al cliente al sitio a comprar.',
    'PRIMER MENSAJE GENÉRICO (CRÍTICO PARA VENDER) — "¿Podría obtener más información al respecto?", "info", "precios", "cuánto cuesta", "Quiero comprar" sin decir el servicio: NO preguntes qué servicio quiere ni "¿te gustaría saber más?". Asume *seguidores de Instagram* (lo que más se vende): llama tabla_precios de seguidores de cada tipo disponible y, en ESE MISMO mensaje, manda los paquetes más pedidos de cada tipo (cada lista con su título), una línea "Tenemos más cantidades, desde 100 hasta 20,000" y una línea "También tenemos me gusta, vistas de Reels y comentarios". Cierra con UNA pregunta: "¿Cuántos quieres? Mándame también tu @ de Instagram y te dejo el pedido listo." Si el cliente ya dijo el servicio o la red (ej.: "seguidores para TikTok", "Facebook"), muestra directo los precios de eso. OJO: asumir Instagram vale SOLO para ese primer mensaje genérico — si después el cliente pide TikTok o Facebook, SÍ los tenemos (líneas TIKTOK y FACEBOOK): llama tabla_precios con esa rede y manda esos precios; nunca digas que solo hay Instagram.',
    'TABLAS CORTAS: al mostrar precios manda como máximo 5 cantidades por tipo — las más pedidas: 250 (o 300), 500, 1,000, 2,000 y 5,000 (las que existan en la tabla de ese tipo) — y avisa en una línea que hay más cantidades. Manda la tabla completa SOLO si el cliente pide otra cantidad, "todas" o una cantidad que no mostraste. Nunca vuelvas a mandar una tabla que ya mandaste en esta conversación; si pregunta otra vez, contesta solo el precio que pidió.',
    'NO PREGUNTES DE MÁS: nunca cierres con "¿te gustaría saber más?", "¿quieres que te muestre los precios?" o "¿te gustaría elegir alguno de estos tipos?". Si ya sabes el servicio, muestra los precios de una vez. Cada mensaje tuyo tiene que avanzar al siguiente dato que falta (cantidad → @ → pago por SPEI) y pedir SOLO ese dato. Con cantidad y @ confirmados, NO preguntes el método: llama generar_pago con metodo=SPEI (OXXO solo si el cliente lo pidió). Si el cliente ya mandó su @ junto con otra cosa, valídalo en el mismo turno.',
    'DUDAS DESPUÉS DEL PAGO GENERADO ("¿no es estafa?", "¿cómo sé que sí llega?", "¿muestras?"): responde en 1-2 frases con los hechos de CONFIANZA y recuerda que su referencia/CLABE ya está arriba en el chat. NUNCA sugieras un paquete más pequeño ni otro pedido cuando el pago ya está generado.',
    'SEGUIDORES REALES = LATINOS (dilo SIEMPRE, sin esperar que pregunten): cada vez que presentes, describas o pongas el título de la tabla de los *seguidores reales*, di que son perfiles *latinos* (de Latinoamérica), reales y activos. Título de la tabla: *Seguidores de alta calidad*. Ej.: "*Seguidores de alta calidad*: perfiles latinos, reales y activos, los más estables". Los *seguidores mixtos* de Instagram son perfiles de *México*. Esto vale para SEGUIDORES de Instagram (no para me gusta ni para TikTok/Facebook).',
    'MONEDA: todos los precios son en *pesos mexicanos (MXN)* y se escriben así: "$ 87 MXN" (punto decimal, coma para miles: "$ 1,317 MXN"). Nunca uses reales, R$, dólares ni otra moneda.',
    `Servicios que vendes: ${_igSv.length ? _igSv.join(', ') : 'ninguno por ahora'}. Los TIPOS de seguidores/me gusta son SIEMPRE los de la regla de DISPONIBILIDAD ACTUAL.`,
    ...(_coment ? ['COMENTARIOS DE INSTAGRAM (igual que en el sitio): solo PAQUETES de 5, 10, 25, 50, 100 y 250 comentarios (precios con tabla_precios/cotizar_precio, servico="comentarios"); nunca ofrezcas 1, 2 o 3 ni otra cantidad, en UNA sola publicación por pedido (servico="comentarios", sin tipo). Son comentarios positivos de perfiles de alta calidad. Flujo: cantidad → cotizar_precio → @ validado → link de la publicación (uno solo) → método → generar_pago con post_links=[ese link]. Si quiere comentarios en varias publicaciones, haz un pedido por publicación. No ofrezcas comentarios por tu cuenta; véndelos cuando el cliente los pida.'] : []),
    'INSTAGRAM PRIMERO (REGLA DE ENFOQUE): tu oferta principal es SIEMPRE Instagram. NO menciones ni ofrezcas TikTok o Facebook por tu cuenta. SOLO si el cliente pide o menciona TikTok o Facebook, ofrécele con gusto lo que hay en esa red (pasa rede="tiktok" o rede="facebook" en TODAS las herramientas de ese pedido):',
    _linhaTT,
    _linhaFB,
    '- Si el cliente pide un SERVICIO concreto de TikTok/Facebook (ej.: "quiero seguidores para TikTok"), llama tabla_precios con esa rede y ese servicio y manda la tabla en el MISMO mensaje, con el título (*Seguidores de TikTok (mixtos)*), y pregunta qué cantidad quiere. Si pide la red sin servicio (ej.: "quiero servicios para TikTok", "¿qué tienen para Facebook?"), lista los servicios disponibles de esa red en 1 mensaje corto y pregunta cuál quiere — sin tabla todavía.',
    (_ttReais ? '- En TikTok, *reales* existe SOLO en me gusta (tipo="organicos"); seguidores, vistas y comentarios de TikTok y todo Facebook son solo *mixtos*. Si piden reales en otro servicio, explica que ahí solo manejamos *mixtos*.' : '- En TikTok/Facebook NO existen *reales*: si piden reales ahí, explica que en esa red solo manejamos *mixtos*.') + ' Los precios salen de tabla_precios/cotizar_precio con la rede correcta; nunca uses la tabla de Instagram para otra red.',
    '- FLUJO TikTok/Facebook: 1) servicio; 2) tabla y cantidad; 3) cotiza; 4) valida el perfil con validar_perfil (rede=tiktok con el @, o rede=facebook con el link) y confirma nombre/seguidores; 5) si es me gusta/vistas/comentarios, pide el link del video/publicación; 6) pago por SPEI (OXXO solo si el cliente lo pide; no preguntes "¿SPEI u OXXO?"); 7) generar_pago con rede, servico, quantidade, metodo y post_link (si aplica). En Facebook, si el cliente manda el link de un video o publicación (facebook.com/share/r/..., /share/v/..., /reel/..., /videos/...), pásalo igual a validar_perfil: el sistema encuentra la página dueña; si no la encuentra, explica cómo copiar el link del perfil o página (abrir el perfil → los tres puntos → Copiar enlace). Un pedido por servicio; para repartir en varios videos haz un pedido por video.',
    'NOMBRES: escribe los tipos siempre así: *mixtos* y *reales*. La marca es siempre *You Agency*.',
    'QUÉ EXISTE EN CADA RED (no inventes ni quites nada): INSTAGRAM = seguidores (*mixtos* y *reales*), me gusta (*mixtos* y *reales*), vistas de Reels y comentarios (según la DISPONIBILIDAD de arriba). TikTok y Facebook = lo que dicen las líneas TIKTOK y FACEBOOK de abajo. NUNCA digas que no tenemos TikTok o Facebook si aparecen aquí. YouTube, Twitter/X, Kwai y otras redes NO las manejamos. NUNCA escribas cantidades o paquetes de memoria: las cantidades salen SOLO de tabla_precios.',
    'GARANTÍA (dilo claro y con seguridad, nunca "no hay garantía"): todo pedido tiene *entrega garantizada* de la cantidad contratada. *Mixtos*: servicio *estable, con bajísima caída*, y además tienen *reposición gratis por 30 días* con el link de reposición. *Reales*: también estables, con bajísima caída (solo 5-6% en más de un mes). Si preguntan por devolución del dinero, NO digas "no devolvemos": di que la entrega está garantizada y que, si algo no se entrega como se contrató, el equipo de soporte lo resuelve. "¿Son permanentes?" / "el anuncio dice permanentes": sí, se quedan en tu perfil, no se quitan solos; los dos servicios son estables, con bajísima caída, y en los mixtos además está la reposición gratis por 30 días — no lo contradigas.',
    `SEGUIDORES LATINOS: si preguntan si son latinos, la respuesta es SÍ: los *reales* son perfiles latinos, reales y activos (los más estables).${(_d.seguidores || []).includes('brasileiros') ? ' Además existe el tipo *latinos* (100% perfiles de Latinoamérica, más económico que los reales; en las herramientas pasa tipo="latinos").' : ''} Si piden seguidores de México: los *seguidores mixtos* de Instagram son perfiles de México. Si piden un estado o ciudad (solo Tlaxcala), di que no segmentamos por estado, pero que son perfiles de México. Responde esto aunque venga junto con otra pregunta en el mismo mensaje (contesta las dos). No repitas la explicación si ya la diste.`,
    'CONFIANZA ("¿es seguro?", "me han estafado", "¿tienen testimonios?"): responde corto y con hechos VERIFICABLES: nunca pedimos contraseña; el pago es por SPEI u OXXO con referencia propia de tu pedido y la confirmación llega aquí por WhatsApp; recibes el link para seguir tu pedido y ver la entrega; en youagency.site ves las compras reales de las últimas horas; y puedes empezar con el paquete más pequeño para probar. Si menciona estafa o desconfianza, la respuesta SIEMPRE termina sugiriendo empezar con el paquete MÁS PEQUEÑO para probar sin arriesgar mucho (de ese servicio y tipo, con su precio de tabla_precios/cotizar_precio) y preguntando si lo armas. NUNCA inventes números de clientes o pedidos (nada de "miles de pedidos", "miles de clientes", "años en el mercado"). NUNCA digas "no puedo compartir testimonios".',
    'URGENCIA ("lo necesito ya", "en 10 minutos"): los *mixtos* son la entrega más rápida: empiezan a entrar poco después de confirmado el pago (SPEI se confirma en minutos) y llegan de forma gradual. NUNCA prometas que la ENTREGA llega "en minutos" ni una hora exacta. Ofrécelos directo, sin hacerle repetir el pedido.',
    '"¿SON BOTS?" / "¿SON REALES?" (respuesta honesta, siempre igual): los *mixtos* son perfiles de México, estables y con reposición gratis por 30 días; sirven para dar número y autoridad al perfil, y no garantizan interacción. Si quiere perfiles reales y activos, ofrece los *seguidores de alta calidad* (latinos, reales y activos) si están disponibles; si no, no los menciones. NUNCA digas que los mixtos son "reales", "personas reales", "activos" ni "no son bots".',
    'QUÉ ES CADA TIPO ("¿qué diferencia hay?", "¿son reales?"): *Mixtos* (seguidores de Instagram): perfiles de México, entrega rápida, estables con bajísima caída, más económicos; dan número y autoridad al perfil. (Los *me gusta mixtos* son de varios países.) *Reales*: perfiles *latinos* (de Latinoamérica), reales y activos, de mayor calidad y los MÁS ESTABLES (caída de solo 5-6% en más de un mes) — el paquete premium' + ((_d.seguidores || []).includes('brasileiros') ? '. *Latinos* (solo seguidores): 100% perfiles de Latinoamérica, más económicos que los reales' : '') + '. NUNCA digas que los mixtos son falsos, bots o robots, y NUNCA digas que los mixtos son "reales". Si preguntan "¿son reales?", ofrece la opción *reales* y explica la diferencia en 1 frase. NUNCA cites perfiles de ejemplo de terceros.',
    'Datos internos de la empresa (RFC, razón social, dirección, contratos, documentos): NO los compartas, pero NUNCA respondas seco ("no puedo"). Responde profesional y cálido: You Agency es una empresa seria y activa, el pago es 100% seguro (transferencia SPEI o pago en OXXO, con referencia a tu nombre) y la entrega está garantizada; luego regresa al pedido. Si insiste mucho o desconfía en serio, ofrece pasar con soporte humano (llamar_soporte).',
    '"¿ES ESTAFA?" / desconfianza: NUNCA respondas vago. Responde con CONFIANZA y pruebas concretas (sin inventar números de clientes): pago 100% seguro por transferencia SPEI o en OXXO con referencia propia del pedido, nunca pedimos contraseña, entrega garantizada en el plazo del servicio, y el cliente recibe por aquí, en WhatsApp, la confirmación del pago y el link para seguir su pedido. Después retoma el pedido.',
    'RECLAMO "LLEGARON EXTRANJEROS" / "no es lo que esperaba" / "son de otros países": NO llames a soporte de inmediato y NO culpes al cliente. Los *seguidores mixtos* de Instagram son perfiles de México: si el cliente compró seguidores de Instagram y dice que llegaron de otros países, NO lo contradigas ni lo culpes — di con empatía que lo vas a revisar con el equipo y llama a llamar_soporte con el @ y lo que reclama. Si el reclamo es de me gusta/vistas (que son de varios países) explícalo con calma y solo llama a soporte si sigue inconforme.',
    'ESTABILIDAD (LOS DOS SERVICIOS): *mixtos* y *reales* son servicios ESTABLES, con BAJÍSIMA CAÍDA — dilo con seguridad cuando presentes los tipos o pregunten "¿se caen?", "¿los perderé?", "¿son permanentes?". El número "5-6% en más de un mes" es de los *reales*; de los *mixtos* di "estables, con bajísima caída, y con reposición gratis por 30 días por si algo baja". NUNCA digas que los mixtos "se caen con el tiempo", "los vas a perder", "no son tan estables" ni que "puede haber caída" como desventaja; la diferencia entre los tipos es la calidad del perfil (reales = perfiles reales y activos) y el precio, no la estabilidad. Tampoco prometas caída cero: NUNCA digas "no se caen" ni "no se caen con el tiempo"; di "bajísima caída".',
    'PLAZOS DE ENTREGA: *mixtos* empiezan a entrar poco después de confirmado el pago (entrega rápida). *Reales* tienen plazo de HASTA 48 H para terminar — la entrega es gradual y natural, NO inmediata. Me gusta y vistas empiezan rápido tras el pago. NO se puede agendar una hora exacta de entrega.',
    'EL PAGO SE CONFIRMA SOLO: con SPEI la confirmación suele llegar en minutos; con OXXO puede tardar un poco más (normalmente menos de 1 hora). El cliente NO necesita mandar comprobante — cuando el pago se confirma, el sistema le avisa aquí mismo.',
    'INTERACCIÓN NO GARANTIZADA: entregamos la CANTIDAD contratada (seguidores/me gusta/vistas), lo que da autoridad y prueba social, pero NO garantizamos que los seguidores comenten o interactúen. Si preguntan, sé honesto y amable. Nunca prometas interacción.',
    'SEGURIDAD / MIEDO A BLOQUEO / CONTRASEÑA: tranquiliza con firmeza — es 100% SEGURO, NUNCA pedimos tu contraseña y el método no pone tu cuenta en riesgo (solo usamos tu @ público).',
    'OBJECIÓN DE PRECIO ("está caro", "solo tengo X pesos"): JAMÁS ofrezcas un paquete fuera de la tabla, ni inventes precio o descuento. Muestra la tabla oficial (tabla_precios) y refuerza el valor con amabilidad, sin presionar. Si tiene poco presupuesto, muestra la cantidad MÁS PEQUEÑA de la tabla.',
    'SOPORTE HUMANO / HORARIO: si el cliente pide hablar con una persona o reclama algo que no resuelves, dile que el *soporte humano atiende de lunes a viernes, de 7:00 a 18:00 (hora del centro de México)* y usa llamar_soporte. Fuera de ese horario, avisa con amabilidad que el soporte responde en el siguiente horario de atención.',
    'POSVENTA: sé siempre amable y resuelve. Si dice que "compró y no le llegó todo", usa consultar_pedido y explica con calma. Muchos clientes compran en más de un lugar y se confunden — verifica antes de afirmar algo.',
    'ESTADO REAL — NUNCA digas "en proceso" a ciegas: si consultar_pedido regresa precisaSuporte=true, el pedido tiene un PROBLEMA. En ese caso NO digas que está en proceso, NO des plazo y NO tranquilices como si todo estuviera bien: di que lo vas a REVISAR con el equipo y que le respondes, y llama a llamar_soporte con el motivo. Solo afirma "en proceso" o "completado" cuando precisaSuporte=false.',
    'REPOSICIÓN QUE NO LLEGA: si dice que ya pidió la reposición por el link y no le ha llegado, dile que la reposición tiene un plazo de HASTA 24 H para procesarse. Respuesta corta.',
    'POSVENTA — BUSCAR POR @: cuando el cliente te pase el @ (porque no encontraste el pedido por el teléfono), llama consultar_pedido de inmediato con usuario=<ese @>. NO uses validar_perfil para esto y no pidas otro teléfono.',
    'CAÍDA DE SEGUIDORES ("se cayeron", "bajaron", "perdí seguidores"): llama consultar_pedido DE INMEDIATO, SIN argumentos (busca por el teléfono de este contacto) — NO pidas el @ antes. Solo pide el @ y vuelve a llamar (usuario=<@>) si regresa encontrado:false. Con el resultado: (a) si ehReales=true: NO mandes link de reposición — di que vas a REVISAR su pedido e informa que los *reales* son el servicio MÁS ESTABLE, con caída de solo 5-6% en más de un mes; (b) si NO es reales: responde CORTÍSIMO, 1 frase + el link, NADA MÁS: "¡Claro! Puedes reponer los seguidores que se cayeron aquí: <refilLink>". Si no viene refilLink, di que lo vas a revisar y llama a llamar_soporte.',
    '"PAGUÉ Y NO ME LLEGÓ" / "mi pedido no llega": llama consultar_pedido DE INMEDIATO, SIN argumentos. Solo pide el @ y vuelve a llamar si regresa encontrado:false. El campo "status" solo viene como "en proceso" o "completado" — comunica SOLO eso. NUNCA digas "parcial", "incompleto", "error", "cancelado", ni cuántos faltan. (a) "en proceso" y ehReales=true: explica que los *reales* tienen plazo de HASTA 48 H y la entrega es gradual — está dentro del plazo; (b) "en proceso" y no reales: "tu pedido está *en proceso*, puedes estar tranquilo(a) que se va a completar"; (c) "completado": di que la entrega ya terminó (que revise/actualice la app); (d) perfilPrivado=true: avisa que la entrega NO avanza con el perfil privado y pide que lo deje PÚBLICO hasta terminar. Si no encuentras el pedido ni por teléfono ni por @, llama a llamar_soporte.',
    'ESTILO WHATSAPP: NO uses emojis, ninguno. Habla como una persona, natural y directa. Negritas con UN asterisco (*así*), nunca con dos, y nunca uses títulos con #. Mensajes cortos: máximo 2 o 3 frases fuera de las tablas; no repitas lo que ya dijiste. Links: manda la URL CRUDA, NUNCA en markdown [texto](url).',
    'PRECIO: usa SIEMPRE lo que regresan las herramientas, en el MISMO mensaje — nunca inventes ni calcules precios, y nunca digas solo "voy a revisar" y te detengas.',
    'ME GUSTA y VISTAS necesitan el LINK de la publicación — pídelo (no listes publicaciones). REPARTIR EN VARIAS PUBLICACIONES (CRÍTICO): ANTES de generar el pago, pregunta si quiere repartir la cantidad en más de una publicación y, si sí, pide TODOS los links. Solo llama generar_pago cuando diga que ya terminó (o que es una sola). Si acaba de mandar un link y puede mandar más, pregunta "¿Es solo esa publicación o quieres repartir en más?". En generar_pago pasa en post_links TODOS los links que mandó para este pedido.',
    'REENVIAR DATOS DE PAGO: si el cliente pide otra vez la CLABE, la referencia o los datos de pago y AÚN no paga, llama generar_pago de nuevo con los MISMOS datos del pedido (servicio, tipo, cantidad, @, nombre, método): el sistema reenvía el MISMO pago, sin cobrar dos veces. MÉTODOS DE PAGO: *SPEI* es el principal (transferencia desde la app de CUALQUIER banco o billetera: BBVA/Bancomer, Banorte, Santander, Banamex, HSBC, Banco Azteca, Banregio, Nu, Mercado Pago, Spin by OXXO, Hey Banco, etc.; se confirma en minutos). *OXXO* (efectivo en tienda con número de referencia; de $ 10 a $ 10,000 MXN) solo si el cliente lo pide o no tiene banco; avísale que en la caja de OXXO cobran una comisión aparte (que lleve unos pesos de más) y que la confirmación puede tardar hasta 1 hora. Si el cliente dice que tiene BBVA, Mercado Pago, Nu u otra app, eso ES SPEI: no le ofrezcas OXXO. Si el cliente quiere cambiar de método antes de pagar, llama generar_pago con los mismos datos y el nuevo metodo. No aceptamos tarjeta. Nunca digas que no puedes reenviar los datos.',
    'LINKS DESPUÉS DEL PAGO GENERADO: si manda más links después de generar el pago y AÚN no paga, llama generar_pago de nuevo con TODOS los links (el sistema los agrega al MISMO pedido, sin cobrar otra vez). Si YA PAGÓ y manda links nuevos, NO generes pago: di que vas a pasar las publicaciones al equipo y llama a llamar_soporte.',
    'AL VALIDAR EL PERFIL, confirma con el @ y el NÚMERO REAL de seguidores que regresó validar_perfil. Nunca escribas "NOMBRE" o "N" literal. Ej.: "¡Encontré tu perfil! @fulano, 12,345 seguidores. ¿Es correcto?". Si el cliente dice que el número está mal, NO discutas: llama validar_perfil otra vez y usa el número nuevo.',
    'TIPO ANTES DEL PRECIO (CRÍTICO): NUNCA muestres tabla o precio de seguidores o me gusta sin dejar claro DE QUÉ TIPO son. En SEGUIDORES, si el cliente no eligió, son *mixtos* (dilo en el título) — no preguntes el tipo ni muestres otra tabla; *alta calidad* solo si la pide. En ME GUSTA, si no eligió, pregunta (*mixtos* o *reales*) o muestra las dos tablas, cada una con su título. Si las herramientas regresan tipoAssumido=true, los precios son de *mixtos* — dilo explícitamente.',
    'VARIAS TABLAS: pon SIEMPRE el título del tipo arriba de cada lista (*Seguidores mixtos*, *Seguidores de alta calidad*, *Me gusta reales*...).',
    'PRECIO SOLO DE LA HERRAMIENTA: cualquier precio o cantidad que escribas tiene que venir de cotizar_precio o tabla_precios en ESTA conversación. Nunca inventes cantidades (ej.: "2,500 seguidores") ni combines precios.',
    '@ OBLIGATORIO EN TODO PEDIDO DE INSTAGRAM (también me gusta y vistas; en TikTok/Facebook sigue el FLUJO TikTok/Facebook): pide el @ de Instagram y valídalo con validar_perfil ANTES de generar el pago. NUNCA uses el correo ni el nombre del cliente como @. Copia el @ EXACTAMENTE como lo escribió el cliente, letra por letra.',
    'IMAGEN DEL CLIENTE: mensajes "[El cliente envió una IMAGEN… Contenido: …]" traen lo que hay en la foto. Úsalo: si aparece un @, úsalo; si es captura de la página de reposición con error, trátalo como ERROR EN LA REPOSICIÓN; si es comprobante, trátalo como pago enviado. No digas que no puedes ver imágenes.',
    'LINK DE REPOSICIÓN: solo manda el refilLink que regresó consultar_pedido, y SOLO cuando el cliente hable de caída o pida reposición. NUNCA armes ni inventes un link.',
    'PAGO YA GENERADO: si ya generaste el pago de un paquete, NO propongas otro paquete ni cambies la cantidad por tu cuenta ("voy a confiar", "ok", "bueno" NO son cambio de pedido). Solo cambia si el cliente pide CLARAMENTE otra cantidad o servicio.',
    'FLUJO DE VENTA: 1) servicio + tipo; 2) muestra la tabla y pregunta la cantidad; 3) cotiza el valor exacto; 4) pide el @ y valida (confirma seguidores); 5) si es me gusta/vistas, pide el link y pregunta si reparte en más publicaciones; 6) pago por *SPEI* (lo normal; NO preguntes "¿SPEI u OXXO?"): con el @ validado, genera el pago por SPEI — es transferencia desde la app de cualquier banco y se confirma en minutos. Usa *OXXO* solo si el cliente lo pide, dice que no tiene banco/app o quiere pagar en efectivo; no ofrezcas tarjeta; 7) genera el pago. NO pidas el nombre ni el correo: el sistema usa el nombre del WhatsApp del cliente.',
    'GENERAR EL PAGO — REGLA CRÍTICA: en cuanto tengas servicio, tipo, cantidad, @ validado y método (y, en me gusta/vistas, los links con la confirmación de que terminó), llama *generar_pago* DE INMEDIATO, en el MISMO turno. NUNCA digas "voy a generar el pago", "un momento" o "espera" sin llamar la herramienta. Si falta un dato, pide solo lo que falta.',
    'DESPUÉS DE GENERAR EL PAGO: NUNCA escribas en el texto la CLABE, el banco, el beneficiario ni ningún link — el sistema los manda AUTOMÁTICAMENTE en mensajes separados. Tu mensaje lleva solo la confirmación del resumen y el cierre "Quedo al pendiente de la confirmación de tu pago para liberar tu pedido." Si generar_pago regresa error, NO digas que salió bien — pide intentar de nuevo u ofrece el otro método, o llama a soporte. Nunca pidas RFC ni CURP.',
    'CONFIRMACIÓN ANTES DEL PAGO: generar_pago puede regresar "oferta_enviada" (el sistema ya le ofreció al cliente, una sola vez, el paquete siguiente por la diferencia) o "resumen_enviado" (el sistema ya le mandó el resumen del pedido con "¿Todo bien?"). En los dos casos NO escribas nada más en ese turno. Cuando el cliente conteste la oferta: si la acepta ("sí", "va", "el de 1,000"), llama generar_pago con la cantidad nueva y el mismo tipo; si no la quiere o no responde a eso, llama generar_pago con la cantidad original, sin insistir ni volver a ofrecer. Cuando confirme el resumen, llama generar_pago con los mismos datos. Nunca digas que el pago ya está generado hasta que generar_pago regrese ok.',
    'TIPO AL CERRAR (CRÍTICO): en generar_pago usa EXACTAMENTE el tipo que cotizaste y el cliente confirmó. "alta calidad"/"reales"/"de verdad"/"orgánicos" = organicos. El monto del pago TIENE que ser el mismo que cotizaste.',
    'NOMBRE Y CORREO: NO los pidas — el sistema usa el nombre del WhatsApp del cliente. Si el cliente da su nombre o correo por su cuenta, pásalos en generar_pago. Si en el historial ya preguntaste el nombre, no lo vuelvas a preguntar.',
    'FRASES DE PAGO NO SON @: "para depositar en Oxxo", "por transferencia", "en efectivo", "ahorita pago" son el MÉTODO DE PAGO, nunca un usuario. Solo llama validar_perfil con un @ o link que el cliente escribió.',
    'NO SABE TRANSFERIR ("no puedo hacer la transferencia", "¿cómo le hago?", "¿qué es SPEI?", "¿a qué cuenta?"): antes de ofrecer OXXO, ayúdalo con el paso a paso en 1 mensaje corto: abre la app de tu banco → Transferir → a otro banco / nueva cuenta → pega la CLABE de 18 dígitos (beneficiario Zypher Servicos) → escribe el monto exacto → confirma. En Mercado Pago: Transferir → con CLABE. Solo si de verdad no tiene banco ni app, ofrece OXXO.',
    'PAGA DESPUÉS ("te deposito mañana", "el OXXO está cerrado", "ahorita estoy en clase", "mi banco tarda"): NUNCA respondas solo "no hay problema". (1) Si todavía NO generaste el pago y ya tienes servicio, cantidad, @ validado y método, llama generar_pago YA, para que el cliente tenga los datos guardados en el chat. (2) Responde corto: su pedido queda *apartado con el mismo precio*; con *SPEI* la CLABE no vence (puede transferir cuando quiera); con *OXXO* la referencia sigue válida varios días y sirve en cualquier OXXO; en cuanto pague se confirma solo aquí y empieza la entrega. (3) Cierra amable, sin presionar ("Aquí te espero").',
    'ANTES DEL PAGO NO HAY "EN PROCESO": mientras el cliente no pague, NUNCA digas que su pedido "está en proceso" o "ya fue liberado"; di que queda listo y empieza en cuanto se confirme el pago. NUNCA pidas captura, ticket ni comprobante (ni de OXXO): la confirmación es automática.',
    'NO RETROCEDAS: si el cliente ya eligió servicio, cantidad y validó el @, y vuelve después (o manda el @ otra vez), sigue desde donde quedó: pide solo lo que falta (normalmente el método de pago) y genera el pago.',
    'ERROR EN LA REPOSICIÓN (pidió la reposición y le salió error, no puede, no funciona, manda captura de error): NUNCA vuelvas a mandar el link y NUNCA respondas con el estado del pedido. Di que vas a pasar con soporte para revisarlo y llama a llamar_soporte.',
    'PAGO YA CONFIRMADO: si en el historial ya está el mensaje de *Pago confirmado* de este pedido, NUNCA pidas el pago otra vez ni reenvíes los datos. Agradece y habla de la entrega. Si generar_pago responde pedido_ja_pago, igual. Si dice que ya pagó pero el sistema no lo confirmó, dile que la confirmación puede tardar unos minutos (OXXO un poco más).',
    'UN RECLAMO NO ES UN PAGO NUEVO: "no llegó", "no ha cambiado nada", "¿sí va a llegar?" son preguntas sobre un pedido YA PAGADO — usa consultar_pedido. NUNCA llames generar_pago en esos mensajes. Usa comprar_mais=true solo si pide claramente COMPRAR OTRO paquete.',
    'PERFIL PRIVADO: si el cliente dice que su perfil ya es PÚBLICO, no repitas que está privado: agradece, di que lo vas a revisar y llama a llamar_soporte.',
    'VARIOS SERVICIOS: avisa que lo haces uno por uno, en orden; un pago por servicio. Nunca digas que generaste un pedido que la herramienta no confirmó. Al repartir me gusta/vistas en varias publicaciones, confirma cuántos links mandó REALMENTE el cliente.',
    'Si el cliente pide un humano o hace un reclamo serio, usa llamar_soporte y deja de vender.',
  ].join('\n');
}

const TOOLS = [
  { type: 'function', function: { name: 'cotizar_precio', description: 'Precio oficial (MXN) de UN paquete de un servicio.', parameters: { type: 'object', properties: { rede: { type: 'string', enum: ['instagram', 'tiktok', 'facebook'], description: 'Red social. Por defecto instagram. tiktok/facebook SOLO si el cliente pidió esa red.' }, servico: { type: 'string', enum: ['seguidores', 'curtidas', 'visualizacoes', 'comentarios'], description: 'seguidores | curtidas (= me gusta) | visualizacoes (= vistas) | comentarios (Instagram, TikTok o Facebook)' }, tipo: { type: 'string', enum: ['mistos', 'organicos', 'latinos'], description: 'mistos = mixtos | organicos = reales (seguidores/me gusta de Instagram; en TikTok solo me gusta reales) | latinos = seguidores latinos de Instagram' }, quantidade: { type: 'integer' } }, required: ['servico', 'quantidade'] } } },
  { type: 'function', function: { name: 'tabla_precios', description: 'Tabla completa de cantidades y precios (MXN) de un servicio para que el cliente elija.', parameters: { type: 'object', properties: { rede: { type: 'string', enum: ['instagram', 'tiktok', 'facebook'], description: 'Red social. Por defecto instagram. tiktok/facebook SOLO si el cliente pidió esa red.' }, servico: { type: 'string', enum: ['seguidores', 'curtidas', 'visualizacoes', 'comentarios'] }, tipo: { type: 'string', enum: ['mistos', 'organicos', 'latinos'] } }, required: ['servico'] } } },
  { type: 'function', function: { name: 'validar_perfil', description: 'Valida el perfil (Instagram: @; TikTok: @; Facebook: link del perfil o página) y regresa nombre + seguidores para confirmar.', parameters: { type: 'object', properties: { rede: { type: 'string', enum: ['instagram', 'tiktok', 'facebook'], description: 'Red social. Por defecto instagram. tiktok/facebook SOLO si el cliente pidió esa red.' }, usuario: { type: 'string', description: '@ (Instagram/TikTok) o link del perfil/página (Facebook)' } }, required: ['usuario'] } } },
  { type: 'function', function: { name: 'consultar_pedido', description: 'Consulta el pedido del cliente ("pagué y no llegó", caída). Sin argumentos busca por el teléfono del contacto; pasa "usuario" (@) solo si no lo encontró por teléfono. Regresa tipo, horas desde el pago, si es reales (plazo 48 h), estado y si el perfil está privado.', parameters: { type: 'object', properties: { usuario: { type: 'string', description: '@ o link del perfil — solo si no se encontró por teléfono' } }, required: [] } } },
  { type: 'function', function: { name: 'llamar_soporte', description: 'Pasa la conversación al soporte humano y deja de vender.', parameters: { type: 'object', properties: { motivo: { type: 'string', description: 'Resumen CORTO (1 frase) de lo que el cliente necesita — llega como notificación al equipo.' } }, required: ['motivo'] } } },
  { type: 'function', function: { name: 'generar_pago', description: 'Crea el pedido y genera el pago por SPEI u OXXO (pasa el metodo que eligió el cliente). El precio lo define el tipo — pasa SIEMPRE el tipo exacto que eligió el cliente.', parameters: { type: 'object', properties: { rede: { type: 'string', enum: ['instagram', 'tiktok', 'facebook'], description: 'Red social. Por defecto instagram. tiktok/facebook SOLO si el cliente pidió esa red.' }, post_link: { type: 'string', description: 'TikTok/Facebook: link del video/publicación (me gusta, vistas, comentarios).' }, servico: { type: 'string', enum: ['seguidores', 'curtidas', 'visualizacoes', 'comentarios'] }, tipo: { type: 'string', enum: ['mistos', 'organicos', 'latinos'], description: 'OBLIGATORIO para seguidores/me gusta. "reales", "de verdad", "orgánicos" = organicos; "latinos" = latinos (solo seguidores). Usa EXACTAMENTE el tipo cotizado.' }, quantidade: { type: 'integer' }, usuario: { type: 'string' }, nome: { type: 'string', description: 'Nombre del cliente SOLO si él lo dio; si no, déjalo vacío (el sistema usa el nombre del WhatsApp).' }, email: { type: 'string' }, metodo: { type: 'string', enum: ['SPEI', 'OXXO'], description: 'SPEI por defecto (transferencia desde cualquier banco o app). OXXO SOLO si el cliente lo pidió o no tiene banco (efectivo en tienda, de $ 10 a $ 10,000 MXN).' }, post_links: { type: 'array', items: { type: 'string' }, description: 'TODOS los links de publicación (me gusta/vistas) que mandó para ESTE pedido.' }, comprar_mais: { type: 'boolean', description: 'true SOLO si el cliente pidió claramente comprar OTRO paquete igual a uno ya pagado.' } }, required: ['servico', 'quantidade', 'usuario'] } } },
];

// Nome do pedido sem perguntar: o nome do perfil do WhatsApp (gravado nas mensagens recebidas).
async function _nomeDoContato(phone, fallback) {
  try {
    const c = await getCollection('wa_ia_messages');
    const m = await c.find({ phone: String(phone), direction: 'in', name: { $nin: [null, ''] } }, { projection: { name: 1 } }).sort({ createdAt: -1 }).limit(1).next();
    const n = String((m && m.name) || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim();
    if (n.length >= 2) return n.slice(0, 60);
  } catch (_) {}
  const f = String(fallback || '').replace(/^@+/, '').trim();
  return f.length >= 2 ? f : 'Cliente';
}
// O @ passado ao validar_perfil tem que ter sido ESCRITO pelo cliente (evita "Para depositar en Oxxo" → @jesus).
function _clienteEscreveu(ctx, usuario) {
  const h = String(usuario || '').toLowerCase().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[/?#].*$/, '').trim();
  if (!h) return false;
  const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ponto final da frase ("Mi @ es fulano.") não é parte do @ (simulação 22/11: 28 de 61 conversas travaram no "no pude validar")
  const rx = new RegExp('(^|[^a-z0-9._])@?' + esc + '(?![a-z0-9_]|\\.[a-z0-9_])', 'i');
  return (ctx.allUserTexts || ctx.recentUserTexts || [ctx.text]).some((t) => rx.test(String(t || '').toLowerCase()));
}
// ── Estado da venda por contato (whatsapp_contacts): resumo esperando "¿Todo bien?", oferta do pacote
// seguinte (uma vez a cada 6 h) e a oferta de dobrar o pedido (pós-compra). ──
async function _getContato(phone) {
  try { const c = await getCollection('whatsapp_contacts'); return (await c.findOne({ _id: String(phone) }, { projection: { pedidoAConfirmar: 1, ofertaMejoraAt: 1, ofertaMejora: 1, ofertaDobro: 1 } })) || {}; } catch (_) { return {}; }
}
async function _setContato(phone, set, unset) {
  try {
    const c = await getCollection('whatsapp_contacts');
    const up = {}; if (set && Object.keys(set).length) up.$set = set; if (unset && Object.keys(unset).length) up.$unset = unset;
    if (Object.keys(up).length) await c.updateOne({ _id: String(phone) }, up, { upsert: true });
  } catch (_) {}
}
// "Sí" claro (confirma o resumo). Para a oferta de dobrar vale só o SÍ: "ok", "gracias" e "no" contam como recusa.
const RE_SIM = /^\s*(s[ií]+|sip|s[ií]\s*,?\s*(por\s+favor|claro|correcto|todo\s+bien|est[aá]\s+bien|as[ií]|perfecto|adelante|dale|va|la\s+quiero|lo\s+quiero|quiero|gracias|g[eé]neralo|genera(lo)?)|claro(\s+que\s+s[ií])?|todo\s+bien|todo\s+correcto|correcto|perfecto|as[ií]\s+est[aá]\s+bien|est[aá]\s+bien|ok(ay|ey|i)?|va|vale|sale|dale|listo|adelante|de\s+acuerdo|exacto|confirmo|confirmado)\s*[.!¡]*\s*$/i;
const RE_SIM_DOBRO = /^\s*(s[ií]+|sip|s[ií]\s*,?\s*(por\s+favor|claro|la\s+quiero|lo\s+quiero|quiero|dale|va)|claro\s+que\s+s[ií]|s[ií]\s+la\s+quiero)\s*[.!¡]*\s*$/i;
// Recusa com cobrança aberta → para os lembretes de pagamento (evita denúncia de spam).
const RE_RECUSA = /(ya\s+no\s+(lo\s+)?(quiero|me\s+interesa|voy\s+a\s+(comprar|pagar))|no\s+lo\s+quiero|no\s+quiero\s+(nada|comprar|pagar|ya|el\s+pedido|seguir)|^\s*no\s+quiero\s*[.!]*\s*$|mejor\s+no\b|no\s+me\s+interesa|cancel(a|ar|alo|en|ado)\s+(el\s+|mi\s+)?(pedido|pago|compra)|^\s*no,?\s+gracias\s*[.!]*\s*$|olv[ií]dalo|ya\s+no\s+(comprar[ée]|pagar[ée]))/i;
const _fq = (n) => Number(n || 0).toLocaleString('en-US');
function _chavePedido(rede, a) {
  const sv = sales.normalizeServico(a && a.servico);
  const tipo = (sv === 'seguidores' || sv === 'curtidas') ? sales.normalizeTipo(a && a.tipo) : '';
  const links = [...new Set((Array.isArray(a && a.post_links) ? a.post_links : []).concat(a && a.post_link ? [a.post_link] : []).map((u) => String(u).replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()).filter(Boolean))].sort().join(',');
  const met = /oxxo/i.test(String((a && a.metodo) || '')) ? 'OXXO' : 'SPEI';
  return [rede, sv, tipo, Number(a && a.quantidade) || 0, String((a && a.usuario) || '').toLowerCase().replace(/^@+/, ''), links, met].join('|');
}
// Antes de criar uma cobrança NOVA: o resumo desse mesmo pedido já foi mostrado num turno anterior → confirmado.
async function _antesDeCobrar(ctx, rede, a2) {
  if (ctx.confirmado) return { confirmado: true, ct: {} };
  const chave = _chavePedido(rede, a2);
  const ct = await _getContato(ctx.phone);
  const p = ct.pedidoAConfirmar;
  const recente = p && p.at && (Date.now() - new Date(p.at).getTime()) < 3 * 3600e3;
  const mesmo = !!(recente && p.chave === chave && !ctx.resumoNesteTurno);
  // "no", "espera", "todavía no" ao resumo NUNCA viram confirmação (nem reenviam o mesmo resumo).
  if (mesmo && RE_NAO.test(String(ctx.text || ''))) return { confirmado: false, ct, chave, bloqueio: { ok: false, error: 'cliente_no_confirmo', message: 'El cliente NO confirmó el resumen. Pregúntale en 1 frase qué quiere cambiar (cantidad, tipo, perfil, publicación o método de pago). No mandes el mismo resumen otra vez ni generes el pago.' } };
  return { confirmado: mesmo, ct, chave };
}
const RE_NAO = /^\s*(no|nop|nel|nope|mmm+|espera|esp[eé]rame|aguanta|todav[ií]a\s+no|a[uú]n\s+no|mejor\s+no|ahorita\s+no|est[aá]\s+mal|no\s+es)\b/i;
// A cobrança seria nova: manda (texto fixo, sem a IA) a oferta do pacote seguinte — uma vez — ou o resumo "¿Todo bien?".
async function _ofertaOuResumo(ctx, rede, a2, r, gate) {
  if (ctx.textoFixo) return { ok: false, error: 'ya_enviado', message: 'El sistema ya le mandó un mensaje al cliente en este turno. No escribas nada; espera su respuesta.' };
  const ct = gate.ct || {};
  const ofertou = ct.ofertaMejoraAt && (Date.now() - new Date(ct.ofertaMejoraAt).getTime()) < 6 * 3600e3;
  const nomeSv = r.unit + (r.tipoNombre ? ' ' + r.tipoNombre : '') + (r.redeNombre ? ' de ' + r.redeNombre : '');
  // Perfil validado neste mesmo turno: a confirmação do perfil vai junto (senão o cliente nem vê o que foi achado).
  const pv = ctx.perfilNesteTurno;
  const prefixo = (pv && pv.username) ? ('¡Encontré tu perfil! @' + String(pv.username).replace(/^@+/, '') + (Number.isFinite(Number(pv.followers)) ? (', ' + _fq(pv.followers) + ' seguidores') : '') + '.\n\n') : '';
  if (r.mejora && !ofertou) {
    ctx.textoFixo = prefixo + 'Antes de generar tu pago: por solo *' + r.mejora.diffLabel + ' más* te llevas *' + _fq(r.mejora.quantidade) + ' ' + nomeSv + '* en lugar de ' + _fq(r.quantidade) + ' (total ' + r.mejora.priceLabel + '). ¿Lo quieres o seguimos con ' + _fq(r.quantidade) + '?';
    await _setContato(ctx.phone, { ofertaMejoraAt: new Date(), ofertaMejora: { de: r.quantidade, para: r.mejora.quantidade, servico: a2.servico, rede } }, { pedidoAConfirmar: '' });
    return { ok: false, error: 'oferta_enviada', message: 'El sistema YA le mandó al cliente la oferta del paquete siguiente (' + _fq(r.mejora.quantidade) + ' por ' + r.mejora.priceLabel + ' en vez de ' + _fq(r.quantidade) + '). No escribas nada; espera su respuesta. Si la acepta, llama generar_pago con quantidade=' + r.mejora.quantidade + ' y el mismo tipo; si no la quiere, con quantidade=' + r.quantidade + ', sin insistir.' };
  }
  ctx.textoFixo = prefixo + 'Te confirmo tu pedido:\n\n' + r.resumoConfirmacao + '\n\n¿Todo bien?';
  ctx.resumoNesteTurno = true;
  await _setContato(ctx.phone, { pedidoAConfirmar: { chave: gate.chave, rede, args: a2, validatedRede: ctx.validatedRede || null, resumo: r.resumoConfirmacao, at: new Date() } });
  return { ok: false, error: 'resumen_enviado', message: 'El sistema YA le mandó al cliente el resumen del pedido con la pregunta "¿Todo bien?". No escribas nada; espera su respuesta. Si confirma, llama generar_pago con los mismos datos; si corrige algo, llama generar_pago con los datos corregidos.' };
}

// Pagamento já gerado e o cliente só PERGUNTOU algo ("¿Mercado Pago sirve?", "¿cuánto tarda?"): não refaz resumo/cobrança,
// manda o modelo responder a pergunta (22/11: perguntas viravam "Te mando otra vez los datos" / resumo repetido).
async function _bloqueioPagoAberto(ctx, a2) {
  try {
    if (ctx.confirmado) return null;
    const t = String(ctx.text || '');
    const muda = /(\d{2,}|oxxo|efectivo|tienda|spei|transferencia|en\s+vez|mejor|cambi|otr[oa]s?\b|m[aá]s\s+(seguidores|likes|me\s+gusta)|reales|mixtos|likes?|me\s+gusta|vistas|coment|@|instagram\.com|tiktok|facebook|clabe|referencia(?!s)|datos|reenv|de\s+nuevo|otra\s+vez|genera|quiero|s[ií]\b|va\b|dale|listo)/i.test(t);
    if (muda) return null;
    const ab = await sales.ultimoPagoAberto(ctx.phone);
    if (!ab || !ab.codigoPago) return null;
    return { ok: false, error: 'pago_ya_generado', message: 'YA hay un pago generado y enviado en el chat (' + (ab.pacote || 'su pedido') + ', ' + ab.valorLabel + ' por ' + String((ab.pago && ab.pago.metodo) || 'SPEI') + '). El cliente NO pidió cambiar nada: NO generes otro pago ni repitas el resumen o los datos. Contesta SOLO su pregunta en 1-2 frases (ej.: Mercado Pago, BBVA, Nu y cualquier app de banco sirven para SPEI) y recuérdale que la CLABE/referencia está arriba en el chat.' };
  } catch (_) { return null; }
}

async function runTool(name, args, ctx) {
  try {
    const avisaTipo = (r, args2) => {
      try {
        const semTipo = !String((args2 && args2.tipo) || '').trim();
        const aceitaTipo = ['seguidores', 'curtidas'].includes(String((args2 && args2.servico) || '').toLowerCase());
        if (r && r.ok && semTipo && aceitaTipo) {
          r.tipoAssumido = true;
          r.aviso = 'El cliente NO eligió el tipo — asumí *mixtos*. DEBES decir explícitamente que son *mixtos* al mostrar estos precios, o preguntar antes qué tipo quiere (*mixtos* o *reales*).';
        }
      } catch (_) {}
      return r;
    };
    const redeArg = sales.normalizeRede(args && args.rede);
    if (name === 'cotizar_precio') { const r0 = await sales.quote(args || {}); return redeArg === 'instagram' ? avisaTipo(r0, args) : r0; }
    if (name === 'tabla_precios') { const r0 = await sales.priceTable(args || {}); return redeArg === 'instagram' ? avisaTipo(r0, args) : r0; }
    if (name === 'validar_perfil' && redeArg !== 'instagram') {
      const vr = await sales.validateRedeProfile(redeArg, (args && args.usuario) || '');
      if (vr && vr.ok) { ctx.validatedRede = { rede: redeArg, username: vr.username, link: vr.link }; ctx.perfilNesteTurno = { username: vr.username, followers: vr.followers }; }
      return vr;
    }
    if (name === 'generar_pago' && redeArg !== 'instagram') {
      const a2 = Object.assign({}, args || {});
      let val = (ctx.validatedRede && ctx.validatedRede.rede === redeArg) ? ctx.validatedRede : null;
      if (!val && a2.usuario) { const vr = await sales.validateRedeProfile(redeArg, a2.usuario).catch(() => null); if (vr && vr.ok) val = ctx.validatedRede = { rede: redeArg, username: vr.username, link: vr.link }; }
      if (!val) return { ok: false, error: 'perfil_nao_validado', message: 'No generes el pago todavía: pide y valida el perfil de ' + (redeArg === 'tiktok' ? 'TikTok (@)' : 'Facebook (link del perfil o página)') + ' con validar_perfil (rede=' + redeArg + ').' };
      const postLink = a2.post_link || (Array.isArray(a2.post_links) ? a2.post_links[0] : '') || '';
      if (String(a2.nome || '').trim().length < 2) a2.nome = await _nomeDoContato(ctx.phone, val.username);
      a2.usuario = val.username; a2.post_link = postLink; delete a2.post_links;
      const pa0 = await _bloqueioPagoAberto(ctx, a2); if (pa0) return pa0;
      const gate = await _antesDeCobrar(ctx, redeArg, a2);
      if (gate.bloqueio) return gate.bloqueio;
      const r = await sales.createRedeOrder({ rede: redeArg, servico: a2.servico, tipo: a2.tipo, quantidade: a2.quantidade, usuario: val.username, perfil_link: val.link, nome: a2.nome, email: a2.email, phone: ctx.phone, post_link: postLink, comprar_mais: a2.comprar_mais, metodo: a2.metodo, previewOnly: !gate.confirmado });
      if (!r.ok && r.error === 'precisa_confirmar') return await _ofertaOuResumo(ctx, redeArg, a2, r, gate);
      if (r.ok) { try { await _setContato(ctx.phone, null, { pedidoAConfirmar: '' }); } catch (_) {} }
      if (r.ok && r.codigoPago) { ctx.pagoToSend = r.pago; ctx.pagoCodigo = r.codigoPago; ctx.pagoValor = r.valorLabel; }
      if (r.ok && r.reaproveitado) { ctx.pagoReused = true; r.resumo = r.resumo + ' — es el MISMO pago generado antes para este pedido (no es un pedido nuevo); díselo al cliente.'; }
      if (r.ok && !r.codigoPago) return { ok: false, error: 'sem_dados_pagamento', message: 'El pedido se creó pero no regresaron los datos de pago. Dile al cliente que lo revisas con el equipo y llama a llamar_soporte.' };
      if (r.ok) return { ok: true, valor: r.valorLabel, metodo: r.pago && r.pago.metodo, resumo: r.resumo, datos_de_pago_enviados_automaticamente: true, instruccion_interna_no_mencionar: 'Los datos de pago salen solos en mensajes aparte. Tu respuesta: solo confirma el resumen y cierra con "Quedo al pendiente de la confirmación de tu pago para liberar tu pedido." No hables de CLABE, referencia, banco, links ni de esta instrucción.' };
      return r;
    }
    if (name === 'validar_perfil') {
      const pedido = String((args && args.usuario) || '').trim();
      if (!_clienteEscreveu(ctx, pedido)) return { ok: false, error: 'usuario_no_escrito', message: 'El cliente NO escribió ese @ (' + pedido + '). No inventes ni deduzcas usuarios de otras frases: pídele su @ de Instagram tal como aparece en su perfil.' };
      let vr = await sales.validateProfile(pedido);
      // El modelo a veces reescribe el @ y se come letras: intenta con el texto crudo del cliente.
      if (!vr || !vr.ok) {
        const cru = String(ctx.text || '').trim().replace(/^@+/, '');
        const pareceHandle = /^[a-zA-Z0-9._]{2,30}$/.test(cru) || /instagram\.com\//i.test(String(ctx.text || ''));
        const diferente = cru.toLowerCase() !== pedido.toLowerCase().replace(/^@+/, '');
        if (pareceHandle && diferente && cru) {
          const vr2 = await sales.validateProfile(String(ctx.text || '').trim());
          if (vr2 && vr2.ok) vr = vr2;
        }
      }
      // Cliente mandó el LINK del perfil antes: intenta los @ exactos de esos links.
      if (!vr || !vr.ok) {
        const norm = (x) => String(x || '').toLowerCase().replace(/^@+/, '').replace(/[._]/g, '');
        const vistos = new Set();
        for (const t of (ctx.recentUserTexts || [])) {
          for (const mm of String(t).matchAll(/instagram\.com\/([A-Za-z0-9_.]+)/gi)) {
            const h = mm[1].toLowerCase();
            if (vistos.has(h) || ['p', 'reel', 'reels', 'stories', 'tv'].includes(h)) continue;
            vistos.add(h);
            if (h === pedido.toLowerCase().replace(/^@+/, '')) continue;
            if (norm(h) !== norm(pedido) && !norm(h).startsWith(norm(pedido))) continue;
            const vr3 = await sales.validateProfile(h);
            if (vr3 && vr3.ok) { vr = vr3; break; }
          }
          if (vr && vr.ok) break;
        }
      }
      if (vr && vr.ok) { ctx.validated = true; ctx.validatedUsername = vr.username || String((args && args.usuario) || '').replace(/^@+/, ''); ctx.perfilNesteTurno = { username: ctx.validatedUsername, followers: vr.followers }; }
      return vr;
    }
    if (name === 'consultar_pedido') {
      let usuario = (args && args.usuario) || '';
      if (!usuario) {
        const t = String(ctx.text || '').trim();
        if (/instagram\.com\//i.test(t) || /^@?[a-zA-Z0-9._]{2,30}$/.test(t)) usuario = t;
      }
      const r = await sales.consultarPedido({ telefone: ctx.phone, usuario });
      ctx.lastConsulta = r;
      return r;
    }
    if (name === 'llamar_soporte') { ctx.support = true; return await sales.flagSupport(ctx.phone, (args && args.motivo) || ''); }
    if (name === 'generar_pago') {
      const a2 = Object.assign({}, args || {});
      // El @ del pedido es el VALIDADO en la conversación.
      let validado = ctx.validatedUsername || ctx.histUsername || '';
      const normU = (x) => String(x || '').toLowerCase().replace(/^@+/, '').trim();
      if (!validado) {
        const h = normU(a2.usuario);
        const escH = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rxH = new RegExp('(^|[^a-z0-9._@])@?' + escH + '(?![a-z0-9_]|\\.[a-z0-9_]|@)', 'i');
        const escreveu = !!h && (ctx.allUserTexts || ctx.recentUserTexts || []).some((t) => rxH.test(String(t || '').replace(/\S+@\S+\.\S+/g, ' ')));
        const vr = escreveu ? await sales.validateProfile(h).catch(() => null) : null;
        if (!vr || !vr.ok) {
          return { ok: false, error: 'perfil_nao_validado', message: 'No generes el pago todavía: pide el @ de Instagram del cliente y valídalo con validar_perfil (confirma seguidores). NUNCA uses el correo o el nombre del cliente como @.' };
        }
        validado = vr.username || h;
        ctx.validatedUsername = validado;
      }
      if (normU(a2.usuario) !== normU(validado)) a2.usuario = validado;
      if (String(a2.nome || '').trim().length < 2) a2.nome = await _nomeDoContato(ctx.phone, validado);
      // Link da publicação (me gusta/vistas/comentarios): o modelo às vezes manda em post_link (singular) ou
      // não manda nenhum → faltou_post em loop ("manda el link sin parámetros"; 21/11 perdeu a venda).
      // Usa o post_link e, se ainda faltar, o último link de post que o CLIENTE escreveu.
      if (['curtidas', 'visualizacoes', 'comentarios'].includes(String(a2.servico || '').toLowerCase())) {
        const rxUm = /instagram\.com\/(?:[^\s/]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,}/i;
        const rxTodos = /https?:\/\/(?:www\.)?instagram\.com\/(?:[^\s/]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,}[^\s]*/gi;
        const temValido = (arr) => (arr || []).some((u) => rxUm.test(String(u || '')) && !/X{5,}/.test(String(u || '')));
        let links = Array.isArray(a2.post_links) ? a2.post_links.filter(Boolean) : (a2.post_links ? String(a2.post_links).split(',').map((x) => x.trim()) : []);
        if (!temValido(links) && a2.post_link) links = [a2.post_link];
        if (!temValido(links)) {
          // mensagem atual primeiro, depois o histórico do mais novo para o mais velho
          const ordem = [(ctx.allUserTexts || [])[0]].concat((ctx.allUserTexts || []).slice(1).reverse());
          for (const t of ordem) { const ms = String(t || '').match(rxTodos); if (ms && ms.length) { links = [ms[ms.length - 1]]; break; } }
        }
        a2.post_links = links;
      }
      // "quiero OTROS 1,000", "más", "de nuevo": recompra — sem isso o mesmo pacote pago nos últimos 7 dias volta como
      // "ya fue pagado" e a venda se perde (Oppus 19/11). Reclamo não conta.
      if (a2.comprar_mais !== true) {
        const ult = (ctx.recentUserTexts || []).slice(0, 3).join(' ');
        const recompra = /(^|[^a-záéíóúñ])(m[aá]s|otr[oa]s?|de\s+nuevo|otra\s+vez|nuevamente|repetir)(?![a-záéíóúñ])/i.test(ult);
        const reclama = /(no\s+(me\s+)?(lleg[oó]|ha\s+llegado|entr[oó]|veo|aparece)|se\s+(cayeron|bajaron)|perd[ií]|falta|reclam|reembolso|devoluci|demora)/i.test(ult);
        if (recompra && !reclama) a2.comprar_mais = true;
      }
      const pa1 = await _bloqueioPagoAberto(ctx, a2); if (pa1) return pa1;
      const gate = await _antesDeCobrar(ctx, 'instagram', a2);
      if (gate.bloqueio) return gate.bloqueio;
      const r = await sales.createPaymentOrder(Object.assign({ phone: ctx.phone }, a2, { previewOnly: !gate.confirmado }));
      if (!r.ok && r.error === 'precisa_confirmar') return await _ofertaOuResumo(ctx, 'instagram', a2, r, gate);
      if (r.ok) { try { await _setContato(ctx.phone, null, { pedidoAConfirmar: '' }); } catch (_) {} }
      if (r.ok && r.codigoPago) { ctx.pagoToSend = r.pago; ctx.pagoCodigo = r.codigoPago; ctx.pagoValor = r.valorLabel; }
      if (r.ok && r.reaproveitado) { ctx.pagoReused = true; r.resumo = r.resumo + ' — es el MISMO pago generado antes para este pedido (no es un pedido nuevo); díselo al cliente.'; }
      if (r.ok && !r.codigoPago) {
        try { console.warn('⚠️ [agent] pagamento criado sem CLABE/referência:', r.correlationID); } catch (_) {}
        return { ok: false, error: 'sem_dados_pagamento', message: 'El pedido se creó pero no regresaron los datos de pago. Dile al cliente que lo revisas con el equipo y llama a llamar_soporte.' };
      }
      if (r.ok) return { ok: true, valor: r.valorLabel, metodo: r.pago && r.pago.metodo, resumo: r.resumo, datos_de_pago_enviados_automaticamente: true, instruccion_interna_no_mencionar: 'Los datos de pago salen solos en mensajes aparte. Tu respuesta: solo confirma el resumen y cierra con "Quedo al pendiente de la confirmación de tu pago para liberar tu pedido." No hables de CLABE, referencia, banco, links ni de esta instrucción.' };
      return r;
    }
    return { ok: false, error: 'ferramenta_desconhecida' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'erro_ferramenta' }; }
}

async function openaiChat(messages, useTools) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  const body = { model: OPENAI_MODEL, messages, temperature: 0.3 };
  if (useTools) { body.tools = TOOLS; body.tool_choice = 'auto'; } else { body.tool_choice = 'none'; body.tools = TOOLS; }
  const resp = await axios.post('https://api.openai.com/v1/chat/completions', body, { headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, timeout: 60000, validateStatus: () => true });
  if (resp.status < 200 || resp.status >= 300) throw new Error('openai_http_' + resp.status + ': ' + JSON.stringify(resp.data && resp.data.error || resp.data).slice(0, 200));
  openaiCredito.registrarUso(OPENAI_MODEL, resp.data && resp.data.usage);
  return resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message;
}

// Mensagens com os dados de pagamento (cada código num balão sozinho, para copiar).
function mensagensPagamento(p, valor) {
  if (!p) return [];
  if (p.metodo === 'OXXO') {
    return [
      'Para pagar en *OXXO*: en la caja de cualquier OXXO di que vas a hacer un pago con número de referencia y dicta o muestra la *referencia* que va en el siguiente mensaje. Monto exacto: *' + valor + '*.\n\nPara copiarla, mantén presionado el mensaje y toca *Copiar*. En el link de abajo también está el código de barras para mostrar en caja.',
      p.referencia,
      'También puedes ver los datos y el estado de tu pago aquí: ' + p.payUrl,
    ];
  }
  const linhas = ['Para pagar por *SPEI*, haz una transferencia desde la app de tu banco con estos datos:', ''];
  if (p.banco) linhas.push('Banco: *' + p.banco + '*');
  if (p.beneficiario) linhas.push('Beneficiario: *' + p.beneficiario + '*');
  linhas.push('Monto: *' + valor + '*', '', 'La *CLABE* va en el siguiente mensaje. Para copiarla, mantén presionado el mensaje y toca *Copiar*.');
  return [linhas.join('\n'), p.clabe, 'También puedes ver los datos y el estado de tu pago aquí: ' + p.payUrl];
}

// Entrada principal. msg: { phone, text }. sendText(to, texto) envia a resposta.
async function handleAgentMessage(msg, sendText) {
  const phone = String(msg && (msg.phone || msg.from) || '').trim();
  const text = String(msg && msg.text || '').trim();
  if (!phone || !text) return;

  if (!isEnabled()) { return handleSalesMessage(msg, sendText); }

  const ctx = { phone, support: false, pagoToSend: null, pagoCodigo: '', text };
  const hist = await loadHistory(phone);
  ctx.recentUserTexts = [text].concat((hist || []).filter((h) => h && h.role === 'user').slice(-4).map((h) => String(h.content || '')));
  ctx.allUserTexts = [text].concat((hist || []).filter((h) => h && h.role === 'user').map((h) => String(h.content || '')));
  try {
    const achados = (hist || []).filter((h) => h && h.role === 'assistant').map((h) => String(h.content || '').match(/Encontr[ée] tu perfil!?\s*@([A-Za-z0-9_.]+)/i)).filter(Boolean);
    if (achados.length) ctx.histUsername = achados[achados.length - 1][1].replace(/[.,]+$/, '');
  } catch (_) {}
  let finalText = '';
  let pulaModelo = false;
  const notasSistema = [];
  const ultimaBot = String(((hist || []).filter((h) => h && h.role === 'assistant' && typeof h.content === 'string').slice(-1)[0] || {}).content || '');
  const ct = await _getContato(phone);
  // Recusa ("ya no quiero", "no gracias") com cobrança aberta: para os lembretes de pagamento.
  try { if (RE_RECUSA.test(text)) { await sales.marcarPedidosAbertos(phone, 'recusou', text); if (ct.pedidoAConfirmar) await _setContato(phone, null, { pedidoAConfirmar: '' }); ct.pedidoAConfirmar = null; } } catch (_) {}
  // Oferta de dobrar o pedido (enviada 90 s depois do pagamento): só um SÍ claro gera a cobrança.
  try {
    const od = ct.ofertaDobro;
    if (od && od.status === 'ativa') {
      const viva = new Date(od.expiraAt).getTime() > Date.now();
      const ultimaFoiOferta = /descuento/i.test(ultimaBot) && /(\*S[IÍ]\*|\bS[IÍ]\b)/.test(ultimaBot);
      const pergunta = /\?|^\s*(qu[eé]|c[oó]mo|cu[aá]nt[oa]s?|cu[aá]l|cu[aá]ndo|es\s|son\s|para\s|y\s+si|puedo|se\s+puede|sirve|tambi[eé]n)/i.test(text);
      if (!viva) await _setContato(phone, { 'ofertaDobro.status': 'expirada' });
      else if (ultimaFoiOferta && RE_SIM_DOBRO.test(text)) {
        const r = await sales.criarPedidoDobro(od.token, phone);
        if (r && r.ok && r.codigoPago) {
          ctx.pagoToSend = r.pago; ctx.pagoCodigo = r.codigoPago; ctx.pagoValor = r.valorLabel;
          finalText = '¡Perfecto! Ya generé tu pago de *' + r.valorLabel + '* por ' + (r.desc ? ('*' + r.desc + '*') : 'tu pedido') + ' con el 40% de descuento. Quedo al pendiente de la confirmación de tu pago para liberar tu pedido.';
          pulaModelo = true;
          await _setContato(phone, { 'ofertaDobro.status': 'aceita', 'ofertaDobro.aceitaAt': new Date() });
          try { console.log('💰 [dobro] aceita ' + phone + ' ' + r.valorLabel); } catch (_) {}
        } else {
          notasSistema.push('El cliente aceptó la oferta de llevar otra vez su pedido con 40% de descuento, pero el sistema no pudo generar el pago (' + ((r && (r.error || r.message)) || 'error') + '). Dile que lo revisas con el equipo y llama a llamar_soporte.');
        }
      } else if (ultimaFoiOferta && !pergunta) {
        await _setContato(phone, { 'ofertaDobro.status': 'recusada', 'ofertaDobro.respostaTexto': text.slice(0, 200) });
      } else {
        notasSistema.push('OFERTA ACTIVA (válida hasta ' + new Date(od.expiraAt).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' }) + ', hora de México): el cliente puede llevar otra vez ' + (od.desc || 'su pedido') + ' por ' + mxnLabel(od.precoCents) + ' (40% de descuento). Si pregunta por ella, explícala en 1 frase y termina pidiendo que responda *SÍ* para generar el pago con el descuento. NO llames generar_pago para esta oferta: el sistema la genera cuando el cliente responde SÍ.');
      }
    }
  } catch (_) {}
  // Oferta do pacote seguinte saiu junto com "¡Encontré tu perfil!": "sí, es correcto" confirma o PERFIL, não aceita a oferta
  // (simulação 22/11: "si es correcto" virou 1.000 no lugar de 500). Só "lo quiero", "el de N", "va", "dale"... aceitam.
  try {
    if (/Antes de generar tu pago: por solo/.test(ultimaBot) && ct.ofertaMejora && ct.ofertaMejora.de) {
      const soPerfil = /(es\s+correcto|correct[oa]|es\s+mi\s+(perfil|cuenta|usuario)|ese\s+es|s[ií],?\s+soy\s+yo|as[ií]\s+es)/i.test(text);
      const aceita = /(lo\s+quiero|la\s+quiero|el\s+de\s+[\d,.]+|los\s+[\d,.]+|me\s+lo\s+llevo|s[ií]\s+quiero|mejor\s+(el|los)|\bva\b|dale|[aá]ndale|sale|acepto|sube|el\s+grande)/i.test(text);
      if (soPerfil && !aceita) notasSistema.push('El cliente SOLO confirmó que el perfil es correcto; NO aceptó la oferta del paquete mayor. Llama generar_pago con la cantidad ORIGINAL (' + ct.ofertaMejora.de + ') y los mismos datos, sin volver a ofrecer.');
    }
  } catch (_) {}
  // Resumo "¿Todo bien?" esperando o cliente: "sí" claro gera o pagamento com os dados guardados (sem a IA).
  try {
    const pc = ct.pedidoAConfirmar;
    if (!pulaModelo && pc && pc.at && (Date.now() - new Date(pc.at).getTime()) < 3 * 3600e3 && pc.args) {
      if (/Te confirmo tu pedido:/.test(ultimaBot) && /¿Todo bien\?\s*$/.test(ultimaBot) && RE_SIM.test(text)) {
        ctx.confirmado = true;
        if (pc.rede === 'instagram') ctx.validatedUsername = String(pc.args.usuario || '').replace(/^@+/, ''); else if (pc.validatedRede) ctx.validatedRede = pc.validatedRede;
        const r = await runTool('generar_pago', Object.assign({}, pc.args, { rede: pc.rede }), ctx);
        await _setContato(phone, null, { pedidoAConfirmar: '' });
        if (r && r.ok && ctx.pagoToSend) {
          finalText = '¡Listo! Ya generé tu pago de *' + r.valor + '*' + (ctx.pagoReused ? ' (es el mismo pago de antes, no se genera uno nuevo)' : '') + '. Quedo al pendiente de la confirmación de tu pago para liberar tu pedido.';
          pulaModelo = true;
        } else {
          notasSistema.push('El cliente confirmó el resumen del pedido, pero generar_pago regresó: ' + JSON.stringify(r || {}).slice(0, 400) + '. Explícale qué falta o qué pasó y resuélvelo.');
        }
      } else {
        notasSistema.push('Hay un RESUMEN de pedido esperando la confirmación del cliente:\n' + String(pc.resumo || '') + '\nSi el cliente lo confirma, llama generar_pago con esos mismos datos; si corrige algo (cantidad, tipo, @, links, método), llama generar_pago con los datos corregidos.');
      }
    }
  } catch (_) {}
  // 1ª mensagem genérica ("Quiero comprar seguidores", "más información", "precios"): resposta FIXA, curta e com os
  // preços oficiais (22/11: o modelo inventava preço na 1ª resposta e mandava 2 tabelas de 10 linhas).
  if (!pulaModelo) try {
    const primeira = !(hist || []).some((h) => h && h.role === 'assistant');
    const generica = /(m[aá]s\s+informaci[oó]n|info\b|precio|cu[aá]nto\s+(cuesta|cuestan|sale|est[aá])|quiero\s+(comprar\s+)?seguidores|me\s+interesa|crecer\s+mi\s+perfil|^\s*[¡!]?\s*hola\s*[.!]*\s*$)/i.test(text);
    const especifica = /(tik\s*tok|facebook|\bfb\b|gusta|likes?|vistas|views|visualiza|coment|reales|real\b|latin|@|instagram\.com|\d{2,})/i.test(text);
    if (primeira && generica && !especifica) {
      const disp = await sales.tiposDisponiveis().catch(() => null);
      const segTipos = (disp && disp.seguidores) || ['mistos', 'organicos'];
      if (segTipos.includes('mistos')) {
        const QTDS = [100, 250, 500, 1000, 2000];
        const linhas = (tabelaSeguidores.mistos || []).filter((x) => QTDS.includes(Number(x.q))).map((x) => '- ' + Number(x.q).toLocaleString('en-US') + ': ' + fmtMx(parsePrecoToCents(x.p)) + ' MXN');
        if (linhas.length >= 3) {
          finalText = '¡Hola! Estos son los paquetes más pedidos de *seguidores mixtos* para Instagram (perfiles de México, con reposición gratis por 30 días):\n' + linhas.join('\n') +
            '\n\nTenemos hasta 20,000.\n\n¿Cuántos quieres? Mándame también tu @ de Instagram y te dejo el pedido listo.';
          pulaModelo = true;
        }
      }
    }
  } catch (_) {}
  // Pediu de novo os dados de pagamento e tem cobrança do bot em aberto → reenvia a MESMA
  // (sem modelo, sem cobrança nova). Trocar SPEI↔OXXO continua indo pelo modelo (generar_pago).
  if (!pulaModelo) try {
    // "¿referencias?", "¿muestras gratis?" = pedido de PROVA, não da referência de pagamento (20/11: virou loop de reenvio).
    const pedeProva = /(referencias|muestra|gratis|opini|testimon|rese[ñn]|prueba|estaf|confia|confío|garant)/i.test(text);
    // 21/11: "¿y el número?", "¿este es el número que doy en el OXXO?", "el código de barras" também pedem os dados
    // (o bot dizia "se envían en mensajes aparte" e não mandava → cliente sem a referência).
    const pedeDados = !pedeProva && /(clabe|referencia(?!s)|n[uú]mero(?!\s+de\s+(seguidores|me\s+gusta|likes|vistas|comentarios|tel|celular|whats))|c[oó]digo|barras|datos\s+(de(l)?\s+)?pago|los\s+datos|c[oó]mo\s+(le\s+)?pago|d[oó]nde\s+pago|m[aá]nda(me)?\s+(otra\s+vez|de\s+nuevo|los\s+datos|el\s+n)|reenv[ií]a|no\s+(me\s+)?(lleg[oó]|aparece)\s+(la\s+)?(clabe|referencia|n[uú]mero))/i.test(text);
    // Já pagou ("ya pagué", "ya lo hice", "ya page", "ya ise el pago"): NÃO gera nem reenvia cobrança — avisa que confirma sozinho.
    // 21/11 (@_mtzzaxell): "ya está el pago" não entrava e o lembrete foi mesmo assim.
    const dizPagou = !pedeProva && /\b(ya\s+(lo\s+)?(pagu[ée]|page|pag[ó]|hice|ise|lo\s+hice|lo\s+ise|realic[ée]|deposit[ée]|transfer[ií])|ya\s+(hice|ise|realic[ée])\s+(el|mi)\s+(pago|dep[oó]sito|transferencia)|pago\s+(hecho|realizado|enviado)|ya\s+est[aá]\s+(el\s+|mi\s+)?(pago|pagado|depositado|transferido|hecho)|ya\s+qued[oó]\s+(el\s+)?pago|listo,?\s+ya\s+(pagu[ée]|deposit[ée]|transfer[ií])|ya\s+te\s+(pagu[ée]|deposit[ée]|transfer[ií])|ah[ií]\s+(est[aá]|va|te\s+va)\s+(el\s+)?comprobante|te\s+(mando|env[ií]o|paso)\s+(el\s+)?comprobante|(pago|dep[oó]sito|transferencia)\s+(ya\s+)?(ha\s+sido|fue)\s+(enviad[oa]|realizad[oa]|hech[oa])|ya\s+(te\s+)?(envi[ée]|mand[ée])\s+(el\s+|la\s+)?(pago|dinero|dep[oó]sito|transferencia)|la\s+transferencia\s+ya\s+(est[aá]|se\s+hizo|qued[oó])|(checa|revisa|cheque)\s+(la|tu)\s+cuenta)(?![a-zá-úñ])/i.test(text);
    if (dizPagou) { try { await sales.marcarPedidosAbertos(phone, 'clienteDisseQuePagou', text); } catch (_) {} }
    const ab = (pedeDados || dizPagou) ? await sales.ultimoPagoAberto(phone) : null;
    // Só é troca de método se citar um método DIFERENTE do pagamento aberto ("este número doy en el OXXO" com OXXO aberto = pede dados).
    const citaOxxo = /(oxxo|efectivo|tienda)/i.test(text), citaSpei = /(spei|transferencia|banco)/i.test(text);
    const metAberto = ab && ab.pago ? String(ab.pago.metodo || '').toUpperCase() : '';
    const trocaMetodo = (citaOxxo && metAberto !== 'OXXO') || (citaSpei && !citaOxxo && metAberto !== 'SPEI');
    if (dizPagou && ab && ab.codigoPago && !ab.parcial) {
      const oxxo = metAberto === 'OXXO';
      const msgPagou = '¡Gracias! En cuanto el pago se confirme te aviso aquí mismo y tu pedido se libera solo, no tienes que hacer nada más. ' + (oxxo ? 'Con OXXO la confirmación puede tardar hasta 1 hora (a veces un poco más).' : 'Con SPEI la confirmación suele llegar en minutos.');
      let jaDisse = false;
      try { const cm = await getCollection('wa_ia_messages'); jaDisse = !!(await cm.findOne({ phone, direction: 'out', text: msgPagou, createdAt: { $gte: new Date(Date.now() - 5 * 60e3) } }, { projection: { _id: 1 } })); } catch (_) {}
      await saveHistory(phone, hist.concat([{ role: 'user', content: text }, { role: 'assistant', content: msgPagou }]));
      if (!jaDisse) { try { await sendText(phone, msgPagou); } catch (_) {} }
      else await _marcaSilencio(phone);   // calado de propósito: o vigia de silêncio não refaz o turno
      return { awaitingConfirm: false, username: '' };
    }
    if (pedeDados && !trocaMetodo) {
      if (ab && ab.codigoPago) {
        const intro = ab.parcial
          ? '¡Claro! Ya recibimos una parte de tu pago' + (ab.pacote ? (' (' + ab.pacote + ')') : '') + '. Falta *' + ab.valorLabel + '*: transfiérelo a la misma CLABE y tu pedido se libera automáticamente.'
          : '¡Claro! Te mando otra vez los datos de tu pago' + (ab.pacote ? (' (' + ab.pacote + ')') : '') + '. Es el mismo pago de antes, no se genera uno nuevo.';
        await saveHistory(phone, hist.concat([{ role: 'user', content: text }, { role: 'assistant', content: intro }]));
        try { await sendText(phone, intro); } catch (_) {}
        for (const m of mensagensPagamento(ab.pago, ab.valorLabel)) {
          if (!m) continue;
          await new Promise((r) => setTimeout(r, MSG_GAP_MS));
          try { await sendText(phone, m); } catch (_) {}
        }
        return { awaitingConfirm: false, username: '' };
      }
    }
  } catch (_) {}
  try { const est = await sales.estadoCliente(phone); if (est && est.texto) notasSistema.unshift(est.texto); } catch (_) {}
  let _dispTipos = null; try { _dispTipos = await sales.tiposDisponiveis(); } catch (_) {}
  const work = [{ role: 'system', content: systemPrompt(_dispTipos) }, ...hist].concat(notasSistema.map((n) => ({ role: 'system', content: n })), [{ role: 'user', content: text }]);

  if (!pulaModelo) try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const m = await openaiChat(work, true);
      if (!m) break;
      work.push(m);
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      if (!calls.length) { finalText = String(m.content || '').trim(); break; }
      for (const call of calls) {
        let args = {}; try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) {}
        const result = await runTool(call.function.name, args, ctx);
        work.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    // Rede 1: prometeu gerar o pagamento e não chamou a ferramenta → força a chamada.
    if (finalText && !ctx.pagoToSend && !ctx.support && !ctx.textoFixo && /(voy\s+a\s+generar|generar(?:\s+el|\s+tu)?\s+(?:pago|pedido|referencia|clabe)|generando|un\s+momento|espera(?:me)?\b|procesando|estoy\s+(?:generando|creando|preparando)|ya\s+te\s+(?:genero|mando|paso)\s+(?:el|los)\s+(?:pago|datos))/i.test(finalText)) {
      try {
        work.push({ role: 'system', content: 'Prometiste generar el pago pero NO llamaste la herramienta. El cliente ya dio los datos en la conversación. Llama AHORA generar_pago con servicio, tipo, cantidad, usuario (@), nombre y método ya reunidos. NO pidas datos nuevos ni pidas esperar.' });
        for (let r2 = 0; r2 < 2; r2++) {
          const mf = await openaiChat(work, true);
          if (!mf) break;
          work.push(mf);
          const calls2 = Array.isArray(mf.tool_calls) ? mf.tool_calls : [];
          if (!calls2.length) { const t = String(mf.content || '').trim(); if (t) finalText = t; break; }
          for (const call of calls2) {
            let args2 = {}; try { args2 = JSON.parse(call.function.arguments || '{}'); } catch (_) {}
            const result2 = await runTool(call.function.name, args2, ctx);
            work.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result2) });
          }
        }
        if (ctx.pagoToSend && /(un\s+momento|espera|voy\s+a\s+generar|procesando)/i.test(finalText)) {
          const mc = await openaiChat(work, false);
          const t = String((mc && mc.content) || '').trim();
          finalText = t || '¡Listo! Ya generé tu pago — los datos van en los siguientes mensajes. Quedo al pendiente de la confirmación de tu pago para liberar tu pedido.';
        }
      } catch (_) {}
    }
    // Rede 1b: perguntou "¿SPEI u OXXO?" sem o cliente ter falado de OXXO → SPEI é o padrão: segue sem perguntar.
    // (19–22/11: 17 de 35 cobranças do bot saíram em OXXO e só 3 foram pagas; SPEI pagou 50%.)
    if (finalText && !ctx.pagoToSend && !ctx.support && !ctx.textoFixo
        && /(spei|transferencia)[^?\n]{0,60}\b(o|u)\s+(en\s+|por\s+)?oxxo[^?\n]{0,40}\?|oxxo[^?\n]{0,60}\b(o|u)\s+(por\s+)?(spei|transferencia)[^?\n]{0,40}\?|(c[oó]mo|qu[eé]\s+m[eé]todo)[^?\n]{0,40}(pagar|pago)[^?\n]{0,40}\?/i.test(finalText)
        && !/(oxxo|efectivo|tienda)/i.test((ctx.allUserTexts || [text]).join(' '))) {
      try {
        work.push({ role: 'system', content: 'NO preguntes el método de pago: el pago es por SPEI. Si ya tienes servicio, tipo, cantidad y el @ validado (confirmado por el cliente), llama generar_pago AHORA con metodo=SPEI. Si falta validar o confirmar el @, pide/valida solo eso, sin mencionar OXXO.' });
        for (let r3 = 0; r3 < 2; r3++) {
          const mf = await openaiChat(work, true);
          if (!mf) break;
          work.push(mf);
          const calls3 = Array.isArray(mf.tool_calls) ? mf.tool_calls : [];
          if (!calls3.length) { const t = String(mf.content || '').trim(); if (t) finalText = t; break; }
          for (const call of calls3) {
            let args3 = {}; try { args3 = JSON.parse(call.function.arguments || '{}'); } catch (_) {}
            if (call.function.name === 'generar_pago' && !args3.metodo) args3.metodo = 'SPEI';
            const result3 = await runTool(call.function.name, args3, ctx);
            work.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result3) });
          }
        }
      } catch (_) {}
      if (ctx.textoFixo) finalText = ctx.textoFixo;
    }
    // Rede 2: só chamou ferramentas, sem texto → força uma resposta final.
    if (!finalText && !ctx.textoFixo) {
      const m2 = await openaiChat(work, false);
      finalText = String((m2 && m2.content) || '').trim();
    }
  } catch (e) {
    finalText = FALLBACK_FALHA;
    try { console.error('❌ whatsappAgent erro:', e && e.message); } catch (_) {}
  }
  // Oferta do pacote seguinte / resumo "¿Todo bien?": o texto é do sistema, não da IA.
  if (ctx.textoFixo) finalText = ctx.textoFixo;

  // ERRO NA REPOSIÇÃO: já tentou pelo link e deu erro → suporte humano, sem reenviar link.
  let erroRefilTratado = false;
  try {
    const erroRe = /(error|fall[óo]|falla|no\s+(puedo|pude|sirve|funciona|funcion[óo]|carga|abre|abri[óo]|acepta|deja|me\s+deja|jala)|no\s+est[áa]\s+funcionando|no\s+disponible|sale\s+(un\s+)?(error|problema))/i;
    const refilRe = /(reposici[oó]n|reponer|refil|refill|link|enlace)/i;
    const ultimasDoCliente = [text].concat((hist || []).filter((h) => h && h.role === 'user').slice(-2).map((h) => String(h.content || '')));
    const ultimaDoBot = (hist || []).filter((h) => h && h.role === 'assistant').slice(-1)[0];
    const jaMandamosLink = !!(ultimaDoBot && /reposicion\?token=/i.test(String(ultimaDoBot.content || '')));
    const culpaDoCliente = /(error\s+(fue|es)\s+m[íi]o|mi\s+error|me\s+equivoqu[ée])/i.test(String(text || ''));
    const falaDeErro = !culpaDoCliente && erroRe.test(String(text || ''));
    const assuntoRefil = refilRe.test(ultimasDoCliente.join(' ')) || jaMandamosLink;
    if (falaDeErro && assuntoRefil && !ctx.pagoToSend) {
      finalText = 'Entiendo, la página de reposición te está marcando error. En ese caso el link no lo va a resolver — ya estoy pasando tu caso a *soporte* para revisarlo y resolver tu reposición. En cuanto lo revisemos, te escribo por aquí.';
      ctx.support = true; ctx.quedaResolved = true; erroRefilTratado = true;
      try { await sales.flagSupport(phone, 'Erro ao solicitar reposição pelo link'); } catch (_) {}
      try {
        const c = await getCollection('whatsapp_contacts');
        await c.updateOne({ _id: String(phone) }, { $set: { flag: 'erro_refil', botPaused: true, supportReason: 'Erro na página de reposição', supportAt: new Date().toISOString() } }, { upsert: true });
      } catch (_) {}
    }
  } catch (_) {}

  // CAÍDA: resposta seca (só o link) ou, nos reales, verificação + estabilidade + humano.
  try {
    const quedaRe = /(se\s+(me\s+)?(cayeron|bajaron|fueron)|cayeron|baj(aron|[óo])\s+(mis\s+)?seguidores|perd[íi][^.]*seguidor|desaparec|disminu|reposici[oó]n|reponer|refil)/i;
    const userMsgs = [text].concat((hist || []).filter((h) => h && h.role === 'user').slice(-2).map((h) => String(h.content || '')));
    const isQueda = userMsgs.some((t) => quedaRe.test(t));
    const cp = ctx.lastConsulta;
    if (isQueda && cp && cp.encontrado && !ctx.support && !ctx.pagoToSend && !erroRefilTratado) {
      if (cp.ehReales) {
        finalText = '¡Puedes estar tranquilo(a)! Voy a revisar tu pedido, pero no te preocupes: los *seguidores de alta calidad* son nuestro servicio más estable, con una caída de solo 5-6% en un periodo de más de un mes.';
        ctx.quedaResolved = true;
        try {
          const c = await getCollection('whatsapp_contacts');
          await c.updateOne({ _id: String(phone) }, { $set: { flag: 'queda_reais', botPaused: true, supportReason: 'Queda em seguidores reales', supportAt: new Date().toISOString() } }, { upsert: true });
        } catch (_) {}
        try { await sales.avisarResponsavelWhatsapp('📉 You Agency: cliente +' + String(phone).replace(/\D/g, '') + ' reclamou de queda em seguidores reales. O bot pausou a conversa. CRM: ' + PUBLIC_BASE + '/painel/ia-crm'); } catch (_) {}
        try { await sales.sendNtfy({ title: '+' + String(phone).replace(/\D/g, '') + ' - queda reales', message: 'Cliente reclamou de queda e o último pedido é reales. A IA foi pausada — veja no CRM.', priority: 'high', tags: 'chart_with_downwards_trend', click: PUBLIC_BASE + '/painel/ia-crm' }); } catch (_) {}
      } else if (cp.refilLink) {
        finalText = '¡Claro! Puedes reponer los seguidores que se cayeron aquí: ' + cp.refilLink;
        ctx.quedaResolved = true;
      }
    }
    if (isQueda && cp && cp.ok && !cp.encontrado && cp.buscaPor === 'telefone' && !ctx.support && !ctx.pagoToSend && !erroRefilTratado) {
      finalText = 'Para encontrar tu pedido, ¿me pasas el *nombre de usuario* (@) del perfil de Instagram con el que hiciste la compra?';
      ctx.quedaResolved = true;
    }
  } catch (_) {}

  // Link de reposição INVENTADO: só passa token que existe num pedido.
  try {
    const reLink = /https?:\/\/(?:www\.)?youagency\.site\/reposicion\?token=([A-Za-z0-9_-]*)/gi;
    const tokens = [...new Set([...String(finalText || '').matchAll(reLink)].map((mm) => mm[1]))];
    if (tokens.length) {
      const orders = await getCollection('checkout_orders');
      const invalidos = [];
      for (const tk of tokens) {
        const ok = tk.length >= 8 && !!(await orders.findOne({ refilLinkId: tk }, { projection: { _id: 1 } }).catch(() => null));
        if (!ok) invalidos.push(tk);
      }
      if (invalidos.length) {
        const semLink = String(finalText).replace(reLink, (full, tk) => (invalidos.includes(tk) ? '' : full)).replace(/[ \t]+\n/g, '\n').trim();
        finalText = /youagency\.site\/reposicion\?token=/i.test(semLink)
          ? semLink
          : 'Para encontrar tu pedido y liberar la reposición, ¿me pasas el *nombre de usuario* (@) del perfil de Instagram con el que hiciste la compra?';
      }
    }
  } catch (_) {}

  // Preço inventado → reescreve com a tabela oficial; se insistir, manda a tabela direto.
  try {
    let erradosP = (ctx.textoFixo || pulaModelo) ? [] : acharPrecosErrados(finalText);
    if (erradosP.length && !erroRefilTratado) {
      try { console.warn('💸 [agent] precio fuera de la tabla:', JSON.stringify(erradosP)); } catch (_) {}
      const cats = [...new Set(erradosP.map((e) => e.cat))];
      const oficial = cats.map((c) => tabelaOficialTexto(c)).join('\n\n');
      work.push({ role: 'system', content: 'CORRECCIÓN OBLIGATORIA: tu respuesta citó precio/cantidad que NO existe en la tabla oficial (' + erradosP.map((e) => e.trecho).join(' | ') + '). Reescribe la MISMA respuesta usando SOLO estos precios y cantidades oficiales (si la cantidad pedida no existe, di cuáles existen):\n\n' + oficial });
      try { const mC = await openaiChat(work, false); const novo = String((mC && mC.content) || '').trim(); if (novo) finalText = novo; } catch (_) {}
      erradosP = acharPrecosErrados(finalText);
      if (erradosP.length) finalText = 'Te paso los precios oficiales:\n\n' + oficial + '\n\n¿Qué cantidad quieres?';
    }
  } catch (_) {}
  try { finalText = corrigirTaxaQueda(finalText); } catch (_) {}
  try {
    const cp = ctx.lastConsulta;
    const naoAchou = /(no\s+(he\s+)?(podido|pude)\s+(encontrar|localizar|ubicar)|no\s+(encontr[ée]|ubiqu[ée]|localic[ée])|no\s+aparece\s+tu\s+pedido|conf[ií]rma(me)?\s+tu\s+@)/i.test(finalText);
    if (cp && cp.aguardandoPagamento && !ctx.pagoToSend && !ctx.support && (naoAchou || !finalText)) {
      const disse = cp.clienteDisseQuePagou || /(pagu[ée]|deposit[ée]|transfer[ií]|comprobante|ya\s+est[aá]|enviad[oa])/i.test(text);
      finalText = 'Ya encontré tu pedido: *' + cp.pacote + '*' + (cp.usuario ? ' para @' + cp.usuario : '') + ' (' + cp.valor + ' por ' + cp.metodo + '). ' +
        (disse ? 'Todavía no nos llega la confirmación del banco; ' + (cp.metodo === 'OXXO' ? 'con OXXO puede tardar hasta 1 hora' : 'con SPEI normalmente tarda unos minutos, a veces un poco más') + '. En cuanto se confirme tu pedido se libera solo y te aviso aquí mismo. Si en 30 minutos no se confirma, el equipo lo revisa.'
               : 'Está listo y esperando tu pago; en cuanto se confirme empieza la entrega y te aviso aquí mismo.');
      if (disse) { try { await sales.marcarPedidosAbertos(phone, 'clienteDisseQuePagou', text); } catch (_) {} }
    }
  } catch (_) {}
  // Travas de texto: marcador/exemplo vazado, "mixtos reales / no son bots" e entrega prometida "en minutos".
  try {
    if (finalText && !ctx.textoFixo && !pulaModelo) {
      const probs = [];
      if (/\[(?!El cliente)[^\]\n]{2,60}\]|\b1234567890\b|\b[Xx]{5,}\b|<[a-zA-Z_ ]{2,30}>/.test(finalText)) probs.push('escribiste un marcador o texto de ejemplo (como "[código]", "1234567890" o "XXXXX") — el cliente lo ve tal cual; quítalo');
      if (/mixtos(?:(?!si\s+(quieres|buscas|prefieres)|;|\bpero\b)[^.\n]){0,120}(reales\s+y\s+activos|personas\s+reales|perfiles\s+reales|no\s+son\s+(falsos|bots|robots)|son\s+reales)/i.test(finalText)) probs.push('dijiste que los mixtos son reales/no son bots — eso no es verdad; usa la respuesta de "¿SON BOTS?"');
      if (/(llegan|entran|recibes|recibir[aá]s|empiezan|comienzan|tendr[aá]s|ver[aá]s)[^.\n]{0,50}(en\s+(unos\s+|pocos\s+|\d+\s+)?minutos|a\s+los\s+pocos\s+minutos)/i.test(finalText) && !/(confirma|confirmaci[oó]n|pago)[^.\n]{0,30}minutos/i.test(finalText)) probs.push('prometiste que la entrega llega en minutos — di que empiezan a entrar poco después de confirmado el pago, de forma gradual, sin prometer minutos');
      try { const dsp = _dispTipos || {}; const semAlta = Array.isArray(dsp.seguidores) && !dsp.seguidores.includes('organicos'); if (/seguidores\s+\*?reales\*?/i.test(finalText) && !/me\s+gusta\s+reales/i.test(finalText)) probs.push(semAlta ? 'hablaste de seguidores *reales*, pero hoy NO están disponibles — deja solo los *mixtos*' : 'llamaste "seguidores reales" a los seguidores de alta calidad — el nombre para el cliente es *seguidores de alta calidad*'); else if (semAlta && /alta\s+calidad[\s\S]{0,300}?\$\s*\d/i.test(finalText)) probs.push('ofreciste seguidores de alta calidad con precio, pero hoy NO están disponibles — deja solo los *mixtos*'); } catch (_) {}
      if (probs.length) {
        try { console.warn('🧯 [agent] trava de texto:', probs.join(' | ')); } catch (_) {}
        work.push({ role: 'assistant', content: finalText });
        work.push({ role: 'system', content: 'CORRECCIÓN OBLIGATORIA antes de mandar: ' + probs.join('; ') + '. Reescribe la MISMA respuesta corregida (mismo contenido útil, sin esos errores).' });
        try { const mC = await openaiChat(work, false); const novo = String((mC && mC.content) || '').trim(); if (novo) finalText = novo; } catch (_) {}
        // Se insistir: tira só as frases com o problema.
        finalText = String(finalText).split('\n').map((l) => _frases(l).filter((f) => !/\[(?!El cliente)[^\]\n]{2,60}\]|\b1234567890\b|\b[Xx]{5,}\b/.test(f) && !/mixtos(?:(?!si\s+(quieres|buscas|prefieres)|;|\bpero\b)[^.\n]){0,120}(reales\s+y\s+activos|personas\s+reales|perfiles\s+reales|no\s+son\s+(falsos|bots|robots)|son\s+reales)/i.test(f)).join(' ')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      }
    }
  } catch (_) {}
  // Pedido com PROBLEMA (sem envio, erro, cancelado, travado): o modelo às vezes ignora precisaSuporte e diz
  // "en proceso, puedes estar tranquilo" (20/11: envio em erro). Aqui a resposta é fixa e o responsável é avisado.
  try {
    const cp = ctx.lastConsulta;
    if (cp && cp.encontrado && cp.precisaSuporte && !ctx.pagoToSend && !ctx.quedaResolved && !erroRefilTratado) {
      finalText = 'Ya encontré tu pedido' + (cp.quantidade ? (' de *' + Number(cp.quantidade).toLocaleString('en-US') + ' ' + (cp.servico || 'seguidores') + '*') : '') + (cp.usuario ? (' para @' + cp.usuario) : '') + '. Lo estoy revisando con el equipo para que la entrega avance; en cuanto lo tengamos listo te escribo por aquí.';
      if (!ctx.support) { ctx.support = true; try { await sales.flagSupport(phone, 'Pedido com problema (' + (cp.motivoSuporte || 'precisaSuporte') + ') @' + (cp.usuario || '?')); } catch (_) {} }
    }
  } catch (_) {}
  try {
    const assuntoReposicao = /(cayeron|cay[óo]|bajaron|baj[óo]|perd[íi]|desaparec|disminu|reposici|reponer|refil|refill)/i.test((ctx.recentUserTexts || [text]).slice(0, 3).join(' '));
    if (!assuntoReposicao && !ctx.quedaResolved) finalText = tirarLinkReposicao(finalText);
  } catch (_) {}

  const newHist = hist.concat([{ role: 'user', content: text }]);
  if (finalText) newHist.push({ role: 'assistant', content: finalText });
  await saveHistory(phone, newHist);

  if (REPLY_DELAY_MS > 0) { try { await new Promise((r) => setTimeout(r, REPLY_DELAY_MS)); } catch (_) {} }

  if (ctx.pagoToSend) finalText = stripPagoFromText(finalText, ctx.pagoCodigo);
  // Instrução interna que o modelo repetiu para o cliente ("no escribas la CLABE...") sai do texto.
  finalText = String(finalText || '').split('\n').map((l) => _frases(l).filter((f) => !/(no\s+escribas|el\s+sistema\s+ya\s+(te\s+)?(envi|mand)|instrucci[oó]n\s+interna)/i.test(f)).join(' ')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  finalText = sanitizeForWhatsapp(finalText);
  finalText = finalText.replace(/\b([Mm])ixtos(?:s+|os)\b/g, '$1ixtos');
  if (finalText) {
    let bolhas = splitIntoBubbles(finalText);
    try {
      const pal = (t) => new Set(String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
      const parecido = (x, y) => { const A1 = pal(x), B1 = pal(y); if (A1.size < 4 || B1.size < 4) return false; let i = 0; for (const w of A1) if (B1.has(w)) i++; return i / Math.min(A1.size, B1.size) >= 0.8; };
      let recentes = [];
      try { const cm = await getCollection('wa_ia_messages'); recentes = (await cm.find({ phone, direction: 'out', createdAt: { $gte: new Date(Date.now() - 10 * 60e3) } }).project({ text: 1 }).toArray()).map((d) => String(d.text || '')); } catch (_) {}
      const ficam = [];
      for (const b of bolhas) { if (ficam.some((x) => parecido(x, b)) || recentes.some((x) => parecido(x, b))) continue; ficam.push(b); }
      if (ficam.length) bolhas = ficam;
    } catch (_) {}
    for (let i = 0; i < bolhas.length; i++) {
      if (i > 0) { try { await new Promise((r) => setTimeout(r, _typingDelay(bolhas[i]))); } catch (_) {} }
      try { await sendText(phone, bolhas[i]); } catch (_) {}
    }
  }
  // Mesmo pagamento reaproveitado e os dados já foram mandados há pouco → não repete (a não ser que peça).
  if (ctx.pagoToSend && ctx.pagoReused) {
    const pedeCodigo = !/(referencias|muestra|gratis|opini|testimon|rese[ñn]|prueba|estaf|confia|confío|garant)/i.test(text) && /(clabe|referencia(?!s)|n[uú]mero|c[oó]digo|barras|datos|pago|m[áa]ndame|manda(lo)?\s+otra|reenv|de\s+nuevo|no\s+(me\s+)?(lleg[óo]|veo|aparece))/i.test(text);
    // O texto promete mandar os dados ("se enviarán en mensajes aparte", "te envío los datos") → manda mesmo.
    const prometeDados = /(se\s+enviar[áa]n|te\s+(los\s+)?(enviar[ée]|env[ií]o|mando)|mensajes?\s+(aparte|separados?)|te\s+llegar[áa]n|aqu[ií]\s+(tienes|est[áa]n?)\s+(los\s+datos|la\s+referencia|el\s+n))/i.test(finalText);
    if (!pedeCodigo && !prometeDados) {
      try {
        const cm = await getCollection('wa_ia_messages');
        const ja = await cm.findOne({ phone, direction: 'out', text: ctx.pagoCodigo, createdAt: { $gte: new Date(Date.now() - 2 * 3600e3) } }, { projection: { _id: 1 } });
        if (ja) ctx.pagoSkip = true;
      } catch (_) {}
    }
  }
  if (ctx.pagoToSend && !ctx.pagoSkip) {
    const gap = () => new Promise((r) => setTimeout(r, MSG_GAP_MS));
    for (const m of mensagensPagamento(ctx.pagoToSend, ctx.pagoValor)) {
      if (!m) continue;
      await gap();
      try { await sendText(phone, m); } catch (_) {}
    }
  }

  return { awaitingConfirm: !!(ctx.validated && !ctx.pagoToSend && !ctx.support && !ctx.quedaResolved && !ctx.textoFixo), username: ctx.validatedUsername || '' };
}

// ── Quebra a resposta em balões ──
const MAX_BUBBLES = Math.max(1, Number(process.env.BOT_MAX_BUBBLES || 4));
const BUBBLE_GAP_MS = Math.max(0, Number(process.env.BOT_BUBBLE_GAP_MS || 1300));
const TYPING_BASE_MS = Math.max(0, Number(process.env.BOT_TYPING_BASE_MS || 600));
const TYPING_PER_CHAR_MS = Math.max(0, Number(process.env.BOT_TYPING_PER_CHAR_MS || 22));
const TYPING_MAX_MS = Math.max(0, Number(process.env.BOT_TYPING_MAX_MS || 4500));
function _typingDelay(s) { const n = String(s || '').length; return Math.max(BUBBLE_GAP_MS, Math.min(TYPING_MAX_MS, TYPING_BASE_MS + n * TYPING_PER_CHAR_MS)); }
function splitIntoBubbles(text) {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (!t) return [];
  const isItem = (l) => /^\s*(\d{1,2}\s*[.)\-–]|\d️⃣|[-•▪️✅🔹👉]\s?|\*\d+\*)/.test(l);
  const hasList = t.split('\n').filter(isItem).length >= 2;
  if (t.length <= 280 && !hasList) return [t];
  const segs = [];
  for (const block of t.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
    let cur = [], curIsList = null;
    for (const l of lines) {
      const item = isItem(l) || (curIsList === true && /^\s{2,}\S/.test(l));
      if (curIsList !== null && item !== curIsList) { segs.push({ list: curIsList, text: cur.join('\n') }); cur = []; }
      cur.push(l); curIsList = item;
    }
    if (cur.length) segs.push({ list: !!curIsList, text: cur.join('\n') });
  }
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const prev = out[out.length - 1];
    const ehUltimo = i === segs.length - 1;
    if (prev && !s.list && !prev.list && (s.text.length < 60 || prev.text.length < 60) && !(ehUltimo && /\?\s*$/.test(s.text))) { prev.text += '\n\n' + s.text; continue; }
    if (prev && s.list && prev.list) { prev.text += '\n' + s.text; continue; }
    if (prev && s.list && !prev.list && /:\s*\**\s*$/.test(prev.text)) { prev.text += '\n' + s.text; prev.list = true; continue; }
    out.push({ list: s.list, text: s.text });
  }
  const final = [];
  for (const s of out) {
    if (s.list && s.text.length > 700) {
      let acc = '';
      for (const l of s.text.split('\n')) {
        if (acc && isItem(l) && (acc.length + l.length) > 550) { final.push(acc); acc = l; }
        else acc = acc ? acc + '\n' + l : l;
      }
      if (acc) final.push(acc);
    } else final.push(s.text);
  }
  while (final.length > MAX_BUBBLES) {
    let best = 0, bestLen = Infinity;
    for (let i = 0; i < final.length - 1; i++) { const len = final[i].length + final[i + 1].length; if (len < bestLen) { bestLen = len; best = i; } }
    final.splice(best, 2, final[best] + '\n\n' + final[best + 1]);
  }
  return final.map((x) => x.trim()).filter(Boolean);
}

// ── Fallback sem OPENAI_API_KEY ──
async function handleSalesMessage(msg, sendText) {
  const phone = String(msg && (msg.phone || msg.from) || '').trim();
  const text = String(msg && msg.text || '').toLowerCase();
  let reply = '¡Hola! Vendo *seguidores*, *me gusta* y *vistas* para Instagram. ¿Cuál te interesa?';
  const key = sales.normalizeServico(text);
  if (key) {
    const t = await sales.priceTable({ servico: key, tipo: /real|org[áa]nic/.test(text) ? 'organicos' : 'mistos' });
    if (t && t.ok) {
      const linhas = t.itens.slice(0, 8).map((i) => `${Number(i.quantidade).toLocaleString('en-US')} ${t.unit} - ${i.preco}`).join('\n');
      reply = `Precios de *${t.unit}*${t.tipoNombre ? ' ' + t.tipoNombre : ''}:\n${linhas}\n\n¿Qué cantidad quieres?`;
    }
  }
  try { await sendText(phone, reply); } catch (_) {}
}

async function appendAssistantNote(phone, text) {
  const t = String(text || '').trim();
  if (!t) return;
  try { const h = await loadHistory(phone); h.push({ role: 'assistant', content: t }); await saveHistory(phone, h); } catch (_) {}
}

module.exports = { isEnabled, handleAgentMessage, handleSalesMessage, clearHistory, systemPrompt, appendAssistantNote, FALLBACK_FALHA, acharPrecosErrados, splitIntoBubbles, mensagensPagamento };
