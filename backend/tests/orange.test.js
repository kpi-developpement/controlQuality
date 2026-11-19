// Tests unitaires « contrat Orange » — sans base de données ni dépendance supplémentaire.
// Exécution : node --test tests/
const { test } = require("node:test");
const assert = require("node:assert/strict");
const K = require("../utils/kpi");
const { computeScope, userFilterForScope, sampleFilterForScope, matchesScopeFields, DENY } = require("../utils/scope");
const { typeClause, parseTypes, normalizeType, normalizeDirection } = require("../utils/evalTypes");
const { validateSetting } = require("../utils/settings");

const ID = "64b000000000000000000001";

test("Taux : pourcentage à une décimale, null si dénominateur nul", () => {
  assert.equal(K.rate(1, 3), 33.3);
  assert.equal(K.rate(2, 2), 100);
  assert.equal(K.rate(5, 0), null);
});

test("Mois d'appel : callDate prioritaire, createdAt à défaut, en UTC", () => {
  assert.equal(K.callMonth({ callDate: "2026-10-31T00:00:00.000Z", createdAt: "2026-11-02T10:00:00Z" }), "2026-10");
  assert.equal(K.callMonth({ callDate: null, createdAt: "2026-11-02T10:00:00Z" }), "2026-11");
  assert.deepEqual(K.monthsBetween("2026-11-15", "2027-02-01"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
});

test("Contestation : une contestation traitée reste comptée", () => {
  assert.equal(K.isEverContested({ contested: false, reevaluatedAt: new Date() }), true);
  assert.equal(K.isEverContested({ contested: false, contestComment: "  motif " }), true);
  assert.equal(K.isEverContested({ contested: false }), false);
  const r = K.evaluationContestation([{ contested: true }, { reevaluatedAt: 1 }, {}, {}]);
  assert.deepEqual([r.contested, r.open, r.received, r.rate], [2, 1, 4, 50]);
});

test("Validation des coachings et des évaluations", () => {
  assert.deepEqual(K.coachingValidation([{ pilotAcknowledged: true }, {}, {}]), { validated: 1, received: 3, pending: 2, rate: 33.3 });
  assert.equal(K.evaluationValidation([{ pilotValidated: true }, { pilotValidated: true }, {}]).rate, 66.7);
});

test("Taux d'utilisation : trois dénominateurs possibles", () => {
  const u = K.usage({ logins: 120, distinctLoggedUsers: 30, enabledUsers: 40, expectedUsers: 50, denominator: "enabled_users" });
  assert.equal(u.loginsPerUser, 3);
  assert.equal(u.adoptionRate, 75);
  assert.equal(K.usage({ logins: 120, distinctLoggedUsers: 30, enabledUsers: 40, expectedUsers: 50, denominator: "active_users" }).loginsPerUser, 4);
  assert.equal(K.usage({ logins: 120, distinctLoggedUsers: 30, enabledUsers: 40, expectedUsers: 0, denominator: "expected_users" }).loginsPerUser, null);
});

test("Réalisation des coachings : moyenne mensuelle, objectif annuel, 12 mois glissants", () => {
  const r = K.coachingCompletion({ doneInPeriod: 10, monthsInPeriod: 1, doneLast12Months: 96, activeAgents: 10, annualTarget: 12, perAgent: true, mode: "annual_target" });
  assert.equal(r.monthlyAverage, 10);
  assert.equal(r.rolling12MonthlyAverage, 8);
  assert.equal(r.expectedInPeriod, 10); // 12/an/agent × 10 agents × 1/12
  assert.equal(r.targetAttainmentRate, 100);
});

test("Couverture : restant jamais négatif", () => {
  assert.deepEqual(K.coverage({ done: 12, expected: 10 }), { done: 12, expected: 10, remaining: 0, rate: 120 });
  assert.equal(K.coverage({ done: 3, expected: 0 }).rate, null);
});

test("Quiz : finalisés, en cours, non commencés, échus", () => {
  const users = [{ _id: "u1", role: "pilote", cell: "A" }, { _id: "u2", role: "pilote", cell: "A" }, { _id: "u3", role: "cq", cell: "B" }];
  const now = new Date("2026-11-10");
  const trainings = [
    { _id: "t1", active: true, questions: [{}], roles: [], targetCells: [], targetUsers: [], attempts: [{ user: "u1" }], starts: [{ user: "u2" }] },
    { _id: "t2", active: true, questions: [{}], roles: ["pilote"], dueDate: "2026-11-01", attempts: [], starts: [] },
    { _id: "t3", active: true, questions: [], roles: [] }, // sans question : pas un quiz
    { _id: "t4", active: false, questions: [{}], roles: [] }, // inactif
  ];
  const r = K.quizCompletion(trainings, users, now);
  assert.equal(r.activeQuizzes, 2);
  assert.equal(r.assignments, 5); // t1 : 3 utilisateurs, t2 : 2 pilotes
  assert.equal(r.finalized, 1);
  assert.equal(r.inProgress, 1);
  assert.equal(r.notStarted, 1);
  assert.equal(r.overdue, 2);
  assert.equal(r.rate, 20);
});

test("Ventilation : moyenne, contestations, validations", () => {
  const rows = K.breakdown(
    [{ c: "A", p: 80, contested: true }, { c: "A", p: 60, pilotValidated: true }, { c: "B", p: 100 }],
    (s) => ({ key: s.c, label: s.c }),
    (s) => s.p
  );
  assert.equal(rows[0].key, "A");
  assert.equal(rows[0].avgPercent, 70);
  assert.equal(rows[0].contestationRate, 50);
  assert.equal(rows[0].validationRate, 50);
});

test("Types : les évaluations anciennes sans type sont « standard »", () => {
  assert.deepEqual(parseTypes("standard,picking,inconnu"), ["standard", "picking"]);
  assert.equal(typeClause([]), null);
  assert.ok(typeClause(["standard"]).$or.some((c) => c.evaluationType && c.evaluationType.$exists === false));
  assert.deepEqual(typeClause(["calibration"]), { evaluationType: { $in: ["calibration"] } });
  assert.equal(normalizeType("xx"), "standard");
  assert.equal(normalizeDirection("Sortant"), "outbound");
  assert.equal(normalizeDirection("in"), ""); // convention MySQL inversée : jamais devinée
});

test("Périmètre : admin, CQ et formateur inchangés", () => {
  for (const role of ["admin", "cq", "formateur"]) {
    const s = computeScope({ _id: ID, role, cell: "A" }, {}, true);
    assert.equal(s.unrestricted, true, role);
    assert.equal(userFilterForScope(s), null);
  }
});

test("Périmètre : Management historique tant que le contrôle n'est pas activé", () => {
  assert.equal(computeScope({ _id: ID, role: "management", cell: "A" }, {}, false).unrestricted, true);
  const on = computeScope({ _id: ID, role: "management", cell: "A", project: "P", contract: "Orange" }, {}, true);
  const f = userFilterForScope(on);
  const rxA = f.$and[0].$or[0].cell;
  assert.ok(rxA.test("a") && rxA.test(" A "));
  assert.deepEqual(f.$and.slice(1), [
    { $or: [{ project: "P" }, { project: "" }, { project: null }] },
    { $or: [{ contract: "Orange" }, { contract: "" }, { contract: null }] },
  ]);
});

test("Périmètre : Supervision toujours limitée, refus si aucune cellule", () => {
  const s = computeScope({ _id: ID, role: "supervision", cell: "", extraCells: [] }, {}, false);
  assert.equal(userFilterForScope(s), DENY);
  const s2 = computeScope({ _id: ID, role: "supervision", cell: "A", extraCells: ["B", "A"] }, {}, false);
  const f2 = userFilterForScope(s2);
  assert.equal(f2.$and.length, 1);
  assert.equal(f2.$and[0].$or.length, 2);
  assert.ok(f2.$and[0].$or[1].cell.test("b"));
  assert.deepEqual(sampleFilterForScope(s2), f2);
});

test("Périmètre explicite saisi par l'admin toujours appliqué (ex. CQ limité au contrat)", () => {
  const s = computeScope({ _id: ID, role: "cq", visibilityScope: "contract", contract: "Orange" }, {}, false);
  assert.deepEqual(userFilterForScope(s), { contract: "Orange" });
  assert.equal(userFilterForScope(computeScope({ _id: ID, role: "cq", visibilityScope: "contract", contract: "" }, {}, false)), DENY);
  // l'admin ne peut pas être restreint
  assert.equal(computeScope({ _id: ID, role: "admin", visibilityScope: "cell" }, {}, true).unrestricted, true);
});

test("Paramètres : validation stricte", () => {
  assert.equal(validateSetting("accessScopeEnforced", "true"), true);
  assert.equal(validateSetting("coachingAnnualTarget", "12"), 12);
  assert.throws(() => validateSetting("usageDenominator", "x"));
  assert.throws(() => validateSetting("inconnu", 1));
  assert.throws(() => validateSetting("coachingAnnualTarget", -1));
  assert.deepEqual(validateSetting("usageRoles", ["pilote", "pirate"]), ["pilote"]);
});

test("Périmètre cellule : casse, accents et espaces ignorés ; projet/contrat vides tolérés, autre projet exclu", () => {
  const sc = computeScope({ _id: ID, role: "management", cell: "Presta Réseau CV", project: "Fibre", contract: "Orange" }, {}, true);
  const rx = userFilterForScope(sc).$and[0].$or[0].cell;
  for (const v of ["Presta Réseau CV", "presta reseau cv", " PRESTA  RÉSEAU CV "]) assert.ok(rx.test(v), v);
  for (const v of ["Presta Réseau CV2", "Presta.Réseau CV", "Autre"]) assert.ok(!rx.test(v), v);
  assert.equal(matchesScopeFields(sc, { cell: "presta reseau cv", project: "", contract: "" }), true);
  assert.equal(matchesScopeFields(sc, { cell: "presta reseau cv", project: "Mobile" }), false);
  assert.equal(matchesScopeFields(sc, { cell: "presta reseau cv", contract: "Bytel" }), false);
  assert.equal(matchesScopeFields(sc, { cell: "Autre" }), false);
});
