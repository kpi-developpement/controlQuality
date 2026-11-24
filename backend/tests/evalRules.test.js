"use strict";
// Règles de saisie : date d'appel ≠ jour J, mois de prime obligatoire, quiz à tentative unique
const test = require("node:test");
const assert = require("node:assert/strict");
const { primeMonthError, callDateError, callDayKey, todayKey, quizAttemptInfo } = require("../utils/evalRules");

// 21/11/2026 à 11h (heure de Casablanca, UTC+1)
const NOW = new Date("2026-11-21T10:00:00Z");

test("Date du jour calculée dans le fuseau de l'entreprise", () => {
  assert.equal(todayKey(NOW), "2026-11-21");
  // le jour dépend du fuseau : 23h30 UTC le 21 = déjà le 22 à Tokyo
  assert.equal(todayKey(new Date("2026-11-21T23:30:00Z"), "Asia/Tokyo"), "2026-11-22");
  assert.equal(todayKey(new Date("2026-11-21T23:30:00Z"), "UTC"), "2026-11-21");
});

test("Date d'appel : jour saisi lu sans décalage", () => {
  assert.equal(callDayKey("2026-11-20"), "2026-11-20");
  assert.equal(callDayKey(new Date("2026-11-20").toISOString()), "2026-11-20");
  assert.equal(callDayKey(""), "");
  assert.equal(callDayKey("pas une date"), "");
});

test("Date d'appel obligatoire", () => {
  assert.match(callDateError(null, "standard", NOW), /obligatoire/);
  assert.match(callDateError("", "sample", NOW), /obligatoire/);
});

test("Date d'appel égale au jour J refusée", () => {
  assert.match(callDateError(new Date("2026-11-21").toISOString(), "standard", NOW), /différente du jour/);
  assert.match(callDateError("2026-11-21", "calibration", NOW), /différente du jour/);
});

test("Date d'appel future refusée, date passée acceptée", () => {
  assert.match(callDateError("2026-11-25", "standard", NOW), /futur/);
  assert.equal(callDateError(new Date("2026-11-20").toISOString(), "standard", NOW), "");
  assert.equal(callDateError("2026-10-02", "sample", NOW), "");
});

test("Picking : date issue de l'enregistrement, le jour J reste accepté", () => {
  assert.equal(callDateError(new Date("2026-11-21T08:00:00Z").toISOString(), "picking", NOW), "");
  assert.match(callDateError(null, "picking", NOW), /obligatoire/);
});

test("Mois de prime obligatoire hors calibrage, format AAAA-MM", () => {
  assert.match(primeMonthError("", "standard"), /obligatoire/);
  assert.match(primeMonthError("", "picking"), /obligatoire/);
  assert.match(primeMonthError("", "sample"), /obligatoire/);
  assert.equal(primeMonthError("", "calibration"), "");
  assert.equal(primeMonthError("2026-11", "standard"), "");
  assert.match(primeMonthError("2026-13", "standard"), /invalide/);
  assert.match(primeMonthError("11/2026", "calibration"), /invalide/);
});

test("Quiz à tentative unique : bloqué après la première tentative", () => {
  const quiz = { allowMultipleAttempts: false, questions: [{ question: "?", options: ["a", "b"] }], attempts: [] };
  assert.equal(quizAttemptInfo(quiz, "u1").canAttempt, true);
  quiz.attempts.push({ user: "u1", score: 1, total: 1 });
  const info = quizAttemptInfo(quiz, "u1");
  assert.equal(info.canAttempt, false);
  assert.equal(info.myAttempts, 1);
  assert.equal(info.myLastPercent, 100);
  // un autre utilisateur peut toujours le passer
  assert.equal(quizAttemptInfo(quiz, "u2").canAttempt, true);
});

test("Quiz à tentatives multiples : toujours autorisé ; sans question : jamais", () => {
  const quiz = { allowMultipleAttempts: true, questions: [{ question: "?" }], attempts: [{ user: "u1", score: 0, total: 2 }] };
  assert.equal(quizAttemptInfo(quiz, "u1").canAttempt, true);
  assert.equal(quizAttemptInfo({ questions: [], attempts: [] }, "u1").canAttempt, false);
  // documents anciens sans le champ : tentatives multiples par défaut
  assert.equal(quizAttemptInfo({ questions: [{}], attempts: [{ user: "u1", score: 1, total: 1 }] }, "u1").canAttempt, true);
});
