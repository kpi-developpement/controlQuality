/* eslint-disable no-console */
/**
 * Données de démonstration (base LOCALE uniquement).
 *
 *   node scripts/seed.js            → crée les données de démo (si absentes)
 *   node scripts/seed.js --reset    → supprime les données de démo puis les recrée
 *   node scripts/seed.js --clean    → supprime seulement les données de démo
 *
 * Toutes les données créées sont repérables : emails en @demo.kcq, grilles « (démo) »,
 * référentiels avec la description « seed-demo ». Les autres données ne sont jamais touchées.
 * Refuse de s'exécuter sur une base distante (sauf --force).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Score = require("../models/Score");
const Grid = require("../models/Grid");
const Coaching = require("../models/Coaching");
const Training = require("../models/Training");
const Cell = require("../models/Cell");
const Project = require("../models/Project");
const Contract = require("../models/Contract");
const Sample = require("../models/Sample");
const Notification = require("../models/Notification");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/kcq";
const ARGS = new Set(process.argv.slice(2));
const DOMAIN = "demo.kcq";
const PASSWORD = "Demo@2026";
const TAG = "seed-demo";

// ---------- Aléatoire reproductible ----------
let seed = 20261118;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const daysAgo = (d, h = int(8, 18)) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, int(0, 59), 0, 0); return t; };
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

const FIRST = ["Yassine", "Salma", "Omar", "Imane", "Hamza", "Khadija", "Mehdi", "Sara", "Anas", "Nora", "Ayoub", "Hiba",
  "Reda", "Meryem", "Ilyas", "Zineb", "Amine", "Houda", "Karim", "Fatima", "Adam", "Lina", "Soufiane", "Ghita", "Walid", "Rim", "Othmane", "Asmae"];
const LAST = ["Benali", "El Amrani", "Alaoui", "Bennani", "Tazi", "Idrissi", "Chraibi", "Berrada", "Fassi", "Kettani", "Lahlou",
  "Squalli", "Ouazzani", "Naciri", "Benjelloun", "Sefrioui", "Lamrani", "Zerouali", "Hajji", "Rami"];
let nameIdx = 0;
const nextName = () => { const n = `${FIRST[nameIdx % FIRST.length]} ${LAST[(nameIdx * 7) % LAST.length]}`; nameIdx += 1; return n; };

// ---------- Référentiels ----------
const ACTIVITIES = [
  { project: "Orange", contract: "Orange Fibre", cells: ["Orange Fibre Rabat", "Orange Fibre Casablanca"] },
  { project: "Bytel", contract: "Bytel Mobile", cells: ["Bytel Mobile Fès", "Bytel Mobile Tanger"] },
];

const GRIDS = [
  {
    name: "Grille Qualité Orange (démo)",
    project: "Orange",
    items: [
      { type: "group", title: "Accueil", hardFail: false, malusPercent: 0 },
      { type: "item", label: "Formule d'accueil complète" },
      { type: "item", label: "Identification du client" },
      { type: "group", title: "Découverte du besoin" },
      { type: "item", label: "Questions de découverte pertinentes" },
      { type: "item", label: "Reformulation de la demande" },
      { type: "group", title: "Traitement" },
      { type: "item", label: "Solution adaptée et exacte" },
      { type: "item", label: "Respect des procédures" },
      { type: "item", label: "Mise à jour du dossier client" },
      { type: "group", title: "Conclusion" },
      { type: "item", label: "Récapitulatif des actions" },
      { type: "item", label: "Formule de fin d'appel" },
    ],
  },
  {
    name: "Grille Qualité Bytel (démo)",
    project: "Bytel",
    items: [
      { type: "group", title: "Prise en charge" },
      { type: "item", label: "Accueil personnalisé" },
      { type: "item", label: "Vérification de l'identité" },
      { type: "group", title: "Résolution" },
      { type: "item", label: "Diagnostic correct" },
      { type: "item", label: "Information exacte et complète" },
      { type: "item", label: "Proposition commerciale adaptée" },
      { type: "group", title: "Savoir-être" },
      { type: "item", label: "Ton et courtoisie" },
      { type: "item", label: "Gestion des silences et de l'attente" },
      { type: "item", label: "Prise de congé" },
    ],
  },
];

const CLOSURES = ["Résolu", "Escalade N2", "Rappel planifié", "Information donnée", "Réclamation"];

async function clean() {
  const demoUsers = await User.find({ email: new RegExp(`@${DOMAIN.replace(".", "\\.")}$`) }).select("_id").lean();
  const ids = demoUsers.map((u) => u._id);
  const r = {
    scores: (await Score.deleteMany({ $or: [{ pilot: { $in: ids } }, { evaluator: { $in: ids } }] })).deletedCount,
    coachings: (await Coaching.deleteMany({ pilot: { $in: ids } })).deletedCount,
    trainings: (await Training.deleteMany({ createdBy: { $in: ids } })).deletedCount,
    samples: (await Sample.deleteMany({ createdBy: { $in: ids } })).deletedCount,
    notifications: (await Notification.deleteMany({ createdBy: { $in: ids } })).deletedCount,
    grids: (await Grid.deleteMany({ name: / \(démo\)$/ })).deletedCount,
    cells: (await Cell.deleteMany({ description: TAG })).deletedCount,
    contracts: (await Contract.deleteMany({ description: TAG })).deletedCount,
    projects: (await Project.deleteMany({ description: TAG })).deletedCount,
    users: (await User.deleteMany({ _id: { $in: ids } })).deletedCount,
  };
  console.log("🧹 Données de démo supprimées :", r);
}

async function upsertRef(Model, filter, doc) {
  const existing = await Model.findOne(filter).lean();
  if (existing) return existing;
  return (await Model.create({ ...doc, description: TAG })).toObject();
}

async function seedAll() {
  if (await User.exists({ email: `admin@${DOMAIN}` })) {
    console.log("ℹ️  Les données de démo existent déjà. Utilisez --reset pour les recréer.");
    return;
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = async (name, role, extra = {}, local = null) => User.create({
    name, role, passwordHash, active: true, email: `${local || slug(name)}@${DOMAIN}`, ...extra,
  });

  // Référentiels
  for (const a of ACTIVITIES) {
    await upsertRef(Project, { name: a.project }, { name: a.project, active: true });
    await upsertRef(Contract, { name: a.contract }, { name: a.contract, project: a.project, active: true });
    for (const c of a.cells) await upsertRef(Cell, { name: c }, { name: c, project: a.project, contract: a.contract, active: true });
  }

  // Comptes transverses
  const admin = await mk("Admin Démo", "admin", {}, "admin");
  const cqs = [await mk("Nadia Chafik", "cq", {}, "cq1"), await mk("Rachid Mansouri", "cq", {}, "cq2")];
  const formateur = await mk("Leila Bouzid", "formateur", {}, "formateur");
  const evaluatorsCQ = [...cqs, formateur];

  const pilots = [];
  const referents = [];
  const superviseurs = [];
  const cdps = [];

  for (const [ai, a] of ACTIVITIES.entries()) {
    const key = a.project.toLowerCase();
    cdps.push(await mk(`Chef de projet ${a.project}`, "cdp", { project: a.project, contract: a.contract }, `cdp.${key}`));
    const sup = await mk(nextName(), "superviseur", { project: a.project, contract: a.contract, cell: a.cells[0], extraCells: a.cells.slice(1) }, `superviseur.${key}`);
    superviseurs.push(sup);
    for (const [ci, cell] of a.cells.entries()) {
      const ref = await mk(nextName(), "referent", { project: a.project, contract: a.contract, cell, superviseur: sup._id }, `referent.${key}${ci + 1}`);
      referents.push(ref);
      const nb = 6 + ((ai + ci) % 2);
      for (let i = 0; i < nb; i++) {
        const p = await mk(nextName(), "pilote", { project: a.project, contract: a.contract, cell, referent: ref._id, superviseur: sup._id },
          `pilote.${key}${ci + 1}.${i + 1}`);
        p._skill = 0.62 + rnd() * 0.34; // niveau de conformité moyen de l'agent
        p._activity = a;
        pilots.push(p);
      }
    }
  }

  // Grilles
  const grids = {};
  for (const g of GRIDS) {
    const doc = await Grid.create({
      name: g.name, description: `Grille de démonstration — ${g.project}`, gridType: "classic", usage: "all", active: true,
      roles: ["cq", "formateur", "referent", "superviseur", "management"],
      items: g.items.map((it, i) => ({ ...it, order: i, pointsConforme: 1, pointsNonConforme: 0 })),
    });
    grids[g.project] = doc;
  }

  // Évaluations (3 derniers mois)
  const scores = [];
  for (const p of pilots) {
    const a = p._activity;
    const grid = grids[a.project];
    const ref = referents.find((r) => String(r._id) === String(p.referent));
    const sup = superviseurs.find((s) => String(s._id) === String(p.superviseur));
    const n = int(6, 11);
    for (let k = 0; k < n; k++) {
      const age = int(0, 88);
      const roll = rnd();
      const evaluator = roll < 0.7 ? pick(evaluatorsCQ) : roll < 0.85 ? ref : sup;
      const items = grid.items.map((gi) => {
        if (gi.type === "group") return { label: gi.title, status: "", value: 0 };
        const r = rnd();
        const status = r < 0.06 ? "NA" : r < 0.06 + p._skill ? "C" : "NC";
        return { label: gi.label, status, value: status === "C" ? 1 : 0 };
      });
      const callDate = daysAgo(age + int(0, 3));
      const evalDate = daysAgo(age);
      scores.push({
        pilot: p._id, evaluator: evaluator._id, gridId: grid._id,
        callDate, interactionDate: evalDate, evaluationDate: evalDate, listeningDate: evalDate,
        eps: `EPS-${a.project.slice(0, 2).toUpperCase()}${int(100000, 999999)}`,
        callDuration: `${int(2, 14)}:${String(int(0, 59)).padStart(2, "0")}`,
        callDirection: rnd() < 0.75 ? "inbound" : "outbound",
        closureCode: pick(CLOSURES),
        comment: pick(["Bon appel, client satisfait.", "Reformulation à améliorer.", "Procédure respectée.", "Attention aux temps d'attente.", "Très bonne écoute active.", ""]),
        items, evaluationType: "standard",
        cellAtEvaluation: p.cell, projectAtEvaluation: a.project, contractAtEvaluation: a.contract,
        pilotValidated: age > 7 && rnd() < 0.7,
        pilotValidatedAt: age > 7 ? daysAgo(age - 2) : null,
        createdAt: evalDate, updatedAt: evalDate,
        _ref: ref, _sup: sup,
      });
    }
  }

  // Contestations : ~12 % des évaluations CQ / Formateur
  const cqIds = new Set(evaluatorsCQ.map((u) => String(u._id)));
  for (const s of scores) {
    if (!cqIds.has(String(s.evaluator)) || rnd() > 0.12) continue;
    const by = rnd() < 0.6 ? s._ref : s._sup;
    const state = pick(["pending", "pending", "accepted", "rejected"]);
    Object.assign(s, {
      contested: state !== "rejected",
      contestStatus: state,
      contestedBy: by._id,
      contestComment: pick(["Le client a interrompu l'agent, critère non applicable.", "La procédure a été respectée selon la note interne.", "Appel transféré, l'agent n'était pas responsable de la conclusion."]),
      contestedAt: new Date(s.evaluationDate.getTime() + 86400000),
      pilotValidated: false, pilotValidatedAt: null,
    });
    if (state !== "pending") {
      Object.assign(s, {
        arbitratedBy: pick(evaluatorsCQ)._id,
        arbitratedAt: new Date(s.evaluationDate.getTime() + 2 * 86400000),
        arbitrationComment: state === "accepted" ? "Contestation fondée, l'évaluation sera corrigée." : "Critère bien non conforme d'après l'écoute.",
      });
    }
  }
  const inserted = await Score.insertMany(scores.map(({ _ref, _sup, ...s }) => s), { timestamps: false });

  // Coachings
  const coachings = [];
  for (let i = 0; i < 22; i++) {
    const sc = pick(inserted);
    const p = pilots.find((x) => String(x._id) === String(sc.pilot));
    const coach = rnd() < 0.6 ? superviseurs.find((s) => String(s._id) === String(p.superviseur)) : pick(cqs);
    const status = pick(["open", "in_progress", "done", "done"]);
    coachings.push({
      score: sc._id, pilot: p._id, evaluator: sc.evaluator, coach: coach._id,
      notes: pick(["Manque de reformulation en début d'appel.", "Procédure de vérification d'identité incomplète.", "Bonne maîtrise technique, travailler la conclusion."]),
      actionPlan: pick(["Écoute croisée de 3 appels avec le référent.", "Relire la fiche procédure et faire un quiz.", "Mise en situation avec le superviseur."]),
      status,
      followUpDate: daysAgo(int(-10, 15)),
      pilotAcknowledged: status === "done" && rnd() < 0.8,
      pilotComment: status === "done" ? pick(["Merci pour les conseils.", "Bien compris.", ""]) : "",
      pilotAcknowledgedAt: status === "done" ? daysAgo(int(1, 20)) : null,
    });
  }
  await Coaching.insertMany(coachings);

  // Formations (formateur)
  const orangePilots = pilots.filter((p) => p._activity.project === "Orange");
  const trainings = [
    {
      title: "Les fondamentaux de l'accueil client", category: "Savoir-être",
      description: "Formule d'accueil, ton, reformulation et prise de congé.",
      targetUsers: orangePilots.slice(0, 8).map((p) => p._id),
      questions: [
        { question: "Quelle est la première étape d'un appel ?", options: ["La solution", "L'accueil", "La vente"], correctIndex: 1 },
        { question: "Reformuler sert à…", options: ["Gagner du temps", "Valider la compréhension du besoin", "Clôturer l'appel"], correctIndex: 1 },
        { question: "Un silence de plus de 30 s doit être…", options: ["Annoncé au client", "Ignoré", "Évité en raccrochant"], correctIndex: 0 },
      ],
    },
    {
      title: "Procédures Bytel Mobile", category: "Technique",
      description: "Vérification d'identité, diagnostic et offres mobiles.",
      targetCells: ["Bytel Mobile Fès"],
      questions: [
        { question: "Avant toute modification de contrat, il faut…", options: ["Vérifier l'identité", "Proposer une offre", "Transférer l'appel"], correctIndex: 0 },
        { question: "Un diagnostic réseau commence par…", options: ["Redémarrer le mobile", "Vérifier la zone de couverture", "Changer la carte SIM"], correctIndex: 1 },
      ],
    },
  ];
  for (const t of trainings) {
    const attempts = (t.targetUsers || []).slice(0, 5).map((u) => {
      const answers = t.questions.map((q) => (rnd() < 0.75 ? q.correctIndex : (q.correctIndex + 1) % q.options.length));
      const score = answers.filter((a, i) => a === t.questions[i].correctIndex).length;
      return { user: u, answers, score, total: t.questions.length, completedAt: daysAgo(int(1, 30)) };
    });
    await Training.create({
      ...t, active: true, allowMultipleAttempts: true, passThreshold: 70, dueDate: daysAgo(-21),
      createdBy: formateur._id, attempts,
    });
  }

  // Échantillons à traiter
  const samples = [];
  for (const p of orangePilots.slice(0, 10)) {
    const status = pick(["pending", "assigned", "in_progress", "done"]);
    samples.push({
      eps: `EPS-OR${int(100000, 999999)}`, callDate: daysAgo(int(1, 20)), callDirection: "inbound",
      pilot: p._id, gridId: grids.Orange._id, assignedTo: status === "pending" ? null : pick(cqs)._id,
      cell: p.cell, project: "Orange", contract: "Orange Fibre", status, batch: "Lot démo novembre",
      dueDate: daysAgo(-7), createdBy: admin._id,
    });
  }
  await Sample.insertMany(samples);

  const contested = inserted.filter((s) => s.contestStatus).length;
  console.log("✅ Données de démo créées");
  console.log(`   ${pilots.length} pilotes · ${referents.length} référents · ${superviseurs.length} superviseurs · ${cdps.length} chefs de projet · 2 CQ · 1 formateur · 1 admin`);
  console.log(`   ${inserted.length} évaluations (${contested} contestations) · ${coachings.length} coachings · ${trainings.length} formations · ${samples.length} échantillons`);
  console.log(`\n   Mot de passe de tous les comptes : ${PASSWORD}`);
  console.log("   Comptes :");
  const list = [
    ["Admin", `admin@${DOMAIN}`], ["CQ", `cq1@${DOMAIN}`], ["Formateur", `formateur@${DOMAIN}`],
    ["Chef de projet Orange", `cdp.orange@${DOMAIN}`], ["Chef de projet Bytel", `cdp.bytel@${DOMAIN}`],
    ["Superviseur Orange", `superviseur.orange@${DOMAIN}`], ["Superviseur Bytel", `superviseur.bytel@${DOMAIN}`],
    ["Référent Orange (Rabat)", `referent.orange1@${DOMAIN}`], ["Référent Bytel (Fès)", `referent.bytel1@${DOMAIN}`],
    ["Pilote Orange", `pilote.orange1.1@${DOMAIN}`], ["Pilote Bytel", `pilote.bytel1.1@${DOMAIN}`],
  ];
  for (const [r, e] of list) console.log(`     ${r.padEnd(26)} ${e}`);
}

(async () => {
  const local = /^mongodb:\/\/(127\.0\.0\.1|localhost|mongo)(:\d+)?\//.test(MONGO_URI);
  if (!local && !ARGS.has("--force")) {
    console.error(`⛔ MONGO_URI ne pointe pas vers une base locale (${MONGO_URI.replace(/\/\/.*@/, "//***@")}). Ajoutez --force si c'est voulu.`);
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  try {
    if (ARGS.has("--reset") || ARGS.has("--clean")) await clean();
    if (!ARGS.has("--clean")) await seedAll();
  } catch (e) {
    console.error("❌ Erreur :", e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
