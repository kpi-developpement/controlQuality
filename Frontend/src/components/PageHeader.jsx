import React from "react";

export default function PageHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.035em", color: "var(--text)", lineHeight: 1.2 }}>{title}</div>
        {subtitle ? <div style={{ marginTop: 4, color: "var(--muted)", fontSize: "0.875rem" }}>{subtitle}</div> : null}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}
