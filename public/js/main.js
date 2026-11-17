// Envia o token da página (cookie ya_tk) nas chamadas /api/ do próprio site.
(function () {
  try {
    if (window.__yaFetchTk || typeof window.fetch !== 'function') return;
    window.__yaFetchTk = true;
    var orig = window.fetch;
    var getTk = function () {
      try {
        if (window.YA_API_TK) return String(window.YA_API_TK);
        var m = document.cookie.match(/(?:^|;\s*)ya_tk=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
      } catch (_) { return ''; }
    };
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : ((input && input.url) || '');
        var mesmoSite = url.charAt(0) === '/' || url.indexOf(location.origin) === 0;
        if (mesmoSite && url.indexOf('/api/') >= 0) {
          var tk = getTk();
          if (tk) {
            init = init || {};
            var h = new Headers(init.headers || (typeof input !== 'string' && input && input.headers) || {});
            if (!h.has('X-Ya-Api-Tk')) h.set('X-Ya-Api-Tk', tk);
            init.headers = h;
          }
        }
      } catch (_) {}
      return orig.call(this, input, init);
    };
  } catch (_) {}
})();

// Landing page sem vídeo: navegação por cards de serviço
document.addEventListener('DOMContentLoaded', function() {
    console.log('Página carregada - You Agency');

    // Navegação por cards (landing)
    const cards = document.querySelectorAll('.service-card');
    cards.forEach(card => {
        card.addEventListener('click', function(e) {
            if (card.classList.contains('disabled')) {
                e.preventDefault();
                return false;
            }
            try {
                const servico = card.dataset.servico || new URL(card.href, window.location.origin).searchParams.get('servico');
                if (servico) {
                    sessionStorage.setItem('ya_servico', servico);
                }
            } catch (err) {
                // Ignora erros de URL
            }
        });
    });

    // Tema escuro/claro com persistência
    const btn = document.getElementById('themeToggleBtn');
    console.log('themeToggleBtn found:', btn);
    const applyTheme = (theme) => {
        console.log('Applying theme:', theme);
        const isLight = theme === 'light';
        const isEn = (function () {
            try { return String(document.documentElement?.lang || window.__PAGE_LANG__ || '').toLowerCase().startsWith('en'); } catch (_) { return false; }
        })();
        document.body.classList.toggle('theme-light', isLight);
        console.log('Body classes:', document.body.className);
        if (btn) {
            btn.setAttribute('aria-pressed', String(isLight));
            const label = btn.querySelector('.theme-label');
            if (label) label.textContent = isEn ? (isLight ? 'Theme: Dark' : 'Theme: Light') : (isLight ? 'Tema: Oscuro' : 'Tema: Claro');
        }
    };
    
    // Ler do localStorage ou usar light como default
    const savedTheme = localStorage.getItem('ya_theme') || 'light';
    applyTheme(savedTheme);

    if (btn) {
        console.log('Botão de tema encontrado e listener adicionado');
        btn.addEventListener('click', () => {
            console.log('Botão de tema clicado');
            const currentTheme = document.body.classList.contains('theme-light') ? 'light' : 'dark';
            const next = currentTheme === 'light' ? 'dark' : 'light';
            console.log('Trocando para:', next);
            localStorage.setItem('ya_theme', next);
            applyTheme(next);
        });
    } else {
        console.error('Botão de tema NÃO encontrado - verifique o ID themeToggleBtn');
    }
});
