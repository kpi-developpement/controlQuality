"use strict";
// backend/utils/evalTypes.js — types d'évaluation (contrat Orange)
const EVALUATION_TYPES = ["standard", "sample", "calibration", "picking", "coaching"];
const TYPE_LABELS = {
  standard: "Évaluation standard",
  sample: "Évaluation d'échantillon",
  calibration: "Calibrage",
  picking: "Picking",
  coaching: "Coaching",
};
// Types comptés dans les indicateurs qualité « production » (le calibrage est un exercice
// d'alignement entre évaluateurs, il ne mesure pas l'agent).
const PRODUCTION_TYPES = ["standard", "sample", "picking", "coaching"];
const DIRECTIONS = ["", "inbound", "outbound"];

function normalizeType(raw, fallback = "standard") {
  const t = String(raw || "").trim().toLowerCase();
  return EVALUATION_TYPES.includes(t) ? t : fallback;
}

function normalizeDirection(raw) {
  const d = String(raw || "").trim().toLowerCase();
  if (["inbound", "entrant"].includes(d)) return "inbound";
  if (["outbound", "sortant"].includes(d)) return "outbound";
  return "";
}

function parseTypes(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  const list = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((x) => String(x).trim().toLowerCase())
    .filter((x) => EVALUATION_TYPES.includes(x));
  return [...new Set(list)];
}

/**
 * Clause Mongo pour filtrer par type. Les documents antérieurs (sans champ) sont « standard ».
 * Retourne null si aucun filtre.
 */
function typeClause(types) {
  const list = parseTypes(types);
  if (!list.length) return null;
  if (list.includes("standard")) {
    return { $or: [{ evaluationType: { $in: list } }, { evaluationType: { $exists: false } }, { evaluationType: null }] };
  }
  return { evaluationType: { $in: list } };
}

function typeOf(score) {
  return normalizeType(score && score.evaluationType);
}

module.exports = { EVALUATION_TYPES, TYPE_LABELS, PRODUCTION_TYPES, DIRECTIONS, normalizeType, normalizeDirection, parseTypes, typeClause, typeOf };
