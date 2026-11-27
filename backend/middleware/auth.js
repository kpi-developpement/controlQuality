// backend/middleware/auth.js
const jwt = require("jsonwebtoken");

// À incrémenter pour imposer une reconnexion à tous les utilisateurs
const SESSION_VERSION = 1;

function getJwtSecret() {
  // Support legacy env var name SECRET while keeping JWT_SECRET as primary.
  return process.env.JWT_SECRET || process.env.SECRET || "";
}

function auth(req, res, next) {
  const JWT_SECRET = getJwtSecret();
  if (!JWT_SECRET) {
    return res
      .status(500)
      .json({ message: "Configuration serveur invalide (JWT_SECRET manquant)." });
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ message: "Token manquant" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token invalide" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Session ouverte avant la version courante : reconnexion demandée (une seule fois). La reconnexion
    // enregistre la copie chiffrée du mot de passe, consultable ensuite par l'admin.
    if (Number(decoded?.pv || 0) < SESSION_VERSION) {
      return res.status(401).json({ message: "Session à renouveler : merci de vous reconnecter.", code: "SESSION_RENEW" });
    }
    req.user = decoded; // { id, role, name, ... }
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ message: "Token expiré ou invalide" });
  }
}

// middleware strict management
function allowManagement(req, res, next) {
  if (!req.user || !["management", "superviseur", "referent", "cdp"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ message: "Accès réservé au management." });
  }
  next();
}

auth.allowManagement = allowManagement;

module.exports = auth;
module.exports.allowManagement = allowManagement;
module.exports.SESSION_VERSION = SESSION_VERSION;
