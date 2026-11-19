"use strict";
// backend/utils/compliance.js
// Fonctions de notation extraites À L'IDENTIQUE de routes/score.routes.js (aucune
// modification de règle) afin d'être réutilisées par les indicateurs qualité.

/**
 * Nouveau : normalisation du status (Conforme / Non conforme / Non applicable)
 */
function normalizeStatus(raw) {
  const s = (raw || "").toString().trim().toLowerCase();
  if (["c", "conforme", "ok", "oui", "yes", "true", "1"].includes(s)) return "C";
  if (["nc", "non conforme", "non_conforme", "ko", "non", "no", "false", "0"].includes(s)) return "NC";
  if (["na", "n/a", "non applicable", "non_applicable"].includes(s)) return "NA";

// Presence grid (Grille 2)
if (["pc","présent conforme","present conforme","présent / conforme","present / conforme"].includes(s)) return "PC";
if (["pnc","présent non conforme","present non conforme","présent / non conforme","present / non conforme"].includes(s)) return "PNC";
if (["np","non présent","non present","absent"].includes(s)) return "NP";
  return "";
}

function isTrue(v) {
  return v === true || v === 1 || v === "1" || v === "true" || v === "on";
}


/**
 * Nouveau : calcul du taux de conformité (%) basé sur :
 * - status: C / NC / NA
 * - points définis par la grille (pointsConforme / pointsNonConforme)
 * - NA exclu du dénominateur
 *
 * Fallback si pas de grille:
 * - C = 1, NC = 0, NA exclu
 */
function computeCompliancePercent(scoreDoc, gridDoc) {
  const items = Array.isArray(scoreDoc?.items) ? scoreDoc.items : [];
  const gridItems = Array.isArray(gridDoc?.items) ? gridDoc.items : [];


// Grille 2 (présence) : scoring fixe
// Présent/Conforme = 1
// Présent/Non conforme = 0.5
// Non Présent = 0
// NA exclu du calcul
const gridType = (gridDoc?.gridType || "classic").toString();
if (gridType === "presence") {
  // Map phase rules to each item label (based on nearest previous group in grid order)
  const groupByLabel = new Map();
  let currentGroup = null;
  for (const gi of gridItems) {
    if (!gi) continue;
    if (gi.type === "group") {
      currentGroup = {
        hardFail: isTrue(gi.hardFail),
        malusPercent: Number.isFinite(Number(gi.malusPercent)) ? Number(gi.malusPercent) : 0,
      };
      continue;
    }
    const lbl = (gi.label || "").toString().trim();
    if (!lbl) continue;
    groupByLabel.set(lbl, currentGroup);
  }

  let obtained = 0;
  let maxApplicable = 0;
  let totalMalus = 0;

  for (const it of items) {
    const label = (it?.label || "").toString().trim();
    if (!label) continue;

    let status = normalizeStatus(it.status);

    if (!status) {
      // Legacy fallback: derive status from numeric value (old data)
      const v = typeof it.value === "number" ? it.value : Number(it.value) || 0;
      // scale 0..5 or 0..1: treat >=4 as compliant, >=2.5 as partially compliant
      if (v <= 1) status = v >= 0.8 ? "PC" : v >= 0.4 ? "PNC" : "NP";
      else status = v >= 4 ? "PC" : v >= 2.5 ? "PNC" : "NP";
    }
if (status === "NA") continue;

    const group = groupByLabel.get(label) || null;

    const isNonCompliant = status === "PNC" || status === "NP" || status === "NC";

    if (isNonCompliant && group && group.hardFail) {
      return 0;
    }

    if (isNonCompliant) {
      const phaseMalus = group && group.malusPercent > 0 ? group.malusPercent : 0;
      if (phaseMalus > 0) totalMalus += phaseMalus;
    }

    maxApplicable += 1;

    if (status === "PC" || status === "C") obtained += 1;
    else if (status === "PNC") obtained += 0.5;
    else if (status === "NP" || status === "NC") obtained += 0;
    else {
      // legacy numérique
      const v = typeof it.value === "number" ? it.value : Number(it.value) || 0;
      obtained += v >= 4 ? 1 : 0;
    }
  }

  if (maxApplicable <= 0) return 0;
  let base = (obtained / maxApplicable) * 100;
  base = Math.max(0, Math.min(100, base));
  const finalPct = Math.max(0, base - totalMalus);
  return Math.round(finalPct * 10) / 10;
}


  const pointsByLabel = new Map();
  for (const gi of gridItems) {
    if (!gi) continue;
    if (gi.type === "group") continue;
    const label = (gi.label || "").toString().trim();
    if (!label) continue;
    const pC = typeof gi.pointsConforme === "number" ? gi.pointsConforme : 1;
    const pNC = typeof gi.pointsNonConforme === "number" ? gi.pointsNonConforme : 0;
    pointsByLabel.set(label, { pC, pNC });
  }

  // malus par item (si défini). Fallback possible sur le malus de phase.
  const itemMalusByLabel = new Map();
  for (const gi of gridItems) {
    if (!gi || gi.type === "group") continue;
    const label = (gi.label || "").toString().trim();
    if (!label) continue;
    const mp = Number.isFinite(Number(gi.malusPercent)) ? Number(gi.malusPercent) : 0;
    itemMalusByLabel.set(label, mp);
  }


  
  // Map phase rules to each item label (based on nearest previous group in grid order)
  const groupByLabel = new Map();
  let currentGroup = null;
  for (const gi of gridItems) {
    if (!gi) continue;
    if (gi.type === "group") {
      currentGroup = {
        hardFail: isTrue(gi.hardFail),
        malusPercent: Number.isFinite(Number(gi.malusPercent)) ? Number(gi.malusPercent) : 0,
      };
      continue;
    }
    const lbl = (gi.label || "").toString().trim();
    if (!lbl) continue;
    groupByLabel.set(lbl, currentGroup);
  }
let obtained = 0;
  let maxApplicable = 0;
  let totalMalus = 0;

  for (const it of items) {
    const label = (it?.label || "").toString().trim();
    if (!label) continue;

    let status = normalizeStatus(it.status);

    // NA => on ignore complètement
    if (!status) {
      // Legacy fallback: derive status from numeric value (old data)
      const v = typeof it.value === "number" ? it.value : Number(it.value) || 0;
      if (v <= 1) status = v >= 0.8 ? "C" : "NC";
      else status = v >= 4 ? "C" : "NC";
    }
if (status === "NA") continue;

    const group = groupByLabel.get(label) || null;

    // Phase rule #1: hard fail (any NC => 0%)
    if (status === "NC" && group && group.hardFail) {
      return 0;
    }

    // Phase rule #2: malus (priorité item, fallback phase)
    if (status === "NC") {
      const itemMalus = Number(itemMalusByLabel.get(label)) || 0;
      const phaseMalus = group && group.malusPercent > 0 ? group.malusPercent : 0;
      const applied = itemMalus > 0 ? itemMalus : phaseMalus;
      if (applied > 0) totalMalus += applied;
    }


    const pts = pointsByLabel.get(label);
    const pC = pts ? pts.pC : 1;
    const pNC = pts ? pts.pNC : 0;

    maxApplicable += pC;

    if (status === "C") obtained += pC;
    else if (status === "NC") obtained += pNC;
    else {
      // legacy numérique 1..5 → on approxime C si >=4 sinon NC
      const v = typeof it.value === "number" ? it.value : Number(it.value) || 0;
      obtained += v >= 4 ? pC : pNC;
    }
  }

  if (maxApplicable <= 0) return 0;
  let base = (obtained / maxApplicable) * 100;
  // clamp base to avoid >100% when pointsNonConforme > pointsConforme
  base = Math.max(0, Math.min(100, base));
  const finalPct = Math.max(0, base - totalMalus);
  return Math.round(finalPct * 10) / 10; // 1 décimale
}

module.exports = { normalizeStatus, isTrue, computeCompliancePercent };
