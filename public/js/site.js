(() => {
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  const mobileLogin = document.querySelector("[data-mobile-login]");
  const navLinks = document.querySelector(".nav-links");
  if (mobileLogin && navLinks) {
    const sync = () => {
      const hideNav = window.matchMedia("(max-width: 860px)").matches;
      mobileLogin.hidden = !hideNav;
    };
    sync();
    window.addEventListener("resize", sync);
  }

  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i % 4, 3) * 0.08}s`;
      io.observe(el);
    });
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  const heroVisual = document.querySelector(".hero-visual svg");
  if (heroVisual && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.addEventListener(
      "pointermove",
      (event) => {
        const x = (event.clientX / window.innerWidth - 0.5) * 12;
        const y = (event.clientY / window.innerHeight - 0.5) * 8;
        heroVisual.style.transform = `translate(${x}px, ${y}px)`;
      },
      { passive: true }
    );
  }
})();
