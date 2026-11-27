import React from "react";

/** Monogramme Kyntus (K blanc) posé sur le dégradé de marque du conteneur. */
export default function BrandMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="16 14 36 36" aria-hidden="true">
      <path d="M22 44V20h6v10l10-10h8L34 32l12 12h-8L28 34v10z" fill="#fff" />
    </svg>
  );
}
