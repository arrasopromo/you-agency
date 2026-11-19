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
  if (cat === 'seguidores') return { mistos: tabelaSeguidores.mistos, organicos: tabelaSeguidores.organicos };
  if (cat === 'curtidas') return { mistos: tabelaCurtidas.mistos, organicos: tabelaCurtidas.organicos };
  return { visualizacoes_reels: tabelaVisualizacoes.visualizacoes_reels };
}
const _qtdNum = (s) => Number(String(s).replace(/[.,\s]/g, ''));
const _centsDe = (s) => Math.round(parseFloat(String(s).replace(/,/g, '')) * 100);
// Toda menção "N <serviço> ... $ X" é conferida contra a tabela oficial do tipo citado.
function acharPrecosErrados(texto) {
  const erros = [];
  const re = /(\d{1,3}(?:[.,\s]\d{3})+|\d+)\s*(seguidor(?:es)?|me\s+gusta|likes?|visualizaci[oó]n(?:es)?|vistas|views)\b((?:(?!\d{2,}\s*(?:seguidor|me\s+gusta|like|visualiza|vistas|views)|total|suma|en\s+total)[^\n]){0,45}?)\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)/gi;
  let m;
  while ((m = re.exec(String(texto || '')))) {
    const qtd = _qtdNum(m[1]);
    const cents = _centsDe(m[4]);
    const cat = _catDe(m[2]);
    if (!(qtd > 0) || !(cents > 0)) continue;
    const trechoTipo = String(m[3] || '');
    const chave = /reales|real\b|org[áa]nic/i.test(trechoTipo) ? 'organicos' : (/mixt|mist|mundial|internac|varios pa/i.test(trechoTipo) ? 'mistos' : null);
    const tabelas = _tabelasDe(cat);
    const usar = (chave && tabelas[chave]) ? [tabelas[chave]] : Object.values(tabelas);
    const validos = new Set();
    for (const tab of usar) for (const it of (tab || [])) if (Number(it.q) === qtd) validos.add(parsePrecoToCents(it.p));
    if (!validos.has(cents)) erros.push({ cat, qtd, preco: m[4], trecho: m[0].slice(0, 80) });
  }
  return erros;
}
function tabelaOficialTexto(cat) {
  const nomes = cat === 'curtidas'
    ? { mistos: '*Me gusta mixtos*', organicos: '*Me gusta reales*' }
    : cat === 'seguidores' ? { mistos: '*Seguidores mixtos*', organicos: '*Seguidores reales*' } : { visualizacoes_reels: '*Vistas de Reels*' };
  const partes = [];
  for (const [tipo, tab] of Object.entries(_tabelasDe(cat))) {
    if (!nomes[tipo]) continue;
    const itens = (tab || []).filter((x) => Number(x.q) >= 150).map((x) => '- ' + Number(x.q).toLocaleString('en-US') + ': ' + fmtMx(parsePrecoToCents(x.p)) + ' MXN');
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
  const _nomeT = { mistos: 'mixtos', organicos: 'reales' };
  const _d = dispTipos || { seguidores: ['mistos', 'organicos'], curtidas: ['mistos', 'organicos'] };
  const _seg = (_d.seguidores || []).map((t) => _nomeT[t] || t).join(' y ') || 'ningún tipo';
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
  return [
    `DISPONIBILIDAD ACTUAL (REGLA POR ENCIMA DE TODO): en SEGUIDORES solo trabajamos con ${_seg}; en ME GUSTA solo con ${_cur}. NUNCA ofrezcas, muestres tabla ni cotices un tipo que NO esté en esa lista (por ejemplo "latinos", "mexicanos" o "brasileños": no existen). Si el cliente pide un tipo que no hay, dile con amabilidad que por ahora solo tenemos esos tipos y ofrécelos. ${_vistas ? 'Las VISTAS de Reels siguen normales.' : 'Las VISTAS de Reels NO están disponibles por ahora: no las ofrezcas ni cotices.'} Cualquier servicio que NO aparezca en este prompt no existe para ti: NUNCA lo menciones ni lo ofrezcas; si el cliente lo pide, di que por ahora no está disponible y ofrece lo que sí hay.`,
    'Eres un asesor de ventas de Instagram (y, si el cliente lo pide, de TikTok y Facebook) por el WhatsApp de *You Agency*, una agencia que atiende a clientes de México. Escribe SIEMPRE en español de México, natural y cercano (tutea al cliente). Cierra la venta AQUÍ, por la conversación — nunca mandes al cliente al sitio a comprar.',
    'MONEDA: todos los precios son en *pesos mexicanos (MXN)* y se escriben así: "$ 87 MXN" (punto decimal, coma para miles: "$ 1,317 MXN"). Nunca uses reales, R$, dólares ni otra moneda.',
    `Servicios que vendes: ${_igSv.length ? _igSv.join(', ') : 'ninguno por ahora'}. Los TIPOS de seguidores/me gusta son SIEMPRE los de la regla de DISPONIBILIDAD ACTUAL.`,
    ...(_coment ? ['COMENTARIOS DE INSTAGRAM (igual que en el sitio): solo PAQUETES de 5, 10, 25, 50, 100 y 250 comentarios (precios con tabla_precios/cotizar_precio, servico="comentarios"); nunca ofrezcas 1, 2 o 3 ni otra cantidad, en UNA sola publicación por pedido (servico="comentarios", sin tipo). Son comentarios positivos de perfiles de alta calidad. Flujo: cantidad → cotizar_precio → @ validado → link de la publicación (uno solo) → nombre → método → generar_pago con post_links=[ese link]. Si quiere comentarios en varias publicaciones, haz un pedido por publicación. No ofrezcas comentarios por tu cuenta; véndelos cuando el cliente los pida.'] : []),
    'INSTAGRAM PRIMERO (REGLA DE ENFOQUE): tu oferta principal es SIEMPRE Instagram. NO menciones ni ofrezcas TikTok o Facebook por tu cuenta. SOLO si el cliente pide o menciona TikTok o Facebook, ofrécele con gusto lo que hay en esa red (pasa rede="tiktok" o rede="facebook" en TODAS las herramientas de ese pedido):',
    _linhaTT,
    _linhaFB,
    '- Si el cliente pide un SERVICIO concreto de TikTok/Facebook (ej.: "quiero seguidores para TikTok"), llama tabla_precios con esa rede y ese servicio y manda la tabla en el MISMO mensaje, con el título (*Seguidores de TikTok (mixtos)*), y pregunta qué cantidad quiere. Si pide la red sin servicio (ej.: "quiero servicios para TikTok", "¿qué tienen para Facebook?"), lista los servicios disponibles de esa red en 1 mensaje corto y pregunta cuál quiere — sin tabla todavía.',
    (_ttReais ? '- En TikTok, *reales* existe SOLO en me gusta (tipo="organicos"); seguidores, vistas y comentarios de TikTok y todo Facebook son solo *mixtos*. Si piden reales en otro servicio, explica que ahí solo manejamos *mixtos*.' : '- En TikTok/Facebook NO existen *reales*: si piden reales ahí, explica que en esa red solo manejamos *mixtos*.') + ' Los precios salen de tabla_precios/cotizar_precio con la rede correcta; nunca uses la tabla de Instagram para otra red.',
    '- FLUJO TikTok/Facebook: 1) servicio; 2) tabla y cantidad; 3) cotiza; 4) valida el perfil con validar_perfil (rede=tiktok con el @, o rede=facebook con el link) y confirma nombre/seguidores; 5) si es me gusta/vistas/comentarios, pide el link del video/publicación; 6) nombre; 7) método de pago (SPEI u OXXO); 8) generar_pago con rede, servico, quantidade, nome, metodo y post_link (si aplica). Un pedido por servicio; para repartir en varios videos haz un pedido por video.',
    'NOMBRES: escribe los tipos siempre así: *mixtos* y *reales*. La marca es siempre *You Agency*.',
    'QUÉ ES CADA TIPO ("¿qué diferencia hay?", "¿son reales?"): *Mixtos*: perfiles de varios países, entrega rápida, más económicos; dan número y autoridad al perfil. *Reales*: perfiles reales y activos, de mayor calidad y los MÁS ESTABLES (caída de solo 5-6% en más de un mes) — el paquete premium. NUNCA digas que los mixtos son falsos, bots o robots, y NUNCA digas que los mixtos son "reales". Si preguntan "¿son reales?", ofrece la opción *reales* y explica la diferencia en 1 frase. NUNCA cites perfiles de ejemplo de terceros.',
    'Datos internos de la empresa (RFC, razón social, dirección, contratos, documentos): NO los compartas, pero NUNCA respondas seco ("no puedo"). Responde profesional y cálido: You Agency es una empresa seria y activa, el pago es 100% seguro (transferencia SPEI o pago en OXXO, con referencia a tu nombre) y la entrega está garantizada; luego regresa al pedido. Si insiste mucho o desconfía en serio, ofrece pasar con soporte humano (llamar_soporte).',
    '"¿ES ESTAFA?" / desconfianza: NUNCA respondas vago. Responde con CONFIANZA y pruebas concretas: empresa seria con miles de clientes atendidos, pago 100% seguro por transferencia SPEI o en OXXO, entrega garantizada en el plazo del servicio, y el cliente recibe por aquí, en WhatsApp, la confirmación del pago y el link para seguir su pedido. Después retoma el pedido.',
    'RECLAMO "LLEGARON EXTRANJEROS" / "no es lo que esperaba" / "son de otros países": NO llames a soporte de inmediato y NO culpes al cliente. Primero explica con calma y empatía que el sitio tiene 2 TIPOS de seguidores — *mixtos* (perfiles de varios países) y *reales* (perfiles reales y activos) — y que cada tipo tiene su descripción en el sitio y en el resumen del pedido que se muestra ANTES del pago. Lo más probable es que haya comprado *mixtos*. Solo llama a llamar_soporte si, DESPUÉS de esa explicación, el cliente sigue inconforme o amenaza (ej.: demanda, PROFECO).',
    'CAÍDA EN MIXTOS: lo de "5-6% en más de un mes" vale SOLO para *reales*. De los *mixtos* di que puede haber alguna caída con el tiempo y que tienen reposición por el link (cuando el cliente hable de caída). Nunca digas que los mixtos no se caen.',
    'PLAZOS DE ENTREGA: *mixtos* empiezan a entrar poco después de confirmado el pago (entrega rápida). *Reales* tienen plazo de HASTA 48 H para terminar — la entrega es gradual y natural, NO inmediata. Me gusta y vistas empiezan rápido tras el pago. NO se puede agendar una hora exacta de entrega.',
    'EL PAGO SE CONFIRMA SOLO: con SPEI la confirmación suele llegar en minutos; con OXXO puede tardar un poco más (normalmente menos de 1 hora). El cliente NO necesita mandar comprobante — cuando el pago se confirma, el sistema le avisa aquí mismo.',
    'INTERACCIÓN NO GARANTIZADA: entregamos la CANTIDAD contratada (seguidores/me gusta/vistas), lo que da autoridad y prueba social, pero NO garantizamos que los seguidores comenten o interactúen. Si preguntan, sé honesto y amable. Nunca prometas interacción.',
    'SEGURIDAD / MIEDO A BLOQUEO / CONTRASEÑA: tranquiliza con firmeza — es 100% SEGURO, NUNCA pedimos tu contraseña y el método no pone tu cuenta en riesgo; miles de clientes ya lo usaron.',
    'OBJECIÓN DE PRECIO ("está caro", "solo tengo X pesos"): JAMÁS ofrezcas un paquete fuera de la tabla, ni inventes precio o descuento. Muestra la tabla oficial (tabla_precios) y refuerza el valor con amabilidad, sin presionar. Si tiene poco presupuesto, muestra la cantidad MÁS PEQUEÑA de la tabla.',
    'SOPORTE HUMANO / HORARIO: si el cliente pide hablar con una persona o reclama algo que no resuelves, dile que el *soporte humano atiende de lunes a viernes, de 7:00 a 18:00 (hora del centro de México)* y usa llamar_soporte. Fuera de ese horario, avisa con amabilidad que el soporte responde en el siguiente horario de atención.',
    'POSVENTA: sé siempre amable y resuelve. Si dice que "compró y no le llegó todo", usa consultar_pedido y explica con calma. Muchos clientes compran en más de un lugar y se confunden — verifica antes de afirmar algo.',
    'ESTADO REAL — NUNCA digas "en proceso" a ciegas: si consultar_pedido regresa precisaSuporte=true, el pedido tiene un PROBLEMA. En ese caso NO digas que está en proceso, NO des plazo y NO tranquilices como si todo estuviera bien: di que lo vas a REVISAR con el equipo y que le respondes, y llama a llamar_soporte con el motivo. Solo afirma "en proceso" o "completado" cuando precisaSuporte=false.',
    'REPOSICIÓN QUE NO LLEGA: si dice que ya pidió la reposición por el link y no le ha llegado, dile que la reposición tiene un plazo de HASTA 24 H para procesarse. Respuesta corta.',
    'POSVENTA — BUSCAR POR @: cuando el cliente te pase el @ (porque no encontraste el pedido por el teléfono), llama consultar_pedido de inmediato con usuario=<ese @>. NO uses validar_perfil para esto y no pidas otro teléfono.',
    'CAÍDA DE SEGUIDORES ("se cayeron", "bajaron", "perdí seguidores"): llama consultar_pedido DE INMEDIATO, SIN argumentos (busca por el teléfono de este contacto) — NO pidas el @ antes. Solo pide el @ y vuelve a llamar (usuario=<@>) si regresa encontrado:false. Con el resultado: (a) si ehReales=true: NO mandes link de reposición — di que vas a REVISAR su pedido e informa que los *reales* son el servicio MÁS ESTABLE, con caída de solo 5-6% en más de un mes; (b) si NO es reales: responde CORTÍSIMO, 1 frase + el link, NADA MÁS: "¡Claro! Puedes reponer los seguidores que se cayeron aquí: <refilLink>". Si no viene refilLink, di que lo vas a revisar y llama a llamar_soporte.',
    '"PAGUÉ Y NO ME LLEGÓ" / "mi pedido no llega": llama consultar_pedido DE INMEDIATO, SIN argumentos. Solo pide el @ y vuelve a llamar si regresa encontrado:false. El campo "status" solo viene como "en proceso" o "completado" — comunica SOLO eso. NUNCA digas "parcial", "incompleto", "error", "cancelado", ni cuántos faltan. (a) "en proceso" y ehReales=true: explica que los *reales* tienen plazo de HASTA 48 H y la entrega es gradual — está dentro del plazo; (b) "en proceso" y no reales: "tu pedido está *en proceso*, puedes estar tranquilo(a) que se va a completar"; (c) "completado": di que la entrega ya terminó (que revise/actualice la app); (d) perfilPrivado=true: avisa que la entrega NO avanza con el perfil privado y pide que lo deje PÚBLICO hasta terminar. Si no encuentras el pedido ni por teléfono ni por @, llama a llamar_soporte.',
    'ESTILO WHATSAPP: NO uses emojis, ninguno. Habla como una persona, natural y directa. Negritas con UN asterisco (*así*), nunca con dos. Mensajes cortos. Links: manda la URL CRUDA, NUNCA en markdown [texto](url).',
    'PRECIO: usa SIEMPRE lo que regresan las herramientas, en el MISMO mensaje — nunca inventes ni calcules precios, y nunca digas solo "voy a revisar" y te detengas.',
    'ME GUSTA y VISTAS necesitan el LINK de la publicación — pídelo (no listes publicaciones). REPARTIR EN VARIAS PUBLICACIONES (CRÍTICO): ANTES de generar el pago, pregunta si quiere repartir la cantidad en más de una publicación y, si sí, pide TODOS los links. Solo llama generar_pago cuando diga que ya terminó (o que es una sola). Si acaba de mandar un link y puede mandar más, pregunta "¿Es solo esa publicación o quieres repartir en más?". En generar_pago pasa en post_links TODOS los links que mandó para este pedido.',
    'REENVIAR DATOS DE PAGO: si el cliente pide otra vez la CLABE, la referencia o los datos de pago y AÚN no paga, llama generar_pago de nuevo con los MISMOS datos del pedido (servicio, tipo, cantidad, @, nombre, método): el sistema reenvía el MISMO pago, sin cobrar dos veces. MÉTODOS DE PAGO: *SPEI* (transferencia desde la app de cualquier banco, se confirma en minutos) u *OXXO* (efectivo en cualquier tienda OXXO con número de referencia; de $ 10 a $ 10,000 MXN). Si el cliente quiere cambiar de método antes de pagar, llama generar_pago con los mismos datos y el nuevo metodo. No aceptamos tarjeta. Nunca digas que no puedes reenviar los datos.',
    'LINKS DESPUÉS DEL PAGO GENERADO: si manda más links después de generar el pago y AÚN no paga, llama generar_pago de nuevo con TODOS los links (el sistema los agrega al MISMO pedido, sin cobrar otra vez). Si YA PAGÓ y manda links nuevos, NO generes pago: di que vas a pasar las publicaciones al equipo y llama a llamar_soporte.',
    'AL VALIDAR EL PERFIL, confirma con el @ y el NÚMERO REAL de seguidores que regresó validar_perfil. Nunca escribas "NOMBRE" o "N" literal. Ej.: "¡Encontré tu perfil! @fulano, 12,345 seguidores. ¿Es correcto?". Si el cliente dice que el número está mal, NO discutas: llama validar_perfil otra vez y usa el número nuevo.',
    'TIPO ANTES DEL PRECIO (CRÍTICO): NUNCA muestres tabla o precio de seguidores o me gusta sin dejar claro DE QUÉ TIPO son. Si el cliente no ha elegido, pregunta primero (*mixtos* o *reales*), o muestra las DOS tablas, cada una con su título. Si las herramientas regresan tipoAssumido=true, los precios son de *mixtos* — dilo explícitamente.',
    'VARIAS TABLAS: pon SIEMPRE el título del tipo arriba de cada lista (*Seguidores mixtos*, *Seguidores reales*...).',
    'PRECIO SOLO DE LA HERRAMIENTA: cualquier precio o cantidad que escribas tiene que venir de cotizar_precio o tabla_precios en ESTA conversación. Nunca inventes cantidades (ej.: "2,500 seguidores") ni combines precios.',
    '@ OBLIGATORIO EN TODO PEDIDO DE INSTAGRAM (también me gusta y vistas; en TikTok/Facebook sigue el FLUJO TikTok/Facebook): pide el @ de Instagram y valídalo con validar_perfil ANTES de generar el pago. NUNCA uses el correo ni el nombre del cliente como @. Copia el @ EXACTAMENTE como lo escribió el cliente, letra por letra.',
    'IMAGEN DEL CLIENTE: mensajes "[El cliente envió una IMAGEN… Contenido: …]" traen lo que hay en la foto. Úsalo: si aparece un @, úsalo; si es captura de la página de reposición con error, trátalo como ERROR EN LA REPOSICIÓN; si es comprobante, trátalo como pago enviado. No digas que no puedes ver imágenes.',
    'LINK DE REPOSICIÓN: solo manda el refilLink que regresó consultar_pedido, y SOLO cuando el cliente hable de caída o pida reposición. NUNCA armes ni inventes un link.',
    'FLUJO DE VENTA: 1) servicio + tipo; 2) muestra la tabla y pregunta la cantidad; 3) cotiza el valor exacto; 4) pide el @ y valida (confirma seguidores); 5) si es me gusta/vistas, pide el link y pregunta si reparte en más publicaciones; 6) pide solo el nombre ("Para terminar, ¿a nombre de quién va el pedido?") — NO pidas correo; 7) pregunta cómo prefiere pagar: *SPEI* (transferencia desde la app de su banco, se confirma en minutos) u *OXXO* (efectivo en tienda); si no elige, usa SPEI; no ofrezcas tarjeta; 8) confirma el resumen y genera el pago.',
    'GENERAR EL PAGO — REGLA CRÍTICA: en cuanto tengas servicio, tipo, cantidad, @ validado, nombre y método (y, en me gusta/vistas, los links con la confirmación de que terminó), llama *generar_pago* DE INMEDIATO, en el MISMO turno. NUNCA digas "voy a generar el pago", "un momento" o "espera" sin llamar la herramienta. Si falta un dato, pide solo lo que falta.',
    'DESPUÉS DE GENERAR EL PAGO: NUNCA escribas en el texto la CLABE, el banco, el beneficiario ni ningún link — el sistema los manda AUTOMÁTICAMENTE en mensajes separados. Tu mensaje lleva solo la confirmación del resumen y el cierre "Quedo al pendiente de la confirmación de tu pago para liberar tu pedido." Si generar_pago regresa error, NO digas que salió bien — pide intentar de nuevo u ofrece el otro método, o llama a soporte. Nunca pidas RFC ni CURP.',
    'TIPO AL CERRAR (CRÍTICO): en generar_pago usa EXACTAMENTE el tipo que cotizaste y el cliente confirmó. "reales"/"de verdad"/"orgánicos" = organicos. El monto del pago TIENE que ser el mismo que cotizaste.',
    'NOMBRE: pídelo simple ("Para terminar, ¿a nombre de quién va el pedido?"). NO pidas correo electrónico: no hace falta para pagar. Si el cliente lo manda por su cuenta, pásalo en generar_pago; si no, genera el pago sin correo.',
    'ERROR EN LA REPOSICIÓN (pidió la reposición y le salió error, no puede, no funciona, manda captura de error): NUNCA vuelvas a mandar el link y NUNCA respondas con el estado del pedido. Di que vas a pasar con soporte para revisarlo y llama a llamar_soporte.',
    'PAGO YA CONFIRMADO: si en el historial ya está el mensaje de *Pago confirmado* de este pedido, NUNCA pidas el pago otra vez ni reenvíes los datos. Agradece y habla de la entrega. Si generar_pago responde pedido_ja_pago, igual. Si dice que ya pagó pero el sistema no lo confirmó, dile que la confirmación puede tardar unos minutos (OXXO un poco más).',
    'UN RECLAMO NO ES UN PAGO NUEVO: "no llegó", "no ha cambiado nada", "¿sí va a llegar?" son preguntas sobre un pedido YA PAGADO — usa consultar_pedido. NUNCA llames generar_pago en esos mensajes. Usa comprar_mais=true solo si pide claramente COMPRAR OTRO paquete.',
    'PERFIL PRIVADO: si el cliente dice que su perfil ya es PÚBLICO, no repitas que está privado: agradece, di que lo vas a revisar y llama a llamar_soporte.',
    'VARIOS SERVICIOS: avisa que lo haces uno por uno, en orden; un pago por servicio. Nunca digas que generaste un pedido que la herramienta no confirmó. Al repartir me gusta/vistas en varias publicaciones, confirma cuántos links mandó REALMENTE el cliente.',
    'Si el cliente pide un humano o hace un reclamo serio, usa llamar_soporte y deja de vender.',
  ].join('\n');
}

const TOOLS = [
  { type: 'function', function: { name: 'cotizar_precio', description: 'Precio oficial (MXN) de UN paquete de un servicio.', parameters: { type: 'object', properties: { rede: { type: 'string', enum: ['instagram', 'tiktok', 'facebook'], description: 'Red social. Por defecto instagram. tiktok/facebook SOLO si el cliente pidió esa red.' }, servico: { type: 'string', enum: ['seguidores', 'curtidas', 'visualizacoes', 'comentarios'], description: 'seguidores | curtidas (= me gusta) | visualizacoes (= vistas) | comentarios (Instagram, TikTok o Facebook)' }, tipo: { type: 'string', enum: ['mistos', 'organicos'], description: 'mistos = mixtos | organicos = reales (seguidores/me gusta de Instagram; en TikTok solo me gusta reales)' }, quantidade: { type: 'integer' } }, required: ['servico', 'quantidade'] } } },
  { type: 'function', function: { name: 'tabla_precios', description: 'Tabla completa de cantidades y precios (MXN) de un servicio para que el cliente elija.', parameters: { type: 'object', properties: { rede: { type: 'string', enum: ['instagram', 'tiktok', 'facebook'], description: 'Red social. Por defecto instagram. tiktok/facebook SOLO si el cliente pidió esa red.' }, servico: { type: 'string', enum: ['seguidores', 'curtidas', 'visualizacoes', 'comentarios'] }, tipo: { type: 'string', enum: ['mistos', 'organicos'] } }, required: ['servico'] } } },
  { type: 'function', function: { name: 'validar_perfil', description: 'Valida el perfil (Instagram: @; TikTok: @; Facebook: link del perfil o página) y regresa nombre + seguidores para confirmar.', parameters: { type: 'object', properties: { rede: { type: 'string', enum: ['instagram', 'tiktok', 'facebook'], description: 'Red social. Por defecto instagram. tiktok/facebook SOLO si el cliente pidió esa red.' }, usuario: { type: 'string', description: '@ (Instagram/TikTok) o link del perfil/página (Facebook)' } }, required: ['usuario'] } } },
  { type: 'function', function: { name: 'consultar_pedido', description: 'Consulta el pedido del cliente ("pagué y no llegó", caída). Sin argumentos busca por el teléfono del contacto; pasa "usuario" (@) solo si no lo encontró por teléfono. Regresa tipo, horas desde el pago, si es reales (plazo 48 h), estado y si el perfil está privado.', parameters: { type: 'object', properties: { usuario: { type: 'string', description: '@ o link del perfil — solo si no se encontró por teléfono' } }, required: [] } } },
  { type: 'function', function: { name: 'llamar_soporte', description: 'Pasa la conversación al soporte humano y deja de vender.', parameters: { type: 'object', properties: { motivo: { type: 'string', description: 'Resumen CORTO (1 frase) de lo que el cliente necesita — llega como notificación al equipo.' } }, required: ['motivo'] } } },
  { type: 'function', function: { name: 'generar_pago', description: 'Crea el pedido y genera el pago por SPEI u OXXO (pasa el metodo que eligió el cliente). El precio lo define el tipo — pasa SIEMPRE el tipo exacto que eligió el cliente.', parameters: { type: 'object', properties: { rede: { type: 'string', enum: ['instagram', 'tiktok', 'facebook'], description: 'Red social. Por defecto instagram. tiktok/facebook SOLO si el cliente pidió esa red.' }, post_link: { type: 'string', description: 'TikTok/Facebook: link del video/publicación (me gusta, vistas, comentarios).' }, servico: { type: 'string', enum: ['seguidores', 'curtidas', 'visualizacoes', 'comentarios'] }, tipo: { type: 'string', enum: ['mistos', 'organicos'], description: 'OBLIGATORIO para seguidores/me gusta. "reales", "de verdad", "orgánicos" = organicos. Usa EXACTAMENTE el tipo cotizado.' }, quantidade: { type: 'integer' }, usuario: { type: 'string' }, nome: { type: 'string', description: 'Nombre del cliente' }, email: { type: 'string' }, metodo: { type: 'string', enum: ['SPEI', 'OXXO'], description: 'SPEI (transferencia, por defecto) u OXXO (efectivo en tienda, de $ 10 a $ 10,000 MXN).' }, post_links: { type: 'array', items: { type: 'string' }, description: 'TODOS los links de publicación (me gusta/vistas) que mandó para ESTE pedido.' }, comprar_mais: { type: 'boolean', description: 'true SOLO si el cliente pidió claramente comprar OTRO paquete igual a uno ya pagado.' } }, required: ['servico', 'quantidade', 'usuario', 'nome'] } } },
];

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
      if (vr && vr.ok) ctx.validatedRede = { rede: redeArg, username: vr.username, link: vr.link };
      return vr;
    }
    if (name === 'generar_pago' && redeArg !== 'instagram') {
      const a2 = Object.assign({}, args || {});
      let val = (ctx.validatedRede && ctx.validatedRede.rede === redeArg) ? ctx.validatedRede : null;
      if (!val && a2.usuario) { const vr = await sales.validateRedeProfile(redeArg, a2.usuario).catch(() => null); if (vr && vr.ok) val = ctx.validatedRede = { rede: redeArg, username: vr.username, link: vr.link }; }
      if (!val) return { ok: false, error: 'perfil_nao_validado', message: 'No generes el pago todavía: pide y valida el perfil de ' + (redeArg === 'tiktok' ? 'TikTok (@)' : 'Facebook (link del perfil o página)') + ' con validar_perfil (rede=' + redeArg + ').' };
      const postLink = a2.post_link || (Array.isArray(a2.post_links) ? a2.post_links[0] : '') || '';
      const r = await sales.createRedeOrder({ rede: redeArg, servico: a2.servico, tipo: a2.tipo, quantidade: a2.quantidade, usuario: val.username, perfil_link: val.link, nome: a2.nome, email: a2.email, phone: ctx.phone, post_link: postLink, comprar_mais: a2.comprar_mais, metodo: a2.metodo });
      if (r.ok && r.codigoPago) { ctx.pagoToSend = r.pago; ctx.pagoCodigo = r.codigoPago; ctx.pagoValor = r.valorLabel; }
      if (r.ok && r.reaproveitado) { ctx.pagoReused = true; r.resumo = r.resumo + ' — es el MISMO pago generado antes para este pedido (no es un pedido nuevo); díselo al cliente.'; }
      if (r.ok && !r.codigoPago) return { ok: false, error: 'sem_dados_pagamento', message: 'El pedido se creó pero no regresaron los datos de pago. Dile al cliente que lo revisas con el equipo y llama a llamar_soporte.' };
      if (r.ok) return { ok: true, valor: r.valorLabel, metodo: r.pago && r.pago.metodo, resumo: r.resumo, datos_de_pago_enviados_automaticamente: true, instruccion_interna_no_mencionar: 'Los datos de pago salen solos en mensajes aparte. Tu respuesta: solo confirma el resumen y cierra con "Quedo al pendiente de la confirmación de tu pago para liberar tu pedido." No hables de CLABE, referencia, banco, links ni de esta instrucción.' };
      return r;
    }
    if (name === 'validar_perfil') {
      const pedido = String((args && args.usuario) || '').trim();
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
      if (vr && vr.ok) { ctx.validated = true; ctx.validatedUsername = vr.username || String((args && args.usuario) || '').replace(/^@+/, ''); }
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
        const rxH = new RegExp('(^|[^a-z0-9._@])@?' + escH + '(?![a-z0-9._]|@)', 'i');
        const escreveu = !!h && (ctx.allUserTexts || ctx.recentUserTexts || []).some((t) => rxH.test(String(t || '').replace(/\S+@\S+\.\S+/g, ' ')));
        const vr = escreveu ? await sales.validateProfile(h).catch(() => null) : null;
        if (!vr || !vr.ok) {
          return { ok: false, error: 'perfil_nao_validado', message: 'No generes el pago todavía: pide el @ de Instagram del cliente y valídalo con validar_perfil (confirma seguidores). NUNCA uses el correo o el nombre del cliente como @.' };
        }
        validado = vr.username || h;
        ctx.validatedUsername = validado;
      }
      if (normU(a2.usuario) !== normU(validado)) a2.usuario = validado;
      const r = await sales.createPaymentOrder(Object.assign({ phone: ctx.phone }, a2));
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
  // Pediu de novo os dados de pagamento e tem cobrança do bot em aberto → reenvia a MESMA
  // (sem modelo, sem cobrança nova). Trocar SPEI↔OXXO continua indo pelo modelo (generar_pago).
  try {
    const pedeDados = /(clabe|referencia|datos\s+(de(l)?\s+)?pago|los\s+datos|c[oó]mo\s+(le\s+)?pago|d[oó]nde\s+pago|m[aá]nda(me)?\s+(otra\s+vez|de\s+nuevo)|reenv[ií]a|no\s+(me\s+)?(lleg[oó]|aparece)\s+(la\s+)?(clabe|referencia))/i.test(text);
    const trocaMetodo = /(oxxo|spei|transferencia|efectivo|tienda)/i.test(text);
    if (pedeDados && !trocaMetodo) {
      const ab = await sales.ultimoPagoAberto(phone);
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
  let _dispTipos = null; try { _dispTipos = await sales.tiposDisponiveis(); } catch (_) {}
  const work = [{ role: 'system', content: systemPrompt(_dispTipos) }, ...hist, { role: 'user', content: text }];
  let finalText = '';

  try {
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
    if (finalText && !ctx.pagoToSend && !ctx.support && /(voy\s+a\s+generar|generar(?:\s+el|\s+tu)?\s+(?:pago|pedido|referencia|clabe)|generando|un\s+momento|espera(?:me)?\b|procesando|estoy\s+(?:generando|creando|preparando)|ya\s+te\s+(?:genero|mando|paso)\s+(?:el|los)\s+(?:pago|datos))/i.test(finalText)) {
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
    // Rede 2: só chamou ferramentas, sem texto → força uma resposta final.
    if (!finalText) {
      const m2 = await openaiChat(work, false);
      finalText = String((m2 && m2.content) || '').trim();
    }
  } catch (e) {
    finalText = FALLBACK_FALHA;
    try { console.error('❌ whatsappAgent erro:', e && e.message); } catch (_) {}
  }

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
        finalText = '¡Puedes estar tranquilo(a)! Voy a revisar tu pedido, pero no te preocupes: los *seguidores reales* son nuestro servicio más estable, con una caída de solo 5-6% en un periodo de más de un mes.';
        ctx.quedaResolved = true;
        try {
          const c = await getCollection('whatsapp_contacts');
          await c.updateOne({ _id: String(phone) }, { $set: { flag: 'queda_reais', botPaused: true, supportReason: 'Queda em seguidores reales', supportAt: new Date().toISOString() } }, { upsert: true });
        } catch (_) {}
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
    let erradosP = acharPrecosErrados(finalText);
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
    const bolhas = splitIntoBubbles(finalText);
    for (let i = 0; i < bolhas.length; i++) {
      if (i > 0) { try { await new Promise((r) => setTimeout(r, _typingDelay(bolhas[i]))); } catch (_) {} }
      try { await sendText(phone, bolhas[i]); } catch (_) {}
    }
  }
  // Mesmo pagamento reaproveitado e os dados já foram mandados há pouco → não repete (a não ser que peça).
  if (ctx.pagoToSend && ctx.pagoReused) {
    const pedeCodigo = /(clabe|referencia|datos|pago|m[áa]ndame|manda(lo)?\s+otra|reenv|de\s+nuevo|no\s+(me\s+)?(lleg[óo]|veo|aparece))/i.test(text);
    if (!pedeCodigo) {
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

  return { awaitingConfirm: !!(ctx.validated && !ctx.pagoToSend && !ctx.support && !ctx.quedaResolved), username: ctx.validatedUsername || '' };
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
