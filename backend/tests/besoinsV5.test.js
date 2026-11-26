"use strict";
// Liste des besoins v4 : quiz chronométré à tentative unique (le chronomètre ne repart pas de zéro)
const test = require("node:test");
const assert = require("node:assert/strict");

const { quizStartInfo } = require("../routes/training.routes")._test;

const U = "507f1f77bcf86cd799439011";
const NOW = Date.parse("2026-11-26T10:00:00Z");
const min = (n) => n * 60000;

test("quiz : premier passage = nouveau démarrage", () => {
  assert.equal(quizStartInfo({ timeLimitMinutes: 10, attempts: [], starts: [] }, U, NOW).action, "new");
});

test("quiz chronométré : un passage en cours reprend avec la même échéance", () => {
  const startedAt = new Date(NOW - min(3));
  const r = quizStartInfo({ timeLimitMinutes: 10, attempts: [], starts: [{ user: U, startedAt }] }, U, NOW);
  assert.equal(r.action, "resume");
  assert.equal(r.deadline.getTime(), startedAt.getTime() + min(10));
});

test("quiz à tentative unique : refus après une tentative", () => {
  const t = { allowMultipleAttempts: false, timeLimitMinutes: 0, attempts: [{ user: U, completedAt: new Date(NOW - min(60)) }], starts: [] };
  assert.equal(quizStartInfo(t, U, NOW).action, "blocked");
});

test("quiz à tentative unique : passage abandonné au-delà du délai = tentative perdue", () => {
  const t = { allowMultipleAttempts: false, timeLimitMinutes: 5, attempts: [], starts: [{ user: U, startedAt: new Date(NOW - min(30)) }] };
  assert.equal(quizStartInfo(t, U, NOW).action, "expired");
});

test("quiz à tentatives multiples : délai expiré = nouveau passage autorisé", () => {
  const t = { allowMultipleAttempts: true, timeLimitMinutes: 5, attempts: [], starts: [{ user: U, startedAt: new Date(NOW - min(30)) }] };
  assert.equal(quizStartInfo(t, U, NOW).action, "new");
});

test("quiz à tentatives multiples : après envoi, un nouveau passage redémarre le chronomètre", () => {
  const t = {
    allowMultipleAttempts: true, timeLimitMinutes: 5,
    attempts: [{ user: U, completedAt: new Date(NOW - min(1)) }],
    starts: [{ user: U, startedAt: new Date(NOW - min(2)) }],
  };
  assert.equal(quizStartInfo(t, U, NOW).action, "new");
});

test("quiz sans délai : toujours un nouveau passage tant que la tentative est permise", () => {
  const t = { timeLimitMinutes: 0, attempts: [], starts: [{ user: U, startedAt: new Date(NOW - min(500)) }] };
  assert.equal(quizStartInfo(t, U, NOW).action, "new");
});

test("quiz : le passage d'un autre utilisateur est ignoré", () => {
  const t = { allowMultipleAttempts: false, timeLimitMinutes: 5, attempts: [{ user: "x", completedAt: new Date() }], starts: [{ user: "x", startedAt: new Date(NOW - min(1)) }] };
  assert.equal(quizStartInfo(t, U, NOW).action, "new");
});
