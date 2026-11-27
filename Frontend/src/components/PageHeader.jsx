import React from "react";

/** Titre révélé mot à mot (texte simple uniquement ; un titre avec icône reste d'un bloc). */
function RevealTitle({ children }) {
  if (typeof children !== "string") return children;
  return children.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w) ? w : <span key={i} className="word" style={{ "--i": i / 2 }}>{w}</span>));
}

/**
 * En-tête de page commun : grand titre (dégradé, révélation mot à mot), sous-titre, actions à droite.
 * Styles : styles/layout/page.css
 */
export default function PageHeader({ title, subtitle, right }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title"><RevealTitle>{title}</RevealTitle></h1>
        {subtitle ? <div>{subtitle}</div> : null}
      </div>
      {right ? <div className="page-head__actions">{right}</div> : null}
    </div>
  );
}
