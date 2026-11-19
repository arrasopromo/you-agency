// Página de serviços de TikTok e Facebook (/servicios-tiktok, /servicios-facebook).
// Mesmo padrão visual e de etapas da página do Instagram (servicos-instagram.js): cards de tipo,
// descrição, pacotes com selo e preço riscado (+15%), Detalles, Resumen e pagamento SPEI.
// Catálogo e preços vêm do servidor (/api/redes/catalogo → pricing.js tabelaRedes), então o valor
// enviado bate com o verifyPrice do /api/xpag/create-charge.
(function () {
  var main = document.getElementById('rdMain');
  if (!main) return;
  var rede = main.getAttribute('data-rede') === 'facebook' ? 'facebook' : 'tiktok';
  var NOME = rede === 'facebook' ? 'Facebook' : 'TikTok';
  var $ = function (id) { return document.getElementById(id); };
  var tipoCards = $('tipoCards'), planCards = $('planCards'), descCard = $('tipoDescCard'), descContent = $('tipoDescContent');
  var servicos = [], servico = null, pacote = null;
  // Funil por visitante (o servidor grava pelo cookie ya_cid). Só registra — nunca bloqueia a compra.
  function funilEvento(evento, dados) {
    try {
      var body = JSON.stringify(Object.assign({ evento: evento, servico: rede + (servico ? '_' + kind(servico) : ''), tipo: servico ? servico.tipo : '', qtd: pacote ? Number(pacote.q) || null : null }, dados || {}));
      if (navigator.sendBeacon && navigator.sendBeacon('/api/funil/evento', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/funil/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (_) {}
  }

  // Pesos inteiros sem casas decimais ("$ 20"); com centavos (cupom %) mostra 2 casas.
  var fmt = function (cents) { var c = Math.round(cents); return '$ ' + (c % 100 === 0 ? (c / 100).toLocaleString('en-US') : (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var linkOk = function (u) {
    u = String(u || '').trim();
    if (!/^https?:\/\//i.test(u)) return false;
    return rede === 'tiktok' ? /^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(u) : /^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fb\.com|fb\.watch)\//i.test(u);
  };
  var digits = function (s) { return String(s || '').replace(/\D/g, ''); };
  // Telefone México, igual à etapa 2 do Instagram: "+52" fixo antes, máscara "55 1234 5678",
  // backend recebe "52" + 10 dígitos.
  var mxNac = function (v) { var d = digits(v); if (d.length === 13 && d.indexOf('521') === 0) d = d.slice(3); else if (d.length > 10 && d.indexOf('52') === 0) d = d.slice(2); return d; };
  var phoneLen = function (s) { return mxNac(s).length; };
  var mascaraMx = function (v) { var s = mxNac(v).slice(0, 10); if (!s) return ''; var o = s.slice(0, 2); if (s.length > 2) o += ' ' + s.slice(2, 6); if (s.length > 6) o += ' ' + s.slice(6, 10); return o; };
  var foneBackend = function (v) { var d = mxNac(v); return d.length === 10 ? '52' + d : ''; };
  (function () {
    var inp = $('contactPhoneInput');
    if (!inp || inp.parentNode.classList.contains('mx-phone-wrap')) return;
    var wrap = document.createElement('div'); wrap.className = 'mx-phone-wrap';
    var ddi = document.createElement('span'); ddi.className = 'mx-phone-ddi'; ddi.textContent = '🇲🇽 +52'; ddi.setAttribute('aria-hidden', 'true');
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(ddi); wrap.appendChild(inp);
    inp.setAttribute('aria-label', 'Teléfono (México, +52)');
    inp.addEventListener('input', function () {
      var raw = String(inp.value || '');
      if (!(/^\s*\+/.test(raw) && digits(raw).length <= 12)) inp.value = mascaraMx(raw);
      if (phoneLen(inp.value) === 10) escondeErro('phoneErrorMsg');
    });
    inp.addEventListener('blur', function () { inp.value = mascaraMx(inp.value); });
  })();
  var mostraErro = function (id, txt) { var e = $(id); if (!e) return; if (txt != null) e.textContent = txt; e.style.display = 'block'; };
  var escondeErro = function (id) { var e = $(id); if (e) e.style.display = 'none'; };

  // Mesmas regras de pacote/selo da página do Instagram.
  var kind = function (s) { return /seguidores/.test(s.tipo) ? 'seguidores' : (/curtidas/.test(s.tipo) ? 'curtidas' : (/comentarios/.test(s.tipo) ? 'comentarios' : 'visualizacoes')); };
  var BADGES = { 150: 'INICIAL', 500: 'BÁSICO', 1000: 'MÁS POPULAR', 3000: 'EXCLUSIVO', 5000: 'VIP', 10000: 'ÉLITE' };
  function pacotesVisiveis(s) {
    var k = kind(s), arr = s.pacotes.slice();
    if (k === 'seguidores') return arr.filter(function (p) { return BADGES.hasOwnProperty(p.q); });
    if (k === 'curtidas') return arr.slice(0, 6);
    if (k === 'comentarios') return arr;
    var views = [1000, 5000, 25000, 100000, 200000, 500000];
    return arr.filter(function (p) { return views.indexOf(p.q) >= 0; });
  }
  function selo(s, q) {
    var k = kind(s);
    if (k === 'seguidores') { if (q === 1000) return ['MEJOR PRECIO', false]; if (q === 3000) return ['MÁS POPULAR', true]; return [BADGES[q] || '', false]; }
    if (k === 'comentarios') { var mc = { 10: 'INICIAL', 25: 'BÁSICO', 50: 'MEJOR PRECIO', 100: 'MÁS POPULAR', 250: 'VIP' }; return [mc[q] || '', q === 100]; }
    if (k === 'visualizacoes') { var m = { 1000: 'INICIAL', 5000: 'BÁSICO', 25000: 'MEJOR PRECIO', 100000: 'MÁS POPULAR', 200000: 'VIP', 500000: 'ÉLITE' }; return [m[q] || '', q === 100000]; }
    return [BADGES[q] || '', q === 1000];
  }
  var descricoes = {
    tiktok_seguidores: ['Seguidores para tu perfil de TikTok con entrega rápida y estable.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '🌍 Perfiles de varios países para hacer crecer tu cuenta.', '🔗 Solo necesitas el enlace de tu perfil.']],
    tiktok_curtidas_reais: ['Me gusta de perfiles reales para tus videos de TikTok.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '❤️ Me gusta de perfiles reales y activos.', '🔗 Solo necesitas el enlace del video.']],
    tiktok_curtidas: ['Me gusta para tus videos de TikTok con entrega rápida.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '❤️ Refuerza la prueba social de tus videos.', '🔗 Solo necesitas el enlace del video.']],
    tiktok_visualizacoes: ['Vistas para tus videos de TikTok.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '🎬 Da un impulso inicial a tus videos.', '🔗 Solo necesitas el enlace del video.']],
    facebook_seguidores: ['Seguidores para tu perfil o página de Facebook.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '👥 Sirve para perfiles personales y páginas (fanpage).', '🔗 Solo necesitas el enlace del perfil o de la página.']],
    facebook_seguidores_perfil: ['Seguidores para tu perfil personal de Facebook.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '👤 Para perfiles personales (no páginas).', '🔗 Solo necesitas el enlace de tu perfil.']],
    facebook_seguidores_pagina: ['Seguidores para tu página (fanpage) de Facebook.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '🏢 Para páginas de negocio, marca o creador.', '🔗 Solo necesitas el enlace de tu página.']],
    facebook_curtidas: ['Me gusta para tus publicaciones de Facebook.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '❤️ Refuerza la prueba social de tus publicaciones.', '🔗 Solo necesitas el enlace de la publicación.']],
    tiktok_comentarios: ['Comentarios para tus videos de TikTok.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '💬 Comentarios positivos de perfiles de calidad.', '🔗 Solo necesitas el enlace del video.']],
    facebook_comentarios: ['Comentarios para tus publicaciones y videos de Facebook.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '💬 Comentarios positivos de perfiles de calidad.', '🔗 Solo necesitas el enlace de la publicación.']],
    facebook_visualizacoes: ['Vistas para tus videos y reels de Facebook.', ['✅ 100% seguro y confidencial, sin pedir contraseña.', '🎬 Da un impulso inicial a tus videos.', '🔗 Solo necesitas el enlace del video.']],
  };
  var labelTipo = function (s) { return s.titulo + (s.tipo.indexOf('seguidores') >= 0 && rede === 'tiktok' ? '' : ''); };

  // Igual ao Instagram: cada link é um serviço só (seguidores, me gusta ou vistas);
  // os cards de tipo são só as variações dele (no Facebook: seguidores de perfil e de página).
  var preSv = String(new URLSearchParams(location.search).get('servicio') || '').toLowerCase();
  var FOCO = /coment|comment/.test(preSv) ? 'comentarios' : (/curtid|gusta|like/.test(preSv) ? 'curtidas' : (/visualiz|view/.test(preSv) ? 'visualizacoes' : 'seguidores'));
  var LABEL_TIPO = {
    tiktok_seguidores: 'Seguidores mixtos', tiktok_curtidas: 'Me gusta mixtos', tiktok_curtidas_reais: 'Me gusta reales', tiktok_visualizacoes: 'Vistas', tiktok_comentarios: 'Comentarios', facebook_comentarios: 'Comentarios',
    facebook_seguidores: 'Seguidores', facebook_seguidores_perfil: 'Seguidores de perfil', facebook_seguidores_pagina: 'Seguidores de página',
    facebook_curtidas: 'Me gusta mixtos', facebook_visualizacoes: 'Vistas'
  };
  function renderTipoCards() {
    tipoCards.innerHTML = '';
    var lista = servicos.filter(function (s) { return kind(s) === FOCO; });
    tipoCards.setAttribute('data-n', String(lista.length));
    if (!lista.length) { tipoCards.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:#6b7280; padding:18px 8px;">Este servicio no está disponible por ahora.</p>'; return; }
    var pre = preSv;
    var escolhido = null, primeiro = null;
    lista.forEach(function (s) {
      var card = document.createElement('div');
      card.className = 'service-card option-card';
      card.setAttribute('data-role', 'tipo');
      card.setAttribute('data-tipo', s.tipo);
      card.innerHTML = '<div class="card-content"><div class="card-title" style="text-align:center;">' + esc(LABEL_TIPO[s.tipo] || labelTipo(s)) + '</div></div>';
      card.addEventListener('click', function () { escolherTipo(s, card); });
      tipoCards.appendChild(card);
      if (pre && (s.tipo === pre || s.tipo === rede + '_' + pre)) escolhido = [s, card];
      else if (!escolhido && !primeiro) primeiro = [s, card];
    });
    escolhido = escolhido || primeiro; // sem tipo no link: já abre no primeiro (no Facebook, perfil)
    if (escolhido) setTimeout(function () { escolherTipo(escolhido[0], escolhido[1]); }, 0);
  }

  // Rolagem do celular até os cards de pacotes (igual à Oppus e às páginas do Instagram): 6s.
  var scrollCardsTimer = null;
  function rolarAteCardsMobile() {
    if (scrollCardsTimer) { clearTimeout(scrollCardsTimer); scrollCardsTimer = null; }
    if (window.innerWidth > 640) return;
    scrollCardsTimer = setTimeout(function () {
      scrollCardsTimer = null;
      if (!planCards || planCards.style.display === 'none' || !planCards.children.length) return;
      if ($('step1Container').style.display === 'none' || planCards.offsetParent === null) return; // já saiu da etapa 1
      var alvo = planCards.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop) - 120;
      try { window.scrollTo({ top: alvo, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, alvo); }
    }, 6000);
  }

  function escolherTipo(s, card) {
    servico = s; pacote = null;
    Array.prototype.forEach.call(tipoCards.querySelectorAll('.option-card'), function (c) { c.classList.toggle('active', c === card); });
    var d = descricoes[s.tipo];
    if (d) {
      descContent.innerHTML = '<p>' + esc(d[0]) + '</p><ul>' + d[1].map(function (li) { return '<li>' + esc(li) + '</li>'; }).join('') + '</ul>';
      descCard.style.display = '';
    }
    renderPlanCards(s);
    rolarAteCardsMobile();
  }

  function renderPlanCards(s) {
    planCards.innerHTML = '';
    planCards.style.display = '';
    pacotesVisiveis(s).forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'service-card plan-card';
      card.setAttribute('data-role', 'plano');
      card.setAttribute('data-qtd', p.q);
      var inc = Math.round(p.cents * 1.15);
      var old = Math.ceil(inc / 100) * 100; // pesos inteiros
      var sl = selo(s, p.q);
      if (sl[1]) card.classList.add('gold-card');
      card.innerHTML = (sl[0] ? '<div class="plan-badge">' + sl[0] + '</div>' : '') +
        '<div class="card-content"><div class="card-title">' + Number(p.q).toLocaleString('en-US') + ' ' + esc(s.unidade) + '</div>' +
        '<div class="card-desc"><span class="price-old">' + fmt(old) + '</span> <span class="price-new">' + fmt(p.cents) + '</span></div></div>';
      card.addEventListener('click', function () {
        pacote = p;
        funilEvento('pacote_escolhido', { preco: fmt(p.cents) });
        Array.prototype.forEach.call(planCards.querySelectorAll('.plan-card'), function (c) { c.classList.toggle('active', c === card); });
        prepararDetalhes();
        window.goToStep(2);
      });
      planCards.appendChild(card);
    });
  }

  // ── Etapa 2: busca do perfil (igual ao "Buscar" do Instagram) ──
  var perfilOk = null; // { username, nome, link, privado, ... } depois de buscar
  var inpUser = $('usernameCheckoutInput'), btnBuscar = $('checkCheckoutButton');
  // Mesmo formato do TikTok: 40.6K, 3.8M.
  var fmtN = function (n) { if (n == null || !isFinite(n)) return '-'; n = Number(n); if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return n.toLocaleString('en-US'); };
  function status(msg, tipo) { var e = $('statusCheckoutMessage'); if (!msg) { e.style.display = 'none'; return; } e.textContent = msg; e.className = 'status-message ' + (tipo === 'error' ? 'error' : 'success'); e.style.display = 'block'; }
  function escondeBalao() { var b = $('tutorial3Usuario'); if (b) { b.style.display = 'none'; b.classList.add('hide'); } }
  function buscarPerfil() {
    var q = inpUser.value.trim();
    if (!q) { status(rede === 'tiktok' ? 'Escribe tu usuario de TikTok.' : 'Pega el enlace de tu perfil o página de Facebook.', 'error'); return; }
    escondeBalao(); status('');
    perfilOk = null; $('profilePreview').style.display = 'none'; $('contactFieldsArea').style.display = 'none';
    atualizaBotoesGrade();
    $('loadingCheckoutSpinner').style.display = 'block'; btnBuscar.disabled = true;
    fetch('/api/redes/perfil?rede=' + rede + '&q=' + encodeURIComponent(q))
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        $('loadingCheckoutSpinner').style.display = 'none'; btnBuscar.disabled = false;
        if (!d || !d.ok) {
          var msgs = { entrada_invalida: rede === 'tiktok' ? 'Usuario inválido. Escríbelo como @usuario.' : 'Enlace inválido. Pega el enlace de tu perfil o página de Facebook.', nao_encontrado: 'No encontramos este perfil. Revisa el usuario o el enlace.', muitas_buscas: 'Demasiadas búsquedas. Espera un minuto e inténtalo de nuevo.' };
          status(msgs[d && d.error] || 'No pudimos consultar el perfil ahora. Inténtalo de nuevo en unos segundos.', 'error');
          return;
        }
        $('checkoutProfileImage').src = d.avatar ? '/api/redes/avatar?u=' + encodeURIComponent(d.avatar) : '/images/default-avatar.svg';
        $('checkoutProfileImage').onerror = function () { this.onerror = null; this.src = '/images/default-avatar.svg'; };
        $('checkoutProfileUsername').textContent = rede === 'tiktok' ? '@' + d.username : d.nome;
        $('checkoutProfileName').textContent = rede === 'tiktok' ? (d.nome || '') : String(d.link || '').replace(/^https:\/\/(www\.)?/, '');
        var stats = [];
        if (rede === 'tiktok') stats = [[d.seguindo, 'seguidos'], [d.seguidores, 'seguidores'], [d.curtidas, 'me gusta']].filter(function (x) { return x[0] != null; });
        else if (d.seguidores != null) stats = [[d.seguidores, 'seguidores']];
        $('checkoutProfileStats').innerHTML = stats.map(function (x) { return '<div><strong>' + esc(fmtN(x[0])) + '</strong> ' + x[1] + '</div>'; }).join('');
        $('profilePreview').style.display = 'block';
        if (d.privado) { status('Tu cuenta es privada. Cámbiala a pública y vuelve a buscar para continuar.', 'error'); return; }
        perfilOk = d;
        funilEvento('perfil_validado');
        status('¡Perfil encontrado!', 'success');
        $('contactFieldsArea').style.display = 'block';
        // Vídeo de outro perfil não vale: limpa a escolha se trocou de @.
        if (videosCache.user && videosCache.user !== d.username) { videosCache = { user: '', list: null }; if ($('rdVideoSel').style.display !== 'none') { $('rdLink').value = ''; mostraVideoSel(null); } }
        atualizaBotoesGrade();
        // Serviço de vídeo no TikTok: abre a grade para escolher (como a seleção de publicação do Instagram).
        if (gradeAtiva && servico && servico.alvo === 'post' && !$('rdLink').value.trim()) abrirGrade('principal');
      })
      .catch(function () { $('loadingCheckoutSpinner').style.display = 'none'; btnBuscar.disabled = false; status('Sin conexión. Inténtalo de nuevo.', 'error'); });
  }
  btnBuscar.addEventListener('click', buscarPerfil);
  inpUser.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); buscarPerfil(); } });
  inpUser.addEventListener('input', escondeBalao);
  inpUser.addEventListener('paste', escondeBalao);
  $('tutorial3Usuario').addEventListener('click', escondeBalao);

  function prepararDetalhes() {
    var perfil = servico.alvo === 'perfil';
    $('postLinkArea').style.display = perfil ? 'none' : 'block';
    if (!perfil) {
      $('rdLinkLabel').textContent = rede === 'tiktok' ? 'Enlace del video de TikTok' : 'Enlace de la publicación o video de Facebook';
      $('rdLink').placeholder = rede === 'tiktok' ? 'https://www.tiktok.com/@usuario/video/…' : 'https://www.facebook.com/…';
      $('rdLinkHint').textContent = (gradeAtiva ? 'O pega el enlace: abre' : 'Abre') + ' la publicación en ' + NOME + ', toca "Compartir" y "Copiar enlace". Debe ser pública.';
    }
    atualizaBotoesGrade();
  }
  var linkDoPedido = function () { return servico && servico.alvo === 'perfil' ? (perfilOk ? perfilOk.link : '') : $('rdLink').value.trim(); };

  // ── Grade de vídeos do TikTok (igual à seleção de publicação do Instagram) ─────────────
  // /api/redes/videos devolve os 10 vídeos mais recentes do perfil buscado (embed do criador).
  // Escolher um vídeo preenche o campo do link (etapa 2) ou o link das ofertas (etapa 3).
  var videosCache = { user: '', list: null };
  var gradeAtiva = rede === 'tiktok';
  function fmtViews(n) { return n == null ? '' : fmtN(n); }
  // Data da postagem (mesmo formato da grade do Instagram: toLocaleString es-MX).
  function dataVideo(v) { return v && v.ts ? new Date(v.ts * 1000).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function capaSrc(u) { return u ? '/api/redes/avatar?u=' + encodeURIComponent(u) : ''; }
  function carregarVideos(cb) {
    var u = perfilOk && perfilOk.username;
    if (!u) return cb(null, 'sem_perfil');
    if (videosCache.user === u && videosCache.list) return cb(videosCache.list);
    fetch('/api/redes/videos?rede=tiktok&q=' + encodeURIComponent(u))
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.videos)) { videosCache = { user: u, list: d.videos }; return cb(d.videos, d.privado ? 'privado' : ''); }
        cb(null, (d && d.error) || 'erro');
      })
      .catch(function () { cb(null, 'erro'); });
  }
  function fecharGrade() { $('rdVideoModal').style.display = 'none'; try { document.body.style.overflow = ''; } catch (_) {} }
  // destino: 'principal' (link do serviço) | 'ofertas' (link dos me gusta/visualizaciones/comentarios extras)
  function abrirGrade(destino) {
    if (!gradeAtiva || !perfilOk) return;
    var input = destino === 'ofertas' ? $('bumpLink') : $('rdLink');
    var modal = $('rdVideoModal'), grid = $('rdVideoGrid');
    if (modal.parentNode !== document.body) document.body.appendChild(modal);
    var k = kind(servico);
    $('rdVideoModalTitle').textContent = destino === 'ofertas' ? 'Selecciona el video para las ofertas'
      : (k === 'visualizacoes' ? 'Selecciona el video que recibirá las vistas' : (k === 'comentarios' ? 'Selecciona el video que recibirá los comentarios' : 'Selecciona el video que recibirá los me gusta'));
    try { document.body.style.overflow = 'hidden'; } catch (_) {}
    modal.style.display = 'flex';
    grid.innerHTML = '<div class="rd-vid-msg">Cargando tus videos…</div>';
    carregarVideos(function (lista, motivo) {
      if (motivo === 'privado') { grid.innerHTML = '<div class="rd-vid-msg">Tu cuenta es privada. Cámbiala a pública para elegir el video.</div>'; return; }
      if (!lista || !lista.length) {
        grid.innerHTML = '<div class="rd-vid-msg">No pudimos cargar tus videos ahora. Cierra esta ventana y pega el enlace del video en el campo.</div>';
        return;
      }
      var atual = input.value.trim();
      grid.innerHTML = lista.map(function (v, i) {
        var sel = atual && atual.indexOf('/video/' + v.id) >= 0;
        return '<div class="rd-vid' + (sel ? ' selected-mark' : '') + '" data-i="' + i + '">'
          + '<div class="rd-vid-media">' + (v.capa ? '<img src="' + esc(capaSrc(v.capa)) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '')
          + (v.views != null ? '<span class="rd-vid-views">▶ ' + esc(fmtViews(v.views)) + '</span>' : '') + '</div>'
          + '<div class="rd-vid-desc"' + (v.desc ? ' title="' + esc(v.desc) + '"' : '') + '>' + esc(dataVideo(v) || v.desc || ' ') + '</div>'
          + '<button type="button" class="continue-button">' + (sel ? 'Seleccionado' : 'Seleccionar') + '</button></div>';
      }).join('') + '<div class="rd-vid-msg" style="padding:0.5rem 0 0; font-size:0.85rem;">Mostramos tus 10 videos más recientes. ¿No está el que buscas? Cierra y pega el enlace en el campo.</div>';
      Array.prototype.forEach.call(grid.querySelectorAll('.rd-vid'), function (card) {
        card.addEventListener('click', function () {
          var v = lista[Number(card.getAttribute('data-i'))]; if (!v) return;
          input.value = v.link;
          if (destino === 'ofertas') escondeErro('bumpLinkError'); else { escondeErro('linkErrorMsg'); mostraVideoSel(v); }
          fecharGrade();
        });
      });
    });
  }
  function mostraVideoSel(v) {
    var box = $('rdVideoSel');
    if (!v) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="rd-vs-box">' + (v.capa ? '<img src="' + esc(capaSrc(v.capa)) + '" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'">' : '')
      + '<div class="rd-vs-txt"><strong>Video seleccionado ✓</strong><span>' + esc(v.desc || v.link.replace(/^https:\/\/(www\.)?/, '')) + '</span>'
      + (dataVideo(v) ? '<span>Publicado el ' + esc(dataVideo(v)) + '</span>' : '')
      + (v.views != null ? '<span>▶ ' + esc(fmtViews(v.views)) + ' vistas</span>' : '') + '</div></div>';
    box.style.display = 'block';
  }
  function atualizaBotoesGrade() {
    var podePrincipal = gradeAtiva && !!perfilOk && servico && servico.alvo === 'post';
    $('rdVideoBtn').style.display = podePrincipal ? '' : 'none';
    $('bumpVideoBtn').style.display = (gradeAtiva && !!perfilOk) ? '' : 'none';
  }
  $('rdVideoBtn').addEventListener('click', function () { abrirGrade('principal'); });
  $('bumpVideoBtn').addEventListener('click', function () { abrirGrade('ofertas'); });
  $('rdVideoModalClose').addEventListener('click', fecharGrade);
  $('rdVideoModalClose2').addEventListener('click', fecharGrade);
  $('rdVideoModal').addEventListener('click', function (e) { if (e.target === this) fecharGrade(); });
  $('rdLink').addEventListener('input', function () {
    var v = this.value.trim(), l = videosCache.list || [];
    var achou = null; l.forEach(function (x) { if (v && v.indexOf('/video/' + x.id) >= 0) achou = x; });
    mostraVideoSel(achou);
  });

  function validaDetalhes() {
    var ok = true;
    if (!perfilOk) { status(rede === 'tiktok' ? 'Busca tu usuario de TikTok antes de continuar.' : 'Busca tu perfil o página antes de continuar.', 'error'); return false; }
    var link = linkDoPedido();
    if (!linkOk(link)) { mostraErro('linkErrorMsg', rede === 'tiktok' ? 'Pega un enlace de TikTok válido (tiktok.com).' : 'Pega un enlace de Facebook válido (facebook.com).'); ok = false; } else escondeErro('linkErrorMsg');
    if ($('contactNameInput').value.trim().length < 2) { mostraErro('nameErrorMsg'); ok = false; } else escondeErro('nameErrorMsg');
    var em = $('contactEmailInput').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { mostraErro('emailErrorMsg'); ok = false; } else escondeErro('emailErrorMsg');
    if (phoneLen($('contactPhoneInput').value) !== 10) { mostraErro('phoneErrorMsg'); ok = false; } else escondeErro('phoneErrorMsg');
    return ok;
  }

  window.goToStep = function (step) {
    if (step >= 2 && !pacote) { alert('Selecciona un paquete antes de continuar.'); return; }
    if (step === 3 && !validaDetalhes()) { step = 2; }
    Array.prototype.forEach.call(document.querySelectorAll('.stepper-container .step'), function (el, idx) {
      el.classList.remove('active', 'completed');
      if (idx + 1 === step) el.classList.add('active'); else if (idx + 1 < step) el.classList.add('completed');
    });
    $('step1Container').style.display = step === 1 ? 'grid' : 'none';
    $('perfilCard').style.display = step === 2 ? 'block' : 'none';
    $('step3Container').style.display = step === 3 ? 'block' : 'none';
    if (step === 3) preencherEtapa3();
    if (step === 2) setTimeout(function () { var l = perfilOk ? $('rdLink') : inpUser; if (l && !l.value && l.offsetParent) l.focus(); }, 100);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Ofertas da etapa 3 (iguais às do Instagram): me gusta, vistas e comentarios ──
  // Preços vêm do /api/redes/catalogo (os mesmos que o pricing.js soma no verifyPrice).
  var ofertas = { likes: [], views: [], comments: { unitCents: 2000, max: 250 } };
  var ofertasOcultas = {}; // { tiktok: { likes, views, comments }, facebook: {...} } — Gerenciamento de Tipo → Oculto
  var ofQ = { likes: 150, views: 1000, comments: 1 };
  var OF_IDS = { likes: 'promoLikes', views: 'promoViews', comments: 'promoComments' };
  var OF_ITEM = { likes: 'promoItemLikes', views: 'promoItemViews', comments: 'promoItemComments' };
  var OF_NOME = { likes: 'ME GUSTA MIXTOS', views: 'VISTAS', comments: 'COMENTARIOS' };
  var OF_RES = { likes: 'me gusta', views: 'vistas', comments: 'comentarios' };
  var ofertaDisponivel = function (k) {
    if (!servico) return false;
    var kd = kind(servico);
    if (k === 'likes' && kd === 'curtidas') return false;      // já é o serviço principal
    if (k === 'views' && kd === 'visualizacoes') return false;
    if (k === 'comments' && kd === 'comentarios') return false;
    if (ofertasOcultas[rede] && ofertasOcultas[rede][k]) return false; // serviço oculto: a oferta some
    return k === 'comments' || (ofertas[k] && ofertas[k].length > 0);
  };
  var ofertaCents = function (k) {
    if (k === 'comments') return ofQ.comments * ofertas.comments.unitCents;
    var it = (ofertas[k] || []).filter(function (x) { return x.q === ofQ[k]; })[0];
    return it ? it.cents : 0;
  };
  var ofertasMarcadas = function () {
    return ['likes', 'views', 'comments'].filter(function (k) { var c = $(OF_IDS[k]); return c && c.checked && ofertaDisponivel(k) && ofertaCents(k) > 0; });
  };
  var bumpsCents = function () { return ofertasMarcadas().reduce(function (a, k) { return a + ofertaCents(k); }, 0); };
  var bumpsStr = function () { return ofertasMarcadas().map(function (k) { return k + ':' + ofQ[k]; }).join(';'); };
  // Principal em vídeo/publicação → as ofertas vão para o mesmo link. Principal em perfil → pede o link.
  var bumpLinkDoPedido = function () { return servico && servico.alvo === 'post' ? linkDoPedido() : $('bumpLink').value.trim(); };
  var UP_MAP = { 150: 300, 300: 500, 500: 700, 700: 1000, 1000: 2000, 1200: 2000, 2000: 3000, 3000: 4000, 4000: 5000, 5000: 7500, 7500: 10000, 10000: 15000 };
  var UP_MAP_VIEWS = { 1000: 2500, 5000: 10000, 25000: 50000, 100000: 150000, 200000: 250000, 500000: 1000000 };
  var upgradeAlvo = function () {
    if (!servico || !pacote || kind(servico) === 'comentarios') return null;
    var alvoQ = (kind(servico) === 'visualizacoes' ? UP_MAP_VIEWS : UP_MAP)[pacote.q];
    var t = alvoQ ? (servico.pacotes || []).filter(function (x) { return x.q === alvoQ; })[0] : null;
    return t && t.cents > pacote.cents ? t : null;
  };
  var upgradeMarcado = function () { var c = $('orderBumpCheckboxInline'); return !!(c && c.checked && upgradeAlvo()); };
  // Pacote que vai ser cobrado e entregue (o maior quando a mejora está marcada).
  var pacoteEfetivo = function () { return upgradeMarcado() ? upgradeAlvo() : pacote; };
  function renderUpgrade() {
    var t = upgradeAlvo(), item = $('promoItemUpgrade');
    if (!item) return;
    var box = item.querySelector('.promo-prices');
    if (!t) {
      $('orderBumpCheckboxInline').checked = false;
      item.style.display = 'none';
      return;
    }
    item.style.display = '';
    var diff = t.cents - pacote.cents, add = t.q - pacote.q, un = servico.unidade;
    $('orderBumpHighlight').textContent = '+ ' + add + ' ' + un.toUpperCase();
    $('orderBumpText').textContent = 'Por solo ' + fmt(diff) + ' más, agrega ' + add + ' ' + un + ' y sube a ' + t.q + '.';
    box.querySelector('.old-price').textContent = fmt(t.cents);
    box.querySelector('.discount-badge').textContent = Math.round(((t.cents - diff) / t.cents) * 100) + '% OFF';
    box.querySelector('.new-price').textContent = fmt(diff);
    item.classList.toggle('selected', $('orderBumpCheckboxInline').checked);
  }
  function renderOferta(k) {
    var item = $(OF_ITEM[k]);
    if (!item) return;
    var disp = ofertaDisponivel(k);
    item.style.display = disp ? '' : 'none';
    if (!disp) { $(OF_IDS[k]).checked = false; return; }
    var cents = ofertaCents(k), old = Math.round(cents * 1.7 / 100) * 100;
    var box = item.querySelector('.promo-prices');
    box.querySelector('.old-price').textContent = fmt(old);
    box.querySelector('.discount-badge').textContent = Math.round((1 - cents / old) * 100) + '% OFF';
    box.querySelector('.new-price').textContent = fmt(cents);
    $(k + 'Qty').textContent = String(ofQ[k]);
    $(k + 'Highlight').textContent = '+ ' + ofQ[k] + ' ' + OF_NOME[k];
    item.classList.toggle('selected', $(OF_IDS[k]).checked);
  }
  function renderOfertas() {
    var alvo = rede === 'tiktok' ? 'tu video de TikTok' : 'tu publicación o video de Facebook';
    $('likesDesc').textContent = 'Agrega me gusta de perfiles mixtos a ' + alvo + '.';
    $('viewsDesc').textContent = 'Agrega vistas a ' + alvo + '.';
    renderUpgrade();
    ['likes', 'views', 'comments'].forEach(renderOferta);
    $('orderBumpInline').style.display = (upgradeAlvo() || ['likes', 'views', 'comments'].some(ofertaDisponivel)) ? '' : 'none';
    var algum = ofertasMarcadas().length > 0;
    var pedeLink = algum && servico && servico.alvo !== 'post';
    $('bumpLinkArea').style.display = pedeLink ? 'block' : 'none';
    atualizaBotoesGrade();
    if (pedeLink) {
      $('bumpLinkLabel').textContent = rede === 'tiktok' ? 'Enlace del video de TikTok para las ofertas' : 'Enlace de la publicación o video de Facebook para las ofertas';
      $('bumpLink').placeholder = rede === 'tiktok' ? 'https://www.tiktok.com/@usuario/video/…' : 'https://www.facebook.com/…';
      $('bumpLinkHint').textContent = 'Los me gusta, vistas y comentarios van a este video. Debe ser público.';
    } else escondeErro('bumpLinkError');
  }
  function passoOferta(k, dir) {
    if (k === 'comments') {
      ofQ.comments = Math.min(ofertas.comments.max || 250, Math.max(1, ofQ.comments + dir));
    } else {
      var arr = ofertas[k] || []; if (!arr.length) return;
      var i = -1; arr.forEach(function (x, j) { if (x.q === ofQ[k]) i = j; });
      i = Math.min(arr.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir));
      ofQ[k] = arr[i].q;
    }
    renderOfertas(); preencherResumoOfertas(); atualizaTotal();
  }
  ['likes', 'views', 'comments'].forEach(function (k) {
    var para = function (e) { e.preventDefault(); e.stopPropagation(); };
    $(k + 'Dec').addEventListener('click', function (e) { para(e); passoOferta(k, -1); });
    $(k + 'Inc').addEventListener('click', function (e) { para(e); passoOferta(k, 1); });
    $(OF_IDS[k]).addEventListener('change', function () { renderOfertas(); preencherResumoOfertas(); atualizaTotal(); });
  });
  $('orderBumpCheckboxInline').addEventListener('change', function () { preencherEtapa3(); });
  $('bumpLink').addEventListener('input', function () { escondeErro('bumpLinkError'); });
  // "Ejemplos de comentarios" (mesmo modal do Instagram)
  (function () {
    var modal = $('commentsExampleModal'), video = $('commentsVideoPlayer');
    var fecha = function () { modal.style.display = 'none'; try { video.pause(); } catch (_) {} };
    $('commentsExampleBtn').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      modal.style.display = 'flex';
      try { video.currentTime = 0; video.play().catch(function () {}); } catch (_) {}
    });
    $('commentsExampleCloseBtn').addEventListener('click', fecha);
    $('commentsExampleCloseBtn2').addEventListener('click', fecha);
    modal.addEventListener('click', function (e) { if (e.target === modal) fecha(); });
  })();
  function preencherResumoOfertas() {
    var ks = ofertasMarcadas(), up = upgradeMarcado() ? upgradeAlvo() : null;
    $('resPromosContainer').style.display = (ks.length || up) ? '' : 'none';
    $('resPromos').innerHTML = (up ? '<div class="resumo-row"><span>Mejora de paquete (+' + esc(Number(up.q - pacote.q).toLocaleString('en-US')) + ' ' + esc(servico.unidade) + ')</span><span>' + fmt(up.cents - pacote.cents) + '</span></div>' : '') +
      ks.map(function (k) {
        return '<div class="resumo-row"><span>+ ' + esc(Number(ofQ[k]).toLocaleString('en-US')) + ' ' + OF_RES[k] + '</span><span>' + fmt(ofertaCents(k)) + '</span></div>';
      }).join('');
  }

  // ── Etapa 3 (igual à do Instagram): perfil + quantidade, cupom, resumo e total ──
  var cupom = { code: '', pct: 0 };
  // Sem cupom: pacote + ofertas. Com cupom: o desconto vale sobre o total (igual ao servidor), piso de $20.
  var subtotalCents = function () { return pacote ? pacoteEfetivo().cents + bumpsCents() : 0; };
  var totalCents = function () {
    if (!pacote) return 0;
    var base = subtotalCents();
    if (!cupom.pct) return base;
    return Math.max(base - Math.round(base * cupom.pct), Math.min(base, 2000)); // mesmo piso de $20 do servidor
  };
  function preencherEtapa3() {
    var p = perfilOk || {};
    var segs = (servico.alvo === 'perfil' && /seguidores/.test(servico.tipo));
    var foto = p.avatar ? '/api/redes/avatar?u=' + encodeURIComponent(p.avatar) : '/images/default-avatar.svg';
    var img = $('reviewProfileImage'); img.onerror = function () { this.onerror = null; this.src = '/images/default-avatar.svg'; }; img.src = foto;
    $('reviewProfileUsername').textContent = rede === 'tiktok' ? '@' + (p.username || '') : (p.nome || p.username || '');
    var unidade = servico.unidade;
    var pe = pacoteEfetivo();
    $('reviewSelectedQty').textContent = '+' + Number(pe.q).toLocaleString('en-US') + ' ' + unidade;
    if (segs && p.seguidores != null) {
      $('reviewLinhaAtual').style.display = ''; $('reviewLinhaTotalSep').style.display = ''; $('reviewLinhaTotal').style.display = '';
      $('reviewProfileFollowers').textContent = Number(p.seguidores).toLocaleString('en-US');
      $('reviewUnidadeAtual').textContent = 'seguidores actuales';
      $('reviewTotalFollowers').textContent = (Number(p.seguidores) + Number(pe.q)).toLocaleString('en-US');
      $('reviewLinkPost').style.display = 'none';
    } else {
      // me gusta / vistas: o pacote vai para o post, não para o perfil
      $('reviewLinhaAtual').style.display = 'none'; $('reviewLinhaTotalSep').style.display = 'none'; $('reviewLinhaTotal').style.display = 'none';
      var lk = linkDoPedido();
      $('reviewLinkPost').textContent = segs ? '' : lk;
      $('reviewLinkPost').style.display = segs ? 'none' : '';
    }
    $('reviewBanner').textContent = 'Completa tu pago para recibir los ' + unidade + ' de arriba';
    $('resTipo').textContent = servico.titulo + ' · ' + NOME;
    $('resQtd').textContent = Number(pe.q).toLocaleString('en-US') + ' ' + unidade;
    $('resPreco').textContent = fmt(pacote.cents);
    renderOfertas();
    preencherResumoOfertas();
    atualizaTotal();
  }
  function atualizaTotal() {
    if (!pacote) return;
    var t = totalCents(), sub = subtotalCents();
    if (cupom.pct && t < sub) {
      $('resCupomRow').style.display = '';
      $('resCupomLabel').textContent = 'Cupón ' + cupom.code;
      $('resCupom').textContent = '- ' + fmt(sub - t);
    } else $('resCupomRow').style.display = 'none';
    // Mesmo total do Instagram: preço "de" riscado (+15%, terminado em .90), selo de % OFF e preço atual.
    var orig = Math.ceil(Math.round(sub * 1.15) / 100) * 100; // pesos inteiros
    var pct = orig > t ? Math.round(((orig - t) / orig) * 100) : 0;
    var mob = window.innerWidth <= 640;
    $('resTotalFinal').innerHTML = mob
      ? '<div class="promo-prices" style="flex-direction: column; align-items: flex-start; gap: 0;"><div style="display:flex; gap: 0.5rem; align-items: center;"><span class="old-price" style="text-decoration: line-through; color: #9ca3af;">' + fmt(orig) + '</span><span class="discount-badge">' + pct + '% OFF</span></div><span class="new-price">' + fmt(t) + '</span></div>'
      : '<div class="promo-prices" style="justify-content: flex-end; display: flex; align-items: center; gap: 0.5rem;"><span class="old-price">' + fmt(orig) + '</span><span class="discount-badge">' + pct + '% OFF</span><span class="new-price">' + fmt(t) + '</span></div>';
  }
  $('applyCouponBtn').addEventListener('click', function () {
    var btn = this, msg = $('couponMessage'), inp = $('couponInput');
    var code = String(inp.value || '').trim().toUpperCase();
    var show = function (t, cor) { msg.textContent = t; msg.style.color = cor; msg.style.display = 'block'; };
    if (!code) { show('Ingresa un cupón.', '#ef4444'); return; }
    btn.disabled = true; btn.textContent = 'Verificando...';
    fetch('/api/validate-coupon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, instagram_username: perfilOk ? perfilOk.username : '' }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.valid) {
          cupom = { code: d.code || code, pct: Number(d.discount) || 0 };
          show('¡Cupón aplicado! (' + Math.round(cupom.pct * 100) + '% OFF)', '#22c55e');
          inp.disabled = true; btn.textContent = 'Aplicado';
        } else {
          cupom = { code: '', pct: 0 };
          show((d && d.error) || 'Cupón no válido.', '#ef4444');
          btn.disabled = false; btn.textContent = 'Aplicar';
        }
        atualizaTotal();
      })
      .catch(function () { show('Error al validar el cupón.', '#ef4444'); btn.disabled = false; btn.textContent = 'Aplicar'; });
  });

  $('backToStep1Btn').addEventListener('click', function () { window.goToStep(1); });
  $('btnActionProceed').addEventListener('click', function () { window.goToStep(3); });

  $('payWithCardBtn').addEventListener('click', function () {
    escondeErro('payErrorMsg');
    if (!servico || !pacote || !validaDetalhes()) { window.goToStep(2); return; }
    var bumps = bumpsStr(), bumpLink = bumps ? bumpLinkDoPedido() : '';
    if (bumps && !linkOk(bumpLink)) {
      mostraErro('bumpLinkError', rede === 'tiktok' ? 'Pega el enlace de un video de TikTok (tiktok.com) para las ofertas.' : 'Pega el enlace de una publicación de Facebook (facebook.com) para las ofertas.');
      $('bumpLink').focus(); return;
    }
    var link = linkDoPedido(), nome = $('contactNameInput').value.trim(), fone = foneBackend($('contactPhoneInput').value), email = $('contactEmailInput').value.trim();
    var utms = {}; try { utms = JSON.parse(sessionStorage.getItem('ya_utms') || '{}') || {}; } catch (_) {}
    var btn = $('payWithCardBtn'), txt = btn.querySelector('.button-text');
    btn.disabled = true; txt.textContent = 'Generando pago…';
    var cid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    var body = {
      correlationID: cid, total_cents: totalCents(), xpag_method: 'SPEI', profile_is_private: false, utms: utms,
      customer: { name: nome, phone_number: fone, email: email },
      additionalInfo: [
        { key: 'tipo_servico', value: servico.tipo },
        { key: 'categoria_servico', value: rede },
        { key: 'plataforma', value: rede },
        { key: 'quantidade', value: String(pacoteEfetivo().q) },
        { key: 'pacote', value: pacoteEfetivo().q + ' ' + servico.unidade + ' ' + NOME + ' - ' + pacoteEfetivo().label + (upgradeMarcado() ? ' (mejora desde ' + pacote.q + ')' : '') },
        { key: 'upgrade_de', value: upgradeMarcado() ? String(pacote.q) : '' },
        { key: 'link_alvo', value: link },
        { key: 'perfil_rede', value: perfilOk ? perfilOk.username : '' },
        { key: 'perfil_rede_link', value: perfilOk ? perfilOk.link : '' },
        { key: 'perfil', value: perfilOk ? perfilOk.username : '' },
        { key: 'cupom', value: cupom.code || '' },
        { key: 'order_bumps', value: bumps },
        { key: 'order_bumps_total', value: bumps ? (bumpsCents() / 100).toFixed(2) : '' },
        { key: 'bump_link', value: bumpLink },
        { key: 'phone', value: fone },
        { key: 'email', value: email },
        { key: 'customer_name', value: nome },
        { key: 'payment_method', value: 'spei' }
      ]
    };
    funilEvento('clicou_pagar', { metodo: 'spei' });
    fetch('/api/xpag/create-charge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (d && d.pay_url) { location.href = d.pay_url; return; }
        funilEvento('erro_pagamento', { metodo: 'spei', erro: String((d && (d.message || d.error)) || 'sem_pay_url').slice(0, 160) });
        mostraErro('payErrorMsg', (d && d.message) || 'No se pudo generar el pago. Inténtalo de nuevo.');
        btn.disabled = false; txt.textContent = 'Pagar con SPEI';
      })
      .catch(function () { mostraErro('payErrorMsg', 'Sin conexión. Inténtalo de nuevo.'); btn.disabled = false; txt.textContent = 'Pagar con SPEI'; });
  });

  fetch('/api/redes/catalogo?rede=' + rede)
    .then(function (r) { return r.json(); })
    .then(function (d) { servicos = (d && d.servicos) || []; if (d && d.ofertas) ofertas = d.ofertas; if (d && d.ofertasOcultas) ofertasOcultas = d.ofertasOcultas; renderTipoCards(); })
    .catch(function () { tipoCards.innerHTML = '<div class="rd-erro" style="display:block;">No se pudieron cargar los servicios. Recarga la página.</div>'; });
})();
