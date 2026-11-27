// src/ui/viewTransition.js — transitions entre écrans avec l'API View Transitions du navigateur
//
// withViewTransition(update) : le navigateur fige l'écran actuel, applique la mise à jour
// (rendu React synchrone), puis anime le passage (styles : ::view-transition-*(kcq-page) dans motion.css).
// Repli transparent si l'API n'existe pas, si l'utilisateur réduit les animations ou en mode performance.
import { flushSync } from "react-dom";

export function canTransition() {
  if (typeof document === "undefined" || !document.startViewTransition) return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return !document.documentElement.classList.contains("perf-lite");
}

let running = null;

export function withViewTransition(update) {
  // Un clic pendant une transition : on termine la précédente immédiatement (aucun clic perdu)
  if (running) { try { running.skipTransition(); } catch { /* déjà terminée */ } running = null; }
  if (!canTransition()) { update(); return; }
  try {
    const html = document.documentElement;
    html.classList.add("vt-page"); // .content devient la zone animée (styles/motion.css)
    const t = document.startViewTransition(() => { flushSync(update); });
    running = t;
    t.finished.finally(() => { html.classList.remove("vt-page"); if (running === t) running = null; });
  } catch {
    update();
  }
}
