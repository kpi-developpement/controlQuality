import React, { useEffect, useRef } from "react";

/**
 * Fond animé de la barre latérale :
 *  - aurores colorées qui dérivent (CSS)
 *  - champ d'étoiles scintillantes + étoiles filantes
 *  - flux de particules qui monte et s'enroule autour du curseur quand on survole le menu
 *  - sol en grille perspective qui défile sous la carte utilisateur
 * Canvas limité à la taille de la barre, ~30 fps, en pause si l'onglet est caché,
 * statique si « réduire les animations ».
 */
export default function SidebarBackdrop() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const host = wrap?.parentElement;
    if (!wrap || !canvas || !host) return undefined;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, dpr = 1;
    let stars = [], flow = [], comets = [];
    const mouse = { x: -999, y: -999, on: false, sx: -999, sy: -999 };

    const rand = (a, b) => a + Math.random() * (b - a);
    function resize() {
      const r = host.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((W * H) / 2200) }, () => ({
        x: rand(0, W), y: rand(0, H), r: rand(0.3, 1.3), t: rand(0, Math.PI * 2), s: rand(0.01, 0.04),
      }));
      flow = Array.from({ length: 55 }, () => newFlow(true));
    }
    function newFlow(anywhere) {
      return {
        x: rand(0, W), y: anywhere ? rand(0, H) : H + rand(0, 40),
        vy: -rand(0.25, 0.9), vx: 0, life: 0, r: rand(0.6, 1.8),
        hue: Math.random() < 0.7 ? rand(205, 230) : rand(160, 180),
      };
    }

    function frame() {
      ctx.clearRect(0, 0, W, H);
      mouse.sx += (mouse.x - mouse.sx) * 0.15;
      mouse.sy += (mouse.y - mouse.sy) * 0.15;

      // Étoiles
      for (const s of stars) {
        s.t += s.s;
        const a = 0.25 + Math.sin(s.t) * 0.25 + 0.15;
        ctx.fillStyle = `rgba(200,220,255,${a.toFixed(3)})`;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }

      // Flux de particules (tourbillon autour du curseur)
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < flow.length; i++) {
        const p = flow[i];
        if (mouse.on) {
          const dx = mouse.sx - p.x, dy = mouse.sy - p.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < 140) {
            const f = (1 - d / 140) * 0.9;
            // composante tangentielle = tourbillon, radiale = attraction
            p.vx += (-dy / d) * f * 0.35 + (dx / d) * f * 0.12;
            p.vy += (dx / d) * f * 0.35 + (dy / d) * f * 0.12;
          }
        }
        p.vx *= 0.94;
        p.vy = p.vy * 0.97 - 0.02;
        p.x += p.vx + Math.sin((p.y + p.life) * 0.02) * 0.25;
        p.y += p.vy;
        p.life += 1;
        if (p.y < -20 || p.x < -20 || p.x > W + 20) flow[i] = newFlow(false);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
        glow.addColorStop(0, `hsla(${p.hue},100%,75%,0.6)`);
        glow.addColorStop(1, `hsla(${p.hue},100%,60%,0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2); ctx.fill();
      }

      // Étoiles filantes
      if (Math.random() < 0.012 && comets.length < 2) {
        comets.push({ x: rand(W * 0.2, W * 1.2), y: rand(-20, H * 0.5), v: rand(5, 9), life: 0, max: rand(40, 70) });
      }
      comets = comets.filter((c) => c.life < c.max);
      for (const c of comets) {
        c.life += 1; c.x -= c.v * 0.8; c.y += c.v * 0.6;
        const a = 1 - c.life / c.max;
        const g = ctx.createLinearGradient(c.x, c.y, c.x + 60, c.y - 45);
        g.addColorStop(0, `rgba(220,235,255,${a})`);
        g.addColorStop(1, "rgba(120,170,255,0)");
        ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + 60, c.y - 45); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      // Halo du curseur
      if (mouse.on) {
        const h = ctx.createRadialGradient(mouse.sx, mouse.sy, 0, mouse.sx, mouse.sy, 120);
        h.addColorStop(0, "rgba(91,140,255,0.16)");
        h.addColorStop(1, "rgba(91,140,255,0)");
        ctx.fillStyle = h; ctx.fillRect(0, 0, W, H);
      }
    }

    let raf = 0, last = 0;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || t - last < 33) return;
      last = t;
      frame();
    };
    const onMove = (e) => {
      const r = host.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      if (!mouse.on) { mouse.sx = mouse.x; mouse.sy = mouse.y; }
      mouse.on = true;
    };
    const onLeave = () => { mouse.on = false; };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    if (reduce) { frame(); return () => ro.disconnect(); }
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={wrapRef} className="side-fx" aria-hidden="true">
      <div className="side-fx__aurora side-fx__aurora--1" />
      <div className="side-fx__aurora side-fx__aurora--2" />
      <div className="side-fx__aurora side-fx__aurora--3" />
      <div className="side-fx__aurora side-fx__aurora--4" />
      <canvas ref={canvasRef} className="side-fx__canvas" />
      <div className="side-fx__floor" />
      <div className="side-fx__scan" />
      <div className="side-fx__edge" />
    </div>
  );
}
