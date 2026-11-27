import React from "react";

/** Entrée de la barre latérale : icône + libellé, repère lumineux quand elle est active. */
export default function NavItem({ item, onSelect }) {
  return (
    <button
      type="button"
      className={item.active ? "nav__item nav__item--active" : "nav__item"}
      onClick={() => onSelect(item)}
      title={item.label}
      aria-current={item.active ? "page" : undefined}
    >
      <span className="nav__icon">{item.icon}</span>
      <span className="nav__label">{item.label}</span>
    </button>
  );
}
