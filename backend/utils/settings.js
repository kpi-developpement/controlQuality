"use strict";
// backend/utils/settings.js — paramètres applicatifs (collection appsettings) avec cache court.
const AppSetting = require("../models/AppSetting");

const DEFAULTS = Object.freeze({
  // Contrôle d'accès par périmètre pour les rôles Management (désactivé par défaut :
  // comportement historique conservé tant que l'admin n'a pas complété les profils).
  accessScopeEnforced: false,
  // Bouton « Valider l'évaluation » côté agent
  pilotEvaluationValidationEnabled: true,
  // Taux d'utilisation : dénominateur = active_users | enabled_users | expected_users
  usageDenominator: "enabled_users",
  usageExpectedUsers: 0,
  usageRoles: ["pilote", "cq", "management", "formateur", "supervision"],
  // Taux de réalisation des coachings
  coachingTargetMode: "annual_target", // monthly_average | annual_target | rolling_12
  coachingAnnualTarget: 12,
  coachingTargetPerAgent: true,
  coachingDoneDefinition: "created", // created | status_done | acknowledged
  // Taux de couverture : volume attendu par défaut si aucun objectif mensuel saisi
  evaluationTargetPerAgentPerMonth: 4,
  // Indicateur « échantillons en attente ou standby » : statuts comptés
  sampleWaitingStatuses: ["pending", "assigned", "standby"],
});

const ENUMS = {
  usageDenominator: ["active_users", "enabled_users", "expected_users"],
  coachingTargetMode: ["monthly_average", "annual_target", "rolling_12"],
  coachingDoneDefinition: ["created", "status_done", "acknowledged"],
};
const ROLES = ["admin", "pilote", "cq", "management", "formateur", "supervision"];
const SAMPLE_STATUSES = ["pending", "assigned", "in_progress", "standby"];

let cache = null;
let cacheAt = 0;
const TTL_MS = 15000;

function validateSetting(key, value) {
  if (!(key in DEFAULTS)) throw Object.assign(new Error(`Paramètre inconnu : ${key}`), { status: 400 });
  const def = DEFAULTS[key];
  if (typeof def === "boolean") return value === true || value === "true";
  if (typeof def === "number") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1000000) throw Object.assign(new Error(`Valeur invalide pour ${key}.`), { status: 400 });
    return n;
  }
  if (ENUMS[key]) {
    if (!ENUMS[key].includes(String(value))) throw Object.assign(new Error(`Valeur invalide pour ${key}.`), { status: 400 });
    return String(value);
  }
  if (key === "usageRoles") {
    const arr = Array.isArray(value) ? value.map(String).filter((r) => ROLES.includes(r)) : [];
    if (!arr.length) throw Object.assign(new Error("Sélectionnez au moins un rôle."), { status: 400 });
    return arr;
  }
  if (key === "sampleWaitingStatuses") {
    const arr = Array.isArray(value) ? value.map(String).filter((s) => SAMPLE_STATUSES.includes(s)) : [];
    if (!arr.length) throw Object.assign(new Error("Sélectionnez au moins un statut."), { status: 400 });
    return arr;
  }
  return value;
}

async function getSettings() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  const out = { ...DEFAULTS };
  try {
    const rows = await AppSetting.find({ key: { $in: Object.keys(DEFAULTS) } }).lean();
    for (const r of rows) {
      try { out[r.key] = validateSetting(r.key, r.value); } catch { /* valeur corrompue : défaut */ }
    }
  } catch {
    // base indisponible : valeurs par défaut (comportement historique)
  }
  // Surcharge possible par variable d'environnement (secours exploitation)
  if (process.env.ACCESS_SCOPE_ENFORCED === "true") out.accessScopeEnforced = true;
  if (process.env.ACCESS_SCOPE_ENFORCED === "false") out.accessScopeEnforced = false;
  cache = out;
  cacheAt = Date.now();
  return out;
}

async function getSetting(key) {
  const all = await getSettings();
  return all[key];
}

async function updateSettings(patch, userId) {
  const entries = Object.entries(patch || {});
  const clean = {};
  for (const [k, v] of entries) clean[k] = validateSetting(k, v);
  for (const [k, v] of Object.entries(clean)) {
    await AppSetting.updateOne({ key: k }, { $set: { value: v, updatedBy: userId || null } }, { upsert: true });
  }
  invalidate();
  return getSettings();
}

function invalidate() { cache = null; cacheAt = 0; }

module.exports = { DEFAULTS, getSettings, getSetting, updateSettings, validateSetting, invalidate };
