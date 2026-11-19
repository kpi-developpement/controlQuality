import React from "react";
import AnimatedValue from "./AnimatedValue.jsx";

/** Carte d'indicateur : valeur principale, détail du calcul et formule. */
export default function KpiCard({ title, value, detail, formula, tone, children }) {
  const color = tone === "good" ? "var(--success)" : tone === "warn" ? "var(--warning)" : tone === "bad" ? "var(--danger)" : "var(--text)";
  return (
    <div className="card stat-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, minHeight: 132, "--stat-accent": tone ? color : undefined }}>
      <div className="stat-card__label">{title}</div>
      <div className="stat-card__value" style={{ color }}><AnimatedValue value={value} /></div>
      {detail ? <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{detail}</div> : null}
      {children}
      {formula ? <div style={{ marginTop: "auto", fontSize: "0.72rem", color: "var(--muted)" }}>{formula}</div> : null}
    </div>
  );
}

export const fmtRate = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)} %`);
export const toneFor = (v, good = 80, warn = 50, inverse = false) => {
  if (v === null || v === undefined) return undefined;
  if (inverse) return v <= 100 - good ? "good" : v <= 100 - warn ? "warn" : "bad";
  return v >= good ? "good" : v >= warn ? "warn" : "bad";
};

/** Bornes UTC d'une plage de mois (AAAA-MM). */
export function monthRange(fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return {
    dateFrom: new Date(Date.UTC(fy, fm - 1, 1)).toISOString(),
    dateTo: new Date(Date.UTC(ty, tm, 0, 23, 59, 59, 999)).toISOString(),
  };
}
export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
