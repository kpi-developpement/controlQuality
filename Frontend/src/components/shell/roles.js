// Libellés des rôles affichés dans la coquille (carte utilisateur, menus)
export const ROLE_LABELS = {
  admin: "Administrateur",
  cq: "Contrôle qualité",
  formateur: "Formateur",
  management: "Management",
  supervision: "Supervision",
  pilote: "Pilote",
  referent: "Référent technique",
  superviseur: "Superviseur",
  cdp: "Chef de projet",
};

export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}
