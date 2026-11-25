"use strict";
// Rôles calqués sur Management, périmètre « pôle » et copie chiffrée des mots de passe
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "secret-de-test";
const { sealPassword, openPassword } = require("../utils/passwordVault");
const permit = require("../middleware/roles");
const { computeScope, userFilterForScope, matchesScopeFields, DENY } = require("../utils/scope");

function run(mw, role) {
  let status = 200;
  let nexted = false;
  const res = { status(c) { status = c; return { json() {} }; } };
  mw({ user: { role } }, res, () => { nexted = true; });
  return nexted ? 200 : status;
}

test("Superviseur, Référent technique et Chef de projet ont les accès du Management", () => {
  const mw = permit("admin", "management");
  for (const r of ["management", "superviseur", "referent", "cdp", "admin"]) assert.equal(run(mw, r), 200, r);
  for (const r of ["cq", "pilote", "formateur"]) assert.equal(run(mw, r), 403, r);
});

test("Une route sans Management n'est pas ouverte aux rôles calqués", () => {
  const mw = permit("admin", "superviseur");
  assert.equal(run(mw, "superviseur"), 200);
  for (const r of ["referent", "cdp", "management", "cq"]) assert.equal(run(mw, r), 403, r);
});

test("Périmètres par défaut : CDP = contrat, Superviseur / RT = pôle", () => {
  assert.equal(computeScope({ role: "cdp", contract: "Bytel" }, null, true).mode, "contract");
  assert.equal(computeScope({ role: "superviseur" }, null, true).mode, "pole");
  assert.equal(computeScope({ role: "referent" }, null, false).mode, "pole");
  // un périmètre explicite saisi par l'admin reste prioritaire
  assert.equal(computeScope({ role: "referent", visibilityScope: "team" }, null, true).mode, "team");
});

test("Pôle : toutes les cellules des activités affectées, refus si aucune", () => {
  const scope = { ...computeScope({ role: "superviseur", cell: "Fès" }, null, true), poleCells: ["Fès", "Tanger"] };
  assert.ok(matchesScopeFields(scope, { cell: "Tanger" }));
  assert.ok(matchesScopeFields(scope, { cell: " fès " }));
  assert.equal(matchesScopeFields(scope, { cell: "Rabat" }), false);
  assert.equal(userFilterForScope({ ...scope, poleCells: [] }), DENY);
  assert.equal(userFilterForScope(scope).$or.length, 2);
});

test("Chef de projet sans contrat : aucun agent visible", () => {
  assert.equal(userFilterForScope(computeScope({ role: "cdp" }, null, true)), DENY);
  assert.deepEqual(userFilterForScope(computeScope({ role: "cdp", contract: "Bytel" }, null, true)), { contract: "Bytel" });
});

test("Mot de passe : copie chiffrée, jamais en clair, relisible avec la clé", () => {
  const sealed = sealPassword("Kyntus@2026!");
  assert.ok(sealed.startsWith("v1."));
  assert.equal(sealed.includes("Kyntus"), false);
  assert.notEqual(sealPassword("Kyntus@2026!"), sealed); // IV aléatoire
  assert.equal(openPassword(sealed), "Kyntus@2026!");
});

test("Mot de passe : donnée altérée, absente ou clé changée → non consultable", () => {
  const sealed = sealPassword("abc123");
  const parts = sealed.split(".");
  parts[3] = Buffer.from("autre").toString("base64url");
  assert.equal(openPassword(parts.join(".")), null);
  assert.equal(openPassword(""), null);
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "autre-secret";
  assert.equal(openPassword(sealed), null);
  process.env.JWT_SECRET = old;
  assert.equal(openPassword(sealed), "abc123");
});
