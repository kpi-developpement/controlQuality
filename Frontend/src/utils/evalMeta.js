// Contrat Orange : libellés et colonnes d'export communs aux écrans d'évaluations.
import api from "../api";

export const EVAL_TYPES = [
  { value: "standard", label: "Évaluation standard" },
  { value: "picking", label: "Picking" },
  { value: "sample", label: "Évaluation d'échantillon" },
  { value: "calibration", label: "Calibrage" },
  { value: "coaching", label: "Coaching" },
];
// Onglet « Évaluations » : calibrages et échantillons ont leurs propres onglets.
export const LIST_DEFAULT_TYPES = ["standard", "picking", "coaching"];
// Statistiques « production » : le calibrage est exclu.
export const PRODUCTION_TYPES_CSV = "standard,picking,coaching,sample";

const TYPE_LABEL = Object.fromEntries(EVAL_TYPES.map((t) => [t.value, t.label]));
export const typeLabel = (t) => TYPE_LABEL[t || "standard"] || "Évaluation standard";
export const typeShort = (t) => ({ standard: "Standard", picking: "Picking", sample: "Échantillon", calibration: "Calibrage", coaching: "Coaching" }[t || "standard"] || "Standard");
export const DIRECTIONS = [
  { value: "", label: "—" },
  { value: "inbound", label: "Entrant" },
  { value: "outbound", label: "Sortant" },
];
export const directionLabel = (d) => (d === "inbound" ? "Entrant" : d === "outbound" ? "Sortant" : "");

export const ROLE_LABELS = { admin: "Admin", cq: "CQ", management: "Management", pilote: "Pilote", formateur: "Formateur", supervision: "Supervision", referent: "Référent technique", superviseur: "Superviseur", cdp: "Chef de projet" };
export const VISIBILITY_SCOPES = [
  { value: "", label: "Par défaut du rôle" },
  { value: "cell", label: "Sa cellule (+ cellules autorisées)" },
  { value: "contract", label: "Son contrat" },
  { value: "project", label: "Son projet" },
  { value: "all", label: "Tout (sans restriction)" },
  { value: "self", label: "Lui-même uniquement" },
  { value: "team", label: "Ses pilotes affectés (référent)" },
  { value: "line", label: "Pilotes de ses référents (superviseur)" },
  { value: "pole", label: "Son pôle (activités affectées)" },
];
export const EDIT_SCOPES = [
  { value: "", label: "Par défaut du rôle" },
  { value: "none", label: "Lecture seule" },
  { value: "own", label: "Ses propres évaluations" },
  { value: "perimeter", label: "Son périmètre" },
];

export function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("fr-FR");
}
export function callMonth(s) {
  const d = new Date(s?.callDate || s?.createdAt || "");
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function scorePercent(s) {
  for (const k of ["compliancePercent", "avgPercent", "total"]) {
    const v = s?.[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  if (typeof s?.avgScore === "number") return s.avgScore * 20;
  return 0;
}
const itemsText = (items) => (Array.isArray(items) ? items.map((it) => `${it.label || ""}:${it.status || ""}`).join(" | ") : "");
const everContested = (s) => !!(s?.contested || s?.contestedAt || s?.reevaluatedAt || String(s?.contestComment || "").trim());

/** Ligne d'export complète (colonnes historiques conservées + colonnes contrat Orange). */
export function evalExportRow(s) {
  const pct = Number(scorePercent(s) || 0);
  return {
    "Date évaluation": fmtDate(s.createdAt),
    "Date appel": fmtDate(s.callDate || s.interactionDate),
    "Mois d'appel": callMonth(s),
    "Date d'écoute": fmtDate(s.listeningDate),
    "Type d'évaluation": typeLabel(s.evaluationType),
    "Code de clôture": s.closureCode || "",
    "Sens d'appel": directionLabel(s.callDirection),
    Agent: s.pilotName || s.pilot?.name || "",
    Email_agent: s.pilotEmail || s.pilot?.email || "",
    Cellule: s.pilotCell || s.pilot?.cell || s.cellAtEvaluation || "",
    Projet: s.pilot?.project || s.projectAtEvaluation || "",
    Contrat: s.pilot?.contract || s.contractAtEvaluation || "",
    EPS: s.eps || "",
    Évaluateur: s.evaluatorName || s.evaluator?.name || "",
    Rôle_évaluateur: s.evaluatorRole || s.evaluator?.role || "",
    Score: `${pct.toFixed(1)}%`,
    "Score (%)": pct.toFixed(1),
    Résultat: pct >= 80 ? "Conforme (≥ 80 %)" : pct >= 50 ? "À améliorer (50-79 %)" : "Non conforme (< 50 %)",
    Commentaire: s.comment || "",
    "Picking prime": s.pickingPrime ? "Oui" : "Non",
    "Mois prime": primeMonthText(s.primeMonth),
    "Durée appel": s.callDuration || "",
    Contestée: s.contested ? "Oui" : "Non",
    "Contestée (historique)": everContested(s) ? "Oui" : "Non",
    "Commentaire contestation": s.contestComment || "",
    "Date contestation": fmtDate(s.contestedAt),
    "Date réévaluation": fmtDate(s.reevaluatedAt),
    "Validée par l'agent": s.pilotValidated ? "Oui" : "Non",
    "Date validation agent": fmtDate(s.pilotValidatedAt),
    "Détail items": itemsText(s.items),
  };
}

/** Grille exportée : une ligne par critère, avec le code de clôture et le type. */
export function evalCriteriaRows(list) {
  const out = [];
  for (const s of list || []) {
    for (const it of Array.isArray(s.items) ? s.items : []) {
      out.push({
        EPS: s.eps || "",
        "Code de clôture": s.closureCode || "",
        "Type d'évaluation": typeLabel(s.evaluationType),
        "Date appel": fmtDate(s.callDate || s.interactionDate),
        Agent: s.pilotName || s.pilot?.name || "",
        Cellule: s.pilotCell || s.pilot?.cell || s.cellAtEvaluation || "",
        Évaluateur: s.evaluatorName || s.evaluator?.name || "",
        Critère: it.label || "",
        Statut: it.status || "",
      });
    }
  }
  return out;
}

/** Feuilles d'export standard : évaluations + grilles détaillées. */
export function evalWorkbook(list) {
  return { "Évaluations": (list || []).map(evalExportRow), "Grilles (critères)": evalCriteriaRows(list) };
}

let closureCache = null;
export async function loadClosureCodes() {
  if (closureCache) return closureCache;
  try {
    const r = await api.get("/referentials/closure-codes", { params: { active: "true" } });
    closureCache = Array.isArray(r.data) ? r.data : [];
  } catch {
    closureCache = [];
  }
  return closureCache;
}
export function resetClosureCodesCache() { closureCache = null; }

export function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}
export function navigate(view, extra = {}) {
  const role = getCurrentUser()?.role;
  if (!role) return;
  window.dispatchEvent(new CustomEvent("kcq:navigate", { detail: { role, view, ...extra } }));
}

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
/** "2026-11" → "Novembre 2026" */
export function primeMonthText(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || ""));
  return m ? `${MOIS[Number(m[2]) - 1]} ${m[1]}` : "";
}
