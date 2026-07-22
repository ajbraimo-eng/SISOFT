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
      { threshold: 0.16, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i % 4, 3) * 0.08}s`;
      io.observe(el);
    });
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  const visual = document.querySelector(".hero-visual");
  if (visual && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.addEventListener(
      "pointermove",
      (event) => {
        const x = (event.clientX / window.innerWidth - 0.5) * 12;
        const y = (event.clientY / window.innerHeight - 0.5) * 8;
        visual.style.transform = `translate(${x}px, ${y}px)`;
      },
      { passive: true }
    );
  }

  const form = document.getElementById("contact-form");
  const msg = document.getElementById("contact-msg");
  if (form && msg) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      msg.textContent = "";
      msg.classList.remove("is-ok");
      const payload = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim(),
        service: form.service.value,
        message: form.message.value.trim()
      };
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Não foi possível enviar.");
        msg.classList.add("is-ok");
        msg.textContent = "Pedido enviado. A Sisoft vai contactá-lo em breve.";
        form.reset();
      } catch (err) {
        msg.textContent = err.message || "Erro de ligação.";
      }
    });
  }
})();
