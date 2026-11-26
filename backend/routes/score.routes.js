// backend/routes/score.routes.js
const express = require("express");
const mongoose = require("mongoose");

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const Score = require("../models/Score");
const User = require("../models/User");
const Grid = require("../models/Grid");
const Notification = require("../models/Notification");
const { logAudit } = require("../utils/audit");

const {
  RECORDINGS_BASE_URL,
  AUDIO_BASE_PATH,
  isHttpMode,
  isMysqlMode,
  httpAuth,
  getMysqlPool,
} = require("../config/recordings");

const auth = require("../middleware/auth");
const permit = require("../middleware/roles");

const { PRIME_MONTH_RE, primeMonthError, callDateError } = require("../utils/evalRules");
const router = express.Router();

// Toutes les routes /scores/* nécessitent une authentification
router.use(auth);
const { dateRange } = require("../utils/dateRange");
const Sample = require("../models/Sample");
const { getSetting } = require("../utils/settings");
const { PRODUCTION_TYPES, normalizeType, normalizeDirection, parseTypes, typeClause } = require("../utils/evalTypes");
const { getScope, pilotScopeClause, andClause, isPilotInScope } = require("../utils/scope");

const escapeRx = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Filtres additifs (contrat Orange). Sans paramètre, la requête est inchangée,
 * sauf la restriction de périmètre (qui ne s'applique qu'aux profils restreints).
 *  - evaluationType=standard,picking  (les évaluations anciennes sans type = standard)
 *  - closureCode=...   (recherche partielle, insensible à la casse)
 *  - callDirection=inbound|outbound
 *  - project=... / contract=...  (périmètre de l'agent)
 *  - validated=yes|no
 */
async function applyOrangeFilters(q, query, req, { defaultTypes = null } = {}) {
  const types = parseTypes(query.evaluationType);
  andClause(q, typeClause(types.length ? types : defaultTypes));
  const code = String(query.closureCode || "").trim().slice(0, 120);
  if (code) andClause(q, { closureCode: new RegExp(escapeRx(code), "i") });
  const dir = normalizeDirection(query.callDirection);
  if (dir) andClause(q, { callDirection: dir });
  const perim = {};
  const csv = (x) => String(x || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (query.project) perim.project = { $in: csv(query.project) };
  if (query.contract) perim.contract = { $in: csv(query.contract) };
  if (Object.keys(perim).length) {
    const ids = await User.distinct("_id", perim);
    andClause(q, { pilot: { $in: ids } });
  }
  // Évaluateur par rôle (CQ, Superviseur, Référent, Management, Formateur…)
  const evalRoles = csv(query.evaluatorRole);
  if (evalRoles.length) {
    const ids = await User.distinct("_id", { role: { $in: evalRoles } });
    andClause(q, { evaluator: { $in: ids } });
  }
  // Mois de prime (AAAA-MM, plusieurs possibles)
  const primes = csv(query.primeMonth).filter((m) => PRIME_MONTH_RE.test(m));
  if (primes.length) andClause(q, { primeMonth: { $in: primes } });
  // Picking prime (oui / non)
  if (query.pickingPrime !== undefined && query.pickingPrime !== "") {
    const pp = String(query.pickingPrime).toLowerCase();
    if (["true", "1", "yes", "on"].includes(pp)) andClause(q, { pickingPrime: true });
    if (["false", "0", "no", "off"].includes(pp)) andClause(q, { pickingPrime: { $ne: true } });
  }
  // Pickings de contrôle process (plusieurs EPS)
  if (["1", "true", "yes"].includes(String(query.multiEps || "").toLowerCase())) andClause(q, { "epsList.0": { $exists: true } });
  const v = String(query.validated || "").toLowerCase();
  if (["yes", "true", "1"].includes(v)) andClause(q, { pilotValidated: true });
  if (["no", "false", "0"].includes(v)) andClause(q, { pilotValidated: { $ne: true } });
  if (req) {
    const scope = await getScope(req);
    andClause(q, await pilotScopeClause(scope));
  }
  return q;
}

/** Règle EPS doublon : le calibrage (plusieurs évaluateurs sur un même appel) est exclu. */
function epsDuplicateQuery(eps, type, evaluatorId, excludeId) {
  const q = { eps };
  if (type === "calibration") {
    q.evaluationType = "calibration";
    q.evaluator = evaluatorId;
  } else {
    q.evaluationType = { $ne: "calibration" };
  }
  if (excludeId) q._id = { $ne: excludeId };
  return q;
}

// New period/cell filters are additive; existing query names keep their behavior.
async function applyPeriodAndCell(q, query) {
  const range = dateRange(query.dateFrom, query.dateTo);
  if (range) { delete q.$or; q.createdAt = range; }
  if (query.cell) {
    const cells = String(query.cell).split(",").map((s) => s.trim()).filter(Boolean);
    const ids = await User.distinct("_id", { cell: { $in: cells } });
    q.$and = [...(q.$and || []), { pilot: { $in: ids } }];
  }
}

// Picking de contrôle process : liste d'EPS dédoublonnée (5 minimum)
const MIN_PICKING_EPS = 5;
function processEpsList(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || "").split(/[\n,;]+/);
  return [...new Set(arr.map((x) => String(x || "").trim().slice(0, 120)).filter(Boolean))].slice(0, 100);
}

// Coaching obligatoire sous ce seuil (liste des besoins : évaluations < 70 %)
const COACHING_REQUIRED_BELOW = 70;
/** Ajoute l'état du coaching lié à chaque évaluation (tag « en cours » / « finalisé » / « requis »). */
async function attachCoachingInfo(rows) {
  const Coaching = require("../models/Coaching");
  const ids = rows.map((s) => s._id).filter(Boolean);
  const list = ids.length ? await Coaching.find({ score: { $in: ids } }).select("score status pilotAcknowledged createdAt").sort({ createdAt: -1 }).lean() : [];
  const byScore = new Map();
  for (const c of list) if (!byScore.has(String(c.score))) byScore.set(String(c.score), c);
  return rows.map((s) => {
    const c = byScore.get(String(s._id));
    const pct = Number(s.compliancePercent);
    const eligible = (s.evaluationType || "standard") !== "calibration";
    return {
      ...s,
      coaching: c ? { _id: c._id, status: c.status, done: c.status === "done", pilotAcknowledged: !!c.pilotAcknowledged } : null,
      coachingRequired: eligible && Number.isFinite(pct) && pct < COACHING_REQUIRED_BELOW,
    };
  });
}


/**
 * Utilitaire : calcul du score moyen d'une évaluation (moyenne /5)
 */
function computeAverageScore(scoreDoc) {
  if (
    !scoreDoc.items ||
    !Array.isArray(scoreDoc.items) ||
    scoreDoc.items.length === 0
  ) {
    return 0;
  }
  const sum = scoreDoc.items.reduce((acc, it) => {
    const v =
      typeof it.value === "number" ? it.value : Number(it.value) || 0;
    return acc + v;
  }, 0);
  return sum / scoreDoc.items.length;
}

/**
 * Utilitaire : calcul du total (/45 si 9 items)
 */
function computeTotalScore(scoreDoc) {
  if (
    !scoreDoc.items ||
    !Array.isArray(scoreDoc.items) ||
    scoreDoc.items.length === 0
  ) {
    return 0;
  }
  return scoreDoc.items.reduce((acc, it) => {
    const v =
      typeof it.value === "number" ? it.value : Number(it.value) || 0;
    return acc + v;
  }, 0);
}


const { normalizeStatus, isTrue, computeCompliancePercent } = require("../utils/compliance");


/* =========================================================================
 *  EPS: DÉTECTION DE DOUBLON (CQ / MANAGEMENT)
 * ========================================================================= */

/**
 * GET /scores/check-eps?eps=XXX&excludeId=...
 * Retour: { duplicate: boolean, existing?: { id, createdAt, listeningDate, pilotName, evaluatorName } }
 */
router.get(
  "/check-eps",
  permit("cq", "management", "admin", "formateur", "superviseur", "referent"),
  async (req, res) => {
    try {
      const eps = (req.query.eps || "").toString().trim();
      const excludeId = (req.query.excludeId || "").toString().trim();

      if (!eps) return res.json({ duplicate: false });

      const checkType = normalizeType(req.query.evaluationType);
      const q = epsDuplicateQuery(
        eps,
        checkType,
        req.user.id || req.user._id,
        excludeId && mongoose.Types.ObjectId.isValid(excludeId) ? excludeId : null
      );

      const existing = await Score.findOne(q)
        .populate("pilot", "name email")
        .populate("evaluator", "name email role")
        .sort({ createdAt: -1 })
        .lean();

      if (!existing) return res.json({ duplicate: false });

      return res.json({
        duplicate: true,
        existing: {
          id: existing._id,
          createdAt: existing.createdAt,
          listeningDate: existing.listeningDate || existing.interactionDate || existing.callDate || null,
          pilotName: existing.pilot?.name || "",
          evaluatorName: existing.evaluator?.name || "",
        },
      });
    } catch (err) {
      console.error("GET /scores/check-eps error:", err);
      return res.status(500).json({ message: "Erreur serveur lors de la vérification EPS." });
    }
  }
);

/* =========================================================================
 *  CRÉATION D'UNE ÉVALUATION (CQ / MANAGEMENT)
 * ========================================================================= */

/**
 * POST /scores
 * Body :
 * {
 *   pilotId,        // <== envoyé par le front (CQ / Management)
 *   (ou pilot),
 *   listeningDate,
 *   callDate,
 *   interactionDate,
 *   eps,
 *   callDuration,
 *   comment,
 *   gridId,
 *   items: [{ label, value }]
 * }
 */
router.post(
  "/",
  permit("cq", "management", "formateur", "superviseur", "referent"),
  async (req, res) => {
    try {
      const evaluatorId = req.user.id || req.user._id;

      const {
        pilot, // compatibilité éventuelle ancienne version
        pilotId, // ce que le front envoie actuellement
        listeningDate,
        callDate,
        interactionDate,
        eps,
        pickingPrime,
        callDuration,
        comment,
        gridId,
        items,
        evaluationType,
        closureCode,
        callDirection,
        sampleId,
        primeMonth,
        epsList,
      } = req.body;

      const finalPilotId = pilotId || pilot;

      if (!finalPilotId || !mongoose.Types.ObjectId.isValid(finalPilotId)) {
        return res.status(400).json({ message: "Pilote invalide." });
      }

      // ---- Contrat Orange : type, code de clôture, sens d'appel, échantillon ----
      let evalType = normalizeType(evaluationType);
      let sampleDoc = null;
      if (sampleId !== undefined && sampleId !== null && sampleId !== "") {
        if (!mongoose.Types.ObjectId.isValid(String(sampleId))) {
          return res.status(400).json({ message: "Échantillon invalide." });
        }
        sampleDoc = await Sample.findById(sampleId);
        if (!sampleDoc) return res.status(404).json({ message: "Échantillon introuvable." });
        if (["done", "cancelled"].includes(sampleDoc.status)) {
          return res.status(409).json({ message: "Cet échantillon est déjà finalisé ou annulé." });
        }
        evalType = "sample";
      } else if (evalType === "sample") {
        return res.status(400).json({ message: "Une évaluation d'échantillon doit être lancée depuis l'onglet Échantillons." });
      }
      const closure = String(closureCode || "").trim().slice(0, 120);
      const direction = normalizeDirection(callDirection);

      // Picking de contrôle process : plusieurs EPS (minimum 5), sans prime
      let processEps = null;
      if (epsList !== undefined && epsList !== null) {
        const list = processEpsList(epsList);
        if (list.length < MIN_PICKING_EPS) {
          return res.status(400).json({ message: `Un picking doit comporter au moins ${MIN_PICKING_EPS} EPS différents.`, code: "PICKING_EPS" });
        }
        processEps = list;
        evalType = "picking";
      }

      // Mois de prime obligatoire (sauf calibrage et picking process) ; date d'appel obligatoire et différente du jour J
      const prime = processEps ? "" : String(primeMonth || "").trim();
      const primeErr = processEps ? "" : primeMonthError(prime, evalType);
      if (primeErr) return res.status(400).json({ message: primeErr, code: "PRIME_MONTH" });
      const callErr = callDateError(callDate, evalType);
      if (callErr) return res.status(400).json({ message: callErr, code: "CALL_DATE" });
      const callDay = new Date(callDate);

      const scope = await getScope(req);
      if (!(await isPilotInScope(scope, finalPilotId))) {
        return res.status(403).json({ message: "Cet agent ne fait pas partie de votre périmètre." });
      }
      if (scope.editScope === "none") {
        return res.status(403).json({ message: "Votre profil est en lecture seule." });
      }

            // Nettoyage items : on ignore les lignes vides et on accepte status=C/NC/NA
      const cleanedItems = Array.isArray(items)
        ? items
            .map((it) => ({
              label: (it?.label || "").toString().trim(),
              status: normalizeStatus(it?.status),
              value: it?.value,
            }))
            .filter((it) => it.label.length > 0)
        : [];

      if (cleanedItems.length === 0) {
        return res
          .status(400)
          .json({ message: "Aucun item d'évaluation fourni." });
      }


// 🔔 EPS doublon (même comportement CQ ; le calibrage autorise plusieurs évaluateurs)
const epsClean = processEps ? processEps.join(", ") : (eps || "").toString().trim();
if (epsClean && !processEps) {
  const existing = await Score.findOne(epsDuplicateQuery(epsClean, evalType, evaluatorId)).lean();
  if (existing) {
    return res.status(409).json({
      message: "EPS doublon : une évaluation existe déjà avec cet EPS.",
      code: "EPS_DUPLICATE",
      duplicate: true,
      existingId: existing._id,
    });
  }
}

      // Charger la grille (pour les points par item)
      const grid =
        gridId && mongoose.Types.ObjectId.isValid(gridId)
          ? await Grid.findById(gridId).lean()
          : null;

      
const gridTypeForSave = (grid?.gridType || "classic").toString();
const pilotForSnapshot = await User.findById(finalPilotId).select("cell project contract").lean();

      // Map points par label
      const gridPointsByLabel = new Map();
      if (grid && Array.isArray(grid.items)) {
        for (const gi of grid.items) {
          if (!gi) continue;
          if (gi.type === "group") continue;
          const lbl = (gi.label || "").toString().trim();
          if (!lbl) continue;
          const pC = typeof gi.pointsConforme === "number" ? gi.pointsConforme : 1;
          const pNC = typeof gi.pointsNonConforme === "number" ? gi.pointsNonConforme : 0;
          gridPointsByLabel.set(lbl, { pC, pNC });
        }
      }

const score = await Score.create({
        pilot: finalPilotId,
        evaluator: evaluatorId,
        gridId:
          gridId && mongoose.Types.ObjectId.isValid(gridId) ? gridId : null,

        listeningDate: listeningDate ? new Date(listeningDate) : null,
        callDate: callDay,
        // Date de l'évaluation = toujours la date du jour (fixée par le serveur)
        interactionDate: new Date(),
        evaluationDate: new Date(),
        primeMonth: evalType === "calibration" ? "" : prime,

        eps: epsClean || "",
        ...(processEps ? { epsList: processEps } : {}),
        pickingPrime: processEps ? false : isTrue(pickingPrime),
        callDuration: callDuration || "",
        comment: comment || "",

        evaluationType: evalType,
        closureCode: closure,
        callDirection: direction,
        sample: sampleDoc ? sampleDoc._id : null,
        cellAtEvaluation: pilotForSnapshot?.cell || "",
        projectAtEvaluation: pilotForSnapshot?.project || "",
        contractAtEvaluation: pilotForSnapshot?.contract || "",

        items: cleanedItems.map((it) => {
          const pts = gridPointsByLabel.get(it.label);
          const pC = pts ? pts.pC : 1;
          const pNC = pts ? pts.pNC : 0;


// Award points according to status.
// - classic: use grid points (C/NC/NA)
// - presence: PC=1, PNC=0.5, NP=0, NA excluded
let awarded = 0;
if (gridTypeForSave === "presence") {
  if (it.status === "PC" || it.status === "C") awarded = 1;
  else if (it.status === "PNC") awarded = 0.5;
  else if (it.status === "NP" || it.status === "NC") awarded = 0;
  else if (it.status === "NA") awarded = 0;
  else {
    const v = typeof it.value === "number" ? it.value : Number(it.value) || 0;
    awarded = v >= 4 ? 1 : 0;
  }
} else {
  if (it.status === "C") awarded = pC;
  else if (it.status === "NC") awarded = pNC;
  else if (it.status === "NA") awarded = 0;
  else {
    // legacy numérique
    const v = typeof it.value === "number" ? it.value : Number(it.value) || 0;
    awarded = v >= 4 ? pC : pNC;
  }
}

          return {
            label: it.label,
            status: it.status,
            value: Number(awarded) || 0, // on garde 'value' pour compat (points obtenus)
          };
        }),
      });

      // Échantillon : lien vers l'évaluation et passage au statut finalisé
      if (sampleDoc) {
        try {
          sampleDoc.status = "done";
          sampleDoc.score = score._id;
          sampleDoc.doneAt = new Date();
          if (!sampleDoc.startedAt) sampleDoc.startedAt = new Date();
          if (!sampleDoc.pilot) sampleDoc.pilot = finalPilotId;
          await sampleDoc.save();
        } catch (e) {
          console.error("POST /scores sample link error:", e?.message || e);
        }
      }

      const populated = await Score.findById(score._id)
        .populate("pilot", "-passwordHash")
        .populate("evaluator", "-passwordHash")
        .lean();

      if (populated) {
        populated.compliancePercent = computeCompliancePercent(populated, grid);
      }

      // 🔔 Realtime push for CQ/Management dashboards & lists
      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("scores:changed", { action: "created", id: String(score._id) });
          const cell = populated?.pilot?.cell ? String(populated.pilot.cell).trim() : "";
          if (cell) io.to(`cell:${cell}`).emit("scores:changed", { action: "created", id: String(score._id) });
          const evId = populated?.evaluator?._id ? String(populated.evaluator._id) : evaluatorId;
          if (evId) io.to(`user:${evId}`).emit("scores:changed", { action: "created", id: String(score._id) });
        }

        // Notify pilot of new evaluation (calibrage compris : l'agent peut le valider)
        try {
          const Notification = require("../models/Notification");
          const pilotUserId = populated?.pilot?._id || pilotId;
          const evaluatorName = req.user.name || "Évaluateur";
          const isCal = evalType === "calibration";
          const notif = await Notification.create({
            type: "notification",
            title: isCal ? "Nouveau calibrage" : "Nouvelle évaluation",
            message: `📋 ${evaluatorName} a réalisé ${isCal ? "un calibrage" : "une évaluation"} sur l'appel ${populated?.eps || ""}. Score : ${Math.round(populated?.compliancePercent || populated?.total || 0)}%.`,
            targetUsers: [pilotUserId],
            createdBy: req.user.id || req.user._id,
            meta: { scoreId: String(score._id) },
          });
          if (io) io.emit("notification:new", notif);
        } catch (_) {}

        // Évaluation sous 70 % : coaching obligatoire par l'évaluateur
        try {
          const pct = Number(populated?.compliancePercent);
          if (evalType !== "calibration" && Number.isFinite(pct) && pct < COACHING_REQUIRED_BELOW) {
            const Notification = require("../models/Notification");
            const notif = await Notification.create({
              type: "notification",
              title: "Coaching obligatoire",
              message: `⚠️ L'évaluation de ${populated?.pilot?.name || "l'agent"} (${populated?.eps || "sans EPS"}) est à ${Math.round(pct)} % : un coaching doit être réalisé.`,
              targetUsers: [evaluatorId],
              createdBy: evaluatorId,
              meta: { scoreId: String(score._id), coachingRequired: true },
            });
            if (io) io.emit("notification:new", notif);
          }
        } catch (_) {}
      } catch (_) {
        // ignore realtime failures
      }

      if (populated) populated.coachingRequired = evalType !== "calibration" && Number(populated.compliancePercent) < COACHING_REQUIRED_BELOW;
      res.status(201).json(populated);
    } catch (err) {
      console.error("POST /scores error:", err);
      res.status(500).json({
        message: "Erreur serveur lors de la création de l'évaluation.",
      });
    }
  }
);

// -------------------- Helpers for large lists --------------------
function parseCsvList(v) {
  if (v === undefined || v === null) return [];
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseDateRange(from, to) {
  const out = {};
  const f = from ? new Date(String(from)) : null;
  const t = to ? new Date(String(to)) : null;
  if (f && !Number.isNaN(f.getTime())) out.$gte = f;
  if (t && !Number.isNaN(t.getTime())) {
    t.setHours(23, 59, 59, 999);
    out.$lte = t;
  }
  return Object.keys(out).length ? out : null;
}

function startOfMonth(year, month1to12) {
  const y = Number(year);
  const m = Number(month1to12);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
}

function endOfMonth(year, month1to12) {
  const y = Number(year);
  const m = Number(month1to12);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  // last ms of month
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
}

/* =========================================================================
 *  META: LISTE DES ÉVALUATEURS (pour alimenter les filtres multi-select)
 *  NOTE: important car /scores est filtré côté serveur (perf), donc la liste
 *  des évaluateurs ne doit pas dépendre des résultats déjà filtrés.
 * ========================================================================= */

router.get(
  "/evaluators",
  permit("admin", "management", "manager", "cq", "formateur", "supervision", "superviseur", "referent", "cdp"),
  async (req, res) => {
    try {
      // CQ / Formateur : la liste d'évaluateurs est triviale (lui-même)
      if (["cq", "formateur"].includes(req.user.role)) {
        return res.json([
          {
            id: String(req.user.id || req.user._id),
            name: req.user.name || "",
            email: req.user.email || "",
          },
        ]);
      }

      const q = {};

      // Optional filters to scope the evaluator list (year/month + pilot)
      const pilotIds = parseCsvList(req.query.pilotId);
      const validPilotIds = pilotIds.filter((x) => mongoose.Types.ObjectId.isValid(x));
      if (validPilotIds.length) q.pilot = { $in: validPilotIds };

      const years = parseCsvList(req.query.year);
      const months = parseCsvList(req.query.month);
      if (years.length && months.length) {
        const ranges = [];
        for (const y of years) {
          for (const m of months) {
            const s = startOfMonth(y, m);
            const e = endOfMonth(y, m);
            if (s && e) ranges.push({ createdAt: { $gte: s, $lte: e } });
          }
        }
        if (ranges.length) q.$or = ranges;
      }

      // Périmètre (profils restreints) — ObjectId explicites pour l'agrégation
      const scopeClause = await pilotScopeClause(await getScope(req));
      if (scopeClause) q.$and = [...(q.$and || []), scopeClause];
      if (q.pilot && q.pilot.$in) q.pilot.$in = q.pilot.$in.map((x) => new mongoose.Types.ObjectId(String(x)));

      const rows = await Score.aggregate([
        { $match: q },
        { $group: { _id: "$evaluator", count: { $sum: 1 } } },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "u",
          },
        },
        { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            id: { $toString: "$_id" },
            name: "$u.name",
            email: "$u.email",
            count: 1,
          },
        },
        { $sort: { name: 1 } },
      ]);

      res.json((rows || []).filter((r) => r.id && r.name));
    } catch (err) {
      console.error("GET /scores/evaluators error:", err);
      res.status(500).json({ message: "Erreur serveur." });
    }
  }
);

/* =========================================================================
 *  LECTURE : MES ÉVALUATIONS (CQ / MANAGEMENT)
 * ========================================================================= */

/**
 * GET /scores/mine
 * Renvoie toutes les évaluations réalisées par l'utilisateur connecté
 * (CQ ou Management).
 */


/**
 * GET /scores/stats
 * KPI agrégés (léger) pour dashboards, avec filtres.
 * Query:
 * - year=YYYY (optionnel) ; month=MM (optionnel)
 * - pilotId=... (csv)
 * - evaluatorId=... (csv)
 * - dateFrom=YYYY-MM-DD ; dateTo=YYYY-MM-DD (optionnel)
 *
 * Retour:
 * { total, avgScore, avgPercent, contestedCount, contestedRate }
 */
router.get(
  "/stats",
  permit("admin", "management", "cq", "formateur", "supervision", "superviseur", "referent", "cdp"),
  async (req, res) => {
    try {
      const match = {};
      // Scope role CQ / Formateur -> evaluator = current user
      if (["cq", "formateur"].includes(req.user?.role)) {
        const uid = req.user.id || req.user._id;
        if (!uid || !mongoose.Types.ObjectId.isValid(String(uid))) {
          return res.status(401).json({ message: "Utilisateur non authentifié." });
        }
        match.evaluator = new mongoose.Types.ObjectId(String(uid));
      }

      const { year, month, pilotId, evaluatorId, dateFrom, dateTo } = req.query || {};

      // year/month => createdAt range
      if (year) {
        const y = parseInt(year, 10);
        if (!Number.isNaN(y)) {
          const m = month ? parseInt(month, 10) : null;
          const start = new Date(y, m ? m - 1 : 0, 1);
          const end = m ? new Date(y, m, 1) : new Date(y + 1, 0, 1);
          match.createdAt = { $gte: start, $lt: end };
        }
      }

      // explicit date range overrides/extends createdAt match
      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(dateTo) : null;
        const range = {};
        if (from && !isNaN(from.getTime())) range.$gte = from;
        if (to && !isNaN(to.getTime())) {
          // include end day
          const t2 = new Date(to);
          t2.setDate(t2.getDate() + 1);
          range.$lt = t2;
        }
        if (Object.keys(range).length) match.createdAt = range;
      }

      if (pilotId) {
        const ids = String(pilotId)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));
        if (ids.length) match.pilot = { $in: ids };
      }

      // For admin/management only; CQ already scoped
      if (evaluatorId && !["cq", "formateur"].includes(req.user?.role)) {
        const ids = String(evaluatorId)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));
        if (ids.length) match.evaluator = { $in: ids };
      }

      // Contrat Orange : périmètre + filtres additifs ; le calibrage est exclu des KPI
      // par défaut (aucune évaluation existante n'est de ce type : chiffres inchangés).
      if (req.query.cell) {
        const cellIds = await User.distinct("_id", { cell: String(req.query.cell) });
        andClause(match, { pilot: { $in: cellIds } });
      }
      await applyOrangeFilters(match, req.query, req, { defaultTypes: PRODUCTION_TYPES });

      // Compute percent with the same rules as evaluation scoring
      // (classic grids + presence + hardFail + malus).
      const scores = await Score.find(match).lean()
        .select("items gridId contested")
        .lean();

      const gridIds = Array.from(
        new Set(
          (scores || [])
            .map((s) => (s.gridId ? String(s.gridId) : ""))
            .filter(Boolean)
        )
      );

      const grids = gridIds.length
        ? await Grid.find({ _id: { $in: gridIds } }).lean()
        : [];
      const gridById = new Map((grids || []).map((g) => [String(g._id), g]));

      let total = 0;
      let sumPercent = 0;
      let contestedCount = 0;

      for (const s of scores || []) {
        total += 1;
        if (s.contested) contestedCount += 1;
        const g = s.gridId ? gridById.get(String(s.gridId)) : null;
        const pct = computeCompliancePercent(s, g);
        sumPercent += Number(pct) || 0;
      }

      const avgPercent = total > 0 ? sumPercent / total : 0;
      const contestedRate = total > 0 ? (contestedCount / total) * 100 : 0;

      // avgScore kept for legacy screens (0..5 scale)
      const avgScore = avgPercent / 20;

      res.json({
        total,
        avgScore,
        avgPercent: Math.round(avgPercent * 10) / 10,
        contestedCount,
        contestedRate: Math.round(contestedRate * 10) / 10,
      });
    } catch (err) {
      console.error("GET /scores/stats error:", err);
      res.status(500).json({ message: "Erreur serveur lors du calcul des statistiques." });
    }
  }
);

router.get(
  "/mine",
  permit("cq", "management", "formateur", "superviseur", "referent"),
  async (req, res) => {
    try {
      const evaluatorId = req.user.id || req.user._id;

      // Pagination + filtering for performance (thousands of evaluations)
      const page = Math.max(1, parseInt(req.query.page || "1", 10));
      const limit = Math.min(500, Math.max(10, parseInt(req.query.limit || "50", 10)));
      const skip = (page - 1) * limit;

      const q = { evaluator: evaluatorId };

      // Le profil CQ voit les évaluations réalisées par tous les CQ
      // ainsi que celles réalisées par le Management.
      if (["cq", "formateur"].includes(req.user?.role)) {
        const visibleEvaluatorIds = await User.distinct("_id", {
          role: { $in: ["cq", "formateur", "management", "superviseur", "referent"] },
        });

        q.evaluator = { $in: visibleEvaluatorIds };
      }

      // Filter by pilot (supports multi: pilotId=a,b,c)
      const pilotIds = parseCsvList(req.query.pilotId);
      const validPilotIds = pilotIds.filter((x) => mongoose.Types.ObjectId.isValid(x));
      if (validPilotIds.length) q.pilot = { $in: validPilotIds };

      // Filter by createdAt month/year (supports multi)
      const years = parseCsvList(req.query.year);
      const months = parseCsvList(req.query.month);
      if (years.length && months.length) {
        // If multiple, build OR ranges
        const ranges = [];
        for (const y of years) {
          for (const m of months) {
            const s = startOfMonth(y, m);
            const e = endOfMonth(y, m);
            if (s && e) ranges.push({ createdAt: { $gte: s, $lte: e } });
          }
        }
        if (ranges.length) q.$or = ranges;
      }

      // Direct date range override (YYYY-MM-DD)
      if (req.query.startDate || req.query.endDate) {
        const sd = req.query.startDate ? new Date(String(req.query.startDate)) : null;
        const ed = req.query.endDate ? new Date(String(req.query.endDate)) : null;
        if (sd && !isNaN(sd.getTime())) q.createdAt = { ...(q.createdAt || {}), $gte: sd };
        if (ed && !isNaN(ed.getTime())) q.createdAt = { ...(q.createdAt || {}), $lte: ed };
      }

      // Contested filter (yes/no)
      const contested = parseCsvList(req.query.contested);
      if (contested.length) {
        const wantYes = contested.includes("yes") || contested.includes("true") || contested.includes("1");
        const wantNo = contested.includes("no") || contested.includes("false") || contested.includes("0");
        if (wantYes && !wantNo) q.contested = true;
        else if (!wantYes && wantNo) q.contested = false;
      }

      await applyPeriodAndCell(q, req.query);
      await applyOrangeFilters(q, req.query, req);
      const [scores, total] = await Promise.all([
        Score.find(q)
          .populate("pilot", "-passwordHash")
          .populate("evaluator", "-passwordHash")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Score.countDocuments(q),
      ]);


      // Load grids once to apply phase rules (hardFail/malus) correctly
      const gridIds = [
        ...new Set(
          (scores || [])
            .map((s) => (s && s.gridId ? String(s.gridId) : ""))
            .filter(Boolean)
        ),
      ];
      const grids = gridIds.length
        ? await Grid.find({ _id: { $in: gridIds } }).lean()
        : [];
      const gridsById = new Map((grids || []).map((g) => [String(g._id), g]));


      const mapped = scores.map((s) => ({
        ...s,
        pilotName: s.pilot?.name || "",
        pilotEmail: s.pilot?.email || "",
        pilotCell: s.pilot?.cell || "",
        pilotId: s.pilot?._id || s.pilot,
        evaluatorName: s.evaluator?.name || "",
        evaluatorRole: s.evaluator?.role || "",
        avgScore: computeAverageScore(s),
        compliancePercent: computeCompliancePercent(s, gridsById.get(String(s.gridId)) || null),
      }));

      res.json({ page, limit, total, items: await attachCoachingInfo(mapped) });
    } catch (err) {
      console.error("GET /scores/mine error:", err);
      res.status(err.status || 500).json({
        message: err.status === 400 ? err.message : "Erreur serveur lors du chargement de vos évaluations.",
      });
    }
  }
);

/* =========================================================================
 *  LECTURE : ÉVALUATIONS DU PILOTE CONNECTÉ (PILOTE)
 * ========================================================================= */

/**
 * GET /scores/me
 * Vue utilisée par le PilotDashboard :
 * - rôle : pilote
 * - renvoie { average, count, scores[] }
 *   où "total" = somme des items (/45 si 9 items)
 */
router.get(
  "/me",
  permit("pilote"),
  async (req, res) => {
    try {
      const pilotId = req.user.id || req.user._id;

      // Calibrages : présentés à l'agent uniquement sur demande (onglet « Mes évaluations »), pour qu'il
      // puisse les valider (taux de validation des calibrages). Ils restent hors moyenne et hors compteur.
      const withCalibrations = ["1", "true", "yes"].includes(String(req.query.includeCalibrations || "").toLowerCase());
      const scores = await Score.find(withCalibrations ? { pilot: pilotId } : { pilot: pilotId, evaluationType: { $ne: "calibration" } })
        .populate("evaluator", "-passwordHash")
        .sort({ createdAt: -1 })
        .lean();

      // Load grids for compliance calculation
      const gridIds = [...new Set(scores.map((s) => s.gridId).filter(Boolean).map(String))];
      const grids = gridIds.length ? await Grid.find({ _id: { $in: gridIds } }).lean() : [];
      const gridById = new Map(grids.map((g) => [String(g._id), g]));

      const mapped = scores.map((s) => {
        const grid = s.gridId ? gridById.get(String(s.gridId)) : null;
        const total = computeCompliancePercent(s, grid);

        let cq = null;
        if (s.evaluator && s.evaluator.role === "cq") {
          cq = {
            name: s.evaluator.name || "",
            email: s.evaluator.email || "",
          };
        }

        return {
          _id: s._id,
          items: s.items || [],
          total,
          eps: s.eps || "",
          callDuration: s.callDuration || "",
          comment: s.comment || "",
          contested: !!s.contested,
          contestComment: s.contestComment || "",
          contestStatus: s.contestStatus || "",
          arbitrationComment: s.arbitrationComment || "",
          arbitratedAt: s.arbitratedAt || null,
          cq,

          // Informations génériques de l'évaluateur :
          // fonctionne pour CQ et Management.
          evaluator: s.evaluator
            ? {
                _id: s.evaluator._id || null,
                name: s.evaluator.name || "",
                email: s.evaluator.email || "",
                role: s.evaluator.role || "",
              }
            : null,

          evaluatorName: s.evaluator?.name || "",
          evaluatorRole: s.evaluator?.role || "",

          // Picking prime visible dans la vision pilote.
          pickingPrime: !!s.pickingPrime,

          listeningDate: s.listeningDate || null,
          interactionDate: s.interactionDate || null,
          callDate: s.callDate || null,
          createdAt: s.createdAt || null,

          // Contrat Orange (lecture seule pour l'agent)
          evaluationType: s.evaluationType || "standard",
          closureCode: s.closureCode || "",
          callDirection: s.callDirection || "",
          primeMonth: s.primeMonth || "",
          pilotValidated: !!s.pilotValidated,
          pilotValidatedAt: s.pilotValidatedAt || null,
          pilotValidationComment: s.pilotValidationComment || "",
        };
      });

      const production = mapped.filter((s) => s.evaluationType !== "calibration");
      const count = production.length;
      const average =
        count > 0
          ? production.reduce(
              (acc, s) => acc + Number(s.total || 0),
              0
            ) / count
          : 0;

      const validationEnabled = await getSetting("pilotEvaluationValidationEnabled");
      res.json({
        average,
        count,
        scores: mapped,
        validationEnabled: !!validationEnabled,
      });
    } catch (err) {
      console.error("GET /scores/me error:", err);
      res.status(500).json({
        message: "Erreur serveur lors du chargement de vos évaluations.",
      });
    }
  }
);

/* =========================================================================
 *  LECTURE : TOUTES LES ÉVALUATIONS (ADMIN / MANAGEMENT)
 * ========================================================================= */

/**
 * GET /scores
 * Vue globale (ADMIN + MANAGEMENT) si tu veux un écran "toutes les écoutes".
 */
router.get(
  "/",
  permit("admin", "management", "formateur", "supervision", "superviseur", "referent", "cdp"),
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page || "1", 10));
      const limit = Math.min(500, Math.max(10, parseInt(req.query.limit || "50", 10)));
      const skip = (page - 1) * limit;

      const q = {};

      // multi filters
      const pilotIds = parseCsvList(req.query.pilotId);
      const validPilotIds = pilotIds.filter((x) => mongoose.Types.ObjectId.isValid(x));
      if (validPilotIds.length) q.pilot = { $in: validPilotIds };

      const evaluatorIds = parseCsvList(req.query.evaluatorId);
      const validEvaluatorIds = evaluatorIds.filter((x) => mongoose.Types.ObjectId.isValid(x));
      if (validEvaluatorIds.length) q.evaluator = { $in: validEvaluatorIds };

      const years = parseCsvList(req.query.year);
      const months = parseCsvList(req.query.month);
      if (years.length && months.length) {
        const ranges = [];
        for (const y of years) {
          for (const m of months) {
            const s = startOfMonth(y, m);
            const e = endOfMonth(y, m);
            if (s && e) ranges.push({ createdAt: { $gte: s, $lte: e } });
          }
        }
        if (ranges.length) q.$or = ranges;
      }

      if (req.query.startDate || req.query.endDate) {
        const sd = req.query.startDate ? new Date(String(req.query.startDate)) : null;
        const ed = req.query.endDate ? new Date(String(req.query.endDate)) : null;
        if (sd && !isNaN(sd.getTime())) q.createdAt = { ...(q.createdAt || {}), $gte: sd };
        if (ed && !isNaN(ed.getTime())) q.createdAt = { ...(q.createdAt || {}), $lte: ed };
      }

      const eps = (req.query.eps || "").toString().trim();
      if (eps) q.eps = eps;

      if (req.query.pickingPrime !== undefined) {
        const v = String(req.query.pickingPrime).toLowerCase();
        if (["true", "1", "yes", "on"].includes(v)) q.pickingPrime = true;
        if (["false", "0", "no", "off"].includes(v)) q.pickingPrime = false;
      }

      // Contested filter
      if (req.query.contested !== undefined) {
        const v = String(req.query.contested).toLowerCase();
        if (["true", "1", "yes", "on"].includes(v)) q.contested = true;
        if (["false", "0", "no", "off"].includes(v)) q.contested = false;
      }

      await applyPeriodAndCell(q, req.query);
      await applyOrangeFilters(q, req.query, req);
      const [scores, total] = await Promise.all([
        Score.find(q)
          .populate("pilot", "-passwordHash")
          .populate("evaluator", "-passwordHash")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Score.countDocuments(q),
      ]);


      // Load grids once to apply phase rules (hardFail/malus) correctly
      const gridIds = [
        ...new Set(
          (scores || [])
            .map((s) => (s && s.gridId ? String(s.gridId) : ""))
            .filter(Boolean)
        ),
      ];
      const grids = gridIds.length
        ? await Grid.find({ _id: { $in: gridIds } }).lean()
        : [];
      const gridsById = new Map((grids || []).map((g) => [String(g._id), g]));


      const mapped = scores.map((s) => ({
        ...s,
        pilotName: s.pilot?.name || "",
        pilotEmail: s.pilot?.email || "",
        pilotCell: s.pilot?.cell || "",
        evaluatorName: s.evaluator?.name || "",
        evaluatorRole: s.evaluator?.role || "",
        avgScore: computeAverageScore(s),
        compliancePercent: computeCompliancePercent(s, gridsById.get(String(s.gridId)) || null),
      }));

      res.json({ page, limit, total, items: await attachCoachingInfo(mapped) });
    } catch (err) {
      console.error("GET /scores error:", err);
      res.status(err.status || 500).json({
        message: err.status === 400 ? err.message : "Erreur serveur lors du chargement des évaluations.",
      });
    }
  }
);

/* =========================================================================
 *  LECTURE : DÉTAIL D’UNE ÉVALUATION
 * ========================================================================= */

/**
 * GET /scores/:id
 */
/* =========================================================================
 *  LISTE DES ÉVALUATIONS CONTESTÉES EN ATTENTE DE RÉÉVALUATION (CQ)
 * ========================================================================= */

/**
 * GET /scores/contested
 * Retourne les évaluations avec contested=true.
 * Visible uniquement par le rôle CQ (et admin).
 */
router.get(
  "/contested",
  permit("cq", "admin", "formateur", "management"),
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page || "1", 10));
      const limit = Math.min(500, Math.max(10, parseInt(req.query.limit || "50", 10)));
      const skip = (page - 1) * limit;

      // ?status=pending (défaut) | accepted | rejected | all
      const st = String(req.query.status || "").toLowerCase();
      const q = st === "all" ? { contestStatus: { $in: ["pending", "accepted", "rejected"] } }
        : st === "accepted" ? { contestStatus: "accepted" }
        : st === "rejected" ? { contestStatus: "rejected" }
        : { contested: true, contestStatus: { $ne: "accepted" } };
      const pilotIds = parseCsvList(req.query.pilotId);
      const validPilotIds = pilotIds.filter((x) => mongoose.Types.ObjectId.isValid(x));
      if (validPilotIds.length) q.pilot = { $in: validPilotIds };
      andClause(q, await pilotScopeClause(await getScope(req)));

      const [scores, total] = await Promise.all([
        Score.find(q)
          .populate("pilot", "-passwordHash")
          .populate("evaluator", "-passwordHash")
          .populate("contestedBy", "name role")
          .populate("arbitratedBy", "name role")
          .sort({ contestedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Score.countDocuments(q),
      ]);

      // Load grids once to apply phase rules (hardFail/malus) correctly
      const gridIds = [
        ...new Set(
          (scores || [])
            .map((s) => (s && s.gridId ? String(s.gridId) : ""))
            .filter(Boolean)
        ),
      ];
      const grids = gridIds.length
        ? await Grid.find({ _id: { $in: gridIds } }).lean()
        : [];
      const gridsById = new Map((grids || []).map((g) => [String(g._id), g]));

      const mapped = scores.map((s) => ({
        ...s,
        pilotName: s.pilot?.name || "",
        pilotEmail: s.pilot?.email || "",
        pilotCell: s.pilot?.cell || "",
        evaluatorName: s.evaluator?.name || "",
        evaluatorRole: s.evaluator?.role || "",
        avgScore: computeAverageScore(s),
        compliancePercent: computeCompliancePercent(
          s,
          gridsById.get(String(s.gridId)) || null
        ),
      }));

      return res.json({ page, limit, total, items: mapped });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        message:
          "Erreur serveur lors du chargement des évaluations contestées.",
      });
    }
  }
);

/* =========================================================================
 *  PICKING CALLS: liste des appels à évaluer
 *
 *  2 modes (voir backend/config/recordings.js) :
 *   - HTTP  : interroge la nouvelle app d'enregistrement (RECORDINGS_BASE_URL,
 *             par défaut http://enreg.kyntus.fr:8085) — mode par défaut.
 *   - LOCAL : lit /app/audio_mails (montage NAS historique) — fallback.
 *
 *  Endpoints HTTP supposés sur la nouvelle app (à ajuster selon son API réelle) :
 *    GET {BASE}/api/picking-calls?year=YYYY&month=MM&limit=N
 *      -> { items: [{ eps, phone, audioDay, audioFile, callDate, ... }, ...] }
 *    GET {BASE}/api/picking-audio/{day}/{file}  -> stream audio
 *
 *  Si l'application expose d'autres chemins (ex. /list.php?day=...), modifier
 *  les fonctions httpPickingCalls / httpPickingAudio ci-dessous.
 * ========================================================================= */
function parseAudioFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const allowed = [".mp3", ".wav", ".m4a", ".ogg", ".flac"];
  if (!allowed.includes(ext)) return null;

  const base = path.basename(filename, ext);
  const parts = base.split("_");

  if (parts.length < 3) return null;

  const eps = parts[0] || "";
  const phone = parts[1] || "";
  const rawDate = parts[2] || ""; // ex: 2026-03-11-11-06-50

  let isoCallDate = null;
  const m = rawDate.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
  if (m) {
    isoCallDate = `${m[1]}T${m[2]}:${m[3]}:${m[4]}`;
  }

  return {
    eps,
    cell: eps,
    phone,
    callDate: isoCallDate,
  };
}

// ---- LOCAL mode helpers ----
function listAudioCallsLocal(rootDir, limit = 5000, year = null, month = null) {
  if (!rootDir || !fs.existsSync(rootDir)) return [];

  const allDateDirs = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a));

  let dateDirs = allDateDirs;

  if (year && month) {
    const ym = `${String(year)}-${String(month).padStart(2, "0")}`;
    dateDirs = allDateDirs.filter((d) => d.startsWith(ym + "-"));
  }

  const out = [];
  const audioExts = [".mp3", ".wav", ".m4a", ".ogg", ".flac"];

  for (const day of dateDirs) {
    const dayPath = path.join(rootDir, day);
    const files = fs
      .readdirSync(dayPath, { withFileTypes: true })
      .filter((f) => f.isFile() && audioExts.includes(path.extname(f.name).toLowerCase()))
      .map((f) => f.name)
      .sort((a, b) => b.localeCompare(a));

    for (const file of files) {
      const parsed = parseAudioFilename(file);
      if (!parsed) continue;

      out.push({
        _id: `${day}/${file}`,
        eps: parsed.eps,
        pilotId: "",
        pilotName: "",
        callDate: parsed.callDate || `${day}T00:00:00`,
        callDuration: "",
        audioFile: file,
        audioDay: day,
        cell: parsed.cell,
        phone: parsed.phone,
        comment: "",
      });

      if (out.length >= limit) return out;
    }
  }

  return out;
}


// ---- MYSQL mode helper ----
async function mysqlPickingCalls({ year, month, limit }) {
  const safeLimit = Math.min(
    20000,
    Math.max(100, Number.parseInt(limit, 10) || 5000)
  );

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  const startDate =
    `${String(year).padStart(4, "0")}-` +
    `${String(month).padStart(2, "0")}-01 00:00:00`;

  const endDate =
    `${String(nextYear).padStart(4, "0")}-` +
    `${String(nextMonth).padStart(2, "0")}-01 00:00:00`;

  const sql = `
    SELECT
      tag,
      numero2,
      direction,
      call_dt,
      filename,
      filepath,
      filesize
    FROM audio_index
    WHERE call_dt >= ?
      AND call_dt < ?
    ORDER BY call_dt DESC
    LIMIT ${safeLimit}
  `;

  const [rows] = await getMysqlPool().execute(
    sql,
    [startDate, endDate]
  );

  return rows
    .map((row) => {
      const normalizedPath = String(
        row.filepath || ""
      ).replace(/\\/g, "/");

      const pathParts = normalizedPath
        .split("/")
        .filter(Boolean);

      const rawCallDate = row.call_dt
        ? String(row.call_dt)
        : "";

      const callDate = rawCallDate
        ? rawCallDate.replace(" ", "T")
        : "";

      const dateFromPath =
        pathParts.find((part) =>
          /^\d{4}-\d{2}-\d{2}$/.test(part)
        ) || "";

      const audioDay =
        dateFromPath ||
        (callDate ? callDate.slice(0, 10) : "");

      const audioFile = path.basename(
        String(
          row.filename ||
          pathParts[pathParts.length - 1] ||
          ""
        )
      );

      const directionRaw = String(
        row.direction || ""
      ).toLowerCase();

      const filesize = Number(row.filesize || 0);

      let direction = "Inconnu";
      let directionClass = "unknown";

      // Convention de la base :
      // in  = appel affiché comme Sortant
      // out = appel affiché comme Entrant
      if (directionRaw === "in") {
        direction = "Sortant";
        directionClass = "outbound";
      } else if (directionRaw === "out") {
        direction = "Entrant";
        directionClass = "inbound";

        if (filesize > 0 && filesize < 15360) {
          direction = "Manqué";
          directionClass = "missed";
        }
      }

      const tag = String(row.tag || "");
      const phone = String(row.numero2 || "");

      return {
        _id:
          normalizedPath ||
          `${audioDay}/${audioFile}`,

        eps: tag,
        cell: tag,
        phone,

        pilotId: "",
        pilotName: "",

        callDate,
        callDuration: "",

        audioFile,
        audioDay,

        direction,
        directionClass,
        directionRaw,

        filesize,
        filepath: normalizedPath,

        comment: "",
        source: "mysql",
      };
    })
    .filter((call) => call.audioDay && call.audioFile);
}

// ---- HTTP mode helpers ----
async function httpPickingCalls({ year, month, limit }) {
  const url = `${RECORDINGS_BASE_URL}/api/picking-calls`;
  const r = await axios.get(url, {
    params: { year, month, limit },
    auth: httpAuth(),
    timeout: 30000,
  });
  // accepte { items: [...] } OU directement [...]
  const items = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.items) ? r.data.items : [];
  return items.map((it) => {
    // garantit la présence des champs essentiels
    const audioFile = it.audioFile || it.file || it.filename || "";
    const audioDay = it.audioDay || it.day || it.date || "";
    const parsed = parseAudioFilename(audioFile) || {};
    return {
      _id: it._id || `${audioDay}/${audioFile}`,
      eps: it.eps ?? parsed.eps ?? "",
      pilotId: it.pilotId || "",
      pilotName: it.pilotName || "",
      callDate: it.callDate || parsed.callDate || (audioDay ? `${audioDay}T00:00:00` : ""),
      callDuration: it.callDuration || "",
      audioFile,
      audioDay,
      cell: it.cell ?? parsed.cell ?? "",
      phone: it.phone ?? parsed.phone ?? "",
      comment: it.comment || "",
    };
  });
}

async function httpPickingAudio(day, file, req, res) {
  const url = `${RECORDINGS_BASE_URL}/api/picking-audio/${encodeURIComponent(day)}/${encodeURIComponent(file)}`;
  const upstream = await axios.get(url, {
    auth: httpAuth(),
    responseType: "stream",
    timeout: 0,
    headers: req.headers.range ? { Range: req.headers.range } : {},
    validateStatus: () => true,
  });
  res.status(upstream.status);
  const pass = ["content-type", "content-length", "accept-ranges", "content-range"];
  for (const h of pass) {
    if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
  }
  upstream.data.pipe(res);
}

router.get(
  "/picking-calls",
  permit("cq", "management", "formateur", "superviseur", "referent"),
  async (req, res) => {
    try {
      const now = new Date();
      const year = parseInt(req.query.year || now.getFullYear(), 10);
      const month = parseInt(req.query.month || (now.getMonth() + 1), 10);
      const limit = Math.min(20000, Math.max(100, parseInt(req.query.limit || "5000", 10)));

      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ message: "Paramètres year/month invalides." });
      }

      let baseCalls = [];

      if (isMysqlMode()) {
        baseCalls = await mysqlPickingCalls({
          year,
          month,
          limit,
        });
      } else if (isHttpMode()) {
        baseCalls = await httpPickingCalls({
          year,
          month,
          limit,
        });
      } else {
        baseCalls = listAudioCallsLocal(
          AUDIO_BASE_PATH,
          limit,
          year,
          month
        );
      }

      const calls = baseCalls.map((call) => {
        // L'URL de stream pointe TOUJOURS sur notre backend
        // (qui relaie soit vers la nouvelle app, soit vers le NAS).
        const audioUrl =
          `${req.protocol}://${req.get("host")}/api/scores/picking-audio/` +
          `${encodeURIComponent(call.audioDay)}/${encodeURIComponent(call.audioFile)}`;
        return { ...call, audioUrl };
      });

      return res.json({
        year,
        month,
        count: calls.length,
        items: calls,
        source: isMysqlMode()
          ? "mysql"
          : isHttpMode()
            ? "http"
            : "local",
      });
    } catch (err) {
      console.error("GET /scores/picking-calls error:", err?.message || err);
      return res.status(500).json({
        message: "Erreur serveur lors du chargement des appels.",
        hint: isMysqlMode()
          ? "Vérifie la connexion MySQL et la table audio_index."
          : isHttpMode()
            ? `Vérifie ${RECORDINGS_BASE_URL}/api/picking-calls (et son schéma de réponse).`
            : `Vérifie le montage ${AUDIO_BASE_PATH}.`,
      });
    }
  }
);

router.get(
  "/picking-audio/:day/:file",
  permit("cq", "management", "formateur", "superviseur", "referent"),
  async (req, res) => {
    try {
      const day = path.basename(req.params.day || "");
      const file = path.basename(req.params.file || "");

      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return res.status(400).json({ message: "Date invalide." });
      }

      if (isHttpMode()) {
        return await httpPickingAudio(day, file, req, res);
      }

      const fullPath = path.join(AUDIO_BASE_PATH, day, file);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ message: "Fichier audio introuvable." });
      }
      return res.sendFile(fullPath);
    } catch (err) {
      console.error("GET /scores/picking-audio error:", err?.message || err);
      if (!res.headersSent) {
        return res.status(500).json({ message: "Erreur serveur." });
      }
    }
  }
);

router.get(
  "/:id",
  permit("admin", "management", "cq", "pilote", "formateur", "supervision", "superviseur", "referent", "cdp"),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID invalide." });
      }

      const score = await Score.findById(id)
        .populate("pilot", "-passwordHash")
        .populate("evaluator", "-passwordHash")
        .populate("gridId")
        .lean();

      if (!score) {
        return res.status(404).json({ message: "Évaluation introuvable." });
      }

      // Contrôle d'accès : l'agent ne lit que ses évaluations ; périmètre pour les profils restreints
      const pilotRef = score.pilot?._id || score.pilot;
      if (req.user.role === "pilote" && String(pilotRef) !== String(req.user.id || req.user._id)) {
        return res.status(403).json({ message: "Accès interdit." });
      }
      if (req.user.role !== "pilote" && !(await isPilotInScope(await getScope(req), pilotRef))) {
        return res.status(403).json({ message: "Évaluation hors de votre périmètre." });
      }

      res.json(score);
    } catch (err) {
      console.error("GET /scores/:id error:", err);
      res.status(500).json({
        message: "Erreur serveur lors du chargement de l'évaluation.",
      });
    }
  }
);

/* =========================================================================
 *  MISE À JOUR D'UNE ÉVALUATION (CQ / MANAGEMENT / ADMIN)
 * ========================================================================= */

/**
 * PATCH /scores/:id
 * - CQ / Management peuvent modifier leurs propres évaluations
 * - Admin peut modifier n'importe quelle évaluation
 */
router.patch(
  "/:id",
  permit("cq", "management", "admin", "formateur", "superviseur", "referent"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID invalide." });
      }

      const score = await Score.findById(id);
      if (!score) {
        return res
          .status(404)
          .json({ message: "Évaluation introuvable." });
      }

      const isAdmin = req.user.role === "admin";
      const isCq = ["cq", "formateur"].includes(req.user.role);
      const evaluatorId = String(score.evaluator);
      const currentId = String(req.user.id || req.user._id);

      // CQ peut réévaluer une écoute contestée même si ce n'est pas lui l'évaluateur
      const allowCqReeval = isCq && (score.contested === true || score.contestStatus === "accepted");

      if (!isAdmin && !allowCqReeval && evaluatorId !== currentId) {
        return res.status(403).json({
          message: "Vous ne pouvez modifier que vos propres évaluations.",
        });
      }

      // Contrat Orange : périmètre et profil lecture seule (sans effet pour admin / profils non restreints)
      if (!isAdmin) {
        const editScopeCtx = await getScope(req);
        if (editScopeCtx.editScope === "none") {
          return res.status(403).json({ message: "Votre profil est en lecture seule." });
        }
        if (!(await isPilotInScope(editScopeCtx, score.pilot))) {
          return res.status(403).json({ message: "Évaluation hors de votre périmètre." });
        }
        const newPilot = req.body?.pilotId || req.body?.pilot;
        if (newPilot && String(newPilot) !== String(score.pilot) && !(await isPilotInScope(editScopeCtx, newPilot))) {
          return res.status(403).json({ message: "Cet agent ne fait pas partie de votre périmètre." });
        }
      }

      // Restrict edits to current cycle (15 → 14 du mois suivant) based on evaluation creation date
      if (!isAdmin && !allowCqReeval) {
        const baseDate = score.createdAt || new Date();
        const d = new Date(baseDate);
        const now = new Date();

        // Le cycle courant démarre le 15 du mois courant si on est >= 15,
        // sinon le 15 du mois précédent.
        const cycleStart = (ref) => {
          const x = new Date(ref);
          if (x.getDate() >= 15) {
            return new Date(x.getFullYear(), x.getMonth(), 15, 0, 0, 0, 0);
          }
          return new Date(x.getFullYear(), x.getMonth() - 1, 15, 0, 0, 0, 0);
        };

        const startNow = cycleStart(now);
        const endNow = new Date(startNow.getFullYear(), startNow.getMonth() + 1, 15, 0, 0, 0, 0); // 15 du mois suivant, exclusif

        if (d < startNow || d >= endNow) {
          return res.status(403).json({
            message: "Modification autorisée uniquement sur le cycle en cours (du 15 au 14 du mois suivant).",
            code: "EDIT_CYCLE_LOCK",
          });
        }
      }

      const {
        pilot,
        pilotId,
        listeningDate,
        callDate,
        interactionDate,
        eps,
        pickingPrime,
        callDuration,
        comment,
        items,
        contested,
        contestComment,
        closureCode,
        callDirection,
        primeMonth,
        epsList,
      } = req.body;

      const finalPilot = pilotId || pilot;
      if (finalPilot && mongoose.Types.ObjectId.isValid(finalPilot)) {
        score.pilot = finalPilot;
      }

      if (listeningDate !== undefined) {
        score.listeningDate = listeningDate
          ? new Date(listeningDate)
          : null;
      }
      if (callDate !== undefined) {
        // Date d'appel modifiée : mêmes règles qu'à la création (obligatoire, différente du jour J)
        const { callDayKey } = require("../utils/evalRules");
        if (callDayKey(callDate) !== callDayKey(score.callDate)) {
          const callErr = callDateError(callDate, normalizeType(score.evaluationType));
          if (callErr) return res.status(400).json({ message: callErr, code: "CALL_DATE" });
        }
        score.callDate = callDate ? new Date(callDate) : null;
      }
      if (interactionDate !== undefined) {
        score.interactionDate = interactionDate
          ? new Date(interactionDate)
          : null;
      }


if (closureCode !== undefined) score.closureCode = String(closureCode || "").trim().slice(0, 120);
if (callDirection !== undefined) score.callDirection = normalizeDirection(callDirection);
if (primeMonth !== undefined) {
  const pm = String(primeMonth || "").trim();
  if (pm && !PRIME_MONTH_RE.test(pm)) return res.status(400).json({ message: "Mois de prime invalide (format AAAA-MM)." });
  score.primeMonth = pm;
}

const isProcessPicking = Array.isArray(score.epsList) && score.epsList.length > 0;
if (isProcessPicking && epsList !== undefined) {
  const list = processEpsList(epsList);
  if (list.length < MIN_PICKING_EPS) return res.status(400).json({ message: `Un picking doit comporter au moins ${MIN_PICKING_EPS} EPS différents.`, code: "PICKING_EPS" });
  score.epsList = list;
  score.eps = list.join(", ");
} else if (eps !== undefined && !isProcessPicking) {
  const epsClean = (eps || "").toString().trim();
  if (epsClean) {
    const existing = await Score.findOne(epsDuplicateQuery(epsClean, normalizeType(score.evaluationType), score.evaluator, id)).lean();
    if (existing) {
      return res.status(409).json({
        message: "EPS doublon : une évaluation existe déjà avec cet EPS.",
        code: "EPS_DUPLICATE",
        duplicate: true,
        existingId: existing._id,
      });
    }
  }
  score.eps = epsClean;
}

      if (callDuration !== undefined) score.callDuration = callDuration;
      if (comment !== undefined) score.comment = comment;

      if (pickingPrime !== undefined) {
        score.pickingPrime = isTrue(pickingPrime);
      }


if (Array.isArray(items)) {
  score.items = items.map((it) => ({
    label: (it?.label || "").toString(),
    status: normalizeStatus(it?.status),
    value:
      typeof it.value === "number"
        ? it.value
        : Number(it.value) || 0,
  }));
}

      if (contested !== undefined) {
        score.contested = !!contested;
      }
      if (contestComment !== undefined) {
        score.contestComment = contestComment || "";
      }

      
// Si un CQ réévalue une écoute contestée, on "résout" la contestation.
if (["cq", "formateur"].includes(req.user.role) && score.contested === true) {
  // CQ / Formateur réévalue une écoute contestée => contestation acceptée et clôturée
  score.contested = false;
  score.contestStatus = "accepted";
  score.arbitratedBy = currentId;
  score.arbitratedAt = new Date();
  score.reevaluatedAt = new Date();
  // La note change : l'agent devra valider la nouvelle version
  score.pilotValidated = false;
  score.pilotValidatedAt = null;
  const _rePilot = await User.findById(score.pilot).select("name").lean(); await logAudit(req, { action: "REEVALUATE", targetType: "score", targetId: score._id, metadata: { eps: score.eps || "", pilotName: _rePilot?.name || "", previousEvaluatorId: String(score.evaluator) } });
  // on conserve le commentaire de contestation pour l’historique
  score.evaluator = currentId;
}

await score.save();

if (["cq", "formateur"].includes(req.user.role)) {
  { const _aP = await User.findById(score.pilot).select("name").lean(); await logAudit(req, { action: "UPDATE_EVALUATION", targetType: "score", targetId: score._id, metadata: { by: "cq", eps: score.eps || "", pilotName: _aP?.name || "" } }); }
} else if (["management", "superviseur", "referent"].includes(req.user.role)) {
  { const _aP2 = await User.findById(score.pilot).select("name").lean(); await logAudit(req, { action: "UPDATE_EVALUATION", targetType: "score", targetId: score._id, metadata: { by: "management", eps: score.eps || "", pilotName: _aP2?.name || "" } }); }
}


      const populated = await Score.findById(score._id)
        .populate("pilot", "-passwordHash")
        .populate("evaluator", "-passwordHash")
        .lean();

      // 🔔 Realtime push
      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("scores:changed", { action: "updated", id: String(score._id) });
          const cell = populated?.pilot?.cell ? String(populated.pilot.cell).trim() : "";
          if (cell) io.to(`cell:${cell}`).emit("scores:changed", { action: "updated", id: String(score._id) });
          const evId = populated?.evaluator?._id ? String(populated.evaluator._id) : null;
          if (evId) io.to(`user:${evId}`).emit("scores:changed", { action: "updated", id: String(score._id) });
        }
      } catch (_) {}

      res.json(populated);
    } catch (err) {
      console.error("PATCH /scores/:id error:", err);
      res.status(500).json({
        message: "Erreur serveur lors de la mise à jour de l'évaluation.",
      });
    }
  }
);

/* =========================================================================
 *  CONTESTATION D'UNE ÉVALUATION PAR LE PILOTE
 * ========================================================================= */

/**
 * POST /scores/:id/contest
 * Body : { contestComment }
 */
router.post(
  "/:id/contest",
  permit("management", "superviseur", "referent"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { contestComment } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID invalide." });
      }

      const score = await Score.findById(id);
      if (!score) {
        return res
          .status(404)
          .json({ message: "Évaluation introuvable." });
      }

      // Règles :
      // - Pilote : peut contester uniquement ses propres évaluations
      // - Management : peut contester les évaluations des pilotes de sa cellule (si sa cellule est renseignée)
      const role = String(req.user.role || "");
      const currentUserId = String(req.user.id || req.user._id);

      if (role === "pilote") {
        const pilotId = String(score.pilot);
        if (pilotId !== currentUserId) {
          return res.status(403).json({
            message: "Vous ne pouvez contester que vos propres évaluations.",
          });
        }
      }

      if (role === "management") {
        const manager = await User.findById(currentUserId).select("cell").lean();
        const managerCell = (manager?.cell || "").toString().trim();
        if (managerCell) {
          const pilot = await User.findById(score.pilot).select("cell").lean();
          const pilotCell = (pilot?.cell || "").toString().trim();
          if (pilotCell !== managerCell) {
            return res.status(403).json({
              message: "Vous ne pouvez contester que les évaluations de votre cellule.",
            });
          }
        }
      }

      // Contestation uniquement des évaluations faites par un CQ (champ evaluator)
      const evaluatorId = score.evaluator ? String(score.evaluator) : "";
      if (!evaluatorId || !mongoose.Types.ObjectId.isValid(evaluatorId)) {
        return res.status(400).json({
          message: "Cette évaluation ne possède pas d'évaluateur valide (CQ).",
        });
      }
      const evaluatorUser = await User.findById(evaluatorId)
        .select("role name email")
        .lean();
      if (!evaluatorUser || !["cq", "formateur"].includes(String(evaluatorUser.role || ""))) {
        return res.status(400).json({
          message: "Seules les évaluations réalisées par un CQ peuvent être contestées.",
        });
      }
      if (role !== "pilote" && !(await isPilotInScope(await getScope(req), score.pilot))) {
        return res.status(403).json({ message: "Évaluation hors de votre périmètre." });
      }

      score.contested = true;
      score.contestComment = contestComment || "";
      score.contestedAt = new Date();
      score.contestStatus = "pending";
      score.contestedBy = currentUserId;
      score.arbitratedBy = null;
      score.arbitratedAt = null;
      score.arbitrationComment = "";

      await score.save();

      const populated = await Score.findById(score._id)
        .populate("pilot", "-passwordHash")
        .populate("evaluator", "-passwordHash")
        .lean();

            // 🔔 Notifier instantanément le CQ évaluateur
      try {
        const notif = await Notification.create({
          type: "alerte",
          title: "Évaluation contestée",
          message: `Une évaluation a été contestée (${score.eps || "EPS"}). Merci de la réévaluer.`,
          targetAll: false,
          targetCells: [],
          targetUsers: [new mongoose.Types.ObjectId(String(evaluatorId))],
          createdBy: req.user.id || req.user._id,
          meta: { action: "reevaluate", scoreId: String(score._id) },
        });

        const io = req.app.get("io");
        if (io) {
          const payload = await Notification.findById(notif._id)
            .populate("createdBy", "name email role")
            .lean();
          io.to(`user:${evaluatorId}`).emit("notification:new", payload);
        }
      } catch (e) {
        // ne bloque pas la contestation si la notif échoue
      }

res.json(populated);
    } catch (err) {
      console.error("POST /scores/:id/contest error:", err);
      res.status(500).json({
        message: "Erreur serveur lors de la contestation de l'évaluation.",
      });
    }
  }
);

/* =========================================================================
 *  VALIDATION D'UNE ÉVALUATION PAR L'AGENT (contrat Orange — indicateur 2.2)
 * ========================================================================= */

/**
 * POST /scores/:id/validate
 * Body : { comment? }
 * L'agent prend connaissance de son évaluation et la valide.
 */
router.post(
  "/:id/validate",
  permit("pilote"),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID invalide." });
      }
      if (!(await getSetting("pilotEvaluationValidationEnabled"))) {
        return res.status(403).json({ message: "La validation des évaluations n'est pas activée." });
      }
      const score = await Score.findById(id);
      if (!score) return res.status(404).json({ message: "Évaluation introuvable." });

      const me = String(req.user.id || req.user._id);
      if (String(score.pilot) !== me) {
        return res.status(403).json({ message: "Vous ne pouvez valider que vos propres évaluations." });
      }
      if (score.contested) {
        return res.status(409).json({ message: "Évaluation en cours de contestation : validation impossible." });
      }
      if (score.pilotValidated) {
        return res.status(409).json({ message: "Évaluation déjà validée." });
      }

      score.pilotValidated = true;
      score.pilotValidatedAt = new Date();
      score.pilotValidationComment = String(req.body?.comment || "").trim().slice(0, 2000);
      await score.save();

      await logAudit(req, { action: "VALIDATE_EVALUATION", targetType: "score", targetId: score._id, metadata: { eps: score.eps || "" } });

      try {
        const notif = await Notification.create({
          type: "notification",
          title: "Évaluation validée",
          message: `${req.user.name || "L'agent"} a validé l'évaluation ${score.eps || ""}.`,
          targetUsers: [score.evaluator],
          createdBy: req.user.id || req.user._id,
          meta: { scoreId: String(score._id) },
        });
        const io = req.app.get("io");
        if (io) io.to(`user:${String(score.evaluator)}`).emit("notification:new", notif);
      } catch (_) { /* ne bloque pas la validation */ }

      res.json({
        _id: score._id,
        pilotValidated: true,
        pilotValidatedAt: score.pilotValidatedAt,
        pilotValidationComment: score.pilotValidationComment,
      });
    } catch (err) {
      console.error("POST /scores/:id/validate error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la validation." });
    }
  }
);

/* =========================================================================
 *  SUPPRESSION D'UNE ÉVALUATION (CQ / MANAGEMENT / ADMIN)
 * ========================================================================= */

/**
 * DELETE /scores/:id
 * - Admin seulement
 */
router.delete(
  "/:id",
  permit("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID invalide." });
      }

      const score = await Score.findById(id);
      if (!score) {
        return res
          .status(404)
          .json({ message: "Évaluation introuvable." });
      }

      const isAdmin = req.user.role === "admin";
      const evaluatorId = String(score.evaluator);
      const currentId = String(req.user.id || req.user._id);

      if (!isAdmin && evaluatorId !== currentId) {
        return res.status(403).json({
          message:
            "Vous ne pouvez supprimer que vos propres évaluations.",
        });
      }

      await score.deleteOne();

      // Contrat Orange : l'échantillon lié redevient à évaluer
      try {
        await Sample.updateMany({ score: score._id, assignedTo: { $ne: null } }, { $set: { status: "assigned", score: null, doneAt: null } });
        await Sample.updateMany({ score: score._id }, { $set: { status: "pending", score: null, doneAt: null } });
      } catch (_) { /* best-effort */ }

      res.json({ message: "Évaluation supprimée." });
    } catch (err) {
      console.error("DELETE /scores/:id error:", err);
      res.status(500).json({
        message: "Erreur serveur lors de la suppression de l'évaluation.",
      });
    }
  }
);


/* =========================================================================
 * POST /scores/:id/arbitrate — arbitrage d'une contestation
 * CQ / Formateur : accepter ou rejeter ; Admin : arbitrage supérieur (peut revenir sur une décision).
 * Body : { decision: "accept" | "reject", comment }
 *  - accept : contestation fondée → l'évaluation repasse en réévaluation (le CQ peut la corriger)
 *  - reject : contestation rejetée → l'évaluation reste inchangée
 * ========================================================================= */
router.post("/:id/arbitrate", permit("cq", "formateur", "admin"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Identifiant invalide." });
    const decision = String(req.body.decision || "").toLowerCase();
    if (!["accept", "reject"].includes(decision)) return res.status(400).json({ message: "Décision invalide (accept ou reject)." });
    const comment = String(req.body.comment || "").trim().slice(0, 2000);
    if (decision === "reject" && !comment) return res.status(400).json({ message: "Un motif est obligatoire pour rejeter une contestation." });

    const score = await Score.findById(req.params.id);
    if (!score) return res.status(404).json({ message: "Évaluation introuvable." });
    const isAdmin = req.user.role === "admin";
    const alreadyDecided = ["accepted", "rejected"].includes(score.contestStatus);
    if (!score.contested && !(isAdmin && alreadyDecided)) {
      return res.status(400).json({ message: "Cette évaluation n'a pas de contestation en cours." });
    }

    const me = String(req.user.id || req.user._id);
    score.contestStatus = decision === "accept" ? "accepted" : "rejected";
    score.arbitratedBy = me;
    score.arbitratedAt = new Date();
    score.arbitrationComment = comment;
    if (decision === "reject") {
      score.contested = false;
    } else {
      // Contestation fondée : reste ouverte jusqu'à la réévaluation, l'agent devra revalider
      score.contested = true;
      score.pilotValidated = false;
      score.pilotValidatedAt = null;
    }
    await score.save();

    const pilot = await User.findById(score.pilot).select("name").lean();
    await logAudit(req, {
      action: decision === "accept" ? "CONTEST_ACCEPTED" : "CONTEST_REJECTED",
      targetType: "score",
      targetId: score._id,
      metadata: { eps: score.eps || "", pilotName: pilot?.name || "", comment, by: req.user.role },
    });

    // Notifie l'auteur de la contestation
    try {
      if (score.contestedBy) {
        const notif = await Notification.create({
          type: "information",
          title: decision === "accept" ? "Contestation acceptée" : "Contestation rejetée",
          message: `Votre contestation (${score.eps || "EPS"}) a été ${decision === "accept" ? "acceptée : l'évaluation va être corrigée" : "rejetée"}${comment ? ` — ${comment}` : ""}.`,
          targetAll: false,
          targetCells: [],
          targetUsers: [score.contestedBy],
          createdBy: me,
          meta: { action: "arbitration", scoreId: String(score._id) },
        });
        const io = req.app.get("io");
        if (io) io.to(`user:${String(score.contestedBy)}`).emit("notification:new", notif.toObject());
      }
    } catch (e) { /* la notification ne bloque pas l'arbitrage */ }

    const populated = await Score.findById(score._id).populate("pilot", "-passwordHash").populate("evaluator", "-passwordHash").populate("arbitratedBy", "name role").lean();
    res.json(populated);
  } catch (err) {
    console.error("POST /scores/:id/arbitrate error:", err);
    res.status(500).json({ message: "Erreur serveur lors de l'arbitrage." });
  }
});

module.exports = router;

