"use strict";
// backend/utils/evalRules.js — règles de saisie des évaluations et des quiz (testées dans tests/)

const PRIME_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TZ = "Africa/Casablanca";

/** Date du jour (AAAA-MM-JJ) dans le fuseau de l'entreprise. */
function todayKey(now = new Date(), timeZone = TZ) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Jour calendaire saisi pour la date d'appel.
 * Le frontend envoie « AAAA-MM-JJ » converti en ISO à minuit UTC : la partie date UTC est le jour choisi.
 */
function callDayKey(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Mois de prime : obligatoire hors calibrage, format AAAA-MM.
 * Retourne un message d'erreur, ou "" si valide.
 */
function primeMonthError(value, evalType) {
  const v = String(value || "").trim();
  if (v && !PRIME_MONTH_RE.test(v)) return "Mois de prime invalide (format AAAA-MM).";
  if (!v && evalType !== "calibration") return "Le mois concerné par la prime est obligatoire.";
  return "";
}

/**
 * Date d'appel : obligatoire et strictement antérieure au jour de l'évaluation (jour J).
 * Exception : en picking, la date provient de l'enregistrement de l'appel (non saisie).
 */
function callDateError(value, evalType, now = new Date()) {
  const day = callDayKey(value);
  if (!day) return "La date de l'appel est obligatoire.";
  if (evalType === "picking") return new Date(value).getTime() > now.getTime() + 864e5 ? "La date de l'appel ne peut pas être dans le futur." : "";
  const today = todayKey(now);
  if (day === today) return "La date de l'appel doit être différente du jour de l'évaluation.";
  if (day > today) return "La date de l'appel ne peut pas être dans le futur.";
  return "";
}

/** Tentatives de quiz de l'utilisateur et droit de (re)passer le quiz. */
function quizAttemptInfo(training, userId) {
  const t = training || {};
  const mine = (t.attempts || []).filter((a) => String(a.user) === String(userId));
  const pct = (a) => (a.total > 0 ? Math.round((a.score / a.total) * 100) : 0);
  const last = mine[mine.length - 1];
  return {
    myAttempts: mine.length,
    myBestPercent: mine.length ? Math.max(...mine.map(pct)) : null,
    myLastPercent: last ? pct(last) : null,
    myLastAt: last ? last.completedAt : null,
    canAttempt: (t.questions || []).length > 0 && (t.allowMultipleAttempts !== false || mine.length === 0),
  };
}

module.exports = { PRIME_MONTH_RE, todayKey, callDayKey, primeMonthError, callDateError, quizAttemptInfo };
