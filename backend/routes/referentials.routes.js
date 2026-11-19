// backend/routes/referentials.routes.js — référentiels du contrat Orange
// Projets, contrats, codes de clôture, objectifs d'évaluation et paramètres qualité.
const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const permit = require("../middleware/roles");
const Project = require("../models/Project");
const Contract = require("../models/Contract");
const ClosureCode = require("../models/ClosureCode");
const EvaluationTarget = require("../models/EvaluationTarget");
const { getSettings, updateSettings, DEFAULTS } = require("../utils/settings");
const { logAudit } = require("../utils/audit");

const router = express.Router();
router.use(auth);

const READERS = ["admin", "cq", "management", "formateur", "supervision", "superviseur", "referent", "cdp"];
const str = (v, max = 200) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);

router.param("id", (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Identifiant invalide." });
  next();
});

function handleError(res, err, fallback) {
  if (err && err.code === 11000) return res.status(409).json({ message: "Cet élément existe déjà." });
  if (err && err.status) return res.status(err.status).json({ message: err.message });
  if (err && err.name === "ValidationError") return res.status(400).json({ message: "Données invalides." });
  console.error(fallback, err);
  return res.status(500).json({ message: fallback });
}

/** CRUD générique pour un référentiel simple. */
function crud(path, Model, { build, sort }) {
  router.get(`/${path}`, permit(...READERS), async (req, res) => {
    try {
      const q = req.query.active === "true" ? { active: { $ne: false } } : {};
      res.json(await Model.find(q).sort(sort).lean());
    } catch (e) { handleError(res, e, "Chargement impossible."); }
  });
  router.post(`/${path}`, permit("admin"), async (req, res) => {
    try {
      const doc = await Model.create(build(req.body || {}, true));
      res.status(201).json(doc);
    } catch (e) { handleError(res, e, "Création impossible."); }
  });
  router.patch(`/${path}/:id`, permit("admin"), async (req, res) => {
    try {
      const doc = await Model.findByIdAndUpdate(req.params.id, { $set: build(req.body || {}, false) }, { new: true, runValidators: true });
      if (!doc) return res.status(404).json({ message: "Élément introuvable." });
      res.json(doc);
    } catch (e) { handleError(res, e, "Modification impossible."); }
  });
  router.delete(`/${path}/:id`, permit("admin"), async (req, res) => {
    try {
      // Suppression logique : les données historiques gardent la valeur texte
      const doc = await Model.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { new: true });
      if (!doc) return res.status(404).json({ message: "Élément introuvable." });
      res.json({ ok: true, item: doc });
    } catch (e) { handleError(res, e, "Suppression impossible."); }
  });
}

function requireName(v) {
  const name = str(v, 120);
  if (!name) throw Object.assign(new Error("Le nom est obligatoire."), { status: 400 });
  return name;
}

crud("projects", Project, {
  sort: { name: 1 },
  build: (b, isNew) => {
    const o = {};
    if (isNew || b.name !== undefined) o.name = requireName(b.name);
    if (b.description !== undefined) o.description = str(b.description, 500);
    if (b.active !== undefined) o.active = !!b.active;
    return o;
  },
});

crud("contracts", Contract, {
  sort: { name: 1 },
  build: (b, isNew) => {
    const o = {};
    if (isNew || b.name !== undefined) o.name = requireName(b.name);
    if (b.project !== undefined) o.project = str(b.project, 120);
    if (b.description !== undefined) o.description = str(b.description, 500);
    if (b.active !== undefined) o.active = !!b.active;
    return o;
  },
});

crud("closure-codes", ClosureCode, {
  sort: { code: 1 },
  build: (b, isNew) => {
    const o = {};
    if (isNew || b.code !== undefined) {
      o.code = str(b.code, 120);
      if (!o.code) throw Object.assign(new Error("Le code est obligatoire."), { status: 400 });
    }
    if (b.label !== undefined) o.label = str(b.label, 200);
    if (b.contract !== undefined) o.contract = str(b.contract, 120);
    if (b.active !== undefined) o.active = !!b.active;
    return o;
  },
});

/* ---------------- Objectifs d'évaluations (taux de couverture) ---------------- */
router.get("/targets", permit(...READERS), async (req, res) => {
  try {
    const q = {};
    if (/^\d{4}-\d{2}$/.test(String(req.query.month || ""))) q.month = String(req.query.month);
    res.json(await EvaluationTarget.find(q).sort({ month: -1, contract: 1, project: 1, cell: 1 }).limit(2000).lean());
  } catch (e) { handleError(res, e, "Chargement impossible."); }
});

router.put("/targets", permit("admin"), async (req, res) => {
  try {
    const month = str(req.body.month, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: "Mois invalide (AAAA-MM)." });
    const target = Number(req.body.target);
    if (!Number.isFinite(target) || target < 0 || target > 1000000) return res.status(400).json({ message: "Objectif invalide." });
    const key = { month, cell: str(req.body.cell, 120), project: str(req.body.project, 120), contract: str(req.body.contract, 120) };
    const doc = await EvaluationTarget.findOneAndUpdate(key, { $set: { ...key, target, createdBy: req.user.id || req.user._id } }, { upsert: true, new: true, runValidators: true });
    res.json(doc);
  } catch (e) { handleError(res, e, "Enregistrement impossible."); }
});

router.delete("/targets/:id", permit("admin"), async (req, res) => {
  try {
    const r = await EvaluationTarget.findByIdAndDelete(req.params.id);
    if (!r) return res.status(404).json({ message: "Objectif introuvable." });
    res.json({ ok: true });
  } catch (e) { handleError(res, e, "Suppression impossible."); }
});

/* ---------------- Paramètres qualité ---------------- */
router.get("/settings", permit(...READERS, "pilote"), async (req, res) => {
  try {
    const all = await getSettings();
    if (req.user.role === "admin") return res.json({ settings: all, defaults: DEFAULTS });
    // Les autres rôles ne reçoivent que ce qui leur est utile à l'affichage
    res.json({ settings: { pilotEvaluationValidationEnabled: all.pilotEvaluationValidationEnabled, accessScopeEnforced: all.accessScopeEnforced } });
  } catch (e) { handleError(res, e, "Chargement impossible."); }
});

router.put("/settings", permit("admin"), async (req, res) => {
  try {
    const patch = req.body && typeof req.body.settings === "object" ? req.body.settings : {};
    const before = await getSettings();
    const after = await updateSettings(patch, req.user.id || req.user._id);
    const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.length) {
      await logAudit(req, {
        action: "UPDATE_SETTINGS",
        targetType: "setting",
        targetId: new mongoose.Types.ObjectId(String(req.user.id || req.user._id)),
        metadata: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: after[k] }])),
      });
    }
    res.json({ settings: after });
  } catch (e) { handleError(res, e, "Enregistrement impossible."); }
});

module.exports = router;
