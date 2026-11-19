import React from "react";
import AnimatedValue from "./AnimatedValue.jsx";

export function StatCards({ stats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 16 }}>
      {stats.map((s) => (
        <div key={s.label} className="card stat-card" style={{ padding: "16px 18px" }}>
          <div className="stat-card__label">{s.label}</div>
          <div className="stat-card__value" style={{ marginTop: 4 }}><AnimatedValue value={s.value} /></div>
          {s.help ? <div style={{ marginTop: 4, color: "var(--muted)", fontSize: "0.78rem" }}>{s.help}</div> : null}
        </div>
      ))}
    </div>
  );
}
