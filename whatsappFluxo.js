// Bot B do WhatsApp da You Agency (23/11/2026): o CÓDIGO conduz a venda de seguidores e o pós-venda;
// a IA só (1) entende a mensagem (extrai dados/intenção, JSON) e (2) responde em 1-2 frases a dúvida fora da lista.
// Preço, tabela, resumo, cobrança, status do pedido e link de reposição são sempre texto do código.
// O que o B não cobre (me gusta, vistas, comentários, imagem/áudio, oferta de dobrar) volta para o bot A
// (whatsappAgent.js) — handle() devolve null e o A responde. Ficha do cliente: coleção wa_fluxo_b (24 h).
const P = require('./pricing.js');
const sales = require('./whatsappSales.js');
const { getCollection } = require('./mongodbClient');
const agentMod = () => require('./whatsappAgent.js'); // lazy: o A também requer este arquivo

const MODEL = String(process.env.BOT_B_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const FICHA_TTL_MS = 24 * 3600e3;

async function chat(messages, { json = false, temperature = 0.3, max_tokens = 300 } = {}) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new Error('sem_chave');
  const body = { model: MODEL, messages, temperature, max_tokens };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('openai_' + r.status + ' ' + String((j.error && (j.error.code || j.error.message)) || '').slice(0, 80));
  try { require('./openaiCredito.js').registrarUso(MODEL, j.usage); } catch (_) {}
  const c = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
  return json ? JSON.parse(c || '{}') : c;
}

const fmt = (c) => '$ ' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' MXN';
const fq = (q) => Number(q).toLocaleString('en-US');
const REDES = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };
function tabela(rede, tipo) {
  if (rede === 'tiktok') return P.tabelaRedes.tiktok_seguidores;
  if (rede === 'facebook') return P.tabelaRedes.facebook_seguidores;
  return tipo === 'organicos' ? P.tabelaSeguidores.organicos : P.tabelaSeguidores.mistos;
}
const preco = (rede, tipo, q) => { const it = tabela(rede, tipo).find((x) => Number(x.q) === Number(q)); return it ? P.parsePrecoToCents(it.p) : 0; };
// O cliente nunca vê "mixtos": é só "seguidores" (perfiles de México); o outro tipo é "de alta calidad".
const nomeTipo = (s) => (s.rede !== 'instagram' ? 'seguidores de ' + REDES[s.rede] : (s.tipo === 'organicos' ? 'seguidores de alta calidad' : 'seguidores'));
function listaCurta(s) {
  const qs = s.tipo === 'organicos' ? [150, 500, 1000, 3000, 5000] : [100, 250, 500, 1000, 2000];
  return tabela(s.rede, s.tipo).filter((x) => qs.includes(Number(x.q))).map((x) => '- ' + fq(x.q) + ': ' + fmt(P.parsePrecoToCents(x.p))).join('\n');
}
function proximoPacote(s) { const t = tabela(s.rede, s.tipo); const i = t.findIndex((x) => Number(x.q) === Number(s.qtd)); return i >= 0 && t[i + 1] ? Number(t[i + 1].q) : null; }
const semMixtos = (t) => String(t || '')
  .replace(/\b(seguidores|me gusta|likes)(\*?)\s+\*?mixt[oa]s(\*?)/gi, (m0, w, a1, a2) => w + (a1 || a2))
  .replace(/\b([Ll])os\s+\*?mixt[oa]s\*?/g, '$1os *seguidores*').replace(/\*mixt[oa]s\*/gi, '*seguidores*')
  .replace(/\bMixt[oa]s\b/g, 'Seguidores').replace(/\bmixt[oa]s\b/g, 'seguidores').replace(/\bseguidores\s+seguidores\b/gi, 'seguidores');

// ── respostas aprovadas (dúvidas comuns) ──
function faq(tema, s) {
  s.faqs = s.faqs || {};
  if (tema === 'extras') return 'El precio que te paso es el total: sin costos extra ni mensualidades. (Si pagas en OXXO, la tienda cobra su comisión en caja.)';
  if (tema === 'precio' && s.rede === 'instagram' && s.tipo !== 'organicos' && /real|calidad|latin|activ/i.test(s.textoAtual || '') && s.disp && s.disp.alta) {
    const t = P.tabelaSeguidores.organicos.filter((x) => [150, 500, 1000, 3000, 5000].includes(Number(x.q))).map((x) => '- ' + fq(x.q) + ': ' + fmt(P.parsePrecoToCents(x.p))).join('\n');
    if (s.faqs.tabelaAlta) return 'Los de *alta calidad* son los que te pasé arriba (150 por ' + fmt(P.parsePrecoToCents(P.tabelaSeguidores.organicos[0].p)) + '). ¿Cuál te late?';
    s.faqs.tabelaAlta = true;
    return 'Precios de *seguidores de alta calidad* (perfiles latinos reales y activos):\n' + t;
  }
  if (tema === 'precio') {
    if (s.qtd && preco(s.rede, s.tipo, s.qtd)) return '*' + fq(s.qtd) + ' ' + nomeTipo(s) + '* cuestan *' + fmt(preco(s.rede, s.tipo, s.qtd)) + '*' + (s.tipo === 'organicos' ? ' (son perfiles reales y activos, por eso cuestan más).' : '.');
    const chaveT = 'tabela|' + s.rede + '|' + s.tipo;
    if (s.faqs[chaveT]) return 'Los precios de *' + nomeTipo(s) + '* son los que te pasé arriba: ' + tabela(s.rede, s.tipo).filter((x) => [100, 150, 250, 500, 1000].includes(Number(x.q))).slice(0, 3).map((x) => fq(x.q) + ' por ' + fmt(P.parsePrecoToCents(x.p))).join(', ') + '…';
    s.faqs[chaveT] = true; if (s.tabelaEnviada && !/real|calidad/i.test(s.textoAtual || '')) return null;
    return 'Estos son los precios de *' + nomeTipo(s) + '*:\n' + listaCurta(s);
  }
  if (s.faqs[tema]) { s.faqRepetida = tema; return null; } // já respondeu: a IA responde curto e diferente
  s.faqs[tema] = true;
  const menor = tabela(s.rede, s.tipo)[0];
  const T = {
    bots: 'Nuestros *seguidores* son perfiles de México, estables y con reposición gratis por 30 días; sirven para dar número y autoridad a tu perfil y no garantizan interacción.' + (s.disp && s.disp.alta ? ' Si buscas perfiles reales y activos, tenemos *seguidores de alta calidad* (latinos), desde ' + fmt(P.parsePrecoToCents(P.tabelaSeguidores.organicos[0].p)) + ' por 150.' : ''),
    prazo: 'Empiezan a entrar poco después de que se confirma el pago y llegan de forma gradual' + (s.tipo === 'organicos' ? '; los de alta calidad se completan en hasta 48 h.' : '.') + ' Con SPEI la confirmación del pago tarda minutos.',
    seguranca: 'Es 100% seguro: nunca pedimos tu contraseña, solo tu @ público. Pagas por SPEI a una CLABE exclusiva de tu pedido y la confirmación te llega aquí mismo, con el link para seguir tu entrega. Si quieres probar primero, puedes empezar con el paquete más pequeño: ' + fq(menor.q) + ' por ' + fmt(P.parsePrecoToCents(menor.p)) + '.',
    garantia: 'Son estables, con bajísima caída, y si algo baja tienes *reposición gratis por 30 días* con tu link de reposición.',
    pagamento_como: 'Pagas por *SPEI* desde la app de cualquier banco (BBVA, Banorte, Santander, Banamex, Nu, Mercado Pago, Spin, etc.): abre la app → Transferir → a otro banco → pega la CLABE de 18 dígitos → escribe el monto exacto → confirma. Si no tienes banco ni app, también puedes pagar en *OXXO* en efectivo (en caja cobran una comisión aparte).',
    privado: 'Para la entrega tu perfil tiene que estar *público* hasta que terminemos; después puedes volver a ponerlo privado.',
    interacao: 'Entregamos la cantidad contratada, que da número y autoridad al perfil, pero no garantizamos que comenten o interactúen.',
    muestra: 'No damos muestras gratis, pero puedes empezar con el paquete más pequeño: ' + fq(menor.q) + ' por ' + fmt(P.parsePrecoToCents(menor.p)) + '.',
    contrasena: 'No, nunca pedimos tu contraseña: solo necesitamos tu @ y que el perfil esté público.',
    tarjeta: 'Por ahora no aceptamos tarjeta: el pago es por SPEI desde cualquier app de banco (incluye Mercado Pago, Nu y Spin) o en efectivo en OXXO.',
  };
  return T[tema] || null;
}

const NLU = `Eres un extractor de datos para el WhatsApp de ventas de You Agency (seguidores de Instagram/TikTok/Facebook en México). Lee el ÚLTIMO mensaje del cliente con el contexto y devuelve SOLO JSON:
{"intencion": "comprar|dar_cantidad|dar_usuario|si|no|pregunta|ya_pague|pide_datos_pago|quiere_oxxo|quiere_spei|no_quiere|estado_pedido|caida|reclamo|saludo|otro",
 "cantidad": número o null (ej. "2 mil"→2000, "mil"→1000; solo si habla de cantidad de seguidores),
 "usuario": "@ o link de perfil que el cliente ESCRIBIÓ, exacto" o null,
 "rede": "instagram|tiktok|facebook" o null (solo si la menciona),
 "servicio": "seguidores|me_gusta|vistas|comentarios" o null (solo si lo menciona),
 "confirma": true si el mensaje dice que SÍ a lo último que preguntó el bot (perfil correcto, resumen "¿Todo bien?", seguir), aunque además pregunte otra cosa; false si dice que NO o corrige; null si no responde a eso,
 "quiere_comprar_alta_calidad": true SOLO si pide COMPRAR seguidores reales/de alta calidad/latinos ("quiero reales", "dame los de alta calidad"); si solo PREGUNTA si son reales, es false y va en temas "bots",
 "acepta_oferta": true/false/null (solo si el bot ofreció un paquete mayor: true si lo acepta),
 "temas": lista de dudas que hace, de: ["bots","precio","extras","prazo","seguranca","garantia","pagamento_como","privado","interacao","muestra","contrasena","tarjeta","otro"] ("bots" = pregunta si los seguidores son reales/bots/falsos; "seguranca" = pregunta si la EMPRESA es real/confiable o dice que lo estafaron; "precio" = pregunta cuánto cuesta o por qué tan caro),
 "pregunta_texto": "la duda del cliente si tema=otro, si no null"}
"si" = confirma lo que el bot preguntó (incluye "correcto", "ok", "va", "dale", "ese es"). "ya_pague" = dice que ya pagó/transfirió/manda comprobante.
"estado_pedido" = pregunta por un pedido YA PAGADO ("no me llega", "cuándo llegan", "cuánto falta", "ya pagué y nada").
"caida" = dice que se le cayeron/bajaron los seguidores o pide reposición.
"reclamo" = quiere cancelar, reembolso/devolución, hablar con una persona, o reclama enojado.`;

function FATOS(s) {
  const d = (s && s.disp) || {};
  const segs = ['seguidores (perfiles de México, estables, reposición gratis 30 días)'].concat(d.alta ? ['seguidores de alta calidad (latinos reales y activos, hasta 48 h)'] : []);
  const redes = [d.tiktok ? 'seguidores de TikTok' : '', d.facebook ? 'seguidores de Facebook' : ''].filter(Boolean);
  return 'Hechos de You Agency (SOLO esto existe; lo que no esté aquí NO lo ofrecemos ahora): vende ' + segs.join(' y ') + ' para Instagram, además de me gusta, vistas y comentarios' + (redes.length ? '; también ' + redes.join(' y ') : '; NO hay seguidores de TikTok ni de Facebook por ahora') + '. Pago por SPEI (CLABE exclusiva del pedido, confirma en minutos) u OXXO (efectivo, comisión en caja, hasta 1 h). Nunca pide contraseña. Sin tarjeta. Soporte humano de lunes a viernes 7:00-18:00 (CDMX).';
}

async function responderLivre(s, pergunta) {
  const jaDito = (s.historicoBot || []).slice(-6).join('\n').slice(-1500);
  try {
    return await chat([{ role: 'system', content: 'Eres asesor de ventas de You Agency por WhatsApp. Responde la duda del cliente en español de México, en 1-2 frases, cálido y directo, sin emojis. ' + FATOS(s) + ' No hables de precios ni cantidades (el sistema los manda aparte; nunca digas que no puedes compartirlos), NUNCA prometas tiempos exactos, NUNCA digas que los seguidores normales son reales o no son bots, NUNCA escribas la palabra "mixtos". Si no sabes, di que lo revisas con el equipo.' },
      { role: 'user', content: 'Lo que el bot YA dijo (NO lo repitas; si la duda ya se respondió, contesta en 1 frase corta con otras palabras o con un dato nuevo):\n' + (jaDito || '-') + '\n\nCliente: ' + pergunta }], { temperature: 0.3, max_tokens: 160 });
  } catch (_) { return 'Déjame revisarlo con el equipo y te confirmo por aquí.'; }
}

// ── pós-venda (pedido já pago) ──
async function posVenda(phone, texto, n, s, out) {
  const intent = n.intencion;
  if (intent === 'reclamo') {
    try { await sales.flagSupport(phone, 'Cliente pediu: ' + String(texto).slice(0, 200)); } catch (_) {}
    out.push('Entiendo. Ya le pasé tu caso al equipo de soporte para que lo revise y te responda por aquí (atienden de lunes a viernes, de 7:00 a 18:00, hora del centro de México).');
    s.encerrado = true;
    return true;
  }
  if (intent !== 'estado_pedido' && intent !== 'caida' && !(intent === 'ya_pague' && !s.temPagoAberto)) return false;
  let usuario = '';
  if (s.pedeUsuarioPos) { const m = String(texto).match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i) || String(texto).match(/@?([A-Za-z0-9_.]{3,30})/); usuario = (m && m[1]) || ''; }
  let cp = null;
  try { cp = await sales.consultarPedido({ telefone: phone, usuario }); } catch (_) { cp = null; }
  if (!cp || !cp.encontrado) {
    if (!s.pedeUsuarioPos) { s.pedeUsuarioPos = true; out.push('No encuentro un pedido pagado con este número. ¿Me pasas el @ (usuario de Instagram) con el que hiciste la compra?'); return true; }
    s.pedeUsuarioPos = false;
    try { await sales.flagSupport(phone, 'Pós-venda: não achou o pedido (' + String(texto).slice(0, 120) + ')'); } catch (_) {}
    out.push('No logré encontrar tu pedido. Ya le pasé tu caso al equipo para que lo revise y te responda por aquí.');
    s.encerrado = true;
    return true;
  }
  s.pedeUsuarioPos = false;
  const desc = (cp.quantidade ? fq(cp.quantidade) + ' ' : '') + (cp.ehReales ? 'seguidores de alta calidad' : (cp.servico === 'seguidores' || !cp.servico ? 'seguidores' : cp.servico)) + (cp.usuario ? ' para @' + cp.usuario : '');
  if (cp.aguardandoPagamento) {
    if (intent === 'ya_pague' || /pagu|transfer|deposit/i.test(texto)) { try { await sales.marcarPedidosAbertos(phone, 'clienteDisseQuePagou', texto); } catch (_) {} }
    out.push('Ya encontré tu pedido: *' + (cp.pacote || desc) + '*' + (cp.usuario ? ' para @' + cp.usuario : '') + ' (' + cp.valor + ' por ' + cp.metodo + '). Todavía no nos llega la confirmación del banco; ' + (cp.metodo === 'OXXO' ? 'con OXXO puede tardar hasta 1 hora' : 'con SPEI normalmente tarda unos minutos') + '. En cuanto se confirme, tu pedido se libera solo y te aviso aquí. Si en 30 minutos no se confirma, el equipo lo revisa.');
    return true;
  }
  if (cp.precisaSuporte) {
    try { await sales.flagSupport(phone, 'Pedido com problema (' + (cp.motivoSuporte || 'precisaSuporte') + ') @' + (cp.usuario || '?')); } catch (_) {}
    out.push('Ya encontré tu pedido de *' + desc + '*. Lo estoy revisando con el equipo para que la entrega avance; en cuanto lo tengamos listo te escribo por aquí.');
    s.encerrado = true;
    return true;
  }
  if (cp.perfilPrivado) { out.push('Ya encontré tu pedido de *' + desc + '*. Tu perfil está *privado* y así la entrega no avanza: ponlo *público* hasta que terminemos y sigue entrando solo.'); return true; }
  if (intent === 'caida') {
    if (cp.ehReales) {
      try { await sales.flagSupport(phone, 'Queda em seguidores de alta calidad @' + (cp.usuario || '?')); } catch (_) {}
      out.push('¡Puedes estar tranquilo(a)! Ya le pasé tu pedido al equipo para revisarlo. Los *seguidores de alta calidad* son nuestro servicio más estable, con una caída de solo 5-6% en más de un mes.');
      s.encerrado = true;
      return true;
    }
    if (cp.refilLink) { out.push('¡Claro! Puedes reponer los seguidores que se cayeron aquí: ' + cp.refilLink); return true; }
    try { await sales.flagSupport(phone, 'Queda sem link de reposição @' + (cp.usuario || '?')); } catch (_) {}
    out.push('Ya encontré tu pedido. Le pasé tu caso al equipo para liberar tu reposición; te escribo por aquí en cuanto esté.');
    s.encerrado = true;
    return true;
  }
  if (cp.status === 'completado') { out.push('Tu pedido de *' + desc + '* ya se completó. Si no ves todo, actualiza la app o cierra y abre Instagram; a veces el contador tarda un poco en actualizarse.'); return true; }
  out.push(cp.ehReales
    ? 'Tu pedido de *' + desc + '* está *en proceso*. Los de alta calidad llegan de forma gradual y se completan en hasta 48 h desde el pago.'
    : 'Tu pedido de *' + desc + '* está *en proceso* y va entrando de forma gradual. Puedes estar tranquilo(a), se va a completar.');
  return true;
}

// ── um turno de venda/pós-venda ──
async function turno(phone, texto, s, deps) {
  const out = [];
  const ultimaBot = s.ultimaBot || '';
  let n;
  try {
    n = await chat([{ role: 'system', content: NLU }, { role: 'user', content: JSON.stringify({ etapa: s.etapa, ficha: { cantidad: s.qtd || null, usuario: s.usuario || null, rede: s.rede, tipo: s.tipo, tiene_pedido_pagado: !!s.temPedidoPago, tiene_pago_pendiente: !!s.temPagoAberto }, ultimo_mensaje_bot: ultimaBot.slice(-500), mensaje_cliente: texto }) }], { json: true, temperature: 0, max_tokens: 280 });
  } catch (e) {
    try { console.warn('⚠️ [bot-b] extrator falhou, passa para o A:', e && e.message); } catch (_) {}
    return null; // sem IA (ex.: sem crédito): o A responde com o fallback dele
  }
  n = n || {};
  if (n.servicio && n.servicio !== 'seguidores' && !s.qtd) { s.delegado = true; return null; }
  // quantidade e @ só valem se estiverem ESCRITOS na mensagem do cliente (o extrator copia do texto do bot)
  if (n.cantidad) {
    const tnum0 = String(texto || '').replace(/(\d)[.,](\d{3})/g, '$1$2');
    const q00 = Number(n.cantidad);
    const escrita0 = new RegExp('(^|\\D)' + q00 + '(\\D|$)').test(tnum0) || (q00 % 1000 === 0 && new RegExp('(^|\\D)' + (q00 / 1000) + '\\s*mil' + (q00 === 1000 ? '|\\bmil\\b' : ''), 'i').test(tnum0));
    if (!escrita0) n.cantidad = null;
  }
  if (n.usuario && !String(texto || '').toLowerCase().includes(String(n.usuario).replace(/^@+/, '').toLowerCase().slice(0, 4))) n.usuario = null;
  // "¿y si es real?", "me estafaron": dúvida se a EMPRESA é confiável (não pedido de seguidores reais)
  const pedeAlta = /(seguidores\s+(reales|de\s+verdad|activos|latinos|de\s+calidad)|alta\s+calidad|los\s+reales|quiero\s+(los\s+)?reales|perfiles\s+reales|personas\s+reales|que\s+interact)/i.test(texto);
  if (/(es\s+real\b|si\s+es\s+real|es\s+verdad|estaf|fraude|enga[ñn]|confiable|confiar|es\s+seguro|me\s+robaron)/i.test(texto) && !pedeAlta) {
    n.temas = ['seguranca'].concat((n.temas || []).filter((t) => t !== 'bots' && t !== 'seguranca'));
    n.quiere_comprar_alta_calidad = false;
  }

  // pós-venda: pedido pago (ou cobrança aberta) e o cliente fala do pedido
  if ((s.temPedidoPago || s.temPagoAberto || n.intencion === 'reclamo') && !(s.qtd && !s.pago)) {
    if (await posVenda(phone, texto, n, s, out)) return out;
  }

  // cliente que já comprou e só pergunta: responde a dúvida, sem empurrar a tabela de novo
  const querComprar = n.intencion === 'comprar' || n.intencion === 'dar_cantidad' || !!n.cantidad || !!n.usuario || !!n.quiere_comprar_alta_calidad || s.qtd;
  if (s.temPedidoPago && !s.pago && !querComprar) {
    for (const t of (n.temas || [])) { const f = faq(t, s); if (f && !/^Estos son los precios/.test(f)) out.push(f); else if (t === 'otro' && n.pregunta_texto) out.push(await responderLivre(s, n.pregunta_texto)); }
    if (!out.length) out.push(await responderLivre(s, texto));
    return out;
  }
  const jaPagouAlgo = s.disseQuePagou || s.pagoConfirmado || n.intencion === 'ya_pague';
  if (!jaPagouAlgo && s.metodo === 'OXXO' && /(clabe|transfer|spei)/i.test(texto) && !/oxxo|efectivo|tienda/i.test(texto)) n.intencion = 'quiere_spei';
  if (s.metodo !== 'OXXO' && /(oxxo|efectivo|en\s+tienda)/i.test(texto) && !/(clabe|transfer|spei)/i.test(texto) && n.intencion !== 'pregunta') n.intencion = 'quiere_oxxo';
  if (n.rede && n.rede !== 'instagram' && n.rede !== s.rede && !s.pago && s.disp && !s.disp[n.rede]) { out.push('Por ahora no tenemos seguidores de ' + REDES[n.rede] + ' disponibles. Lo que sí tengo son seguidores para Instagram.'); n.rede = null; }
  if (n.rede && n.rede !== s.rede && !s.pago) {
    const soPergunta = n.intencion === 'pregunta' && (s.qtd || s.usuario) && !/(quiero|para mi|dame|mejor|c[aá]mbia)/i.test(texto);
    if (!soPergunta) { const qAnt = s.qtd; s.rede = n.rede; s.tipo = 'mistos'; s.qtd = qAnt && preco(n.rede, 'mistos', qAnt) ? qAnt : null; s.usuario = null; s.perfilOk = false; s.perfilPerguntado = false; s.tabelaEnviada = false; s.resumoChave = null; }
  }
  if (n.quiere_comprar_alta_calidad && s.disp && !s.disp.alta && !s.pago && !s.avisouSemAlta) { s.avisouSemAlta = true; out.push('Por ahora no tenemos seguidores de alta calidad disponibles; te puedo ofrecer nuestros *seguidores* (perfiles de México, con reposición gratis por 30 días).'); n.quiere_comprar_alta_calidad = false; }
  if (s.propostaAlta && !s.pago) {
    const quer = /(alta\s+calidad|reales|los\s+de\s+calidad|cambia|cambio|esos|ese|los\s+caros|s[ií]\b)/i.test(texto) && !/(mixtos|normales|sigo|me\s+quedo|no\b|mejor\s+no)/i.test(texto);
    s.propostaAlta = false;
    if (quer) { s.tipo = 'organicos'; s.tabelaEnviada = true; if (s.qtd && !preco(s.rede, s.tipo, s.qtd)) s.qtd = null; s.resumoChave = null; out.push('Listo, cambiamos a *seguidores de alta calidad*' + (s.qtd ? ': *' + fq(s.qtd) + '* por *' + fmt(preco(s.rede, s.tipo, s.qtd)) + '*.' : '.')); }
    else out.push('Perfecto, seguimos con los *seguidores* de siempre (perfiles de México).');
    n.quiere_comprar_alta_calidad = false;
  }
  if (n.quiere_comprar_alta_calidad && !s.pago && s.rede === 'instagram' && s.tipo !== 'organicos') {
    const explicito = /(quiero|dame|prefiero|mejor|c[aá]mbia|cambiar|ponme|v[aá]monos\s+con|los\s+de)\b[^?]{0,40}(real|alta\s+calidad|calidad|latin)/i.test(texto);
    if (!explicito || s.qtd) {
      s.propostaAlta = true;
      const q = s.qtd && preco(s.rede, 'organicos', s.qtd) ? s.qtd : 500;
      out.push('Tenemos *seguidores de alta calidad* (perfiles latinos reales y activos, se completan en hasta 48 h). ¿Quieres cambiar a alta calidad (' + fq(q) + ' por ' + fmt(preco(s.rede, 'organicos', q)) + ') o sigues con los *seguidores* de siempre (' + fq(q) + ' por ' + fmt(preco(s.rede, 'mistos', q) || preco(s.rede, 'mistos', 500)) + ')?');
      n.quiere_comprar_alta_calidad = false;
    }
  }
  if (n.quiere_comprar_alta_calidad && s.rede === 'instagram' && s.tipo !== 'organicos' && !s.pago) { s.tipo = 'organicos'; s.tabelaEnviada = false; if (s.qtd && !preco(s.rede, s.tipo, s.qtd)) s.qtd = null; out.push('Sí, tenemos *seguidores de alta calidad*: perfiles latinos, reales y activos, los más estables (se completan en hasta 48 h).'); }

  // cobrança gerada nesta conversa e ainda não paga
  if (s.pago && !s.pagoConfirmado) {
    if (n.intencion === 'ya_pague') { s.disseQuePagou = (s.disseQuePagou || 0) + 1; try { await sales.marcarPedidosAbertos(phone, 'clienteDisseQuePagou', texto); } catch (_) {} out.push(s.disseQuePagou === 1 ? '¡Gracias! En cuanto el banco confirme tu pago te aviso aquí mismo y tu pedido se libera solo. ' + (s.metodo === 'OXXO' ? 'Con OXXO puede tardar hasta 1 hora.' : 'Con SPEI suele tardar unos minutos.') : 'Ya encontré tu pedido: *' + fq(s.qtd) + ' ' + nomeTipo(s) + '* para @' + s.usuario + ' (' + fmt(s.valor) + ' por ' + s.metodo + '). Todavía no nos llega la confirmación del banco; en cuanto llegue se libera solo y te aviso. Si en 30 minutos no se confirma, el equipo lo revisa.'); return out; }
    if (n.intencion === 'quiere_spei' && s.metodo !== 'SPEI' && !s.disseQuePagou) { s.metodo = 'SPEI'; const r = await deps.criarPagamento(phone, s); if (!r.ok) { out.push(r.erroTexto); return out; } out.push('¡Listo! Te cambié el pago a *SPEI* (transferencia, se confirma en minutos). Estos son los datos:'); out.push(...r.msgs); return out; }
    if (n.intencion === 'quiere_oxxo' && s.metodo !== 'OXXO' && !s.disseQuePagou) { s.metodo = 'OXXO'; const r = await deps.criarPagamento(phone, s); if (!r.ok) { out.push(r.erroTexto); return out; } out.push('¡Listo! Te cambié el pago a *OXXO* (efectivo). Lleva unos pesos extra: en caja cobran una comisión aparte. La confirmación puede tardar hasta 1 hora.'); out.push(...r.msgs); return out; }
    if (n.intencion === 'pide_datos_pago') { out.push('¡Claro! Te mando otra vez los datos de tu pago (es el mismo, no se genera otro):'); out.push(...(s.msgsPago || [])); return out; }
    if (n.intencion === 'no_quiere') { try { await sales.marcarPedidosAbertos(phone, 'recusou', texto); } catch (_) {} out.push('Entiendo, sin problema. Tu pedido queda apartado por si cambias de opinión; aquí estoy.'); return out; }
    for (const t of (n.temas || [])) { const f = faq(t, s); if (f) out.push(f); else if (t === 'otro' && n.pregunta_texto) out.push(await responderLivre(s, n.pregunta_texto)); }
    if (!out.length && n.intencion !== 'si') out.push(await responderLivre(s, texto));
    else if (s.faqRepetida && out.length === 0) out.push(await responderLivre(s, texto));
    if (!/datos de pago est[aá]n arriba/i.test(ultimaBot)) out.push('Tus datos de pago están arriba en el chat; en cuanto se confirme, empieza tu pedido.');
    return out;
  }
  if (s.pago && s.pagoConfirmado) {
    // compra nova depois de paga: recomeça a ficha
    if (n.intencion === 'comprar' || n.cantidad) { Object.assign(s, { pago: null, pagoConfirmado: false, msgsPago: null, qtd: null, perfilOk: false, perfilPerguntado: false, ofertaFeita: false, etapa: 'coleta', resumoChave: null, disseQuePagou: 0, comprarMais: true }); }
    else {
      for (const t of (n.temas || [])) { const f = faq(t, s); if (f) out.push(f); }
      if (!out.length) out.push((n.temas || []).includes('otro') && n.pregunta_texto ? await responderLivre(s, n.pregunta_texto) : '¡Gracias! Tu pedido de *' + fq(s.qtd) + ' ' + nomeTipo(s) + '* para @' + s.usuario + ' ya está en proceso; empieza a entrar poco después de la confirmación y llega de forma gradual.');
      return out;
    }
  }

  if (n.intencion === 'no_quiere') { out.push('Entiendo, sin problema. Si cambias de opinión, aquí estoy.'); return out; }
  const jaAvisouIndisp = out.some((x) => /no tenemos .* disponibles/i.test(x));
  for (const t of (n.temas || [])) { if (t === 'bots' && n.quiere_comprar_alta_calidad) continue; if (t === 'otro' && jaAvisouIndisp) continue; const f = faq(t, s); if (f) out.push(f); else if (t === 'otro' && n.pregunta_texto) out.push(await responderLivre(s, n.pregunta_texto)); }
  if (n.intencion === 'quiere_oxxo') { s.metodo = 'OXXO'; }
  if (n.intencion === 'quiere_spei') { s.metodo = 'SPEI'; }
  // quantidade só vale se estiver ESCRITA na mensagem
  if (n.cantidad) {
    const tnum = String(texto || '').replace(/(\d)[.,](\d{3})/g, '$1$2');
    const q0 = Number(n.cantidad);
    const escrita = new RegExp('(^|\\D)' + q0 + '(\\D|$)').test(tnum) || (q0 % 1000 === 0 && new RegExp('(^|\\D)' + (q0 / 1000) + '\\s*mil' + (q0 === 1000 ? '|\\bmil\\b' : ''), 'i').test(tnum));
    if (!escrita) n.cantidad = null;
  }
  if (!n.cantidad && !s.qtd && !s.pago) {
    const tq = String(texto || '').toLowerCase().replace(/@\S+/g, ' ');
    const mm = tq.match(/(\d+(?:[.,]\d+)?)\s*mil\b/); const mn = tq.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{3,5})\b/);
    const cand = mm ? Math.round(parseFloat(mm[1].replace(',', '.')) * 1000) : (/\bmil\b/.test(tq) ? 1000 : (mn ? Number(mn[1].replace(/[.,]/g, '')) : 0));
    if (cand && preco(s.rede, s.tipo, cand)) n.cantidad = cand;
  }
  if (n.cantidad && !s.pago) {
    const q = Number(n.cantidad);
    if (preco(s.rede, s.tipo, q)) { if (s.qtd !== q) { s.qtd = q; if (s.etapa === 'resumen' || s.etapa === 'oferta') s.etapa = s.perfilOk ? 'resumen_pendente' : s.etapa; } }
    else {
      const t = tabela(s.rede, s.tipo); const ab = t.filter((x) => Number(x.q) < q).slice(-1)[0]; const ac = t.find((x) => Number(x.q) > q);
      out.push('No manejamos ' + fq(q) + ' exactos; los paquetes más cercanos son ' + [ab, ac].filter(Boolean).map((x) => '*' + fq(x.q) + '* por ' + fmt(P.parsePrecoToCents(x.p))).join(' o ') + '. ¿Cuál prefieres?');
      return out;
    }
  }
  { // @ ou link escrito no texto vale mais que o extrator
    const t0 = String(texto || '');
    const mFb = t0.match(/(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook|fb)\.com\/[^\s,;]+/i);
    const mIg = t0.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i) || t0.match(/(?:^|\s)@([A-Za-z0-9_.]{2,30}[A-Za-z0-9_])/);
    const mTt = t0.match(/tiktok\.com\/@([A-Za-z0-9_.]{2,30})/i);
    if (s.rede === 'facebook' && mFb) n.usuario = mFb[0];
    else if (s.rede === 'tiktok' && (mTt || mIg)) n.usuario = (mTt || mIg)[1];
    else if (s.rede === 'instagram' && mIg) n.usuario = mIg[1];
    if (n.usuario && /^@?(facebook|fb|instagram|tiktok)\.com$/i.test(String(n.usuario))) n.usuario = null;
  }
  if (n.usuario && (!s.usuario || String(n.usuario).replace(/^@/, '').toLowerCase() !== String(s.usuario).toLowerCase())) { s.usuario = String(n.usuario).trim(); s.perfilOk = false; s.perfilPerguntado = false; }

  if (s.etapa === 'oferta') { const soConfirmaPerfil = /(correct|ese\s+es|soy\s+yo|es\s+mi\s+(perfil|cuenta))/i.test(texto) && !/(lo\s+quiero|el\s+de\s+[\d,.]+|los\s+[\d,.]+|s[ií]\s+quiero|mejor\s+(el|los)|\bva\b|dale|acepto|s[uú]bele|el\s+grande)/i.test(texto); if (n.acepta_oferta === true && !soConfirmaPerfil) { const px = proximoPacote(s); if (px) s.qtd = px; } s.etapa = 'resumen_pendente'; }
  const chaveAtual = [s.qtd, s.tipo, s.rede, s.usuario, s.metodo].join('|');
  const resumoValido = (s.etapa === 'resumen' || s.etapa === 'resumen_pendente') && s.resumoChave === chaveAtual;
  if (resumoValido && (n.intencion === 'no' || n.confirma === false) && n.cantidad && Number(n.cantidad) === Number(s.qtd)) { n.confirma = true; n.intencion = 'si'; }
  if (resumoValido && s.etapa === 'resumen_pendente' && (n.confirma === true || n.intencion === 'si')) s.etapa = 'resumen';
  if (s.etapa === 'resumen' && (n.confirma === true || n.intencion === 'si' || (n.intencion === 'pide_datos_pago' && n.confirma !== false))) {
    const r = await deps.criarPagamento(phone, s);
    if (!r.ok) { out.push(r.erroTexto); return out; }
    out.push('¡Listo! Ya generé tu pago de *' + fmt(s.valor) + '*' + (s.metodo === 'OXXO' ? ' en OXXO (en caja cobran una comisión aparte)' : '') + '. Quedo al pendiente de la confirmación para liberar tu pedido.');
    out.push(...r.msgs); return out;
  }
  if (s.etapa === 'resumen' && (n.confirma === false || n.intencion === 'no')) { out.push('Sin problema, ¿qué quieres cambiar? (cantidad, perfil o forma de pago)'); s.etapa = 'resumen_pendente'; return out; }

  const pedeClabe = n.intencion === 'pide_datos_pago' || /(clabe|referencia(?!s)|cuenta|d[oó]nde\s+(pago|deposito|transfiero))/i.test(texto);
  if (pedeClabe && (!s.qtd || !s.usuario || !s.perfilOk) && !s.avisouClabe && (s.avisouClabe = true)) out.push('Te mando la ' + (s.metodo === 'OXXO' ? 'referencia de OXXO' : 'CLABE') + ' en cuanto tenga ' + (!s.qtd ? 'la cantidad que quieres y tu @' : 'tu @ confirmado') + ' (es para saber a qué perfil enviar los seguidores).');
  if (!s.qtd) {
    if (!s.tabelaEnviada) { s.tabelaEnviada = true; out.push((s.rede === 'instagram' ? (s.tipo === 'organicos' ? 'Paquetes de *seguidores de alta calidad*:' : 'Estos son los paquetes más pedidos de *seguidores* para Instagram (perfiles de México, con reposición gratis por 30 días):') : 'Paquetes de *seguidores de ' + REDES[s.rede] + '*:') + '\n' + listaCurta(s) + '\n\nTenemos hasta 20,000.'); }
    out.push('¿Cuántos quieres? Mándame también tu ' + (s.rede === 'facebook' ? 'link del perfil o página de Facebook' : '@ de ' + REDES[s.rede]) + ' y te dejo el pedido listo.');
  } else if (!s.usuario) {
    out.push('Perfecto: *' + fq(s.qtd) + ' ' + nomeTipo(s) + '* por *' + fmt(preco(s.rede, s.tipo, s.qtd)) + '*. ¿Me pasas tu ' + (s.rede === 'facebook' ? 'link del perfil o página' : '@ de ' + REDES[s.rede]) + '?');
  } else if (!s.perfilOk) {
    if (s.perfilPerguntado && (n.confirma === true || n.intencion === 'si')) { s.perfilOk = true; }
    else if (s.perfilPerguntado && (n.confirma === false || n.intencion === 'no')) { s.usuario = null; s.perfilPerguntado = false; out.push('Va, ¿me pasas tu @ exacto, tal como aparece en tu perfil?'); }
    else {
      const v = await deps.validar(s.rede, s.usuario);
      if (!v || !v.ok) { s.usuario = null; out.push('No encontré ese perfil. ¿Me pasas tu @ exacto, tal como aparece en tu perfil?'); }
      else if (v.isPrivate) { s.usuario = v.username; s.perfilLink = v.link || ''; out.push('Encontré tu perfil @' + v.username + ', pero está *privado*: para la entrega tiene que estar público. Cuando lo abras, avísame y seguimos.'); }
      else { s.usuario = v.username; s.perfilLink = v.link || ''; s.perfilPerguntado = true; out.push('¡Encontré tu perfil! @' + v.username + ', ' + fq(v.followers || 0) + ' seguidores. ¿Es correcto?'); }
    }
  }
  if (s.qtd && s.usuario && s.perfilOk && !out.some((x) => /Es correcto\?|privado/.test(x))) {
    const px = proximoPacote(s);
    if (!s.ofertaFeita && px && s.etapa !== 'resumen_pendente') {
      s.ofertaFeita = true; s.etapa = 'oferta';
      out.push('Antes de generar tu pago: por solo *' + fmt(preco(s.rede, s.tipo, px) - preco(s.rede, s.tipo, s.qtd)) + ' más* te llevas *' + fq(px) + '* en lugar de ' + fq(s.qtd) + ' (total ' + fmt(preco(s.rede, s.tipo, px)) + '). ¿Lo quieres o seguimos con ' + fq(s.qtd) + '?');
    } else {
      const chaveR = [s.qtd, s.tipo, s.rede, s.usuario, s.metodo].join('|');
      if (s.resumoChave === chaveR) { s.etapa = 'resumen'; out.push('¿Te confirmo así tu pedido de *' + fq(s.qtd) + ' ' + nomeTipo(s) + '* (' + fmt(preco(s.rede, s.tipo, s.qtd)) + ') para mandarte la ' + (s.metodo === 'OXXO' ? 'referencia de OXXO' : 'CLABE') + '?'); }
      else {
        s.etapa = 'resumen'; s.resumoChave = chaveR;
        out.push('Te confirmo tu pedido:\n\n*' + fq(s.qtd) + ' ' + nomeTipo(s) + '*\nPerfil: *@' + s.usuario + '*\nTotal: *' + fmt(preco(s.rede, s.tipo, s.qtd)) + '*\nPago: *' + (s.metodo === 'OXXO' ? 'OXXO (efectivo)' : 'SPEI (transferencia)') + '*\n\n¿Todo bien?');
      }
    }
  }
  if (out.length && s.ultimaBot && out[out.length - 1] === (s.ultimaBot.split('\n').slice(-1)[0] || '')) {
    const ult = out.pop();
    const v = /Es correcto\?/.test(ult) && s.usuario ? '¿Me confirmas que @' + String(s.usuario).replace(/^@/, '') + ' es tu perfil?' : /@/.test(ult) && s.qtd && !s.usuario ? 'Solo me falta tu @ de ' + REDES[s.rede] + ' para dejar listo tu pedido.' : /@/.test(ult) && s.qtd ? null : (/Cuántos/.test(ult) ? '¿Qué cantidad te late? Puede ser 100, 250, 500, 1,000 o 2,000 (hay hasta 20,000).' : ult);
    if (v) out.push(v);
  }
  return out;
}

// ── cobrança e validação reais ──
async function criarPagamento(phone, s) {
  const metodo = s.metodo === 'OXXO' ? 'OXXO' : 'SPEI';
  let r;
  const base = { phone, servico: 'seguidores', tipo: s.tipo || 'mistos', quantidade: s.qtd, usuario: s.usuario, metodo, nome: '', previewOnly: false, comprar_mais: !!s.comprarMais };
  try {
    if (s.rede === 'instagram') {
      r = await sales.createPaymentOrder(base);
      if (r && !r.ok && r.error === 'pedido_ja_pago') r = await sales.createPaymentOrder(Object.assign({}, base, { comprar_mais: true }));
    } else {
      r = await sales.createRedeOrder({ rede: s.rede, servico: 'seguidores', tipo: 'mistos', quantidade: s.qtd, usuario: s.usuario, perfil_link: s.perfilLink || s.usuario, nome: '', phone, metodo, previewOnly: false, comprar_mais: !!s.comprarMais });
    }
  } catch (e) { r = { ok: false, error: (e && e.message) || 'erro' }; }
  if (!r || !r.ok || !r.pago) {
    try { console.warn('⚠️ [bot-b] cobrança falhou:', phone, JSON.stringify(r || {}).slice(0, 200)); } catch (_) {}
    try { await sales.flagSupport(phone, 'Bot B: falha ao gerar cobrança (' + String((r && (r.error || r.message)) || 'erro').slice(0, 80) + ')'); } catch (_) {}
    return { ok: false, erroTexto: 'Tuve un problema al generar tu pago. Ya le avisé al equipo para resolverlo y te escribo por aquí en un momento.' };
  }
  s.valor = Number(r.valorCents) || preco(s.rede, s.tipo, s.qtd);
  s.pago = { correlationID: r.correlationID || '', metodo };
  s.metodo = metodo;
  s.msgsPago = agentMod().mensagensPagamento(r.pago, r.valorLabel).filter(Boolean);
  return { ok: true, msgs: s.msgsPago };
}
async function validar(rede, u) {
  try { return rede === 'instagram' ? await sales.validateProfile(u) : await sales.validateRedeProfile(rede, u); } catch (_) { return null; }
}

// ── ficha no banco ──
async function lerFicha(phone) {
  try {
    const c = await getCollection('wa_fluxo_b');
    const d = await c.findOne({ _id: String(phone) });
    if (d && d.s && (Date.now() - new Date(d.updatedAt).getTime()) < FICHA_TTL_MS) return d.s;
  } catch (_) {}
  return null;
}
async function salvarFicha(phone, s) {
  try { const c = await getCollection('wa_fluxo_b'); await c.updateOne({ _id: String(phone) }, { $set: { s, updatedAt: new Date() } }, { upsert: true }); } catch (_) {}
}

// Quem atende: B para BOT_B_PCT% dos telefones (sempre o mesmo telefone no mesmo grupo).
function noGrupoB(phone) {
  const pct = Math.max(0, Math.min(100, Number(process.env.BOT_B_PCT || 0) || 0));
  if (!pct) return false;
  const d = String(phone || '').replace(/\D/g, '');
  let h = 0; for (const ch of d) h = (h * 31 + ch.charCodeAt(0)) % 1000003;
  return (h % 100) < pct;
}

// Retorna null quando o A deve responder; senão { awaitingConfirm, username } como o A.
async function handle(phone, texto, sendText, ctxA) {
  if (!noGrupoB(phone)) return null;
  const t = String(texto || '').trim();
  if (!t) return null;
  // casos que ficam com o A
  if (/^\[El cliente (envi|mand)/i.test(t)) return null; // imagem/áudio/comprovante descritos
  const ct = (ctxA && ctxA.contato) || {};
  if (ct.ofertaDobro && ct.ofertaDobro.status === 'ativa') return null;
  if (ct.pedidoAConfirmar) return null;
  let s = await lerFicha(phone);
  if (s && s.delegado) return null;
  const nova = !s;
  if (!s) s = { etapa: 'inicio', rede: 'instagram', tipo: 'mistos', metodo: 'SPEI' };
  s.textoAtual = t;
  try { const d = await sales.tiposDisponiveis(); s.disp = { mixtos: (d.seguidores || []).includes('mistos'), alta: (d.seguidores || []).includes('organicos'), tiktok: (d.tiktok || []).includes('seguidores'), facebook: (d.facebook || []).includes('seguidores') }; } catch (_) { s.disp = s.disp || { mixtos: true, alta: false, tiktok: false, facebook: false }; }
  // estado real no banco: pedido pago recente / cobrança aberta
  try {
    const est = await sales.estadoCliente(phone);
    s.temPedidoPago = !!(est && est.pagos);
    s.temPagoAberto = !!(est && est.aberto);
    if (s.pago && !s.pagoConfirmado && est && est.pagos && !est.aberto) s.pagoConfirmado = true;
  } catch (_) {}

  let msgs;
  if (nova && s.etapa === 'inicio' && !s.temPedidoPago && !s.temPagoAberto) {
    s.etapa = 'coleta';
    const generica = /(informaci|info\b|precio|cu[aá]nto|quiero\s+(comprar\s+)?seguidores|me\s+interesa|crecer|^\s*[¡!]?\s*hola\s*[.!]*\s*$)/i.test(t) && !/(tik\s*tok|facebook|gusta|likes?|vistas|views|coment|real|@|\d{2,})/i.test(t);
    if (generica) { s.tabelaEnviada = true; msgs = ['¡Hola! Estos son los paquetes más pedidos de *seguidores* para Instagram (perfiles de México, con reposición gratis por 30 días):\n' + listaCurta(s) + '\n\nTenemos hasta 20,000.\n\n¿Cuántos quieres? Mándame también tu @ de Instagram y te dejo el pedido listo.']; }
  }
  if (s.etapa === 'inicio') s.etapa = 'coleta';
  if (!msgs) {
    msgs = await turno(phone, t, s, { criarPagamento, validar });
    if (msgs === null) { await salvarFicha(phone, s); return null; } // o A responde
  }
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  s.historicoBot = s.historicoBot || [];
  const recentes = s.historicoBot.slice(-8).map(norm);
  const pagto = new Set((s.msgsPago || []).map(norm));
  let finais = msgs.filter((m) => m && (pagto.has(norm(m)) || !recentes.includes(norm(m))));
  if (!finais.length && msgs.length) finais = [await responderLivre(s, t)];
  finais = finais.map((m) => (pagto.has(norm(m)) ? m : semMixtos(m)));
  s.faqRepetida = null;
  s.ultimaBot = finais.join('\n');
  s.historicoBot = s.historicoBot.concat(finais).slice(-20);
  await salvarFicha(phone, s);
  // histórico do A (se o A assumir depois, sabe o que foi conversado)
  try { await agentMod().registrarTurnoExterno(phone, t, finais.join('\n\n')); } catch (_) {}
  for (let i = 0; i < finais.length; i++) {
    if (i > 0) await new Promise((ok) => setTimeout(ok, Math.max(0, Number(process.env.BOT_BUBBLE_GAP_MS || 1300))));
    try { await sendText(phone, finais[i]); } catch (_) {}
  }
  if (s.encerrado) { s.encerrado = false; await salvarFicha(phone, s); }
  try { console.log('🤖 [bot-b] ' + String(phone).slice(-4) + ' etapa=' + s.etapa + ' msgs=' + finais.length); } catch (_) {}
  return { awaitingConfirm: false, username: s.usuario || '', botB: true };
}

module.exports = { handle, noGrupoB, preco, tabela, semMixtos };
