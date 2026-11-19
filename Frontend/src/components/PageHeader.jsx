import React from "react";

/** En-tête de page commun : même titre (dégradé, animation) que le reste de l'application. */
export default function PageHeader({ title, subtitle, right }) {
  return (
    <div className="page-head">
      <div>
        <div className="page-title">{title}</div>
        {subtitle ? <div>{subtitle}</div> : null}
      </div>
      {right ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{right}</div> : null}
    </div>
  );
}
