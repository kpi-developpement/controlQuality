"use strict";
/**
 * backend/utils/scope.js — périmètre de visibilité des utilisateurs (contrat Orange).
 *
 * Règles (cahier des besoins §6-7) :
 *  - admin       : tout (inchangé)
 *  - cq, formateur : tout par défaut (inchangé) ; restreignable par l'admin via visibilityScope
 *  - management  : sa cellule (+ projet / contrat s'ils sont renseignés) quand le contrôle
 *                  d'accès est activé ; comportement historique (tout) tant qu'il ne l'est pas
 *  - supervision : sa cellule (+ projet / contrat), toujours appliqué (nouveau rôle)
 *  - pilote      : lui-même
 * Un périmètre explicite (visibilityScope) saisi par l'admin s'applique toujours.
 * Principe : refus par défaut si le profil ne permet pas de déterminer le périmètre.
 */
const mongoose = require("mongoose");
const User = require("../models/User");
const { getSetting } = require("./settings");

// referent : ses pilotes directs ; superviseur : pilotes de ses référents ; cdp : son activité (projet)
const ROLE_DEFAULT = {
  admin: "all", cq: "all", formateur: "all", pilote: "self", management: "cell", supervision: "cell",
  referent: "team", superviseur: "line", cdp: "project",
};
const LEGACY_DEFAULT = { ...ROLE_DEFAULT, management: "all" };
const DENY = Object.freeze({ _id: { $in: [] } });

const escapeRx = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ACCENTS = { a: "aàâäáã", e: "eéèêë", i: "iîïíì", o: "oôöóòõ", u: "uùûüú", c: "cç", y: "yÿ", n: "nñ" };
function cellRegex(c) {
  // Insensible à la casse, aux accents et aux espaces (début, fin, espaces multiples)
  const base = String(c).trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const body = [...base].map((ch) => {
    if (/\s/.test(ch)) return "\\s+";
    if (ACCENTS[ch]) return `[${ACCENTS[ch]}]`;
    return escapeRx(ch);
  }).join("");
  return new RegExp(`^\\s*${body}\\s*$`, "i");
}
function sameOrEmpty(field, value) {
  return { $or: [{ [field]: value }, { [field]: "" }, { [field]: null }] };
}

/** Le document (cell / project / contract) respecte-t-il le périmètre ? Même règle que le filtre Mongo. */
function matchesScopeFields(scope, doc) {
  if (!scope || scope.unrestricted) return true;
  const d = doc || {};
  const val = (k) => String(d[k] || "").trim();
  if (scope.mode === "cell") {
    if (!scope.cells.length) return false;
    if (!scope.cells.some((c) => cellRegex(c).test(String(d.cell || "")))) return false;
    if (scope.project && val("project") && val("project") !== scope.project) return false;
    if (scope.contract && val("contract") && val("contract") !== scope.contract) return false;
    return true;
  }
  if (scope.mode === "project") {
    if (!scope.project || val("project") !== scope.project) return false;
    return !scope.contract || val("contract") === scope.contract;
  }
  if (scope.mode === "contract") return !!scope.contract && val("contract") === scope.contract;
  return false;
}

function uniq(arr) {
  return [...new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean))];
}

/** Calcule le périmètre (pur, testable). */
function computeScope(user, tokenUser, enforced) {
  const role = String((user && user.role) || (tokenUser && tokenUser.role) || "");
  const userId = String((user && user._id) || (tokenUser && (tokenUser.id || tokenUser._id)) || "");
  let mode;
  if (role === "admin") mode = "all";
  else if (user && user.visibilityScope) mode = user.visibilityScope;
  else mode = (enforced ? ROLE_DEFAULT[role] : LEGACY_DEFAULT[role]) || "self";
  return {
    userId,
    role,
    mode,
    unrestricted: mode === "all",
    cells: uniq([user && user.cell, ...((user && user.extraCells) || [])]),
    project: String((user && user.project) || "").trim(),
    contract: String((user && user.contract) || "").trim(),
    editScope: String((user && user.editScope) || ""),
    enforced: !!enforced,
  };
}

/** Filtre Mongo sur la collection users : membres du périmètre. null = sans restriction. */
function userFilterForScope(scope) {
  if (!scope || scope.unrestricted) return null;
  const extra = {};
  if (scope.project) extra.project = scope.project;
  if (scope.contract) extra.contract = scope.contract;
  switch (scope.mode) {
    case "self":
      return mongoose.Types.ObjectId.isValid(scope.userId) ? { _id: new mongoose.Types.ObjectId(scope.userId) } : DENY;
    case "cell": {
      if (!scope.cells.length) return DENY;
      // Cellule : insensible à la casse et aux espaces superflus (saisies / imports Excel).
      const cellClause = { $or: scope.cells.map((c) => ({ cell: cellRegex(c) })) };
      // Projet / contrat du responsable : on exclut les agents rattachés à un AUTRE projet
      // ou contrat, sans exclure ceux dont le champ n'est pas encore renseigné.
      const and = [cellClause];
      if (scope.project) and.push(sameOrEmpty("project", scope.project));
      if (scope.contract) and.push(sameOrEmpty("contract", scope.contract));
      return { $and: and };
    }
    case "project":
      return scope.project ? { ...extra } : DENY;
    case "contract":
      return scope.contract ? { contract: scope.contract } : DENY;
    case "team":
      // Référent technique : pilotes qui lui sont directement affectés
      return mongoose.Types.ObjectId.isValid(scope.userId) ? { referent: new mongoose.Types.ObjectId(scope.userId) } : DENY;
    case "line": {
      // Superviseur : pilotes rattachés à ses référents + pilotes affectés directement + ses référents
      if (!mongoose.Types.ObjectId.isValid(scope.userId)) return DENY;
      const me = new mongoose.Types.ObjectId(scope.userId);
      const leads = (scope.teamLeads || []).map((id) => new mongoose.Types.ObjectId(String(id)));
      return { $or: [{ referent: { $in: leads } }, { superviseur: me }, { _id: { $in: leads } }] };
    }
    default:
      return DENY;
  }
}

/** Filtre Mongo sur les échantillons (champs cell/project/contract du document). */
function sampleFilterForScope(scope) {
  if (!scope || scope.unrestricted) return null;
  if (scope.mode === "team" || scope.mode === "line") return DENY; // périmètres par agent, pas par cellule
  const f = userFilterForScope(scope);
  if (!f || f === DENY || f._id) return DENY;
  return f; // mêmes noms de champs : cell, project, contract
}

async function getScope(req) {
  if (req._kcqScope) return req._kcqScope;
  const tokenUser = req.user || {};
  const id = tokenUser.id || tokenUser._id;
  let user = null;
  if (id && mongoose.Types.ObjectId.isValid(String(id))) {
    user = await User.findById(id).select("role cell project contract extraCells visibilityScope editScope active").lean();
  }
  const enforced = await getSetting("accessScopeEnforced");
  req._kcqScope = computeScope(user, tokenUser, enforced);
  if (req._kcqScope.mode === "line" && user) {
    req._kcqScope.teamLeads = (await User.distinct("_id", { role: "referent", superviseur: user._id })).map(String);
  }
  return req._kcqScope;
}

/** Identifiants des utilisateurs (agents) visibles. null = sans restriction. */
async function visibleUserIds(scope) {
  const f = userFilterForScope(scope);
  if (!f) return null;
  if (f === DENY) return [];
  return User.distinct("_id", f);
}

/** Clause à ajouter dans un $and sur Score / Coaching (champ pilot). null = sans restriction. */
async function pilotScopeClause(scope, field = "pilot") {
  const ids = await visibleUserIds(scope);
  if (ids === null) return null;
  return { [field]: { $in: ids } };
}

/** Ajoute une clause dans q.$and sans écraser l'existant. */
function andClause(q, clause) {
  if (!clause) return q;
  q.$and = [...(q.$and || []), clause];
  return q;
}

/** Vérifie qu'un agent (id) appartient au périmètre. */
async function isPilotInScope(scope, pilotId) {
  if (!scope || scope.unrestricted) return true;
  const f = userFilterForScope(scope);
  if (!f || f === DENY || !pilotId || !mongoose.Types.ObjectId.isValid(String(pilotId))) return false;
  const found = await User.exists({ $and: [{ _id: pilotId }, f] });
  return !!found;
}

module.exports = { ROLE_DEFAULT, LEGACY_DEFAULT, DENY, computeScope, userFilterForScope, matchesScopeFields, sampleFilterForScope, getScope, visibleUserIds, pilotScopeClause, andClause, isPilotInScope };
