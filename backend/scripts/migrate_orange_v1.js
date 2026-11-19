#!/usr/bin/env node
/**
 * Migration « Contrat Orange » v1 — idempotente, sans suppression.
 *
 * Par défaut : SIMULATION (aucune écriture). Ajouter --apply pour écrire.
 *
 *   node scripts/migrate_orange_v1.js                       # rapport seul
 *   node scripts/migrate_orange_v1.js --apply               # types / usages par défaut
 *   node scripts/migrate_orange_v1.js --apply --default-contract=Bytel
 *        → renseigne contrat "Bytel" sur les utilisateurs et cellules SANS contrat
 *   node scripts/migrate_orange_v1.js --apply --default-project="Bytel B2C"
 *   node scripts/migrate_orange_v1.js --apply --propagate-cells
 *        → recopie projet / contrat de chaque cellule vers ses membres (champs vides seulement)
 *
 * Variables : MONGO_URI (déjà présente dans le conteneur backend).
 */
require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/User");
const Cell = require("../models/Cell");
const Score = require("../models/Score");
const Grid = require("../models/Grid");
const Project = require("../models/Project");
const Contract = require("../models/Contract");
const ClosureCode = require("../models/ClosureCode");
const Sample = require("../models/Sample");
const LoginEvent = require("../models/LoginEvent");
const AppSetting = require("../models/AppSetting");
const EvaluationTarget = require("../models/EvaluationTarget");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const opt = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3).replace(/^"|"$/g, "").trim() : "";
};
const DEFAULT_CONTRACT = opt("default-contract");
const DEFAULT_PROJECT = opt("default-project");
const PROPAGATE = args.includes("--propagate-cells");
const EMPTY = { $in: ["", null] };
const emptyOrMissing = (f) => ({ $or: [{ [f]: EMPTY }, { [f]: { $exists: false } }] });

async function step(label, filter, Model, update) {
  const n = await Model.countDocuments(filter);
  if (APPLY && n > 0) {
    const r = await Model.updateMany(filter, update);
    console.log(`  ✔ ${label} : ${r.modifiedCount ?? r.nModified ?? 0} document(s) mis à jour`);
  } else {
    console.log(`  ${APPLY ? "✔" : "…"} ${label} : ${n} document(s) ${APPLY ? "(rien à faire)" : "concerné(s)"}`);
  }
}

(async () => {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/kcq";
  await mongoose.connect(uri);
  console.log(`Connexion : ${uri.replace(/\/\/[^@]*@/, "//***@")}`);
  console.log(APPLY ? "MODE ÉCRITURE (--apply)\n" : "MODE SIMULATION (ajouter --apply pour écrire)\n");

  console.log("1) Valeurs par défaut des nouveaux champs");
  await step("Évaluations sans type → standard", { evaluationType: { $exists: false } }, Score, { $set: { evaluationType: "standard" } });
  await step("Grilles sans usage → evaluation", { usage: { $exists: false } }, Grid, { $set: { usage: "evaluation" } });

  console.log("\n2) Index des nouvelles collections (création seule, aucun index supprimé)");
  for (const M of [Project, Contract, ClosureCode, Sample, LoginEvent, AppSetting, EvaluationTarget, Score, User, Grid]) {
    if (APPLY) await M.createIndexes();
    console.log(`  ${APPLY ? "✔" : "…"} ${M.modelName}`);
  }

  if (DEFAULT_CONTRACT || DEFAULT_PROJECT) {
    console.log("\n3) Rattachement par défaut des profils existants (champs vides uniquement)");
    if (DEFAULT_CONTRACT) {
      if (APPLY) await Contract.updateOne({ name: DEFAULT_CONTRACT }, { $setOnInsert: { name: DEFAULT_CONTRACT, project: DEFAULT_PROJECT || "" } }, { upsert: true });
      await step(`Utilisateurs sans contrat → ${DEFAULT_CONTRACT}`, { $and: [emptyOrMissing("contract"), { role: { $ne: "admin" } }] }, User, { $set: { contract: DEFAULT_CONTRACT } });
      await step(`Cellules sans contrat → ${DEFAULT_CONTRACT}`, emptyOrMissing("contract"), Cell, { $set: { contract: DEFAULT_CONTRACT } });
    }
    if (DEFAULT_PROJECT) {
      if (APPLY) await Project.updateOne({ name: DEFAULT_PROJECT }, { $setOnInsert: { name: DEFAULT_PROJECT } }, { upsert: true });
      await step(`Utilisateurs sans projet → ${DEFAULT_PROJECT}`, { $and: [emptyOrMissing("project"), { role: { $ne: "admin" } }] }, User, { $set: { project: DEFAULT_PROJECT } });
      await step(`Cellules sans projet → ${DEFAULT_PROJECT}`, emptyOrMissing("project"), Cell, { $set: { project: DEFAULT_PROJECT } });
    }
  }

  if (PROPAGATE) {
    console.log("\n4) Recopie projet / contrat des cellules vers leurs membres (champs vides uniquement)");
    const cells = await Cell.find({}).lean();
    for (const c of cells) {
      for (const f of ["project", "contract"]) {
        if (!c[f]) continue;
        await step(`Cellule « ${c.name} » : ${f} = ${c[f]}`, { $and: [{ cell: c.name }, emptyOrMissing(f)] }, User, { $set: { [f]: c[f] } });
      }
    }
  }

  console.log("\n5) Rapport des profils actifs (préparation du contrôle d'accès)");
  const users = await User.find({ active: { $ne: false } }).select("role cell project contract visibilityScope").lean();
  const byRole = {};
  for (const u of users) {
    const r = (byRole[u.role] = byRole[u.role] || { total: 0, sansCellule: 0, sansProjet: 0, sansContrat: 0 });
    r.total += 1;
    if (!u.cell) r.sansCellule += 1;
    if (!u.project) r.sansProjet += 1;
    if (!u.contract) r.sansContrat += 1;
  }
  console.table(byRole);
  const blocking = users.filter((u) => ["management", "supervision"].includes(u.role) && !u.cell && !u.visibilityScope).length;
  console.log(blocking
    ? `⚠ ${blocking} profil(s) Management/Supervision sans cellule : ils ne verraient aucune donnée si le contrôle d'accès est activé.`
    : "✔ Tous les profils Management/Supervision ont une cellule.");

  await mongoose.disconnect();
  console.log("\nTerminé.");
})().catch(async (e) => {
  console.error("Échec de la migration :", e?.message || e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
