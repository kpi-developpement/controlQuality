import React from "react";

export default function Card({ title, right, children, style }) {
  return (
    <div
      className="card"
      style={{
        padding: "1.1rem 1.2rem",
        marginBottom: "1rem",
        ...style,
      }}
    >
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.75rem" }}>
          <div style={{ fontWeight: 750, fontSize: "0.95rem", letterSpacing: "-0.015em" }}>{title}</div>
          <div>{right}</div>
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}