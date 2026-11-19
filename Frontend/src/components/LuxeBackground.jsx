import React, { useEffect, useRef } from "react";
import { isLite, isPaused } from "../ui/perf.js";

/**
 * Fond interactif « luxe » :
 *  - maillage de dégradés + aurores floues qui dérivent lentement (CSS)
 *  - halo conique qui tourne très lentement (CSS)
 *  - grain fin (SVG) pour la matière
 *  - poussière de lumière (canvas) : particules qui flottent ; près du curseur elles s'éclairent
 *    et se relient par des filaments
 *  - halo + trame de points qui suivent la souris avec inertie
 * En pause quand l'onglet est caché ; statique si « réduire les animations ».
 */
export default function LuxeBackground({ variant = "app" }) {
  const ref = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    const isDark = () => document.documentElement.classList.contains("dark");

    let W = 0, H = 0, dpr = 1;
    let particles = [];
    const box = () => (variant === "login" ? el.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });

    function resize() {
      const b = box();
      W = Math.max(1, b.width); H = Math.max(1, b.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(45, Math.max(20, (W * H) / 34000)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.4 + 0.5,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -(Math.random() * 0.18 + 0.04),
        tw: Math.random() * Math.PI * 2,
        ts: Math.random() * 0.02 + 0.006,
      }));
    }

    // Souris (avec inertie)
    let tx = W * 0.7, ty = H * 0.3, mx = tx, my = ty, inside = false;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const dark = isDark();
      const base = dark ? "160,190,255" : "36,86,230";
      const near = [];
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.tw += p.ts;
        if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
        if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
        const dx = p.x - mx, dy = p.y - my;
        const d = Math.hypot(dx, dy);
        const prox = inside ? Math.max(0, 1 - d / 190) : 0;
        if (prox > 0) {
          // légère répulsion
          p.x += (dx / (d || 1)) * prox * 0.6;
          p.y += (dy / (d || 1)) * prox * 0.6;
          near.push([p, prox]);
        }
        const tw = 0.5 + Math.sin(p.tw) * 0.5;
        const a = (dark ? 0.22 : 0.18) + tw * (dark ? 0.25 : 0.16) + prox * 0.55;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + prox * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${base},${a.toFixed(3)})`;
        ctx.fill();
      }
      // Filaments entre particules proches du curseur
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const [a, pa] = near[i], [b, pb] = near[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 120) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${base},${((1 - d / 120) * Math.min(pa, pb) * 0.55).toFixed(3)})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }
    }

    let raf = 0, lastT = 0;
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (isPaused() || t - lastT < 33) return; // ~30 fps, rien si fenêtre inactive
      lastT = t;
      mx += (tx - mx) * 0.08; my += (ty - my) * 0.08;
      el.style.setProperty("--mx", `${mx.toFixed(1)}px`);
      el.style.setProperty("--my", `${my.toFixed(1)}px`);
      el.style.setProperty("--px", ((mx / W) * 2 - 1).toFixed(3));
      el.style.setProperty("--py", ((my / H) * 2 - 1).toFixed(3));
      draw();
    }

    const onMove = (e) => {
      const b = box();
      tx = e.clientX - b.left; ty = e.clientY - b.top;
      inside = tx >= 0 && ty >= 0 && tx <= W && ty <= H;
      el.classList.toggle("is-idle", !inside);
    };
    const onLeave = () => { inside = false; el.classList.add("is-idle"); };

    resize();
    window.addEventListener("resize", resize);
    if (reduce || isLite()) { draw(); return () => window.removeEventListener("resize", resize); }
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [variant]);

  return (
    <div ref={ref} className={`luxe-bg luxe-bg--${variant}`} aria-hidden="true">
      <div className="luxe-bg__mesh" />
      <div className="luxe-bg__halo" />
      <div className="luxe-bg__aura luxe-bg__aura--1" />
      <div className="luxe-bg__aura luxe-bg__aura--2" />
      <div className="luxe-bg__aura luxe-bg__aura--3" />
      <div className="luxe-bg__dots" />
      <div className="luxe-bg__spot" />
      <canvas ref={canvasRef} className="luxe-bg__dust" />
      <div className="luxe-bg__grain" />
    </div>
  );
}
