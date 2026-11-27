import React from "react";
import { FiSidebar } from "react-icons/fi";
import NavItem from "./NavItem.jsx";
import UserCard from "./UserCard.jsx";
import BrandMark from "./BrandMark.jsx";

/**
 * Barre latérale : marque, sections de navigation, carte utilisateur.
 * Repliée : rail d'icônes qui s'ouvre au survol (styles/layout/shell.css).
 */
export default function Sidebar({ navSections, user, collapsed, onTogglePin, onSelect, onOpenProfile, onLogout }) {
  return (
    <aside className="sidebar" aria-label="Navigation principale">
      <div className="sidebar__top">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true"><BrandMark /></div>
          <div className="brand__text">
            <div className="brand__name">Kyntus</div>
            <div className="brand__sub">Contrôle qualité</div>
          </div>
        </div>
        <button type="button" className="iconbtn sidebar__pin" onClick={onTogglePin}
          title={collapsed ? "Garder le menu ouvert" : "Réduire le menu en barre d'icônes"} aria-label={collapsed ? "Garder le menu ouvert" : "Réduire le menu"} aria-pressed={!collapsed}>
          <FiSidebar size={15} />
        </button>
      </div>

      <nav className="nav">
        {(navSections || []).map((sec) => (
          <div key={sec.title} className="nav__section">
            <div className="nav__title">{sec.title}</div>
            <div className="nav__items">
              {sec.items.map((it) => <NavItem key={it.key} item={it} onSelect={onSelect} />)}
            </div>
          </div>
        ))}
      </nav>

      <div className="sidebar__bottom">
        <UserCard user={user} onOpenProfile={onOpenProfile} onLogout={onLogout} />
      </div>
    </aside>
  );
}
