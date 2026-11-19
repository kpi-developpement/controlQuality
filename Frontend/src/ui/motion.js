// src/ui/motion.js — micro-interactions globales (sans dépendance)
// - Ripple sur les boutons et les éléments de navigation
// - Barre de progression fine pendant les requêtes réseau (axios)

const RIPPLE_SELECTOR = ".btn, .btn-primary, .btn-outline, .btn-danger, .nav__item, .iconbtn";

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function initRipple() {
  if (typeof document === "undefined" || document.__kcqRipple) return;
  document.__kcqRipple = true;

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || reducedMotion()) return;
      const el = e.target.closest?.(RIPPLE_SELECTOR);
      if (!el || el.disabled) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      const span = document.createElement("span");
      span.className = "ripple";
      span.style.width = span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left - size / 2}px`;
      span.style.top = `${e.clientY - rect.top - size / 2}px`;
      el.appendChild(span);
      span.addEventListener("animationend", () => span.remove(), { once: true });
      setTimeout(() => span.remove(), 900);
    },
    { passive: true }
  );
}

export function attachNetworkProgress(axiosInstance) {
  if (typeof document === "undefined" || !axiosInstance || axiosInstance.__kcqProgress) return;
  axiosInstance.__kcqProgress = true;

  const bar = document.createElement("div");
  bar.className = "net-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);

  let pending = 0;
  let showTimer = null;
  const update = () => {
    if (pending > 0) {
      if (!showTimer) showTimer = setTimeout(() => bar.classList.add("is-active"), 120);
    } else {
      clearTimeout(showTimer);
      showTimer = null;
      bar.classList.remove("is-active");
    }
  };
  const done = () => {
    pending = Math.max(0, pending - 1);
    update();
  };

  axiosInstance.interceptors.request.use((config) => {
    pending += 1;
    update();
    return config;
  });
  axiosInstance.interceptors.response.use(
    (res) => {
      done();
      return res;
    },
    (err) => {
      done();
      return Promise.reject(err);
    }
  );
}

/** Change de thème avec un dévoilement circulaire depuis le point du clic (si supporté). */
export function withThemeTransition(event, apply) {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc?.startViewTransition || reducedMotion()) {
    apply();
    return;
  }
  const x = event?.clientX ?? window.innerWidth - 60;
  const y = event?.clientY ?? 32;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const t = doc.startViewTransition(() => {
    apply();
  });
  t.ready
    .then(() => {
      doc.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 520, easing: "cubic-bezier(0.22,1,0.36,1)", pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {});
}

/** Halo des cartes : pose --cx/--cy (position de la souris dans la carte survolée). */
export function initCardGlow() {
  if (typeof document === "undefined" || document.__kcqCardGlow) return;
  document.__kcqCardGlow = true;
  let raf = 0, last = null;
  document.addEventListener(
    "pointermove",
    (e) => {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const card = last.target.closest?.(".card");
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--cx", `${last.clientX - r.left}px`);
        card.style.setProperty("--cy", `${last.clientY - r.top}px`);
      });
    },
    { passive: true }
  );
}
