// src/ui/perf.js — mode performance et mise en pause des animations
//
// - « léger » : coupe les fonds animés (canvas), flous, reflets et halos → fluide sur les PC modestes.
//   Auto-activé si la machine a peu de cœurs / de mémoire ou si l'utilisateur préfère réduire les animations.
//   Choix mémorisé (bouton éclair dans la barre du haut).
// - pause : quand l'onglet est caché ou que la fenêtre n'a pas le focus (autre fenêtre au premier plan),
//   toutes les animations s'arrêtent (classe html.kcq-paused) et les canvas ne dessinent plus.

const KEY = "kcq:perf"; // "lite" | "full" | absent = auto
const listeners = new Set();

function autoLite() {
  if (typeof window === "undefined") return false;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return reduce || cores <= 4 || mem <= 4;
}

export function getPerfPref() {
  try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; }
}

export function isLite() {
  const p = getPerfPref();
  return p === "lite" || (p === "auto" && autoLite());
}

function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("perf-lite", isLite());
}

export function setPerfPref(v) {
  try {
    if (v === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch { /* ignore */ }
  apply();
  listeners.forEach((fn) => fn(isLite()));
}

export function onPerfChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Vrai quand rien ne doit s'animer (onglet caché ou fenêtre sans focus). */
export function isPaused() {
  return typeof document !== "undefined" && (document.hidden || !document.hasFocus());
}

export function initPerf() {
  if (typeof document === "undefined" || document.__kcqPerf) return;
  document.__kcqPerf = true;
  apply();
  const sync = () => document.documentElement.classList.toggle("kcq-paused", isPaused());
  window.addEventListener("blur", sync);
  window.addEventListener("focus", sync);
  document.addEventListener("visibilitychange", sync);
  sync();
}
