(function () {
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];

  const cart = new Map();
  const yearEl = qs('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* Header scroll */
  const header = qs('.site-header');
  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 12);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Mobile nav */
  const navPill = qs('#navPill');
  const menuToggle = qs('#menuToggle');
  menuToggle?.addEventListener('click', () => {
    navPill.classList.toggle('is-open');
  });
  qsa('#navPill a').forEach((a) => {
    a.addEventListener('click', () => navPill.classList.remove('is-open'));
  });

  /* Active nav by section */
  const sections = qsa('section[id], header[id]');
  const navLinks = qsa('.nav-pill a');
  const spy = () => {
    let current = 'top';
    for (const section of sections) {
      const top = section.getBoundingClientRect().top;
      if (top <= 120) current = section.id || current;
    }
    navLinks.forEach((link) => {
      const href = link.getAttribute('href')?.replace('#', '');
      link.classList.toggle('is-active', href === current);
    });
  };
  window.addEventListener('scroll', spy, { passive: true });
  spy();

  /* Cart */
  const cartDrawer = qs('#cartDrawer');
  const backdrop = qs('#backdrop');
  const cartBody = qs('#cartBody');
  const cartCount = qs('#cartCount');
  const cartTotal = qs('#cartTotal');

  function toast(message) {
    const stack = qs('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s';
      setTimeout(() => el.remove(), 250);
    }, 2400);
  }

  function openCart() {
    cartDrawer.classList.add('is-open');
    cartDrawer.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
  }

  function closeCart() {
    cartDrawer.classList.remove('is-open');
    cartDrawer.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
  }

  function renderCart() {
    let total = 0;
    let count = 0;
    const lines = [];
    for (const [name, item] of cart.entries()) {
      total += item.price * item.qty;
      count += item.qty;
      lines.push(`
        <div class="cart-line">
          <div>
            <strong>${name}</strong>
            <small>${item.qty} × ${item.price} ₽</small>
          </div>
          <strong>${item.qty * item.price} ₽</strong>
        </div>`);
    }
    cartBody.innerHTML = lines.length
      ? lines.join('')
      : '<p class="cart-empty">Пока пусто. Выберите кофе :)</p>';
    cartCount.textContent = String(count);
    cartTotal.textContent = `${total} ₽`;
  }

  function addToCart(name, price) {
    const existing = cart.get(name);
    if (existing) existing.qty += 1;
    else cart.set(name, { price: Number(price), qty: 1 });
    renderCart();
    toast(`${name} добавлен в корзину`);
  }

  qsa('.product-card').forEach((card) => {
    card.querySelector('.add-btn')?.addEventListener('click', () => {
      addToCart(card.dataset.name, card.dataset.price);
    });
  });

  qs('#cartBtn')?.addEventListener('click', openCart);
  qs('#closeCart')?.addEventListener('click', closeCart);
  backdrop?.addEventListener('click', () => {
    closeCart();
    closeQuiz();
  });

  qs('#checkoutBtn')?.addEventListener('click', () => {
    if (!cart.size) {
      toast('Корзина пуста');
      return;
    }
    toast('Заказ принят! Мы свяжемся с вами.');
    cart.clear();
    renderCart();
    closeCart();
  });

  /* Quiz */
  const quizModal = qs('#quizModal');
  const quizStepText = qs('#quizStepText');
  const quizOptions = qs('#quizOptions');
  const quizResult = qs('#quizResult');

  const quizFlow = [
    {
      text: 'Что тебе ближе утром?',
      options: [
        { label: 'Бодрость и крепость', score: 'espresso' },
        { label: 'Мягкость и молоко', score: 'latte' },
        { label: 'Сладость и уют', score: 'mocha' }
      ]
    },
    {
      text: 'Какой вкус любишь?',
      options: [
        { label: 'Горький шоколад / какао', score: 'mocha' },
        { label: 'Чистый кофейный профиль', score: 'espresso' },
        { label: 'Нежный сливочный', score: 'latte' }
      ]
    },
    {
      text: 'Как обычно пьёшь кофе?',
      options: [
        { label: 'Быстро, на ходу', score: 'espresso' },
        { label: 'Медленно, с книгой', score: 'latte' },
        { label: 'Как десерт после дня', score: 'mocha' }
      ]
    }
  ];

  const results = {
    espresso: 'Тебе подойдёт классический Espresso или крепкий Cappuccino — чистый вкус и энергия.',
    latte: 'Твой напиток — Latte. Мягкий, молочный и идеальный для спокойного утра.',
    mocha: 'Бери Mocha: шоколад, кофе и настроение десерта в одной чашке.'
  };

  let step = 0;
  const scores = { espresso: 0, latte: 0, mocha: 0 };

  function openQuiz() {
    step = 0;
    scores.espresso = scores.latte = scores.mocha = 0;
    quizResult.classList.add('hidden');
    quizResult.textContent = '';
    paintQuizStep();
    quizModal.hidden = false;
    backdrop.hidden = false;
  }

  function closeQuiz() {
    quizModal.hidden = true;
    if (!cartDrawer.classList.contains('is-open')) backdrop.hidden = true;
  }

  function paintQuizStep() {
    const current = quizFlow[step];
    quizStepText.textContent = current.text;
    quizOptions.innerHTML = current.options
      .map((o) => `<button type="button" data-score="${o.score}">${o.label}</button>`)
      .join('');
    qsa('button', quizOptions).forEach((btn) => {
      btn.addEventListener('click', () => {
        scores[btn.dataset.score] += 1;
        step += 1;
        if (step >= quizFlow.length) {
          const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
          quizOptions.innerHTML = '';
          quizStepText.textContent = 'Готово!';
          quizResult.textContent = results[winner];
          quizResult.classList.remove('hidden');
          return;
        }
        paintQuizStep();
      });
    });
  }

  qs('#quizBtn')?.addEventListener('click', openQuiz);
  qs('#closeQuiz')?.addEventListener('click', closeQuiz);

  /* Scroll reveal */
  const revealEls = qsa(
    '.product-card, .feature, .review-card, .quiz-panel, .about-center, .menu-item'
  );
  revealEls.forEach((el) => el.classList.add('reveal'));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  revealEls.forEach((el) => io.observe(el));

  renderCart();
})();
