// backend/routes/admin.routes.js
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Score = require("../models/Score");
const Grid = require("../models/Grid");
const Notification = require("../models/Notification");
const Coaching = require("../models/Coaching");
const AuditLog = require("../models/AuditLog");
const { logAudit } = require("../utils/audit");
// ---- Helpers grilles (groups + items) ----
const parseItemsTextToArray = (raw) => {
  const lines = String(raw || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const out = [];
  let order = 0;

  for (const line of lines) {
    if (line.startsWith("#")) {
      const title = line.replace(/^#+/, "").trim();
      if (title) out.push({ type: "group", title, order: order++ });
      continue;
    }
    out.push({ type: "item", label: line, order: order++ });
  }
  return out;
};

const normalizeGridItems = (items) => {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .map((it, idx) => {
      const order = typeof it?.order === "number" ? it.order : idx;

      const isGroup =
        it?.type === "group" ||
        (typeof it?.title === "string" && it.title.trim().length > 0) ||
        (typeof it?.label === "string" && it.label.trim().startsWith("#"));

      if (isGroup) {
        const title = (it?.title || it?.label || "")
          .toString()
          .replace(/^#+/, "")
          .trim();
        return title
          ? {
              type: "group",
              title,
              hardFail: !!it?.hardFail,
              malusPercent: Number(it?.malusPercent) || 0,
              order,
            }
          : null;
      }

      const label = (it?.label || "").toString().trim();
      if (!label) return null;

      const pointsConforme = Number(it?.pointsConforme);
      const pointsNonConforme = Number(it?.pointsNonConforme);
      const malusPercent = Number(it?.malusPercent);

      return {
        type: "item",
        label,
        pointsConforme: Number.isFinite(pointsConforme) ? pointsConforme : 0,
        pointsNonConforme: Number.isFinite(pointsNonConforme) ? pointsNonConforme : 0,
        malusPercent: Number.isFinite(malusPercent) ? malusPercent : 0,
        order,
      };
    })
    .filter(Boolean);
};

const Cell = require("../models/Cell");

const auth = require("../middleware/auth");
const permit = require("../middleware/roles");
const Sample = require("../models/Sample");
const { getScope, userFilterForScope, pilotScopeClause } = require("../utils/scope");

const router = express.Router();

/* ---- Contrat Orange : champs de périmètre des profils ---- */
const VALID_ROLES = ["admin", "cq", "pilote", "management", "formateur", "supervision", "referent", "superviseur", "cdp"];
const VISIBILITY_SCOPES = ["", "cell", "project", "contract", "all", "self", "team", "line"];
const EDIT_SCOPES = ["", "none", "own", "perimeter"];

/** Rôle saisi (formulaire / import Excel) → valeur technique. « Pilote », « CQ », « Manager »… acceptés. */
const ROLE_ALIASES = {
  agent: "pilote", pilot: "pilote", manager: "management", trainer: "formateur", administrateur: "admin",
  "référent": "referent", "referent technique": "referent", "référent technique": "referent", rt: "referent",
  supervisor: "superviseur", "chef de projet": "cdp", "chef projet": "cdp", "project manager": "cdp",
};
function normalizeRole(raw) {
  const r = String(raw === undefined || raw === null ? "" : raw).trim().toLowerCase();
  return ROLE_ALIASES[r] || r;
}

/** Extrait et valide les champs de périmètre d'un corps de requête (seulement ceux fournis). */
function pickScopeFields(body) {
  const out = {};
  if (!body || typeof body !== "object") return out;
  if (body.project !== undefined) out.project = String(body.project || "").trim().slice(0, 120);
  if (body.contract !== undefined) out.contract = String(body.contract || "").trim().slice(0, 120);
  if (body.extraCells !== undefined) {
    const arr = Array.isArray(body.extraCells) ? body.extraCells : String(body.extraCells || "").split(",");
    out.extraCells = [...new Set(arr.map((c) => String(c || "").trim()).filter(Boolean))].slice(0, 50);
  }
  if (body.visibilityScope !== undefined) {
    const v = String(body.visibilityScope || "");
    if (!VISIBILITY_SCOPES.includes(v)) throw Object.assign(new Error("Périmètre de consultation invalide."), { status: 400 });
    out.visibilityScope = v;
  }
  if (body.editScope !== undefined) {
    const v = String(body.editScope || "");
    if (!EDIT_SCOPES.includes(v)) throw Object.assign(new Error("Périmètre de modification invalide."), { status: 400 });
    out.editScope = v;
  }
  for (const k of ["referent", "superviseur"]) {
    if (body[k] === undefined) continue;
    const v = body[k] ? String(body[k]) : "";
    if (v && !mongoose.Types.ObjectId.isValid(v)) throw Object.assign(new Error("Responsable hiérarchique invalide."), { status: 400 });
    out[k] = v || null;
  }
  return out;
}

/** Vérifie que les responsables affectés ont le bon rôle. */
async function validateHierarchy(fields) {
  if (fields.referent) {
    const r = await User.findById(fields.referent).select("role").lean();
    if (!r || r.role !== "referent") throw Object.assign(new Error("Le référent choisi n'est pas un Référent Technique."), { status: 400 });
  }
  if (fields.superviseur) {
    const r = await User.findById(fields.superviseur).select("role").lean();
    if (!r || r.role !== "superviseur") throw Object.assign(new Error("Le superviseur choisi n'a pas le rôle Superviseur."), { status: 400 });
  }
}

async function scopedUserQuery(req, base) {
  const f = userFilterForScope(await getScope(req));
  return f ? { $and: [base, f] } : base;
}

// Toutes les routes /admin/* nécessitent une authentification
router.use(auth);

/**
 * Petit utilitaire pour calculer le score moyen d'une évaluation
 */
function computeAverageScore(scoreDoc) {
  if (!scoreDoc.items || !Array.isArray(scoreDoc.items) || scoreDoc.items.length === 0) {
    return 0;
  }
  const sum = scoreDoc.items.reduce((acc, it) => {
    const v = typeof it.value === "number" ? it.value : Number(it.value) || 0;
    return acc + v;
  }, 0);
  return sum / scoreDoc.items.length;
}

/* =========================================================================
 *  USERS / UTILISATEURS
 * ========================================================================= */

/**
 * GET /admin/users
 * Liste tous les utilisateurs (admin + management + cq peuvent voir)
 */
router.get(
  "/users",
  permit("admin", "management", "cq", "formateur", "superviseur", "referent", "cdp"),
  async (req, res) => {
    try {
      const users = await User.find(await scopedUserQuery(req, {})).select("-passwordHash").lean();
      res.json(users);
    } catch (err) {
      console.error("GET /admin/users error:", err);
      res.status(500).json({ message: "Erreur serveur lors du chargement des utilisateurs." });
    }
  }
);

/**
 * GET /admin/pilots
 * Retourne uniquement les utilisateurs de rôle "pilote"
 */
router.get(
  "/pilots",
  permit("admin", "management", "cq", "formateur", "superviseur", "referent", "cdp"),
  async (req, res) => {
    try {
      const pilots = await User.find(await scopedUserQuery(req, { role: "pilote", active: { $ne: false } }))
        .select("-passwordHash")
        .lean();
      res.json(pilots);
    } catch (err) {
      console.error("GET /admin/pilots error:", err);
      res.status(500).json({ message: "Erreur serveur lors du chargement des pilotes." });
    }
  }
);

/**
 * POST /admin/users
 * Création d'un utilisateur (ADMIN uniquement)
 */
router.post(
  "/users",
  permit("admin"),
  async (req, res) => {
    try {
      const { name, password, cell } = req.body;
      const role = normalizeRole(req.body.role);
      const email = String(req.body.email || "").trim().toLowerCase();

      if (!name || !email || !password || !role) {
        return res.status(400).json({ message: "Champs obligatoires manquants." });
      }
      if (!VALID_ROLES.includes(String(role))) {
        return res.status(400).json({ message: "Rôle invalide." });
      }
      let scopeFields;
      try { scopeFields = pickScopeFields(req.body); await validateHierarchy(scopeFields); }
      catch (e) { return res.status(e.status || 400).json({ message: e.message }); }

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: "Un utilisateur avec cet email existe déjà." });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await User.create({
        name,
        email,
        role,
        passwordHash,
        active: true,
        cell: cell || "",
        ...scopeFields,
      });

      const plainUser = user.toObject();
      delete plainUser.passwordHash;

      res.status(201).json(plainUser);
    } catch (err) {
      console.error("POST /admin/users error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la création de l'utilisateur." });
    }
  }
);

/**
 * POST /admin/pilots
 * Formateur (ou admin) : crée un nouveau pilote et l'affecte éventuellement à des formations.
 * Body : { name, email, password, cell, project, contract, referent, trainingIds: [] }
 */
router.post("/pilots", permit("admin", "formateur"), async (req, res) => {
  try {
    const Training = require("../models/Training");
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!name || !email || !password) return res.status(400).json({ message: "Nom, email et mot de passe sont obligatoires." });
    if (password.length < 6) return res.status(400).json({ message: "Le mot de passe doit contenir au moins 6 caractères." });
    if (await User.findOne({ email })) return res.status(400).json({ message: "Un utilisateur avec cet email existe déjà." });

    let fields;
    try {
      fields = pickScopeFields({ project: req.body.project, contract: req.body.contract, referent: req.body.referent });
      await validateHierarchy(fields);
    } catch (e) { return res.status(e.status || 400).json({ message: e.message }); }

    const user = await User.create({
      name, email, role: "pilote", active: true,
      passwordHash: await bcrypt.hash(password, 10),
      cell: String(req.body.cell || "").trim(),
      ...fields,
    });

    const ids = (Array.isArray(req.body.trainingIds) ? req.body.trainingIds : []).filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
    if (ids.length) await Training.updateMany({ _id: { $in: ids } }, { $addToSet: { targetUsers: user._id } });

    await logAudit(req, { action: "CREATE_PILOT", targetType: "user", targetId: user._id, metadata: { name, email, cell: user.cell, trainings: ids.length } });
    const plain = user.toObject();
    delete plain.passwordHash;
    res.status(201).json({ ...plain, assignedTrainings: ids.length });
  } catch (err) {
    console.error("POST /admin/pilots error:", err);
    res.status(500).json({ message: "Erreur serveur lors de la création du pilote." });
  }
});

/**
 * POST /admin/pilots/:id/trainings — affecte un pilote existant à des formations (formateur / admin)
 * Body : { trainingIds: [] }
 */
router.post("/pilots/:id/trainings", permit("admin", "formateur"), async (req, res) => {
  try {
    const Training = require("../models/Training");
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Identifiant invalide." });
    const pilot = await User.findOne({ _id: req.params.id, role: "pilote" }).select("_id name").lean();
    if (!pilot) return res.status(404).json({ message: "Pilote introuvable." });
    const ids = (Array.isArray(req.body.trainingIds) ? req.body.trainingIds : []).filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
    if (!ids.length) return res.status(400).json({ message: "Aucune formation sélectionnée." });
    const r = await Training.updateMany({ _id: { $in: ids } }, { $addToSet: { targetUsers: pilot._id } });
    await logAudit(req, { action: "ASSIGN_TRAINING", targetType: "user", targetId: pilot._id, metadata: { name: pilot.name, trainings: ids.length } });
    res.json({ ok: true, updated: r.modifiedCount ?? 0 });
  } catch (err) {
    console.error("POST /admin/pilots/:id/trainings error:", err);
    res.status(500).json({ message: "Erreur serveur lors de l'affectation." });
  }
});

/**
 * PATCH /admin/users/:id/cell
 * Superviseur (agents de sa ligne), Chef de projet (agents de son activité) ou admin : change la cellule d'un agent.
 */
router.patch("/users/:id/cell", permit("admin", "superviseur", "cdp"), async (req, res) => {
  try {
    const { isPilotInScope } = require("../utils/scope");
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Identifiant invalide." });
    const target = await User.findById(req.params.id).select("name role cell project").lean();
    if (!target) return res.status(404).json({ message: "Utilisateur introuvable." });
    if (req.user.role !== "admin") {
      if (!["pilote", "referent"].includes(target.role)) return res.status(403).json({ message: "Vous ne pouvez modifier que la cellule des agents." });
      if (!(await isPilotInScope(await getScope(req), target._id))) return res.status(403).json({ message: "Agent hors de votre périmètre." });
    }
    const cell = String(req.body.cell || "").trim();
    if (cell && !(await Cell.exists({ name: cell }))) return res.status(400).json({ message: "Cellule inconnue." });
    await User.updateOne({ _id: target._id }, { $set: { cell } });
    await logAudit(req, { action: "UPDATE_CELL", targetType: "user", targetId: target._id, metadata: { name: target.name, from: target.cell || "", to: cell } });
    res.json({ ok: true, cell });
  } catch (err) {
    console.error("PATCH /admin/users/:id/cell error:", err);
    res.status(500).json({ message: "Erreur serveur lors du changement de cellule." });
  }
});

/**
 * PATCH /admin/users/:id/hierarchy
 * Affecte un pilote à un référent, ou un référent (ou pilote) à un superviseur.
 * Admin : tout ; Chef de projet : dans son activité ; Superviseur : ses agents vers ses référents.
 */
router.patch("/users/:id/hierarchy", permit("admin", "cdp", "superviseur"), async (req, res) => {
  try {
    const { isPilotInScope } = require("../utils/scope");
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Identifiant invalide." });
    const target = await User.findById(req.params.id).select("name role project").lean();
    if (!target) return res.status(404).json({ message: "Utilisateur introuvable." });
    let fields;
    try {
      fields = pickScopeFields({ referent: req.body.referent, superviseur: req.body.superviseur });
      await validateHierarchy(fields);
    } catch (e) { return res.status(e.status || 400).json({ message: e.message }); }
    if (target.role !== "pilote") delete fields.referent;
    if (!["referent", "pilote"].includes(target.role)) delete fields.superviseur;
    if (!Object.keys(fields).length) return res.status(400).json({ message: "Aucune affectation applicable à ce profil." });

    const me = String(req.user.id || req.user._id);
    if (req.user.role === "superviseur") {
      if (fields.superviseur !== undefined) return res.status(403).json({ message: "Seuls l'admin et le chef de projet affectent les superviseurs." });
      if (!(await isPilotInScope(await getScope(req), target._id))) return res.status(403).json({ message: "Agent hors de votre périmètre." });
      if (fields.referent) {
        const ref = await User.findById(fields.referent).select("superviseur").lean();
        if (String(ref?.superviseur || "") !== me) return res.status(403).json({ message: "Ce référent n'est pas sous votre responsabilité." });
      }
    }
    if (req.user.role === "cdp") {
      const meDoc = await User.findById(me).select("project").lean();
      const proj = meDoc?.project || "";
      if (!proj || target.project !== proj) return res.status(403).json({ message: "Utilisateur hors de votre activité." });
      for (const k of ["referent", "superviseur"]) {
        if (fields[k]) {
          const u = await User.findById(fields[k]).select("project").lean();
          if (u?.project !== proj) return res.status(403).json({ message: "Responsable hors de votre activité." });
        }
      }
    }
    await User.updateOne({ _id: target._id }, { $set: fields });
    const meta = { name: target.name };
    for (const [k, v] of Object.entries(fields)) meta[k] = v ? String(v) : "";
    await logAudit(req, { action: "UPDATE_HIERARCHY", targetType: "user", targetId: target._id, metadata: meta });
    res.json({ ok: true, ...fields });
  } catch (err) {
    console.error("PATCH /admin/users/:id/hierarchy error:", err);
    res.status(500).json({ message: "Erreur serveur lors de l'affectation." });
  }
});

/**
 * POST /admin/users/bulk
 * Création multiple d'utilisateurs (upload CSV etc.)
 * Body attendu : { users: [ {name, email, password, role, cell} ] }
 */
router.post(
  "/users/bulk",
  permit("admin"),
  async (req, res) => {
    try {
      const { users } = req.body;
      if (!Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ message: "Aucun utilisateur à traiter." });
      }

      const created = [];
      const errors = [];

      for (const raw of users) {
        try {
          const { name, password, cell } = raw;
          const role = normalizeRole(raw.role);
          const email = String(raw.email || "").trim().toLowerCase();
          let bulkScope = {};
          try { bulkScope = pickScopeFields({ project: raw.project, contract: raw.contract }); } catch { bulkScope = {}; }
          if (bulkScope.project === "") delete bulkScope.project;
          if (bulkScope.contract === "") delete bulkScope.contract;

          if (!name || !email || !password || !role) {
            errors.push({
              entry: raw,
              error: "Champs obligatoires manquants",
            });
            continue;
          }
          if (!VALID_ROLES.includes(role)) {
            errors.push({ entry: { ...raw, password: undefined }, error: `Rôle invalide : « ${raw.role} »` });
            continue;
          }

          const existing = await User.findOne({ email });
          if (existing) {
            errors.push({
              entry: raw,
              error: "Email déjà utilisé",
            });
            continue;
          }

          const passwordHash = await bcrypt.hash(password, 10);

          const user = await User.create({
            name,
            email,
            role,
            passwordHash,
            active: true,
            cell: cell || "",
            ...bulkScope,
          });

          created.push({
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
          });
        } catch (e) {
          console.error("Bulk user error for entry:", raw, e);
          errors.push({
            entry: raw,
            error: "Erreur serveur lors de la création de cet utilisateur.",
          });
        }
      }

      res.json({ created, errors });
    } catch (err) {
      console.error("POST /admin/users/bulk error:", err);
      res.status(500).json({ message: "Erreur serveur lors de l'import en masse." });
    }
  }
);

/* ---- Contrat Orange : mise à jour des profils existants ---- */

/**
 * GET /admin/users/incomplete
 * Profils actifs auxquels il manque cellule / projet / contrat (préparation du contrôle d'accès).
 */
router.get("/users/incomplete", permit("admin"), async (req, res) => {
  try {
    const users = await User.find({ active: { $ne: false }, role: { $ne: "admin" } })
      .select("name email role cell project contract visibilityScope editScope extraCells")
      .sort({ role: 1, name: 1 })
      .lean();
    const rows = users
      .map((u) => ({
        ...u,
        missing: [!u.cell && "cellule", !u.project && "projet", !u.contract && "contrat"].filter(Boolean),
      }))
      .filter((u) => u.missing.length);
    // Diagnostic : agents réellement visibles par chaque responsable, selon la règle appliquée
    // quand le contrôle d'accès est activé (toujours appliquée pour la Supervision).
    const { computeScope, userFilterForScope: ufs } = require("../utils/scope");
    const scopeCheck = [];
    for (const u of users.filter((x) => ["management", "supervision"].includes(x.role))) {
      const f = ufs(computeScope(u, {}, true));
      const where = { role: "pilote", active: { $ne: false } };
      const visibleAgents = await User.countDocuments(f ? { $and: [where, f] } : where);
      scopeCheck.push({ _id: u._id, name: u.name, role: u.role, cell: u.cell || "", extraCells: u.extraCells || [], project: u.project || "", contract: u.contract || "", visibilityScope: u.visibilityScope || "", visibleAgents });
    }
    const noAgent = scopeCheck.filter((x) => x.visibleAgents === 0);
    res.json({ total: rows.length, blocking: noAgent.length, items: rows, scopeCheck, noAgent });
  } catch (err) {
    console.error("GET /admin/users/incomplete error:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * PATCH /admin/users/bulk-scope
 * Body : { userIds: [...], set: { project?, contract?, visibilityScope?, editScope?, extraCells?, cell? } }
 * Seuls les champs fournis sont modifiés.
 */
router.patch("/users/bulk-scope", permit("admin"), async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.userIds) ? req.body.userIds : []).filter((x) => mongoose.Types.ObjectId.isValid(String(x)));
    if (!ids.length) return res.status(400).json({ message: "Aucun utilisateur sélectionné." });
    if (ids.length > 2000) return res.status(400).json({ message: "Sélection trop importante (2000 maximum)." });
    let set;
    try { set = pickScopeFields(req.body?.set || {}); }
    catch (e) { return res.status(e.status || 400).json({ message: e.message }); }
    if (req.body?.set?.cell !== undefined) set.cell = String(req.body.set.cell || "").trim();
    if (!Object.keys(set).length) return res.status(400).json({ message: "Aucun champ à modifier." });
    const r = await User.updateMany({ _id: { $in: ids } }, { $set: set });
    const { logAudit: audit } = require("../utils/audit");
    await audit(req, { action: "BULK_UPDATE_SCOPE", targetType: "user", targetId: ids[0], metadata: { count: ids.length, set } });
    res.json({ ok: true, matched: r.matchedCount ?? r.n ?? 0, modified: r.modifiedCount ?? r.nModified ?? 0 });
  } catch (err) {
    console.error("PATCH /admin/users/bulk-scope error:", err);
    res.status(500).json({ message: "Erreur serveur lors de la mise à jour en masse." });
  }
});

/**
 * POST /admin/users/apply-cell-scope
 * Recopie projet / contrat de chaque cellule vers ses membres.
 * Body : { overwrite?: boolean }  (false par défaut : seuls les champs vides sont complétés)
 */
router.post("/users/apply-cell-scope", permit("admin"), async (req, res) => {
  try {
    const overwrite = req.body?.overwrite === true;
    const cells = await Cell.find({ $or: [{ project: { $nin: ["", null] } }, { contract: { $nin: ["", null] } }] }).lean();
    let modified = 0;
    for (const c of cells) {
      for (const field of ["project", "contract"]) {
        if (!c[field]) continue;
        const where = { cell: c.name };
        if (!overwrite) where.$or = [{ [field]: "" }, { [field]: null }, { [field]: { $exists: false } }];
        const r = await User.updateMany(where, { $set: { [field]: c[field] } });
        modified += r.modifiedCount ?? r.nModified ?? 0;
      }
    }
    res.json({ ok: true, cells: cells.length, modified });
  } catch (err) {
    console.error("POST /admin/users/apply-cell-scope error:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * PATCH /admin/users/:id
 * Mise à jour d'un utilisateur (ADMIN uniquement)
 */
router.patch(
  "/users/:id",
  permit("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, role, active, cell, password } = req.body;

      const update = {};
      if (name !== undefined) update.name = name;
      if (email !== undefined) update.email = email;
      if (role !== undefined) update.role = normalizeRole(role);
      if (cell !== undefined) update.cell = cell;
      if (active !== undefined) update.active = active;
      if (role !== undefined && !VALID_ROLES.includes(update.role)) {
        return res.status(400).json({ message: "Rôle invalide." });
      }
      try { const sf = pickScopeFields(req.body); await validateHierarchy(sf); Object.assign(update, sf); }
      catch (e) { return res.status(e.status || 400).json({ message: e.message }); }

      if (password && password.trim().length > 0) {
        update.passwordHash = await bcrypt.hash(password, 10);
      }

      const user = await User.findByIdAndUpdate(id, update, {
        new: true,
      }).select("-passwordHash");

      if (!user) {
        return res.status(404).json({ message: "Utilisateur introuvable." });
      }

      res.json(user);
    } catch (err) {
      console.error("PATCH /admin/users/:id error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la mise à jour de l'utilisateur." });
    }
  }
);

/**
 * DELETE /admin/users/:id
 * Suppression logique (active = false) ou réelle (ici on met active=false)
 */
router.delete(
  "/users/:id",
  permit("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const user = await User.findByIdAndUpdate(
        id,
        { active: false },
        { new: true }
      ).select("-passwordHash");

      if (!user) {
        return res.status(404).json({ message: "Utilisateur introuvable." });
      }

      res.json({ message: "Utilisateur désactivé.", user });
    } catch (err) {
      console.error("DELETE /admin/users/:id error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la suppression de l'utilisateur." });
    }
  }
);

/* =========================================================================
 *  CELLS / CELLULES
 * ========================================================================= */

/**
 * GET /admin/cells
 */
router.get(
  "/cells",
  permit("admin", "management", "cq", "formateur", "supervision", "superviseur", "referent", "cdp"),
  async (req, res) => {
    try {
      const cells = await Cell.find().lean();
      res.json(cells);
    } catch (err) {
      console.error("GET /admin/cells error:", err);
      res.status(500).json({ message: "Erreur serveur lors du chargement des cellules." });
    }
  }
);

/**
 * POST /admin/cells
 */
router.post(
  "/cells",
  permit("admin"),
  async (req, res) => {
    try {
      const { name, description, active } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Le nom de la cellule est obligatoire." });
      }

      const existing = await Cell.findOne({ name: name.trim() });
      if (existing) {
        return res.status(400).json({ message: "Une cellule avec ce nom existe déjà." });
      }

      const cell = await Cell.create({
        name: name.trim(),
        description: description || "",
        active: active !== undefined ? active : true,
        project: String(req.body.project || "").trim(),
        contract: String(req.body.contract || "").trim(),
        activity: String(req.body.activity || "").trim(),
      });

      res.status(201).json(cell);
    } catch (err) {
      console.error("POST /admin/cells error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la création de la cellule." });
    }
  }
);

/**
 * PATCH /admin/cells/:id
 */
router.patch(
  "/cells/:id",
  permit("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, active } = req.body;

      const update = {};
      if (name !== undefined) update.name = name;
      if (description !== undefined) update.description = description;
      if (active !== undefined) update.active = active;
      if (req.body.project !== undefined) update.project = String(req.body.project || "").trim();
      if (req.body.contract !== undefined) update.contract = String(req.body.contract || "").trim();
      if (req.body.activity !== undefined) update.activity = String(req.body.activity || "").trim();

      const cell = await Cell.findByIdAndUpdate(id, update, {
        new: true,
      });

      if (!cell) {
        return res.status(404).json({ message: "Cellule introuvable." });
      }

      res.json(cell);
    } catch (err) {
      console.error("PATCH /admin/cells/:id error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la mise à jour de la cellule." });
    }
  }
);

/**
 * DELETE /admin/cells/:id
 * Détache les utilisateurs de cette cellule puis supprime la cellule
 */
router.delete(
  "/cells/:id",
  permit("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const cell = await Cell.findById(id);
      if (!cell) {
        return res.status(404).json({ message: "Cellule introuvable." });
      }

      // Détacher les utilisateurs
      await User.updateMany({ cell: cell.name }, { $set: { cell: "" } });

      await cell.deleteOne();

      res.json({ message: "Cellule supprimée et utilisateurs détachés." });
    } catch (err) {
      console.error("DELETE /admin/cells/:id error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la suppression de la cellule." });
    }
  }
);

/* =========================================================================
 *  GRIDS / GRILLES D'ÉVALUATION
 * ========================================================================= */

/**
 * GET /admin/grids
 */
router.get(
  "/grids",
  permit("admin", "management", "cq", "formateur", "superviseur", "referent", "cdp"),
  async (req, res) => {
    try {
      const grids = await Grid.find({ isDeleted: { $ne: true } }).lean();
      res.json(grids);
    } catch (err) {
      console.error("GET /admin/grids error:", err);
      res.status(500).json({ message: "Erreur serveur lors du chargement des grilles." });
    }
  }
);

/** Rangement d'une grille : contrat, activité, cellules (chaînes nettoyées). */
function gridPlacement(body, partial = false) {
  const out = {};
  const clean = (v) => String(v || "").trim().slice(0, 120);
  if (!partial || body.contract !== undefined) out.contract = clean(body.contract);
  if (!partial || body.activity !== undefined) out.activity = clean(body.activity);
  if (!partial || body.cells !== undefined) {
    out.cells = [...new Set((Array.isArray(body.cells) ? body.cells : []).map(clean).filter(Boolean))].slice(0, 200);
  }
  return out;
}

/**
 * POST /admin/grids
 * Body attendu : { name, description, items: [{type:'group',title} | {type:'item',label,pointsConforme,pointsNonConforme,order}], roles: ['cq','management'], active }
 */
router.post(
  "/grids",
  permit("admin", "management", "cq", "formateur"),
  async (req, res) => {
    try {
      const { name, description, items, roles, active, gridType } = req.body;
      const GRID_USAGES = ["evaluation", "calibration", "sample", "all"];

      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Le nom de la grille est obligatoire." });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "La grille doit contenir au moins un item." });
      }

      const normalizedItems = normalizeGridItems(items);
      const hasAtLeastOneItem = normalizedItems.some((x) => x.type === "item");
      if (!hasAtLeastOneItem) {
        return res
          .status(400)
          .json({ message: "La grille doit contenir au moins un item (hors titres)." });
      }

      const grid = await Grid.create({
        name: name.trim(),
        description: description || "",
        gridType: (gridType || "classic").toString() === "presence" ? "presence" : "classic",
        items: normalizedItems,
        roles: Array.isArray(roles) ? roles : [],
        active: active !== undefined ? active : true,
        usage: GRID_USAGES.includes(String(req.body.usage)) ? String(req.body.usage) : "evaluation",
        callDirection: ["inbound", "outbound"].includes(String(req.body.callDirection)) ? String(req.body.callDirection) : "",
        ...gridPlacement(req.body),
      });

      res.status(201).json(grid);
    } catch (err) {
      console.error("POST /admin/grids error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la création de la grille." });
    }
  }
);

/**
 * PATCH /admin/grids/:id/items
 * Body:
 *  - { items: [...] }  (structured)
 *  - OR { itemsText: "..." } (lines with # for group titles)
 */
router.patch(
  "/grids/:id/items",
  permit("admin", "management", "cq", "formateur"),
  async (req, res) => {
    try {
      const gridId = req.params.id;
      const { items, itemsText } = req.body || {};

      const sourceItems =
        typeof itemsText === "string" ? parseItemsTextToArray(itemsText) : items;

      const normalizedItems = normalizeGridItems(sourceItems);
      const hasAtLeastOneItem = normalizedItems.some((x) => x.type === "item");
      if (!hasAtLeastOneItem) {
        return res
          .status(400)
          .json({ message: "La grille doit contenir au moins un item (hors titres)." });
      }

      const updated = await Grid.findByIdAndUpdate(
        gridId,
        { items: normalizedItems },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({ message: "Grille introuvable." });
      }

      res.json(updated);
    } catch (err) {
      console.error("PATCH /admin/grids/:id/items error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la mise à jour de la grille." });
    }
  }
);

/**
 * PATCH /admin/grids/:id
 * Mise à jour simple (nom, description, active, roles)
 */
router.patch(
  "/grids/:id",
  permit("admin", "management", "cq", "formateur"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, active, roles, gridType } = req.body;

      const update = {};
      if (name !== undefined) update.name = name;
      if (description !== undefined) update.description = description;
      if (active !== undefined) update.active = active;
      if (roles !== undefined && Array.isArray(roles)) update.roles = roles;
      if (gridType !== undefined) update.gridType = (String(gridType) === "presence") ? "presence" : "classic";
      if (req.body.usage !== undefined) {
        if (!["evaluation", "calibration", "sample", "all"].includes(String(req.body.usage))) {
          return res.status(400).json({ message: "Usage de grille invalide." });
        }
        update.usage = String(req.body.usage);
      }
      if (req.body.callDirection !== undefined) {
        update.callDirection = ["inbound", "outbound"].includes(String(req.body.callDirection)) ? String(req.body.callDirection) : "";
      }

      Object.assign(update, gridPlacement(req.body, true));

      const grid = await Grid.findByIdAndUpdate(id, update, { new: true });
      if (!grid) {
        return res.status(404).json({ message: "Grille introuvable." });
      }

      res.json(grid);
    } catch (err) {
      console.error("PATCH /admin/grids/:id error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la mise à jour de la grille." });
    }
  }
);

/**
 * DELETE /admin/grids/:id
 */
router.delete(
  "/grids/:id",
  permit("admin", "management"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const grid = await Grid.findById(id);
      if (!grid) {
        return res.status(404).json({ message: "Grille introuvable." });
      }

      // Soft delete: keep the grid to preserve historical evaluation scores
      grid.isDeleted = true;
      grid.deletedAt = new Date();
      grid.active = false;
      await grid.save();

      res.json({ message: "Grille archivée (soft delete)." });
    } catch (err) {
      console.error("DELETE /admin/grids/:id error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la suppression de la grille." });
    }
  }
);

/* =========================================================================
 *  STATS GLOBALES / ADMIN DASHBOARD
 * ========================================================================= */

/**
 * GET /admin/stats
 * Utilisé par AdminDashboard (stats.global, stats.byPilot)
 */
router.get(
  "/stats",
  permit("admin", "management"),
  async (req, res) => {
    try {
      const scores = await Score.find({}).populate("pilot", "-passwordHash").lean();

      let globalCount = 0;
      let globalSum = 0;

      const byPilotMap = new Map();

      for (const s of scores) {
        const avg = computeAverageScore(s);
        globalCount += 1;
        globalSum += avg;

        const pilotId = s.pilot?._id?.toString() || "unknown";

        if (!byPilotMap.has(pilotId)) {
          byPilotMap.set(pilotId, {
            pilotId,
            pilotName: s.pilot?.name || "Pilote inconnu",
            pilotEmail: s.pilot?.email || "",
            count: 0,
            sum: 0,
          });
        }

        const entry = byPilotMap.get(pilotId);
        entry.count += 1;
        entry.sum += avg;
      }

      const byPilot = Array.from(byPilotMap.values()).map((p) => ({
        pilotId: p.pilotId,
        pilotName: p.pilotName,
        pilotEmail: p.pilotEmail,
        count: p.count,
        avgTotal: p.count ? p.sum / p.count : 0,
      }));

      const globalAvg = globalCount ? globalSum / globalCount : 0;

      res.json({
        global: {
          count: globalCount,
          avgTotal: globalAvg,
        },
        byPilot,
      });
    } catch (err) {
      console.error("GET /admin/stats error:", err);
      res.status(500).json({ message: "Erreur serveur lors du chargement des statistiques." });
    }
  }
);

/**
 * GET /admin/item-stats
 * Statistiques par item de grille, optionnellement filtrées par pilote
 * Query : ?pilotId=<id>
 * Retour: [{ label, avgValue, count }]
 */
router.get(
  "/item-stats",
  permit("admin", "management"),
  async (req, res) => {
    try {
      const { pilotId } = req.query;

      const match = {};
      if (pilotId && mongoose.Types.ObjectId.isValid(pilotId)) {
        match.pilot = new mongoose.Types.ObjectId(pilotId);
      }

      const pipeline = [
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.label",
            avgValue: { $avg: "$items.value" },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            label: "$_id",
            avgValue: 1,
            count: 1,
          },
        },
        { $sort: { label: 1 } },
      ];

      const stats = await Score.aggregate(pipeline);
      res.json(stats);
    } catch (err) {
      console.error("GET /admin/item-stats error:", err);
      res.status(500).json({
        message: "Erreur serveur lors du chargement des statistiques par item.",
      });
    }
  }
);

/**
 * GET /admin/cq-stats
 * Répartition des évaluations par CQ (pour le pie chart du dashboard)
 * Query : ?year=YYYY&month=MM (facultatif)
 * Retour: [{ cqId, cqName, cqEmail, count }]
 */
router.get(
  "/cq-stats",
  permit("admin", "management"),
  async (req, res) => {
    try {
      const { year, month } = req.query;
      const match = {};

      if (year) {
        const y = parseInt(year, 10);
        if (!Number.isNaN(y)) {
          const m = month ? parseInt(month, 10) : null;
          const start = new Date(y, m ? m - 1 : 0, 1);
          const end = m ? new Date(y, m, 1) : new Date(y + 1, 0, 1);
          match.createdAt = { $gte: start, $lt: end };
        }
      }

      const pipeline = [
        { $match: match },
        {
          $lookup: {
            from: "users",
            localField: "evaluator",
            foreignField: "_id",
            as: "evaluator",
          },
        },
        { $unwind: "$evaluator" },
        { $match: { "evaluator.role": "cq" } },
        {
          $group: {
            _id: "$evaluator._id",
            cqName: { $first: "$evaluator.name" },
            cqEmail: { $first: "$evaluator.email" },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            cqId: "$_id",
            cqName: 1,
            cqEmail: 1,
            count: 1,
          },
        },
        { $sort: { cqName: 1 } },
      ];

      const stats = await Score.aggregate(pipeline);
      res.json(stats);
    } catch (err) {
      console.error("GET /admin/cq-stats error:", err);
      res.status(500).json({
        message: "Erreur serveur lors du chargement des statistiques CQ.",
      });
    }
  }
);

/* =========================================================================
 *  ÉVALUATIONS : VUE ADMIN PAR CQ / MANAGEMENT
 * ========================================================================= */

function mapScoreForAdminResponse(doc) {
  const avg = computeAverageScore(doc);

  const pilot = doc.pilot || null;
  const evaluator = doc.evaluator || null;

  const base = {
    _id: doc._id,
    eps: doc.eps || "",
    pickingPrime: !!doc.pickingPrime,
    callDuration: doc.callDuration || "",
    listeningDate: doc.listeningDate || null,
    callDate: doc.callDate || null,
    interactionDate: doc.interactionDate || null,
    createdAt: doc.createdAt || null,

    comment: doc.comment || "",
    contested: !!doc.contested,

    items: doc.items || [],

    pilot: pilot
      ? {
          _id: pilot._id,
          name: pilot.name,
          email: pilot.email,
          cell: pilot.cell || "",
        }
      : null,
    pilotName: pilot?.name || "",
    pilotEmail: pilot?.email || "",
    pilotCell: pilot?.cell || "",
    cell: pilot?.cell || "",

    evaluatorId: evaluator?._id || null,
    evaluatorName: evaluator?.name || "",
    evaluatorRole: evaluator?.role || "",
    role: evaluator?.role || "",
    avgScore: avg,
  };

  if (evaluator?.role === "cq") {
    base.cqName = evaluator.name;
  }
  if (evaluator?.role === "management") {
    base.managerName = evaluator.name;
  }

  return base;
}

/**
 * GET /admin/evaluations/cq
 * Toutes les évaluations réalisées par les CQ (pour tableau + export Excel)
 */
router.get(
  "/evaluations/cq",
  // Autorise l'export global des évaluations CQ depuis l'espace CQ.
  // (Le rôle CQ reste non autorisé sur les autres routes admin.)
  permit("admin", "management", "cq", "formateur", "superviseur", "cdp"),
  async (req, res) => {
    try {
      const scopeClause = await pilotScopeClause(await getScope(req));
      const scores = await Score.find(scopeClause || {}).lean()
        .populate("pilot", "-passwordHash")
        .populate("evaluator", "-passwordHash")
        .lean();

      const filtered = scores.filter((s) => s.evaluator && s.evaluator.role === "cq");

      const result = filtered.map(mapScoreForAdminResponse);
      res.json(result);
    } catch (err) {
      console.error("GET /admin/evaluations/cq error:", err);
      res.status(500).json({
        message: "Erreur serveur lors du chargement des évaluations CQ.",
      });
    }
  }
);

/**
 * GET /admin/evaluations/management
 * Toutes les évaluations réalisées par le management
 */
router.get(
  "/evaluations/management",
  permit("admin", "management", "superviseur", "cdp"),
  async (req, res) => {
    try {
      const scopeClause = await pilotScopeClause(await getScope(req));
      const scores = await Score.find(scopeClause || {}).lean()
        .populate("pilot", "-passwordHash")
        .populate("evaluator", "-passwordHash")
        .lean();

      const filtered = scores.filter(
        (s) => s.evaluator && s.evaluator.role === "management"
      );

      const result = filtered.map(mapScoreForAdminResponse);
      res.json(result);
    } catch (err) {
      console.error("GET /admin/evaluations/management error:", err);
      res.status(500).json({
        message: "Erreur serveur lors du chargement des évaluations Management.",
      });
    }
  }
);


/* ================================
 *  NOTIFICATIONS (ADMIN)
 * ================================ */

/**
 * GET /admin/notifications
 */
router.get(
  "/notifications",
  permit("admin"),
  async (req, res) => {
    try {
      const list = await Notification.find({}).lean()
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 })
        .lean();
      res.json(list);
    } catch (err) {
      console.error("GET /admin/notifications error:", err);
      res.status(500).json({ message: "Erreur serveur lors du chargement des notifications." });
    }
  }
);

/**
 * POST /admin/notifications
 * Body: { type, title, message, targetAll, targetCells, targetUsers }
 */
router.post(
  "/notifications",
  permit("admin"),
  async (req, res) => {
    try {
      const { type, title, message, targetAll, targetCells, targetUsers } = req.body || {};
      const t = (type || "").toString().trim();

      if (!["information", "notification", "alerte"].includes(t)) {
        return res.status(400).json({ message: "Type de notification invalide." });
      }
      const msg = (message || "").toString().trim();
      if (!msg) return res.status(400).json({ message: "Le message est obligatoire." });

      const payload = {
        type: t,
        title: (title || "").toString().trim(),
        message: msg,
        targetAll: !!targetAll,
        targetCells: Array.isArray(targetCells)
          ? targetCells.map((c) => (c || "").toString().trim()).filter(Boolean)
          : [],
        targetUsers: Array.isArray(targetUsers)
          ? targetUsers.filter((id) => mongoose.Types.ObjectId.isValid(id))
          : [],
        createdBy: req.user.id || req.user._id,
      };

      // si targetAll=true, on ignore les autres ciblages côté logique de diffusion,
      // mais on les conserve éventuellement pour l'admin (pas bloquant). On peut les vider pour être clair:
      if (payload.targetAll) {
        payload.targetCells = [];
        payload.targetUsers = [];
      }

      const created = await Notification.create(payload);
      const populated = await Notification.findById(created._id)
        .populate("createdBy", "name email role")
        .lean();

      
      // 🔔 Realtime push (socket.io)
      try {
        const io = req.app.get("io");
        if (io) {
          if (populated.targetAll) {
            io.emit("notification:new", populated);
          } else {
            const cells = Array.isArray(populated.targetCells) ? populated.targetCells : [];
            const users = Array.isArray(populated.targetUsers) ? populated.targetUsers : [];
            cells.forEach((c) => c && io.to(`cell:${c}`).emit("notification:new", populated));
            users.forEach((u) => u && io.to(`user:${u}`).emit("notification:new", populated));
          }
        }
      } catch (e) {}
res.status(201).json(populated);
    } catch (err) {
      console.error("POST /admin/notifications error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la création de la notification." });
    }
  }
);

/**
 * DELETE /admin/notifications/:id
 */
router.delete(
  "/notifications/:id",
  permit("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID invalide." });
      }

      const n = await Notification.findById(id);
      if (!n) return res.status(404).json({ message: "Notification introuvable." });

      await n.deleteOne();
      res.json({ message: "Notification supprimée." });
    } catch (err) {
      console.error("DELETE /admin/notifications/:id error:", err);
      res.status(500).json({ message: "Erreur serveur lors de la suppression de la notification." });
    }
  }
);



/**
 * DELETE /admin/evaluations/:id
 * HARD delete an evaluation (Score) and its dependent coaching rows.
 * This is intentionally NOT a soft delete.
 */
router.delete(
  "/evaluations/:id",
  permit("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID invalide." });
      }

      const score = await Score.findById(id);
      if (!score) return res.status(404).json({ message: "Évaluation introuvable." });

      // Remove dependent coaching first (best-effort)
      await Coaching.deleteMany({ score: score._id });

      // Contrat Orange : l'échantillon lié redevient à évaluer
      try {
        await Sample.updateMany({ score: score._id, assignedTo: { $ne: null } }, { $set: { status: "assigned", score: null, doneAt: null } });
        await Sample.updateMany({ score: score._id }, { $set: { status: "pending", score: null, doneAt: null } });
      } catch (_) { /* best-effort */ }

      await Score.deleteOne({ _id: score._id });

      await logAudit(req, { action: "DELETE_EVALUATION", targetType: "score", targetId: score._id, metadata: { eps: score.eps || "", pilotId: score.pilot || score.pilotId || "" } });

      return res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /admin/evaluations/:id error:", err);
      return res.status(500).json({ message: "Erreur lors de la suppression de l'évaluation." });
    }
  }
);


// -------------------- Audit log (Admin) --------------------
router.get(
  "/audit",
  auth,
  permit("admin"),
  async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const skip = (page - 1) * limit;

      const action = (req.query.action || "").toString().trim();
      const targetType = (req.query.targetType || "").toString().trim();
      const actor = (req.query.actor || "").toString().trim();

      const q = {};
      if (action) q.action = action;
      if (targetType) q.targetType = targetType;
      if (actor && mongoose.Types.ObjectId.isValid(actor)) q.actor = actor;

      const [items, total] = await Promise.all([
        AuditLog.find(q)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("actor", "name email role cell")
          .lean(),
        AuditLog.countDocuments(q),
      ]);

      res.json({ items, total, page, limit });
    } catch (e) {
      console.error("GET /admin/audit error:", e);
      res.status(500).json({ message: "Erreur chargement audit log" });
    }
  }
);

// -------------------- Health (Admin) --------------------
router.get(
  "/health",
  auth,
  permit("admin"),
  async (req, res) => {
    const startedAt = req.app.get("startedAt");
    try {
      const mongoState = mongoose.connection?.readyState || 0; // 1 connected
      let pingMs = null;
      if (mongoState === 1) {
        const t0 = Date.now();
        // cheap ping
        await mongoose.connection.db.admin().ping();
        pingMs = Date.now() - t0;
      }

      const getClients = req.app.get("socketClients");
      const socketClients = typeof getClients === "function" ? getClients() : null;

      res.json({
        ok: true,
        uptimeSec: Math.floor(process.uptime()),
        mongo: { connected: mongoState === 1, readyState: mongoState, pingMs },
        socket: { connectedClients: socketClients },
        version: process.env.npm_package_version || "",
        startedAt: startedAt || null,
      });
    } catch (e) {
      console.error("GET /admin/health error:", e);
      res.status(500).json({ ok: false, message: "Health check failed" });
    }
  }
);

// -------------------- AI Assistant (OpenRouter) --------------------

/**
 * POST /admin/ai/chat
 * Proxy to AI API with auto-router + fallback models.
 * Body: { message: string, context?: string }
 */
router.post("/ai/chat", async (req, res) => {
  try {
    const { message, context, history = [], format = "auto" } = req.body || {};
    if (typeof message !== "string" || message.length > 12000 || (context !== undefined && (typeof context !== "string" || context.length > 20000))) {
      return res.status(400).json({ message: "Message ou contexte invalide ou trop long." });
    }
    if (!["auto", "text", "docx", "xlsx"].includes(format) || !Array.isArray(history)) return res.status(400).json({ message: "Format ou historique invalide." });
    const conversation = history.slice(-12).filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0,12000) }));
    while (conversation.reduce((n, m) => n + m.content.length, 0) > 50000) conversation.shift();
    if (!message || !String(message).trim()) {
      return res.status(400).json({ message: "Message requis." });
    }

    const apiKey = process.env.OPENROUTER_API_KEY || "";
    if (!apiKey) {
      return res.status(400).json({ message: "Clé API IA non configurée. Allez dans Santé > Configuration API." });
    }

    const axios = require("axios");

    // openrouter/free auto-selects from available free models
    // Fallbacks: specific models known to be free as of 2025-2026
    const models = [
      "openrouter/free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "meta-llama/llama-4-scout:free",
      "mistralai/mistral-small-3.1-24b-instruct:free",
      "deepseek/deepseek-chat-v3-0324:free",
      "nousresearch/deephermes-3-llama-3-8b-preview:free",
    ];

    const systemPrompt = `L’application transforme tes réponses en véritables fichiers Word (.docx) et Excel (.xlsx) via les boutons de téléchargement. Produis le contenu demandé, sans inventer de lien de téléchargement et sans prétendre avoir enregistré un fichier. Pour Excel, utilise des tableaux Markdown avec une ligne d’en-têtes, des colonnes stables, les identifiants comme texte et les nombres sans unités dans les cellules. Pour Word, utilise titres, paragraphes et tableaux. Format demandé : ${format}. Tu n’as pas d’accès direct à la base de données : utilise seulement les informations fournies dans la conversation et demande les données manquantes, sans inventer de performances ou d’agents. Tu es un assistant IA expert en contrôle qualité call center. Tu aides les superviseurs à analyser les évaluations, identifier les tendances, et proposer des actions correctives. Réponds en français, de façon concise et actionnable.${context ? "\n\nContexte: " + context : ""}`;

    let lastError = null;
    for (const model of models) {
      try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            ...conversation,
            { role: "user", content: String(message).trim() },
          ],
          max_tokens: 6000,
          temperature: 0.7,
        }, {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.APP_URL || "http://localhost:5000",
            "X-Title": "Kyntus CQ",
          },
          timeout: 30000,
        });

        const choice = response.data?.choices?.[0];
        const reply = choice?.message?.content || "";
        if (choice?.finish_reason === "length") {
          return res.status(422).json({ message: "La réponse dépasse la limite du modèle. Demandez un document plus court ou une partie à la fois pour obtenir un fichier complet." });
        }
        if (typeof reply === "string" && reply.trim()) {
          return res.json({ reply, model: model.split("/").pop() });
        }
      } catch (e) {
        lastError = e?.response?.data?.error?.message || e.message || "Erreur modèle";
        continue;
      }
    }

    return res.status(502).json({ message: `Erreur IA: ${lastError}` });
  } catch (err) {
    console.error("POST /admin/ai/chat error:", err);
    res.status(500).json({ message: "Erreur serveur IA." });
  }
});

// -------------------- Config API Keys (Admin) --------------------

/**
 * GET /admin/config
 * Returns masked API keys status.
 */
router.get("/config", permit("admin"), async (req, res) => {
  try {
    res.json({
      aiKey: process.env.OPENROUTER_API_KEY ? "••••" + (process.env.OPENROUTER_API_KEY).slice(-4) : "",
      pickingApiUrl: process.env.PICKING_API_URL || "",
      pickingApiKey: process.env.PICKING_API_KEY ? "••••" + (process.env.PICKING_API_KEY).slice(-4) : "",
    });
  } catch (err) {
    res.status(500).json({ message: "Erreur." });
  }
});

/**
 * PATCH /admin/config
 * Update runtime env vars.
 */
router.patch("/config", permit("admin"), async (req, res) => {
  try {
    const { aiKey, pickingApiUrl, pickingApiKey } = req.body;
    if (aiKey !== undefined) process.env.OPENROUTER_API_KEY = String(aiKey).trim();
    if (pickingApiUrl !== undefined) process.env.PICKING_API_URL = String(pickingApiUrl).trim();
    if (pickingApiKey !== undefined) process.env.PICKING_API_KEY = String(pickingApiKey).trim();
    res.json({ ok: true, message: "Configuration mise à jour." });
  } catch (err) {
    res.status(500).json({ message: "Erreur." });
  }
});

/**
 * GET /admin/supervision
 * Real-time supervision data: users online, evaluation counts, recent activity.
 */
router.get("/supervision", permit("admin"), async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers, activeUsers, totalPilots, totalCQ, totalMgmt,
      evalsToday, evalsMonth,
      contestedOpen, coachingOpen,
      recentEvals
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ active: { $ne: false } }),
      User.countDocuments({ role: "pilote", active: { $ne: false } }),
      User.countDocuments({ role: "cq", active: { $ne: false } }),
      User.countDocuments({ role: "management", active: { $ne: false } }),
      Score.countDocuments({ createdAt: { $gte: startOfDay } }),
      Score.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Score.countDocuments({ contested: true }),
      Coaching.countDocuments({ status: { $in: ["open", "in_progress"] } }),
      Score.find({ createdAt: { $gte: startOfDay } })
        .populate("pilot", "name cell")
        .populate("evaluator", "name role")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    const getClients = req.app.get("socketClients");
    const socketClients = typeof getClients === "function" ? getClients() : 0;

    res.json({
      users: { total: totalUsers, active: activeUsers, pilots: totalPilots, cq: totalCQ, management: totalMgmt },
      evaluations: { today: evalsToday, month: evalsMonth },
      contested: contestedOpen,
      coachingActive: coachingOpen,
      socketClients,
      recentEvals: (recentEvals || []).map((s) => ({
        _id: s._id,
        pilotName: s.pilot?.name || "—",
        pilotCell: s.pilot?.cell || "—",
        evaluatorName: s.evaluator?.name || "—",
        evaluatorRole: s.evaluator?.role || "—",
        eps: s.eps || "",
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    console.error("GET /admin/supervision error:", err);
    res.status(500).json({ message: "Erreur supervision." });
  }
});


module.exports = router;
