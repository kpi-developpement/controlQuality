// src/ui/spotlight.js — lueur des cartes qui suit le curseur (Spotlight / mouse-tracking borders)
//
// Un seul écouteur pour toute l'application : à chaque mouvement de souris (au plus une fois par image),
// on pose --x / --y (position du curseur dans la carte survolée) ; le CSS (styles/components/cards.css)
// dessine la bordure lumineuse et le halo avec un radial-gradient. Aucun rendu React n'est déclenché.

const SELECTOR = ".card, [data-spotlight]";

export function initSpotlight() {
  if (typeof document === "undefined" || document.__kcqSpotlight) return;
  document.__kcqSpotlight = true;
  let raf = 0;
  let last = null;
  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (document.documentElement.classList.contains("perf-lite")) return;
        const el = last.target.closest?.(SELECTOR);
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--x", `${last.clientX - r.left}px`);
        el.style.setProperty("--y", `${last.clientY - r.top}px`);
      });
    },
    { passive: true }
  );
}
