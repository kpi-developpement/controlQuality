import React, { useEffect, useRef } from "react";

/**
 * Fond atmosphérique : aurores qui dérivent, trame de points révélée autour du curseur, grain.
 * Rendu 100 % CSS (styles/layout/background.css) ; ce composant ne fait que suivre la souris
 * (--mx / --my, au plus une fois par image). Aucun canvas, aucune boucle permanente.
 *
 * @param {boolean} contained  fond limité à son parent (écran de connexion) au lieu de toute la fenêtre
 */
export default function AuroraBackground({ contained = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    let last = null;
    const onMove = (e) => {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (document.documentElement.classList.contains("perf-lite")) return;
        const r = contained ? el.getBoundingClientRect() : { left: 0, top: 0 };
        el.style.setProperty("--mx", `${last.clientX - r.left}px`);
        el.style.setProperty("--my", `${last.clientY - r.top}px`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, [contained]);

  return (
    <div ref={ref} className={contained ? "aurora aurora--contained" : "aurora"} aria-hidden="true">
      <div className="aurora__blob aurora__blob--1" />
      <div className="aurora__blob aurora__blob--2" />
      <div className="aurora__blob aurora__blob--3" />
      <div className="aurora__blob aurora__blob--4" />
      <div className="aurora__spot" />
      <div className="aurora__grid" />
      <div className="aurora__grain" />
    </div>
  );
}
