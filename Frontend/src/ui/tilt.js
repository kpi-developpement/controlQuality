// src/ui/tilt.js — cartes inclinables en 3D (« magnetic / tilt cards »)
//
// Toute carte portant la classe .card--tilt s'incline selon la position du curseur ;
// ses éléments marqués data-depth="1|2|3" se décalent à des vitesses différentes (parallaxe).
// Variables posées : --rx / --ry (angles) et --px / --py (-1 → 1). Style : styles/components/cards.css.

const MAX_DEG = 7;

function reduced() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.classList.contains("perf-lite");
}

export function initTilt() {
  if (typeof document === "undefined" || document.__kcqTilt) return;
  document.__kcqTilt = true;
  let current = null;
  let raf = 0;
  let last = null;

  const reset = (el) => {
    if (!el) return;
    el.classList.remove("is-tilting");
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
    el.style.removeProperty("--px");
    el.style.removeProperty("--py");
  };

  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = last.target.closest?.(".card--tilt");
        if (el !== current) { reset(current); current = el; }
        if (!el || reduced()) return;
        const r = el.getBoundingClientRect();
        const px = ((last.clientX - r.left) / r.width) * 2 - 1;
        const py = ((last.clientY - r.top) / r.height) * 2 - 1;
        el.classList.add("is-tilting");
        el.style.setProperty("--ry", `${(px * MAX_DEG).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${(-py * MAX_DEG).toFixed(2)}deg`);
        el.style.setProperty("--px", px.toFixed(3));
        el.style.setProperty("--py", py.toFixed(3));
      });
    },
    { passive: true }
  );
  document.addEventListener("pointerleave", () => { reset(current); current = null; }, true);
  window.addEventListener("blur", () => { reset(current); current = null; });
}
