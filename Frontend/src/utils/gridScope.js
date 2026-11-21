// src/utils/gridScope.js — rangement des grilles : Contrat → Activité → Cellule(s)

export const isClassified = (g) => !!(g?.contract || g?.activity || (g?.cells || []).length);

/**
 * La grille s'applique-t-elle à cette cellule ?
 * - cellules listées : seulement celles-ci
 * - sinon activité renseignée : toutes les cellules de l'activité
 * - sinon contrat renseigné : toutes les cellules du contrat
 */
export function gridAppliesToCell(g, cell) {
  if (!g || !cell) return false;
  const cells = g.cells || [];
  if (cells.length) return cells.includes(cell.name);
  if (g.activity) return g.activity === (cell.activity || "") && (!g.contract || g.contract === (cell.contract || ""));
  if (g.contract) return g.contract === (cell.contract || "");
  return false;
}

/**
 * Grilles proposées pour évaluer un agent de cette cellule : uniquement celles de la cellule.
 * Tant qu'aucune grille n'est rangée pour la cellule, on garde les grilles non classées
 * (comportement d'avant le rangement).
 */
export function gridsForCell(grids, cell) {
  const list = Array.isArray(grids) ? grids : [];
  if (!cell) return list.filter((g) => !isClassified(g));
  const matched = list.filter((g) => gridAppliesToCell(g, cell));
  return matched.length ? matched : list.filter((g) => !isClassified(g));
}
