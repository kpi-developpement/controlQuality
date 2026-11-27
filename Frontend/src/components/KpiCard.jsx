import React from "react";
import AnimatedValue from "./AnimatedValue.jsx";

/**
 * Carte d'indicateur (verre + spotlight + inclinaison 3D) : valeur, détail du calcul, formule.
 * @param {"good"|"warn"|"bad"} tone  colore la valeur et la lueur
 * @param {number} meter              0-100 : jauge sous la valeur (taux)
 * @param {"hero"|"wide"} size        tuile de grille bento (styles/components/cards.css)
 */
export default function KpiCard({ title, value, detail, formula, tone, meter, size, icon, children }) {
  const color = tone === "good" ? "var(--success)" : tone === "warn" ? "var(--warning)" : tone === "bad" ? "var(--danger)" : "var(--text)";
  const cls = ["card", "stat-card", "card--tilt", size === "hero" && "bento--hero", size === "wide" && "bento--wide"].filter(Boolean).join(" ");
  const pct = Number.isFinite(Number(meter)) ? Math.max(0, Math.min(100, Number(meter))) : null;
  return (
    <div className={cls} style={tone ? { "--stat-accent": color } : undefined}>
      <div className="stat-card__label" data-depth="1">{title}</div>
      {icon ? <div className="stat-card__icon" data-depth="2">{icon}</div> : null}
      <div className="stat-card__value" data-depth="3" style={{ color }}><AnimatedValue value={value} /></div>
      {size === "hero" && pct !== null ? <Ring pct={pct} /> : null}
      {pct !== null && size !== "hero" ? <div className="stat-card__meter" data-depth="2" role="presentation"><span style={{ width: `${pct}%` }} /></div> : null}
      {detail ? <div className="stat-card__detail" data-depth="1">{detail}</div> : null}
      {children}
      {formula ? <div className="stat-card__formula">{formula}</div> : null}
    </div>
  );
}

/** Anneau de progression (tuile principale) : tracé animé avec un ressort. */
function Ring({ pct }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <svg className="stat-card__ring" data-depth="2" viewBox="0 0 180 180" aria-hidden="true">
      <g transform="rotate(-90 90 90)">
        <circle cx="90" cy="90" r={r} className="stat-card__ring-track" />
      <circle cx="90" cy="90" r={r} className="stat-card__ring-value" strokeDasharray={c} style={{ "--off": c * (1 - pct / 100), "--len": c }} />
      </g>
      <text x="90" y="98" textAnchor="middle" className="stat-card__ring-text">{Math.round(pct)}<tspan dy="-14" fontSize="16">%</tspan></text>
    </svg>
  );
}
