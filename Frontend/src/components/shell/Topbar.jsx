import React from "react";
import { FiMenu, FiZap, FiChevronRight } from "react-icons/fi";
import ThemeToggle from "../ThemeToggle.jsx";
import NotificationsBell from "../NotificationsBell.jsx";
import CommandSearch from "./CommandSearch.jsx";
import LivePill from "./LivePill.jsx";

/**
 * Barre du haut flottante (verre) : menu mobile, fil d'Ariane, barre de commande,
 * état temps réel, mode performance, thème, notifications.
 */
export default function Topbar({ activeEntry, commands, onNavigate, onToggleMenu, lite, onToggleLite }) {
  return (
    <header className="topbar">
      <div className="topbar__bar">
        <button className="iconbtn topbar__menu" onClick={onToggleMenu} title="Menu" aria-label="Ouvrir le menu"><FiMenu /></button>
        {activeEntry && (
          <nav className="topbar__crumbs" aria-label="Fil d'Ariane">
            <span className="topbar__section">{activeEntry.section}</span>
            <span className="topbar__sep" aria-hidden="true"><FiChevronRight size={14} /></span>
            <span key={activeEntry.key} className="topbar__title" aria-current="page">{activeEntry.label}</span>
          </nav>
        )}
        <div className="topbar__center">
          <CommandSearch commands={commands} onNavigate={onNavigate} />
        </div>
        <div className="topbar__actions">
          <LivePill />
          <button
            className={lite ? "iconbtn is-on" : "iconbtn"}
            onClick={onToggleLite}
            title={lite ? "Mode performance activé (effets réduits) — cliquer pour les effets complets" : "Activer le mode performance (PC lents)"}
            aria-pressed={lite}
            aria-label="Mode performance"
          >
            <FiZap size={17} />
          </button>
          <ThemeToggle />
          <NotificationsBell />
        </div>
      </div>
    </header>
  );
}
