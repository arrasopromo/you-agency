document.addEventListener('DOMContentLoaded', () => {
  (function initWhyUsSlider() {
    const track = document.getElementById('whyUsTrack');
    const dots = document.querySelectorAll('.why-us-dot');
    if (!track || dots.length === 0 || !track.firstElementChild) return;

    let isScrolling = false;
    let autoPlayInterval;

    const updateActiveDot = () => {
      if (isScrolling) return;

      const scrollLeft = track.scrollLeft;
      const cardWidth = track.firstElementChild.offsetWidth;
      const center = scrollLeft + (track.offsetWidth / 2);
      const index = Math.max(0, Math.min(dots.length - 1, Math.floor(center / (cardWidth + 24))));

      dots.forEach((dot, i) => {
        if (i === index) dot.classList.add('active');
        else dot.classList.remove('active');
      });
    };

    track.addEventListener('scroll', () => {
      window.requestAnimationFrame(updateActiveDot);
    });

    const stopAutoPlay = () => {
      clearInterval(autoPlayInterval);
    };

    const startAutoPlay = () => {
      stopAutoPlay();
      autoPlayInterval = setInterval(() => {
        const cardWidth = track.firstElementChild.offsetWidth;
        const gap = 24;
        const maxScroll = track.scrollWidth - track.clientWidth;

        let nextScroll = track.scrollLeft + cardWidth + gap;
        if (nextScroll > maxScroll + 50) nextScroll = 0;

        track.scrollTo({ left: nextScroll, behavior: 'smooth' });
      }, 6000);
    };

    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        isScrolling = true;
        const cardWidth = track.firstElementChild.offsetWidth;
        const gap = 24;
        track.scrollTo({ left: index * (cardWidth + gap), behavior: 'smooth' });

        dots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');

        setTimeout(() => { isScrolling = false; }, 500);
        startAutoPlay();
      });
    });

    startAutoPlay();
    track.addEventListener('mouseenter', stopAutoPlay);
    track.addEventListener('mouseleave', startAutoPlay);
    track.addEventListener('touchstart', stopAutoPlay, { passive: true });
    track.addEventListener('touchend', startAutoPlay);
  })();

  (function initTestimonialsCarousel() {
    const root = document.getElementById('testimonialsCarousel');
    if (!root) return;

    const items = Array.from(root.querySelectorAll('.carousel-item'));
    const prev = root.querySelector('.carousel-btn.prev');
    const next = root.querySelector('.carousel-btn.next');

    if (items.length === 0) return;

    let index = Math.max(0, items.findIndex(el => el.classList.contains('active')));
    if (index < 0) index = 0;
    let autoPlay;

    const setIndex = (nextIndex) => {
      const len = items.length;
      index = ((nextIndex % len) + len) % len;
      items.forEach((el, i) => {
        el.classList.remove('active', 'pos-left', 'pos-right', 'pos-hidden-left', 'pos-hidden-right');
        if (i === index) {
          el.classList.add('active');
          el.setAttribute('aria-hidden', 'false');
        } else {
          el.classList.add('pos-hidden-right');
          el.setAttribute('aria-hidden', 'true');
        }
      });
    };

    const stop = () => { if (autoPlay) clearInterval(autoPlay); };
    const start = () => {
      stop();
      autoPlay = setInterval(() => setIndex(index + 1), 8000);
    };

    if (prev) prev.addEventListener('click', () => { setIndex(index - 1); start(); });
    if (next) next.addEventListener('click', () => { setIndex(index + 1); start(); });

    setIndex(index);
    start();

    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);
    root.addEventListener('touchstart', stop, { passive: true });
    root.addEventListener('touchend', start);
  })();

  (function initFaq() {
    const faq = document.getElementById('faqSection');
    if (!faq) return;
    const buttons = Array.from(faq.querySelectorAll('.faq-card .faq-question'));
    if (!buttons.length) return;

    const closeAll = () => {
      for (const btn of buttons) {
        btn.setAttribute('aria-expanded', 'false');
        const card = btn.closest('.faq-card');
        const ans = card ? card.querySelector('.faq-answer') : null;
        if (ans) ans.hidden = true;
      }
    };

    closeAll();

    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const card = btn.closest('.faq-card');
        const ans = card ? card.querySelector('.faq-answer') : null;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        closeAll();
        btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        if (ans) ans.hidden = expanded;
      });
    }
  })();
});
