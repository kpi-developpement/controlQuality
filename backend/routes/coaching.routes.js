// backend/routes/coaching.routes.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/auth");
const permit = require("../middleware/roles");

const Coaching = require("../models/Coaching");
const Score = require("../models/Score");
const User = require("../models/User");
const { dateRange } = require("../utils/dateRange");
const { getScope, pilotScopeClause, andClause, userFilterForScope, isPilotInScope } = require("../utils/scope");

const router = express.Router();
router.use(auth);

function isValidObjectId(id) {
  return Boolean(id) && mongoose.Types.ObjectId.isValid(String(id));
}

function parseCsvList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap((x) => String(x).split(",")).map((s) => s.trim()).filter(Boolean);
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

function parseDateRange(from, to) {
  const out = {};
  const f = from ? new Date(String(from)) : null;
  const t = to ? new Date(String(to)) : null;
  if (f && !Number.isNaN(f.getTime())) out.$gte = f;
  if (t && !Number.isNaN(t.getTime())) {
    // include full day
    t.setHours(23, 59, 59, 999);
    out.$lte = t;
  }
  return Object.keys(out).length ? out : null;
}

async function resolveScoreIdsFromFilters(query) {
  const pilotIds = parseCsvList(query.pilotId).filter((x) => mongoose.Types.ObjectId.isValid(x));
  const evaluatorIds = parseCsvList(query.evaluatorId).filter((x) => mongoose.Types.ObjectId.isValid(x));
  const dateRange = parseDateRange(query.dateFrom, query.dateTo);

  const scoreQ = {};
  if (pilotIds.length) scoreQ.pilot = { $in: pilotIds };
  if (evaluatorIds.length) scoreQ.evaluator = { $in: evaluatorIds };
  if (dateRange) scoreQ.createdAt = dateRange;

  if (!Object.keys(scoreQ).length) return null; // no score filters
  const ids = await Score.find(scoreQ).select("_id").lean();
  return ids.map((d) => d._id);
}

// Additive filters: legacy dateFrom/dateTo still concern the linked evaluation.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function applyCoachingFilters(q, query) {
  const range = dateRange(query.coachingDateFrom, query.coachingDateTo);
  if (range) q.createdAt = range;
  const ids = parseCsvList(query.pilotId);
  if (ids.length) q.pilot = { $in: ids.filter(isValidObjectId) };
  const clauses = [];
  if (query.cell) {
    const pilots = await User.find({ cell: String(query.cell) }).select("_id").lean();
    clauses.push({ pilot: { $in: pilots.map((p) => p._id) } });
  }
  const text = String(query.q || "").trim().slice(0, 150);
  if (text) {
    const rx = new RegExp(escapeRegex(text), "i");
    const [pilots, scores] = await Promise.all([
      User.find({ $or: [{ name: rx }, { cell: rx }, { email: rx }] }).select("_id").lean(),
      Score.find({ eps: rx }).select("_id").lean(),
    ]);
    clauses.push({ $or: [{ notes: rx }, { actionPlan: rx }, { pilotComment: rx }, { pilot: { $in: pilots.map((p) => p._id) } }, { score: { $in: scores.map((s) => s._id) } }] });
  }
  const statuses = parseCsvList(query.status).filter((s) => ["open", "in_progress", "done"].includes(s));
  if (statuses.length) q.status = { $in: statuses };
  if (clauses.length) q.$and = clauses;
  return q;
}
async function coachingSummary(q) {
  q = Coaching.find(q).cast(Coaching);
  const rows = await Coaching.aggregate([{ $match: q }, { $group: {
    _id: null, total: { $sum: 1 },
    open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
    inProgress: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
    done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
    ackDone: { $sum: { $cond: ["$pilotAcknowledged", 1, 0] } },
    overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "done"] }, { $ne: ["$followUpDate", null] }, { $lt: ["$followUpDate", new Date(new Date().setHours(0,0,0,0))] }] }, 1, 0] } },
  } }]);
  const row = rows[0] || { total: 0, open: 0, inProgress: 0, done: 0, ackDone: 0, overdue: 0 };
  return { ...row, ackPending: row.total - row.ackDone };
}
router.get("/filter-options", permit("admin", "cq", "management", "formateur", "supervision", "superviseur", "referent", "cdp"), async (req, res) => {
  try {
    // Périmètre : les profils restreints ne voient que les agents de leur périmètre
    const scopeFilter = userFilterForScope(await getScope(req));
    const where = scopeFilter ? { $and: [{ role: "pilote" }, scopeFilter] } : { role: "pilote" };
    const pilots = await User.find(where).select("name cell project contract").sort({ name: 1 }).lean();
    res.json({ pilots });
  } catch { res.status(500).json({ message: "Chargement des filtres impossible." }); }
});

/**
 * POST /api/coaching
 * Create a coaching linked to an evaluation.
 * Roles: cq, management, admin
 */
router.post("/", permit("cq", "management", "admin", "formateur", "superviseur"), async (req, res) => {
  try {
    const { scoreId, notes, actionPlan, status, followUpDate } = req.body || {};
    if (!isValidObjectId(scoreId)) {
      return res.status(400).json({ message: "scoreId invalide" });
    }

    const score = await Score.findById(scoreId).lean();
    if (!score) return res.status(404).json({ message: "Évaluation introuvable" });
    const createScope = await getScope(req);
    if (createScope.editScope === "none") return res.status(403).json({ message: "Votre profil est en lecture seule." });
    if (!(await isPilotInScope(createScope, score.pilot))) {
      return res.status(403).json({ message: "Cet agent ne fait pas partie de votre périmètre." });
    }

    const doc = await Coaching.create({
      score: score._id,
      pilot: score.pilot,
      evaluator: score.evaluator,
      // auth middleware sets req.user = { id, role, name, ... }
      // Some tokens may include _id, so we support both.
      coach: req.user.id || req.user._id,
      notes: typeof notes === "string" ? notes : "",
      actionPlan: typeof actionPlan === "string" ? actionPlan : "",
      status: ["open", "in_progress", "done"].includes(String(status))
        ? String(status)
        : "open",
      followUpDate: followUpDate ? new Date(String(followUpDate)) : null,
    });

    const populated = await Coaching.findById(doc._id)
      .populate({ path: "score", populate: [{ path: "pilot", select: "-passwordHash" }, { path: "evaluator", select: "-passwordHash" }] })
      .populate("pilot", "-passwordHash")
      .populate("coach", "-passwordHash")
      .lean();

    // Notify pilot of new coaching
    try {
      const Notification = require("../models/Notification");
      const coachName = req.user.name || "Coach";
      const pilotUserId = score.pilot;
      const notif = await Notification.create({
        type: "notification",
        title: "Nouveau coaching",
        message: `🎯 ${coachName} vous a créé un coaching suite à l'évaluation ${score.eps || ""}. Consultez-le et validez-le.`,
        targetUsers: [pilotUserId],
        createdBy: req.user.id || req.user._id,
        meta: { coachingId: String(doc._id) },
      });
      const io = req.app.get("io");
      if (io) io.emit("notification:new", notif);
    } catch (_) {}

    res.status(201).json(populated);
  } catch (err) {
    console.error("POST /api/coaching error:", err);
    res.status(500).json({ message: "Erreur serveur lors de la création du coaching" });
  }
});

/**
 * GET /api/coaching/mine
 * Roles: cq, management, admin
 */
router.get("/mine", permit("cq", "management", "admin", "formateur", "superviseur"), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit || "50", 10)));
    const skip = (page - 1) * limit;

    const q = { coach: new mongoose.Types.ObjectId(String(req.user.id || req.user._id)) };
    await applyCoachingFilters(q, req.query);

    // Optional filters (agent / evaluator / date) are applied on the linked evaluation (Score)
    andClause(q, await pilotScopeClause(await getScope(req)));

    const scoreIds = await resolveScoreIdsFromFilters(req.query);
    if (Array.isArray(scoreIds)) {
      // If filters yield no score, return empty quickly
      if (scoreIds.length === 0) return res.json({ page, limit, total: 0, items: [] });
      q.score = { $in: scoreIds };
    }

    const summaryQuery = { ...q };
    delete summaryQuery.status; // Pipeline counts span all statuses within the selected period/agents.
    const [items, total, summary] = await Promise.all([
      Coaching.find(q)
        .populate({ path: "score", populate: [{ path: "pilot", select: "-passwordHash" }, { path: "evaluator", select: "-passwordHash" }] })
        .populate("pilot", "-passwordHash")
        .populate("coach", "-passwordHash")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Coaching.countDocuments(q),
      coachingSummary(summaryQuery),
    ]);

    res.json({ page, limit, total, items, summary });
  } catch (err) {
    console.error("GET /api/coaching/mine error:", err);
    res.status(err.status || 500).json({ message: err.status === 400 ? err.message : "Erreur serveur lors du chargement des coachings" });
  }
});

/**
 * GET /api/coaching
 * Admin : tous les coachings ; Supervision (contrat Orange) : coachings de son périmètre, lecture seule.
 */
router.get("/", permit("admin", "supervision", "superviseur", "referent", "cdp"), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit || "50", 10)));
    const skip = (page - 1) * limit;

    const q = {};
    await applyCoachingFilters(q, req.query);
    andClause(q, await pilotScopeClause(await getScope(req)));

    const scoreIds = await resolveScoreIdsFromFilters(req.query);
    if (Array.isArray(scoreIds)) {
      if (scoreIds.length === 0) return res.json({ page, limit, total: 0, items: [] });
      q.score = { $in: scoreIds };
    }

    const [items, total, summary] = await Promise.all([
      Coaching.find(q)
        .populate({ path: "score", populate: [{ path: "pilot", select: "-passwordHash" }, { path: "evaluator", select: "-passwordHash" }] })
        .populate("pilot", "-passwordHash")
        .populate("coach", "-passwordHash")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Coaching.countDocuments(q),
      coachingSummary(q),
    ]);

    res.json({ page, limit, total, items, summary });
  } catch (err) {
    console.error("GET /api/coaching error:", err);
    res.status(err.status || 500).json({ message: err.status === 400 ? err.message : "Erreur serveur lors du chargement des coachings" });
  }
});

/**
 * PATCH /api/coaching/:id
 * Roles: cq, management, admin
 */
router.patch("/:id", permit("cq", "management", "admin", "formateur", "superviseur"), async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidObjectId(id)) return res.status(400).json({ message: "id invalide" });

    const existing = await Coaching.findById(id).lean();
    if (!existing) return res.status(404).json({ message: "Coaching introuvable" });

    const me = req.user.id || req.user._id;
    if (req.user.role !== "admin" && String(existing.coach) !== String(me)) {
      return res.status(403).json({ message: "Accès interdit" });
    }

    const patch = {};
    if (req.body.notes !== undefined) patch.notes = String(req.body.notes || "");
    if (req.body.actionPlan !== undefined) patch.actionPlan = String(req.body.actionPlan || "");
    if (req.body.status !== undefined) {
      const s = String(req.body.status);
      if (["open", "in_progress", "done"].includes(s)) patch.status = s;
    }
    if (req.body.followUpDate !== undefined) {
      patch.followUpDate = req.body.followUpDate ? new Date(String(req.body.followUpDate)) : null;
    }

    await Coaching.updateOne({ _id: id }, { $set: patch });

    const populated = await Coaching.findById(id)
      .populate({ path: "score", populate: [{ path: "pilot", select: "-passwordHash" }, { path: "evaluator", select: "-passwordHash" }] })
      .populate("pilot", "-passwordHash")
      .populate("coach", "-passwordHash")
      .lean();

    res.json(populated);
  } catch (err) {
    console.error("PATCH /api/coaching/:id error:", err);
    res.status(500).json({ message: "Erreur serveur lors de la mise à jour du coaching" });
  }
});

/**
 * DELETE /api/coaching/:id
 * Admin only
 */
router.delete("/:id", permit("admin"), async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidObjectId(id)) return res.status(400).json({ message: "id invalide" });

    await Coaching.deleteOne({ _id: id });
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/coaching/:id error:", err);
    res.status(500).json({ message: "Erreur serveur lors de la suppression du coaching" });
  }
});

/**
 * GET /api/coaching/my-coachings
 * Pilot: list coachings assigned to me
 */
router.get("/my-coachings", permit("pilote"), async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const items = await Coaching.find({ pilot: userId })
      .populate({ path: "score", populate: [{ path: "pilot", select: "-passwordHash" }, { path: "evaluator", select: "-passwordHash" }] })
      .populate("coach", "name email role")
      .sort({ createdAt: -1 })
      .lean();
    res.json(items);
  } catch (err) {
    console.error("GET /api/coaching/my-coachings error:", err);
    res.status(500).json({ message: "Erreur chargement coachings." });
  }
});

/**
 * POST /api/coaching/:id/acknowledge
 * Pilot acknowledges a coaching and adds a comment
 */
router.post("/:id/acknowledge", permit("pilote"), async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidObjectId(id)) return res.status(400).json({ message: "id invalide" });

    const coaching = await Coaching.findById(id);
    if (!coaching) return res.status(404).json({ message: "Coaching introuvable" });

    const userId = String(req.user.id || req.user._id);
    if (String(coaching.pilot) !== userId) {
      return res.status(403).json({ message: "Ce coaching ne vous est pas assigné." });
    }

    if (coaching.pilotAcknowledged) {
      return res.status(400).json({ message: "Coaching déjà validé." });
    }

    coaching.pilotAcknowledged = true;
    coaching.pilotComment = String(req.body.comment || "").trim();
    coaching.pilotAcknowledgedAt = new Date();
    await coaching.save();

    const populated = await Coaching.findById(id)
      .populate({ path: "score", populate: [{ path: "pilot", select: "-passwordHash" }, { path: "evaluator", select: "-passwordHash" }] })
      .populate("coach", "name email role")
      .lean();

    // Notify the coach
    try {
      const Notification = require("../models/Notification");
      const pilotName = req.user.name || "Agent";
      const notif = await Notification.create({
        type: "notification",
        title: "Coaching validé",
        message: `${pilotName} a validé le coaching et ajouté un commentaire.`,
        targetUsers: [coaching.coach],
        createdBy: req.user.id || req.user._id,
        meta: { coachingId: String(id) },
      });
      const io = req.app.get("io");
      if (io) io.emit("notification:new", notif);
    } catch (e) { /* don't block */ }

    res.json(populated);
  } catch (err) {
    console.error("POST /api/coaching/:id/acknowledge error:", err);
    res.status(500).json({ message: "Erreur validation coaching." });
  }
});

module.exports = router;