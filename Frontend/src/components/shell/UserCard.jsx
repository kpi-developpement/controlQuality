import React from "react";
import { FiLogOut, FiSettings } from "react-icons/fi";
import { ROLE_LABELS, initialsOf } from "./roles.js";

/** Bas de la barre latérale : avatar (ouvre le profil), nom, rôle, déconnexion. */
export default function UserCard({ user, onOpenProfile, onLogout }) {
  const role = user?.role || "";
  return (
    <div className="usercard">
      <button type="button" className="usercard__avatar" onClick={onOpenProfile} title="Paramètres du profil" aria-label="Paramètres du profil">
        {initialsOf(user?.name)}
      </button>
      <button type="button" className="usercard__meta" onClick={onOpenProfile} title="Paramètres du profil">
        <span className="usercard__name">{user?.name || "Utilisateur"} <FiSettings style={{ fontSize: 12, opacity: 0.55, flexShrink: 0 }} /></span>
        <span className="usercard__role">{ROLE_LABELS[role] || role.toUpperCase()}</span>
      </button>
      <button type="button" className="iconbtn usercard__logout" onClick={onLogout} title="Déconnexion" aria-label="Déconnexion"><FiLogOut /></button>
    </div>
  );
}
