// backend/routes/kpi.routes.js — indicateurs qualité du contrat Orange (§2, §3.3, §4)
const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const permit = require("../middleware/roles");
const Score = require("../models/Score");
const Coaching = require("../models/Coaching");
const User = require("../models/User");
const Grid = require("../models/Grid");
const Training = require("../models/Training");
const LoginEvent = require("../models/LoginEvent");
const Sample = require("../models/Sample");
const EvaluationTarget = require("../models/EvaluationTarget");
const { getScope, userFilterForScope, sampleFilterForScope } = require("../utils/scope");
const { getSettings } = require("../utils/settings");
const { PRODUCTION_TYPES, TYPE_LABELS, typeClause, typeOf } = require("../utils/evalTypes");
const { computeCompliancePercent } = require("../utils/compliance");
const K = require("../utils/kpi");

const router = express.Router();
router.use(auth);

const READERS = ["admin", "cq", "formateur", "management", "supervision", "superviseur", "referent", "cdp"];
const isId = (v) => !!v && mongoose.Types.ObjectId.isValid(String(v));
const csvIds = (v) => (v ? String(v).split(",").map((x) => x.trim()).filter(isId).map((x) => new mongoose.Types.ObjectId(x)) : []);
const str = (v) => String(v || "").trim().slice(0, 120);

/** Période : dateFrom/dateTo ISO ; défaut = mois courant (UTC). */
function resolvePeriod(query) {
  const now = new Date();
  let from = query.dateFrom ? new Date(String(query.dateFrom)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let to = query.dateTo ? new Date(String(query.dateTo)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw Object.assign(new Error("Période invalide."), { status: 400 });
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.dateTo || ""))) to.setUTCHours(23, 59, 59, 999);
  if (from > to) throw Object.assign(new Error("La date de début dépasse la date de fin."), { status: 400 });
  if (to - from > 1000 * 60 * 60 * 24 * 400) throw Object.assign(new Error("Période limitée à 13 mois."), { status: 400 });
  return { from, to, months: K.monthsBetween(from, to) };
}

/** Clause « mois d'appel » : callDate, à défaut createdAt. */
function callRangeClause(from, to) {
  return { $or: [{ callDate: { $gte: from, $lte: to } }, { callDate: null, createdAt: { $gte: from, $lte: to } }] };
}

/**
 * Population du périmètre : agents actifs (dénominateurs) et identifiants des agents
 * pour filtrer évaluations / coachings (null = aucune restriction).
 */
async function resolvePopulation(req) {
  const scope = await getScope(req);
  const base = {};
  if (req.query.cell) base.cell = str(req.query.cell);
  if (req.query.project) base.project = str(req.query.project);
  if (req.query.contract) base.contract = str(req.query.contract);
  const pilotIds = csvIds(req.query.pilotId);
  if (pilotIds.length) base._id = { $in: pilotIds };
  const sf = userFilterForScope(scope);
  const where = sf ? { $and: [base, sf] } : base;
  const filtered = !!sf || Object.keys(base).length > 0;
  const [agents, pilotFilterIds] = await Promise.all([
    User.find({ $and: [where, { role: "pilote", active: { $ne: false } }] }).select("name cell project contract").lean(),
    filtered ? User.distinct("_id", where) : Promise.resolve(null),
  ]);
  return { scope, where, agents, pilotFilterIds };
}

async function loadScores({ from, to }, pop, query, fields) {
  const and = [callRangeClause(from, to), typeClause(PRODUCTION_TYPES)];
  if (pop.pilotFilterIds) and.push({ pilot: { $in: pop.pilotFilterIds } });
  const evaluators = csvIds(query.evaluatorId);
  if (evaluators.length) and.push({ evaluator: { $in: evaluators } });
  return Score.find({ $and: and }).select(fields).lean();
}

async function gridsFor(scores) {
  const ids = [...new Set(scores.map((s) => (s.gridId ? String(s.gridId) : "")).filter(Boolean))];
  const grids = ids.length ? await Grid.find({ _id: { $in: ids } }).lean() : [];
  return new Map(grids.map((g) => [String(g._id), g]));
}

/** Objectif mensuel par agent : cellule > contrat > projet > global > paramètre par défaut. */
async function targetResolver(months, defaultPerAgent) {
  const rows = months.length ? await EvaluationTarget.find({ month: { $in: months } }).lean() : [];
  const idx = new Map(rows.map((r) => [`${r.month}|${r.cell}|${r.project}|${r.contract}`, r.target]));
  const find = (m, cell, project, contract) => idx.get(`${m}|${cell}|${project}|${contract}`);
  return (agent, month) => {
    const c = agent.cell || "";
    const p = agent.project || "";
    const k = agent.contract || "";
    const candidates = [
      c && find(month, c, "", ""),
      c && find(month, c, p, k),
      k && find(month, "", "", k),
      k && find(month, "", p, k),
      p && find(month, "", p, ""),
      find(month, "", "", ""),
    ];
    for (const v of candidates) if (typeof v === "number") return v;
    return Number(defaultPerAgent) || 0;
  };
}

function expectedFor(agents, months, resolve) {
  let total = 0;
  for (const a of agents) for (const m of months) total += resolve(a, m);
  return total;
}

function handle(res, err, label) {
  if (err && err.status) return res.status(err.status).json({ message: err.message });
  console.error(label, err);
  return res.status(500).json({ message: "Erreur lors du calcul des indicateurs." });
}

/**
 * GET /api/kpi/summary
 * Query : dateFrom, dateTo, cell, project, contract, pilotId, evaluatorId
 * Les 7 indicateurs du besoin §2 + échantillons en attente (§3.3).
 */
router.get("/summary", permit(...READERS), async (req, res) => {
  try {
    const period = resolvePeriod(req.query);
    const settings = await getSettings();
    const pop = await resolvePopulation(req);
    const evaluators = csvIds(req.query.evaluatorId);

    // --- Évaluations (mois d'appel) ---
    const scores = await loadScores(period, pop, req.query, "pilot evaluator callDate createdAt contested contestedAt reevaluatedAt contestComment pilotValidated evaluationType items gridId");
    const gridById = await gridsFor(scores);
    const pct = (s) => computeCompliancePercent(s, s.gridId ? gridById.get(String(s.gridId)) : null);
    const avgPercent = scores.length ? K.round1(scores.reduce((n, s) => n + (Number(pct(s)) || 0), 0) / scores.length) : null;

    // --- Coachings (date de création) ---
    const cAnd = [{ createdAt: { $gte: period.from, $lte: period.to } }];
    if (pop.pilotFilterIds) cAnd.push({ pilot: { $in: pop.pilotFilterIds } });
    if (evaluators.length) cAnd.push({ coach: { $in: evaluators } });
    const coachings = await Coaching.find({ $and: cAnd }).select("pilotAcknowledged status createdAt").lean();
    const from12 = new Date(period.to);
    from12.setUTCMonth(from12.getUTCMonth() - 12);
    const c12And = [{ createdAt: { $gt: from12, $lte: period.to } }];
    if (pop.pilotFilterIds) c12And.push({ pilot: { $in: pop.pilotFilterIds } });
    if (evaluators.length) c12And.push({ coach: { $in: evaluators } });
    const coachings12 = await Coaching.find({ $and: c12And }).select("pilotAcknowledged status").lean();
    const def = settings.coachingDoneDefinition;

    // --- Utilisation ---
    const usageUsersWhere = { $and: [pop.where, { active: { $ne: false }, role: { $in: settings.usageRoles } }] };
    const usageIds = await User.distinct("_id", usageUsersWhere);
    const loginAnd = [{ at: { $gte: period.from, $lte: period.to } }, { user: { $in: usageIds } }];
    const [logins, distinctLogged] = await Promise.all([
      LoginEvent.countDocuments({ $and: loginAnd }),
      LoginEvent.distinct("user", { $and: loginAnd }),
    ]);

    // --- Quiz ---
    const quizUsers = await User.find({ $and: [pop.where, { active: { $ne: false }, role: { $ne: "admin" } }] }).select("role cell").lean();
    const trainings = await Training.find({ active: { $ne: false }, "questions.0": { $exists: true } })
      .select("title active roles targetCells targetUsers dueDate attempts.user starts.user questions._id")
      .lean();

    // --- Couverture (mois d'appel, agents actifs du périmètre) ---
    const resolve = await targetResolver(period.months, settings.evaluationTargetPerAgentPerMonth);
    const agentIds = new Set(pop.agents.map((a) => String(a._id)));
    const doneForCoverage = scores.filter((s) => agentIds.has(String(s.pilot))).length;
    const evaluatedAgents = new Set(scores.filter((s) => agentIds.has(String(s.pilot))).map((s) => String(s.pilot))).size;

    // --- Échantillons en attente / standby ---
    const sf = sampleFilterForScope(pop.scope);
    const sAnd = [{ status: { $in: settings.sampleWaitingStatuses } }];
    if (sf) sAnd.push(sf);
    if (req.query.cell) sAnd.push({ cell: str(req.query.cell) });
    if (req.query.contract) sAnd.push({ contract: str(req.query.contract) });
    if (req.query.project) sAnd.push({ project: str(req.query.project) });
    const waitingSamples = await Sample.aggregate([{ $match: { $and: sAnd } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);

    res.json({
      period: { from: period.from, to: period.to, months: period.months, dateBasis: "call" },
      population: { activeAgents: pop.agents.length },
      evaluations: { total: scores.length, avgPercent, byType: K.countByType(scores) },
      coachingValidation: K.coachingValidation(coachings),
      evaluationValidation: { ...K.evaluationValidation(scores), enabled: settings.pilotEvaluationValidationEnabled },
      evaluationContestation: K.evaluationContestation(scores),
      usage: K.usage({
        logins,
        distinctLoggedUsers: distinctLogged.length,
        enabledUsers: usageIds.length,
        expectedUsers: settings.usageExpectedUsers,
        denominator: settings.usageDenominator,
      }),
      coachingCompletion: K.coachingCompletion({
        doneInPeriod: coachings.filter((c) => K.isCoachingDone(c, def)).length,
        monthsInPeriod: period.months.length,
        doneLast12Months: coachings12.filter((c) => K.isCoachingDone(c, def)).length,
        activeAgents: pop.agents.length,
        annualTarget: settings.coachingAnnualTarget,
        perAgent: settings.coachingTargetPerAgent,
        mode: settings.coachingTargetMode,
      }),
      coverage: {
        ...K.coverage({ done: doneForCoverage, expected: expectedFor(pop.agents, period.months, resolve) }),
        evaluatedAgents,
        evaluationRate: K.rate(evaluatedAgents, pop.agents.length),
      },
      quiz: K.quizCompletion(trainings, quizUsers),
      samplesWaiting: {
        statuses: settings.sampleWaitingStatuses,
        byStatus: Object.fromEntries(waitingSamples.map((r) => [r._id, r.n])),
        total: waitingSamples.reduce((n, r) => n + r.n, 0),
      },
      definitions: {
        coachingDoneDefinition: def,
        usageDenominator: settings.usageDenominator,
        coachingTargetMode: settings.coachingTargetMode,
        coachingAnnualTarget: settings.coachingAnnualTarget,
        evaluationTargetPerAgentPerMonth: settings.evaluationTargetPerAgentPerMonth,
      },
    });
  } catch (err) {
    handle(res, err, "GET /kpi/summary error:");
  }
});

/**
 * GET /api/kpi/breakdown?dimension=evaluator|pilot|cell|project|contract|month|type
 * Volumes, moyenne, contestations et validations par dimension (identification des contestations).
 */
router.get("/breakdown", permit(...READERS), async (req, res) => {
  try {
    const dimension = String(req.query.dimension || "cell");
    if (!["evaluator", "pilot", "cell", "project", "contract", "month", "type"].includes(dimension)) {
      return res.status(400).json({ message: "Dimension invalide." });
    }
    const period = resolvePeriod(req.query);
    const pop = await resolvePopulation(req);
    const scores = await loadScores(period, pop, req.query, "pilot evaluator callDate createdAt contested contestedAt reevaluatedAt contestComment pilotValidated evaluationType items gridId cellAtEvaluation projectAtEvaluation contractAtEvaluation");
    const gridById = await gridsFor(scores);
    const userIds = [...new Set(scores.flatMap((s) => [String(s.pilot || ""), String(s.evaluator || "")]).filter(isId))];
    const users = new Map((await User.find({ _id: { $in: userIds } }).select("name cell project contract role").lean()).map((u) => [String(u._id), u]));
    const pilotOf = (s) => users.get(String(s.pilot)) || {};
    const keyFn = {
      evaluator: (s) => ({ key: String(s.evaluator || ""), label: (users.get(String(s.evaluator)) || {}).name || "Évaluateur supprimé" }),
      pilot: (s) => ({ key: String(s.pilot || ""), label: pilotOf(s).name || "Agent supprimé" }),
      cell: (s) => { const v = pilotOf(s).cell || s.cellAtEvaluation || ""; return { key: v, label: v || "Sans cellule" }; },
      project: (s) => { const v = pilotOf(s).project || s.projectAtEvaluation || ""; return { key: v, label: v || "Sans projet" }; },
      contract: (s) => { const v = pilotOf(s).contract || s.contractAtEvaluation || ""; return { key: v, label: v || "Sans contrat" }; },
      month: (s) => { const v = K.callMonth(s); return { key: v, label: v }; },
      type: (s) => { const t = typeOf(s); return { key: t, label: TYPE_LABELS[t] || t }; },
    }[dimension];
    let rows = K.breakdown(scores, keyFn, (s) => computeCompliancePercent(s, s.gridId ? gridById.get(String(s.gridId)) : null));
    if (dimension === "month") rows = rows.sort((a, b) => a.key.localeCompare(b.key));
    if (dimension === "pilot") {
      rows = rows.map((r) => ({ ...r, cell: (users.get(r.key) || {}).cell || "" }));
    }
    res.json({ dimension, period: { from: period.from, to: period.to }, total: scores.length, rows });
  } catch (err) {
    handle(res, err, "GET /kpi/breakdown error:");
  }
});

/**
 * GET /api/kpi/cq-progress  (vue CQ, §4)
 * Query : endMonth=YYYY-MM (défaut : mois courant), months=1..12 (tendance, défaut 6),
 *         cell, project, contract, evaluatorId
 * Toutes les statistiques sont calculées par MOIS D'APPEL.
 */
router.get("/cq-progress", permit(...READERS), async (req, res) => {
  try {
    const now = new Date();
    const endMonth = /^\d{4}-\d{2}$/.test(String(req.query.endMonth || "")) ? String(req.query.endMonth) : K.monthKey(now);
    const n = Math.min(12, Math.max(1, parseInt(req.query.months || "6", 10) || 6));
    const [ey, em] = endMonth.split("-").map(Number);
    const to = new Date(Date.UTC(ey, em, 0, 23, 59, 59, 999));
    const from = new Date(Date.UTC(ey, em - n, 1));
    const months = K.monthsBetween(from, to);
    const settings = await getSettings();
    const pop = await resolvePopulation(req);

    const scores = await loadScores({ from, to }, pop, req.query, "pilot evaluator callDate createdAt evaluationType");
    const resolve = await targetResolver(months, settings.evaluationTargetPerAgentPerMonth);
    const agentById = new Map(pop.agents.map((a) => [String(a._id), a]));
    const inPop = scores.filter((s) => agentById.has(String(s.pilot)));

    const trend = months.map((m) => {
      const ms = inPop.filter((s) => K.callMonth(s) === m);
      const expected = expectedFor(pop.agents, [m], resolve);
      const evaluated = new Set(ms.map((s) => String(s.pilot))).size;
      return {
        month: m,
        ...K.coverage({ done: ms.length, expected }),
        evaluatedAgents: evaluated,
        activeAgents: pop.agents.length,
        evaluationRate: K.rate(evaluated, pop.agents.length),
      };
    });
    const current = trend[trend.length - 1];
    const curScores = inPop.filter((s) => K.callMonth(s) === endMonth);

    // Par cellule / projet / contrat
    const groupAgents = (field) => {
      const map = new Map();
      for (const a of pop.agents) {
        const key = a[field] || "";
        if (!map.has(key)) map.set(key, { key, label: key || "Non renseigné", agents: [], done: 0, evaluated: new Set() });
        map.get(key).agents.push(a);
      }
      for (const s of curScores) {
        const a = agentById.get(String(s.pilot));
        const g = map.get((a && a[field]) || "");
        if (g) { g.done += 1; g.evaluated.add(String(s.pilot)); }
      }
      return [...map.values()].map((g) => ({
        key: g.key,
        label: g.label,
        activeAgents: g.agents.length,
        ...K.coverage({ done: g.done, expected: expectedFor(g.agents, [endMonth], resolve) }),
        evaluatedAgents: g.evaluated.size,
        evaluationRate: K.rate(g.evaluated.size, g.agents.length),
      })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    };

    // Par évaluateur (selon droits : le périmètre limite déjà les évaluations visibles)
    const evalIds = [...new Set(curScores.map((s) => String(s.evaluator)).filter(isId))];
    const evalUsers = new Map((await User.find({ _id: { $in: evalIds } }).select("name role").lean()).map((u) => [String(u._id), u]));
    const byEvaluatorMap = new Map();
    for (const s of curScores) {
      const id = String(s.evaluator || "");
      if (!byEvaluatorMap.has(id)) byEvaluatorMap.set(id, { key: id, label: (evalUsers.get(id) || {}).name || "Évaluateur supprimé", role: (evalUsers.get(id) || {}).role || "", done: 0, agents: new Set() });
      const r = byEvaluatorMap.get(id);
      r.done += 1;
      r.agents.add(String(s.pilot));
    }
    const byEvaluator = [...byEvaluatorMap.values()]
      .map((r) => ({ key: r.key, label: r.label, role: r.role, done: r.done, evaluatedAgents: r.agents.size, share: K.rate(r.done, curScores.length) }))
      .sort((a, b) => b.done - a.done);

    res.json({
      endMonth,
      months,
      dateBasis: "call",
      current: { ...current, month: endMonth },
      trend,
      byCell: groupAgents("cell"),
      byProject: groupAgents("project"),
      byContract: groupAgents("contract"),
      byEvaluator,
      definitions: {
        coverage: "Évaluations réalisées (mois d'appel) / évaluations attendues",
        evaluationRate: "Agents évalués au moins une fois / agents actifs du périmètre",
        expected: "Objectif mensuel par agent (cellule > contrat > projet > global > paramètre par défaut) × agents actifs",
        defaultPerAgent: settings.evaluationTargetPerAgentPerMonth,
      },
    });
  } catch (err) {
    handle(res, err, "GET /kpi/cq-progress error:");
  }
});

module.exports = router;
module.exports._test = { resolvePeriod, callRangeClause, targetResolver, expectedFor };
