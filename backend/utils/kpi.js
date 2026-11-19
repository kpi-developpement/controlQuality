"use strict";
/**
 * backend/utils/kpi.js — calculs des indicateurs qualité (contrat Orange).
 * Fonctions pures : aucune lecture base, testables unitairement.
 *
 * Conventions :
 *  - Les taux sont exprimés en pourcentage (1 décimale) ; null si dénominateur nul.
 *  - « Mois d'appel » = callDate, à défaut createdAt (évaluations anciennes sans date d'appel).
 *  - Les mois sont calculés en UTC, comme les filtres année/mois existants.
 */
const { typeOf } = require("./evalTypes");

function rate(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (d <= 0) return null;
  return Math.round((n / d) * 1000) / 10;
}

function round1(v) {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Date de référence « mois d'appel ». */
function callRefDate(score) {
  return (score && (score.callDate || score.createdAt)) || null;
}

function callMonth(score) {
  const d = callRefDate(score);
  return d ? monthKey(d) : "";
}

/** Liste des mois YYYY-MM couverts par [from, to]. */
function monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || a > b) return [];
  const out = [];
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth();
  const endY = b.getUTCFullYear();
  const endM = b.getUTCMonth();
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 240) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    guard += 1;
  }
  return out;
}

/** Une évaluation a-t-elle été contestée (y compris contestation déjà traitée) ? */
function isEverContested(s) {
  return !!(s && (s.contested || s.contestedAt || s.reevaluatedAt || String(s.contestComment || "").trim()));
}

function isCoachingDone(c, definition) {
  if (!c) return false;
  if (definition === "status_done") return c.status === "done";
  if (definition === "acknowledged") return !!c.pilotAcknowledged;
  return true; // "created" : le coaching enregistré est réputé réalisé
}

/** 2.1 — Taux de validation des coachings. */
function coachingValidation(coachings) {
  const received = coachings.length;
  const validated = coachings.filter((c) => c.pilotAcknowledged).length;
  return { validated, received, pending: received - validated, rate: rate(validated, received) };
}

/** 2.2 / 2.3 — validations et contestations des évaluations. */
function evaluationValidation(scores) {
  const received = scores.length;
  const validated = scores.filter((s) => s.pilotValidated).length;
  return { validated, received, rate: rate(validated, received) };
}

function evaluationContestation(scores) {
  const received = scores.length;
  const contested = scores.filter(isEverContested).length;
  const open = scores.filter((s) => s.contested).length;
  return { contested, open, received, rate: rate(contested, received) };
}

/** 2.4 — Taux d'utilisation. */
function usage({ logins, distinctLoggedUsers, enabledUsers, expectedUsers, denominator }) {
  const dens = {
    active_users: Number(distinctLoggedUsers) || 0,
    enabled_users: Number(enabledUsers) || 0,
    expected_users: Number(expectedUsers) || 0,
  };
  const key = dens[denominator] !== undefined ? denominator : "enabled_users";
  return {
    logins: Number(logins) || 0,
    distinctLoggedUsers: dens.active_users,
    enabledUsers: dens.enabled_users,
    expectedUsers: dens.expected_users,
    denominator: key,
    // connexions par utilisateur (formule du besoin : connexions / utilisateurs)
    loginsPerUser: dens[key] > 0 ? round1((Number(logins) || 0) / dens[key]) : null,
    // part des utilisateurs habilités qui se sont connectés au moins une fois
    adoptionRate: rate(dens.active_users, dens.enabled_users),
  };
}

/**
 * 2.5 — Taux de réalisation des coachings. Les trois lectures sont calculées ;
 * `mode` désigne celle affichée en principal (paramétrable).
 */
function coachingCompletion({ doneInPeriod, monthsInPeriod, doneLast12Months, activeAgents, annualTarget, perAgent, mode }) {
  const months = Math.max(1, Number(monthsInPeriod) || 1);
  const target = Number(annualTarget) || 0;
  const agents = Number(activeAgents) || 0;
  const expected = target > 0 ? (target * (perAgent ? agents : 1) * months) / 12 : 0;
  return {
    mode: ["monthly_average", "annual_target", "rolling_12"].includes(mode) ? mode : "annual_target",
    doneInPeriod: Number(doneInPeriod) || 0,
    monthlyAverage: round1((Number(doneInPeriod) || 0) / months),
    rolling12MonthlyAverage: round1((Number(doneLast12Months) || 0) / 12),
    expectedInPeriod: round1(expected),
    targetAttainmentRate: rate(doneInPeriod, expected),
  };
}

/** 2.6 — Taux de couverture (par mois d'appel). */
function coverage({ done, expected }) {
  const d = Number(done) || 0;
  const e = Number(expected) || 0;
  return { done: d, expected: round1(e), remaining: round1(Math.max(0, e - d)), rate: rate(d, e) };
}

/** Visibilité d'une formation pour un utilisateur — même règle que GET /api/training. */
function isTrainingVisibleTo(t, u) {
  const roles = t.roles || [];
  const cells = t.targetCells || [];
  const users = (t.targetUsers || []).map(String);
  if (!roles.length && !cells.length && !users.length) return true;
  if (roles.includes(u.role)) return true;
  if (u.cell && cells.includes(u.cell)) return true;
  return users.includes(String(u._id));
}

/**
 * 2.7 — Taux de passation des quiz.
 * Quiz actif = formation active contenant au moins une question.
 * Pour chaque couple (utilisateur ciblé, quiz actif) : finalisé / en cours / non commencé / échu.
 */
function quizCompletion(trainings, users, now = new Date()) {
  const quizzes = (trainings || []).filter((t) => t.active !== false && Array.isArray(t.questions) && t.questions.length > 0);
  const totals = { activeQuizzes: quizzes.length, assignments: 0, finalized: 0, inProgress: 0, notStarted: 0, overdue: 0 };
  const byQuiz = [];
  for (const t of quizzes) {
    const done = new Set((t.attempts || []).map((a) => String(a.user)));
    const started = new Set((t.starts || []).map((s) => String(s.user)));
    const due = t.dueDate ? new Date(t.dueDate) : null;
    const isPastDue = !!(due && Number.isFinite(due.getTime()) && due < now);
    const row = { id: String(t._id), title: t.title || "", dueDate: t.dueDate || null, assignments: 0, finalized: 0, inProgress: 0, notStarted: 0, overdue: 0 };
    for (const u of users || []) {
      if (!isTrainingVisibleTo(t, u)) continue;
      row.assignments += 1;
      const id = String(u._id);
      if (done.has(id)) row.finalized += 1;
      else if (isPastDue) row.overdue += 1;
      else if (started.has(id)) row.inProgress += 1;
      else row.notStarted += 1;
    }
    row.rate = rate(row.finalized, row.assignments);
    byQuiz.push(row);
    for (const k of ["assignments", "finalized", "inProgress", "notStarted", "overdue"]) totals[k] += row[k];
  }
  // Lecture « quiz » du besoin : quiz actifs finalisés par tous leurs destinataires
  const quizzesFullyFinalized = byQuiz.filter((q) => q.assignments > 0 && q.finalized === q.assignments).length;
  return { ...totals, quizzesFullyFinalized, rate: rate(totals.finalized, totals.assignments), byQuiz };
}

/**
 * Regroupement des évaluations par dimension pour les tableaux et exports.
 * keyFn(score) -> { key, label }
 */
function breakdown(scores, keyFn, percentFn) {
  const map = new Map();
  for (const s of scores) {
    const k = keyFn(s) || { key: "", label: "—" };
    const key = String(k.key || "");
    if (!map.has(key)) map.set(key, { key, label: k.label || "—", count: 0, sumPct: 0, contested: 0, validated: 0 });
    const r = map.get(key);
    r.count += 1;
    r.sumPct += Number(percentFn ? percentFn(s) : 0) || 0;
    if (isEverContested(s)) r.contested += 1;
    if (s.pilotValidated) r.validated += 1;
  }
  return [...map.values()]
    .map((r) => ({
      key: r.key,
      label: r.label,
      count: r.count,
      avgPercent: r.count ? round1(r.sumPct / r.count) : null,
      contested: r.contested,
      contestationRate: rate(r.contested, r.count),
      validated: r.validated,
      validationRate: rate(r.validated, r.count),
    }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
}

/** Nombre d'évaluations par mois d'appel. */
function countByCallMonth(scores) {
  const out = {};
  for (const s of scores) {
    const m = callMonth(s);
    if (!m) continue;
    out[m] = (out[m] || 0) + 1;
  }
  return out;
}

/** Compte des types pour contrôle. */
function countByType(scores) {
  const out = {};
  for (const s of scores) {
    const t = typeOf(s);
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

module.exports = {
  rate, round1, monthKey, callRefDate, callMonth, monthsBetween, isEverContested, isCoachingDone,
  coachingValidation, evaluationValidation, evaluationContestation, usage, coachingCompletion, coverage,
  isTrainingVisibleTo, quizCompletion, breakdown, countByCallMonth, countByType,
};
