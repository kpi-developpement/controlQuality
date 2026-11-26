import { initialPeriod, periodRange } from "./period.mjs";

/** Rôles d'évaluateur proposés dans le filtre « Évaluateur (par rôle) ». */
export const EVALUATOR_ROLE_OPTIONS = [
  { value: "cq", label: "CQ" },
  { value: "superviseur", label: "Superviseur" },
  { value: "referent", label: "Référent technique" },
  { value: "management", label: "Management" },
  { value: "formateur", label: "Formateur" },
];

export const initialScopeFilters = (period = initialPeriod()) => ({
  period, contract: [], project: [], cell: [], pilotId: [], evaluatorRole: [],
});

/** Paramètres d'API correspondant aux filtres (listes séparées par des virgules). */
export function scopeParams(f) {
  const out = { ...periodRange(f?.period) };
  for (const k of ["contract", "project", "cell", "pilotId", "evaluatorRole"]) {
    if (Array.isArray(f?.[k]) && f[k].length) out[k] = f[k].join(",");
  }
  return out;
}
