// src/utils/gridScope.js — rangement des grilles : Contrat(s) → Activité(s) → Cellule(s)

/** Valeurs multiples d'une grille, compatibles avec l'ancien format (champ texte unique). */
export const gridContracts = (g) => (g?.contracts?.length ? g.contracts : g?.contract ? [g.contract] : []);
export const gridActivities = (g) => (g?.activities?.length ? g.activities : g?.activity ? [g.activity] : []);

export const isClassified = (g) => !!(gridContracts(g).length || gridActivities(g).length || (g?.cells || []).length);

/**
 * La grille s'applique-t-elle à cette cellule ?
 * - cellules listées : seulement celles-ci
 * - sinon activités renseignées : toutes les cellules de ces activités (dans les contrats choisis, s'il y en a)
 * - sinon contrats renseignés : toutes les cellules de ces contrats
 */
export function gridAppliesToCell(g, cell) {
  if (!g || !cell) return false;
  const cells = g.cells || [];
  if (cells.length) return cells.includes(cell.name);
  const acts = gridActivities(g);
  const ctrs = gridContracts(g);
  if (acts.length) return acts.includes(cell.activity || "") && (!ctrs.length || ctrs.includes(cell.contract || ""));
  if (ctrs.length) return ctrs.includes(cell.contract || "");
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
