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
const QualityObjective = require("../models/QualityObjective");
const Cell = require("../models/Cell");
const { matchesScopeFields } = require("../utils/scope");
const { getScope, userFilterForScope, sampleFilterForScope } = require("../utils/scope");
const { getSettings } = require("../utils/settings");
const { PRODUCTION_TYPES, TYPE_LABELS, typeClause, typeOf } = require("../utils/evalTypes");
const { computeCompliancePercent } = require("../utils/compliance");
const K = require("../utils/kpi");

const router = express.Router();
router.use(auth);

const READERS = ["admin", "cq", "formateur", "management", "supervision", "superviseur", "referent", "cdp"];
// Onglet « Indicateurs qualité » : Admin et Superviseur uniquement
const INDICATOR_READERS = ["admin", "superviseur", "supervision"];
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
router.get("/summary", permit(...INDICATOR_READERS), async (req, res) => {
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
    const coachings = await Coaching.find({ $and: cAnd }).select("pilot pilotAcknowledged status createdAt").lean();
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

    // --- Calibrages (mois d'appel) : validations et contestations ---
    const calAnd = [callRangeClause(period.from, period.to), typeClause(["calibration"])];
    if (pop.pilotFilterIds) calAnd.push({ pilot: { $in: pop.pilotFilterIds } });
    if (evaluators.length) calAnd.push({ evaluator: { $in: evaluators } });
    const calibrations = await Score.find({ $and: calAnd }).select("pilot contested contestedAt contestComment reevaluatedAt pilotValidated").lean();

    // --- Échantillons en attente / standby ---
    const sf = sampleFilterForScope(pop.scope);
    const sAnd = [{ status: { $in: settings.sampleWaitingStatuses } }];
    if (sf) sAnd.push(sf);
    if (req.query.cell) sAnd.push({ cell: str(req.query.cell) });
    if (req.query.contract) sAnd.push({ contract: str(req.query.contract) });
    if (req.query.project) sAnd.push({ project: str(req.query.project) });
    const waitingSamples = await Sample.aggregate([{ $match: { $and: sAnd } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);

    // Indicateurs qualité avec les formules du client (liste des besoins, nov. 2026)
    const evalVal = K.evaluationValidation(scores);
    const evalCont = K.evaluationContestation(scores);
    const calVal = K.evaluationValidation(calibrations);
    const calCont = K.evaluationContestation(calibrations);
    const coachVal = K.coachingValidation(coachings);
    const quizC = K.quizCompletion(trainings, quizUsers);
    const coachedAgents = new Set(coachings.map((c) => String(c.pilot)).filter((id) => agentIds.has(id))).size;
    const ind = (key, label, formula, num, den) => ({ key, label, formula, num, den, rate: K.rate(num, den) });
    const clientIndicators = [
      ind("coachingValidation", "Taux de validation des coachings", "Coachings validés / coachings reçus", coachVal.validated, coachVal.received),
      ind("evaluationValidation", "Taux de validation des évaluations", "Évaluations validées par l'agent / évaluations reçues", evalVal.validated, evalVal.received),
      ind("calibrationValidation", "Taux de validation des calibrages", "Calibrages validés par l'agent / calibrages reçus", calVal.validated, calVal.received),
      ind("evaluationContestation", "Taux de contestation des évaluations", "Évaluations contestées / évaluations reçues", evalCont.contested, evalCont.received),
      ind("calibrationContestation", "Taux de contestation des calibrages", "Calibrages contestés / calibrages reçus", calCont.contested, calCont.received),
      ind("quizCompletion", "Taux de passation des quiz", "Quiz finalisés / quiz actifs attribués", quizC.finalized, quizC.assignments),
      ind("coverage", "Taux de couverture des évaluations", "Agents actifs évalués / total des agents actifs", evaluatedAgents, pop.agents.length),
      ind("coachingRate", "Taux de coaching", "Agents actifs coachés / total des agents actifs", coachedAgents, pop.agents.length),
      ind("connection", "Taux de connexion à l'application", "Utilisateurs connectés / total des utilisateurs", distinctLogged.length, usageIds.length),
    ];

    res.json({
      clientIndicators,
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
 * Tableau de bord — indicateurs affichés selon le rôle (liste des besoins v3).
 * Chaque rôle ne reçoit que les indicateurs auxquels il a droit ; le périmètre de données
 * reste celui du rôle (admin : tout, CDP : contrat, superviseur / RT : cellules affectées, agent : lui-même).
 */
const ALL_ROLES = ["admin", "cdp", "superviseur", "referent", "management", "cq", "formateur", "supervision", "pilote"];
const STAFF_ROLES = ALL_ROLES.filter((r) => r !== "pilote");
const LEAD_ROLES = ["admin", "cdp", "superviseur", "supervision"];
const DASHBOARD_INDICATORS = [
  { key: "qualityScore", label: "Score qualité (note QA)", roles: ALL_ROLES, kind: "percent", formula: "Moyenne des scores des évaluations" },
  { key: "evaluations", label: "Nombre d'évaluations", roles: STAFF_ROLES, kind: "count", formula: "Évaluations réalisées sur la période (hors calibrages et pickings)" },
  { key: "calibrations", label: "Nombre de calibrages", roles: STAFF_ROLES, kind: "count", formula: "Calibrages réalisés sur la période" },
  { key: "pickings", label: "Nombre de pickings", roles: STAFF_ROLES, kind: "count", formula: "Pickings réalisés sur la période" },
  { key: "coachingValidation", label: "Taux de validation des coachings", roles: ALL_ROLES, kind: "rate", formula: "Coachings validés / coachings reçus" },
  { key: "evaluationValidation", label: "Taux de validation des évaluations", roles: ALL_ROLES, kind: "rate", formula: "Évaluations validées par l'agent / évaluations reçues" },
  { key: "calibrationValidation", label: "Taux de validation des calibrages", roles: ALL_ROLES, kind: "rate", formula: "Calibrages validés par l'agent / calibrages reçus" },
  { key: "evaluationContestation", label: "Taux de contestation des évaluations", roles: LEAD_ROLES, kind: "rate", inverse: true, formula: "Évaluations contestées / évaluations reçues" },
  { key: "calibrationContestation", label: "Taux de contestation des calibrages", roles: LEAD_ROLES, kind: "rate", inverse: true, formula: "Calibrages contestés / calibrages reçus" },
  { key: "quizCompletion", label: "Taux de passation des quiz", roles: LEAD_ROLES, kind: "rate", formula: "Quiz actifs finalisés / quiz actifs attribués" },
  { key: "coverage", label: "Taux de couverture des évaluations", roles: LEAD_ROLES, kind: "rate", formula: "Agents actifs évalués / total des agents actifs" },
  { key: "coachingRate", label: "Taux de coaching", roles: LEAD_ROLES, kind: "rate", formula: "Nombre de coachings / nombre de pilotes actifs" },
  { key: "connection", label: "Taux de connexion à l'application", roles: ["admin"], kind: "rate", formula: "Utilisateurs connectés / total des utilisateurs" },
];
const EVALUATOR_ROLES = ["cq", "superviseur", "referent", "management", "formateur", "cdp", "admin"];
const csvStr = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200).map((x) => x.slice(0, 120));

function dashboardPeriod(query) {
  const parse = (v) => { if (!v) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? undefined : d; };
  const from = parse(query.dateFrom);
  const to = parse(query.dateTo);
  if (from === undefined || to === undefined) throw Object.assign(new Error("Période invalide."), { status: 400 });
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(String(query.dateTo || ""))) to.setUTCHours(23, 59, 59, 999);
  if (from && to && from > to) throw Object.assign(new Error("La date de début dépasse la date de fin."), { status: 400 });
  return { from, to };
}
const inRange = (field, p) => {
  if (!p.from && !p.to) return null;
  const r = {};
  if (p.from) r.$gte = p.from;
  if (p.to) r.$lte = p.to;
  return { [field]: r };
};

router.get("/dashboard", permit(...ALL_ROLES), async (req, res) => {
  try {
    const role = String(req.user.role || "");
    const period = dashboardPeriod(req.query);
    const scope = await getScope(req);
    const isAgent = role === "pilote";

    // Population : périmètre du rôle + filtres contrat / projet / cellule / agent
    const base = {};
    if (!isAgent) {
      const cells = csvStr(req.query.cell);
      const contracts = csvStr(req.query.contract);
      const projects = csvStr(req.query.project);
      const pilotIds = csvIds(req.query.pilotId);
      if (cells.length) base.cell = { $in: cells };
      if (contracts.length) base.contract = { $in: contracts };
      if (projects.length) base.project = { $in: projects };
      if (pilotIds.length) base._id = { $in: pilotIds };
    }
    const sf = userFilterForScope(scope);
    const where = sf ? { $and: [base, sf] } : base;
    const filtered = !!sf || Object.keys(base).length > 0;
    const [agents, pilotFilterIds] = await Promise.all([
      User.find({ $and: [where, { role: "pilote", active: { $ne: false } }] }).select("_id").lean(),
      filtered ? User.distinct("_id", where) : Promise.resolve(null),
    ]);
    const agentIds = new Set(agents.map((a) => String(a._id)));

    // Évaluateur par rôle
    const evalRoles = isAgent ? [] : csvStr(req.query.evaluatorRole).filter((r) => EVALUATOR_ROLES.includes(r));
    const evaluatorIds = evalRoles.length ? await User.distinct("_id", { role: { $in: evalRoles } }) : null;

    const scoreAnd = (types) => {
      const and = [typeClause(types)];
      const d = inRange("createdAt", period);
      if (d) and.push(d);
      if (pilotFilterIds) and.push({ pilot: { $in: pilotFilterIds } });
      if (evaluatorIds) and.push({ evaluator: { $in: evaluatorIds } });
      return { $and: and };
    };
    const fields = "pilot evaluator createdAt contested contestedAt reevaluatedAt contestComment pilotValidated evaluationType items gridId";
    const [prod, calibrations] = await Promise.all([
      Score.find(scoreAnd(PRODUCTION_TYPES)).select(fields).lean(),
      Score.find(scoreAnd(["calibration"])).select("pilot contested contestedAt contestComment reevaluatedAt pilotValidated").lean(),
    ]);
    const gridById = await gridsFor(prod);
    const pct = (s) => Number(computeCompliancePercent(s, s.gridId ? gridById.get(String(s.gridId)) : null)) || 0;
    const evaluations = prod.filter((s) => typeOf(s) !== "picking");
    const pickings = prod.filter((s) => typeOf(s) === "picking");

    const cAnd = [];
    const cd = inRange("createdAt", period);
    if (cd) cAnd.push(cd);
    if (pilotFilterIds) cAnd.push({ pilot: { $in: pilotFilterIds } });
    if (evaluatorIds) cAnd.push({ coach: { $in: evaluatorIds } });
    const coachings = await Coaching.find(cAnd.length ? { $and: cAnd } : {}).select("pilot pilotAcknowledged status").lean();

    const allowed = DASHBOARD_INDICATORS.filter((d) => d.roles.includes(role));
    const want = new Set(allowed.map((d) => d.key));
    const values = {};
    const ratio = (num, den) => ({ num, den, value: K.rate(num, den) });

    if (want.has("qualityScore")) values.qualityScore = { value: prod.length ? K.round1(prod.reduce((n, s) => n + pct(s), 0) / prod.length) : null, num: prod.length, den: null };
    if (want.has("evaluations")) values.evaluations = { value: evaluations.length };
    if (want.has("calibrations")) values.calibrations = { value: calibrations.length };
    if (want.has("pickings")) values.pickings = { value: pickings.length };
    if (want.has("coachingValidation")) { const c = K.coachingValidation(coachings); values.coachingValidation = ratio(c.validated, c.received); }
    if (want.has("evaluationValidation")) { const v = K.evaluationValidation(prod); values.evaluationValidation = ratio(v.validated, v.received); }
    if (want.has("calibrationValidation")) { const v = K.evaluationValidation(calibrations); values.calibrationValidation = ratio(v.validated, v.received); }
    if (want.has("evaluationContestation")) { const v = K.evaluationContestation(prod); values.evaluationContestation = ratio(v.contested, v.received); }
    if (want.has("calibrationContestation")) { const v = K.evaluationContestation(calibrations); values.calibrationContestation = ratio(v.contested, v.received); }
    if (want.has("coverage")) {
      const evaluated = new Set(prod.map((s) => String(s.pilot)).filter((id) => agentIds.has(id))).size;
      values.coverage = ratio(evaluated, agents.length);
    }
    if (want.has("coachingRate")) values.coachingRate = ratio(coachings.length, agents.length);
    if (want.has("quizCompletion")) {
      const quizUsers = await User.find({ $and: [where, { active: { $ne: false }, role: { $ne: "admin" } }] }).select("role cell").lean();
      const trainings = await Training.find({ active: { $ne: false }, "questions.0": { $exists: true } })
        .select("title active roles targetCells targetUsers dueDate attempts.user starts.user questions._id").lean();
      const q = K.quizCompletion(trainings, quizUsers);
      values.quizCompletion = ratio(q.finalized, q.assignments);
    }
    if (want.has("connection")) {
      const usageIds = await User.distinct("_id", { $and: [where, { active: { $ne: false } }] });
      const lAnd = [{ user: { $in: usageIds } }];
      const ld = inRange("at", period);
      if (ld) lAnd.push(ld);
      const logged = await LoginEvent.distinct("user", { $and: lAnd });
      values.connection = ratio(logged.length, usageIds.length);
    }

    res.json({
      role,
      period: { from: period.from, to: period.to, dateBasis: "evaluation" },
      population: { activeAgents: agents.length },
      indicators: allowed.map((d) => ({ key: d.key, label: d.label, kind: d.kind, inverse: !!d.inverse, formula: d.formula, ...(values[d.key] || { value: null }) })),
    });
  } catch (err) {
    handle(res, err, "GET /kpi/dashboard error:");
  }
});

/**
 * GET /api/kpi/breakdown?dimension=evaluator|pilot|cell|project|contract|month|type
 * Volumes, moyenne, contestations et validations par dimension (identification des contestations).
 */
router.get("/breakdown", permit(...INDICATOR_READERS), async (req, res) => {
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

/**
 * GET /api/kpi/objectives-progress?month=YYYY-MM
 * Avancement des tâches de chaque population (CQ, référents, management) par rapport aux
 * objectifs fixés par cellule dans Paramètres qualité. Comptage par date de réalisation.
 */
const GROUP_OF_ROLE = { cq: "cq", formateur: "formateur", referent: "referent", management: "management", superviseur: "management", cdp: "management" };
const ACTIVITY_OF_TYPE = { standard: "evaluations", picking: "pickings", sample: "samples", calibration: "calibrations" };
router.get("/objectives-progress", permit(...READERS), async (req, res) => {
  try {
    const now = new Date();
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month || "")) ? String(req.query.month) : K.monthKey(now);
    const [y, m] = month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    const me = String(req.user.id || req.user._id);

    const scope = await getScope(req);
    let objectives = await QualityObjective.find({}).sort({ contract: 1, cell: 1 }).lean();
    // Contrat courant de la cellule (il peut avoir changé depuis la saisie des objectifs)
    const cellDocs = await Cell.find({ name: { $in: objectives.map((o) => o.cell) } }).select("name contract").lean();
    const contractOf = new Map(cellDocs.map((c) => [c.name, c.contract || ""]));
    objectives = objectives.map((o) => ({ ...o, contract: contractOf.has(o.cell) ? contractOf.get(o.cell) : o.contract }));
    if (!scope.unrestricted && ["cell", "project", "contract", "pole"].includes(scope.mode)) {
      objectives = objectives.filter((o) => matchesScopeFields(scope, { cell: o.cell, contract: o.contract }));
    }
    const cells = objectives.map((o) => o.cell);
    if (!cells.length) return res.json({ month, myGroup: GROUP_OF_ROLE[req.user.role] || "", rows: [] });

    const pilots = await User.find({ role: "pilote", cell: { $in: cells } }).select("_id cell active").lean();
    const cellOfPilot = new Map(pilots.map((p) => [String(p._id), p.cell]));
    const activeAgents = {};
    for (const p of pilots) if (p.active !== false) activeAgents[p.cell] = (activeAgents[p.cell] || 0) + 1;

    const [scores, coachings] = await Promise.all([
      Score.find({ createdAt: { $gte: from, $lte: to }, evaluationType: { $in: Object.keys(ACTIVITY_OF_TYPE) } })
        .select("pilot evaluator evaluationType cellAtEvaluation").lean(),
      Coaching.find({ createdAt: { $gte: from, $lte: to } }).select("pilot coach").lean(),
    ]);
    const actorIds = [...new Set([...scores.map((s) => String(s.evaluator)), ...coachings.map((c) => String(c.coach))])].filter(isId);
    const actors = await User.find({ _id: { $in: actorIds } }).select("_id role").lean();
    const roleOf = new Map(actors.map((u) => [String(u._id), u.role]));

    const blank = () => Object.fromEntries(QualityObjective.ACTIVITIES.map((a) => [a, { done: 0, mine: 0 }]));
    const done = new Map(cells.map((c) => [c, Object.fromEntries(QualityObjective.GROUPS.map((g) => [g, blank()]))]));
    const add = (cell, actorId, activity) => {
      const bucket = done.get(cell);
      const group = GROUP_OF_ROLE[roleOf.get(String(actorId))];
      if (!bucket || !group) return;
      bucket[group][activity].done += 1;
      if (String(actorId) === me) bucket[group][activity].mine += 1;
    };
    for (const s of scores) {
      const cell = s.cellAtEvaluation || cellOfPilot.get(String(s.pilot));
      add(cell, s.evaluator, ACTIVITY_OF_TYPE[s.evaluationType || "standard"]);
    }
    for (const c of coachings) add(cellOfPilot.get(String(c.pilot)), c.coach, "coachings");

    const rows = objectives.map((o) => {
      // Objectif fixé par agent : volume attendu = objectif × agents actifs de la cellule
      const mult = activeAgents[o.cell] || 0;
      const groups = {};
      for (const g of QualityObjective.GROUPS) {
        groups[g] = {};
        for (const a of QualityObjective.ACTIVITIES) {
          const target = Number(o[g]?.[a] || 0) * mult;
          const d = done.get(o.cell)[g][a];
          groups[g][a] = { target, done: d.done, mine: d.mine, rate: target ? Math.round((d.done / target) * 1000) / 10 : null };
        }
      }
      return { cell: o.cell, contract: o.contract || "", base: "agent", perAgent: Object.fromEntries(QualityObjective.GROUPS.map((g) => [g, o[g] || {}])), activeAgents: activeAgents[o.cell] || 0, groups };
    });
    res.json({ month, myGroup: GROUP_OF_ROLE[req.user.role] || "", rows });
  } catch (err) {
    handle(res, err, "GET /kpi/objectives-progress error:");
  }
});

module.exports = router;
module.exports._test = { resolvePeriod, callRangeClause, targetResolver, expectedFor };
