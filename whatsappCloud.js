// whatsappCloud.js — You Agency (México): infra da IA de vendas no WhatsApp (Meta Cloud API,
// número +55 31 7566-4986 "You Agency"), debounce, envio de texto/mídia, checagem de pausa
// e retomada automática. Porte do bot da Oppus com textos em espanhol e horário do México.
// Registra as rotas via registerWhatsappIa(app).
'use strict';

const { getCollection } = require('./mongodbClient');
const agent = require('./whatsappAgent.js');
const openaiCredito = require('./openaiCredito.js');
let axios = require('axios'); if (axios && axios.default) axios = axios.default;

const CFG = () => ({
  phoneId: String(process.env.WHATSAPP_IA_PHONE_NUMBER_ID || '').trim(),
  token: String(process.env.WHATSAPP_IA_TOKEN || '').trim(),
  verifyToken: String(process.env.WHATSAPP_IA_VERIFY_TOKEN || '').trim(),
  version: String(process.env.WHATSAPP_IA_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v21.0').trim(),
  webhookPath: String(process.env.WHATSAPP_IA_WEBHOOK_PATH || '/api/whatsapp-ia/webhook').trim(),
  autoReply: String(process.env.WHATSAPP_AUTO_REPLY || 'true').toLowerCase() !== 'false',
  debounceMs: Math.max(0, Number(process.env.WHATSAPP_DEBOUNCE_MS || 8000) || 8000),
});
function configured() { const c = CFG(); return !!(c.phoneId && c.token); }

// ── Log de mensagens da IA (inbox/CRM). Coleção wa_ia_messages. Best-effort. ──
let __iaMsgIndexed = false;
async function logIaMessage(d) {
  try {
    const phone = String((d && d.phone) || '').trim();
    const phoneKey = phone.replace(/\D/g, '');
    if (!phoneKey) return;
    const col = await getCollection('wa_ia_messages');
    if (!__iaMsgIndexed) { __iaMsgIndexed = true; try { await col.createIndex({ phone: 1, createdAt: 1 }); await col.createIndex({ createdAt: -1 }); await col.createIndex({ wamid: 1 }, { sparse: true }); } catch (_) {} }
    const wamid = String((d && d.wamid) || '').trim();
    const doc = {
      phone, phoneKey,
      direction: (d.direction === 'out') ? 'out' : 'in',
      type: String(d.type || 'text').slice(0, 20),
      text: String(d.text || '').slice(0, 4000),
      mediaId: String(d.mediaId || '').slice(0, 200),
      mime: String(d.mime || '').slice(0, 100),
      filename: String(d.filename || '').slice(0, 200),
      wamid, name: String(d.name || '').slice(0, 120),
      replyTo: String(d.replyTo || '').slice(0, 200),   // wamid da mensagem citada
      agent: !!d.agent, // true = enviado por atendente humano no CRM; false = bot
      ...(d.imagemDescricao ? { imagemDescricao: String(d.imagemDescricao).slice(0, 1500) } : {}),   // o que a IA leu na imagem
      ...(d.recovery ? { recovery: String(d.recovery).slice(0, 20) } : {}),   // cutucada de recuperação (stage1/stage2) — não conta como atividade orgânica
      createdAt: new Date(),
    };
    if (wamid) { try { const r = await col.updateOne({ wamid }, { $setOnInsert: doc }, { upsert: true }); if (!r.upsertedCount && !r.modifiedCount && r.matchedCount) { /* já existia */ } } catch (_) { try { await col.insertOne(doc); } catch (_) {} } }
    else { await col.insertOne(doc); }
    // Atualiza o contato (nome + last message) p/ a lista de conversas do CRM.
    try {
      const cc = await getCollection('whatsapp_contacts');
      const set = { lastMessageAt: new Date(), lastMessageText: doc.text.slice(0, 140), lastMessageDir: doc.direction };
      if (doc.name) set.name = doc.name;
      if (doc.direction === 'in') set.unread = true;
      await cc.updateOne({ _id: phone }, { $set: set, $setOnInsert: { _id: phone, createdAt: new Date() } }, { upsert: true });
    } catch (_) {}
  } catch (_) {}
}

async function sendWhatsAppText(to, text, opts = {}) {
  const c = CFG();
  if (!c.phoneId || !c.token) return { ok: false, error: 'not_configured' };
  const url = `https://graph.facebook.com/${c.version}/${c.phoneId}/messages`;
  const payload = { messaging_product: 'whatsapp', to: String(to), type: 'text', text: { preview_url: false, body: String(text || '').slice(0, 4096) } };
  // Responder CITANDO uma mensagem específica (igual ao "responder" do WhatsApp).
  if (opts && opts.replyTo) payload.context = { message_id: String(opts.replyTo) };
  try {
    const resp = await axios.post(url, payload, { headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, timeout: 20000, validateStatus: () => true });
    const ok = resp.status >= 200 && resp.status < 300;
    if (ok && opts.log !== false) {
      const wamid = (resp.data && Array.isArray(resp.data.messages) && resp.data.messages[0]) ? resp.data.messages[0].id : '';
      logIaMessage({ phone: String(to), direction: 'out', type: 'text', text, wamid, agent: !!opts.agent, replyTo: opts.replyTo || '' }).catch(() => {});
    }
    return { ok, status: resp.status, data: resp.data };
  } catch (e) { return { ok: false, error: (e && e.message) || 'erro' }; }
}

// kind: image|video|document. source: URL pública ou media_id.
async function sendWhatsAppMedia(to, kind, source, caption) {
  const c = CFG();
  if (!c.phoneId || !c.token) return { ok: false, error: 'not_configured' };
  const url = `https://graph.facebook.com/${c.version}/${c.phoneId}/messages`;
  const isId = source && !/^https?:\/\//i.test(String(source));
  const media = isId ? { id: String(source) } : { link: String(source) };
  if (caption && (kind === 'image' || kind === 'video' || kind === 'document')) media.caption = String(caption).slice(0, 1024);
  const payload = { messaging_product: 'whatsapp', to: String(to), type: kind, [kind]: media };
  try {
    const resp = await axios.post(url, payload, { headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true });
    return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, data: resp.data };
  } catch (e) { return { ok: false, error: (e && e.message) || 'erro' }; }
}

// ── Menu de boas-vindas (gatilho) + botões interativos ──
const MENU_BUTTONS = [
  { id: 'ja_comprei', title: 'Ya compré' },
  { id: 'quero_comprar', title: 'Quiero comprar' },
  { id: 'preciso_suporte', title: 'Necesito soporte' },
];
const WELCOME_TEXT = '¡Hola! ¿Cómo estás?\nBienvenido(a) a la atención de *You Agency*.\n\nEste es el contacto oficial para soporte, nuevas compras y dudas.\n\nCuéntame, ¿qué estás buscando hoy?';
const INSTRUCAO_JA_COMPREI = '¡Perfecto! Revisar tu pedido es muy fácil:\n\n1. Entra al *Área de Cliente*: https://youagency.site/cliente\n2. Escribe el *correo* que usaste al comprar\n3. La primera vez, *crea una contraseña* (después solo entras con ella)\n\n¡Listo! Ahí ves el *estado* y el avance de la entrega, el *detalle* del pedido (servicio, cantidad y perfil) y tu *historial* de compras.\n\nSi tienes cualquier problema para entrar o duda sobre la entrega, escríbeme aquí y te ayudo.';
const PERGUNTA_SUPORTE = '¡Claro! Cuéntame cuál es tu duda o qué pasó, y te ayudo por aquí.';

// ── Gatilhos EXATOS (mensagens pré-preenchidas do site/anúncios) ──
const _normTrig = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/^¡/, '');
const TRIGGER_MENU = _normTrig('¡Hola! Estoy en el sitio y necesito ayuda.');
const TRIGGERS_SALES = [
  _normTrig('¡Hola! Me interesa y quiero más información, por favor.'),
  _normTrig('¡Hola! ¿Me puedes dar más información sobre esto?'),
];
// Gatilho do MENU de boas-vindas (com botões).
function isTriggerMessage(text) { return _normTrig(text) === TRIGGER_MENU; }
// Gatilhos que iniciam direto o processo de VENDA.
function isSalesTrigger(text) { return TRIGGERS_SALES.includes(_normTrig(text)); }

// Envia UMA mensagem interativa com até 3 botões de resposta rápida.
async function sendWhatsAppButtons(to, bodyText, buttons) {
  const c = CFG();
  if (!c.phoneId || !c.token) return { ok: false, error: 'not_configured' };
  const url = `https://graph.facebook.com/${c.version}/${c.phoneId}/messages`;
  const payload = {
    messaging_product: 'whatsapp', to: String(to), type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(bodyText || '').slice(0, 1024) },
      action: { buttons: (buttons || []).slice(0, 3).map((b) => ({ type: 'reply', reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) } })) },
    },
  };
  try {
    const resp = await axios.post(url, payload, { headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, timeout: 20000, validateStatus: () => true });
    const ok = resp.status >= 200 && resp.status < 300;
    if (ok) { const wamid = (resp.data && Array.isArray(resp.data.messages) && resp.data.messages[0]) ? resp.data.messages[0].id : ''; logIaMessage({ phone: String(to), direction: 'out', type: 'button', text: bodyText, wamid, agent: false }).catch(() => {}); }
    return { ok, status: resp.status, data: resp.data };
  } catch (e) { return { ok: false, error: (e && e.message) || 'erro' }; }
}

// Contato bloqueado no CRM conta como pausado: o bot, o cutucão e a recuperação não falam com ele.
async function isBotPaused(phone) {
  try { const col = await getCollection('whatsapp_contacts'); const d = await col.findOne({ _id: String(phone) }, { projection: { botPaused: 1, bloqueado: 1 } }); return !!(d && (d.botPaused || d.bloqueado)); } catch (_) { return false; }
}

// ── Debounce: junta mensagens picadas do mesmo telefone antes de responder ──
const buffers = new Map(); // phone -> { parts:[], timer }
function scheduleFlush(phone) {
  const c = CFG();
  const b = buffers.get(phone); if (!b) return;
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => { flush(phone).catch(() => {}); }, c.debounceMs);
}
async function flush(phone) {
  const b = buffers.get(phone); if (!b) return;
  buffers.delete(phone);
  const text = b.parts.join('\n').trim();
  if (!text) return;
  await runAgent(phone, text);
}

// ── "Cutucão" de confirmação do @: se a IA pediu pra confirmar o perfil e o cliente
// sumir por ~2min, manda um retorno. Cancelado assim que o cliente responde. ──
const CONFIRM_NUDGE_MS = Math.max(30000, Number(process.env.WHATSAPP_IA_CONFIRM_NUDGE_MS || 120000) || 120000);
const confirmNudges = new Map(); // phone -> timeout
function cancelNudge(phone) {
  const p = String(phone || '');
  const t = confirmNudges.get(p);
  if (t) { try { clearTimeout(t); } catch (_) {} confirmNudges.delete(p); try { console.log('🔕 [cutucão] cancelado (cliente respondeu) ' + p); } catch (_) {} }
}
function buildConfirmNudgeText(username) {
  const u = username ? ('*@' + String(username).replace(/^@+/, '') + '*') : 'tu perfil';
  return '¿Sigues por ahí? Confírmame si ' + u + ' es correcto y sigo con tu pedido.';
}
function scheduleConfirmNudge(phone, username) {
  const p = String(phone || '');
  cancelNudge(p);
  const txt = buildConfirmNudgeText(username);
  try { console.log('🔔 [cutucão] agendado ' + p + ' em ' + Math.round(CONFIRM_NUDGE_MS / 1000) + 's (@' + String(username || '?') + ')'); } catch (_) {}
  const t = setTimeout(async () => {
    confirmNudges.delete(p);
    try { if (await isBotPaused(p)) { console.log('🔕 [cutucão] pulado (IA pausada) ' + p); return; } } catch (_) {} // humano assumiu → não cutuca
    try { await sendWhatsAppText(p, txt); console.log('🔔 [cutucão] DISPARADO ' + p); } catch (e) { try { console.error('🔔 [cutucão] falha ao enviar ' + p + ':', e && e.message); } catch (_) {} }
  }, CONFIRM_NUDGE_MS);
  try { if (t && t.unref) t.unref(); } catch (_) {}
  confirmNudges.set(p, t);
}

// Chama o agente e, se ele acabou pedindo a confirmação do @, agenda o cutucão.
// UM turno por telefone de cada vez: mensagem que chega enquanto o agente ainda responde
// espera e vai no turno seguinte, junto. Antes rodavam dois turnos em paralelo com o
// histórico velho — o bot pedia nome/e-mail de novo depois do Pix e contradizia o preço.
const turnosEmAndamento = new Map(); // phone -> { pendentes: [] }

// ── Anti-loop / anti-flood ───────────────────────────────────────────────────
// Se a IA responder demais para o MESMO número numa janela curta (ex.: outro bot
// conversando com a gente num vai-e-vem infinito), pausa a IA nessa conversa e
// passa pro humano. Conta 1 por TURNO da IA (não por mensagem mesclada).
// Duas réguas: RAJADA (ritmo de robô: >10 turnos em 5min) e TETO por hora (>40 em 60min).
// Antes era só 15/60min e cortava cliente de verdade que comprava 2 coisas seguidas
// (ex.: 556792085965 em 11/11 — 16 mensagens em ~30min, uma a cada 1-2min, e ficou sem o Pix).
const IA_FLOOD_MAX = Math.max(0, Number(process.env.WHATSAPP_IA_FLOOD_MAX || 40) || 40);                 // teto na janela longa; 0 = desativado
const IA_FLOOD_WINDOW_MS = Math.max(60000, (Number(process.env.WHATSAPP_IA_FLOOD_WINDOW_MIN || 60) || 60) * 60000); // janela longa (default 60min)
const IA_FLOOD_BURST_MAX = Math.max(0, Number(process.env.WHATSAPP_IA_FLOOD_BURST_MAX || 10) || 10);     // rajada; 0 = desativado
const IA_FLOOD_BURST_WINDOW_MS = Math.max(60000, (Number(process.env.WHATSAPP_IA_FLOOD_BURST_WINDOW_MIN || 5) || 5) * 60000); // janela curta (default 5min)
const iaReplyTimes = new Map(); // phone -> number[] timestamps das respostas da IA
async function tripFloodGuard(phone) {
  if (!(IA_FLOOD_MAX > 0) && !(IA_FLOOD_BURST_MAX > 0)) return false; // desativado por config
  const p = String(phone || '');
  const now = Date.now();
  const janela = Math.max(IA_FLOOD_WINDOW_MS, IA_FLOOD_BURST_WINDOW_MS);
  const arr = (iaReplyTimes.get(p) || []).filter((t) => (now - t) < janela);
  arr.push(now);
  iaReplyTimes.set(p, arr);
  if (iaReplyTimes.size > 5000) { // limpeza defensiva de memória
    for (const [k, v] of iaReplyTimes) { if (!v.length || (now - v[v.length - 1]) > janela) iaReplyTimes.delete(k); }
  }
  const nLonga = arr.filter((t) => (now - t) < IA_FLOOD_WINDOW_MS).length;
  const nRajada = arr.filter((t) => (now - t) < IA_FLOOD_BURST_WINDOW_MS).length;
  let motivo = '';
  if (IA_FLOOD_BURST_MAX > 0 && nRajada > IA_FLOOD_BURST_MAX) motivo = `${nRajada} respostas em ${Math.round(IA_FLOOD_BURST_WINDOW_MS / 60000)}min`;
  else if (IA_FLOOD_MAX > 0 && nLonga > IA_FLOOD_MAX) motivo = `${nLonga} respostas em ${Math.round(IA_FLOOD_WINDOW_MS / 60000)}min`;
  if (!motivo) return false;
  try {
    const col = await getCollection('whatsapp_contacts');
    await col.updateOne({ _id: p }, { $set: { botPaused: true, flag: 'suporte', supportReason: `IA pausada: anti-loop (${motivo})`, supportAt: new Date().toISOString() } }, { upsert: true });
  } catch (_) {}
  iaReplyTimes.delete(p); // já pausou; zera pra não re-disparar
  try { console.warn(`🛑 [IA] anti-loop: ${p} ${motivo} → IA pausada + flag suporte`); } catch (_) {}
  return true;
}

async function runAgent(phone, text) {
  const p = String(phone || '');
  const andamento = turnosEmAndamento.get(p);
  if (andamento) { andamento.pendentes.push(text); try { console.log('⏳ [IA] ' + p + ' ainda respondendo — mensagem entra no próximo turno'); } catch (_) {} return null; }
  if (await tripFloodGuard(p)) return null; // anti-loop: pausou a IA e sinalizou humano
  const estado = { pendentes: [] };
  turnosEmAndamento.set(p, estado);
  let res = null;
  try {
    let atual = text;
    while (atual) {
      res = null;
      try { res = await agent.handleAgentMessage({ phone: p, text: atual }, sendWhatsAppText); }
      catch (e) { try { console.error('❌ IA erro:', e && e.message); } catch (_) {} }
      try { console.log('🤖 [IA] turno ' + p + ' → awaitingConfirm=' + !!(res && res.awaitingConfirm)); } catch (_) {}
      try { if (res && res.awaitingConfirm) scheduleConfirmNudge(p, res.username); } catch (_) {}
      atual = estado.pendentes.splice(0).join('\n').trim();
      if (atual && await isBotPaused(p)) break;   // humano assumiu no meio: não responde o resto
    }
  } finally { turnosEmAndamento.delete(p); }
  return res;
}

// ── Áudio do cliente → texto ────────────────────────────────────────────────
// Antes, quem mandava áudio ficava SEM resposta: a mídia era só registrada como "[áudio]"
// e não chegava no agente (que é texto). Agora baixa da Meta e transcreve na OpenAI, o
// texto vai pro CRM e pro agente. Se falhar, cai no comportamento antigo.
const TRANSCREVER_AUDIO = String(process.env.WHATSAPP_IA_TRANSCREVER_AUDIO || 'true').toLowerCase() !== 'false';
const TRANSCRIBE_MODEL = String(process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1').trim();
const AUDIO_MAX_BYTES = Math.max(1, Number(process.env.WHATSAPP_IA_AUDIO_MAX_MB || 12) || 12) * 1024 * 1024;

async function transcreverAudio(mediaId, mimeIn) {
  const c = CFG();
  const openai = String(process.env.OPENAI_API_KEY || '').trim();
  if (!TRANSCREVER_AUDIO || !openai || !c.token || !mediaId) return '';
  if (typeof FormData === 'undefined' || typeof Blob === 'undefined') return '';   // Node antigo: segue sem transcrição
  try {
    const meta = await axios.get(`https://graph.facebook.com/${c.version}/${encodeURIComponent(String(mediaId))}`, { headers: { Authorization: 'Bearer ' + c.token }, timeout: 20000, validateStatus: () => true });
    const url = (meta && meta.status === 200 && meta.data && meta.data.url) ? String(meta.data.url) : '';
    if (!url) return '';
    const tamanho = Number((meta.data && meta.data.file_size) || 0);
    if (tamanho && tamanho > AUDIO_MAX_BYTES) { try { console.warn('🎧 [IA] áudio grande demais, não transcrito:', tamanho); } catch (_) {} return ''; }
    const bin = await axios.get(url, { headers: { Authorization: 'Bearer ' + c.token }, responseType: 'arraybuffer', timeout: 45000, validateStatus: () => true });
    if (bin.status !== 200 || !bin.data) return '';
    const buf = Buffer.from(bin.data);
    if (buf.length > AUDIO_MAX_BYTES) return '';
    const mime = String((meta.data && meta.data.mime_type) || mimeIn || 'audio/ogg').split(';')[0];
    const ext = /ogg/i.test(mime) ? 'ogg' : (/mp4|m4a|aac/i.test(mime) ? 'm4a' : (/mpeg|mp3/i.test(mime) ? 'mp3' : 'wav'));
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), 'audio.' + ext);
    fd.append('model', TRANSCRIBE_MODEL);
    fd.append('language', 'es');
    const r = await axios.post('https://api.openai.com/v1/audio/transcriptions', fd, { headers: { Authorization: 'Bearer ' + openai }, timeout: 90000, validateStatus: () => true });
    if (r.status !== 200) { try { console.warn('🎧 [IA] transcrição falhou:', r.status, JSON.stringify(r.data || {}).slice(0, 160)); } catch (_) {} return ''; }
    return String((r.data && r.data.text) || '').trim().slice(0, 1500);
  } catch (e) { try { console.warn('🎧 [IA] erro ao transcrever:', e && e.message); } catch (_) {} return ''; }
}

// ── Imagem do cliente → texto ───────────────────────────────────────────────
// Print de tela (página de refil com erro, perfil, comprovante): a IA não via nada e
// respondia às cegas. Baixa da Meta e pede à OpenAI uma descrição curta com os textos
// importantes (@ do Instagram, mensagens de erro, valores).
const LER_IMAGEM = String(process.env.WHATSAPP_IA_LER_IMAGEM || 'true').toLowerCase() !== 'false';
const VISION_MODEL = String(process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini').trim();
const IMAGEM_MAX_BYTES = 5 * 1024 * 1024;
async function descreverImagem(mediaId, mimeIn, legenda) {
  const c = CFG();
  const openai = String(process.env.OPENAI_API_KEY || '').trim();
  if (!LER_IMAGEM || !openai || !c.token || !mediaId) return '';
  try {
    const meta = await axios.get(`https://graph.facebook.com/${c.version}/${encodeURIComponent(String(mediaId))}`, { headers: { Authorization: 'Bearer ' + c.token }, timeout: 20000, validateStatus: () => true });
    const url = (meta && meta.status === 200 && meta.data && meta.data.url) ? String(meta.data.url) : '';
    if (!url) return '';
    const bin = await axios.get(url, { headers: { Authorization: 'Bearer ' + c.token }, responseType: 'arraybuffer', timeout: 45000, validateStatus: () => true });
    if (bin.status !== 200 || !bin.data) return '';
    const buf = Buffer.from(bin.data);
    if (buf.length > IMAGEM_MAX_BYTES) return '';
    const mime = String((meta.data && meta.data.mime_type) || mimeIn || 'image/jpeg').split(';')[0];
    const pedido = 'Un cliente de una tienda de seguidores/me gusta para Instagram mandó esta imagen por WhatsApp' + (legenda ? (' con el texto: "' + String(legenda).slice(0, 300) + '"') : '') + '. En español, en máximo 3 frases: di qué muestra la imagen y TRANSCRIBE exactamente los textos importantes — nombre de usuario de Instagram (@), mensajes de error, montos, número de seguidores, códigos de pedido, referencias o CLABE. No inventes lo que no se puede leer.';
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: VISION_MODEL, temperature: 0, max_tokens: 250,
      messages: [{ role: 'user', content: [{ type: 'text', text: pedido }, { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + buf.toString('base64'), detail: 'high' } }] }]
    }, { headers: { Authorization: 'Bearer ' + openai, 'Content-Type': 'application/json' }, timeout: 60000, validateStatus: () => true });
    if (r.status !== 200) { try { console.warn('🖼️ [IA] leitura de imagem falhou:', r.status, JSON.stringify(r.data || {}).slice(0, 160)); } catch (_) {} return ''; }
    openaiCredito.registrarUso(VISION_MODEL, r.data && r.data.usage);
    const msg = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
    return String((msg && msg.content) || '').trim().slice(0, 1200);
  } catch (e) { try { console.warn('🖼️ [IA] erro ao ler imagem:', e && e.message); } catch (_) {} return ''; }
}

// dedup de wamids reentregues pela Meta
const seenWamids = new Set();

async function handleInboundMessage(m, contactName) {
  const c = CFG();
  const from = String(m && m.from || '').trim();
  if (!from) return;
  const wamid = String(m && m.id || '');
  if (wamid) { if (seenWamids.has(wamid)) return; seenWamids.add(wamid); if (seenWamids.size > 5000) seenWamids.clear(); }

  // Cliente respondeu (qualquer tipo de mensagem) → cancela o cutucão pendente.
  cancelNudge(from);

  // Veio de anúncio que abre o WhatsApp: guarda o ctwa_clid para o pixel de mensagens (wppCapi.js).
  if (m.referral && m.referral.ctwa_clid) { try { require('./wppCapi.js').registrarClique(from, m.referral).catch(() => {}); } catch (_) {} }

  // Texto normal OU clique de botão interativo (button_reply / list_reply).
  let bodyRaw = (m.type === 'text' && m.text && m.text.body) ? String(m.text.body).trim() : '';
  // Veio do botão do WhatsApp do site: "(#XXXXX)" liga a conversa à visita (clique do anúncio) e sai do texto.
  if (bodyRaw && /\(#[A-Z0-9]{5}\)/.test(bodyRaw)) { try { bodyRaw = await require('./metaCapi.js').lerCodigoDaMensagem(from, bodyRaw); } catch (_) {} }
  const btn = (m.type === 'interactive' && m.interactive) ? (m.interactive.button_reply || m.interactive.list_reply) : null;
  const btnId = btn ? String(btn.id || '') : '';
  const btnTitle = btn ? String(btn.title || '') : '';
  const lc = bodyRaw.toLowerCase();

  // MÍDIA recebida (imagem/áudio/vídeo/documento/figurinha): registra no inbox e NÃO
  // passa pro agente (que é texto-only) — o atendente vê e responde pelo CRM.
  const MEDIA_TYPES = ['image', 'audio', 'voice', 'video', 'document', 'sticker'];
  if (MEDIA_TYPES.includes(m.type)) {
    const md = m[m.type] || {};
    const kind = (m.type === 'voice') ? 'audio' : m.type;
    // Áudio: transcreve e trata como se o cliente tivesse escrito — o CRM mostra o texto
    // junto do player e o agente responde normalmente.
    if (kind === 'audio') {
      const transcricao = await transcreverAudio(String(md.id || ''), String(md.mime_type || ''));
      if (transcricao) {
        try { console.log('🎧 [IA] áudio transcrito de ' + from + ': ' + transcricao.slice(0, 120)); } catch (_) {}
        await logIaMessage({ phone: from, direction: 'in', type: 'audio', text: '[áudio] ' + transcricao, mediaId: String(md.id || ''), mime: String(md.mime_type || ''), wamid: String(m.id || ''), name: contactName || '', replyTo: String((m.context && m.context.id) || '') });
        if (c.autoReply && !(await isBotPaused(from))) { await runAgent(from, transcricao); }
        return;
      }
    }
    // Imagem: a IA lê o conteúdo (print com @, erro, comprovante) e responde com base nele.
    // O CRM continua mostrando a foto; a descrição fica guardada junto da mensagem.
    if (kind === 'image') {
      const legenda = String(md.caption || '');
      if (c.autoReply && !(await isBotPaused(from))) {
        const descricao = await descreverImagem(String(md.id || ''), String(md.mime_type || ''), legenda);
        await logIaMessage({ phone: from, direction: 'in', type: 'image', text: legenda ? ('[imagem] ' + legenda) : '[imagem]', imagemDescricao: descricao || '', mediaId: String(md.id || ''), mime: String(md.mime_type || ''), wamid: String(m.id || ''), name: contactName || '', replyTo: String((m.context && m.context.id) || '') });
        if (descricao) {
          try { console.log('🖼️ [IA] imagem lida de ' + from + ': ' + descricao.slice(0, 120)); } catch (_) {}
          await runAgent(from, '[El cliente envió una IMAGEN' + (legenda ? (' con el texto "' + legenda + '"') : '') + '. Contenido: ' + descricao + ']');
        }
        return;
      }
    }
    const label = kind === 'image' ? '[imagem]' : kind === 'audio' ? '[áudio]' : kind === 'video' ? '[vídeo]' : kind === 'document' ? ('[documento] ' + (md.filename || '')) : kind === 'sticker' ? '[figurinha]' : '[mídia]';
    logIaMessage({ phone: from, direction: 'in', type: kind, text: (md.caption ? (label + ' ' + md.caption) : label), mediaId: String(md.id || ''), mime: String(md.mime_type || ''), filename: String(md.filename || ''), wamid: String(m.id || ''), name: contactName || '', replyTo: String((m.context && m.context.id) || '') }).catch(() => {});
    return;
  }

  // Registra a mensagem RECEBIDA no inbox (mesmo se o bot estiver pausado / for comando).
  const inboundText = bodyRaw || (btnTitle ? ('🔘 ' + btnTitle) : '');
  if (inboundText && !/^\/(pause|pausar|pausa|start|iniciar|começar|comecar|resume|retomar)$/.test(lc)) {
    logIaMessage({ phone: from, direction: 'in', type: btn ? 'button' : (m.type || 'text'), text: inboundText, wamid: String(m.id || ''), name: contactName || '', replyTo: String((m.context && m.context.id) || '') }).catch(() => {});
  }

  // "Pare"/"sair" no número da IA: para de receber retomada automática (a conversa segue normal).
  if (bodyRaw && RE_REC_OPTOUT.test(bodyRaw)) { markRecoveryOptOut(from).catch(() => {}); }

  // Comandos de controle (texto): /pause e /start (para operar o número da IA).
  if (/^\/(pause|pausar|pausa)$/.test(lc)) { try { const col = await getCollection('whatsapp_contacts'); await col.updateOne({ _id: from }, { $set: { botPaused: true } }, { upsert: true }); } catch (_) {} return; }
  if (/^\/(start|iniciar|começar|comecar|resume|retomar)$/.test(lc)) { try { const col = await getCollection('whatsapp_contacts'); await col.updateOne({ _id: from }, { $set: { botPaused: false } }, { upsert: true }); } catch (_) {} try { await agent.clearHistory(from); } catch (_) {} return; }

  if (!c.autoReply) return;
  if (await isBotPaused(from)) return; // humano assumiu

  // ── Clique num botão do menu ──
  if (btnId) {
    if (btnId === 'ja_comprei') { await sendWhatsAppText(from, INSTRUCAO_JA_COMPREI); return; }
    if (btnId === 'preciso_suporte') { await sendWhatsAppText(from, PERGUNTA_SUPORTE); return; }
    if (btnId === 'quero_comprar') { await runAgent(from, 'Quiero comprar'); return; }
    if (btnTitle) { await runAgent(from, btnTitle); return; }
    return;
  }

  // ── Gatilho do MENU (frase exata) → boas-vindas com botões ──
  if (bodyRaw && isTriggerMessage(bodyRaw)) { await sendWhatsAppButtons(from, WELCOME_TEXT, MENU_BUTTONS); return; }
  // ── Gatilhos de VENDA (frases exatas) → inicia a venda na hora (sem debounce) ──
  if (bodyRaw && isSalesTrigger(bodyRaw)) { await runAgent(from, bodyRaw); return; }

  // Só texto entra no funil de venda (mídia/áudio: ignora por ora).
  if (m.type !== 'text' || !bodyRaw) return;

  let b = buffers.get(from);
  if (!b) { b = { parts: [], timer: null }; buffers.set(from, b); }
  b.parts.push(bodyRaw);
  if (c.debounceMs <= 0) { await flush(from); } else { scheduleFlush(from); }
}

function registerWhatsappIa(app) {
  const c = CFG();
  const path = c.webhookPath || '/api/whatsapp-ia/webhook';

  // Verificação do webhook (Meta chama com hub.challenge)
  app.get(path, (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const cfg = CFG();
    if (mode === 'subscribe' && token && cfg.verifyToken && token === cfg.verifyToken) return res.status(200).send(challenge);
    return res.sendStatus(403);
  });

  // Recebe mensagens
  app.post(path, async (req, res) => {
    res.sendStatus(200); // responde rápido; processa async
    try {
      const body = req.body || {};
      if (body.object !== 'whatsapp_business_account') return;
      for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
          const value = change.value || {};
          const contacts = value.contacts || [];
          const nameByWa = {};
          for (const ct of contacts) { if (ct && ct.wa_id) nameByWa[String(ct.wa_id)] = (ct.profile && ct.profile.name) || ''; }
          for (const msg of (value.messages || [])) {
            handleInboundMessage(msg, nameByWa[String(msg.from)] || '').catch(() => {});
          }
        }
      }
    } catch (e) { try { console.error('❌ IA webhook erro:', e && e.message); } catch (_) {} }
  });

  try { console.log(`🤖 IA WhatsApp: webhook em ${path} | ${configured() ? 'configurado' : 'SEM credenciais (WHATSAPP_IA_*)'} | OpenAI ${agent.isEnabled() ? 'on' : 'off (fallback regras)'}`); } catch (_) {}
  try { startIaRecoveryLoop(); } catch (_) {}
}

// ── Recuperação automática no WhatsApp: cutuca leads que ESFRIARAM sem gerar Pix ──
// 1ª tentativa aos 30min do silêncio, 2ª aos 3h. Só dentro da janela de 24h do WhatsApp.
// Pula: bot pausado (humano assumiu), opt-out, quem já gerou Pix (converteu) e suporte/pós-venda.
// Dedup por ciclo (não repete a mesma etapa). Liga/desliga por IA_RECOVERY_ENABLED.
const IA_RECOVERY_ENABLED = String(process.env.IA_RECOVERY_ENABLED || 'true').toLowerCase() !== 'false';
const IA_RECOVERY_STAGE1_MIN = Number(process.env.IA_RECOVERY_STAGE1_MIN || 30) || 30;
const IA_RECOVERY_STAGE2_MIN = Number(process.env.IA_RECOVERY_STAGE2_MIN || 180) || 180;
const IA_RECOVERY_MAX_PER_RUN = Number(process.env.IA_RECOVERY_MAX_PER_RUN || 300) || 300;
// Intervalo aleatório entre cada envio da varredura, pra NÃO disparar tudo no mesmo
// segundo (bloco de mensagens idênticas = cara de spam). Pingam espaçados e humanos.
const IA_RECOVERY_SEND_GAP_MIN_MS = Number(process.env.IA_RECOVERY_SEND_GAP_MIN_MS || 5000) || 5000;
const IA_RECOVERY_SEND_GAP_MAX_MS = Number(process.env.IA_RECOVERY_SEND_GAP_MAX_MS || 18000) || 18000;
const _recSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _recPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Cada etapa/tipo tem VÁRIAS redações — sorteia uma por envio pra não mandar
// texto idêntico em bloco (o que o WhatsApp lê como spam).
// Preço de entrada = menor pacote de seguidores mixtos da tabela oficial (nunca fixo no texto).
function _precoDesde() {
  try {
    const { tabelaSeguidores, parsePrecoToCents } = require('./pricing.js');
    const it = (tabelaSeguidores.mistos || []).filter((x) => Number(x.q) >= 150).sort((a, b) => a.q - b.q)[0];
    if (it) return '$ ' + (parsePrecoToCents(it.p) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' MXN';
  } catch (_) {}
  return '';
}
const _REC_VARIANTS = {
  '2_sem_arroba': [
    'Todavía estás a tiempo de hacer crecer tu perfil hoy. Seguidores con entrega rápida y garantía de reposición. Solo mándame tu @ de Instagram y lo dejo listo.',
    '¡Hola! Si todavía quieres crecer tu perfil, te armo el paquete con entrega rápida y garantía. Mándame tu @ de Instagram y lo preparo.',
    '¿Le damos el empujón a tu perfil hoy? Seguidores con garantía y entrega rápida. Solo necesito tu @ de Instagram.',
  ],
  '2_geral': [
    '¿Todavía quieres darle el empujón a tu perfil? Seguidores con entrega rápida y garantía. Escríbeme y te armo tu paquete.',
    '¡Hola! Sigo por aquí si quieres continuar con el crecimiento de tu perfil. ¿Te armo tu paquete?',
    '¿Seguimos? Te puedo armar un paquete de seguidores con garantía y entrega rápida. Solo escríbeme.',
  ],
  '1_preco': [
    '¡Hola! Sobre el precio, tranquilo(a): hay paquetes desde {PRECO} y con garantía. ¿Te armo uno? Solo mándame tu @ de Instagram.',
    '¡Hola! Hay opciones desde {PRECO}, todo con garantía. Si quieres te armo un paquete para tu perfil. Mándame tu @ de Instagram.',
    'Sobre el precio: puedes empezar con {PRECO}, con garantía. ¿Te lo armo? Solo necesito tu @ de Instagram.',
  ],
  '1_sem_arroba': [
    '¡Hola! Para mostrarte los paquetes y armar tu pedido, solo mándame tu @ de Instagram.',
    '¡Hola! Mándame tu @ de Instagram y te muestro los paquetes y armo tu pedido.',
    '¡Hola! Solo me falta tu @ de Instagram para pasarte los paquetes y dejar tu pedido listo.',
  ],
  '1_geral': [
    '¡Hola! Vi que querías hacer crecer tu perfil. ¿Te armo el pedido? Mándame tu @ de Instagram y te paso todo.',
    '¡Hola! ¿Seguimos donde nos quedamos? Puedo armar tu pedido ahora. Mándame tu @ de Instagram.',
    '¡Hola! ¿Todavía quieres crecer tu perfil? Mándame tu @ de Instagram y armo tu pedido.',
  ],
};
function _recMsg(stage, tipo) {
  const t = (stage === 2) ? (tipo === 'sem_arroba' ? 'sem_arroba' : 'geral')
                          : (tipo === 'preco' ? 'preco' : (tipo === 'sem_arroba' ? 'sem_arroba' : 'geral'));
  let msg = _recPick(_REC_VARIANTS[stage + '_' + t] || _REC_VARIANTS['1_geral']);
  if (msg.includes('{PRECO}')) { const p = _precoDesde(); msg = p ? msg.split('{PRECO}').join(p) : _recPick(_REC_VARIANTS['1_geral']); }
  return msg;
}
// Limites anti-insistência (o relatório diário da IA apontava "follow-up repetitivo" como o
// problema nº 1): no máximo N retomadas por telefone a cada 24h, nada no horário de silêncio.
const IA_RECOVERY_MAX_24H = Math.max(1, Number(process.env.IA_RECOVERY_MAX_24H || 2) || 2);
const IA_RECOVERY_QUIET_START = Number(process.env.IA_RECOVERY_QUIET_START || 21); // hora do centro do México
const IA_RECOVERY_QUIET_END = Number(process.env.IA_RECOVERY_QUIET_END || 8);      // hora do centro do México
const IA_RECOVERY_PAID_DAYS = Math.max(1, Number(process.env.IA_RECOVERY_PAID_DAYS || 7) || 7);
// Cliente em suporte/pós-venda (inclui os botões "Ya compré" / "Necesito soporte").
const RE_REC_SUPORTE = /problema|reclam|estafa|fraude|soporte|no (me )?lleg|no (lo )?recib|reembols|devoluci|comprobante|ya pagu|ya compr|ya (est[aá] )?pagado|mi pedido|se cayeron|cayeron|bajaron|reposici|reponer|refil|desaparec|necesito soporte/;
// Último texto do bot foi o fallback de falha (ex.: sem crédito na OpenAI) → não manda modelo pronto.
const RE_REC_FALHA_BOT = /no alcanc[ée] a leer tu [uú]ltimo mensaje/i;
// Pedido de saída no número da IA → não recebe mais retomada.
const RE_REC_OPTOUT = /^\s*(alto|basta|stop|para|pare|ya no|ya no quiero|no me interesa|no gracias|no, gracias|cancelar|baja|dame de baja|s[áa]came( de la lista)?|b[óo]rrame|deja de (escribirme|mandarme mensajes)|no me escribas( m[áa]s)?)\s*[.!]*\s*$/i;
// Centro do México: UTC-6 o ano todo (sem horário de verão desde 2022).
function _horaBRT(ms) { return new Date(ms - 6 * 3600000).getUTCHours(); }
function _emSilencio(ms) {
  const h = _horaBRT(ms);
  return IA_RECOVERY_QUIET_START > IA_RECOVERY_QUIET_END ? (h >= IA_RECOVERY_QUIET_START || h < IA_RECOVERY_QUIET_END) : (h >= IA_RECOVERY_QUIET_START && h < IA_RECOVERY_QUIET_END);
}
// Últimos 10 dígitos: o WhatsApp manda 521XXXXXXXXXX e o site grava +52XXXXXXXXXX.
const _phoneTail = (p) => String(p || '').replace(/\D/g, '').slice(-10);
async function markRecoveryOptOut(phone) {
  const key = String(phone || '').replace(/\D/g, '');
  if (!key) return;
  try { const recCol = await getCollection('wa_ia_recovery'); await recCol.updateOne({ _id: key }, { $set: { optout: true, optoutAt: new Date().toISOString() } }, { upsert: true }); console.log('🔕 [ia-recovery] opt-out ' + phone); } catch (_) {}
}
let __iaRecoveryRunning = false;
async function runIaRecoverySweep() {
  if (!IA_RECOVERY_ENABLED || !configured() || __iaRecoveryRunning) return;
  if (_emSilencio(Date.now())) return; // horário de silêncio: nada sai (o ciclo continua depois)
  __iaRecoveryRunning = true;
  try {
    // Sem crédito na OpenAI o bot só responde o fallback: não adianta cutucar ninguém.
    try { const cr = await openaiCredito.status(); if (cr && cr.semCredito) { console.log('🔁 [ia-recovery] pulado: OpenAI sem crédito'); return; } } catch (_) {}
    const ia = await getCollection('wa_ia_messages');
    const orders = await getCollection('checkout_orders');
    const recCol = await getCollection('wa_ia_recovery');
    const optCol = await getCollection('wa_optout');
    const now = Date.now();
    // Quem PAGOU qualquer pedido (site ou bot) nos últimos dias não recebe oferta de compra.
    const paidPhones = new Set();
    try {
      const dP = new Date(now - IA_RECOVERY_PAID_DAYS * 86400000);
      const pagos = await orders.find({ status: 'pago', $or: [{ paidAt: { $gte: dP.toISOString() } }, { paidAt: { $gte: dP } }] }, { projection: { telefone: 1, 'customer.phone': 1, 'additionalInfoMap.phone': 1, 'additionalInfoMapPaid.phone': 1 } }).toArray();
      for (const o of pagos) {
        for (const p of [o.telefone, o.customer && o.customer.phone, o.additionalInfoMap && o.additionalInfoMap.phone, o.additionalInfoMapPaid && o.additionalInfoMapPaid.phone]) { const t = _phoneTail(p); if (t.length >= 10) paidPhones.add(t); }
      }
    } catch (_) {}
    const since = new Date(now - 26 * 3600000);
    const convs = await ia.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: {
        _id: '$phone',
        lastAnyAt: { $max: '$createdAt' },
        lastInAt: { $max: { $cond: [{ $eq: ['$direction', 'in'] }, '$createdAt', null] } },
        lastOrganicAt: { $max: { $cond: [{ $ifNull: ['$recovery', false] }, null, '$createdAt'] } },
        inTexts: { $push: { $cond: [{ $eq: ['$direction', 'in'] }, '$text', '$$REMOVE'] } },
      } },
      { $limit: 5000 },
    ]).toArray();
    const pixDocs = await orders.find({ correlationID: { $regex: '^WppAgent_' }, createdAt: { $gte: new Date(now - 3 * 86400000).toISOString() } }, { projection: { additionalInfoMap: 1, additionalInfo: 1, customer: 1 } }).toArray();
    const pixPhones = new Set();
    for (const o of pixDocs) { const m = o.additionalInfoMap || {}; let ph = m.telefone || m.phone || (o.customer && (o.customer.phone_number || o.customer.phone)) || ''; if (!ph && Array.isArray(o.additionalInfo)) { const x = o.additionalInfo.find(i => /telefone|phone/i.test(i.key)); ph = x && x.value; } ph = String(ph || '').replace(/\D/g, ''); if (ph) { pixPhones.add(_phoneTail(ph)); } }
    let enviados = 0;
    for (const c of convs) {
      if (enviados >= IA_RECOVERY_MAX_PER_RUN) break;
      const phone = String(c._id || '').trim(); const key = phone.replace(/\D/g, '');
      if (!key || !c.lastInAt) continue;
      if ((now - new Date(c.lastInAt).getTime()) > 24 * 3600000) continue; // fora da janela de 24h
      const baseMs = new Date(c.lastOrganicAt || c.lastAnyAt).getTime();
      const ageMin = (now - baseMs) / 60000;
      if (ageMin < IA_RECOVERY_STAGE1_MIN) continue; // ainda não esfriou
      if (pixPhones.has(_phoneTail(key))) continue; // já gerou pagamento pelo bot
      if (paidPhones.has(_phoneTail(key))) continue; // já é cliente pago recente (site ou bot)
      try { const ob = await optCol.findOne({ phoneKey: { $in: [key, _phoneTail(key)] } }, { projection: { blocked: 1 } }); if (ob && ob.blocked === true) continue; } catch (_) {}
      try { if (await isBotPaused(phone)) continue; } catch (_) {} // humano assumiu
      const txt = String((c.inTexts || []).join(' \n ')).toLowerCase();
      if (RE_REC_SUPORTE.test(txt)) continue; // suporte/pós-venda
      const temArroba = /@[a-z0-9._]{2,}|instagram\.com\//i.test(txt);
      const preco = /precio|cu[aá]nto|cuesta|costo|tabla|caro/.test(txt);
      const tipo = !temArroba ? 'sem_arroba' : (preco ? 'preco' : 'geral');
      let rec = null; try { rec = await recCol.findOne({ _id: key }); } catch (_) {}
      if (rec && rec.optout) continue; // pediu para parar
      if (!rec || Number(rec.baseMs) !== baseMs) { rec = { _id: key, baseMs, stage1At: null, stage2At: null }; try { await recCol.updateOne({ _id: key }, { $set: { baseMs, stage1At: null, stage2At: null, tipo, updatedAt: new Date() } }, { upsert: true }); } catch (_) {} }
      let stage = 0;
      if (ageMin >= IA_RECOVERY_STAGE2_MIN && !rec.stage2At) stage = 2;
      else if (ageMin >= IA_RECOVERY_STAGE1_MIN && ageMin < IA_RECOVERY_STAGE2_MIN && !rec.stage1At) stage = 1;
      if (!stage) continue;
      // Última resposta do bot foi o fallback de falha → o problema foi nosso, não manda modelo pronto.
      try {
        const lastOut = await ia.find({ phone, direction: 'out', recovery: { $exists: false } }, { projection: { text: 1 } }).sort({ createdAt: -1 }).limit(1).next();
        if (lastOut && RE_REC_FALHA_BOT.test(String(lastOut.text || ''))) continue;
      } catch (_) {}
      // Teto por telefone: no máximo IA_RECOVERY_MAX_24H retomadas nas últimas 24h (o ciclo
      // reinicia a cada nova mensagem, e sem teto um mesmo número chegou a receber 19).
      try {
        const n24 = await ia.countDocuments({ phone, direction: 'out', recovery: { $exists: true }, createdAt: { $gte: new Date(now - 24 * 3600000) } });
        if (n24 >= IA_RECOVERY_MAX_24H) continue;
      } catch (_) {}
      // Trava a etapa NO BANCO antes de enviar: com duas instâncias rodando a varredura, só uma
      // envia (antes saíam duplicadas no mesmo segundo). Envio que falha não é repetido.
      const stageField = 'stage' + stage + 'At';
      let claimed = false;
      try {
        const cl = await recCol.updateOne({ _id: key, baseMs, $or: [{ [stageField]: null }, { [stageField]: { $exists: false } }] }, { $set: { [stageField]: new Date().toISOString(), tipo } });
        claimed = !!(cl && cl.modifiedCount > 0);
      } catch (_) {}
      if (!claimed) continue;
      const msg = _recMsg(stage, tipo);
      try {
        const r = await sendWhatsAppText(phone, msg, { log: false });
        if (r && r.ok) {
          await logIaMessage({ phone, direction: 'out', type: 'text', text: msg, recovery: 'stage' + stage });
          try { await agent.appendAssistantNote(phone, msg); } catch (_) {} // a IA passa a saber o que foi enviado
          enviados++;
          try { console.log('🔁 [ia-recovery] stage' + stage + ' -> ' + phone + ' (' + tipo + ', ' + Math.round(ageMin) + 'min)'); } catch (_) {}
          // Espaça o próximo envio (intervalo aleatório) pra não cair tudo no mesmo segundo.
          const gap = IA_RECOVERY_SEND_GAP_MIN_MS + Math.floor(Math.random() * Math.max(0, IA_RECOVERY_SEND_GAP_MAX_MS - IA_RECOVERY_SEND_GAP_MIN_MS));
          await _recSleep(gap);
        } else {
          const err = (r && (r.error || (r.data && r.data.error) || r.status)) || 'falha_envio';
          try { await recCol.updateOne({ _id: key }, { $set: { ['stage' + stage + 'Erro']: typeof err === 'object' ? JSON.stringify(err).slice(0, 300) : String(err).slice(0, 300), ultimoErroAt: new Date().toISOString() } }); } catch (_) {}
          try { console.warn('🔁 [ia-recovery] falha stage' + stage + ' -> ' + phone + ': ' + (typeof err === 'object' ? JSON.stringify(err).slice(0, 200) : err)); } catch (_) {}
        }
      } catch (e) {
        try { await recCol.updateOne({ _id: key }, { $set: { ['stage' + stage + 'Erro']: String((e && e.message) || e).slice(0, 300), ultimoErroAt: new Date().toISOString() } }); } catch (_) {}
      }
    }
    if (enviados) { try { console.log('🔁 [ia-recovery] enviados: ' + enviados); } catch (_) {} }
  } catch (e) { try { console.error('🔁 [ia-recovery] erro:', e && e.message); } catch (_) {} }
  finally { __iaRecoveryRunning = false; }
}
function startIaRecoveryLoop() {
  if (!IA_RECOVERY_ENABLED) { try { console.log('🔁 [ia-recovery] DESATIVADO (IA_RECOVERY_ENABLED=false)'); } catch (_) {} return; }
  // Mesma chave dos outros jobs: instância de teste/local (BACKGROUND_JOBS_ENABLED=false) não envia.
  const bg = String(typeof process.env.BACKGROUND_JOBS_ENABLED === 'undefined' ? 'true' : process.env.BACKGROUND_JOBS_ENABLED).trim().toLowerCase();
  if (bg === 'false' || bg === '0' || bg === 'no') { try { console.log('⏸️ [ia-recovery] DESLIGADO (BACKGROUND_JOBS_ENABLED=false)'); } catch (_) {} return; }
  setTimeout(() => { runIaRecoverySweep().catch(() => {}); }, 100 * 1000);
  try { const t = setInterval(() => { runIaRecoverySweep().catch(() => {}); }, 5 * 60 * 1000); t.unref && t.unref(); } catch (_) {}
  try { console.log('🔁 [ia-recovery] ativo: 1ª aos ' + IA_RECOVERY_STAGE1_MIN + 'min, 2ª aos ' + IA_RECOVERY_STAGE2_MIN + 'min, varre a cada 5min'); } catch (_) {}
}

module.exports = { transcreverAudio, registerWhatsappIa, sendWhatsAppText, sendWhatsAppMedia, sendWhatsAppButtons, isBotPaused, handleInboundMessage, configured, isTriggerMessage, isSalesTrigger, buildConfirmNudgeText, CONFIRM_NUDGE_MS, MENU_BUTTONS, WELCOME_TEXT, logIaMessage, getIaConfig: CFG, runIaRecoverySweep, startIaRecoveryLoop };
