// Rôles « calqués » sur Management : Superviseur, Référent technique et Chef de projet ont au minimum
// tous les accès du Management (leur périmètre de visibilité reste propre à chacun, cf. utils/scope.js).
const MANAGEMENT_LIKE = ["superviseur", "referent", "cdp"];

function expandRoles(roles) {
  const set = new Set(roles);
  if (set.has("management")) MANAGEMENT_LIKE.forEach((r) => set.add(r));
  return set;
}

module.exports = function permit(...allowedRoles) {
  const allowed = expandRoles(allowedRoles);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (!allowed.has(req.user.role))
      return res.status(403).json({ message: 'Accès interdit' });
    next();
  };
};
module.exports.MANAGEMENT_LIKE = MANAGEMENT_LIKE;
module.exports.expandRoles = expandRoles;
