/* Saomi landing page interactions */
(() => {
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

  const hasLoader = !!$('.loader'); // only the home page plays the intro
  const MIN_LOADER = !hasLoader || reduceMotion ? 0 : seen ? 500 : 1700;
  const MAX_LOADER = 4000;
  const t0 = performance.now();
  let revealed = false;
  let markLoaded;
  const loaded = new Promise((resolve) => { markLoaded = resolve; });

  function reveal() {
    if (revealed) return;
    revealed = true;
    const wait = Math.max(0, MIN_LOADER - (performance.now() - t0));
    setTimeout(() => {
      root.classList.add('is-loaded');
      if (videos.length) syncPlayback();
      markLoaded();
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
    // Read every measurement first, then write styles, so the browser lays the page out
    // once per frame instead of once per parallax image.
    const y = scrollY;
    const vh = innerHeight;
    const rects = reduceMotion ? [] : parallaxEls.map((el) => el.parentElement.getBoundingClientRect());

    siteTop.classList.toggle('is-scrolled', y > 30);
    if (y > vh * 0.9 && y > lastY + 3 && !document.body.classList.contains('menu-open')) {
      siteTop.classList.add('is-hidden');
    } else if (y < lastY - 3 || y < vh * 0.9) {
      siteTop.classList.remove('is-hidden');
    }
    lastY = y;

    if (!reduceMotion) {
      if (heroContent && heroMedia && y < vh * 1.2) {
        heroContent.style.transform = `translate3d(0, ${(y * 0.32).toFixed(1)}px, 0)`;
        heroContent.style.opacity = Math.max(0, 1 - y / (vh * 0.75)).toFixed(3);
        heroMedia.style.transform = `translate3d(0, ${(y * 0.2).toFixed(1)}px, 0) scale(${(1 + y * 0.00012).toFixed(4)})`;
      }
      parallaxEls.forEach((el, i) => {
        const r = rects[i];
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

  /* ---------- Decorative loops only run while their section is on screen ---------- */

  // Sheen, glow, grain, marquee, mist, sparks and the seal keep the browser repainting even when
  // nobody can see them; pausing them off screen leaves the work for scrolling.
  if ('IntersectionObserver' in window && document.getAnimations) {
    const pauseIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.target.classList.toggle('is-offscreen', !e.isIntersecting));
    }, { rootMargin: '120px 0px' });
    const watchLoops = () => document.getAnimations().forEach((a) => {
      const target = a.effect && a.effect.target;
      if (!target || a.effect.getTiming().iterations !== Infinity) return;
      const zone = target.closest('section, .marquee, footer');
      if (zone) pauseIO.observe(zone);
    });
    watchLoops();
    loaded.then(watchLoops); // some loops only start once the intro has finished
  }

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

  /* ---------- Films outside the hero: load when near, play only while on screen ---------- */

  const films = $$('video[data-film]');
  if (films.length && 'IntersectionObserver' in window) {
    const filmIO = new IntersectionObserver((entries) => {
      entries.forEach(({ target: film, isIntersecting }) => {
        if (!isIntersecting) { film.pause(); return; }
        if (!film.getAttribute('src') && film.dataset.src) film.src = film.dataset.src;
        if (reduceMotion) return; // the poster stays put
        const p = film.play();
        if (p && p.catch) p.catch(() => { /* autoplay refused: the poster stays */ });
      });
    }, { rootMargin: '200px 0px' });
    films.forEach((film) => filmIO.observe(film));
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

  /* ---------- Bag: kept in this browser so it follows the visitor from page to page ---------- */

  const BAG_KEY = 'saomi-bag';
  const bagLink = $('[data-bag]');
  const bagCount = $('[data-bag-count]');
  let memoryBag = []; // used when storage is blocked

  // The range, by slug (keep in step with CATALOG in server.py). Each has a small 4:5 card photo.
  const RANGE = new Set([
    'soleil-dor', 'velours-noir', 'rose-imperiale', 'verdant-obsession', 'lumiere-dopal',
    'santal-majeste', 'aura-celeste', 'elixir-de-nuit', 'jasmin-eternel', 'cuir-imperial',
    'nectar-dor', 'ombre-rose', 'fleur-sauvage', 'ocean-infini', 'bois-de-cashmere',
  ]);
  const photoOf = (slug) => `assets/img/products/card/${slug}.jpg`;

  const bagStore = {
    read() {
      let items;
      try { items = JSON.parse(localStorage.getItem(BAG_KEY) || '[]'); } catch (e) { items = memoryBag; }
      // Anything no longer in the range (e.g. saved before the products changed) is dropped.
      return Array.isArray(items) ? items.filter((i) => i && RANGE.has(i.slug)) : [];
    },
    write(items) {
      memoryBag = items;
      try { localStorage.setItem(BAG_KEY, JSON.stringify(items)); } catch (e) { /* storage blocked */ }
      renderBagCount(true);
    },
    add(item) {
      const items = bagStore.read();
      const hit = items.find((i) => i.slug === item.slug && i.size === item.size);
      if (hit) hit.qty = Math.min(10, hit.qty + 1);
      else items.push({ ...item, qty: 1 });
      bagStore.write(items);
    },
  };

  function renderBagCount(bump) {
    const n = bagStore.read().reduce((sum, i) => sum + i.qty, 0);
    bagCount.textContent = n;
    bagLink.setAttribute('aria-label', `Shopping bag, ${n} ${n === 1 ? 'item' : 'items'}`);
    $$('[data-bag-total]').forEach((el) => { el.textContent = `(${n})`; });
    if (bump) {
      bagCount.classList.remove('is-bump');
      void bagCount.offsetWidth; // restart the bump animation
      bagCount.classList.add('is-bump');
    }
  }
  renderBagCount(false);
  addEventListener('storage', (e) => {
    if (e.key !== BAG_KEY) return;
    renderBagCount(false);
    document.dispatchEvent(new Event('bag:sync'));
  });

  /* ---------- Products: size → price, add to bag ---------- */

  $$('.product').forEach((card) => {
    const price = $('.price', card);
    const addBtn = $('[data-add]', card);
    const addLabel = $('[data-add-label]', addBtn) || addBtn;
    const wish = $('[data-wish]', card);

    $$('input[type="radio"]', card).forEach((input) => {
      input.addEventListener('change', () => { price.textContent = `$${input.dataset.price}`; });
    });

    if (wish) {
      wish.addEventListener('click', () => {
        const on = wish.getAttribute('aria-pressed') !== 'true';
        wish.setAttribute('aria-pressed', String(on));
        showToast(`${wish.dataset.wish} ${on ? 'saved to' : 'removed from'} your wishlist`);
      });
    }

    addBtn.addEventListener('click', () => {
      const size = $('input:checked', card);
      bagStore.add({
        slug: card.dataset.slug,
        name: addBtn.dataset.add,
        size: size.value,
        price: Number(size.dataset.price),
      });

      const label = addLabel.textContent;
      addLabel.textContent = 'Added';
      addBtn.classList.add('is-added');
      setTimeout(() => { addLabel.textContent = label; addBtn.classList.remove('is-added'); }, 1600);

      showToast(`${addBtn.dataset.add} (${size.value}) added to your bag`);
    });
  });

  /* ---------- Best sellers carousel: progress bar + arrows over native scroll ---------- */

  $$('[data-carousel]').forEach((carousel) => {
    const track = $('[data-carousel-track]', carousel);
    const bar = $('[data-carousel-bar]', carousel);
    const prev = $('[data-carousel-prev]', carousel);
    const next = $('[data-carousel-next]', carousel);
    let pending = false;

    function step() {
      const card = [...track.children].find((c) => !c.hidden);
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return card ? card.getBoundingClientRect().width + gap : track.clientWidth;
    }

    function update() {
      pending = false;
      const max = track.scrollWidth - track.clientWidth;
      const x = track.scrollLeft;
      bar.style.width = `${Math.min(100, ((x + track.clientWidth) / track.scrollWidth) * 100).toFixed(2)}%`;
      prev.disabled = x <= 2;
      next.disabled = x >= max - 2;
      carousel.classList.toggle('is-static', max <= 2);
    }

    const go = (dir) => track.scrollBy({ left: dir * step(), behavior: reduceMotion ? 'auto' : 'smooth' });
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    track.addEventListener('scroll', () => {
      if (!pending) { pending = true; requestAnimationFrame(update); }
    }, { passive: true });
    addEventListener('resize', update);
    update();
  });

  /* ---------- Shop: family chips, search, and ?family= links from other pages ---------- */

  const filterGroup = $('[data-filters]');
  if (filterGroup) {
    const chips = $$('[data-filter]', filterGroup);
    const cards = $$('.product');
    const count = $('[data-shop-count]');
    const track = $('[data-carousel-track]');
    const search = $('[data-shop-search]');
    const empty = $('[data-shop-empty]');
    const inFamily = (card, f) => f === 'all' || card.dataset.family === f;
    // Accents and curly apostrophes are ignored, so "elixir" finds Élixir and "d'or" finds Soleil d’Or.
    const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").toLowerCase();
    const haystack = (card) => fold(`${$('.product__name', card).textContent} ${$('.product__notes', card).textContent}`);
    let family = 'all';
    let query = '';

    chips.forEach((chip) => {
      $('[data-count]', chip).textContent = cards.filter((c) => inFamily(c, chip.dataset.filter)).length;
    });

    function apply(animate) {
      const chip = chips.find((c) => c.dataset.filter === family);
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      let shown = 0;
      cards.forEach((card) => {
        const on = inFamily(card, family) && (!query || haystack(card).includes(query));
        card.hidden = !on;
        card.classList.remove('is-entering');
        if (on && animate && !reduceMotion) {
          void card.offsetWidth; // restart the entrance animation
          card.style.setProperty('--n', shown);
          card.classList.add('is-entering');
        }
        if (on) shown += 1;
      });
      const noun = shown === 1 ? 'fragrance' : 'fragrances';
      const label = family === 'all' ? '' : ` ${$('.chip__label', chip).textContent}`;
      count.textContent = query
        ? `${shown}${label} ${noun} for “${query}”`
        : family === 'all' ? `Showing all ${shown} ${noun}` : `Showing ${shown}${label} ${noun}`;
      if (empty) empty.hidden = shown > 0;
      track.scrollLeft = 0;
      dispatchEvent(new Event('resize')); // refresh the carousel controls
    }

    chips.forEach((chip) => chip.addEventListener('click', () => { family = chip.dataset.filter; apply(true); }));
    if (search) {
      search.addEventListener('input', () => { query = fold(search.value.trim()); apply(false); });
    }
    const reset = $('[data-shop-reset]');
    if (reset) {
      reset.addEventListener('click', () => { family = 'all'; query = ''; if (search) search.value = ''; apply(true); });
    }

    const wanted = new URLSearchParams(location.search).get('family');
    if (chips.some((c) => c.dataset.filter === wanted)) {
      family = wanted;
      apply(false);
      // Land on the filtered grid rather than the banner, once the intro has finished.
      loaded.then(() => {
        root.style.scrollBehavior = 'auto';
        $('#shop').scrollIntoView({ block: 'start' });
        root.style.scrollBehavior = '';
      });
    }
    if (location.hash === '#search' && search) search.focus({ preventScroll: true });
  }

  /* ---------- Testimonials: tabs with a timed autoplay ---------- */

  const voices = $('[data-voices]');
  if (voices) {
    const tabs = $$('[role="tab"]', voices);
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    const row = tabs[0].parentElement;
    let active = 0;

    function select(i, focus) {
      active = (i + tabs.length) % tabs.length;
      tabs.forEach((t, j) => {
        const on = j === active;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].classList.toggle('is-active', on);
      });
      const tab = tabs[active];
      if (focus) tab.focus({ preventScroll: true });
      // Keep the chosen card in view on narrow screens without moving the page.
      if (row.scrollWidth > row.clientWidth) {
        row.scrollTo({ left: tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    }

    tabs.forEach((tab, j) => {
      tab.addEventListener('click', () => select(j));
      // The active card's timer bar is a CSS animation; when it finishes, move on.
      tab.addEventListener('animationend', (e) => {
        if (e.animationName === 'voice-timer' && j === active) select(active + 1);
      });
    });

    row.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      select(keys[e.key], true);
    });

    new IntersectionObserver(([entry]) => {
      voices.classList.toggle('is-visible', entry.isIntersecting);
    }, { threshold: 0.35 }).observe(voices);
  }

  /* ---------- Newsletter ---------- */

  const form = $('[data-newsletter]');
  const msg = $('[data-form-msg]');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.elements.email;
      const valid = EMAIL.test(input.value.trim());
      form.classList.toggle('is-error', !valid);
      msg.classList.toggle('is-error', !valid);
      if (!valid) {
        msg.textContent = 'Please enter a valid email address.';
        input.focus();
        return;
      }
      msg.textContent = 'Subscribing…';
      api('/api/subscribe', { email: input.value.trim() }).then(() => {
        msg.classList.add('is-done');
        msg.textContent = 'Thank you. Welcome to the Saomi Letter.';
        form.classList.add('is-done');
        input.blur();
      }).catch((err) => {
        form.classList.add('is-error');
        msg.classList.add('is-error');
        msg.textContent = err.message;
      });
    });
    form.elements.email.addEventListener('input', () => {
      if (form.classList.contains('is-error')) {
        form.classList.remove('is-error');
        msg.classList.remove('is-error');
        msg.textContent = 'You can unsubscribe at any time.';
      }
    });
  }

  /* ---------- Accounts, orders and messages (Firebase: js/backend.js) ---------- */

  // The Firebase code loads on first use, so pages without forms stay light.
  let backendModule;
  const UNAVAILABLE = 'Sign-in and accounts aren’t available right now. Please try again later.';

  async function api(path, body) {
    backendModule = backendModule || import('./backend.js');
    let backend;
    try { backend = await backendModule; } catch (e) {
      backendModule = null;
      throw Object.assign(new Error(UNAVAILABLE), { status: 0 });
    }
    return backend.call(path, body);
  }

  const session = api('/api/me').then((d) => d.user).catch(() => null);

  session.then((user) => {
    root.classList.toggle('is-signed-in', !!user);
    $$('[data-account-link]').forEach((a) => a.setAttribute('aria-label', user ? `My account, signed in as ${user.name}` : 'Sign in or create an account'));
    $$('[data-account-text]').forEach((a) => { a.textContent = user ? 'My account' : 'Sign in'; });
  });

  const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
  const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Only same-site page names are accepted as a post-login destination.
  function nextPage(fallback) {
    const next = new URLSearchParams(location.search).get('next') || '';
    return /^[a-z-]+\.html(#[\w-]+)?$/.test(next) ? next : fallback;
  }

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-success', kind === 'success');
  }

  function markField(form, name, bad) {
    const input = form.elements[name];
    if (!input) return;
    input.closest('.field').classList.toggle('is-invalid', bad);
    if (bad) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function busy(btn, on, text) {
    btn.disabled = on;
    btn.classList.toggle('is-busy', on);
    if (text) btn.textContent = text;
  }

  function clearOnInput(form) {
    form.addEventListener('input', (e) => {
      const field = e.target.closest('.field');
      if (field) field.classList.remove('is-invalid');
      e.target.removeAttribute('aria-invalid');
    });
  }

  // Validates [name, isBad, message] rows; marks fields and focuses the first problem.
  function validate(form, status, checks) {
    const bad = {};
    checks.forEach(([name, isBad]) => { bad[name] = bad[name] || isBad; });
    Object.entries(bad).forEach(([name, isBad]) => markField(form, name, isBad));
    const first = checks.find(([, isBad]) => isBad);
    if (first) {
      setStatus(status, first[2], 'error');
      form.elements[first[0]].focus();
    }
    return !first;
  }

  // Show / hide password. Delegated so forms added later (My account) work too.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle-password]');
    if (!btn) return;
    const input = $('input', btn.parentElement);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  // New passwords: strength meter, rule ticks and a matching confirmation. Returns the checks for validate().
  const passwordRules = (pw) => ({ length: pw.length >= 8, mix: /[a-z]/i.test(pw) && /\d/.test(pw) });

  function passwordScore(pw) {
    if (!pw) return 0;
    const rules = passwordRules(pw);
    if (!rules.length || !rules.mix) return 1;
    if (pw.length < 12) return 2;
    return /[^a-z0-9]/i.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) ? 4 : 3;
  }

  function watchNewPassword(form) {
    const pw = form.elements.password;
    const confirm = form.elements.confirm;
    const meter = $('[data-meter]', form);
    const label = $('[data-meter-label]', form);
    const update = () => {
      const rules = passwordRules(pw.value);
      $$('[data-rule="length"]', form).forEach((li) => li.classList.toggle('is-met', rules.length));
      $$('[data-rule="mix"]', form).forEach((li) => li.classList.toggle('is-met', rules.mix));
      $$('[data-rule="match"]', form).forEach((li) => li.classList.toggle('is-met', !!confirm.value && confirm.value === pw.value));
      const score = passwordScore(pw.value);
      if (meter) meter.dataset.score = score;
      if (label) label.textContent = pw.value ? `Strength: ${['', 'Weak', 'Fair', 'Good', 'Strong'][score]}` : '';
    };
    pw.addEventListener('input', update);
    confirm.addEventListener('input', update);
    form.addEventListener('reset', () => setTimeout(update));
    update();
    return () => {
      const rules = passwordRules(pw.value);
      return [
        ['password', !rules.length, 'Your password needs at least 8 characters.'],
        ['password', !rules.mix, 'Use at least one letter and one number in your password.'],
        ['confirm', confirm.value !== pw.value, 'The two passwords don’t match.'],
      ];
    };
  }

  // Carries ?next= through sign in → code → destination (same-site pages only).
  const keepNext = () => {
    const next = nextPage('');
    return next ? `?next=${encodeURIComponent(next)}` : '';
  };

  /* Sign in (straight to the account) / create account (continues on the confirm-email page) */

  const authForm = $('[data-auth-form]');
  if (authForm) {
    const signup = authForm.dataset.authForm === 'signup';
    const status = $('[data-form-status]', authForm);
    const submit = $('button[type="submit"]', authForm);
    const label = submit.textContent;
    $$('[data-keep-next]').forEach((a) => { a.href += keepNext(); });
    session.then((user) => { if (user) location.replace(nextPage('account.html')); });
    clearOnInput(authForm);

    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = authForm.elements;
      // Sign-up step 1 is name + email only; the password is created after the email is confirmed.
      const data = signup
        ? { name: f.name.value.trim(), email: f.email.value.trim(), newsletter: f.newsletter.checked }
        : { email: f.email.value.trim(), password: f.password.value, remember: f.remember.checked };
      const ok = validate(authForm, status, [
        ...(signup ? [['name', !data.name, 'Please enter your full name.']] : []),
        ['email', !EMAIL.test(data.email), 'Please enter a valid email address.'],
        ...(signup ? [] : [['password', !data.password, 'Please enter your password.']]),
      ]);
      if (!ok) return;
      busy(submit, true, signup ? 'Sending link…' : 'Signing in…');
      setStatus(status, '', null);
      try {
        await api(signup ? '/api/signup' : '/api/login', data);
        if (signup) {
          setStatus(status, 'Link sent. Check your inbox.', 'success');
          location.assign(`verify.html${keepNext()}`);
        } else {
          setStatus(status, 'Welcome back.', 'success');
          location.assign(nextPage('account.html'));
        }
      } catch (err) {
        busy(submit, false, label);
        setStatus(status, err.message, 'error');
        if (err.field && f[err.field]) { markField(authForm, err.field, true); f[err.field].focus(); }
      }
    });
  }

  /* Forgot password */

  const forgotForm = $('[data-forgot-form]');
  if (forgotForm) {
    const status = $('[data-form-status]', forgotForm);
    const submit = $('button[type="submit"]', forgotForm);
    clearOnInput(forgotForm);
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = forgotForm.elements.email.value.trim();
      if (!validate(forgotForm, status, [['email', !EMAIL.test(email), 'Please enter a valid email address.']])) return;
      busy(submit, true, 'Sending…');
      setStatus(status, '', null);
      try {
        await api('/api/forgot', { email });
        busy(submit, false, 'Send another link');
        setStatus(status, `If there’s an account for ${email}, a link to choose a new password is on its way. It works for 1 hour; check your spam folder too.`, 'success');
      } catch (err) {
        busy(submit, false, 'Send link');
        setStatus(status, err.message, 'error');
      }
    });
  }

  /* Confirm-email page. After sign-up it waits for the emailed link to be opened (checking by
     itself), then asks for a password. It also handles Firebase links that point here directly:
     ?mode=verifyEmail&oobCode=… and ?mode=resetPassword&oobCode=… */

  const verifyPanel = $('[data-verify]');
  if (verifyPanel) {
    const waiting = $('[data-waiting]');
    const waitStatus = $('[data-form-status]', waiting);
    const checkBtn = $('[data-check]', waiting);
    const resendBtn = $('[data-resend]', waiting);
    const timer = $('[data-resend-timer]', waiting);
    const passwordStep = $('[data-password-step]');
    const steps = $('[data-steps]');
    const kicker = $('[data-verify-kicker]');
    const title = $('[data-verify-title]');
    const lead = $('[data-verify-lead]');
    const switchRow = $('[data-verify-switch]');
    const back = $('[data-verify-back]');
    const params = new URLSearchParams(location.search);
    const mode = params.get('mode');
    const oobCode = params.get('oobCode');
    const COPY = {
      signup: {
        steps: ['Your details', 'Verify email', 'Create password'],
        passwordKicker: 'Email confirmed', passwordTitle: 'Create Your Password',
        passwordLead: 'Your email address is confirmed. Create a password to finish setting up your account.',
        passwordLabel: 'Create password', passwordButton: 'Create account',
        done: (name) => `Your account is ready. Welcome to Saomi, ${name}.`,
      },
      reset: {
        steps: ['Your email', 'Open the link', 'New password'],
        passwordKicker: 'Almost done', passwordTitle: 'Choose a New Password',
        passwordLead: 'Pick a password you haven’t used here before. You’ll be signed out on your other devices.',
        passwordLabel: 'New password', passwordButton: 'Save new password',
        done: () => 'Password updated. Signing you in…',
      },
    };
    let purpose = 'signup';
    let resetCode = '';
    let tick;
    let poll;

    const say = (k, t, l) => { kicker.textContent = k; title.textContent = t; lead.textContent = l; };

    function showSteps(current) {
      const labels = COPY[purpose].steps;
      steps.hidden = false;
      $$('li', steps).forEach((li, i) => {
        $('.steps__label', li).textContent = labels[i];
        li.classList.toggle('is-done', i + 1 < current);
        li.classList.toggle('is-current', i + 1 === current);
        if (i + 1 === current) li.setAttribute('aria-current', 'step');
        else li.removeAttribute('aria-current');
      });
    }

    function stopWaiting() {
      clearInterval(poll);
      clearInterval(tick);
      waiting.hidden = true;
    }

    // A finished or dead end: a heading, a sentence and one link onward.
    function endWith(k, t, l, linkText, href) {
      stopWaiting();
      steps.hidden = true;
      passwordStep.hidden = true;
      say(k, t, l);
      back.textContent = linkText;
      back.href = href;
      switchRow.hidden = false;
    }

    const expired = (message) => endWith('Link expired', 'Start Again',
      message || 'This sign-up has expired. Please start again to get a new link.',
      'Back to create account', `signup.html${keepNext()}`);

    function startTimer(seconds) {
      let left = Math.max(0, Number(seconds) || 0);
      clearInterval(tick);
      const paint = () => {
        resendBtn.disabled = left > 0;
        timer.textContent = left > 0 ? ` in ${left}s` : '';
      };
      paint();
      tick = setInterval(() => {
        left -= 1;
        paint();
        if (left <= 0) clearInterval(tick);
      }, 1000);
    }

    function showPasswordStep() {
      const copy = COPY[purpose];
      stopWaiting();
      switchRow.hidden = true;
      passwordStep.hidden = false;
      say(copy.passwordKicker, copy.passwordTitle, copy.passwordLead);
      $('[data-password-label]', passwordStep).textContent = copy.passwordLabel;
      $('[data-password-submit]', passwordStep).textContent = copy.passwordButton;
      showSteps(3);
      passwordStep.elements.password.focus();
    }

    // Has the link been opened (here, in another tab, or on another device)?
    async function check(manual) {
      try {
        const { verified } = await api('/api/check');
        if (verified) { showPasswordStep(); return; }
        if (manual) setStatus(waitStatus, 'Not confirmed yet. Open the link in the email we sent, then try again.', 'error');
      } catch (err) {
        if (err.status === 410) expired(err.message);
        else if (manual) setStatus(waitStatus, err.message, 'error');
      }
    }

    function wait(email, resendIn) {
      showSteps(2);
      say('Confirm your email', 'Check Your Inbox', '');
      const strong = document.createElement('strong');
      strong.textContent = email;
      lead.append('We sent a link to ', strong, '. Open it to confirm your email address, then come back here. This page moves on by itself.');
      waiting.hidden = false;
      back.textContent = 'Use a different email';
      back.href = `signup.html${keepNext()}`;
      startTimer(resendIn);
      poll = setInterval(() => { if (!document.hidden) check(false); }, 4000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && !waiting.hidden) check(false); });
    }

    const dropCode = () => history.replaceState(null, '', `verify.html${keepNext()}`); // keep the one-time code out of history

    if (mode === 'verifyEmail' && oobCode) {
      say('One moment', 'Confirming…', 'Confirming your email address.');
      api('/api/apply-code', { code: oobCode }).then(({ continue: carryOn }) => {
        dropCode();
        if (carryOn) { purpose = 'signup'; showPasswordStep(); return; }
        endWith('Email confirmed', 'You’re Nearly There',
          'Your email address is confirmed. Go back to the page where you started to create your password. If you’ve closed it, use “Forgot password” to set one.',
          'Set a password', 'forgot.html');
      }).catch((err) => { dropCode(); expired(err.message); });
    } else if (mode === 'resetPassword' && oobCode) {
      purpose = 'reset';
      api('/api/reset-check', { code: oobCode }).then(() => {
        resetCode = oobCode;
        dropCode();
        showPasswordStep();
      }).catch((err) => {
        dropCode();
        endWith('Link expired', 'Request a New Link', err.message, 'Reset your password', 'forgot.html');
      });
    } else {
      api('/api/challenge').then((ch) => {
        if (ch.verified) { showPasswordStep(); return; } // came back after confirming
        wait(ch.email, ch.resendIn);
      }).catch((err) => expired(err.status === 410 ? '' : err.message));
    }

    checkBtn.addEventListener('click', async () => {
      busy(checkBtn, true, 'Checking…');
      setStatus(waitStatus, '', null);
      await check(true);
      busy(checkBtn, false, 'I’ve confirmed my email');
    });

    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true;
      try {
        const res = await api('/api/resend', {});
        setStatus(waitStatus, 'A new link is on its way. Check your inbox and spam folder.', 'success');
        startTimer(res.resendIn);
      } catch (err) {
        if (err.status === 410) { expired(err.message); return; }
        setStatus(waitStatus, err.message, 'error');
        startTimer(err.retry);
      }
    });

    const passwordStatus = $('[data-form-status]', passwordStep);
    const passwordSubmit = $('[data-password-submit]', passwordStep);
    const passwordChecks = watchNewPassword(passwordStep);
    clearOnInput(passwordStep);
    passwordStep.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate(passwordStep, passwordStatus, passwordChecks())) return;
      const label = passwordSubmit.textContent;
      const password = passwordStep.elements.password.value;
      busy(passwordSubmit, true, 'Saving…');
      setStatus(passwordStatus, '', null);
      try {
        const res = purpose === 'reset'
          ? await api('/api/reset-password', { code: resetCode, password })
          : await api('/api/set-password', { password });
        $('[data-verified-notice]', passwordStep).hidden = true;
        setStatus(passwordStatus, COPY[purpose].done(res.user.name), 'success');
        setTimeout(() => location.assign(nextPage('account.html')), 1200);
      } catch (err) {
        busy(passwordSubmit, false, label);
        if (err.status === 410) {
          if (purpose === 'reset') endWith('Link expired', 'Request a New Link', err.message, 'Reset your password', 'forgot.html');
          else expired(err.message);
          return;
        }
        setStatus(passwordStatus, err.message, 'error');
        if (err.field) markField(passwordStep, err.field, true);
      }
    });
  }

  /* My account */

  const accountEl = $('[data-account]');
  if (accountEl) {
    const box = $('[data-account-body]', accountEl);
    session.then(async (user) => {
      if (!user) { location.replace('login.html?next=account.html'); return; }
      const since = new Date(user.createdAt * 1000).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      box.innerHTML = `
        <div class="account__layout">
          <aside class="profile">
            <span class="profile__avatar" aria-hidden="true"></span>
            <h2 class="profile__name"></h2>
            <p class="profile__email"></p>
            <p class="profile__since">Member since ${esc(since)}</p>
            <button class="btn btn--ghost" type="button" data-logout>Sign out</button>
          </aside>
          <div class="orders">
            <p class="kicker">Your orders</p>
            <h2 class="section-title">Order History</h2>
            <div data-orders><p class="cart__loading">Loading your orders…</p></div>

            <section class="security" aria-labelledby="security-title">
              <p class="kicker">Security</p>
              <h2 class="section-title" id="security-title">Change Password</h2>
              <form class="form" novalidate data-password-form>
                <div class="field">
                  <label for="p-current">Current password</label>
                  <div class="field__password">
                    <input id="p-current" name="current" type="password" autocomplete="current-password" maxlength="128" required>
                    <button type="button" class="field__toggle" aria-label="Show password" aria-pressed="false" data-toggle-password>${EYE}</button>
                  </div>
                </div>
                <div class="field">
                  <label for="p-password">New password</label>
                  <div class="field__password">
                    <input id="p-password" name="password" type="password" autocomplete="new-password" maxlength="128" required aria-describedby="p-password-rules">
                    <button type="button" class="field__toggle" aria-label="Show password" aria-pressed="false" data-toggle-password>${EYE}</button>
                  </div>
                  <div class="meter" data-meter aria-hidden="true"><span></span><span></span><span></span><span></span></div>
                  <ul class="rules" id="p-password-rules">
                    <li data-rule="length">At least 8 characters</li>
                    <li data-rule="mix">A letter and a number</li>
                    <li class="rules__strength" data-meter-label aria-live="polite"></li>
                  </ul>
                </div>
                <div class="field">
                  <label for="p-confirm">Confirm new password</label>
                  <div class="field__password">
                    <input id="p-confirm" name="confirm" type="password" autocomplete="new-password" maxlength="128" required aria-describedby="p-confirm-rule">
                    <button type="button" class="field__toggle" aria-label="Show password" aria-pressed="false" data-toggle-password>${EYE}</button>
                  </div>
                  <ul class="rules" id="p-confirm-rule"><li data-rule="match">Passwords match</li></ul>
                </div>
                <div class="form__actions">
                  <button class="btn btn--dark" type="submit">Update password</button>
                  <p class="form__status" role="status" data-form-status></p>
                </div>
              </form>
              <div class="security__devices">
                <p>Don’t recognise a sign-in? Change your password above: that signs you out of Saomi on every other device.</p>
              </div>
            </section>
          </div>
        </div>`;
      $('.profile__avatar', box).textContent = user.name.trim().charAt(0).toUpperCase();
      $('.profile__name', box).textContent = user.name;
      $('.profile__email', box).textContent = user.email;

      $('[data-logout]', box).addEventListener('click', async (e) => {
        busy(e.currentTarget, true, 'Signing out…');
        try { await api('/api/logout', {}); } catch (err) { /* already signed out */ }
        location.assign('index.html');
      });

      const passwordForm = $('[data-password-form]', box);
      const passwordStatus = $('[data-form-status]', passwordForm);
      const passwordSubmit = $('button[type="submit"]', passwordForm);
      const passwordChecks = watchNewPassword(passwordForm);
      clearOnInput(passwordForm);
      passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = passwordForm.elements;
        const ok = validate(passwordForm, passwordStatus, [
          ['current', !f.current.value, 'Please enter your current password.'],
          ...passwordChecks(),
        ]);
        if (!ok) return;
        busy(passwordSubmit, true, 'Updating…');
        setStatus(passwordStatus, '', null);
        try {
          await api('/api/password', { current: f.current.value, password: f.password.value });
          passwordForm.reset();
          setStatus(passwordStatus, 'Password updated. Your other devices will be signed out.', 'success');
        } catch (err) {
          if (err.status === 401) { location.assign('login.html?next=account.html'); return; }
          setStatus(passwordStatus, err.message, 'error');
          if (err.field) markField(passwordForm, err.field, true);
        } finally {
          busy(passwordSubmit, false, 'Update password');
        }
      });

      const list = $('[data-orders]', box);
      try {
        const { orders } = await api('/api/orders');
        if (!orders.length) {
          list.innerHTML = '<p class="orders__empty">No orders yet. <a href="shop.html">Find your signature</a></p>';
          return;
        }
        list.innerHTML = `<ul class="orders__list">${orders.map((o) => `
          <li class="order">
            <div>
              <p class="order__no">${esc(o.number)}</p>
              <p class="order__date">${esc(new Date(o.createdAt * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
            </div>
            <p class="order__total">${money(o.subtotal)}</p>
            <p class="order__items">${o.items.map((i) => `${esc(i.name)} · ${esc(i.size)} × ${Number(i.qty)}`).join(' &nbsp;/&nbsp; ')}</p>
          </li>`).join('')}</ul>`;
      } catch (err) {
        list.innerHTML = '<p class="orders__empty"></p>';
        $('.orders__empty', list).textContent = err.message;
      }
    });
  }

  /* Bag page */

  const cartEl = $('[data-cart]');
  if (cartEl) {
    const box = $('[data-cart-body]', cartEl);
    const FREE_FROM = 150;
    let placed = null;


    function render(focus) {
      if (placed) {
        box.innerHTML = `
          <div class="cart__done">
            <p class="kicker">Thank you</p>
            <h2 class="section-title">Order Received</h2>
            <p class="order-no">${esc(placed.order.number)}</p>
            <p>Your order is saved to your account. We’ll email <strong>${esc(placed.user.email)}</strong> to arrange payment and delivery.</p>
            <a class="btn btn--dark" href="account.html">View my orders</a>
          </div>`;
        return;
      }
      const items = bagStore.read();
      if (!items.length) {
        box.innerHTML = `
          <div class="cart__empty">
            <img class="cart__empty-photo" src="${photoOf('soleil-dor')}" alt="" width="112" height="140">
            <p class="kicker">Your bag</p>
            <h2 class="section-title">Your Bag Is Empty</h2>
            <p>Find a signature that lingers long after you leave the room.</p>
            <a class="btn btn--dark" href="shop.html">Shop fragrances</a>
          </div>`;
        return;
      }
      const count = items.reduce((n, i) => n + i.qty, 0);
      const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
      const remaining = Math.max(0, FREE_FROM - subtotal);
      box.innerHTML = `
        <div class="cart__layout">
          <div>
            <div class="cart__head"><span>${count} ${count === 1 ? 'item' : 'items'}</span><span>Total</span></div>
            <ul class="cart__list">${items.map((item, i) => `
              <li class="cart-line" data-index="${i}">
                <a class="cart-line__media" href="shop.html" tabindex="-1" aria-hidden="true"><img src="${photoOf(item.slug)}" alt="" width="96" height="120" loading="lazy"></a>
                <div>
                  <p class="cart-line__name">${esc(item.name)}</p>
                  <p class="cart-line__meta">${esc(item.size)} · ${money(item.price)}</p>
                  <div class="cart-line__controls">
                    <div class="qty" role="group" aria-label="Quantity of ${esc(item.name)}">
                      <button type="button" data-qty="-1" aria-label="Remove one" ${item.qty <= 1 ? 'disabled' : ''}>−</button>
                      <output>${Number(item.qty)}</output>
                      <button type="button" data-qty="1" aria-label="Add one" ${item.qty >= 10 ? 'disabled' : ''}>+</button>
                    </div>
                    <button class="cart-line__remove" type="button" data-remove>Remove</button>
                  </div>
                </div>
                <p class="cart-line__total">${money(item.price * item.qty)}</p>
              </li>`).join('')}
            </ul>
          </div>
          <aside class="cart__summary" aria-label="Order summary">
            <p class="summary__title">Order summary</p>
            <div class="summary__row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
            <div class="summary__row"><span>Shipping</span><span>${remaining ? 'Confirmed by email' : 'Complimentary'}</span></div>
            <div class="ship-meter">
              <div class="ship-meter__bar" style="--p:${Math.min(100, (subtotal / FREE_FROM) * 100).toFixed(1)}%"><span></span></div>
              <p>${remaining ? `Add ${money(remaining)} more for complimentary shipping.` : 'Your order ships complimentary.'}</p>
            </div>
            <div class="summary__row summary__row--total"><span>Total</span><span>${money(subtotal)}</span></div>
            <p class="summary__note">Two free samples with every order</p>
            <button class="btn btn--dark btn--block" type="button" data-checkout>Checkout</button>
            <p class="form__status" role="status" data-checkout-status></p>
          </aside>
        </div>`;
      session.then((user) => {
        const btn = $('[data-checkout]', box);
        if (btn && !user) btn.textContent = 'Sign in to check out';
      });
      if (focus) {
        const el = $(focus, box);
        if (el && !el.disabled) el.focus();
      }
    }

    function update(index, change) {
      const items = bagStore.read();
      if (!items[index]) return;
      if (change === 'remove') items.splice(index, 1);
      else items[index].qty = Math.min(10, Math.max(1, items[index].qty + change));
      bagStore.write(items);
    }

    box.addEventListener('click', async (e) => {
      const line = e.target.closest('.cart-line');
      const qtyBtn = e.target.closest('[data-qty]');
      if (line && qtyBtn) {
        const d = Number(qtyBtn.dataset.qty);
        update(Number(line.dataset.index), d);
        render(`[data-index="${line.dataset.index}"] [data-qty="${d}"]`);
        return;
      }
      if (line && e.target.closest('[data-remove]')) {
        update(Number(line.dataset.index), 'remove');
        render('[data-remove]');
        return;
      }
      const checkout = e.target.closest('[data-checkout]');
      if (!checkout) return;
      const status = $('[data-checkout-status]', box);
      const user = await session;
      if (!user) { location.assign('login.html?next=cart.html'); return; }
      busy(checkout, true, 'Placing order…');
      setStatus(status, '', null);
      try {
        const items = bagStore.read().map(({ slug, size, qty }) => ({ slug, size, qty }));
        const { order } = await api('/api/orders', { items });
        placed = { order, user };
        bagStore.write([]);
        render();
        scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      } catch (err) {
        if (err.status === 401) { location.assign('login.html?next=cart.html'); return; }
        busy(checkout, false, 'Checkout');
        setStatus(status, err.message, 'error');
      }
    });

    document.addEventListener('bag:sync', () => render());
    render();
  }

  /* Contact form */

  const contactForm = $('[data-contact-form]');
  if (contactForm) {
    const status = $('[data-form-status]', contactForm);
    const submit = $('button[type="submit"]', contactForm);
    const label = submit.textContent;
    const f = contactForm.elements;
    clearOnInput(contactForm);
    session.then((user) => {
      if (!user) return;
      if (!f.name.value) f.name.value = user.name;
      if (!f.email.value) f.email.value = user.email;
    });

    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = { name: f.name.value.trim(), email: f.email.value.trim(), topic: f.topic.value, message: f.message.value.trim() };
      const ok = validate(contactForm, status, [
        ['name', !data.name, 'Please enter your name.'],
        ['email', !EMAIL.test(data.email), 'Please enter a valid email address.'],
        ['topic', !data.topic, 'Please choose a topic.'],
        ['message', data.message.length < 10, 'Please write a little more so we can help.'],
      ]);
      if (!ok) return;
      busy(submit, true, 'Sending…');
      setStatus(status, '', null);
      try {
        await api('/api/contact', data);
        contactForm.reset();
        setStatus(status, 'Thank you. Your message is on its way, and we’ll reply by email.', 'success');
      } catch (err) {
        setStatus(status, err.message, 'error');
        if (err.field) markField(contactForm, err.field, true);
      } finally {
        busy(submit, false, label);
      }
    });
  }
})();
