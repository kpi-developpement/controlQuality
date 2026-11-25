"use strict";
// backend/utils/passwordVault.js — copie chiffrée (AES-256-GCM) du mot de passe, consultable par l'admin.
//
// Demande du client : afficher le mot de passe actuel dans le Panneau Admin. Le hash bcrypt (utilisé
// pour la connexion) est irréversible ; on conserve donc en plus une copie CHIFFRÉE, jamais en clair.
// Clé : PASSWORD_VIEW_KEY si défini, sinon dérivée de JWT_SECRET. Sans clé : fonction désactivée.
// Seuls les mots de passe définis après la mise en place sont consultables.
const crypto = require("crypto");

function key() {
  const secret = process.env.PASSWORD_VIEW_KEY || process.env.JWT_SECRET || "";
  if (!secret) return null;
  return crypto.createHash("sha256").update(`kcq-password-view:${secret}`).digest();
}

/** Chiffre un mot de passe ; "" si aucune clé n'est configurée. Format : v1.iv.tag.data (base64url). */
function sealPassword(plain) {
  const k = key();
  if (!k || !plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

/** Déchiffre ; null si absent, clé changée ou donnée altérée. */
function openPassword(sealed) {
  const k = key();
  if (!k || !sealed) return null;
  try {
    const [v, iv, tag, data] = String(sealed).split(".");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

module.exports = { sealPassword, openPassword };
