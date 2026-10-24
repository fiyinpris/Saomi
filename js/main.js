/* Saomi landing page interactions */
(() => {
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- Hero video: seamless crossfade loop ---------- */

  const videos = $$('[data-hero-video]');
  const toggle = $('[data-video-toggle]');
  const progress = $('[data-video-progress]');
  const FADE = 1.2; // seconds; matches .hero__video opacity transition
  let current = 0;
  let fading = false;
  let userPaused = reduceMotion;
  let heroVisible = true;
  let raf = 0;

  const active = () => videos[current];

  function setToggle() {
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', String(userPaused));
    toggle.setAttribute('aria-label', userPaused ? 'Play background video' : 'Pause background video');
  }

  function safePlay(v) {
    const p = v.play();
    if (p && p.catch) {
      p.catch((err) => {
        // Autoplay refused (e.g. low-power mode): show the play state so the visitor can start it.
        if (err && err.name === 'NotAllowedError') { userPaused = true; setToggle(); }
      });
    }
  }

  function loadSecond() {
    const b = videos[1];
    if (b && !b.src && b.dataset.src) { b.src = b.dataset.src; b.load(); }
  }

  function crossfade() {
    const a = videos[current];
    const b = videos[1 - current];
    if (!b || !b.src || b.readyState < 2) {
      // Second copy not ready yet: fall back to a plain restart.
      a.currentTime = 0;
      safePlay(a);
      return;
    }
    fading = true;
    b.currentTime = 0;
    safePlay(b);
    a.classList.remove('is-front');
    b.classList.add('is-front', 'is-active');
    setTimeout(() => {
      a.classList.remove('is-active');
      a.pause();
      current = 1 - current;
      fading = false;
    }, FADE * 1000 + 60);
  }

  function frame() {
    const v = active();
    if (v.duration) {
      if (!fading && v.currentTime >= v.duration - FADE) crossfade();
      if (progress) progress.style.strokeDashoffset = (100 - (v.currentTime / v.duration) * 100).toFixed(2);
    }
    raf = !userPaused && heroVisible ? requestAnimationFrame(frame) : 0;
  }

  function syncPlayback() {
    const shouldPlay = !userPaused && heroVisible;
    videos.forEach((v) => { if (!shouldPlay || v !== active()) { if (!fading) v.pause(); } });
    if (shouldPlay) {
      safePlay(active());
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (fading) {
      videos.forEach((v) => v.pause());
    }
  }

  if (videos.length) {
    const first = videos[0];
    if (reduceMotion) { first.removeAttribute('autoplay'); first.pause(); }
    if (first.readyState >= 4) loadSecond();
    else first.addEventListener('canplaythrough', loadSecond, { once: true });
    videos.forEach((v) => v.addEventListener('ended', () => { if (v === active() && !fading) crossfade(); }));

    if (toggle) {
      setToggle();
      toggle.addEventListener('click', () => {
        userPaused = !userPaused;
        setToggle();
        syncPlayback();
      });
    }

    new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      syncPlayback();
    }).observe($('.hero'));
  }

  /* ---------- Intro loader ---------- */

  let seen = false;
  try { seen = sessionStorage.getItem('saomi-intro') === '1'; sessionStorage.setItem('saomi-intro', '1'); } catch (e) { /* storage blocked */ }

  const MIN_LOADER = reduceMotion ? 0 : seen ? 500 : 1700;
  const MAX_LOADER = 4000;
  const t0 = performance.now();
  let revealed = false;

  function reveal() {
    if (revealed) return;
    revealed = true;
    const wait = Math.max(0, MIN_LOADER - (performance.now() - t0));
    setTimeout(() => {
      root.classList.add('is-loaded');
      syncPlayback();
    }, wait);
  }

  const videoReady = new Promise((resolve) => {
    const v = videos[0];
    if (!v || v.readyState >= 3) return resolve();
    v.addEventListener('canplay', resolve, { once: true });
    v.addEventListener('error', resolve, { once: true });
  });
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  Promise.all([videoReady, fontsReady]).then(reveal);
  setTimeout(reveal, MAX_LOADER);

  /* ---------- Announcement rotation ---------- */

  const msgs = $$('.announce__msg');
  if (msgs.length > 1 && !reduceMotion) {
    let i = 0;
    setInterval(() => {
      const out = msgs[i];
      out.classList.remove('is-active');
      out.classList.add('is-leaving');
      setTimeout(() => out.classList.remove('is-leaving'), 700);
      i = (i + 1) % msgs.length;
      msgs[i].classList.add('is-active');
    }, 4200);
  }

  /* ---------- Scroll: header state, hero parallax, image parallax ---------- */

  const siteTop = $('[data-site-top]');
  const heroContent = $('[data-hero-content]');
  const heroMedia = $('[data-hero-media]');
  const parallaxEls = $$('[data-parallax]');
  let lastY = scrollY;
  let ticking = false;

  function onScroll() {
    const y = scrollY;
    const vh = innerHeight;

    siteTop.classList.toggle('is-scrolled', y > 30);
    if (y > vh * 0.9 && y > lastY + 3 && !document.body.classList.contains('menu-open')) {
      siteTop.classList.add('is-hidden');
    } else if (y < lastY - 3 || y < vh * 0.9) {
      siteTop.classList.remove('is-hidden');
    }
    lastY = y;

    if (!reduceMotion) {
      if (y < vh * 1.2) {
        heroContent.style.transform = `translate3d(0, ${(y * 0.32).toFixed(1)}px, 0)`;
        heroContent.style.opacity = Math.max(0, 1 - y / (vh * 0.75)).toFixed(3);
        heroMedia.style.transform = `translate3d(0, ${(y * 0.2).toFixed(1)}px, 0) scale(${(1 + y * 0.00012).toFixed(4)})`;
      }
      parallaxEls.forEach((el) => {
        const r = el.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        const p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
        el.style.translate = `0 ${(-p * (parseFloat(el.dataset.parallax) || 40)).toFixed(1)}px`;
      });
    }
    ticking = false;
  }

  addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  /* ---------- Scroll reveal ---------- */

  $$('[data-stagger]').forEach((parent) => {
    [...parent.children].forEach((child, i) => child.style.setProperty('--d', `${i * 120}ms`));
  });

  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); revealIO.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal]').forEach((el) => revealIO.observe(el));

  /* ---------- Card tilt + glare ---------- */

  if (finePointer && !reduceMotion) {
    $$('[data-tilt]').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
        card.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ---------- Mobile drawer ---------- */

  const drawer = $('[data-drawer]');
  const openBtn = $('[data-menu-open]');

  function setMenu(open) {
    drawer.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    openBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      siteTop.classList.remove('is-hidden');
      setTimeout(() => $('[data-menu-close].icon-btn', drawer).focus(), 50);
    } else {
      openBtn.focus({ preventScroll: true });
    }
  }

  openBtn.addEventListener('click', () => setMenu(true));
  $$('[data-menu-close]', drawer).forEach((el) => el.addEventListener('click', () => setMenu(false)));
  $$('.drawer__nav a', drawer).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) setMenu(false);
  });
  drawer.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = $$('a, button', $('.drawer__panel', drawer));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- Toast ---------- */

  const toast = $('[data-toast]');
  let toastTimer;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  /* ---------- Products: size → price, add to bag ---------- */

  const bag = $('[data-bag]');
  const bagCount = $('[data-bag-count]');
  let bagItems = 0;

  $$('.product').forEach((card) => {
    const price = $('.price', card);
    const addBtn = $('[data-add]', card);

    $$('input[type="radio"]', card).forEach((input) => {
      input.addEventListener('change', () => { price.textContent = `$${input.dataset.price}`; });
    });

    addBtn.addEventListener('click', () => {
      const size = $('input:checked', card);
      bagItems += 1;
      bagCount.textContent = bagItems;
      bag.setAttribute('aria-label', `Shopping bag, ${bagItems} ${bagItems === 1 ? 'item' : 'items'}`);
      bagCount.classList.remove('is-bump');
      void bagCount.offsetWidth; // restart the bump animation
      bagCount.classList.add('is-bump');

      addBtn.textContent = 'Added';
      addBtn.classList.add('is-added');
      setTimeout(() => { addBtn.textContent = 'Add to bag'; addBtn.classList.remove('is-added'); }, 1600);

      showToast(`${addBtn.dataset.add}${size ? ` (${size.value})` : ''} added to your bag`);
    });
  });

  /* ---------- Newsletter ---------- */

  const form = $('[data-newsletter]');
  const msg = $('[data-form-msg]');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.elements.email;
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim());
      form.classList.toggle('is-error', !valid);
      msg.classList.toggle('is-error', !valid);
      if (!valid) {
        msg.textContent = 'Please enter a valid email address.';
        input.focus();
        return;
      }
      msg.classList.add('is-done');
      msg.textContent = 'Thank you. Welcome to the Saomi Letter.';
      form.classList.add('is-done');
      input.blur();
    });
    form.elements.email.addEventListener('input', () => {
      if (form.classList.contains('is-error')) {
        form.classList.remove('is-error');
        msg.classList.remove('is-error');
        msg.textContent = 'You can unsubscribe at any time.';
      }
    });
  }
})();
