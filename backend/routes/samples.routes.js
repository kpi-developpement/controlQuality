// backend/routes/samples.routes.js — évaluations d'échantillons (contrat Orange, §3.2)
const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const permit = require("../middleware/roles");
const Sample = require("../models/Sample");
const User = require("../models/User");
const Cell = require("../models/Cell");
const Grid = require("../models/Grid");
const { dateRange } = require("../utils/dateRange");
const { normalizeDirection } = require("../utils/evalTypes");
const { getScope, sampleFilterForScope, isPilotInScope, matchesScopeFields, DENY } = require("../utils/scope");
const { getSetting } = require("../utils/settings");
const { logAudit } = require("../utils/audit");

const router = express.Router();
router.use(auth);

const READERS = ["admin", "cq", "formateur", "management", "supervision", "superviseur", "cdp"];
const WRITERS = ["admin", "cq", "formateur", "management", "cdp"];
const isId = (v) => !!v && mongoose.Types.ObjectId.isValid(String(v));
const str = (v, max = 200) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);
const csv = (v) => (v ? String(v).split(",").map((x) => x.trim()).filter(Boolean) : []);
const escapeRx = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Le document (cell/project/contract) est-il dans le périmètre ? (même règle que le filtre Mongo) */
function sampleInScope(scope, s) {
  if (!scope || scope.unrestricted) return true;
  const f = sampleFilterForScope(scope);
  if (!f || f === DENY) return false;
  return matchesScopeFields(scope, s);
}

async function perimeterFor(pilotId, cellName) {
  if (isId(pilotId)) {
    const p = await User.findById(pilotId).select("cell project contract").lean();
    if (p) return { cell: p.cell || "", project: p.project || "", contract: p.contract || "" };
  }
  const name = str(cellName, 120);
  if (name) {
    const c = await Cell.findOne({ name }).select("project contract").lean();
    return { cell: name, project: (c && c.project) || "", contract: (c && c.contract) || "" };
  }
  return { cell: "", project: "", contract: "" };
}

async function validAssignee(id) {
  if (!isId(id)) return false;
  return !!(await User.exists({ _id: id, active: { $ne: false }, role: { $in: ["cq", "management", "formateur", "admin"] } }));
}

const populateSample = (q) =>
  q.populate("pilot", "name cell")
    .populate("assignedTo", "name role")
    .populate("gridId", "name gridType usage")
    .populate("score", "createdAt evaluator closureCode")
    .populate("createdBy", "name");

async function buildQuery(req, { withStatus = true } = {}) {
  const q = {};
  const and = [];
  const scope = await getScope(req);
  const sf = sampleFilterForScope(scope);
  if (sf) and.push(sf);

  if (withStatus) {
    const statuses = csv(req.query.status).filter((s) => Sample.STATUSES.includes(s));
    if (statuses.length) and.push({ status: { $in: statuses } });
    else if (req.query.includeCancelled !== "true") and.push({ status: { $ne: "cancelled" } });
  } else if (req.query.includeCancelled !== "true") {
    and.push({ status: { $ne: "cancelled" } });
  }
  if (req.query.assignedTo === "me") and.push({ assignedTo: new mongoose.Types.ObjectId(String(req.user.id || req.user._id)) });
  else if (req.query.assignedTo === "none") and.push({ assignedTo: null });
  else if (isId(req.query.assignedTo)) and.push({ assignedTo: new mongoose.Types.ObjectId(String(req.query.assignedTo)) });
  if (req.query.batch) and.push({ batch: str(req.query.batch, 120) });
  if (isId(req.query.gridId)) and.push({ gridId: new mongoose.Types.ObjectId(String(req.query.gridId)) });
  const dir = normalizeDirection(req.query.callDirection);
  if (dir) and.push({ callDirection: dir });
  if (req.query.cell) and.push({ cell: str(req.query.cell, 120) });
  if (req.query.contract) and.push({ contract: str(req.query.contract, 120) });
  if (req.query.project) and.push({ project: str(req.query.project, 120) });
  const text = str(req.query.q, 100);
  if (text) {
    const rx = new RegExp(escapeRx(text), "i");
    and.push({ $or: [{ eps: rx }, { phone: rx }, { batch: rx }, { callRef: rx }] });
  }
  const range = dateRange(req.query.dateFrom, req.query.dateTo);
  if (range) and.push({ callDate: range });
  if (and.length) q.$and = and;
  return q;
}

/**
 * GET /api/samples
 * Liste paginée + synthèse par statut (sur l'ensemble filtré, hors filtre de statut).
 */
router.get("/", permit(...READERS), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limit = Math.min(500, Math.max(10, parseInt(req.query.limit || "50", 10) || 50));
    const q = await buildQuery(req);
    const summaryQ = await buildQuery(req, { withStatus: false });

    const [items, total, byStatus, byReason, waitingStatuses] = await Promise.all([
      populateSample(Sample.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      Sample.countDocuments(q),
      Sample.aggregate([{ $match: summaryQ }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
      Sample.aggregate([{ $match: { $and: [summaryQ, { status: "standby" }] } }, { $group: { _id: "$standbyReason", n: { $sum: 1 } } }]),
      getSetting("sampleWaitingStatuses"),
    ]);

    const counts = Object.fromEntries(Sample.STATUSES.map((s) => [s, 0]));
    for (const r of byStatus) if (r._id in counts) counts[r._id] = r.n;
    const totalActive = Sample.STATUSES.filter((s) => s !== "cancelled").reduce((n, s) => n + counts[s], 0);
    const waiting = (waitingStatuses || []).reduce((n, s) => n + (counts[s] || 0), 0);
    res.json({
      page,
      limit,
      total,
      items,
      summary: {
        ...counts,
        total: totalActive,
        waiting,
        waitingStatuses,
        standbyByReason: Object.fromEntries(byReason.map((r) => [r._id || "", r.n])),
        completionRate: totalActive ? Math.round((counts.done / totalActive) * 1000) / 10 : null,
      },
    });
  } catch (err) {
    console.error("GET /samples error:", err);
    res.status(err.status || 500).json({ message: err.status === 400 ? err.message : "Erreur lors du chargement des échantillons." });
  }
});

/** GET /api/samples/batches — noms de lots existants (pour les filtres) */
router.get("/batches", permit(...READERS), async (req, res) => {
  try {
    const sf = sampleFilterForScope(await getScope(req));
    const batches = await Sample.distinct("batch", sf || {});
    res.json(batches.filter(Boolean).sort());
  } catch (err) {
    console.error("GET /samples/batches error:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * POST /api/samples
 * Body : { batch?, gridId?, assignedTo?, dueDate?, items: [{ eps, phone?, callDate?, callDirection?, audioDay?, audioFile?, callRef?, pilotId?, cell? }] }
 * Les appels déjà présents dans un échantillon actif (même EPS) sont ignorés.
 */
router.post("/", permit(...WRITERS), async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ message: "Aucun appel sélectionné." });
    if (items.length > 1000) return res.status(400).json({ message: "1000 appels maximum par ajout." });

    const scope = await getScope(req);
    if (scope.editScope === "none") return res.status(403).json({ message: "Votre profil est en lecture seule." });

    let gridId = null;
    if (body.gridId) {
      if (!isId(body.gridId) || !(await Grid.exists({ _id: body.gridId, isDeleted: { $ne: true } }))) {
        return res.status(400).json({ message: "Grille invalide." });
      }
      gridId = body.gridId;
    }
    let assignedTo = null;
    if (body.assignedTo) {
      if (!(await validAssignee(body.assignedTo))) return res.status(400).json({ message: "Évaluateur invalide." });
      assignedTo = body.assignedTo;
    }
    let dueDate = null;
    if (body.dueDate) {
      const d = new Date(String(body.dueDate));
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: "Échéance invalide." });
      dueDate = d;
    }

    const epsList = items.map((it) => str(it && it.eps, 120)).filter(Boolean);
    const existing = new Set(
      (await Sample.find({ eps: { $in: epsList }, status: { $ne: "cancelled" } }).select("eps").lean()).map((s) => s.eps)
    );

    const docs = [];
    const skipped = [];
    const seen = new Set();
    for (const it of items) {
      const eps = str(it && it.eps, 120);
      if (!eps) { skipped.push({ eps: "", reason: "EPS manquant" }); continue; }
      if (existing.has(eps) || seen.has(eps)) { skipped.push({ eps, reason: "Déjà dans un échantillon" }); continue; }
      const pilotId = isId(it.pilotId) ? it.pilotId : null;
      const perim = await perimeterFor(pilotId, it.cell);
      if (pilotId && !(await isPilotInScope(scope, pilotId))) { skipped.push({ eps, reason: "Agent hors périmètre" }); continue; }
      if (!sampleInScope(scope, perim)) { skipped.push({ eps, reason: "Hors périmètre" }); continue; }
      const callDate = it.callDate ? new Date(String(it.callDate)) : null;
      seen.add(eps);
      docs.push({
        batch: str(body.batch, 120),
        eps,
        phone: str(it.phone, 60),
        callDate: callDate && !Number.isNaN(callDate.getTime()) ? callDate : null,
        callDirection: normalizeDirection(it.callDirection),
        audioDay: /^\d{4}-\d{2}-\d{2}$/.test(String(it.audioDay || "")) ? String(it.audioDay) : "",
        audioFile: str(it.audioFile, 300),
        callRef: str(it.callRef, 500),
        pilot: pilotId,
        gridId,
        assignedTo,
        dueDate,
        ...perim,
        status: assignedTo ? "assigned" : "pending",
        createdBy: req.user.id || req.user._id,
      });
    }

    const created = docs.length ? await Sample.insertMany(docs, { ordered: false }) : [];
    if (created.length) {
      await logAudit(req, { action: "CREATE_SAMPLES", targetType: "sample", targetId: created[0]._id, metadata: { count: created.length, batch: str(body.batch, 120) } });
    }
    res.status(201).json({ created: created.length, skipped });
  } catch (err) {
    console.error("POST /samples error:", err);
    res.status(500).json({ message: "Erreur lors de la création des échantillons." });
  }
});

async function loadForWrite(req, res) {
  if (!isId(req.params.id)) { res.status(400).json({ message: "Identifiant invalide." }); return null; }
  const sample = await Sample.findById(req.params.id);
  if (!sample) { res.status(404).json({ message: "Échantillon introuvable." }); return null; }
  const scope = await getScope(req);
  if (scope.editScope === "none") { res.status(403).json({ message: "Votre profil est en lecture seule." }); return null; }
  if (!sampleInScope(scope, sample)) { res.status(403).json({ message: "Échantillon hors de votre périmètre." }); return null; }
  return sample;
}

/**
 * PATCH /api/samples/:id
 * Champs : assignedTo, gridId, status (pending|assigned|in_progress|standby|cancelled), standbyReason, standbyComment, dueDate, pilotId, batch
 * Le statut « done » n'est posé que par l'enregistrement de l'évaluation.
 */
router.patch("/:id", permit(...WRITERS), async (req, res) => {
  try {
    const sample = await loadForWrite(req, res);
    if (!sample) return;
    const b = req.body || {};
    if (sample.status === "done") return res.status(409).json({ message: "Échantillon finalisé : modification impossible." });

    if (b.assignedTo !== undefined) {
      if (b.assignedTo === null || b.assignedTo === "") {
        sample.assignedTo = null;
        if (sample.status === "assigned") sample.status = "pending";
      } else {
        if (!(await validAssignee(b.assignedTo))) return res.status(400).json({ message: "Évaluateur invalide." });
        sample.assignedTo = b.assignedTo;
        if (sample.status === "pending") sample.status = "assigned";
      }
    }
    if (b.gridId !== undefined) {
      if (b.gridId && !(isId(b.gridId) && (await Grid.exists({ _id: b.gridId, isDeleted: { $ne: true } })))) {
        return res.status(400).json({ message: "Grille invalide." });
      }
      sample.gridId = b.gridId || null;
    }
    if (b.pilotId !== undefined) {
      if (b.pilotId && !isId(b.pilotId)) return res.status(400).json({ message: "Agent invalide." });
      if (b.pilotId && !(await isPilotInScope(await getScope(req), b.pilotId))) return res.status(403).json({ message: "Agent hors périmètre." });
      sample.pilot = b.pilotId || null;
      if (b.pilotId) Object.assign(sample, await perimeterFor(b.pilotId));
    }
    if (b.batch !== undefined) sample.batch = str(b.batch, 120);
    if (b.dueDate !== undefined) {
      const d = b.dueDate ? new Date(String(b.dueDate)) : null;
      if (d && Number.isNaN(d.getTime())) return res.status(400).json({ message: "Échéance invalide." });
      sample.dueDate = d;
    }
    if (b.status !== undefined) {
      const st = String(b.status);
      if (!["pending", "assigned", "in_progress", "standby", "cancelled"].includes(st)) {
        return res.status(400).json({ message: "Statut invalide." });
      }
      if (st === "standby") {
        const reason = String(b.standbyReason || "");
        if (!Sample.STANDBY_REASONS.includes(reason) || !reason) return res.status(400).json({ message: "Motif de standby obligatoire." });
        sample.standbyReason = reason;
        sample.standbyComment = str(b.standbyComment, 1000);
      } else {
        sample.standbyReason = "";
        if (b.standbyComment !== undefined) sample.standbyComment = str(b.standbyComment, 1000);
      }
      if (st === "assigned" && !sample.assignedTo) return res.status(400).json({ message: "Affectez un évaluateur." });
      sample.status = st;
    }
    await sample.save();
    res.json(await populateSample(Sample.findById(sample._id)).lean());
  } catch (err) {
    console.error("PATCH /samples/:id error:", err);
    res.status(500).json({ message: "Erreur lors de la mise à jour." });
  }
});

/** POST /api/samples/:id/start — passe l'échantillon « en cours » et renvoie les données de l'appel */
router.post("/:id/start", permit(...WRITERS), async (req, res) => {
  try {
    const sample = await loadForWrite(req, res);
    if (!sample) return;
    if (["done", "cancelled"].includes(sample.status)) return res.status(409).json({ message: "Échantillon finalisé ou annulé." });
    const me = String(req.user.id || req.user._id);
    if (sample.assignedTo && String(sample.assignedTo) !== me && req.user.role !== "admin") {
      return res.status(403).json({ message: "Échantillon affecté à un autre évaluateur." });
    }
    if (!sample.assignedTo) sample.assignedTo = me;
    sample.status = "in_progress";
    sample.standbyReason = "";
    if (!sample.startedAt) sample.startedAt = new Date();
    await sample.save();
    res.json(await populateSample(Sample.findById(sample._id)).lean());
  } catch (err) {
    console.error("POST /samples/:id/start error:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/** DELETE /api/samples/:id — admin ou créateur, si non finalisé */
router.delete("/:id", permit(...WRITERS), async (req, res) => {
  try {
    const sample = await loadForWrite(req, res);
    if (!sample) return;
    if (sample.status === "done") return res.status(409).json({ message: "Échantillon finalisé : suppression impossible." });
    if (req.user.role !== "admin" && String(sample.createdBy) !== String(req.user.id || req.user._id)) {
      return res.status(403).json({ message: "Seul le créateur ou l'administrateur peut supprimer." });
    }
    await sample.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /samples/:id error:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

module.exports = router;
module.exports._test = { sampleInScope };
